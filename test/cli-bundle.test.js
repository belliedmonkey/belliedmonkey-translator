// test/cli-bundle.test.js — 命令行宿主的裁剪包（learning-design §9.10 / domain-design §2.7）。
//
// 这道门守的与 test/ext-bundle.test.js 同一句承诺：**CLI 里发出去的请求，与扩展 / App 里
// 发出去的，是同一个东西。** 判据不是「CLI 能翻出东西」，是**逐键深度相等** —— 一旦破了，
// 症状是「扩展好好的、CLI 少一个字段」，没有一行日志会说。
//
// 三件事：
//   1. 空白 vm 上下文里能起来（垫片清单够不够，只有在什么都没有的地方才问得出来）；
//   2. 四种请求形状与扩展那条路逐键相等；
//   3. 启动器真的能跑（本地 HTTP 端点，端到端）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { execFile } = require('child_process');
const { test, describe, ok, eq } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-cli-'));
const BUNDLE = path.join(TMP, 'engine.js');

// 每次跑测试都真的构建一次裁剪包 —— 这道门必须盯着**构建产物**，不能盯一个手工维护的副本。
require('../build/cli-bundle.js').buildCliBundle(TMP, null, {});

const plain = (o) => JSON.parse(JSON.stringify(o));

function makeFetch(calls, reply) {
  return (url, o) => {
    const opts = o || {};
    const headers = {};
    if (opts.headers) for (const k of Object.keys(opts.headers)) headers[k] = opts.headers[k];
    const req = { url: String(url), method: opts.method || 'GET', headers, body: opts.body == null ? null : String(opts.body) };
    calls.push(req);
    const r = reply(req, calls.length);
    const body = typeof r.body === 'string' ? r.body : '';
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => null },
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    });
  };
}

// 在一个空白上下文里起一份 CLI 引擎（只给 Node 真的会有的那些全局）。
function bootCli(seed, reply) {
  const calls = [];
  const ctx = {
    console, setTimeout, clearTimeout, AbortController, FormData, Blob, URLSearchParams,
    atob: (b) => Buffer.from(b, 'base64').toString('latin1'),
    fetch: makeFetch(calls, reply),
    __mtSeed: seed,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), ctx, { filename: 'engine.js' });
  return { ctx, calls };
}

// 扩展那条路：直接跑同一批源文件（不是另一份实现）。
function viaExt(seed, reply) {
  const calls = [];
  const store = Object.assign({}, seed);
  const dual = (fn) => (arg, cb) => { const v = fn(arg); if (cb) { cb(v); return undefined; } return Promise.resolve(v); };
  const ctx = {
    console, setTimeout, clearTimeout, AbortController, FormData, Blob,
    atob: (b) => Buffer.from(b, 'base64').toString('latin1'),
    fetch: makeFetch(calls, reply),
    chrome: {
      storage: {
        local: { get: dual((keys) => {
          if (keys == null) return Object.assign({}, store);
          const list = Array.isArray(keys) ? keys : Object.keys(keys);
          const out = {};
          for (const k of list) if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
          return out;
        }), set: dual((o) => { Object.assign(store, o); }) },
        onChanged: { addListener() {} },
      },
      runtime: { getURL: () => '' },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const rel of ['extension/content/providers.gen.js', 'extension/content/langs.gen.js',
    'extension/content/engine-state.js',
    'extension/content/wire-format.js', 'extension/content/request-shape.js',
    'extension/content/translation-api.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  }
  return { ctx, calls };
}

const okReply = (body) => () => ({ status: 200, headers: {}, body: JSON.stringify(body) });
const CHAT_OK = { choices: [{ message: { content: '你好。' } }] };

describe('cli-bundle: CLI 的引擎与扩展 / App 是同一份（§9.10）', () => {
  test('清单：垫片第一、入口最后，且不带整份文案与字幕引擎', () => {
    const { MODULES } = require('../build/cli-bundle.js');
    eq(MODULES[0], 'cli/node-shim.js', '垫片必须第一 —— 后面几个在加载期就读 chrome');
    eq(MODULES[MODULES.length - 1], 'cli/entry.js', '入口必须最后');
    for (const heavy of ['extension/content/i18n-messages.js', 'extension/content/translation-core.js']) {
      ok(!MODULES.includes(heavy), heavy + ' 不该进 CLI 包（Phase 1 用不上）');
    }
  });

  test('★ 空白上下文里能起来，并自称 cli', () => {
    const { ctx } = bootCli({ provider: 'deepseek', apiKey: 'k' }, okReply(CHAT_OK));
    const r = ctx.MTCli.ready();
    eq(r.ok, true, 'TranslationAPI 必须在');
    eq(r.host, 'cli', '进程要认得出自己是 CLI');
    eq(typeof ctx.chrome.runtime.sendMessage, 'undefined', '垫片故意不给 sendMessage ⇒ 探针失败即直连');
  });

  test('★ 四种请求形状：与扩展那条路逐键深度相等', async () => {
    const SHAPES = [
      { name: 'chat-compat（DeepSeek）', seed: { provider: 'deepseek', apiKey: 'sk-test-key', targetLang: 'zh-CN' } },
      { name: '自定义 /chat/completions', seed: { provider: 'custom_chat', apiKey: 'k', apiBaseUrl: 'https://gw.example.com/v1/chat/completions', apiModel: 'm', targetLang: 'zh-CN' } },
      { name: '自定义 /responses', seed: { provider: 'custom_chat', apiKey: 'k', apiBaseUrl: 'https://gw.example.com/v1/responses', apiModel: 'm', targetLang: 'zh-CN' } },
      { name: '自定义 /messages', seed: { provider: 'custom_chat', apiKey: 'k', apiBaseUrl: 'https://gw.example.com/v1/messages', apiModel: 'm', targetLang: 'zh-CN' } },
    ];
    for (const s of SHAPES) {
      const cli = bootCli(s.seed, okReply(CHAT_OK));
      await cli.ctx.MTCli.translate('Hello.', {});
      const ext = viaExt(s.seed, okReply(CHAT_OK));
      await ext.ctx.window.TranslationAPI.translate('Hello.', 'zh-CN',
        ext.ctx.window.TranslationAPI.resolveProvider(s.seed.provider),
        s.seed.apiKey, s.seed.apiBaseUrl || '', s.seed.apiModel || '');
      ok(cli.calls.length >= 1, s.name + '：CLI 要发出请求');
      ok(ext.calls.length >= 1, s.name + '：扩展要发出请求');
      eq(JSON.stringify(plain(cli.calls[0])), JSON.stringify(plain(ext.calls[0])),
        s.name + '：CLI 与扩展发出的请求必须逐键相同');
    }
  });

  test('★ 未配置 ⇒ needs_setup，且一个请求都不发', async () => {
    const { ctx, calls } = bootCli({}, okReply(CHAT_OK));
    const r = await ctx.MTCli.translate('Hello.', {});
    eq(r.ok, false); eq(r.code, 'needs_setup'); eq(calls.length, 0);
  });

  test('空文字不发请求', async () => {
    const { ctx, calls } = bootCli({ provider: 'deepseek', apiKey: 'k' }, okReply(CHAT_OK));
    eq((await ctx.MTCli.translate('   ', {})).code, 'empty');
    eq(calls.length, 0);
  });

  test('★ 免费的无 key 引擎：只有「选过」才算配置好（EngineState 判据，不重判）', () => {
    const a = bootCli({ provider: 'google' }, okReply(CHAT_OK));
    eq(a.ctx.MTCli.resolveConfig().needsSetup, true, '没选过 ⇒ 仍算未配置');
    const b = bootCli({ provider: 'google', engineChosen: true }, okReply(CHAT_OK));
    eq(b.ctx.MTCli.resolveConfig().needsSetup, false, '选过 + 不需要 key ⇒ 可用（免费路径完整）');
  });

  test('★ 401 归成 auth，而不是一句原始错误', async () => {
    const { ctx } = bootCli({ provider: 'deepseek', apiKey: 'bad' },
      () => ({ status: 401, headers: {}, body: '{"error":{"message":"invalid key"}}' }));
    const r = await ctx.MTCli.translate('Hello.', {});
    eq(r.ok, false); eq(r.code, 'auth'); eq(r.status, 401);
  });
});

// ── 端到端：启动器真的能跑（本地 HTTP 端点）────────────────────────────────
function runCli(args, env, input) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [path.join(ROOT, 'cli', 'bin', 'belliedmonkey.js')].concat(args),
      { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout, stderr }));
    if (input != null) { child.stdin.end(input); }
  });
}

function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', async () => {
      const port = srv.address().port;
      try { resolve(await fn(port)); }
      catch (e) { reject(e); }
      finally { srv.close(); }
    });
  });
}

describe('cli-bin: 启动器端到端（本地端点，§3.1.13）', () => {
  const CONF = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-cli-conf-'));
  const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-cli-empty-'));
  const ENV = { BELLIEDMONKEY_CONFIG_DIR: CONF, BM_CLI_DIST: TMP };

  test('未配置 translate ⇒ 退出码 2（且不打网络）', async () => {
    const r = await runCli(['translate', 'Hello.'], { BELLIEDMONKEY_CONFIG_DIR: EMPTY, BM_CLI_DIST: TMP });
    eq(r.code, 2, '没有 key ⇒ 引擎未配置，退出码 2');
    eq(r.stdout, '', '未配置时 stdout 不该有结果');
  });

  test('config set → get（key 打码）', async () => {
    const set = await runCli(['config', 'set', 'apiKey', 'sk-secret-9999'], ENV);
    eq(set.code, 0);
    const get = await runCli(['config', 'get', 'apiKey'], ENV);
    ok(!/sk-secret-9999/.test(get.stdout), 'config get 绝不能回显完整 key');
    ok(/9999/.test(get.stdout), '打码要留后四位，实际 ' + get.stdout);
  });

  test('config set provider ⇒ 同时记下 engineChosen（选中引擎这个动作本身）', async () => {
    const set = await runCli(['config', 'set', 'provider', 'deepseek'], ENV);
    eq(set.code, 0);
    const get = await runCli(['config', 'get', 'engineChosen'], ENV);
    ok(/true/.test(get.stdout), 'engineChosen 必须为真，实际 ' + get.stdout);
  });

  test('★ translate 真的发出请求并打印译文（默认双语）', async () => {
    const seen = [];
    await withServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url, auth: req.headers.authorization || '', body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '你好。' } }] }));
      });
    }, async (port) => {
      const env = Object.assign({}, ENV, {
        BM_PROVIDER: 'custom_chat',
        BM_API_KEY: 'sk-x',
        BM_BASE_URL: `http://127.0.0.1:${port}/v1/chat/completions`,
        BM_MODEL: 'test-model',
      });
      const r = await runCli(['translate', 'Hello.', '--only'], env);
      eq(r.code, 0, 'stderr=' + r.stderr);
      eq(r.stdout.trim(), '你好。');
      eq(seen.length, 1, '要恰好一次请求');
      ok(/chat\/completions$/.test(seen[0].url), '打到配置的端点');
      ok(/test-model/.test(seen[0].body), '模型名进请求体');
    });
  });

  test('providers 列出注册表，并标出当前引擎', async () => {
    const r = await runCli(['providers'], ENV);
    eq(r.code, 0);
    ok(/deepseek/.test(r.stdout), '注册表里要有引擎');
  });
});
