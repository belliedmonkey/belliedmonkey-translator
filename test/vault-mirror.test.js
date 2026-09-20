// test/vault-mirror.test.js — 把引擎配置镜像给 iOS 系统翻译扩展（§9.9 / iOS 线 I-4）。
//
// 这一层经手的是**用户的 key**，所以门禁的重点不是「同步得成不成」，是几件
// 一旦做错就很难被发现的事：
//   · 过期的引擎 id 不许静默回落 —— 否则用户在弹层里用上一个他没选过的引擎
//   · 全量快照，不是增量 —— iOS 的 Keychain 卸载后还在，增量会留下孤儿 key
//   · 回执里永远没有 key 的值
//   · 没有那条通道的壳（macOS、老原生）整个不做，而不是「先存着」
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');

// 起一份 AppVault。`bridged` 决定这个壳有没有 mtVault 通道。
function load(opts) {
  const o = opts || {};
  const sent = [];
  const store = Object.assign({}, o.store || {});
  const listeners = [];
  const dual = (fn) => (arg, cb) => { const v = fn(arg); if (cb) { cb(v); return undefined; } return Promise.resolve(v); };
  const ctx = {
    console,
    MT_PROVIDERS: o.providers || [{ id: 'google', needsKey: false }, { id: 'deepseek', needsKey: true }],
    chrome: {
      storage: {
        local: {
          get: dual((keys) => {
            if (keys == null) return Object.assign({}, store);
            const list = Array.isArray(keys) ? keys : Object.keys(keys);
            const out = {};
            for (const k of list) if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
            return out;
          }),
          set: dual((obj) => {
            const ch = {};
            for (const k of Object.keys(obj || {})) { ch[k] = { newValue: obj[k] }; store[k] = obj[k]; }
            for (const fn of listeners) fn(ch);
            return undefined;
          }),
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    },
  };
  if (o.bridged !== false) {
    ctx.webkit = { messageHandlers: { mtVault: { postMessage: (m) => sent.push(m) } } };
  }
  // 收件箱那一半要的两样：AppHandoff（摄入）与 document（回前台再收一次）。
  const ingested = [];
  ctx.AppHandoff = o.handoff || {
    ingestLive: async (list) => {
      ingested.push(list);
      if (o.ingestThrows) throw new Error('boom');
      return o.ingestOut || { written: list.length, names: list.map((r) => r.name).filter(Boolean) };
    },
  };
  const visListeners = [];
  ctx.document = { hidden: false, addEventListener: (t, fn) => { if (t === 'visibilitychange') visListeners.push(fn); } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const rel of ['extension/content/engine-state.js', 'extension/learn/notes.js', 'app/vault-mirror.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  }
  const foreground = () => { ctx.document.hidden = false; for (const fn of visListeners) fn(); };
  return { ctx, sent, store, ingested, foreground, V: ctx.AppVault };
}

describe('vault-mirror: 把引擎配置镜像给系统翻译扩展（I-4）', () => {
  test('★ 没有 mtVault 的壳（macOS / 老原生）整个不做 —— 不是「先存着等以后」', async () => {
    const { V } = load({ bridged: false, store: { provider: 'deepseek', apiKey: 'sk-x' } });
    eq(V.available(), false);
    eq(await V.sync(), false, '没有通道时 sync 什么都不发');
    eq(V.start(), false, 'start 也不该挂监听');
    eq(V.clear(), false);
  });

  test('★ 过期的引擎 id 不许静默回落 —— 整份当作「没配」，key 也不带出去', () => {
    const { V } = load({});
    const bad = V.snapshot({ provider: 'engine_that_no_longer_exists', apiKey: 'sk-secret', apiBaseUrl: 'https://x/y' });
    eq(bad.nonSecret.provider, '', '认不出来的 id 不能原样镜像');
    eq(bad.nonSecret.baseUrl, '', '地址也不带 —— 否则扩展会拿它去打一个没有引擎的端点');
    eq(bad.secret.apiKey, '', 'key 更不能带');
    // 而认得出来的照常
    const good = V.snapshot({ provider: 'deepseek', apiKey: 'sk-secret' });
    eq(good.nonSecret.provider, 'deepseek');
    eq(good.secret.apiKey, 'sk-secret');
  });

  test('★ 镜像的是**解析后**的三元组（解析引擎优先），Swift 不重写这条规则', () => {
    const { V } = load({});
    const snap = V.snapshot({
      provider: 'deepseek', apiKey: 'sk-main', apiBaseUrl: 'https://main/', apiModel: 'm1',
      notesProvider: 'deepseek', notesApiKey: 'sk-notes', notesBaseUrl: 'https://notes/', notesModel: 'm2',
    });
    eq(snap.nonSecret.model, 'm2', '配了解析引擎就用它 —— 与设置页 / Mac 面板同一个 resolveConfig');
    eq(snap.secret.apiKey, 'sk-notes');
  });

  test('★ 全量快照：上一次有的键，这一次没配了，快照里必须是空字符串而不是缺席', async () => {
    const { V, sent, ctx } = load({ store: { provider: 'deepseek', apiKey: 'sk-x' } });
    await V.sync();
    eq(sent.length, 1);
    eq(sent[0].secret.apiKey, 'sk-x');
    // 用户把引擎清了
    await new Promise((r) => ctx.chrome.storage.local.set({ provider: '', apiKey: '' }, r));
    await V.sync();
    eq(sent.length, 2, '配置变了要重新镜像');
    eq(sent[1].secret.apiKey, '', '清掉之后快照里是空，原生据此删 Keychain 里那一项');
    eq('apiKey' in sent[1].secret, true, '**键要在**：缺席与空值在原生那边是两件事');
  });

  test('★ 没变就不发 —— 每一次 sync 都是一次 Keychain 写入', async () => {
    const { V, sent } = load({ store: { provider: 'deepseek', apiKey: 'sk-x' } });
    eq(await V.sync(), true);
    eq(await V.sync(), false, '第二次没变，不该再写');
    eq(sent.length, 1);
    eq(await V.sync({ force: true }), true, 'force 跳过去重');
    eq(sent.length, 2);
  });

  test('★ 清空之后下一次一定重发 —— 否则扩展那边会一直是空的', async () => {
    const { V, sent } = load({ store: { provider: 'deepseek', apiKey: 'sk-x' } });
    await V.sync();
    V.clear();
    eq(sent[sent.length - 1].type, 'vault-clear');
    eq(await V.sync(), true, '清空之后同样的配置也要重发（去重记忆已作废）');
  });

  test('★ 回执里永远没有 key 的值', () => {
    const { V } = load({});
    V.onNative({ type: 'vault-ack', keys: ['apiKey', 'provider'], status: 0, apiKey: 'sk-LEAK' });
    const a = V.ack();
    deepEq(a.keys, ['apiKey', 'provider']);   // 数组要用 deepEq —— harness 的 eq 是严格相等
    eq(a.status, 0);
    eq(Object.prototype.hasOwnProperty.call(a, 'apiKey'), false, '回执里带了值也不许存下来');
  });

  test('只在相关键变化时重新镜像，别的键变了不发', async () => {
    const { V, sent, ctx } = load({ store: { provider: 'deepseek', apiKey: 'sk-x' } });
    V.start();
    await new Promise((r) => setTimeout(r, 5));
    const n = sent.length;
    await new Promise((r) => ctx.chrome.storage.local.set({ someUnrelatedKey: 1 }, r));
    await new Promise((r) => setTimeout(r, 5));
    eq(sent.length, n, '无关的键变了不该写 Keychain');
    await new Promise((r) => ctx.chrome.storage.local.set({ targetLang: 'ja' }, r));
    await new Promise((r) => setTimeout(r, 5));
    ok(sent.length > n, '「译成」变了要重新镜像');
  });

  test('★ flavor 按注册表实际内容判定，不按名字', () => {
    const g = load({ providers: [{ id: 'google', needsKey: false }, { id: 'deepseek', needsKey: true }] });
    eq(g.V.snapshot({}).nonSecret.flavor, 'global', '注册表里有免费通道 = 国际版');
    const c = load({ providers: [{ id: 'deepseek', needsKey: true }, { id: 'glm', needsKey: true }] });
    eq(c.V.snapshot({}).nonSecret.flavor, 'china', '一个 needsKey:false 都没有 = 中国版');
  });

  test('快照里只有清单上那些键 —— 多镜像一个就是多一份没人读却会被备份走的数据', () => {
    const { V } = load({});
    const snap = V.snapshot({ provider: 'deepseek', apiKey: 'sk-x', learnAuth: { token: 'SECRET' }, someOther: 1 });
    const allowed = new Set(V.NON_SECRET.concat(['schema']));
    for (const k of Object.keys(snap.nonSecret)) ok(allowed.has(k), k + ' 不在 NON_SECRET 清单里');
    deepEq(Object.keys(snap.secret), ['apiKey'], 'secret 里只有 apiKey');
    eq(JSON.stringify(snap).includes('SECRET'), false, '登录令牌绝不进快照');
  });

  // ── 收件箱（§9.9 / iOS 线 I-6）─────────────────────────────────────────────
  // 这一段守的是**别把用户翻过的句子弄丢**，以及反过来**别在用户关了开关之后还留着积压**。

  test('★ 先写库后删文件：ack 只在 ingest 落定之后发，而且只 ack 它交回来的名字', async () => {
    const { V, sent, ingested } = load({});
    V.drain();
    eq(sent[sent.length - 1].type, 'inbox-drain');
    const recs = [{ name: 'a.json', record: { text: 'hi', tr: '你好' } },
      { name: 'b.json', record: { text: 'yo', tr: '哟' } }];
    await V.onNative({ type: 'inbox-batch', records: recs });
    deepEq(ingested[0], recs, '原样交给唯一写入者，不在这一层挑挑拣拣');
    const ack = sent[sent.length - 1];
    eq(ack.type, 'inbox-ack');
    deepEq(ack.names, ['a.json', 'b.json']);
  });

  test('★ 写库抛了就一个名字都不 ack —— 文件留着下次重来，比静默吞掉好', async () => {
    const { V, sent } = load({ ingestThrows: true });
    V.drain();
    const before = sent.length;
    await V.onNative({ type: 'inbox-batch', records: [{ name: 'a.json', record: {} }] });
    eq(sent.length, before, '不该发 ack');
  });

  test('★ 被门拦下的记录也要 ack —— 留着它们不会变得可写，只会成为看不见的积压', async () => {
    // ingest 的约定：names 里既有写进去的，也有被拦下的（handoff.js 的注释说的就是这条）
    const { V, sent } = load({ ingestOut: { written: 0, names: ['x.json'] } });
    await V.onNative({ type: 'inbox-batch', records: [{ name: 'x.json', record: {} }] });
    deepEq(sent[sent.length - 1], { type: 'inbox-ack', names: ['x.json'] });
  });

  test('空批次不发 ack，也不该抛 —— 「收件箱是空的」与「原生没回话」要分得开', async () => {
    const { V, sent } = load({});
    V.drain();
    const before = sent.length;
    const out = await V.onNative({ type: 'inbox-batch', records: [] });
    eq(out.written, 0);
    eq(sent.length, before);
  });

  test('★ 启动收一次，之后**每次回到前台**再收 —— 扩展是在 App 不在前台时写的', async () => {
    const { V, sent, foreground } = load({});
    V.start();
    await new Promise((r) => setTimeout(r, 5));
    eq(sent.filter((m) => m.type === 'inbox-drain').length, 1, '启动时收一次');
    // 上一轮要先落定，否则 drain 的并发闸会挡住（那正是它该干的）
    await V.onNative({ type: 'inbox-batch', records: [] });
    foreground();
    eq(sent.filter((m) => m.type === 'inbox-drain').length, 2, '回前台再收一次');
  });

  test('一轮还没落定时不重复发 drain —— 否则同一批会被摄入两次', async () => {
    const { V, sent } = load({});
    V.drain(); V.drain();
    eq(sent.filter((m) => m.type === 'inbox-drain').length, 1);
    await V.onNative({ type: 'inbox-batch', records: [] });
    V.drain();
    eq(sent.filter((m) => m.type === 'inbox-drain').length, 2, '落定之后可以再收');
  });

  test('没有那条通道的壳（macOS / 老原生）整个不收', () => {
    const { V } = load({ bridged: false });
    eq(V.drain(), false);
    eq(V.clearInbox(), false);
  });

  test('清收件箱是一条独立的消息 —— 清库时用得上', () => {
    const { V, sent } = load({});
    eq(V.clearInbox(), true);
    deepEq(sent[sent.length - 1], { type: 'inbox-clear' });
  });
});
