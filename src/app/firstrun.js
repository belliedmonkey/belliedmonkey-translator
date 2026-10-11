// src/app/firstrun.js — App 首屏三段式的唯一判定（2026-10-01，#532；2026-10-11 改稿 F/G）。
//
// 规格：`design/firstrun-3step/firstrun-spec.html` §1（boot）与 §3（就绪判据）；
// 交互规约：`docs/interaction-spec.md`「App 首屏三段式」与「改稿 F / 改稿 G」。
//
// 三条自我约束，门禁 `test/app-firstrun.test.js` 的 R3/R4 就是按它们打的：
//   · **纯函数**：不引 Registry、不读存储、不摸 DOM —— 所以它能被布尔组合逐一断言；
//   · **不看发行版**：两版逐条同构，差异只在引擎那一格的来源（R4）；
//   · **不看扩展状态**：就绪判据不含 Safari 扩展（#485 口径，R3）。
//
// 就绪 = 登录 ∧ 引擎可解析 ∧ 所选识别语言包 ∧ 勾选的朗读包 ∧ 基础组件（语种识别 + 人声检测）。
// 听译页的胶囊、两个说话键、状态卡读的是同一个 readiness() / talkChrome()。

/** 就绪判据**唯一**读取的五个输入。顺序即界面上的判定顺序。 */
export const READY_INPUTS = ['loggedIn', 'engine', 'asrPack', 'ttsPack', 'basePack'];

/** 首启语言列表默认展开的四门（其余收进「其他 N 种语言」）。 */
export const PINNED_LANGS = ['zh', 'en', 'th', 'ja'];

/** 中英共用的那一个朗读包覆盖的两门。 */
export const KOKORO_LANGS = ['zh', 'en'];

export function readyInputs() {
  return READY_INPUTS.slice();
}

export function isReady(s) {
  return READY_INPUTS.every((k) => !!s[k]);
}

export function baseCode(x) {
  return String(x || '').split(/[-_]/)[0].toLowerCase();
}

/**
 * 默认勾选：系统语言 + 中文 + English，去重。
 * 系统是中文 ⇒ [zh, en]；系统是泰语 ⇒ [th, zh, en]。没有单独的「对方语言」默认。
 */
export function defaultLangSelection(systemLang) {
  const sys = baseCode(systemLang) || 'en';
  const out = [];
  const add = (c) => { if (c && out.indexOf(c) < 0) out.push(c); };
  add(sys);
  add('zh');
  add('en');
  return out;
}

/** 勾了中文或 English 就带上共用朗读包；用户明确关掉（override === false）才不带。两门都没勾则不带。 */
export function kokoroChecked(selectedLangs, kokoroOverride) {
  const sel = (selectedLangs || []).map(baseCode);
  const has = sel.indexOf('zh') >= 0 || sel.indexOf('en') >= 0;
  if (!has) return false;
  if (kokoroOverride === false) return false;
  return true;
}

/**
 * 要下的朗读语言。泰语朗读包默认不在里面：勾了 ไทย 也不会自动带上，只有 thaiTts 为真才加。
 * 返回值交给 deviceStatus / ensureDeviceReady 的 langOpt，没选的泰语就不会被探、也不会被下。
 */
export function ttsLangsFor(selectedLangs, thaiTts, kokoroOverride) {
  const sel = (selectedLangs || []).map(baseCode);
  const out = [];
  if (kokoroChecked(sel, kokoroOverride)) {
    if (sel.indexOf('zh') >= 0) out.push('zh');
    if (sel.indexOf('en') >= 0) out.push('en');
  }
  if (thaiTts && sel.indexOf('th') >= 0 && out.indexOf('th') < 0) out.push('th');
  return out;
}

/**
 * 一份资产对照一份需求，给出每一项齐没齐。
 * assets: { asr: {zh:true}, tts: {zh:true, en:true}, lid: bool, vad: bool }
 * need:   { asrLangs, ttsLangs, base }
 * 中英朗读是**一行**（tts:zh-en）：两门里只要需求里有一门，就等那一门对应的模型；
 * 它们共用一个包，调用方探针按语言过滤后，装好一门另一门也齐。
 */
export function readiness(assets, need) {
  const a = assets || {};
  const n = need || {};
  const asrMap = a.asr || {};
  const ttsMap = a.tts || {};
  const items = [];
  if (n.base) {
    const ready = !!(a.lid && a.vad);
    items.push({ id: 'base', kind: 'base', ready, pending: !ready });
  }
  const asrLangs = [];
  for (const lang of (n.asrLangs || [])) {
    const code = baseCode(lang);
    if (!code || asrLangs.indexOf(code) >= 0) continue;
    asrLangs.push(code);
    const ready = !!asrMap[code];
    items.push({ id: 'asr:' + code, kind: 'asr', lang: code, ready, pending: !ready });
  }
  const ttsLangs = [];
  for (const lang of (n.ttsLangs || [])) {
    const code = baseCode(lang);
    if (code && ttsLangs.indexOf(code) < 0) ttsLangs.push(code);
  }
  const kokoro = ttsLangs.filter((c) => c === 'zh' || c === 'en');
  if (kokoro.length) {
    const ready = kokoro.every((c) => !!ttsMap[c]);
    items.push({ id: 'tts:zh-en', kind: 'tts', langs: kokoro.slice(), ready, pending: !ready });
  }
  if (ttsLangs.indexOf('th') >= 0) {
    const ready = !!ttsMap.th;
    items.push({ id: 'tts:th', kind: 'tts', langs: ['th'], ready, pending: !ready });
  }
  const pending = items.filter((it) => it.pending);
  const asrPack = asrLangs.every((c) => !!asrMap[c]);
  const ttsPack = ttsLangs.every((c) => !!ttsMap[c]);
  const basePack = n.base ? !!(a.lid && a.vad) : true;
  return { ready: pending.length === 0, pending, items, asrPack, ttsPack, basePack };
}

/**
 * 一次转写探针算不算「这门识别包已经在设备上」。
 * 只认 `assets === 'installed'`。`ok` 为真但 assets 仍是 missing，是「语言支持、包没下」。
 * 探针上的 `ready: true` 是旧夹具字段（也是进度消息里「识别器硬件可用」），单独出现不算装好。
 * 包屏和听译页都用这一句，再把结果交给 readiness()。
 */
export function asrInstalled(probe) {
  if (!probe || probe.ok === false) return false;
  return probe.assets === 'installed';
}

/** 听译页某一侧要能开口：这门语言的识别包 + 基础组件。朗读包不拦说话键。 */
export function sideNeed(lang) {
  const code = baseCode(lang);
  return { asrLangs: code ? [code] : [], ttsLangs: [], base: true };
}

/** 首启硬门要的那一份：勾选的识别包 + 勾选的朗读包 + 基础组件。 */
export function firstRunNeed(selectedLangs, opts) {
  const o = opts || {};
  const sel = [];
  for (const lang of (selectedLangs || [])) {
    const code = baseCode(lang);
    if (code && sel.indexOf(code) < 0) sel.push(code);
  }
  return {
    asrLangs: sel.slice(),
    ttsLangs: ttsLangsFor(sel, !!o.thaiTts, o.kokoro),
    base: o.base !== false,
  };
}

/**
 * 说话键 / 状态卡 / 胶囊共用的这一帧。
 * showsListening / showsRecording 只在「这一侧真的就绪，而且麦已经开了」时为真。
 * autoStart 恒为 false：下完不会自己开始收音。
 */
export function talkChrome(s) {
  const st = s || {};
  const sideReady = !!st.sideReady;
  const recording = !!st.recording;
  const phase = st.phase || 'idle';
  const listening = !!(recording && sideReady && phase === 'listening');
  let hint = 'tap';
  let card = 'idle';
  if (!sideReady) {
    hint = 'preparing';
    card = 'not-ready';
  } else if (listening) {
    hint = 'recording';
    card = 'listening';
  } else if (st.justReady) {
    hint = 'tap';
    card = 'ready-tap';
  }
  return {
    hint,
    card,
    showsListening: listening,
    showsRecording: listening,
    autoStart: false,
    disabled: !sideReady || !!st.blocked,
  };
}

/**
 * 进度回调必须带得出名字。空名字抛错，调用方用组件名或语言本名当 fallback 再进来。
 * 返回的对象同时有 locale 与 name，胶囊不会再画出空白语言。
 */
export function nameProgress(msg, fallback) {
  const m = msg && typeof msg === 'object' ? msg : {};
  const name = String(m.name || m.locale || fallback || '').trim();
  if (!name) {
    const err = new Error('progress-name-required');
    err.code = 'progress-name-required';
    throw err;
  }
  return Object.assign({}, m, { locale: m.locale || name, name });
}

/** 只有明确报了蜂窝才先问。未知网络不拦（探不到不该把人卡在门口）。 */
export function needsCellularConfirm(kind) {
  return kind === 'cellular';
}

/** 'wait' 留下勾选、连上 Wi-Fi 再下；'cellular' 现在就下。 */
export function cellularPlan(choice) {
  if (choice === 'cellular') return { download: true, waitWifi: false };
  return { download: false, waitWifi: true };
}

/**
 * 把字节数收成设计稿上的「约 N MB」：MiB 与十进制 MB 哪边更接近整数就用哪边，再按 5 取整。
 * 调用方传入清单里的字节数，这里不读模型表。
 */
export function displayMb(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return 0;
  const mib = n / (1024 * 1024);
  const mb = n / 1e6;
  const pick = Math.abs(mib - Math.round(mib)) <= Math.abs(mb - Math.round(mb)) ? mib : mb;
  return Math.max(5, Math.round(pick / 5) * 5);
}

/**
 * 展开的四门 + 收起的其余。系统语言不在四门里时插到最前（并默认勾上，由 defaultLangSelection 决定）。
 * catalog 是 {code} 或短码，顺序保留。
 */
export function visibleLangs(catalog, systemLang) {
  const codes = [];
  for (const item of (catalog || [])) {
    const code = baseCode(typeof item === 'string' ? item : item && item.code);
    if (code && codes.indexOf(code) < 0) codes.push(code);
  }
  const have = {};
  for (const c of codes) have[c] = true;
  const sys = baseCode(systemLang);
  const pinned = [];
  if (sys && have[sys] && PINNED_LANGS.indexOf(sys) < 0) pinned.push(sys);
  for (const c of PINNED_LANGS) if (have[c]) pinned.push(c);
  const rest = codes.filter((c) => pinned.indexOf(c) < 0);
  return { pinned, rest };
}

/**
 * 听译页那一对：我的 = 系统语言（若已勾）否则勾选里的第一门；
 * 对方 = 另一门已勾的，中英都在时优先对面那门。
 */
export function listenPair(selected, systemLang) {
  const sel = [];
  for (const lang of (selected || [])) {
    const code = baseCode(lang);
    if (code && sel.indexOf(code) < 0) sel.push(code);
  }
  const sys = baseCode(systemLang);
  const my = (sys && sel.indexOf(sys) >= 0) ? sys : (sel[0] || sys || 'zh');
  let other = '';
  const rest = sel.filter((c) => c !== my);
  if (sel.indexOf('en') >= 0 && sel.indexOf('zh') >= 0) other = my === 'zh' ? 'en' : 'zh';
  else if (rest.indexOf('en') >= 0) other = 'en';
  else if (rest.indexOf('zh') >= 0) other = 'zh';
  else if (rest.length) other = rest[0];
  else other = my === 'en' ? 'zh' : 'en';
  if (other === my) other = my === 'en' ? 'zh' : 'en';
  return { my, other };
}

// 降级：**唯一**允许绕过屏 2 的情形是「这台设备的识别器不支持这个语种」——
// 那时识别这条路本来就走不通，把朗读包与基础组件下完、其余功能照用，比卡在门口好。
// 其余原因（离线 / 蜂窝 / 空间不足 / 未知）一律不许绕过，只能重试。
const DEGRADABLE = new Set(['asrUnsupported']);

export function degradeAllowed(reason) {
  return DEGRADABLE.has(reason);
}

/**
 * boot 判定（规格 §1）。顺序即优先级：
 *   未登录                  → 'login'      （屏 1 只有登录）
 *   缺任一设备包            → 'packs'      （**硬门**；降级由屏内处理，不在这里放行）
 *   否则                    → 'home'
 *
 * 设备包自 2026-10-11（改稿 F）起是三样：所选识别包、勾选的朗读包、基础组件。
 * 引擎可解析**不参与屏序**（2026-10-01 模拟器实测改的口径）：它决定能不能算就绪，不决定先看哪一屏。
 */
export function step(s) {
  if (!s.loggedIn) return 'login';
  if (!s.asrPack || !s.ttsPack || !s.basePack) return 'packs';
  return 'home';
}
