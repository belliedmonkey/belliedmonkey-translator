// app/native-audio.js — 系统媒体表面的适配器（§9.5「后台与锁屏播放」）。
//
// 两条腿，各管一段：
//
//   1. **原生桥**（`window.webkit.messageHandlers.mtAudio`）—— 音频会话与后台断言。
//      让 App 在不可见时还能继续出声，这一半只有原生做得到。
//   2. **`navigator.mediaSession`** —— 锁屏/灵动岛上显示什么、遥控键怎么接。
//
// ── 第 2 条是 2026-08-25 真机+模拟器实证之后改过来的，值得写清楚为什么 ──────────
// 原本这一半也走原生（`MPNowPlayingInfoCenter`）。在 iOS 上它**完全不起作用**：
// 模拟器锁屏上显示的是「大肚猴翻译 · 复习」——那是我们页面的 `document.title`，
// 还带着一根拖动条和 ⏪10/⏩10，而我们明明设了 `IsLiveStream` 且禁掉了 seek。
//
// 原因是 **WebKit 会为页面里的 `<audio>` 元素自动发布一套自己的 now-playing 会话**，
// 标题取自 `document.title`。而播客模式每播一段就 `new Audio(...)` 一次，于是 WebKit
// 每段都重新发布一遍，把我们从原生侧写进去的东西盖掉 —— 我们在跟 WebKit 抢一个
// 它本来就拥有的东西。（macOS 上反过来是我们赢，所以那边一直是好的。）
//
// **正确的做法是喂它，不是抢它**：音频归 web 层，媒体会话就该归 web 层。
// 原生那一半保留音频会话与后台模式（实测有效），`MPNowPlayingInfoCenter` 留着只对
// macOS 有意义。
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
    toNative: ['session-start', 'session-stop', 'now-playing', 'now-playing-artwork', 'playing-state', 'record-mode', 'mic-start', 'mic-stop',
      // 实时字幕（learning-design §9.8）：Swift 侧先是空 case（不回复）—— 空 case 就是「老壳」，入口不显示。
      'caps-probe', 'subtitle-config', 'subtitle-show', 'subtitle-state', 'subtitle-float', 'subtitle-hide'],
    fromNative: ['session-ready', 'session-failed', 'remote', 'interrupt', 'route', 'artwork-size', 'mic-pcm', 'mic-state', 'mic-level'],
  };

  // 实时字幕的两个「原生 → JS」动词：页面已经会处理，但原生还不发（随 Mac / iOS 原生那一步上，
  // 那时挪进 PROTOCOL.fromNative，让协议镜像测试去 .swift 里对表）。
  const PENDING_FROM_NATIVE = ['audio-caps', 'tick'];

  let ready = false;
  let platform = '';
  // audio-caps（§9.8）：原生报的采集能力。null = 还没收到；probedNoReply = 问过、原生没回 ⇒ 老壳。
  let caps = null;
  let probedNoReply = false;
  let capsWaiters = [];
  let tickFn = null;
  let lastSubtitle = '';
  // 这个宿主会不会在 App 不可见时挂起进程。由原生报（iOS 会，macOS 不会），不靠嗅
  // UA —— §5.3 规则 2 禁止用 UA 做能力判断，而这正是一个平台能力问题。
  // 未知时按**最保守**的 true 处理：宁可多暂停一次，也不要承诺一个不存在的后台。
  let suspends = true;
  // 监听者是一串，不是一个（2026-09-07 起）：播客模式与实时听译各自注册，各自按
  // 「我的视图在不在前台」过滤。每个回调各自 try/catch，一个坏了不影响别人。
  const listeners = [];
  // 麦克风（§9.6 原生采集）：PCM 与状态走独立的槽，不混进 listeners —— 每秒十几块
  // 音频不该让播客模式的回调也跟着醒十几次。
  let mic = null;
  // 上一次推给原生的 payload，按 JSON 串去重。paint() 每次重绘都会调，而绝大多数重绘
  // 什么都没变；每一次过桥都是一次 evaluateJavaScript 往返。
  let lastNowPlaying = '';
  let lastPlaying = null;
  // 封面按**卡片 id** 去重，不按图内容。图是几十上百 KB 的 data URL，拿它去做
  // JSON.stringify 比较是白烧 —— 而且它天然只在换卡时才变。
  let lastArtworkId = '';
  // 系统实际用哪些尺寸来问封面。Apple 没公开这件事，所以由原生如实报上来、这里攒着，
  // `AppDriving._debug()` 读得到 —— 「小尺寸阈值」因此是量出来的，不是猜的。
  const artSizes = [];

  // ─── navigator.mediaSession ────────────────────────────────────────────
  // `MediaMetadata` 是整体赋值的一个对象，而标题与封面来自两条不同的调用
  // （`nowPlaying` 每次重绘、`artwork` 换卡才一次），所以两边各自存下来，谁变了都重建。
  let msInfo = { title: '', subtitle: '', album: '' };
  let msArt = '';
  let msWired = false;
  const msActions = [];
  let msArtUrl = '';      // blob: URL，用完要 revoke

  function ms() {
    try { return (navigator.mediaSession && window.MediaMetadata) ? navigator.mediaSession : null; }
    catch (_) { return null; }
  }

  // data: URL → blob: URL。**同步解码，不走 fetch**：file:// 下 fetch 一个 data URL
  // 是又一个可能被安全策略拦住的地方，而这一步只是把 base64 变成字节，没必要冒那个险。
  function toBlobUrl(dataUrl) {
    try {
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return '';
      const bin = atob(dataUrl.slice(comma + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    } catch (_) { return ''; }
  }

  function applyMediaSession() {
    const s = ms();
    if (!s) return;
    try {
      s.metadata = new window.MediaMetadata({
        title: msInfo.title,
        artist: msInfo.subtitle,
        album: msInfo.album,
        artwork: msArtUrl ? [{ src: msArtUrl, sizes: '1024x1024', type: 'image/png' }] : [],
      });
    } catch (_) { /* 元数据设不上不该影响播放 */ }
  }

  // 遥控。**接上 nexttrack / previoustrack 是有第二重作用的**：只要它们有处理函数，
  // WebKit 就会用「上一曲/下一曲」取代默认的 ⏪10/⏩10 —— 而那两个按钮在这里没有意义
  // （一张卡三遍五段，往回退 10 秒是个假动作）。seek 那三个显式设 null，双保险。
  function wireMediaSession() {
    const s = ms();
    if (!s || msWired) return;
    msWired = true;
    const send = (command) => () => _fromNative({ type: 'remote', command });
    // 哪些接上了、哪些被引擎拒了，记下来 —— 「⏪10 还在」有两种完全不同的原因
    // （handler 没注册上 / 注册了但引擎不理），不记就分不出来。
    const set = (action, handler) => {
      try { s.setActionHandler(action, handler); msActions.push(action); }
      catch (e) { msActions.push('!' + action); }
    };
    set('play', send('play'));
    set('pause', send('pause'));
    set('nexttrack', send('next'));
    set('previoustrack', send('previous'));
    set('seekbackward', null);
    set('seekforward', null);
    set('seekto', null);
    set('stop', send('pause'));
  }

  function msPlaybackState(playing) {
    const s = ms();
    if (!s) return;
    try { s.playbackState = playing ? 'playing' : 'paused'; } catch (_) {}
    // 一段音频的时长不是「这张卡还剩多久」，拿它画进度条就是撒谎。标成直播态，
    // 系统就不画那根条。设不上就算了 —— 有条进度条也比没有声音强。
    try { if (s.setPositionState) s.setPositionState({ duration: Infinity }); } catch (_) {}
  }

  // 每次现取，不在加载时缓存：宿主注册 handler 与页面加载谁先谁后不由我们决定。
  function port() {
    try { return (window.webkit.messageHandlers[CHANNEL]) || null; } catch (_) { return null; }
  }

  function available() { return !!port(); }

  // 「系统媒体表面存不存在」—— 桥与 mediaSession 任一即可。封面该不该画看这个，
  // 而不是看桥：Chrome 里没有桥但有 mediaSession，封面照样有地方去。
  function mediaAvailable() { return !!port() || !!ms(); }

  function post(payload) {
    const p = port();
    if (!p) return false;
    try { p.postMessage(payload); return true; } catch (_) { return false; }
  }

  function sessionStart() {
    lastNowPlaying = ''; lastPlaying = null; lastArtworkId = '';
    msInfo = { title: '', subtitle: '', album: '' }; msArt = '';
    wireMediaSession();
    if (!available()) return false;
    ready = false;
    return post({ type: 'session-start' });
  }

  function sessionStop() {
    ready = false;
    lastNowPlaying = ''; lastPlaying = null; lastArtworkId = '';
    msInfo = { title: '', subtitle: '', album: '' }; msArt = '';
    const s = ms();
    if (s) { try { s.metadata = null; s.playbackState = 'none'; } catch (_) {} }
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
    msInfo = { title: payload.title, subtitle: payload.subtitle, album: payload.album };
    applyMediaSession();
    return post(payload);
  }

  // 锁屏 / 灵动岛的封面。**独立一条消息，不能塞进 nowPlaying** —— 那条的去重是
  // `JSON.stringify(整个 payload)`，而它每次重绘都被调；把一张图塞进去等于每次重绘都
  // 对上百 KB 做一次序列化加比较，过桥的往返也跟着变重。
  //
  // 换卡才推一次。同一张卡重复调用直接返回 false。
  // `cardId` 是**去重键**，不必是卡片 id 本身：一张卡在解析文本回来之后要再推一次
  // （封面上从"没有解析"变成"解析压暗铺着"），调用方于是传 `id + 状态` 进来。
  // 挡住的仍然是「同一张图推两遍」，而不是「这张卡已经推过了」—— 后者会把解析那次
  // 更新静默吃掉，表现为锁屏上永远没有解析区（2026-08-26 模拟器上就是这么发现的）。
  function artwork(cardId, dataUrl) {
    const id = String(cardId || '');
    if (!id || !dataUrl) return false;
    if (id === lastArtworkId) return false;
    lastArtworkId = id;
    msArt = String(dataUrl);
    const prev = msArtUrl;
    msArtUrl = toBlobUrl(msArt) || msArt;   // blob 造不出来就退回 data URL
    if (prev && prev !== msArtUrl) { try { URL.revokeObjectURL(prev); } catch (_) {} }
    applyMediaSession();
    return post({ type: 'now-playing-artwork', id, image: String(dataUrl) });
  }

  // **只更新锁屏封面，不过桥。**（§9.5「解析跟读」）
  //
  // 解析逐行朗读时封面要跟着高亮当前行，一张卡会重画三次。那条「换卡才推一次」的规约
  // 是针对**过桥**写的 —— 一张 1024² PNG ≈123 KB，跟着每次重绘走就是白烧。而 iOS 上
  // 封面走的是 mediaSession 的 blob URL，**根本不过桥**：逐行更新只花一次 canvas 重绘。
  // 所以逐行走这条，卡级仍走 `artwork()` 过桥一次（那一次是给 macOS 的）。
  function artworkLocal(dataUrl) {
    if (!dataUrl || !ms()) return false;
    msArt = String(dataUrl);
    const prev = msArtUrl;
    msArtUrl = toBlobUrl(msArt) || msArt;
    if (prev && prev !== msArtUrl) { try { URL.revokeObjectURL(prev); } catch (_) {} }
    applyMediaSession();
    return true;
  }

  function playingState(playing) {
    const v = !!playing;
    if (v === lastPlaying) return false;
    lastPlaying = v;
    msPlaybackState(v);
    return post({ type: 'playing-state', playing: v });
  }

  // 由 app/driving.js 在 wire() 里注册。一个监听者，不是一串 —— 会话只有一个。
  // 实时听译（§9.6）：请求一个**可录音**的音频会话（.playAndRecord），让锁屏后麦克风
  // 还活着。要在 sessionStart 之前发；关掉时回到只放不录。
  // profile（§9.8 协议补充决定 2）：'subtitle' = 字幕档会话（可混音、外放、不带蓝牙）。不传 / 'conv' 时
  // 消息与原来逐字节相同 —— 老原生壳只认 on。
  function recordMode(on, profile) {
    const body = { type: 'record-mode', on: !!on };
    if (on && profile && profile !== 'conv') body.profile = String(profile);
    post(body);
  }
  function onEvent(fn) { if (typeof fn === 'function' && listeners.indexOf(fn) < 0) listeners.push(fn); }
  function offEvent(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }

  // ─── 麦克风（§9.6）────────────────────────────────────────────────────────
  // 原生 AVAudioEngine 在 inputNode 上装 tap，重采样到 `rate`、Int16、base64，
  // 每块一条 `mic-pcm`；状态一条 `mic-state`（granted / denied / failed / interrupted / ended）。
  // WebKit 在 App 不可见时一律静音页内的 getUserMedia（2026-09-07 真机三轮实证），
  // 所以锁屏后还想听，采集只能在这儿。
  //   handlers: { onPcm(Int16Array), onState(state, reason), onLevel(rms), deliver: 'pcm'|'level' }
  //   deliver:'level'（§9.6.1 本机路）⇒ 原生不发 PCM，只发 mic-level {rms}（≤10 Hz）；音频留在原生。
  function micStart(rate, handlers) {
    if (!available()) return false;
    mic = handlers || null;
    const body = { type: 'mic-start', rate: Number(rate) || 24000 };
    if (mic && mic.deliver === 'level') body.deliver = 'level';
    if (mic && mic.source && mic.source !== 'mic') {
      // **没收到 audio-caps.system === 'ok' 绝不发 source:'system'**：老原生壳会无视这个字段、
      // 静默打开麦克风（§9.8）。规则只在这一处执行。
      if (mic.source === 'system' && !(caps && caps.system === 'ok')) { mic = null; return false; }
      body.source = String(mic.source);
    }
    return post(body);
  }

  // ─── 实时字幕（§9.8）──────────────────────────────────────────────────────
  // 问一次采集能力。已知就立即给；问过没回（老壳）就立即给 null；否则发 caps-probe 等 timeoutMs。
  function capsProbe(timeoutMs) {
    if (caps) return Promise.resolve(caps);
    if (!available() || probedNoReply) return Promise.resolve(null);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      capsWaiters.push(finish);
      post({ type: 'caps-probe' });
      setTimeout(() => { if (!caps) probedNoReply = true; finish(caps); }, Number(timeoutMs) || 1500);
    });
  }
  function audioCaps() { return caps; }
  // 字幕条 / 画中画上的每个字都由 JS 传（原生零文案）：labels.state[state]、labels.controls、labels.menu。
  function subtitleConfig(cfg) {
    const c = cfg || {};
    return post({ type: 'subtitle-config', labels: c.labels || {}, clickThrough: !!c.clickThrough,
      fontScale: Number(c.fontScale) || 1, opacity: c.opacity == null ? 1 : Number(c.opacity) });
  }
  // 按 JSON 去重：半句每来一个词都会调，绝大多数时候没变。
  function subtitleShow(info) {
    const payload = { type: 'subtitle-show', orig: String((info && info.orig) || ''), tr: String((info && info.tr) || ''), partial: !!(info && info.partial) };
    const key = JSON.stringify(payload);
    if (key === lastSubtitle) return false;
    lastSubtitle = key;
    return post(payload);
  }
  function subtitleState(state, pct) {
    const body = { type: 'subtitle-state', state: String(state || '') };
    if (pct != null) body.pct = Number(pct) || 0;
    return post(body);
  }
  function subtitleFloat() { return post({ type: 'subtitle-float' }); }
  function subtitleHide() { lastSubtitle = ''; return post({ type: 'subtitle-hide' }); }
  // tick（S3）：会话中原生每 250 ms 一条；页面不可见时计时器被钳到 1 Hz，靠它驱动时钟。
  function onTick(fn) { tickFn = typeof fn === 'function' ? fn : null; }
  function micStop() {
    mic = null;
    return post({ type: 'mic-stop' });
  }
  // base64 → Int16Array（小端）。同步解码，不走 fetch（同 toBlobUrl 的理由）。
  function pcmOf(b64) {
    const bin = atob(String(b64 || ''));
    const n = bin.length >> 1;
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      out[i] = v >= 0x8000 ? v - 0x10000 : v;
    }
    return out;
  }

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
    } else if (msg.type === 'artwork-size') {
      const s = Number(msg.w) + 'x' + Number(msg.h);
      if (artSizes.indexOf(s) < 0) artSizes.push(s);
    }
    if (msg.type === 'mic-pcm') {
      if (mic && mic.onPcm) { try { mic.onPcm(pcmOf(msg.b64)); } catch (_) {} }
      return;   // 音频块不广播
    }
    if (msg.type === 'mic-level') {
      if (mic && mic.onLevel) { try { mic.onLevel(Number(msg.rms) || 0); } catch (_) {} }
      return;
    }
    if (msg.type === 'tick') {
      if (tickFn) { try { tickFn(Number(msg.t) || 0); } catch (_) {} }
      return;   // 4 Hz，不广播
    }
    if (msg.type === 'audio-caps') {
      caps = { sources: Array.isArray(msg.sources) ? msg.sources.slice() : [], system: String(msg.system || ''), broadcast: String(msg.broadcast || '') };
      probedNoReply = false;
      const ws = capsWaiters; capsWaiters = [];
      for (const w of ws) { try { w(caps); } catch (_) {} }
    }
    if (msg.type === 'mic-state') {
      if (mic && mic.onState) { try { mic.onState(String(msg.state || ''), String(msg.reason || ''), String(msg.source || '')); } catch (_) {} }
    }
    for (const fn of listeners.slice()) { try { fn(msg); } catch (_) { /* 播放器不因一次回调出错而停 */ } }
  }

  const api = {
    CHANNEL, PROTOCOL, PENDING_FROM_NATIVE,
    available, mediaAvailable,
    // 测试用：mediaSession 那一半有没有真的接上（Chrome 里也成立）
    mediaSessionWired: () => msWired,
    mediaActions: () => msActions.slice(),
    // 「桥在」不等于「音频会话真的建起来了」。iOS 上 setCategory 可能失败（别的 App
    // 独占、系统拒绝），那时必须退回「隐藏即暂停」，而不是继续假装能后台播。
    ready: () => ready,
    platform: () => platform,
    artSizes: () => artSizes.slice(),
    suspends: () => suspends,
    sessionStart, sessionStop, recordMode, nowPlaying, artwork, artworkLocal, playingState, onEvent, offEvent,
    micStart, micStop, pcmOf, _fromNative,
    capsProbe, audioCaps, subtitleConfig, subtitleShow, subtitleState, subtitleFloat, subtitleHide, onTick,
  };
  // 显式挂全局：原生就是照着这个名字回话的。
  try { window.NativeAudio = api; } catch (_) {}
  return api;
})();
