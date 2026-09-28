// src/app/settings-model.js — App 设置页的模型层（PR6b）。前身 app/settings.js
// 里与 DOM 无关的决策逻辑收编到这里；涂写与接线在 settings-view.jsx。
//
// Scope is plan §F's split, not "everything the extension has": the app owns the
// REVIEW loop's knobs, the account, the corpus — and, per learning-design §7.2's
// 2026-08-08 amendment, ONE device-local credential: a chat engine + key used
// solely for sentence notes (§9.2). The app still never translates and never
// captures; the key never syncs (it is not in any chunk), and it lives in this
// device's localStorage in plaintext — the same standing as the extension's own
// key storage, which the wording below must not claim to improve on.
//
// Reads and writes through the SAME `chrome.storage.local` keys `review.js` and
// `tts.js` read (via the shim's localStorage backing), so there is no second settings
// model to drift — changing a value here changes what those modules see next time
// they read, with no plumbing in between.
//
// 为什么这里的读写走 **raw chrome.storage.local**、不经 SettingsStore：
// schema 的 default 会把「键不存在」伪装成「已配默认值」—— QuickSetup.prefill /
// claimAndApply / ensureDefaults 必须分得清「用户从没配过」和「配了默认」的差别，
// 而 SettingsStore.get() 的 default 兜底恰恰抹掉这个差别。写入同样走 raw set：
// 写进 storage 后由 SettingsStore 的总线把新值送回快照（订阅者自动重画），model
// 自己不再维护第二份快照 —— 旧 set() 尾上那截 depsOnWrite() 正则重画就此退役
// （依赖行的重画改由 settings-view 订阅 store 总线承担，见那边的头注释）。

import PageText from '../lib/i18n.js';
import Registry from '../lib/registry.js';
import SETTINGS_SCHEMA from '../store/schema.js';

// Same i18n as everything else (interaction-spec 「界面语言」: no hardcoded copy).
// Chinese literals below are FALLBACKS beside their keys, never the only copy.
const t = PageText.t;

// PR9：KEYS 手抄清单已删，键表 = schema 的 app 面（App 设置页 + 各 App 模型共用一个
// 面；每键为何在这里的逐键说明随 surfaces 住进了 schema.js）。宽出的 5 键全是
// [flow] 标记（engineChosen/grantTail/grantBalance/onboardSeen/onboardResume），
// 一次 get 无害。
const KEYS = SETTINGS_SCHEMA.keysFor('app');

// 「快速 | 详细」两档的模式键。UI 状态不是配置，不进 SETTINGS_SCHEMA（options.jsx
// 同一条裁定）—— 也因此 SettingsStore 的 onStorageChanged 会跳过它：读写必须走 raw。
const DETAIL_KEY = 'optDetailMode';

function get(keys) {
  return new Promise((res) => chrome.storage.local.get(keys, res));
}
function set(items) {
  return new Promise((res) => chrome.storage.local.set(items, res));
}

// `learnEnabled` 被强制打开，因为「有没有材料来源」在 App 上确实为真：材料经同步
// 进来，浏览器的采集开关不归这个面管。
//
// ⚠️ 2026-08-28 更正：这里原本写着它「gates」复习页那句「去设置里打开采集」。
// 它不 gate —— review.js 全文只有存储键列表那一处提到 learnEnabled，空态分支
// 根本不读它，所以那句错话是**无条件**显示的。真正的修复在 app.js 的
// paintAppEmptyState()：把空态换成 App 自己的说法。这个 flag 与那件事无关。
async function ensureDefaults() {
  const cur = await get(KEYS);
  const patch = {};
  if (cur.learnEnabled !== true) patch.learnEnabled = true;
  if (typeof cur.learnDailyNew !== 'number') patch.learnDailyNew = 15;
  // 坏值修复落到 **'off'**，不是 'assist'（2026-09-04）：语音要用户先配引擎才有，
  // 修一个坏值不该顺手把功能打开。chrome-shim 那边同步播种的那一段已经删掉了。
  if (['off', 'assist', 'audio-first'].indexOf(cur.ttsMode) < 0) patch.ttsMode = 'off';
  if (typeof cur.ttsAutoPlay !== 'boolean') patch.ttsAutoPlay = false;
  if (typeof cur.ttsRate !== 'number') patch.ttsRate = 1;
  if (Object.keys(patch).length) await set(patch);
}

// **没有回落到第一个引擎**（2026-09-04）。这是全仓第三处同样的谎 —— 另两处在
// `tts.js` 的 engine() 与扩展 `options.js` 的 updateTtsUI，同一天一起删的。
// 回落会让「未配置」在界面上显示成「已选 browser」，而用户从没做过那个选择。
// 未配置返回 null，调用方各自处理（三处都已能吃 null）。
const engineById = (id) => (Registry.ttsEngines() || []).find((e) => e.id === id) || null;

// 对话模式的语言对（§9.6）。两个下拉从语言注册表填 —— 视图不重述语言列表。
// 用 Registry.langs() 而不是界面语言那张表：归属判断要读它的 scripts 字段，而界面语言表没有。
// 2026-09-17：对话的语言只列**本机识别器支持的语种**（learning-design §9.6 门控修订）。清单由原生桥
// 在 stt-probe 时当场报出（NativeSpeech.supportedLocales），不写死；还没探过 / 老壳不报 ⇒ 不过滤。
// 正选中的那个照旧留着 —— 过滤掉它会让下拉显示成空白（「我明明选过」那一类）。
function sttSupportedBases() {
  try {
    const l = (typeof NativeSpeech !== 'undefined' && NativeSpeech.supportedLocales) ? NativeSpeech.supportedLocales() : [];
    return l.length ? new Set(l.map((x) => String(x).split(/[-_]/)[0].toLowerCase())) : null;
  } catch (_) { return null; }
}
// 「我的语言」没选过就跟着界面语言走；界面语言也没选就跟系统。只在读取时回落，
// 不往存储播种默认值 —— 播种了，用户以后改界面语言这一项就不会跟着动。
function myLangOf(cur) {
  const B = ListenCore.baseCode;
  return B(cur.listenMyLang) || B(cur.uiLang !== 'auto' ? cur.uiLang : '')
    || B(navigator.language) || 'zh';
}

// 账单文案。**能力缺失也要在这里说出来** —— 用户开着「播放解析」却没配引擎时，
// 默默把那些卡从计划里删掉，就是 build 38 那次「表现得和功能没做完全一样」的复刻。
function priceText(p) {
  const lines = [];
  if (!p.cards.length) {
    // 「没有可听读的卡」单独说不够：语音引擎配坏了会让 speakableDeck 把**每一张**卡都
    // 判成读不出来，于是真正的原因（缺地址 / 缺 key）被一句「没卡」盖住。下面那些
    // 具名的行照常追加，所以用户看到的是原因，不是症状。
    lines.push(t('drive_empty', '没有可听读的卡'));
  } else {
    const parts = [t('drive_preload_cards', '{n} 张卡').replace('{n}', String(p.cards.length))];
    if (p.audioCacheable) {
      parts.push(t('drive_preload_audio', '待合成 {n} 段语音').replace('{n}', String(p.audioMissing)));
    }
    if (p.notesMissing) parts.push(t('drive_preload_notes', '待解析 {n} 张').replace('{n}', String(p.notesMissing)));
    if (p.trMissing) parts.push(t('drive_preload_tr', '待补译文 {n} 张').replace('{n}', String(p.trMissing)));
    lines.push(parts.join(' · '));
  }
  if (!p.audioCacheable) {
    lines.push(t('drive_preload_no_audio_cache',
      '设备内置语音不产生缓存，本来就能离线播放；这里只预载解析与译文。'));
  }
  if (p.audioCacheable && !p.engineReady) {
    lines.push(t('drive_preload_tts_bad',
      '语音引擎还没配置好（{reason}），这次一段音频都合成不出来（设置 → 语音引擎）')
      .replace('{reason}', p.engineReason || ''));
  }
  if (p.notesBlocked) {
    lines.push(t('drive_notes_engine_missing',
      '「播放解析」需要先在设置里配好解析引擎（设置 → 句子解析）'));
  } else if (p.fillBlocked) {
    lines.push(t('drive_preload_no_fill_engine',
      '没配解析引擎，没有译文的卡这次补不了译文（设置 → 句子解析）'));
  }
  if (p.skipped) {
    lines.push(t('drive_skipped', '跳过 {n} 张读不出来的卡（媒体卡或无语音）')
      .replace('{n}', String(p.skipped)));
  }
  return lines.join('\n');
}

function tallyText(r) {
  const head = (r.stopped ? t('drive_preload_stopped', '已停止：完成 {done}/{total}')
                          : t('drive_preload_done', '完成 {done}/{total}'))
    .replace('{done}', String(r.done)).replace('{total}', String(r.total));
  if (!r.failures.length) return head;
  const named = r.failures.map((f) => f.reason + ' ×' + f.n).join('、');
  return head + ' · ' + t('drive_preload_failed', '{n} 处失败（{reasons}）')
    .replace('{n}', String(r.failures.reduce((a, f) => a + f.n, 0)))
    .replace('{reasons}', named);
}

// ─── 来源治理 (§4.1/§7.4/§8.9) ─────────────────────────────────────────
// 规则随下一次 push 作为一条 `g` 行走；删除是账号意图，强制同步一次（§7.4）。
async function writeRules(mutate) {
  const cur = await get(['learnRules']);
  const base = cur.learnRules || { v: 1, block: [], langs: null };
  const next = LearnRules.withUpdate(base, mutate(base));
  await set({ learnRules: next });
  const b = Registry.backend();
  if (b && b.enabled) {
    LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
  }
  return next;
}

// Push the WHOLE speech config into the live LearnTTS — configure() is
// RESET-style (DEFAULTS + next), and review.js only reads settings once at
// bundle load, so this is what makes a change work on the NEXT card instead
// of the next launch.
//
// 参数显式（视图把五个输入框的当前值递进来）：model 不摸 DOM。
function liveTtsConfigure(cfg) {
  const c = cfg || {};
  LearnTTS.configure(Object.assign({}, LearnTTS.config, {
    // **没有回落。** 这里曾经是 `|| 'browser'` —— 于是「未配置」在试听时被静默
    // 换成系统自带，真的出了声，而界面说「播放中」。tts.js 里的那个回落 2026-09-04
    // 拆掉了，这一处漏了：同一条规则的第二份实现，正是这一轮在消灭的东西。
    engineId: c.engineId,
    apiKey: String(c.apiKey || '').trim(),
    baseUrl: String(c.baseUrl || '').trim(),
    model: String(c.model || '').trim(),
    voice: c.voice,
  }));
}

// `engineChosen` 此前**在 App 里一处都没写**（只有扩展设置页与扩展引导页写过），
// 而 `EngineState.needsSetup` 要读它：于是在 App 里选了一个不需要 key 的引擎之后，
// 界面仍然说「还没配过翻译引擎」。写入点跟着「真的写了 provider」走。
async function markEngineChosen(plan) {
  const w = (plan && plan.writes) || {};
  if (!w.provider) return;
  try { await set({ engineChosen: 1 }); } catch (_) {}
}

// 对称于扩展设置页 options.jsx 的 maybeTrackEngineSet。App 里写**主翻译引擎**的路
// 有两条：一键卡（applyQuickSetup）与领免费额度（grantAction 的 claim / restore）——
// App 没有 provider 下拉（只有 tts-engine / notes-provider / stt-engine）。
// 两条都要走到这里；漏了任何一条，telemetry-design §1 第一问的激活漏斗「配了引擎 →
// 翻出东西」在 App 上就缺一段。09-16 补一键卡时写的是「一键卡是唯一入口」，那句话当时
// 就不成立：领取直接 set(plan.writes)、不经 applyQuickSetup，于是 #297 把「免费开始」
// 提成引导的默认路径之后，默认路径上没有 engine_set（telemetry-design §3.4）。
//
// 判据走 EngineState.needsSetup，与扩展那侧**同一个出口**，不另写一份
// （engine-state.js 那条「没有人再另写一份判据」由 test/engine-state.test.js 守着）。
// 两条路写完都带 key，所以这里几乎总为真；照样走判据，是为了两个宿主的 engine_set
// 永远表示同一件事 —— 否则同一个数在两张表里含义不同，比没有更糟。
async function trackEngineSet() {
  try {
    const cur = await get(KEYS.concat(['engineChosen']));
    if (typeof EngineState !== 'undefined' && typeof MTTelemetry !== 'undefined'
        && !EngineState.needsSetup(cur)) {
      MTTelemetry.track('engine_set', { provider: String(EngineState.resolve(cur.provider) || '') });
    }
  } catch (_) {}
}

// 领额度 → 写进三槽 → 记 engine_set → 三行自检回执。**这一段是共用的**：
// 设置页的「领取 / 改回」按钮走它，引导页登录成功后的自动领取也走它
// （2026-09-22，learning-design §8.10.1）。抽出来的理由不是复用，是**不能有第二份**
// —— 它里面有四件容易各写各的事：overwrite 的语义、engine_set 什么时候才算数、
// 「已配好」这句话要有证据、以及一个槽都没写时那句话是假的。
async function claimAndApply(opts) {
  const o = opts || {};
  const claimed = await LearnGrant.claim();
  const cur = await get(KEYS);
  // 「改回」= 用户已确认替换掉自己的 key ⇒ overwrite；「领取」不碰用户自己的 key。
  const plan = LearnGrant.plan(claimed, cur, window, { overwrite: !!o.overwrite });
  if (plan.writes && Object.keys(plan.writes).length) await set(plan.writes);
  if (plan.marks) await set(plan.marks);
  // 领到额度并写进了槽 = 引擎配好了（grant_claimed 由 LearnGrant.claim() 自己记）。
  if (plan.writes && Object.keys(plan.writes).length) await trackEngineSet();
  // 一个槽都没写（三槽都是用户自己的 key）时，「已配好」是假话（扩展设置页同一条）。
  const wroteAny = plan.tests && plan.tests.length > 0;
  await markEngineChosen(plan);
  if (o.say) o.say(wroteAny
    ? t('grant_claimed_toast', '免费额度已配好')
    : t('grant_claimed_kept_toast', '免费额度已领到。你自己的 key 保留着 —— 想换用额度，点「改回免费额度」。'));
  // **这句「已配好」此前没有证据** —— 领取这条路一次自检都不跑（plan.tests 只用来
  // 数槽位）。与一键卡走同一份回执：跑一次真的请求，通了才算。
  if (wroteAny && o.selfTest !== false) {
    try { if (typeof AppSetupDone !== 'undefined') await AppSetupDone.show(plan.tests); } catch (_) {}
  }
  return { wroteAny, plan };
}

// ── 宿主 → 设置页的三条通路（旧 wire(opts) 单例换成 bind + 两个订阅口）──────
// 旧 AppSettings 是单例：shell 直接调 paint(session, say) / setDetail(on) / wire。
// React 之后视图是组件、shell-model 不 import 组件 —— 三条命令改走 model 转发：
//   · notifySettingsShown(session)：shell 打开设置页时调；视图订阅 onSettingsShown
//     后整页重画（旧 paint() 的时序位）。
//   · requestDetail(on)：shell 要切「快速 / 详细」档（旧 setDetail 的时序位）。
//   · bind({say, getSession, openExternal, onSignIn, onSignOut})：额度卡要的三样
//     都在宿主那边 —— 开外链走原生桥、登录切视图、提示条（旧 _grantHooks）。
let _hooks = null;
let _session = null;
const _shownSubs = [];
const _detailSubs = [];

function bind(opts) { _hooks = opts || {}; }
function hooks() { return _hooks || {}; }

// 订阅者返回自己的重画 promise（视图的 paintNow），这里收集后统一等 —— 旧 paint()
// 是 async、shell 的 openSettings「paint 之后再滚」要等它跑完；换通知制后时序由
// 返回值保住。requestDetail 同理：shell 要「切完档再滚」，订阅者的 setDetailFn
// 返回 promise，收集后 await。
function notifySettingsShown(session) {
  _session = session || null;
  const ps = _shownSubs.map((fn) => { try { return fn(); } catch (_) { return null; } });
  return Promise.all(ps).then(() => {});
}
function onSettingsShown(fn) { _shownSubs.push(fn); }
// 以 notifySettingsShown 传入的 session 为准（PR6b 裁定）：shell 每次打开设置页都
// 先调 notifySettingsShown，新鲜度在调用点保证；verify 脚本也只经这一口注入假
// session。_session 为 null 时才回落到 bind({session}) 的 getter —— 兜宿主只绑
// getter、从不通知的旧路径。
function currentSession() {
  if (_session !== null) return _session;
  const h = hooks();
  return (typeof h.session === 'function') ? h.session() : null;
}

function requestDetail(on) {
  const ps = _detailSubs.map((fn) => { try { return fn(!!on); } catch (_) { return null; } });
  return Promise.all(ps).then(() => {});
}
function onDetailRequest(fn) { _detailSubs.push(fn); }

// detail 档的持久化（raw —— 见 DETAIL_KEY 处的注释）。
function readStoredDetail() {
  return new Promise((res) => {
    try {
      chrome.storage.local.get([DETAIL_KEY], (r) => res(!!(r && r[DETAIL_KEY] === true)));
    } catch (_) { res(false); }
  });
}
function writeStoredDetail(on) {
  return new Promise((res) => {
    try { chrome.storage.local.set({ [DETAIL_KEY]: !!on }, () => res()); } catch (_) { res(); }
  });
}

export default {
  KEYS, DETAIL_KEY, get, set, ensureDefaults, engineById, sttSupportedBases, myLangOf,
  priceText, tallyText, writeRules, liveTtsConfigure, markEngineChosen, trackEngineSet,
  claimAndApply, bind, hooks, notifySettingsShown, onSettingsShown, currentSession,
  requestDetail, onDetailRequest, readStoredDetail, writeStoredDetail,
};
