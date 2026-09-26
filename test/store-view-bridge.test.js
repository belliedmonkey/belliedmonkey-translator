// test/store-view-bridge.test.js — view-store 与 native-bridge 的单元回归（PR2）。
//
// view-store：「两个首页同时可见」bug 的结构性终点 —— 视图是单值 + 回退栈；
// back() 空栈必须返回 false 而不是把用户晾在空白页。
// native-bridge：Swift 从原生侧调进页面的四个 window 函数名是 ABI（PROTOCOL 表
// 对照测试盯着 Swift 那半边）；冷启动时结果可能先到，三处 pending 暂存必须被
// install 回放后清空。
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');

describe('view-store', () => {
  function bootView() {
    const ctx = loadSrc('src/store/view-store.js', 'ViewStore', {});
    return ctx.ViewStore;
  }

  test('boot 设初始视图；重复 boot 拒绝', () => {
    const V = bootView();
    V.boot('home');
    eq(V.getSnapshot().current, 'home');
    eq(V.getSnapshot().depth, 0);
    ok(V.getSnapshot() === Object.freeze(V.getSnapshot()) || Object.isFrozen(V.getSnapshot()), '快照冻结');
    ok(/called twice/.test((() => { try { V.boot('other'); return 'no throw'; } catch (e) { return e.message; } })()), '第二次 boot 必须 throw');
  });

  test('navigate 压栈、同视图 no-op、back 弹栈', () => {
    const V = bootView();
    V.boot('home');
    const seen = [];
    const off = V.subscribe((cur) => seen.push(cur));
    eq(V.navigate('home'), false, '同视图 no-op');
    eq(V.navigate('settings'), true);
    eq(V.getSnapshot().depth, 1);
    eq(V.back(), true);
    eq(V.getSnapshot().current, 'home');
    eq(V.back(), false, '空栈 back 返回 false 且不动');
    eq(V.getSnapshot().current, 'home');
    off();
    eq(V.navigate('x'), true);
    deepEq(seen, ['settings', 'home'], '退订后不再通知');
  });

  test('replace：不加深回退栈（同视图重渲染语义）', () => {
    const V = bootView();
    V.boot('a');
    V.navigate('b');
    V.navigate('c', { replace: true });
    eq(V.getSnapshot().current, 'c');
    eq(V.back(), true);
    eq(V.getSnapshot().current, 'b', 'replace 只换栈顶 —— 回退落回 b，不是 a');
    // 空栈上的 replace 仍可回退到 boot 的初始视图
    const V2 = bootView();
    V2.boot('home');
    V2.navigate('transient', { replace: true });
    eq(V2.back(), true);
    eq(V2.getSnapshot().current, 'home');
  });

  test('订阅者抛错不影响状态与后续订阅者', () => {
    const V = bootView();
    V.boot('home');
    let n = 0;
    V.subscribe(() => { throw new Error('bad'); });
    V.subscribe(() => n++);
    V.navigate('settings');
    eq(n, 1);
    eq(V.getSnapshot().current, 'settings');
  });
});

describe('native-bridge', () => {
  // fake window：普通对象即可 —— 模块里 g() 在 window 存在时用它。
  // console 换成静音版：异常隔离用例故意让 handler 抛错。
  function bootBridge(pending = {}) {
    const w = Object.assign({}, pending);
    const ctx = loadSrc('src/lib/native-bridge.js', 'NativeBridge', {
      window: w,
      console: { error() {}, log() {} },
    });
    return { NB: ctx.NativeBridge, w };
  }

  test('install 挂齐全部四个 ABI 名，带幂等标记', () => {
    const { NB, w } = bootBridge();
    deepEq(NB.abiNames(), ['show', '__mtAppleResult', '__mtWebAuthResult', '__mtDeepLink']);
    NB.installBridgeGlobals();
    for (const name of NB.abiNames()) {
      eq(typeof w[name], 'function', name + ' 必须是普通函数（Swift 直接调用）');
      eq(w[name].__mtBridge, true);
    }
  });

  test('install 幂等：第二次调用不换函数', () => {
    const { NB, w } = bootBridge();
    NB.installBridgeGlobals();
    const before = w.show;
    NB.installBridgeGlobals();
    eq(w.show, before, '换函数 = 旧订阅全丢');
  });

  test('冷启动 pending 回放：先到的事件送达订阅者，槽位清空', () => {
    // Swift 的暂存顺序：open-url-bridge 存 __mtDeepLinkPending；app.js 挂载后
    // 回放 __mtApplePending / __mtWebAuthPending。install 按 ABI 表顺序回放。
    const { NB, w } = bootBridge({ __mtApplePending: { ok: false }, __mtDeepLinkPending: 'mt://x?y=1' });
    const seen = [];
    NB.onNative('apple-result', (r) => seen.push(['apple', r]));
    NB.onNative('deeplink', (raw) => seen.push(['deep', raw]));
    NB.installBridgeGlobals();
    deepEq(seen, [['apple', { ok: false }], ['deep', 'mt://x?y=1']]);
    eq(w.__mtApplePending, null, '回放后清空，不得二次送达');
    eq(w.__mtDeepLinkPending, null);
    // 之后的 window 调用照常分发
    w.__mtDeepLink('mt://second');
    deepEq(seen[2], ['deep', 'mt://second']);
  });

  test('没有 pending 时 install 照常挂载，不炸', () => {
    const { NB, w } = bootBridge();
    NB.installBridgeGlobals();
    let n = 0;
    NB.onNative('show', () => n++);
    w.show('ios', true, false);
    eq(n, 1);
  });

  test('onNative 退订后不再收到；非函数入参给回安全 no-op', () => {
    const { NB, w } = bootBridge();
    NB.installBridgeGlobals();
    const seen = [];
    const off = NB.onNative('deeplink', (raw) => seen.push(raw));
    off();
    const offJunk = NB.onNative('deeplink', 'not a function');
    eq(typeof offJunk, 'function');
    offJunk();
    w.__mtDeepLink('mt://after');
    deepEq(seen, []);
  });

  test('异常隔离：第一个 handler 抛错，其余照常送达', () => {
    const { NB, w } = bootBridge();
    NB.installBridgeGlobals();
    NB.onNative('webauth-result', () => { throw new Error('boom'); });
    let second = 0;
    NB.onNative('webauth-result', () => second++);
    w.__mtWebAuthResult({ ok: true });
    eq(second, 1, '一个视图的 handler 崩了不能吞掉别的视图的结果');
  });
});
