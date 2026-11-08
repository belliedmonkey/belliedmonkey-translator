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

const K = {
  lastSurface: 'tm:lastSurface',
  setupId: 'tm:setupId',
  packsReady: 'tm:packsReady',
  authSeen: 'tm:authSeen',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_RE = /^[a-z0-9_-]{1,32}$/;

// ── 一次启动的 id ─────────────────────────────────────────────────────────
// 模块求值一次 = 这次冷启生成一次；同一进程里的所有事件共用。不是安装 id，也不是账号。
const LAUNCH_ID = uuid();

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
    return !!(await t.enabled());
  } catch (_) { return false; }
}
// 所有新事件只从这个口出。MTTelemetry.track 自己的 trackOne() 会先过 enabled()，
// 所以关掉开关时既不入队也不发；flushOnce() 发送前还会再查一次（旧队列也不发）。
function track(name, props) {
  try {
    const t = telemetry();
    if (t && typeof t.track === 'function') t.track(name, props || {});
  } catch (_) { /* 埋点永远不能挡住产品 */ }
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
    const surface = currentSurfaceSync();
    track('auth_ok', { surface, provider, method });
    // 开关打开时才写第一方窄口；与上面的匿名事件同进同退。
    return reportAuthOk({ accessToken: src.accessToken, provider, method });
  })().catch(() => false);
}

// ── 门 / 领取失败 ──────────────────────────────────────────────────────────
export function liveGate(surface, ok) {
  const s = validSurface(surface) ? surface : currentSurfaceSync();
  // 注册表没有 bool 类型：钉成字符串枚举 'true' / 'false'，不要发 JSON 布尔。
  track('live_gate', { surface: s, ok: (ok === true || ok === 'true') ? 'true' : 'false' });
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
export function grantClaimFail(code) {
  track('grant_claim_fail', { surface: currentSurfaceSync(), code: grantClaimCode(code) });
}

// ── 语言包：setup_id / start / ok / fail / packs_ready ─────────────────────
// setup_id 与 install_id **分开存**（仿它的存法，不复用）：install_id 是安装级随机
// uuid，setup_id 是「把包配齐」这条流程的 id，跨启动保持不变，这样上次没下完、这次
// 接着下能串成一条。首次用到时生成，之后一直读同一个键。
let setupFlight = null;
export function setupId() {
  if (setupFlight) return setupFlight;
  setupFlight = (async () => {
    const r = await sget([K.setupId]);
    const cur = r[K.setupId];
    if (typeof cur === 'string' && UUID_RE.test(cur)) return cur;
    const id = uuid();
    await sset({ [K.setupId]: id });
    return id;
  })().catch(() => LAUNCH_ID);
  return setupFlight;
}

function packSurface(surface) { return validSurface(surface) ? surface : currentSurfaceSync(); }
export async function packStart(surface) {
  const setup = await setupId();
  track('pack_download_start', { setup_id: setup, surface: packSurface(surface) });
  return setup;
}
export async function packOk(surface) {
  const setup = await setupId();
  track('pack_download_ok', { setup_id: setup, surface: packSurface(surface) });
  return setup;
}
export async function packFail(surface, code) {
  const setup = await setupId();
  const c = String(code || '').toLowerCase();
  // 注册表是 'id' 型（小写字母/数字/_/-，≤32）。不塞系统长文或路径。
  const safe = ID_RE.test(c) ? c : 'download';
  track('pack_download_fail', { setup_id: setup, surface: packSurface(surface), code: safe });
  return setup;
}

// 一条流程的齐态缓存：先把上次落盘的「哪些 kind 已经齐过」读回来，再逐 kind 比较。
// 只在 false → true 的那一次发；true → false 只更新缓存（不发）；之后再变齐可以再发。
// 这样同一 setup 从「未齐」到「齐」只记一条，从「齐」变「不齐」再变「齐」可再记。
let packsCache = null;
let packsChain = Promise.resolve();
async function packsCacheOnce() {
  if (packsCache) return packsCache;
  const r = await sget([K.packsReady]);
  const v = r[K.packsReady];
  packsCache = (v && v.setup_id && v.kinds && typeof v.kinds === 'object')
    ? { setup_id: String(v.setup_id), kinds: Object.assign({}, v.kinds) }
    : { setup_id: '', kinds: {} };
  return packsCache;
}
/** state = { base:{required,ready}, asr:{...}, tts:{...}, all:{...} }（kind 可缺）。 */
export async function packsReady(state) {
  const run = packsChain.then(() => packsReadyOne(state), () => packsReadyOne(state));
  packsChain = run.catch(() => {});
  return run;
}
async function packsReadyOne(state) {
  try {
    const setup = await setupId();
    const cache = await packsCacheOnce();
    // 换了 setup_id（理论上只会发生在清数据后）⇒ 旧 cache 作废，重新按过渡记。
    const prev = cache.setup_id === setup ? cache.kinds : {};
    const next = Object.assign({}, prev);
    let changed = false;
    for (const kind of ['base', 'asr', 'tts', 'all']) {
      const s = state && state[kind];
      if (!s) continue;
      const required = Math.max(0, Number(s.required) || 0);
      const ready = Math.max(0, Math.min(required, Number(s.ready) || 0));
      // 没有这一类需求（required 0）不算一次「齐」的过渡，不发空计数。
      if (!required) continue;
      const isReady = ready >= required;
      if (isReady && prev[kind] !== true) {
        track('packs_ready', { setup_id: setup, ready_kind: kind, required, ready });
      }
      if (next[kind] !== isReady) { next[kind] = isReady; changed = true; }
    }
    packsCache = { setup_id: setup, kinds: next };
    if (changed || cache.setup_id !== setup) await sset({ [K.packsReady]: packsCache });
    return true;
  } catch (_) { return false; }
}

// 测试/调试出口（不进产物面）：不改变线上行为。
export const _KEYS = K;
export const _resetForTest = () => {
  appOpenFlight = null;
  setupFlight = null;
  packsCache = null;
  packsChain = Promise.resolve();
  surfaceFlight = null;
  currentSurface = '';
  launchPatched = false;
};
