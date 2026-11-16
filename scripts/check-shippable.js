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
// BEL-280: `MT_TEST_400=<reason>` injects this header into grant requests. It is a
// TEST-BUILD-ONLY probe (the relay honours it only for an allowlisted token hash),
// so its literal name must never appear in an artifact tree that could be archived.
// The build also withholds the zip + writes .not-shippable; this scan is the second,
// independent gate — it catches a tree whose marker was deleted or never written.
const TEST400_MARKER = 'x-mt-test-400';

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

// Walk one artifact tree and return every file whose bytes contain the test header
// literal. Read as UTF-8: the marker is ASCII, and a binary file that happens to
// contain the bytes still decodes to a string containing it. A read error is a
// failure, not a skip — "could not prove this file is clean" must not pass.
function findTest400Marker(root) {
  const hits = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      hits.push({ file: dir, error: e.message });
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.isFile()) continue;
      try {
        const text = fs.readFileSync(abs, 'utf8');
        if (text.indexOf(TEST400_MARKER) >= 0) hits.push({ file: abs });
      } catch (e) {
        hits.push({ file: abs, error: e.message });
      }
    }
  };
  for (const name of ARTIFACT_DIRS) {
    const dir = path.join(root, name);
    if (!fs.existsSync(dir)) continue;
    walk(dir);
  }
  return hits;
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

  // BEL-280: independent of the .not-shippable marker. A test-400 build is
  // non-shippable by construction; this catches the case where the marker was
  // deleted, the tree was copied without it, or a future build path forgot it.
  const test400Hits = findTest400Marker(opts.root);
  if (test400Hits.length) {
    console.error(`✗ NOT SHIPPABLE — ${TEST400_MARKER} found in ${test400Hits.length} artifact file(s) under ${opts.root}:`);
    for (const h of test400Hits) {
      console.error(`  ${path.relative(opts.root, h.file)}${h.error ? ' (' + h.error + ')' : ''}`);
    }
    console.error('');
    console.error('This tree came from an MT_TEST_400 test build. The relay 400 probe is');
    console.error('TEST-BUILD-ONLY; rebuild without MT_TEST_400 before archiving or uploading.');
    return 1;
  }
  console.log(`✓ no ${TEST400_MARKER} test-probe marker in artifact trees under ${opts.root}`);

  if (opts.verifyIos) {
    const status = runVerifyIos(opts.verifyIos, opts.flavor);
    if (status !== 0) return status;
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { ARTIFACT_DIRS, MARKER, TEST400_MARKER, findMarkers, findTest400Marker, main };
