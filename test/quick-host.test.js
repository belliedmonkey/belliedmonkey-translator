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
