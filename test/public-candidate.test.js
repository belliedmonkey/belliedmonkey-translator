// Public-candidate intake. Synthetic rows stay labeled and are not measurements.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, eq } = require('./harness');
const { selectDisjointPairs } = require('../eval/baselines/asr/select.js');
const {
  checkCached, safeAudioName, summarizeCandidates, recordFailure, checkAudioSidecar,
} = require('../eval/baselines/asr/fetch-public-candidates.js');
const { checkCatalog } = require('../eval/baselines/default-chain-check.js');

function row(sentenceId, audioName, raw, normalized) {
  return { sentenceId: String(sentenceId), audioName, raw, normalized, numSamples: 16000, speakerLabel: 'FEMALE' };
}

describe('public candidates — not the frozen 16 and not a reviewed set', () => {
  test('pairs only shared sentence ids and skips the frozen baseline', () => {
    const en = [
      row(1660, '1.wav', 'Old.', 'old'),
      row(1668, '9.wav', 'Buy a card.', 'buy a card'),
      row(1668, '2.wav', 'Buy a card.', 'buy a card'),
      row(1670, '3.wav', 'Only English.', 'only english'),
    ];
    const zh = [
      row(1660, '4.wav', '旧。', '旧'),
      row(1668, '8.wav', '买一张卡。', '买一张卡'),
      row(1669, '5.wav', '只有中文。', '只有中文'),
    ];
    const got = selectDisjointPairs(en, zh, ['1660'], 15);
    eq(got.pairs.length, 1);
    eq(got.pairs[0].sentenceId, '1668');
    eq(got.pairs[0].en.audioName, '2.wav');
    eq(got.items.length, 2);
    eq(got.humanVerifiedCount, 0);
    eq(got.alignment, 'shared-flores-sentence-id');
    eq(got.buckets.accent.count, 0);
    eq(got.buckets.accent.status, 'unknown');
    eq(got.buckets.readSpeech.count, 2);
  });

  test('a bad cache hash is not accepted and a traversal name is rejected', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-cache-'));
    const file = path.join(dir, 'tsv');
    fs.writeFileSync(file, 'hello');
    const bad = checkCached(file, 'f'.repeat(64), 5);
    eq(bad.ok, false);
    eq(bad.code, 'checksum-mismatch');
    eq(fs.readFileSync(file, 'utf8'), 'hello');
    eq(checkCached(path.join(dir, 'missing'), 'a'.repeat(64), 1).code, 'missing-cache');
    eq(safeAudioName('../x.wav'), false);
    eq(safeAudioName('/tmp/1.wav'), false);
    eq(safeAudioName('12519810849995407480.wav'), true);
    const receipt = recordFailure(dir, { ok: false, code: 'checksum-mismatch', rates: null, productMetric: false });
    eq(receipt.code, 'checksum-mismatch');
    eq(receipt.rates, null);
    eq(fs.existsSync(path.join(dir, 'summary.json')), true);
    eq(fs.existsSync(path.join(dir, 'MANIFEST.sha256')), true);
    eq(fs.readFileSync(file, 'utf8'), 'hello');
    eq(checkAudioSidecar(dir).code, 'missing-cache');
  });

  test('the approved plan stays empty while public candidates stay unreviewed', () => {
    const report = checkCatalog();
    eq(report.actualCount, 0);
    eq(report.plannedTarget, 30);
    eq(report.realFailures, 0);
    eq(report.approvedPlannedSetCount, 0);
    eq(report.humanVerifiedCount, 0);
    eq(report.productMetric, null);
    eq(report.rates, null);
    const manifest = summarizeCandidates();
    eq(manifest.humanVerifiedCount, 0);
    eq(manifest.approvedPlannedSetCount, 0);
    eq(manifest.realFailureCount, 0);
    eq(manifest.synthetic, false);
    eq(manifest.productMetric, false);
  });
});
