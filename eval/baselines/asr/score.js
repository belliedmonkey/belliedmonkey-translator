'use strict';

// Offline ASR scoring for an exported hypothesis list against a frozen reference set.
// This file does not read audio, call a model, or invent a hypothesis.
// English is word error rate. Chinese is character error rate. The two are not averaged.

const fs = require('fs');

function nfkc(s) {
  return String(s == null ? '' : s).normalize('NFKC');
}

function enTokens(s) {
  const t = nfkc(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return t ? t.split(/\s+/) : [];
}

function zhChars(s) {
  return [...nfkc(s).replace(/[\s\p{P}\p{S}]+/gu, '')];
}

function unitsFor(lang, text) {
  if (lang === 'en') return enTokens(text);
  if (lang === 'zh') return zhChars(text);
  const err = new Error('language');
  err.lang = lang;
  throw err;
}

function metricFor(lang) {
  if (lang === 'en') return 'wer';
  if (lang === 'zh') return 'cer';
  const err = new Error('language');
  err.lang = lang;
  throw err;
}

function levenshtein(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1);
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (ai === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, sub);
    }
    prev = cur;
  }
  return prev[m];
}

function scorePair(item) {
  const lang = item && item.lang;
  let metric;
  try { metric = metricFor(lang); }
  catch (_) {
    return { ok: false, reason: 'language', id: item && item.id, productMetric: false };
  }
  // Only an explicit string is a hypothesis. Missing, null, and numbers are
  // not an empty recognizer result. A reference-only row has no hypothesis.
  if (!item || typeof item.hypothesis !== 'string') {
    return { ok: false, reason: 'hypothesis-type', lang, metric, id: item && item.id, productMetric: false };
  }
  const ref = unitsFor(lang, item.reference);
  const hyp = unitsFor(lang, item.hypothesis);
  if (!ref.length) {
    return {
      ok: false,
      reason: 'empty-reference',
      lang,
      metric,
      id: item.id,
      productMetric: false,
    };
  }
  const errors = levenshtein(ref, hyp);
  return {
    ok: true,
    lang,
    metric,
    id: item.id,
    errors,
    length: ref.length,
    rate: errors / ref.length,
    emptyHypothesis: item.hypothesis === '',
    productMetric: false,
  };
}

function indexById(list, label) {
  const map = new Map();
  const duplicates = [];
  for (const row of list || []) {
    const id = row && row.id;
    if (id == null || id === '') {
      const err = new Error('missing-id');
      err.label = label;
      throw err;
    }
    if (map.has(id)) duplicates.push(id);
    map.set(id, row);
  }
  return { map, duplicates };
}

function scoreFrozen(set, hypotheses) {
  const base = {
    productMetric: false,
    toolOnly: !!(set && set.kind === 'tool-only'),
    publicComparison: !!(set && set.kind === 'public-comparison'),
  };
  if (!set || !Array.isArray(set.items)) {
    return Object.assign(base, { ok: false, reason: 'bad-set', rates: null });
  }
  if (hypotheses == null) {
    return Object.assign(base, { ok: false, reason: 'no-hypothesis', rates: null, items: [] });
  }
  let frozen;
  let hypIndex;
  try {
    frozen = indexById(set.items, 'reference');
    hypIndex = indexById(hypotheses, 'hypothesis');
  } catch (e) {
    return Object.assign(base, { ok: false, reason: e.message, rates: null });
  }
  if (frozen.duplicates.length || hypIndex.duplicates.length) {
    return Object.assign(base, {
      ok: false,
      reason: 'duplicate-id',
      duplicateReferenceIds: frozen.duplicates,
      duplicateHypothesisIds: hypIndex.duplicates,
      rates: null,
    });
  }
  const missing = [];
  const unknown = [];
  const scored = [];
  const rejected = [];
  for (const [id, row] of frozen.map) {
    if (!hypIndex.map.has(id)) {
      missing.push(id);
      continue;
    }
    const hyp = hypIndex.map.get(id);
    const one = scorePair({
      id,
      lang: row.lang,
      reference: row.reference,
      hypothesis: hyp.hypothesis,
    });
    if (!one.ok) rejected.push(one);
    else scored.push(one);
  }
  for (const id of hypIndex.map.keys()) {
    if (!frozen.map.has(id)) unknown.push(id);
  }
  const byLang = {};
  for (const row of scored) {
    if (!byLang[row.lang]) byLang[row.lang] = { metric: row.metric, n: 0, errors: 0, length: 0 };
    const b = byLang[row.lang];
    b.n += 1;
    b.errors += row.errors;
    b.length += row.length;
  }
  for (const b of Object.values(byLang)) b.rate = b.length ? b.errors / b.length : null;
  const failed = missing.length > 0 || unknown.length > 0 || rejected.length > 0;
  const reason = missing.length ? 'missing-hypothesis'
    : unknown.length ? 'unknown-id'
      : rejected.length ? rejected[0].reason : '';
  if (failed) {
    return Object.assign(base, {
      ok: false,
      reason,
      missing,
      unknown,
      rejected,
      items: [],
      rates: null,
      diagnostic: {
        note: 'not-a-score',
        partial: scored,
      },
    });
  }
  return Object.assign(base, {
    ok: true,
    reason: '',
    missing,
    unknown,
    rejected,
    items: scored,
    byLang,
    rates: byLang,
    diagnostic: null,
  });
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function main(argv) {
  const args = argv.slice(2);
  let setPath = '';
  let hypPath = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') setPath = args[++i];
    else if (args[i] === '--hyp') hypPath = args[++i];
    else {
      console.error('unknown arg ' + args[i]);
      process.exit(1);
    }
  }
  if (!setPath) {
    console.error('usage: node eval/baselines/asr/score.js --set <frozen.json> --hyp <hypotheses.json>');
    process.exit(1);
  }
  const set = readJson(setPath);
  if (!hypPath) {
    const out = scoreFrozen(set, null);
    console.log(JSON.stringify(out, null, 2));
    console.error('no hypothesis file; reference text was not scored against itself');
    process.exit(2);
  }
  const hypotheses = readJson(hypPath);
  const out = scoreFrozen(set, hypotheses);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

if (require.main === module) main(process.argv);

module.exports = {
  enTokens, zhChars, levenshtein, scorePair, scoreFrozen,
};
