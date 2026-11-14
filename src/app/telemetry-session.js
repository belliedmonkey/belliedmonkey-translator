// src/app/telemetry-session.js — App 侧「一次冷启」的遥测会话（BEL-223 / 225 / 226）。
//
// 为什么是 App-only 的新文件，而不是改 `extension/learn/telemetry.js`：
//   · 1.23.3 的 extension/ 已冻结（CWS 在审），本拍不许动；
//   · 但 `launch_id` 必须是**一次进程启动一个**，不能每个事件各生成 —— 所以把
//     「冷启会话」放在 App 组合根里：本模块在 App 脚本里只求值一次，LAUNCH 只生成一次。
//   扩展宿主没有 App 生命周期，仍然不发 app_open / auth_ok / live_gate / pack_*。
//
// 三条纪律：
//   ① 事件正文只有注册表里登记过的属性；user_id / 邮箱 / 令牌 / 内容 / 路径一律不进。
//   ② launch_id 只在本模块生成一次；`installLaunchId()` 把注册表里带 launch_id 的事件
//      （engine_test / mic_permission / asr_start / asr_entry）在发送口补齐。这样共用
//      模块（extension/learn/engine-test.js 等，冻结）不用改，App 侧也只有一个生成点。
//   ③ surface 五值的判定规则写在下面的 SURFACES / DEFAULT_SURFACE 注释里；App 没有
//      web_caption 这个面（它只由扩展的网页字幕会话产生），App 侧不发。
//
// 本文件是 ESM、无 JSX、无 React，`test/harness.js` 的 loadSrc() 能直接跑。
import Registry from '../lib/registry.js';

// BEL-223 的五个功能面（build/telemetry.config.js 的 SURFACES 同源）。
//   listen       对话 · 实时听译页
//   live_caption 实时字幕页 / 字幕浮层
//   quick        快捷翻译面板（#quick 冷启）
//   doc          文档翻译页
//   web_caption  网页字幕入口 —— **App 没有这个面**（扩展的 subtitle-adapter 才发），
//                所以 App 侧只登记、不产生；缺口写进 RESULT。
export const SURFACES = ['listen', 'live_caption', 'quick', 'doc', 'web_caption'];
// 冷启默认面：首页的主功能是「对话 · 实时听译」，所以没有上次面时记 listen。
// 有上次面（tm:lastSurface）时用上次面 —— 这是 BEL-225 的「冷启按首页/上次面判定」规则。
// 登录墙本身不是五个功能面之一：登录墙前的 app_open 仍用这个规则给 surface。
export const DEFAULT_SURFACE = 'listen';

// BEL-223：live_gate 的取值与发送口映射（注册表同源）。放在这里是为了让「桥 / 探针
// 的原始 reason → 票面 result」只有一处翻译表；listen-model 只报它看到的原始状态。
const LIVE_GATE_RESULTS = ['script_missing', 'channel_missing', 'os_below_min', 'no_transcriber',
  'locale_unsupported', 'probe_timeout', 'ok'];
const LIVE_GATE_WINDOWS = ['main', 'quick', 'other'];
const LIVE_GATE_COPY = ['need_os', 'switch_locale', 'other'];

const K = {
  lastSurface: 'tm:lastSurface',
  setupId: 'tm:setupId',
  packsReady: 'tm:packsReady',
  packAttempts: 'tm:packAttempts',
  packDownloaded: 'tm:packDownloaded',
  authSeen: 'tm:authSeen',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/;

// 32-hex 同义标识：uuid 去掉连字符。**卡面写 UUID，因扩展冻结只能用 id 规则** ——
// extension/learn/telemetry.js 的 okValue 只认 数组 / int / id，36 字符带连字符的
// uuid 过不了 /^[a-z0-9_-]{1,32}$/，整条事件会被丢掉（BEL-227，2026-11-08）。
// launch_id / setup_id 一律走这里；install_id 仍是 uuid（既有约定，服务端按 uuid 收）。
function hex32(id) {
  return String(id || '').toLowerCase().replace(/-/g, '');
}

// ── 一次启动的 id ─────────────────────────────────────────────────────────
// 模块求值一次 = 这次冷启生成一次；同一进程里的所有事件共用。不是安装 id，也不是账号。
// 值 = 32 位小写十六进制（uuid 去掉连字符）；理由见上面 hex32()：扩展冻结，只认 id 规则。
const LAUNCH_ID = hex32(uuid());

function uuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) { /* vm / 老宿主没有 crypto，走下面的兜底 */ }
  try {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch (_) { /* 继续兜底 */ }
  // 只用于没有 crypto 的测试环境。仍然是 v4 形状、随机、只活这一次进程。
  const h = [];
  for (let i = 0; i < 16; i++) h.push(Math.floor(Math.random() * 256));
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function launchId() { return LAUNCH_ID; }

// ── 存储小工具（App 用 chrome.storage.local；测试给假体）────────────────────
function storage() {
  try { return chrome.storage && chrome.storage.local; } catch (_) { return null; }
}
function sget(keys) {
  return new Promise((resolve) => {
    const s = storage(); if (!s) return resolve({});
    try { s.get(keys, (r) => resolve(r || {})); } catch (_) { resolve({}); }
  });
}
function sset(obj) {
  return new Promise((resolve) => {
    const s = storage(); if (!s) return resolve();
    try { s.set(obj, () => resolve()); } catch (_) { resolve(); }
  });
}

function telemetry() {
  try { return (typeof MTTelemetry !== 'undefined' && MTTelemetry) || null; } catch (_) { return null; }
}
// 开关必须**调用当时**读：设置页改了 tm:on，本模块不缓存，下一次调用立刻生效。
// MTTelemetry.enabled() 每次都读 chrome.storage（缺省 = 开），所以这里不保存结果。
async function telemetryOn() {
  try {
    const t = telemetry();
    if (!t || typeof t.enabled !== 'function') return false;
    // 规格未就位时 MTTelemetry.enabled() 会直接返回 false（它先看 spec()）。若此时
    // 就放弃，app_open / auth_ok 会在 track() 的缓冲之外提前丢掉 —— 所以这里也等
    // 同一小段；等不到就维持原来的「没有规格 ⇒ 不发」。
    if (!specReady() && !(await waitForSpec())) return false;
    return !!(await t.enabled());
  } catch (_) { return false; }
}

// ── 等 spec 就位（BEL-227 防御）──────────────────────────────────────────────
// App 的 bundle 与 providers.gen.js 是两个 script：极少数冷启顺序里 telemetry 规格
// （Registry.telemetrySpec() 背后的 window.MT_TELEMETRY）会晚一拍。规格没到时
// MTTelemetry.track() 的 shape() 直接判 null，事件静默消失。这里只等 200ms（10ms
// 一查），给后到的 spec 一个机会；仍没有就保持原来的静默语义（不抛、不入队）。
// 每次都现读，绝不把「已就位」缓存成永久真 —— 允许同一个进程里 spec 后到。
const SPEC_WAIT_MS = 200;
const SPEC_POLL_MS = 10;

function specReady() {
  try { return !!(Registry.telemetrySpec && Registry.telemetrySpec()); } catch (_) { return false; }
}
function waitForSpec() {
  return new Promise((resolve) => {
    if (specReady()) return resolve(true);
    const deadline = Date.now() + SPEC_WAIT_MS;
    const poll = () => {
      if (specReady()) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, SPEC_POLL_MS);
    };
    poll();
  });
}
function trackNow(name, props) {
  try {
    const t = telemetry();
    if (t && typeof t.track === 'function') return t.track(name, props || {});
  } catch (_) { /* 埋点永远不能挡住产品 */ }
  return false;
}

// 所有新事件只从这个口出。MTTelemetry.track 自己的 trackOne() 会先过 enabled()，
// 所以关掉开关时既不入队也不发；flushOnce() 发送前还会再查一次（旧队列也不发）。
// 规格已就位时保持同步调用（与改动前逐字一致）；未就位才返回一个最多 200ms 的
// Promise，供调用方（和实跑证据）观察结果。
function track(name, props) {
  try {
    if (specReady()) return trackNow(name, props);
    return waitForSpec().then((ready) => (ready ? trackNow(name, props) : false));
  } catch (_) { /* 埋点永远不能挡住产品 */ }
  return false;
}
function debug(msg, err) {
  // 只记事件名 / 状态 / 错误名 —— 永不记 Authorization、token、邮箱、正文。
  try {
    if (typeof console === 'undefined' || !console.debug) return;
    const detail = err ? String((err && (err.name || err.message)) || err) : '';
    console.debug('[telemetry] ' + msg + (detail ? ': ' + detail : ''));
  } catch (_) {}
}

// ── launch_id 注入（一次性）────────────────────────────────────────────────
// 注册表里带 launch_id 的事件：engine_test / mic_permission / asr_start / asr_entry。
// 这几个发送点有的在冻结的 extension/learn/engine-test.js 里，本拍不改它 —— 在 App
// 的发送口统一补。包装只加「注册表允许且缺省」的键；从不让表外键混进事件。
let launchPatched = false;
export function installLaunchId() {
  if (launchPatched) return;
  const t = telemetry();
  if (!t || typeof t.track !== 'function') return;
  const spec = (Registry.telemetrySpec && Registry.telemetrySpec()) || null;
  const events = (spec && spec.spec && spec.spec.events) || null;
  if (!events) return;
  const orig = t.track;
  t.track = function patchedTrack(name, props) {
    try {
      const rules = events[name];
      if (rules && Object.prototype.hasOwnProperty.call(rules, 'launch_id')) {
        const p = Object.assign({}, props || {});
        if (p.launch_id === undefined) p.launch_id = LAUNCH_ID;
        return orig.call(t, name, p);
      }
    } catch (_) { /* 注入失败就原样发 */ }
    return orig.call(t, name, props);
  };
  launchPatched = true;
}

// ── surface：进面时记一次，冷启按上次面/首页判定 ──────────────────────────
let currentSurface = '';
let surfaceFlight = null;
function validSurface(s) { return SURFACES.indexOf(s) >= 0 && s !== 'web_caption'; }

// BEL-223 live_gate.window：主窗口 / Mac 快译第二窗 / 其它。快译面板是同一个页面以
// #quick 加载（AppQuick.isQuickMode），它**不走首页这道闸** —— 所以 liveGate() 在
// quick 窗口里直接不发，避免把第二窗记成「首页灰卡」。
function isQuickWindow() {
  try {
    return !!(typeof AppQuick !== 'undefined' && AppQuick
      && typeof AppQuick.isQuickMode === 'function' && AppQuick.isQuickMode());
  } catch (_) { return false; }
}
export function windowKind() {
  if (isQuickWindow()) return 'quick';
  return 'main';   // App 目前只有主窗与快译第二窗；'other' 留给以后的新窗口
}

// 注册表 id 型：小写字母 / 数字 / _ / -，≤32。os_version 与 probe_locale 都走
// 这条（扩展侧 okValue 只认 数组 / int / id，带点的大写串会整条丢掉）。
function idValue(v) {
  return String(v == null ? '' : v).toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 32);
}

// os_version：只用能从 UA 可靠读到版本的平台（iOS/iPadOS）。macOS 的 UA 冻结在
// 10_15_x，读了会得到一个假版本，所以 Mac 上宁可省略并在 RESULT 记「原生桥没报
// 系统版本」的缺口 —— 不编一个值。
function osVersionId() {
  try {
    const ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    if (!/iPhone|iPad|iPod/.test(ua)) return '';
    const m = /OS (\d+)[._](\d+)(?:[._](\d+))?/.exec(ua);
    if (!m) return '';
    return idValue('ios_' + m[1] + '_' + m[2] + (m[3] ? '_' + m[3] : ''));
  } catch (_) { return ''; }
}
function osMajor() {
  const m = /^ios_(\d+)/.exec(osVersionId());
  return m ? Number(m[1]) : null;
}

function liveCopyClass(result) {
  if (result === 'locale_unsupported') return 'switch_locale';
  if (result === 'os_below_min' || result === 'no_transcriber'
      || result === 'script_missing' || result === 'channel_missing') return 'need_os';
  return 'other';   // ok / probe_timeout：这一刻没有一句新的灰态文案
}

/** 同步读当前面（还没进过任何面时是首页默认面）。 */
export function currentSurfaceSync() { return currentSurface || DEFAULT_SURFACE; }

/** 进入一个功能面：内存值立即生效，同时落盘给下一次冷启用。 */
export function enter(surface) {
  if (!validSurface(surface)) return currentSurfaceSync();
  currentSurface = surface;
  try { sset({ [K.lastSurface]: surface }); } catch (_) { /* 写不进不挡用户 */ }
  return surface;
}

export function currentSurfaceAsync() {
  if (currentSurface) return Promise.resolve(currentSurface);
  if (!surfaceFlight) {
    surfaceFlight = (async () => {
      const r = await sget([K.lastSurface]);
      if (!currentSurface) {
        const last = r[K.lastSurface];
        // quick 是独立的快捷面板冷启，不是主 App 的「上次面」：主 App 冷启若读到
        // 上次是 quick，按首页默认 listen 算。quick 面板自己会在 main.jsx 里先进面。
        currentSurface = (validSurface(last) && last !== 'quick') ? last : DEFAULT_SURFACE;
      }
      return currentSurface;
    })();
  }
  return surfaceFlight;
}

// ── app_open：每次冷启一条，登录墙之前也发 ─────────────────────────────────
// auth_state 只回答「打开那一刻会话读出来没有」：
//   signed_in  = 存储里有一个可用的会话
//   signed_out = 读成功、确实没有会话
//   unknown    = 读失败（读不到 ≠ 已退出，同 LearnAuth 的既有判据）
// 这个事件不 await 登录流程、也不在登录成功后再补发 —— 它就在冷启这一刻。
let appOpenFlight = null;
export function appOpen() {
  if (appOpenFlight) return appOpenFlight;
  appOpenFlight = (async () => {
    // 冷启第一件事先读开关：关掉时连 track() 都不调，队列里不会多出一条 app_open。
    if (!(await telemetryOn())) return false;
    const surface = await currentSurfaceAsync();
    let authState = 'unknown';
    try {
      if (typeof LearnAuth !== 'undefined' && LearnAuth && typeof LearnAuth.currentStable === 'function') {
        const session = await LearnAuth.currentStable({ tries: 0 }).catch(() => null);
        const loadErr = (typeof LearnAuth.lastLoadError === 'function') ? LearnAuth.lastLoadError() : null;
        authState = session ? 'signed_in' : (loadErr ? 'unknown' : 'signed_out');
      }
    } catch (_) { authState = 'unknown'; }
    track('app_open', { launch_id: LAUNCH_ID, surface, auth_state: authState });
    return true;
  })().catch(() => false);
  return appOpenFlight;
}

// ── auth_ok：登录成功后的匿名事件 + 第一方窄口 ─────────────────────────────
// method 的判定：注册表只给 signup / signin，而 GoTrue 的会话对象没有可靠的
// 「这次是新建还是登录」字段（bt-auth-ok 的实现注释也明说不要拿时间差猜）。
// App 里「登录即注册」（邮箱验证码 create_user）与 Apple / Google / 密码登录都会
// 产生会话，所以本模块用**本机首次见到的账号**作 signup：同一台设备第一次成功登录
// 这个 userId ⇒ signup，之后再登 ⇒ signin。它是本机口径，不是服务端出生证明 ——
// 换设备的第一次登录会记成 signup（缺口如实写进 RESULT）。
async function classifyMethod(userId) {
  if (!userId) return 'signin';
  try {
    const r = await sget([K.authSeen]);
    const seen = Array.isArray(r[K.authSeen]) ? r[K.authSeen].map(String) : [];
    if (seen.indexOf(String(userId)) >= 0) return 'signin';
    seen.push(String(userId));
    await sset({ [K.authSeen]: seen.slice(-20) });
    return 'signup';
  } catch (_) { return 'signin'; }
}

function flavor() {
  try { return Registry.flavor() === 'china' ? 'china' : 'global'; } catch (_) { return 'global'; }
}

async function reportAuthOk(o) {
  const auth = String((o && o.accessToken) || '');
  if (!auth) return false;
  const backend = Registry.backend();
  if (!backend || !backend.url) return false;
  let installId = null;
  try {
    const t = telemetry();
    if (t && typeof t.installId === 'function') {
      const got = await t.installId();
      installId = (got && got.id) || null;
    }
  } catch (_) { installId = null; }
  const headers = {
    Authorization: 'Bearer ' + auth,
    'content-type': 'application/json',
    'x-mt-method': String(o.method || ''),
    'x-mt-host': 'app',
    'x-mt-flavor': flavor(),
    'x-mt-provider': String(o.provider || ''),
  };
  if (installId) headers['x-mt-install-id'] = installId;
  const body = {
    install_id: installId,
    method: o.method,
    host: 'app',
    flavor: flavor(),
    provider: o.provider,
  };
  try {
    const res = await fetch(backend.url + '/functions/v1/bt-auth-ok', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res || !res.ok) debug('bt-auth-ok failed (HTTP ' + String((res && res.status) || 0) + ')');
    return !!(res && res.ok);
  } catch (e) {
    // 失败不阻塞登录：吞掉，只留一行不含令牌的 debug。
    debug('bt-auth-ok unreachable', e);
    return false;
  }
}

/**
 * 登录/注册成功后调用。返回的 Promise 永远 resolve（false = 窄口没写成），
 * 调用方 **不要 await** 它来推动登录 UI —— fire-and-forget。
 */
export function noteAuthOk(o) {
  const src = o || {};
  const provider = ['apple', 'google', 'email', 'phone', 'unknown'].indexOf(src.provider) >= 0
    ? src.provider : 'unknown';
  return (async () => {
    // 两条路共用同一个开关：关掉时必须**两条都不做** —— 不记匿名 auth_ok，也不写
    // 第一方 bt-auth-ok（否则「关了还留着账号关联」就是假话）。开关状态现读，不缓存。
    if (!(await telemetryOn())) return false;
    const method = src.method === 'signup' || src.method === 'signin'
      ? src.method : await classifyMethod(src.userId);
    // BEL-223：登录成功发生在登录面 —— surface 钉成 login，不再沿用「上次功能面」。
    // launch_id 与同一次冷启的其他事件共用一个 32-hex id（installLaunchId 也会补，
    // 这里显式带上是让发送口自身完整、可单测）。
    track('auth_ok', { surface: 'login', provider, method, launch_id: LAUNCH_ID });
    // 开关打开时才写第一方窄口；与上面的匿名事件同进同退。
    return reportAuthOk({ accessToken: src.accessToken, provider, method });
  })().catch(() => false);
}

// ── 门 / 领取失败 ──────────────────────────────────────────────────────────
//
// BEL-223 live_gate：首页入口判定。调用方只报**原始状态**（桥在不在、探针 reason、
// 这次探针是否复用了上次结论），result / reason_copy_class 的映射收在这一处，
// 保证「票面 result 枚举 → 代码」只有一张表：
//   bridgeState: 'script_missing' | 'channel_missing' | 'ok'
//   probeReason: NativeSpeech.probe() 的 reason（os / locale / timeout / no-bridge / ''）
// 判断顺序 = 现网：先桥后探针（桥都没有就不探）。
export function liveGate(info) {
  const o = (info && typeof info === 'object') ? info : {};
  // Mac 快译第二窗故意不装识别桥，也不是首页 —— 它不走这道闸，一条都不发。
  if (isQuickWindow()) return false;
  const surface = validSurface(o.surface) ? o.surface : currentSurfaceSync();
  const bridge = (o.bridgeState === 'script_missing' || o.bridgeState === 'channel_missing')
    ? o.bridgeState : '';
  let result = LIVE_GATE_RESULTS.indexOf(o.result) >= 0 ? o.result : '';
  if (!result) {
    if (bridge) {
      result = bridge;
    } else if (o.ok === true || o.ok === 'true') {
      result = 'ok';
    } else {
      const reason = String(o.probeReason || '');
      if (reason === 'timeout') result = 'probe_timeout';
      else if (reason === 'locale') result = 'locale_unsupported';
      else if (reason === 'no-bridge') result = 'channel_missing';
      // 原生 reason:'os' 同时覆盖「系统低于 26」与「SpeechTranscriber.isAvailable=false」。
      // UA 能读到 iOS 主版本时，≥26 就归 no_transcriber，否则（含 Mac 读不到版本）归
      // os_below_min —— 原生桥没有分开报这两个原因，缺口见 RESULT。
      else if (reason === 'os') result = (osMajor() != null && osMajor() >= 26) ? 'no_transcriber' : 'os_below_min';
      else result = 'no_transcriber';
    }
  }
  const p = {
    surface,
    // 旧 P0 属性照发（1.23.3 老客户端收这个）；result 才是本轮的原因拆分。
    ok: result === 'ok' ? 'true' : 'false',
    result: result,
    window: LIVE_GATE_WINDOWS.indexOf(o.window) >= 0 ? o.window : windowKind(),
    first_refresh: (o.firstRefresh === true || o.firstRefresh === 'true') ? 'true' : 'false',
    reused_prior_state: (o.reusedPriorState === true || o.reusedPriorState === 'true') ? 'true' : 'false',
    launch_id: LAUNCH_ID,
    reason_copy_class: LIVE_GATE_COPY.indexOf(o.reasonCopyClass) >= 0
      ? o.reasonCopyClass : liveCopyClass(result),
  };
  const osv = idValue(o.osVersion || osVersionId());
  if (osv) p.os_version = osv;
  // os_meets_min：调用方能从探针确定就显式给；没给时只按 result 能确定的填，
  // 桥/超时这种「不知道」就省略键 —— 不发一个猜的布尔。
  // no_transcriber 的前提是系统已够新（只是识别器没开放），所以也归 true。
  let meets = o.osMeetsMin;
  if (meets === undefined) {
    if (result === 'ok' || result === 'locale_unsupported' || result === 'no_transcriber') meets = true;
    else if (result === 'os_below_min') meets = false;
  }
  if (meets === true || meets === 'true') p.os_meets_min = 'true';
  else if (meets === false || meets === 'false') p.os_meets_min = 'false';
  const loc = idValue(o.probeLocale);
  if (loc) p.probe_locale = loc;
  return track('live_gate', p);
}

// 领取失败的七个码来自 extension 的 grant_err_* 文案键。服务端/传输层会抛更细的
// 内部码（grant_unavailable / offline / signed_out…），这里只做**归一化**，不改文案。
const GRANT_CODES = ['exhausted', 'unavailable', 'misconfigured', 'revoked', 'invalid', 'model', 'busy'];
export function grantClaimCode(code) {
  const raw = String(code || '').toLowerCase();
  if (GRANT_CODES.indexOf(raw) >= 0) return raw;
  if (raw === 'grant_unavailable' || raw === 'offline' || raw === 'network' || raw === 'server'
      || raw === 'timeout' || raw === '') return 'unavailable';
  if (raw === 'grant_misconfigured' || raw === 'no_host' || raw === 'no host') return 'misconfigured';
  if (raw === 'signed_out' || raw === 'auth' || raw === '401' || raw === '403') return 'revoked';
  if (raw === 'model_not_allowed' || raw.indexOf('model') === 0) return 'model';
  if (raw === 'invalid' || raw === 'bad_request' || raw === '400') return 'invalid';
  if (raw === 'busy' || raw === 'rate_limited' || raw === '429') return 'busy';
  return 'unavailable';
}

// 真实原因（票面五值）。分类依据 = LearnGrant.claim() 抛的 code 与 HTTP status：
//   offline / network / timeout                    → network
//   busy / rate_limited / 429                      → busy
//   revoked / grant_revoked / signed_out / 401/403 → revoked
//   server / grant_unavailable / grant_misconfigured / 5xx → server
//   其余（exhausted / invalid / model）                     → other
export function grantClaimReason(err) {
  const code = String((err && typeof err === 'object') ? (err.code || '') : (err || '')).toLowerCase();
  const status = Number(err && typeof err === 'object' ? err.status : 0) || 0;
  if (code === 'offline' || code === 'network' || code === 'timeout' || code === 'fetch') return 'network';
  if (code === 'busy' || code === 'rate_limited' || status === 429) return 'busy';
  if (code === 'revoked' || code === 'grant_revoked' || code === 'signed_out'
      || code === 'auth' || status === 401 || status === 403) return 'revoked';
  if (code === 'server' || code === 'grant_unavailable' || code === 'grant_misconfigured'
      || status >= 500) return 'server';
  return 'other';
}
export function grantClaimFail(err, path) {
  const reason = grantClaimReason(err);
  track('grant_claim_fail', {
    surface: currentSurfaceSync(),
    // 旧 P0 属性：code 七值照发（1.23.3 老客户端收这个），过渡期两套并存。
    code: grantClaimCode((err && typeof err === 'object') ? err.code : err),
    reason: reason,
    // 文案类别：revoked 走「这份免费额度已经停用了」（票面明确不改）；其余归 retryable。
    copy_class: reason === 'revoked' ? 'revoked' : 'retryable',
    // silent = 登录/换号后的自动领取；manual = 设置页按钮。
    path: path === 'manual' ? 'manual' : 'silent',
  });
}

// ── 语言包：setup_id / start / ok / fail / packs_ready ─────────────────────
// setup_id 与 install_id **分开存**（仿它的存法，不复用）：install_id 是安装级随机
// uuid，setup_id 是「把包配齐」这条流程的 id，跨启动保持不变，这样上次没下完、这次
// 接着下能串成一条。首次用到时生成，之后一直读同一个键。
//
// 格式是 **32 位小写十六进制**（uuid 去掉连字符），理由同 launch_id：扩展冻结，okValue
// 只认 id 规则，36 字符带连字符的 uuid 会被整条丢掉（BEL-227，2026-11-08）。
function normalizeSetupId(v) {
  if (typeof v !== 'string') return '';
  if (HEX32_RE.test(v)) return v;
  // 平滑迁移：旧版本存的是带连字符的 uuid。去掉连字符就是**同一个标识**的 32-hex 写法，
  // 转换一次并写回；不重新生成 —— 否则老用户跨启动的「同一个 setup」会断掉。
  if (UUID_RE.test(v)) return hex32(v);
  return '';
}
let setupFlight = null;
export function setupId() {
  if (setupFlight) return setupFlight;
  setupFlight = (async () => {
    const r = await sget([K.setupId]);
    const cur = normalizeSetupId(r[K.setupId]);
    if (cur) {
      // 旧 uuid 一次性写回 32-hex；已是 32-hex 时这里不写，之后每次启动都读同一个值。
      if (r[K.setupId] !== cur) await sset({ [K.setupId]: cur });
      return cur;
    }
    // 没有值 / 值坏掉：生成一次并写回，之后一直读同一个键（不是每次启动都换）。
    const id = hex32(uuid());
    await sset({ [K.setupId]: id });
    return id;
  })().catch(() => LAUNCH_ID);
  return setupFlight;
}

// BEL-226：下载入口面 + 单元字段的客户端归一化。注册表同源（build/telemetry.config.js）。
const PACK_SURFACES = SURFACES.concat(['first_run_packs', 'settings_packs']);
const PACK_KINDS = ['asr', 'tts', 'lid', 'vad'];
const PACK_SOURCES = ['system', 'github', 'modelscope', 'other'];
const PACK_FAIL_REASONS = ['network', 'timeout', 'disk', 'hash', 'unsupported', 'other'];

function packSurface(surface) {
  const s = String(surface || '');
  // 旧 P0 客户端发功能面（listen / …）；枚举是并集，所以这里也接受，不把老的行变成非法。
  if (PACK_SURFACES.indexOf(s) >= 0) return s;
  return 'first_run_packs';
}
function packKindOf(id, kind) {
  if (PACK_KINDS.indexOf(kind) >= 0) return kind;
  const p = String(id || '');
  if (p.indexOf('tts') === 0) return 'tts';
  if (p.indexOf('asr') === 0) return 'asr';
  if (p.indexOf('lid') === 0) return 'lid';
  if (p.indexOf('vad') === 0) return 'vad';
  return 'asr';
}
// 'id' 型：小写字母 / 数字 / _ / -，≤32。共享包 tts:zh-en 在这里是 tts_zh_en ——
// 冒号过不了冻结扩展的 okValue，整条事件会被丢（setup_id 32-hex 同一条理由）。
function packIdValue(v, kind) {
  const s = String(v == null ? '' : v).toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 32);
  return s || (kind === 'tts' ? 'tts' : kind);
}
function sourceValue(source) {
  return PACK_SOURCES.indexOf(source) >= 0 ? source : 'other';
}
function packInfo(info) {
  // 兼容旧调用形状 packStart('listen')（1.23.3 只有 surface）。新调用传完整对象。
  const i = (typeof info === 'string') ? { surface: info } : (info || {});
  const kind = packKindOf(i.pack_id, i.pack_kind);
  return {
    pack_kind: kind,
    pack_id: packIdValue(i.pack_id, kind),
    locale: idValue(i.locale),
    surface: packSurface(i.surface),
    source: sourceValue(i.source),
  };
}
function packFields(info, setup, downloadId, attempt) {
  const p = {
    setup_id: setup,
    surface: info.surface,
    pack_kind: info.pack_kind,
    pack_id: info.pack_id,
    download_id: downloadId,
    launch_id: LAUNCH_ID,
    source: info.source,
    attempt: attempt,
  };
  if (info.locale) p.locale = info.locale;
  return p;
}

// attempt：同一 setup 内按 pack_id 递增，落盘 ⇒ 跨启动继续（上次断在第 2 次，这次是 3）。
let attemptCache = null;
let attemptChain = Promise.resolve();
async function attemptCacheOnce() {
  if (attemptCache) return attemptCache;
  const r = await sget([K.packAttempts]);
  const v = r[K.packAttempts];
  const sid = normalizeSetupId(v && v.setup_id);
  attemptCache = (sid && v && v.counts && typeof v.counts === 'object')
    ? { setup_id: sid, counts: Object.assign({}, v.counts) }
    : { setup_id: '', counts: {} };
  return attemptCache;
}
async function nextAttempt(setup, packId) {
  const run = attemptChain.then(async () => {
    const c = await attemptCacheOnce();
    if (c.setup_id !== setup) { c.setup_id = setup; c.counts = {}; }
    const n = (Number(c.counts[packId]) || 0) + 1;
    c.counts[packId] = n;
    await sset({ [K.packAttempts]: c });
    return n;
  });
  attemptChain = run.catch(() => {});
  return run;
}

// 本次 setup 内哪些 pack 是**新下的**（pack_download_ok 过）：packs_ready 的 ready_kind
// 靠它分 downloaded / preexisting / mixed。持久化 ⇒ 跨启动仍知道「上次下过这个包」。
let downloadedCache = null;
let downloadedChain = Promise.resolve();
async function downloadedCacheOnce() {
  if (downloadedCache) return downloadedCache;
  const r = await sget([K.packDownloaded]);
  const v = r[K.packDownloaded];
  const sid = normalizeSetupId(v && v.setup_id);
  downloadedCache = (sid && v && Array.isArray(v.ids))
    ? { setup_id: sid, ids: v.ids.map(String) }
    : { setup_id: '', ids: [] };
  return downloadedCache;
}
async function markDownloaded(setup, packId) {
  const run = downloadedChain.then(async () => {
    const c = await downloadedCacheOnce();
    if (c.setup_id !== setup) { c.setup_id = setup; c.ids = []; }
    if (c.ids.indexOf(packId) < 0) c.ids.push(packId);
    await sset({ [K.packDownloaded]: c });
  });
  downloadedChain = run.catch(() => {});
  return run;
}
async function downloadedIds(setup) {
  const c = await downloadedCacheOnce();
  return c.setup_id === setup ? c.ids.slice() : [];
}

/**
 * 一次下载尝试开始。返回的 token（含 download_id / attempt / setup_id）必须原样传给
 * packOk / packFail —— 同一个 download_id 串起三态。失败永远不抛给产品。
 */
export async function packStart(info) {
  try {
    const i = packInfo(info);
    const setup = await setupId();
    const download_id = hex32(uuid());
    const attempt = await nextAttempt(setup, i.pack_id);
    track('pack_download_start', packFields(i, setup, download_id, attempt));
    return Object.assign({}, i, { setup_id: setup, download_id, attempt });
  } catch (_) { return null; }
}

/** 安装 / 就绪校验通过后才调；进度 100% 不能代替（调用方在 await 下载之后才进来）。 */
export async function packOk(token) {
  try {
    const i = packInfo(token);
    const setup = (token && token.setup_id) || await setupId();
    const download_id = (token && token.download_id) || hex32(uuid());
    const attempt = (token && Number(token.attempt)) || 0;
    await markDownloaded(setup, i.pack_id);
    track('pack_download_ok', packFields(i, setup, download_id, attempt));
    return setup;
  } catch (_) { return ''; }
}

// 六值归一化。只看错误对象里的 reason/code/why 与异常名，**不**把原始报错或 URL 发出去。
export function packFailReason(err) {
  const e = (err && typeof err === 'object') ? err : { message: String(err || '') };
  if (e.mtSttTimeout) return 'timeout';
  const raw = [e.reason, e.code, e.why, e.name, e.message].filter(Boolean).join(' ').toLowerCase();
  if (/timeout|timed[ _-]?out|stt-timeout/.test(raw)) return 'timeout';
  if (/sha|hash|checksum|integrity|mismatch/.test(raw)) return 'hash';
  if (/disk|enospc|no[ _-]?space|storage[ _-]?full|quota/.test(raw)) return 'disk';
  if (/offline|network|http|dns|connect|socket|unreachable|not connected|econn|fetch/.test(raw)) return 'network';
  if (/unsupported|no[ _-]?bridge|not[ _-]?supported|not[ _-]?device|^locale$|^os$|\blocale\b/.test(raw)) return 'unsupported';
  // 缺资产（assets / download / load / failed）是下载没成，不是「系统不支持」。
  return 'other';
}
function failReasonValue(reason) {
  if (PACK_FAIL_REASONS.indexOf(reason) >= 0) return reason;
  if (typeof reason === 'string') {
    const r = reason.toLowerCase();
    if (PACK_FAIL_REASONS.indexOf(r) >= 0) return r;
    return packFailReason({ reason: r });
  }
  return packFailReason(reason);
}
function legacyCode(code, fallback) {
  // 只认「本来就是 id 型」的码（packFailCode 已经归一化过）。长文/路径/URL 不许被
  // 下划线化后混进事件 —— 判据是**原样**过 id 规则，不是洗一遍再看。
  const raw = String(code == null ? '' : code).trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(raw) ? raw : (fallback || 'download');
}

/**
 * 失败。token 来自 packStart；也接受旧调用 packFail(surface, reason, code)（会现造 token）。
 * `reason` 是本轮六值；`code` 是旧 P0 的 id 型码，过渡期同发。
 */
export async function packFail(token, reason, code) {
  try {
    const i = packInfo(token);
    const setup = (token && token.setup_id) || await setupId();
    const download_id = (token && token.download_id) || hex32(uuid());
    let attempt = (token && Number(token.attempt)) || 0;
    if (!attempt) {
      try { attempt = await nextAttempt(setup, i.pack_id); } catch (_) { attempt = 0; }
    }
    const r = failReasonValue(reason);
    const c = legacyCode(code, r);
    const p = packFields(i, setup, download_id, attempt);
    p.reason = r;
    p.code = c;
    track('pack_download_fail', p);
    return setup;
  } catch (_) { return ''; }
}

/**
 * ASR 语种系统不支持：**不是**下载成功，也不该假装经历了一次下载尝试。
 * 只记 fail{reason:'unsupported'}，不记 start / ok（票面「另记，不要标成下载成功」）。
 */
export async function packUnsupported(info) {
  try {
    const i = packInfo(info);
    const setup = await setupId();
    const download_id = hex32(uuid());
    const attempt = await nextAttempt(setup, i.pack_id);
    const p = packFields(i, setup, download_id, attempt);
    p.reason = 'unsupported';
    p.code = 'unsupported';
    track('pack_download_fail', p);
    return setup;
  } catch (_) { return ''; }
}

// ── packs_ready：整套所需资源都校验就绪时记一条 ─────────────────────────────
// selection_id = 所需 kind/id/locale 集合的稳定派生（32-hex）。集合一变就换新：同一台
// 机器上换语言、勾/去朗读包都会产生新的 selection，旧的「已齐」不能替新的作数。
function selectionId(items) {
  const key = (items || []).map((it) => String((it && it.id) || '')).filter(Boolean).sort().join(',');
  return hash32(key);
}
function hash32(s) {
  let out = '';
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (const seed of seeds) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 32);
}
function stateItems(state) {
  const raw = (state && Array.isArray(state.items)) ? state.items : [];
  const out = [];
  for (const it of raw) {
    const id = packIdValue(it && it.id, 'asr');
    if (!id || out.some((x) => x.id === id)) continue;
    out.push({ id: id, kind: (it && it.kind) || packKindOf(id, '') });
  }
  if (out.length) return out;
  // 旧调用形状（只有 base/asr/tts/all 计数）：仍能按 kind 派生一个 selection。
  for (const kind of ['base', 'asr', 'tts']) {
    if (Number(state && state[kind] && state[kind].required) > 0) out.push({ id: kind, kind: kind === 'base' ? 'vad' : kind });
  }
  return out;
}

// 一条流程的齐态缓存：按 setup_id + selection_id 记「这一套已经齐过」。
// 只在 false → true 的那一次发；true → false 只更新缓存（不发）；之后同 selection 再变齐
// 可再发。跨启动从存储读回，重复探不发（旧实现按 kind 存，这里改成按 selection）。
let packsCache = null;
let packsChain = Promise.resolve();
async function packsCacheOnce() {
  if (packsCache) return packsCache;
  const r = await sget([K.packsReady]);
  const v = r[K.packsReady];
  const sid = normalizeSetupId(v && v.setup_id);
  const sel = (v && typeof v.selection_id === 'string' && HEX32_RE.test(v.selection_id)) ? v.selection_id : '';
  packsCache = { setup_id: sid, selection_id: sel, ready: !!(v && v.ready) };
  return packsCache;
}
/** state = {items:[{id,kind,locale}], base/asr/tts/all:{required,ready}, surface}（kind 可缺）。 */
export async function packsReady(state) {
  const run = packsChain.then(() => packsReadyOne(state), () => packsReadyOne(state));
  packsChain = run.catch(() => {});
  return run;
}
async function packsReadyOne(state) {
  try {
    const setup = await setupId();
    const cache = await packsCacheOnce();
    const items = stateItems(state);
    if (!items.length) return true;
    const selection_id = selectionId(items);
    const num = (o, k) => Math.max(0, Number(o && o[k]) || 0);
    const allReq = num(state.all, 'required');
    const allReady = Math.min(allReq, num(state.all, 'ready'));
    const isReady = allReq > 0 && allReady >= allReq;
    const same = cache.setup_id === setup && cache.selection_id === selection_id;
    if (isReady && !(same && cache.ready)) {
      // ready_kind：这一套里哪些是本次 setup 内新下的 vs 之前已有。
      const ids = items.map((it) => it.id);
      const have = (await downloadedIds(setup)).filter((id) => ids.indexOf(id) >= 0);
      const ready_kind = have.length === 0 ? 'preexisting'
        : (have.length === ids.length ? 'downloaded' : 'mixed');
      const asrReq = num(state.asr, 'required');
      const asrReady = Math.min(asrReq, num(state.asr, 'ready'));
      const ttsReq = num(state.tts, 'required');
      const ttsReady = Math.min(ttsReq, num(state.tts, 'ready'));
      const baseReq = num(state.base, 'required');
      const baseReady = Math.min(baseReq, num(state.base, 'ready'));
      track('packs_ready', {
        setup_id: setup,
        selection_id: selection_id,
        launch_id: LAUNCH_ID,
        surface: packSurface(state.surface),
        ready_kind: ready_kind,
        asr_required: asrReq,
        asr_ready: asrReady,
        tts_required: ttsReq,
        tts_ready: ttsReady,
        base_ready: (baseReq > 0 && baseReady >= baseReq) ? 'true' : 'false',
        required_count: allReq,
        ready_count: allReady,
        // 旧 P0 字段照发（1.23.3 老客户端/旧看板）：整批 required / ready。
        required: allReq,
        ready: allReady,
      });
    }
    if (cache.setup_id !== setup || cache.selection_id !== selection_id || cache.ready !== isReady) {
      packsCache = { setup_id: setup, selection_id: selection_id, ready: isReady };
      await sset({ [K.packsReady]: packsCache });
    }
    return true;
  } catch (_) { return false; }
}

// 测试/调试出口（不进产物面）：不改变线上行为。
export const _KEYS = K;
export const _track = track;
export const _resetForTest = () => {
  appOpenFlight = null;
  setupFlight = null;
  packsCache = null;
  packsChain = Promise.resolve();
  attemptCache = null;
  attemptChain = Promise.resolve();
  downloadedCache = null;
  downloadedChain = Promise.resolve();
  surfaceFlight = null;
  currentSurface = '';
  launchPatched = false;
};
