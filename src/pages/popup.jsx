// pages/popup.jsx — 弹窗的 React 化（PR3，全仓第一个迁移页；范式见
// docs/domain-design.md §10.9）。前身 extension/popup/popup.js（本 PR 删除）。
//
// 与命令式版本的对应关系（迁移指南的活样本，后面的页面照这个样子搬）：
//   · getSettings + POPUP_KEYS        → SettingsStore.init(schema.keysFor('popup'))
//                                       + useSettings —— 「第四份手抄键表」删除，
//                                       写入方也订阅：开着弹窗时 options 改配置会跟着变。
//   · applyI18n / data-i18n           → useT()：首帧即用 uiLang 生效的语言渲染
//                                       （原版先画 HTML 中文兜底再换语言，那个闪烁没有了）。
//   · updateSetupNote / updateFirstRun /
//     applyUnconfigured / paintAsrEntry /
//     renderSiteSection / updateTranslateUI —— 全部改为从 state 派生：同一轮渲染
//                                       内一次算完，「先让提示决定再收起」的顺序
//                                       约束随命令式重画一起消失。
//   · saveSettings(chrome.storage.set) → SettingsStore.set（乐观更新 + 回声去重 +
//                                       失败精确回滚）；site-capture 的写入方第一次
//                                       订阅自己的写入。
//   · $('id') / classList / onclick   → JSX 元素，id 全部保留（门禁与对比度 sweep
//                                       都按 id 找）。hidden 纪律照旧：可见性是
//                                       派生布尔写到始终挂载的元素上，没有条件卸载。
// 首帧行为差异（记入 PR 描述）：settings 读回之前，setup-note / first-run 不显示
// （原版 HTML 静态 display:none，等 JS 读完才动）——读回前我们什么都不知道，不猜。

import { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import PageText from '../lib/i18n.js';
import Registry from '../lib/registry.js';
import SETTINGS_SCHEMA from '../store/schema.js';
import SettingsStore from '../store/settings-store.js';
import { useSettings, useSettingsStatus } from '../store/hooks.js';

async function sendToPage(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { action });
  } catch (_) {
    return null; // content script not loaded on this page (e.g. chrome://)
  }
}

// 免费额度钉住的翻译模型。来自构建时发射的那份规格（Registry.grant()），
// **不是第二份写死的字符串** —— 换模型只改 build/providers.config.js 一处。
// 取不到就返回空串，那时模型那一条不判：拿一个猜出来的模型名去说「你改错了」，
// 比不说更糟。
function grantPinnedModel() {
  try {
    const g = Registry.grant();
    return (g && g.models && g.models.chat) || '';
  } catch (_) { return ''; }
}

function Popup() {
  const t = PageText.useT();
  const status = useSettingsStatus();
  const ready = status !== 'loading';
  const s = useSettings(SETTINGS_SCHEMA.keysFor('popup'));

  const [pageStatus, setPageStatus] = useState(null);
  const [siteUrl, setSiteUrl] = useState('');
  const [pageTranslated, setPageTranslated] = useState(false);
  const [due, setDue] = useState('');
  const [asrNote, setAsrNote] = useState(null);   // null = 走 iframe 派生默认
  const [busy, setBusy] = useState(false);        // 翻译按钮：内容脚本往返期间锁住
  const [siteBusy, setSiteBusy] = useState(false);// 收录开关：写入在途期间锁住
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  // ── boot：清 badge + 拿当前页状态 + 本站 URL ─────────────────────────────
  useEffect(() => {
    // Clear the first-run dot (background.js sets it on install). Clearing the GLOBAL
    // badge is safe: the per-tab 'ON' badges are stored separately and take precedence,
    // so an active translation keeps its indicator.
    try { chrome.action.setBadgeText({ text: '' }); } catch (_) { /* best-effort */ }
    let alive = true;
    (async () => {
      const st = await sendToPage('getPageStatus');
      if (!alive) return;
      setPageStatus(st);
      // URL comes from the content script's own getPageStatus (the same url the
      // capture gate judged); chrome.tabs is the fallback for a page whose content
      // script predates this popup opening. A restricted url fails the https? check
      // in the site-section derivation and hides it.
      let url = (st && st.url) || '';
      if (!url) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          url = (tab && tab.url) || '';
        } catch (_) {}
      }
      if (!alive) return;
      setSiteUrl(url);
    })();
    return () => { alive = false; };
  }, []);

  // ── settings：一页面的唯一读入口 + uiLang 单点喂给 i18n ──────────────────
  useEffect(() => {
    SettingsStore.init(SETTINGS_SCHEMA.keysFor('popup'));
  }, []);
  useEffect(() => {
    PageText.setUiLang(s.uiLang);
  }, [s.uiLang]);
  useEffect(() => {
    // The popup has no room for an explanation; it must at least not lie. When the
    // read failed we show what we have and mark it, rather than presenting defaults
    // as if they were the user's configuration.
    if (status === 'error') {
      try { document.body.dataset.settingsUnavailable = '1'; } catch (_) {}
    }
  }, [status]);

  // ── 派生：全部可见性与文案都从 state 算出，任何一项变化自动重渲染 ────────

  // 「配好了没有」的判据取自 content/engine-state.js —— 与悬浮球、设置页同一份，
  // 且**先归一化 provider**。读回之前不猜（原版 HTML 初始 display:none，等 JS 读完才动）。
  const setup = ready && EngineState.needsSetup({ provider: s.provider, apiKey: s.apiKey, engineChosen: s.engineChosen });

  // setup note：只剩两支，要么引导去配，要么什么都不说。原来还有第三支「当前使用
  // 免费通道，不需要 API Key —— 适合先看看效果」，2026-09-01 去掉：决策不再为免费
  // 通道开特例，第一优先级是一键配置。弹窗不提供配置控件，这条提示的职责是**引导**：
  // 整条可点，点开设置页。interaction-spec 要求它同时出现在弹窗与设置页两处，
  // 那条契约仍然成立 —— 变的是它把人送去哪儿。
  const grantRow = setup ? null
    : (typeof LearnGrant !== 'undefined'
      ? LearnGrant.popupRow(s, { t, pinnedModel: grantPinnedModel() })
      : null);
  const setupNote = setup
    ? { text: t('popup_need_setup', '还没配好翻译引擎 —— 点这里去设置页，一把 key 就能配好。') }
    : (grantRow ? { text: grantRow.text } : null);

  // 首次运行入口。extObSeen 是**流程标记，不是配置标记**（test/ext-ob-seen.test.js
  // 钉着全仓只有这里读它）：任何一次「以后再设置」都会写它，设置页的「重看引导」
  // 会删掉它 —— 拿它当「配好了」的信号立刻出错。**故意不复用 App 的 onboardSeen
  // 这个键名**：两边存储不通（app/chrome-shim.js 把 chrome.storage 垫在 file:// 的
  // localStorage 上），同名会让以后读代码的人以为它们是一回事。
  const firstRunVisible = ready && !s.extObSeen && !setup;

  // 「还没配好」时弹窗只留一个入口。判据取**配好了没有**，不取「有没有走过引导」
  // —— 按过「以后再设置」的人 extObSeen 已置位而一句也翻不出来；点过「重看引导」
  // 的人配得好好的却没置位。site-section 除外：它有自己的显示条件，下面的
  // siteVisible 已经包含，不会因为这里放开而错显。
  const siteHost = siteUrl && typeof LearnRules !== 'undefined' ? LearnRules.siteRuleFor(siteUrl) : '';
  const siteRules = (s.learnRules && typeof s.learnRules === 'object') ? s.learnRules : null;
  const siteVisible = s.learnEnabled === true && !!siteUrl && /^https?:/i.test(siteUrl) && !!siteHost;
  const siteBlocked = siteVisible && LearnRules.isBlocked(siteUrl, siteRules);
  const siteExact = siteVisible
    ? ((siteRules && siteRules.block) || []).find((p) => LearnRules.normalizePattern(p) === siteHost)
    : null;
  // Blocked by a BROADER wildcard rule: a switch here would lie (toggling it could
  // not unblock the site). Name the rule and offer 管理 instead.
  const switchHidden = siteBlocked && !siteExact;
  const blockingRule = siteBlocked
    ? (((siteRules && siteRules.block) || []).find((p) => LearnRules.matchesUrl(p, siteUrl)) || '')
    : '';

  // 「🎙 转写」五态（popup/asr-entry.js；interaction-spec 2026-09-11）。那一行常显：
  // 有媒体就开始，没找到就说没找到，引擎没配就送去配。翻译引擎未配置时随其它节一起
  // 收起，免得两条「先配置」打架。
  const asrKnown = typeof AsrEntry !== 'undefined';
  const asrSt = asrKnown && pageStatus
    ? AsrEntry.state({ pageStatus, settings: s, engines: Registry.sttEngines() })
    : null;
  const asrHidden = !asrKnown || setup || !asrSt || asrSt.kind === 'no_script';
  const asrLabel = asrSt && asrSt.kind === 'no_engine'
    ? t('popup_asr_no_engine2', '🎙 转写这段音视频 — 先选一个转写引擎 →')
    : t('popup_asr_go2', '🎙 转写这段音视频 + 翻译');
  const asrHint = asrSt && asrSt.media ? AsrEntry.durationText(asrSt.media, t) : '';
  const asrNoteText = asrNote !== null ? asrNote
    : (asrSt && asrSt.kind === 'iframe_only'
      ? t('popup_asr_iframe', '播放器在页内的另一个框架里；在新标签页打开它再转写 ↗')
      : '');

  // 常驻的「用 App 听设备的声音」那一行（2026-09-16）。
  //
  // 三个平台说三句话，因为这是**能力差异**不是本地化差异：
  //   · Mac —— 取系统音频，切过去视频不会停 ⇒ 可以「现在就去」
  //   · iPhone/iPad —— 一离开前台 iOS 立刻暂停网页视频（尖刺 S5 实测）⇒ 必须说清
  //     「先开始听，再回来播放」，写成「现在就去」等于教人走一条必然失败的路
  //   · 其它平台 —— App 根本不存在 ⇒ 整行不出，一个字都不提
  //
  // 文案**不点名 Safari**（用户 2026-09-13 裁定）：听的是设备的声音，与谁在放无关。
  const appRowVisible = typeof AppLink !== 'undefined' && AppLink.applePlatform();
  const handheld = /iPhone|iPad|iPod/i.test((navigator.userAgent || '') + ' ' + (navigator.platform || ''));

  const translateLabel = pageTranslated ? t('btn_view_original', '查看原文') : t('btn_translate_page', '翻译本页');
  // 两态，与原版 updateTranslateUI 逐字对应。pageStatus 拿不到（无内容页/受限页）时
  // 原版也是走 pageTranslated=false 的「未翻译」——静态 HTML 的「已关闭」只是
  // getPageStatus 返回前的瞬时初值，不是稳态，不要把它建成第三态。
  const badgeText = pageTranslated ? t('status_translated', '已翻译') : t('status_untranslated', '未翻译');

  // 只填 href。评分行在这个宿主没有商店条目时（中国版 Chrome/Firefox）保持 hidden ——
  // 指向一个不存在的页比没有这一行更糟。反馈入口坏了不能拖垮弹窗本身。
  const fb = useMemo(() => {
    try {
      return { mail: MTFeedback.mailtoUrl('popup'), rate: MTFeedback.rateUrl() || '' };
    } catch (_) { return { mail: '', rate: '' }; }
  }, []);

  // ── 动作 ──────────────────────────────────────────────────────────────────
  function showToast(msg, duration = 2000) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), duration);
  }
  function goSettingsAndClose() {
    try { chrome.runtime.openOptionsPage(); } catch (_) {}
    window.close();
  }
  function openTab(url) {
    try { window.open(url, '_blank'); } catch (_) {}
    window.close();
  }
  function openAsrOptions() {
    try { window.open(chrome.runtime.getURL('options/options.html') + '#stt', '_blank'); } catch (_) {}
    window.close();
  }

  async function onTargetLang(e) {
    await SettingsStore.set('targetLang', e.target.value);
    showToast(t('toast_lang_switched', '语言已切换'));
  }

  function writeSiteRules(mutate) {
    const base = siteRules || { v: 1, block: [], langs: null };
    const next = Object.assign({}, base, mutate(base), { v: 1, updatedAt: Date.now() });
    // No forced sync here: the popup closes too fast to babysit a request. The
    // rules ride the next natural push/pull (§8.9) from any longer-lived surface.
    return SettingsStore.set('learnRules', next);
  }
  async function onSiteCapture(e) {
    // interaction-spec 全局原则: the write is in flight — the toggle locks so a
    // rapid double-flip can't interleave two rule writes.
    setSiteBusy(true);
    try {
      const host = LearnRules.siteRuleFor(siteUrl);
      if (!host) return;
      if (e.target.checked) {
        await writeSiteRules((r) => ({ block: (r.block || []).filter((p) => LearnRules.normalizePattern(p) !== host) }));
        showToast(t('learn_src_unblock', '恢复收录'));
      } else {
        await writeSiteRules((r) => ({
          block: (r.block || []).indexOf(host) >= 0 ? r.block : (r.block || []).concat([host]),
        }));
        showToast(t('learn_src_block', '不再收录'));
      }
      // 开关自身的回显不重画：SettingsStore.set 的乐观更新已把它推进 snapshot，
      // 派生出的 checked 下一次渲染就是新值 —— 这正是迁移要消灭的手动重画。
    } finally { setSiteBusy(false); }
  }

  async function onTranslate() {
    // interaction-spec 全局原则: locked across the content-script roundtrip, and
    // the status toast fires BEFORE the await — feedback that arrives only after
    // the work settles tells the user nothing while they wait.
    setBusy(true);
    try {
      if (pageTranslated) {
        const r = await sendToPage('disablePage');
        // sendToPage never throws — it resolves null when no content script
        // answered. Flipping state on null would paint a status the page is
        // not in, so both branches gate the flip on a real response.
        if (r == null) { showToast(t('msg_translate_failed_retry', '⚠️ 翻译失败——点按重试')); return; }
        setPageTranslated(false);
        showToast(t('toast_restored_original', '已恢复原文'));
      } else {
        showToast(t('toast_translating', '正在翻译…'));
        const r = await sendToPage('translatePage');
        if (r == null) { showToast(t('msg_translate_failed_retry', '⚠️ 翻译失败——点按重试')); return; }
        setPageTranslated(true);
      }
    } finally { setBusy(false); }
  }

  function onAppRowClick() {
    // 这一行是**主动发现**的入口，与页内「撞墙之后」那个出口分开记（surface 不同）——
    // 免费额度那次的教训：83% vs 14% 的差距是按入口劈开才看见的（telemetry-design §3.3.2）。
    try {
      if (typeof MTTelemetry !== 'undefined') MTTelemetry.track('asr_entry', { surface: 'popup_app_row', result: 'to_app' });
    } catch (_) {}
    // AppLink.open 自己兜「自定义 scheme 没人接 ⇒ 页面没失焦 ⇒ 说出来」，那正是本仓
    // 最怕的「点了没反应」；没装 App 的人由兜底送去 App Store。
    try {
      AppLink.open('', () => { try { window.open(AppLink.storeUrl(), '_blank'); } catch (_) {} }, 1200, 'listen');
    } catch (_) {}
    window.close();
  }

  async function onTranscribe() {
    if (asrSt.kind === 'no_engine') { openAsrOptions(); return; }
    if (asrSt.kind === 'iframe_only') {
      try { chrome.tabs.create({ url: asrSt.frames[0].href }); } catch (_) {}
      window.close();
      return;
    }
    const r = await sendToPage('transcribeMedia');
    if (r && r.ok) { window.close(); return; }
    const reason = (r && r.reason) || 'no_media';
    if (reason === 'no_engine') { openAsrOptions(); return; }
    if (reason === 'busy') { window.close(); return; }
    setAsrNote(t('popup_asr_none_found', '没找到能转写的视频/音频。播放器可能在另一个框架里，或还没开始播放。'));
  }

  // ── 复习数字 + 心跳 ───────────────────────────────────────────────────────
  // The row renders immediately and the count fills in when IndexedDB resolves —
  // the popup must never wait on the corpus to paint. 心跳在 setDue **之后**才发起
  // （popup-heartbeat 门禁钉着这一对顺序）：先把数画上去，永不挡在它前面。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 库的选择仍然是**跟随**，不是决策：弹窗读 learnActiveDb，照别的面已经做过
        // 并落盘的决定走。（bindCorpus 那条策略不在这里跑 —— 它要读会话、要判认领，
        // 属于「有界面负责解释结果」的那类动作。）
        try {
          const r = await PageSettings.read(['learnActiveDb']);
          if (r.ok && r.data.learnActiveDb) await LearnStore.useDb(r.data.learnActiveDb);
        } catch (_) {}
        await LearnDrain.run();
        const items = await LearnStore.allItems();
        const n = LearnScheduler.dueCount(items, Date.now());
        if (!alive) return;
        setDue(n > 0 ? String(n) : '');

        // ── 弹窗也是一次心跳（§8.8）────────────────────────────────────
        //
        // 为什么非加不可：在这之前，全仓只有复习页与设置页两个入口级触发点。
        // 一个装好扩展、天天在网页上翻译、采集攒了几百张卡、但从没点开过那两页的人，
        // 服务器上是空的 —— 于是他在 App 里看到「同步完成，但服务器上还没有内容」，
        // 而他确实什么都没做错。弹窗是他最常点的那一面。
        //
        // **不带 force**：受 autoSync 自己的 10 分钟节流，且未登录时它在
        // `if (!t)` 那一行就返回，不发任何请求、不碰 IndexedDB。
        //
        // 代价，如实记：弹窗一关 JS 就死，push 可能被打断。后果是下次重推 ⇒ 服务器上
        // 多一条 chunk 行（append-only，replay 幂等），**不是数据损坏**；水位线
        // syncPushedAt 是全有或全无，被打断时不推进。这与 §8.8 规则 1「用户没主动
        // 发起的运行不许打断他」一致 —— 所以它 catch 掉一切，界面上不留任何痕迹。
        //
        // 后端开关经 Registry 读（中国版没有 backend.config 的那半边）—— src/ 不摸
        // MT_* 全局，这是 src-boundaries 门定的边界。
        const be = Registry.backend();
        if (be && be.enabled && typeof LearnSync !== 'undefined') {
          LearnSync.autoSync(Date.now()).catch(() => {});
        }
      } catch (_) { /* silent + total */ }
    })();
    return () => { alive = false; };
  }, []);

  // ── 渲染 ──────────────────────────────────────────────────────────────────
  // hidden 纪律：每个 id 都常驻 DOM，可见性只是派生布尔。#site-switch 所在 .row 的
  // display 由「是否被更宽的通配规则挡住」派生（原版 closest('.row') 导航，这里
  // 结构已知，直接写在那一行上）。
  return (
    <>
      <div className="popup-header">
        <div className="logo">
          {/* 大肚猴 mark — the canonical icons/icon.svg, referenced not restated
               (design/handoff.md §3; same-package URLs work in extension pages). */}
          <img src="../icons/icon.svg" width="36" height="36" alt="" />
        </div>
        {/* **产品名**，不是 extension_name。后者是商店条目的标题，为搜索长尾词而长，
             在 320px 的弹窗里它自己就占掉三行，把整个弹窗顶成一张海报（2026-09-02 用户实测）。
             商店那个名字属于商店，不属于产品里面。 */}
        <h1>{t('product_name', '大肚猴翻译')}</h1>
        <div className={'badge' + (pageTranslated ? ' on' : '')} id="status-badge">{badgeText}</div>
      </div>

      {/* Onboarding: says what to do BEFORE the user hits a bad first result.
           刻意由用户主动点，不在 onInstalled 里自动开页 ——
           background.js:63-70 已用实测封死那条路（劫持标签页 + 让 layout 套挂起）。 */}
      <button
        className={firstRunVisible ? 'setup-note' : 'setup-note'}
        id="first-run"
        type="button"
        style={{ display: firstRunVisible ? 'block' : 'none' }}
        onClick={firstRunVisible
          ? () => openTab(chrome.runtime.getURL('onboard/onboard.html'))
          : undefined}
      >{firstRunVisible ? t('extob_first_run', '第一次用？两分钟把它配好 →') : ''}</button>

      <div
        className={setupNote ? 'setup-note warn clickable' : 'setup-note'}
        id="setup-note"
        style={{ display: setupNote ? 'block' : 'none' }}
        onClick={setupNote ? goSettingsAndClose : undefined}
      >{setupNote ? setupNote.text : ''}</div>

      {/* 复习入口。到期为 0 时这一行仍然显示（只是没有计数）—— 藏起来会让整个功能
           无从发现。计数不用 action badge：service worker 在 Safari iOS 上会死，
           badge 会静默过期。 */}
      <div className="section" id="review-section" hidden={setup}>
        <button className="row row-btn" id="open-review"
          onClick={() => openTab(chrome.runtime.getURL('learn/review.html'))}>
          <span className="row-label">{t('learn_review', '复习')}</span>
          <span className="row-value" id="review-count">{due}</span>
        </button>
      </div>

      {/* 文档翻译（learning-design §9.7）：上传 PDF / Word / 图片，打开一页翻一页。开新标签页。 */}
      <div className="section" id="docs-section" hidden={setup}>
        <button className="row row-btn" id="open-docs"
          onClick={() => openTab(chrome.runtime.getURL('learn/docs.html'))}>
          <span className="row-label">{t('doc_popup_row', '📄 翻译文档（PDF / Word / 图片）')}</span>
        </button>
      </div>

      {/* 本站（interaction-spec「来源治理」）：页内快速入口刻意放在弹窗里 ——
           采集对浏览流必须零打扰。被规则挡住的页面在这里可见、可修复（法则 2）。
           只在「采集学习材料」开着且页面可注入时显示。 */}
      <div className="section" id="site-section" hidden={setup || !siteVisible}>
        <div className="row" style={{ display: switchHidden ? 'none' : '' }}>
          <span className="row-label">
            <span>{t('popup_site_capture', '收录本站')}</span>
            <br />
            <span className="hint" id="site-host">{siteHost}</span>
          </span>
          <label className="switch" id="site-switch">
            <input
              type="checkbox"
              id="site-capture"
              checked={!siteBlocked}
              disabled={siteBusy}
              onChange={onSiteCapture}
            />
            <span className="slider" />
          </label>
        </div>
        <button className="row row-btn" id="site-blocked-row" hidden={!switchHidden}
          onClick={() => { try { chrome.runtime.openOptionsPage(); } catch (_) {} }}>
          <span className="row-label hint" id="site-blocked-by">
            {switchHidden ? t('learn_src_blocked_by', '由规则 {pattern} 屏蔽').replace('{pattern}', blockingRule) : ''}
          </span>
          <span className="row-value">{t('popup_site_manage', '管理…')}</span>
        </button>
      </div>

      <div className="section" id="lang-section" hidden={setup}>
        <div className="row">
          <span className="row-label">{t('popup_target_lang', '目标语言')}</span>
          <select id="target-lang" className="select"
            value={s.targetLang || 'zh-CN'} onChange={onTargetLang}>
            {/* 语言名是 endonym（每种语言自己的名字），interaction-spec 判定原样
                显示、不进翻译表。 */}
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="es">Español</option>
            <option value="ar">العربية</option>
            <option value="pt">Português</option>
            <option value="ru">Русский</option>
            <option value="it">Italiano</option>
          </select>
        </div>
      </div>

      {/* 引擎 / API Key / 接口地址 / 模型**不在这里**。它们曾经是设置页的一份缩水
           复制品，而且带着一个设置页早就修掉、这一份没修的缺陷：Key 只挂 change（失焦），
           iOS 上粘完直接锁屏就静默丢了（1.6.8 的同款事故）。未配置时由上面的 #setup-note
           整条可点，把人送到设置页那一个入口。 */}

      {/* 反馈 / 评分。两个都是 <a>：点击直接由浏览器处理，不经 window.open，也就没有
           用户手势的坑。地址由 learn/feedback.js 统一给；评分行在没有商店条目的宿主上藏掉。 */}
      <div className="section" id="feedback-section">
        <a className="row row-btn" id="feedback-mail" target="_blank" rel="noopener" href={fb.mail}>
          <span className="row-label">{t('feedback_row', '发送反馈')}</span>
        </a>
        <a className="row row-btn" id="feedback-rate" target="_blank" rel="noopener"
          hidden={!fb.rate} href={fb.rate}>
          <span className="row-label">{t('feedback_rate', '去商店评分')}</span>
        </a>
      </div>

      {/* 「🎙 转写」常显（interaction-spec 五态表，2026-09-11）：此前只在媒体 ≥ 30 s 时出现，
           否则整节 hidden —— 元数据没到、播放器在 shadow root 或 iframe 里，用户看到的都是
           「什么都没有」。 */}
      <div className="section" id="asr-section" hidden={asrHidden}>
        <button className="row row-btn" id="transcribe-media" type="button" onClick={onTranscribe}>
          <span className="row-label" id="transcribe-media-label">{asrLabel}</span>
          <span className="row-value hint" id="transcribe-media-hint">{asrHint}</span>
        </button>
        <div className="setup-note" id="transcribe-media-note" hidden={!asrNoteText}>
          {asrNoteText}
        </div>
        {/* 常驻的 App 出口（2026-09-16 用户裁定「常驻」）。扩展端只剩整段转写，
             取不出音轨的媒体（视频站、直播、DRM）一律落到 App —— 它听的是设备正在放的
             声音。**非 Apple 平台整行不出**（App 在那里根本不存在），由 AppLink 决定，
             不在这里判 UA。 */}
        <button className="row row-btn" id="asr-app-row" type="button"
          hidden={!appRowVisible} onClick={onAppRowClick}>
          <span className="row-label" id="asr-app-label">
            {appRowVisible ? t('popup_asr_app_row', '🔊 用 App 听设备的声音') : ''}
          </span>
          <span className="row-value hint" id="asr-app-hint">
            {appRowVisible
              ? (handheld ? t('popup_asr_app_hint_ios', '先开始听，再回来播放')
                : t('popup_asr_app_hint_mac', '直播、视频站都能转'))
              : ''}
          </span>
        </button>
      </div>

      <div className="section actions" id="actions-section" hidden={setup}>
        <button className="btn-primary" id="btn-translate" disabled={busy}
          onClick={onTranslate}>{translateLabel}</button>
        <button className="btn-secondary" id="btn-settings"
          onClick={() => { try { chrome.runtime.openOptionsPage(); } catch (_) {} }}>
          {t('btn_more_settings', '更多设置')}
        </button>
      </div>

      <div id="toast" className={toast ? 'toast show' : 'toast'}>{toast}</div>
    </>
  );
}

// 用量事件：扩展页打开即 flush（内容脚本攒下的队列由这里送走），顺便记当日心跳。
// 模块级执行一次 —— 在 React 挂载之前，与原版脚本尾部的时机一致。
try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.init({ flushNow: true }); } catch (_) {}

createRoot(document.getElementById('root')).render(<Popup />);
