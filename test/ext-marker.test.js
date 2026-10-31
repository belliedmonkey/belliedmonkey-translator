// test/ext-marker.test.js — 官网探测标记的注入边界。
//
// 这个标记让页面能回答「扩展启用了没」—— iOS 上 App 自己查不到
// （getStateOfSafariExtension 是 macOS-only），所以官网的启用教程页靠它亮绿灯。
//
// 但它同时是一个**指纹面**：任何能读到它的网站，都知道用户装了这个扩展。
// 所以注入范围必须严格限定在自家域名。这条测试钉的是那个边界，不是功能。
const { describe, test, ok, eq } = require('./harness');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'content-main.js'), 'utf8');

// 把源码里那条正则原样取出来判定，而不是在测试里重写一遍 ——
// 重写一遍就变成「测试自己的正则」，源码改了它照样绿。
const m = SRC.match(/const MT_SITES = (\/.*?\/);/);
const MT_SITES = m ? eval(m[1]) : null;

describe('官网探测标记：注入范围就是安全边界', () => {
  test('源码里确实有这条判断（不是被顺手删掉了）', () => {
    ok(MT_SITES, '找不到 MT_SITES —— 标记若无条件注入，等于给所有网站开指纹面');
    ok(/dataset\.mtExtension/.test(SRC), '找不到标记写入');
  });

  test('自家域名命中', () => {
    for (const h of ['belliedmonkey.cc', 'www.belliedmonkey.cc',
                     'belliedmonkey.com', 'www.belliedmonkey.com']) {
      ok(MT_SITES.test(h), h + ' 应当命中');
    }
  });

  test('别人的域名一律不命中 —— 包括看起来很像的', () => {
    for (const h of [
      'example.com', 'youtube.com', 'x.com',
      'belliedmonkey.cc.evil.com',      // 后缀伪装
      'evil-belliedmonkey.cc',          // 前缀伪装
      'belliedmonkey.co',               // 少一个字母
      'sub.belliedmonkey.cc',           // 任意子域（只允许 www）
      'belliedmonkey.cn',
    ]) {
      eq(MT_SITES.test(h), false, h + ' 不该命中 —— 这是指纹面泄漏');
    }
  });

  test('标记写入被 try/catch 包住 —— 探测失败绝不能影响翻译', () => {
    const seg = SRC.slice(SRC.indexOf('MT_SITES.test(location.hostname)'));
    const body = seg.slice(0, seg.indexOf('const isYouTube'));
    ok(/try \{/.test(body) && /catch/.test(body),
      '标记写入必须 try/catch —— 它是附加功能，不能拖垮主路径');
  });
});
