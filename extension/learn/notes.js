// learn/notes.js — 句子解析 (§9.2): 生词 / 短语搭配 / 一个语法点.
// See docs/learning-design.md §9.2 and interaction-spec 「解析」.
//
// Uses the user's OWN chat-capable engine, read from the same provider registry the
// translator uses (window.MT_PROVIDERS — the single source of provider truth;
// nothing vendor-specific is restated here, only the two wire formats — note the
// China gate scans shipped COMMENTS too, so no repo-doc names in this file). The free Google
// channel is a translation API and cannot do this, so capability is a hard gate:
// no chat engine configured ⇒ `capable()` is false ⇒ the UI renders no entry point.
//
// One generation per card, ever — the caller caches through LearnStore's `notes`
// store, and `get()` is cache-first. Cost is a real per-call charge on the user's
// key; predictability is part of the feature.
//
// EXTENSION PAGES ONLY (and the app's WKWebView, where the app's own settings may
// hold a chat engine + key — learning-design §7.2's device-local credentials; no
// key configured ⇒ the gate simply stays closed).

var LearnNotes = (() => {
  let cfg = { provider: '', apiKey: '', baseUrl: '', model: '' };

  function configure(c) { cfg = Object.assign({}, cfg, c || {}); }

  function providerInfo() {
    const list = (typeof window !== 'undefined' && window.MT_PROVIDERS) || [];
    return list.find((p) => p.id === cfg.provider) || null;
  }

  // The one place that knows which registry TYPES can do this job. The app's
  // settings select is built from this, so "what counts as a chat engine" cannot
  // drift between the gate and the picker.
  function chatEngines() {
    const list = (typeof window !== 'undefined' && window.MT_PROVIDERS) || [];
    return list.filter((p) => p.type === 'chat-compat' || p.type === 'messages-compat');
  }

  // Chat-capable AND keyed. `google` is excluded by type, not by name — the registry
  // stays the single place that knows what each engine is.
  function capable() {
    const p = providerInfo();
    return !!(p && (p.type === 'chat-compat' || p.type === 'messages-compat') && cfg.apiKey);
  }

  // Prompt contract version, stored on every cached note. Bump ONLY when a prompt
  // change corrects WRONG output (wording polish never qualifies): a bump makes
  // get() treat older notes as a miss and regenerate — at most one extra charge
  // per card per bump, the one deliberate exception to §9.2's "cached forever".
  // v1 → v2: v1 never said which side the words come from, and on `und` cards
  // (every Safari capture — domain-design §5.3) the model had no study-language
  // signal at all; observed on-device studying the TRANSLATION (an English card
  // "parsed" into pinyin'd Chinese vocabulary).
  const PROMPT_VERSION = 2;

  // English system prompt (the project convention); the EXPLANATIONS come back in
  // the user's UI language. JSON-only output so the parser has a fighting chance.
  // The study side is pinned explicitly: words come FROM THE SENTENCE, never the
  // translation — `lang` is 'und' on every Safari capture, so the prompt is the
  // only place this can be said.
  function buildPrompt(explainLang) {
    return 'You are a language-learning assistant. The learner is studying the '
      + 'language the Sentence is written in; the Translation is in the learner\'s '
      + 'own language and is context only. Produce concise study notes: every word '
      + 'and phrase must be picked FROM THE SENTENCE ONLY, copied verbatim — never '
      + 'from the Translation. Write all glosses and explanations in '
      + (explainLang || 'zh-CN') + '. The grammar point must be about the Sentence\'s '
      + 'language. Respond with ONLY a JSON object, no markdown, in exactly this shape: '
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
      // 3000, not 1000: hybrid thinking models (observed on the DeepSeek default)
      // spend their budget on the reasoning phase FIRST — at 1000 the budget died
      // mid-think and `content` came back empty, indistinguishable from a broken
      // endpoint. The notes JSON itself is small; the headroom is for thinking.
      body: JSON.stringify(msgFormat
        ? { model, max_tokens: 3000, system: buildPrompt(explainLang),
            messages: [{ role: 'user', content: user }] }
        : { model, temperature: 0.3, max_tokens: 3000,
            messages: [{ role: 'system', content: buildPrompt(explainLang) },
                       { role: 'user', content: user }] }),
    });
    if (!resp.ok) {
      const e = new Error('HTTP ' + resp.status);
      e.code = 'http'; e.status = resp.status;
      throw e;
    }
    const d = await resp.json();
    const msg = !msgFormat && d && d.choices && d.choices[0] && d.choices[0].message;
    const text = msgFormat
      ? d && d.content && d.content[0] && d.content[0].text
      : msg && msg.content;
    // Empty content is its OWN failure, not "unparsable": a reasoning/thinking
    // model that never reached its answer (or a model that only emits
    // reasoning_content) needs the user to switch models — retrying is useless,
    // so the UI names the fix instead of asking them to try again.
    if (!String(text == null ? '' : text).trim()) {
      const thinking = !!(msg && msg.reasoning_content);
      try {
        console.error('[learn/notes] empty content' + (thinking ? ' (reasoning_content present — thinking model)' : ''),
          JSON.stringify(d).slice(0, 300));
      } catch (_) {}
      const e = new Error('model returned no content'); e.code = 'empty_output'; throw e;
    }
    const parsed = parseNotes(text);
    // Both gates share the user-facing code, so the console line is the only
    // place that says WHICH gate rejected and what the model actually sent —
    // without it every bad_output is an identical dead end.
    if (!parsed) {
      try { console.error('[learn/notes] bad_output (unparsable):', String(text).slice(0, 500)); } catch (_) {}
      const e = new Error('unusable model output'); e.code = 'bad_output'; throw e;
    }
    if (!notesMatchSentence(parsed, item.text)) {
      try { console.error('[learn/notes] bad_output (not from sentence):', JSON.stringify(parsed).slice(0, 500), '| sentence:', String(item.text).slice(0, 200)); } catch (_) {}
      const e = new Error('notes not from the sentence'); e.code = 'bad_output'; throw e;
    }
    return parsed;
  }

  // Mechanical enforcement of the prompt's core rule — the prompt alone is an
  // instruction a model can ignore. The wrong-side failure produced ZERO entries
  // from the sentence (every word came from the translation), so requiring just
  // ONE case-insensitive verbatim hit rejects that wholesale while tolerating a
  // lemmatized entry here and there. Failing this is bad_output: nothing cached,
  // the user sees the failure line and can retry.
  function notesMatchSentence(notes, sentence) {
    const s = String(sentence || '').toLowerCase();
    if (!s) return true;
    const entries = (notes.words || []).map((x) => x.w)
      .concat((notes.phrases || []).map((x) => x.p));
    if (!entries.length) return true;   // grammar-only output has nothing to check
    return entries.some((w) => s.indexOf(String(w).toLowerCase()) >= 0);
  }

  // In-flight generations by card id: the same sentence can be on screen in two
  // places (practice deck + review, or app + extension page), and two concurrent
  // get()s would charge the key twice for one answer.
  const inflight = new Map();

  // Cache-first. The user's key is charged at most once per card — per prompt
  // version. A version mismatch (or a pre-versioning record) is a miss: those
  // notes were generated by a prompt that produced wrong output, and serving
  // them forever is worse than one more charge.
  async function get(item, explainLang) {
    if (inflight.has(item.id)) return inflight.get(item.id);
    const hit = await LearnStore.getNote(item.id);
    if (hit && hit.data && hit.v === PROMPT_VERSION) return { data: hit.data, cached: true };
    if (inflight.has(item.id)) return inflight.get(item.id);
    const p = (async () => {
      const data = await callEngine(item, explainLang);
      // The charge already happened and the data is in hand — a failed cache
      // write must not surface as "解析失败" and bait a SECOND charge. Same
      // best-effort stance as the audio cache (tts.js putAudio).
      try {
        await LearnStore.putNote(item.id, data, { provider: cfg.provider, v: PROMPT_VERSION });
      } catch (_) {}
      return { data, cached: false };
    })();
    inflight.set(item.id, p);
    try { return await p; } finally { inflight.delete(item.id); }
  }

  // Same gates as get(): a stale-version or dataless note must not auto-render
  // on the answer face — the button comes back instead, and clicking regenerates.
  function cached(id) {
    return LearnStore.getNote(id)
      .then((h) => (h && h.data && h.v === PROMPT_VERSION ? h : null))
      .catch(() => null);
  }

  return { configure, capable, chatEngines, parseNotes, buildPrompt, get, cached,
    notesMatchSentence, PROMPT_VERSION };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnNotes;
