// content-podcast.js — Podcast bilingual subtitles (audio analogue of YouTube).
//
// Thin backend over SubtitleAdapter.createSubtitleUI (see docs/domain-design.md §2.2).
// Supplies only the podcast-specific parts: the source (an EXISTING timed transcript —
// in-page WebVTT/SRT, Podcasting-2.0 <podcast:transcript>, or Spotify's synced DOM),
// the media clock (<audio>.currentTime, or Spotify's progress bar), a viewport-anchored
// overlay, and the platform-native-caption suppression (Spotify list / Substack player
// shell marking / third-party caption layers / native <track>). No ASR; if there is no
// timed transcript we show 字幕不可用 and the webpage text path still translates the page.
// All overlay/tick/menu/SRT live in subtitle-adapter.js.

var PodcastTranslator = (() => {
  const IS_SPOTIFY = /(^|\.)spotify\.com$/.test(location.hostname);
  let ui; // set below; sync closures reference ui.engine / ui.active

  // ─── Media element ─────────────────────────────────────────────────────
  function mediaEl() {
    const els = Array.from(document.querySelectorAll('audio, video'));
    if (!els.length) return null;
    return els.find((e) => !e.paused && e.currentTime > 0)
      || els.find((e) => e.currentTime > 0)
      || els.find((e) => e.tagName === 'AUDIO')
      || els[0];
  }
  function isSpotifyEpisode() { return /\/episode\//.test(location.pathname) || !!document.querySelector('[data-testid="transcript-tab"]'); }
  function hasMedia() { return IS_SPOTIFY ? isSpotifyEpisode() : !!document.querySelector('audio, video'); }
  function episodeKey() {
    if (IS_SPOTIFY) return location.href;
    const m = mediaEl(); return location.href + '|' + (m ? (m.currentSrc || m.src || '') : '');
  }

  // Playback position in ms (Spotify: read the progress-bar slider — the <video>'s
  // currentTime is an MSE buffer position, not the episode position).
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
  function fetchWithTimeout(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
  }
  async function fetchTimedText(url) {
    try {
      const r = await fetchWithTimeout(url); // NO credentials: a CloudFront-signed URL 503s for cookie-bearing requests
      if (!r.ok) return null;
      const txt = await r.text();
      if (/^\s*<\?xml|<Error>|MissingKey/i.test(txt.slice(0, 120))) return null;
      const cues = parseTimedText(txt);
      return cues.length ? cues : null;
    } catch (_) { return null; }
  }

  // ─── Cue sources ───────────────────────────────────────────────────────
  function findCaptionUrlInPage() {
    for (const tr of document.querySelectorAll('track')) {
      const k = (tr.getAttribute('kind') || '').toLowerCase();
      if (tr.src && (k === '' || k === 'subtitles' || k === 'captions')) return tr.src;
    }
    let html = document.documentElement.innerHTML;
    html = html.replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
    const signed = [...html.matchAll(/https?:\/\/[^"'\\\s]+\.(?:vtt|srt)\?[^"'\\\s]*(?:Key-Pair-Id|Signature|token|Expires)=[^"'\\\s]+/gi)].map((m) => m[0]);
    if (signed.length) return pickCaptionForMedia(signed);
    const any = html.match(/https?:\/\/[^"'\\\s]+\.(?:vtt|srt)(?:\?[^"'\\\s]*)?/i);
    return any ? any[0] : null;
  }
  function pickCaptionForMedia(candidates) {
    const m = mediaEl();
    const src = m && (m.currentSrc || m.src) || '';
    if (src) {
      const tokens = src.split(/[/?#&]/).filter((t) => t.length >= 8 && /^[\w-]+$/.test(t));
      const hit = candidates.find((u) => tokens.some((t) => u.indexOf(t) !== -1));
      if (hit) return hit;
    }
    return candidates[0];
  }
  function hasTranscriptHint() { return !!findCaptionUrlInPage(); }

  async function resolveViaRss() {
    const link = document.querySelector('link[rel="alternate"][type="application/rss+xml"]');
    if (!link) return null;
    let feedUrl; try { feedUrl = new URL(link.getAttribute('href'), location.href).toString(); } catch (_) { return null; }
    let xml; try { const r = await fetchWithTimeout(feedUrl); if (!r.ok) return null; xml = await r.text(); } catch (_) { return null; }
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
    if (!url || /json|html|plain/i.test(pick.getAttribute('type') || '')) return null;
    return fetchTimedText(url);
  }

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
      const tab = document.querySelector('[data-testid="transcript-tab"]');
      if (tab && !spotifyTabActivated) { spotifyTabActivated = true; try { tab.click(); } catch (_) {} }
      return null;
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
        if (/自动生成|automatically generated|accuracy/i.test(txt)) continue;
        cur.text = (cur.text ? cur.text + ' ' : '') + txt;
      }
    }
    if (cur && cur.text) cues.push(cur);
    for (let i = 0; i < cues.length - 1; i++) cues[i].end = cues[i + 1].start;
    if (cues.length) cues[cues.length - 1].end = cues[cues.length - 1].start + 6000;
    return cues.length ? cues : null;
  }

  async function acquire() {
    const inPage = findCaptionUrlInPage();
    if (inPage) { const c = await fetchTimedText(inPage); if (c && c.length) return c; }
    const rss = await resolveViaRss(); if (rss && rss.length) return rss;
    const sp = resolveSpotifyDom(); if (sp && sp.length) return sp;
    return null;
  }

  // ─── Overlay anchor (viewport-fixed; audio pages have no video frame) ───
  function placeOverlay(ov) {
    ov.style.cssText =
      'position:fixed;left:50%;bottom:8%;transform:translateX(-50%);' +
      'width:max-content;max-width:90%;z-index:2147482000;pointer-events:none;' +
      'display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;';
    return true;
  }
  function fontPx() { return Math.max(15, Math.min(30, Math.round(window.innerWidth * 0.026))); }
  function overlayTextWidth() { return Math.min(Math.round(window.innerWidth * 0.9), 760) - 24; }

  // ─── Native-caption suppression (runs every tick via spec.syncNative) ───
  function markSubstackPlayerShells() {
    for (const shell of document.querySelectorAll('[class*="playerShell"]')) {
      if (shell.querySelector('audio, video') && !shell.hasAttribute('data-mt-player-region')) {
        shell.setAttribute('data-mt-player-region', '1');
      }
    }
  }
  function syncSpotifyNativeUI(active, hasItems) {
    if (active && hasItems) {
      if (!IS_SPOTIFY) return;
      const { list } = spotifyTranscriptList();
      if (list && list.getAttribute('data-mt-native-hidden') !== '1') {
        list.setAttribute('data-mt-native-hidden', '1');
        list.style.setProperty('display', 'none', 'important');
      }
    } else {
      document.querySelectorAll('[data-mt-native-hidden]').forEach((el) => {
        el.removeAttribute('data-mt-native-hidden');
        el.style.removeProperty('display');
      });
    }
  }
  function normText(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function syncThirdPartyCaptionLayers(active, hasItems) {
    if (!active || !hasItems) return;
    const m = mediaEl();
    if (!m || m.tagName !== 'VIDEO') return;
    const s = ui.engine.activeAt(m.currentTime * 1000);
    if (!s) return;
    const cur = normText(s.text);
    if (cur.length < 8) return;
    const vr = m.getBoundingClientRect();
    if (!vr.width || !vr.height) return;
    for (const el of document.querySelectorAll('[data-mt-player-region] div, [data-mt-player-region] span')) {
      if (el.getAttribute('data-mt-native-hidden') === '1' || el.contains(m)) continue;
      const t = normText(el.textContent);
      if (t.length < 8 || t.length > 300 || cur.indexOf(t) === -1) continue;
      const r = el.getBoundingClientRect();
      const overV = r.width > 0 && !(r.right < vr.left || r.left > vr.right || r.bottom < vr.top || r.top > vr.bottom);
      if (!overV) continue;
      let top = el;
      let p = el.parentElement;
      while (p && !p.contains(m) && p.getAttribute('data-mt-player-region') !== '1') {
        const pr = p.getBoundingClientRect();
        if (pr.right < vr.left || pr.left > vr.right || pr.bottom < vr.top || pr.top > vr.bottom) break;
        top = p; p = p.parentElement;
      }
      top.setAttribute('data-mt-native-hidden', '1');
      top.style.setProperty('display', 'none', 'important');
    }
  }
  const savedTrackModes = new Map();
  function syncNativeTextTracks(active, hasItems) {
    const m = mediaEl();
    if (active && hasItems && m && m.textTracks) {
      for (const t of m.textTracks) {
        if (t.mode !== 'disabled') { if (!savedTrackModes.has(t)) savedTrackModes.set(t, t.mode); t.mode = 'disabled'; }
      }
    } else if (savedTrackModes.size) {
      savedTrackModes.forEach((mode, t) => { try { t.mode = mode; } catch (_) {} });
      savedTrackModes.clear();
    }
  }
  function syncNative(active, hasItems) {
    markSubstackPlayerShells();       // adapter-marked player regions for DomSegmenter (#21) — always
    syncSpotifyNativeUI(active, hasItems);
    syncThirdPartyCaptionLayers(active, hasItems);
    syncNativeTextTracks(active, hasItems);
  }

  const T = TranslationCore.t;
  ui = SubtitleAdapter.createSubtitleUI({
    ids: { overlay: 'mt-pod-overlay', orig: 'mt-pod-orig', trans: 'mt-pod-trans', btn: 'mt-pod-btn', menu: 'mt-pod-menu', meas: 'mt-pod-meas' },
    menuToggle: false, // podcast is toggled by the page FAB — no on/off row in the menu
    hasMedia,
    mediaKey: episodeKey,
    getCurrentTime: positionMs,
    isPlaying: () => { const m = mediaEl(); return !!(m && !m.paused); },
    acquire,
    placeOverlay,
    fontPx,
    textWidth: overlayTextWidth,
    onMediaKeyChange: () => { spotifyTabActivated = false; },
    syncNative,
    srtName: () => document.title,
    translate: (text, s) => TranslationAPI.translate(
      text, s.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      s.provider || 'google', s.apiKey || '', s.apiBaseUrl || '', s.apiModel || '',
      s.apiBaseUrlVerbatim === true),
    labels: { btnTitle: T('podcast_sub_off', '关闭播客字幕翻译') },
  });

  return { init: ui.init, enable: ui.enable, disable: ui.disable, updateSettings: ui.updateSettings, hasTranscriptHint };
})();
