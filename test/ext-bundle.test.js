// test/ext-bundle.test.js — 系统翻译扩展的裁剪包（learning-design §9.9 / iOS 线 I-3）。
//
// 这道门守的是**一句承诺**：扩展里发出去的请求，与 App 里发出去的，是同一个东西。
// 承诺一旦破了，症状是「Mac 上好好的，iPhone 上少一个字段」—— 没有一行日志会说，
// 而两边各自都「没报错」。所以判据不是「扩展能翻出东西」，是**逐键深度相等**。
//
// 跑法：把 ExtEngine.js 放进一个**空白 vm 上下文**里，只给原生真的会给的那三个钩子
// （__mtSeed / __mtFetch / __mtTimer）。缺什么就会当场抛 —— 这正是要的：
// 垫片清单是不是够，只有在一个真的什么都没有的地方才问得出来。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, describe } = require('node:test');
const { strict: assert } = require('node:assert');
const eq = assert.deepStrictEqual;
const ok = assert.ok;

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist-app', 'ExtEngine.js');

// 在一个空白上下文里起一份引擎。`capture` 收下每一次出站请求。
// **上下文里故意没有**：document / navigator / localStorage / XMLHttpRequest /
// chrome.runtime.sendMessage —— 少了哪个会当场抛，而不是悄悄降级。
function boot(seed, reply) {
  const calls = [];
  const ctx = {
    console,
    __mtSeed: seed,
    __mtFetch: (req) => { calls.push(req); return Promise.resolve(reply(req, calls.length)); },
    // 原生那边是主队列上的 asyncAfter；测试里不真的等。
    __mtTimer: (ms) => new Promise((r) => setTimeout(r, Math.min(Number(ms) || 0, 5))),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), ctx, { filename: 'ExtEngine.js' });
  return { ctx, calls };
}

// App 那边同一条路：直接 require 这几个模块，在 Node 里跑一次，收下请求。
// 这不是「另一份实现」—— 是同一批文件，只是换个宿主加载，所以两边不等就一定是
// 裁剪包漏了什么或垫片改了语义。
function viaApp(seed, reply) {
  const calls = [];
  const store = Object.assign({}, seed);
  const dual = (fn) => (arg, cb) => { const v = fn(arg); if (cb) { cb(v); return undefined; } return Promise.resolve(v); };
  const ctx = {
    console, setTimeout, clearTimeout, AbortController, FormData, Blob,
    atob: (b) => Buffer.from(b, 'base64').toString('latin1'),
    fetch: (url, o) => {
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
    },
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
      runtime: { getURL: () => '' },   // 同样不给 sendMessage
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  // 与裁剪包同一批文件（engine-state 是 translation-api 在**请求时**才调的 —— 第一版漏了它，
  // 这道门当场把「两边清单不一致」抓了出来，正是它该干的事）。
  for (const rel of ['extension/content/providers.gen.js', 'extension/content/langs.gen.js',
    'extension/content/engine-state.js',
    'extension/content/wire-format.js', 'extension/content/request-shape.js',
    'extension/content/translation-api.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  }
  return { ctx, calls };
}

// 两个上下文是两个 vm 领域，那里造出来的对象带着各自的 Object.prototype ——
// deepStrictEqual 会比原型，于是「逐键看着一样却不相等」。跨领域比较前先归一化。
const plain = (o) => JSON.parse(JSON.stringify(o));

const okReply = (body) => () => ({ status: 200, headers: {}, body: JSON.stringify(body) });
const CHAT_OK = { choices: [{ message: { content: '你好。' } }] };

describe('ext-bundle: 扩展里的翻译引擎与 App 里的是同一份（I-3）', () => {
  const HAS = fs.existsSync(BUNDLE);

  test('★ 空白上下文里能起来 —— 垫片清单够不够，只有在什么都没有的地方才问得出来', () => {
    if (!HAS) return;
    const { ctx } = boot({}, okReply(CHAT_OK));
    const r = ctx.MTExt.ready();
    eq(r.ok, true, 'TranslationAPI 必须在');
    eq(r.host, 'ext', '进程要认得出自己是扩展（遥测据此一行都不发）');
    // 上下文里本来就没有这些；起得来说明没人在加载期偷偷用它们
    for (const g of ['document', 'navigator', 'localStorage', 'XMLHttpRequest']) {
      eq(typeof ctx[g], 'undefined', `裁剪包不该需要 ${g}`);
    }
  });

  test('★ 四种请求形状：与 App 那条路逐键深度相等', async () => {
    if (!HAS) return;
    const SHAPES = [
      { name: 'chat-compat（DeepSeek）', seed: { provider: 'deepseek', apiKey: 'sk-test-key', targetLang: 'zh-CN' } },
      { name: '自定义 /chat/completions', seed: { provider: 'custom_chat', apiKey: 'k', apiBaseUrl: 'https://gw.example.com/v1/chat/completions', apiModel: 'm', targetLang: 'zh-CN' } },
      { name: '自定义 /responses', seed: { provider: 'custom_chat', apiKey: 'k', apiBaseUrl: 'https://gw.example.com/v1/responses', apiModel: 'm', targetLang: 'zh-CN' } },
      { name: '自定义 /messages', seed: { provider: 'custom_chat', apiKey: 'k', apiBaseUrl: 'https://gw.example.com/v1/messages', apiModel: 'm', targetLang: 'zh-CN' } },
    ];
    for (const s of SHAPES) {
      const ext = boot(s.seed, okReply(CHAT_OK));
      await ext.ctx.MTExt.translate('Hello.', {});
      const app = viaApp(s.seed, okReply(CHAT_OK));
      await app.ctx.window.TranslationAPI.translate('Hello.', 'zh-CN',
        app.ctx.window.TranslationAPI.resolveProvider(s.seed.provider),
        s.seed.apiKey, s.seed.apiBaseUrl || '', s.seed.apiModel || '');
      ok(ext.calls.length >= 1, s.name + '：扩展要发出请求');
      ok(app.calls.length >= 1, s.name + '：App 要发出请求');
      // 逐键比 url / method / headers / body —— 差一个字段就是两份实现开始漂的那一刻
      eq(plain(ext.calls[0]), plain(app.calls[0]), s.name + '：扩展与 App 发出的请求必须逐键相同');
    }
  });

  test('★ 401 归成 auth，而不是一句原始错误', async () => {
    if (!HAS) return;
    const { ctx } = boot({ provider: 'deepseek', apiKey: 'bad' },
      () => ({ status: 401, headers: {}, body: '{"error":{"message":"invalid key"}}' }));
    const r = await ctx.MTExt.translate('Hello.', {});
    eq(r.ok, false);
    eq(r.code, 'auth', '停机码要与 App 同一套（原生按码查表出文案与出口）');
    eq(r.status, 401);
  });

  test('★ 免费额度用完的那个码原样透出去', async () => {
    if (!HAS) return;
    const { ctx } = boot({ provider: 'deepseek', apiKey: 'k' },
      () => ({ status: 402, headers: {}, body: '{"error":{"code":"credit_exhausted","message":"no credit"}}' }));
    const r = await ctx.MTExt.translate('Hello.', {});
    eq(r.ok, false);
    ok(r.code === 'credit_exhausted' || r.status === 402, '额度用完要能被弹层认出来，实际 ' + JSON.stringify(r));
  });

  test('★ 没配引擎 ⇒ needs_setup，而不是去打一个空地址', async () => {
    if (!HAS) return;
    const { ctx, calls } = boot({}, okReply(CHAT_OK));
    const r = await ctx.MTExt.translate('Hello.', {});
    eq(r.ok, false);
    eq(r.code, 'needs_setup');
    eq(calls.length, 0, '未配置时一个请求都不该发出去');
  });

  test('空文字不发请求', async () => {
    if (!HAS) return;
    const { ctx, calls } = boot({ provider: 'deepseek', apiKey: 'k' }, okReply(CHAT_OK));
    eq((await ctx.MTExt.translate('   ', {})).code, 'empty');
    eq(calls.length, 0);
  });

  test('★ 目标语言：本次弹层改过的优先，其次设置里的「译成」', async () => {
    if (!HAS) return;
    const seed = { provider: 'deepseek', apiKey: 'k', targetLang: 'ja' };
    const a = boot(seed, okReply(CHAT_OK));
    eq((await a.ctx.MTExt.translate('Hello.', {})).lang, 'ja', '没传就用设置里的');
    const b = boot(seed, okReply(CHAT_OK));
    eq((await b.ctx.MTExt.translate('Hello.', { lang: 'fr' })).lang, 'fr', '传了就用这一次的');
  });

  test('★ 后台探针如实失败 ⇒ 走直连（扩展进程里本来就没有 service worker）', () => {
    if (!HAS) return;
    const { ctx } = boot({}, okReply(CHAT_OK));
    eq(typeof ctx.chrome.runtime.sendMessage, 'undefined',
      '垫片故意不给 sendMessage —— 假装有一个会让每段干等 20 秒');
  });

  test('清单里不该有整份界面文案（1 MB）与字幕引擎', () => {
    const { MODULES } = require('../build/ext-bundle.js');
    for (const heavy of ['extension/content/i18n-messages.js', 'extension/content/translation-core.js']) {
      ok(!MODULES.includes(heavy), heavy + ' 不该进扩展包（失败文案由原生按 code 查表）');
    }
    ok(MODULES[0] === 'app/ext-shim.js', '垫片必须第一 —— 后面几个在加载期就读 chrome');
    ok(MODULES[MODULES.length - 1] === 'app/ext-entry.js', '入口必须最后');
  });
});
