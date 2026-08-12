// learn-exercises.js — pure exercise generation for the four-skill rotation
// (记忆层). See docs/learning-design.md §5.4 (rotation) and §9.3 (local vs pack).
//
// PURE and DETERMINISTIC, like clozeFor: no model, no ambient randomness. Every
// choice is seeded by (item id, reps, skill) — a reload re-asks the same question,
// and a test can predict what the UI will show. Depends only on LearnModel (loaded
// first in both hosts).
//
// The material rotation (§5.4): which words a listen-pick tests and which foils it
// uses turn over as `reps` grows, so a sentence's knowledge points all get their
// turn without any knowledge-point-level bookkeeping.

var LearnExercises = (() => {
  // Same normalization contract as LearnModel.clozeNorm: case, punctuation and
  // whitespace are noise, not knowledge.
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  // ─── Seeded determinism ────────────────────────────────────────────────────
  function seedOf(str) {
    return parseInt(LearnModel.hash16(String(str)).slice(0, 8), 16) >>> 0;
  }
  // mulberry32 — tiny, good-enough PRNG; the seed carries all the variety.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, seed) {
    const r = rng(seed);
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  function pickN(arr, n, seed) { return shuffle(arr, seed).slice(0, Math.max(0, n)); }

  // ─── The variant rotation (§9.3) ───────────────────────────────────────────
  // Local variants always exist; AI variants join only while the pack gate is
  // open (`hasAI`), and only 'comprehension' may trigger a pack generation —
  // listen-pick merely PREFERS pack foils when a cached pack has them.
  function pickExercise(skill, item, opts) {
    opts = opts || {};
    const reps = opts.reps || 0;
    if (skill === 'write') return { kind: 'cloze', needsPack: false };
    if (skill === 'speak') return { kind: 'speak', needsPack: false };
    const seed = seedOf((item && item.id) + '|' + reps + '|' + skill);
    if (skill === 'read') {
      const kinds = ['recall', 'mcq'];
      if (opts.hasAI) kinds.push('comprehension');
      let k = kinds[seed % kinds.length];
      // An MCQ needs distractors to exist; a small corpus falls back to recall.
      if (k === 'mcq' && (opts.poolSize || 0) < 4) k = 'recall';
      return { kind: k, needsPack: k === 'comprehension' };
    }
    const kinds = ['listen-recall', 'listen-pick'];
    let k = kinds[seed % kinds.length];
    if (k === 'listen-pick' && (opts.poolSize || 0) < 2) k = 'listen-recall';
    return { kind: k, needsPack: false };
  }

  // ─── 译文选择题 (read · mcq) ────────────────────────────────────────────────
  // Distractors prefer the (already compliance-checked) pack; the local fallback
  // draws other corpus items' translations, nearest-in-length first — plausible
  // by construction, deterministic by sort. Anything normalize-equal to the
  // answer is excluded wholesale: an option that IS the answer in disguise makes
  // the exercise unwinnable-by-honesty.
  function mcqFrom(item, pool, packDistractors, reps) {
    const answer = String((item && item.tr) || '');
    const answerN = norm(answer);
    if (!answerN) return null;
    const seen = new Set([answerN]);
    const ds = [];
    for (const d of packDistractors || []) {
      const n = norm(d);
      if (!n || seen.has(n)) continue;
      seen.add(n); ds.push(String(d).trim());
      if (ds.length >= 3) break;
    }
    if (ds.length < 3) {
      const cands = (pool || [])
        .filter((it) => it && it.id !== item.id && it.tr && !seen.has(norm(it.tr)))
        .sort((a, b) =>
          (Math.abs(String(a.tr).length - answer.length) - Math.abs(String(b.tr).length - answer.length))
          || (a.id < b.id ? -1 : 1));
      for (const c of cands) {
        const n = norm(c.tr);
        if (seen.has(n)) continue;
        seen.add(n); ds.push(String(c.tr));
        if (ds.length >= 3) break;
      }
    }
    if (!ds.length) return null;
    const options = shuffle(ds.concat([answer]), seedOf((item.id || '') + '|' + (reps || 0) + '|mcq'));
    return { options, correct: options.indexOf(answer) };
  }

  // ─── 盲听选词 (listen · pick) ───────────────────────────────────────────────
  // Correct options are content units OF the sentence (they were heard); foils
  // must NOT occur in it (pack foils are pre-checked, local foils re-checked
  // here). The seed rotates WHICH sentence words are tested as reps grow — the
  // §5.4 knowledge-point rotation, with zero bookkeeping.
  function listenPickFrom(item, pool, packFoils, reps) {
    const text = String((item && item.text) || '');
    const textLower = text.toLowerCase();
    const units = [];
    const uSeen = new Set();
    for (const w of LearnModel.contentWords(text)) {
      const n = norm(w);
      if (!n || uSeen.has(n)) continue;
      uSeen.add(n); units.push(w);
    }
    if (!units.length) return null;
    const seed = seedOf((item.id || '') + '|' + (reps || 0) + '|pick');
    const hits = pickN(units, 3, seed);
    const foils = [];
    const fSeen = new Set();
    const admit = (w) => {
      const n = norm(w);
      if (!n || fSeen.has(n) || uSeen.has(n)) return false;
      if (textLower.indexOf(String(w).toLowerCase()) >= 0) return false;
      fSeen.add(n); foils.push(String(w).trim());
      return true;
    };
    for (const f of packFoils || []) {
      if (foils.length >= 3) break;
      admit(f);
    }
    if (foils.length < 3) {
      const cands = [];
      const cSeen = new Set();
      for (const it of pool || []) {
        if (!it || it.id === item.id || !it.text) continue;
        for (const w of LearnModel.contentWords(it.text)) {
          const n = norm(w);
          if (!n || cSeen.has(n)) continue;
          cSeen.add(n); cands.push(w);
        }
      }
      cands.sort();
      for (const w of pickN(cands, cands.length, seed ^ 0x9e3779b9)) {
        if (foils.length >= 3) break;
        admit(w);
      }
    }
    if (foils.length < 2) return null;   // not enough contrast to test anything
    const options = hits.map((w) => ({ w, hit: true }))
      .concat(foils.map((w) => ({ w, hit: false })));
    return { options: shuffle(options, seed) };
  }

  // ─── 说 — transcript vs original, scored locally (§9.4) ───────────────────
  // The model only transcribes; the JUDGE is this pure function — testable and
  // replayable. Dense scripts: character-bigram overlap on normalized text.
  // Sparse scripts: content-word multiset overlap. Returns the fraction of the
  // ORIGINAL covered, plus the original units the transcript missed.
  function speakScore(original, transcript) {
    const o = String(original == null ? '' : original);
    const oN = norm(o), tN = norm(transcript);
    if (!oN) return { score: 0, missed: [] };
    if (!tN) return { score: 0, missed: LearnModel.contentWords(o) };
    if (LearnModel.isDense(o)) {
      if (oN.length < 2) return { score: tN.indexOf(oN) >= 0 ? 1 : 0, missed: [] };
      const grams = (s) => {
        const m = new Map();
        for (let i = 0; i < s.length - 1; i++) {
          const g = s.slice(i, i + 2);
          m.set(g, (m.get(g) || 0) + 1);
        }
        return m;
      };
      const a = grams(oN), b = grams(tN);
      let hit = 0, total = 0;
      for (const entry of a) {
        total += entry[1];
        hit += Math.min(entry[1], b.get(entry[0]) || 0);
      }
      const missed = LearnModel.contentWords(o).filter((w) => tN.indexOf(norm(w)) < 0);
      return { score: total ? hit / total : 0, missed };
    }
    const words = LearnModel.contentWords(o);
    if (!words.length) return { score: oN === tN ? 1 : 0, missed: [] };
    const bag = new Map();
    for (const w of LearnModel.contentWords(transcript)) {
      const n = norm(w);
      bag.set(n, (bag.get(n) || 0) + 1);
    }
    let hit = 0;
    const missed = [];
    for (const w of words) {
      const n = norm(w);
      const have = bag.get(n) || 0;
      if (have > 0) { hit++; bag.set(n, have - 1); } else missed.push(w);
    }
    return { score: hit / words.length, missed };
  }

  // ─── Objective result → allowed grades (§5.2 honesty, §9.3) ────────────────
  // One place, mirroring the cloze rule exactly: a demonstrated pass contradicts
  // 「不记得」, a demonstrated fail contradicts every passing grade. Speak is
  // thresholded — the middle band leaves self-assessment intact.
  function gradeGate(kind, result) {
    if (kind === 'speak') {
      const sc = (result && result.score) || 0;
      if (sc >= 0.9) return [1, 2, 3];
      if (sc < 0.5) return [0, 1];
      return [0, 1, 2, 3];
    }
    return result && result.correct ? [1, 2, 3] : [0];
  }

  return { pickExercise, mcqFrom, listenPickFrom, speakScore, gradeGate, seedOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnExercises;
