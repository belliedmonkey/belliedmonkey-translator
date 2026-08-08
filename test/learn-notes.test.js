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
        return { ok: true, status: 200, json: async () => ({ content: [{ text:
          '{"words":[{"w":"x","g":"y"}],"phrases":[],"grammar":""}' }] }) };
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
