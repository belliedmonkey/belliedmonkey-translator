// learn/notes.js — 句子解析 (§9.2): 生词 / 短语搭配 / 一个语法点.
// See docs/learning-design.md §9.2 and interaction-spec 「解析」.
//
// Uses the user's OWN chat-capable engine, read from the same provider registry the
// translator uses (window.MT_PROVIDERS — the single source, per CLAUDE.md; nothing
// vendor-specific is restated here, only the two wire formats). The free Google
// channel is a translation API and cannot do this, so capability is a hard gate:
// no chat engine configured ⇒ `capable()` is false ⇒ the UI renders no entry point.
//
// One generation per card, ever — the caller caches through LearnStore's `notes`
// store, and `get()` is cache-first. Cost is a real per-call charge on the user's
// key; predictability is part of the feature.
//
// EXTENSION PAGES ONLY (and the app's WKWebView, where no provider is configured and
// the gate simply stays closed).

var LearnNotes = (() => {
  let cfg = { provider: '', apiKey: '', baseUrl: '', model: '' };

  function configure(c) { cfg = Object.assign({}, cfg, c || {}); }

  function providerInfo() {
    const list = (typeof window !== 'undefined' && window.MT_PROVIDERS) || [];
    return list.find((p) => p.id === cfg.provider) || null;
  }

  // Chat-capable AND keyed. `google` is excluded by type, not by name — the registry
  // stays the single place that knows what each engine is.
  function capable() {
    const p = providerInfo();
    return !!(p && (p.type === 'chat-compat' || p.type === 'messages-compat') && cfg.apiKey);
  }

  // English system prompt (the project convention); the EXPLANATIONS come back in
  // the user's UI language. JSON-only output so the parser has a fighting chance.
  function buildPrompt(explainLang) {
    return 'You are a language-learning assistant. Given a sentence and its '
      + 'translation, produce concise study notes. Write all glosses and '
      + 'explanations in ' + (explainLang || 'zh-CN') + '. Respond with ONLY a JSON '
      + 'object, no markdown, in exactly this shape: '
      + '{"words":[{"w":"...","g":"..."}],"phrases":[{"p":"...","g":"..."}],"grammar":"..."} '
      + '— 3 to 6 key words with glosses, 1 to 3 phrases or collocations, and one '
      + 'grammar point worth knowing.';
  }

  // Model output is untrusted input, as a premise rather than a surprise: strip
  // fences, cut to the outermost braces, parse defensively, keep only well-typed
  // entries, clamp counts. Returns null when nothing usable survives — the caller
  // turns that into its own error code instead of showing garbage.
  function parseNotes(text) {
    let s = String(text == null ? '' : text).trim();
    s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    let j;
    try { j = JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
    if (!j || typeof j !== 'object') return null;

    const pair = (arr, k) => (Array.isArray(arr) ? arr : [])
      .filter((x) => x && typeof x[k] === 'string' && typeof x.g === 'string'
        && x[k].trim() && x.g.trim())
      .map((x) => ({ [k]: x[k].trim(), g: x.g.trim() }));

    const out = {
      words: pair(j.words, 'w').slice(0, 8),
      phrases: pair(j.phrases, 'p').slice(0, 4),
      grammar: typeof j.grammar === 'string' ? j.grammar.trim() : '',
    };
    if (!out.words.length && !out.phrases.length && !out.grammar) return null;
    return out;
  }

  async function callEngine(item, explainLang) {
    const p = providerInfo();
    const base = cfg.baseUrl || p.defaultBase;
    if (!base) { const e = new Error('missing base URL'); e.code = 'no_base'; throw e; }
    const model = cfg.model || p.defaultModel;
    const user = 'Sentence (' + (item.lang || 'und') + '): ' + item.text
      + '\nTranslation: ' + item.tr;

    const msgFormat = p.type === 'messages-compat';
    const resp = await fetch(base + p.path, {
      method: 'POST',
      headers: msgFormat
        ? { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true' }
        : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(msgFormat
        ? { model, max_tokens: 1000, system: buildPrompt(explainLang),
            messages: [{ role: 'user', content: user }] }
        : { model, temperature: 0.3, max_tokens: 1000,
            messages: [{ role: 'system', content: buildPrompt(explainLang) },
                       { role: 'user', content: user }] }),
    });
    if (!resp.ok) {
      const e = new Error('HTTP ' + resp.status);
      e.code = 'http'; e.status = resp.status;
      throw e;
    }
    const d = await resp.json();
    const text = msgFormat
      ? d && d.content && d.content[0] && d.content[0].text
      : d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    const parsed = parseNotes(text);
    if (!parsed) { const e = new Error('unusable model output'); e.code = 'bad_output'; throw e; }
    return parsed;
  }

  // Cache-first. The user's key is charged at most once per card, ever.
  async function get(item, explainLang) {
    const hit = await LearnStore.getNote(item.id);
    if (hit && hit.data) return { data: hit.data, cached: true };
    const data = await callEngine(item, explainLang);
    await LearnStore.putNote(item.id, data, { provider: cfg.provider });
    return { data, cached: false };
  }

  function cached(id) { return LearnStore.getNote(id); }

  return { configure, capable, parseNotes, buildPrompt, get, cached };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnNotes;
