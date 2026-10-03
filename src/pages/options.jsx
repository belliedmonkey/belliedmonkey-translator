// pages/options.jsx — 扩展设置页（PR5 React 迁移）。前身 extension/options/options.js
// （本 PR 删除）。范式与 docs/domain-design.md §10.9 相同（onboard.jsx 是第一份）。
//
// 与命令式版本的对应关系：
//   · 原 36 键手抄清单             → SETTINGS_SCHEMA.keysFor('options')（schema 是唯一
//                                    登记处；本文件通篇不再出现那份清单的标识符，
//                                    store-schema-i18n 门禁按行扫描）。保存动作实际写
//                                    的键域收进 options-model.js 的 SAVE_KEYS（33 键，
//                                    差集 5 键每条有名有姓，test/options-model.test.js
//                                    对账）。
//   · saveAll()（整体覆盖式，DOM   → saveNow()：只补「store 里还没有的那部分」——
//     才是真相源）                    flush 500ms 防抖 + 收割六个不受控框（高级参数×4、
//                                    每日新卡数），走 setMany 一次落盘。其余 27 键在
//                                    各自的 onChange 里已经进了 store —— store 即镜像，
//                                    不存在「整体覆盖」这回事，也就不存在「少回填一个
//                                    控件就静默清空」那一族事故。
//   · applyI18n / 三处手动重画     → useT() + useUiLang()：改界面语言 = 一次 store 写入，
//                                    全树（含四个引擎孤岛、一键卡、额度卡）自动换语言。
//   · update*UI / paintDeps /      → 从 state 派生：hidden、禁用、提示行全部是
//     updateSetupNote 手动重画        store 快照的纯函数，写入方即订阅者。
//   · EngineFields ×4 / QuickSetup / LearnGrant / DepLine / SourcesView
//                                  → 命令式孤岛（§10.9 规则 4）：ref 容器 + effect 挂载，
//                                    render 幂等；React 只写容器级 hidden，孤岛内部 DOM
//                                    归孤岛。共享模块源码一字不改（§9.4）。
//   · chrome.storage 原生写（grant marks、learnRules 整键、reqCustomParams 读-改-写、
//     optDetailMode、清缓存）      → 原样保留 —— 它们是「事件记录/整键 JSON」，不是
//                                    逐键设置；learnRules 与 reqCustomParams 写完会被
//                                    总线送回 store，页面照样响应式重画。
//
// 行为差异（逐条声明，PR 描述同文）：
//   首帧空窗：settings 读回前文案输出空串（原版静态 HTML 中文兜底再被 applyI18n 覆盖）。
//   toast 单 state + 定时器：连发不再互相覆盖残留（原版多个 setTimeout 各自摘 class）。
//   换 uiLang 单点写入：三件手动重画（applyI18n/populateProviders/updateProviderUI）
//   由响应式承担，下拉与提示行自动换语言。
//   高级参数数字框：React onChange≈input，中间态（钳制后）短暂入库；失焦才 toast。
//   每日新卡数：同上，输入即写钳制值，失焦才 toast。
//   「打开文档翻译」按钮不再嵌套注册在「打开复习页」的首次点击里（原版怪癖，修正）。
//   signOut 里 loadSettings/restoreSettings/restore 三连死代码删除（本页从未定义过它们）。
//   #sync-or（手机号「或者」分隔行）不迁：手机号通道未接通，原版那行只在
//   phoneOtp 开启时改口，本页从未渲染过分隔行。
//   btn-tts-test 的形状检查改读 store 值（原版读 #tts-base-url 的 DOM 值）。

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import PageText from '../lib/i18n.js';
import Registry from '../lib/registry.js';
import SETTINGS_SCHEMA from '../store/schema.js';
import SettingsStore from '../store/settings-store.js';
import { useSettings, useSettingsStatus, useUiLang } from '../store/hooks.js';
import {
  SAVE_KEYS, scaleValue, advNum as advNumClamp, learnDailyNew as dailyNewClamp,
  apiHint as apiHintStr, syncError as syncErrorText,
} from './options-model.js';
import LearnDialog from '../shared/dialog.jsx';

// PR7b：共享模块从「HTML script 标签挂 window + typeof 守卫」改成 ESM import
// （§9.4：两宿主 import 同一份源、同一次编译）。四个渲染宿主在本页仍是命令式孤岛
// （§10.9 规则 4）——变了的只有全局查找这一层：render 经各 view 文件的 named export
// 进来（它们保留旧 render 的 `box.hidden` 写入与返回句柄语义，孤岛读回判据不变），
// 纯逻辑经各自的源文件进来。
import EngineFields from '../shared/engine-fields.js';
import QuickSetup from '../shared/quick-setup.js';
import { render as renderQuickSetup } from '../shared/quick-setup-view.jsx';
import { render as renderEngineFields } from './engine-fields-view.jsx';
import * as LearnGrant from '../shared/grant.js';
import { render as renderGrant } from '../shared/grant-view.jsx';
import * as SourcesView from '../shared/sources-view-view.jsx';
import DepLineView from '../shared/dep-line-view.jsx';
import '../shared/dialog-host.jsx';   // 副作用：挂 DialogHost 宿主 div + uiLang 就位 + window.LearnDialog ABI

// 这一行是「有哪些键」的唯一来源（schema）。保存动作的键域是 SAVE_KEYS（33），
// 两者差集由 test/options-model.test.js 钉死。
const READ_KEYS = SETTINGS_SCHEMA.keysFor('options');

// 模式档位单独存：UI 状态不是配置（原 optDetailMode 同一理由）。
const DETAIL_KEY = 'optDetailMode';

// 回调落在我们自己的站点上。两个 flavor 两个站，但中国版扩展的 sync 在构建期被
// 整段移除，所以这一行实际只会在国际版里被读到 —— 仍然按 flavor 写，免得哪天
// 中国版打开同步时这里悄悄指错站。
const PROVIDER_REDIRECT = (Registry.flavor() === 'china')
  ? 'https://belliedmonkey.com/auth/done.html'
  : 'https://belliedmonkey.cc/auth/done.html';

// store 的当前值拼一个 settings 形状的对象（孤岛的 values / 治理区现读用）。
function readSnapshot(keys) {
  const out = {};
  for (const k of keys) out[k] = SettingsStore.get(k);
  return out;
}

// ─── 孤岛输入框 → 存储键（EngineFields 吐出的 id 就是这一套）────────────────
const INPUT_KEYS = {
  'api-key': 'apiKey', 'api-base-url': 'apiBaseUrl', 'api-model': 'apiModel',
  'notes-api-key': 'notesApiKey', 'notes-base-url': 'notesBaseUrl', 'notes-model': 'notesModel',
  'stt-api-key': 'sttApiKey', 'stt-base-url': 'sttBaseUrl', 'stt-model': 'sttModel',
  'tts-api-key': 'ttsApiKey', 'tts-base-url': 'ttsBaseUrl', 'tts-model': 'ttsModel',
};
// 文本框失焦时的专属 toast（原 change 监听逐条）；不在表里 = 无 toast（notes/stt 三框）。
// 中文一律走 t() 的兜底位 —— 零硬编码文案门禁按这个形状放行。
function changeToastFor(id, t) {
  if (id === 'api-key') return t('toast_apikey_saved', 'API Key 已保存');
  if (id === 'api-base-url') return t('toast_apiurl_saved', 'API 地址已保存');
  if (id === 'api-model') return t('toast_model_saved', '模型已保存');
  if (id === 'tts-base-url' || id === 'tts-api-key' || id === 'tts-model') return t('toast_saved', '已保存');
  return '';
}

// 自定义请求参数提示行的纯逻辑（原 updateCustomNote 的文案分支）。
function customNoteFor(raw, t) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let obj;
  try { obj = JSON.parse(s); } catch (e) {
    return t('options_adv_custom_bad', '解析不了，本次不会发送：') + e.message;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return t('options_adv_custom_notobj', '需要是一个 JSON 对象，本次不会发送。');
  }
  const dropped = Object.keys(obj).filter((k) => RequestShape.CUSTOM_FORBIDDEN.indexOf(k) >= 0);
  const kept = Object.keys(obj).filter((k) => RequestShape.CUSTOM_FORBIDDEN.indexOf(k) < 0);
  const none = t('options_adv_custom_none', '（无）');
  return t('options_adv_custom_ok', '将发送：') + (kept.join(', ') || none)
    + (dropped.length ? '\n' + t('options_adv_custom_dropped', '不可覆盖，已忽略：') + dropped.join(', ') : '');
}

// 引擎自检的 URL 行 / 通路行（原 withUrl / withRoute，逐字同义）。
function withUrl(text, url, t) {
  return text + (url
    ? '\n' + t('engine_test_url', '请求地址：{url}').replace('{url}', String(url))
    : '');
}
function withRoute(text, route, t) {
  return text + (route
    ? '\n' + t('engine_test_route', '通路：{route}').replace('{route}',
      route === 'proxy' ? t('engine_test_route_proxy', '扩展后台（不受跨域限制，不发预检）')
        : t('engine_test_route_direct', '直连（从页面发出，会先发 OPTIONS 预检）'))
    : '');
}

// 云端用量（原 fmtSize）：固定「MB」在 50 KB 量级读出 0.0，长文本看不见增长。
function fmtSize(n) {
  return n < 1024 * 1024
    ? Math.round(n / 1024) + ' KB'
    : (n / 1024 / 1024).toFixed(1) + ' MB';
}

// ─── 清除本机全部数据（原 init 内三函数逐字提升为模块级）────────────────────
// 判据是**回读**，不是「没报错」。四个去处：chrome.storage.local、mt-learn* 那组
// IndexedDB（按账号分库）、登录态本身、活句柄。少清一处就是没清。
async function wipeEverything(t) {
  const before = await new Promise((r) => {
    setTimeout(() => r([]), 3000);
    try { chrome.storage.local.get(null, (o) => r(Object.keys(o || {}))); } catch (_) { r([]); }
  });
  try { await LearnAuth.signOut(); } catch (_) { /* 没登录 / 网络不通都不该挡住清除 */ }
  try { await LearnStore.closeDb(); } catch (_) {}
  await deleteLearnDbs();
  try { if (typeof DocStore !== 'undefined') await DocStore.wipe(); } catch (_) {}
  await new Promise((r) => {
    let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    setTimeout(fin, 3000);
    try { chrome.storage.local.clear(fin); } catch (_) { fin(); }
  });
  const after = await new Promise((r) => {
    setTimeout(() => r(null), 3000);
    try { chrome.storage.local.get(null, (o) => r(o || {})); } catch (_) { r(null); }
  });
  const dbs = await learnDbNames();
  const leftover = after ? before.filter((k) => k in after)
    : [t('wipe_left_unreadable', '存储读不回来')];
  return { leftover, dbsLeft: dbs };
}

// 列出还存在的 mt-learn* 库。没有 indexedDB.databases() 时**不能**退回「返回当前库名」
// —— 那只是一个名字，不是「库还在」的证据；改成逐个探测，探出「本来不存在」就回滚。
async function learnDbNames() {
  try {
    if (indexedDB.databases) {
      const l = await indexedDB.databases();
      return (l || []).map((d) => d && d.name).filter((n) => n && /^mt-learn/.test(n));
    }
  } catch (_) { /* 有这个 API 但调用失败 ⇒ 走下面的探测 */ }
  const cur = LearnStore.currentDbName ? LearnStore.currentDbName() : LearnStore.DB_NAME;
  const names = cur ? [cur] : [];
  const alive = [];
  for (const n of names) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await new Promise((r) => {
      let fresh = false;
      let req;
      setTimeout(() => r(true), 2500);      // 探不出来就当它还在：宁可报失败，不可谎报成功
      try { req = indexedDB.open(n); } catch (_) { r(true); return; }
      req.onupgradeneeded = () => { fresh = true; };
      req.onsuccess = () => {
        try { req.result.close(); } catch (_) {}
        if (fresh) { try { indexedDB.deleteDatabase(n); } catch (_) {} }
        r(!fresh);
      };
      req.onerror = () => r(true);
    });
    if (exists) alive.push(n);
  }
  return alive;
}

async function deleteLearnDbs() {
  const names = await learnDbNames();
  await Promise.all(names.map((n) => new Promise((r) => {
    // blocked 不结束请求 —— 它只是在说「还有人开着」。给个上限，然后靠回读定胜负。
    setTimeout(r, 4000);
    let req;
    try { req = indexedDB.deleteDatabase(n); } catch (_) { r(); return; }
    req.onsuccess = r; req.onerror = r;
  })));
}

// ─── 锚点表（#sync / #learn / #stt / #tts / #review / #grant / #engine）──────
// 别处把人往这里送时，落点必须是**看得见的目标**。before 标记落点前要切的档位：
// 'detail'（槽卡在详细档）/'quick'（额度卡在快速档）。jump() 里用 flushSync 执行 ——
// 原版 applyDetailMode 是同步 DOM 操作，React 里不 flush 就会读到一个仍然 hidden
// 的节点然后直接返回。
const ANCHORS = {
  '#sync': {
    sec: 'sync-section',
    focus: () => {
      const out = document.getElementById('sync-out');
      if (!out || out.hidden) return null;
      const eb = document.getElementById('sync-email-block');
      if (eb && !eb.hidden) return document.getElementById('sync-email');
      const a = document.getElementById('btn-sync-apple');
      if (a && !a.hidden) return a;
      return document.getElementById('btn-sync-email');
    },
  },
  '#learn': {
    sec: 'learn-card',
    focus: () => document.getElementById('learn-enabled'),
    flash: () => { const el = document.getElementById('learn-enabled'); return el && el.closest('.field'); },
  },
  '#stt': {
    sec: 'stt-card', before: 'detail',
    focus: () => document.getElementById('stt-engine'),
    flash: () => { const el = document.getElementById('stt-engine'); return el && el.closest('.field'); },
  },
  '#tts': {
    sec: 'tts-card', before: 'detail',
    focus: () => document.getElementById('tts-engine'),
    flash: () => { const el = document.getElementById('tts-engine'); return el && el.closest('.field'); },
  },
  '#review': {
    sec: 'review-card',
    focus: () => document.getElementById('tts-mode'),
    flash: () => { const el = document.getElementById('tts-mode'); return el && el.closest('.field'); },
  },
  '#grant': {
    sec: 'grant-card', before: 'quick',
    focus: () => { const b = document.getElementById('grant-box'); return b && b.querySelector('button, a'); },
  },
  '#engine': {
    sec: 'engine-card', before: 'detail',
    focus: () => document.getElementById('api-key'),
    flash: () => { const el = document.getElementById('api-key'); return el && el.closest('.field'); },
  },
};

const BE = Registry.backend();                 // backend.config.js 先于 bundle 加载
const AVAIL = (BE && BE.providers) || [];      // 后端真开着的第三方登录；表外按钮直接不渲染
const PHONE_OTP = !!(BE && (BE.phoneOtp === true
  || (BE.phoneOtp === 'cn' && Registry.flavor() === 'china')));

// ─── 组件 ────────────────────────────────────────────────────────────────────

function Options() {
  const t = PageText.useT();
  const status = useSettingsStatus();
  const s = useSettings(READ_KEYS);
  const uiLangNow = useUiLang();

  // ── 页面级状态 ──
  const [initTimedOut, setInitTimedOut] = useState(false);   // 3 秒读超时（原版保命）
  const [bootErr, setBootErr] = useState('');
  const [readFailed, setReadFailed] = useState(false);
  const [readFailWhy, setReadFailWhy] = useState('');
  const [detail, setDetailState] = useState(false);          // false = 快速档（默认）
  const [quickAvail, setQuickAvail] = useState(true);
  const [advOpen, setAdvOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [busyTick, setBusyTick] = useState(0);

  // ── 学习库 / 缓存 ──
  const [learnStats, setLearnStats] = useState('');
  const [learnPressure, setLearnPressure] = useState('');
  const [cleanBtn, setCleanBtn] = useState({ hidden: true, label: '' });
  const [cacheStatus, setCacheStatus] = useState('');
  const [ttsCacheLine, setTtsCacheLine] = useState('');
  const [ttsCacheTick, setTtsCacheTick] = useState(0);

  // ── 语音 ──
  const [voiceOpts, setVoiceOpts] = useState([]);
  const [voicesTick, setVoicesTick] = useState(0);

  // ── 高级参数 ──
  const [customNote, setCustomNote] = useState('');

  // ── 关于 ──
  const [telAvail, setTelAvail] = useState(false);
  const [telOn, setTelOn] = useState(false);
  const [fbMail, setFbMail] = useState('');
  const [fbDisc, setFbDisc] = useState('');
  const [fbRate, setFbRate] = useState('');
  const [unpacked, setUnpacked] = useState(false);
  const [version, setVersion] = useState('');

  // ── 同步 / 登录 ──
  const [sess, setSess] = useState(null);
  const [syncMsg, setSyncMsg] = useState('');
  const [whoLine, setWhoLine] = useState('');
  const [usageLine, setUsageLine] = useState('');
  const [nextAppLine, setNextAppLine] = useState('');
  const [appUid, setAppUid] = useState('');
  const [appFallback, setAppFallback] = useState(null);      // null | 'store' | 'other'
  const [prepOk, setPrepOk] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [codeStep, setCodeStep] = useState(false);
  const [emailVal, setEmailVal] = useState('');
  const [codeVal, setCodeVal] = useState('');

  // ── 免费额度（paintGrant 的落定回 React）──
  const [grantCardHidden, setGrantCardHidden] = useState(true);
  const [grantSumHidden, setGrantSumHidden] = useState(true);

  // ── 来源治理 ──
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // ── refs ──
  const bootSnapRef = useRef(null);          // 启动快照（quickShows / prefill 冻结用）
  const quickShowsRef = useRef(null);        // 一键卡表示得了这份配置吗（null = 表示不了）
  const engineSetSentRef = useRef('');
  const toastTimer = useRef(null);
  const inputTimer = useRef(null);
  const pendingPatch = useRef({});           // 500ms 防抖窗口里攒的孤岛输入
  const chatClearedRef = useRef(false);      // 四个组件「我帮你清了端点」的回报
  const ttsClearedRef = useRef(false);
  const notesClearedRef = useRef(false);
  const sttClearedRef = useRef(false);
  const grantBusyRef = useRef(false);
  const grantUnavailableRef = useRef(false); // 503 grant_unavailable 之后为真，只影响本会话
  const busyIds = useRef(new Set());         // interaction-spec：IO 在途，控件不可用

  // 孤岛容器
  const engineCoreRef = useRef(null);
  const ttsCoreRef = useRef(null);
  const notesCoreRef = useRef(null);
  const sttCoreRef = useRef(null);
  const extrasRef = useRef(null);            // <template id="engine-extras">（React 渲染）
  const apiHintElRef = useRef(null);         // 挂进孤岛的那一行 #api-hint（克隆体）
  const chatCoreRef = useRef(null);
  const ttsCoreHandleRef = useRef(null);
  const notesCoreHandleRef = useRef(null);
  const sttCoreHandleRef = useRef(null);
  const grantBoxRef = useRef(null);
  const quickRef = useRef(null);
  const quickMountedRef = useRef(false);
  const learnLangsRef = useRef(null);
  const sourcesRef = useRef(null);
  const fileRef = useRef(null);
  const codeInputRef = useRef(null);
  const emailInputRef = useRef(null);
  // 不受控的六个框（高级参数 ×4 + 每日新卡数）+ 自定义参数草稿
  const advTempRef = useRef(null);
  const advMaxRef = useRef(null);
  const advTimeoutRef = useRef(null);
  const advConcRef = useRef(null);
  const dailyNewRef = useRef(null);

  // 活快照给异步回调（split-long 的重翻、测试钮）用
  const sRef = useRef(s);
  sRef.current = s;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const quickAvailRef = useRef(quickAvail);
  quickAvailRef.current = quickAvail;
  const tRef = useRef(t);
  tRef.current = t;

  const ready = status !== 'loading' || initTimedOut;
  // 首帧门控：settings 读回前文案输出空串（与 onboard 同一纪律）。
  const T = (k, fb) => (ready ? t(k, fb) : '');

  // ── 基础动作 ────────────────────────────────────────────────────────────────

  const showToast = (msg, duration) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg || '');
    toastTimer.current = setTimeout(() => setToastMsg(''), duration || 2500);
  };

  // interaction-spec 全局原则（IO 在途，控件不可用）：按控件记忙、重入拒绝。
  const isBusy = (id) => busyIds.current.has(id);
  const withBusy = async (id, fn) => {
    if (busyIds.current.has(id)) return undefined;
    busyIds.current.add(id);
    setBusyTick((x) => x + 1);
    try { return await fn(); }
    finally { busyIds.current.delete(id); setBusyTick((x) => x + 1); }
  };

  // engine_set 的判据是 **EngineState.needsSetup**，不是「在下拉里选了什么」。
  // 放在保存汇合处（saveNow / 换引擎 / 一键卡）而不是某个控件的监听上，就不会漏。
  const maybeTrackEngineSet = () => {
    if (typeof MTTelemetry === 'undefined' || typeof EngineState === 'undefined') return;
    try {
      const st = {
        provider: SettingsStore.get('provider'),
        apiKey: SettingsStore.get('apiKey'),
        engineChosen: !!SettingsStore.get('engineChosen'),
      };
      if (EngineState.needsSetup(st)) return;        // 还没配完 —— 这不是一次「配好了」
      const id = EngineState.resolve(st.provider);
      if (!id || id === engineSetSentRef.current) return;   // 同一个引擎不重复记
      engineSetSentRef.current = id;
      MTTelemetry.track('engine_set', { provider: String(id) });
    } catch (_) {}
  };

  // saveNow()：store 即镜像之后，它只剩两件事 —— flush 防抖窗口、收割六个不受控框。
  // 只在三处被调：三个「测试连接」钮与 applyQuickSetup 的开头（smoke 的「过期快照」
  // 断言依赖这个顺序：先把手打的 key 落进存储，一键卡现读时才能看见它）。
  const saveNow = async () => {
    clearTimeout(inputTimer.current);
    const patch = {};
    if (pendingPatch.current && Object.keys(pendingPatch.current).length) {
      Object.assign(patch, pendingPatch.current);
      pendingPatch.current = {};
    }
    const cl = RequestShape.CLAMP;
    patch.reqTemperature = advNumClamp(advTempRef.current ? advTempRef.current.value : '', cl.reqTemperature);
    patch.reqMaxTokens = advNumClamp(advMaxRef.current ? advMaxRef.current.value : '', cl.reqMaxTokens);
    patch.reqTimeoutSec = advNumClamp(advTimeoutRef.current ? advTimeoutRef.current.value : '', cl.reqTimeoutSec);
    patch.reqConcurrency = advNumClamp(advConcRef.current ? advConcRef.current.value : '', cl.reqConcurrency);
    patch.learnDailyNew = dailyNewClamp(dailyNewRef.current ? dailyNewRef.current.value : '', LearnScheduler.DEFAULTS.dailyNew);
    // 键域兜一道：setMany 对未知键整单拒绝，SAVE_KEYS 之外的一个都不能混进来。
    const filtered = {};
    for (const k of SAVE_KEYS) if (k in patch) filtered[k] = patch[k];
    if (Object.keys(filtered).length) await SettingsStore.setMany(filtered);
    maybeTrackEngineSet();
  };

  // ── 派生（全部从 store 快照来）──────────────────────────────────────────────
  // A stored provider from another flavor may not exist in this build → fall
  // back to the first registry provider available here（原 init 同一句）。
  const prov = EngineState.byId(s.provider) ? s.provider : EngineState.defaultId();
  const engineChosen = !!s.engineChosen;
  const effTextColor = s.textColor || Registry.palette().textColor || '';
  const effYtTextColor = s.ytTextColor || Registry.palette().ytTextColor || '';
  const apiHintText = apiHintStr(prov, t, (id) => EngineState.byId(id));
  const ttsEngineById = (id) => Registry.ttsEngines().find((e) => e.id === id) || null;
  const ttsEntry = ttsEngineById(s.ttsEngine);
  const ttsEngineHint = (ttsEntry && ttsEntry.hintKey) ? t(ttsEntry.hintKey, '') : '';
  const sttEntry = Registry.sttEngines().find((x) => x.id === s.sttEngine) || null;
  const notesVisible = !!s.notesProvider;
  const customParams = (s.reqCustomParams && typeof s.reqCustomParams === 'object') ? s.reqCustomParams : {};

  // 能力表说当前 host+模型不收某个参数时，那个格子里的值不会被发送 —— 在它旁边
  // 直接说出来，并把输入框置灰（「表赢，但界面上说明原因」的落点）。
  let advCaps = {};
  try {
    advCaps = RequestShape.paramsFor(
      WireFormat.resolveEndpoint(String(s.apiBaseUrl || '').trim(),
        Registry.providers().find((p) => p.id === prov)),
      String(s.apiModel || '').trim(),
    ) || {};
  } catch (_) { advCaps = {}; }

  // setup-note 三态：读失败优先于引导建议（告诉一个我们读不到他 key 的人「去填 key」
  // 比什么都不说更糟）；needsSetup 的两支不能共用一句话 —— needsKey 为真是「引擎要
  // Key 而 Key 空」，否则是「还没配过」（第二支**不许**变回「你可以先用免费通道」）。
  const needsSetup = EngineState.needsSetup({ provider: prov, apiKey: s.apiKey, engineChosen });
  let setupNote = '';
  if (bootErr) {
    setupNote = T('options_init_failed', '设置页没能加载完（{err}）。请重新打开这个页面；若仍然如此，请把这条信息反馈给我们。')
      .replace('{err}', bootErr);
  } else if (readFailed) {
    setupNote = T('settings_read_failed', '读不到已保存的设置，下面显示的是默认值——请不要在此保存，否则会覆盖掉你原来的配置。（{why}）')
      .replace('{why}', readFailWhy || '');
  } else if (needsSetup) {
    setupNote = EngineState.needsKey({ provider: prov, apiKey: s.apiKey })
      ? T('setup_need_key', '这个引擎需要 API Key。填入下面的 Key 之后翻译才会工作。')
      : T('setup_not_configured', '还没配过翻译引擎。用上面的一键配置，或切到「详细」里选一个引擎并填上 Key。');
  }
  const setupNoteShown = !!setupNote;

  // ── 学习库统计 / 存储压力 ───────────────────────────────────────────────────
  const refreshLearnStats = async () => {
    try {
      // 打开这一页也是把 outbox 排进语料的少数机会（内容脚本不能：origin 不对；
      // service worker 不可信：Safari iOS）。
      await LearnDrain.run();
      const st = await LearnStore.stats();
      const due = LearnScheduler.dueCount(await LearnStore.allItems(), Date.now());
      setLearnStats(st.total
        ? t('learn_stats', '学习库 {n} 条 · 待复习 {due} · 约 {kb} KB')
          .replace('{n}', String(st.total))
          .replace('{due}', String(due))
          .replace('{kb}', String(Math.max(1, Math.round(st.approxChars / 1024))))
        : t('learn_stats_empty', '学习库为空'));
    } catch (_) { setLearnStats(''); }   // silent + total（domain-design §9.1 law 2）
  };

  const refreshPressure = async () => {
    try {
      const p = await LearnStore.pressure();
      if (!p) { setLearnPressure(''); setCleanBtn({ hidden: true, label: '' }); return; }
      let msg = '';
      if (p.dropped > 0) {
        msg = t('learn_pressure_dropped', '有 {n} 条采集内容没能存下来（学习库满时会发生）。').replace('{n}', String(p.dropped));
      } else if (p.evicted > 0) {
        msg = t('learn_pressure_evicted', '学习库已满，已自动淘汰 {n} 张旧卡为新内容腾地方。').replace('{n}', String(p.evicted));
      } else if (p.atCap || p.nearCap) {
        msg = t('learn_pressure_near', '学习库快满了（{n} / {cap}）。').replace('{n}', String(p.total)).replace('{cap}', String(p.cap));
      }
      // §7.5 — 备份失败不是丢失（语料还活着），但对开了学习的用户不许静默。
      try {
        const bm = await LearnBackup.meta();
        if (bm && bm.lastError) {
          msg += (msg ? ' ' : '') + t('learn_backup_failed', '本地备份未能写入（{why}）。学习库本身不受影响。')
            .replace('{why}', String(bm.lastError));
        }
      } catch (_) {}
      setLearnPressure(msg);
      // Offering a cleanup that would free nothing is worse than offering none.
      const hidden = p.reclaimable === 0;
      setCleanBtn({
        hidden,
        label: hidden ? '' : t('learn_clean_known_n', '清理已掌握的 {n} 张卡').replace('{n}', String(p.reclaimable)),
      });
    } catch (_) { setLearnPressure(''); setCleanBtn({ hidden: true, label: '' }); }
  };

  // ── 语音缓存行（浏览器引擎不产生缓存，就说那句，而不是挂一个坏的 0 KB）──────
  const refreshTtsCache = async () => {
    try {
      const st = await LearnStore.audioStats();
      const e = ttsEngineById(SettingsStore.get('ttsEngine'));
      if (e && !e.returnsAudio) { setTtsCacheLine(t('tts_cache_na', '设备内置语音不产生缓存')); return; }
      setTtsCacheLine(st.count
        ? t('tts_cache', '语音缓存 {n} 条 · 约 {mb} MB（上限 {cap} MB）')
          .replace('{n}', String(st.count))
          .replace('{mb}', String(Math.max(1, Math.round(st.bytes / 1048576))))
          .replace('{cap}', String(Math.round(LearnStore.MAX_AUDIO_BYTES / 1048576)))
        : t('tts_cache_empty', '语音缓存为空'));
    } catch (_) { setTtsCacheLine(''); }
  };

  // ── 免费额度（这一页是领取的唯一落点）──────────────────────────────────────
  // async 命令式画（原 paintGrant 逐字）：marks 不在 schema 里（grant/grantTail/
  // grantBalance 是事件记录不是设置），必须走 chrome.storage；layout effect 里不能
  // await，所以整段留在异步函数里、由 effect 与各动作显式调用。
  const paintGrant = async () => {
    const box = grantBoxRef.current;
    if (!box) return;
    const gs = LearnGrant.enabled() ? await LearnAuth.currentStable() : null;
    // **必须 await 并取 .data**：PageSettings.read 是异步的、返回 {ok, data}。把
    // Promise 当设置传给 status() 的那次事故：领完额度卡上永远显示「你在用自己的 key」。
    const rd = await PageSettings.read(READ_KEYS);
    const cur = (rd && rd.data) || {};
    let marks = {};
    try {
      marks = await new Promise((res) => chrome.storage.local.get(['grant', 'grantTail', 'grantBalance'], (v) => res(v || {})));
    } catch (_) {}
    const st = LearnGrant.status(Object.assign({}, cur, marks),
      { signedIn: !!gs, unavailable: grantUnavailableRef.current });
    renderGrant(box, {
      t: tRef.current, status: st, balance: marks.grantBalance || null, busy: grantBusyRef.current,
      flavor: Registry.flavor(),
      keyUrl: (Registry.providers().find((x) => x.keyUrl) || {}).keyUrl || '',
      onAction: (id) => grantAction(id),
    });
    // render 把「有没有卡要画」写在 box.hidden 上（发生在 React 的 DOM 之外）——
    // 立刻对齐回 state，section 级 hidden 由此收敛在一处。
    const cardHidden = !!box.hidden;
    setGrantCardHidden(cardHidden);
    setGrantSumHidden(cardHidden || !marks.grantTail);
  };

  const applyQuickSetup = async (plan) => {
    // 先把手打的 key / 六个不受控框落进存储（smoke「过期快照」断言的确定性机制）。
    await saveNow();
    const w = plan.writes || {};
    const patch = {};
    for (const k of SAVE_KEYS) if (k in w) patch[k] = w[k];
    if (Object.keys(patch).length) await SettingsStore.setMany(patch);
    // 孤岛按新值重画（layout effect 以 applyEpoch 为键重跑，values 从 store 现读）。
    setApplyEpoch((e) => e + 1);
    // 一键卡写过三槽之后额度卡的状态可能变了（用自己的 key 盖掉免费槽 ⇒ 「改回免费额度」）。
    try { await paintGrant(); } catch (_) {}
    maybeTrackEngineSet();
  };

  const grantAction = async (id) => {
    if (id === 'signin') {
      // 登录表单就在本页。滚过去并聚焦，而不是开一个新页面。
      const sec = document.getElementById('sync-section');
      if (sec && !sec.hidden) {
        try { sec.scrollIntoView({ block: 'start' }); } catch (_) { sec.scrollIntoView(); }
        const a = document.getElementById('btn-sync-apple');
        const f = a && !a.hidden ? a : document.getElementById('btn-sync-email');
        if (f) { try { f.focus({ preventScroll: true }); } catch (_) { f.focus(); } }
      }
      return;
    }
    if (id === 'byo') {
      const p = Registry.providers().find((x) => x.keyUrl);
      if (p && p.keyUrl) window.open(p.keyUrl, '_blank', 'noopener');
      return;
    }
    if (id === 'community') { window.open(MTFeedback.discussUrl(), '_blank', 'noopener'); return; }
    if (id !== 'claim' && id !== 'restore') return;

    // 「改回免费额度」会覆盖用户自己粘的 key —— 必须先问一句（页内确认框）。
    // （import 进来的实现不会缺席，旧 typeof 守卫的静默跳过路径随之退役 —— 那条
    // 路径正是 options.html 老注释里记过的 2026-09-10 事故形状。）
    if (id === 'restore') {
      const okGo = await LearnDialog.confirm(t('grant_restore_confirm', '改回免费额度会替换掉你现在填的 key。要继续吗？'));
      if (!okGo) return;
    }

    grantBusyRef.current = true;
    await paintGrant();
    try {
      const claimed = await LearnGrant.claim();
      const rd = await PageSettings.read(READ_KEYS);
      // 读不出已存设置就不许写：往一份读不出来的档案上盖三组配置，正是
      // 「你的 key 静默变成了免费通道」那一类事故。
      if (!rd || !rd.ok) throw Object.assign(new Error(rd && rd.error || 'settings_unreadable'), { code: 'storage' });
      const cur = rd.data || {};
      const plan = LearnGrant.plan(claimed, cur, window, { overwrite: id === 'restore' });
      await applyQuickSetup(plan);
      try { chrome.storage.local.set(plan.marks); } catch (_) {}
      // grant_claimed 由 LearnGrant.claim() 自己记（telemetry-design §3.4）—— 不在调用方。
      // §8.10.3（2026-09-30）：判据从「写过任何一槽」改成「**翻译槽**真被写了」（grant.toastKey）。
      // 两句文案各自留在静态 t() 的 fallback 位 —— no-hardcoded-copy 门禁要能核对「键 ↔ 文案」。
      showToast(LearnGrant.toastKey(plan) === 'grant_claimed_toast'
        ? t('grant_claimed_toast', '免费额度已配好')
        : t('grant_claimed_kept_toast', '免费额度已领到。你自己的 key 保留着 —— 想换用额度，点「改回免费额度」。'));
    } catch (e) {
      if (e && e.code === 'grant_unavailable') grantUnavailableRef.current = true;
      showToast(syncErrorText(e, t));
    } finally {
      grantBusyRef.current = false;
      await paintGrant();
    }
  };

  // 登录即自动领取（2026-10-02，用户要求）。与 App 侧的 autoClaimGrant 同一条纪律：
  //   · 只判「这个 flavor 有没有额度这条路」（中国版 MT_GRANT 可能为 null）；
  //   · overwrite:false —— 只写空槽，绝不碰用户自己粘的 key；
  //   · 一次页面会话只试一次；失败静默（手动「领取」按钮仍在，错误交给它说）。
  // 挂在 refreshSyncUI 上：那是所有登录路径的汇合点（邮箱验证码 / 第三方回跳 /
  // 打开设置页时已经登录）。判据：test/grant-one-implementation.test.js。
  const autoClaimRef = useRef(false);
  const autoClaimGrant = async () => {
    if (autoClaimRef.current) return;
    autoClaimRef.current = true;
    try {
      if (!LearnGrant.enabled()) return;
      const rd = await PageSettings.read(READ_KEYS);
      // 读不出已存设置就不写 —— 往一份读不出来的档案上盖配置，正是「你的 key 静默变成
      // 免费通道」那一类事故（与手动「领取」同一条纪律）。
      if (!rd || !rd.ok) return;
      const cur = rd.data || {};
      if (LearnGrant.active(cur)) return;              // 已经在用额度，不必再领
      const claimed = await LearnGrant.claim();
      const plan = LearnGrant.plan(claimed, cur, window, { overwrite: false });
      await applyQuickSetup(plan);
      try { chrome.storage.local.set(plan.marks); } catch (_) {}
      await paintGrant();
    } catch (_) { /* 自动领取失败不打断页面；手动「领取」仍在 */ }
  };

  // ── 同步（可选）────────────────────────────────────────────────────────────
  const refreshSyncUI = async () => {
    // 额度卡跟着登录态走；refreshSyncUI 在页面加载与每次登录/退出后都会跑。
    try { await paintGrant(); } catch (_) {}
    const gs = await LearnAuth.currentStable();
    try { await LearnAuth.bindCorpus(gs); } catch (_) {}
    setSess(gs);
    if (!gs) {
      setUsageLine('');
      // Storage-read failure ≠ signed out（§8.4.1）：表单照常显示，状态行说失败。
      if (LearnAuth.lastLoadError()) {
        setSyncMsg(t('sync_status_storage_error', '读不到登录状态（存储读取失败），稍后自动重试 —— 这不代表已退出登录。'));
      }
      return;
    }
    setWhoLine(t('sync_signed_in', '已登录：{email}').replace('{email}', LearnAuth.displayName(gs)));
    try {
      const u = await LearnSync.usage();
      setUsageLine(t('sync_usage', '云端已用 {used} / {quota} · {n} 个数据块')
        .replace('{used}', fmtSize(u.bytes)).replace('{quota}', fmtSize(u.quota))
        .replace('{n}', String(u.chunks)));
    } catch (_) { setUsageLine(''); }
    setNextAppLine(t('sync_next_app',
      '接下来：在 iPhone / Mac 的 App 里用同一个邮箱（{email}）登录，这些卡才会出现在那边。')
      .replace('{email}', LearnAuth.displayName(gs)));
    setAppUid(gs.userId || '');
    // 登录即自动领取免费额度。不 await：它不该挡住同步与状态刷新（失败静默）。
    autoClaimGrant().catch(() => {});
  };

  const runSync = async () => {
    await withBusy('btn-sync-now', async () => {
      setSyncMsg(t('sync_running', '同步中…'));
      try {
        const r = await LearnSync.sync(Date.now());
        // "Needs upgrade" is not a failure and must not be worded as one.
        if (r.pulled.needsUpgrade) {
          setSyncMsg(t('sync_err_upgrade', '云端有这个版本还读不了的内容（可能来自更新版本的扩展）。请升级扩展后再同步——那些内容没有丢，只是暂时读不了。'));
        } else {
          setSyncMsg(t('sync_done', '同步完成 · 收到 {in} 张 · 上传 {out} 张')
            .replace('{in}', String(r.pulled.cards)).replace('{out}', String((r.pushed && r.pushed.pushed) || 0)));
        }
        await Promise.all([refreshLearnStats(), refreshPressure(), refreshSyncUI()]);
      } catch (e) { setSyncMsg(syncErrorText(e, t)); }
    });
  };

  // 手工粘票：Safari iOS 上内容脚本可能没有那一站的权限，落地页于是把票显示出来。
  const tryPastedTicket = async (raw) => {
    const m = /^([A-Za-z0-9_.\-]+)\.([A-Za-z0-9_\-]+)$/.exec(String(raw || '').trim());
    if (!m) return false;
    setSyncMsg(t('sync_verifying', '验证中…'));
    try {
      await LearnAuth.completeProviderSignIn({ code: m[1], state: m[2] });
      await refreshSyncUI();
      setSyncMsg(t('sync_signed_in_now', '已登录。第一次同步可能要几秒。'));
      await runSync();
    } catch (e) { setSyncMsg(syncErrorText(e, t)); }
    return true;
  };

  const btnSyncCode = async () => {
    await withBusy('btn-sync-code', async () => {
      const who = String(emailVal || '').trim();
      if (!who) {
        setSyncMsg(t('sync_need_id_dyn', '先填{what}').replace('{what}', PHONE_OTP ? T('sync_email_or_phone', '邮箱或手机号') : T('sync_email', '邮箱')));
        return;
      }
      setSyncMsg(t('sync_sending', '发送中…'));
      try {
        const r = await LearnAuth.signIn(who);
        setCodeStep(true);
        if (codeInputRef.current) { try { codeInputRef.current.focus(); } catch (_) {} }
        setSyncMsg(r.via === 'phone'
          ? t('sync_code_sent_sms', '验证码已发到 {who} 的短信，填在下面。').replace('{who}', who)
          : t('sync_code_sent', '验证码已发到 {email}，填在下面。').replace('{email}', who));
      } catch (e) { setSyncMsg(syncErrorText(e, t)); }
    });
  };

  const btnSyncVerify = async () => {
    await withBusy('btn-sync-verify', async () => {
      // 粘进来的如果是落地页给的那张票（code.state），走兑换而不是验证码。
      if (await tryPastedTicket(codeVal)) { setCodeVal(''); return; }
      setSyncMsg(t('sync_verifying', '验证中…'));
      try {
        await LearnAuth.verify(String(emailVal || '').trim(), String(codeVal || '').trim());
        setCodeVal('');
        setCodeStep(false);
        await refreshSyncUI();
        setSyncMsg(t('sync_signed_in_now', '已登录。第一次同步可能要几秒。'));
        await runSync();
      } catch (e) {
        setSyncMsg(e && e.status === 403 || e && e.status === 401
          ? t('sync_bad_code', '验证码不对或已过期，重新发一个。')
          : syncErrorText(e, t));
      }
    });
  };

  const btnSyncOut = async () => {
    await withBusy('btn-sync-out', async () => {
      // 免费额度在用时先确认一次；退出清掉三槽令牌与 grantTail / grantBalance。
      const cur = await new Promise((res) => chrome.storage.local.get(['apiKey', 'ttsApiKey', 'sttApiKey', 'grantTail'], (v) => res(v || {})));
      if (LearnGrant.active(cur)) {
        const go = await LearnDialog.confirm(t('grant_signout_confirm', '退出登录后免费额度会停用（余额保留，再登录就回来）。要退出吗？'), { ok: t('sync_signout', '退出登录') });
        if (!go) return;
      }
      await LearnAuth.signOut();
      if (cur.grantTail) {
        const c = LearnGrant.clearOnSignOut(cur);
        await new Promise((res) => chrome.storage.local.set(c.writes, () => chrome.storage.local.remove(['grantTail', 'grantBalance'], res)));
      }
      // The corpus stays. Signing out is not a reason to lose what you learned.
      await LearnSync.forget();
      await refreshSyncUI();
      setSyncMsg(t('sync_signed_out', '已退出登录。本机的学习库原样保留。'));
    });
  };

  const btnSyncDelete = async () => {
    await withBusy('btn-sync-delete', async () => {
      // busy() 在这里是保命的：双击曾经对着一个不可逆端点发出两次删除。
      if (!window.confirm(t('sync_delete_confirm', '删除云端数据与账号？服务器上的所有内容与这个账号都会被删除，无法恢复。本机的学习库会保留。'))) return;
      setSyncMsg(t('sync_deleting', '删除中…'));
      try {
        const r = await LearnAuth.deleteAccount();
        await LearnSync.forget();
        await refreshSyncUI();
        setSyncMsg(r.account
          ? t('sync_deleted', '云端数据与账号都已删除。本机的学习库保留。')
          : t('sync_deleted_partial', '云端数据已删除，但账号没能删掉（{why}）。可以重试或联系我们。')
            .replace('{why}', String(r.reason || '')));
      } catch (e) { setSyncMsg(syncErrorText(e, t)); }
    });
  };

  // ── 来源治理（learnRules 整键写，走 LearnRules.withUpdate 成形）────────────
  const writeRules = async (mutate) => {
    // 成形只有一处（LearnRules.withUpdate）—— 这段逻辑曾经被抄了四份，第四份漏了
    // updatedAt，于是那台设备的规则永远输给远端、也永远推不上去，全程零报错。
    const base = sRef.current.learnRules || null;
    const next = LearnRules.withUpdate(base, mutate(base || { v: 1, block: [], langs: null }));
    await new Promise((r) => chrome.storage.local.set({ learnRules: next }, r));
    sRef.current = Object.assign({}, sRef.current, { learnRules: next });
    renderGovernance();
    // A deliberate rules edit deserves a prompt push (rides the next chunk, §8.9).
    if (BE && BE.enabled) {
      LearnSync.autoSync(Date.now(), { force: true }).then((r) => {
        if (r) { refreshLearnStats(); refreshPressure(); }
      }).catch(() => {});
    }
  };

  const renderLangChipsUI = () => {
    const box = learnLangsRef.current;
    if (!box) return;
    const rules = sRef.current.learnRules || null;
    SourcesView.renderLangChips(box, {
      registry: Registry.langs(),
      langs: rules && rules.langs,
      t: tRef.current,
      // MUST return the promise: SourcesView's lock() holds the chip disabled
      // until this settles. Dropping it re-enables mid-write and reopens the
      // stale-closure lost-update race (two quick taps, first language lost).
      onChange: (langs) => writeRules(() => ({ langs }))
        .then(() => showToast(t('toast_saved', '已保存'))),
    });
  };

  const renderSourcesManager = async () => {
    const box = sourcesRef.current;
    if (!box || !sourcesOpen) return;
    let items = []; let sources = [];
    try {
      [items, sources] = await Promise.all([LearnStore.allItems(), LearnStore.allSources()]);
    } catch (_) {}
    SourcesView.render(box, {
      items, sources, rules: sRef.current.learnRules || null, t: tRef.current,
      onDelete: async ({ host, itemIds, sourceIds }) => {
        if (!itemIds.length) { showToast(t('learn_delete_none', '这个来源已没有可删的卡')); return; }
        if (!window.confirm(t('learn_delete_confirm', '删除 {host} 的 {n} 张卡？会同步到所有设备，不可恢复。')
          .replace('{host}', host).replace('{n}', String(itemIds.length)))) return;
        try {
          // 文档来源（§9.7）：删卡连文档本体一起删（确认框已写明）。
          for (const sid of (sourceIds || [])) {
            if (/^doc:/.test(sid) && typeof DocStore !== 'undefined') { try { await DocStore.remove(sid.slice(4)); } catch (_) {} }
          }
          const n = await LearnStore.deleteItems(itemIds, Date.now());
          await LearnStore.deleteSourcesIfOrphan(sourceIds);
          showToast(t('learn_delete_done', '已删除 {n} 张卡').replace('{n}', String(n)));
        } catch (_) { showToast(t('toast_learn_clear_failed', '清空失败')); }
        renderSourcesManager();
        refreshLearnStats();
        refreshPressure();
        // The delete must reach the server promptly — it is account intent (§7.4).
        if (BE && BE.enabled) LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
      },
      onBlock: (p) => writeRules((r) => ({
        block: (r.block || []).indexOf(p) >= 0 ? r.block : (r.block || []).concat([p]),
      })),
      onUnblock: (p) => writeRules((r) => ({ block: (r.block || []).filter((x) => x !== p) })),
      onAddRule: (p) => writeRules((r) => ({
        block: (r.block || []).indexOf(p) >= 0 ? r.block : (r.block || []).concat([p]),
      })),
      onInvalidRule: () => showToast(t('learn_block_invalid', '规则格式不对')),
    });
  };

  const renderGovernance = () => {
    renderLangChipsUI();
    renderSourcesManager();
  };

  // ── 孤岛：四个引擎槽 + 委托监听 ────────────────────────────────────────────
  // renderEngineFields 的 onChange 在这一页**不写存储** —— 只记下组件有没有帮我们
  // 清掉端点（写盘走下面的委托监听，store 即真相源）。挂进孤岛的那几行（眼睛按钮、
  // 三条提示）从 React 渲染的 <template> 克隆 —— 克隆体脱离 React 所有权，随便挂。

  const buildEyeButton = () => {
    const src = extrasRef.current;
    if (!src) return null;
    const btn = src.querySelector('#toggle-eye');
    return btn ? btn.cloneNode(true) : null;
  };

  const onIslInput = (e) => {
    const key = INPUT_KEYS[e.target.id];
    if (!key) return;
    pendingPatch.current = Object.assign({}, pendingPatch.current, { [key]: String(e.target.value || '').trim() });
    clearTimeout(inputTimer.current);
    inputTimer.current = setTimeout(() => {
      const p = pendingPatch.current;
      pendingPatch.current = {};
      if (Object.keys(p).length) SettingsStore.setMany(p);
    }, 500);
  };

  const flushPending = async () => {
    clearTimeout(inputTimer.current);
    const p = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(p).length) await SettingsStore.setMany(p);
  };

  const onProviderChange = async (el) => {
    await flushPending();
    // 组件的 change 监听先跑并清端点；这里只读它的回报。
    const cleared = chatClearedRef.current;
    chatClearedRef.current = false;
    // 记下「这是一次主动选择」。出厂默认的免费引擎不算 —— 故意选了免费引擎的人
    // 不该被反复弹回引导页。单独写，不进 saveNow：它是一次事件的记录。
    await SettingsStore.set('engineChosen', 1);
    const patch = { provider: el.value };
    if (cleared) patch.apiBaseUrl = '';
    await SettingsStore.setMany(patch);
    if (chatCoreRef.current) chatCoreRef.current.paint();
    // ⚠️ 自定义参数按引擎存，切引擎必须**重新回填**。不做的话输入框里还留着上一个
    // 引擎的内容，用户随手一改就把 A 的参数存到了 B 名下。
    const cur = customParamsOf();
    setCustomNote(customNoteFor(cur[el.value] || '', t));
    const ta = document.getElementById('adv-custom');
    if (ta) ta.value = cur[el.value] || '';
    maybeTrackEngineSet();
    showToast(cleared ? t('toast_endpoint_cleared', '换引擎了，接口地址已清空')
      : t('toast_provider_saved', '翻译引擎已保存'));
  };

  const onTtsEngineChange = async (el) => {
    await flushPending();
    // 换引擎清端点由组件做，这里只读回报；Engine defaults differ, so the model
    // placeholder and voice list must follow the engine BEFORE the user picks a voice.
    const cleared = ttsClearedRef.current;
    ttsClearedRef.current = false;
    const patch = { ttsEngine: el.value, ttsVoice: '' };
    if (cleared) patch.ttsBaseUrl = '';
    await SettingsStore.setMany(patch);
    if (ttsCoreHandleRef.current) ttsCoreHandleRef.current.paint();
    showToast(cleared ? t('toast_endpoint_cleared', '换引擎了，接口地址已清空') : t('toast_saved', '已保存'));
  };

  const onGroupEngineChange = async (group, el) => {
    await flushPending();
    const clearedRef = group === 'notes' ? notesClearedRef : sttClearedRef;
    const cleared = clearedRef.current;
    clearedRef.current = false;
    const engineKey = group === 'notes' ? 'notesProvider' : 'sttEngine';
    const baseKey = group === 'notes' ? 'notesBaseUrl' : 'sttBaseUrl';
    const patch = { [engineKey]: el.value };
    if (cleared) patch[baseKey] = '';
    await SettingsStore.setMany(patch);
    if (group === 'notes' && notesCoreHandleRef.current) notesCoreHandleRef.current.paint();
    if (group === 'stt' && sttCoreHandleRef.current) sttCoreHandleRef.current.paint();
    // notes/stt 的三个文本框没有 toast（原版同）；换引擎要不要说清端点被清，要说。
    showToast(cleared ? t('toast_endpoint_cleared', '换引擎了，接口地址已清空') : t('toast_saved', '已保存'));
  };

  const onIslChange = async (e) => {
    const el = e.target;
    const id = el.id;
    if (id === 'provider') { await onProviderChange(el); return; }
    if (id === 'tts-engine') { await onTtsEngineChange(el); return; }
    if (id === 'notes-provider') { await onGroupEngineChange('notes', el); return; }
    if (id === 'stt-engine') { await onGroupEngineChange('stt', el); return; }
    const key = INPUT_KEYS[id];
    if (!key) return;
    await flushPending();
    await SettingsStore.setMany({ [key]: String(el.value || '').trim() });
    const toast = changeToastFor(id, t);
    if (toast) showToast(toast);
  };

  const onIslClick = (e) => {
    // 眼睛按钮是从模板克隆进孤岛的（React 所有权之外），点击走容器委托。
    if (e.target && e.target.closest && e.target.closest('#toggle-eye')) {
      const inp = chatCoreRef.current && chatCoreRef.current.rows.key.input;
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    }
  };

  // 四槽挂载。deps [ready, uiLangNow, applyEpoch]：ready 才有真值；换界面语言全部
  // 重挂换文案；applyEpoch 是「一键卡/额度卡刚写完盘」的信号（原 applyQuickSetup
  // 的「先回填控件再保存」在这里变成「写 store → epoch++ → 孤岛从 store 重画」）。
  const [applyEpoch, setApplyEpoch] = useState(0);
  const customParamsOf = () => {
    const v = SettingsStore.get('reqCustomParams');
    return (v && typeof v === 'object') ? v : {};
  };
  useLayoutEffect(() => {
    if (!ready) return undefined;
    const containers = [
      [engineCoreRef, 'chat', null],
      [ttsCoreRef, 'tts', null],
      [notesCoreRef, 'notes', () => LearnNotes.chatEngines()],
      [sttCoreRef, 'stt', null],
    ];
    const values = readSnapshot(READ_KEYS);
    const disposers = [];
    for (const [ref, slot, entriesFn] of containers) {
      const box = ref.current;
      if (!box) continue;
      box.textContent = '';
      const handle = renderEngineFields(box, {
        slot, t, head: false, values,
        entries: entriesFn ? entriesFn() : undefined,
        onChange: (patch) => {
          // 只记录「组件帮我们清了端点」；写盘走容器的委托监听。
          const baseKey = slot === 'chat' ? 'apiBaseUrl' : slot === 'tts' ? 'ttsBaseUrl'
            : slot === 'notes' ? 'notesBaseUrl' : 'sttBaseUrl';
          const flag = slot === 'chat' ? chatClearedRef : slot === 'tts' ? ttsClearedRef
            : slot === 'notes' ? notesClearedRef : sttClearedRef;
          if (baseKey in patch && patch[baseKey] === '') flag.current = true;
        },
      });
      if (slot === 'chat') {
        chatCoreRef.current = handle;
        // 这一页额外的东西，挂进组件交回来的那几行里。挂在行**内**是构成要件：
        // 字段按 visibility 收起时它们跟着收。
        const src = extrasRef.current;
        if (src && handle.rows) {
          const hintPs = src.querySelectorAll('p.hint');
          const apiHintEl = hintPs[0] ? hintPs[0].cloneNode(true) : null;
          const baseHint = hintPs[1] ? hintPs[1].cloneNode(true) : null;
          const modelHint = hintPs[2] ? hintPs[2].cloneNode(true) : null;
          if (apiHintEl) {
            apiHintEl.textContent = apiHintStr(SettingsStore.get('provider'), t, (x) => EngineState.byId(x));
            apiHintElRef.current = apiHintEl;
            handle.rows.key.row.append(apiHintEl);
          }
          if (baseHint) handle.rows.baseUrl.row.append(baseHint);
          if (modelHint) handle.rows.model.row.append(modelHint);
          const eye = buildEyeButton();
          if (eye) handle.rows.key.inputRow.append(eye);
        }
      }
      if (slot === 'tts') ttsCoreHandleRef.current = handle;
      if (slot === 'notes') notesCoreHandleRef.current = handle;
      if (slot === 'stt') sttCoreHandleRef.current = handle;
      // 委托监听挂在容器上（容器是 React 的，effect 清理时摘掉；core.el 每次重建，
      // 事件从 core.el 冒泡到容器正好被接住）。
      box.addEventListener('input', onIslInput);
      box.addEventListener('change', onIslChange);
      box.addEventListener('click', onIslClick);
      disposers.push(() => {
        box.removeEventListener('input', onIslInput);
        box.removeEventListener('change', onIslChange);
        box.removeEventListener('click', onIslClick);
      });
    }
    return () => { for (const d of disposers) d(); };
  }, [ready, uiLangNow, applyEpoch]);

  // #api-hint 行：引擎或界面语言变了就换文案（行在孤岛里，textContent 直接写）。
  useEffect(() => {
    if (apiHintElRef.current) apiHintElRef.current.textContent = apiHintText;
  }, [apiHintText]);

  // ── 一键卡孤岛（QuickSetup）────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!ready || !quickRef.current) return;
    // 界面语言变了要**重画**（2026-10-03，issue #559）：这批命令式孤岛是在
    // `PageText.setUiLang` 落地**之前**画的一次，而哨兵只放行一次 —— 于是把界面语言
    // 选成泰语的用户，在这张卡上看到的是 `chrome.i18n` 的兜底语言（本机 Chrome 是中文
    // ⇒ 页面上泰文与中文混排）。引擎字段那批孤岛的 deps 里早就有 uiLangNow（见上面
    // 「四槽挂载」的注释），只有这张卡漏了。代价：换语言会清掉卡里未保存的输入 ——
    // 换语言是低频动作，而且与「重画」本来就是同一件事。
    const quickLang = uiLangNow || 'auto';
    if (quickMountedRef.current === quickLang) return;
    quickMountedRef.current = quickLang;
    const s0 = bootSnapRef.current || readSnapshot(READ_KEYS);
    quickRef.current.textContent = '';
    renderQuickSetup(quickRef.current, {
      t,
      // 现读而不是快照：启动快照会变旧。拿旧快照判「配没配过」会覆盖用户刚在
      // 「详细」里输入的 key。
      readSettings: () => {
        if (typeof PageSettings !== 'undefined') return PageSettings.read(READ_KEYS);
        return new Promise((resolve) => {
          let settled = false;
          const done = (v) => { if (!settled) { settled = true; resolve(v); } };
          const timer = setTimeout(() => done({ ok: false, data: {} }), 3000);
          try {
            chrome.storage.local.get(READ_KEYS, (res) => {
              clearTimeout(timer);
              done({ ok: !!res, data: res || {} });
            });
          } catch (_) { clearTimeout(timer); done({ ok: false, data: {} }); }
        });
      },
      // 免费额度令牌的尾八位：让一键卡知道哪几个槽是「我们写的」、可以被用户自己的 key 盖掉。
      replaceKeyTail: () => new Promise((res) => chrome.storage.local.get(['grantTail'], (v) => res((v && v.grantTail) || ''))),
      // 配过的回显出来。一个空输入框在已经配好的页面上是假话。
      prefill: quickShowsRef.current ? { host: quickShowsRef.current.host, key: s0.apiKey } : null,
      targetLang: s0.targetLang,
      // 读不到已存设置时不许配：往一份读不出来的档案上盖三组配置。
      disabled: readFailed,
      onApply: applyQuickSetup,
      // 设置页配完就没有下一步了。
      showTry: true,
    });
    // render 之后立刻对齐回 props 的显隐（渲染器画内容，调用方定显隐 —— onboard
    // GrantIsland 的同一条分工）。
    quickRef.current.hidden = detail || !quickAvail;
    if (!quickRef.current.children.length) {
      // 这个 flavor 没有可一键的平台。不留空壳 —— _quickAvailable 让 applyDetailMode
      // 之后也一直藏着它。
      setQuickAvail(false);
      setDetailState(true);
      try { chrome.storage.local.set({ [DETAIL_KEY]: true }); } catch (_) {}
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // quickRef 容器的显隐随 React 派生值走（孤岛 render 自己动过 hidden，每次都按
  // props 收敛回来）。
  useEffect(() => {
    if (quickRef.current) quickRef.current.hidden = detail || !quickAvail;
  }, [detail, quickAvail]);

  // ── 额度卡孤岛（renderGrant；异步 paint，见 paintGrant）──────────────────────
  useLayoutEffect(() => {
    if (!ready) return;
    paintGrant().catch(() => {});
  }, [ready, uiLangNow]);

  // ── 依赖行（DepLineView ×2，JSX 里挂在复习卡与文档卡首行）──────────────────
  // PR7a 前是「无依赖数组的 useLayoutEffect、每次渲染现读快照重画」；组件化后同一
  // 份新鲜度由页面本来就有的 useSettings(READ_KEYS) 订阅承担：任何一次 store 写入
  // ⇒ 快照换 identity ⇒ 重渲染 ⇒ 这里现读、DepLineView 重画。ready 之前给 null
  // （组件输出空 div），与旧 effect 的 ready 早退一致。
  const depSettings = ready ? readSnapshot(READ_KEYS) : null;
  const depQuick = !!depSettings && !detail && !!QuickSetup.represents(depSettings);
  const goDeps = (slot) => {
    flushSync(() => setDetailState(true));
    try { chrome.storage.local.set({ [DETAIL_KEY]: true }); } catch (_) {}
    const el = document.getElementById(
      slot === 'notes' ? 'notes-provider' : slot === 'stt' ? 'stt-engine' : slot === 'tts' ? 'tts-engine' : 'provider',
    );
    if (!el) return;
    try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
    try { el.focus({ preventScroll: true }); } catch (_) {}
  };

  // ── boot ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    SettingsStore.init(READ_KEYS).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        // A failed read is NOT an empty profile：把原因透传给 setup-note。
        setReadFailed(true);
        setReadFailWhy(r.error || '');
      }
    }).catch(() => {});
    const id = setTimeout(() => setInitTimedOut(true), 3000);
    return () => { alive = false; clearTimeout(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 等 init 落定（或 3 秒超时兜底）再做依赖快照的事。
      for (let i = 0; i < 100 && SettingsStore.isReady() === false && !initTimedOut; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!alive) return;
      const s0 = readSnapshot(READ_KEYS);
      bootSnapRef.current = s0;
      // 这份已存的配置，一键卡表示得了吗（null = 表示不了 / 还没配过）。
      quickShowsRef.current = QuickSetup.represents(s0);
      // provider 归一：另一 flavor 存来的 id 可能不存在于此构建 → 落到注册表第一个。
      // 只写这一键，不走 saveNow（boot 不是一次用户保存）。
      const cur = SettingsStore.get('provider');
      const provNow = EngineState.byId(cur) ? cur : EngineState.defaultId();
      if (provNow !== cur) await SettingsStore.set('provider', provNow);

      // 默认「快速」，除非用户上次切到过详细。
      let d = false;
      try {
        const r2 = await new Promise((res) => chrome.storage.local.get([DETAIL_KEY], (v) => res(v || {})));
        d = r2[DETAIL_KEY] === true;
      } catch (_) {}
      // 已经配过、但一键卡表示不了这份配置 —— 快速视图里没有一个控件能显示他的配置。
      // 这一条不写进 DETAIL_KEY：它是「这份数据长什么样」的推论，不是用户的偏好。
      if (!quickShowsRef.current && String(s0.apiKey || '').trim()) d = true;
      // 读不到已存设置时一键配置是 disabled 的，同样没有可做的事 —— 强制展开。
      if (!s0 || readFailed) d = true;
      setDetailState(d);

      // 版本号来自 manifest，不来自翻译（十一份译文的那个教训）。
      try { setVersion('v' + chrome.runtime.getManifest().version); } catch (_) { setVersion(''); }
      // 匿名用量事件的开关：独立键，不进 saveNow。中国版没有这个块。
      const tb = Registry.telemetryEnabled();
      setTelAvail(tb);
      if (tb && typeof MTTelemetry !== 'undefined') {
        MTTelemetry.enabled().then((on) => { if (alive) setTelOn(!!on); }).catch(() => {});
      }
      // 反馈 / 评分 / 讨论区：地址由 learn/feedback.js 统一给。
      try { setFbMail(MTFeedback.mailtoUrl('settings')); } catch (_) { setFbMail(''); }
      try { setFbDisc(MTFeedback.discussUrl()); } catch (_) { setFbDisc(''); }
      try { const u = MTFeedback.rateUrl(); if (u) setFbRate(u); } catch (_) {}
      // ZIP 直装提示：判据是商店分配的固定 id；Firefox 不做这个判断。
      try {
        const isFirefox = typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo;
        if (!isFirefox && chrome.runtime.id && chrome.runtime.id !== MTFeedback.CWS_ID) setUnpacked(true);
      } catch (_) { /* 判断不出来就不说 —— 说错比不说更坏 */ }

      // 学习库：空库先从本地备份恢复，再画首屏统计；随后打一次节流内的快照。
      try { await LearnBackup.restoreIfEmpty(); } catch (_) {}
      try { LearnBackup.maybeRun(); } catch (_) {}
      refreshLearnStats();
      refreshPressure();
      refreshTtsCache();

      // ── 同步（可选）──
      if (BE && BE.enabled) {
        // 备好 PKCE，然后才让按钮可点。点击处理器里不能有 await。
        LearnAuth.prepareProviderSignIn().then(() => { if (alive) setPrepOk(true); })
          .catch(() => { /* 备不好就保持不可点 —— 那比点了没反应诚实 */ });
        // 回调之后：票在 storage 里，这里（一个真正的扩展页）兑换。**不经 background**
        // —— Safari iOS 锁屏后 service worker 永久 undefined。
        LearnAuth.completeProviderSignIn().then(async (session) => {
          if (!session || !alive) return;            // 没有票，正常路径，什么都不说
          await refreshSyncUI();
          setSyncMsg(tRef.current('sync_signed_in_now', '已登录。第一次同步可能要几秒。'));
          await runSync();
        }).catch((e) => {
          if (!alive) return;
          setSyncMsg(syncErrorText(e, tRef.current));
          // 兑换失败会作废 verifier，不重新备一份的话按钮到刷新前都是死的。
          LearnAuth.prepareProviderSignIn().catch(() => {});
        });
        refreshSyncUI();
        // §8.8 — opening this page is the heartbeat (throttled + silent inside autoSync).
        LearnSync.autoSync().then((r) => {
          if (r) return Promise.all([refreshLearnStats(), refreshPressure(), refreshSyncUI()]);
          return null;
        }).catch(() => {});
      }

      // ── 锚点：位置必须排在 applyDetailMode 之后，再等一帧让重排落定 ──
      const target = ANCHORS[location.hash];
      if (target) {
        const jump = () => {
          if (target.before === 'detail') flushSync(() => setDetailState(true));
          if (target.before === 'quick' && quickAvailRef.current) flushSync(() => setDetailState(false));
          const sec = document.getElementById(target.sec);
          if (!sec || sec.hidden) return;   // 这个构建里整节被拿掉了（如中国版的同步）
          try { sec.scrollIntoView({ block: 'start' }); } catch (_) { sec.scrollIntoView(); }
          let el = null;
          try { el = target.focus(); } catch (_) {}
          if (el) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } }
          let row = null;
          try { row = target.flash && target.flash(); } catch (_) {}
          if (row) {
            row.classList.add('anchor-flash');
            // 动画结束就摘掉。留着的话，下次回到这一页它会毫无理由地亮着。
            setTimeout(() => row.classList.remove('anchor-flash'), 2600);
          }
        };
        try { requestAnimationFrame(() => requestAnimationFrame(jump)); } catch (_) { jump(); }
      }

      // 用量事件：扩展页打开即 flush + 当日心跳（docs/telemetry-design.md §4）。
      try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.init({ flushNow: true }); } catch (_) {}
    })().catch((e) => {
      // A bare promise turns any throw into a silent unhandled rejection —
      // a broken settings page must not be quiet (domain-design §9.1 law 2).
      try { console.error('[options] init failed:', e); } catch (_) {}
      if (alive) setBootErr(String((e && e.message) || e));
    });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // uiLang 单点写入后的两件响应式事：文案语言 + 孤岛重挂（layout effect deps）。
  useEffect(() => { PageText.setUiLang(s.uiLang); }, [s.uiLang]);
  useEffect(() => {
    const dt = t('options_title', '大肚猴翻译 · 设置');
    if (dt) document.title = dt;
  }, [uiLangNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // 语音：音色列表按引擎重建（原 updateTtsUI 的列表半边）。**没有回落到第一个引擎**
  // —— 空 ttsEngine 落哨兵项，populate 的 fallback 规则只在孤岛里；这里 e 为 null =
  // 未配置 = 列表只有「自动」。
  useEffect(() => {
    let alive = true;
    (async () => {
      const opts = [{ value: '', label: t('tts_voice_auto', '自动（按卡片语言挑选）') }];
      const e = ttsEngineById(SettingsStore.get('ttsEngine'));
      if (e && e.type === 'browser') {
        // Voices for the browser engine arrive LATE — see LearnTTS.loadVoices.
        const voices = await LearnTTS.loadVoices();
        for (const v of (voices || [])) opts.push({ value: v.voiceURI, label: `${v.name} — ${v.lang}` });
      } else if (e && e.voices) {
        for (const v of e.voices) opts.push({ value: v, label: v });
      }
      if (!alive) return;
      setVoiceOpts(opts);
      // 校正：存着的音色不在列表里 → 回「自动」（原 sel.value 校正同义）。
      const cur = SettingsStore.get('ttsVoice') || '';
      if (cur && !opts.some((o) => o.value === cur)) await SettingsStore.set('ttsVoice', '');
    })();
    return () => { alive = false; };
  }, [s.ttsEngine, voicesTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 平台音色表迟到：a voice list built before the platform published its voices
  // would stay empty forever.
  useEffect(() => {
    if (typeof LearnTTS === 'undefined' || !LearnTTS.onVoicesChanged) return undefined;
    const off = LearnTTS.onVoicesChanged(() => setVoicesTick((x) => x + 1));
    return () => { try { off && off(); } catch (_) {} };
  }, []);

  // LearnTTS.configure（原 applyTtsConfig）：七个键全量，值来自 store（store 即镜像）。
  useEffect(() => {
    if (typeof LearnTTS === 'undefined') return;
    LearnTTS.configure({
      engineId: s.ttsEngine,
      baseUrl: String(s.ttsBaseUrl || '').trim(),
      apiKey: String(s.ttsApiKey || '').trim(),
      model: String(s.ttsModel || '').trim(),
      voice: s.ttsVoice || '',
      rate: Number(s.ttsRate) > 0 ? Number(s.ttsRate) : 1,
    });
  }, [s.ttsEngine, s.ttsBaseUrl, s.ttsApiKey, s.ttsModel, s.ttsVoice, s.ttsRate]);

  // 语音缓存行跟引擎走；试听完成后由 setTimeout 里 bump tick 再刷。
  useEffect(() => { refreshTtsCache(); }, [s.ttsEngine, ttsCacheTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 别处改了 learnRules（同步拉回的 g 行、popup 的本站开关、App）→ 重画治理区。
  useEffect(() => {
    if (!ready) return;
    renderGovernance();
  }, [s.learnRules, sourcesOpen, uiLangNow, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 事件处理（全部 const 箭头 —— user-gesture / endpoint-shape 门禁按这个形状提取）──

  // ⚠️ window.open 必须**同步**发生在这次点击里。一旦先 await 过，用户手势就用掉了，
  // Safari 会把随后的 window.open 当弹窗拦掉 —— 表现是「点了没反应」，控制台没有任何
  // 东西，本地 Chrome 也测不出来。2026-09-01 用户在真机上报的就是这个。
  const btnSyncCards = () => {
    try { window.open(chrome.runtime.getURL('learn/review.html'), '_blank'); } catch (_) {}
  };

  const openAppViaLink = () => {
    // 地址形状与复习页那个按钮共用一处实现（AppLink）：只带不透明 userId。
    // **打不开时要说话** —— 电脑上没装 App 的话，自定义 scheme 一点反应都没有。
    const uid = appUid || '';
    AppLink.open(uid, (kind) => setAppFallback(kind === 'store' ? 'store' : 'other'));
  };

  // 重看引导：**先开页，再清标记**（两件事不互相依赖；引导页读的是活状态）。
  const btnReonboard = () => {
    try { window.open(chrome.runtime.getURL('onboard/onboard.html'), '_blank'); } catch (_) {}
    try { chrome.storage.local.remove(['extObSeen'], () => {}); } catch (_) {}
  };

  // 登录页备好之前不可点，而不是点了没反应（原 wireProvider 的 disabled 同义）。
  const openProviderSignIn = (name) => {
    const url = LearnAuth.providerSignInUrl(name, PROVIDER_REDIRECT);
    if (!url) { setSyncMsg(syncErrorText({ code: 'pkce_missing' }, t)); return; }
    window.open(url, '_blank', 'noopener');
    setSyncMsg(t('sync_opening', '正在打开登录页…'));
  };

  const setDetailMode = (on) => {
    setDetailState(on);
    try { chrome.storage.local.set({ [DETAIL_KEY]: !!on }); } catch (_) {}
  };

  const advHintGo = () => {
    flushSync(() => setDetailMode(false));
    const card = document.getElementById('quick-setup-card');
    if (card) { try { card.scrollIntoView({ block: 'start' }); } catch (_) {} }
  };

  const grantSummaryGo = () => {
    if (quickAvailRef.current) flushSync(() => setDetailMode(false));
    const card = document.getElementById('grant-card');
    if (card && !card.hidden) { try { card.scrollIntoView({ block: 'start' }); } catch (_) {} }
  };

  const btnAdvanced = () => {
    setAdvOpen(!advOpen);
  };

  // 输入时只更新提示（不写存储），失焦时才落盘 —— 打字过程中每个字符都写一次存储
  // 既无必要，也会让「解析不了」的中间态反复触发运行时刷新。
  const advCustomInput = (e) => { setCustomNote(customNoteFor(e.target.value, t)); };
  const advCustomBlur = async (e) => {
    const providerId = SettingsStore.get('provider');
    if (!providerId) return;
    const cur = customParamsOf();
    const next = Object.assign({}, cur);
    // 空 ⇒ 删掉这个引擎的条目，而不是留一个空字符串。存储里没有该键 = 没设过。
    if (String(e.target.value || '').trim()) next[providerId] = e.target.value;
    else delete next[providerId];
    await SettingsStore.set('reqCustomParams', next);
    sRef.current = Object.assign({}, sRef.current, { reqCustomParams: next });
    try { RequestShape.refresh(); } catch (_) {}
    setCustomNote(customNoteFor(e.target.value, t));
    showToast(t('toast_saved', '已保存'));
  };

  // 高级参数数字框：输入即写（钳制后），失焦才 toast —— 中间态短暂入库是声明过的
  // 行为差异；钳制范围与 request-shape.js 的 CLAMP 同源。
  const advNumInput = (key) => (e) => {
    SettingsStore.set(key, advNumClamp(e.target.value, RequestShape.CLAMP[key]));
  };
  const advNumBlur = () => { showToast(t('toast_saved', '已保存')); };

  // 运行时缓存了这四个值（request-shape.js 的 _prefs）；它自己也监听 storage 变化，
  // 但内容脚本与这一页不同上下文 —— 显式刷一次自己这份在 blur 时做。
  const advNumRefresh = () => { try { RequestShape.refresh(); } catch (_) {} };

  const dailyNewChange = (e) => {
    const v = dailyNewClamp(e.target.value, LearnScheduler.DEFAULTS.dailyNew);
    SettingsStore.set('learnDailyNew', v);
    e.target.value = String(v);
  };
  const dailyNewBlur = () => { showToast(t('toast_saved', '已保存')); };

  // ── 引擎自检 ×3 + 试听（interaction-spec：在途禁用 + 具名失败 + URL 行）──────
  // 每个测试都走该功能真正用的传输；「通了」意味着真的能翻，不只是字段填了。

  const btnTestProvider = async () => {
    await withBusy('btn-test-provider', async () => {
      const noteSet = (v) => setTestProvNote(v);
      noteSet(t('engine_test_running', '测试中…'));
      try {
        await saveNow();
        const r = await EngineTest.translation({
          targetLang: SettingsStore.get('targetLang') || 'zh-CN',
          provider: SettingsStore.get('provider'),
          apiKey: String(SettingsStore.get('apiKey') || '').trim(),
          baseUrl: String(SettingsStore.get('apiBaseUrl') || '').trim(),
          model: String(SettingsStore.get('apiModel') || '').trim(),
        });
        noteSet(withRoute(withUrl(
          t('engine_test_ok', '✓ 通了 · {ms}ms').replace('{ms}', String(r.ms))
            + (r.sample ? ' · ' + t('engine_test_sample', '返回：') + r.sample : ''),
          r.url, t), r.route, t));
      } catch (e) {
        console.error('[engine-test]', (e && e.url) || '', e);
        noteSet(withRoute(withUrl('✗ ' + EngineTest.reason(e, t), e && e.url, t), e && e.route, t));
      }
    });
  };

  const btnTestNotes = async () => {
    await withBusy('btn-test-notes', async () => {
      setTestNotesNote(t('engine_test_running', '测试中…'));
      try {
        await saveNow();
        // 形状检查搬进 EngineTest.notes() 了：解析组可以为空并跟随翻译组。
        const r = await EngineTest.notes(readSnapshot(READ_KEYS));
        setTestNotesNote(withRoute(withUrl(
          t('engine_test_ok', '✓ 通了 · {ms}ms').replace('{ms}', String(r.ms))
            + (r.sample ? ' · ' + t('engine_test_sample', '返回：') + r.sample : ''),
          r.url, t), r.route, t));
      } catch (e) {
        console.error('[engine-test]', (e && e.url) || '', e);
        setTestNotesNote(withRoute(withUrl('✗ ' + EngineTest.reason(e, t), e && e.url, t), e && e.route, t));
      }
    });
  };

  const btnTestStt = async () => {
    await withBusy('btn-test-stt', async () => {
      setTestSttNote(t('engine_test_running', '测试中…'));
      try {
        await saveNow();
        const r = await EngineTest.stt({
          engineId: SettingsStore.get('sttEngine'),
          apiKey: String(SettingsStore.get('sttApiKey') || '').trim(),
          baseUrl: String(SettingsStore.get('sttBaseUrl') || '').trim(),
          model: String(SettingsStore.get('sttModel') || '').trim(),
        });
        setTestSttNote(withRoute(withUrl(
          t('engine_test_ok', '✓ 通了 · {ms}ms').replace('{ms}', String(r.ms))
            + (r.sample ? ' · ' + t('engine_test_sample', '返回：') + r.sample : ''),
          r.url, t), r.route, t));
      } catch (e) {
        console.error('[engine-test]', (e && e.url) || '', e);
        setTestSttNote(withRoute(withUrl('✗ ' + EngineTest.reason(e, t), e && e.url, t), e && e.route, t));
      }
    });
  };

  // 试听是**播放**不是探活（「听得见才算通」），不走 EngineTest 的四条传输；但地址
  // 写错离线就能判 —— 只补形状检查这一句，不改试听的语义。
  const btnTtsTest = async () => {
    await withBusy('btn-tts-test', async () => {
      const sample = t('tts_test_sample', 'This is what your review cards will sound like.');
      const hint = EngineTest.shapeHint(String(SettingsStore.get('ttsBaseUrl') || ''), t);
      if (hint) { setTtsCacheLine('✗ ' + hint); return; }
      setTtsCacheLine(t('tts_testing', '正在合成…'));
      const r = await LearnTTS.speak(sample, 'en');
      setTtsCacheLine(r.ok ? t('tts_test_ok', '播放中') : LearnTTS.reason(r.reason, t));
      if (r.ok) {
        setTimeout(() => setTtsCacheTick((x) => x + 1), 1500);
        // 播放也算在途（同 review ▶）：按钮停到样例结束为止 —— 有上限，因为 Chrome
        // 的 speechSynthesis 偶尔吞 end 事件，而这一页没有任何地方调用 stop()。
        await Promise.race([
          (r.done || Promise.resolve()).catch(() => {}),
          new Promise((res) => setTimeout(res, 15000)),
        ]);
      }
    });
  };

  const btnClearTts = async () => {
    await withBusy('btn-clear-tts', async () => {
      try { await LearnStore.clearAudio(); showToast(t('toast_tts_cleared', '语音缓存已清空')); }
      catch (_) { showToast(t('toast_learn_clear_failed', '清空失败')); }
      refreshTtsCache();
    });
  };

  // ── 导出 / 导入 ─────────────────────────────────────────────────────────────
  const btnExportLearn = async () => {
    await withBusy('btn-export-learn', async () => {
      try {
        const { bytes, header } = await LearnChunk.exportBytes(Date.now());
        if (!header.counts.cards) { showToast(t('toast_export_empty', '还没有可导出的卡片')); return; }
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = LearnChunk.fileName(Date.now());
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast(t('toast_exported', '已导出 {n} 张卡片').replace('{n}', String(header.counts.cards)));
      } catch (_) {
        showToast(t('toast_export_failed', '导出失败'));
      }
    });
  };

  // The visible trigger locks during the bulk import — the hidden input can't
  // show a disabled state.
  const btnImportLearn = () => { if (fileRef.current) fileRef.current.click(); };
  const importFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                       // so re-picking the same file re-fires
    if (!file) return;
    await withBusy('btn-import-learn', async () => {
      try {
        const stats = await LearnChunk.importBytes(new Uint8Array(await file.arrayBuffer()));
        // Merging, never replacing: re-importing the same file changes nothing.
        let msg = t('toast_imported', '已导入 {n} 张卡片').replace('{n}', String(stats.cards));
        if (stats.skipped) msg += ' · ' + t('toast_import_skipped', '{n} 行无法解析已跳过').replace('{n}', String(stats.skipped));
        showToast(msg);
      } catch (err) {
        const c = err && err.code;
        showToast(c === 'bad_format' ? t('toast_import_bad_format', '这不是学习库导出文件')
          : c === 'enc_unsupported' ? t('toast_import_upgrade', '这个文件来自更新版本的扩展，升级后才能导入。文件本身没有问题。')
          : t('toast_import_failed', '导入失败'));
      }
      await refreshLearnStats();
      await refreshPressure();
    });
  };

  // ── 学习区动作 ──────────────────────────────────────────────────────────────
  const learnEnabledChange = async (e) => {
    const on = e.target.checked;
    await withBusy('learn-enabled', async () => {
      await SettingsStore.set('learnEnabled', on);
      // Turning capture OFF stops collecting; it does NOT delete what was already
      // collected. Say so, rather than letting the user assume either way.
      showToast(on ? t('toast_learn_on', '已开始采集学习材料') : t('toast_learn_off', '已停止采集（已收集的内容保留）'));
      await refreshLearnStats();
    });
  };

  const docCaptureChange = async (e) => {
    await withBusy('doc-capture', async () => { await SettingsStore.set('docCapture', e.target.checked); });
  };

  // §4.2: heal pre-rule long cards. Two phases behind the one consented press.
  const btnSplitLong = async () => {
    await withBusy('btn-split-long', async () => {
      const r = await LearnStore.splitLongItems().catch(() => null);
      if (!r) { showToast(t('learn_split_failed', '拆分失败')); await refreshLearnStats(); await refreshPressure(); return; }
      let llm = null;
      let rt = null;
      if (r.skipped) {
        try {
          LearnNotes.configure(LearnNotes.resolveConfig(readSnapshot(READ_KEYS)));
          if (LearnNotes.capable()) llm = await LearnAlign.healUnalignable();
        } catch (_) { llm = null; }
        // §4.2d last resort: re-translate per source sentence — aligned by
        // construction, and the only rescue for a truncated stored translation.
        try {
          rt = await LearnAlign.healByRetranslate((sl, target) =>
            TranslationAPI.translate(sl, target || SettingsStore.get('targetLang') || 'zh-CN',
              SettingsStore.get('provider'), String(SettingsStore.get('apiKey') || '').trim(),
              String(SettingsStore.get('apiBaseUrl') || '').trim(), String(SettingsStore.get('apiModel') || '').trim()));
        } catch (_) { rt = null; }
      }
      const healed = (llm ? llm.split : 0) + (rt ? rt.split : 0);
      const parents = r.parents + healed;
      const children = r.children + (llm ? llm.children : 0) + (rt ? rt.children : 0);
      const skipped = Math.max(0, r.skipped - healed);
      if (!parents && !skipped) { showToast(t('learn_split_none', '没有可拆分的长段卡')); }
      else {
        let msg = t('learn_split_done', '已把 {p} 张长段卡拆成 {c} 张句子卡')
          .replace('{p}', String(parents)).replace('{c}', String(children));
        if (skipped) msg += t('learn_split_skipped', '（{k} 张译文对不齐，保持原样）')
          .replace('{k}', String(skipped));
        showToast(msg, 4000);
      }
      await refreshLearnStats();
      await refreshPressure();
    });
  };

  const btnCleanKnown = async () => {
    await withBusy('btn-clean-known', async () => {
      const n = await LearnStore.clearKnown().catch(() => -1);
      if (n < 0) { showToast(t('toast_learn_clear_failed', '清空失败')); }
      else { showToast(t('toast_learn_cleaned', '已清理 {n} 张已掌握的卡').replace('{n}', String(n))); }
      await refreshLearnStats();
      await refreshPressure();
    });
  };

  const btnClearLearn = async () => {
    await withBusy('btn-clear-learn', async () => {
      if (!window.confirm(t('learn_clear_confirm', '清空学习库？所有已采集的句子与复习进度都会被删除，且无法恢复。'))) return;
      try {
        await LearnStore.clearAll();
        // §7.5 清空守卫：用户要的清空不许下次打开由备份还魂。
        await LearnBackup.clear();
        showToast(t('toast_learn_cleared', '学习库已清空'));
      } catch (_) {
        showToast(t('toast_learn_clear_failed', '清空失败'));
      }
      await refreshLearnStats();
      await refreshPressure();
    });
  };

  const btnManageSources = async () => {
    await withBusy('btn-manage-sources', async () => {
      setSourcesOpen(!sourcesOpen);
    });
  };

  const btnOpenReview = () => {
    try { window.open(chrome.runtime.getURL('learn/review.html'), '_blank'); } catch (_) {}
  };
  const btnOpenDocs = () => {
    try { window.open(chrome.runtime.getURL('learn/docs.html'), '_blank'); } catch (_) {}
  };

  // ── 清除缓存 / 清除本机全部数据 ────────────────────────────────────────────
  const btnClearCache = async () => {
    await withBusy('btn-clear-cache', async () => {
      setCacheStatus(t('toast_clearing', '清除中…'));
      await new Promise((done) => {
        chrome.storage.local.get(null, (items) => {
          const keys = Object.keys(items || {}).filter((k) => k.startsWith('tr:'));
          if (keys.length === 0) { setCacheStatus(t('toast_cache_empty', '缓存为空')); done(); return; }
          chrome.storage.local.remove(keys, () => {
            setCacheStatus(t('toast_cache_cleared', '缓存已清除') + ` (${keys.length})`);
            showToast(t('toast_cache_cleared', '缓存已清除'));
            done();
          });
        });
      });
    });
  };

  const btnWipeAll = async () => {
    await withBusy('btn-wipe-all', async () => {
      // 兜底串必须整条写在 t() 的第二个参数上，不能用 + 拆行：拆了之后第二段的中文
      // 就不在兜底位上，零硬编码文案那道门禁会红（它是对的 —— 那正是漏译的形状）。
      if (!window.confirm(t('options_wipe_confirm', '清除这台设备上的全部数据？API Key、全部设置、已采集的句子与复习进度都会被删除，并会退出登录。此操作无法撤销。\n\n已同步到云端的内容不受影响 —— 重新登录会把它们同步回来。'))) return;
      const r = await wipeEverything(t).catch((e) => ({ leftover: ['(' + ((e && e.message) || e) + ')'], dbsLeft: [] }));
      if (r.leftover.length || r.dbsLeft.length) {
        // 说实话，并且**说得出剩了什么**。半清干净了却报「已清除」仍然是更糟的那一边。
        const what = r.leftover.concat(r.dbsLeft).slice(0, 4).join('、');
        showToast(t('toast_wipe_failed_what', '没有清干净，还剩：{what}。请再试一次。').replace('{what}', what), 6000);
        return;
      }
      // location 导航不受用户手势限制（不同于 window.open），这里不需要提前调。
      location.replace(chrome.runtime.getURL('onboard/onboard.html'));
    });
  };

  // ── 测试钮的 note 状态（在事件处理器之后声明 —— 它们被上面的闭包引用）────────
  const [testProvNote, setTestProvNote] = useState('');
  const [testNotesNote, setTestNotesNote] = useState('');
  const [testSttNote, setTestSttNote] = useState('');

  // ── 渲染 ────────────────────────────────────────────────────────────────────
  const emailBlockOpen = codeStep || emailOpen || !AVAIL.length;
  const emailLinkHidden = codeStep || emailBlockOpen;
  const providersHidden = codeStep || !AVAIL.length;
  const quickOnlyHidden = detail || !quickAvail;

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          {/* 大肚猴 mark — the canonical icons/icon.svg, referenced not restated */}
          <img src="../icons/icon.svg" width="40" height="40" alt="" />
          <span>{T('options_title', '大肚猴翻译 · 设置')}</span>
        </h1>
      </header>

      {/* ready 前不挂 main：不受控框（高级参数×4、每日新卡数）的 defaultValue 停在
          schema 默认值上，读回之后也不会更新 —— 等真值到手再挂载才诚实（首帧空窗
          的同一理由，见文件头「行为差异」）。 */}
      {ready && (
      <main>
        <div className={setupNoteShown ? 'setup-note warn' : 'setup-note'} id="setup-note" hidden={!setupNoteShown}>{setupNote}</div>

        {/* ── ① 引擎与密钥 ─────────────────────────────────────────────────── */}
        <div className="sec" id="sec-engines">
          <div className="sec-head">
            <div className="sec-title"><span className="sec-n">1</span><h2>{T('opt_sec_engines', '引擎与密钥')}</h2></div>
            {/* 快速 / 详细。刻意**不叫「高级」**——翻译引擎卡里已经有一个 #btn-advanced。
                只管这一节；实现只用 hidden，永不 remove()。 */}
            <div className="mode-tabs" id="mode-tabs" role="tablist" hidden={!quickAvail}>
              <button id="mode-quick" type="button" role="tab" aria-selected={String(!detail)} onClick={() => setDetailMode(false)}>{T('opt_mode_quick', '快速')}</button>
              <button id="mode-detail" type="button" role="tab" aria-selected={String(detail)} onClick={() => setDetailMode(true)}>{T('opt_mode_detail', '详细')}</button>
            </div>
          </div>

          {/* 免费额度（§8.10）：与一键卡并排在同一个 tab 里（裁定 D2：登录永远不是墙）。
              中国版与开关未翻时 renderGrant 把整块藏起来（grantCardHidden 回读）。 */}
          <section className="card quick-only" id="grant-card" hidden={quickOnlyHidden || grantCardHidden}>
            <div id="grant-box" ref={grantBoxRef} />
          </section>

          {/* 一把 key 配好全部（QuickSetup）：渲染在 src/shared/quick-setup-view.jsx
              （PR7b 起 named import 它的 render），与扩展引导第 2 屏是**同一个组件**。
              它只返回 patch，写盘由 applyQuickSetup 负责。 */}
          <section className="card quick-only" id="quick-setup-card" hidden={quickOnlyHidden}>
            <h2>{T('qs_title', '用一把 key 配好全部')}</h2>
            <div id="quick-setup" ref={quickRef} />
          </section>

          {/* 永不同屏，但路必须有：详细档顶上一行指回快速档。 */}
          <p className="hint adv-only" id="adv-hint" hidden={detail}>
            <button type="button" className="link-btn" id="adv-hint-go" onClick={advHintGo}>{T('opt_adv_hint', '一键配置在「快速」里 →')}</button>
          </p>

          {/* 翻译引擎（含「解析这句」可选覆盖） */}
          <section className="card adv-only" id="engine-card" hidden={!detail}>
            <h2>{T('options_engine_section', '翻译引擎')}</h2>
            <div id="engine-core" ref={engineCoreRef} />
            {/* 组件把这几段克隆进对应的行里；放在 template 里只是为了文案仍由 JSX +
                T() 维护，而不是散进 JS 字符串。 */}
            <template id="engine-extras" ref={extrasRef}>
              <p className="hint" id="api-hint" />
              <p className="hint">{T('options_custom_api_hint', '留空则使用默认地址。适用于中转代理或自建服务。')}</p>
              <p className="hint">{T('options_custom_model_hint', '留空则使用该引擎的默认模型。')}</p>
              <button className="icon-btn" id="toggle-eye" title={T('toggle_show_hide', '显示/隐藏')} type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              </button>
            </template>

            {/* 高级参数：默认折叠、默认全部不设置。「不设置」与「设成了默认值」必须
                可区分 —— 空着就是空着，由 request-shape.js 决定发不发。 */}
            <div className="field">
              <button id="btn-advanced" className="secondary" onClick={btnAdvanced}>{T('options_advanced', '高级参数')}</button>
            </div>
            <div id="advanced-config" hidden={!advOpen}>
              <div className="field">
                <label htmlFor="adv-temperature"><span>{T('label_adv_temperature', '随机度 temperature')}</span> <span className="optional">{T('label_optional', '（可选）')}</span></label>
                <input type="number" id="adv-temperature" ref={advTempRef} step="0.1" min="0.01" max="2" placeholder="0.3"
                  defaultValue={s.reqTemperature === '' || s.reqTemperature == null ? '' : String(s.reqTemperature)}
                  onChange={advNumInput('reqTemperature')} onBlur={() => { advNumBlur(); advNumRefresh(); }} disabled={advCaps.temperature === false} />
                <p className="hint">{T('options_adv_temperature_hint', '留空使用 0.3。数值越低译文越稳定。')}</p>
                <p className="hint" id="adv-temperature-note">{advCaps.temperature === false ? T('options_adv_unsupported', '当前模型不接受此参数，本次不会发送。') : ''}</p>
              </div>
              <div className="field">
                <label htmlFor="adv-max-tokens"><span>{T('label_adv_max_tokens', '单次最大输出长度')}</span> <span className="optional">{T('label_optional', '（可选）')}</span></label>
                <input type="number" id="adv-max-tokens" ref={advMaxRef} step="100" min="16" max="32000" placeholder="2000"
                  defaultValue={s.reqMaxTokens === '' || s.reqMaxTokens == null ? '' : String(s.reqMaxTokens)}
                  onChange={advNumInput('reqMaxTokens')} onBlur={() => { advNumBlur(); advNumRefresh(); }} disabled={advCaps.budget === false} />
                <p className="hint">{T('options_adv_max_tokens_hint', '留空使用 2000。长段落被截断时可调高。')}</p>
                <p className="hint" id="adv-max-tokens-note">{advCaps.budget === false ? T('options_adv_unsupported', '当前模型不接受此参数，本次不会发送。') : ''}</p>
              </div>
              <div className="field">
                <label htmlFor="adv-timeout"><span>{T('label_adv_timeout', '单次请求超时（秒）')}</span> <span className="optional">{T('label_optional', '（可选）')}</span></label>
                <input type="number" id="adv-timeout" ref={advTimeoutRef} step="5" min="5" max="120" placeholder="20"
                  defaultValue={s.reqTimeoutSec === '' || s.reqTimeoutSec == null ? '' : String(s.reqTimeoutSec)}
                  onChange={advNumInput('reqTimeoutSec')} onBlur={() => { advNumBlur(); advNumRefresh(); }} />
                <p className="hint">{T('options_adv_timeout_hint', '留空使用 20 秒。自建或推理模型较慢时可调高。')}</p>
              </div>
              {/* 自定义请求参数：能力表的逃生口。按**引擎条目**存（切引擎会重新回填），
                  冲突时**用户赢**。失焦才落盘：JSON 打了一半时用户的输入不能丢。 */}
              <div className="field">
                <label htmlFor="adv-custom"><span>{T('label_adv_custom', '自定义请求参数')}</span> <span className="optional">{T('label_optional', '（可选）')}</span></label>
                <textarea id="adv-custom" rows="4" spellCheck="false" key={prov}
                  defaultValue={customParams[prov] || ''}
                  placeholder={`{"thinking": {"type": "disabled"}}`}
                  onChange={advCustomInput} onBlur={advCustomBlur} />
                <p className="hint">{T('options_adv_custom_hint', 'JSON 对象，会合并进请求体，覆盖上面几项。适用于我们没有实测过的自建或内网端点。')}</p>
                <p className="hint" id="adv-custom-note">{customNote}</p>
              </div>
              <div className="field">
                <label htmlFor="adv-concurrency"><span>{T('label_adv_concurrency', '并发请求数')}</span> <span className="optional">{T('label_optional', '（可选）')}</span></label>
                <input type="number" id="adv-concurrency" ref={advConcRef} step="1" min="1" max="16" placeholder="5"
                  defaultValue={s.reqConcurrency === '' || s.reqConcurrency == null ? '' : String(s.reqConcurrency)}
                  onChange={advNumInput('reqConcurrency')} onBlur={() => { advNumBlur(); advNumRefresh(); }} />
                <p className="hint">{T('options_adv_concurrency_hint', '留空使用 5。被限流时调低；调高不会加速已经在等的请求。')}</p>
              </div>
            </div>

            {/* 引擎自检：走翻译功能真正用的那条传输，「通了」意味着真的能翻。 */}
            <div className="field">
              <button id="btn-test-provider" disabled={isBusy('btn-test-provider')} onClick={btnTestProvider}>{T('engine_test', '测试连接')}</button>
              <p className="hint" id="test-provider-note">{testProvNote}</p>
            </div>
            {/* 解析引擎（learning-design §9.2）：翻译卡里的可选覆盖。默认跟随翻译引擎。 */}
            <div className="subblock" id="notes-block">
              <p className="lbl">{T('notes_block_title', '解析这句（可选）')}</p>
              <div id="notes-core" ref={notesCoreRef} />
              <p className="hint">{T('notes_engine_hint', '「解析这句」用的对话引擎。默认跟随上面的翻译引擎；思考（推理）型模型不适合解析。')}</p>
              <div id="notes-config" hidden={!notesVisible}>
                <div className="field">
                  <button id="btn-test-notes" disabled={isBusy('btn-test-notes')} onClick={btnTestNotes}>{T('engine_test', '测试连接')}</button>
                  <p className="hint" id="test-notes-note">{testNotesNote}</p>
                </div>
              </div>
            </div>
          </section>

          {/* 整段转写（learning-design §9.4）：**永不隐式跟随**翻译或解析组。 */}
          <section className="card adv-only" id="stt-card" hidden={!detail}>
            <h2>{T('stt_section', '整段转写')}</h2>
            <p className="hint">{T('stt_section_use', '说题 · 转写整段音视频')}</p>
            <div id="stt-core" ref={sttCoreRef} />
            <div id="stt-config" hidden={!sttEntry}>
              <div className="field">
                <button id="btn-test-stt" disabled={isBusy('btn-test-stt')} onClick={btnTestStt}>{T('engine_test', '测试连接')}</button>
                <p className="hint" id="test-stt-note">{testSttNote}</p>
              </div>
            </div>
            <p className="hint">{T('stt_hint', '「说」题的录音会发到这里配置的端点转写，识别完立即丢弃、不存储不同步；不配置则不出「说」题。密钥只存本机。')}</p>
          </section>

          {/* 朗读（TTS）引擎 + 音色 + 试听。语音模式 / 语速 / 自动播放是复习的事。 */}
          <section className="card adv-only" id="tts-card" hidden={!detail}>
            <h2>{T('tts_section', '朗读')}</h2>
            <p className="hint">{T('tts_section_hint', '把复习卡当成听力材料。默认使用你设备自带的语音，不联网、不花钱；也可以指向你自己搭的语音服务。')}</p>
            <div id="tts-config">
              <div id="tts-core" ref={ttsCoreRef} />
              <p className="hint" id="tts-engine-hint">{ttsEngineHint}</p>
              <div className="field">
                <label htmlFor="tts-voice">{T('tts_voice', '声音')}</label>
                <select id="tts-voice" value={s.ttsVoice || ''} disabled={!voiceOpts.length}
                  onChange={async (e) => { await flushPending(); await SettingsStore.set('ttsVoice', e.target.value); showToast(t('toast_saved', '已保存')); }}>
                  {voiceOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="hint">{T('tts_voice_hint', '按卡片的语言自动挑选。这里选的声音只在它会说那门语言时才会被采用。')}</p>
              </div>
              <button id="btn-tts-test" disabled={isBusy('btn-tts-test')} onClick={btnTtsTest}>{T('tts_test', '试听一句')}</button>
            </div>
          </section>
        </div>

        {/* ── ② 功能 ───────────────────────────────────────────────────────── */}
        <div className="sec" id="sec-features">
          <div className="sec-head">
            <div className="sec-title"><span className="sec-n">2</span><h2>{T('opt_sec_features', '功能')}</h2></div>
          </div>

          <section className="card" id="lang-card">
            <h2>{T('options_lang_section', '语言')}</h2>
            <div className="field">
              <label htmlFor="target-lang">{T('popup_target_lang', '目标语言')}</label>
              <select id="target-lang" value={s.targetLang || 'zh-CN'}
                onChange={async (e) => { await SettingsStore.set('targetLang', e.target.value); showToast(t('toast_lang_saved', '语言已保存')); }}>
                {/* endonym 原样：原文写什么就显示什么，不进 i18n。 */}
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
                <option value="th">ไทย</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="ui-lang">{T('ui_lang_label', '界面语言')}</label>
              <select id="ui-lang" value={s.uiLang || 'auto'}
                onChange={async (e) => { await SettingsStore.set('uiLang', e.target.value || 'auto'); showToast(t('toast_lang_saved', '语言已保存')); }}>
                {/* 单点写入：换语言 = 一次 store 写入，全树自动换（原版三件手动重画废除）。 */}
                <option value="auto">{T('ui_lang_auto', '跟随系统')}</option>
                <option value="zh_CN">简体中文</option>
                <option value="zh_TW">繁體中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
                <option value="hi">हिन्दी</option>
                <option value="ar">العربية</option>
                <option value="pt_BR">Português</option>
                <option value="ru">Русский</option>
                <option value="th">ไทย</option>
              </select>
            </div>
          </section>

          <section className="card" id="style-card">
            <h2>{T('options_style_section', '显示样式')}</h2>

            <div className="field">
              <label htmlFor="text-color">{T('options_webpage_color', '网页译文颜色')}</label>
              <div className="color-row">
                <input type="color" id="text-color" value={effTextColor}
                  onChange={async (e) => { await SettingsStore.set('textColor', e.target.value); }} />
                <span id="color-preview" className="color-preview" style={{ color: effTextColor }}>{T('options_color_preview', '这是译文的样式预览')}</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="yt-text-color">{T('options_yt_color', 'YouTube 字幕颜色')}</label>
              <div className="color-row">
                <input type="color" id="yt-text-color" value={effYtTextColor}
                  onChange={async (e) => { await SettingsStore.set('ytTextColor', e.target.value); }} />
                <span id="yt-color-preview" className="color-preview" style={{ background: '#000', padding: '2px 6px', borderRadius: 2, color: effYtTextColor }}>{T('options_yt_preview', '双语字幕预览')}</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="font-size">{T('options_font_size', '译文字号(相对原文)')}</label>
              <select id="font-size" value={scaleValue(s.fontSize)}
                onChange={async (e) => { await SettingsStore.set('fontSize', e.target.value); showToast(t('toast_fontsize_saved', '字号已保存')); }}>
                <option value="0.8">{T('options_font_s', '较小 (0.8×)')}</option>
                <option value="0.9">{T('options_font_m', '略小 (0.9×)')}</option>
                <option value="1.0">{T('options_font_body', '与原文一致 (1.0×)')}</option>
                <option value="1.1">{T('options_font_l', '略大 (1.1×)')}</option>
                <option value="1.25">{T('options_font_xl', '较大 (1.25×)')}</option>
              </select>
            </div>

            <div className="field row">
              <label htmlFor="show-fab">{T('options_show_fab', '显示悬浮按钮')}</label>
              <label className="switch">
                <input type="checkbox" id="show-fab" checked={s.showFab !== false}
                  onChange={async (e) => { await SettingsStore.set('showFab', e.target.checked); }} />
                <span className="slider" />
              </label>
            </div>
          </section>

          {/* 复习：怎么听、每天多少张。这些是复习的偏好，不是引擎配置。 */}
          <section className="card" id="review-card">
            <h2>{T('review_section', '复习')}</h2>
            <DepLineView id="dep-review" settings={depSettings} slots={['tts', 'notes']} quick={depQuick} onGo={goDeps} t={t} />
            <div className="field">
              <label htmlFor="tts-mode">{T('tts_mode', '语音模式')}</label>
              <select id="tts-mode" value={s.ttsMode || 'off'}
                onChange={async (e) => { await SettingsStore.set('ttsMode', e.target.value); showToast(t('toast_saved', '已保存')); }}>
                <option value="off">{T('tts_mode_off', '关闭')}</option>
                <option value="assist">{T('tts_mode_assist', '显示原文，可点播放')}</option>
                <option value="audio-first">{T('tts_mode_audio_first', '先听后看（原文先隐藏）')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="tts-rate">{T('tts_rate', '语速')}</label>
              <select id="tts-rate" value={String(Number(s.ttsRate) > 0 ? Number(s.ttsRate) : 1)}
                onChange={async (e) => { await SettingsStore.set('ttsRate', e.target.value); showToast(t('toast_saved', '已保存')); }}>
                <option value="0.7">0.7×</option>
                <option value="0.85">0.85×</option>
                <option value="1">1.0×</option>
                <option value="1.15">1.15×</option>
                <option value="1.3">1.3×</option>
              </select>
            </div>
            <div className="field row">
              <label htmlFor="tts-autoplay">{T('tts_autoplay', '进入卡片自动播放')}</label>
              <label className="switch">
                <input type="checkbox" id="tts-autoplay" checked={s.ttsAutoPlay !== false}
                  onChange={async (e) => { await SettingsStore.set('ttsAutoPlay', e.target.checked); }} />
                <span className="slider" />
              </label>
            </div>
            <div className="field">
              <label htmlFor="learn-daily-new">{T('learn_daily_new', '每天最多引入的新卡片')}</label>
              <input type="number" id="learn-daily-new" ref={dailyNewRef} min="1" max="200" step="1"
                defaultValue={String(Number(s.learnDailyNew) > 0 ? Number(s.learnDailyNew) : LearnScheduler.DEFAULTS.dailyNew)}
                onChange={dailyNewChange} onBlur={dailyNewBlur} />
            </div>
            <button id="btn-open-review" onClick={btnOpenReview}>{T('learn_open_review', '打开复习页')}</button>
          </section>

          {/* 学习采集（记忆层）。**不带 adv-only**：「要不要采集」跟引擎配置毫无关系。 */}
          <section className="card" id="learn-card">
            <h2>{T('learn_section', '学习')}</h2>
            <p className="hint">{T('learn_section_hint', '打开后，你**真正读过**的句子会连同页面地址、标题和停留时长一起存在**这台设备**上，按遗忘曲线重新推给你。快速滚过去的不算。除非你开启同步，否则不上传；一键可清空。')}</p>

            <div className="field row">
              <label htmlFor="learn-enabled">{T('learn_enable', '采集学习材料')}</label>
              <label className="switch">
                <input type="checkbox" id="learn-enabled" checked={s.learnEnabled === true} disabled={isBusy('learn-enabled')} onChange={learnEnabledChange} />
                <span className="slider" />
              </label>
            </div>

            {/* 文档翻译（learning-design §9.7）：默认开；下面一句是 §10 Gate G 的披露。 */}
            <div className="field row">
              <label htmlFor="doc-capture">{T('doc_capture_label', '文档译文进复习（来源「文档」）')}</label>
              <label className="switch">
                <input type="checkbox" id="doc-capture" checked={s.docCapture !== false} disabled={isBusy('doc-capture')} onChange={docCaptureChange} />
                <span className="slider" />
              </label>
            </div>
            <p className="hint">{T('doc_privacy', '文档只保存在本机，不同步、不导出。翻译时，文档的文字按你点开的页发往你配置的翻译端点 —— 不是整份，也不是打开就发；图片与扫描页以图片形式发往同一端点识别，只在你的引擎支持识别图片时。')}</p>

            <div className="field">
              <label>{T('learn_langs_label', '学习语言')}</label>
              <div id="learn-langs" ref={learnLangsRef} />
              <p className="hint">{T('learn_langs_hint', '只收录选中语言的句子。Safari 无法精确识别语言时按文字系统判断；长按收藏不受限制。')}</p>
            </div>

            <button id="btn-manage-sources" disabled={isBusy('btn-manage-sources')} onClick={btnManageSources}>{T('learn_sources_manage', '来源管理')}</button>
            <div id="sources-manager" ref={sourcesRef} hidden={!sourcesOpen} />
          </section>

          {/* 文档翻译：入口。采集开关在上面「学习」卡里。原版 btn-open-docs 曾嵌套注册
              在 btn-open-review 的首次点击里（怪癖），这里修正为两个独立按钮。 */}
          <section className="card" id="docs-card">
            <h2>{T('doc_title', '文档翻译')}</h2>
            <DepLineView id="dep-docs" settings={depSettings} slots={['chat']} quick={depQuick} onGo={goDeps} t={t} />
            <button id="btn-open-docs" onClick={btnOpenDocs}>{T('doc_open_page', '翻译文档（PDF / Word / 图片）')}</button>
          </section>
        </div>

        {/* ── ③ 账号与数据 ─────────────────────────────────────────────────── */}
        <div className="sec" id="sec-account">
          <div className="sec-head">
            <div className="sec-title"><span className="sec-n">3</span><h2>{T('opt_sec_account', '账号与数据')}</h2></div>
          </div>

          {/* 同步（可选）。不登录是默认状态，不是降级版本。整节条件渲染是本页唯一的
              remove 等价物（原版 sec.remove() —— 开关未翻时一条假控件都不留）。 */}
          {BE && BE.enabled && (
          <section className="card" id="sync-section">
            <h2>{T('sync_section', '登录 · 多设备同步')}</h2>

            <div id="sync-out" hidden={!!sess}>
              <p className="hint" id="sync-why">{T('sync_why', '登录同一个账号，浏览器里读到的句子就会同步到 App 和你的其它设备。')}</p>
              <div id="sync-providers" hidden={providersHidden}>
                <button id="btn-sync-apple" className="provider apple" type="button" disabled={!prepOk} hidden={!AVAIL.includes('apple')}
                  onClick={() => openProviderSignIn('apple')}>
                  <svg className="provider-mark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" /></svg>
                  <span>{T('sync_with_apple', '用 Apple 登录')}</span>
                </button>
                <button id="btn-sync-google" className="provider google" type="button" disabled={!prepOk} hidden={!AVAIL.includes('google')}
                  onClick={() => openProviderSignIn('google')}>
                  <svg className="provider-mark" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
                  <span>{T('sync_with_google', '用 Google 登录')}</span>
                </button>
              </div>
              <button id="btn-sync-email" className="link-btn" type="button" hidden={emailLinkHidden}
                onClick={() => { setEmailOpen(true); if (emailInputRef.current) { try { emailInputRef.current.focus(); } catch (_) {} } }}>
                {T('sync_use_email', '或用邮箱登录')}
              </button>

              <div id="sync-email-block" hidden={!emailBlockOpen}>
                <div className="field">
                  <label htmlFor="sync-email" id="sync-id-label">{PHONE_OTP ? T('sync_email_or_phone', '邮箱或手机号') : T('sync_email', '邮箱')}</label>
                  <input type="text" id="sync-email" ref={emailInputRef} autoComplete="username" inputMode="email"
                    placeholder={PHONE_OTP ? 'you@example.com / 13800138000' : 'you@example.com'}
                    value={emailVal} onChange={(e) => setEmailVal(e.target.value)} />
                </div>
                <button id="btn-sync-code" disabled={isBusy('btn-sync-code')} onClick={btnSyncCode}>{T('sync_send_code', '发送验证码')}</button>
              </div>

              <div id="sync-code-row" hidden={!codeStep}>
                <div className="field">
                  <label htmlFor="sync-code" id="sync-code-label">{PHONE_OTP ? T('sync_code_any', '6 位验证码') : T('sync_code', '邮件里的 6 位验证码')}</label>
                  <input type="text" id="sync-code" ref={codeInputRef} inputMode="numeric" autoComplete="one-time-code" maxLength="8"
                    value={codeVal} onChange={(e) => setCodeVal(e.target.value)} />
                </div>
                <button id="btn-sync-verify" disabled={isBusy('btn-sync-verify')} onClick={btnSyncVerify}>{T('sync_verify', '登录')}</button>
                <div className="link-row">
                  <button id="btn-sync-resend" className="link-btn" type="button" onClick={btnSyncCode}>{T('sync_resend', '重新发送')}</button>
                  <button id="btn-sync-change" className="link-btn" type="button"
                    onClick={() => { setCodeStep(false); setEmailOpen(true); if (emailInputRef.current) { try { emailInputRef.current.focus(); } catch (_) {} } }}>
                    {T('sync_change_email', '换一个邮箱')}
                  </button>
                </div>
              </div>

              {/* 「可选」那句放最底下当脚注：它是安心话，不是行动理由。 */}
              <p className="hint" id="sync-optional">{T('sync_section_hint', '可选。不登录也能完整使用 —— 同步只是让浏览器里读到的句子，也出现在 App 和你的其它设备上。登录之后，采集到的句子（含还没进复习的候选）都会同步过去。')}</p>
            </div>

            <div id="sync-in" hidden={!sess}>
              <div id="sync-who" className="cache-status">{whoLine}</div>
              <div id="sync-usage" className="cache-status">{usageLine}</div>

              {/* 登录之后的**下一步**。主行动是「去看你的卡」；App 那个出口带上不透明
                  userId：App 收到之后才发现得了「两边不是同一个账号」。 */}
              <div id="sync-next" hidden={!sess}>
                <p className="hint" id="sync-next-app">{nextAppLine}</p>
                {appFallback && (
                <p className="hint" id="app-open-fallback">
                  {appFallback === 'store'
                    ? (
                      <>
                        {T('app_open_failed', '这台设备上没能打开 App。')}
                        {' '}
                        <a href={typeof AppLink !== 'undefined' ? AppLink.storeUrl() : ''} target="_blank" rel="noopener">{T('app_open_store', '去 App Store 下载 →')}</a>
                      </>
                    )
                    : T('app_not_on_platform', '这个 App 只有 iPhone、iPad 和 Mac 版。在这台设备上，就在浏览器里复习。')}
                </p>
                )}
                <button id="btn-sync-cards" type="button" onClick={btnSyncCards}>{T('sync_next_cards', '去看你的卡')}</button>
                {/* data-uid 是门禁锚点（verify-signin-flow 读 dataset.uid）：旧 IIFE 在 paint
                    时写、PR5 翻转时丢了 —— 2026-09-28 全回归的 test:signin 抓回来的。 */}
                <button id="btn-sync-app" type="button" className="secondary" hidden={!appUid} data-uid={appUid || ''} data-href={appUid ? AppLink.deepLink(appUid) : ''} onClick={openAppViaLink}>{T('review_go_app', '在 App 里继续复习 →')}</button>
              </div>
              <button id="btn-sync-now" disabled={isBusy('btn-sync-now')} onClick={runSync}>{T('sync_now', '立即同步')}</button>
              <button id="btn-sync-out" disabled={isBusy('btn-sync-out')} onClick={btnSyncOut}>{T('sync_signout', '退出登录')}</button>
              {/* §8.7：删除必须是一个动作，且包含账号本身，不只是数据行。 */}
              <button className="btn-danger" id="btn-sync-delete" disabled={isBusy('btn-sync-delete')} onClick={btnSyncDelete}>{T('sync_delete', '删除云端数据与账号')}</button>
            </div>

            <div id="sync-status" className="cache-status">{syncMsg}</div>
            {/* 免费额度的只读摘要（信息架构 ③）：卡本身留在「引擎与密钥」的快速档里。 */}
            <p className="cache-status" id="grant-summary" hidden={grantSumHidden}>
              <button type="button" className="link-btn" id="grant-summary-go" onClick={grantSummaryGo}>{T('grant_summary_claimed', '免费额度已领取 · 管理 →')}</button>
            </p>
          </section>
          )}

          {/* 学习库：统计、导入导出、治理、清空。这些是数据，不是采集设置。 */}
          <section className="card" id="data-card">
            <h2>{T('data_section', '学习库')}</h2>
            <div id="learn-stats" className="cache-status">{learnStats}</div>
            <div id="learn-pressure" className="cache-status">{learnPressure}</div>
            {/* 导出同时是：数据可携带权、不想注册账号时的多端路径、对「我信不过你们」
                最诚实的回答（learning-design §8.2）。 */}
            <button id="btn-export-learn" disabled={isBusy('btn-export-learn')} onClick={btnExportLearn}>{T('learn_export', '导出学习库')}</button>
            <button id="btn-import-learn" disabled={isBusy('btn-import-learn')} onClick={btnImportLearn}>{T('learn_import', '从文件导入')}</button>
            <input type="file" id="import-file" ref={fileRef} accept=".mtlearn,.jsonl,.gz" hidden onChange={importFileChange} />
            {/* §4.2 存量长段卡的显式治愈；定向清理优先于核弹式清空。 */}
            <button id="btn-split-long" disabled={isBusy('btn-split-long')} onClick={btnSplitLong}>{T('learn_split_long', '拆分长段卡')}</button>
            <button id="btn-clean-known" hidden={cleanBtn.hidden} disabled={isBusy('btn-clean-known')} onClick={btnCleanKnown}>{cleanBtn.label || T('learn_clean_known', '清理已掌握的卡')}</button>
            <button className="btn-danger" id="btn-clear-learn" disabled={isBusy('btn-clear-learn')} onClick={btnClearLearn}>{T('learn_clear', '清空学习库')}</button>
          </section>

          {/* 缓存：翻译缓存 + 语音缓存。 */}
          <section className="card" id="cache-card">
            <h2>{T('options_cache_section', '缓存管理')}</h2>
            <p className="hint">{T('options_cache_hint', '翻译结果会缓存 12 小时以减少 API 请求。')}</p>
            <button className="btn-danger" id="btn-clear-cache" disabled={isBusy('btn-clear-cache')} onClick={btnClearCache}>{T('options_clear_cache', '清除翻译缓存')}</button>
            <div id="cache-status" className="cache-status">{cacheStatus}</div>
            <div id="tts-cache" className="cache-status">{ttsCacheLine}</div>
            <button className="btn-danger" id="btn-clear-tts" disabled={isBusy('btn-clear-tts')} onClick={btnClearTts}>{T('tts_clear_cache', '清空语音缓存')}</button>
          </section>
        </div>

        {/* ── ④ 关于 ───────────────────────────────────────────────────────── */}
        <div className="sec" id="sec-about">
          <div className="sec-head">
            <div className="sec-title"><span className="sec-n">4</span><h2>{T('options_about_section', '关于')}</h2></div>
          </div>
          <section className="card about" id="about-card">
            <h2>{T('options_about_section', '关于')}</h2>
            <p><span>{T('about_line', '大肚猴翻译')}</span> · <span id="about-version">{version}</span></p>
            <p>{T('options_about_desc', '支持网页全文双语对照翻译 + YouTube 双语字幕。')}</p>
            <p>{T('options_about_safari', 'Safari iOS：在设置 → Safari → 扩展 中启用。')}</p>
            <p id="about-links">
              <a id="feedback-mail" target="_blank" rel="noopener" href={fbMail || undefined}>{T('feedback_row', '发送反馈')}</a>
              <span className="sep">·</span>
              <a id="feedback-discuss" target="_blank" rel="noopener" href={fbDisc || undefined}>{T('feedback_discuss', 'GitHub 讨论区')}</a>
              <span className="sep" id="feedback-rate-sep" hidden={!fbRate}>·</span>
              <a id="feedback-rate" target="_blank" rel="noopener" href={fbRate || undefined} hidden={!fbRate}>{T('feedback_rate', '去商店评分')}</a>
            </p>
            <p className="note">{T('feedback_hint', '会打开你的邮件 App。主题里带着版本号和平台，除此之外什么都不发送。')}</p>
            {/* 匿名用量事件（telemetry-design §5）：默认开、一个开关可关、关了即删。
                中国版整块藏掉。 */}
            {telAvail && (
            <div id="telemetry-block" className="field row">
              <label htmlFor="telemetry-on">{T('telemetry_toggle', '分享匿名用量数据')}</label>
              <label className="switch">
                <input type="checkbox" id="telemetry-on" checked={telOn}
                  onChange={(e) => { setTelOn(e.target.checked); try { MTTelemetry.setEnabled(e.target.checked); } catch (_) {} }} />
                <span className="slider" />
              </label>
            </div>
            )}
            {telAvail && (
            <p className="note" id="telemetry-hint">
              <span>{T('telemetry_hint', '只发送用了哪些功能、在哪个浏览器、翻译成功还是失败 —— 不含你读的网页、文字、地址、密钥或账号。关掉即删除这台设备发过的数据。')}</span>
              {' '}
              <a id="telemetry-what" target="_blank" rel="noopener" href="https://belliedmonkey.cc/privacy.html#usage">{T('telemetry_what', '会发送什么')}</a>
            </p>
            )}
            {/* ZIP 直装提示：官网早就说了这句，但装完的人不会回去看官网。 */}
            <p id="unpacked-note" className="warn" hidden={!unpacked}>
              {unpacked ? T('extob_unpacked_note', '你是用 ZIP 直接装的：这一份不会自动更新。新版本请到官网下载，或改从商店安装以获得自动更新。') : ''}
            </p>
            <button id="btn-reonboard" type="button" className="secondary" onClick={btnReonboard}>{T('extob_reonboard', '重看开始使用引导')}</button>
            {/* 删 App 不会带走扩展这边的数据（iOS 把扩展的存储容器留下了）。 */}
            <p id="wipe-hint" className="note">{T('options_wipe_hint', '删除 App 不会清除这里的数据。要彻底清干净，先在这里清除。')}</p>
            <button id="btn-wipe-all" type="button" className="btn-danger" disabled={isBusy('btn-wipe-all')} onClick={btnWipeAll}>{T('options_wipe_all', '清除本机全部数据')}</button>
          </section>
        </div>
      </main>
      )}

      <div id="toast" className={toastMsg ? 'toast show' : 'toast'}>{toastMsg}</div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Options />);
