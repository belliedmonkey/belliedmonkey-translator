'use strict';
// Deterministic entity and number check for translation pairs.
//
// Why: the two LLM judges miss name/number errors systematically (calibration on
// 2026-11-18 put entities_numbers TPR at 38.5%, and both judges missed a brand
// name, a police rank and a transliteration). A mechanical check cannot cover
// every name, but it can cover the part that has an exact answer.
//
// Three levels, deliberately asymmetric:
//   fail  a number in the source has no counterpart in the translation
//   warn  a Latin token in a non-Latin source disappeared from the translation
//   info  a capitalised token in an English source is absent from a Chinese
//         translation (reading aid; legitimate transliteration trips this)
//
// The check never decides that a translation is good. It decides which pairs a
// human or judge must look at.
//
// No dependencies, no network. Pure functions so it can run in the test suite.

'use strict';

const MEASURES = [
  '个', '名', '位', '条', '次', '倍', '年', '月', '日', '天', '小时', '分钟', '秒',
  '米', '公里', '英寸', '英尺', '州', '种', '份', '张', '块', '页', '章', '人', '岁',
  '美元', '元', '度', '成', '万', '亿',
];

const EN_ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6,
  billion: 1e9, dozen: 12,
};

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

const STOP_CAP = new Set(('The A An In It Its This That These Those He She They We I His Her Their Our Your My As At On For With But And Or If When While Although Because During After Before From To Of By Not No All Some Many Most Other Such Then There Here What Who Which How Why').split(' '));

function round(v) { return Math.round(v * 1e6) / 1e6; }

// Chinese numerals: 十 / 十三 / 二十四 / 一百零五 / 两千.
function cnNumber(s) {
  let total = 0, section = 0, digit = 0, seen = false;
  for (const ch of s) {
    if (ch in CN_DIGIT) { digit = CN_DIGIT[ch]; seen = true; }
    else if (ch === '十') { section += (digit || 1) * 10; digit = 0; seen = true; }
    else if (ch === '百') { section += (digit || 1) * 100; digit = 0; seen = true; }
    else if (ch === '千') { section += (digit || 1) * 1000; digit = 0; seen = true; }
    else if (ch === '万') { total += (section + digit) * 10000; section = 0; digit = 0; seen = true; }
    else return null;
  }
  return seen ? total + section + digit : null;
}

// Every numeric value the text asserts. Ratios stay whole ("3:2") because 3 and
// 2 on their own are not numbers the translation has to repeat.
function extractNumbers(text) {
  const out = [];
  let t = String(text == null ? '' : text);

  // Superscript digits and the unicode minus appear in science text.
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => '0123456789'['⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)])
    .replace(/[−–]/g, '-').replace(/⁻/g, '-').replace(/⁺/g, '+');

  const exponents = [];
  t = t.replace(/10\s*\^?\s*-\s*(\d+)/g, (m, e) => { exponents.push('10^-' + e); return ' '; });

  // Normalise composed fractions and mixed fractions to decimals.
  // Chinese fractions: 29又四分之三, 24有二分之一.
  t = t.replace(/(\d+)\s*又\s*([零〇一二两三四五六七八九十百]+)\s*分\s*之\s*([零〇一二两三四五六七八九十百]+)/g,
    (m, a, b, c) => { const d = cnNumber(b), e = cnNumber(c); return d && e ? ' ' + round(Number(a) + e / d) + ' ' : m; })
    .replace(/(\d+)\s*,\s*(\d+)\s*\/\s*(\d+)/g, (_, a, b, c) => ' ' + round(Number(a) + Number(b) / Number(c)) + ' ')
    .replace(/(\d+)\s+and\s+(?:a\s+)?half/gi, (_, a) => ' ' + round(Number(a) + 0.5) + ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+and\s+(?:a\s+)?half\b/gi,
      (_, w) => ' ' + round(EN_ONES[w.toLowerCase()] + 0.5) + ' ')
    .replace(/(\d+)\s*有\s*([零〇一二两三四五六七八九十百]+)\s*分\s*之\s*([零〇一二两三四五六七八九十百]+)/g,
    (m, a, b, c) => { const d = cnNumber(b), e = cnNumber(c); return d && e ? ' ' + round(Number(a) + e / d) + ' ' : m; })
    .replace(/(\d+)\s*¾/g, (_, a) => ' ' + round(Number(a) + 0.75) + ' ')
    .replace(/(\d+)\s*½/g, (_, a) => ' ' + round(Number(a) + 0.5) + ' ')
    .replace(/(\d+)\s*¼/g, (_, a) => ' ' + round(Number(a) + 0.25) + ' ')
    .replace(/¾/g, ' 0.75 ').replace(/½/g, ' 0.5 ').replace(/¼/g, ' 0.25 ')
    .replace(/(\d+)\s*又\s*(\d+)\s*\/\s*(\d+)/g, (_, a, b, c) => ' ' + round(Number(a) + Number(b) / Number(c)) + ' ')
    .replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (_, a, b, c) => ' ' + round(Number(a) + Number(b) / Number(c)) + ' ')
    .replace(/(\d+)\s*有\s*(\d+)\s*分\s*之\s*(\d+)/g, (_, a, b, c) => ' ' + round(Number(a) + Number(c) / Number(b)) + ' ');

  // Regnal numbers: 威廉一世 <-> William III.
  for (const m of String(text).matchAll(/([\u4e00-\u9fff]{1,6})([一二三四五六七八九十]{1,3})世(?!纪)/g)) {
    const v = cnNumber(m[2]);
    if (v != null) out.push(String(round(v)));
  }
  const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  for (const m of String(text).matchAll(/\b([A-Z][a-z]+)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)\b/g)) out.push(String(roman[m[2]]));

  // Ratios first, then remove them so their parts are not counted twice.
  const ratios = [];
  t = t.replace(/(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)/g, (m, a, b) => {
    ratios.push(a + ':' + b);
    return ' ';
  });

  // Plain decimals, with thousands separators.
  const plain = t.replace(/(?<=\d),(?=\d{3}\b)/g, '');
  for (const m of plain.matchAll(/\d+(?:\.\d+)?/g)) out.push(m[0]);

  for (const r of ratios) out.push(r);
  for (const e of exponents) out.push(e);

  // English number words.
  for (const m of t.matchAll(/\b([A-Za-z]+)\b/g)) {
    const w = m[1].toLowerCase();
    if (!(w in EN_ONES)) continue;
    const before = t.slice(Math.max(0, m.index - 14), m.index);
    const after = t.slice(m.index + m[1].length, m.index + m[1].length + 10);
    if (/\d\s*$/.test(before)) continue; // "3 hundred" already counted
    if (w === 'one' && (/\b(no|any|every|some|each)\s+$/i.test(before) || /^\s+of\b/i.test(after))) continue;
    out.push(String(EN_ONES[w]));
  }

  // Chinese numerals, only when a measure word or unit follows, to keep 一些 and
  // 第一 out of the set.
  const cnRe = new RegExp('([零〇一二两三四五六七八九十百千万]{1,8})\\s*(?:' + MEASURES.join('|') + ')', 'g');
  for (const m of t.matchAll(cnRe)) {
    if (m[1] === '一') continue; // 一张 / 一个 = an indefinite article, not the number 1
    const v = cnNumber(m[1]);
    if (v != null) out.push(String(round(v)));
  }

  return [...new Set(out.map((x) => (x.includes(':') || x.includes('^') ? x : String(round(Number(x))))))];
}

function extractLatinTokens(text) {
  const out = new Set();
  for (const m of String(text == null ? '' : text).matchAll(/[A-Za-z][A-Za-z0-9'’.\-]*/g)) {
    if (m[0].length >= 2) out.add(m[0]);
  }
  return [...out];
}

// Capitalised tokens that are not sentence-initial and not a common word.
function extractProperish(text) {
  const out = new Set();
  const s = String(text == null ? '' : text);
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9'’.\-]*/g)) {
    const w = m[0];
    const before = s.slice(0, m.index).replace(/\s+$/, '');
    if (w.length < 2) continue;
    if (/\d/.test(w)) { out.add(w); continue; }
    if (w === w.toUpperCase() && /^[A-Z]{2,6}$/.test(w)) { out.add(w); continue; }
    if (!/^[A-Z]/.test(w)) continue;
    if (STOP_CAP.has(w)) continue;
    if (!before || /[.!?:"“”]$/.test(before)) continue;
    out.add(w);
  }
  return [...out];
}

function hasToken(haystack, needle) {
  const n = String(needle);
  if (/^[\x00-\x7F\s]+$/.test(n)) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^A-Za-z0-9])' + esc + '($|[^A-Za-z0-9])', 'i').test(String(haystack));
  }
  return String(haystack).includes(n);
}

/**
 * @param {{source:string, translation:string, targetLang?:string, glossary?:Array<string|{term:string,accept?:string[]}>}} pair
 * @returns {{status:'ok'|'warn'|'fail', missingNumbers:string[], missingTerms:string[], infoNames:string[], checked:{numbers:number, terms:number}}}
 */
function checkPair(pair) {
  const source = pair.source || '';
  const translation = pair.translation || '';
  const targetLang = pair.targetLang || '';
  const glossary = Array.isArray(pair.glossary) ? pair.glossary : [];

  const srcNums = extractNumbers(source);
  const tgtNums = new Set(extractNumbers(translation));
  let missingNumbers = srcNums.filter((n) => !tgtNums.has(n));
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  missingNumbers = missingNumbers.filter((n) => {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 1 || v > 12) return true;
    if (!new RegExp('(^|[^0-9])' + v + '\\s*月').test(source)) return true;
    const m = MONTHS[v - 1];
    return !new RegExp('\\b' + m + '\\b|\\b' + m.slice(0, 3) + '\\b', 'i').test(translation);
  });

  // "a card" / "一张卡" / "one of" all assert the value 1 without a digit.
  const regnalSource = /[一二三四五六七八九十]{1,3}世(?!纪)/.test(source);
  if (!regnalSource && missingNumbers.includes('1') && /(一个|一名|一项|一种|一张|一位|一条|\bone\b|\ba\b|\ban\b)/i.test(translation)) {
    missingNumbers = missingNumbers.filter((n) => n !== '1');
  }

  let missingTerms = [];
  let checkedTerms = 0;

  // Latin tokens in a non-Latin source are names, brands or codes: the
  // translation is expected to carry them through.
  const cjk = (source.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinLetters = (source.match(/[A-Za-z]/g) || []).length;
  const sourceIsLatin = cjk === 0;
  // Mixed-language (code-switch) sources put ordinary English words next to
  // Chinese; those get translated, so only a mostly-Chinese source is checked for
  // Latin tokens that must survive.
  const mostlyCjk = cjk > 0 && cjk / (cjk + latinLetters) > 0.6;
  if (!sourceIsLatin && mostlyCjk) {
    const latin = extractLatinTokens(source);
    const DELIM = /[\s（(「“\"',.;:!?、，。；：！？）)」”]/;
    const keep = [];
    for (const m of source.matchAll(/[A-Za-z][A-Za-z0-9'’.\-]*/g)) {
      if (m[0].length < 2) continue;
      const prev = m.index === 0 ? '' : source[m.index - 1];
      const next = source[m.index + m[0].length] || '';
      const isolated = (!prev || DELIM.test(prev)) && (!next || DELIM.test(next));
      if (isolated || /[A-Z0-9]/.test(m[0])) keep.push(m[0]);
    }
    const checked = [...new Set(keep)];
    checkedTerms += checked.length;
    missingTerms = missingTerms.concat(checked.filter((t) => !hasToken(translation, t)));
  }

  for (const entry of glossary) {
    const term = typeof entry === 'string' ? entry : entry && entry.term;
    if (!term || !hasToken(source, term)) continue;
    checkedTerms += 1;
    const accept = (typeof entry === 'string' ? [term] : [term].concat(entry.accept || []));
    if (!accept.some((a) => hasToken(translation, a))) missingTerms.push(term);
  }

  // Latin that appears in a Chinese translation but nowhere in the source is a
  // fabricated name until proven otherwise.
  const fabricated = [];
  if (/[\u4e00-\u9fff]/.test(translation)) {
    for (const m of translation.matchAll(/[A-Za-z][A-Za-z0-9'’.\-]*/g)) {
      if (m[0].length < 3) continue;
      if (!hasToken(source, m[0])) fabricated.push(m[0]);
    }
  }

  let infoNames = [];
  if (sourceIsLatin && /[\u4e00-\u9fff]/.test(translation)) {
    infoNames = extractProperish(source).filter((t) => !hasToken(translation, t));
  }

  // Deduplicate while keeping order.
  missingTerms = [...new Set(missingTerms)];
  const status = missingNumbers.length ? 'fail' : missingTerms.length ? 'warn' : 'ok';
  if (fabricated.length && status === 'ok') {
    // do not change status here; surfaced separately below
  }
  return {
    status: status === 'ok' && fabricated.length ? 'warn' : status,
    missingNumbers,
    missingTerms: missingTerms.concat(fabricated.length ? ['unexplained-latin:' + [...new Set(fabricated)].join(',')] : []),
    infoNames,
    checked: { numbers: srcNums.length, terms: checkedTerms },
  };
}

module.exports = { checkPair, extractNumbers, extractLatinTokens, extractProperish, cnNumber };
