// Scorer correctness only. The FLEURS references are not used as hypotheses.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { describe, test, ok, eq } = require('./harness');
const { scorePair, scoreFrozen } = require('../eval/baselines/asr/score.js');
const { parseTsv, selectFirst } = require('../eval/baselines/asr/select.js');

const ROOT = path.join(__dirname, '..');
const fleurs = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/fleurs-public-v1.json'), 'utf8'));
const tool = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/baselines/fixtures/asr-score-tool-only.json'), 'utf8'));
const samples = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/baselines/samples.json'), 'utf8'));

describe('public ASR scorer — tool correctness, not a product metric', () => {
  test('English punctuation and case share one token sequence', () => {
    const row = scorePair({ id: 't', lang: 'en', reference: 'Hello, World!', hypothesis: 'hello world' });
    eq(row.ok, true);
    eq(row.metric, 'wer');
    eq(row.errors, 0);
    eq(row.rate, 0);
    eq(row.productMetric, false);
  });

  test('one substituted English word is one error over three tokens', () => {
    const row = scorePair({ id: 't', lang: 'en', reference: 'a b c', hypothesis: 'a x c' });
    eq(row.errors, 1);
    eq(row.length, 3);
    eq(row.rate, 1 / 3);
  });

  test('Chinese punctuation is ignored and the rate is character error rate', () => {
    const same = scorePair({ id: 't', lang: 'zh', reference: '今天，天气。', hypothesis: '今天天气' });
    eq(same.metric, 'cer');
    eq(same.errors, 0);
    const miss = scorePair({ id: 't', lang: 'zh', reference: '今天天气', hypothesis: '今天天' });
    eq(miss.errors, 1);
    eq(miss.length, 4);
  });

  test('an empty reference does not produce a rate', () => {
    const row = scorePair({ id: 't', lang: 'en', reference: '!!!', hypothesis: 'hello' });
    eq(row.ok, false);
    eq(row.reason, 'empty-reference');
    eq(row.rate, undefined);
  });

  test('an empty hypothesis is all deletions and is marked empty', () => {
    const row = scorePair({ id: 't', lang: 'zh', reference: '今天天气', hypothesis: '' });
    eq(row.ok, true);
    eq(row.emptyHypothesis, true);
    eq(row.errors, 4);
    eq(row.rate, 1);
  });

  test('missing, unknown, and duplicate ids do not invent a combined rate', () => {
    const set = tool;
    const missing = scoreFrozen(set, [{ id: 'en-1', hypothesis: 'hello world' }]);
    eq(missing.ok, false);
    eq(missing.reason, 'missing-hypothesis');
    eq(missing.missing[0], 'zh-1');
    eq(missing.rates.zh, undefined);
    const unknown = scoreFrozen(set, [
      { id: 'en-1', hypothesis: 'hello world' },
      { id: 'zh-1', hypothesis: '今天天气' },
      { id: 'extra', hypothesis: 'nope' },
    ]);
    eq(unknown.reason, 'unknown-id');
    eq(unknown.unknown[0], 'extra');
    const dup = scoreFrozen(set, [
      { id: 'en-1', hypothesis: 'hello' },
      { id: 'en-1', hypothesis: 'hello world' },
      { id: 'zh-1', hypothesis: '今天天气' },
    ]);
    eq(dup.ok, false);
    eq(dup.reason, 'duplicate-id');
    eq(dup.rates, null);
  });

  test('no hypothesis file does not score references against themselves', () => {
    const out = scoreFrozen(fleurs, null);
    eq(out.ok, false);
    eq(out.reason, 'no-hypothesis');
    eq(out.rates, null);
    eq(out.productMetric, false);
    eq(out.publicComparison, true);
  });

  test('the tool-only fixture can prove a zero only on its own synthetic strings', () => {
    const out = scoreFrozen(tool, [
      { id: 'en-1', hypothesis: 'Hello, world!' },
      { id: 'zh-1', hypothesis: '今天，天气' },
    ]);
    eq(out.ok, true);
    eq(out.toolOnly, true);
    eq(out.productMetric, false);
    eq(out.byLang.en.rate, 0);
    eq(out.byLang.zh.rate, 0);
    eq(out.byLang.en.metric, 'wer');
    eq(out.byLang.zh.metric, 'cer');
  });

  test('the frozen FLEURS slice is 8 plus 8, hashed, and outside samples-0', () => {
    eq(fleurs.kind, 'public-comparison');
    eq(fleurs.productMetric, false);
    eq(fleurs.items.length, 16);
    const langs = { en: 0, zh: 0 };
    const ids = new Set();
    for (const item of fleurs.items) {
      langs[item.lang] += 1;
      ok(!ids.has(item.id), 'duplicate ' + item.id);
      ids.add(item.id);
      const digest = crypto.createHash('sha256').update(item.reference, 'utf8').digest('hex');
      eq(digest, item.referenceSha256);
      ok(item.reference !== item.raw);
    }
    eq(langs.en, 8);
    eq(langs.zh, 8);
    eq(samples.version, 'samples-0');
    eq(samples.records.length, 0);
    eq(fleurs.audio.fetched, false);
  });

  test('selection keeps the first audio of each sentence id', () => {
    const text = [
      '2\tb.wav\traw two\tnorm two\tchars\t16000\tMALE',
      '1\tz.wav\traw one late\tnorm one\tchars\t16000\tFEMALE',
      '1\ta.wav\traw one early\tnorm one early\tchars\t16000\tMALE',
      '3\t\t\t\t\t\t',
    ].join('\n');
    const rows = selectFirst(parseTsv(text), 2);
    eq(rows.length, 2);
    eq(rows[0].sentenceId, '1');
    eq(rows[0].audioName, 'a.wav');
    eq(rows[1].audioName, 'b.wav');
  });
});
