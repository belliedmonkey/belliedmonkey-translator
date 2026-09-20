// app/sys-banner.js — 首页的「把系统翻译设成默认」横幅（画布第 7 页 · Discover / DiscoverWhen）。
//
// 用户 2026-09-20 报的第三件事：新用户装完、老用户升级，**都没有任何流程**告诉他还要去
// 系统设置里把我们设成默认翻译 App —— 那一步不做，弹层永远不会出现，而产品里没有一处说过。
//
// **形状不是新发明**：与 `#ext-banner`（app/app.js 的 paintExtBanner）逐样对齐 ——
// 标题 + 一句话 + 三步 + 一个「我已设好」。连那条最要紧的纪律也是从它那里继承的：
//
//   **iOS 上 App 判不了，诚实的做法是由用户告诉我们。**
//
// 扩展那张横幅判不了「扩展启没启用」，这张判不了「我是不是默认翻译 App」—— 系统不提供
// 这个接口（T1 尖刺逐条翻过 SDK）。两张都只能由用户点一下「我已…」才收起。
//
// **没有「打开设置」按钮**，尽管画布上画了一个。落地时查清楚了：`openSettingsURLString`
// 打开的是**我们自己 App 的**设置页，不是「设置 › App › 翻译」；能直达那一页的
// `prefs:root=…` 是私有接口。一个点了会把人带到别处的按钮，比没有按钮更糟 ——
// 所以这里只有三步文字，与设置块里那三步同一份文案。
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => (typeof PageI18n !== 'undefined' ? PageI18n.t(k, fb) : fb);
  const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, (v) => res(v || {})));

  // UI 状态键，不进 settings.js 的 KEYS —— 同 extBannerDoneAt / onboardSeen 的先例。
  const DONE = 'systransBannerDoneAt';   // 用户说「我已设好」
  const SEEN = 'systransSeenAt';         // 第一次从系统翻译收进句子（唯一能证明「真的在用」的事实）

  function available() { try { return !!(root.AppVault && root.AppVault.available()); } catch (_) { return false; } }

  // 出不出现。每一条都答得上来「凭什么」——
  // 判不了的那一条（是不是默认）不在这里，它由用户自己点「我已设好」回答。
  async function decide(opts) {
    const o = opts || {};
    if (!available()) return 'none';                       // 这台设备上没有这个扩展点
    if (o.away) return 'none';                             // 别的视图开着
    if (o.onboarding) return 'none';                       // 引导在进行中
    if (o.extBannerShown) return 'none';                   // 首页不能同时挂两张「还差一步」
    const s = await get([DONE, SEEN, 'provider', 'apiKey', 'engineChosen']);
    if (s[DONE]) return 'none';                            // 用户说过「我已设好」⇒ 永不再出现
    if (s[SEEN]) return 'used';
    // 引擎都没配就别谈入口 —— 此刻首页该说的是别的事。
    const needs = (typeof EngineState !== 'undefined')
      ? EngineState.needsSetup({ provider: s.provider, apiKey: s.apiKey, engineChosen: s.engineChosen })
      : !s.apiKey;
    if (needs) return 'none';
    return 'ask';
  }

  function steps() {
    // 与设置块那三步同一份文案键，不另写 —— 同一件事在两处说得不一样是本仓踩过的坑。
    return [
      t('systrans_step1', '打开「设置」App'),
      t('systrans_step2', '进入「App」→「翻译」'),
      t('systrans_step3', '点「默认翻译App」，选「大肚猴翻译」'),
    ];
  }

  async function paint(opts) {
    const sec = $('systrans-banner');
    if (!sec) return 'none';
    const state = await decide(opts);
    if (state === 'none') { sec.hidden = true; return state; }
    sec.hidden = false;
    const ol = $('systrans-banner-steps');
    const doneBtn = $('systrans-banner-done');
    const go = $('systrans-banner-go');
    if (state === 'used') {
      $('systrans-banner-title').textContent = t('systrans_discover_used_title', '系统翻译 · 已在用');
      $('systrans-banner-body').textContent = t('systrans_discover_used', '在任何 App 里选中文字点「翻译」，用的就是你配的引擎。翻过的句子在复习库里。');
      ol.hidden = true; ol.textContent = '';
      doneBtn.hidden = true;
      go.hidden = false;
      go.textContent = t('systrans_discover_see', '在复习库里看 →');
      return state;
    }
    $('systrans-banner-title').textContent = t('systrans_discover_title', '让 iPhone 自带的「翻译」用上大肚猴');
    $('systrans-banner-body').textContent = t('systrans_discover_body', '在任何 App 里选中文字 › 翻译，弹出来的就是你配的引擎。设一次就好。');
    ol.textContent = '';
    for (const line of steps()) { const li = document.createElement('li'); li.textContent = line; ol.appendChild(li); }
    ol.hidden = false;
    doneBtn.hidden = false;
    doneBtn.textContent = t('systrans_discover_done', '我已设好');
    go.hidden = true;
    return state;
  }

  // 用户说「我已设好」。**只有他说了才收起** —— 我们判不了。
  async function markDone() {
    try { await new Promise((r) => chrome.storage.local.set({ [DONE]: Date.now() }, r)); } catch (_) {}
    const sec = $('systrans-banner');
    if (sec) sec.hidden = true;
  }

  function wire(hooks) {
    const doneBtn = $('systrans-banner-done');
    if (doneBtn) doneBtn.addEventListener('click', () => markDone());
    const go = $('systrans-banner-go');
    if (go && hooks && hooks.openReview) go.addEventListener('click', () => hooks.openReview());
  }

  const api = { paint, decide, wire, markDone, steps, DONE, SEEN };
  root.AppSysBanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
