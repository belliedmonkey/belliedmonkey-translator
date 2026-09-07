// popup.js

// Provider list is the build-time registry (window.MT_PROVIDERS, generated per
// flavor from build/providers.config.js).
const PROVIDERS = (window.MT_PROVIDERS || []);
const providerById = (id) => EngineState.byId(id);

const $ = id => document.getElementById(id);

// i18n: localized string by the UI language (user-selectable `uiLang`, default = OS
// locale), consulting the bundled MT_I18N_MESSAGES table, then chrome.i18n, then the
// in-markup fallback. chrome.i18n.getMessage alone can't be switched at runtime.
let _uiLang = 'auto';
function normalizeLocale(tag) {
  const T = window.MT_I18N_MESSAGES || {};
  if (!tag) return '';
  const s = String(tag).replace(/-/g, '_');
  if (T[s]) return s;
  const base = s.split('_')[0];
  if (base === 'zh') return T.zh_CN ? 'zh_CN' : (T.zh_TW ? 'zh_TW' : '');
  if (T[base]) return base;
  for (const k of Object.keys(T)) if (k.split('_')[0] === base) return k;
  return '';
}
function effectiveLocale() {
  if (_uiLang && _uiLang !== 'auto') { const n = normalizeLocale(_uiLang); if (n) return n; }
  try { const n = normalizeLocale(chrome.i18n.getUILanguage()); if (n) return n; } catch (_) {}
  return 'zh_CN';
}
const t = (key, fb) => {
  try {
    const T = window.MT_I18N_MESSAGES;
    if (T) { const loc = effectiveLocale(); const m = T[loc] && T[loc][key]; if (m) return m; }
    const cm = chrome.i18n.getMessage(key); if (cm) return cm;
  } catch (_) {}
  return fb;
};
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { const m = t(el.dataset.i18n, ''); if (m) el.textContent = m; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { const m = t(el.dataset.i18nPlaceholder, ''); if (m) el.placeholder = m; });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { const m = t(el.dataset.i18nAria, ''); if (m) el.setAttribute('aria-label', m); });
}

// Explicit keys, never get(null) by default: the bucket also holds the unbounded
// `tr:` cache and the `lq:` learning outbox (docs/learning-design.md §7). The read
// goes through PageSettings because an extension page on Safari iOS gets nothing back
// — this popup showed "Google 翻译（免费）" while the page it was describing had just
// been translated by the user's own DeepSeek key.
const POPUP_KEYS = [
  // apiBaseUrl / apiModel **刻意不在这里**：弹窗不再配引擎，那是设置页那一个入口的事。
  // 留下的三个是**只读不写**的：provider + apiKey 用来判断「配没配好」，uiLang 用来
  // 决定弹窗自己显示成哪种语言 —— 不再让你在这里**改**它，不等于可以不**读**它。
  // 这份清单是全仓第四份手抄的设置键表，没有任何门禁盯着它。
  'enabled', 'targetLang', 'uiLang', 'provider', 'apiKey', 'engineChosen',
  'extObSeen',
  'textColor', 'ytTextColor', 'fontSize', 'showFab', 'learnEnabled', 'learnDailyNew',
  'learnRules',
];
async function getSettings() {
  const r = await PageSettings.read(POPUP_KEYS);
  // The popup has no room for an explanation; it must at least not lie. When the
  // read failed we show what we have and mark it, rather than presenting defaults
  // as if they were the user's configuration.
  if (!r.ok) { try { document.body.dataset.settingsUnavailable = '1'; } catch (_) {} }
  return r.data;
}

function showToast(msg, duration = 2000) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

async function saveSettings(patch) {
  return new Promise(resolve => chrome.storage.local.set(patch, resolve));
}

// Say what to do BEFORE the first bad result, not after. Two mutually exclusive
// states: a keyed engine with no key (translation WILL fail — warn), or the free
// no-key engine (works, but it is not a stable endpoint and can hand back the
// original text unchanged, which reads as "the extension is broken"). A configured
// keyed engine shows nothing.
function updateSetupNote(provider, apiKey, chosen) {
  const el = $('setup-note');
  if (!el) return;
  // 判据取自 content/engine-state.js —— 与悬浮球、设置页同一份，且**先归一化 provider**。
  //
  // 只剩两支：要么引导去配，要么什么都不说。原来还有第三支「当前使用免费通道，
  // 不需要 API Key —— 适合先看看效果」，2026-09-01 去掉：决策不再为免费通道开特例，
  // 第一优先级是一键配置。那句话的作用是安抚一个我们其实想让他去配的人。
  const unset = EngineState.needsSetup({ provider, apiKey, engineChosen: chosen });
  // 弹窗不再提供配置控件，所以这条提示的职责从「说明」变成**引导**：整条可点，
  // 点开设置页。interaction-spec 要求 setup note 同时出现在弹窗与设置页两处，
  // 那条契约仍然成立 —— 变的是它把人送去哪儿。
  el.onclick = null;
  el.classList.remove('clickable');
  if (unset) {
    el.textContent = t('popup_need_setup', '还没配好翻译引擎 —— 点这里去设置页，一把 key 就能配好。');
    el.classList.add('warn', 'clickable');
    el.onclick = () => { try { chrome.runtime.openOptionsPage(); } catch (_) {} window.close(); };
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// 「还没配好」时，弹窗只留一个入口。
//
// 未配置的人打开弹窗，看到的应该是一件事，不是六件：复习（还没有卡）、收录本站
// （采集还没开）、目标语言（翻不出来，选给谁看）、翻译本页（点了只会失败）——
// 这些在那个状态下不是功能，是分散注意力的噪音，而且每一个都会把人引向一次失败。
//
// 判据取**配好了没有**（content/engine-state.js），不取「有没有走过引导」——那两件事
// 可以任意组合：按过一次「以后再设置」的人 extObSeen 已置位而一句也翻不出来；在设置页
// 点过「重看引导」的人配得好好的却没置位。
//
// ⚠️ 2026-09-01 之前这里写着「用免费通道、没走过引导的人是能用的，不该被拦」。那句话
// 随裁定作废了：出厂默认的免费引擎不再算已配好，所以全新安装的人**会**被折叠成一个
// 入口。主动点选过免费引擎的人才不被拦（engineChosen）。
function applyUnconfigured(blocked) {
  for (const id of ['review-section', 'site-section', 'lang-section', 'actions-section']) {
    const el = $(id);
    if (!el) continue;
    if (blocked) el.hidden = true;
    // blocked=false 时不要在这里取消隐藏：#site-section 有它自己的显示条件
    // （采集开着且页面可注入），这里一律放出来会把那条条件覆盖掉。
  }
  if (blocked) { const fr = $('first-run'); if (fr) fr.style.display = 'none'; }
}

// 首次运行入口。只在 extObSeen 未置位时出现，点了就开引导页。
//
// **extObSeen 是流程标记，不是配置标记** —— 它只回答「这个人看过引导页没有」。
// 全仓只有这一处读它（test/ext-ob-seen.test.js 钉着这一条）：拿它当「配好了」的信号
// 会立刻出错，因为任何一次「以后再设置」都会写它，而设置页的「重看引导」会删掉它。
//
// **故意不复用 App 的 onboardSeen 这个键名**：两边存储不通（app/chrome-shim.js 把
// chrome.storage 垫在 file:// 的 localStorage 上），同名会让以后读代码的人以为它们
// 是一回事，然后写出「App 看过了扩展就不用看」这种错的联动。
function updateFirstRun(seen) {
  const el = $('first-run');
  if (!el) return;
  if (seen) { el.style.display = 'none'; return; }
  el.textContent = t('extob_first_run', '第一次用？两分钟把它配好 →');
  el.style.display = 'block';
  el.onclick = () => {
    try { window.open(chrome.runtime.getURL('onboard/onboard.html'), '_blank'); } catch (_) {}
    window.close();
  };
}


let pageTranslated = false; // whether the current page is currently translated

function updateTranslateUI() {
  $('btn-translate').textContent = pageTranslated ? t('btn_view_original', '查看原文') : t('btn_translate_page', '翻译本页');
  const badge = $('status-badge');
  badge.textContent = pageTranslated ? t('status_translated', '已翻译') : t('status_untranslated', '未翻译');
  badge.classList.toggle('on', pageTranslated);
}

async function sendToPage(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { action });
  } catch (_) {
    return null; // content script not loaded on this page (e.g. chrome://)
  }
}

// ─── 本站 (interaction-spec 「来源治理」) ───────────────────────────────
// The current page's capture switch. URL comes from the content script's own
// getPageStatus (the same url the capture gate judged); chrome.tabs is the
// fallback for a page whose content script predates this popup opening.

let siteRules = null;      // the live learnRules object (or null)
let siteUrl = '';

function writeSiteRules(mutate) {
  const base = siteRules || { v: 1, block: [], langs: null };
  siteRules = Object.assign({}, base, mutate(base), { v: 1, updatedAt: Date.now() });
  // No forced sync here: the popup closes too fast to babysit a request. The
  // rules ride the next natural push/pull (§8.9) from any longer-lived surface.
  return saveSettings({ learnRules: siteRules });
}

function renderSiteSection(learnEnabled) {
  const section = $('site-section');
  if (!section) return;
  if (!learnEnabled || !siteUrl || !/^https?:/i.test(siteUrl)) { section.hidden = true; return; }
  const host = LearnRules.siteRuleFor(siteUrl);
  if (!host) { section.hidden = true; return; }
  section.hidden = false;
  $('site-host').textContent = host;

  const blocked = LearnRules.isBlocked(siteUrl, siteRules);
  const exact = ((siteRules && siteRules.block) || [])
    .find((p) => LearnRules.normalizePattern(p) === host);
  const switchRow = $('site-switch').closest('.row');
  if (blocked && !exact) {
    // Blocked by a BROADER wildcard rule: a switch here would lie (toggling it
    // could not unblock the site). Name the rule and offer 管理 instead.
    switchRow.style.display = 'none';
    $('site-blocked-row').hidden = false;
    $('site-blocked-by').textContent =
      t('learn_src_blocked_by', '由规则 {pattern} 屏蔽').replace('{pattern}', findBlockingRule());
  } else {
    switchRow.style.display = '';
    $('site-blocked-row').hidden = true;
    $('site-capture').checked = !blocked;
  }
}

function findBlockingRule() {
  for (const p of (siteRules && siteRules.block) || []) {
    if (LearnRules.matchesUrl(p, siteUrl)) return p;
  }
  return '';
}

async function init() {
  // Clear the first-run dot (background.js sets it on install). Clearing the GLOBAL
  // badge is safe: the per-tab 'ON' badges are stored separately and take precedence,
  // so an active translation keeps its indicator.
  try { chrome.action.setBadgeText({ text: '' }); } catch (_) { /* best-effort */ }

  const s = await getSettings();
  _uiLang = s.uiLang || 'auto';
  applyI18n();

  // Populate UI
  $('target-lang').value = s.targetLang || 'zh-CN';
  // provider / apiKey 只读不写：弹窗用它们判断「配没配好」，配置本身在设置页。
  // out-of-flavor 的引擎迁移也随之去掉 —— 那是配置动作，属于设置页。
  updateSetupNote(s.provider, s.apiKey, s.engineChosen);
  updateFirstRun(s.extObSeen);
  // 顺序要紧：先让两条提示各自决定显不显示，再由这一步把其余的收起来。
  applyUnconfigured(EngineState.needsSetup(s));

  // Reflect the CURRENT page's translation state (not a stored default).
  const pageStatus = await sendToPage('getPageStatus');
  pageTranslated = !!(pageStatus && pageStatus.enabled);
  updateTranslateUI();

  // §2.4 「转写音频字幕」: shown only when the page has a media element ≥ 30 s. The
  // click starts the session in the page and closes the popup — the overlay is where
  // progress and every stop reason are shown.
  const asrSection = $('asr-section');
  const durationS = (pageStatus && pageStatus.media && pageStatus.media.durationS) || 0;
  const live = !!(pageStatus && pageStatus.media && pageStatus.media.live);
  if (asrSection && (live || durationS >= 30)) {
    asrSection.hidden = false;
    const hint = $('transcribe-media-hint');
    if (hint) hint.textContent = live ? 'LIVE' : Math.floor(durationS / 60) + ':' + String(Math.round(durationS % 60)).padStart(2, '0');
    $('transcribe-media').addEventListener('click', async () => {
      const r = await sendToPage('transcribeMedia');
      if (r && r.ok) window.close();
    });
  }

  // 本站 section — only meaningful while capture is on at all.
  siteRules = s.learnRules || null;
  siteUrl = (pageStatus && pageStatus.url) || '';
  if (!siteUrl) {
    // Content script not present (page predates install, or a restricted page):
    // fall back to the tab url; a chrome:// url fails the https? check and hides
    // the section.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      siteUrl = (tab && tab.url) || '';
    } catch (_) {}
  }
  renderSiteSection(s.learnEnabled === true);

  $('site-capture').addEventListener('change', async (e) => {
    // interaction-spec 全局原则: the write + forced sync are in flight — the
    // toggle locks so a rapid double-flip can't interleave two rule writes.
    const ctl = e.target;
    ctl.disabled = true;
    try {
      const host = LearnRules.siteRuleFor(siteUrl);
      if (!host) return;
      if (ctl.checked) {
        await writeSiteRules((r) => ({ block: (r.block || []).filter((p) => LearnRules.normalizePattern(p) !== host) }));
        showToast(t('learn_src_unblock', '恢复收录'));
      } else {
        await writeSiteRules((r) => ({
          block: (r.block || []).indexOf(host) >= 0 ? r.block : (r.block || []).concat([host]),
        }));
        showToast(t('learn_src_block', '不再收录'));
      }
      renderSiteSection(s.learnEnabled === true);
    } finally { ctl.disabled = false; }
  });
  $('site-blocked-row').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // ─── Event listeners ────────────────────────────────────────────────

  $('target-lang').addEventListener('change', async (e) => {
    await saveSettings({ targetLang: e.target.value });
    showToast(t('toast_lang_switched', '语言已切换'));
  });

  // 复习入口。The row renders immediately and the count fills in when IndexedDB
  // resolves — the popup must never wait on the corpus to paint.
  $('open-review').addEventListener('click', () => {
    window.open(chrome.runtime.getURL('learn/review.html'), '_blank');
    window.close();
  });
  (async () => {
    try {
      // 库的选择仍然是**跟随**，不是决策：弹窗读 learnActiveDb，照别的面已经做过
      // 并落盘的决定走。（bindCorpus 那条策略仍然不在这里跑 —— 它要读会话、要判
      // 认领，属于「有界面负责解释结果」的那类动作。）
      try {
        const r = await PageSettings.read(['learnActiveDb']);
        if (r.ok && r.data.learnActiveDb) await LearnStore.useDb(r.data.learnActiveDb);
      } catch (_) {}
      await LearnDrain.run();
      const items = await LearnStore.allItems();
      const due = LearnScheduler.dueCount(items, Date.now());
      const el = $('review-count');
      if (el) el.textContent = due > 0 ? String(due) : '';

      // ── 弹窗也是一次心跳（§8.8）────────────────────────────────────────
      //
      // 在**画完数字之后**才发起，永不挡在它前面 —— 这一面的第一职责仍然是快点
      // 给出那个数。
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
      if (typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled
          && typeof LearnSync !== 'undefined') {
        LearnSync.autoSync(Date.now()).catch(() => {});
      }
    } catch (_) { /* silent + total */ }
  })();


  // Toggle: 翻译本页 ↔ 查看原文. Re-translating is cache-first (TranslationAPI cache).
  $('btn-translate').addEventListener('click', async (e) => {
    // interaction-spec 全局原则: locked across the content-script roundtrip, and
    // the status toast fires BEFORE the await — feedback that arrives only after
    // the work settles tells the user nothing while they wait.
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      if (pageTranslated) {
        const r = await sendToPage('disablePage');
        // sendToPage never throws — it resolves null when no content script
        // answered. Flipping state on null would paint a status the page is
        // not in, so both branches gate the flip on a real response.
        if (r == null) { showToast(t('msg_translate_failed_retry', '⚠️ 翻译失败——点按重试')); return; }
        pageTranslated = false;
        showToast(t('toast_restored_original', '已恢复原文'));
      } else {
        showToast(t('toast_translating', '正在翻译…'));
        const r = await sendToPage('translatePage');
        if (r == null) { showToast(t('msg_translate_failed_retry', '⚠️ 翻译失败——点按重试')); return; }
        pageTranslated = true;
      }
      updateTranslateUI();
    } finally { btn.disabled = false; }
  });

  $('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();

// ─── 反馈 / 评分 ────────────────────────────────────────────────────────────
// 只填 href。评分行在这个宿主没有商店条目时（中国版 Chrome/Firefox）保持 hidden ——
// 指向一个不存在的页比没有这一行更糟。
(() => {
  try {
    const mail = document.getElementById('feedback-mail');
    if (mail) mail.href = MTFeedback.mailtoUrl('popup');
    const rate = document.getElementById('feedback-rate');
    const url = MTFeedback.rateUrl();
    if (rate && url) { rate.href = url; rate.hidden = false; }
  } catch (_) { /* 反馈入口坏了不能拖垮弹窗本身 */ }
})();

// 用量事件：扩展页打开即 flush（内容脚本攒下的队列由这里送走），顺便记当日心跳。
try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.init({ flushNow: true }); } catch (_) {}
