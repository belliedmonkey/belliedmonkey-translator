// app/sys-settings.js — App 设置里「系统翻译」那一块（docs/learning-design.md §9.9 / iOS 线 I-7）。
// 只在 iPhone / iPad 上出现：判据是 `AppVault.available()`（原生装没装 mtVault 通道），
// 不是 UA。macOS 与不认识这条通道的老原生壳整块不显示。
//
// **这一块只说我们答得上来的那件事。**
//
// 系统**不提供**「我是不是当前的默认翻译 App」这个接口（T1 尖刺逐条翻过 SDK）。所以这里
// 不写「已启用 ✓」——那会是一句猜的话，而猜错的方向恰好最伤：一个没选中我们的人看到
// 「已启用」，只会认为功能坏了。我们答得上来的是**引擎配置有没有同步过去**，以及
// 那三步怎么走。选没选成默认，用户自己在那三步里看得见。
//
// 三态（都来自 `vault-ack` 的回读，不是「没报错」）：
//   · 还没同步   打开过 App 但回执还没到，或者根本没配引擎
//   · 已同步     status = 0，且快照里有引擎 —— 连引擎名一起说出来
//   · 同步失败   status ≠ 0（钥匙串写不进去）。带上 OSStatus：这是唯一能定位它的数字
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => (typeof PageI18n !== 'undefined' ? PageI18n.t(k, fb) : fb);
  const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, (v) => res(v || {})));
  const V = () => root.AppVault;

  function available() { try { return !!(V() && V().available()); } catch (_) { return false; } }

  // 引擎的展示名。注册表是唯一来源 —— 这里绝不另写一份 id → 名字的表。
  // `labelKey` 有就走 t()，没有就用字面值（与 src/app/settings-view.jsx、listen.js:1197 同一条）。
  function engineName(id) {
    try {
      const e = typeof EngineState !== 'undefined' ? EngineState.byId(id) : null;
      if (!e) return id || '';
      return e.labelKey ? t(e.labelKey, e.label) : e.label;
    } catch (_) { return id || ''; }
  }

  function stateText(ack, provider) {
    if (!ack) return t('systrans_state_pending', '还没同步。打开这个 App 时会自动同步一次。');
    if (ack.status !== 0) {
      // OSStatus 原样带出来：这条路上出了问题，这个数字是唯一能定位它的东西。
      return t('systrans_state_failed', '同步失败（{code}）。到「引擎与密钥」里重新保存一次试试。')
        .replace('{code}', String(ack.status));
    }
    if (!provider) return t('systrans_state_noengine', '还没配置引擎。配好之后会自动同步过去。');
    return t('systrans_state_ok', '引擎已同步：{name} ✓').replace('{name}', engineName(provider));
  }

  async function paint() {
    const box = $('g-systrans');
    if (!box) return;
    box.hidden = !available();
    if (box.hidden) return;
    const s = await get(['provider', 'handoffCapture', 'learnEnabled', 'sysTranslateFontScale']);
    const ack = V().ack();
    if ($('systrans-state')) $('systrans-state').textContent = stateText(ack, s.provider || '');
    if ($('systrans-capture')) {
      $('systrans-capture').checked = s.handoffCapture !== false;
      // 学习总闸关着时这一行跟着灰 —— 与文档 / 听译 / 字幕那几个开关同一条。
      $('systrans-capture').disabled = s.learnEnabled === false;
    }
    // 弹层字号（#495）：存值不在三档上（手改过 / 老版本）时就近落档再显示 —— 与
    // listen-core fontStep 同一条规则。''（缺省）= 1（标准），写回也统一成档上的数。
    if ($('systrans-font')) {
      const STEPS = [0.85, 1, 1.2];
      const v = Number(s.sysTranslateFontScale) || 1;
      let best = STEPS[0];
      for (const st of STEPS) if (Math.abs(st - v) < Math.abs(best - v)) best = st;
      $('systrans-font').value = String(best);
    }
  }

  function paintStatic() {
    const put = (id, text) => { if ($(id)) $(id).textContent = text; };
    put('systrans-title', t('systrans_title', '系统翻译'));
    put('systrans-intro', t('systrans_intro', '在任何 App 里选中文字点「翻译」，用你自己配的引擎翻。要先把大肚猴翻译设为默认：'));
    put('systrans-step1', t('systrans_step1', '打开「设置」App'));
    put('systrans-step2', t('systrans_step2', '进入「App」→「翻译」'));
    put('systrans-step3', t('systrans_step3', '点「默认翻译App」，选「大肚猴翻译」'));
    // 系统低于 18.4 时那一行根本不会出现，而 App 这边**问不出来系统版本**（问得出来也
    // 只能多一条要维护的协议）。所以不猜，直接把条件说清楚，让用户自己对得上。
    put('systrans-need', t('systrans_need', '需要 iOS 或 iPadOS 18.4 及以上。系统版本低于它时，那个列表里不会出现大肚猴翻译。'));
    put('systrans-capture-label', t('systrans_capture_label', '存入复习库'));
    put('systrans-capture-hint', t('systrans_capture_hint', '翻过的句子进复习，来源「系统翻译」。关掉后照常翻译，只是不存。'));
    put('systrans-font-label', t('systrans_font_label', '弹层字号'));
    if ($('systrans-font-small')) $('systrans-font-small').textContent = t('systrans_font_small', '小');
    if ($('systrans-font-std')) $('systrans-font-std').textContent = t('systrans_font_std', '标准');
    if ($('systrans-font-large')) $('systrans-font-large').textContent = t('systrans_font_large', '大');
    put('systrans-font-hint', t('systrans_font_hint', '选中文字翻译时原文与译文的字号（按钮与说明不变）。改完下次弹层生效。'));
  }

  function wire() {
    if (!$('g-systrans')) return;
    paintStatic();
    $('systrans-capture').addEventListener('change', () => {
      chrome.storage.local.set({ handoffCapture: $('systrans-capture').checked });
    });
    if ($('systrans-font')) {
      $('systrans-font').addEventListener('change', () => {
        // 只写三档上的数 —— select 的 option 值就是档位，别的值进不来。
        chrome.storage.local.set({ sysTranslateFontScale: Number($('systrans-font').value) || 1 });
      });
    }
    // 回执到了要重画：同步是异步的，先画出来的那一版必然是「还没同步」。
    try { if (V() && V().onAck) V().onAck(() => paint()); } catch (_) {}
    try {
      chrome.storage.onChanged.addListener((ch) => {
        if (!ch) return;
        if (ch.uiLang) paintStatic();
        if (ch.uiLang || ch.provider || ch.handoffCapture || ch.learnEnabled || ch.sysTranslateFontScale) paint();
      });
    } catch (_) {}
    paint();
  }

  const api = { wire, paint, paintStatic, stateText, available };
  root.AppSysSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
