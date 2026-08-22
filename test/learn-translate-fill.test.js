// test/learn-translate-fill.test.js — §9.5 补译文.
//
// This module exists because 播客模式 needs something to read in the second pass for a
// card that was captured without a translation. Everything worth testing here is a
// BOUNDARY, not a computation:
//
//   1. **It never writes `items`.** `item.tr` records what the page actually showed;
//      a value written here could not sync anyway (`touchedAt` would not move), so
//      writing it would only fork the corpus silently. The reverse assertion at the
//      bottom is the contract, not a nicety.
//   2. **The user's key is charged at most once per card**, like §9.2 — cache-first,
//      in-flight de-duplicated, and a failed cache WRITE must not bait a second charge.
//   3. **No engine ⇒ no request.** The preload surface prices the batch before
//      spending; a module that quietly fires anyway would make that price a lie.

const { loadModule, describe, test, ok, eq } = require('./harness');

const CHAT = { id: 'chat_x', type: 'chat-compat', label: 'Chat X' };
const REASONER = { id: 'reason_x', type: 'chat-compat', label: 'Reasoner X' };
const NOT_CHAT = { id: 'g', type: 'translate-only', label: 'Free translate' };

function setup(opts = {}) {
  const calls = { translate: [], put: [], get: [] };
  const notes = new Map();

  const LearnStore = {
    getNote: (k) => { calls.get.push(k); return Promise.resolve(notes.get(k) || null); },
    putNote: (k, data, meta) => {
      calls.put.push({ k, data, meta });
      if (opts.putThrows) return Promise.reject(new Error('quota'));
      notes.set(k, Object.assign({ id: k, data }, meta));
      return Promise.resolve();
    },
    // Present so the reverse assertion below has something it COULD have called.
    mergeBatch: () => { throw new Error('translate-fill must never write items'); },
  };

  // The real LearnNotes, so `resolveConfig` cannot drift into a second copy here.
  const LearnNotes = loadModule('learn/notes.js', {
    window: { MT_PROVIDERS: [CHAT, REASONER, NOT_CHAT] },
    LearnStore, LearnModel: { normText: (x) => String(x || '').trim() },
    WireFormat: { resolveEndpoint: () => 'https://x/v1/chat/completions', formatFor: () => 'chat-compat', hostOf: () => 'x' },
    RequestShape: { build: () => ({ headers: {}, body: {} }), parse: () => '' },
    fetch: () => Promise.reject(new Error('notes must not be called by these tests')),
  }).LearnNotes;

  const TranslationAPI = {
    translate: (text, target, provider, key, baseUrl, model) => {
      calls.translate.push({ text, target, provider, key, baseUrl, model });
      if (opts.translateThrows) {
        const e = new Error('boom'); e.code = opts.translateThrows; return Promise.reject(e);
      }
      return Promise.resolve(opts.translateReturns === undefined ? '你好，世界' : opts.translateReturns);
    },
  };

  const ctx = loadModule('../app/translate-fill.js', {
    window: { MT_PROVIDERS: [CHAT, REASONER, NOT_CHAT] },
    LearnStore, LearnNotes, TranslationAPI,
  });
  return { F: ctx.LearnTranslateFill, calls, notes, LearnNotes };
}

const ITEM = { id: 'card1', text: 'Hello, world', lang: 'en', targetLang: 'zh-CN' };
const CFG = { provider: 'chat_x', apiKey: 'k', baseUrl: '', model: 'm' };

describe('LearnTranslateFill — 引擎与门控 (§9.5 / §9.2)', () => {
  test('resolveConfig 就是 §9.2 那一条规则，不是它的第二份拷贝', () => {
    const { F, LearnNotes } = setup();
    const s = { notesProvider: 'reason_x', notesApiKey: 'nk', notesBaseUrl: 'nb', notesModel: 'nm',
      provider: 'chat_x', apiKey: 'tk', apiBaseUrl: 'tb', apiModel: 'tm' };
    eq(JSON.stringify(F.resolveConfig(s)), JSON.stringify(LearnNotes.resolveConfig(s)));
    // 空 notesProvider ⇒ 整组跟随翻译引擎，与解析同一条路。
    eq(F.resolveConfig({ provider: 'chat_x', apiKey: 'tk' }).provider, 'chat_x');
  });

  test('门按 type + key，不按名字', () => {
    const { F } = setup();
    F.configure({ provider: '', apiKey: '' });
    eq(F.capable(), false, '什么都没配 ⇒ 门关着');
    F.configure({ provider: 'chat_x', apiKey: '' });
    eq(F.capable(), false, '有引擎没 key ⇒ 门关着');
    F.configure({ provider: 'g', apiKey: 'k' });
    eq(F.capable(), false, '非 chat 类引擎做不了这件事 —— 按 type 排除，不按名字');
    F.configure(CFG);
    eq(F.capable(), true);
  });

  test('门关着时 get() 具名失败，且一个请求都不发', async () => {
    // 预载会先算账再花钱；这里要是偷偷发请求，账单就是假的。
    const { F, calls } = setup();
    F.configure({ provider: '', apiKey: '' });
    let e = null;
    try { await F.get(ITEM, 'zh-CN'); } catch (err) { e = err; }
    eq(e && e.code, 'no_engine');
    eq(calls.translate.length, 0);
  });
});

describe('LearnTranslateFill — 每张卡至多收一次费 (§9.2 同一套契约)', () => {
  test('第一次调用翻译引擎并回写缓存，第二次零调用', async () => {
    const { F, calls } = setup();
    F.configure(CFG);
    const a = await F.get(ITEM, 'zh-CN');
    eq(a.tr, '你好，世界');
    eq(a.cached, false);
    eq(calls.translate.length, 1);

    const b = await F.get(ITEM, 'zh-CN');
    eq(b.tr, '你好，世界');
    eq(b.cached, true);
    eq(calls.translate.length, 1, '缓存命中必须一分钱都不花');
    eq(calls.put.length, 1, '也不能重写缓存');
  });

  test('并发的两次 get 只扣一次费', async () => {
    // 预载的算账/开跑两趟，与开卡预热可能同时问同一张卡。
    const { F, calls } = setup();
    F.configure(CFG);
    const [a, b] = await Promise.all([F.get(ITEM, 'zh-CN'), F.get(ITEM, 'zh-CN')]);
    eq(calls.translate.length, 1);
    eq(a.tr, b.tr);
  });

  test('缓存写失败之后仍然返回译文 —— 不得因此二次扣费', async () => {
    const { F, calls } = setup({ putThrows: true });
    F.configure(CFG);
    const r = await F.get(ITEM, 'zh-CN');
    eq(r.tr, '你好，世界');
    eq(calls.translate.length, 1);
  });

  test('空译文是错误而不是「成功地什么都没有」，且不进缓存', async () => {
    const { F, notes } = setup({ translateReturns: '   ' });
    F.configure(CFG);
    let e = null;
    try { await F.get(ITEM, 'zh-CN'); } catch (err) { e = err; }
    eq(e && e.code, 'empty_output');
    eq(notes.size, 0, '空结果被缓存下来，这张卡就永远读不出译句了');
  });

  test('翻译失败具名向上抛，缓存不留残骸', async () => {
    const { F, notes } = setup({ translateThrows: 'network' });
    F.configure(CFG);
    let e = null;
    try { await F.get(ITEM, 'zh-CN'); } catch (err) { e = err; }
    eq(e && e.code, 'network');
    eq(notes.size, 0);
  });

  test('失败之后 in-flight 表清干净 —— 一次断网不该钉死这张卡', async () => {
    const { F, calls } = setup({ translateThrows: 'network' });
    F.configure(CFG);
    for (let i = 0; i < 2; i++) { try { await F.get(ITEM, 'zh-CN'); } catch (_) {} }
    eq(calls.translate.length, 2);
  });
});

describe('LearnTranslateFill — 缓存位置与版本 (§9.3 同款借表)', () => {
  test('key 是 itemId + NUL + tr —— 借 notes 表，不撞解析也不撞题包', () => {
    const { F } = setup();
    eq(F.keyFor('card1'), 'card1\u0000tr');
    ok(F.keyFor('card1') !== 'card1', '不能和解析记录同键，否则两者互相覆盖');
    ok(F.keyFor('card1') !== 'card1\u0000pack');
  });

  test('版本不符视为未命中 —— 与 §9.2 的版本纪律同形', async () => {
    const { F, calls, notes } = setup();
    F.configure(CFG);
    notes.set(F.keyFor(ITEM.id), { id: ITEM.id, data: '旧译文', v: F.TR_VERSION - 1 });
    const r = await F.get(ITEM, 'zh-CN');
    eq(r.cached, false, '旧版本记录必须重新生成');
    eq(r.tr, '你好，世界');
    eq(calls.translate.length, 1);
  });

  test('cached() 只读、不扣费，且对坏记录与读失败都返回 null', async () => {
    const { F, calls, notes } = setup();
    F.configure(CFG);
    eq(await F.cached(ITEM.id), null);
    notes.set(F.keyFor(ITEM.id), { id: ITEM.id, v: F.TR_VERSION });        // 无 data
    eq(await F.cached(ITEM.id), null, '没有 data 的记录不能当命中');
    notes.set(F.keyFor(ITEM.id), { id: ITEM.id, data: 'x', v: F.TR_VERSION - 1 });
    eq(await F.cached(ITEM.id), null, '旧版本不能当命中');
    eq(calls.translate.length, 0, 'cached() 永远不发请求 —— 播放途中只准调它');
  });
});

describe('LearnTranslateFill — 它永远不碰 items (§9.5 的契约)', () => {
  test('模块表面上没有任何写 items 的函数', () => {
    // 反向断言，load-bearing：`item.tr` 记录的是页面当时真的显示了什么，而这里生成的
    // 译文是派生物。写进去不但越界，还同步不出去（touchedAt 不会因此抬高），只会造出
    // 一个各设备互相看不见的分叉。
    const { F } = setup();
    const surface = Object.keys(F).sort();
    for (const forbidden of ['put', 'putItem', 'save', 'write', 'mergeBatch', 'applySplit', 'fill', 'apply']) {
      eq(typeof F[forbidden], 'undefined', forbidden + ' 出现在 LearnTranslateFill 上 —— 写路径溜进来了');
    }
    eq(surface.join(','), 'TR_VERSION,cached,capable,configure,get,keyFor,resolveConfig',
      '模块表面变了：新增导出必须先说明它为什么不是一条写 items 的路');
  });

  test('跑完一整趟 get，items 侧一次都没被碰过', async () => {
    const { F, calls } = setup();
    F.configure(CFG);
    await F.get(ITEM, 'zh-CN');
    // setup() 的 LearnStore.mergeBatch 会直接抛；能走到这里就说明没人叫过它。
    ok(calls.put.every((c) => String(c.k).indexOf('\u0000tr') > 0),
      '写入必须全部落在补译文那个 key 上：' + JSON.stringify(calls.put.map((c) => c.k)));
    eq('tr' in ITEM, false, 'get() 不得往传进来的卡上写任何东西');
  });
});
