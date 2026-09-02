// test/device.test.js —— 「这是手机、平板还是电脑」只有一份判据。
//
// 起因：popup 与引导页是照着手机排的，在电脑上就是一个被放大的手机界面
// （2026-09-02 用户在 Chrome 里报了两次）。给桌面另一套版式，先得能说出这是不是
// 桌面 —— 而第一版用的是 CSS 的 `pointer: fine`，**接了妙控键盘的 iPad 也报 fine**。
//
// 这一组守三件事：
//   ① 九种真实设备形状判对，尤其是「iPadOS 把自己报成 Macintosh」那一种；
//   ② 没有 userAgentData 时（Safari / Firefox）仍然判得出来 —— 它是 Chromium 独有的；
//   ③ 拿不准时**偏向平板**：判错成平板的代价是一套更松的版式，判错成桌面的代价是
//      手指点不中的按钮。

const path = require('path');
const { loadModule, describe, test, eq, ok } = require('./harness');

const D = loadModule(['content/device.js'], {}).Device;

const CASES = [
  ['Chrome · Mac', 'desktop',
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140',
      maxTouchPoints: 0, userAgentData: { mobile: false } }],
  ['Safari · Mac（无 userAgentData）', 'desktop',
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18 Safari/605',
      maxTouchPoints: 0 }],
  ['Safari · iPhone', 'phone',
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605',
      maxTouchPoints: 5 }],
  // 这一条是整组的核心：iPadOS 13 起 Safari 的 UA 与桌面 Mac 逐字相同，
  // 唯一的区别是 Mac 没有触摸屏。判错的话，iPad 会拿到给鼠标排的版式。
  ['Safari · iPad（UA 装成 Mac）', 'tablet',
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18 Safari/605',
      maxTouchPoints: 5 }],
  ['Safari · iPad（老 UA）', 'tablet',
    { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/605', maxTouchPoints: 5 }],
  ['Chrome · 安卓手机', 'phone',
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) Mobile Chrome/140',
      maxTouchPoints: 5, userAgentData: { mobile: true } }],
  // 安卓平板报的是 mobile:false —— userAgentData 只回答「是不是手机」。
  ['Chrome · 安卓平板', 'tablet',
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Tab) Chrome/140',
      maxTouchPoints: 5, userAgentData: { mobile: false } }],
  ['Firefox · Windows', 'desktop',
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko Firefox/130', maxTouchPoints: 0 }],
  ['触屏 Windows 笔记本', 'desktop',
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140',
      maxTouchPoints: 10, userAgentData: { mobile: false } }],
];

describe('设备判别', () => {
  for (const [name, want, nav] of CASES) {
    test(name + ' → ' + want, () => { eq(D.classOf(nav), want); });
  }

  test('拿不准时偏向平板，不偏向桌面', () => {
    // 有触摸、没有 userAgentData、UA 谁也不像 —— 这种情况下判成桌面会给出
    // 手指点不中的按钮，判成平板只是版式松一点。
    eq(D.classOf({ userAgent: 'SomeKiosk/1.0', maxTouchPoints: 10 }), 'tablet');
  });

  test('navigator 缺席时不抛，回落桌面', () => {
    eq(D.classOf(null), 'desktop');
  });

  test('apply() 把结果写在 <html data-device> 上', () => {
    let set = null;
    const doc = { documentElement: { setAttribute: (k, v) => { set = [k, v]; } } };
    const c = D.apply(doc, { userAgent: 'Mozilla/5.0 (iPhone)', maxTouchPoints: 5 });
    eq(c, 'phone');
    eq(set[0], 'data-device');
    eq(set[1], 'phone');
  });
});

describe('两个页面用的是这一份判据，不是自己写的媒体查询', () => {
  const fs = require('fs');
  const ROOT = path.join(__dirname, '..');
  for (const [css, html] of [['onboard/onboard.css', 'onboard/onboard.html'],
                             ['popup/popup.css', 'popup/popup.html']]) {
    test(css + ' 的桌面版式按 data-device 出', () => {
      const s = fs.readFileSync(path.join(ROOT, 'extension', css), 'utf8');
      ok(s.includes('[data-device="desktop"]'), css + ' 里没有 data-device 选择器');
      // `pointer: fine` 是被这一版替换掉的那个近似 —— 它回来就说明有人绕过了判据。
      ok(!/@media[^{]*pointer:\s*fine/.test(s),
        css + ' 又出现了 `pointer: fine` 媒体查询 —— 接了键盘的 iPad 会被判成桌面');
    });
    test(html + ' 在首帧之前打标记', () => {
      const s = fs.readFileSync(path.join(ROOT, 'extension', html), 'utf8');
      const head = s.slice(0, s.indexOf('</head>'));
      ok(head.includes('content/device.js'), html + ' 的 <head> 里没有 device.js');
      ok(head.includes('Device.apply('), html + ' 没有在 <head> 里调用 Device.apply');
    });
  }
});
