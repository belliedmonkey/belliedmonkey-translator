// test/learn-notes.test.js — 句子解析 (§9.2).
//
// The load-bearing properties: the capability gate (no chat engine ⇒ no feature,
// decided by TYPE from the registry, not by vendor name), the untrusted-output
// parser, and above all the cache discipline — the user's key is charged AT MOST
// ONCE per card, which only a call-count assertion can see (verification-spec
// §3.1.1 blind spot 2).

const { loadModule, describe, test, ok, eq } = require('./harness');

const PROVIDERS = [
  { id: 'google', type: 'google', label: 'G' },
  { id: 'chat1', type: 'chat-compat', label: 'C', defaultBase: 'https://chat.example', path: '/v1/chat/completions', defaultModel: 'm1' },
  { id: 'msg1', type: 'messages-compat', label: 'M', defaultBase: 'https://msg.example', path: '/v1/messages', defaultModel: 'm2' },
  // Neither google nor chat-capable. Without this row, "exclude by name" and
  // "exclude by type" are indistinguishable — the fixture's only non-chat engine
  // WAS google, and the whole point of type-gating is that a future non-chat type
  // stays excluded without anyone editing a name list.
  { id: 'other', type: 'speech-compat', label: 'S', defaultBase: 'https://s.example', path: '/v1/speech' },
];

function setup(over) {
  const notesDb = new Map();
  const calls = { fetch: [] };
  const fetchImpl = (over && over.fetch) || (async (url, init) => {
    calls.fetch.push({ url, init: JSON.parse(init.body), headers: init.headers });
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content:
        '{"words":[{"w":"curve","g":"曲线"}],"phrases":[{"p":"over time","g":"随时间"}],"grammar":"一般现在时"}' } }] }),
    };
  });
  const LearnStore = {
    getNote: (id) => Promise.resolve(notesDb.get(id) || null),
    putNote: (id, data, meta) => { notesDb.set(id, Object.assign({ id, data }, meta)); return Promise.resolve(); },
  };
  const ctx = loadModule('learn/notes.js', {
    window: { MT_PROVIDERS: PROVIDERS }, LearnStore, fetch: fetchImpl,
  });
  return { N: ctx.LearnNotes, notesDb, calls };
}

const ITEM = { id: 'card1', text: 'The curve bends over time.', tr: '曲线随时间弯曲。', lang: 'en' };

describe('LearnNotes — the capability gate (§9.2)', () => {
  test('chat-capable + key ⇒ capable; anything less ⇒ not', () => {
    const { N } = setup();
    N.configure({ provider: 'chat1', apiKey: 'k' });
    eq(N.capable(), true);
    N.configure({ provider: 'msg1', apiKey: 'k' });
    eq(N.capable(), true, 'messages 格式同样是 chat 能力');
    N.configure({ provider: 'google', apiKey: 'k' });
    eq(N.capable(), false, '翻译通道做不了解析 —— 按 type 拒，不按名字');
    N.configure({ provider: 'chat1', apiKey: '' });
    eq(N.capable(), false, '没有 key 就没有能力');
    N.configure({ provider: 'nope', apiKey: 'k' });
    eq(N.capable(), false, '注册表里没有的引擎不是引擎');
    N.configure({ provider: 'other', apiKey: 'k' });
    eq(N.capable(), false, '非 chat 的 type 一律排除 —— 按 type，不是按名单');
  });
});

describe('LearnNotes — parseNotes treats model output as untrusted (§9.2)', () => {
  test('clean JSON, fenced JSON, and JSON buried in prose all parse', () => {
    const { N } = setup();
    const good = '{"words":[{"w":"a","g":"b"}],"phrases":[],"grammar":"g"}';
    ok(N.parseNotes(good) !== null);
    ok(N.parseNotes('```json\n' + good + '\n```') !== null, '代码栅栏要剥掉');
    ok(N.parseNotes('Sure! Here you go: ' + good + ' Hope that helps!') !== null,
      '包在客套话里的 JSON 要挖出来');
  });

  test('garbage, wrong shapes and empty results are null — never rendered', () => {
    const { N } = setup();
    eq(N.parseNotes('I cannot help with that.'), null);
    eq(N.parseNotes('{"words": "not-an-array"}'), null);
    eq(N.parseNotes('{"words":[],"phrases":[],"grammar":""}'), null, '全空 = 没有可用内容');
    eq(N.parseNotes(''), null);
  });

  test('entries are type-checked and counts clamped', () => {
    const { N } = setup();
    const words = [];
    for (let i = 0; i < 20; i++) words.push({ w: 'w' + i, g: 'g' + i });
    words.push({ w: 42, g: 'bad' });          // non-string dropped
    words.push({ w: '  ', g: 'blank' });      // blank dropped
    const out = N.parseNotes(JSON.stringify({ words, phrases: [], grammar: '' }));
    eq(out.words.length, 8, '生词最多 8 条（' + out.words.length + '）');
    ok(out.words.every((x) => typeof x.w === 'string' && x.w.trim()), '混入了坏条目');
  });
});

describe('LearnNotes — 生词只取自原句，缓存带提示词版本 (§9.2 v2)', () => {
  // 真机实测的事故形状：en.wikipedia 的英文卡，解析出带拼音的中文生词 —— v1 提示词
  // 没说生词来自哪一侧，而 Safari 采集的卡 lang 全是 'und'，模型把译文当成了学习语言。
  test('prompt pins the study side: from the Sentence, never the Translation', () => {
    const { N } = setup();
    const p = N.buildPrompt('zh-CN');
    ok(/FROM THE SENTENCE ONLY/.test(p), '提示词必须点名生词只能取自原句');
    ok(/never[\s\S]*from the Translation/.test(p), '提示词必须明说不取译文');
    ok(p.indexOf('zh-CN') >= 0, '解释语言仍要进提示词');
  });

  test('a v1-era cached note (no version) is a MISS — regenerated once, then cached', async () => {
    const { N, notesDb, calls } = setup();
    N.configure({ provider: 'chat1', apiKey: 'k' });
    // What v1 left behind: wrong-side vocabulary, stored without a version field.
    notesDb.set(ITEM.id, { id: ITEM.id, data: { words: [{ w: '曲线', g: 'qūxiàn' }], phrases: [], grammar: '' } });
    const r = await N.get(ITEM, 'zh-CN');
    eq(r.cached, false, '旧版提示词的缓存必须重新生成 —— 里面是拿译文当学习语言的错误结果');
    eq(calls.fetch.length, 1);
    eq(notesDb.get(ITEM.id).v, N.PROMPT_VERSION, '重生成的记录要带上当前版本号');
    const again = await N.get(ITEM, 'zh-CN');
    eq(again.cached, true, '版本一致后回到缓存');
    eq(calls.fetch.length, 1, '版本迁移每卡至多多扣一次费');
  });

  test('cached() hides stale-version notes from the auto-render path', async () => {
    const { N, notesDb } = setup();
    notesDb.set('c9', { id: 'c9', data: { words: [{ w: '旧', g: 'jiù' }], phrases: [], grammar: '' } });
    eq(await N.cached('c9'), null, '旧版缓存不能再自动渲染到答案面 —— 按钮回来，点了再生成');
    notesDb.set('c9', { id: 'c9', v: N.PROMPT_VERSION, data: { words: [{ w: 'new', g: '新' }], phrases: [], grammar: '' } });
    ok((await N.cached('c9')) !== null, '当前版本的缓存照常自动渲染');
  });

  test('cached() is defensive: dataless records and a failing store both yield null', async () => {
    const { N, notesDb } = setup();
    notesDb.set('c8', { id: 'c8', v: N.PROMPT_VERSION });   // 有版本没内容
    eq(await N.cached('c8'), null, '没 data 的记录不能进渲染路径');
    // 再用一个 getNote 会拒绝的 store 加载一份新模块实例
    const { loadModule } = require('./harness');
    const c = loadModule('learn/notes.js', {
      window: { MT_PROVIDERS: PROVIDERS },
      LearnStore: { getNote: () => Promise.reject(new Error('idb gone')) },
      fetch: async () => { throw new Error('unused'); },
    });
    eq(await c.LearnNotes.cached('c1'), null, '存储层挂了也不能把答案面炸掉');
  });

  test('wholesale wrong-side output (nothing from the sentence) is bad_output — never cached', async () => {
    // 真机事故的直接机械化：英文卡解析出全中文生词。提示词只是指令，模型可以不听；
    // 回验是不会不听的那道闸。
    const { N, notesDb } = setup({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content:
        '{"words":[{"w":"自豪地","g":"proudly"}],"phrases":[{"p":"自豪地托管","g":"proudly host"}],"grammar":"副词修饰动词"}' } }] }) }),
    });
    N.configure({ provider: 'chat1', apiKey: 'k' });
    let code = null;
    try { await N.get(ITEM, 'zh-CN'); } catch (e) { code = e.code; }
    eq(code, 'bad_output', '零匹配 = 取错侧，必须拒收');
    eq(notesDb.size, 0, '错侧结果被缓存 = 这张卡永远错下去');
  });

  test('notesMatchSentence: one verbatim hit passes (lemmatized strays tolerated), zero hits fails', () => {
    const { N } = setup();
    const s = 'The curve bends over time.';
    ok(N.notesMatchSentence({ words: [{ w: 'bend', g: '弯' }, { w: 'curve', g: '曲线' }], phrases: [] }, s),
      '个别词形还原（bends→bend 没命中）不该连坐 —— 有一个逐字命中即可');
    ok(!N.notesMatchSentence({ words: [{ w: '曲线', g: 'qūxiàn' }], phrases: [{ p: '随时间', g: 'over time' }] }, s),
      '全部来自译文 = 零命中，必须失败');
    ok(N.notesMatchSentence({ words: [], phrases: [], grammar: '只有语法点' }, s),
      '纯语法输出没有可回验的条目，放行');
  });

  test('failed regeneration of a stale note leaves the old record untouched', async () => {
    const { N, notesDb } = setup({ fetch: async () => ({ ok: false, status: 500 }) });
    N.configure({ provider: 'chat1', apiKey: 'k' });
    notesDb.set(ITEM.id, { id: ITEM.id, data: { words: [{ w: '旧', g: 'jiù' }], phrases: [], grammar: '' } });
    let code = null;
    try { await N.get(ITEM, 'zh-CN'); } catch (e) { code = e.code; }
    eq(code, 'http');
    eq(notesDb.get(ITEM.id).v, undefined, '失败不得写入当前版本号 —— 否则错误笔记被洗白成 v2');
  });

  // A user-configured chat endpoint is always a cross-origin POST. If it omits
  // `Access-Control-Allow-Origin`, WebKit kills the fetch before any status exists and
  // throws a bare TypeError ("Load failed") — identical to "host unreachable"
  // (learning-design §9.4, measured 2026-08-13). Unnamed, that reached the settings
  // page as the raw string; the settings page can only say what to fix if the
  // transport says what happened, and can only show WHERE if the error carries it.
  test('a bare fetch rejection is named `network` and carries the URL', async () => {
    const { N } = setup({ fetch: async () => { throw new TypeError('Load failed'); } });
    N.configure({ provider: 'chat1', apiKey: 'k' });
    let e = null;
    try { await N.get(ITEM, 'zh-CN'); } catch (err) { e = err; }
    eq(e && e.code, 'network');
    eq(e && e.url, 'https://chat.example/v1/chat/completions');
  });

  test('an HTTP failure carries the URL too', async () => {
    const { N } = setup({ fetch: async () => ({ ok: false, status: 404 }) });
    N.configure({ provider: 'chat1', apiKey: 'k' });
    let e = null;
    try { await N.get(ITEM, 'zh-CN'); } catch (err) { e = err; }
    eq(e && e.code, 'http');
    eq(e && e.url, 'https://chat.example/v1/chat/completions');
  });

  test('a failed cache WRITE after a successful (paid) call still returns the data', async () => {
    // 扣费已经发生、数据已经在手 —— IndexedDB 写失败不能表现成「解析失败」
    // 引诱用户再点一次、再扣一次。
    const notesDb = new Map();
    const { loadModule } = require('./harness');
    const c = loadModule('learn/notes.js', {
      window: { MT_PROVIDERS: PROVIDERS },
      LearnStore: {
        getNote: () => Promise.resolve(null),
        putNote: () => Promise.reject(new Error('quota')),
      },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content:
        '{"words":[{"w":"curve","g":"曲线"}],"phrases":[],"grammar":""}' } }] }) }),
    });
    c.LearnNotes.configure({ provider: 'chat1', apiKey: 'k' });
    const r = await c.LearnNotes.get(ITEM, 'zh-CN');
    eq(r.cached, false);
    eq(r.data.words[0].w, 'curve', '缓存写失败只意味着下次可能再生成，不意味着这次白付了');
  });

  test('concurrent get() for the same card charges the key ONCE', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { N, calls } = setup({
      fetch: async (url, init) => {
        calls.fetch.push({ url });
        await gate;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content:
          '{"words":[{"w":"curve","g":"曲线"}],"phrases":[],"grammar":""}' } }] }) };
      },
    });
    N.configure({ provider: 'chat1', apiKey: 'k' });
    const p1 = N.get(ITEM, 'zh-CN');
    const p2 = N.get(ITEM, 'zh-CN');   // 同卡并发：练习卡组 / 双宿主同开
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    eq(calls.fetch.length, 1, '同一张卡的并发生成必须去重 —— 两次扣费');
    eq(JSON.stringify(r1.data), JSON.stringify(r2.data));
  });
});

describe('LearnNotes — the key is charged AT MOST ONCE per card (§9.2)', () => {
  test('second get() serves the cache — zero further fetches', async () => {
    const { N, calls } = setup();
    N.configure({ provider: 'chat1', apiKey: 'k' });
    const first = await N.get(ITEM, 'zh-CN');
    eq(first.cached, false);
    eq(calls.fetch.length, 1);
    const second = await N.get(ITEM, 'zh-CN');
    eq(second.cached, true, '第二次必须走缓存');
    eq(calls.fetch.length, 1, '缓存命中后又发了请求 —— 用户被重复扣费');
    eq(JSON.stringify(second.data), JSON.stringify(first.data));
  });

  test('chat-compat request carries the right shape and auth', async () => {
    const { N, calls } = setup();
    N.configure({ provider: 'chat1', apiKey: 'sk-test' });
    await N.get(ITEM, 'fr');
    const c = calls.fetch[0];
    eq(c.url, 'https://chat.example/v1/chat/completions');
    eq(c.headers.Authorization, 'Bearer sk-test');
    eq(c.init.model, 'm1');
    ok(c.init.messages[0].content.indexOf('fr') >= 0, '解释语言要进提示词');
    ok(c.init.messages[1].content.indexOf(ITEM.text) >= 0, '句子要进用户消息');
  });

  test('messages-compat request uses its own headers and shape', async () => {
    const { N, calls } = setup({
      fetch: async (url, init) => {
        calls.fetch.push({ url, init: JSON.parse(init.body), headers: init.headers });
        // 'curve' 逐字来自 ITEM.text —— 生词回验（notesMatchSentence）放行的前提。
        return { ok: true, status: 200, json: async () => ({ content: [{ text:
          '{"words":[{"w":"curve","g":"曲线"}],"phrases":[],"grammar":""}' }] }) };
      },
    });
    const { calls: c2 } = { calls };   // alias for clarity
    N.configure({ provider: 'msg1', apiKey: 'sk-m' });
    await N.get(ITEM, 'zh-CN');
    const c = calls.fetch[0];
    eq(c.url, 'https://msg.example/v1/messages');
    eq(c.headers['x-api-key'], 'sk-m');
    ok(!!c.headers['anthropic-version'], 'Messages 格式的协议头是硬要求');
    ok(typeof c.init.system === 'string', 'system 在顶层，不在 messages 里');
  });

  test('unusable output is an ERROR with a code — never cached', async () => {
    const { N, notesDb, calls } = setup({
      fetch: async (url, init) => {
        calls.fetch.push({ url });
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'nope' } }] }) };
      },
    });
    N.configure({ provider: 'chat1', apiKey: 'k' });
    let code = null;
    try { await N.get(ITEM, 'zh-CN'); } catch (e) { code = e.code; }
    eq(code, 'bad_output');
    eq(notesDb.size, 0, '坏输出被缓存 = 这张卡永远坏了');
  });
});

// §9.2 (2026-08-09 二) — the notes engine may override the translator's. The
// rule is all-or-nothing on notesProvider: borrowing the translation key under
// a different provider would pair a key with an endpoint it was never issued
// for, so a set notesProvider switches the WHOLE group.
describe('resolveConfig — notes-engine override (§9.2)', () => {
  const TRANS = { provider: 'chat1', apiKey: 'k-trans', apiBaseUrl: 'https://t.example', apiModel: 'mt' };

  test('empty notesProvider follows the translation group wholesale', () => {
    const { N } = setup();
    const r = N.resolveConfig(TRANS);
    eq(r.provider, 'chat1');
    eq(r.apiKey, 'k-trans');
    eq(r.baseUrl, 'https://t.example');
    eq(r.model, 'mt');
  });

  test('set notesProvider switches the whole group — nothing borrowed', () => {
    const { N } = setup();
    const r = N.resolveConfig(Object.assign({}, TRANS, {
      notesProvider: 'msg1', notesApiKey: 'k-notes',
    }));
    eq(r.provider, 'msg1');
    eq(r.apiKey, 'k-notes');
    eq(r.baseUrl, '', '解析组没填地址就是空——绝不借翻译组的');
    eq(r.model, '', '解析组没填模型就是空——用注册表默认，不借翻译组的');
  });

  test('empty settings resolve to all-empty (gate stays closed)', () => {
    const { N } = setup();
    const r = N.resolveConfig({});
    eq(r.provider, '');
    eq(r.apiKey, '');
  });

  test('override feeds capable(): reasoner-on-translation, chat-on-notes opens the gate', () => {
    const { N } = setup();
    N.configure(N.resolveConfig({ provider: 'google', notesProvider: 'chat1', notesApiKey: 'k' }));
    ok(N.capable(), '翻译用非 chat 引擎时，独立解析引擎照样开门');
  });
});
