'use strict';
// Tests for docs/qa/checks/entity-check.js — the deterministic number/name check
// that backs the LLM judges.

const { describe, test, ok, eq, deepEq } = require('./harness');
const {
  checkPair, extractNumbers, extractLatinTokens, extractProperish, cnNumber,
} = require('../docs/qa/checks/entity-check.js');

const nums = (s) => extractNumbers(s).sort();

describe('qa entity check', () => {

test('entity-check: plain numbers and thousands separators', () => {
  deepEq(nums('from 1,694 to 2005'), ['1694', '2005'].sort());
  deepEq(nums('10 agents'), ['10']);
});

test('entity-check: composed and mixed fractions', () => {
  deepEq(nums('29¾ inches by 24½'), ['24.5', '29.75'].sort());
  deepEq(nums('29又四分之三英寸'), ['29.75']);
  deepEq(nums('24有二分之一英寸'), ['24.5']);
  deepEq(nums('29, 3/4 inches'), ['29.75']);
  deepEq(nums('two and a half hours'), ['2.5']);
});

test('entity-check: superscripts and exponents', () => {
  deepEq(nums('10¹² parts'), ['1012']);
  deepEq(nums('10⁻¹²'), ['10^-12']);
  deepEq(nums('10−12'), ['10^-12']);
});

test('entity-check: Chinese numerals need a measure word', () => {
  deepEq(nums('十三个州'), ['13']);
  deepEq(nums('五倍'), ['5']);
  deepEq(nums('一些公园'), []);       // 一 is an article here
  deepEq(nums('一张万能卡'), []);      // same
  deepEq(nums('二十四'), []);
});

test('entity-check: English number words', () => {
  deepEq(nums('ten agents'), ['10']);
  deepEq(nums('five times the force'), ['5']);
  deepEq(nums('no one knows'), []); // pronoun, not a number
});

test('entity-check: ratios stay whole', () => {
  deepEq(nums('1:1 and 3:2 and 5:2'), ['1:1', '3:2', '5:2']);
  deepEq(nums('1:1'), ['1:1']);
});

test('entity-check: cnNumber', () => {
  eq(cnNumber('十三'), 13);
  eq(cnNumber('二十四'), 24);
  eq(cnNumber('两百'), 200);
  eq(cnNumber('一千零五'), 1005);
  eq(cnNumber('一些'), null);
});

test('entity-check: a missing number fails the pair', () => {
  const r = checkPair({ source: 'The FBI must assign 10 agents.', translation: '联邦调查局必须指派探员。' });
  eq(r.status, 'fail');
  deepEq(r.missingNumbers, ['10']);
});

test('entity-check: spelled-out numbers satisfy the digit', () => {
  const r = checkPair({ source: '必须指派 10 名探员', translation: 'must assign ten agents' });
  eq(r.status, 'ok');
});

test('entity-check: an English month satisfies 12月', () => {
  const r = checkPair({ source: '于当年12月的一篇论文', translation: 'in a paper that December' });
  eq(r.status, 'ok');
  const bad = checkPair({ source: '于当年12月的一篇论文', translation: 'in a paper that year' });
  eq(bad.status, 'fail');
});

test('entity-check: a Latin token dropped from a Chinese source warns', () => {
  const r = checkPair({ source: '买一张万能卡（Wild Card）也有不少好处，带着这张卡可以进入南非的一些公园。', translation: 'Buying a Universal Card also has many benefits.' });
  eq(r.status, 'warn');
  deepEq(r.missingTerms, ['Wild']);
});

test('entity-check: glossary accepts listed renderings', () => {
  const g = [{ term: 'Wild Card', accept: ['Wild Card'] }];
  eq(checkPair({ source: 'buy a Wild Card', translation: '购买 Wild Card', glossary: g }).status, 'ok');
  eq(checkPair({ source: 'buy a Wild Card', translation: '购买野生卡', glossary: g }).status, 'warn');
});

test('entity-check: glossary matches whole Latin words only', () => {
  const g = [{ term: 'Sie', accept: ['Sie', '您'] }];
  // "Messier" contains the letters "sie" but is not the German pronoun.
  eq(checkPair({ source: 'The Messier catalogue', translation: '梅西耶星表', glossary: g }).status, 'ok');
  eq(checkPair({ source: 'the word Sie for you', translation: 'the letter C', glossary: g }).status, 'warn');
});

test('entity-check: names are reported as info, not as a defect', () => {
  const r = checkPair({ source: 'said Glen Cushing of the USGS', translation: '美国地质调查局的格伦·卡辛表示' });
  eq(r.status, 'ok');
  ok(r.infoNames.includes('Cushing'));
  ok(r.infoNames.includes('Glen'));
});

test('entity-check: latin token extraction and properish', () => {
  deepEq(extractLatinTokens('the USGS and FBI'), ['the', 'USGS', 'and', 'FBI']);
  ok(extractProperish('said Oliver Sacks in Flagstaff').includes('Oliver'));
  ok(!extractProperish('The cat sat').includes('The'));
});

test('entity-check: empty inputs do not throw', () => {
  eq(checkPair({ source: '', translation: '' }).status, 'ok');
  deepEq(extractNumbers(null), []);
});
});
