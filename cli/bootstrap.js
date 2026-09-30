// cli/bootstrap.js — 给「账号 / 同步 / 免费额度」这套装上运行环境。
//
// 在 cli/sync-runtime.js 的基础上多做两件：
//   1. 载入当前 flavor 的生成注册表（providers.gen.js）—— 它顺带发射 `MT_GRANT`，而
//      Registry.grant() 读的就是它。不载它就等于「这个版本没有免费额度」。
//   2. 挂上 grant.js（src/shared/grant.js 的编译产物）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { setup } = require('./sync-runtime.js');

// providers.gen.js 用 `window.X = ...` 写值；Node 里先给 window 一个名字。
// 生成物跟 flavor 走（中国版在 dist-china/），缺了中国版那句「没有代领额度」才成立。
function loadRegistries(flavor) {
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
  const p = flavor === 'china'
    ? path.join(ROOT, 'dist-china', 'content', 'providers.gen.js')
    : path.join(ROOT, 'extension', 'content', 'providers.gen.js');
  require(p);
  // 领取端点的测试 / 自建覆盖（同 BM_BACKEND_URL 的形状）：只覆盖，不回写产物。
  if (process.env.BM_GRANT_CLAIM_URL && globalThis.MT_GRANT) {
    globalThis.MT_GRANT = Object.assign({}, globalThis.MT_GRANT, { claimUrl: process.env.BM_GRANT_CLAIM_URL });
  }
}

function boot(corpus, opts) {
  const rt = setup(corpus, opts);
  loadRegistries(opts && opts.flavor);
  rt.grant = require('./grant.js').load();
  return rt;
}

module.exports = { boot, loadRegistries };
