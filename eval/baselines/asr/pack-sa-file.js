'use strict';

// Build a standalone script bundle. It does not contain audio or a git checkout.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { tarCreateSpec, listArchiveMembers } = require('./run-sa-file.js');

const HERE = __dirname;
const FILES = [
  'run-sa-file.js',
  'product-asr-mac.swift',
  'score.js',
  'fleurs-public-v1.json',
  'wav-info.js',
  'fetch-fleurs.js',
  'select.js',
  'tar-member.js',
];

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildBundle(dest) {
  fs.mkdirSync(dest, { recursive: false });
  for (const name of FILES) {
    fs.copyFileSync(path.join(HERE, name), path.join(dest, name));
  }
  fs.writeFileSync(path.join(dest, 'README.md'), [
    '# SA file component',
    '',
    'Not a product score, not e1_b1, not end-to-end, not a FLEURS leaderboard.',
    '',
    '```bash',
    'node run-sa-file.js --audio-cache <existing-cache-audio> --out-root <new-runs-dir>',
    '```',
    '',
    '`<existing-cache-audio>` is the directory that contains `en_us/` and `cmn_hans_cn/`.',
    'Each run creates a new subdirectory. An existing run directory is not overwritten.',
    'Missing audio fails. `--fetch-audio` downloads the pinned public revision into this bundle\'s `.cache/audio` and is not the default.',
    'The evidence archive omits wavs, the compiled binary, and secret files.',
    'Repack one existing run directory, without recognition:',
    '',
    '```bash',
    'node run-sa-file.js --pack-existing <run-dir>',
    '```',
    '',
    'That command packs only files already in the directory. It does not create a missing score or hypothesis file.',
    '',
  ].join('\n'));
  const names = FILES.concat(['README.md']);
  const lines = names.map((name) => sha256File(path.join(dest, name)) + '  ' + name);
  fs.writeFileSync(path.join(dest, 'MANIFEST.sha256'), lines.join('\n') + '\n');
  return { dir: dest, files: names.concat(['MANIFEST.sha256']) };
}

function main(argv) {
  let out = '';
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i];
    else {
      console.error('unknown arg ' + args[i]);
      process.exit(2);
    }
  }
  if (!out) {
    console.error('usage: node pack-sa-file.js --out <bundle.tar.gz>');
    process.exit(2);
  }
  const stage = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-pack-'));
  const dest = path.join(stage, 'sa-file-bundle');
  buildBundle(dest);
  const spec = tarCreateSpec(process.platform);
  const result = spawnSync('tar', spec.args.concat([path.resolve(out), '-C', stage, 'sa-file-bundle']), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, spec.env),
  });
  if (result.status !== 0) {
    console.error(result.stderr || 'tar failed');
    process.exit(2);
  }
  const listed = listArchiveMembers(path.resolve(out));
  if (!listed.ok) process.exit(2);
  for (const member of listed.members) {
    const parts = String(member.name || '').split('/');
    if (parts.some((part) => part.startsWith('._') || part === '.DS_Store')) process.exit(2);
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(out))).digest('hex');
  console.log(hash + '  ' + path.resolve(out));
}

if (require.main === module) main(process.argv);

module.exports = { buildBundle, FILES };
