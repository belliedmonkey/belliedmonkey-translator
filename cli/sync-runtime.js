// cli/sync-runtime.js — 复用 learn/auth.js + learn/sync.js 的最小运行环境（§9.10）。
//
// 这两个模块是「扩展页」模块：它们引用裸全局 `chrome` / `PageSettings` / `LearnStore` /
// `LearnChunk` / `LearnModel` / `MT_BACKEND` / `LearnAuth`。Node 的 CommonJS 里裸名会落到
// `globalThis`，所以只要**在 require 之前**把这些全局挂好，两个模块就能原样跑 —— 与
// app/ext-shim.js 让传输层在 JSC 里跑起来是同一种做法。这条路的关键是「同一份字节」：
// 我们不重写登录与同步，只换掉它们脚下的存储与语料。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const stateMod = require('./state.js');
const { makeStore } = require('./store-adapter.js');

// 后端配置跟 flavor 走（与 build.js 对扩展的处置同源）：中国版读 dist-china 里那份
// （build.js 把 sync 关掉/换境内地址）；缺了就报错，不静默回落到东京。
function backendConfig(flavor) {
  if (flavor === 'china') {
    const cn = path.join(ROOT, 'dist-china', 'learn', 'backend.config.js');
    if (!fs.existsSync(cn)) {
      const e = new Error('中国版 CLI 需要先 `node build.js --flavor china`（缺 dist-china/learn/backend.config.js）');
      e.code = 'china_not_built'; throw e;
    }
    return withOverride(require(cn));
  }
  return withOverride(require(path.join(ROOT, 'extension/learn/backend.config.js')));
}

// 测试与自建后端用：`BM_BACKEND_URL` / `BM_BACKEND_ANON` 覆盖地址与 anon key，**只覆盖不回写**。
function withOverride(cfg) {
  const out = Object.assign({}, cfg);
  if (process.env.BM_BACKEND_URL) out.url = process.env.BM_BACKEND_URL;
  if (process.env.BM_BACKEND_ANON) out.anonKey = process.env.BM_BACKEND_ANON;
  return out;
}

function setup(corpus, opts) {
  opts = opts || {};
  const state = stateMod.load(opts.stateFile);

  global.chrome = stateMod.makeChrome(state);
  global.PageSettings = require(path.join(ROOT, 'extension/learn/page-settings.js'));
  global.LearnModel = require(path.join(ROOT, 'extension/content/learn-model.js'));
  global.LearnChunk = require(path.join(ROOT, 'extension/learn/chunk.js'));
  global.MT_BACKEND = backendConfig(opts.flavor || 'global');
  global.LearnStore = makeStore(corpus, state);

  const auth = require(path.join(ROOT, 'extension/learn/auth.js'));
  global.LearnAuth = auth;                       // sync.js 引用它
  const sync = require(path.join(ROOT, 'extension/learn/sync.js'));
  global.LearnSync = sync;

  return {
    auth, sync, store: global.LearnStore, state,
    backend: global.MT_BACKEND,
    saveState: () => stateMod.save(state),
  };
}

module.exports = { setup, backendConfig };
