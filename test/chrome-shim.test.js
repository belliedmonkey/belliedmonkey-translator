// test/chrome-shim.test.js — App 宿主的 chrome.storage 垫片要发 onChanged。
//
// 2026-09-06 报障：App 里先没配语音 key，登录后到设置里配好、返回，播客入口与 ▶ 仍不出现，
// 要重启 App 才刷新。根因不是某一处漏了调用，而是垫片**根本没有 `storage.onChanged`** ——
// 于是 review.js / driving.js 在启动时读一次设置之后，再没有任何东西能告诉它们「变了」，
// App 侧只能靠每个设置控件手写「显式重绘」，而一键配置、朗读模式、自动播放三处都漏了。
//
// 这里钉死的是总线本身：每次 set / remove 之后异步派发 {key: {oldValue, newValue}} + 'local'，
// 值没变的键不发。消费者（review.js 的 reloadSettings、driving.js 的 refreshEntry）只订阅这一个来源。
const { loadModule, describe, test, ok, eq, deepEq, tick } = require('./harness');

function fakeLocalStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] || null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

function load() {
  const win = {};
  // console 打桩：「监听器抛错不拖累别人」那条用例会让垫片 console.error 一次，那是它该做的，
  // 但不该把「boom」印进 npm test 的输出里冒充失败。
  const ctx = loadModule('../app/chrome-shim.js', { window: win, localStorage: fakeLocalStorage(), console: { log() {}, warn() {}, error() {} } });
  return { chrome: ctx.window.chrome, ctx };
}

const set = (chrome, items) => new Promise((r) => chrome.storage.local.set(items, r));
const remove = (chrome, keys) => new Promise((r) => chrome.storage.local.remove(keys, r));
const get = (chrome, q) => new Promise((r) => chrome.storage.local.get(q, r));

describe('chrome-shim — storage.onChanged 是设置总线', () => {
  test('onChanged 存在，且 storage.local.onChanged 是同一个对象（真 API 两处都有）', () => {
    const { chrome } = load();
    ok(chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === 'function');
    eq(chrome.storage.local.onChanged, chrome.storage.onChanged);
  });

  test('set 之后异步派发 {oldValue,newValue} 与 area=local', async () => {
    const { chrome } = load();
    const seen = [];
    chrome.storage.onChanged.addListener((ch, area) => seen.push([ch, area]));
    await set(chrome, { ttsEngine: 'openai', ttsApiKey: 'k' });
    eq(seen.length, 0, '派发必须是异步的 —— 真 API 就是，同步派发会让写入方在自己的 set 里被重入');
    await tick(5);
    eq(seen.length, 1);
    deepEq(seen[0][0], { ttsEngine: { newValue: 'openai' }, ttsApiKey: { newValue: 'k' } });
    eq(seen[0][1], 'local');
    await set(chrome, { ttsEngine: 'browser' });
    await tick(5);
    deepEq(seen[1][0], { ttsEngine: { oldValue: 'openai', newValue: 'browser' } });
  });

  test('值没变的键不发；整批都没变就一次也不发', async () => {
    const { chrome } = load();
    await set(chrome, { a: 1, b: { x: [1, 2] } });
    await tick(5);
    const seen = [];
    chrome.storage.onChanged.addListener((ch) => seen.push(ch));
    await set(chrome, { a: 1, b: { x: [1, 2] } });
    await tick(5);
    eq(seen.length, 0);
    await set(chrome, { a: 1, b: { x: [1, 3] } });
    await tick(5);
    eq(seen.length, 1);
    deepEq(Object.keys(seen[0]), ['b']);
  });

  test('remove 派发只有 oldValue 的变更；不存在的键不发', async () => {
    const { chrome } = load();
    await set(chrome, { a: 1 });
    await tick(5);
    const seen = [];
    chrome.storage.onChanged.addListener((ch) => seen.push(ch));
    await remove(chrome, ['a', 'nope']);
    await tick(5);
    eq(seen.length, 1);
    deepEq(seen[0], { a: { oldValue: 1 } });
  });

  test('removeListener / hasListener 生效；一个监听器抛错不影响其它监听器', async () => {
    const { chrome } = load();
    const a = () => { throw new Error('boom'); };
    let hits = 0;
    const b = () => { hits++; };
    chrome.storage.onChanged.addListener(a);
    chrome.storage.onChanged.addListener(b);
    ok(chrome.storage.onChanged.hasListener(b));
    await set(chrome, { k: 1 });
    await tick(5);
    eq(hits, 1);
    chrome.storage.onChanged.removeListener(b);
    ok(!chrome.storage.onChanged.hasListener(b));
    await set(chrome, { k: 2 });
    await tick(5);
    eq(hits, 1);
  });

  test('get 行为不变：数组查询只回存在的键，对象查询补默认值', async () => {
    const { chrome } = load();
    await set(chrome, { a: 1 });
    deepEq(await get(chrome, ['a', 'b']), { a: 1 });
    deepEq(await get(chrome, { a: 0, b: 'd' }), { a: 1, b: 'd' });
  });
});
