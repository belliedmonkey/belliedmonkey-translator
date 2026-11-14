'use strict';

// Blank listening sheet for the 30 public candidates and cmn_hans_cn/1663.
// Copies already-cached wavs. Does not edit references or mark a review.

const fs = require('fs');
const path = require('path');
const { checkCached } = require('./fetch-public-candidates.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const TEXT = path.join(__dirname, 'public-candidates-v1.json');
const SIDE = path.join(__dirname, 'public-candidates-audio-v1.json');
const FROZEN = path.join(__dirname, 'fleurs-public-v1.json');
const QUESTIONS = ['括注拉丁是否实际读出', '音频转写不符/不确定'];

function blankRow(input) {
  return {
    id: input.id,
    role: input.role,
    sentenceId: String(input.sentenceId),
    config: input.config,
    audioName: input.audioName,
    relativeAudio: 'audio/' + input.config + '/' + input.audioName,
    audioSha256: input.audioSha256,
    bytes: input.bytes,
    durationSeconds: input.durationSeconds,
    reference: input.reference,
    raw: input.raw,
    questions: QUESTIONS.slice(),
    latinParentheticalSpoken: '',
    transcriptMismatchOrUncertain: '',
    humanReviewer: '',
    humanTime: '',
    humanTranscript: '',
    humanEvidence: '',
    verdict: '',
    approved: false,
    humanReviewed: false,
  };
}

function forbiddenPackDir(dir) {
  const resolved = path.resolve(dir);
  const blocked = [
    path.resolve(path.join(__dirname, '.cache', 'audio')),
    path.resolve(path.join(__dirname, '.cache', 'public-candidates')),
    path.resolve(path.join(__dirname, 'runs')),
  ];
  for (const root of blocked) {
    if (resolved === root || resolved.startsWith(root + path.sep) || String(dir || '').includes('..')) {
      return { ok: false, code: 'cache-mix', humanVerifiedCount: 0, productMetric: false };
    }
  }
  return { ok: true, code: 'ok' };
}

function planFromDisk() {
  const text = JSON.parse(fs.readFileSync(TEXT, 'utf8'));
  const side = JSON.parse(fs.readFileSync(SIDE, 'utf8'));
  const frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
  const byKey = new Map(side.items.map((item) => [item.config + '/' + item.audioName + '/' + item.sentenceId, item]));
  const entries = [];
  for (const item of text.items) {
    const audio = byKey.get(item.config + '/' + item.audioName + '/' + item.sentenceId);
    if (!audio) {
      return { ok: false, code: 'audio-incomplete', rows: [], humanVerifiedCount: 0, productMetric: false };
    }
    entries.push({
      id: item.id,
      role: 'public-candidate',
      sentenceId: item.sentenceId,
      config: item.config,
      audioName: item.audioName,
      reference: item.reference,
      raw: item.raw,
      audioSha256: audio.sha256,
      bytes: audio.bytes,
      durationSeconds: audio.durationSeconds,
      sourcePath: path.join(__dirname, '.cache', 'public-candidates', item.config, item.audioName),
    });
  }
  const focus = frozen.items.find((item) => item.config === 'cmn_hans_cn' && String(item.sentenceId) === '1663');
  if (!focus || !focus.audioCache || focus.audioCache.includes('..')) {
    return { ok: false, code: 'missing-1663', rows: [], humanVerifiedCount: 0, productMetric: false };
  }
  entries.push({
    id: focus.id,
    role: 'focus',
    sentenceId: focus.sentenceId,
    config: focus.config,
    audioName: focus.audioName,
    reference: focus.reference,
    raw: focus.raw,
    audioSha256: focus.audioSha256,
    bytes: focus.audioBytes,
    durationSeconds: focus.durationSeconds,
    sourcePath: path.join(ROOT, focus.audioCache),
  });
  return {
    ok: entries.length === 31,
    code: entries.length === 31 ? 'ok' : 'audio-scope',
    rows: entries.map(blankRow),
    entries: entries,
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    realFailureCount: 0,
    productMetric: false,
  };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function writeReviewPack(outDir, entries) {
  const gate = forbiddenPackDir(outDir);
  if (!gate.ok) return gate;
  for (const entry of entries) {
    const cached = checkCached(entry.sourcePath, entry.audioSha256, entry.bytes);
    if (!cached.ok) {
      return { ok: false, code: cached.code, humanVerifiedCount: 0, productMetric: false, rates: null };
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of entries) {
    const dest = path.join(outDir, 'audio', entry.config, entry.audioName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const partial = dest + '.partial';
    fs.copyFileSync(entry.sourcePath, partial);
    const again = checkCached(partial, entry.audioSha256, entry.bytes);
    if (!again.ok) {
      fs.unlinkSync(partial);
      return { ok: false, code: again.code, humanVerifiedCount: 0, productMetric: false, rates: null };
    }
    fs.renameSync(partial, dest);
  }
  const items = entries.map(blankRow);
  const manifest = {
    schema: 'belliedmonkey.review-pack.v1',
    notAHumanReview: true,
    productMetric: false,
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    realFailureCount: 0,
    clipCount: items.length,
    license: 'CC-BY-4.0',
    revision: '70bb2e84b976b7e960aa89f1c648e09c59f894dd',
    items: items,
  };
  const header = [
    'id', 'role', 'sentenceId', 'config', 'relativeAudio', 'audioSha256', 'bytes', 'durationSeconds',
    'reference', 'raw', 'latinParentheticalSpoken', 'transcriptMismatchOrUncertain',
    'humanReviewer', 'humanTime', 'humanTranscript', 'humanEvidence', 'verdict',
  ];
  const lines = [header.join(',')];
  for (const item of items) {
    lines.push(header.map((key) => csvCell(item[key])).join(','));
  }
  fs.writeFileSync(path.join(outDir, 'annotations.csv'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'README.md'), [
    '# 听审材料',
    '',
    '这不是人审结果。`humanVerifiedCount` 是 0，`approved` 全是 false，复核列是空的。',
    '',
    '重做这个目录：',
    '',
    '```bash',
    'node eval/baselines/asr/make-review-pack.js --out <目录>',
    '```',
    '',
    '音频来自已核对的 FLEURS 缓存。不要把这些 wav 放进评分证据包，也不要按识别结果改参考。',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(outDir, 'ATTRIBUTION.txt'), [
    'Dataset: google/fleurs',
    'Revision: 70bb2e84b976b7e960aa89f1c648e09c59f894dd',
    'License: CC-BY-4.0',
    'Citation: Conneau et al., FLEURS, arXiv:2205.12446',
    'These clips are an unmodified subset. The reference text is the published field, not a new transcript.',
    '',
  ].join('\n'));
  return {
    ok: true,
    code: 'pack-ok',
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    realFailureCount: 0,
    productMetric: false,
    rates: null,
    clipCount: items.length,
  };
}

function main(argv) {
  const index = argv.indexOf('--out');
  if (index < 0 || !argv[index + 1] || String(argv[index + 1]).startsWith('--')) {
    console.log(JSON.stringify({ ok: false, code: 'out', humanVerifiedCount: 0, productMetric: false }));
    process.exit(2);
  }
  const out = argv[index + 1];
  const gate = forbiddenPackDir(out);
  if (!gate.ok) {
    console.log(JSON.stringify(gate));
    process.exit(2);
  }
  const plan = planFromDisk();
  if (!plan.ok) {
    console.log(JSON.stringify({ ok: false, code: plan.code, humanVerifiedCount: 0, productMetric: false }));
    process.exit(2);
  }
  const result = writeReviewPack(out, plan.entries);
  console.log(JSON.stringify(result));
  if (!result.ok) process.exit(2);
}

if (require.main === module) main(process.argv);

module.exports = { blankRow, writeReviewPack, forbiddenPackDir, planFromDisk };
