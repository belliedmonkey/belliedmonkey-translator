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
  // Active-video selection with HYSTERESIS (§2.3.5): keep the current active video
  // until it stops/leaves the viewport or another video's visible area clearly beats
  // it (≥1.3×), so two comparably-sized feed videos don't flip every 250ms tick (a
  // flip changes mediaKey → engine reset). One button + one overlay follow the winner.
  let stickyActive = null;
  const AREA_MARGIN = 1.3;
  function activeVideo() {
    const vids = amplifyVideos();
    if (!vids.length) { stickyActive = null; return null; }
    const playing = vids.filter((v) => !v.paused && v.currentTime > 0);
    const pool = playing.length ? playing : vids;
    const best = pool.slice().sort((a, b) => visibleArea(b) - visibleArea(a))[0] || null;
    if (stickyActive && pool.indexOf(stickyActive) !== -1) {
      // retain unless another video is clearly more visible than the sticky one
      if (best === stickyActive || visibleArea(best) < visibleArea(stickyActive) * AREA_MARGIN) return stickyActive;
    }
    stickyActive = best;
    return best;
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
  // Stable per-video identity. X re-renders the player subtree on mouse hover (to show
  // controls), which can transiently detach the enclosing <article> (status-id lookup
  // fails) or swap currentSrc. Recomputing then would FLIP mediaKey → engine reset →
  // subtitles snap back to 字幕加载中… mid-playback. Cache the first non-empty key per
  // <video> element so that churn can't change it.
  const keyByVideo = new WeakMap(); // v -> { key, mid }
  function activeKey() {
    const v = activeVideo();
    if (!v) return '';
    const mid = mediaId(v); // stable amplify id when resolvable; '' during hover churn
    const cached = keyByVideo.get(v);
    // Keep the cached key through hover flicker (mid empty or unchanged); only recompute
    // when the element is genuinely reused for a different media (mid changed) — feed recycling.
    if (cached && (!mid || mid === cached.mid)) return cached.key;
    const art = v.closest('article[role="article"]');
    const link = art && art.querySelector('a[href*="/status/"]');
    const status = link && (link.getAttribute('href').match(/status\/(\d+)/) || [])[1];
    const key = status || mid || v.currentSrc || v.src || '';
    if (key) keyByVideo.set(v, { key, mid });
    return key || (cached ? cached.key : '');
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

  // ─── Player container (§2.3.6): the element we re-parent overlay + 译 button
  // INTO, so both ride into the top layer on fullscreen and are bound to the active
  // video. Runtime-adaptive: when a fullscreen element exists and can host children
  // (not a raw <video>), that IS the container — so we follow whatever X fullscreens
  // on Chrome/Safari. Otherwise X's video wrapper, falling back to the nearest
  // positioned ancestor, then the video's parent.
  function positionedAncestor(v) {
    let el = v.parentElement;
    while (el && el !== document.body) { if (getComputedStyle(el).position !== 'static') return el; el = el.parentElement; }
    return null;
  }
  function playerContainer(v) {
    if (!v) return null;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl.tagName !== 'VIDEO' && (fsEl === v || fsEl.contains(v))) return fsEl;
    return v.closest('[data-testid="videoPlayer"]') || v.closest('[data-testid="videoComponent"]') ||
      positionedAncestor(v) || v.parentElement;
  }
  // Re-parent an element into the active video's container each tick (idempotent),
  // ensuring the container can anchor absolutely-positioned children. The prior
  // inline `position` is recorded on the container ('1' = none, the flow-fix
  // pattern) so disable can put back exactly what the page had — a leaked
  // static→relative flip re-parents the page's own absolutely-positioned
  // descendants (interaction-spec: 插入不得改变页面原有内容的行为).
  const posFixed = new Set(); // containers we flipped — the doc sweep misses ones DETACHED at disable time
  function anchorInto(el, container) {
    if (el.parentElement !== container) container.appendChild(el);
    if (getComputedStyle(container).position === 'static') {
      if (!container.hasAttribute('data-mt-pos-fix')) container.setAttribute('data-mt-pos-fix', container.style.position || '1');
      container.style.position = 'relative';
      posFixed.add(container);
    }
  }
  // The container changes across videos / fullscreen flips, so several may carry
  // the fix. Sweep the live document AND the tracked set: a container React
  // unmounted before disable is detached but may be recycled later — it must not
  // come back with a leaked position:relative. Style writes work on detached nodes.
  function undoPosFix() {
    const undo = (el) => {
      if (!el.hasAttribute('data-mt-pos-fix')) return;
      const prev = el.getAttribute('data-mt-pos-fix');
      el.style.position = (prev && prev !== '1') ? prev : '';
      el.removeAttribute('data-mt-pos-fix');
    };
    document.querySelectorAll('[data-mt-pos-fix]').forEach(undo);
    posFixed.forEach(undo);
    posFixed.clear();
  }

  // ─── Overlay anchor: absolute, INSIDE the active video's container (§2.3.6) ──
  function placeOverlay(ov) {
    const v = activeVideo();
    const container = playerContainer(v);
    if (!v || !container) { ov.style.display = 'none'; return false; }
    const r = v.getBoundingClientRect();
    if (!r.width || !r.height) { ov.style.display = 'none'; return false; }
    anchorInto(ov, container);
    ov.style.cssText = 'position:absolute;left:50%;bottom:8%;transform:translateX(-50%);' +
      'z-index:2147482000;pointer-events:none;display:flex;flex-direction:column;align-items:center;' +
      'gap:3px;text-align:center;width:max-content;max-width:92%;';
    return true;
  }
  // 译 button embedded top-right INSIDE the active video's container (§2.3.6, §5).
  function anchorButton(btn) {
    const v = activeVideo();
    const container = playerContainer(v);
    if (!container) return;
    anchorInto(btn, container);
    btn.style.cssText = 'position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;' +
      window.MT_PALETTE.roundBtnCss(14) +
      'box-shadow:0 1px 6px rgba(0,0,0,.5);z-index:2147483000;pointer-events:auto;';
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
    // §2.4: X video / Spaces are HLS→MSE, so only the live tier applies.
    unavailableAction: AsrSource.offerFor(activeVideo, () => ui, () => ui.settings),
    placeOverlay,
    anchorButton,
    fontPx,
    textWidth,
    translate: (text, s) => TranslationAPI.translate(
      text, s.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
    showButton: () => !TranslationCore.isMobileLayout(), // mobile: page FAB drives it
    syncNative,
    srtName: () => document.title,
    labels: {
      btnTitle: T('yt_btn_title', '大肚猴翻译 · 视频字幕'),
      subOn: T('yt_sub_on', '开启视频字幕翻译'),
      subOff: T('yt_sub_off', '关闭视频字幕翻译'),
    },
  });

  // Instant re-anchor on fullscreen enter/exit (the 250ms tick also re-anchors, but
  // this avoids a flash of missing subtitle). playerContainer() reads
  // document.fullscreenElement, so re-running placeOverlay/anchorButton moves both
  // overlay and 译 button into whatever X just fullscreened (Chrome + Safari, §2.3.6).
  function reanchor() {
    const ov = document.getElementById('mt-tw-overlay'); if (ov) placeOverlay(ov);
    const btn = document.getElementById('mt-tw-btn'); if (btn) anchorButton(btn);
  }
  const FS_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'];
  let fsBound = false;
  function bindFs() { if (fsBound) return; fsBound = true; FS_EVENTS.forEach((e) => document.addEventListener(e, reanchor)); }
  function unbindFs() { if (!fsBound) return; fsBound = false; FS_EVENTS.forEach((e) => document.removeEventListener(e, reanchor)); }

  function startAsr() { return AsrSource.start(activeVideo(), ui, ui.settings); }
  return {
    startAsr,
    init: (s) => { bindFs(); return ui.init(s); },
    enable: ui.enable,
    disable: () => { unbindFs(); undoPosFix(); return ui.disable(); },
    updateSettings: ui.updateSettings,
  };
})();
