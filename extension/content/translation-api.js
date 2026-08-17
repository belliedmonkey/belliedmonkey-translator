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

  async function apiFetch(url, opts, label) {
    let resp;
    if (IS_FIREFOX) {
      // No fallback to the direct fetch when this fails. A fallback would succeed on
      // CSP-free pages and fail elsewhere — restoring exactly the site-dependent
      // unpredictability this removes (and #74 already ruled that a silent fallback
      // hiding a real failure is worse than a visible one).
      try {
        resp = await proxyFetch(url, opts);
      } catch (e) {
        throw transportError(e, url);
      }
    } else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        resp = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
      } catch (e) {
        throw transportError(e, url);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const e = new Error(`${label} ${resp.status}: ${(err.error && err.error.message) || resp.statusText}`);
      e.status = resp.status;
      // `code`/`url` are for the settings page's engine self-check: without a code it
      // fell through to the raw message, so a 404 never got the "the endpoint URL or
      // the model name is wrong" hint the learning engines already had.
      e.code = 'http';
      e.url = url;
      e.retryAfter = parseRetryAfter(resp.headers.get('retry-after'));
      throw e;
    }
    return resp;
  }

  async function callChatAPI(o) {
    const resp = await apiFetch(o.url, {
      method: 'POST', headers: o.headers, body: JSON.stringify(o.body)
    }, o.label);
    return o.extract(await resp.json()).trim();
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
  function translateChatCompat(text, targetLang, apiKey, cfg, model) {
    return callChatAPI({
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

  // The endpoint is used EXACTLY as stored — no path is appended, ever. See
  // content/wire-format.js for why, and for the legacy branch that keeps a device
  // whose one-time migration never ran working on the old semantics.
  function callProvider(provider, text, targetLang, apiKey, baseUrl, model, verbatim) {
    const p = providerById(provider);
    if (!p || p.type === 'google') return translateGoogle(text, targetLang);
    const url = WireFormat.resolveEndpoint(baseUrl, p, { cap: 'chat', verbatim });
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
  // `verbatim` is the per-field 「这个地址是按新语义存的」 stamp (settings key
  // `apiBaseUrlVerbatim`). Absent ⇒ falsy ⇒ wire-format.js falls back to the legacy
  // branch, i.e. a caller that has not been taught the flag keeps the OLD behaviour
  // rather than a broken one — which is the only safe default for a positional
  // parameter added to a signature four adapters already call.
  async function translate(text, targetLang, provider, apiKey, baseUrl, model, verbatim) {
    if (!text || text.trim().length < 2) return text;
    const key = `${provider}:${targetLang}:${text}`;

    const mem = cacheGet(key);
    if (mem) return mem;
    const stored = await cacheGetStorage(key);
    if (stored) { memCache.set(key, { v: stored, ts: Date.now() }); return stored; }

    const result = await enqueue(async () => {
      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          return await callProvider(provider, text, targetLang, apiKey, baseUrl, model, verbatim);
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
          const backoff = (err && err.retryAfter != null) ? err.retryAfter : Math.pow(2, retries) * BASE_BACKOFF_MS;
          await new Promise(r => setTimeout(r, backoff + Math.random() * JITTER_MS));
        }
      }
    });

    cacheSet(key, result);
    return result;
  }

  // ─── Batch translate ──────────────────────────────────────────────────
  async function translateBatch(texts, targetLang, provider, apiKey, baseUrl, model, verbatim) {
    if (!texts.length) return [];

    if (provider === 'google') {
      const CHUNK = 20;
      const results = [];
      for (let i = 0; i < texts.length; i += CHUNK) {
        const chunk = texts.slice(i, i + CHUNK);
        const cached = chunk.map(t => cacheGet(`google:${targetLang}:${t}`));
        const missingIdx = cached.map((v, idx) => v === null ? idx : -1).filter(idx => idx >= 0);
        if (missingIdx.length > 0) {
          try {
            const missing = missingIdx.map(idx => chunk[idx]);
            const translated = await translateGoogleBatch(missing, targetLang);
            missingIdx.forEach((idx, j) => { cacheSet(`google:${targetLang}:${chunk[idx]}`, translated[j]); cached[idx] = translated[j]; });
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

  return { translate, translateBatch, LANG_NAMES };
})();
