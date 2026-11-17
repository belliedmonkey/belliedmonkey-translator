#!/usr/bin/env node
// scripts/check-shippable.js — BEL-692 upload hard gate.
//
// A build that was allowed to skip the zip (SKIP_ZIP paths: MT_SYNC_E2E,
// MT_ALLOW_PLACEHOLDER_BACKEND, …) leaves a `.not-shippable` marker in the
// emission directory. `build.js` refuses to zip those trees, but the iOS/macOS
// archive path reads `dist*` directly — the marker has to be checked here,
// immediately before xcodebuild archive and again immediately before altool.
//
// This is deliberately read-only: it never builds, archives, uploads, or writes
// a marker. It answers one question — may this checkout be packaged at all?
//
//   node scripts/check-shippable.js [--root <dir>] [--verify-ios <derivedData>] [--flavor <global|china>]
//
//   --root <dir>          artifact tree to inspect (default: this repo)
//   --verify-ios <dd>     also run scripts/verify-ios-bundle.js <dd>; its
//                         nonzero exit is propagated unchanged
//   --flavor <flavor>     forwarded to verify-ios-bundle.js (china selects
//                         dist-china/dist-app-china)
//
// Exit codes: 0 = shippable, 1 = marker found / verify failed, 2 = usage error.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIRS = ['dist', 'dist-app', 'dist-china', 'dist-app-china', 'dist-firefox'];
const MARKER = '.not-shippable';

function usage(stream) {
  stream.write(
    'usage: node scripts/check-shippable.js [--root <dir>] [--verify-ios <derivedData>] [--flavor <global|china>]\n'
    + '\n'
    + '  --root <dir>        artifact tree to inspect (default: the repo root)\n'
    + '  --verify-ios <dd>   also run scripts/verify-ios-bundle.js <dd>; propagate nonzero\n'
    + '  --flavor <flavor>   forwarded to verify-ios-bundle.js (default: global)\n',
  );
}

function parseArgv(argv) {
  const opts = { root: ROOT, verifyIos: null, flavor: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      return argv[++i];
    };
    if (arg === '--root') opts.root = path.resolve(value());
    else if (arg === '--verify-ios') opts.verifyIos = path.resolve(value());
    else if (arg === '--flavor') {
      const flavor = value();
      if (flavor !== 'global' && flavor !== 'china') throw new Error(`--flavor must be global or china, got ${flavor}`);
      opts.flavor = flavor;
    } else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

// Read the marker without ever mutating it. An unreadable marker is a failure
// too: "I could not prove this tree is shippable" must not become a pass.
function readMarker(file) {
  try {
    return { ok: true, reason: fs.readFileSync(file, 'utf8').trim() };
  } catch (e) {
    return { ok: false, reason: `unreadable: ${e.message}` };
  }
}

function findMarkers(root) {
  const found = [];
  for (const name of ARTIFACT_DIRS) {
    const marker = path.join(root, name, MARKER);
    // existsSync catches every shape; anything present (even a directory) is a
    // marker and an unreadable one fails closed above.
    if (!fs.existsSync(marker)) continue;
    found.push({ name, marker, ...readMarker(marker) });
  }
  return found;
}

function runVerifyIos(derivedData, flavor) {
  const verify = path.join(ROOT, 'scripts', 'verify-ios-bundle.js');
  if (!fs.existsSync(verify)) {
    console.error(`✗ script not found: ${verify}`);
    return 1;
  }
  const args = [verify, derivedData];
  if (flavor) args.push('--flavor', flavor);
  console.log(`→ verify-ios: node ${path.relative(ROOT, verify)} ${derivedData}${flavor ? ` --flavor ${flavor}` : ''}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.error) {
    console.error(`✗ could not run verify-ios-bundle.js: ${r.error.message}`);
    return 1;
  }
  if (r.signal) {
    console.error(`✗ verify-ios-bundle.js terminated by ${r.signal}`);
    return 1;
  }
  if (r.status !== 0) {
    console.error(`✗ verify-ios-bundle.js failed (exit ${r.status}) — not shippable`);
    return r.status || 1;
  }
  return 0;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgv(argv);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    usage(process.stderr);
    return 2;
  }
  if (opts.help) {
    usage(process.stdout);
    return 0;
  }

  const markers = findMarkers(opts.root);
  if (markers.length) {
    console.error(`✗ NOT SHIPPABLE — ${markers.length} .not-shippable marker(s) under ${opts.root}:`);
    for (const m of markers) {
      console.error(`  ${m.name}/${MARKER}`);
      console.error(`    ${m.reason || '(empty)'}`);
    }
    console.error('');
    console.error('Refusing to archive or upload. This tree came from a build that deliberately');
    console.error('skipped the zip (SKIP_ZIP / placeholder-escape path). Re-run a normal build');
    console.error('for this flavor, then archive again.');
    return 1;
  }
  console.log(`✓ no ${MARKER} marker in ${ARTIFACT_DIRS.length} artifact dirs under ${opts.root} `
    + `(${ARTIFACT_DIRS.join(', ')})`);

  if (opts.verifyIos) {
    const status = runVerifyIos(opts.verifyIos, opts.flavor);
    if (status !== 0) return status;
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { ARTIFACT_DIRS, MARKER, findMarkers, main };
