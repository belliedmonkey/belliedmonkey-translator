// Blank listening sheet. Empty reviewer fields are not a human pass.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, eq } = require('./harness');
const { blankRow, writeReviewPack, forbiddenPackDir, planFromDisk } = require('../eval/baselines/asr/make-review-pack.js');

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('review pack — blank sheet, not an approval', () => {
  test('reviewer fields stay empty and the row is not a pass', () => {
    const row = blankRow({
      id: 'cmn_hans_cn/1663/17125746560393607835.wav',
      role: 'focus',
      sentenceId: '1663',
      config: 'cmn_hans_cn',
      audioName: '17125746560393607835.wav',
      reference: 'ref',
      raw: 'raw (Cochamó Valley)',
      audioSha256: 'ab',
      bytes: 3,
      durationSeconds: 1,
    });
    eq(row.humanReviewer, '');
    eq(row.humanTime, '');
    eq(row.humanTranscript, '');
    eq(row.humanEvidence, '');
    eq(row.verdict, '');
    eq(row.latinParentheticalSpoken, '');
    eq(row.transcriptMismatchOrUncertain, '');
    eq(row.approved, false);
    eq(row.humanReviewed, false);
    eq(row.questions.indexOf('括注拉丁是否实际读出') >= 0, true);
    eq(row.questions.indexOf('音频转写不符/不确定') >= 0, true);
  });

  test('a bad hash is not packed, and the scoring cache is not a destination', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-pack-'));
    const src = path.join(dir, 'src.wav');
    fs.writeFileSync(src, 'wav');
    const digest = sha(Buffer.from('wav'));
    const bad = writeReviewPack(path.join(dir, 'out'), [{
      id: 'x',
      role: 'public-candidate',
      sentenceId: '1',
      config: 'en_us',
      audioName: '1.wav',
      reference: 'r',
      raw: 'r',
      audioSha256: 'f'.repeat(64),
      bytes: 3,
      durationSeconds: 1,
      sourcePath: src,
    }]);
    eq(bad.ok, false);
    eq(bad.code, 'checksum-mismatch');
    eq(fs.existsSync(path.join(dir, 'out', 'MANIFEST.json')), false);
    eq(forbiddenPackDir(path.join('eval/baselines/asr/.cache/audio/pack')).code, 'cache-mix');
    const good = writeReviewPack(path.join(dir, 'good'), [{
      id: 'cmn_hans_cn/1663/a.wav',
      role: 'focus',
      sentenceId: '1663',
      config: 'cmn_hans_cn',
      audioName: '1.wav',
      reference: 'ref',
      raw: 'raw (Latin)',
      audioSha256: digest,
      bytes: 3,
      durationSeconds: 1,
      sourcePath: src,
    }]);
    eq(good.ok, true);
    eq(good.humanVerifiedCount, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'good', 'MANIFEST.json'), 'utf8'));
    eq(manifest.humanVerifiedCount, 0);
    eq(manifest.approvedPlannedSetCount, 0);
    eq(manifest.realFailureCount, 0);
    eq(manifest.productMetric, false);
    eq(manifest.items[0].verdict, '');
    eq(manifest.items[0].humanTranscript, '');
    eq(manifest.items[0].sourcePath, undefined);
    eq(fs.readFileSync(path.join(dir, 'good', 'audio/cmn_hans_cn/1.wav'), 'utf8'), 'wav');
    const csv = fs.readFileSync(path.join(dir, 'good', 'annotations.csv'), 'utf8');
    eq(csv.indexOf('pass') < 0, true);
  });

  test('the real plan keeps the frozen files and leaves every review blank', () => {
    const root = path.join(__dirname, '../eval/baselines/asr');
    const names = ['fleurs-public-v1.json', 'public-candidates-v1.json', 'public-candidates-audio-v1.json'];
    const before = names.map((name) => sha(fs.readFileSync(path.join(root, name))));
    const plan = planFromDisk();
    eq(plan.ok, true);
    eq(plan.rows.length, 31);
    eq(plan.rows.filter((row) => row.role === 'public-candidate').length, 30);
    eq(plan.rows.filter((row) => row.role === 'focus').length, 1);
    eq(plan.rows.filter((row) => row.sentenceId === '1663' && row.config === 'cmn_hans_cn').length, 1);
    eq(plan.humanVerifiedCount, 0);
    eq(plan.rows.every((row) => row.verdict === '' && row.humanReviewed === false && row.approved === false), true);
    const after = names.map((name) => sha(fs.readFileSync(path.join(root, name))));
    eq(before.join(','), after.join(','));
  });
});
