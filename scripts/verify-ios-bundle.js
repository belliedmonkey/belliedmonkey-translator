#!/usr/bin/env node
// Does the built Safari .appex actually contain what dist/ contains?
//
// It did not, and nothing said so. `safari-web-extension-converter` captures the
// extension's FILE LIST at conversion time; every file added afterwards is simply
// never referenced by the Xcode project. The whole `learn/` directory had fallen out
// that way — which on iOS meant options.html loaded seven scripts that were not
// there, options.js died on the first undefined global, and the settings page (where
// the API key is entered) was dead. The build succeeded. The manifest validated.
//
// The fix is to regenerate the project when files are added; this is the check that
// makes forgetting loud instead of silent.
//
//   npm run verify:ios -- [/path/to/DerivedData]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dd = process.argv[2] || '/tmp/bt-dd';

function walk(dir, base = dir, out = new Set()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.add(path.relative(base, p));
  }
  return out;
}

function findAppex(root) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (e.name.endsWith('.appex')) return p;
      stack.push(p);
    }
  }
  return null;
}

const distDir = path.join(ROOT, 'dist');
if (!fs.existsSync(distDir)) {
  console.error('✗ no dist/ — run `node build.js` first');
  process.exit(1);
}
const appex = findAppex(dd);
if (!appex) {
  console.error(`✗ no .appex under ${dd} — build the iOS scheme first:\n` +
    `    xcodebuild -scheme "BelliedMonkey Translator (iOS)" -derivedDataPath ${dd} ... build`);
  process.exit(1);
}

const inDist = walk(distDir);
const inAppex = walk(appex);
const missing = [...inDist].filter((f) => !inAppex.has(f)).sort();

if (missing.length) {
  console.error(`✗ ${missing.length} file(s) in dist/ are NOT in the built extension:`);
  for (const f of missing) console.error('    ' + f);
  console.error('\nThe Xcode project references a file list captured when it was generated.\n' +
    'Regenerate it, then rebuild:\n' +
    '    xcrun safari-web-extension-converter dist --project-location ./safari-project \\\n' +
    '      --app-name "BelliedMonkey Translator" --bundle-identifier com.belliedmonkeytranslator \\\n' +
    '      --swift --no-open --no-prompt --force');
  process.exit(1);
}
console.log(`✓ Safari bundle complete — all ${inDist.size} dist files present in ${path.basename(appex)}`);
