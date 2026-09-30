// cli/state.js — 命令行宿主的「设备存储」（learning-design §9.10 / §8.4.1）。
//
// 扩展与 App 的会话、learnRules、同步台账都住在 `chrome.storage.local` / IndexedDB 里。
// CLI 没有这些，于是给 `chrome.storage.local` 一个**文件后端**：`state.json`（0600）。
//
// **凭证在这里，明文，与扩展同级** —— `learning-design` §7.2 规则 3 的既有事实：
// 扩展的 `chrome.storage.local` 与 App 的 `localStorage` 也都是明文，这里不假装更安全。
// 文件 0600，且 `BM_STATE` / `XDG_CONFIG_HOME` 可改位置。同步台账（`meta`）也放同一文件。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveFile(p) {
  if (p) return path.resolve(p);
  if (process.env.BM_STATE) return path.resolve(process.env.BM_STATE);
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'belliedmonkey', 'state.json');
}

function load(file) {
  const f = resolveFile(file);
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { raw = {}; }
  return {
    file: f,
    storage: (raw && typeof raw.storage === 'object' && raw.storage) ? raw.storage : {},
    meta: (raw && typeof raw.meta === 'object' && raw.meta) ? raw.meta : {},
  };
}

function save(state) {
  const out = { storage: state.storage, meta: state.meta };
  fs.mkdirSync(path.dirname(state.file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(state.file, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(state.file, 0o600); } catch (_) { /* 平台不支持就算了 */ }
  return state.file;
}

// 一个够 page-settings.js / auth.js / chunk.js 用的 `chrome`：get/set/remove 都支持
// 回调式与 Promise 式（与 app/ext-shim.js、cli/node-shim.js 同一形状），每次写都落盘。
function makeChrome(state) {
  const persist = () => save(state);
  const select = (query) => {
    if (query == null) return Object.assign({}, state.storage);
    const list = Array.isArray(query) ? query : (typeof query === 'string' ? [query] : Object.keys(query));
    const out = {};
    for (const k of list) {
      if (Object.prototype.hasOwnProperty.call(state.storage, k)) out[k] = state.storage[k];
      else if (query && !Array.isArray(query) && typeof query === 'object' && k in query) out[k] = query[k];
    }
    return out;
  };
  const local = {
    get(query, cb) {
      const out = select(query);
      if (typeof cb === 'function') { cb(out); return undefined; }
      return Promise.resolve(out);
    },
    set(items, cb) {
      Object.assign(state.storage, items || {});
      persist();
      if (typeof cb === 'function') { cb(); return undefined; }
      return Promise.resolve();
    },
    remove(keys, cb) {
      for (const k of (Array.isArray(keys) ? keys : [keys])) delete state.storage[k];
      persist();
      if (typeof cb === 'function') { cb(); return undefined; }
      return Promise.resolve();
    },
  };
  return {
    storage: { local, onChanged: { addListener() {}, removeListener() {} } },
    // `lastError` 必须存在且为 null：page-settings.js 的回调分支会读它。
    runtime: { getURL: () => '', lastError: null },
  };
}

module.exports = { load, save, makeChrome, resolveFile };
