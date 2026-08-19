// translation-api.js — Unified, provider-agnostic translation transport.
// Runs in content script context. All fetch() calls are made here directly
// to avoid the Safari iOS service worker lifecycle bug.

var TranslationAPI = (() => {
  const memCache = new Map();
  const CACHE_TTL = 12 * 60 * 60 * 1000;
  const MAX_MEM_CACHE = 1000;
  const CACHE_KEY_PREFIX = 'tr:';

  const REQUEST_TIMEOUT_MS = 20000;
  const BASE_BACKOFF_MS = 500;
  const JITTER_MS = 400;
  const MAX_RETRIES = 3;

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

  // Same request from the background page, which no page's CSP can reach. A Response
  // cannot cross the message boundary, so the parts `apiFetch` actually reads are sent
  // and a minimal stand-in is rebuilt here — keeping ONE error shape for both paths.
  async function proxyFetch(url, opts) {
    const o = opts || {};
    const r = await chrome.runtime.sendMessage({
      action: 'proxyFetch', url,
      init: { method: o.method || 'GET', headers: o.headers, body: o.body },
    });
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

  // ─── 严格 CORS 的端点：直连打不通，走后台 (§5.5) ─────────────────────────
  //
  // 内容脚本的 fetch 是**以当前网页的身份**发出的：`Origin` 是 en.wikipedia.org，
  // 而不是扩展。带 Authorization + JSON body 的请求还是非简单请求，浏览器会先发一个
  // OPTIONS 预检。企业网关看到一个陌生第三方站点来源，预检回 403 —— 浏览器于是连
  // POST 都不发，`fetch` 抛裸 TypeError。2026-08-19 真机实证：Network 面板里成对的
  // `403 preflight` + `CORS error fetch`，请求头写着「Provisional headers are shown」
  // 与 `Referer: https://en.wikipedia.org/`。
  //
  // 扩展后台没有这个问题：带 `host_permissions` 的 service worker 发请求不受 CORS
  // 约束，也不发预检。`background.js` 的 proxyFetch 早就在了（为 Firefox 的 CSP 写的），
  // 这里只是让它在**直连失败后**也能被用上。
  //
  // 为什么是「失败后回退」而不是「一律走后台」：仓库根部说明里的硬规矩——Safari iOS 的
  // service worker 在设备锁屏后会永久 undefined，所以翻译**不能依赖**后台。回退只在
  // 直连已经失败时发生，后台若也不可用（正是 Safari 那种情况），我们报的还是原来那个
  // 错，行为与今天完全一致。
  //
  // 这也不是 #74 否决的那种「静默回退」：#74 是把失败的引擎悄悄换成 Google，产生一个
  // 貌似正确的答案并掩盖坏掉的 key。这里是**同一个请求、同一个端点**换一条 CORS 立场
  // 不同的通道；成功就是用户自己的引擎答的，没有任何东西被掩盖。
  const proxyOrigins = new Set();
  function originOf(url) {
    const m = /^https?:\/\/[^/?#]+/i.exec(String(url == null ? '' : url).trim());
    return m ? m[0].toLowerCase() : '';
  }

  async function directFetch(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  async function apiFetch(url, opts, label) {
    let resp;
    const origin = originOf(url);
    if (IS_FIREFOX || proxyOrigins.has(origin)) {
      // Firefox: 页面 CSP 会管住内容脚本的 fetch（§5.4），后台是唯一可靠的路。
      // proxyOrigins: 这个 origin 上一次已经被证明要走后台——CORS 拒绝是确定性的，
      // 记住它，否则整页每一段都要先白撞一次注定失败的预检（实测一页 283 个请求，
      // 其中几十对是这么浪费掉的）。
      try {
        resp = await proxyFetch(url, opts);
      } catch (e) {
        throw transportError(e, url);
      }
    } else {
      try {
        resp = await directFetch(url, opts);
      } catch (e) {
        const direct = transportError(e, url);
        // 只对 `network` 回退。`timeout` 说明请求确实出去了、只是没回来——再发一遍
        // 只会把等待时间翻倍。
        if (direct.code !== 'network') throw direct;
        try {
          resp = await proxyFetch(url, opts);
          proxyOrigins.add(origin);
        } catch (_) {
          // 两条路都不通 ⇒ 报**直连**那个错（它才是用户配置的那条路），并标记我们
          // 已经替他试过后台，免得建议里再让他去查跨域。
          direct.viaProxy = true;
          throw direct;
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
  function serverSays(bodyText) {
    const raw = String(bodyText == null ? '' : bodyText).trim();
    if (!raw) return '';
    let msg = '';
    try {
      const d = JSON.parse(raw);
      const err = d && d.error;
      msg = (err && typeof err === 'object' && err.message)
        || (typeof err === 'string' && err)
        || (d && d.message) || (d && d.detail) || '';
      if (msg && typeof msg !== 'string') msg = JSON.stringify(msg);
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
    }, o.label);
    const text = await resp.text();
    // A streaming answer is still just a body once it has all arrived. We never ask
    // for one, but the negotiation below may end up asking, and then the body is SSE.
    return o.extract(o.body && o.body.stream ? sseMerge(text) : JSON.parse(text)).trim();
  }

  // ─── 请求体协商 (§7.1) ────────────────────────────────────────────────────
  //
  // 「同一个地址、同一把 key，别的客户端能用，我们 400」的通用解释是：**地址和 key 都
  // 对，是我们请求体里多了点东西**。2026-08-18 的真机对照把这件事说得很干净——把同一个
  // 网关配到两个命令行客户端都能用，而它们在 chat/completions 这条路上恰好都不发我们
  // 发的那几个字段：
  //
  //   我们发                     两个命令行客户端                  新模型的态度
  //   ─────────────────────────  ────────────────────────────────  ──────────────────
  //   temperature: 0.3           不发                              只接受默认值 ⇒ 400
  //   max_tokens: 2000           走 Responses 的 max_output_tokens  改名了 ⇒ 400
  //     ↑ 或 Messages 的 max_tokens（那里它是合法的）
  //   messages[0].role='system'  走顶层 instructions / system      要求 developer ⇒ 400
  //   （不发 stream）            stream: true                      SSE 网关只收流式 ⇒ 400
  //
  // 四个嫌疑人，我们不知道是哪一个——**也不需要知道**。服务端在 400 的响应体里会把它
  // 不接受的字段名点出来，所以正确的做法不是维护一张「哪个模型不吃哪个参数」的名单
  // （那张表和厂商名单一样，注定过期），而是**照着服务端说的那句话把对应字段让掉，再试
  // 一次**。让掉的全是可选字段：temperature 和 max_tokens 只影响成本与风格，system 换成
  // developer 语义等价，stream 只改变同一份内容的到达方式。
  //
  // 边界：只在 400/422（服务端在挑请求体的毛病）时协商，401/404/429/5xx 一律照旧报错；
  // 每次协商必须真的改动了什么，否则立刻停；总共最多三次请求。这样它不可能变成一个把
  // 真实错误磨掉的重试循环。
  const NEGOTIABLE_STATUS = [400, 422];
  const MAX_RELAX = 2;

  function relaxBody(body, said) {
    const msg = String(said || '');
    if (!msg) return null;                    // 服务端没说话，就没有可照着让的东西
    const next = Object.assign({}, body);
    let changed = false;

    // 顺序重要：先认「改名」再认「不支持」，否则 'use max_completion_tokens instead'
    // 会被当成单纯的「不支持 max_tokens」而把预算整个丢掉。
    if ('max_tokens' in next && /max_completion_tokens/i.test(msg)) {
      next.max_completion_tokens = next.max_tokens; delete next.max_tokens; changed = true;
    } else if ('max_tokens' in next && /max_tokens/i.test(msg)) {
      delete next.max_tokens; changed = true;
    }
    if ('temperature' in next && /temperature/i.test(msg)) { delete next.temperature; changed = true; }

    // system → developer。新模型把这个角色改了名，含义没变。
    if (Array.isArray(next.messages) && /\bsystem\b|\bdeveloper\b/i.test(msg)) {
      const i = next.messages.findIndex((m) => m && m.role === 'system');
      if (i >= 0) {
        next.messages = next.messages.slice();
        next.messages[i] = Object.assign({}, next.messages[i], { role: 'developer' });
        changed = true;
      }
    }

    // 只收流式的网关。我们不需要边收边显示，所以「流式」对我们只是响应体换了个编码，
    // 整包收完再解析即可 —— 见 sseMerge。
    if (!next.stream && /\bstream/i.test(msg)) { next.stream = true; changed = true; }

    return changed ? next : null;
  }

  // 把一段 SSE 响应体合并回一个 Chat Completions 形状的对象，好让上层的 extract 不必
  // 知道流式这回事。只认 `data:` 行，`[DONE]` 忽略，坏帧跳过——半个 JSON 帧不该让
  // 整次翻译失败。
  function sseMerge(text) {
    let out = '';
    let last = null;
    for (const line of String(text || '').split(/\r?\n/)) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let d = null;
      try { d = JSON.parse(payload); } catch (_) { continue; }
      last = d;
      const ch = d && Array.isArray(d.choices) && d.choices[0];
      if (!ch) continue;
      const delta = ch.delta || {};
      if (typeof delta.content === 'string') out += delta.content;
      else if (ch.message && typeof ch.message.content === 'string') out += ch.message.content;
    }
    // 一帧都没解析出内容时把最后一帧原样交上去：它可能本来就是个非流式响应（网关忽略了
    // stream），让上层的 extract 去处理，而不是在这里把它变成空串。
    if (!out && last) return last;
    return { choices: [{ message: { content: out } }] };
  }

  // 发一次；被挑请求体的毛病就照着服务端的话让一步，最多让 MAX_RELAX 次。
  async function callChatNegotiating(o) {
    let body = o.body;
    for (let relaxed = 0; ; relaxed++) {
      try {
        return await callChatAPI(Object.assign({}, o, { body }));
      } catch (e) {
        const negotiable = e && e.code === 'http' && NEGOTIABLE_STATUS.includes(e.status)
          && relaxed < MAX_RELAX;
        const next = negotiable ? relaxBody(body, e.serverMessage) : null;
        if (!next) throw e;                   // 没得让了 —— 原样把服务端那句话报上去
        body = next;
      }
    }
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

  // Chat Completions request format (DeepSeek / GLM / Qwen / Kimi / custom / etc.).
  // The one shape that faces the whole compatibility zoo — every proxy, gateway and
  // self-hosted server speaks it, and they disagree about the optional fields. Hence
  // callChatNegotiating rather than callChatAPI: see 请求体协商 above.
  function translateChatCompat(text, targetLang, apiKey, cfg, model) {
    return callChatNegotiating({
      url: cfg.url,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: {
        model: model || cfg.defaultModel,
        messages: [
          { role: 'system', content: buildSystemPrompt(targetLang) },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 2000
      },
      label: cfg.label,
      extract: (d) => d.choices[0].message.content
    });
  }

  // Messages request format (custom / self-hosted). `anthropic-version` is a
  // required protocol header for ANY Messages-compatible endpoint — a technical
  // API-format requirement, not a vendor brand reference.
  function translateMessagesFormat(text, targetLang, apiKey, cfg, model) {
    return callChatAPI({
      url: cfg.url,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: {
        model: model || cfg.defaultModel,
        max_tokens: 2000,
        system: buildSystemPrompt(targetLang),
        messages: [{ role: 'user', content: text }]
      },
      label: cfg.label,
      extract: (d) => d.content[0].text
    });
  }

  // The Responses request format. Same host and the same Bearer auth as Chat
  // Completions — what differs is the shape, which is why the ENDPOINT has to be the
  // thing that selects it: one provider serves both from one origin, and before this
  // the user had no way to say which one they wanted.
  //
  // `instructions` rather than a system message inside `input`: it lines up 1:1 with
  // buildSystemPrompt() and with the Messages format's top-level `system`, and it
  // sidesteps the system-vs-developer role rename. `max_output_tokens`, not
  // `max_tokens` — a different name AND a different meaning, since reasoning tokens
  // are charged against it (notes.js:132 records what a too-small budget looks like:
  // an empty body that is indistinguishable from a broken endpoint).
  function translateResponsesFormat(text, targetLang, apiKey, cfg, model) {
    return callChatAPI({
      url: cfg.url,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: {
        model: model || cfg.defaultModel,
        instructions: buildSystemPrompt(targetLang),
        input: text,
        max_output_tokens: 2000,
        temperature: 0.3,
      },
      label: cfg.label,
      extract: extractResponses,
    });
  }

  // NEVER `output[0]`: a reasoning model puts a `{type:'reasoning'}` item first and the
  // answer after it, so index 0 is empty on exactly the models people reach for. Walk
  // for the message item instead. `output_text` is tried first because it is the flat
  // convenience field; it may not exist in the raw HTTP body, so the walk is the real
  // implementation and the fast path is the optimisation.
  function extractResponses(d) {
    if (d && typeof d.output_text === 'string' && d.output_text.trim()) return d.output_text;
    let out = '';
    const items = (d && Array.isArray(d.output)) ? d.output : [];
    for (const it of items) {
      if (!it || it.type !== 'message') continue;
      for (const c of (Array.isArray(it.content) ? it.content : [])) {
        if (c && (c.type === 'output_text' || typeof c.text === 'string')) out += (c.text || '');
      }
    }
    return out;
  }

  // The endpoint is used EXACTLY as stored — no path is appended, ever, under any
  // condition. See content/wire-format.js.
  function callProvider(provider, text, targetLang, apiKey, baseUrl, model) {
    const p = providerById(provider);
    if (!p || p.type === 'google') return translateGoogle(text, targetLang);
    const url = WireFormat.resolveEndpoint(baseUrl, p);
    if (!url) { const e = new Error(`${p.label || provider}: missing endpoint URL`); e.status = 0; e.code = 'no_base'; throw e; }
    const cfg = { url, defaultModel: p.defaultModel, label: p.label || provider };
    // Registry `type` is the default shape; the address refines it (domain-design §7).
    switch (WireFormat.formatFor(url, p.type)) {
      case 'messages-compat': return translateMessagesFormat(text, targetLang, apiKey, cfg, model);
      case 'responses-compat': return translateResponsesFormat(text, targetLang, apiKey, cfg, model);
      default: return translateChatCompat(text, targetLang, apiKey, cfg, model);
    }
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
  const MAX_CONCURRENT = 5;
  const queue = [];

  function enqueue(fn) {
    return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); drain(); });
  }
  function drain() {
    while (inFlight < MAX_CONCURRENT && queue.length > 0) {
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
          return await callProvider(provider, text, targetLang, apiKey, baseUrl, model);
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
          // 限流白白撞满。请求体协商（见上）会让这件事更糟：3 × 3 = 9。
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

  return { translate, translateBatch, serverSays, relaxBody, sseMerge, LANG_NAMES };
})();
