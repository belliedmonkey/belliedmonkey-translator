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
//   acquire(ctx):   Promise< cues[] | null | 'unavailable' | 'streaming' >
//                   cues[] → ready; null → retry (until cap); 'unavailable' → no track (final);
//                   'streaming' → the backend keeps pushing through ctx (docs/domain-design.md
//                   §2.4 tier B). ctx = { push(cues), done(), fail(msg), notice(msg),
//                   mode('file'|'live'), onAbort(fn) } — push() runs the streaming sentence
//                   merger and appends only CLOSED sentences to the engine; done() flushes;
//                   fail(msg) ends in `unavailable` with msg as the notice; mode() applies
//                   the per-tier window; onAbort(fn) registers the stop hook the harness
//                   calls on media change / disable / settings change / 「停止转写」.
//   unavailableAction(): {label, onClick} | null — (optional) a button rendered inside the
//                   `字幕不可用` notice (the §2.4 offer). Re-read every tick.
//   placeHistory(el): bool — (optional) mount + position the 字幕历史 panel (e.g. inside the
//                   player, bottom-right, above the controls). Default: viewport-fixed
//                   bottom-right. Return false to hide it this tick.
//   onSettingsChange(cfg): void — (optional) e.g. abort a live session when its engine changed
//   placeOverlay(ov): bool — (re)mount + position the overlay; false ⇒ skip render this tick
//   fontPx():       number
//   textWidth():    number
//   translate(text):Promise<string>
//   labels:         { btnTitle, subOn, subOff }  — i18n strings for the menu
//   showButton():   bool   — (optional) show the in-adapter 译 button (false on mobile → FAB)
//   buttonCss():    string — (optional) the floating button's cssText
//   onActiveChange(on): void — (optional) e.g. inject/remove native-caption-hiding CSS
//   beforeRender():'clear'|'skip'|void — (optional) e.g. suppress overlay during an ad
//   acquireGate():  bool   — (optional) false ⇒ acquisition is PAUSED: no attempt is started and
//                   nothing is counted (e.g. a YouTube pre-roll ad — the main video's transcript
//                   does not exist yet, and maxAttempts would be spent on nothing; #325). When it
//                   turns true again the attempt budget is fresh and a cap-exhausted `unavailable`
//                   is un-latched. A backend's own final 'unavailable' / fail(msg) is NOT.
//   syncNative(active, hasItems): void — (optional) native <track>/UI suppression, every tick
//   srtName():      string — (optional) download filename base

var SubtitleAdapter = (() => {
  const RESOLVE_MAX_ATTEMPTS = 6;
  const RESOLVE_RETRY_MS = 2500;
  // 一次取现成字幕（spec.acquire）的总上限，见 tick() 里的说明（全回归 09-14 F12）
  const ACQUIRE_TIMEOUT_MS = 20000;
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
    let status = '';           // '' | 'loading' | 'ready' | 'unavailable' | 'streaming'
    // failures：已落定的「这次没取到」次数（null / 超时 / 抛错）。早出的 offer 按它判，不按 !inFlight ——
    // 否则下一次 acquire 一起飞 offer 就消失、落定又出，一闪一闪（全回归 09-15 O3）。
    let inFlight = false, attempts = 0, nextAt = 0, failures = 0;
    // acquireGate（#325）：gateWasClosed 记「上一拍闸门关着」，capExhausted 记「unavailable 是次数耗尽落定的」——
    // 只有这一种 unavailable 会在闸门重开时解开；后端自己给的最终结论（'unavailable' / fail(msg)）不解。
    let gateWasClosed = false, capExhausted = false;
    // Every (re)start of acquisition bumps the epoch; an acquire that resolves after
    // the epoch moved (media changed, acquireVia took over) must not touch `status`.
    let acquireEpoch = 0;
    // §2.4 streaming state: the backend-supplied acquire (set by acquireVia), its abort
    // hook, the open-tail merger, and a custom notice line (a stop reason, never silent).
    let asrAcquire = null, streamAbort = null, merger = null, noticeMsg = '';
    // Tier B（边说边出的实时档）已于 2026-09-16 从扩展端下掉（domain-design §2.4
    // 第 3 条）。随它一起消失的是三个**只为它存在**的概念：开口的尾句（partial）、
    // 边说边译（partial 的即时翻译）、字幕历史面板。它们此前占这个文件约 150 行。
    //
    // 留这段注释而不是留代码：`ctx.mode()` 现在唯一的调用方是 asr-source.js 的
    // `ctx.mode('file')`，也就是说 `live` 恒为 false —— 那些分支一行都执行不到，
    // 而不可达代码会让下一个读这个文件的人以为它们还在工作。
    //
    // ⚠️ App 的听译里有**同名**的「边说边译」与「字幕历史」（app/listen-core.js、
    // scripts/verify-listen.js）。那是另一套实现，与这里无关，不要一起清。
    let lastNoticeKey = '';
    // 生产窗口，从 core 读（永不在这里重述一遍）。
    const FILE_WINDOW = { GRACE_MS: (TranslationCore.WINDOW || {}).GRACE_MS, HOLD_MS: 0 };
    function applyWindow(w) {
      const clean = {};
      for (const k of Object.keys(w)) if (w[k] !== undefined) clean[k] = w[k];
      if (engine.setWindow) engine.setWindow(clean);
    }
    function abortStream(why) {
      const fn = streamAbort; streamAbort = null;
      if (fn) { try { fn(why); } catch (_) {} }
      merger = null;
    }
    function makeCtx() {
      return {
        push(cues) {
          if (!merger) merger = TranslationCore.createCueMerger();
          const closed = merger.push(cues);
          if (closed.length) engine.appendItems(closed);
        },
        done() {
          if (merger) { const t = merger.flush(); if (t.length) engine.appendItems(t); }
          if (status === 'streaming') status = 'ready';
          streamAbort = null;
        },
        fail(msg) { abortStream('fail'); status = 'unavailable'; noticeMsg = msg || ''; lastShownKey = ''; },
        notice(msg) { noticeMsg = msg || ''; },
        // 只剩 'file' 一种（asr-source.js 是唯一调用方）。保留这个方法而不是内联，
        // 是因为它是 ctx 的对外形状 —— 后端换一种取字幕的方式时，窗口该由它来说。
        mode() { applyWindow(FILE_WINDOW); },
        onAbort(fn) { streamAbort = fn; },
      };
    }

    const pager = TranslationCore.createPager({ measurerId: ID.meas });
    let subOkSent = false, subSince = 0;
    let haltCode = '';   // 本会话最后一次停机码（额度 / key 被拒）—— 与 content-webpage 同一份文案
    const openHaltSettings = () => { try { window.open(chrome.runtime.getURL('options/options.html') + TranslationCore.haltAnchor(haltCode), '_blank'); } catch (_) {} };
    const engine = TranslationCore.createSubtitleEngine({
      getCurrentTime: () => spec.getCurrentTime(),
      onOk: () => {
        if (subOkSent || !(typeof MTTelemetry !== 'undefined')) return;
        subOkSent = true;
        MTTelemetry.track('translate_ok', { provider: String((settings && settings.provider) || ''), kind: 'subtitle', ms: Date.now() - subSince });
        // 字幕会话也算一次成功会话（评分提示的计数），只计数：叠层里没有位置出那一行。
        try { if (typeof MTFeedback !== 'undefined' && MTFeedback.noteOkSession) MTFeedback.noteOkSession().catch(() => {}); } catch (_) {}
      },
      onFail: (e) => {
        if (e && (e.grant || e.halt) && typeof e.code === 'string') haltCode = e.code;
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
        // 停机（额度用完 / key 被拒）时重试没有意义 —— 这一行说停机那句，点了去设置页。
        const halt = haltCode ? TranslationCore.haltMessage(haltCode) : '';
        zhEl.textContent = halt || TranslationCore.MSG.error;
        zhEl.onclick = halt ? openHaltSettings : () => { engine.retry(sentence); lastShownKey = ''; };
      } else if (state === 'pending') {
        zhEl.style.cssText = lineCss(Math.round(fp * 0.85), '#d6d6d6') + 'opacity:.85;font-style:italic;';
        zhEl.textContent = TranslationCore.MSG.preparing;
      } else { zhEl.style.display = 'none'; zhEl.textContent = ''; }
    }
    // action: {label, onClick} — the §2.4 offer button, inside the same notice line.
    // Content is rebuilt only when (msg, label) changes: the notice is re-rendered every
    // tick to follow the overlay anchor, and rebuilding the button every 250 ms would
    // let a tap land between two generations of it.
    function renderNotice(msg, action) {
      const ov = ensureOverlay();
      if (!spec.placeOverlay(ov)) return;
      const enEl = ov.querySelector('.' + ID.orig);
      const zhEl = ov.querySelector('.' + ID.trans);
      enEl.style.display = 'none'; enEl.textContent = '';
      const key = msg + '|' + (action ? action.label : '');
      if (key === lastNoticeKey && zhEl.style.display !== 'none') return;
      lastNoticeKey = key;
      zhEl.onclick = null;
      zhEl.style.cssText = lineCss(Math.round(spec.fontPx() * 0.85), '#d6d6d6') + 'opacity:.85;font-style:italic;';
      zhEl.textContent = msg;
      if (action) {
        const btn = document.createElement('button');
        btn.className = ID.trans + '-action';
        btn.setAttribute('translate', 'no');
        btn.textContent = action.label;
        // The podcast overlay is pointer-events:none so it never blocks the page; the
        // button is the one thing inside it that must be tappable.
        btn.style.cssText = 'pointer-events:auto;margin-left:10px;padding:2px 10px;border-radius:12px;border:0;' +
          'font:inherit;font-style:normal;cursor:pointer;' + window.MT_PALETTE.roundBtnCss(Math.round(spec.fontPx() * 0.8));
        btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); action.onClick(); });
        zhEl.appendChild(btn);
      }
    }
    function clearOverlay() {
      const ov = document.getElementById(ID.overlay);
      if (ov) for (const cls of [ID.orig, ID.trans]) { const el = ov.querySelector('.' + cls); if (el) { el.textContent = ''; el.style.display = 'none'; } }
      lastShownKey = ''; lastNoticeKey = '';
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
        // A §2.4 session belongs to the media it was tapped for: stop it, and require a
        // fresh tap for the next media (never an automatic restart of a paid session).
        // The FIRST key after activation is not a change — acquireVia may already have
        // registered the session for exactly this media.
        const realChange = lastKey !== '';
        lastKey = key;
        if (realChange) { abortStream('media'); asrAcquire = null; }
        noticeMsg = ''; applyWindow(FILE_WINDOW);
        engine.setItems([]); engine.reset();
        inFlight = false; attempts = 0; failures = 0; nextAt = 0; status = ''; capExhausted = false; clearOverlay(); acquireEpoch++;
        if (spec.onMediaKeyChange) spec.onMediaKeyChange(); // backend resets its own acquire state
      }

      // 'streaming' latches the gate exactly like 'unavailable': the backend now owns
      // acquisition and feeds the engine through ctx.push — re-calling acquire would
      // start a second capture of the same media.
      // 取字幕的闸门（#325，2026-09-18）。YouTube 片头广告期间正片的 timedtext 还不存在：那 20 s（8 × 2.5 s）
      // 的尝试全落空，status 锁死在 unavailable，广告结束后地址来了也不再试 —— 而界面只说「字幕不可用」。
      // 闸门关着：不起飞、不计次。重新打开：预算清零；只解开「次数耗尽」落定的 unavailable。
      // 用户已经点过的 §2.4 转写（asrAcquire）不归这道闸门管 —— 那是一次付费会话，不能因为一条广告重来。
      const gateOpen = spec.acquireGate ? !!spec.acquireGate() : true;
      if (!gateOpen) gateWasClosed = true;
      else if (gateWasClosed) {
        gateWasClosed = false;
        if (!engine.items.length && status !== 'streaming' && !asrAcquire) {
          attempts = 0; failures = 0; nextAt = 0;
          if (status === 'unavailable' && capExhausted) { status = ''; lastShownKey = ''; }
        }
        capExhausted = false;
      }

      if (gateOpen && !engine.items.length && status !== 'unavailable' && status !== 'streaming' && !inFlight && Date.now() >= nextAt) {
        inFlight = true; status = status === 'ready' ? 'ready' : 'loading'; attempts++;
        const ctx = makeCtx();
        const fn = asrAcquire || spec.acquire;
        const epoch = acquireEpoch;
        // 取现成字幕的一次尝试有总上限（全回归 09-14 F12）：acquire 挂住时 inFlight 永远是 true，叠层永远「字幕加载中」、
        // offer 永远不出。超时按「这次没取到」算（重试 / 落定 unavailable），迟到的结果丢掉。§2.4 已开始的转写（asrAcquire）
        // 不设这个上限 —— 整段上传转写可以要一百多秒。
        const run = Promise.resolve().then(() => fn(ctx));
        const guarded = asrAcquire ? run
          : Promise.race([run, new Promise((resolve) => setTimeout(() => resolve(null), spec.acquireTimeoutMs || ACQUIRE_TIMEOUT_MS))]);
        guarded.then((res) => {
          if (epoch !== acquireEpoch) return; // superseded: a newer acquisition owns `status`
          if (res === 'unavailable') { status = 'unavailable'; }
          else if (res === 'streaming') { if (status !== 'unavailable') status = 'streaming'; }
          else if (res && res.length) { engine.setItems(TranslationCore.mergeSentences(res)); status = 'ready'; }
          else { failures++; if (attempts >= MAX_ATTEMPTS) { status = 'unavailable'; capExhausted = true; } else nextAt = Date.now() + RESOLVE_RETRY_MS; }
        }).catch(() => {
          if (epoch !== acquireEpoch) return;
          failures++;
          if (attempts >= MAX_ATTEMPTS) { status = 'unavailable'; capExhausted = true; }
          else nextAt = Date.now() + RESOLVE_RETRY_MS;
        }).finally(() => { if (epoch === acquireEpoch) inFlight = false; });
      }

      const br = spec.beforeRender ? spec.beforeRender() : undefined;
      if (br === 'clear') { if (lastShownKey) clearOverlay(); return; }
      if (br === 'skip') return;

      const tMs = spec.getCurrentTime();
      let s = null;
      if (engine.items.length) { engine.pump(); s = engine.activeAt(tMs); }
      if (engine.items.length) {
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
        if (status === 'unavailable') {
          const action = spec.unavailableAction ? spec.unavailableAction() : null;
          renderNotice(noticeMsg || TranslationCore.t('yt_subtitle_unavailable', '字幕不可用'), action);
        }
        else if (status === 'streaming') renderNotice(noticeMsg || TranslationCore.t('yt_subtitle_loading', '⏳ 字幕加载中…'));
        else {
          // 2026-09-11：offer 从第一次 acquire 失败起就出现在「⏳ 字幕加载中…」这一行里（podcast 1 次，
          // YouTube 2 次 —— 前 3 s 有 grace）。此前要等 6–8 次重试 ≈ 15–20 s，多数人已经走了。
          // 落定后仍是「字幕不可用 + offer」（上一分支），规约不变。
          // 按已落定的失败次数判，下一次 acquire 在飞时 offer 也留在原处（全回归 09-15 O3：此前按 !inFlight 判，一闪一闪）。
          const early = failures >= (spec.offerAfterAttempts || 1) && spec.unavailableAction ? spec.unavailableAction() : null;
          renderNotice(noticeMsg || TranslationCore.t('yt_subtitle_loading', '⏳ 字幕加载中…'), early);
        }
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
      if (streamAbort) {
        // 「字幕历史面板」与「边说边译」两项随 Tier B 一起下掉（2026-09-16）。
        menu.appendChild(row(T('asr_stop', '停止转写'), { onClick: () => { stopAsr(); closeMenu(); } }));
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
      if (on) { lastKey = ''; inFlight = false; attempts = 0; failures = 0; nextAt = 0; status = ''; capExhausted = false; acquireEpoch++; }
      // 用量事件：字幕会话开始，只记站点**类别**（youtube / substack / podcast / other），不记域名。
      if (on && (typeof MTTelemetry !== 'undefined')) {
        subOkSent = false; subSince = Date.now();
        MTTelemetry.track('subtitle_on', { site: spec.telemetrySite || 'other' });
      }
      if (spec.onActiveChange) spec.onActiveChange(on);
      if (!on) { abortStream('off'); asrAcquire = null; noticeMsg = ''; removeOverlay(); document.getElementById(ID.btn)?.remove(); closeMenu(); if (spec.syncNative) spec.syncNative(false, 0); }
      closeMenu();
      tick();
    }
    // §2.4: the backend hands over an acquire that transcribes (on the user's tap).
    // It replaces spec.acquire for the CURRENT media only; a media change clears it.
    function acquireVia(fn) {
      abortStream('restart');
      asrAcquire = fn; noticeMsg = '';
      status = ''; attempts = 0; failures = 0; nextAt = 0; inFlight = false; capExhausted = false; acquireEpoch++;
      engine.setItems([]); engine.reset(); clearOverlay();
      // With subtitles off, setActive's own tick sees the FIRST media key (not a change,
      // so the session registered above survives) and runs it. Found live: an earlier
      // version cleared the session on that first tick and ended in a plain 字幕不可用.
      if (!active) setActive(true); else tick();
    }
    // User-initiated stop: back to the offer, never a silent state.
    function stopAsr() {
      abortStream('user'); asrAcquire = null; noticeMsg = '';
      status = 'unavailable'; applyWindow(FILE_WINDOW); clearOverlay();
    }
    return {
      init(cfg) { settings = cfg; active = false; startLoop(); },
      enable(cfg) { if (cfg) settings = cfg; setActive(true); },
      disable() { setActive(false); },
      updateSettings(cfg) { settings = cfg; engine.reset(); clearOverlay(); if (spec.onSettingsChange) spec.onSettingsChange(cfg); },
      acquireVia, stopAsr,
      get streaming() { return !!streamAbort; },
      setActive,
      setDisplayMode: setMode,
      get engine() { return engine; },
      get settings() { return settings; },
      get active() { return active; },
      tick,
    };
  }

  // exported for tests: the clamp keeps a dragged panel fully inside the viewport
  return { createSubtitleUI };

})();
