// test/bel257-token-isolation.test.js — BEL-257：凭证类别 / 归属 / 端点守卫。
//
// 纯 mock：`bmg_test_` / `sk-test_` + 本地 http.createServer 中继。不连任何真实
// provider、不耗额度、不发真实 key。四条传输（chat / messages / speech / transcribe）
// 都必须走 RequestShape.build 的同一个 throw-before-fetch 守卫。
const http = require('http');
const path = require('path');
const { describe, test, ok, eq, deepEq, rejects, loadModule, loadSrc, tick } = require('./harness');
const { makeChrome } = require('./stubs');
const WireFormat = require('../extension/content/wire-format.js');

const ROOT = path.join(__dirname, '..');
const GRANT = 'bmg_test_1234567890';
const USER_KEY = 'sk-test_user_key';

function loadRegistry(mutate) {
  const window = {};
  loadModule(['providers.gen.js', 'tts.gen.js', 'stt.gen.js'], { window });
  if (mutate) mutate(window);
  return window;
}

// 只跑 build（不 fetch）。用来钉四条形状的 throw-before-fetch。
function shapeCtx(window) {
  const ctx = loadModule('request-shape.js', { window, WireFormat });
  return ctx.RequestShape;
}

function buildError(RS, fmt, o) {
  try { RS.build(fmt, o); } catch (e) { return e; }
  return null;
}

describe('BEL-257 — RequestShape.build 在 fetch 之前拒绝', () => {
  const window = loadRegistry();
  const RS = shapeCtx(window);

  const SHAPES = [
    ['chat-compat', { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', system: 's', user: 'u' }, 'openai'],
    ['messages-compat', { url: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-4-5-20251001', system: 's', user: 'u' }, 'claude'],
    ['speech-compat', { url: 'https://api.openai.com/v1/audio/speech', model: 'gpt-4o-mini-tts', input: 'hi', voice: 'alloy' }, 'openai_speech'],
    ['transcribe-compat', { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1', file: new Blob(), filename: 'a.webm' }, 'openai_transcribe'],
  ];

  for (const [fmt, base, pid] of SHAPES) {
    test(`${fmt}: vendor + bmg_ → grant_token_wrong_engine，0 次 fetch`, () => {
      const e = buildError(RS, fmt, Object.assign({}, base, {
        apiKey: GRANT, providerId: pid, needsKey: true, keyOwner: 'grant',
      }));
      ok(e, '必须 throw，不能返回 {error} —— callProvider/tts 不检查 req.error');
      eq(e.code, 'grant_token_wrong_engine');
      eq(e.retryable, false, '不可重试');
      eq(e.preflight, true, 'preflight：不进 translate_fail，也不重试三次');
    });
  }

  test('grant 引擎 + vendor 端点 → grant_token_wrong_endpoint', () => {
    const e = buildError(RS, 'chat-compat', {
      url: 'https://api.openai.com/v1/chat/completions', apiKey: GRANT,
      providerId: 'grant', needsKey: true,
    });
    eq(e.code, 'grant_token_wrong_endpoint');
  });

  test('grant 引擎 + 本 flavor 中继端点 → 放行，header 是 bmg_', () => {
    const grant = window.MT_PROVIDERS.find((p) => p.id === 'grant');
    const req = RS.build('chat-compat', {
      url: grant.defaultEndpoint, apiKey: GRANT, providerId: 'grant', needsKey: true,
      model: grant.defaultModel, system: 's', user: 'u',
    });
    eq(req.headers.Authorization, 'Bearer ' + GRANT);
    eq(req.headers['x-api-key'], undefined, 'chat-compat 不该带 x-api-key');
  });

  test('空 key + needsKey → no_key_for_provider（不是发一个 Bearer 空串）', () => {
    const e = buildError(RS, 'chat-compat', {
      url: 'https://api.openai.com/v1/chat/completions', apiKey: '', providerId: 'openai', needsKey: true,
      model: 'gpt-4o-mini', system: 's', user: 'u',
    });
    eq(e.code, 'no_key_for_provider');
    eq(e.preflight, true);
  });

  test('A 的 key + B 的 provider → key_owner_mismatch；owner 为空（旧配置）不误伤', () => {
    const bad = buildError(RS, 'chat-compat', {
      url: 'https://api.openai.com/v1/chat/completions', apiKey: USER_KEY, providerId: 'deepseek',
      needsKey: true, keyOwner: 'openai', model: 'x', system: 's', user: 'u',
    });
    eq(bad.code, 'key_owner_mismatch');
    eq(bad.retryable, false);
    const legacy = RS.build('chat-compat', {
      url: 'https://api.openai.com/v1/chat/completions', apiKey: USER_KEY, providerId: 'openai',
      needsKey: true, keyOwner: '', model: 'x', system: 's', user: 'u',
    });
    eq(legacy.headers.Authorization, 'Bearer ' + USER_KEY, '没迁移的旧安装不能被拦死');
  });
});

describe('BEL-257 — TranslationAPI：vendor + bmg_ 零 fetch / 零 proxyFetch', () => {
  function loadAPI(window, store) {
    const chrome = makeChrome({ store: store || {} });
    const calls = [];
    const fetch = async (url) => { calls.push(url); throw new Error('NO FETCH ALLOWED'); };
    fetch.calls = calls;
    const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'],
      { chrome, fetch, AbortController, URLSearchParams, window, WireFormat });
    return { API: ctx.TranslationAPI, fetch, chrome, ctx };
  }

  test('vendor + bmg_：一个 fetch / 一个 proxyFetch 都没有', async () => {
    const window = loadRegistry();
    const { API, fetch, chrome } = loadAPI(window);
    const e = await rejects(API.translate('hello world', 'fr', 'deepseek', GRANT, ''));
    eq(e.code, 'grant_token_wrong_engine');
    eq(fetch.calls.length, 0);
    eq((chrome.runtime._sent || []).filter((m) => m && m.action === 'proxyFetch').length, 0,
      '连 proxyFetch 都不该发 —— 后台不是第一道防线，header 构造才是');
  });

  test('owner 不匹配 → 0 fetch；切回 A 之后照常成功', async () => {
    const window = loadRegistry();
    const store = { apiKeyOwner: 'openai' };
    const calls = [];
    const chrome = makeChrome({ store, onMessage: (m) => (m && m.action === 'ping' ? { ok: false } : undefined) });
    const fetch = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, headers: { get: () => null },
        text: async () => JSON.stringify({ choices: [{ message: { content: 'bonjour' } }] }) };
    };
    const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'],
      { chrome, fetch, AbortController, URLSearchParams, window, WireFormat });
    const e = await rejects(ctx.TranslationAPI.translate('hello world', 'fr', 'deepseek', USER_KEY, ''));
    eq(e.code, 'key_owner_mismatch');
    eq(calls.length, 0);
    // 切回 A：owner 与 provider 一致 ⇒ 请求正常发出。
    store.apiKeyOwner = 'deepseek';
    await ctx.RequestShape.refresh();
    eq(await ctx.TranslationAPI.translate('hello world', 'fr', 'deepseek', USER_KEY, ''), 'bonjour');
    eq(calls.length, 1);
  });
});

describe('BEL-257 — grant 正例只打本地中继（真实 http.createServer）', () => {
  test('1 次 fetch 到本地 relay；Authorization=bmg_test_，不是 vendor host', async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url, auth: req.headers.authorization || '', body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'bonjour' } }] }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const relay = `http://127.0.0.1:${port}/functions/v1/bt-relay/chat/completions`;
    try {
      const window = loadRegistry((w) => {
        const g = w.MT_PROVIDERS.find((p) => p.id === 'grant');
        g.defaultEndpoint = relay;
      });
      const chrome = makeChrome({ onMessage: (m) => (m && m.action === 'ping' ? { ok: false } : undefined) });
      const proxy = [];
      const fetch = (url, opts) => { proxy.push(url); return globalThis.fetch(url, opts); };
      const ctx = loadModule(['engine-state.js', 'request-shape.js', 'translation-api.js'],
        { chrome, fetch, AbortController, URLSearchParams, window, WireFormat });
      eq(await ctx.TranslationAPI.translate('hello world', 'fr', 'grant', GRANT, ''), 'bonjour');
      eq(seen.length, 1, '恰好一次中继请求');
      eq(seen[0].url, '/functions/v1/bt-relay/chat/completions');
      eq(seen[0].auth, 'Bearer ' + GRANT);
      ok(!/openai|anthropic|deepseek|googleapis/i.test(seen[0].url), '不能落到任何 vendor host');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('BEL-257 — background 纵深：bmg_ 不许被转发到非中继 host', () => {
  function loadBg(fetchImpl, chromeOpts) {
    const listeners = [];
    const chrome = makeChrome(chromeOpts || {});
    chrome.runtime.onInstalled = { addListener: () => {} };
    chrome.runtime.onMessage = { addListener: (fn) => listeners.push(fn) };
    chrome.action = { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, onClicked: { addListener: () => {} } };
    chrome.tabs = { onUpdated: { addListener: () => {} }, onActivated: { addListener: () => {} }, query: () => {}, sendMessage: () => {} };
    loadModule('./background.js', { chrome, fetch: fetchImpl, AbortController, URL, setTimeout, clearTimeout });
    return listeners[0];
  }

  test('header 含 bmg_ 且 host 不在 relayHosts → 不 fetch，回具名错误', async () => {
    let calls = 0;
    const listener = loadBg(async () => { calls++; return { ok: true, headers: { get: () => null }, text: async () => '{}' }; });
    let answer = null;
    const stopped = listener({
      action: 'proxyFetch', url: 'https://api.openai.com/v1/chat/completions',
      init: { method: 'POST', headers: { Authorization: 'Bearer ' + GRANT } },
      relayHosts: ['relay.test'],
    }, {}, (r) => { answer = r; });
    eq(stopped, undefined, '被拒绝时同步回话，不返回 true');
    deepEq(answer, { error: 'grant_token_wrong_endpoint' });
    eq(calls, 0, '一个字节都不许发出去');
  });

  test('没有 relayHosts（旧内容脚本）也 fail-closed', async () => {
    let calls = 0;
    const listener = loadBg(async () => { calls++; return { ok: true, headers: { get: () => null }, text: async () => '{}' }; });
    let answer = null;
    listener({ action: 'proxyFetch', url: 'https://api.openai.com/v1/chat/completions',
      init: { headers: { 'x-api-key': GRANT } } }, {}, (r) => { answer = r; });
    eq(answer.error, 'grant_token_wrong_endpoint');
    eq(calls, 0);
  });

  test('中继 host + bmg_ → 正常转发', async () => {
    let calls = 0;
    const listener = loadBg(async () => {
      calls++;
      return { ok: true, headers: { get: () => null }, text: async () => '{}' };
    });
    let answer = null;
    const r = listener({ action: 'proxyFetch', url: 'https://relay.test/functions/v1/bt-relay/chat/completions',
      init: { headers: { Authorization: 'Bearer ' + GRANT } }, relayHosts: ['relay.test'] }, {}, (a) => { answer = a; });
    eq(r, true);
    await tick(5);
    eq(calls, 1, '中继正例必须真的发');
    eq(answer.ok, true);
  });
});

describe('BEL-257 — 旧配置 owner 迁移', () => {
  const G = loadSrc('src/shared/grant.js', 'LearnGrant').LearnGrant;

  test('bmg_ → grant id；用户 key → 当前 provider/engine；不删 key', () => {
    const p = G.migrateOwners({
      apiKey: GRANT, provider: 'deepseek',
      ttsApiKey: USER_KEY, ttsEngine: 'openai_speech',
      sttApiKey: GRANT, sttEngine: 'openai_transcribe',
      notesApiKey: USER_KEY, notesProvider: 'openai',
    });
    deepEq(p, {
      apiKeyOwner: 'grant',
      ttsKeyOwner: 'openai_speech',
      sttKeyOwner: 'grant_stt',
      notesKeyOwner: 'openai',
    });
  });

  test('已有 owner 不覆盖；空槽不造归属', () => {
    const p = G.migrateOwners({ apiKey: USER_KEY, apiKeyOwner: 'openai', ttsApiKey: '' });
    deepEq(p, { ttsKeyOwner: '', sttKeyOwner: '', notesKeyOwner: '' });
  });

  test('退出/换号只清 bmg_ 的 owner，用户 key 与 owner 一个字节不动', () => {
    const out = G.clearForAccountSwitch({
      apiKey: GRANT, apiKeyOwner: 'grant',
      ttsApiKey: USER_KEY, ttsKeyOwner: 'openai_speech',
    });
    eq(out.writes.apiKey, '');
    eq(out.writes.apiKeyOwner, '');
    eq(out.writes.ttsApiKey, undefined, '用户 key 不许清');
    eq(out.writes.ttsKeyOwner, undefined, '用户 key 的 owner 不许清');
  });
});
