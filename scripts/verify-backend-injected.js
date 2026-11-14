#!/usr/bin/env node
// scripts/verify-backend-injected.js — assert an EXPORTED artifact carries a real,
// flavor-appropriate backend, BEFORE it is uploaded.
//
// The build gate (build.js, BEL-259) stops a placeholder build from being written.
// This is the second half: it reads the artifact that is about to be uploaded and
// checks the `MT_BACKEND` block inside it. That covers the hand-off the build gate
// cannot see — a stale zip, a wrong-flavor archive, or an ASC export made before the
// gate existed.
//
//   node scripts/verify-backend-injected.js <artifact> --flavor china
//   node scripts/verify-backend-injected.js <artifact> --flavor intl
//   node scripts/verify-backend-injected.js --dist dist-china --flavor china
//   node scripts/verify-backend-injected.js <artifact> --flavor intl --expect-host <host>
//
// Accepted artifacts: .ipa / .pkg / .zip / .xpi (or a .app/.appex/dist directory).
//
// Checks (only the ACTIVE fields):
//   · url non-empty, not *.invalid
//   · china: url must not be a *.supabase.co host
//   · intl:  url must be a *.supabase.co host (the intl backend is Supabase-hosted)
//   · anonKey non-empty and not a build placeholder constant
//   · supabase url ⇒ anonKey JWT `ref` matches the project subdomain;
//     non-supabase url ⇒ anonKey must not carry a supabase `ref`
//
// `previousUrl` is the BEL-260 sentinel (`https://backend.invalid`): it is printed
// as a host for diagnosis and is NEVER a pass/fail criterion.
//
// Never prints a key — only host + sha256 first 8 + source file. Exits 1 on a hit,
// printing the hit file.
'use strict';

const { checkBackendInjected } = require('./lib/release-gate.js');

const USAGE = `用法:
  node scripts/verify-backend-injected.js <artifact> --flavor <intl|china> [--expect-host <host>]
  node scripts/verify-backend-injected.js --dist <dir> --flavor <intl|china> [--expect-host <host>]

  artifact: .ipa / .pkg / .zip / .xpi，或一个 .app/.appex/dist 目录`;

function usage(code) {
  (code ? console.error : console.log)(USAGE);
  process.exit(code);
}

const argv = process.argv.slice(2);
let artifact = null;
let dist = null;
let flavor = 'intl';
let expectHost = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dist') {
    dist = argv[++i];
    if (!dist) usage(2);
  } else if (a === '--flavor') {
    flavor = argv[++i];
    if (!flavor) usage(2);
  } else if (a === '--expect-host') {
    expectHost = argv[++i];
    if (!expectHost) usage(2);
  } else if (a === '--help' || a === '-h') {
    usage(0);
  } else if (a.startsWith('-')) {
    console.error(`✗ 未知参数：${a}`);
    usage(2);
  } else if (!artifact) {
    artifact = a;
  } else {
    console.error(`✗ 多余的参数：${a}`);
    usage(2);
  }
}

if (!artifact && !dist) usage(2);
if (artifact && dist) {
  console.error('✗ <artifact> 与 --dist 只能给一个');
  usage(2);
}

let result;
try {
  result = checkBackendInjected({ artifact, dist, flavor, expectHost });
} catch (e) {
  console.error('✗ ' + ((e && e.message) || e));
  process.exit(2);
}

for (const t of result.targets) {
  console.log(`  ${t.file}: host=${t.host || '(none)'} anonKey=sha256:${t.anonKeySha8}`
    + (t.previousHost ? ` previousUrl=${t.previousHost}` : ''));
}

if (!result.ok) {
  console.error(`\n✗ backend-injected gate: ${result.violations.length} violation(s) (flavor=${result.flavor})`);
  for (const v of result.violations.slice(0, 30)) console.error('  ' + v);
  console.error('  这个产物不能上传 —— 重新构建并从构建门通过的产物里取。');
  process.exit(1);
}

console.log(`✓ backend-injected gate: ${result.targets.length} target(s) look shippable (flavor=${result.flavor})`);
