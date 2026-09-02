// learn/app-link.js —— 「去 App 里复习」这一跳的**唯一**实现。
//
// 自定义 scheme 打不开时，浏览器什么都不做，也不报错。在装了 App 的 iPhone 上这
// 条链很顺；在电脑上点它常常是**一点反应都没有**（2026-09-02 用户在 Chrome 里
// 实测）—— 而「点了没反应」正是这个仓库反复付代价的那一类：出了问题，界面不说。
//
// 判据只能是间接的：scheme 被系统接走时，这一页会失去焦点/被切到后台。所以
//   ① 记下点击时刻，装上 visibilitychange / blur 的一次性监听；
//   ② 真的去跳；
//   ③ 到点了这一页还在前台、也没被隐藏过 —— 那就是没人接，把出口说出来。
// 反过来不成立的情况（用户点完立刻切了别的窗口）会被判成「打开了」，那是可接受
// 的方向：宁可少说一句，也不要在 App 明明打开了的时候还劝人去下载。
//
// 出口按平台分：Mac / iPhone / iPad 给 App Store；其它平台上这个 App 根本不存在，
// 说「去下载」就是假话 —— 那里只说清楚它在哪些设备上有，并且**留在浏览器里复习**
// 本来就是完整可用的。

var AppLink = (() => {
  // 两个 flavor 是两个上架条目（bundle id 不同，App Store id 也不同）。
  const STORE = { global: '6787190032', china: '6789718038' };

  function flavor() {
    return (typeof window !== 'undefined' && window.MT_FLAVOR === 'china') ? 'china' : 'global';
  }

  // scheme 也按 flavor 分：同名的话两版同时在场时由系统随机挑一个去接
  // （verification-spec §2.0 为「跑的是哪一份没有确定答案」付过代价）。
  function deepLink(userId) {
    const scheme = flavor() === 'china' ? 'belliedmonkeycn' : 'belliedmonkey';
    return scheme + '://review' + (userId ? '?uid=' + encodeURIComponent(userId) : '');
  }

  function storeUrl() {
    return 'https://apps.apple.com/app/id' + STORE[flavor()];
  }

  // 这台设备上到底有没有这个 App 可装。Apple 平台之外没有，别劝人去下载。
  function applePlatform() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const p = (typeof navigator !== 'undefined' && navigator.platform) || '';
    return /Mac|iPhone|iPad|iPod/i.test(ua + ' ' + p);
  }

  // 点一次。onFallback(kind) 在「没人接」时被调用，kind 是 'store' 或 'none'。
  // 调用方负责画那句话 —— 这里不碰 DOM，因为两个宿主（设置页 / 复习页）的版式
  // 不一样，而把版式塞进来就等于让这个文件知道两份布局。
  function open(userId, onFallback, waitMs) {
    let gone = false;
    const mark = () => { gone = true; };
    try {
      document.addEventListener('visibilitychange', mark, { once: true });
      window.addEventListener('blur', mark, { once: true });
              window.addEventListener('pagehide', mark, { once: true });
    } catch (_) { /* 监听不上就只能靠计时器，那时一定会走兜底 —— 方向是对的 */ }
    const url = deepLink(userId);
    setTimeout(() => {
      try {
        document.removeEventListener('visibilitychange', mark);
        window.removeEventListener('blur', mark);
        window.removeEventListener('pagehide', mark);
      } catch (_) {}
      if (gone || (typeof document !== 'undefined' && document.hidden)) return;
      try { onFallback(applePlatform() ? 'store' : 'none'); } catch (_) {}
    }, Math.max(400, Number(waitMs) || 1400));
    try { location.href = url; } catch (_) {}
    return url;
  }

  return { open, deepLink, storeUrl, applePlatform };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AppLink;
