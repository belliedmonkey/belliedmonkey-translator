// content-twitter.js — x.com / twitter.com in-tweet VIDEO subtitles (§2.3).
//
// Thin backend over SubtitleAdapter.createSubtitleUI — supplies only the Twitter-
// specific parts: the source (HLS master → SUBTITLES sub-playlist → .vtt segments,
// VTT-only, no ASR), active-media selection (a feed holds many <video>), the media
// clock, and the overlay anchor (fixed over the active tweet's <video>). All overlay
// rendering / tick loop / 译 menu / SRT live in subtitle-adapter.js.

var TwitterTranslator = (() => {
  // ─── Active media selection (a feed holds many <video>) ─────────────────
  function amplifyVideos() {
    return Array.from(document.querySelectorAll('video')).filter((v) => {
      const p = v.poster || v.currentSrc || v.src || '';
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
    for (const b of text.replace(/\r/g, '').split(/\n\n+/)) {
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
  async function fetchText(url) { const r = await fetchWithTimeout(url); if (!r.ok) throw new Error('http ' + r.status); return r.text(); }

  // ─── Acquisition: master m3u8 → SUBTITLES sub-playlist → .vtt segments ──
  // Master discovered by tw-media-observer.js (Resource Timing → window.__mtTwHlsUrls).
  // Master = /amplify_video/<id>/pl/<hash>.m3u8 (no variant subdir avc1/mp4a/s0).
  function masterUrlFor(id) {
    const list = window.__mtTwHlsUrls || [];
    const isMaster = (u) => new RegExp('/amplify_video/' + (id ? id : '\\d+') + '/pl/[^/]+\\.m3u8').test(u);
    for (let i = list.length - 1; i >= 0; i--) if (isMaster(list[i])) return list[i];
    return '';
  }
  // Returns cues[] (ready) | null (retry) | 'unavailable' (no caption track — final).
  async function acquire() {
    const v = activeVideo();
    if (!v) return null;
    const master = masterUrlFor(mediaId(v));
    if (!master) return null; // observer hasn't seen it yet → retry
    const masterBody = await fetchText(master);
    const sm = masterBody.match(/#EXT-X-MEDIA:TYPE=SUBTITLES[^\n\r]*URI="([^"]+)"/i);
    if (!sm) return 'unavailable'; // no caption track — first-class, common
    const subUrl = new URL(sm[1], master).toString();
    const subBody = await fetchText(subUrl);
    const segs = [];
    let dur = 0, pending = 0;
    for (const line of subBody.split(/\r?\n/)) {
      const inf = line.match(/^#EXTINF:([\d.]+)/);
      if (inf) { pending = parseFloat(inf[1]) || 0; continue; }
      if (line && line[0] !== '#' && /\.vtt/i.test(line)) {
        segs.push({ url: new URL(line.trim(), subUrl).toString(), offsetMs: Math.round(dur * 1000) });
        dur += pending; pending = 0;
      }
    }
    if (!segs.length) return null;
    const cues = [];
    for (const seg of segs) { try { cues.push(...parseVtt(await fetchText(seg.url), seg.offsetMs)); } catch (_) {} }
    cues.sort((a, b) => a.start - b.start);
    return cues.length ? cues : null;
  }

  // ─── Overlay anchor: fixed, positioned over the active video each tick ──
  function placeOverlay(ov) {
    const v = activeVideo();
    if (!v) { ov.style.display = 'none'; return false; }
    const r = v.getBoundingClientRect();
    if (!r.width || !r.height) { ov.style.display = 'none'; return false; }
    ov.style.cssText = 'position:fixed;z-index:2147482000;pointer-events:none;display:flex;' +
      'flex-direction:column;align-items:center;gap:3px;text-align:center;transform:translateX(-50%);' +
      `left:${Math.round(r.left + r.width / 2)}px;bottom:${Math.round(innerHeight - r.bottom + Math.max(8, r.height * 0.08))}px;` +
      `width:max-content;max-width:${Math.round(r.width * 0.92)}px;`;
    return true;
  }
  function fontPx() { const v = activeVideo(); const h = (v && v.getBoundingClientRect().height) || 360; return Math.max(15, Math.min(34, Math.round(h * 0.05))); }
  function textWidth() { const v = activeVideo(); const w = (v && v.getBoundingClientRect().width) || 600; return Math.max(180, Math.round(w * 0.92) - 20); }

  // ─── Suppress X's own native <track> captions while ours drive ──────────
  const savedTrackModes = new Map();
  function syncNative(active, hasItems) {
    const v = activeVideo();
    if (active && hasItems && v && v.textTracks) {
      for (const t of v.textTracks) {
        if (t.mode !== 'disabled') { if (!savedTrackModes.has(t)) savedTrackModes.set(t, t.mode); t.mode = 'disabled'; }
      }
    } else if (savedTrackModes.size) {
      savedTrackModes.forEach((mode, t) => { try { t.mode = mode; } catch (_) {} });
      savedTrackModes.clear();
    }
  }

  const T = TranslationCore.t;
  const ui = SubtitleAdapter.createSubtitleUI({
    ids: { overlay: 'mt-tw-overlay', orig: 'mt-tw-orig', trans: 'mt-tw-trans', btn: 'mt-tw-btn', menu: 'mt-tw-menu', meas: 'mt-tw-meas' },
    hasMedia: () => !!activeVideo(),
    mediaKey: activeKey,
    getCurrentTime: () => (activeVideo()?.currentTime || 0) * 1000,
    isPlaying: () => { const v = activeVideo(); return !!(v && !v.paused); },
    acquire,
    placeOverlay,
    fontPx,
    textWidth,
    translate: (text, s) => TranslationAPI.translate(
      text, s.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      s.provider || 'google', s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
    showButton: () => !TranslationCore.isMobileLayout(), // mobile: page FAB drives it
    syncNative,
    srtName: () => document.title,
    labels: {
      btnTitle: T('yt_btn_title', '大肚猴翻译 · 视频字幕'),
      subOn: T('yt_sub_on', '开启视频字幕翻译'),
      subOff: T('yt_sub_off', '关闭视频字幕翻译'),
    },
  });

  return { init: ui.init, enable: ui.enable, disable: ui.disable, updateSettings: ui.updateSettings };
})();
