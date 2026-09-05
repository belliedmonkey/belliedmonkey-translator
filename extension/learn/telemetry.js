// learn/telemetry.js —— 匿名用量事件的客户端（docs/telemetry-design.md §3–§4）。
//
// 三条边界，全在这一个文件里守：
//   ① **白名单**：事件名、属性键、值类型都对着 build 期发下来的 window.MT_TELEMETRY.spec
//      （由 build/telemetry.config.js 生成 —— 与服务端读的是同一张表）。表外的东西
//      **不入队**，而不是「发过去让服务端拒」：拒了也没人看见。
//   ② **不采内容**：字符串 ≤ 64 字符且不含 http / @；没有 URL、没有原文、没有邮箱、
//      没有账号 id。install_id 是本机随机生成的 UUID，与 auth.users 永远不关联。
//   ③ **可关且关了即删**：tm:on=false 之后 track() 是空操作；关的那一刻发唯一一条
//      telemetry_off（服务端据此删掉这个 id 的全部行），本机 id 与队列一并清掉。
//
// 中国版：build.js 把 MT_TELEMETRY 发成 null，这个文件在那个 flavor 里从头到尾是空操作。
//
// 传输：事件先入 chrome.storage.local 的队列（上限 200，满了丢最旧），满 10 条、或
// 距上次 ≥ 60 s、或扩展页打开时 flush 一次。请求体用 text/plain —— 简单请求，不触发
// 预检；边缘函数按 JSON 解析正文，不看这个头。内容脚本里 fetch 走页面 origin，
// 端点返回 ACAO:*，且**不带任何 key**（build.js 的铁律：anon key 不进内容脚本）。
var MTTelemetry = (() => {
  const K = { on: 'tm:on', id: 'tm:id', queue: 'tm:queue', day: 'tm:day', once: 'tm:once', last: 'tm:last' };
  const FLUSH_AT = 10, FLUSH_MS = 60 * 1000, QUEUE_CAP = 200;
  const STR_MAX = 64;
  let flushTimer = null;

  function spec() {
    // 自动化里的浏览器（门禁、语料、真机驱动）不算用户：headless / CDP 驱动的 Chrome 会把
    // navigator.webdriver 置真。不加这一条，每跑一次 test:app 就往表里写两行。
    try { if (typeof navigator !== 'undefined' && navigator.webdriver === true) return null; } catch (_) {}
    try { return (typeof window !== 'undefined' && window.MT_TELEMETRY) || null; } catch (_) { return null; }
  }
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
  function sremove(keys) {
    return new Promise((resolve) => {
      const s = storage(); if (!s) return resolve();
      try { s.remove(keys, () => resolve()); } catch (_) { resolve(); }
    });
  }

  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // 宿主判定与 learn/feedback.js 同一套判据（原生桥 → Firefox 的 browser 对象 → UA）。
  // 不直接依赖 MTFeedback：内容脚本不加载它。
  function host() {
    try { if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.controller) return 'app'; } catch (_) {}
    try { if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo) return 'firefox'; } catch (_) {}
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/Firefox/i.test(ua)) return 'firefox';
    if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg\//i.test(ua)) return 'safari';
    return 'chrome';
  }
  function device() {
    const s = ((typeof navigator !== 'undefined' && navigator.userAgent) || '') + ' ' + ((typeof navigator !== 'undefined' && navigator.platform) || '');
    if (/iPad/i.test(s)) return 'iPad';
    if (/iPhone|iPod/i.test(s)) return 'iPhone';
    if (/Mac/i.test(s)) return 'Mac';
    if (/Android/i.test(s)) return 'Android';
    if (/Windows/i.test(s)) return 'Windows';
    if (/Linux/i.test(s)) return 'Linux';
    return '';
  }
  function ui() {
    let lang = '';
    try { lang = chrome.i18n.getUILanguage() || ''; } catch (_) {}
    if (!lang) { try { lang = navigator.language || ''; } catch (_) {} }
    const m = /^([a-z]{2,3})/i.exec(String(lang)); return m ? m[1].toLowerCase() : '';
  }
  function version() {
    try { if (window.MT_VERSION) return String(window.MT_VERSION); } catch (_) {}
    try { return chrome.runtime.getManifest().version || ''; } catch (_) { return ''; }
  }
  // 取整到分钟：精确时间是不采的东西之一。
  function ts(now) {
    const d = new Date(now || Date.now()); d.setSeconds(0, 0); return d.toISOString().replace('.000Z', 'Z');
  }

  // ── 白名单校验（与边缘函数同一套规则）─────────────────────────────────────
  function okValue(rule, v) {
    if (Array.isArray(rule)) return typeof v === 'string' && rule.includes(v);
    if (typeof v === 'string' && (v.length > STR_MAX || /http|@/i.test(v))) return false;
    if (rule === 'int') return Number.isInteger(v) && v >= 0 && v < 1e10;
    if (rule === 'id') return typeof v === 'string' && /^[a-z0-9_-]{1,32}$/.test(v);
    return false;
  }
  // 返回可入队的事件，或 null（原因写在 reason 上，测试用）。
  function shape(name, props, now) {
    const sp = spec(); if (!sp || !sp.spec) return null;
    const ev = sp.spec.events || {};
    if (!Object.prototype.hasOwnProperty.call(ev, name)) return null;
    const out = {};
    const given = props || {};
    for (const k of Object.keys(given)) {
      if (!Object.prototype.hasOwnProperty.call(ev[name], k)) return null;      // 表外的键：整条不要
      if (!okValue(ev[name][k], given[k])) return null;
    }
    for (const k of Object.keys(given)) out[k] = given[k];
    return { name, props: out, ts: ts(now) };
  }

  // ── 状态 ────────────────────────────────────────────────────────────────────
  async function enabled() {
    if (!spec()) return false;
    const r = await sget([K.on]);
    return r[K.on] !== false;                 // 缺省 = 开（设计 §2 第 4 条）
  }
  async function installId() {
    const r = await sget([K.id]);
    if (r[K.id]) return { id: r[K.id], fresh: false };
    const id = uuid();
    await sset({ [K.id]: id });
    return { id, fresh: true };
  }
  function envelope(id, e) {
    return {
      install_id: id, ts: e.ts, v: version(), flavor: 'global', host: host(),
      device: device(), ui: ui(), name: e.name, props: e.props,
    };
  }

  // ── 入队 / 发送 ─────────────────────────────────────────────────────────────
  async function track(name, props, now) {
    try {
      if (!(await enabled())) return false;
      const e = shape(name, props, now);
      if (!e) return false;
      const r = await sget([K.queue]);
      const q = Array.isArray(r[K.queue]) ? r[K.queue] : [];
      q.push(e);
      while (q.length > QUEUE_CAP) q.shift();
      await sset({ [K.queue]: q });
      if (q.length >= FLUSH_AT) flush(); else schedule();
      return true;
    } catch (_) { return false; }
  }
  // 每个 install 只发一次的事件（capture_first / sync_on / installed）。
  async function once(name, props, now) {
    try {
      if (!(await enabled())) return false;
      const r = await sget([K.once]);
      const seen = Array.isArray(r[K.once]) ? r[K.once] : [];
      if (seen.includes(name)) return false;
      seen.push(name);
      await sset({ [K.once]: seen });
      return track(name, props, now);
    } catch (_) { return false; }
  }
  function schedule() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_MS);
  }
  async function send(events) {
    const sp = spec(); if (!sp || !sp.url) return false;
    const body = JSON.stringify(events);
    try {
      const r = await fetch(sp.url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } });
      return !!(r && r.ok);
    } catch (_) { return false; }
  }
  async function flush() {
    try {
      if (!(await enabled())) return false;
      const r = await sget([K.queue, K.last]);
      const q = Array.isArray(r[K.queue]) ? r[K.queue] : [];
      if (!q.length) return false;
      // 两个页面同时 flush（弹窗 + 设置页各自 init）会把同一批发两遍 —— 09-05 实测表里
      // 成对重复。storage 没有原子操作，用 tm:last 当 5 秒的软锁：窗口从「读到写」缩到
      // 一次 get 的往返；剩下的重复由日聚合的 count(distinct install_id) 吸收。
      if (Number(r[K.last]) && Date.now() - Number(r[K.last]) < 5000) { schedule(); return false; }
      // 先清再发：发失败放回队尾。
      await sset({ [K.queue]: [], [K.last]: Date.now() });
      const { id } = await installId();
      const batch = q.slice(0, 50).map((e) => envelope(id, e));
      const ok = await send(batch);
      if (!ok) {
        const r2 = await sget([K.queue]);
        const q2 = Array.isArray(r2[K.queue]) ? r2[K.queue] : [];
        await sset({ [K.queue]: q.concat(q2).slice(-QUEUE_CAP) });
      }
      return ok;
    } catch (_) { return false; }
  }

  // ── 开关 ────────────────────────────────────────────────────────────────────
  async function setEnabled(on) {
    if (on) { await sset({ [K.on]: true }); return true; }
    // 关 = 删光：最后一条 telemetry_off 直接发（不入队），然后本机 id / 队列 / 去重表全清。
    const r = await sget([K.id]);
    if (r[K.id]) {
      await send([envelope(r[K.id], { name: 'telemetry_off', props: {}, ts: ts() })]);
    }
    await sremove([K.id, K.queue, K.once, K.day, K.last]);
    await sset({ [K.on]: false });
    return false;
  }

  // ── 初始化：installed（首次）+ heartbeat（每个自然日一次）+ 扩展页打开即 flush ──
  async function init(opts) {
    try {
      if (!spec()) return;
      if (!(await enabled())) return;
      const { fresh } = await installId();
      if (fresh) await track('installed');
      const today = new Date().toISOString().slice(0, 10);
      const r = await sget([K.day]);
      if (r[K.day] !== today) { await sset({ [K.day]: today }); await track('heartbeat'); }
      if (opts && opts.flushNow) flush();
    } catch (_) {}
  }

  return {
    track, once, flush, init, enabled, setEnabled, installId,
    // 测试与调试
    _shape: shape, _envelope: envelope, host, device, KEYS: K, FLUSH_AT, QUEUE_CAP,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MTTelemetry;
