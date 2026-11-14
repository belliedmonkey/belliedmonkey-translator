// ASCEND text screen. Empty reviewer fields are not an ear check.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, eq } = require('./harness');
const {
  codeSwitchText, selectCandidates, verifyAudioSet, publishManifest, attributionText, writeBlankPack,
} = require('../eval/baselines/ascend/fetch-ascend.js');

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('ASCEND candidates — text screen, not a review', () => {
  test('han plus a latin letter is the only screen, and dialogue stays unknown', () => {
    eq(codeSwitchText('好的'), false);
    eq(codeSwitchText('hello'), false);
    eq(codeSwitchText('ok福建'), true);
    const picked = selectCandidates([
      { id: '00028', transcription: 'ok福建' },
      { id: '00009', transcription: 'no我专业' },
      { id: '00002', transcription: '只有中文' },
      { id: '00001', transcription: 'see you' },
      { id: '00004', transcription: "呃what's the呃" },
    ], 2);
    eq(picked.items.map((row) => row.id).join(','), '00004,00009');
    eq(picked.humanVerifiedCount, 0);
    eq(picked.approvedPlannedSetCount, 0);
    eq(picked.realFailureCount, 0);
    eq(picked.buckets.continuousDialogue.count, 0);
    eq(picked.buckets.continuousDialogue.status, 'unknown');
    eq(picked.buckets.codeSwitchHuman.status, 'unknown');
    eq(picked.buckets.accent.status, 'unknown');
    eq(picked.buckets.noise.status, 'unknown');
    eq(picked.buckets.codeSwitchText.status, 'text-screen-only');
  });

  test('a copied cache with a bad hash or a missing file is not success', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascend-cache-'));
    const file = path.join(dir, '00004.wav');
    fs.writeFileSync(file, 'wav');
    const items = [{ audioName: '00004.wav', sha256: sha(Buffer.from('wav')), bytes: 3 }];
    const flipped = verifyAudioSet(dir, [{ audioName: '00004.wav', sha256: 'a'.repeat(64), bytes: 3 }]);
    eq(flipped.ok, false);
    eq(flipped.code, 'checksum-mismatch');
    eq(fs.readFileSync(file, 'utf8'), 'wav');
    const missing = verifyAudioSet(dir, items.concat([{ audioName: '00009.wav', sha256: 'b'.repeat(64), bytes: 1 }]));
    eq(missing.ok, false);
    eq(missing.code, 'missing-cache');
    eq(verifyAudioSet(dir, items).ok, true);
    const side = path.join(dir, 'manifest.json');
    fs.writeFileSync(side, '{"keep":true}\n');
    eq(publishManifest(side, { items: [] }, 'verify'), false);
    eq(fs.readFileSync(side, 'utf8'), '{"keep":true}\n');
  });

  test('attribution names the data license and not the code repository license', () => {
    const text = attributionText();
    eq(text.indexOf('CC-BY-SA-4.0') >= 0, true);
    eq(text.indexOf('https://creativecommons.org/licenses/by-sa/4.0/') >= 0, true);
    eq(text.indexOf('MIT is not the data license') >= 0, true);
  });

  test('the blank pack keeps the official transcription and an empty verdict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascend-pack-'));
    const src = path.join(dir, 'src.wav');
    fs.writeFileSync(src, 'wav');
    const digest = sha(Buffer.from('wav'));
    const result = writeBlankPack(path.join(dir, 'out'), [{
      id: '00004',
      audioName: '00004.wav',
      transcription: "呃what's the呃",
      audioSha256: digest,
      bytes: 3,
      durationSeconds: 1.36,
      sourcePath: src,
    }]);
    eq(result.ok, true);
    eq(result.humanVerifiedCount, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'MANIFEST.json'), 'utf8'));
    eq(manifest.items[0].transcription, "呃what's the呃");
    eq(manifest.items[0].verdict, '');
    eq(manifest.items[0].humanReviewer, '');
    eq(manifest.items[0].sourcePath, undefined);
    eq(manifest.license.spdx, 'CC-BY-SA-4.0');
    eq(fs.readFileSync(path.join(dir, 'out', 'audio/00004.wav'), 'utf8'), 'wav');
  });

  test('the committed six-clip manifest is a text screen and not the donation set', () => {
    const body = JSON.parse(fs.readFileSync(path.join(__dirname, '../eval/baselines/ascend/ascend-test-v1.json'), 'utf8'));
    eq(body.publicCandidateCount, 6);
    eq(body.humanVerifiedCount, 0);
    eq(body.donationActualCount, 0);
    eq(body.realFailureCount, 0);
    eq(body.license.spdx, 'CC-BY-SA-4.0');
    eq(body.source.sha256, 'a4c81d2b5ed6124f052089a695972808c16e0ce0c365ec9773c5d1a8fcf043a7');
    eq(body.source.cardRevision, '737e9800ae31be9932ba8464c80366559bd28424');
    eq(body.items.map((item) => item.id).join(','), '00004,00009,00028,00055,00066,00068');
    eq(body.items[0].transcription, "呃what's the呃");
    eq(body.buckets.continuousDialogue.status, 'unknown');
    eq(body.buckets.codeSwitchHuman.status, 'unknown');
    eq(body.items.every((item) => item.humanReviewed === false && item.ear.codeSwitch === 'unknown'), true);
  });
});
