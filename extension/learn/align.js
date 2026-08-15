// align.js — §4.2c LLM alignment adjudication for the 拆分长段卡 action.
//
// The structural reconciler (learn-model.js §4.2b) refuses whenever punctuation
// evidence cannot certify an alignment — translator restructuring above all.
// For those refusals the user's OWN configured chat engine is asked to GROUP
// sentences; it never rewrites text. The proposal is verified mechanically by
// LearnModel.alignByGroups (index partition + verbatim slicing + ratio guard),
// so a hallucinating model can only fail closed to keep-whole — the LLM
// proposes, the code disposes. EXPLICIT action only: this spends the user's
// key, so it runs behind the same button press that consented to rewriting
// collected material (§3 law 2) — never silently at capture.
//
// Transport rides LearnNotes.chat (§9.2/§9.3) — the ONE place that knows the
// two wire formats; a third copy is exactly how they would drift.

var LearnAlign = (() => {
  // Per press — bounded spend. The result surface reports how many were sent,
  // so a capped run is visible, not silent (verification-spec: no silent caps).
  const MAX_CALLS = 40;

  const SYSTEM = 'You align a source text with its translation at sentence level.'
    + ' You receive numbered source sentences (A0..An) and numbered translation'
    + ' sentences (B0..Bm). Group CONSECUTIVE sentences on each side so the groups'
    + ' correspond one-to-one in order. Reply with ONLY a JSON object, no prose:'
    + ' {"a":[[0],[1,2]],"b":[[0,1],[2]]} — every index used exactly once, ascending,'
    + ' both sides having the SAME number of groups (at least 2). If you are not'
    + ' confident the texts align, reply {"a":null}.';

  function buildUser(a, b) {
    return 'Source sentences:\n' + a.map((s, i) => 'A' + i + ': ' + s).join('\n')
      + '\n\nTranslation sentences:\n' + b.map((s, i) => 'B' + i + ': ' + s).join('\n');
  }

  // Strict extraction: the first {...} block, JSON.parse, shape-checked. The
  // real validation (partition/verbatim/ratio) lives in alignByGroups — this
  // only has to produce a candidate object or null.
  function parseGroups(text) {
    const s = String(text == null ? '' : text);
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    let g;
    try { g = JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; }
    if (!g || !Array.isArray(g.a) || !Array.isArray(g.b)) return null;
    return { a: g.a, b: g.b };
  }

  async function adjudicate(item) {
    const a = LearnModel.splitSentences(item.text, item.lang);
    const b = LearnModel.splitSentences(item.tr, item.targetLang);
    if (a.length < 2 || b.length < 2) return null;
    const raw = await LearnNotes.chat(SYSTEM, buildUser(a, b));
    const groups = parseGroups(raw);
    if (!groups) return null;
    return LearnModel.alignByGroups(item.text, item.tr, item.lang, item.targetLang, groups);
  }

  // The second phase of the 拆分长段卡 press: everything the structural pass
  // left whole gets one adjudication attempt each, capped. Per-item failures
  // (transport, refusal, invalid grouping) leave that item whole and move on —
  // one bad paragraph must not abort the run.
  async function healUnalignable() {
    const items = await LearnStore.allItems();
    const cands = LearnStore.llmCandidatesFor(items);
    const out = { asked: 0, split: 0, children: 0, capped: Math.max(0, cands.length - MAX_CALLS) };
    for (const it of cands.slice(0, MAX_CALLS)) {
      out.asked++;
      let pairs = null;
      try { pairs = await adjudicate(it); } catch (_) { pairs = null; }
      if (!pairs || pairs.length < 2) continue;
      try {
        out.children += await LearnStore.applySplit(it, pairs);
        out.split++;
      } catch (_) { /* storage failure: item stays whole, next press retries */ }
    }
    return out;
  }

  // §4.2d — the last-resort fallback (用户提议 2026-08-16): when even grouping
  // cannot rescue a pair, RE-TRANSLATE the source per sentence. The source side
  // splits reliably; per-sentence pairs are aligned BY CONSTRUCTION, and a
  // truncated/garbled stored translation — unfixable by any alignment — is
  // rescued outright. This is the one place a card's `tr` deviates from what
  // the page showed: acceptable because the paragraph-level translation is
  // discarded on split anyway, and the alternative is an unmemorizable card.
  // `translate(sentence, targetLang)` is injected by the OPTIONS page only —
  // the app never translates (its own first law), so there it simply never runs.
  const MAX_RETRANSLATE_SENTENCES = 80; // per press — bounded spend, cache-backed
  async function healByRetranslate(translate) {
    const items = await LearnStore.allItems();
    const cands = LearnStore.retranslateCandidatesFor(items);
    const out = { asked: 0, split: 0, children: 0, capped: 0 };
    let budget = MAX_RETRANSLATE_SENTENCES;
    for (const it of cands) {
      const sents = LearnModel.splitSentences(it.text, it.lang);
      if (sents.length < 2) continue;
      if (sents.length > budget) { out.capped++; continue; }
      out.asked++;
      let pairs = [];
      try {
        for (const s of sents) {
          const tr = await translate(s, it.targetLang);
          if (!tr || !String(tr).trim()) { pairs = null; break; }
          pairs.push({ text: s, tr: String(tr).trim() });
        }
      } catch (_) { pairs = null; }
      if (!pairs || pairs.length < 2) continue;
      budget -= sents.length;
      try {
        out.children += await LearnStore.applySplit(it, pairs);
        out.split++;
      } catch (_) { /* storage failure: stays whole, next press retries */ }
    }
    return out;
  }

  return { adjudicate, healUnalignable, healByRetranslate, parseGroups, buildUser,
    SYSTEM, MAX_CALLS, MAX_RETRANSLATE_SENTENCES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnAlign;
