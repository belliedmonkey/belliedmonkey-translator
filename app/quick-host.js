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
    toNative: ['quick-probe', 'quick-config', 'quick-close-main'],
    fromNative: ['quick-caps', 'quick-first-close', 'quick-open-settings', 'quick-capture', 'quick-result'],
  };
  const KEYS = ['quickEnabled', 'quickResidentSeen'];
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

  async function pushConfig() {
    if (!caps) return false;
    const s = await get(KEYS);
    return post({
      type: 'quick-config', enabled: enabledOf(s), seen: !!s.quickResidentSeen,
      // 菜单标题由页面给：原生那份文件里没有任何给用户看的文案。
      labels: {
        open: t('quick_menu_open', '打开大肚猴翻译'),
        settings: t('quick_menu_settings', '快速翻译设置…'),
        quit: t('quick_menu_quit', '退出'),
        clip: t('quick_menu_clip', '翻译剪贴板'),
        input: t('quick_menu_input', '输入翻译'),
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

  function _fromNative(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'quick-caps') { caps = msg; pushConfig(); for (const fn of listeners) { try { fn(caps); } catch (_) {} } return; }
    if (msg.type === 'quick-first-close') { onFirstClose(); return; }
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
    try { chrome.storage.onChanged.addListener((ch) => { if (ch && (ch.quickEnabled || ch.quickResidentSeen || ch.uiLang)) pushConfig(); }); } catch (_) {}
  }

  const api = {
    CHANNEL, PROTOCOL, KEYS, start, _fromNative, pushConfig, enabledOf,
    caps: () => caps,
    onCaps: (fn) => { listeners.push(fn); if (caps) fn(caps); },
  };
  root.AppQuickHost = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
