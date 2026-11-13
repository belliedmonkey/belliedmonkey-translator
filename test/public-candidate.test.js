// Public-candidate intake. Synthetic rows stay labeled and are not measurements.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, eq } = require('./harness');
const { selectDisjointPairs } = require('../eval/baselines/asr/select.js');
const {
  checkCached, safeAudioName, summarizeCandidates, recordFailure, checkAudioSidecar,
  audioCoverage, verifyAudioFiles, mergeSidecar, publishSidecar, publicCandidateCache,
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
    const text = JSON.parse(fs.readFileSync(path.join(__dirname, '../eval/baselines/asr/public-candidates-v1.json'), 'utf8'));
    const side = JSON.parse(fs.readFileSync(path.join(__dirname, '../eval/baselines/asr/public-candidates-audio-v1.json'), 'utf8'));
    const covered = audioCoverage(text.items, side.items.slice(0, 2));
    eq(text.items.length, 30);
    eq(covered.ok, false);
    eq(covered.code, 'audio-incomplete');
    eq(covered.audioScope, 30);
    eq(checkAudioSidecar(dir).ok, false);
    eq(checkAudioSidecar(dir).code === 'missing-cache' || checkAudioSidecar(dir).code === 'audio-incomplete', true);
  });

  test('the default audio check is all 30, and a freeze cannot replace a pinned hash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-scope-'));
    const rows = [];
    for (let i = 0; i < 30; i++) {
      const body = Buffer.from('wav' + i);
      rows.push({
        sentenceId: String(3000 + i),
        config: i % 2 === 0 ? 'en_us' : 'cmn_hans_cn',
        audioName: String(200000 + i) + '.wav',
        bytes: body.length,
        sha256: crypto.createHash('sha256').update(body).digest('hex'),
        sampleRate: 16000,
        samples: 16000,
      });
    }
    for (let i = 0; i < 29; i++) {
      const dest = path.join(dir, rows[i].config);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, rows[i].audioName), Buffer.from('wav' + i));
    }
    const missing = verifyAudioFiles(dir, rows);
    eq(missing.ok, false);
    eq(missing.code, 'missing-cache');
    eq(missing.audioScope, 30);
    eq(missing.audioCount, 29);
    fs.mkdirSync(path.join(dir, rows[29].config), { recursive: true });
    fs.writeFileSync(path.join(dir, rows[29].config, rows[29].audioName), Buffer.from('nope'));
    const bad = verifyAudioFiles(dir, rows);
    eq(bad.ok, false);
    eq(bad.code, 'checksum-mismatch');
    eq(fs.readFileSync(path.join(dir, rows[29].config, rows[29].audioName), 'utf8'), 'nope');
    const pinned = 'd6ab97bb7e3232b60b61910d3ac7e1cf37acbcbfd062773b453c76217682f49e';
    const previous = {
      items: [{
        sentenceId: '1668', config: 'en_us', audioName: '12519810849995407480.wav',
        bytes: 852538, sha256: pinned, sampleRate: 16000, samples: 213120,
      }],
    };
    let code = '';
    try {
      mergeSidecar(previous, [{
        sentenceId: '1668', config: 'en_us', audioName: '12519810849995407480.wav',
        bytes: 852538, sha256: 'a'.repeat(64), sampleRate: 16000, samples: 213120,
      }]);
    } catch (err) { code = err.code; }
    eq(code, 'hash-pin');
    eq(previous.items[0].sha256, pinned);
    const added = mergeSidecar(previous, [
      previous.items[0],
      {
        sentenceId: '1669', config: 'en_us', audioName: '1.wav',
        bytes: 4, sha256: 'b'.repeat(64), sampleRate: 16000, samples: 16000, durationSeconds: 1,
      },
    ]);
    eq(added.items[0].sha256, pinned);
    eq(added.items.length, 2);
    const sidePath = path.join(dir, 'side.json');
    fs.writeFileSync(sidePath, '{"keep":true}\n');
    eq(publishSidecar(sidePath, added, 'verify'), false);
    eq(fs.readFileSync(sidePath, 'utf8'), '{"keep":true}\n');
    eq(publicCandidateCache(path.join(__dirname, '../eval/baselines/asr/.cache/audio')).code, 'cache-mix');
    eq(publicCandidateCache(dir).ok, true);
  });

  test('the approved plan stays empty while public candidates stay unreviewed', () => {
    const report = checkCatalog();
    eq(report.actualCount, 0);
    eq(report.plannedTarget, 30);
    eq(report.realFailures, 0);
    eq(report.approvedPlannedSetCount, 0);
    eq(report.humanVerifiedCount, 1);
    eq(report.publicCandidateHumanVerifiedCount, 0);
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
