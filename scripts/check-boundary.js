#!/usr/bin/env node
// scripts/check-boundary.js — CI path-deny for the public / private repo split (BEL-172).
//
// BOUNDARY.md §2 is the human table; this file is the executable half. It fails when:
//   · a denylisted implementation path is tracked in the public tree,
//   · a changed file touches the denylist (PR mode),
//   · the tree imports/submodules a private side repo,
//   · a JWT-shaped token (service_role / anon key copy) is tracked in a text file.
//
// Usage:
//   node scripts/check-boundary.js                 # full tree scan
//   node scripts/check-boundary.js --changed <ref> # also check `git diff <ref>...HEAD`
//   node scripts/check-boundary.js --json
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Every deny rule is anchored at the repo root. Keep in sync with BOUNDARY.md §2.
const DENY = [
  { re: /^supabase\/functions\/bt-relay\//, why: 'hosted relay implementation' },
  { re: /^supabase\/functions\/bt-grant\//, why: 'hosted grant implementation' },
  { re: /^supabase\/functions\/bt-grant-ledger\//, why: 'hosted ledger implementation' },
  { re: /^supabase\/functions\/bt-models\//, why: 'hosted model-source implementation' },
  { re: /^supabase\/functions\/bt-delete-account\//, why: 'hosted account-deletion implementation' },
  { re: /^supabase\/functions\/bt-ingest\/(?!events\.gen\.json$)/, why: 'telemetry pipeline implementation (whitelist may stay)' },
  { re: /^deploy\/china\//, why: 'in-country deploy/filing runbooks (compliance repo)' },
  { re: /^deploy\/china-relay\//, why: 'SCF packaging for the hosted relay' },
  { re: /(^|\/)\.env(\.|$)/, why: 'environment file' },
  { re: /\.(pem|p12|mobileprovision)$/i, why: 'key material' },
  { re: /^supabase\/\.temp\//, why: 'supabase CLI local state' },
];

// Contract / whitelist / mock are the only things the public tree may carry under those
// names. (Most are outside the deny prefix already; listed for the falsifiability test.)
const ALLOW = [
  /^supabase\/schema\.sql$/,
  /^supabase\/functions\/bt-ingest\/events\.gen\.json$/,
  /^supabase\/functions\/README\.md$/,
  /^contracts\//,
  /^mocks\//,
];

const PRIVATE_IMPORT = [
  /require\(\s*['"][^'"]*belliedmonkey-translator-(hosted|compliance)/,
  /from\s+['"][^'"]*belliedmonkey-translator-(hosted|compliance)/,
  /^\s*path\s*=\s*[^#\n]*belliedmonkey-translator-(hosted|compliance)/m,
  /url\s*=\s*[^\n]*belliedmonkey-translator-(hosted|compliance)\.git/,
];

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.yml', '.yaml',
  '.sh', '.py', '.html', '.css', '.toml', '.txt', '.sql', '.plist', '.pbxproj', '.swift', '.xcconfig']);

function git(args) {
  const env = { ...process.env };
  delete env.GIT_CONFIG_COUNT;
  delete env.GIT_CONFIG_VALUE_0;
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
}

function trackedFiles() {
  try {
    return git(['ls-files', '-z']).split('\0').filter(Boolean);
  } catch (_) {
    // Fallback for a non-git export: walk the tree, skipping generated/vendored dirs.
    const out = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const p = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) {
          if (['.git', 'node_modules', 'dist', 'dist-china', 'dist-firefox', 'out-reg'].includes(e.name)) continue;
          if (/^safari-project/.test(e.name)) continue;
          walk(p);
        } else out.push(p);
      }
    };
    walk('');
    return out;
  }
}

function denied(p) {
  if (ALLOW.some((re) => re.test(p))) return null;
  return DENY.find((d) => d.re.test(p)) || null;
}

function inspectPaths(paths, root = ROOT) {
  const violations = [];
  for (const p of paths) {
    const d = denied(p);
    if (d) violations.push({ path: p, kind: 'denylist', why: d.why });
  }
  return violations;
}

function inspectTree(root = ROOT) {
  const files = trackedFiles();
  const violations = inspectPaths(files, root);
  for (const p of files) {
    if (!TEXT_EXT.has(path.extname(p).toLowerCase())) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, p), 'utf8'); } catch (_) { continue; }
    if (PRIVATE_IMPORT.some((re) => re.test(text))) {
      violations.push({ path: p, kind: 'private-import', why: 'public tree imports/references a private side repo as code' });
    }
    if (JWT.test(text)) {
      violations.push({ path: p, kind: 'jwt', why: 'JWT-shaped token in a tracked text file (rotate/scrub or move it out)' });
    }
  }
  return violations;
}

function changedPaths(ref) {
  if (!ref) return [];
  const mergeBase = git(['merge-base', ref, 'HEAD']).trim();
  return git(['diff', '--name-only', mergeBase, 'HEAD']).split('\n').filter(Boolean);
}

function main(argv) {
  const json = argv.includes('--json');
  const ci = argv.indexOf('--changed');
  const violations = inspectTree();
  if (ci >= 0 && argv[ci + 1]) {
    const changed = changedPaths(argv[ci + 1]);
    const set = new Set(violations.map((v) => v.path + '|' + v.kind));
    for (const v of inspectPaths(changed)) {
      if (!set.has(v.path + '|' + v.kind)) violations.push({ ...v, kind: 'denylist-changed' });
    }
  }
  if (json) {
    process.stdout.write(JSON.stringify({ ok: violations.length === 0, violations }, null, 2) + '\n');
  } else if (violations.length) {
    console.error(`✗ boundary: ${violations.length} violation(s) — see BOUNDARY.md §2`);
    for (const v of violations) console.error(`  [${v.kind}] ${v.path} — ${v.why}`);
  } else {
    console.log('✓ boundary: public tree respects BOUNDARY.md §2');
  }
  process.exit(violations.length ? 1 : 0);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { inspectTree, inspectPaths, denied, deniedRules: DENY, allowedRules: ALLOW, changedPaths };
