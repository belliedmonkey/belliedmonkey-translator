// test/quick-host.test.js — 快速翻译在 App 主页面这一侧的接线（docs/learning-design.md §9.9）。
const path = require('path');
const { describe, test, eq, ok, deepEq } = require('./harness');

function load(store) {
  const posted = []; const st = Object.assign({}, store || {}); const listeners = [];
  const sandbox = {
    webkit: { messageHandlers: { mtQuick: { postMessage: (m) => posted.push(m) } } },
    chrome: { storage: { local: {
      get: (keys, cb) => setTimeout(() => cb(Object.fromEntries(keys.filter((k) => k in st).map((k) => [k, st[k]]))), 0),
      set: (o, cb) => { Object.assign(st, o); setTimeout(() => { for (const fn of listeners) fn(Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }]))); cb && cb(); }, 0); },
    }, onChanged: { addListener: (fn) => listeners.push(fn) } } },
  };
  const saved = {}; for (const k of Object.keys(sandbox)) { saved[k] = global[k]; global[k] = sandbox[k]; }
  delete require.cache[require.resolve(path.join(__dirname, '..', 'app', 'quick-host.js'))];
  const H = require(path.join(__dirname, '..', 'app', 'quick-host.js'));
  const restore = () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete global[k]; else global[k] = saved[k]; } };
  return { H, posted, st, restore };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));

describe('AppQuickHost — 能力靠探测，配置靠推', () => {
  test('start 只发一条 quick-probe；原生不回就什么都不做（iOS / 老原生壳）', async () => {
    const { H, posted, restore } = load();
    H.start({}); await tick();
    deepEq(posted.map((m) => m.type), ['quick-probe']); eq(H.caps(), null);
    restore();
  });
  test('收到 quick-caps ⇒ 推一份配置：常驻默认开、没看过提示、三条菜单文案都在', async () => {
    const { H, posted, restore } = load();
    H.start({}); H._fromNative({ type: 'quick-caps', resident: true }); await tick();
    const cfg = posted.find((m) => m.type === 'quick-config');
    ok(!!cfg, '没有发 quick-config'); eq(cfg.enabled, true); eq(cfg.seen, false);
    for (const k of ['open', 'settings', 'quit']) ok(typeof cfg.labels[k] === 'string' && cfg.labels[k].length > 0, '缺菜单文案 ' + k);
    restore();
  });
  test('用户关过常驻 ⇒ enabled:false；不往存储里播种默认值', async () => {
    const { H, posted, st, restore } = load({ quickEnabled: false });
    H.start({}); H._fromNative({ type: 'quick-caps', resident: true }); await tick();
    eq(posted.find((m) => m.type === 'quick-config').enabled, false);
    ok(!('quickResidentSeen' in st), '还没发生第一次关窗，不该写这个键');
    restore();
  });
  test('第一次关窗：先问，答「知道了」⇒ 记下已看过 → 推配置 → 才让原生收起窗口', async () => {
    const { H, posted, st, restore } = load();
    let asked = ''; H.start({ confirm: async (m) => { asked = m; return true; } });
    H._fromNative({ type: 'quick-caps', resident: true }); await tick();
    H._fromNative({ type: 'quick-first-close' }); await tick(40);
    ok(/菜单栏/.test(asked), '提示里没有说「还在菜单栏」：' + asked);
    eq(st.quickResidentSeen, true);
    const types = posted.map((m) => m.type);
    ok(types.lastIndexOf('quick-close-main') > types.lastIndexOf('quick-config') - 1 && types.includes('quick-close-main'), types.join(','));
    eq(posted.filter((m) => m.type === 'quick-config').pop().seen, true);
    restore();
  });
  test('答「不想常驻」⇒ 不替用户关，带到设置里那个开关面前；窗口不收', async () => {
    const { H, posted, st, restore } = load();
    let went = ''; H.start({ confirm: async () => false, openSettings: (id) => { went = id; } });
    H._fromNative({ type: 'quick-caps', resident: true }); await tick();
    H._fromNative({ type: 'quick-first-close' }); await tick(40);
    eq(went, 'g-quick'); ok(!posted.some((m) => m.type === 'quick-close-main'), '不该收起窗口');
    eq(st.quickEnabled, undefined, '不替用户改开关'); eq(st.quickResidentSeen, true);
    restore();
  });
  test('菜单里点「快速翻译设置…」⇒ 打开设置并落到那一块', async () => {
    const { H, restore } = load();
    let went = ''; H.start({ openSettings: (id) => { went = id; } });
    H._fromNative({ type: 'quick-open-settings' }); eq(went, 'g-quick');
    restore();
  });
});

// ── 增强取词（M-5）──────────────────────────────────────────────────────────────
// 平台现实：系统权限弹窗不回调允许 / 拒绝，授权后正在运行的进程也读不到新权限。所以「想开」与「真的开了」是两件事，
// 分晓在下一次启动。这里会静默出错的：开关显示为开而权限其实没有（用户以为能用）；拒绝之后意图一直挂着，每次启动都去问。
describe('AppQuickHost — 增强取词：意图、权限、对账', () => {
  const caps = (postEvent) => ({ type: 'quick-caps', resident: true, panel: true, postEvent });
  test('老原生壳不报 postEvent ⇒ 不支持（设置里那一行整个不出现）', async () => {
    const { H, restore } = load();
    H.start({}); await H._fromNative({ type: 'quick-caps', resident: true }); await tick();
    eq(H.supportsEnhanced(), false); restore();
  });
  test('没权限时打开：先出我们自己的说明；点「先不开」⇒ 什么都不发、什么都不存', async () => {
    const { H, posted, st, restore } = load();
    let asked = null;
    H.start({ confirm: async (m, o) => { asked = { m, o }; return false; } }); await H._fromNative(caps(false)); await tick();
    eq(await H.setEnhanced(true), false);
    ok(/会做/.test(asked.m) && /不会做/.test(asked.m) && /⌘C/.test(asked.m), '说明里该有「会做 / 不会做」');
    eq(asked.o.ok, '继续'); eq(asked.o.cancel, '先不开');
    ok(!posted.some((m) => m.type === 'quick-request-perm'), '用户没点继续就去问系统了');
    ok(!('quickEnhanced' in st)); restore();
  });
  test('点「继续」⇒ 记下意图 + pending、调系统的请求接口；**开关仍显示为关**（还没生效）；配置里 enhanced:true', async () => {
    const { H, posted, st, restore } = load();
    H.start({ confirm: async () => true }); await H._fromNative(caps(false)); await tick();
    eq(await H.setEnhanced(true), false, '还没生效就不能显示为开');
    await tick();
    eq(st.quickEnhanced, true); eq(st.quickEnhancedNote, 'pending');
    deepEq(posted.filter((m) => m.type === 'quick-request-perm'), [{ type: 'quick-request-perm', which: 'postEvent' }]);
    eq(posted.filter((m) => m.type === 'quick-config').pop().enhanced, true, '原生要知道用户想开：权限一到、重开之后就直接生效');
    restore();
  });
  test('重开后权限在 ⇒ 开关是开的、说明清掉', async () => {
    const { H, st, restore } = load({ quickEnhanced: true, quickEnhancedNote: 'pending' });
    H.start({}); await H._fromNative(caps(true)); await tick();
    eq(st.quickEnhanced, true); eq(st.quickEnhancedNote, ''); eq(H.hasPostEvent(), true); restore();
  });
  test('重开后权限仍不在（用户拒绝了）⇒ 意图弹回关 + denied；不给面板留「权限被关掉了」那句（他是知情拒绝的）', async () => {
    const { H, posted, st, restore } = load({ quickEnhanced: true, quickEnhancedNote: 'pending' });
    H.start({}); await H._fromNative(caps(false)); await tick();
    eq(st.quickEnhanced, false); eq(st.quickEnhancedNote, 'denied'); eq(st.quickEnhancedLost, false);
    eq(posted.filter((m) => m.type === 'quick-config').pop().enhanced, false);
    ok(!posted.some((m) => m.type === 'quick-request-perm'), '启动时不该自己去问系统');
    restore();
  });
  test('用着用着被用户在系统设置里撤销 ⇒ 弹回关 + 给面板留一次性的那一句', async () => {
    const { H, st, restore } = load({ quickEnhanced: true, quickEnhancedNote: '' });
    H.start({}); await H._fromNative(caps(false)); await tick();
    eq(st.quickEnhanced, false); eq(st.quickEnhancedLost, true); restore();
  });
  test('已有权限时打开 ⇒ 不出说明、不问系统，直接开；关 ⇒ 意图与说明一起清', async () => {
    const { H, posted, st, restore } = load();
    let asked = false;
    H.start({ confirm: async () => { asked = true; return true; } }); await H._fromNative(caps(true)); await tick();
    eq(await H.setEnhanced(true), true); eq(asked, false); ok(!posted.some((m) => m.type === 'quick-request-perm'));
    eq(await H.setEnhanced(false), false); eq(st.quickEnhanced, false); eq(st.quickEnhancedNote, ''); restore();
  });
  test('「现在重开」「打开系统设置」各发一条，名字在协议表里', async () => {
    const { H, posted, restore } = load();
    H.start({}); H.relaunch(); H.openPrivacy();
    deepEq(posted.slice(-2), [{ type: 'quick-relaunch' }, { type: 'quick-open-privacy', which: 'postEvent' }]);
    for (const m of posted) ok(H.PROTOCOL.toNative.indexOf(m.type) >= 0, m.type); restore();
  });
});
