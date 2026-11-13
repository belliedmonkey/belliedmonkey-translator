'use strict';

// Checkout-free bundle for the judge entry. No audio, no hypotheses, no keys.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const FILES = [
  'eval/baselines/judge/run-judge.js',
  'eval/baselines/judge/rubric.js',
  'eval/baselines/judge/schema.js',
  'eval/baselines/judge/assign.js',
  'eval/baselines/judge/prompt.js',
  'eval/baselines/judge/parse.js',
  'docs/baselines/llm-judge.md',
];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function packBundle(outTar) {
  const root = path.join(__dirname, '../../..');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-judge-bundle-'));
  for (const rel of FILES) {
    const body = fs.readFileSync(path.join(root, rel));
    fs.writeFileSync(path.join(stage, path.basename(rel)), body);
  }
  fs.writeFileSync(path.join(stage, 'README.md'), [
    '# LLM judge bundle',
    '',
    'Dry-run is the default. It does not read keys and does not call a model.',
    'Two judge model ids must be different. A missing endpoint or key is blocked, not a second copy of the same model.',
    'This archive has no audio and no hypothesis. Edit rates are not produced.',
    'The 1675 parallel strings are not translation gold. The translation task exits translation-not-open.',
    '',
    '```bash',
    'node run-judge.js --synthetic --input input.json --config config.json --out /tmp/judge-dry',
    'node run-judge.js --run --synthetic --input input.json --config config.json --out /tmp/judge-run',
    '```',
    '',
  ].join('\n'));
  const names = fs.readdirSync(stage).filter((name) => name !== 'SHA256SUMS').sort();
  const sums = names.map((name) => sha256(fs.readFileSync(path.join(stage, name))) + '  ' + name);
  fs.writeFileSync(path.join(stage, 'SHA256SUMS'), sums.join('\n') + '\n');
  if (fs.existsSync(outTar)) fs.unlinkSync(outTar);
  const packed = spawnSync('tar', ['--format=ustar', '-czf', outTar, '-C', stage, '.'], { encoding: 'utf8' });
  if (packed.status !== 0) throw new Error('bundle-pack-failed');
  return { bytes: fs.statSync(outTar).size, sha256: sha256(fs.readFileSync(outTar)), names: names.concat(['SHA256SUMS']) };
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    process.stderr.write('usage: node eval/baselines/judge/pack-judge-bundle.js <out.tar.gz>\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(packBundle(path.resolve(out))) + '\n');
}

module.exports = { packBundle };
