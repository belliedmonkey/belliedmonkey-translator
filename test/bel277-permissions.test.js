// test/bel277-permissions.test.js — BEL-277 的发布面硬约束：零新权限。
//
// 用户装的是一个**已上架**扩展。BEL-277 只改遥测走 SW、菜单静态注入，两者都不
// 需要新权限；一旦 permissions / host_permissions 变一个字符，商店会当成一次
// 权限变更重新征求授权（已安装用户被要求「重新授权」）。所以这里把 base
// e22fa91346c5cb5d0cf867ebbb12004224cd8968 的两个数组逐字钉死。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const manifestPath = path.join(ROOT, 'extension', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// base e22fa913 的原文（数组顺序也算 —— 商店 diff 按数组比）。
const BASE = {
  permissions: ['storage', 'activeTab'],
  host_permissions: ['<all_urls>'],
};

describe('BEL-277 — 权限零 diff（base e22fa913）', () => {
  test('permissions 与 base 逐字一致', () => {
    deepEq(manifest.permissions, BASE.permissions,
      'permissions 变了 —— 已安装用户会被重新要求授权；BEL-277 不需要任何新权限');
  });

  test('host_permissions 与 base 逐字一致', () => {
    deepEq(manifest.host_permissions, BASE.host_permissions,
      'host_permissions 变了 —— 商店按权限变更处理；BEL-277 不需要任何新 host');
  });

  test('直接对 base e22fa913 的 git 原文再比一次（history 可用时）', () => {
    let base = null;
    try {
      base = JSON.parse(execFileSync('git', ['show', 'e22fa91346c5cb5d0cf867ebbb12004224cd8968:extension/manifest.json'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch (_) { /* shallow checkout / 无 history：上两条硬编码断言仍然生效 */ }
    if (!base) return;
    deepEq(manifest.permissions, base.permissions, 'permissions 与 base e22fa913 不同');
    deepEq(manifest.host_permissions, base.host_permissions, 'host_permissions 与 base e22fa913 不同');
  });

  test('没有 scripting（也不许用 chrome.scripting 绕开静态注入）', () => {
    ok(!(manifest.permissions || []).includes('scripting'), 'permissions 出现 scripting');
    ok(!(manifest.optional_permissions || []).includes('scripting'), 'optional_permissions 出现 scripting');
    const src = fs.readFileSync(manifestPath, 'utf8');
    eq(/chrome\.scripting/.test(src), false, 'manifest 源码出现 chrome.scripting');
    const contentDir = path.join(ROOT, 'extension', 'content');
    for (const f of fs.readdirSync(contentDir)) {
      if (!/\.js$/.test(f)) continue;
      eq(/chrome\.scripting/.test(fs.readFileSync(path.join(contentDir, f), 'utf8')), false,
        `content/${f} 用了 chrome.scripting`);
    }
  });

  test('遥测不需要新权限：SW 代发只用已有 host_permissions', () => {
    // 这条是解释性断言：SW 的 fetch 受扩展 host_permissions 管；<all_urls> 已在 base。
    ok(manifest.host_permissions.includes('<all_urls>'),
      'SW 代发依赖已有的 <all_urls>；如果以后收窄 host_permissions，这条要重新评估');
  });
});
