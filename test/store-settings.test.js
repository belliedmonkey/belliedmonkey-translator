// test/store-settings.test.js — settings-store 的单元回归（React 迁移 PR2）。
//
// 这个 store 是三条纪律的落点，每条背后都有一次真实事故：
//   读失败 ≠ 空配置   —— page-settings 的 {ok:false} 语义（2026-08-05，供应商和 key
//                        被静默盖回免费通道）；
//   写入方也订阅       —— chrome-shim 总线（2026-09-06，「配置了 TTS 回来，播客入口
//                        还是不见」）；
//   回声去重           —— 我们自己写的值会从 onChanged 绕回来，不去重就自激。
// 走 loadSrc：esbuild 把 schema+registry 一起打进来，vm 里跑的字节就是把要进页面的
// 那份。PageSettings 与 chrome.storage.onChanged 都是 fake —— 何时派发回声、回声带
// 什么值，正是这些用例的自变量。
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');

// bootStore: fresh store module per call (loadSrc gives each call its own vm
// context, so the singleton state never leaks between cases).
//   initial   —— PageSettings 假存储里已有的键
//   readFail  —— 非 null 则 read() 返回 {ok:false, error:readFail}
//   write     —— 覆盖默认的 write 实现（测「写失败」与「写挂在半路」）
function bootStore({ initial = {}, readFail = null, write } = {}) {
  const store = Object.assign({}, initial);
  const listeners = [];
  const ps = {
    read: async (keys) => readFail
      ? { ok: false, error: readFail }
      : { ok: true, data: Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])) },
    write: write || (async (patch) => { Object.assign(store, patch); return { ok: true }; }),
  };
  const ctx = loadSrc('src/store/settings-store.js', 'SettingsStore', {
    PageSettings: ps,
    chrome: { storage: { onChanged: { addListener: (fn) => listeners.push(fn) } } },
  });
  return {
    S: ctx.SettingsStore,
    store,
    // 手动派发一次 storage.onChanged（真宿主里这是异步的，这里由测试掌握时机）
    emit: (changes, area) => { for (const fn of listeners) fn(changes, area || 'local'); },
  };
}

describe('settings-store: init', () => {
  test('读到的键生效，没读到的键回落 schema 默认', async () => {
    const { S } = bootStore({ initial: { provider: 'deepseek', targetLang: 'en' } });
    await S.init(['provider', 'targetLang']);
    eq(S.get('provider'), 'deepseek');
    eq(S.get('targetLang'), 'en');
    eq(S.get('uiLang'), 'auto');            // 不在存储 → schema 默认
    eq(S.get('learnDailyNew'), 15);
    eq(S.isReady(), true);
    eq(S.getSnapshot().status, 'ok');
    eq(S.getSnapshot().error, null);
  });

  test('读失败透传：status=error、error 原文保留，绝不画成空配置', async () => {
    const { S } = bootStore({ readFail: 'db locked' });
    const r = await S.init();
    eq(r.ok, false);
    eq(r.error, 'db locked');
    eq(S.getSnapshot().status, 'error');
    eq(S.getSnapshot().error, 'db locked');
    // get 仍回落默认（初始帧有东西可画），但 status 让 UI 知道这不是「没配置」
    eq(S.get('provider'), 'google');
  });

  test('PageSettings 缺席 = 读失败，不是静默默认', async () => {
    const ctx = loadSrc('src/store/settings-store.js', 'SettingsStore', {
      chrome: { storage: { onChanged: { addListener: () => {} } } },
    });
    const r = await ctx.SettingsStore.init();
    ok(!r.ok);
    ok(/PageSettings is not loaded/.test(r.error), '错误信息要能让人定位到 page-settings.js 缺失');
    eq(ctx.SettingsStore.getSnapshot().status, 'error');
  });

  test('init(keys) 缩窄读取：清单外的键不进来，回落默认', async () => {
    const { S } = bootStore({ initial: { provider: 'openai', apiKey: 'sk-x' } });
    await S.init(['provider']);
    eq(S.get('provider'), 'openai');
    eq(S.get('apiKey'), '');                // 存储里有，但这次没读 → 默认
  });
});

describe('settings-store: 乐观写入与回声去重', () => {
  test('set 同步生效并通知，之后真的写进 PageSettings', async () => {
    const { S, store } = bootStore({ initial: { targetLang: 'zh-CN' } });
    await S.init();
    let notices = 0; let last = null;
    S.subscribe((c) => { notices++; last = c; });
    const p = S.set('targetLang', 'en');
    eq(notices, 1, '写完成前订阅者就应被通知（乐观）');
    deepEq(last, { targetLang: { old: 'zh-CN', new: 'en' } });
    eq(S.get('targetLang'), 'en');
    const r = await p;
    ok(r.ok);
    eq(store.targetLang, 'en');
  });

  test('自己的回声被吞：写完后 onChanged 回来同值，不再通知', async () => {
    const { S, emit } = bootStore({ initial: { provider: 'google' } });
    await S.init();
    let notices = 0; S.subscribe(() => notices++);
    await S.set('provider', 'openai');
    eq(notices, 1);
    emit({ provider: { oldValue: 'google', newValue: 'openai' } });
    eq(notices, 1, '回声必须被吞，否则每次写入自激一轮');
    // 之后的真外部写入照常放行
    emit({ provider: { oldValue: 'openai', newValue: 'deepseek' } });
    eq(notices, 2);
    eq(S.get('provider'), 'deepseek');
  });

  test('对象值靠 JSON 比对去重：chrome 回来的新引用也算回声', async () => {
    const { S, emit } = bootStore({});
    await S.init();
    let notices = 0; S.subscribe(() => notices++);
    await S.set('learnRules', { 'example.com': { mode: 'off' } });
    eq(notices, 1);
    // 真实 chrome.storage 回传的是反序列化的新对象，=== 必然不等
    emit({ learnRules: { oldValue: null, newValue: { 'example.com': { mode: 'off' } } } });
    eq(notices, 1);
  });

  test('过时回声按外部写入处理：迟到的旧值照样放行', async () => {
    const { S, emit } = bootStore({ initial: { fontSize: '1.0' } });
    await S.init();
    await S.set('fontSize', '1.1');
    await S.set('fontSize', '1.2');
    // 第一次写的回声迟到了（pending 里已是第二次的值）
    emit({ fontSize: { oldValue: '1.0', newValue: '1.1' } });
    eq(S.get('fontSize'), '1.1', '存储的现状说了算，不替它「纠正」');
  });

  test('未知键拒绝：不写、不通知', async () => {
    const { S, store } = bootStore({});
    await S.init();
    let notices = 0; S.subscribe(() => notices++);
    const r = await S.set('madeUpKey', 1);
    deepEq(r, { ok: false, error: 'unknown settings key: madeUpKey' });
    eq(notices, 0);
    deepEq(store, {});
  });
});

describe('settings-store: 写失败回滚', () => {
  test('键原本在存储里：恢复旧值', async () => {
    const { S, store } = bootStore({ initial: { provider: 'google' }, write: async () => ({ ok: false, error: 'quota' }) });
    await S.init();
    let notices = 0; S.subscribe(() => notices++);
    const r = await S.set('provider', 'openai');
    ok(!r.ok);
    eq(r.error, 'quota');
    eq(S.get('provider'), 'google', '写失败必须回滚');
    eq(store.provider, 'google', '存储根本没被碰到');
    eq(notices, 2, '乐观一次 + 回滚一次');
  });

  test('键原本不在存储里：删键，不留「恰好等于默认值」的假键', async () => {
    const { S } = bootStore({ write: async () => ({ ok: false, error: 'boom' }) });
    await S.init();
    const r = await S.set('fontSize', '1.4');
    ok(!r.ok);
    eq(S.get('fontSize'), '1.0');
    eq('fontSize' in S.getSnapshot().values, false,
      '回滚要恢复「没有这个键」，不是「存了默认值」——两种形状在外部看来必须一样');
  });

  test('写挂在半路时外部写入先到：外部值赢，不回滚', async () => {
    let release;
    const { S, emit } = bootStore({
      write: () => new Promise((res) => { release = () => res({ ok: false, error: 'late' }); }),
    });
    await S.init();
    const p = S.set('provider', 'openai');
    emit({ provider: { oldValue: 'google', newValue: 'deepseek' } });   // 外部写入插队
    eq(S.get('provider'), 'deepseek', '外部值已生效，pending 让位');
    release();
    const r = await p;
    ok(!r.ok);
    eq(S.get('provider'), 'deepseek', '失败回滚不得覆盖插队的外部写入');
  });
});

describe('settings-store: 总线订阅纪律', () => {
  test('只认 local 区、只认 schema 键；subscribeKey 精准通知', async () => {
    const { S, emit } = bootStore({});
    await S.init();
    let any = 0; S.subscribe(() => any++);
    let key = 0; S.subscribeKey('uiLang', (v) => { key++; eq(v, 'en'); });
    emit({ whatever: { newValue: 1 } }, 'sync');              // 区不对 → 忽略
    emit(null);                                                // 无 changes → 忽略
    emit({ 'tr:google:en:hi': { newValue: {} } });             // 翻译缓存键 → 忽略
    emit({ uiLang: { newValue: 'en' }, grantTail: { newValue: 'abcd1234' } });
    eq(any, 1, '一次 emit 两条本库键只发一次通知');
    eq(key, 1);
    eq(S.get('uiLang'), 'en');
  });

  test('删键（newValue undefined）回落 schema 默认', async () => {
    const { S, emit } = bootStore({ initial: { uiLang: 'en' } });
    await S.init();
    eq(S.get('uiLang'), 'en');
    emit({ uiLang: { oldValue: 'en', newValue: undefined } });
    eq(S.get('uiLang'), 'auto');
    eq('uiLang' in S.getSnapshot().values, false);
  });

  test('订阅退订后不再收到通知；订阅者抛错不炸总线', async () => {
    const { S, emit } = bootStore({});
    await S.init();
    let n1 = 0;
    const off = S.subscribe(() => n1++);
    S.subscribe(() => { throw new Error('bad subscriber'); });
    off();
    emit({ uiLang: { newValue: 'ja' } });
    eq(n1, 0, '已退订');
    eq(S.get('uiLang'), 'ja', '别的订阅者抛错不影响状态本身');
  });
});
