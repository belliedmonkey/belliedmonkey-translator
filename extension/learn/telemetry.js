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
// 中国版与国际版走同一条 track（BEL-135）：build.js 给中国版发境内
// `MT_TELEMETRY.url`（api.belliedmonkey.com/.../bt-ingest），事件名与属性是同一张表。
// `auth_fail` 因此也外发，只是落在境内，不落东京。
// 只有这个 build **根本没有**遥测规格（spec() === null，例如 china.ready 仍为 false）
// 时，`auth_fail` 才留在本机（`mt:diag`，上限 20 条）。那不是「中国版不发」的承诺。
//
// 传输：事件先入 chrome.storage.local 的队列（上限 200，满了丢最旧），满 10 条、或
// 距上次 ≥ 60 s（Safari 内容页 10 s）、或扩展页打开时 flush 一次。请求体用
// text/plain —— 简单请求，不触发预检；边缘函数按 JSON 解析正文，
// 不看这个头。**http/https 内容脚本每页先探测一次后台**（BEL-304）：探测只用来
// **跳过**已知不可用的 SW；探测成功也不代表 SW 发得出去，所以本页第一批仍走 SW，
// SW 返回失败（含 15s 超时 / {ok:false}）就**立刻整页降级**并把这一批用直连重发
// 一次（复用同一个 batch id，服务端按 (install_id, batch_id, batch_seq) 去重）。
// 扩展页 / App 不探测，一直直连。SW 只放行本 build 的 ingest 端点；直连受页面 CSP
// 管，失败时事件留在队列等下一次 flush。端点**不带任何 key**（build.js 的铁律：
// anon key 不进内容脚本）。
var MTTelemetry = (() => {
  const K = { on: 'tm:on', id: 'tm:id', queue: 'tm:queue', day: 'tm:day', once: 'tm:once', last: 'tm:last', dropped: 'mtTelemetryDropped', directFail: 'mtTelemetryDirectFail' };
  const FLUSH_AT = 10, FLUSH_MS = 60 * 1000, FLUSH_MS_SAFARI = 10 * 1000, QUEUE_CAP = 200;
  // BEL-277：http/https 内容脚本不再直接 fetch（页面 CSP 的 connect-src 可以把它
  // 整个拦掉），改由 service worker 代发。扩展页 / App 仍走直连 —— 只有网页上下文
  // 的 fetch 会被页面 CSP 管。两个上限与 SW 侧同一组数字。
  // BEL-304：每页只探一次后台。iOS Safari 在设备锁屏后 SW 会永久不可用，此前
  // 内容脚本无条件走 telemetrySend，于是「真翻成功、事件 0 行」而没有任何报错。
  // 这里在**发第一批之前**问一次「后台在吗」，400ms 内答不上来就整页直连；答得上
  // 只代表消息通道通，SW 仍可能发不出去 —— 所以它只是「快速跳过」，不是判决。
  // 判决在 sendViaRuntime：失败即整页 direct + 本批直连重发（见 send()）。
  const PING_TIMEOUT_MS = 400;
  const SW_TIMEOUT_MS = 15000, BODY_MAX = 64 * 1024;
  const STR_MAX = 64;
  let flushTimer = null;

  function spec() {
    let sp = null;
    try { sp = (typeof window !== 'undefined' && window.MT_TELEMETRY) || null; } catch (_) { return null; }
    if (!sp) return null;
    // 门禁把端点指到本机桩、并注入 allowAutomation 之后，自动化里也要发 —— 那正是 smoke
    // 断言「translate_ok 真的到达」要看的东西（telemetry-design §8）。线上产物永远没有这个字段。
    if (sp.allowAutomation === true) return sp;
    // 自动化里的浏览器（门禁、语料、真机驱动）不算用户：headless / CDP 驱动的 Chrome 会把
    // navigator.webdriver 置真。不加这一条，每跑一次 test:app 就往表里写两行。
    try { if (typeof navigator !== 'undefined' && navigator.webdriver === true) return null; } catch (_) {}
    return sp;
  }
  // BEL-304 237：Safari 内容脚本的浏览器扩展 API 与存储桥兜底。
  //
  // 这是 `content/request-shape.js` 同一个 Safari 存储桥坑的兜底（那边的注释
  // `storageGet` 记录得更详细）：WebKit 的 `chrome.storage.local.get(..., cb)`
  // **回调可能根本不来** —— 不报错、不抛异常，promise 永远不 settle。内容脚本
  // 的遥测因此整条卡在 `enabled()` / 队列读写上，FAB 翻了、页面进入「翻译中…」，
  // 但 `translate_start` 一条也出不去。`request-shape.js` 用 3s 超时躲开了它；
  // 这里做同一件事，并且**不把超时当错误**：读不到就按内存值继续。
  //
  // 兜底的三条边界：
  //   ① `browser`（Safari / 标准 WebExtensions，Promise 风格）优先，`chrome`
  //      （回调风格）其次。同一个 get 只发一次请求，两种返回都接。
  //   ② 1.5s 内没有答案（回调不来 / promise 不 resolve / 同步抛）⇒ 用 MEM 里的
  //      内存值继续；MEM 也没有的键按「从来没写过」处理（`tm:on` 缺省 true）。
  //   ③ storage 正常时行为完全不变：持久化仍走 storage，MEM 只是同一份写入的
  //      镜像。桥一旦在**本页**超时，本页后续读写不再逐笔等 1.5s（storage 仍
  //      尽力写一次，但不等待），这样 10s flush 不会因为每笔超时被拖到 20s。
  //      `storageDead` 是模块级、每页一份 —— 下一页 / 刷新后重新试桥。
  const STORAGE_TIMEOUT_MS = 1500;

  function api() {
    // Safari 的内容脚本里通常只有 `browser`（Promise 风格）；Chrome 只有
    // `chrome`（回调风格）；某些 polyfill 两个都在。优先标准扩展 API。
    try { if (typeof browser !== 'undefined' && browser) return browser; } catch (_) {}
    try { if (typeof chrome !== 'undefined' && chrome) return chrome; } catch (_) {}
    return null;
  }
  // 按成员回落：`browser` 可能只被 polyfill 出一部分（例如只有 runtime），
  // 不能因为它存在就假装它有 storage / i18n。
  function part(name) {
    const a = api();
    try { if (a && a[name]) return a[name]; } catch (_) {}
    try { if (typeof chrome !== 'undefined' && chrome && chrome[name]) return chrome[name]; } catch (_) {}
    try { if (typeof browser !== 'undefined' && browser && browser[name]) return browser[name]; } catch (_) {}
    return null;
  }
  function storage() {
    const s = part('storage');
    try { return (s && s.local) || null; } catch (_) { return null; }
  }

  // 本页的内存镜像。键面与 K 一一对应：开关 / 安装 id / 队列 / 软锁 / 日心跳 /
  // 去重表 / 两个本机计数器。队列是对象数组，写入时整体替换（与 storage 的语义
  // 一致），不做原地修改，避免读到一半的数组被另一笔 track 改掉。
  const MEM = new Map();
  let storageDead = false;

  function keyList(keys) {
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys.slice();
    if (keys && typeof keys === 'object') return Object.keys(keys);
    return [];
  }
  function memGet(key) {
    if (MEM.has(key)) return MEM.get(key);
    // 缺省 = 开（设计 §2 第 4 条）。这也是 sget 超时时 `enabled()` 仍要看到的
    // 值；不能因为桥不回话就把用户当成「关掉了遥测」。
    if (key === K.on) return true;
    return undefined;
  }
  function memSnapshot(keys) {
    const out = {};
    for (const k of keys) {
      const v = memGet(k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  function noteStorageDead(reason) {
    if (storageDead) return;
    storageDead = true;
    try { console.warn('[mt] telemetry storage fallback (memory)', reason || 'unavailable'); } catch (_) {}
  }

  // 读：storage 正常 ⇒ 返回 storage 的值并写回 MEM；超时 / 抛 / 无 API ⇒ 返回
  // MEM 的值。两种路径都只发一次 get。回调式和 Promise 式同时接（谁先到算谁），
  // 同一个 promise 只 settle 一次。
  function sget(keys) {
    const list = keyList(keys);
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        const out = memSnapshot(list);
        if (r && typeof r === 'object') {
          for (const k of list) {
            if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
            if (r[k] === undefined) continue;
            out[k] = r[k];
            MEM.set(k, r[k]);
          }
        }
        resolve(out);
      };
      const fallback = (why) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (why) noteStorageDead(why);
        // 超时不是错误：按内存值继续。MEM 没有的键就不返回（调用方自己按缺省处理）。
        resolve(memSnapshot(list));
      };
      // 本页已经判定桥不响应：后续读直接用内存值，不再逐笔等 1.5s。
      if (storageDead) return fallback(null);
      const s = storage();
      if (!s || typeof s.get !== 'function') return fallback('storage_unavailable');
      // 先挂表再发起：get() 若同步抛，或回调永远不来，截止时间都已经在。
      timer = setTimeout(() => fallback('timeout'), STORAGE_TIMEOUT_MS);
      try {
        const ret = s.get(list, (r) => finish(r || {}));
        if (ret && typeof ret.then === 'function') {
          ret.then((r) => finish(r || {}),
            (e) => fallback(String((e && (e.message || e)) || 'rejected')));
        }
      } catch (e) {
        fallback(String((e && (e.message || e)) || 'throw'));
      }
    });
  }

  // 写：先写 MEM（同步、永远成功），再调 storage。storage 正常时等它的回调
  // 再 resolve；超时后本页转入内存模式。桥已死时仍然「调一次」storage（不等待），
  // 让恢复后的桥有机会把内存里的队列落盘。
  function sset(obj) {
    if (!obj || typeof obj !== 'object') return Promise.resolve();
    for (const k of Object.keys(obj)) MEM.set(k, obj[k]);
    const s = storage();
    if (!s || typeof s.set !== 'function') return Promise.resolve();
    if (storageDead) {
      try {
        const ret = s.set(obj, () => {});
        if (ret && typeof ret.then === 'function') ret.then(() => {}, () => {});
      } catch (_) {}
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const done = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => { noteStorageDead('set_timeout'); done(); }, STORAGE_TIMEOUT_MS);
      try {
        const ret = s.set(obj, done);
        if (ret && typeof ret.then === 'function') ret.then(done, done);
      } catch (_) { done(); }
    });
  }

  function sremove(keys) {
    const list = keyList(keys);
    for (const k of list) MEM.delete(k);
    const s = storage();
    if (!s || typeof s.remove !== 'function') return Promise.resolve();
    if (storageDead) {
      try {
        const ret = s.remove(list, () => {});
        if (ret && typeof ret.then === 'function') ret.then(() => {}, () => {});
      } catch (_) {}
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const done = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => { noteStorageDead('remove_timeout'); done(); }, STORAGE_TIMEOUT_MS);
      try {
        const ret = s.remove(list, done);
        if (ret && typeof ret.then === 'function') ret.then(done, done);
      } catch (_) { done(); }
    });
  }

  // UTF-8 字节数（不依赖 TextEncoder —— vm/旧宿主里不一定有）。队列上限与 SW 的
  // 64KB 体限用同一把尺子。
  function byteLen(str) {
    let n = 0;
    for (let i = 0; i < str.length; i += 1) {
      const c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; }
      else n += 3;
    }
    return n;
  }

  // 内容脚本 vs 扩展页 / App：只有 http(s) 页面里的 fetch 受页面 CSP 管。
  // `location.protocol` 是宿主事实，不是 UA 猜测。
  function inWebPage() {
    try { return typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:'); }
    catch (_) { return false; }
  }

  // BEL-304：本页传输探测。只问「SW 现在收不收得到消息」，不做任何网络 I/O。
  // 它只是**快速跳过**：探测失败（无 receiver / lastError / throw / 超时）⇒ 本页
  // 直接直连；探测成功只说明消息通道通，**不证明 SW 发得出去** ⇒ 本页第一批仍走
  // SW，失败后由 send() 整页降级。结果缓存在模块内：每页只探一次。
  // 两种 Safari 失败形态（sendMessage 立刻 lastError；回调根本不触发）都在这里
  // 收敛成同一个 false —— 不依赖某一种实现细节。
  let pageProbe = null;
  // 本页判决：null = 未定（第一批按 probe 决定）；'sw' = 走 SW；'direct' = 已降级，
  // 后续批次不再探测、不再发 telemetrySend。
  let pageTransport = null;
  function probeSw() {
    if (pageProbe) return pageProbe;
    pageProbe = new Promise((resolve) => {
      let done = false;
      const finish = (ok, reason) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!ok) {
          // 探针失败要留在本机计数器里（不是事件），并 warn；但不冒充「直连失败」——
          // 直连还没试过。这里只加计数，警告由下面这一条 ping failed 承担。
          bumpDirectFail();
          try { console.warn('[mt] telemetry ping failed', reason || 'unavailable'); } catch (_) {}
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false, 'timeout'), PING_TIMEOUT_MS);
      try {
        // BEL-304 237：Safari 内容脚本可能只暴露 `browser.runtime`，不暴露
        // `chrome.runtime`。探针也必须走同一套 api() 兜底，否则会把「没有
        // chrome」误判成「后台不在」，白白整页直连。
        const runtime = part('runtime');
        if (!runtime || typeof runtime.sendMessage !== 'function') return finish(false, 'no_runtime');
        const ret = runtime.sendMessage({ action: 'telemetryPing' }, (resp) => {
          let lastError = null;
          try { lastError = runtime.lastError; } catch (_) {}
          if (lastError) return finish(false, String((lastError && lastError.message) || lastError));
          finish(!!(resp && resp.ok), 'no_ok');
        });
        if (ret && typeof ret.then === 'function') {
          ret.then((resp) => finish(!!(resp && resp.ok), 'no_ok'),
            (e) => finish(false, String((e && e.message) || e || 'rejected')));
        }
      } catch (e) { finish(false, String((e && e.message) || e || 'throw')); }
    });
    return pageProbe;
  }

  // SW 不可用 / 非 2xx / 超时 ⇒ false，调用方把批次放回队列。回调式与 Promise 式
  // 两种 sendMessage 都接；两种都不到就由 SW_TIMEOUT_MS 兜底，绝不悬着。
  function sendViaRuntime(url, init) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); resolve(ok); };
      const timer = setTimeout(() => finish(false), SW_TIMEOUT_MS);
      try {
        const runtime = part('runtime');
        if (!runtime || typeof runtime.sendMessage !== 'function') return finish(false);
        const ret = runtime.sendMessage({ action: 'telemetrySend', url, init }, (resp) => {
          let lastError = null;
          try { lastError = runtime.lastError; } catch (_) {}
          if (lastError) return finish(false);
          finish(!!(resp && resp.ok));
        });
        if (ret && typeof ret.then === 'function') {
          ret.then((resp) => finish(!!(resp && resp.ok)), () => finish(false));
        }
      } catch (_) { finish(false); }
    });
  }

  // 本机直连失败计数（storage，不是事件）。探针失败与直连 fetch 失败都进这里；
  // SW 失败本身**不**进 —— 那只是「这个通道不行」，直连还没试。
  // 串行化读-改-写：探针失败与紧随其后的直连失败可能同拍发生，不串行会各读到
  // 旧值、两次都写成 1。
  let directFailChain = Promise.resolve();
  function bumpDirectFail() {
    const run = directFailChain.then(async () => {
      try {
        const r = await sget([K.directFail]);
        const prev = Number(r[K.directFail]) || 0;
        await sset({ [K.directFail]: prev + 1 });
      } catch (_) {}
    }, async () => {});
    directFailChain = run.catch(() => {});
    return run;
  }
  // BEL-304：直连失败是可观测的，但**不是丢弃**。队列仍由 flush 放回；
  // CSP 挡住直连时事件留在队列里等下个扩展页 / 下一页。
  async function noteDirectFail(reason) {
    await bumpDirectFail();
    try { console.warn('[mt] telemetry direct failed', reason); } catch (_) {}
  }
  async function sendDirect(url, init) {
    try {
      const r = await fetch(url, init);
      if (r && r.ok) return true;
      await noteDirectFail('http_' + String((r && r.status) || 0));
      return false;
    } catch (e) {
      await noteDirectFail(String((e && (e.name || e.message)) || e || 'fetch_failed'));
      return false;
    }
  }

  // 丢弃不是静默的：本机计数器（storage，不冒充事件）+ 控制台警告。
  async function noteDropped(n) {
    if (!n || n < 1) return;
    try {
      const r = await sget([K.dropped]);
      const prev = Number(r[K.dropped]) || 0;
      await sset({ [K.dropped]: prev + n });
    } catch (_) {}
    try { console.warn('[mt] telemetry dropped', n); } catch (_) {}
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
    try {
      const mh = window.webkit && window.webkit.messageHandlers;
      if (mh && (mh.controller || mh.mtQuick)) return 'app';
    } catch (_) {}
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
    try {
      const i18n = part('i18n');
      if (i18n && typeof i18n.getUILanguage === 'function') lang = i18n.getUILanguage() || '';
    } catch (_) {}
    if (!lang) { try { lang = navigator.language || ''; } catch (_) {} }
    const m = /^([a-z]{2,3})/i.exec(String(lang)); return m ? m[1].toLowerCase() : '';
  }
  function version() {
    try { if (window.MT_VERSION) return String(window.MT_VERSION); } catch (_) {}
    try {
      const runtime = part('runtime');
      if (!runtime || typeof runtime.getManifest !== 'function') return '';
      return runtime.getManifest().version || '';
    } catch (_) { return ''; }
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
    // 下面四种与 bt-ingest 的 okValue **逐字**一致（UUID / SEMVER / LANG 的正则照抄）。
    // iso 只做 Date.parse 形状校验：±7 天窗口是服务端的判断，不在客户端 replicate。
    if (rule === 'uuid') return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
    if (rule === 'semver') return typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
    if (rule === 'lang') return typeof v === 'string' && (v === '' || /^[a-z]{2,3}$/.test(v));
    if (rule === 'iso') return typeof v === 'string' && Number.isFinite(Date.parse(v));
    return false;
  }
  // 返回可入队的事件，或 null（只在这条事件根本不登记时）。
  //
  // BEL-294/BEL-298：表外 / 非法键**只丢该键，保留事件**。以前多一个未知键就把整条
  // 事件（连同已校验的 code / provider / op_id）一起扔掉；现在丢的是键，不是归因。
  // 被丢的键只记在本机 rech 环（事件名 + 键名，不记值）—— 值里可能是用户内容。
  function shape(name, props, now) {
    const sp = spec(); if (!sp || !sp.spec) return null;
    const ev = sp.spec.events || {};
    if (!Object.prototype.hasOwnProperty.call(ev, name)) return null;
    const out = {};
    const given = props || {};
    const dropped = [];
    for (const k of Object.keys(given)) {
      // BEL-294/BEL-298：status=0 不是「HTTP 0」，是「没有 status」。省略这个键，
      // 让缺席看得出来；不要写一个假的整数。
      if (name === 'translate_fail' && k === 'status' && given[k] === 0) continue;
      if (!Object.prototype.hasOwnProperty.call(ev[name], k)) { dropped.push(k); continue; }
      if (!okValue(ev[name][k], given[k])) { dropped.push(k); continue; }
      out[k] = given[k];
    }
    if (dropped.length) rejectNote(name, dropped);
    return { name, props: out, ts: ts(now) };
  }
  // BEL-294/BEL-298：被丢键的本机记录。只存事件名 + 键名，不存值。
  const REJ_KEY = 'mt:tm:rech', REJ_CAP = 20;
  function rejectNote(name, keys) {
    try {
      if (typeof localStorage === 'undefined') return;
      const prev = JSON.parse(localStorage.getItem(REJ_KEY) || '[]');
      const q = Array.isArray(prev) ? prev : [];
      q.push({ n: String(name).slice(0, 40), k: keys.slice(0, 6).map((x) => String(x).slice(0, 24)), ts: ts() });
      while (q.length > REJ_CAP) q.shift();
      localStorage.setItem(REJ_KEY, JSON.stringify(q));
    } catch (_) {}
  }

  // ── 状态 ────────────────────────────────────────────────────────────────────
  async function enabled() {
    if (!spec()) return false;
    const r = await sget([K.on]);
    return r[K.on] !== false;                 // 缺省 = 开（设计 §2 第 4 条）
  }
  // 单飞（#387）：同一页面里并发的几次调用共用**同一次**「读 → 没有就生成 → 写」。原来两次并发
  // 都读到「没有 id」、各生成一个、各自当成 fresh ⇒ init 记两条 installed，而队列在 flush 时才盖
  // 当时的 id，于是线上看到的是「同一个 id、同一分钟、重复 N 条」。只有 fresh 那一次返回 fresh:true。
  let idFlight = null;
  function installId() {
    if (idFlight) return idFlight.then((x) => ({ id: x.id, fresh: false }));
    const p = (async () => {
      const r = await sget([K.id]);
      if (r[K.id]) return { id: r[K.id], fresh: false };
      const id = uuid();
      await sset({ [K.id]: id });
      return { id, fresh: true };
    })();
    idFlight = p;
    p.catch(() => { if (idFlight === p) idFlight = null; });
    return p;
  }
  // 信封上的 flavor 跟构建走。写死 global 会把中国版的行记成国际版。
  function buildFlavor() {
    try {
      const f = (typeof window !== 'undefined' && window.MT_FLAVOR) || '';
      if (f === 'china' || f === 'global') return f;
    } catch (_) {}
    return 'global';
  }
  // BEL-294/BEL-295（BEL-303 携带同形 helper）：App 的构建号。来源是**原生**暴露的
  // caps（CFBundleVersion）：原生注入 window.MT_APP_CAPS，NativeAudio.caps() 合并它；
  // macOS 的 AppQuickHost 也回一份。拿不到 / 不是非负整数 ⇒ 返回 undefined，envelope
  // **整键省略** —— 不写 0 冒充「已归因」。扩展没有原生 caps，所以永远省略。
  // 这是 buildNo 的唯一实现：Sentry 的 dist 也调 MTTelemetry.buildNo()。
  function buildNo() {
    try {
      const pick = (c) => {
        if (!c || typeof c !== 'object') return undefined;
        const n = c.build;
        return Number.isInteger(n) && n >= 0 && n < 1e10 ? n : undefined;
      };
      try {
        if (typeof NativeAudio !== 'undefined' && NativeAudio && typeof NativeAudio.caps === 'function') {
          const n = pick(NativeAudio.caps()); if (n !== undefined) return n;
        }
      } catch (_) {}
      try {
        if (typeof AppQuickHost !== 'undefined' && AppQuickHost && typeof AppQuickHost.caps === 'function') {
          const n = pick(AppQuickHost.caps()); if (n !== undefined) return n;
        }
      } catch (_) {}
      try {
        const c = (typeof window !== 'undefined' && window.MT_APP_CAPS) || null;
        return pick(c);
      } catch (_) { return undefined; }
    } catch (_) { return undefined; }
  }
  // BEL-294/BEL-296：16-hex 操作 id。一次用户操作一个：translate_start 生成、
  // translate_ok / translate_fail 沿用；engine_test 每次测试一个。只在本模块内存里
  // 记「当前这次操作」，不进存储 —— 它是会话标识，不是安装/启动标识。
  const opIds = Object.create(null);
  function newOpId() {
    try {
      const b = new Uint8Array(8);
      crypto.getRandomValues(b);
      return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch (_) { return ''; }
  }
  // BEL-304：一批事件一个 16-hex 批次 id，放请求头 `x-mt-batch`（服务端按
  // (install_id, batch_id) 去重）。它记在队列项的内部字段 `_b` 上，**不进 body**：
  // envelope() 只挑白名单字段，BEL-294 的服务端会把未知顶层键丢掉。
  function newBatchId() {
    try {
      const b = new Uint8Array(8);
      crypto.getRandomValues(b);
      return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      let s = '';
      for (let i = 0; i < 16; i += 1) s += Math.floor(Math.random() * 16).toString(16);
      return s;
    }
  }
  function withOpId(name, props) {
    const p = Object.assign({}, props || {});
    const kind = typeof p.kind === 'string' ? p.kind : '';
    if (name === 'engine_test') {
      if (!p.op_id) p.op_id = newOpId();
      return p;
    }
    if (name === 'translate_start') {
      if (!p.op_id) p.op_id = newOpId();
      if (p.op_id) opIds[kind] = p.op_id;
      return p;
    }
    if (name === 'translate_ok' || name === 'translate_fail') {
      // 有 start 的 kind 沿用；没有 start 的路径（doc / quick / 无 start 的 subtitle）
      // 每次终态生成一个，不把两条不相干的操作串起来。
      if (!p.op_id) p.op_id = opIds[kind] || newOpId();
      return p;
    }
    return p;
  }
  function envelope(id, e) {
    // BEL-304：只挑白名单字段。队列项上的内部字段 `_b`（批次 id）绝不能漏进 body。
    const out = {
      install_id: id, ts: e.ts, v: version(), flavor: buildFlavor(), host: host(),
      device: device(), ui: ui(), name: e.name, props: e.props,
    };
    const b = buildNo(); if (b !== undefined) out.build = b;
    return out;
  }

  // ── 本机诊断（只有「这个 build 根本没有遥测规格」时才写）────────────────────
  // 中国版有境内 ingest 之后，auth_fail 走上面的 track，发到境内。这里只兜
  // spec() === null 的构建（没有 URL 可发）。判定**不是** enabled()：用户自己关掉
  // 遥测（有 spec、tm:on=false）不写 —— 那是他的选择，不该被本机副本绕过。
  // 本机环不是「中国版不发遥测」的出口。
  const DIAG_KEY = 'mt:diag', DIAG_CAP = 20;
  function diag(name, props, now) {
    try {
      if (typeof localStorage === 'undefined') return;
      const prev = JSON.parse(localStorage.getItem(DIAG_KEY) || '[]');
      const q = Array.isArray(prev) ? prev : [];
      q.push({ name: name, props: props || {}, ts: ts(now) });
      while (q.length > DIAG_CAP) q.shift();
      localStorage.setItem(DIAG_KEY, JSON.stringify(q));
    } catch (_) {}
  }

  // ── 入队 / 发送 ─────────────────────────────────────────────────────────────
  // 同一页面里的入队串行化：队列是「读-改-写」，两条 track 交错会互相覆盖（页面上
  // translate_fail 一段一条，401 那种一拍五条并发正好撞上）。跨标签页的交错仍在 ——
  // storage 没有原子操作，那部分由日聚合的 count(distinct install_id) 吸收。
  let trackChain = Promise.resolve();
  function track(name, props, now) {
    const run = trackChain.then(() => trackOne(name, props, now), () => trackOne(name, props, now));
    trackChain = run.catch(() => {});
    return run;
  }
  async function trackOne(name, props, now) {
    try {
      // 这个 build 没有遥测规格：不发，但把登录失败留在本机（见上）。
      // 只记 auth_fail —— 其余事件没有「查一个具体故障」的用途，留了只是噪声。
      // 中国版规格在时不进这里，auth_fail 与别的事件一样入队、发往境内。
      if (!spec()) {
        if (name === 'auth_fail') diag(name, props, now);
        return false;
      }
      if (!(await enabled())) return false;
      const e = shape(name, withOpId(name, props), now);
      if (!e) return false;
      // grant_exhausted（telemetry-design §3.4）：09-08 进注册表，到 09-19 全仓库**零发送点**，
      // 线上 0 行 —— 而它是「这笔钱该不该继续花」的唯一依据。挂在这里而不是某个调用方：
      // credit_exhausted 会从网页、字幕、文档、App 听译四条路上来，挂在任何一条上都会漏另外
      // 三条；而四条路都经过这一行。中继的 402 本身就是「用完了」的判定，不再加第二道。
      // once ⇒ 每装机一次（§3 表的定义）。不 await：它自己会排进 trackChain。
      if (name === 'translate_fail' && e.props && e.props.code === 'credit_exhausted') once('grant_exhausted', {}, now);
      const r = await sget([K.queue]);
      const q = Array.isArray(r[K.queue]) ? r[K.queue] : [];
      q.push(e);
      let dropped = 0;
      while (q.length > QUEUE_CAP) { q.shift(); dropped += 1; }
      await sset({ [K.queue]: q });
      if (dropped) await noteDropped(dropped);
      if (q.length >= FLUSH_AT) flush(); else schedule();
      return true;
    } catch (_) { return false; }
  }
  // 每个 install 只发一次的事件（capture_first / sync_on / installed）。
  // 串行（#387）：去重表也是「读-改-写」，并发的两次 once 会都读到「没发过」。单独一条链，
  // 不排进 trackChain —— once 里面要调 track，排进同一条链会自己等自己。
  let onceChain = Promise.resolve();
  function once(name, props, now) {
    const run = onceChain.then(() => onceOne(name, props, now), () => onceOne(name, props, now));
    onceChain = run.catch(() => {});
    return run;
  }
  async function onceOne(name, props, now) {
    try {
      if (!(await enabled())) return false;
      const r = await sget([K.once]);
      const seen = Array.isArray(r[K.once]) ? r[K.once] : [];
      if (seen.includes(name)) return false;
      seen.push(name);
      await sset({ [K.once]: seen });
      // 不 await：track 自己排进 trackChain；等它会把 onceChain 与 trackChain 串成一条，
      // 而 trackOne 里的 grant_exhausted 又会调 once —— 那就是自己等自己。
      track(name, props, now);
      return true;
    } catch (_) { return false; }
  }
  // Safari 内容页 10s、其余 60s。Safari 上 1–2 条事件的短页面等不到 10 条阈值，
  // 60s 又常常比页面寿命长，所以内容页用更短的 10s。
  function flushMs() {
    return inWebPage() && host() === 'safari' ? FLUSH_MS_SAFARI : FLUSH_MS;
  }
  function schedule() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, flushMs());
  }
  async function send(events, batchId) {
    const sp = spec(); if (!sp || !sp.url) return false;
    const body = JSON.stringify(events);
    if (byteLen(body) > BODY_MAX) return false;
    const headers = { 'content-type': 'text/plain' };
    const init = { method: 'POST', body, keepalive: true, headers };
    // `x-mt-batch` 只在 global 加：东京 v76 的 CORS/唯一索引已放行该头；CN 的
    // api.belliedmonkey.com 还没放行，带自定义头会先发 OPTIONS 预检、整批被挡。
    // 所以 china 一律保持 content-type:text/plain 简单请求（SW 代发也遵守同一条，
    // 便于按 flavor 解释线上行为）。批次 id 只走请求头，SW 转发原样带走。
    const batchable = !!(batchId && buildFlavor() === 'global');
    if (batchable) headers['x-mt-batch'] = batchId;
    // 扩展页 / App：不探测，一直直连。
    if (!inWebPage()) return sendDirect(sp.url, init);
    // 本页已降级：后续批次不再探测、不再发 telemetrySend。
    if (pageTransport !== 'direct') {
      if (!pageTransport) {
        const ok = await probeSw();
        pageTransport = ok ? 'sw' : 'direct';
      }
      if (pageTransport === 'sw') {
        const ok = await sendViaRuntime(sp.url, init);
        if (ok) return true;
        // 探头只证明消息到了后台；这里才是「后台发不发得出去」的判决。
        // 立刻整页降级，并把**这一批**用直连重发一次；同一个 batch id / header
        // （global）原样复用，服务端按 (install_id, batch_id, batch_seq) 去重。
        pageTransport = 'direct';
        try { console.warn('[mt] telemetry sw failed, page downgraded'); } catch (_) {}
      }
    }
    return sendDirect(sp.url, init);
  }
  // 单飞（#387 后半，2026-09-22）：app.js 与 review.js 各调一次 init({flushNow})，同一页面里两个
  // flush 并发，都在对方清队列之前读到同一批 ⇒ 整批 POST 两遍（表里成对、相隔 20–50ms）。
  // 下面那把 tm:last 软锁挡的是**两个页面**，挡不住同一页面里的两次调用。后来的调用等同一个结果。
  let flushFlight = null;
  function flush() {
    if (!flushFlight) flushFlight = flushOnce().finally(() => { flushFlight = null; });
    return flushFlight;
  }
  async function flushOnce() {
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
      // 一批 ≤50 条，且编码后 ≤64KB —— SW 的体限不是「发送后才发现」的失败。
      // 正常事件（单条 ≤1KB 白名单值上限）远到不了，这里守的是异常膨胀。
      const batch = [];
      const picked = [];
      let bytes = 2;                                   // "[]"
      for (const e of q.slice(0, 50)) {
        const row = envelope(id, e);
        const rowBytes = byteLen(JSON.stringify(row)) + (batch.length ? 1 : 0);
        if (batch.length && bytes + rowBytes > BODY_MAX) break;
        picked.push(e); batch.push(row); bytes += rowBytes;
      }
      // BEL-304：同一批被放回队列后重发必须复用同一个 batch id（服务端按
      // (install_id, batch_id, batch_seq) 去重）。队列只往尾部追加：失败批次回队时
      // 老事件仍在队首，所以沿用队首的 `_b`。之后新入队的事件排在后面，服务端看到
      // 的是同一个 batch id 下更大的 seq —— 旧行被去重、新行照常入库。
      let batchId = '';
      if (picked.length) {
        const prev = picked[0] && picked[0]._b;
        batchId = (typeof prev === 'string' && /^[0-9a-f]{16}$/.test(prev)) ? prev : newBatchId();
        for (const e of picked) { if (e && typeof e === 'object') e._b = batchId; }
      }
      const ok = await send(batch, batchId);
      if (!ok) {
        const r2 = await sget([K.queue]);
        const q2 = Array.isArray(r2[K.queue]) ? r2[K.queue] : [];
        const merged = q.concat(q2);
        const over = Math.max(0, merged.length - QUEUE_CAP);
        const keep = over ? merged.slice(over) : merged;
        // 溢出丢的是队首老事件：同一个 batch id 下的 seq 会整体前移，再复用 id 会
        // 让服务端把事件 A 当成事件 B 去重。让下一轮换新 id，宁可重复也不张冠李戴。
        if (over) for (const e of keep) { if (e && typeof e === 'object') delete e._b; }
        await sset({ [K.queue]: keep });
        if (over) await noteDropped(over);
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
    await sremove([K.id, K.queue, K.once, K.day, K.last, K.dropped, K.directFail]);
    await sset({ [K.on]: false });
    idFlight = null;                           // 下次打开要生成新 id，不能复用内存里的旧的
    initFlight = null;
    return false;
  }

  // ── 中继归因：install_id + 信封字段随自家 relay 请求走 header（BEL-224/267）──
  // 病：2026-11-14 的 v51 窗口里 grant_debited 0 条、106 条 grant_event_skipped
  // grant_debited no_install_id —— relay 的出账请求上没有 install_id，扣费成功也
  // 认不出是谁。relay 的 attributionOf() 已经认 header `x-mt-install-id`（也认
  // body / multipart），且按 UUID_RE 校验，所以客户端只需把同一个匿名 id 带上。
  //
  // BEL-267：只带 install_id 还不够。relay 的 emitGrantEvent() 从同一组头里取
  // v/host/surface/flavor/device/ui，缺了就落 0.0.0 / 空串 / 省略 surface。这里
  // 用**本文件已有的 helper**补齐，键名逐字对着 attributionOf()，不加新字段：
  //   x-mt-v ← version() · x-mt-host ← host() · x-mt-flavor ← buildFlavor()
  //   x-mt-device ← device() · x-mt-ui ← ui() · x-mt-surface ← 调用点已知的枚举值
  //
  // 三条边界：
  //   ① 只对自家中继发；vendor 请求一个字节都不加。
  //   ② 只看 enabled()：用户关掉遥测就不发（relay 记 skip，隐私优先）。
  //   ③ 任何异常都吞掉返回 {}：归因失败绝不能挡住翻译、朗读、转写、解析。
  // 放 header 而不是 URL / body：不进 Referer / 访问日志，且 body 形状不用为它改。
  //
  // BEL-279：中国版中继是 SCF 默认域名 + `/chat/completions`，URL 里没有
  // `/bt-relay`。判定因此按**主机**来：host 集合从生成注册表的 grant 条目派生
  // （RequestShape.grantHosts() 是同一份来源；测试 / 尚未加载它的宿主回退到
  // window.MT_PROVIDERS），这里不写死东京或境内主机。
  const RELAY_SURFACES = ['listen', 'live_caption', 'quick', 'doc', 'web_caption'];
  const GRANT_IDS = ['grant', 'grant_speech', 'grant_stt'];
  function hostOfUrl(u) {
    try { return new URL(String(u || '')).hostname.toLowerCase(); } catch (_) { return ''; }
  }
  function grantHosts() {
    try {
      if (typeof RequestShape !== 'undefined' && RequestShape && typeof RequestShape.grantHosts === 'function') {
        return RequestShape.grantHosts();
      }
    } catch (_) {}
    const hosts = [];
    try {
      const list = (typeof window !== 'undefined' && window.MT_PROVIDERS) || [];
      for (const e of list) {
        if (!e || GRANT_IDS.indexOf(String(e.id || '')) < 0) continue;
        const h = hostOfUrl(e.defaultEndpoint || '');
        if (h && hosts.indexOf(h) < 0) hosts.push(h);
      }
    } catch (_) {}
    return hosts;
  }
  async function relayHeaders(url, surface) {
    try {
      const raw = String(url || '');
      const relayHost = hostOfUrl(raw);
      if (!/\/bt-relay(?:\/|$)/i.test(raw) && (!relayHost || grantHosts().indexOf(relayHost) < 0)) return {};
      if (!(await enabled())) return {};
      const { id } = await installId();
      if (!id) return {};
      const out = {
        'x-mt-install-id': id,
        'x-mt-v': version(),
        'x-mt-host': host(),
        'x-mt-flavor': buildFlavor(),
        'x-mt-device': device(),
        'x-mt-ui': ui(),
      };
      // surface 只在**确实是 relay 枚举之一**时才带。空串 / 'page' / 拼错的值整个
      // 键省略，绝不发明：relay 的 grantEventProps() 对非法 surface 也是整键省略，
      // 两边同一规则；用量行则会原样记下客户端给的值，所以更不能送猜测。
      if (RELAY_SURFACES.indexOf(surface) >= 0) out['x-mt-surface'] = surface;
      return out;
    } catch (_) { return {}; }
  }

  // ── 初始化：installed（首次）+ heartbeat（每个自然日一次）+ 扩展页打开即 flush ──
  // 单飞（#387）：App 包里 app.js 与 review.js 各调一次 init，两次并发。同一页面只跑一次，
  // 后来的调用等第一次的结果；flushNow 各自照办（flush 自带 5 秒软锁）。
  let initFlight = null;
  function init(opts) {
    // BEL-304：内容脚本在 init 时启动本页唯一一次探测，但不阻塞 init（探测失败
    // 时 400ms 才回；installed/heartbeat 不该等它）。send() 会 await 同一个 Promise，
    // 所以即使 init 还没跑完，第一批也不会抢跑。
    if (spec() && inWebPage()) probeSw();
    if (!initFlight) initFlight = initOnce();
    return initFlight.then(() => { if (opts && opts.flushNow) flush(); });
  }
  async function initOnce() {
    try {
      if (!spec()) return;
      if (!(await enabled())) return;
      const { fresh } = await installId();
      if (fresh) await track('installed');
      const today = new Date().toISOString().slice(0, 10);
      const r = await sget([K.day]);
      if (r[K.day] !== today) { await sset({ [K.day]: today }); await track('heartbeat'); }
    } catch (_) {}
  }

  // 停留时长 → 桶（telemetry-design §3.9，2026-09-24）。注册表里 dwell 是枚举，
  // 所以这里**只能**吐出那四个值之一；算不出来（没记开始时间、时钟倒流）就吐 ''，
  // 调用方据此**整个不带这个键** —— 带一个空串会被 shape() 当成非法值剔掉
  // （BEL-294/BEL-298：丢的是键，事件仍保留）。
  function dwell(startMs, now) {
    const t0 = Number(startMs);
    if (!Number.isFinite(t0) || t0 <= 0) return '';
    const s = ((Number(now) || Date.now()) - t0) / 1000;
    if (!Number.isFinite(s) || s < 0) return '';
    if (s < 3) return '0-2';
    if (s < 10) return '3-9';
    if (s < 30) return '10-29';
    return '30+';
  }

  // BEL-303：crash 的 Sentry `dist` 用**同一份** buildNo（不写第二套）。
  // crash.js 不读 MT_*，由这里把函数注册进去；扩展 SW 不加载本文件，dist 省略。
  try {
    if (typeof MTCrash !== 'undefined' && MTCrash && typeof MTCrash.setBuildNo === 'function') {
      MTCrash.setBuildNo(buildNo);
    }
  } catch (_) {}

  return {
    track, once, flush, init, enabled, setEnabled, installId, relayHeaders, dwell, buildNo,
    // 测试与调试
    _shape: shape, _okValue: okValue, _envelope: envelope, host, device, KEYS: K, FLUSH_AT, QUEUE_CAP,
    SW_TIMEOUT_MS, BODY_MAX, REJ_KEY, PING_TIMEOUT_MS, FLUSH_MS, FLUSH_MS_SAFARI,
    STORAGE_TIMEOUT_MS,
    // 本机诊断（没有遥测规格时的 auth_fail）：只读出口，给测试与设备容器回读用。
    _diag: diag, DIAG_KEY: DIAG_KEY, DIAG_CAP: DIAG_CAP,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MTTelemetry;
