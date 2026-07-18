// content-twitter.js — x.com / twitter.com in-tweet VIDEO bilingual subtitles.
//
// See docs/domain-design.md §2.3. Strategy (video analogue of the podcast path):
// acquire the COMPLETE WebVTT transcript up front from the video's HLS master
// playlist (#EXT-X-MEDIA:TYPE=SUBTITLES → sub-playlist → .vtt segments — VTT-only,
// no ASR), merge into sentences, translate ahead in the 60s window (reusing the
// TranslationCore subtitle engine), and draw our own overlay anchored to the ACTIVE
// tweet's <video>, synced to its currentTime. A tweet/feed can hold many videos, so
// we track the playing/most-visible one and re-acquire when it changes. If a video
// has no SUBTITLES track we show 字幕不可用 (first-class, common) — never word-by-word.
//
// NOTE: overlay/tick/menu/SRT here intentionally mirror content-youtube.js /
// content-podcast.js; the three are to be factored into a shared subtitle-adapter.js
// (PR2a). Kept self-contained for now so Twitter ships + verifies before that refactor.

var TwitterTranslator = (() => {
  const OVERLAY_ID = 'mt-tw-overlay';
  const ORIG_CLASS = 'mt-tw-orig';
  const TRANS_CLASS = 'mt-tw-trans';
  const BTN_ID = 'mt-tw-btn';
  const MENU_ID = 'mt-tw-menu';

  let settings = {};
  let active = false;
  let pollTimer = null;
  let lastKey = '';            // active-video identity; change ⇒ reset + re-acquire
  let displayMode = 'both';    // 'both' | 'trans' | 'orig'
  let lastShownKey = '';

  // transcript acquisition state (full transcript up front — §2.3).
  let transcriptStatus = '';   // '' | 'loading' | 'ready' | 'unavailable'
  let resolveInFlight = false;
  let resolveAttempts = 0;
  let resolveNextAt = 0;
  const RESOLVE_MAX_ATTEMPTS = 6;
  const RESOLVE_RETRY_MS = 2500;

  const pager = TranslationCore.createPager({ measurerId: 'mt-tw-meas' });
  const engine = TranslationCore.createSubtitleEngine({
    getCurrentTime: () => (activeVideo()?.currentTime || 0) * 1000,
    translate: (text) => TranslationAPI.translate(
      text, settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      settings.provider || 'google', settings.apiKey || '', settings.apiBaseUrl || '', settings.apiModel || ''),
  });

  // ─── Active media selection (feed may hold many <video>) ────────────────
  // Prefer a playing video; break ties by largest viewport-visible area (the one
  // the user is watching). Falls back to the first amplify video present.
  function amplifyVideos() {
    return Array.from(document.querySelectorAll('video')).filter((v) => {
      const p = v.poster || v.currentSrc || v.src || '';
      // amplify videos have a blob src + a twimg poster; keep any <video> in a tweet.
      return v.closest('article[role="article"]') || /amplify_video|twimg/.test(p);
    });
  }
  function visibleArea(v) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  }
  function activeVideo() {
    const vids = amplifyVideos();
    if (!vids.length) return null;
    const playing = vids.filter((v) => !v.paused && v.currentTime > 0);
    const pool = playing.length ? playing : vids;
    return pool.slice().sort((a, b) => visibleArea(b) - visibleArea(a))[0] || null;
  }
  function hasMedia() { return !!activeVideo(); }

  // Identity of the active video: the tweet's status id (stable across the SPA),
  // else the video's media-id token, else its blob src.
  function mediaId(v) {
    if (!v) return '';
    const src = v.poster || v.currentSrc || v.src || '';
    const m = src.match(/amplify_video(?:_thumb)?\/(\d+)/);
    if (m) return m[1];
    const art = v.closest('article[role="article"]');
    const img = art && art.querySelector('img[src*="amplify_video_thumb/"]');
    if (img) { const mm = img.src.match(/amplify_video_thumb\/(\d+)/); if (mm) return mm[1]; }
    return '';
  }
  function activeKey() {
    const v = activeVideo();
    if (!v) return '';
    const art = v.closest('article[role="article"]');
    const link = art && art.querySelector('a[href*="/status/"]');
    const status = link && (link.getAttribute('href').match(/status\/(\d+)/) || [])[1];
    return status || mediaId(v) || v.currentSrc || v.src || '';
  }

  // ─── Timed-text parsing (WebVTT; X wraps words in <X-word-ms> — stripped) ─
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
  function parseVtt(text, offsetMs) {
    const out = [];
    const blocks = text.replace(/\r/g, '').split(/\n\n+/);
    for (const b of blocks) {
      const lines = b.split('\n').filter((l) => l.length);
      const tl = lines.find((l) => l.indexOf('-->') !== -1);
      if (!tl) continue;
      const parts = tl.split('-->');
      if (parts.length < 2) continue;
      const start = tcToMs(parts[0]) + (offsetMs || 0);
      const end = tcToMs(parts[1]) + (offsetMs || 0);
      if (!(end > start)) continue;
      const txt = stripCueTags(lines.slice(lines.indexOf(tl) + 1).join(' '));
      if (txt) out.push({ start, end, text: txt });
    }
    return out;
  }

  function fetchWithTimeout(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 10000);
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
  }
  async function fetchText(url) {
    const r = await fetchWithTimeout(url);
    if (!r.ok) throw new Error('http ' + r.status);
    return r.text();
  }

  // ─── Acquisition: master m3u8 → SUBTITLES sub-playlist → .vtt segments ──
  // The master URL is discovered by tw-media-observer.js (Resource Timing, isolated
  // document_start) into window.__mtTwHlsUrls. Master = /amplify_video/<id>/pl/<x>.m3u8
  // (no variant subdir like /avc1/, /mp4a/, /s0/).
  function masterUrlFor(id) {
    const list = window.__mtTwHlsUrls || [];
    const isMaster = (u) => new RegExp('/amplify_video/' + (id ? id : '\\d+') + '/pl/[^/]+\\.m3u8').test(u);
    for (let i = list.length - 1; i >= 0; i--) if (isMaster(list[i])) return list[i];
    return '';
  }
  async function resolveCues() {
    const v = activeVideo();
    if (!v) return null;
    const id = mediaId(v);
    const master = masterUrlFor(id);
    if (!master) return null; // observer hasn't seen it yet → retry
    const masterBody = await fetchText(master);
    const sm = masterBody.match(/#EXT-X-MEDIA:TYPE=SUBTITLES[^\n\r]*URI="([^"]+)"/i);
    if (!sm) { transcriptStatus = 'unavailable'; return null; } // no caption track — first-class
    const subUrl = new URL(sm[1], master).toString();
    const subBody = await fetchText(subUrl);
    // Collect .vtt segments (in order) + their cumulative offset from #EXTINF.
    const segs = [];
    let dur = 0, pendingDur = 0;
    for (const line of subBody.split(/\r?\n/)) {
      const inf = line.match(/^#EXTINF:([\d.]+)/);
      if (inf) { pendingDur = parseFloat(inf[1]) || 0; continue; }
      if (line && line[0] !== '#' && /\.vtt/i.test(line)) {
        segs.push({ url: new URL(line.trim(), subUrl).toString(), offsetMs: Math.round(dur * 1000) });
        dur += pendingDur; pendingDur = 0;
      }
    }
    if (!segs.length) return null;
    const cues = [];
    for (const seg of segs) {
      try { const t = await fetchText(seg.url); cues.push(...parseVtt(t, seg.offsetMs)); } catch (_) {}
    }
    cues.sort((a, b) => a.start - b.start);
    return cues.length ? cues : null;
  }

  // ─── Overlay (fixed, positioned over the ACTIVE video each tick) ─────────
  function ensureOverlay() {
    let ov = document.getElementById(OVERLAY_ID);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = OVERLAY_ID;
      ov.setAttribute('translate', 'no'); // own UI — dom-processor hardSkip
      ov.style.cssText =
        'position:fixed;z-index:2147482000;pointer-events:none;' +
        'display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;';
      const en = document.createElement('div'); en.className = ORIG_CLASS;
      const zh = document.createElement('div'); zh.className = TRANS_CLASS;
      ov.appendChild(en); ov.appendChild(zh);
      document.body.appendChild(ov);
    }
    return ov;
  }
  // Position the overlay along the bottom of the active video's rect.
  function positionOverlay(ov, v) {
    const r = v.getBoundingClientRect();
    if (!r.width || !r.height) { ov.style.display = 'none'; return false; }
    ov.style.display = 'flex';
    ov.style.left = Math.round(r.left + r.width / 2) + 'px';
    ov.style.transform = 'translateX(-50%)';
    ov.style.bottom = Math.round(innerHeight - r.bottom + Math.max(8, r.height * 0.08)) + 'px';
    ov.style.width = 'max-content';
    ov.style.maxWidth = Math.round(r.width * 0.92) + 'px';
    return true;
  }
  function fontPx() {
    const v = activeVideo();
    const h = (v && v.getBoundingClientRect().height) || 360;
    return Math.max(15, Math.min(34, Math.round(h * 0.05)));
  }
  function overlayTextWidth() {
    const v = activeVideo();
    const w = (v && v.getBoundingClientRect().width) || 600;
    return Math.max(180, Math.round(w * 0.92) - 20);
  }
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
    const v = activeVideo();
    const ov = ensureOverlay();
    if (!v || !positionOverlay(ov, v)) return;
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
    const v = activeVideo();
    const ov = ensureOverlay();
    if (!v || !positionOverlay(ov, v)) return;
    const enEl = ov.querySelector('.' + ORIG_CLASS);
    const zhEl = ov.querySelector('.' + TRANS_CLASS);
    enEl.style.display = 'none'; enEl.textContent = '';
    zhEl.onclick = null;
    zhEl.style.cssText = lineCss(Math.round(fontPx() * 0.85), '#d6d6d6') + 'opacity:.85;font-style:italic;';
    zhEl.textContent = msg;
  }
  function clearOverlay() {
    const ov = document.getElementById(OVERLAY_ID);
    if (ov) for (const cls of [ORIG_CLASS, TRANS_CLASS]) { const el = ov.querySelector('.' + cls); el.textContent = ''; el.style.display = 'none'; }
    lastShownKey = '';
  }
  function removeOverlay() { document.getElementById(OVERLAY_ID)?.remove(); document.getElementById('mt-tw-meas')?.remove(); }

  // ─── Suppress X's own native <track> captions while ours drive ──────────
  const savedTrackModes = new Map();
  function syncNativeTextTracks() {
    const v = activeVideo();
    if (active && engine.items.length && v && v.textTracks) {
      for (const t of v.textTracks) {
        if (t.mode !== 'disabled') { if (!savedTrackModes.has(t)) savedTrackModes.set(t, t.mode); t.mode = 'disabled'; }
      }
    } else if (savedTrackModes.size) {
      savedTrackModes.forEach((mode, t) => { try { t.mode = mode; } catch (_) {} });
      savedTrackModes.clear();
    }
  }

  // ─── Display loop ───────────────────────────────────────────────────────
  function tick() {
    ensureControlButton();
    syncNativeTextTracks();
    if (!active) { if (document.getElementById(OVERLAY_ID)) clearOverlay(); return; }
    if (!hasMedia()) { if (document.getElementById(OVERLAY_ID)) clearOverlay(); return; }

    const key = activeKey();
    if (key !== lastKey) {
      lastKey = key;
      engine.setItems([]); engine.reset();
      resolveInFlight = false; resolveAttempts = 0; resolveNextAt = 0;
      transcriptStatus = ''; clearOverlay();
    }

    if (!engine.items.length && transcriptStatus !== 'unavailable' && !resolveInFlight && Date.now() >= resolveNextAt) {
      resolveInFlight = true; transcriptStatus = 'loading'; resolveAttempts++;
      resolveCues().then((cues) => {
        if (cues && cues.length) { engine.setItems(TranslationCore.mergeSentences(cues)); transcriptStatus = 'ready'; }
        else if (transcriptStatus === 'unavailable') { /* no track — keep */ }
        else if (resolveAttempts >= RESOLVE_MAX_ATTEMPTS) { transcriptStatus = 'unavailable'; }
        else { resolveNextAt = Date.now() + RESOLVE_RETRY_MS; }
      }).catch(() => {
        if (resolveAttempts >= RESOLVE_MAX_ATTEMPTS) transcriptStatus = 'unavailable';
        else resolveNextAt = Date.now() + RESOLVE_RETRY_MS;
      }).finally(() => { resolveInFlight = false; });
    }

    const v = activeVideo();
    if (engine.items.length && v) {
      const tMs = v.currentTime * 1000;
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
      const k = s.start + '|' + en + '|' + (zh || st.state);
      if (k !== lastShownKey) { renderOverlay(en, zh, st.state, s); lastShownKey = k; }
    } else {
      lastShownKey = '';
      // Notices require playback (a paused/never-started video must not pin a notice).
      if (!v || v.paused) { if (document.getElementById(OVERLAY_ID)) clearOverlay(); return; }
      if (transcriptStatus === 'unavailable') renderNotice(TranslationCore.t('yt_subtitle_unavailable', '字幕不可用'));
      else renderNotice(TranslationCore.t('yt_subtitle_loading', '⏳ 字幕加载中…'));
    }
  }
  function startLoop() { if (pollTimer) clearInterval(pollTimer); pollTimer = setInterval(tick, 250); }

  // ─── Floating control button + menu (desktop; mobile FAB drives it) ─────
  function ensureControlButton() {
    if (!active) { document.getElementById(BTN_ID)?.remove(); closeMenu(); return; }
    if (document.getElementById(BTN_ID) || !hasMedia()) return;
    if (TranslationCore.isMobileLayout()) return; // mobile: the page FAB drives it
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.setAttribute('translate', 'no');
    btn.title = TranslationCore.t('yt_btn_title', '大肚猴翻译 · 视频字幕');
    btn.textContent = '译';
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
    menu.setAttribute('translate', 'no');
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
    menu.appendChild(row(active ? T('yt_sub_off', '关闭视频字幕翻译') : T('yt_sub_on', '开启视频字幕翻译'), { checked: active, onClick: () => setActive(!active) }));
    menu.appendChild(sep());
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

  // ─── .srt export ────────────────────────────────────────────────────────
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
    a.setAttribute('translate', 'no');
    a.href = URL.createObjectURL(blob);
    a.download = (document.title.replace(/[\\/:*?"<>|]/g, '_') || 'twitter') + '.srt';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function openSettings() {
    try { if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage(); else window.open(chrome.runtime.getURL('options/options.html'), '_blank'); }
    catch (_) { window.open(chrome.runtime.getURL('options/options.html'), '_blank'); }
  }

  // ─── Public API (mirrors YouTubeTranslator / PodcastTranslator) ─────────
  function applyState() { if (!active) { removeOverlay(); document.getElementById(BTN_ID)?.remove(); closeMenu(); syncNativeTextTracks(); } }
  function setActive(on) {
    active = on;
    if (on) { lastKey = ''; resolveInFlight = false; resolveAttempts = 0; resolveNextAt = 0; transcriptStatus = ''; }
    applyState();
    tick();
  }
  function init(cfg) { settings = cfg; active = false; startLoop(); }
  function enable(cfg) { if (cfg) settings = cfg; setActive(true); }
  function disable() { setActive(false); }
  function updateSettings(cfg) { settings = cfg; engine.reset(); clearOverlay(); }

  return { init, enable, disable, updateSettings };
})();
