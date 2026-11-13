'use strict';

// Scoring for the reviewed 36. Read speech uses the frozen WER/CER normalizer.
// Code-switch is a separate token rule. It is not a ranking and it is not
// character-split Latin CER.

const { enTokens, zhChars, levenshtein, scorePair } = require('./score.js');

function nfkc(s) {
  return String(s == null ? '' : s).normalize('NFKC');
}

function mixedTokens(s) {
  const t = nfkc(s).toLowerCase();
  const out = [];
  let latin = '';
  function flush() {
    if (latin) {
      out.push(latin);
      latin = '';
    }
  }
  for (const ch of t) {
    if (/\p{Script=Han}/u.test(ch)) {
      flush();
      out.push(ch);
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      latin += ch;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

function isHanToken(token) {
  return /^\p{Script=Han}$/u.test(token);
}

function segmentDistance(tokensA, tokensB, keep) {
  const a = tokensA.filter(keep);
  const b = tokensB.filter(keep);
  if (!a.length) return { errors: null, length: 0, rate: null };
  const errors = levenshtein(a, b);
  return { errors: errors, length: a.length, rate: errors / a.length };
}

function scoreMixed(reference, hypothesis) {
  const ref = mixedTokens(reference);
  const hyp = mixedTokens(hypothesis);
  if (!ref.length) return { ok: false, reason: 'empty-reference' };
  const errors = levenshtein(ref, hyp);
  return {
    ok: true,
    metric: 'mer',
    errors: errors,
    length: ref.length,
    rate: errors / ref.length,
    ranking: false,
    han: segmentDistance(ref, hyp, isHanToken),
    latin: segmentDistance(ref, hyp, (token) => !isHanToken(token)),
    note: 'Latin stays a word token. A character CER over Latin is not this rate and is not a rank.',
  };
}

function scoreReviewed(items) {
  const blank = {
    ok: false,
    productMetric: false,
    exploratory: true,
    ranking: false,
    rates: null,
    approvedPlannedSetCount: 0,
  };
  if (!Array.isArray(items) || items.length !== 36) {
    return Object.assign(blank, { reason: 'need-36' });
  }
  const seen = new Set();
  const scored = [];
  for (const item of items) {
    if (!item || !item.id || seen.has(item.id)) {
      return Object.assign(blank, { reason: 'duplicate-id' });
    }
    seen.add(item.id);
    if (typeof item.hypothesis !== 'string' || item.hypothesis === '') {
      return Object.assign(blank, { reason: 'empty-hypothesis', id: item.id });
    }
    if (item.stratum === 'read-speech') {
      const one = scorePair({
        id: item.id,
        lang: item.lang,
        reference: item.reference,
        hypothesis: item.hypothesis,
      });
      if (!one.ok) return Object.assign(blank, { reason: one.reason, id: item.id });
      scored.push(Object.assign({ stratum: 'read-speech', rawHypothesis: item.hypothesis }, one));
    } else if (item.stratum === 'code-switch') {
      const one = scoreMixed(item.reference, item.hypothesis);
      if (!one.ok) return Object.assign(blank, { reason: one.reason, id: item.id });
      scored.push({
        id: item.id,
        stratum: 'code-switch',
        lang: 'mixed',
        rawHypothesis: item.hypothesis,
        metric: 'mer',
        errors: one.errors,
        length: one.length,
        rate: one.rate,
        ranking: false,
        han: one.han,
        latin: one.latin,
        productMetric: false,
      });
    } else {
      return Object.assign(blank, { reason: 'stratum', id: item.id });
    }
  }
  const byLang = {};
  let merErrors = 0;
  let merLength = 0;
  let merN = 0;
  for (const row of scored) {
    if (row.stratum === 'read-speech') {
      if (!byLang[row.lang]) byLang[row.lang] = { metric: row.metric, n: 0, errors: 0, length: 0 };
      byLang[row.lang].n += 1;
      byLang[row.lang].errors += row.errors;
      byLang[row.lang].length += row.length;
    } else {
      merN += 1;
      merErrors += row.errors;
      merLength += row.length;
    }
  }
  for (const b of Object.values(byLang)) b.rate = b.length ? b.errors / b.length : null;
  if (!byLang.en || byLang.en.n !== 15 || !byLang.zh || byLang.zh.n !== 15 || merN !== 6) {
    return Object.assign(blank, { reason: 'stratum-count' });
  }
  return {
    ok: true,
    productMetric: false,
    exploratory: true,
    ranking: false,
    approvedPlannedSetCount: 0,
    reason: '',
    rates: {
      en: byLang.en,
      zh: byLang.zh,
      codeswitch: {
        metric: 'mer',
        n: merN,
        errors: merErrors,
        length: merLength,
        rate: merLength ? merErrors / merLength : null,
        ranking: false,
      },
    },
    items: scored,
    normalizer: 'score.js enTokens/zhChars for read speech; mixedTokens for code-switch',
  };
}

module.exports = {
  mixedTokens, scoreMixed, scoreReviewed, enTokens, zhChars,
};
