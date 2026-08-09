// test/learn-collector.test.js — the sink.
//
// Three things are asserted that output alone cannot show:
//   · WORK NOT DONE — a segment below the dwell floor must produce ZERO storage
//     writes, not merely "no visible card".
//   · RESOURCE LIFETIME — disable() must disconnect the IntersectionObserver and
//     clear the flush timer, via recording stubs.
//   · SILENCE — a throwing storage layer must not propagate anything.

const { loadModule, describe, test, ok, eq, tick } = require('./harness');
const { makeChrome } = require('./stubs');

const LATIN = 'The quick brown fox jumps over the lazy dog and keeps on running.';

// A fake element good enough for the collector: it only ever calls `closest`,
// `getAttribute` and reads `isConnected`.
function el(over) {
  return Object.assign({ nodeType: 1, isConnected: true, closest: () => null, getAttribute: () => null }, over);
}

function setup(opts = {}) {
  const store = opts.store || {};
  const chrome = makeChrome({ store });
  const timers = { set: 0, cleared: 0, ids: [] };
  const observers = [];

  class FakeIO {
    constructor(cb) { this.cb = cb; this.targets = new Set(); this.disconnected = false; observers.push(this); }
    observe(t) { this.targets.add(t); }
    unobserve(t) { this.targets.delete(t); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
    fire(entries) { this.cb(entries); }
  }

  const listeners = [];
  const window = {
    addEventListener: (t, fn) => listeners.push([t, fn]),
    removeEventListener: (t, fn) => {
      const i = listeners.findIndex(([a, b]) => a === t && b === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };

  const model = loadModule('learn-model.js', { window: {} }).LearnModel;
  const ctx = loadModule('learn-collector.js', {
    window,
    chrome,
    LearnModel: model,
    IntersectionObserver: FakeIO,
    document: { title: 'A Page' },
    location: { href: 'https://example.com/post' },
    Math,
    setInterval: (fn, ms) => { timers.set++; const id = setInterval(fn, 1e9); timers.ids.push(id); return id; },
    clearInterval: (id) => { timers.cleared++; clearInterval(id); },
  });

  return { C: ctx.LearnCollector, store, chrome, timers, observers, listeners, model };
}

// Drive dwell: make the node visible at t0, invisible at t0+ms.
function dwell(C, observers, node, ms, clock) {
  const io = observers[observers.length - 1];
  clock.t = 1000;
  io.fire([{ target: node, isIntersecting: true }]);
  clock.t = 1000 + ms;
  io.fire([{ target: node, isIntersecting: false }]);
}

function outboxKeys(store) {
  return Object.keys(store).filter((k) => k.startsWith('lq:') && k !== 'lq:index');
}
function capturedItems(store) {
  return outboxKeys(store).flatMap((k) => (store[k] && store[k].items) || []);
}

describe('LearnCollector — work NOT done', () => {
  test('a segment scrolled straight past produces ZERO storage writes', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN' });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 300, clock);          // 300ms — not reading
    eq(await C.flush(), 0);
    eq(Object.keys(store).length, 0, 'nothing at all was written to storage');
  });

  test('a segment actually read IS written, exactly once, under an lq: key', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN' });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    eq(await C.flush(), 1);
    eq(outboxKeys(store).length, 1);
    eq(capturedItems(store).length, 1);
    eq(capturedItems(store)[0].text, LATIN);
    ok(Array.isArray(store['lq:index']) && store['lq:index'].length === 1);
  });

  test('our own injected UI is never observed, so it can never be captured', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t });
    const ours = el({ closest: (sel) => (/mt-translation/.test(sel) ? {} : null) });
    C.observe(ours, LATIN, '译文');
    eq(observers.length, 0, 'no observer is even created for our own UI');
    eq(await C.flush(), 0);
    eq(Object.keys(store).length, 0);
  });

  test('a translation-less unit is never captured, however long it was on screen', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t });
    const node = el();
    C.observe(node, LATIN, '');
    eq(observers.length, 0);
    eq(await C.flush(), 0);
    eq(Object.keys(store).length, 0);
  });

  test('nothing is captured while disabled — observe() is inert', async () => {
    const { C, store } = setup();
    const node = el();
    C.observe(node, LATIN, '译文');
    eq(await C.flush(), 0);
    eq(Object.keys(store).length, 0);
  });
});

describe('LearnCollector — subtitles', () => {
  test('a played-through sentence is captured with its timestamps and media key', async () => {
    const { C, store } = setup();
    const clock = { t: 5000 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN' });
    C.noteSubtitle({ text: LATIN, tr: '一段足够长的中文译文。', startMs: 12000, endMs: 16000, mediaKey: 'abcdefghijk' });
    eq(await C.flush(), 1);
    const it = capturedItems(store)[0];
    eq(it.anchor.k, 'media');
    eq(it.anchor.startMs, 12000);
    eq(it.anchor.endMs, 16000);
    eq(it.anchor.mediaKey, 'abcdefghijk');
  });
});

describe('LearnCollector — resource lifetime', () => {
  test('disable() disconnects the observer and clears the flush timer', async () => {
    const { C, observers, timers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t });
    C.observe(el(), LATIN, '译文足够长的一句话。');
    eq(timers.set, 1, 'enable schedules exactly one flush timer');
    ok(observers.length === 1);
    await C.disable();
    eq(observers[0].disconnected, true, 'a leaked observer retains every captured node');
    eq(timers.cleared, 1);
    eq(C.isOn, false);
  });

  test('enable() twice does not stack timers or observers', async () => {
    const { C, timers, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t });
    C.enable({ now: () => clock.t });
    C.observe(el(), LATIN, '译文足够长的一句话。');
    eq(timers.set, 1);
    eq(observers.length, 1);
    await C.disable();
  });

  test('the pagehide listener is removed on disable', async () => {
    const { C, listeners } = setup();
    C.enable({ now: () => 0 });
    eq(listeners.filter(([t]) => t === 'pagehide').length, 1);
    await C.disable();
    eq(listeners.filter(([t]) => t === 'pagehide').length, 0);
  });
});

describe('LearnCollector — silent and total degradation', () => {
  test('a throwing storage layer resolves to 0 and never rejects', async () => {
    const { C, chrome, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    chrome.storage.local.get = () => { throw new Error('quota'); };
    eq(await C.flush(), 0, 'a failed capture is indistinguishable from no capture');
  });

  test('with no IntersectionObserver at all, observe() is a no-op and nothing throws', async () => {
    const model = loadModule('learn-model.js', { window: {} }).LearnModel;
    const store = {};
    const ctx = loadModule('learn-collector.js', {
      window: { addEventListener() {}, removeEventListener() {} },
      chrome: makeChrome({ store }),
      LearnModel: model,
      document: { title: 'T' },
      location: { href: 'https://example.com/' },
      Math,
      // IntersectionObserver deliberately absent — the Safari-shaped worst case.
    });
    const C = ctx.LearnCollector;
    C.enable({ now: () => 0 });
    C.observe(el(), LATIN, '译文');
    eq(await C.flush(), 0);
    eq(Object.keys(store).length, 0);
    await C.disable();
  });

  test('dropped captures are COUNTED, not just discarded', async () => {
    // Law 2 was amended 2026-08-04: dropping is still a normal path, but it may not
    // be an invisible one. Without this counter the user has no way to ever learn
    // that collection silently stopped keeping up.
    const store = {};
    const model = loadModule('learn-model.js', { window: {} }).LearnModel;
    const index = [];
    for (let i = 0; i < model.MAX_OUTBOX_SESSIONS; i++) {
      const k = 'lq:old' + i;
      index.push({ k, ts: i, n: 3 });          // 3 captures per dropped session
      store[k] = { items: [] };
    }
    store['lq:index'] = index;

    const { C, observers } = setup({ store });
    const clock = { t: 0 };
    C.enable({ now: () => clock.t });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    ok(await C.flush() > 0);

    const rec = store[model.OUTBOX_DROPPED];
    ok(rec, 'a dropped session must leave a record behind');
    eq(rec.n, 3, 'the count is of ITEMS lost, not sessions — that is what the user lost');
    ok(rec.at > 0);
  });

  test('nothing is recorded as dropped when nothing was dropped', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    await C.flush();
    const model = loadModule('learn-model.js', { window: {} }).LearnModel;
    eq(model.OUTBOX_DROPPED in store, false, 'a false alarm is as bad as a missed one');
  });

  test('the outbox is bounded: old sessions are dropped, which is a NORMAL path', async () => {
    const store = {};
    // Seed an index already at the cap, with keys present.
    const model = loadModule('learn-model.js', { window: {} }).LearnModel;
    const index = [];
    for (let i = 0; i < model.MAX_OUTBOX_SESSIONS; i++) {
      const k = 'lq:old' + i;
      index.push({ k, ts: i, n: 1 });
      store[k] = { items: [] };
    }
    store['lq:index'] = index;

    const { C, observers } = setup({ store });
    const clock = { t: 0 };
    C.enable({ now: () => clock.t });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    ok(await C.flush() > 0);

    eq(store['lq:index'].length, model.MAX_OUTBOX_SESSIONS, 'index stays at the cap');
    eq('lq:old0' in store, false, 'the oldest session blob is actually removed, not just unindexed');
    await tick(0);
  });
});

// ─── §4.1 — the learning-language whitelist gates the flush ──────────────────
// The gate is LearnRules.langAllowed, injected-adjacent: the collector references
// the sibling pure module directly (like LearnModel) and fails OPEN when it is
// absent — the documented failure direction (over-capture is recoverable).

describe('LearnCollector — learning-language whitelist (§4.1)', () => {
  const REGISTRY = [{ code: 'ja', scripts: ['Han', 'Kana'] }, { code: 'en', scripts: ['Latin'] }];

  function setupWithRules(rules) {
    const s = setup();
    const rulesCtx = loadModule('learn-rules.js', { window: {}, URL });
    // Re-load the collector with LearnRules present in its sandbox.
    const model = loadModule('learn-model.js', { window: {} }).LearnModel;
    const ctx = loadModule('learn-collector.js', {
      window: { addEventListener: () => {}, removeEventListener: () => {} },
      chrome: s.chrome, LearnModel: model, LearnRules: rulesCtx.LearnRules,
      IntersectionObserver: class {
        constructor(cb) { this.cb = cb; s.observers.push(this); }
        observe() {} unobserve() {} disconnect() {}
        fire(entries) { this.cb(entries); }
      },
      document: { title: 'A Page' }, location: { href: 'https://example.com/post' },
      Math, setInterval: () => 0, clearInterval: () => {},
    });
    return { C: ctx.LearnCollector, store: s.store, observers: s.observers };
  }

  test('a read sentence in a non-whitelisted language is NOT captured', async () => {
    const { C, store, observers } = setupWithRules();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN',
      rules: { v: 1, block: [], langs: ['ja'], updatedAt: 1 }, langRegistry: REGISTRY });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');    // Latin text, whitelist = [ja]
    dwell(C, observers, node, 4000, clock);
    eq(await C.flush(), 0, '白名单外的语言不得入库');
    eq(outboxKeys(store).length, 0);
  });

  test('the same sentence IS captured when its script matches the whitelist', async () => {
    const { C, store, observers } = setupWithRules();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN',
      rules: { v: 1, block: [], langs: ['en'], updatedAt: 1 }, langRegistry: REGISTRY });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    eq(await C.flush(), 1, 'und + Latin vs [en] 按文字系统放行（Safari 兜底）');
    eq(capturedItems(store).length, 1);
  });

  test('a STARRED sentence bypasses the whitelist — the gesture outranks the filter', async () => {
    const { C, store, observers } = setupWithRules();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN',
      rules: { v: 1, block: [], langs: ['ja'], updatedAt: 1 }, langRegistry: REGISTRY });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    const io = observers[observers.length - 1];
    clock.t = 1000; io.fire([{ target: node, isIntersecting: true }]);
    ok(C.star(node), '长按收藏本身必须成功');
    eq(capturedItems(store).length, 1, '显式手势优先于白名单');
  });

  test('with no LearnRules in the host at all, capture proceeds (fail-open)', async () => {
    const { C, store, observers } = setup();     // plain setup: no LearnRules global
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN',
      rules: { v: 1, block: [], langs: ['ja'], updatedAt: 1 } });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    eq(await C.flush(), 1);
    eq(capturedItems(store).length, 1);
  });
});

describe('LearnCollector — disable({discard}) drops the backlog (本站不收录)', () => {
  test('a just-blocked page must not flush its drafts on the way out', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN' });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);      // fully read — WOULD be captured
    await C.disable({ discard: true });
    eq(Object.keys(store).length, 0, '用户刚说「别在这个网站采集」，积压不许溜进 outbox');
    eq(C.isOn, false);
  });

  test('plain disable() still flushes — the default farewell is unchanged', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN' });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    await C.disable();
    eq(capturedItems(store).length, 1);
  });
});

// ─── The detector's answer shape, and the race with it ───────────────────────
// LangDetect returns {lang, percentage, isReliable}. The collector read
// `r.language` for months — so EVERY item stored 'und', on Chrome too, and the
// whitelist silently ran on script inference in a browser that detects fine.
// Found on a real Chrome (2026-08-09). These pin the field AND the flush-time
// re-resolution that covers the detector's async first answer.

describe('LearnCollector — detector field + in-flight race (真机回归)', () => {
  test('a detector answer {lang:"en"} lands on the item as "en", not "und"', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    C.enable({ now: () => clock.t, targetLang: 'zh-CN',
      detect: () => ({ lang: 'en', percentage: 100, isReliable: true }) });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    eq(await C.flush(), 1);
    eq(capturedItems(store)[0].lang, 'en', 'r.lang 才是检测器的字段 —— 读错就全库 und');
  });

  test('an IN-FLIGHT first answer (undefined) is re-resolved at flush time', async () => {
    // Call #1 returns undefined (detection kicked off), later calls return the
    // answer — exactly LangDetect's contract. The draft keys itself under 'und'
    // at harvest; flush must upgrade it instead of freezing the race forever.
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    let calls = 0;
    C.enable({ now: () => clock.t, targetLang: 'zh-CN',
      detect: () => (++calls === 1 ? undefined : { lang: 'en', percentage: 100, isReliable: true }) });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    eq(await C.flush(), 1);
    eq(capturedItems(store)[0].lang, 'en', '迟到的检测答案要在 flush 时补上');
  });

  test('an und-draft and its later en-twin collapse onto ONE item (higher dwell wins)', async () => {
    const { C, store, observers } = setup();
    const clock = { t: 0 };
    let calls = 0;
    // First TWO calls in flight (draft created as 'und' by an early flush), then answers.
    C.enable({ now: () => clock.t, targetLang: 'zh-CN',
      detect: () => (++calls <= 2 ? undefined : { lang: 'en', percentage: 100, isReliable: true }) });
    const node = el();
    C.observe(node, LATIN, '一段足够长的中文译文。');
    dwell(C, observers, node, 4000, clock);
    await C.flush();                      // draft harvested as 'und' (detector still silent)
    const io = observers[observers.length - 1];
    clock.t = 10000; io.fire([{ target: node, isIntersecting: true }]);
    clock.t = 16000; io.fire([{ target: node, isIntersecting: false }]);
    eq(await C.flush(), 1, '两个化身必须坍缩成一条');
    const items = capturedItems(store);
    eq(items.length, 1);
    eq(items[0].lang, 'en');
  });
});
