// test/content-ui.test.js — content 注入 UI 的结构门（BEL-277 修订）。
//
// 判据都是「文件/清单里有什么」，不是「页面上画了什么」—— 页面行为由
// scripts/verify-content-menu.js（真 Chrome，isolated world 里静态 host + 开/关菜单）
// 与 test/bel277-submenu.test.js（vm 里的 host / DOM 回退）负责。
//
// BEL-277 把 PR8a 的懒加载 ESM 边界翻成**静态 IIFE**：
//   · content/sub-menu.bundle.js 必须出现在 manifest 的 content_scripts 里；
//   · 不允许 import(...) / chrome.scripting / WAR 依赖；
//   · 匹配范围必须有界（不许 <all_urls>），且覆盖字幕适配器的宿主；
//   · 静态宿主失败时 adapter 还能画 DOM 回退菜单。
'use strict';
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const manifestPath = path.join(ROOT, 'extension', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = require('../build/ui-entries.config.js').ENTRIES;
const BUNDLE = 'content/sub-menu.bundle.js';

function contentSources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...contentSources(p));
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('content-ui — 字幕菜单静态 IIFE 边界', () => {
  const entry = entries.find((e) => e.out === BUNDLE);
  const block = (manifest.content_scripts || []).find((b) => (b.js || []).includes(BUNDLE));

  test('登记处：IIFE 入口 + globalName（静态条目靠 isolated-world 全局见面）', () => {
    ok(entry, `ui-entries.config.js 缺 ${BUNDLE} 条目`);
    eq(entry.format, 'iife', '静态注入的产物必须是 IIFE');
    eq(entry.globalName, 'MTSubMenuBundle', 'globalName 丢了 —— adapter 读不到 host');
  });

  test('manifest：静态 content_scripts 条目存在，且 run_at/all_frames 与字幕适配器一致', () => {
    ok(block, `${BUNDLE} 不在 manifest content_scripts —— 静态条目没接上`);
    eq(block.run_at, 'document_idle');
    eq(block.all_frames, true, 'YouTube 的 iframe 字幕也要菜单，all_frames 必须是 true');
  });

  test('匹配范围有界：不许 <all_urls>，且覆盖 YouTube / X / podcast 已知宿主', () => {
    const matches = block.matches || [];
    ok(!matches.includes('<all_urls>'), '菜单 bundle 不许 <all_urls>（有界列表是这张票的边界）');
    for (const want of [
      '*://*.youtube.com/*',
      '*://*.youtube-nocookie.com/*',
      '*://*.x.com/*',
      '*://*.twitter.com/*',
      '*://open.spotify.com/*',
      '*://podcasts.apple.com/*',
      '*://*.substack.com/*',
    ]) ok(matches.includes(want), `bounded 列表缺 ${want}`);
  });

  test('菜单 bundle 不再在 web_accessible_resources（动态 import 的依赖已删）', () => {
    const war = JSON.stringify(manifest.web_accessible_resources || []);
    eq(war.includes(BUNDLE), false, `${BUNDLE} 还挂在 WAR —— 动态 import 路径没删干净`);
  });

  test('content 源码零 import( / 零 chrome.scripting', () => {
    const files = contentSources(path.join(ROOT, 'extension', 'content'));
    const offenders = files.filter((f) => /\bimport\s*\(/.test(fs.readFileSync(f, 'utf8')));
    deepEq(offenders.map((f) => path.relative(ROOT, f)), [],
      'content 源码里还有动态 import —— 静态条目之后它没有存在的理由');
    const all = JSON.stringify(manifest);
    ok(!/chrome\.scripting/.test(all), 'manifest 里出现 chrome.scripting');
    for (const f of files) {
      ok(!/chrome\.scripting/.test(fs.readFileSync(f, 'utf8')), `${path.relative(ROOT, f)} 用了 chrome.scripting`);
    }
    ok(!(manifest.permissions || []).includes('scripting'), 'permissions 里出现 scripting');
  });

  test('subtitle-adapter.js：菜单行判据留在旧侧，bundle 只拿行数据', () => {
    const t = fs.readFileSync(path.join(ROOT, 'extension', 'content', 'subtitle-adapter.js'), 'utf8');
    for (const key of ['yt_mode_both', 'yt_mode_trans', 'yt_mode_orig', 'yt_download_srt', 'asr_stop', 'yt_display_type']) {
      ok(t.includes(`'${key}'`), `菜单文案键 ${key} 从 adapter 消失了 —— 行判据必须留在旧侧`);
    }
    ok(t.includes('MTSubMenuBundle'), '静态 host 的读取点丢了');
    ok(t.includes('_openFallbackMenu') && t.includes('openFallbackMenu'), 'DOM 回退菜单丢了 —— 静态条目失败时菜单必须还能开');
    eq(t.includes('getURL(\'content/sub-menu.bundle.js\')'), false, '动态 import 的 getURL 没删干净');
  });

  // 注入面保留命令式的前提之一是零 Trusted Types 写入汇 —— 这里把「没有」钉成不变量。
  test('content 注入面零 HTML 写入汇 —— 回潮即红', () => {
    const files = ['subtitle-adapter.js', 'content-youtube.js', 'content-podcast.js', 'content-twitter.js', 'content-webpage.js', 'dom-processor.js'];
    for (const f of files) {
      const t = fs.readFileSync(path.join(ROOT, 'extension', 'content', f), 'utf8');
      eq(/\b(?:innerHTML|outerHTML)\s*\+?=[^=]/.test(t), false, `${f} 出现 HTML 写入汇（赋值）`);
      eq(/insertAdjacentHTML|document\.write\s*\(/.test(t), false, `${f} 出现 HTML 写入汇`);
    }
  });

  test('floating-button.js 不再走 innerHTML（Trusted Types 面），ABI 原样', () => {
    const t = fs.readFileSync(path.join(ROOT, 'extension', 'content', 'floating-button.js'), 'utf8');
    eq(t.includes('innerHTML'), false, 'floating-button.js 里还有 innerHTML —— 注入面 TT 隐患回潮');
    ok(t.includes('createElementNS'), 'FAB SVG 应走 createElementNS');
    for (const fn of ['create', 'setEnabled', 'remove', 'showTranslateChip']) {
      ok(new RegExp(`\\b${fn}\\b`).test(t), `FloatingButton.${fn} 不见了 —— content-main.js 的调用 ABI 破坏`);
    }
  });
});
