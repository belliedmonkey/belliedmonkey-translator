// test/app-link.test.js — 「去 App 里复习」这一跳的宿主门。
//
// 2026-09-06 报障：宿主 App 的复习页头出现了「在 App 里继续复习 →」—— 人已经在 App 里了。
// review.js 与 App 共用同一份字节，按钮只看「后端开着 + 已登录」，从没判过宿主。
// 宿主真值只有一个：build/app-bundle.js 在 Script.js 头部写 `window.MT_HOST = 'app'`；
// 不能放进 chrome-shim.js —— test:learn 把垫片也注入扩展复习页那个宿主。
const { loadModule, describe, test, ok, eq, match } = require('./harness');

describe('AppLink.inApp — 宿主判定', () => {
  test('没有宿主标记时不是 App（扩展复习页、扩展设置页）', () => {
    const A = loadModule('learn/app-link.js', { window: {}, navigator: { userAgent: '', platform: '' } }).AppLink;
    eq(typeof A.inApp, 'function');
    eq(A.inApp(), false);
  });
  test('window.MT_HOST === "app" 时是 App', () => {
    const A = loadModule('learn/app-link.js', { window: { MT_HOST: 'app' }, navigator: { userAgent: '', platform: '' } }).AppLink;
    eq(A.inApp(), true);
  });
  test('其它值不算（别把 typo 当成 App）', () => {
    const A = loadModule('learn/app-link.js', { window: { MT_HOST: 'App' }, navigator: { userAgent: '', platform: '' } }).AppLink;
    eq(A.inApp(), false);
  });
});

describe('build/app-bundle.js — Script.js 头部带宿主标记', () => {
  test('生成的 App 包第一段可执行代码就是 window.MT_HOST = "app"', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { buildAppBundle } = require('../build/app-bundle.js');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-app-bundle-'));
    buildAppBundle(out, () => {}, {});
    const js = fs.readFileSync(path.join(out, 'Script.js'), 'utf8');
    // 去掉头部注释与空行后的第一行。放最前面：review.js 在 bundle 加载时就会调 renderGoApp。
    const firstCode = js.split('\n').find((l) => l.trim() && !l.trim().startsWith('//'));
    match(firstCode || '', /^window\.MT_HOST = 'app';/);
    ok(js.indexOf('// ─── app/chrome-shim.js') > js.indexOf("window.MT_HOST = 'app';"), '标记必须在垫片之前');
  });
});
