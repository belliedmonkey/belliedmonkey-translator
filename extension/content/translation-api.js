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
3. Keep proper nouns, brand names, and code unchanged.
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

  async function apiFetch(url, opts, label) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const e = new Error(`${label} ${resp.status}: ${(err.error && err.error.message) || resp.statusText}`);
      e.status = resp.status;
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

  // OpenAI-compatible chat API (OpenAI, DeepSeek, GLM) — one code path.
  function translateOpenAICompat(text, targetLang, apiKey, baseUrl, cfg) {
    return callChatAPI({
      url: (baseUrl || cfg.defaultBase) + cfg.path,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: {
        model: cfg.model,
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

  function translateClaude(text, targetLang, apiKey, baseUrl) {
    return callChatAPI({
      url: (baseUrl || 'https://api.anthropic.com') + '/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: buildSystemPrompt(targetLang),
        messages: [{ role: 'user', content: text }]
      },
      label: 'Claude',
      extract: (d) => d.content[0].text
    });
  }

  const OPENAI_COMPAT = {
    openai:   { defaultBase: 'https://api.openai.com',   path: '/v1/chat/completions',          model: 'gpt-4o-mini',   label: 'OpenAI' },
    deepseek: { defaultBase: 'https://api.deepseek.com', path: '/v1/chat/completions',          model: 'deepseek-chat', label: 'DeepSeek' },
    glm:      { defaultBase: 'https://open.bigmodel.cn', path: '/api/paas/v4/chat/completions', model: 'glm-4-flash',   label: 'GLM' }
  };

  function callProvider(provider, text, targetLang, apiKey, baseUrl) {
    if (provider === 'claude') return translateClaude(text, targetLang, apiKey, baseUrl);
    if (OPENAI_COMPAT[provider]) return translateOpenAICompat(text, targetLang, apiKey, baseUrl, OPENAI_COMPAT[provider]);
    return translateGoogle(text, targetLang);
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

  async function cacheGetStorage(key) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([CACHE_KEY_PREFIX + key], (res) => {
          const entry = res[CACHE_KEY_PREFIX + key];
          if (entry && Date.now() - entry.ts < CACHE_TTL) resolve(entry.v);
          else resolve(null);
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
  async function translate(text, targetLang, provider, apiKey, baseUrl) {
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
          return await callProvider(provider, text, targetLang, apiKey, baseUrl);
        } catch (err) {
          retries++;
          if (retries >= MAX_RETRIES) {
            if (provider !== 'google') return await translateGoogle(text, targetLang);
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
  async function translateBatch(texts, targetLang, provider, apiKey, baseUrl) {
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

    return Promise.all(texts.map(t => translate(t, targetLang, provider, apiKey, baseUrl)));
  }

  return { translate, translateBatch, LANG_NAMES };
})();
