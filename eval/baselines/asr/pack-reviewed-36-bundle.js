'use strict';

// Builds a checkout-free Mac bundle. Audio and the SenseVoice zip stay out.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { loadSet, senseVoicePin, saPin, EAR_SOURCES, validateSet } = require('./reviewed-36.js');

const ROOT = path.join(__dirname, '../../..');
const FILES = [
  'eval/baselines/asr/run-reviewed-36.js',
  'eval/baselines/asr/reviewed-36.js',
  'eval/baselines/asr/codeswitch-score.js',
  'eval/baselines/asr/score.js',
  'eval/baselines/asr/run-sa-file.js',
  'eval/baselines/asr/tar-member.js',
  'eval/baselines/asr/product-asr-mac.swift',
  'eval/baselines/asr/sensevoice-stdout.js',
  'eval/baselines/asr/sensevoice-zip-members-2026-11-13.json',
  'docs/baselines/reviewed-36.md',
];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function auditSnapshot() {
  const records = EAR_SOURCES.map((rel) => {
    const body = fs.readFileSync(path.join(ROOT, rel));
    const doc = JSON.parse(body.toString('utf8'));
    return {
      source: rel,
      file: path.basename(rel),
      sha256: sha256(body),
      reviewer: doc.reviewer || null,
      reviewedAt: doc.reviewedAt || null,
      verbatim: doc.verbatim == null ? null : doc.verbatim,
      humanVerifiedCount: doc.humanVerifiedCount,
      approvedPlannedSetCount: doc.approvedPlannedSetCount,
      blankSheet: false,
    };
  });
  return {
    schema: 'belliedmonkey.reviewed-36-audit.v1',
    blankSheetsIncluded: false,
    note: 'Byte copies of the ear records. The blank listening sheet is not included and the source files are not rewritten.',
    records: records,
  };
}

function packBundle(outZip, extra) {
  const set = extra && extra.set ? extra.set : loadSet(ROOT);
  if (!set.ok) throw new Error(set.code);
  const rows = validateSet(set.items);
  if (!rows.ok) throw new Error(rows.code);
  const stage = fs.mkdtempSync(path.join(require('os').tmpdir(), 'r36-bundle-'));
  for (const rel of FILES) {
    const base = path.basename(rel);
    const body = fs.readFileSync(path.join(ROOT, rel));
    if (base.endsWith('.wav')) throw new Error('audio');
    fs.writeFileSync(path.join(stage, base), body);
  }
  const audit = auditSnapshot();
  for (const rec of audit.records) {
    fs.writeFileSync(path.join(stage, rec.file), fs.readFileSync(path.join(ROOT, rec.source)));
  }
  const manifest = {
    schema: 'belliedmonkey.reviewed-36-bundle.v1',
    synthetic: !!(extra && extra.synthetic === true),
    audioIncluded: false,
    modelIncluded: false,
    approvedPlannedSetCount: 0,
    denominator: 36,
    sa: saPin(),
    sensevoice: senseVoicePin(ROOT),
    audit: audit,
    items: set.items.map((item) => ({
      id: item.id,
      config: item.config,
      stratum: item.stratum,
      lang: item.lang,
      reference: item.reference,
      audioSha256: item.audioSha256,
      audioName: item.audioName,
      audioRel: item.audioRel,
      saLocale: item.saLocale,
      bitsPerSample: item.bitsPerSample,
    })),
  };
  fs.writeFileSync(path.join(stage, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(stage, 'README.md'), [
    '# Reviewed-36 Mac bundle',
    '',
    'No audio and no model zip are in this archive. Linux cannot report a SpeechAnalyzer score.',
    'The SenseVoice zip must already hash to the sha256 in MANIFEST.json before a sensevoice run.',
    'Do not use the product relay. A tar.bz2 from elsewhere is a different file.',
    '',
    'Prepare caches yourself, then from this directory:',
    '',
    '```bash',
    'node run-reviewed-36.js --run --backend sa --out /tmp/r36-sa-smoke \\',
    '  --fleurs-cache /ABS/fleurs-cache --ascend-cache /ABS/ascend-cache',
    'node run-reviewed-36.js --pack-existing /tmp/r36-sa-smoke',
    '```',
    '',
    'That first command is one smoke. Do not pass `--repeats` until a smoke has exited 0. Fewer than five repeats is exploratory and is not a ranking.',
    'Each manifest row carries `config`. `en_us` and `cmn_hans_cn` are read from the FLEURS cache as `config/audioName`. ASCEND is read from the ASCEND cache as `audioName` itself. A row without `config` is `invalid-config` and is not looked up under the FLEURS root.',
    'Ear-record copies sit next to MANIFEST.json. Their sha256 is in `audit`. The blank listening sheet is not in this archive.',
    'Darwin with `swiftc` stages the 36 files, checks their sha256, compiles `product-asr-mac.swift`, runs `--install-assets`, then recognizes. Linux stays `unavailable`.',
    'The default recognize ceiling is 36 times 45s. The old 16-clip process ceiling of 180s is not this set\'s ceiling. `--process-cap-ms` and `--item-cap-ms` override it. That number is a bound, not a measured latency, and the recognize wall is not model-load time.',
    '',
    'The pinned zip is a separate file. Unpack it so this directory sees model.int8.onnx and tokens.txt. A mismatch with sensevoice-zip-members-2026-11-13.json is checksum-mismatch and does not score.',
    '',
    '```bash',
    'node run-reviewed-36.js --run --backend sensevoice --out /tmp/r36-sv-smoke \\',
    '  --sensevoice-dir /ABS/sherpa-onnx-sense-voice \\',
    '  --sensevoice-bin /ABS/sherpa-onnx-v2.0.1-osx-arm64-static-no-tts/bin/sherpa-onnx-offline \\',
    '  --fleurs-cache /ABS/fleurs-cache --ascend-cache /ABS/ascend-cache',
    '```',
    '',
    'The model zip and the macOS binary archive are separate files. Their sha256 values are in sensevoice-zip-members-2026-11-13.json. This Linux host does not run the macOS binary.',
    '',
    'No model directory is `model-missing`. A directory whose `model.int8.onnx` and `tokens.txt` hash, but no `sherpa-onnx-offline` on PATH, is `backend-missing`. Neither blocks the SA command.',
    '',
    '`--check` in this flat directory does not see the repo caches. Point the repo command at the caches instead:',
    '',
    '```bash',
    'node eval/baselines/asr/run-reviewed-36.js --check',
    '```',
    '',
    'SA locale for ASCEND is zh-CN once. It is not chosen by trying en-US as well.',
    '',
  ].join('\n'));
  const names = fs.readdirSync(stage).filter((name) => name !== 'SHA256SUMS').sort();
  const sums = names.map((name) => sha256(fs.readFileSync(path.join(stage, name))) + '  ' + name);
  fs.writeFileSync(path.join(stage, 'SHA256SUMS'), sums.join('\n') + '\n');
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);
  const packed = spawnSync('tar', ['--format=ustar', '-czf', outZip, '-C', stage, '.'], { encoding: 'utf8' });
  if (packed.status !== 0) throw new Error('bundle-pack-failed');
  const zipSha = sha256(fs.readFileSync(outZip));
  return { bytes: fs.statSync(outZip).size, sha256: zipSha, names: names.concat(['SHA256SUMS']) };
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node eval/baselines/asr/pack-reviewed-36-bundle.js <out.tar.gz>');
    process.exit(2);
  }
  console.log(JSON.stringify(packBundle(path.resolve(out))));
}

module.exports = { packBundle };
