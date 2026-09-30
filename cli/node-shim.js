// cli/node-shim.js — 命令行宿主在 Node 里的垫片（learning-design §9.10 / domain-design §2.7）。
//
// 这是 `build/cli-bundle.js` 拼进 `engine.js` 的**第一个**模块：后面那些
// （engine-state / wire-format / request-shape / translation-api）在加载期就会读 `chrome`，
// 晚一行就 undefined。
//
// **只提供那些模块在加载期真的需要的东西。** Node 20 自带 fetch / AbortController /
// setTimeout / atob / FormData / Blob / Buffer，全部照用，不重写 —— 这正是 CLI 比
// JavaScriptCore 那一份（app/ext-shim.js）短得多的原因。
//
// **chrome.runtime.sendMessage 故意缺席。** translation-api 的「后台在吗」探针会去调它，
// 抛错即判后台不可达 ⇒ 走直连（app/ext-shim.js、app/chrome-shim.js 同一形状）。CLI 里
// 本来就没有 service worker，让探针如实失败，比假装有一个再让每段干等 20 秒好。
'use strict';

(function (g) {
  // ── window ────────────────────────────────────────────────────────────────
  // 那些 IIFE 写的是 `window.X = ...` / 读 `window.MT_PROVIDERS`。Node 没有 `window` 这个名字。
  if (typeof g.window === 'undefined') g.window = g;

  // ── 这个进程的自称 ─────────────────────────────────────────────────────────
  // 与 App 包的 'app'、扩展包的 'ext' 同一条：谁在跑，代码要能问得出来（遥测据此决定发不发）。
  g.MT_HOST = 'cli';

  // ── chrome.storage.local ──────────────────────────────────────────────────
  // 启动器在 require 本包**之前**把配置快照写进 `global.__mtSeed`（cli/config.js 的 load()）。
  // 这里读它、拷一份进内存；`__mtStore` 是**同步读口**，给 cli/entry.js 用（Node 里没有理由
  // 为一次读绕 Promise）。写入只落内存 —— 配置的真源在磁盘，由 cli/config.js 负责落盘。
  const seed = (typeof g.__mtSeed === 'object' && g.__mtSeed) ? g.__mtSeed : {};
  const store = Object.assign({}, seed);
  g.__mtStore = store;

  const pick = (keys) => {
    if (keys == null) return Object.assign({}, store);
    const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
    const out = {};
    for (const k of list) {
      if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
      else if (keys && !Array.isArray(keys) && typeof keys === 'object') out[k] = keys[k];  // 默认值形式
    }
    return out;
  };
  // 回调式与 Promise 式都要支持：那几个模块两种写法都有（RequestShape.storageGet 走回调）。
  const dual = (fn) => function (arg, cb) {
    const v = fn(arg);
    if (typeof cb === 'function') { cb(v); return undefined; }
    return Promise.resolve(v);
  };
  g.chrome = g.chrome || {};
  g.chrome.storage = g.chrome.storage || {};
  g.chrome.storage.local = {
    get: dual(pick),
    set: dual((obj) => { Object.assign(store, obj || {}); return undefined; }),
    remove: dual((keys) => {
      for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
      return undefined;
    }),
  };
  // onChanged：有人挂监听不该抛，但永远不会触发（CLI 一次命令一个进程，没有第二个写入者）。
  g.chrome.storage.onChanged = g.chrome.storage.onChanged || { addListener() {}, removeListener() {} };

  // ── chrome.runtime ────────────────────────────────────────────────────────
  // 只给 getURL。**不给 sendMessage** —— 见文件头：探针抛错即判后台不可达，走直连。
  g.chrome.runtime = g.chrome.runtime || { getURL: () => '' };
}(typeof globalThis !== 'undefined' ? globalThis : this));
