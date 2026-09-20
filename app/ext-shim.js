// app/ext-shim.js — 系统翻译扩展（iOS）在 JavaScriptCore 里的垫片。
//
// 这是 `build/ext-bundle.js` 拼进 `ExtEngine.js` 的**第一个**模块：后面那些
// （engine-state / wire-format / request-shape / translation-api）在加载期就会读
// `chrome`，晚一行就 undefined。
//
// **为什么是同一份字节，而不是 Swift 重写一遍**（domain-design §2.6 规则 2）：
// 传输那一层不是「发个 HTTP 请求」那么简单 —— 四种 wire format、按 host + 模型前缀
// 查表决定发哪些可选字段、免费额度的中继、停机码的归类，每一处调参都要两份同时改。
// 写第二份的那天起，两份就开始漂，而漂开的症状是「Mac 上好好的，iPhone 上少一个字段」，
// 没有任何一行日志会说。尖刺 T1 量过：同一份 87 KB 的 JS 在 JavaScriptCore 里就绪
// 3–10 ms、常驻 +3 MB，扩展总占用约 18 MB，而这个扩展点的上限在 230 MB 量级。
//
// JSC 不是浏览器：没有 window、没有 document、没有 fetch、没有定时器。下面这几样是
// **逐文件 grep 出来的最小集**（尖刺在一个只有三个原生钩子的空上下文里验过）：
//
//   window / globalThis     那些模块都是 IIFE 往全局挂名字
//   chrome.storage.local    引擎配置与 key，由原生一次性注入（见 __mtSeed）
//   chrome.runtime.getURL   只被 Firefox 判别用到；返回 '' ⇒ 判为「不是 Firefox」
//   fetch                   转成原生 URLSession（__mtFetch）
//   AbortController         translation-api 的超时靠它
//   setTimeout/clearTimeout 同上
//
// **chrome.runtime.sendMessage 故意缺席。** translation-api 的「后台在吗」探针会去调它，
// 抛错就判定后台不可达 ⇒ 走直连。扩展进程里本来就没有 service worker，让探针如实失败
// 比假装有一个、再让每段干等 20 秒好（app/chrome-shim.js 是同一个形状）。
'use strict';

(function (g) {
  // ── window ────────────────────────────────────────────────────────────────
  // JSC 里全局对象没有 `window` 这个名字，而那些 IIFE 写的是 `window.X = ...`。
  if (typeof g.window === 'undefined') g.window = g;

  // ── 这个进程的自称 ─────────────────────────────────────────────────────────
  // 与 App 包的 `window.MT_HOST = 'app'` 同一条：谁在跑，代码要能问得出来。
  // 遥测据此整个不发（telemetry-design §3.5：扩展进程一行都不发）。
  g.MT_HOST = 'ext';

  // ── chrome.storage.local ──────────────────────────────────────────────────
  // 原生在建上下文时注入一个**快照**（引擎三元组、key、targetLang…），之后只读。
  // 扩展是一次性的短命进程：拿到文字、翻完、结束，没有「设置变了要跟着变」这回事。
  // 写入接受但只落在内存里 —— 真源在宿主 App，扩展改了也没人读（§9.9：镜像，不搬家）。
  const seed = (typeof g.__mtSeed === 'object' && g.__mtSeed) ? g.__mtSeed : {};
  const store = Object.assign({}, seed);
  const pick = (keys) => {
    if (keys == null) return Object.assign({}, store);
    const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
    const out = {};
    for (const k of list) {
      if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
      else if (keys && !Array.isArray(keys) && typeof keys === 'object') out[k] = keys[k];  // 默认值形式
    }
    return out;
  };
  // 回调式与 Promise 式都要支持：这几个模块两种写法都有。
  const dual = (fn) => function (arg, cb) {
    const v = fn(arg);
    if (typeof cb === 'function') { cb(v); return undefined; }
    return Promise.resolve(v);
  };
  g.chrome = g.chrome || {};
  g.chrome.storage = g.chrome.storage || {};
  g.chrome.storage.local = {
    get: dual(pick),
    set: dual((obj) => { Object.assign(store, obj || {}); return undefined; }),
    remove: dual((keys) => {
      for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
      return undefined;
    }),
  };
  // onChanged：有人挂监听不该抛，但永远不会触发（扩展是短命的，没有第二个写入者）。
  g.chrome.storage.onChanged = g.chrome.storage.onChanged || { addListener() {}, removeListener() {} };

  // ── chrome.runtime ────────────────────────────────────────────────────────
  // 只给 getURL。**不给 sendMessage** —— 见文件头：探针抛错即判后台不可达，走直连。
  g.chrome.runtime = g.chrome.runtime || { getURL: () => '' };

  // ── fetch → 原生 URLSession ────────────────────────────────────────────────
  // 原生提供 `__mtFetch(req) -> Promise<{status, headers, body}>`，body 是字符串。
  // 这里只做形状适配，不做任何重试 / 超时 —— 那些在 translation-api 里，两个宿主同一份。
  if (typeof g.fetch !== 'function') {
    g.fetch = function fetch(url, opts) {
      const o = opts || {};
      if (typeof g.__mtFetch !== 'function') {
        // 英文：这条错误只会进原生日志，永远不上屏（上屏的文案由原生按 code 查表）。
        return Promise.reject(new Error('ext-shim: native did not install __mtFetch'));
      }
      // AbortSignal：已经中止就立刻按 AbortError 拒绝（translation-api 靠它判超时）。
      if (o.signal && o.signal.aborted) {
        const e = new Error('Aborted'); e.name = 'AbortError';
        return Promise.reject(e);
      }
      const headers = {};
      if (o.headers) {
        if (typeof o.headers.forEach === 'function') o.headers.forEach((v, k) => { headers[k] = v; });
        else for (const k of Object.keys(o.headers)) headers[k] = o.headers[k];
      }
      const native = g.__mtFetch({
        url: String(url),
        method: o.method || 'GET',
        headers,
        body: typeof o.body === 'string' ? o.body : (o.body == null ? null : String(o.body)),
      });
      // 中止：原生那边不取消（一次翻译就是一次往返，不值得再加一条协议），
      // 但 Promise 这边要如实按 AbortError 落地，否则超时会变成「永远不落定」。
      const raced = o.signal ? new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) return; settled = true;
          const e = new Error('Aborted'); e.name = 'AbortError'; reject(e);
        };
        if (typeof o.signal.addEventListener === 'function') o.signal.addEventListener('abort', onAbort);
        else o.signal.onabort = onAbort;
        native.then((v) => { if (!settled) { settled = true; resolve(v); } },
          (e) => { if (!settled) { settled = true; reject(e); } });
      }) : native;
      return raced.then((r) => {
        const body = typeof r.body === 'string' ? r.body : '';
        const h = r.headers || {};
        const lower = {};
        for (const k of Object.keys(h)) lower[String(k).toLowerCase()] = h[k];
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          statusText: r.statusText || '',
          headers: { get: (k) => (Object.prototype.hasOwnProperty.call(lower, String(k).toLowerCase())
            ? lower[String(k).toLowerCase()] : null) },
          text: () => Promise.resolve(body),
          json: () => Promise.resolve(JSON.parse(body)),
        };
      });
    };
  }

  // ── 定时器 ─────────────────────────────────────────────────────────────────
  // JSC 自己没有。原生提供 `__mtTimer(ms) -> Promise`（在主队列上 asyncAfter）。
  // 只需要 setTimeout / clearTimeout：翻译那条路上没有 setInterval。
  if (typeof g.setTimeout !== 'function') {
    let nextId = 1;
    const live = new Map();
    g.setTimeout = function setTimeout(fn, ms) {
      const id = nextId; nextId += 1;
      live.set(id, true);
      const wait = typeof g.__mtTimer === 'function' ? g.__mtTimer(Number(ms) || 0) : Promise.resolve();
      wait.then(() => { if (live.delete(id)) { try { fn(); } catch (_) { /* 与浏览器同：不打断调用方 */ } } });
      return id;
    };
    g.clearTimeout = function clearTimeout(id) { live.delete(id); };
  }

  // ── AbortController ───────────────────────────────────────────────────────
  if (typeof g.AbortController !== 'function') {
    g.AbortController = function AbortController() {
      const listeners = [];
      const signal = {
        aborted: false,
        onabort: null,
        addEventListener: (t, fn) => { if (t === 'abort') listeners.push(fn); },
        removeEventListener: (t, fn) => {
          if (t !== 'abort') return;
          const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
        },
      };
      this.signal = signal;
      this.abort = function abort() {
        if (signal.aborted) return;
        signal.aborted = true;
        const fns = listeners.slice();
        if (typeof signal.onabort === 'function') fns.push(signal.onabort);
        for (const fn of fns) { try { fn(); } catch (_) { /* 同上 */ } }
      };
    };
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
