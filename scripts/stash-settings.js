// scripts/stash-settings.js — 验证脚本**借用**设置前后的保存/还原（仓库内的那一份）。
//
// 为什么必须有：Debug 包与用户装的正版**同 bundle id ⇒ 共用容器**（见 test-mac.js 头部
// 「两个环境事实」）。2026-10-08 吃过两次：脚本为了量音频写 `listenAutoSpeak:false`，
// 把用户自己的「自动朗读译文」关掉，看起来像功能回归；`verify-listen-flash.js` 与 `test-mac.js`
// 还会把语言对钉成 zh/th。**跑完必须原样还回去。**
//
// 这份放在 `scripts/` 而不是 `.local/`：`.local/` 是 gitignored 的本地目录，仓库脚本不能依赖它。
// `.local/lid-yt/stash.js` 是同一份实现（本地脚本用），两边接口一致。
'use strict';
// 开发开关全部纳入（G-04）：**跑测试前不存在、跑完也必须不存在**。
//   lidEngine / lidThreshold / lidCpuOnly / lidTrace —— LID 的开发键（listen-model.js 的 LID_DEV_KEYS）
//   pttSilenceMs —— 按住说「锁定后静音自动结束」的秒数（默认 8000）
// 少一个的代价是实打实的：脚本为了量数据写进去，用户的容器里就多出一个设置界面上看不见的键。
const KEYS = ['listenMyLang', 'listenOtherLang', 'listenAutoSpeak', 'listenLangManual', 'subtitleVideoLang',
  'lidEngine', 'lidThreshold', 'lidCpuOnly', 'lidTrace', 'pttSilenceMs'];

function stashInit(ev) {
  // 在读之前先把原值抓下来（没设过就记 undefined，还原时删掉这个键 —— 与「未设 = 默认」等价）
  return ev(`window.__stash=null; chrome.storage.local.get(${JSON.stringify(KEYS)},(r)=>{window.__stash=r;}); true`)
    .then(() => new Promise((r) => setTimeout(r, 400)))
    .then(() => ev('JSON.stringify(window.__stash)'));
}
function stashRestore(ev) {
  return ev(`(function(){const o=window.__stash||{}; const del=[], set={};
    ${JSON.stringify(KEYS)}.forEach((k)=>{ if (o[k]===undefined||o[k]===null) del.push(k); else set[k]=o[k]; });
    chrome.storage.local.remove(del,()=>{ if (Object.keys(set).length) chrome.storage.local.set(set,()=>{}); }); })(); true`);
}
module.exports = { stashInit, stashRestore, KEYS };
