// translation-api.js — Unified translation API with multi-provider support
// Runs in content script context. All fetch() calls are made here directly
// to avoid the Safari iOS service worker lifecycle bug.

var TranslationAPI = (() => {
  const memCache = new Map();
  const CACHE_TTL = 12 * 60 * 60 * 1000;
  const MAX_MEM_CACHE = 1000;
  const CACHE_KEY_PREFIX = 'tr:';

  // ─── Language display names ───────────────────────────────────────────
  const LANG_NAMES = {
    'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'en': 'English',
    'ja': '日本語', 'ko': '한국어', 'fr': 'Français',
    'de': 'Deutsch', 'es': 'Español', 'ar': 'العربية',
    'pt': 'Português', 'ru': 'Русский', 'it': 'Italiano'
  };

  // ─── LLM system prompt ────────────────────────────────────────────────
  function buildSystemPrompt(targetLang) {
    const name = LANG_NAMES[targetLang] || targetLang;
    return `你是一位专业翻译。将用户提供的文本翻译成${name}。
规则：
1. 只输出译文，不添加任何解释、标注或额外内容
2. 保留原文的格式和换行
3. 专有名词、品牌名、代码保持原样
4. 译文要自然流畅，符合目标语言习惯`;
  }

  // ─── Provider adapters ────────────────────────────────────────────────

  async function translateGoogle(text, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Google Translate HTTP ${resp.status}`);
    const data = await resp.json();
    return data[0].map(c => c[0]).join('');
  }

  async function translateGoogleBatch(texts, targetLang) {
    const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: targetLang });
    texts.forEach(t => params.append('q', t));
    const resp = await fetch(`https://translate.googleapis.com/translate_a/t?${params}`);
    if (!resp.ok) throw new Error(`Google Translate batch HTTP ${resp.status}`);
    const data = await resp.json();
    return data.map(item => Array.isArray(item) ? item[0] : item);
  }

  async function translateOpenAI(text, targetLang, apiKey, baseUrl) {
    const url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: buildSystemPrompt(targetLang) },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`OpenAI ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    return data.choices[0].message.content.trim();
  }

  async function translateClaude(text, targetLang, apiKey, baseUrl) {
    const url = (baseUrl || 'https://api.anthropic.com') + '/v1/messages';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: buildSystemPrompt(targetLang),
        messages: [{ role: 'user', content: text }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Claude ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    return data.content[0].text.trim();
  }

  async function translateDeepSeek(text, targetLang, apiKey, baseUrl) {
    const url = (baseUrl || 'https://api.deepseek.com') + '/v1/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: buildSystemPrompt(targetLang) },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`DeepSeek ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    return data.choices[0].message.content.trim();
  }

  async function translateGLM(text, targetLang, apiKey, baseUrl) {
    const url = (baseUrl || 'https://open.bigmodel.cn') + '/api/paas/v4/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          { role: 'system', content: buildSystemPrompt(targetLang) },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`GLM ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    return data.choices[0].message.content.trim();
  }

  // ─── Cache helpers ────────────────────────────────────────────────────

  function cacheGet(key) {
    const m = memCache.get(key);
    if (m && Date.now() - m.ts < CACHE_TTL) return m.v;
    return null;
  }

  function cacheSet(key, value) {
    if (memCache.size >= MAX_MEM_CACHE) {
      memCache.delete(memCache.keys().next().value);
    }
    memCache.set(key, { v: value, ts: Date.now() });
    try {
      chrome.storage.local.set({ [CACHE_KEY_PREFIX + key]: { v: value, ts: Date.now() } });
    } catch (_) {}
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

  // ─── Rate limiting ────────────────────────────────────────────────────

  let inFlight = 0;
  const MAX_CONCURRENT = 3;
  const queue = [];

  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      drain();
    });
  }

  function drain() {
    while (inFlight < MAX_CONCURRENT && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      inFlight++;
      fn().then(resolve, reject).finally(() => { inFlight--; drain(); });
    }
  }

  // ─── Main translate function ───────────────────────────────────────────

  async function translate(text, targetLang, provider, apiKey, baseUrl) {
    if (!text || text.trim().length < 2) return text;
    const key = `${provider}:${targetLang}:${text}`;

    const mem = cacheGet(key);
    if (mem) return mem;

    const stored = await cacheGetStorage(key);
    if (stored) { memCache.set(key, { v: stored, ts: Date.now() }); return stored; }

    const result = await enqueue(async () => {
      let retries = 0;
      while (retries < 3) {
        try {
          let translated;
          switch (provider) {
            case 'openai':   translated = await translateOpenAI(text, targetLang, apiKey, baseUrl); break;
            case 'claude':   translated = await translateClaude(text, targetLang, apiKey, baseUrl); break;
            case 'deepseek': translated = await translateDeepSeek(text, targetLang, apiKey, baseUrl); break;
            case 'glm':      translated = await translateGLM(text, targetLang, apiKey, baseUrl); break;
            default:         translated = await translateGoogle(text, targetLang); break;
          }
          return translated;
        } catch (err) {
          retries++;
          if (retries >= 3) {
            // Final fallback: Google
            if (provider !== 'google') {
              return await translateGoogle(text, targetLang);
            }
            throw err;
          }
          await new Promise(r => setTimeout(r, Math.pow(2, retries) * 500));
        }
      }
    });

    cacheSet(key, result);
    return result;
  }

  // ─── Batch translate ───────────────────────────────────────────────────

  async function translateBatch(texts, targetLang, provider, apiKey, baseUrl) {
    if (!texts.length) return [];

    // For Google, use batch API for efficiency
    if (provider === 'google') {
      const CHUNK = 20;
      const results = [];
      for (let i = 0; i < texts.length; i += CHUNK) {
        const chunk = texts.slice(i, i + CHUNK);
        // Check cache first
        const cached = chunk.map(t => cacheGet(`google:${targetLang}:${t}`));
        const missingIdx = cached.map((v, i) => v === null ? i : -1).filter(i => i >= 0);

        if (missingIdx.length > 0) {
          try {
            const missing = missingIdx.map(i => chunk[i]);
            const translated = await translateGoogleBatch(missing, targetLang);
            missingIdx.forEach((idx, j) => {
              cacheSet(`google:${targetLang}:${chunk[idx]}`, translated[j]);
              cached[idx] = translated[j];
            });
          } catch (_) {
            // Fallback to individual
            for (const idx of missingIdx) {
              cached[idx] = await translate(chunk[idx], targetLang, 'google', '', '');
            }
          }
        }
        results.push(...cached);
      }
      return results;
    }

    // For LLM providers, translate in parallel with concurrency limit
    return Promise.all(texts.map(t => translate(t, targetLang, provider, apiKey, baseUrl)));
  }

  return { translate, translateBatch, LANG_NAMES };
})();
