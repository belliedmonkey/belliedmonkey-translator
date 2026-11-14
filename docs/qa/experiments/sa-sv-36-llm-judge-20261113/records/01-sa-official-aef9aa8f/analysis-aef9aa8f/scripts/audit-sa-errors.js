'use strict';

// One-time, read-only audit of the aef9aa8f SA-36 hypotheses against the
// frozen official scorer. This script does not rewrite references, does not
// change score.js / codeswitch-score.js, and does not invent official rates.
// Alignment is added only so S/D/I can be inspected; the distance is required
// to equal the frozen levenshtein result.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FROZEN_DIR = process.env.FROZEN_DIR ||
  '/workspace/baseline-sa-sv-36-20261113/runner-bundle-inspect-aef9aa8f';
const RESULTS_DIR = process.env.RESULTS_DIR ||
  '/workspace/baseline-sa-sv-36-20261113/results/aef9aa8f/sa-smoke-aef9aa8f-r1';
const OUT_DIR = process.env.OUT_DIR ||
  '/workspace/baseline-sa-sv-36-20261113/analysis-aef9aa8f';

const { enTokens, zhChars, levenshtein, scorePair } = require(path.join(FROZEN_DIR, 'score.js'));
const { mixedTokens, scoreMixed, scoreReviewed } = require(path.join(FROZEN_DIR, 'codeswitch-score.js'));

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Tie-break on equal cost: prefer substitution/match, then deletion, then insertion.
// Documented so alignments are reproducible. Distance must match frozen levenshtein().
function alignTokens(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) dp[i][0] = i;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      const del = dp[i - 1][j] + 1;
      const ins = dp[i][j - 1] + 1;
      const sub = dp[i - 1][j - 1] + cost;
      dp[i][j] = Math.min(del, ins, sub);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      const sub = dp[i - 1][j - 1] + cost;
      const del = dp[i - 1][j] + 1;
      const ins = dp[i][j - 1] + 1;
      const best = dp[i][j];
      if (sub === best) {
        ops.push({
          op: cost === 0 ? 'C' : 'S',
          ref: ref[i - 1],
          hyp: hyp[j - 1],
        });
        i -= 1;
        j -= 1;
        continue;
      }
      if (del === best) {
        ops.push({ op: 'D', ref: ref[i - 1], hyp: null });
        i -= 1;
        continue;
      }
      ops.push({ op: 'I', ref: null, hyp: hyp[j - 1] });
      j -= 1;
      continue;
    }
    if (i > 0) {
      ops.push({ op: 'D', ref: ref[i - 1], hyp: null });
      i -= 1;
    } else {
      ops.push({ op: 'I', ref: null, hyp: hyp[j - 1] });
      j -= 1;
    }
  }
  ops.reverse();
  const counts = { C: 0, S: 0, D: 0, I: 0 };
  for (const op of ops) counts[op.op] += 1;
  const distance = counts.S + counts.D + counts.I;
  return { ops, counts, distance };
}

function hasControlToken(text) {
  const s = String(text || '');
  const patterns = [
    /<\s*\/?\s*(s|\/s|unk|unkown|blank|sil|noise|pad|eos|bos|ctrl)[^>]*>/i,
    /\[\s*(unk|blank|sil|noise|pad|sos|eos)\s*\]/i,
    /<\|[^|]+\|>/,
    /<0x[0-9a-fA-F]+>/,
    /\u2581/, // sentencepiece underscore
  ];
  return patterns.some((re) => re.test(s));
}

function nfkc(s) {
  return String(s == null ? '' : s).normalize('NFKC');
}

function looksNumberToken(t) {
  // Digits or numeric code points only. Do not treat Latin letters
  // i/v/x/l/c/d/m as Roman numerals: they appear inside English glosses
  // (Wild, Card, FBI) and would mis-label CER deletions.
  return /^\d+$/.test(String(t)) || /\p{N}/u.test(String(t));
}

function numberEquivalents(token) {
  const map = {
    '0': ['zero', '0', '零', '〇'],
    '1': ['one', '1', '一'],
    '2': ['two', '2', '二', '两'],
    '3': ['three', '3', '三'],
    '4': ['four', '4', '四'],
    '5': ['five', '5', '五'],
    '10': ['ten', '10', '十'],
    '13': ['thirteen', '13', '十三'],
    '24': ['twentyfour', '24'],
    '29': ['twentynine', '29'],
  };
  const t = String(token).toLowerCase();
  for (const [k, vals] of Object.entries(map)) {
    if (vals.includes(t) || t === k) return k;
  }
  return null;
}

function classifyOp(op, lang) {
  if (op.op === 'C') return 'correct';
  if (op.op === 'S') {
    const a = op.ref;
    const b = op.hyp;
    if (a && b && a.toLowerCase && b.toLowerCase && a.toLowerCase() === b.toLowerCase()) {
      return 'case-only';
    }
    const na = numberEquivalents(a);
    const nb = numberEquivalents(b);
    if (na && nb && na === nb) return 'number-itn-equivalent';
    if ((looksNumberToken(a) || na) && (looksNumberToken(b) || nb)) return 'number-form';
    return 'substitution';
  }
  if (op.op === 'D') {
    if (numberEquivalents(op.ref) || looksNumberToken(op.ref)) return 'number-deletion';
    return 'deletion';
  }
  if (numberEquivalents(op.hyp) || looksNumberToken(op.hyp)) return 'number-insertion';
  return 'insertion';
}

function tokensFor(lang, text) {
  if (lang === 'en') return enTokens(text);
  if (lang === 'zh') return zhChars(text);
  if (lang === 'mixed') return mixedTokens(text);
  throw new Error('language ' + lang);
}

function latinCharsKeptInZh(text) {
  const chars = zhChars(text);
  const latin = chars.filter((ch) => /\p{Script=Latin}/u.test(ch));
  return latin;
}

function main() {
  const manifestPath = path.join(FROZEN_DIR, 'MANIFEST.json');
  const hypPath = path.join(RESULTS_DIR, 'hypotheses.json');
  const scorePath = path.join(RESULTS_DIR, 'score.json');
  const summaryPath = path.join(RESULTS_DIR, 'run-summary.json');
  const man = readJson(manifestPath);
  const hyps = readJson(hypPath);
  const official = readJson(scorePath);
  const summary = readJson(summaryPath);

  const byId = new Map();
  for (const row of hyps) byId.set(row.id, row);

  const joined = man.items.map((item) => {
    const row = byId.get(item.id);
    if (!row || typeof row.hypothesis !== 'string') {
      throw new Error('missing hyp ' + item.id);
    }
    return Object.assign({}, item, { hypothesis: row.hypothesis });
  });

  const recomputed = scoreReviewed(joined);
  const ratesMatch = JSON.stringify(recomputed.rates) === JSON.stringify(official.rates);

  const items = [];
  const totals = {
    en: { n: 0, errors: 0, length: 0, S: 0, D: 0, I: 0, C: 0, metric: 'wer' },
    zh: { n: 0, errors: 0, length: 0, S: 0, D: 0, I: 0, C: 0, metric: 'cer' },
    mixed: { n: 0, errors: 0, length: 0, S: 0, D: 0, I: 0, C: 0, metric: 'mer' },
  };
  const classCounts = { en: {}, zh: {}, mixed: {} };
  let controlHits = [];
  let alignMismatch = [];

  for (const item of joined) {
    const lang = item.lang;
    const refTok = tokensFor(lang, item.reference);
    const hypTok = tokensFor(lang, item.hypothesis);
    const aligned = alignTokens(refTok, hypTok);
    const frozenDistance = levenshtein(refTok, hypTok);
    if (aligned.distance !== frozenDistance) {
      alignMismatch.push({ id: item.id, aligned: aligned.distance, frozen: frozenDistance });
    }
    let officialItem = (official.items || []).find((row) => row.id === item.id);
    if (officialItem && officialItem.errors !== frozenDistance) {
      alignMismatch.push({ id: item.id, official: officialItem.errors, frozen: frozenDistance, kind: 'official-vs-frozen' });
    }

    const classified = aligned.ops
      .filter((op) => op.op !== 'C')
      .map((op) => Object.assign({}, op, { class: classifyOp(op, lang) }));
    for (const op of classified) {
      const bucket = classCounts[lang];
      bucket[op.class] = (bucket[op.class] || 0) + 1;
    }

    const control = {
      ref: hasControlToken(item.reference),
      hyp: hasControlToken(item.hypothesis),
    };
    if (control.ref || control.hyp) controlHits.push({ id: item.id, control });

    const latinInZhRef = lang === 'zh' ? latinCharsKeptInZh(item.reference) : [];
    const latinInZhHyp = lang === 'zh' ? latinCharsKeptInZh(item.hypothesis) : [];

    const caseSensitiveEn = lang === 'en'
      ? levenshtein(
        nfkc(item.reference).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean),
        nfkc(item.hypothesis).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
      )
      : null;

    const t = totals[lang];
    t.n += 1;
    t.errors += frozenDistance;
    t.length += refTok.length;
    t.S += aligned.counts.S;
    t.D += aligned.counts.D;
    t.I += aligned.counts.I;
    t.C += aligned.counts.C;

    let mixedDetail = null;
    if (lang === 'mixed') {
      const scored = scoreMixed(item.reference, item.hypothesis);
      mixedDetail = {
        han: scored.han,
        latin: scored.latin,
        ranking: scored.ranking,
      };
    }

    items.push({
      id: item.id,
      lang,
      stratum: item.stratum,
      config: item.config,
      saLocale: item.saLocale,
      officialErrors: officialItem ? officialItem.errors : null,
      officialLength: officialItem ? officialItem.length : null,
      officialRate: officialItem ? officialItem.rate : null,
      frozenErrors: frozenDistance,
      length: refTok.length,
      rate: refTok.length ? frozenDistance / refTok.length : null,
      counts: aligned.counts,
      alignDistanceEqualsFrozen: aligned.distance === frozenDistance,
      rawReference: item.reference,
      rawHypothesis: item.hypothesis,
      nfkcReference: nfkc(item.reference),
      nfkcHypothesis: nfkc(item.hypothesis),
      tokensRef: refTok,
      tokensHyp: hypTok,
      ops: aligned.ops,
      errorOps: classified,
      controlTokens: control,
      latinCharsInZhRef: latinInZhRef,
      latinCharsInZhHyp: latinInZhHyp,
      caseSensitiveEnErrors: caseSensitiveEn,
      mixed: mixedDetail,
    });
  }

  for (const key of Object.keys(totals)) {
    const t = totals[key];
    t.rate = t.length ? t.errors / t.length : null;
  }

  // Diagnostic-only counterfactuals. Not official scores.
  const vulgar = /[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/;
  function splitVulgarEn(s) {
    // After NFKC, 29¾ becomes 293⁄4. A later-version number-aware path would
    // keep the integer and the fraction parts separate: 29, 3, 4.
    let t = nfkc(s);
    t = t.replace(/(\d+)(\d)[⁄/](\d+)/g, '$1 $2 $3');
    return enTokens(t);
  }
  function zhWithoutLatinGloss(s) {
    // Drop Latin letters that survive zhChars because a parenthetical English
    // gloss was stripped of its brackets but not of its letters.
    return zhChars(s).filter((ch) => !/\p{Script=Latin}/u.test(ch));
  }
  function mixedJoinSpelledLatin(tokens) {
    // Join a run of single-character Latin tokens (i s m -> ism). Diagnostic only.
    const out = [];
    let buf = '';
    function flush() {
      if (buf) {
        out.push(buf);
        buf = '';
      }
    }
    for (const tok of tokens) {
      if (/^[a-z]$/i.test(tok)) buf += tok.toLowerCase();
      else {
        flush();
        out.push(tok);
      }
    }
    flush();
    return out;
  }
  function mixedKeepApostrophe(s) {
    const t = nfkc(s).toLowerCase().replace(/['\u2019]/g, '');
    return mixedTokens(t);
  }

  const counterfactual = { note: 'diagnostic-only; official frozen rates are unchanged', variants: {} };

  // A. vulgar-fraction split on English
  let enA = { errors: 0, length: 0 };
  for (const item of joined.filter((x) => x.lang === 'en')) {
    const r = splitVulgarEn(item.reference);
    const h = splitVulgarEn(item.hypothesis);
    enA.errors += levenshtein(r, h);
    enA.length += r.length;
  }
  counterfactual.variants.enVulgarFractionSplit = {
    errors: enA.errors,
    length: enA.length,
    rate: enA.errors / enA.length,
    officialErrors: totals.en.errors,
    officialLength: totals.en.length,
    deltaErrors: enA.errors - totals.en.errors,
  };

  // B. drop Latin gloss letters from Chinese CER
  let zhB = { errors: 0, length: 0 };
  for (const item of joined.filter((x) => x.lang === 'zh')) {
    const r = zhWithoutLatinGloss(item.reference);
    const h = zhWithoutLatinGloss(item.hypothesis);
    zhB.errors += levenshtein(r, h);
    zhB.length += r.length;
  }
  counterfactual.variants.zhDropLatinGlossLetters = {
    errors: zhB.errors,
    length: zhB.length,
    rate: zhB.length ? zhB.errors / zhB.length : null,
    officialErrors: totals.zh.errors,
    officialLength: totals.zh.length,
    deltaErrors: zhB.errors - totals.zh.errors,
    deltaLength: zhB.length - totals.zh.length,
  };

  // C. spelled-out vs Arabic on English (thirteen/13, five/5) after also splitting vulgar fractions
  function foldEnNumbers(tokens) {
    return tokens.map((t) => numberEquivalents(t) || t);
  }
  let enC = { errors: 0, length: 0 };
  for (const item of joined.filter((x) => x.lang === 'en')) {
    const r = foldEnNumbers(splitVulgarEn(item.reference));
    const h = foldEnNumbers(splitVulgarEn(item.hypothesis));
    enC.errors += levenshtein(r, h);
    enC.length += r.length;
  }
  counterfactual.variants.enNumberFoldPlusVulgarSplit = {
    errors: enC.errors,
    length: enC.length,
    rate: enC.errors / enC.length,
    officialErrors: totals.en.errors,
    officialLength: totals.en.length,
    deltaErrors: enC.errors - totals.en.errors,
  };

  // D. ASCEND: join single-letter Latin + drop apostrophes
  let mixD = { errors: 0, length: 0, per: [] };
  for (const item of joined.filter((x) => x.lang === 'mixed')) {
    const r = mixedJoinSpelledLatin(mixedKeepApostrophe(item.reference));
    const h = mixedJoinSpelledLatin(mixedKeepApostrophe(item.hypothesis));
    const e = levenshtein(r, h);
    mixD.errors += e;
    mixD.length += r.length;
    mixD.per.push({ id: item.id, errors: e, length: r.length, ref: r, hyp: h });
  }
  counterfactual.variants.mixedJoinSpelledLettersDropApostrophe = {
    errors: mixD.errors,
    length: mixD.length,
    rate: mixD.length ? mixD.errors / mixD.length : null,
    officialErrors: totals.mixed.errors,
    officialLength: totals.mixed.length,
    deltaErrors: mixD.errors - totals.mixed.errors,
    deltaLength: mixD.length - totals.mixed.length,
    perItem: mixD.per,
  };

  const sources = {
    manifest: { path: manifestPath, sha256: sha256File(manifestPath) },
    hypotheses: { path: hypPath, sha256: sha256File(hypPath) },
    officialScore: { path: scorePath, sha256: sha256File(scorePath) },
    officialSummary: { path: summaryPath, sha256: sha256File(summaryPath) },
    scoreJs: { path: path.join(FROZEN_DIR, 'score.js'), sha256: sha256File(path.join(FROZEN_DIR, 'score.js')) },
    codeswitchJs: { path: path.join(FROZEN_DIR, 'codeswitch-score.js'), sha256: sha256File(path.join(FROZEN_DIR, 'codeswitch-score.js')) },
  };

  const expected = {
    en: { errors: 36, length: 363 },
    zh: { errors: 57, length: 624 },
    mixed: { errors: 24, length: 42 },
  };
  const expectedMatch =
    totals.en.errors === expected.en.errors && totals.en.length === expected.en.length &&
    totals.zh.errors === expected.zh.errors && totals.zh.length === expected.zh.length &&
    totals.mixed.errors === expected.mixed.errors && totals.mixed.length === expected.mixed.length &&
    ratesMatch && alignMismatch.length === 0;

  const report = {
    schema: 'belliedmonkey.sa36-error-audit.v1',
    generatedAt: new Date().toISOString(),
    zone: 'Asia/Shanghai',
    officialRun: 'sa-smoke-aef9aa8f-r1',
    exploratory: true,
    ranking: false,
    productMetric: false,
    approvedPlannedSetCount: 0,
    listenedToAudio: false,
    translationQualityNotScored: true,
    sampleCaveat: 'ASCEND denominator is 6 short clips only and cannot be generalized to continuous dialogue, accent, or noise.',
    frozenRules: {
      en: 'score.js enTokens: NFKC, lower case, replace [^\\p{L}\\p{N}]+ with space, split on whitespace. Metric is WER over those tokens. Denominator is reference token count.',
      zh: 'score.js zhChars: NFKC, delete [\\s\\p{P}\\p{S}]+, remaining code points are characters (including Latin letters that were inside brackets). Metric is CER. Denominator is reference character count after that deletion. Case is not folded.',
      mixed: 'codeswitch-score.js mixedTokens: NFKC, lower case; each Han character is a token; a run of \\p{L}\\p{N} is one Latin/digit token; any other character (apostrophe, space, punctuation) flushes the Latin run. Metric is MER. ranking is false. Denominator is reference mixed-token count. Han and Latin segment distances are diagnostic only and are not added into the official MER.',
      alignmentTieBreak: 'On equal Levenshtein cost, backtrace prefers substitution/match, then deletion, then insertion. Distance is required to equal frozen levenshtein().',
    },
    sources,
    expected,
    recomputedRates: recomputed.rates,
    officialRates: official.rates,
    officialRatesMatchRecomputed: ratesMatch,
    alignmentMatchesFrozenLevenshtein: alignMismatch.length === 0,
    alignMismatch,
    expectedTotalsMatch: expectedMatch,
    totals,
    classCounts,
    controlTokenHits: controlHits,
    counterfactual,
    itemCount: items.length,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'item-alignments.json'), JSON.stringify({
    schema: 'belliedmonkey.sa36-item-alignments.v1',
    officialRatesMatchRecomputed: ratesMatch,
    items,
  }, null, 2) + '\n');

  console.log(JSON.stringify({
    ok: expectedMatch,
    ratesMatch,
    alignMismatch: alignMismatch.length,
    totals,
    classCounts,
    controlTokenHits: controlHits.length,
    counterfactual: counterfactual.variants,
    sources,
  }, null, 2));
}

main();
