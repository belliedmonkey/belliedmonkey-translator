// test/no-fab-marketing.test.js — 营销站不注入悬浮球（BEL-127）。
//
// Safari 内容脚本对 <all_urls> 注入，showFab 默认开，于是 belliedmonkey.cc 首页
// 右下角多出一颗猴，挡住 hero 末句。站点 HTML 自己没有这个按钮。
//
// 正则从 content-main.js 原样取出再判定，不在测试里重写一份。
// MT_SITES（指纹边界，只放行 www）必须保持更窄 —— 两条正则不许并成一条。
const { describe, test, ok, eq, loadModule } = require('./harness');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'content-main.js'), 'utf8');

const hostMatch = SRC.match(/const MT_NO_FAB_HOST = (\/.*?\/);/);
const MT_NO_FAB_HOST = hostMatch ? eval(hostMatch[1]) : null;
const sitesMatch = SRC.match(/const MT_SITES = (\/.*?\/);/);
const MT_SITES = sitesMatch ? eval(sitesMatch[1]) : null;

describe('营销站不注入悬浮球', () => {
  test('源码里有这条 host 判断，并且它挡住 FloatingButton.create', () => {
    ok(MT_NO_FAB_HOST, '找不到 MT_NO_FAB_HOST');
    const creates = SRC.match(/FloatingButton\.create\s*\(/g) || [];
    eq(creates.length, 1, 'create 应该只有一处，多出来的一处可能绕过 host 判断');
    ok(
      /if\s*\(\s*cfg\.showFab\s*&&\s*!MT_NO_FAB_HOST\.test\(location\.hostname\)\s*\)\s*\{[\s\S]*?FloatingButton\.create\s*\(/.test(SRC),
      'FloatingButton.create 必须包在 showFab && !MT_NO_FAB_HOST 里',
    );
  });

  test('apex、www、任意子域（预览域）都不画', () => {
    for (const h of [
      'belliedmonkey.cc', 'belliedmonkey.com',
      'www.belliedmonkey.cc', 'www.belliedmonkey.com',
      'preview.belliedmonkey.cc',
      'foo.bar.belliedmonkey.com',
      'git-main.belliedmonkey.cc',
    ]) {
      ok(MT_NO_FAB_HOST.test(h), h + ' 应当不注入悬浮球');
    }
  });

  test('别的网站照常画 —— 包括看起来像自家域名的', () => {
    for (const h of [
      'example.com', 'youtube.com', 'localhost', '',
      'notbelliedmonkey.cc',
      'evilbelliedmonkey.com',
      'belliedmonkey.cc.evil.com',
      'belliedmonkey.co',
      'belliedmonkey.cn',
      'sub.belliedmonkey.cn',
      'belliedmonkey.ccc',
    ]) {
      eq(MT_NO_FAB_HOST.test(h), false, h + ' 不该被当成营销站');
    }
  });

  test('指纹边界 MT_SITES 仍然只放行 www，没有被这条放宽', () => {
    ok(MT_SITES, 'MT_SITES 丢了');
    ok(MT_SITES.test('belliedmonkey.cc') && MT_SITES.test('www.belliedmonkey.com'));
    eq(MT_SITES.test('preview.belliedmonkey.cc'), false,
      '预览子域不许写入 data-mt-extension —— 那是指纹面');
    eq(String(MT_SITES), String(/^(www\.)?belliedmonkey\.(cc|com)$/));
  });

  test('setEnabled 不会在没 create 过的页面上把按钮补出来', () => {
    let appended = 0;
    const ctx = loadModule('floating-button.js', {
      document: {
        getElementById() { return null; },
        createElement() { return {}; },
        body: { appendChild() { appended += 1; } },
      },
      TranslationCore: { t(_k, fallback) { return fallback; } },
    });
    ctx.FloatingButton.setEnabled(true);
    eq(appended, 0, '弹窗 translatePage 走 setEnabled，营销站上不该因此长出 #mt-fab');
  });
});
