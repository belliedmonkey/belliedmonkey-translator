// test/web-accessible.test.js — 内容脚本要打开的扩展页，必须列进 web_accessible_resources。
//
// 内容脚本里 `chrome.runtime.openOptionsPage()` 不存在（那不是它的 API 面），所以打开
// 扩展页只能自己导航过去。而浏览器会**拒绝**导航到没列进 web_accessible_resources 的
// 扩展页 —— Safari 报「网址无效」（#67，subtitle-adapter.js 的注释记着那一次）。
//
// 2026-09-01 又踩了一次：悬浮球在未配置时跳 `onboard/onboard.html`，而那一页不在清单里。
// 三道真浏览器门禁全绿 —— 因为它们从不在未配置状态下点悬浮球。这种漏法不会自己暴露：
// 页面打不开是**用户**才看得见的事，代码里没有任何东西会红。
//
// 所以判据放在这里：静态扫内容脚本里的 chrome.runtime.getURL('…')，逐个回清单里查。
// 它不依赖任何一次点击被测到。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

// 内容脚本 = manifest 的 content_scripts 里列出的每一个 js。
// 不扫 popup/options/onboard/review —— 那些是扩展页，不受这条限制。
function contentScriptFiles() {
  const out = new Set();
  for (const block of manifest.content_scripts || []) {
    for (const rel of block.js || []) out.add(rel);
  }
  return [...out];
}

// 清单里被声明为可访问的资源（不看 matches：只要没列进去，任何页面都打不开它）。
function accessible() {
  const out = new Set();
  for (const block of manifest.web_accessible_resources || []) {
    for (const r of block.resources || []) out.add(r);
  }
  return out;
}

describe('内容脚本能打开的扩展页，必须在 web_accessible_resources 里', () => {
  const files = contentScriptFiles();
  const listed = accessible();

  test('扫到了内容脚本 —— 扫不到东西的断言不是门禁', () => {
    ok(files.length >= 5, `只从 manifest 读到 ${files.length} 个内容脚本，读法走歪了？`);
    ok(listed.size >= 1, 'web_accessible_resources 是空的？');
  });

  test('每一个 getURL 到的扩展页都被声明了', () => {
    const bad = [];
    for (const rel of files) {
      const p = path.join(EXT, rel);
      if (!fs.existsSync(p)) { bad.push(`${rel} 在 manifest 里但文件不存在`); continue; }
      const src = fs.readFileSync(p, 'utf8');
      // chrome.runtime.getURL('x') —— 只挑指向页面/资源的字符串字面量。
      for (const m of src.matchAll(/chrome\.runtime\.getURL\(\s*'([^']+)'/g)) {
        const target = m[1];
        if (listed.has(target)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        bad.push(`${rel}:${line} 打开 ${target}，但它不在 web_accessible_resources 里`
          + ' —— 浏览器会拒绝这次导航，Safari 报「网址无效」');
      }
    }
    eq(bad.length, 0, '\n  ' + bad.join('\n  '));
  });

  test('声明了的资源都真的存在 —— 列一个不存在的路径等于没列', () => {
    const missing = [...listed].filter((r) => !r.includes('*') && !fs.existsSync(path.join(EXT, r)));
    eq(missing.length, 0, 'web_accessible_resources 里的这些文件不存在：' + missing.join(', '));
  });
});
