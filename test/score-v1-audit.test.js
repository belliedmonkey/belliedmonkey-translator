'use strict';

// Locks score v1. The NFKC fraction glue is a known structural bug.
// These assertions do not rescore the 36 and do not publish a replacement rate.

const { describe, test, eq } = require('./harness');
const { enTokens, zhChars, scorePair } = require('../eval/baselines/asr/score.js');
const { mixedTokens } = require('../eval/baselines/asr/codeswitch-score.js');

describe('score v1 audit locks', () => {
  test('NFKC glues a vulgar fraction onto the preceding number', () => {
    eq(enTokens('29¾').join(','), '293,4');
    eq(enTokens('24½').join(','), '241,2');
    eq(mixedTokens('29¾').join(','), '293,4');
    eq(enTokens('29 3/4').join(','), '29,3,4');
    eq(zhChars('29¾').join(','), '2,9,3,4');
  });

  test('Chinese CER keeps spoken Latin and an edit rate may exceed one', () => {
    const chars = zhChars('联邦调查局 (FBI)');
    eq(chars.indexOf('F') >= 0, true);
    eq(chars.indexOf('B') >= 0, true);
    eq(chars.indexOf('I') >= 0, true);
    eq(enTokens('OK').join(','), 'ok');
    eq(enTokens('ok').join(','), 'ok');
    eq(enTokens('2005/10').join(','), '2005,10');
    eq(mixedTokens('i s m').join(','), 'i,s,m');
    eq(mixedTokens('ISM').join(','), 'ism');
    const over = scorePair({
      id: 'rate-can-exceed-one',
      lang: 'en',
      reference: 'a b c',
      hypothesis: 'd e f g h i',
    });
    eq(over.ok, true);
    eq(over.errors, 6);
    eq(over.length, 3);
    eq(over.rate > 1, true);
    eq(over.productMetric, false);
  });
});
