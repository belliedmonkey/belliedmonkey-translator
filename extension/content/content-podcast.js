// content-podcast.js — Podcast bilingual subtitles (audio analogue of YouTube).
//
// See docs/domain-design.md §2.2 (core constraint) and interaction-spec.md.
// Strategy: acquire an EXISTING timed transcript whole (in-page WebVTT/SRT, or a
// Podcasting 2.0 <podcast:transcript> from the feed, or — Phase B — Spotify's synced
// DOM), merge into sentences, translate ahead in the 60s window (reusing the same
// TranslationCore subtitle engine as YouTube), and render a self-drawn overlay
// anchored to the VIEWPORT (audio pages have no video frame), synced to the <audio>
// element's currentTime. No word-by-word, no ASR; if there's no timed transcript we
// show 字幕不可用 and the webpage text path still translates the show-notes page.

var PodcastTranslator = (() => {
  const OVERLAY_ID = 'mt-pod-overlay';
  const ORIG_CLASS = 'mt-pod-orig';
  const TRANS_CLASS = 'mt-pod-trans';
  const BTN_ID = 'mt-pod-btn';
  const MENU_ID = 'mt-pod-menu';
  const IS_SPOTIFY = /(^|\.)spotify\.com$/.test(location.hostname);

  let settings = {};
  let active = false;
  let pollTimer = null;
  let lastKey = '';            // episode identity (url + audio src) to detect changes
  let displayMode = 'both';    // 'both' | 'trans' | 'orig'
  let lastShownKey = '';

  // transcript acquisition state (full transcript up front — see §2.2). We retry a
  // few times because a podcast embed may render its transcript URL into the DOM
  // slightly after the audio element appears (and to ride out a transient CDN hiccup).
  let transcriptStatus = '';   // '' | 'loading' | 'ready' | 'unavailable'
  let resolveInFlight = false;
  let resolveAttempts = 0;
  let resolveNextAt = 0;
  const RESOLVE_MAX_ATTEMPTS = 6;
  const RESOLVE_RETRY_MS = 2500;

  const pager = TranslationCore.createPager({ measurerId: 'mt-pod-meas' });
  const engine = TranslationCore.createSubtitleEngine({
    getCurrentTime: () => positionMs(),
    translate: (text) => TranslationAPI.translate(
      text, settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      settings.provider || 'google', settings.apiKey || '', settings.apiBaseUrl || ''),
  });

  // ─── Media element ─────────────────────────────────────────────────────
  // Prefer an <audio> that is actually playing/progressed; fall back to <video>
  // for audio-only <video> players. (We are not initialized on YouTube.)
  function mediaEl() {
    const els = Array.from(document.querySelectorAll('audio, video'));
    if (!els.length) return null;
    return els.find((e) => !e.paused && e.currentTime > 0)
      || els.find((e) => e.currentTime > 0)
      || els.find((e) => e.tagName === 'AUDIO')
      || els[0];
  }
  // On Spotify only ENGAGE on an episode page (so music/playlist pages stay dormant →
  // text-only, no 字幕不可用). Elsewhere, any media element means a podcast may be present.
  function isSpotifyEpisode() { return /\/episode\//.test(location.pathname) || !!document.querySelector('[data-testid="transcript-tab"]'); }
  function hasMedia() { return IS_SPOTIFY ? isSpotifyEpisode() : !!document.querySelector('audio, video'); }
  function episodeKey() {
    if (IS_SPOTIFY) return location.href; // media is a muted blob <video>; identity is the episode URL
    const m = mediaEl(); return location.href + '|' + (m ? (m.currentSrc || m.src || '') : '');
  }

  // Playback position in ms. Spotify streams via MSE — the <video> element's
  // currentTime is a buffer position, NOT the episode position — so read the real
  // position (ms) off the player's progress-bar slider (aria-valuenow). Elsewhere the
  // media element's currentTime is authoritative.
  function spotifyProgressEl() {
    return document.querySelector('[data-testid="playback-progressbar"] input[type="range"], [data-testid="progress-bar"] input[type="range"]')
      || [...document.querySelectorAll('[role="slider"][aria-valuenow]')].find((s) => +s.getAttribute('aria-valuemax') > 60000);
  }
  function positionMs() {
    if (IS_SPOTIFY) {
      const el = spotifyProgressEl();
      if (el) { const v = +(el.value || el.getAttribute('aria-valuenow')); if (isFinite(v)) return v; }
      return 0;
    }
    return (mediaEl()?.currentTime || 0) * 1000;
  }

  // ─── Timed-text parsing (WebVTT / SRT) ─────────────────────────────────
  function tcToMs(tc) {
    tc = (tc || '').trim().replace(',', '.').split(' ')[0];
    const p = tc.split(':');
    let h = 0, m = 0, s = 0;
    if (p.length === 3) { h = +p[0]; m = +p[1]; s = parseFloat(p[2]); }
    else if (p.length === 2) { m = +p[0]; s = parseFloat(p[1]); }
    else { s = parseFloat(p[0]); }
    return Math.round(((h * 3600 + m * 60 + s) || 0) * 1000);
  }
  function stripCueTags(t) { return t.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[^\S\n]+/g, ' ').trim(); }

  // Parses both WebVTT and SRT (tcToMs normalizes ',' → '.').
  function parseTimedText(text) {
    const out = [];
    const blocks = text.replace(/\r/g, '').split(/\n\n+/);
    for (const b of blocks) {
      const lines = b.split('\n').filter((l) => l.length);
      const tl = lines.find((l) => l.indexOf('-->') !== -1);
      if (!tl) continue;
      const parts = tl.split('-->');
      if (parts.length < 2) continue;
      const start = tcToMs(parts[0]);
      const end = tcToMs(parts[1]);
      if (!(end > start)) continue;
      const txt = stripCueTags(lines.slice(lines.indexOf(tl) + 1).join(' '));
      if (txt) out.push({ start, end, text: txt });
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  async function fetchTimedText(url) {
    try {
      // NO credentials: a CloudFront-signed transcript URL (e.g. Substack's
      // substackcdn.com en.vtt) returns 503 for cookie-bearing requests — the
      // signature already authorizes it. Default 'same-origin' still sends cookies
      // for a same-origin <track src> but never to a cross-origin CDN.
      const r = await fetch(url);
      if (!r.ok) return null;
      const txt = await r.text();
      if (/^\s*<\?xml|<Error>|MissingKey/i.test(txt.slice(0, 120))) return null; // signed-URL error etc.
      const cues = parseTimedText(txt);
      return cues.length ? cues : null;
    } catch (_) { return null; }
  }

  // ─── Cue sources ───────────────────────────────────────────────────────
  // 1) An in-page WebVTT/SRT URL (a <track src>, or a URL embedded in the page —
  //    e.g. Substack's CloudFront-SIGNED `…/en.vtt?Expires=…&Signature=…&Key-Pair-Id=…`;
  //    the bare/unsigned URL is rejected, so we prefer the signed one).
  function findCaptionUrlInPage() {
    for (const tr of document.querySelectorAll('track')) {
      const k = (tr.getAttribute('kind') || '').toLowerCase();
      if (tr.src && (k === '' || k === 'subtitles' || k === 'captions')) return tr.src;
    }
    let html = document.documentElement.innerHTML;
    html = html.replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
    const signed = html.match(/https?:\/\/[^"'\\\s]+\.(?:vtt|srt)\?[^"'\\\s]*(?:Key-Pair-Id|Signature|token|Expires)=[^"'\\\s]+/i);
    if (signed) return signed[0];
    const any = html.match(/https?:\/\/[^"'\\\s]+\.(?:vtt|srt)(?:\?[^"'\\\s]*)?/i);
    return any ? any[0] : null;
  }

  // 2) Podcasting 2.0 <podcast:transcript> from the page's RSS feed.
  async function resolveViaRss() {
    const link = document.querySelector('link[rel="alternate"][type="application/rss+xml"]');
    if (!link) return null;
    let feedUrl; try { feedUrl = new URL(link.getAttribute('href'), location.href).toString(); } catch (_) { return null; }
    let xml; try { const r = await fetch(feedUrl); if (!r.ok) return null; xml = await r.text(); } catch (_) { return null; }
    let doc; try { doc = new DOMParser().parseFromString(xml, 'application/xml'); } catch (_) { return null; }
    const items = Array.from(doc.querySelectorAll('item'));
    if (!items.length) return null;
    const m = mediaEl();
    const audioSrc = (m && (m.currentSrc || m.src)) || '';
    const pageTitle = (document.title || '').toLowerCase();
    const item = items.find((it) => { const e = it.querySelector('enclosure'); return e && audioSrc && e.getAttribute('url') === audioSrc; })
      || items.find((it) => { const t = (it.querySelector('title') || {}).textContent || ''; return t && pageTitle && pageTitle.indexOf(t.slice(0, 24).toLowerCase()) !== -1; })
      || items[0];
    const trs = Array.from(item.getElementsByTagName('podcast:transcript'));
    if (!trs.length) return null;
    const pick = trs.find((t) => /vtt/i.test(t.getAttribute('type') || ''))
      || trs.find((t) => /srt|subrip/i.test(t.getAttribute('type') || '')) || trs[0];
    const url = pick.getAttribute('url');
    if (!url || /json|html|plain/i.test(pick.getAttribute('type') || '')) return null; // need a TIMED format
    return fetchTimedText(url);
  }

  // 3) Spotify synced "Read along" transcript (open.spotify.com).
  // The transcript only mounts when the episode page's 转录/Transcript tab is active,
  // so we activate it once, then scrape the cue list. The cue DOM uses hashed class
  // names (fragile), so we anchor structurally: the list is the div whose direct
  // children are the cue rows — header rows carry a seek <button> whose text starts
  // with a m:ss timestamp; the following non-button rows are that cue's spoken text.
  // Timestamps are second-granularity; position comes from positionMs() (progress bar).
  let spotifyTabActivated = false;
  function spotifyTranscriptList() {
    const isHeader = (el) => {
      const b = el.querySelector && el.querySelector('button');
      return !!(b && /^\d{1,2}:\d{2}(:\d{2})?/.test((el.textContent || '').trim()));
    };
    const list = [...document.querySelectorAll('div')].find(
      (d) => d.children.length > 20 && [...d.children].filter(isHeader).length > 4);
    return { list, isHeader };
  }
  function resolveSpotifyDom() {
    if (!IS_SPOTIFY) return null;
    const { list, isHeader } = spotifyTranscriptList();
    if (!list) {
      // Not mounted yet — activate the Transcript tab once so it renders, then let the
      // resolve retry loop pick it up next tick. Only auto-click once per episode.
      const tab = document.querySelector('[data-testid="transcript-tab"]');
      if (tab && !spotifyTabActivated) { spotifyTabActivated = true; try { tab.click(); } catch (_) {} }
      return null; // no transcript tab at all → this episode has none → text floor
    }
    const parseTs = (t) => {
      const p = t.split(':').map(Number);
      const s = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
      return Math.round((s || 0) * 1000);
    };
    const cues = [];
    let cur = null;
    for (const row of list.children) {
      const txt = (row.textContent || '').replace(/\s+/g, ' ').trim();
      if (isHeader(row)) {
        const m = txt.match(/^(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (cur && cur.text) cues.push(cur);
        cur = { start: parseTs(m[1]), end: 0, text: '' };
      } else if (cur && txt) {
        if (/自动生成|automatically generated|accuracy/i.test(txt)) continue; // skip the disclaimer
        cur.text = (cur.text ? cur.text + ' ' : '') + txt;
      }
    }
    if (cur && cur.text) cues.push(cur);
    for (let i = 0; i < cues.length - 1; i++) cues[i].end = cues[i + 1].start;
    if (cues.length) cues[cues.length - 1].end = cues[cues.length - 1].start + 6000;
    return cues.length ? cues : null;
  }

  async function resolveCues() {
    const inPage = findCaptionUrlInPage();
    if (inPage) { const c = await fetchTimedText(inPage); if (c && c.length) return c; }
    const rss = await resolveViaRss(); if (rss && rss.length) return rss;
    const sp = resolveSpotifyDom(); if (sp && sp.length) return sp;
    return null;
  }

  // ─── Overlay (self-rendered, anchored to the viewport) ─────────────────
  function ensureOverlay() {
    let ov = document.getElementById(OVERLAY_ID);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = OVERLAY_ID;
      ov.style.cssText =
        'position:fixed;left:50%;bottom:8%;transform:translateX(-50%);' +
        'width:max-content;max-width:90%;z-index:2147482000;pointer-events:none;' +
        'display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;';
      const en = document.createElement('div'); en.className = ORIG_CLASS;
      const zh = document.createElement('div'); zh.className = TRANS_CLASS;
      ov.appendChild(en); ov.appendChild(zh);
      document.body.appendChild(ov);
    }
    return ov;
  }

  function fontPx() { return Math.max(15, Math.min(30, Math.round(window.innerWidth * 0.026))); }
  function overlayTextWidth() { return Math.min(Math.round(window.innerWidth * 0.9), 760) - 24; }

  function lineCss(fp, color) {
    return 'display:inline-block;max-width:100%;box-sizing:border-box;' +
      `color:${color};font-size:${fp}px;line-height:1.3;` +
      'padding:2px 10px;background:rgba(8,8,8,0.82);border-radius:3px;' +
      'text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;' +
      'text-shadow:1px 1px 2px rgba(0,0,0,0.85);';
  }

  function pagesFor(s, fp, width) {
    if (!s._pg || s._pg.w !== width || s._pg.fp !== fp || s._pg.trText !== (s.tr || '')) {
      s._pg = {
        w: width, fp, trText: s.tr || '',
        en: pager.pageize(s.text, 1, fp, width),
        zh: s.tr ? pager.pageize(s.tr, 1, Math.round(fp * 0.95), width) : null,
      };
    }
    return s._pg;
  }

  function renderOverlay(en, zh, state, sentence) {
    const ov = ensureOverlay();
    const enEl = ov.querySelector('.' + ORIG_CLASS);
    const zhEl = ov.querySelector('.' + TRANS_CLASS);
    const fp = fontPx();
    if (displayMode === 'trans' || !en) { enEl.style.display = 'none'; enEl.textContent = ''; }
    else { enEl.style.cssText = lineCss(fp, '#fff'); enEl.textContent = en; }
    zhEl.onclick = null;
    if (displayMode === 'orig') { zhEl.style.display = 'none'; zhEl.textContent = ''; }
    else if (zh) { zhEl.style.cssText = lineCss(Math.round(fp * 0.95), settings.ytTextColor || '#fff'); zhEl.textContent = zh; }
    else if (state === 'error') {
      zhEl.style.cssText = lineCss(Math.round(fp * 0.85), '#ffb3b3') + 'pointer-events:auto;cursor:pointer;';
      zhEl.textContent = TranslationCore.MSG.error;
      zhEl.onclick = () => { engine.retry(sentence); lastShownKey = ''; };
    } else if (state === 'pending') {
      zhEl.style.cssText = lineCss(Math.round(fp * 0.85), '#d6d6d6') + 'opacity:.85;font-style:italic;';
      zhEl.textContent = TranslationCore.MSG.preparing;
    } else { zhEl.style.display = 'none'; zhEl.textContent = ''; }
  }

  function renderNotice(msg) {
    const ov = ensureOverlay();
    const enEl = ov.querySelector('.' + ORIG_CLASS);
    const zhEl = ov.querySelector('.' + TRANS_CLASS);
    enEl.style.display = 'none'; enEl.textContent = '';
    zhEl.onclick = null;
    zhEl.style.cssText = lineCss(Math.round(fontPx() * 0.85), '#d6d6d6') + 'opacity:.85;font-style:italic;';
    zhEl.textContent = msg;
  }

  function clearOverlay() {
    const ov = document.getElementById(OVERLAY_ID);
    if (ov) { ov.querySelector('.' + ORIG_CLASS).textContent = ''; ov.querySelector('.' + TRANS_CLASS).textContent = ''; }
    lastShownKey = '';
  }
  function removeOverlay() { document.getElementById(OVERLAY_ID)?.remove(); document.getElementById('mt-pod-meas')?.remove(); }

  // ─── Display loop ──────────────────────────────────────────────────────
  function tick() {
    ensureControlButton();
    if (!active) { if (document.getElementById(OVERLAY_ID)) clearOverlay(); return; }
    // Dormant on non-media pages (the FAB also turns us on for plain articles).
    if (!hasMedia()) { if (document.getElementById(OVERLAY_ID)) clearOverlay(); return; }

    if (episodeKey() !== lastKey) {
      lastKey = episodeKey();
      engine.setItems([]); engine.reset();
      resolveInFlight = false; resolveAttempts = 0; resolveNextAt = 0;
      spotifyTabActivated = false;
      transcriptStatus = ''; clearOverlay();
    }

    if (!engine.items.length && transcriptStatus !== 'unavailable' && !resolveInFlight
        && hasMedia() && Date.now() >= resolveNextAt) {
      resolveInFlight = true; transcriptStatus = 'loading'; resolveAttempts++;
      resolveCues().then((cues) => {
        if (cues && cues.length) { engine.setItems(TranslationCore.mergeSentences(cues)); transcriptStatus = 'ready'; }
        else if (resolveAttempts >= RESOLVE_MAX_ATTEMPTS) { transcriptStatus = 'unavailable'; }
        else { resolveNextAt = Date.now() + RESOLVE_RETRY_MS; }
      }).catch(() => {
        if (resolveAttempts >= RESOLVE_MAX_ATTEMPTS) transcriptStatus = 'unavailable';
        else resolveNextAt = Date.now() + RESOLVE_RETRY_MS;
      }).finally(() => { resolveInFlight = false; });
    }

    const m = mediaEl();
    if (engine.items.length && m) {
      const tMs = m.currentTime * 1000;
      engine.pump();
      const s = engine.activeAt(tMs);
      if (!s) { if (lastShownKey) clearOverlay(); return; }
      const fp = fontPx();
      const width = overlayTextWidth();
      const frac = Math.min(0.999, Math.max(0, (tMs - s.start) / Math.max(1, s.end - s.start)));
      const pg = pagesFor(s, fp, width);
      const en = pg.en[Math.min(pg.en.length - 1, Math.floor(frac * pg.en.length))];
      const st = engine.stateOf(s, tMs);
      let zh = null;
      if (st.translation && pg.zh) zh = pg.zh[Math.min(pg.zh.length - 1, Math.floor(frac * pg.zh.length))];
      const key = s.start + '|' + en + '|' + (zh || st.state);
      if (key !== lastShownKey) { renderOverlay(en, zh, st.state, s); lastShownKey = key; }
    } else {
      lastShownKey = '';
      if (transcriptStatus === 'unavailable') {
        renderNotice(TranslationCore.t('yt_subtitle_unavailable', '字幕不可用'));
      } else {
        renderNotice(TranslationCore.t('yt_subtitle_loading', '⏳ 字幕加载中…'));
      }
    }
  }

  function startLoop() { if (pollTimer) clearInterval(pollTimer); lastKey = episodeKey(); pollTimer = setInterval(tick, 250); }

  // ─── Floating control button + menu ────────────────────────────────────
  function ensureControlButton() {
    if (!active) { document.getElementById(BTN_ID)?.remove(); closeMenu(); return; }
    if (document.getElementById(BTN_ID) || !hasMedia()) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.title = TranslationCore.t('podcast_sub_off', '关闭播客字幕翻译');
    btn.textContent = '译';
    // Sit ABOVE the page-text FAB (bottom:88px, 52px tall → tops at 140px) so the
    // two controls never overlap; both hug the right edge.
    btn.style.cssText =
      'position:fixed;right:18px;bottom:150px;width:40px;height:40px;border-radius:50%;border:none;' +
      'cursor:pointer;background:rgba(10,122,60,.92);color:#fff;font-size:15px;font-weight:700;' +
      'box-shadow:0 1px 6px rgba(0,0,0,.5);z-index:2147483000;';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(btn); });
    document.body.appendChild(btn);
  }

  function closeMenu() { document.getElementById(MENU_ID)?.remove(); }

  function toggleMenu(btn) {
    if (document.getElementById(MENU_ID)) { closeMenu(); return; }
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.style.cssText =
      'position:fixed;right:18px;bottom:196px;max-height:calc(100vh - 220px);overflow-y:auto;' +
      'z-index:2147483000;min-width:200px;background:rgba(28,28,28,.97);border-radius:10px;' +
      'padding:6px 0;font-size:14px;color:#eee;box-shadow:0 2px 12px rgba(0,0,0,.5);';
    const T = TranslationCore.t;
    const row = (label, opts = {}) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;white-space:nowrap;';
      const tk = document.createElement('span'); tk.textContent = opts.checked ? '✓' : '';
      tk.style.cssText = 'width:12px;display:inline-block;color:#4caf50;';
      const t = document.createElement('span'); t.textContent = label; t.style.flex = '1';
      r.appendChild(tk); r.appendChild(t);
      if (opts.onClick) r.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); });
      return r;
    };
    const sep = () => { const s = document.createElement('div'); s.style.cssText = 'height:1px;background:rgba(255,255,255,.12);margin:5px 0;'; return s; };
    const head = document.createElement('div');
    head.textContent = T('yt_display_type', '字幕显示类型');
    head.style.cssText = 'padding:6px 16px 2px;font-size:11px;color:#9a9a9a;';
    menu.appendChild(head);
    menu.appendChild(row(T('yt_mode_both', '双语字幕'), { checked: displayMode === 'both', onClick: () => setMode('both') }));
    menu.appendChild(row(T('yt_mode_trans', '仅译文'), { checked: displayMode === 'trans', onClick: () => setMode('trans') }));
    menu.appendChild(row(T('yt_mode_orig', '仅原文'), { checked: displayMode === 'orig', onClick: () => setMode('orig') }));
    menu.appendChild(sep());
    menu.appendChild(row(T('yt_download_srt', '下载字幕 (.srt)'), { onClick: () => { downloadSrt(); closeMenu(); } }));
    menu.appendChild(row(T('settings', '设置'), { onClick: () => { openSettings(); closeMenu(); } }));
    document.body.appendChild(menu);
    setTimeout(() => {
      const off = (e) => { if (!menu.contains(e.target) && e.target.id !== BTN_ID) { closeMenu(); document.removeEventListener('click', off); } };
      document.addEventListener('click', off);
    }, 0);
  }

  function setMode(mode) { displayMode = mode; clearOverlay(); closeMenu(); tick(); }

  // ─── .srt export ───────────────────────────────────────────────────────
  function msToSrt(ms) {
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), z = ms % 1000;
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(z, 3)}`;
  }
  function downloadSrt() {
    const items = engine.items;
    if (!items.length) { alert(TranslationCore.t('yt_subtitle_not_ready', '字幕还没准备好,等翻译加载后再试')); return; }
    let srt = '';
    items.forEach((s, i) => {
      const body = displayMode === 'orig' ? s.text : displayMode === 'trans' ? (s.tr || s.text) : s.text + (s.tr ? '\n' + s.tr : '');
      srt += `${i + 1}\n${msToSrt(s.start)} --> ${msToSrt(s.end)}\n${body}\n\n`;
    });
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (document.title.replace(/[\\/:*?"<>|]/g, '_') || 'podcast') + '.srt';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function openSettings() {
    try { if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage(); else window.open(chrome.runtime.getURL('options/options.html'), '_blank'); }
    catch (_) { window.open(chrome.runtime.getURL('options/options.html'), '_blank'); }
  }

  // ─── Public API (mirrors YouTubeTranslator) ────────────────────────────
  function applyState() {
    if (!active) { removeOverlay(); document.getElementById(BTN_ID)?.remove(); closeMenu(); }
  }
  function setActive(on) {
    active = on;
    if (on) { resolveInFlight = false; resolveAttempts = 0; resolveNextAt = 0; transcriptStatus = ''; lastKey = episodeKey(); }
    applyState();
    tick();
  }
  function init(cfg) { settings = cfg; active = false; startLoop(); }
  function enable(cfg) { if (cfg) settings = cfg; setActive(true); }
  function disable() { setActive(false); }
  function updateSettings(cfg) { settings = cfg; engine.reset(); clearOverlay(); }

  return { init, enable, disable, updateSettings };
})();
