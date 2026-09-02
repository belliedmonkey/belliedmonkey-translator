// content/device.js —— 这台设备是手机、平板还是电脑。**唯一**判据实现。
//
// 为什么需要它：popup 与引导页是照着手机排的（窄列、整幅宽的按钮、竖着叠的卡）。
// 在电脑上打开就是「一个被放大的手机界面」（2026-09-02 用户在 Chrome 里报的）。
// 要给桌面另一套版式，先得能说出「这是不是桌面」。
//
// 为什么不用 CSS 的 `pointer: fine` 了事：接了妙控键盘的 iPad 也报 `fine`，会被判成
// 桌面，然后拿到一套给鼠标排的版式，而它的主输入仍然是手指。
//
// 分层，按可靠性从高到低（每一层都在它成立的地方才被采信）：
//
//   ① navigator.userAgentData.mobile —— 最直接，但 **Chromium 独有**
//      （MDN：limited availability / not Baseline；Safari 与 Firefox 都没有）。
//      而且它只回答「是不是手机」：安卓平板报的是 mobile:false。
//   ② UA 里的 iPhone / iPod / Android+Mobile —— 手机。
//   ③ iPad：UA 里有 iPad，**或者** UA 像 Mac 却能多点触控。后半句不是启发式而是
//      事实的组合：iPadOS 13 起 Safari 把自己报成 Macintosh，而 Mac 没有触摸屏。
//      判据用 maxTouchPoints（Baseline，2020-07 起全浏览器可用）。
//   ④ 安卓但 UA 里没有 Mobile —— 平板（安卓自己的约定）。
//   ⑤ 到这里还没定：maxTouchPoints === 0 就是电脑；否则当平板。
//      最后这一步**偏向平板**是刻意的：判错成平板的代价是一套更松的版式，
//      判错成桌面的代价是手指点不中的按钮。
//
// 不做 UA 版本嗅探，不做屏幕尺寸阈值 —— 尺寸是窗口的属性，不是设备的属性。

var Device = (() => {
  function classOf(nav) {
    const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (!n) return 'desktop';
    const ua = String(n.userAgent || '');
    const mtp = Number(n.maxTouchPoints) || 0;
    const uad = n.userAgentData;

    if (uad && uad.mobile === true) return 'phone';
    if (/iPhone|iPod/.test(ua)) return 'phone';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'phone' : 'tablet';
    if (/iPad/.test(ua)) return 'tablet';
    if (/Mac/.test(ua) && mtp > 1) return 'tablet';     // iPadOS 假装成 Mac
    if (uad && uad.mobile === false) return 'desktop';
    return mtp === 0 ? 'desktop' : 'tablet';
  }

  // 把结果写到 <html data-device>，CSS 按它出版式。要在首帧之前调用，否则会闪一下。
  function apply(doc, nav) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.documentElement) return '';
    const c = classOf(nav);
    try { d.documentElement.setAttribute('data-device', c); } catch (_) {}
    return c;
  }

  return { classOf, apply };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Device;
