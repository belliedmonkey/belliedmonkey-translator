// app/native-audio.js — 宿主原生音频能力的适配器（§9.5「后台与锁屏播放」）。
//
// 它包住 App 原生壳提供的那一条消息通道，让播客模式能做到三件事：让 App 在不可见时
// 继续出声、把锁屏/车机/媒体键的命令收进来、把「现在在念哪一句」推到锁屏与控制中心。
//
// ── 为什么是独立模块而不是写进 driving.js ───────────────────────────────────
// 这是**宿主能力适配器**，和 `content/lang-detect.js` 的定位一样：能力探测只有一个
// 地方知道，播放器本身从不去问「我跑在什么里」（domain-design §5.3 —— 适配器注入，
// 引擎不自己探测）。另外 driving.js 已经七百多行。
//
// ── 能力语义：桥不在就是不在 ────────────────────────────────────────────────
// Chrome 里的 test:learn、扩展页、任何非宿主环境下 `available()` 为 false，其余方法
// 全是干净的 no-op —— 不报错、不 log、不在界面上多一个字。今天的行为原样保留。
//
// ── 必须挂在 window 上 ──────────────────────────────────────────────────────
// 原生侧靠 `evaluateJavaScript("window.NativeAudio && …")` 回话。转换器模板自带的
// `show('ios')` 就是反面教材：`app/app.js` 的 `show` 在 IIFE 里、从来不是全局，
// 于是那一句一直在静默抛 ReferenceError（`evaluateJavaScript` 没有 completion
// handler，错误无人接）。这条通道**从没通过**，所以这里不假设它「本来就通」。
var NativeAudio = (() => {
  // 通道名。原生的 `MTAudioBridge.channel` 与 sync-app-assets.js 的 install 行必须
  // 用同一个字符串 —— npm test 有一条断言钉住这三处。
  const CHANNEL = 'mtAudio';

  // 协议。导出是为了让契约测试能拿这两组字符串去和 .swift 里的 case 对表：
  // 一边改名而另一边没跟上，表现是「遥控键按了没反应」，查起来极贵。
  const PROTOCOL = {
    toNative: ['session-start', 'session-stop', 'now-playing', 'playing-state'],
    fromNative: ['session-ready', 'session-failed', 'remote', 'interrupt', 'route'],
  };

  let ready = false;
  let platform = '';
  // 这个宿主会不会在 App 不可见时挂起进程。由原生报（iOS 会，macOS 不会），不靠嗅
  // UA —— §5.3 规则 2 禁止用 UA 做能力判断，而这正是一个平台能力问题。
  // 未知时按**最保守**的 true 处理：宁可多暂停一次，也不要承诺一个不存在的后台。
  let suspends = true;
  let listener = null;
  // 上一次推给原生的 payload，按 JSON 串去重。paint() 每次重绘都会调，而绝大多数重绘
  // 什么都没变；每一次过桥都是一次 evaluateJavaScript 往返。
  let lastNowPlaying = '';
  let lastPlaying = null;

  // 每次现取，不在加载时缓存：宿主注册 handler 与页面加载谁先谁后不由我们决定。
  function port() {
    try { return (window.webkit.messageHandlers[CHANNEL]) || null; } catch (_) { return null; }
  }

  function available() { return !!port(); }

  function post(payload) {
    const p = port();
    if (!p) return false;
    try { p.postMessage(payload); return true; } catch (_) { return false; }
  }

  function sessionStart() {
    if (!available()) return false;
    ready = false;
    lastNowPlaying = ''; lastPlaying = null;
    return post({ type: 'session-start' });
  }

  function sessionStop() {
    ready = false;
    lastNowPlaying = ''; lastPlaying = null;
    return post({ type: 'session-stop' });
  }

  // 锁屏/控制中心上的三行字。**全部由调用方传进来**，这个模块和原生侧都不持有文案
  // —— 同 `LearnDriving.notesToSpeech(notes, labels)` 的纪律。
  function nowPlaying(info) {
    const payload = {
      type: 'now-playing',
      title: String((info && info.title) || ''),
      subtitle: String((info && info.subtitle) || ''),
      album: String((info && info.album) || ''),
      index: Number((info && info.index) || 0),
      count: Number((info && info.count) || 0),
    };
    const key = JSON.stringify(payload);
    if (key === lastNowPlaying) return false;
    lastNowPlaying = key;
    return post(payload);
  }

  function playingState(playing) {
    const v = !!playing;
    if (v === lastPlaying) return false;
    lastPlaying = v;
    return post({ type: 'playing-state', playing: v });
  }

  // 由 app/driving.js 在 wire() 里注册。一个监听者，不是一串 —— 会话只有一个。
  function onEvent(fn) { listener = typeof fn === 'function' ? fn : null; }

  // 原生 → JS 的唯一入口。
  function _fromNative(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'session-ready') {
      ready = true;
      platform = String(msg.platform || '');
      // `!== false`，不是 `=== true`：一个还不认识这个字段的旧原生壳应该落在保守的
      // 那一边（会挂起 ⇒ 隐藏就暂停），而不是拿到一个乐观的默认值。
      suspends = msg.suspends !== false;
    } else if (msg.type === 'session-failed') {
      ready = false;
    }
    if (listener) { try { listener(msg); } catch (_) { /* 播放器不因一次回调出错而停 */ } }
  }

  const api = {
    CHANNEL, PROTOCOL,
    available,
    // 「桥在」不等于「音频会话真的建起来了」。iOS 上 setCategory 可能失败（别的 App
    // 独占、系统拒绝），那时必须退回「隐藏即暂停」，而不是继续假装能后台播。
    ready: () => ready,
    platform: () => platform,
    suspends: () => suspends,
    sessionStart, sessionStop, nowPlaying, playingState, onEvent, _fromNative,
  };
  // 显式挂全局：原生就是照着这个名字回话的。
  try { window.NativeAudio = api; } catch (_) {}
  return api;
})();
