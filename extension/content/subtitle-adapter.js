// subtitle-adapter.js — shared harness for ALL bilingual subtitle surfaces
// (YouTube video, Podcast audio, Twitter/X video). See docs/domain-design.md §2.
//
// The three surfaces are ~90% identical: a TranslationCore subtitle engine (60s
// translate-ahead) + a measure-based pager, a self-drawn 2-line overlay (original
// on top, translation below), a 250ms display loop (media-identity reset → acquire
// retry state machine → engine.pump → activeAt → page → render), a 译 control
// button + menu (on/off · display-mode both/trans/orig · download .srt · settings),
// and .srt export. Only the SOURCE (how cues are acquired), the media CLOCK, and the
// overlay ANCHOR differ per surface — those are the `spec` a backend supplies.
//
// createSubtitleUI(spec) → { init, enable, disable, updateSettings, setActive, get items }
//
// spec:
//   ids:            { overlay, orig, trans, btn, menu, meas }  — DOM ids/classes (keep
//                   per-backend so rendered pixels stay byte-identical to pre-refactor)
//   hasMedia():     bool   — is there media to subtitle? (dormant when false)
//   mediaKey():     string — media identity; change ⇒ reset engine + re-acquire
//   getCurrentTime(): ms   — the playback clock the overlay syncs to
//   isPlaying():    bool   — (optional) gate loading/unavailable notices on playback
//   acquire():      Promise< cues[] | null | 'unavailable' >
//                   cues[] → ready; null → retry (until cap); 'unavailable' → no track (final)
//   placeOverlay(ov): bool — (re)mount + position the overlay; false ⇒ skip render this tick
//   fontPx():       number
//   textWidth():    number
//   translate(text):Promise<string>
//   labels:         { btnTitle, subOn, subOff }  — i18n strings for the menu
//   showButton():   bool   — (optional) show the in-adapter 译 button (false on mobile → FAB)
//   buttonCss():    string — (optional) the floating button's cssText
//   onActiveChange(on): void — (optional) e.g. inject/remove native-caption-hiding CSS
//   beforeRender():'clear'|'skip'|void — (optional) e.g. suppress overlay during an ad
//   syncNative(active, hasItems): void — (optional) native <track>/UI suppression, every tick
//   srtName():      string — (optional) download filename base

var SubtitleAdapter = (() => {
  const RESOLVE_MAX_ATTEMPTS = 6;
  const RESOLVE_RETRY_MS = 2500;
  const TICK_MS = 250;

  function createSubtitleUI(spec) {
    const ID = spec.ids;
    let settings = {};
    let active = false;
    let pollTimer = null;
    let lastKey = '';
    let displayMode = 'both';
    let lastShownKey = '';
    // Learning layer: how long the playhead has actually rested on the current
    // sentence. Reset whenever the sentence changes; see the capture site in tick().
    let watchAcc = { key: '', ms: 0, done: false };
    let status = '';           // '' | 'loading' | 'ready' | 'unavailable'
    let inFlight = false, attempts = 0, nextAt = 0;

    const pager = TranslationCore.createPager({ measurerId: ID.meas });
    let subOkSent = false, subSince = 0;
    const engine = TranslationCore.createSubtitleEngine({
      getCurrentTime: () => spec.getCurrentTime(),
      onOk: () => {
        if (subOkSent || !(typeof MTTelemetry !== 'undefined')) return;
        subOkSent = true;
        MTTelemetry.track('translate_ok', { provider: String((settings && settings.provider) || ''), kind: 'subtitle', ms: Date.now() - subSince });
      },
      onFail: (e) => {
        if (!(typeof MTTelemetry !== 'undefined')) return;
        MTTelemetry.track('translate_fail', {
          provider: String((settings && settings.provider) || ''),
          code: (e && typeof e.code === 'string') ? e.code : 'network',
          status: Number.isInteger(e && e.status) ? e.status : 0,
          route: (e && e.route === 'proxy') ? 'proxy' : ((e && e.route === 'direct') ? 'direct' : ''),
          ms: Date.now() - subSince,
        });
      },
      translate: (text) => spec.translate(text, settings), // harness owns settings; backend reads it
      // Cues already in the target language are skipped before the request, so a
      // native-language video shows one line instead of the same line twice.
      //
      // A GETTER, not a value: this engine is built here, before init/enable/
      // updateSettings have ever assigned `settings`. Passing `settings.targetLang`
      // read `undefined` and froze the check to DEFAULT_TARGET_LANG for the whole
      // session, so subtitles ignored the user's chosen target language entirely.
      // `translate` above was already a late-reading closure; this now matches it.
      // See docs/domain-design.md §4.
      targetLang: () => settings.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      // Optional browser-native detector — see docs/domain-design.md §5.3. Probed in
      // the adapter, never inside TranslationCore. Absent on every Safari.
      detect: (typeof LangDetect !== 'undefined' && LangDetect.available())
        ? LangDetect.detect : null,
    });

    // ─── Overlay ───────────────────────────────────────────────────────
    function ensureOverlay() {
      let ov = document.getElementById(ID.overlay);
      if (!ov) {
        ov = document.createElement('div');
        ov.id = ID.overlay;
        ov.setAttribute('translate', 'no'); // own UI — dom-processor hardSkip
        const en = document.createElement('div'); en.className = ID.orig;
        const zh = document.createElement('div'); zh.className = ID.trans;
        ov.appendChild(en); ov.appendChild(zh);
        document.body.appendChild(ov);
      }
      return ov;
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
      const ov = ensureOverlay();
      if (!spec.placeOverlay(ov)) return;
      const enEl = ov.querySelector('.' + ID.orig);
      const zhEl = ov.querySelector('.' + ID.trans);
      const fp = spec.fontPx();
      if (displayMode === 'trans' || !en) { enEl.style.display = 'none'; enEl.textContent = ''; }
      else { enEl.style.cssText = lineCss(fp, '#fff'); enEl.textContent = en; }
      zhEl.onclick = null;
      if (displayMode === 'orig') { zhEl.style.display = 'none'; zhEl.textContent = ''; }
      else if (zh) { zhEl.style.cssText = lineCss(Math.round(fp * 0.95), settings.ytTextColor || window.MT_PALETTE.ytTextColor); zhEl.textContent = zh; }
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
      if (!spec.placeOverlay(ov)) return;
      const enEl = ov.querySelector('.' + ID.orig);
      const zhEl = ov.querySelector('.' + ID.trans);
      enEl.style.display = 'none'; enEl.textContent = '';
      zhEl.onclick = null;
      zhEl.style.cssText = lineCss(Math.round(spec.fontPx() * 0.85), '#d6d6d6') + 'opacity:.85;font-style:italic;';
      zhEl.textContent = msg;
    }
    function clearOverlay() {
      const ov = document.getElementById(ID.overlay);
      if (ov) for (const cls of [ID.orig, ID.trans]) { const el = ov.querySelector('.' + cls); if (el) { el.textContent = ''; el.style.display = 'none'; } }
      lastShownKey = '';
    }
    function removeOverlay() { document.getElementById(ID.overlay)?.remove(); document.getElementById(ID.meas)?.remove(); }

    // ─── Display loop ──────────────────────────────────────────────────
    const MAX_ATTEMPTS = spec.maxAttempts || RESOLVE_MAX_ATTEMPTS;
    function tick() {
      ensureControlButton();
      if (spec.syncNative) spec.syncNative(active, engine.items.length);
      if (spec.onTick) spec.onTick(active); // per-tick backend hook (e.g. YT ensureCaptionsOn)
      if (!active) { if (document.getElementById(ID.overlay)) clearOverlay(); return; }
      if (!spec.hasMedia()) { if (document.getElementById(ID.overlay)) clearOverlay(); return; }

      const key = spec.mediaKey();
      if (key !== lastKey) {
        lastKey = key;
        engine.setItems([]); engine.reset();
        inFlight = false; attempts = 0; nextAt = 0; status = ''; clearOverlay();
        if (spec.onMediaKeyChange) spec.onMediaKeyChange(); // backend resets its own acquire state
      }

      if (!engine.items.length && status !== 'unavailable' && !inFlight && Date.now() >= nextAt) {
        inFlight = true; status = status === 'ready' ? 'ready' : 'loading'; attempts++;
        Promise.resolve().then(spec.acquire).then((res) => {
          if (res === 'unavailable') { status = 'unavailable'; }
          else if (res && res.length) { engine.setItems(TranslationCore.mergeSentences(res)); status = 'ready'; }
          else if (attempts >= MAX_ATTEMPTS) { status = 'unavailable'; }
          else { nextAt = Date.now() + RESOLVE_RETRY_MS; }
        }).catch(() => {
          if (attempts >= MAX_ATTEMPTS) status = 'unavailable';
          else nextAt = Date.now() + RESOLVE_RETRY_MS;
        }).finally(() => { inFlight = false; });
      }

      const br = spec.beforeRender ? spec.beforeRender() : undefined;
      if (br === 'clear') { if (lastShownKey) clearOverlay(); return; }
      if (br === 'skip') return;

      if (engine.items.length) {
        const tMs = spec.getCurrentTime();
        engine.pump();
        const s = engine.activeAt(tMs);
        if (!s) { if (lastShownKey) clearOverlay(); return; }
        const fp = spec.fontPx();
        const width = spec.textWidth();
        const frac = Math.min(0.999, Math.max(0, (tMs - s.start) / Math.max(1, s.end - s.start)));
        const pg = pagesFor(s, fp, width);
        const en = pg.en[Math.min(pg.en.length - 1, Math.floor(frac * pg.en.length))];
        const st = engine.stateOf(s, tMs);
        let zh = null;
        if (st.translation && pg.zh) zh = pg.zh[Math.min(pg.zh.length - 1, Math.floor(frac * pg.zh.length))];
        const k = s.start + '|' + en + '|' + (zh || st.state);
        if (k !== lastShownKey) { renderOverlay(en, zh, st.state, s); lastShownKey = k; }

        // Learning layer: a SINK, never a source (domain-design §9.1). A subtitle
        // counts as consumed only when the playhead actually STAYED on it — we
        // accumulate display ticks rather than trusting `activeAt`, so seeking past
        // a sentence (or scrubbing through a video) captures nothing.
        try {
          const wk = String(s.start);
          if (watchAcc.key !== wk) watchAcc = { key: wk, ms: 0, done: false };
          watchAcc.ms += TICK_MS;
          const span = Math.max(1, s.end - s.start);
          if (!watchAcc.done && st.translation && watchAcc.ms >= Math.min(1500, span * 0.6)) {
            watchAcc.done = true;
            LearnCollector.noteSubtitle({
              text: s.text, tr: st.translation,
              startMs: s.start, endMs: s.end,
              mediaKey: spec.mediaKey ? spec.mediaKey() : '',
            });
          }
        } catch (_) {}
      } else {
        lastShownKey = '';
        const playing = spec.isPlaying ? spec.isPlaying() : true;
        if (!playing) { if (document.getElementById(ID.overlay)) clearOverlay(); return; }
        if (status === 'unavailable') renderNotice(TranslationCore.t('yt_subtitle_unavailable', '字幕不可用'));
        else renderNotice(TranslationCore.t('yt_subtitle_loading', '⏳ 字幕加载中…'));
      }
    }
    function startLoop() { if (pollTimer) clearInterval(pollTimer); pollTimer = setInterval(tick, TICK_MS); }

    // ─── Control button + menu ─────────────────────────────────────────
    function ensureControlButton() {
      // Backends WITH an on/off menu row (YouTube, Twitter) use the button as the
      // entry point, so it shows even when inactive. Backends WITHOUT one (podcast) are
      // toggled by the page FAB, so their button shows only once active.
      const show = (active || spec.menuToggle !== false)
        && spec.hasMedia()
        && !(spec.showButton && !spec.showButton()); // mobile: the page FAB drives it
      if (!show) { document.getElementById(ID.btn)?.remove(); closeMenu(); return; }
      let btn = document.getElementById(ID.btn);
      if (!btn) {
        btn = document.createElement('button');
        btn.id = ID.btn;
        btn.setAttribute('translate', 'no');
        btn.title = spec.labels.btnTitle;
        btn.textContent = '译';
        btn.style.cssText = spec.buttonCss ? spec.buttonCss() :
          'position:fixed;right:18px;bottom:150px;width:40px;height:40px;border-radius:50%;' +
          window.MT_PALETTE.roundBtnCss(15) +
          'box-shadow:0 1px 6px rgba(0,0,0,.5);z-index:2147483000;';
        btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(btn); });
        document.body.appendChild(btn);
      }
      // A backend may re-parent/reposition the button into the active media's container
      // each tick (Twitter embeds 译 inside the video, so it rides fullscreen and binds to
      // the active video — §2.3.6/§5). Backends without the hook keep the body-fixed default.
      if (spec.anchorButton) spec.anchorButton(btn);
    }
    function closeMenu() { document.getElementById(ID.menu)?.remove(); }
    function toggleMenu(btn) {
      if (document.getElementById(ID.menu)) { closeMenu(); return; }
      const menu = document.createElement('div');
      menu.id = ID.menu;
      menu.setAttribute('translate', 'no');
      const r = btn.getBoundingClientRect();
      const right = Math.max(10, Math.round(window.innerWidth - r.right));
      // Open the menu DOWNWARD when the button sits in the top half of the viewport
      // (e.g. Twitter's 译 embedded at the video's top-right, §2.3.6) so the menu's top
      // items never clip above the viewport/header; open UPWARD otherwise (YouTube /
      // podcast float their button near the bottom).
      const openDown = r.top < window.innerHeight / 2;
      const vpos = openDown
        ? `top:${Math.max(10, Math.round(r.bottom + 8))}px`
        : `bottom:${Math.max(10, Math.round(window.innerHeight - r.top + 8))}px`;
      menu.style.cssText = `position:fixed;right:${right}px;${vpos};max-height:calc(100vh - 72px);overflow-y:auto;` +
        'z-index:2147483000;min-width:210px;background:rgba(28,28,28,.97);border-radius:10px;' +
        'padding:6px 0;font-size:14px;color:#eee;box-shadow:0 2px 12px rgba(0,0,0,.5);';
      const T = TranslationCore.t;
      // Some backends (podcast) have no on/off row in the menu — they are toggled by
      // the page FAB. spec.menuToggle === false omits it (zero-behavior-change parity).
      const withToggle = spec.menuToggle !== false;
      const row = (label, opts = {}) => {
        const rr = document.createElement('div');
        rr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;white-space:nowrap;';
        rr.addEventListener('mouseenter', () => (rr.style.background = 'rgba(255,255,255,.1)'));
        rr.addEventListener('mouseleave', () => (rr.style.background = 'none'));
        const tk = document.createElement('span'); tk.textContent = opts.checked ? '✓' : '';
        tk.style.cssText = 'width:12px;display:inline-block;color:#4caf50;';
        const t = document.createElement('span'); t.textContent = label; t.style.flex = '1';
        rr.appendChild(tk); rr.appendChild(t);
        if (opts.onClick) rr.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); });
        return rr;
      };
      const sep = () => { const s = document.createElement('div'); s.style.cssText = 'height:1px;background:rgba(255,255,255,.12);margin:5px 0;'; return s; };
      if (withToggle) {
        menu.appendChild(row(active ? spec.labels.subOff : spec.labels.subOn, { checked: active, onClick: () => setActive(!active) }));
        menu.appendChild(sep());
      }
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
        const off = (e) => { if (!menu.contains(e.target) && e.target.id !== ID.btn) { closeMenu(); document.removeEventListener('click', off); } };
        document.addEventListener('click', off);
      }, 0);
    }
    function setMode(mode) { displayMode = mode; clearOverlay(); closeMenu(); tick(); }

    // ─── .srt export ───────────────────────────────────────────────────
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
      a.download = ((spec.srtName ? spec.srtName() : document.title).replace(/[\\/:*?"<>|]/g, '_') || 'subtitle') + '.srt';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    // We are in a content script: chrome.runtime.openOptionsPage() is not part of
    // the surface exposed here, so navigating to the page ourselves is the only
    // path. That needs options/options.html in web_accessible_resources — without
    // it the browser refuses the navigation and Safari reports 「网址无效」 (#67).
    // Do NOT route this through the background worker: on Safari iOS it goes
    // permanently undefined after device lock, which would make settings
    // unreachable only *after* the phone is locked — a far more confusing failure.
    function openSettings() {
      window.open(chrome.runtime.getURL('options/options.html'), '_blank');
    }

    // ─── Public API ────────────────────────────────────────────────────
    function setActive(on) {
      active = on;
      if (on) { lastKey = ''; inFlight = false; attempts = 0; nextAt = 0; status = ''; }
      // 用量事件：字幕会话开始，只记站点**类别**（youtube / substack / podcast / other），不记域名。
      if (on && (typeof MTTelemetry !== 'undefined')) {
        subOkSent = false; subSince = Date.now();
        MTTelemetry.track('subtitle_on', { site: spec.telemetrySite || 'other' });
      }
      if (spec.onActiveChange) spec.onActiveChange(on);
      if (!on) { removeOverlay(); document.getElementById(ID.btn)?.remove(); closeMenu(); if (spec.syncNative) spec.syncNative(false, 0); }
      closeMenu();
      tick();
    }
    return {
      init(cfg) { settings = cfg; active = false; startLoop(); },
      enable(cfg) { if (cfg) settings = cfg; setActive(true); },
      disable() { setActive(false); },
      updateSettings(cfg) { settings = cfg; engine.reset(); clearOverlay(); },
      setActive,
      setDisplayMode: setMode,
      get engine() { return engine; },
      get settings() { return settings; },
      get active() { return active; },
      tick,
    };
  }

  return { createSubtitleUI };
})();
