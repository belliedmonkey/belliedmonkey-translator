// Scorer correctness only. The FLEURS references are not used as hypotheses.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { describe, test, ok, eq } = require('./harness');
const zlib = require('zlib');
const { scorePair, scoreFrozen } = require('../eval/baselines/asr/score.js');
const { parseTsv, selectFirst } = require('../eval/baselines/asr/select.js');
const { createTarCollector } = require('../eval/baselines/asr/tar-member.js');
const { wavInfo } = require('../eval/baselines/asr/wav-info.js');

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
    eq(missing.rates, null);
    eq(missing.diagnostic.note, 'not-a-score');
    const unknown = scoreFrozen(set, [
      { id: 'en-1', hypothesis: 'hello world' },
      { id: 'zh-1', hypothesis: '今天天气' },
      { id: 'extra', hypothesis: 'nope' },
    ]);
    eq(unknown.reason, 'unknown-id');
    eq(unknown.unknown[0], 'extra');
    eq(unknown.rates, null);
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
    eq(fleurs.audio.inGit, false);
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

  test('a missing hypothesis field is not an empty recognizer string', () => {
    const missing = scorePair({ id: 't', lang: 'en', reference: 'hello world' });
    eq(missing.ok, false);
    eq(missing.reason, 'hypothesis-type');
    eq(missing.rate, undefined);
    const numeric = scorePair({ id: 't', lang: 'en', reference: 'hello world', hypothesis: 0 });
    eq(numeric.reason, 'hypothesis-type');
    const explicit = scorePair({ id: 't', lang: 'zh', reference: '今天天气', hypothesis: '' });
    eq(explicit.ok, true);
    eq(explicit.emptyHypothesis, true);
  });

  test('feeding reference-only rows back as hypotheses yields no official rate', () => {
    const refused = scoreFrozen(fleurs, fleurs.items);
    eq(refused.ok, false);
    eq(refused.reason, 'hypothesis-type');
    eq(refused.rates, null);
    eq(refused.diagnostic.note, 'not-a-score');
    eq(refused.items.length, 0);
  });

  test('an invalid hypothesis type on a complete id list still has null rates', () => {
    const out = scoreFrozen(tool, [
      { id: 'en-1', hypothesis: 'hello world' },
      { id: 'zh-1', hypothesis: null },
    ]);
    eq(out.ok, false);
    eq(out.reason, 'hypothesis-type');
    eq(out.rates, null);
  });

  test('cmn 1663 keeps the published mixed reference, including the Latin name', () => {
    const row = fleurs.items.find((item) => item.id === 'cmn_hans_cn/1663/17125746560393607835.wav');
    eq(row.reference, '智利首选登山目的地科茶莫山谷 cochamó valley 被称为南美洲的优胜美地 yosemite这里有各式各样的花岗岩大石壁和峭壁');
    ok(row.reference.indexOf('cochamó valley') >= 0);
    ok(row.reference.indexOf('浪 漫') < 0);
  });

  test('cached wav metadata is recorded and the bytes are not part of the set file', () => {
    eq(fleurs.audio.fetched, true);
    eq(fleurs.audio.inGit, false);
    eq(fleurs.audio.compressedBytes, 489272487);
    for (const item of fleurs.items) {
      eq(typeof item.audioSha256, 'string');
      eq(item.audioSha256.length, 64);
      ok(item.audioBytes > 0);
      eq(item.wavSamples, item.numSamples);
      ok(item.audioCache.endsWith('/' + item.audioName));
    }
  });
});

function tarHeader(name, size) {
  const b = Buffer.alloc(512);
  b.write(name, 0, Math.min(name.length, 100), 'utf8');
  b.write('0000644\0', 100);
  b.write('0000000\0', 108);
  b.write('0000000\0', 116);
  b.write(size.toString(8).padStart(11, '0') + '\0', 124);
  b.write('00000000000\0', 136);
  b.write('        ', 148);
  b[156] = 48;
  b.write('ustar\0', 257);
  b.write('00', 263);
  let sum = 0;
  for (const x of b) sum += x;
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}

function pad(size) {
  const n = size % 512 === 0 ? 0 : 512 - (size % 512);
  return Buffer.alloc(n);
}

describe('tar and wav readers — tool correctness for the audio cache', () => {
  test('gzip tar keeps only the requested basename and ignores the other member', () => {
    const keep = Buffer.from('RIFF-keep');
    const drop = Buffer.from('not-this-audio');
    const raw = Buffer.concat([
      tarHeader('en_us/keep.wav', keep.length), keep, pad(keep.length),
      tarHeader('en_us/drop.wav', drop.length), drop, pad(drop.length),
      Buffer.alloc(1024),
    ]);
    const gz = zlib.gzipSync(raw);
    const collector = createTarCollector(['keep.wav']);
    const gunzip = zlib.gunzipSync(gz);
    collector.push(gunzip);
    eq(collector.found.size, 1);
    eq(collector.found.get('keep.wav').toString(), 'RIFF-keep');
  });

  test('a tiny PCM wav reports samples and duration', () => {
    const data = Buffer.alloc(8);
    data.writeInt16LE(1000, 0);
    data.writeInt16LE(-1000, 2);
    data.writeInt16LE(500, 4);
    data.writeInt16LE(-500, 6);
    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(1, 0);
    fmt.writeUInt16LE(1, 2);
    fmt.writeUInt32LE(16000, 4);
    fmt.writeUInt32LE(32000, 8);
    fmt.writeUInt16LE(2, 12);
    fmt.writeUInt16LE(16, 14);
    const chunks = Buffer.concat([
      Buffer.from('fmt '), u32(fmt.length), fmt,
      Buffer.from('data'), u32(data.length), data,
    ]);
    const wav = Buffer.concat([
      Buffer.from('RIFF'), u32(4 + chunks.length), Buffer.from('WAVE'), chunks,
    ]);
    const info = wavInfo(wav);
    ok(info);
    eq(info.sampleRate, 16000);
    eq(info.channels, 1);
    eq(info.samples, 4);
    eq(info.durationSeconds, 4 / 16000);
    eq(wavInfo(Buffer.from('not a wav')), null);
  });
});

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
