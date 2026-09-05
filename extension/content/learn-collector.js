// learn-collector.js — the learning layer's SINK (记忆层).
// See docs/domain-design.md §9.1 and docs/learning-design.md §3.
//
// FOUR LAWS, all of which this file exists to obey:
//   1. Capture is a sink, never a source. Nothing here calls the engine, marks a
//      unit, or originates a translation. Delete this file at runtime and the
//      translation output must be byte-for-byte identical.
//   2. Silent in the browsing flow — never silent to a user who opted in. Every
//      entry point is wrapped: storage full, no IntersectionObserver, a throwing
//      observer — all reduce to "no capture", and the PAGE never hears about it.
//      But anything that loses captures is counted (`lq:dropped`) so the learning
//      surfaces can say so. Dropping is a normal path; hiding it is not.
//   3. Nothing reaches DomSegmenter. There are no selectors here beyond refusing to
//      look at our own injected UI.
//   4. Self-capture is forbidden — `.mt-translation` and any `#mt-*` subtree are
//      skipped, or we would translate our own translations and capture the result.
//
// The corpus does NOT live here. A content script's `indexedDB` belongs to the HOST
// PAGE's origin, so writing it here would scatter the user's reading history across
// every site they visit and expose it to the page. This file only appends to a
// bounded outbox in chrome.storage.local; an extension page drains it later.

var LearnCollector = (() => {
  const FLUSH_EVERY_MS = 30000;
  const MAX_DRAFTS = 400;        // per page session, before we stop accumulating

  let on = false;
  let cfg = {};
  let nowFn = () => Date.now();
  let drafts = new Map();        // id → draft
  let observer = null;
  let watched = new Map();       // node → { text, tr, id, visibleSince, dwellMs }
  let flushTimer = null;
  let sessionId = '';
  let pageMeta = null;

  function safe(fn) { try { return fn(); } catch (_) { return undefined; } }

  function meta() {
    if (!pageMeta) {
      const url = safe(() => location.href) || '';
      pageMeta = {
        url,
        title: (safe(() => document.title) || '').slice(0, 200),
        sourceId: LearnModel.sourceId(url),
      };
    }
    return pageMeta;
  }

  // Never look at our own UI (law 4), and never at something the site marked as
  // non-content chrome (the generic adapter marker — law 3).
  function isOurs(node) {
    if (!node || node.nodeType !== 1) return true;
    if (node.closest('.mt-translation, [id^="mt-"], [data-mt-skip-region]')) return true;
    if (node.getAttribute && node.getAttribute('translate') === 'no') return true;
    return false;
  }

  function detectLang(text) {
    // The detector is INJECTED, never probed for (domain-design §5.3.2). Absent on
    // every Safari — in which case the language is simply unknown, and 'und' items
    // are grouped separately in the review UI rather than dropped.
    // `r.lang`, not `r.language`: LangDetect.flatten returns {lang, percentage,
    // isReliable}. Reading the wrong field stored EVERY item as 'und' on Chrome
    // too — found on a real Chrome (2026-08-09) when the whitelist kept falling
    // back to script inference on a browser that detects perfectly well.
    const det = cfg.detect;
    if (typeof det !== 'function') return 'und';
    const r = safe(() => det(text));
    return (r && r.lang) || 'und';
  }

  function addDraft(d) {
    if (!on) return;
    if (drafts.size >= MAX_DRAFTS && !drafts.has(d.id)) return;
    const prev = drafts.get(d.id);
    if (prev) {
      prev.dwellMs = Math.max(prev.dwellMs || 0, d.dwellMs || 0);
      prev.seenCount = (prev.seenCount || 1) + 1;
      prev.starred = prev.starred || d.starred;
      prev.playedThrough = prev.playedThrough || d.playedThrough;
      return;
    }
    drafts.set(d.id, d);
  }

  // ─── Webpage paragraphs: dwell via IntersectionObserver ──────────────────

  function ensureObserver() {
    if (observer || typeof IntersectionObserver === 'undefined') return observer;
    observer = safe(() => new IntersectionObserver((entries) => {
      const t = nowFn();
      for (const e of entries) {
        const w = watched.get(e.target);
        if (!w) continue;
        if (e.isIntersecting) {
          w.visibleSince = t;
        } else if (w.visibleSince) {
          w.dwellMs += t - w.visibleSince;
          w.visibleSince = 0;
        }
      }
    }, { threshold: 0.5 })) || null;
    return observer;
  }

  // Called from content-webpage's renderUnit, AFTER the same-language backstop —
  // so only genuine translations ever reach here.
  //
  // `priorDwellMs` 是**补登记**用的（renderUnit 从不传它）。采集是在渲染那一刻登记
  // 节点的，而用户完全可能先翻译、再打开采集 —— 我们自己的交接块正是这么引导的
  // （「译文出来了 → 去打开采集学习材料」）。那条路上页面里的译文早已渲染完毕，
  // 没有任何东西会再调用 observe，于是**必然一张卡都没有**（2026-09-02 用户实测）。
  // 补登记时把「这段译文已经在页面上摆了多久、且此刻就在视口里」如实折算进 dwell：
  // 不是凭空给分，是把当时没在记的那段时间补记上，上限与实时那条路的饱和点相同。
  function observe(node, text, tr, priorDwellMs) {
    if (!on) return;
    safe(() => {
      if (isOurs(node)) return;
      if (!LearnModel.normText(text) || !LearnModel.normText(tr)) return;
      const existing = watched.get(node);
      if (existing && existing.text === text && existing.tr === tr) return;
      const ob = ensureObserver();
      if (!ob) return;
      if (existing) ob.unobserve(node);
      const prior = existing ? existing.dwellMs
        : Math.max(0, Math.min(Number(priorDwellMs) || 0, LearnModel.DEFAULTS.DWELL_FULL_MS));
      watched.set(node, { text, tr, dwellMs: prior, visibleSince: 0 });
      ob.observe(node);
    });
  }

  // Long-press on a translation → force-promote, bypassing the salience gate.
  function star(node) {
    if (!on) return false;
    return !!safe(() => {
      const w = watched.get(node);
      if (!w) return false;
      const lang = detectLang(w.text);
      const m = meta();
      for (const d of draftsFrom(w, lang, m)) addDraft(Object.assign(d, { starred: true }));
      flush();
      return true;
    });
  }

  // §4.2: the renderer hands us PARAGRAPHS, but the unit of study is the
  // sentence — split the (text, tr) pair here, before ids are computed.
  // splitPair pairs by count equality; a mismatch gets one bounded §4.2b
  // reconciliation attempt and otherwise returns the pair whole (a misaligned
  // immutable pair would be permanent corpus corruption).
  // Sentences inherit the paragraph's dwell — reading the paragraph IS reading
  // its sentences; the salience gate then judges each sentence on its own.
  function draftsFrom(w, lang, m) {
    return LearnModel.splitPair(w.text, w.tr, lang, cfg.targetLang).map((p) => ({
      id: LearnModel.itemId(lang, p.text),
      text: p.text, tr: p.tr, lang,
      targetLang: cfg.targetLang || '',
      kind: 'sentence',
      sourceId: m.sourceId,
      anchor: { k: 'dom', quote: LearnModel.normText(p.text).slice(0, 120) },
      dwellMs: w.dwellMs || 0,
      seenCount: 1,
      lastSeenAt: nowFn(),
      starred: false,
    }));
  }

  // ─── Subtitles: "dwell" is the playhead actually crossing the sentence ────

  function noteSubtitle(s) {
    if (!on) return;
    safe(() => {
      if (!s || !LearnModel.normText(s.text) || !LearnModel.normText(s.tr)) return;
      const lang = detectLang(s.text);
      const m = meta();
      addDraft({
        id: LearnModel.itemId(lang, s.text),
        text: s.text, tr: s.tr, lang,
        targetLang: cfg.targetLang || '',
        kind: 'sentence',
        sourceId: m.sourceId,
        anchor: {
          k: 'media',
          mediaKey: s.mediaKey || '',
          startMs: s.startMs || 0,
          endMs: s.endMs || 0,
        },
        dwellMs: 0,
        playedThrough: true,
        seenCount: 1,
        lastSeenAt: nowFn(),
        starred: false,
      });
    });
  }

  // ─── Flush: drafts → bounded outbox in chrome.storage.local ──────────────

  function harvestDwell() {
    const t = nowFn();
    const m = meta();
    for (const [node, w] of watched) {
      if (w.visibleSince) { w.dwellMs += t - w.visibleSince; w.visibleSince = t; }
      if (!w.dwellMs) continue;
      if (!node.isConnected) continue;
      for (const d of draftsFrom(w, detectLang(w.text), m)) addDraft(d);
    }
  }

  // Resolves with the number of items written (0 when nothing qualified, or when
  // anything at all went wrong — law 2: a failed capture is indistinguishable from
  // no capture, and never surfaces).
  function flush() {
    if (!on) return Promise.resolve(0);
    return new Promise((resolve) => {
      let settled = false;
      const done = (n) => { if (!settled) { settled = true; resolve(n); } };
      try {
        harvestDwell();
        const now = nowFn();
        // Keyed by FINAL item id: the detector is async, so a draft's first
        // harvest often races the answer and keys itself under 'und'. Late
        // answers re-resolve at flush time; the same sentence seen as both
        // ('und', text) and ('en', text) collapses onto one item here — keep the
        // higher-dwell copy, never sum (both drafts watched the SAME node, so
        // summing would double-count the one reading session).
        const byId = new Map();
        for (const d of drafts.values()) {
          if (!LearnModel.shouldCapture(d, cfg.model)) continue;
          let lang = d.lang;
          if (lang === 'und') {
            const late = detectLang(d.text);
            if (late !== 'und') lang = late;
          }
          // Learning-language whitelist (learning-design §4.1). STARRED drafts
          // bypass it — an explicit long-press outranks a standing filter. The
          // typeof guard fails OPEN (capture), the documented failure direction.
          if (!d.starred && typeof LearnRules !== 'undefined'
            && !LearnRules.langAllowed(lang, d.text,
              cfg.rules && cfg.rules.langs, cfg.langRegistry)) continue;
          const item = LearnModel.makeItem(
            lang === d.lang ? d : Object.assign({}, d, { lang }), now, cfg.model);
          const prev = byId.get(item.id);
          if (!prev || (item.dwellMs || 0) > (prev.dwellMs || 0)) byId.set(item.id, item);
        }
        const items = Array.from(byId.values());
        if (!items.length) { done(0); return; }

        const src = meta();
        const key = LearnModel.OUTBOX_PREFIX + sessionId;
        const idxKey = LearnModel.OUTBOX_INDEX;
        const dropKey = LearnModel.OUTBOX_DROPPED;
        chrome.storage.local.get([idxKey, dropKey], (res) => {
          try {
            const index = Array.isArray(res && res[idxKey]) ? res[idxKey].slice() : [];
            const at = index.findIndex((e) => e && e.k === key);
            const entry = { k: key, ts: now, n: items.length };
            if (at >= 0) index[at] = entry; else index.push(entry);

            // Bounded: the oldest sessions are dropped. Still a NORMAL path (law 2)
            // — but no longer an invisible one. These captures never reach the
            // corpus at all, so the count is carried forward for the learning
            // surfaces to report; the page itself stays silent.
            const drop = index.length > LearnModel.MAX_OUTBOX_SESSIONS
              ? index.splice(0, index.length - LearnModel.MAX_OUTBOX_SESSIONS)
              : [];

            const write = {};
            write[idxKey] = index;
            if (drop.length) {
              const prev = (res && res[dropKey]) || { n: 0, at: 0 };
              write[dropKey] = {
                n: (prev.n || 0) + drop.reduce((t, e) => t + (e.n || 0), 0),
                at: now,
              };
            }
            write[key] = { url: src.url, title: src.title, sourceId: src.sourceId, items };
            chrome.storage.local.set(write, () => {
              if (drop.length) safe(() => chrome.storage.local.remove(drop.map((e) => e.k)));
              // 用量事件：这个 install 第一次真的落盘（成功回调里，失败路径上什么都不发 —— 法则 2）。
              if (items.length && (typeof MTTelemetry !== 'undefined')) safe(() => MTTelemetry.once('capture_first'));
              done(items.length);
            });
          } catch (_) { done(0); }
        });
      } catch (_) { done(0); }
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  function enable(c) {
    if (on) { cfg = Object.assign({}, cfg, c || {}); return; }
    cfg = Object.assign({}, c || {});
    if (typeof cfg.now === 'function') nowFn = cfg.now;
    on = true;
    pageMeta = null;
    sessionId = String(nowFn()) + '-' + Math.random().toString(36).slice(2, 8);
    flushTimer = safe(() => setInterval(flush, FLUSH_EVERY_MS)) || null;
    safe(() => window.addEventListener('pagehide', flush));
  }

  // `opts.discard` skips the farewell flush AND drops the backlog: a page the
  // user just blocked (本站不收录 mid-session) must not sneak its drafts into the
  // outbox on the way out. Default behaviour (flush) is unchanged for everyone else.
  function disable(opts) {
    if (!on) return Promise.resolve(0);
    const p = (opts && opts.discard) ? Promise.resolve(0) : flush();
    on = false;
    // Resource lifetime matters as much as output (verification-spec §3.1.1 blind
    // spot 3): a leaked observer keeps every captured node alive for the life of
    // the page.
    if (flushTimer != null) { safe(() => clearInterval(flushTimer)); flushTimer = null; }
    if (observer) { safe(() => observer.disconnect()); observer = null; }
    watched.clear();
    drafts.clear();
    safe(() => window.removeEventListener('pagehide', flush));
    return p;
  }

  function updateSettings(c) { cfg = Object.assign({}, cfg, c || {}); }

  return {
    enable, disable, updateSettings, observe, noteSubtitle, star, flush,
    get isOn() { return on; },
    _debug: { get drafts() { return drafts; }, get watched() { return watched; } },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnCollector;
