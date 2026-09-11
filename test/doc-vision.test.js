// test/doc-vision.test.js — 文档翻译的识图传输（learning-design §9.7「图片与扫描页：两步」）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadModule } = require('./harness');

function loadShape() {
  const window = {};
  const ctx = loadModule(['content/wire-format.js', 'content/request-shape.js'], { window, chrome: { storage: { local: { get: (k, cb) => cb({}) } } } });
  return ctx.RequestShape;
}

describe('RequestShape.build — image 内容块', () => {
  test('chat-compat：user 变成 [text, image_url] 两块，system 照旧', () => {
    const R = loadShape();
    const r = R.build('chat-compat', { url: 'https://x/v1/chat/completions', apiKey: 'k', model: 'm', system: 'S', user: 'U', image: 'data:image/jpeg;base64,AAAA', budget: 1000, prefs: {} });
    ok(!r.error);
    const u = r.body.messages[1];
    eq(u.role, 'user');
    deepEq(u.content, [{ type: 'text', text: 'U' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA', detail: 'auto' } }]);
    eq(r.body.messages[0].content, 'S');
  });
  test('没有 image 时 user 仍是字符串（不动既有形状）', () => {
    const R = loadShape();
    const r = R.build('chat-compat', { url: 'https://x/v1/chat/completions', apiKey: 'k', model: 'm', system: 'S', user: 'U', budget: 1000, prefs: {} });
    eq(r.body.messages[1].content, 'U');
  });
  test('messages-compat / responses-compat / translate-compat 带 image ⇒ vision_unsupported，不构造请求', () => {
    const R = loadShape();
    for (const fmt of ['messages-compat', 'responses-compat', 'translate-compat']) {
      const r = R.build(fmt, { url: 'https://x', apiKey: 'k', model: 'm', system: 'S', user: 'U', image: 'data:image/png;base64,AA', budget: 1000, prefs: {} });
      eq(r.error, 'vision_unsupported', fmt);
      ok(!r.body, fmt + ' 不该有 body');
    }
  });
});

describe('EngineState.visionOf — 只读注册表', () => {
  const window = { MT_PROVIDERS: [{ id: 'a', vision: true, needsKey: true }, { id: 'b', vision: false, needsKey: true }, { id: 'c', needsKey: true }] };
  const ES = loadModule('content/engine-state.js', { window }).EngineState;
  test('true / false / 缺省=null / 认不出的 id 落到默认', () => {
    eq(ES.visionOf('a'), true); eq(ES.visionOf('b'), false); eq(ES.visionOf('c'), null);
    eq(ES.visionOf('zzz'), true, '认不出 ⇒ 归一化到第一条');
  });
});

describe('生成物：vision 只在注册表写了时才发射；额度那一档恒 false', () => {
  test('dist/content/providers.gen.js', () => {
    const f = path.join(__dirname, '..', 'dist', 'content', 'providers.gen.js');
    if (!fs.existsSync(f)) { ok(true, 'dist 不在，跳过'); return; }
    const window = {};
    loadModule([path.relative(path.join(__dirname, '..', 'extension'), f)], { window });
    const by = Object.fromEntries(window.MT_PROVIDERS.map((p) => [p.id, p]));
    eq(by.openai.vision, true); eq(by.openrouter.vision, true); eq(by.deepseek.vision, false);
    ok(!('vision' in by.custom_chat), 'custom_chat 缺省 = 未知，不发键');
    if (by.grant) eq(by.grant.vision, false, '免费额度不识图（用户裁定 09-11）');
  });
});

describe('TranslationAPI.ocr — 走同一把并发闸，不走缓存，不支持时具名失败', () => {
  function loadApi(fetchImpl, providers) {
    const window = { MT_PROVIDERS: providers, MT_MODEL_PARAMS: [] };
    const chrome = { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } }, runtime: { sendMessage: () => {}, getManifest: () => ({ version: '1' }) } };
    const ctx = loadModule(['content/wire-format.js', 'content/request-shape.js', 'content/engine-state.js', 'content/translation-api.js'],
      { window, chrome, fetch: fetchImpl, AbortController, navigator: { userAgent: 'x' }, location: { href: 'https://x/' } });
    return ctx.TranslationAPI;
  }
  test('chat-compat 引擎：发一次带 image_url 的请求，回包 content 原样返回', async () => {
    const calls = [];
    const payload = JSON.stringify({ choices: [{ message: { content: 'Hello\n\nWorld' } }] });
    const api = loadApi(async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => JSON.parse(payload), text: async () => payload }; },
      [{ id: 'oa', type: 'chat-compat', needsKey: true, defaultEndpoint: 'https://api.example/v1/chat/completions', defaultModel: 'm', vision: true }]);
    const out = await api.ocr('data:image/jpeg;base64,AA', 'oa', 'k', '', '');
    eq(out, 'Hello\n\nWorld');
    eq(calls.length, 1);
    eq(calls[0].messages[1].content[1].type, 'image_url');
    ok(/OCR engine/.test(calls[0].messages[0].content));
  });
  test('messages-compat 引擎：vision_unsupported，一次请求都不发', async () => {
    let n = 0;
    const api = loadApi(async () => { n++; return { ok: true, status: 200, json: async () => ({}), text: async () => '', headers: { get: () => '' } }; },
      [{ id: 'cl', type: 'messages-compat', needsKey: true, defaultEndpoint: 'https://api.example/v1/messages', defaultModel: 'm', vision: false }]);
    let code = null; try { await api.ocr('data:image/png;base64,AA', 'cl', 'k', '', ''); } catch (e) { code = e.code; }
    eq(code, 'vision_unsupported'); eq(n, 0);
  });
});
