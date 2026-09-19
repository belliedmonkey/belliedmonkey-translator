// app/quick-host.js — 快速翻译在 App **主页面**这一侧的接线（docs/learning-design.md §9.9）。
// 原生半边：app/native/resident.swift（通道 mtQuick，整份 #if os(macOS)）。
//
// 能力靠探测，不靠 UA：发 quick-probe，原生回 quick-caps 才算有这个功能。iOS、以及不认识 mtQuick 的
// 老原生壳都不回 ⇒ 设置里那一块**不显示**（不是灰掉：没有能对用户说的原因，也没有出口）——
// 与实时字幕的 audio-caps 同一条纪律。所以这份 JS 可以先于原生合入。
(function (root) {
  'use strict';
  const CHANNEL = 'mtQuick';
  // 与 resident.swift 逐字对表（test/build-scripts.test.js 的协议镜像门）
  const PROTOCOL = {
    toNative: ['quick-probe', 'quick-config', 'quick-close-main', 'quick-request-perm', 'quick-open-privacy', 'quick-relaunch', 'quick-hotkeys', 'quick-login-item'],
    fromNative: ['quick-caps', 'quick-first-close', 'quick-open-settings', 'quick-capture', 'quick-result', 'quick-hotkeys-result'],
  };
  // quickEnhanced：用户的**意图**（想开）。真正生效还要原生读到系统权限（caps.postEvent）。
  // quickEnhancedNote：设置块里那一行该说什么 —— 'pending'（问过系统了，等重开）| 'denied'（重开后仍没有权限，开关已弹回）| ''。
  // quickEnhancedLost：给面板页看的一次性标记 —— 权限没了、热键已退回剪贴板路径，下一次面板出来时说一句。
  // quickHotkeys：{translate, shot, input}，每项是 {code, modifiers} 或 null（用户清掉了）；没存过 = 默认值（HotkeyCore.normalize）。
  const KEYS = ['quickEnabled', 'quickResidentSeen', 'quickEnhanced', 'quickEnhancedNote', 'quickHotkeys'];
  const t = (k, fb) => (typeof PageI18n !== 'undefined' ? PageI18n.t(k, fb) : fb);

  let caps = null;               // 原生回执；null = 还没回 / 这个壳没有
  let hooks = {};                // { openSettings(anchorId), confirm(message, opts) }
  const listeners = [];

  function port() { try { return root.webkit.messageHandlers[CHANNEL] || null; } catch (_) { return null; } }
  function post(payload) { const p = port(); if (!p) return false; try { p.postMessage(payload); return true; } catch (_) { return false; } }
  const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, (v) => res(v || {})));
  const set = (obj) => new Promise((res) => chrome.storage.local.set(obj, res));

  // 常驻默认开（`!== false`，不往存储里播种默认值）。
  const enabledOf = (s) => s.quickEnabled !== false;

  // ── 快捷键（M-7）──
  let clashes = [];              // 原生上一次回报「没注册上」的那些 id（别的 App 占了同一个组合）
  let recording = false;
  const clashListeners = [];
  const hotkeysOf = (s) => (typeof HotkeyCore !== 'undefined' ? HotkeyCore.normalize(s.quickHotkeys) : null);

  async function pushHotkeys() {
    if (!caps || typeof HotkeyCore === 'undefined') return false;
    const hk = hotkeysOf(await get(KEYS));
    return post({ type: 'quick-hotkeys', translate: HotkeyCore.wire(hk.translate), shot: HotkeyCore.wire(hk.shot), input: HotkeyCore.wire(hk.input), paused: recording });
  }
  // 录制开始 / 结束：录制时全局快捷键要全部放开，不然按下现有的组合会被 Carbon 抢在网页之前吃掉 —— 既录不到，又真的触发一次翻译。
  function setRecording(on) { recording = !!on; return pushHotkeys(); }
  // 存一个（combo = null 即清掉）。校验与「三个之间不撞」由调用方先过 HotkeyCore；这里只管落盘，推送由设置总线触发。
  async function setHotkey(id, combo) {
    const s = await get(KEYS);
    const cur = Object.assign({}, s.quickHotkeys && typeof s.quickHotkeys === 'object' ? s.quickHotkeys : {});
    cur[id] = combo ? { code: combo.code, modifiers: combo.modifiers } : null;
    await set({ quickHotkeys: cur });
  }
  const resetHotkeys = () => new Promise((res) => chrome.storage.local.remove(['quickHotkeys'], res));
  const setLoginItem = (on) => post({ type: 'quick-login-item', on: !!on });
  const openPane = (which) => post({ type: 'quick-open-privacy', which });

  async function pushConfig() {
    if (!caps) return false;
    const s = await get(KEYS);
    await pushHotkeys();               // 先于 quick-config：原生 enable() 注册的就是刚发过去的这一组
    return post({
      type: 'quick-config', enabled: enabledOf(s), seen: !!s.quickResidentSeen,
      // 原生每次按快捷键时还会自己再读一次系统权限：这里只是「用户想不想」。
      enhanced: s.quickEnhanced === true,
      // 菜单标题由页面给：原生那份文件里没有任何给用户看的文案。
      labels: {
        open: t('quick_menu_open', '打开大肚猴翻译'),
        settings: t('quick_menu_settings', '快速翻译设置…'),
        quit: t('quick_menu_quit', '退出'),
        clip: t('quick_menu_clip', '翻译剪贴板'),
        input: t('quick_menu_input', '输入翻译'),
        shot: t('quick_menu_shot', '截图翻译'),
      },
    });
  }

  async function onFirstClose() {
    // 第一次关主窗口（常驻开着）：窗口先留着，把这件事说清楚，再收起来。只说一次。
    const msg = t('quick_resident_title', '大肚猴还在菜单栏') + '\n\n'
      + t('quick_resident_body', '快捷键照常可用。要完全退出，用菜单栏图标里的「退出」，或按 ⌘Q。');
    const stay = hooks.confirm ? await hooks.confirm(msg, { ok: t('quick_resident_ok', '知道了'), cancel: t('quick_resident_off', '不想常驻') }) : true;
    await set({ quickResidentSeen: true });
    if (stay) { await pushConfig(); post({ type: 'quick-close-main' }); return; }
    // 「不想常驻」：带到那个开关面前，不替用户关 —— 关掉它意味着快捷键随 App 一起退出，要他自己看见那句话。
    await pushConfig();
    if (hooks.openSettings) hooks.openSettings('g-quick');
  }

  // ── 增强取词（learning-design §9.9，M-5）────────────────────────────────────
  // 平台现实：系统权限弹窗**不回调**允许还是拒绝，而且授权之后**正在运行的进程读不到**新权限（T2 读数：轮询数分钟
  // 一直是 false，重开后第一行就是 true）。所以点了「继续」之后我们分不清两者，只能如实说「允许后重开才生效」；
  // 真正的分晓在下一次启动：有权限 ⇒ 开关是开的；没有 ⇒ 意图弹回「关」+ 一句话（reconcile）。
  const hasPostEvent = () => !!(caps && caps.postEvent === true);
  const supportsEnhanced = () => !!(caps && typeof caps.postEvent === 'boolean');

  // 启动时（原生回了 caps）对一次账：想开、却没有权限 ⇒ 弹回。事后被用户在系统设置里撤销也走这里。
  async function reconcile() {
    if (!supportsEnhanced()) return;
    const s = await get(KEYS);
    if (s.quickEnhanced === true && !hasPostEvent()) {
      await set({ quickEnhanced: false, quickEnhancedNote: 'denied', quickEnhancedLost: s.quickEnhancedNote === 'pending' ? false : true });
    } else if (hasPostEvent() && s.quickEnhancedNote) {
      // 权限在，而说明还停在 pending / denied ⇒ 用户终究是给了：兑现他原来的意图，清掉那句话。
      // 真机实测的顺序（2026-09-19）：重开发生在授权**之前**，那一次对账把意图弹回了「关」并标成 denied；用户随后授权、
      // 再重开，权限有了，开关却还是关的，旁边还挂着「系统没有给权限」—— 那句话此刻是假的。
      // 用户自己在设置里关掉的不在此列：那时说明是空的（setEnhanced(false) 会清掉它）。
      await set({ quickEnhanced: true, quickEnhancedNote: '', quickEnhancedLost: false });
    }
  }

  // 设置页的开关调这里。返回最终的开关状态（true = 显示为开）。
  async function setEnhanced(on) {
    if (!on) { await set({ quickEnhanced: false, quickEnhancedNote: '' }); return false; }
    if (hasPostEvent()) { await set({ quickEnhanced: true, quickEnhancedNote: '' }); return true; }
    // 系统弹窗之前，我们自己的话先到：会做 / 不会做各两条。
    const msg = t('quick_enh_explain_title', '打开增强取词') + '\n\n'
      + t('quick_enh_explain_does', '会做：你按快捷键时，替你按一次 ⌘C；读到选中的文字后，把剪贴板恢复成原来的样子。') + '\n\n'
      + t('quick_enh_explain_doesnt', '不会做：不监听键盘，不在你没按快捷键时读任何东西。');
    const go = hooks.confirm ? await hooks.confirm(msg, { ok: t('quick_enh_continue', '继续'), cancel: t('quick_enh_not_now', '先不开') }) : false;
    if (!go) return false;
    await set({ quickEnhanced: true, quickEnhancedNote: 'pending' });
    post({ type: 'quick-request-perm', which: 'postEvent' });
    return false;                      // 还没生效：开关保持「关」的样子，旁边那一行说明为什么
  }
  const relaunch = () => post({ type: 'quick-relaunch' });
  const openPrivacy = () => post({ type: 'quick-open-privacy', which: 'postEvent' });

  function _fromNative(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'quick-caps') {
      caps = msg;
      return reconcile().then(() => { pushConfig(); for (const fn of listeners) { try { fn(caps); } catch (_) {} } });
    }
    if (msg.type === 'quick-first-close') { onFirstClose(); return; }
    if (msg.type === 'quick-hotkeys-result') { clashes = Array.isArray(msg.failed) ? msg.failed.slice() : []; for (const fn of clashListeners) { try { fn(clashes); } catch (_) {} } return; }
    if (msg.type === 'quick-open-settings') { if (hooks.openSettings) hooks.openSettings('g-quick'); return; }
    // 面板页经原生中继过来的两样东西（面板是第二个 WKWebView：不开学习库、不初始化遥测）。
    // 进不进复习库由那个唯一写入者按同一套门裁定 —— 这里不预判，只转交。
    if (msg.type === 'quick-capture') { if (typeof AppHandoff !== 'undefined') return AppHandoff.ingestLive([msg]); return; }
    if (msg.type === 'quick-result') { if (typeof AppHandoff !== 'undefined') AppHandoff.relayResult(msg); }
  }

  function start(h) {
    hooks = h || {};
    post({ type: 'quick-probe' });
    // 开关或界面语言变了 ⇒ 菜单与常驻状态跟着变（设置总线，同 app/settings.js 的约定）
    try { chrome.storage.onChanged.addListener((ch) => { if (ch && (ch.quickEnabled || ch.quickResidentSeen || ch.quickEnhanced || ch.quickHotkeys || ch.uiLang)) pushConfig(); }); } catch (_) {}
  }

  const api = {
    CHANNEL, PROTOCOL, KEYS, start, _fromNative, pushConfig, enabledOf,
    setEnhanced, relaunch, openPrivacy, hasPostEvent, supportsEnhanced, reconcile,
    pushHotkeys, setRecording, setHotkey, resetHotkeys, setLoginItem, openPane,
    clashes: () => clashes.slice(), onClashes: (fn) => { clashListeners.push(fn); },
    caps: () => caps,
    onCaps: (fn) => { listeners.push(fn); if (caps) fn(caps); },
  };
  root.AppQuickHost = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
