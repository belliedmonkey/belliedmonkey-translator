// translation-api.js — Unified, provider-agnostic translation transport.
// Runs in content script context. All fetch() calls are made here directly
// to avoid the Safari iOS service worker lifecycle bug.

var TranslationAPI = (() => {
  const memCache = new Map();
  const CACHE_TTL = 12 * 60 * 60 * 1000;
  const MAX_MEM_CACHE = 1000;
  const CACHE_KEY_PREFIX = 'tr:';

  const BASE_BACKOFF_MS = 500;
  const JITTER_MS = 400;
  const MAX_RETRIES = 3;
  // 翻译的输出预算。解析那条是 3000（notes.js，那里有「给推理留头寸」的论证）——
  // 两个值各自待在自己的论证旁边，是这次归并里唯一不该归并的东西。
  const MAX_OUT_TRANSLATION = 2000;

  // ─── Language display names ───────────────────────────────────────────
  const LANG_NAMES = {
    'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'en': 'English',
    'ja': '日本語', 'ko': '한국어', 'fr': 'Français',
    'de': 'Deutsch', 'es': 'Español', 'ar': 'العربية',
    'pt': 'Português', 'ru': 'Русский', 'it': 'Italiano'
  };

  // ─── LLM system prompt (English — the lingua franca for LLM instructions,
  // works regardless of the target language). ───────────────────────────
  function buildSystemPrompt(targetLang) {
    const name = LANG_NAMES[targetLang] || targetLang;
    return `You are a professional translator. Translate the user's text into ${name}.
Rules:
1. Output ONLY the translation — no explanations, notes, or extra content.
2. Preserve the original formatting and line breaks.
3. Keep code, URLs, and well-known brand / product / company names unchanged, but
   DO translate ordinary words, place names, and loanwords (including katakana) —
   never leave foreign-script text untranslated.
4. Make the translation natural and fluent in the target language.`;
  }

  // ─── Shared transport: timeout + uniform error (status + Retry-After) ──
  function parseRetryAfter(h) {
    if (!h) return null;
    const n = Number(h);
    if (!isNaN(n)) return n * 1000;
    const t = Date.parse(h);
    return isNaN(t) ? null : Math.max(0, t - Date.now());
  }

  // ─── Firefox: the host page's CSP applies to us (domain-design §5.4) ────
  //
  // Firefox subjects a content script's `fetch` to the CSP of the page it is injected
  // into; Chrome and WebKit exempt it. Measured 2026-08-06 on one Mac, same page and
  // same key: the page's CSP allowlist happened to contain some providers' hosts and
  // not the one in use — Safari translated 26/26 paragraphs, Firefox failed every one;
  // on a CSP-free page the same Firefox was perfect. Left alone, whether translation
  // works depends on which site the reader is on, and nothing the user can change
  // fixes it. (Hosts are deliberately not named here: this file ships in every flavor,
  // and the China bundle may not carry brand references — see build.js's gate.)
  //
  // Detection is a FACT about the runtime, not a UA string (§5.3 rule 2): Firefox is
  // the only browser whose extension URLs are `moz-extension://`.
  const IS_FIREFOX = (() => {
    try { return chrome.runtime.getURL('').indexOf('moz-extension://') === 0; } catch (_) { return false; }
  })();

  // 「后台在吗」——一次探针，按页缓存 (§5.5)。
  //
  // 选路以前是按运行时猜的（Safari 一律直连优先，因为它的 worker 锁屏后会永久
  // undefined）。用户 2026-08-19 裁定统一走后台优先，不再为锁屏留特例。直接删掉那个
  // 分支会留一个坑：proxyFetch 的等待上限必须覆盖**整个往返**（后台替我们打完 API 才
  // 回话，20 秒量级），所以它没法用来判断「worker 是不是死了」——真死了的话每段都要
  // 干等 20 秒，比按运行时猜还糟。
  //
  // 探针把这件事变成可测量的：问一句 ping，纯本地 IPC，毫秒级，1.5 秒还没回就当不可达。
  // 于是不必再猜是哪个浏览器、也不必再假设锁屏会不会发生——**问一次就知道**。
  // 结果按页缓存；proxy 出现传输级失败时作废，下一次请求重新问，所以它能自愈，不会
  // 变成又一个被一次偶发失败钉死的记忆。
  const PROBE_TIMEOUT_MS = 1500;
  let proxyProbe = null;
  function probeProxy() {
    if (proxyProbe) return proxyProbe;
    proxyProbe = (async () => {
      let timer = null;
      try {
        const r = await Promise.race([
          chrome.runtime.sendMessage({ action: 'ping' }),
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS); }),
        ]);
        return !!(r && r.ok);
      } catch (_) {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    return proxyProbe;
  }

  // Same request from the background page, which no page's CSP can reach. A Response
  // cannot cross the message boundary, so the parts `apiFetch` actually reads are sent
  // and a minimal stand-in is rebuilt here — keeping ONE error shape for both paths.
  // The wait is bounded HERE, on the caller side, and that is not belt-and-braces:
  // `chrome.runtime.sendMessage` can simply never settle. On Safari iOS the worker is
  // permanently `undefined` after device lock and the call "fails silently" — no
  // rejection, no answer. An unsettled promise is the worst possible outcome, because
  // it is the 「翻译中…」-forever shape this file already carries one scar from (see
  // cacheGetStorage). The handler has its own timeout, but a dead worker never runs the
  // handler, so its timeout cannot help. Caught by layout fixture 12 (error-state-column)
  // when §5.5's fallback shipped without this: units stopped settling entirely.
  const proxyAnswerTimeoutMs = () => RequestShape.timeoutMs();
  async function proxyFetch(url, opts) {
    const o = opts || {};
    let timer = null;
    const r = await Promise.race([
      chrome.runtime.sendMessage({
        action: 'proxyFetch', url,
        init: { method: o.method || 'GET', headers: o.headers, body: o.body },
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('background did not answer in time')),
          proxyAnswerTimeoutMs());
      }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!r) throw new Error('background did not answer the proxied request');
    if (r.error) throw new Error(r.error);
    return {
      ok: !!r.ok, status: r.status, statusText: r.statusText || '',
      // The RAW header travels, not a parsed number: parseRetryAfter() below is the
      // single place that interprets it, so the two paths cannot disagree about units.
      headers: { get: (h) => (String(h).toLowerCase() === 'retry-after' ? (r.retryAfterHeader || null) : null) },
      json: async () => JSON.parse(r.text || 'null'),
      text: async () => r.text || '',
    };
  }

  // A transport failure that never reached a status code. WebKit rejects a
  // cross-origin response with no `Access-Control-Allow-Origin` BEFORE any status is
  // visible to us — `fetch` throws a bare TypeError ("Load failed"), indistinguishable
  // from "host unreachable" unless we name it. Measured 2026-08-13 on the iOS
  // simulator (learning-design §9.4): the server had received and processed the
  // request, and the page still saw only a TypeError. speech-input.js has named this
  // since #130; the other three transports did not, so every CORS/DNS failure here
  // surfaced as the raw string "Load failed". `url` rides along because the settings
  // page echoes it — the single most useful fact when an endpoint is misconfigured.
  function transportError(e, url) {
    const err = new Error(String((e && e.message) || e));
    err.code = (e && e.name === 'AbortError') ? 'timeout' : 'network';
    err.url = url;
    return err;
  }

  // ─── 一次请求，一条通路 (§5.5) ────────────────────────────────────────────
  //
  // 病因（2026-08-19 真机实测，企业网关）：内容脚本的 fetch 是**以当前网页的身份**发出
  // 的——`Origin` 是 en.wikipedia.org。带 Authorization + JSON body 属非简单请求，浏览器
  // 必须先发 OPTIONS 预检；网关看到陌生第三方来源回 403，于是 POST 根本没发出去，
  // `fetch` 抛裸 TypeError。DevTools 里的形状是成对的 `403 preflight` + `CORS error
  // fetch`，请求头写着「Provisional headers are shown」。
  //
  // 扩展后台没有这个问题：带 `host_permissions` 的 worker 发请求不受 CORS 约束，也不
  // 发预检。所以问题不是「能不能绕过去」，而是**先走哪条**。
  //
  // ── 为什么是「首选后台」而不是「直连失败再回退」 ──────────────────────────
  // 先直连再回退每段要付两趟往返：整页并发起跑时，第一批全都各撞一次注定失败的预检，
  // 用户直接感受到变慢。而且那个方案还需要记住「这个 origin 要走后台」，那份记忆就是
  // 第二个 bug 的来源——见下。首选后台则是**一次请求**，对宽松和严格的端点都一样快。
  //
  // ── 三条路线，判据是运行时事实而不是 UA (§5.3 rule 2) ────────────────────
  //   Firefox  → 只走后台，**不回退**。页面 CSP 会管住内容脚本的 fetch（§5.4），回退到
  //              直连会在无 CSP 的页面上成功、别处失败，重新引入站点相关的不确定性。
  //   Safari   → 直连优先，后台兜底。这是唯一 service worker 会在锁屏后永久 undefined
  //              的运行时，所以它必须保持「不依赖后台」，那条硬规矩一个字没动。
  //   其余     → 后台优先，直连兜底。一次请求，无预检。
  //
  // ── 只记住成功，永不记住失败 ─────────────────────────────────────────────
  // 上一版记过「这个 origin 两条路都不通」，结果被**一次偶发失败毒化**：MV3 的 worker
  // 在并发下偶尔来不及响应（正在唤醒或回收），那一次 sendMessage 失败就把整个 origin
  // 永久钉成 direct-only，之后每一段都跳过后台直接失败。症状正是「前面几段成功，后面
  // 全挂」。所以这份记忆只记**哪条路成功过**，永远不记「都不行」——失败是暂时的，
  // 成功才是关于这个端点的事实。
  const originRoute = new Map();   // origin → 'proxy' | 'direct'（只写成功过的那条）
  // 路由记忆按 origin 记（scheme + host），而参数表按 host 匹配 —— 两者取的都是
  // WireFormat.hostOf，免得「地址的哪一部分算数」在仓库里有两份实现。
  function originOf(url) {
    const h = WireFormat.hostOf(url);
    if (!h) return '';
    return (/^http:/i.test(String(url).trim()) ? 'http://' : 'https://') + h;
  }

  async function directFetch(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RequestShape.timeoutMs());
    try {
      return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  // `diag` 是可选的诊断出参（设置页的「测试连接」传它）。放在这里而不是改返回值：
  // 返回值是 Response，四个适配器都在解它；而「走了哪条路」只有这一层知道。
  async function apiFetch(url, opts, label, diag) {
    let resp;
    let usedRoute = null;
    const origin = originOf(url);
    // 已经成功过的那条优先；否则按运行时的默认顺序。
    const known = originRoute.get(origin);
    const proxyFirst = known ? known === 'proxy' : await probeProxy();

    if (IS_FIREFOX) {
      try { resp = await proxyFetch(url, opts); usedRoute = 'proxy'; if (diag) diag.route = 'proxy'; }
      catch (e) { const e2 = transportError(e, url); e2.route = 'proxy'; throw e2; }
    } else {
      const first = proxyFirst
        ? { run: () => proxyFetch(url, opts), tag: 'proxy' }
        : { run: () => directFetch(url, opts), tag: 'direct' };
      const second = proxyFirst
        ? { run: () => directFetch(url, opts), tag: 'direct' }
        : { run: () => proxyFetch(url, opts), tag: 'proxy' };
      try {
        resp = await first.run();
        originRoute.set(origin, first.tag);
        usedRoute = first.tag;
        if (diag) diag.route = first.tag;
      } catch (e) {
        const firstErr = transportError(e, url);
        // `timeout` 说明请求确实出去了，只是没回来——换条路再发一遍只会把等待翻倍。
        if (firstErr.code !== 'network') { firstErr.route = first.tag; throw firstErr; }
        if (first.tag === 'proxy') proxyProbe = null;   // 后台这次不灵，下次重新问
        try {
          resp = await second.run();
          originRoute.set(origin, second.tag);
          usedRoute = second.tag;
          if (diag) diag.route = second.tag;
        } catch (_) {
          if (second.tag === 'proxy') proxyProbe = null;
          // 两条都不通 ⇒ 报第一条的错，并标记我们已经替用户试过另一条，免得提示里
          // 再让他去查跨域——后台那条本来就不受跨域约束。**不写入 originRoute**：
          // 失败是暂时的，写进去就会毒化后面所有请求。
          firstErr.viaProxy = true;
          firstErr.route = first.tag;
          throw firstErr;
        }
      }
    }
    if (!resp.ok) {
      const said = serverSays(await resp.text().catch(() => ''));
      const e = new Error(`${label} ${resp.status}: ${said || resp.statusText}`);
      e.status = resp.status;
      // `code`/`url` are for the settings page's engine self-check: without a code it
      // fell through to the raw message, so a 404 never got the "the endpoint URL or
      // the model name is wrong" hint the learning engines already had.
      e.code = 'http';
      e.url = url;
      // The server's OWN sentence, kept separate from `message` so the UI can show it
      // verbatim next to our hint. Withholding it was a real cost: a gateway rejecting
      // `max_tokens` / `temperature` for a newer model answers 400 with a sentence
      // naming the exact parameter, and we replaced
      // that with 「服务端拒绝了这次请求」—— which sends the user hunting the URL and
      // the key, the two things that were already right (2026-08-18 真机).
      e.serverMessage = said;
      e.route = usedRoute;
      e.retryAfter = parseRetryAfter(resp.headers.get('retry-after'));
      throw e;
    }
    return resp;
  }

  // What the server said, out of a body we do not control the shape of. Four shapes
  // in the wild: `{error:{message}}`, `{error:"…"}`, `{message}`, `{detail}` — plus
  // gateways that answer HTML or plain text, which is why this takes TEXT, not JSON.
  // A non-JSON body used to be dropped entirely (`resp.json().catch(() => ({}))`),
  // and a reverse proxy's "upstream connect error" is exactly the sentence you need.
  const SERVER_MSG_MAX = 300;
  // 网关会**层层转发**上游的错误，每一层都把下一层整个塞进自己的 `message` 字符串里。
  // 2026-08-20 真机拿到的那条是三层：外层 `{object,error:{message,code}}`，里面是
  // 一段 JSON 文本，再里面又是一段。不拆的话「服务端原话」就是一坨转义反斜杠，而且
  // ——当初更要命的是——**拿去做字段匹配的也是那坨**：真正的字段名 `temperature` 排在
  // 第 100 个字符，网关的 trace_id 再长一点就会被 300 字符上限截掉，于是那套试探性协商
  // 既不报错也不触发。#159 把协商整个换成了查表，那个赌局不复存在；剥壳留下来是因为
  // 用户仍然要读这句话 —— 现在它是「服务端说了什么」的唯一出口，而不是自动重试的燃料。
  const UNWRAP_MAX = 4;
  function pickMessage(d) {
    const err = d && d.error;
    let m = (err && typeof err === 'object' && err.message)
      || (typeof err === 'string' && err)
      || (d && d.message) || (d && d.detail) || '';
    if (m && typeof m !== 'string') m = JSON.stringify(m);
    return m || '';
  }
  function serverSays(bodyText) {
    const raw = String(bodyText == null ? '' : bodyText).trim();
    if (!raw) return '';
    let msg = '';
    try {
      let d = JSON.parse(raw);
      msg = pickMessage(d);
      // 剥壳：只要取出来的还是一段 JSON，就再取一层。上限 4 层,免得畸形输入把这里
      // 变成一个循环。
      for (let i = 0; i < UNWRAP_MAX; i++) {
        const t = String(msg).trim();
        if (!(t.startsWith('{') || t.startsWith('['))) break;
        let inner;
        try { inner = JSON.parse(t); } catch (_) { break; }
        const deeper = pickMessage(inner);
        if (!deeper) break;
        msg = deeper;
      }
    } catch (_) {
      // Not JSON. Strip tags so an HTML error page collapses to its text, and let the
      // length cap below deal with whatever is left.
      msg = raw.replace(/<[^>]*>/g, ' ');
    }
    msg = String(msg || '').replace(/\s+/g, ' ').trim();
    return msg.length > SERVER_MSG_MAX ? msg.slice(0, SERVER_MSG_MAX) + '…' : msg;
  }

  async function callChatAPI(o) {
    const resp = await apiFetch(o.url, {
      method: 'POST', headers: o.headers, body: JSON.stringify(o.body)
    }, o.label, o.diag);
    // 正文按 text 读再 parse，而不是 resp.json()：apiFetch 的错误分支也这么读，两边
    // 保持一致，且畸形正文抛的是我们能定位的 SyntaxError 而不是 fetch 内部的。
    const parsed = JSON.parse(await resp.text());
    const out = String(o.extract(parsed) || '').trim();
    // HTTP 200 + 空正文 = 服务端没意见，是我们要的东西没拿到。其中有一种必须单独说：
    // 推理模型把整个输出预算烧在思考上，一个字都没吐。它长得像「网络不好，再试一次」，
    // 但重试**永远**同样失败（同样的输入、同样的预算、同样的思考）。实测 2026-08-20：
    // gpt-5-mini 对一段 870 字的正文烧掉全部 2000 预算、耗时 27.8 秒、正文 0 字。
    // 具名之后用户至少知道要去调哪个旋钮，而不是把「点此重试」点到天荒地老。
    if (!out && RequestShape.starvedByReasoning(parsed)) {
      // **这里不做 i18n。** 这个文件对 TranslationCore 零依赖，而它有一个不显然的理由：
      // `options.html` 加载 translation-api.js 却**不**加载 translation-core.js，所以在
      // 设置页调 TranslationCore.t 会抛 ReferenceError —— 一个本该说人话的错误，变成
      // 一句 "TranslationCore is not defined"。（这正是 1.6.1 发版前最后一次真端点
      // 复验抓到的，代价是我自己在 #160 里破坏了这条不变量。）
      //
      // 文案由显示层给：设置页有 engineTestReason() 那张 code→文案表（带 i18n），
      // 页面上的失败提示则是固定的 msg_translate_failed_retry，从不显示 message。
      // 所以这里只负责把**事实**带出去：code + 一句英文兜底。
      const e = new Error(`${o.label}: the model spent its entire output budget on reasoning`
        + ' and returned no translation');
      e.status = 0;
      e.code = 'reasoning_starved';
      e.retryable = false;
      throw e;
    }
    return out;
  }

  // ─── Provider adapters (all go through apiFetch → uniform error/timeout) ─
  async function translateGoogle(text, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await apiFetch(url, {}, 'Google');
    const data = await resp.json();
    return data[0].map(c => c[0]).join('');
  }

  async function translateGoogleBatch(texts, targetLang) {
    const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: targetLang });
    texts.forEach(t => params.append('q', t));
    const resp = await apiFetch(`https://translate.googleapis.com/translate_a/t?${params}`, {}, 'Google batch');
    const data = await resp.json();
    return data.map(item => Array.isArray(item) ? item[0] : item);
  }

  // Provider config comes from the build-time registry (window.MT_PROVIDERS,
  // generated per flavor from build/providers.config.js). Transport is keyed by
  // request FORMAT, not by vendor: 'chat-compat' = the Chat Completions request
  // shape; 'messages-compat' = the Messages request shape. Brand-free on purpose so
  // a China build carries no vendor brand strings (App Store Guideline 5).
  function providerById(id) {
    const list = (typeof window !== 'undefined' && window.MT_PROVIDERS) || [];
    return list.find((p) => p.id === id) || null;
  }

  // The endpoint is used EXACTLY as stored — no path is appended, ever, under any
  // condition. See content/wire-format.js.
  function callProvider(provider, text, targetLang, apiKey, baseUrl, model, diag) {
    const p = providerById(provider);
    if (!p || p.type === 'google') return translateGoogle(text, targetLang);
    const url = WireFormat.resolveEndpoint(baseUrl, p);
    if (diag) diag.url = url;
    if (!url) { const e = new Error(`${p.label || provider}: missing endpoint URL`); e.status = 0; e.code = 'no_base'; throw e; }
    // Registry `type` is the default shape; the address refines it (domain-design §7).
    // 三个 adapter 塌成一次调用：请求体长什么样由 request-shape.js 一处决定，
    // 翻译与解析两条链路从此共用同一份实现（原来是两份逐字重复的）。
    // 模型也参与形状判定：翻译专用模型（qwen-mt 家族）与普通对话模型共用同一个地址，
    // 地址区分不了它们（domain-design §7 第三条声明）。
    const mdl = model || p.defaultModel;
    const fmt = WireFormat.formatFor(url, p.type, mdl);
    const req = RequestShape.build(fmt, {
      url, apiKey, model: mdl,
      system: buildSystemPrompt(targetLang), user: text,
      // translate-compat 用它替代提示词里的目标语言；别的形状忽略它。
      targetLang,
      budget: MAX_OUT_TRANSLATION,
    });
    // 「这次按哪一行表发的、实际发了哪些字段」—— 设置页与 verify-provider 都要它。
    // 没有这两行的话，「我们发了什么」又只能靠读源码或抓包去猜。
    if (diag) { diag.paramRow = req.caps.id; diag.bodyKeys = Object.keys(req.body); }
    return callChatAPI({ diag, url, headers: req.headers, body: req.body,
      label: p.label || provider, extract: req.extract });
  }

  // ─── Cache helpers ────────────────────────────────────────────────────
  function cacheGet(key) {
    const m = memCache.get(key);
    if (m && Date.now() - m.ts < CACHE_TTL) return m.v;
    return null;
  }

  function cacheSet(key, value) {
    if (memCache.size >= MAX_MEM_CACHE) memCache.delete(memCache.keys().next().value);
    memCache.set(key, { v: value, ts: Date.now() });
    try { chrome.storage.local.set({ [CACHE_KEY_PREFIX + key]: { v: value, ts: Date.now() } }); } catch (_) {}
  }

  // The `try` must wrap the CALLBACK BODY, not just the call. That distinction was
  // worth a whole afternoon: on Safari iOS this callback arrives with `res`
  // undefined, `res[...]` threw inside the callback, and the surrounding try/catch —
  // which only covers the synchronous `get()` call — never saw it. So `resolve` was
  // never reached and THE PROMISE NEVER SETTLED. `translate()` awaits this before it
  // ever fetches, so the symptom was: no request, no timeout (AbortController never
  // got involved), no error, and every unit pinned at 「翻译中…」 forever. Removing
  // the Google fallback changed nothing, because the retry loop was never reached
  // either.
  //
  // Two rules this encodes, both cheap and both learned the expensive way:
  //   · a promise executor must settle on EVERY path, including a throwing callback;
  //   · never dereference what a browser API hands a callback — Safari passes
  //     undefined where Chrome passes {} (same root cause as options.js init).
  async function cacheGetStorage(key) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([CACHE_KEY_PREFIX + key], (res) => {
          try {
            const entry = (res || {})[CACHE_KEY_PREFIX + key];
            if (entry && Date.now() - entry.ts < CACHE_TTL) resolve(entry.v);
            else resolve(null);
          } catch (_) { resolve(null); }
        });
      } catch (_) { resolve(null); }
    });
  }

  // ─── Concurrency queue ────────────────────────────────────────────────
  let inFlight = 0;
  const queue = [];

  function enqueue(fn) {
    return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); drain(); });
  }
  function drain() {
    // 每轮重读：调高立刻生效。调低无法抢占已经在飞的请求 —— 那点写在设置页的 hint 里。
    while (inFlight < RequestShape.maxConcurrent() && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      inFlight++;
      fn().then(resolve, reject).finally(() => { inFlight--; drain(); });
    }
  }

  // ─── Public translate (uniform retry: backoff honors Retry-After + jitter;
  // final fallback to Google for non-google providers). Applies to ALL providers. ─
  // 可重试 = 网络/超时（瞬时），或服务端明说「稍后再来」（408/429/5xx）。
  // 没有 status 的错误一律当可重试：那是 transportError 那一类，本来就是瞬时的。
  function isRetryable(err) {
    // 显式否决优先于一切。「没有 status ⇒ 当作瞬时错误」这条兜底对 transportError 是对的，
    // 但对「推理吃光预算」是灾难：同样的输入、同样的预算、同样的思考，重试必然同样失败，
    // 而每一次都要再烧一次完整的推理时间（实测单次 27.8 秒）。用户等的是失败的三倍。
    if (err && err.retryable === false) return false;
    const s = err && err.status;
    if (!s) return true;
    if (s === 408 || s === 429) return true;
    return s >= 500;
  }

  // 缓存键必须包含**端点与模型**，不只是引擎 id。`custom_chat` 这个 id 下，地址和模型
  // 才是「哪个模型在回答」的全部信息——只按 id 记，把同一个 id 的两套配置当成同一个东西：
  // 用户把地址从 /chat/completions 改成 /v1/responses、或者换个模型，12 小时内拿到的
  // 仍然是旧配置的译文，而界面上没有任何迹象。2026-08-19 实测就是这样：换完地址点
  // 「测试连接」，1ms 返回「通了」，一个请求都没发出去。
  function cacheKey(provider, targetLang, baseUrl, model, text) {
    return `${provider}:${baseUrl || ''}:${model || ''}:${targetLang}:${text}`;
  }

  // opts.noCache —— 「测试连接」用。一个不发请求的连通性测试是**有害的**，不是省事：
  // 它会在端点其实是坏的时候报「通了」。所以自检读写都绕开缓存，宁可慢几秒。
  async function translate(text, targetLang, provider, apiKey, baseUrl, model, opts) {
    if (!text || text.trim().length < 2) return text;
    // 高级参数要在读缓存与入队之前就位 —— 并发上限也来自它。已读过则立即 resolve。
    await RequestShape.ready();
    const noCache = !!(opts && opts.noCache);
    const key = cacheKey(provider, targetLang, baseUrl, model, text);

    if (!noCache) {
      const mem = cacheGet(key);
      if (mem) return mem;
      const stored = await cacheGetStorage(key);
      if (stored) { memCache.set(key, { v: stored, ts: Date.now() }); return stored; }
    }

    const result = await enqueue(async () => {
      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          return await callProvider(provider, text, targetLang, apiKey, baseUrl, model, opts && opts.diag);
        } catch (err) {
          retries++;
          if (retries >= MAX_RETRIES) {
            // NO SILENT FALLBACK. This used to hand a failed provider off to the free
            // Google endpoint, and the cost of that was three separate things:
            //
            //  1. It made a broken key invisible. A wrong, expired or never-saved key
            //     produced a plausible translation, so the user was quietly moved onto
            //     the unstable path the onboarding note warns them away from — with no
            //     signal that their own engine was never used.
            //  2. It defeated verification-spec §0, which forbids verifying on the free
            //     Google endpoint precisely because it is not a stable baseline. The
            //     rule cannot hold if the product routes there by itself: a verifier
            //     configures DeepSeek, sees output, and is reading Google.
            //  3. It swallowed the real error. Found while chasing a Safari iOS hang
            //     that showed 「翻译中…」 forever — the fallback meant nothing anywhere
            //     ever reported what had actually failed.
            //
            // Failing loudly is also what domain-design §9.1 law 2 requires of a
            // surface the user turned on: the 'error' state renders 「翻译失败 —
            // 点击重试」 with a working retry. Google remains selectable AS an engine;
            // it is no longer a silent understudy for the one you picked.
            throw err;
          }
          // 重试只对**可能自己好起来**的失败有意义。这个循环原来对任何错误都退避重试
          // 三次，于是一个「key 不对」或「余额不足」会被整页每一段各请求三次——一页
          // 50 段就是 150 次注定失败的请求，把用户的报错延后了十几秒，也把服务端的
          // 限流白白撞满。
          // 4xx 里只有 408（超时）和 429（限流）值得再试，其余是我们发错了，重发一遍
          // 还是错。
          if (!isRetryable(err)) throw err;
          const backoff = (err && err.retryAfter != null) ? err.retryAfter : Math.pow(2, retries) * BASE_BACKOFF_MS;
          await new Promise(r => setTimeout(r, backoff + Math.random() * JITTER_MS));
        }
      }
    });

    if (!noCache) cacheSet(key, result);
    return result;
  }

  // ─── Batch translate ──────────────────────────────────────────────────
  async function translateBatch(texts, targetLang, provider, apiKey, baseUrl, model) {
    if (!texts.length) return [];

    if (provider === 'google') {
      const CHUNK = 20;
      const results = [];
      for (let i = 0; i < texts.length; i += CHUNK) {
        const chunk = texts.slice(i, i + CHUNK);
        // 必须走同一个 cacheKey()：这里曾经自己拼 `google:${lang}:${text}`，
        // 键格式一改，批量写进去的条目单条读永远命中不了，两边各刷各的。
        const cached = chunk.map(t => cacheGet(cacheKey('google', targetLang, '', '', t)));
        const missingIdx = cached.map((v, idx) => v === null ? idx : -1).filter(idx => idx >= 0);
        if (missingIdx.length > 0) {
          try {
            const missing = missingIdx.map(idx => chunk[idx]);
            const translated = await translateGoogleBatch(missing, targetLang);
            missingIdx.forEach((idx, j) => { cacheSet(cacheKey('google', targetLang, '', '', chunk[idx]), translated[j]); cached[idx] = translated[j]; });
          } catch (_) {
            for (const idx of missingIdx) cached[idx] = await translate(chunk[idx], targetLang, 'google', '', '');
          }
        }
        results.push(...cached);
      }
      return results;
    }

    return Promise.all(texts.map(t => translate(t, targetLang, provider, apiKey, baseUrl, model)));
  }

  return { translate, translateBatch, serverSays, LANG_NAMES };
})();
