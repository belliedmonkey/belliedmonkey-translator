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
const { execFileSync } = require('child_process');

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

// An iOS .appex keeps its resources at the bundle root; a macOS one puts them under
// `Contents/Resources/`. Comparing a macOS bundle against the iOS assumption reports
// every dist file as missing — 71 of 71, which reads as a catastrophic packaging
// failure and is really just the wrong root. Read the layout off the bundle.
function resourceRoot(appex) {
  const mac = path.join(appex, 'Contents', 'Resources');
  return fs.existsSync(mac) ? mac : appex;
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

// The APP bundle, not the extension. `findAppex` deliberately dives past it; this one
// stops at the first `.app` that is not itself inside a `.appex`.
function findApp(root) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (e.name.endsWith('.app')) return p;
      if (e.name.endsWith('.appex')) continue;
      stack.push(p);
    }
  }
  return null;
}

// macOS keeps Info.plist under Contents/, iOS at the bundle root — same split as
// resourceRoot(), and getting it wrong reads as "the key is missing".
function plistPath(bundle) {
  const mac = path.join(bundle, 'Contents', 'Info.plist');
  return fs.existsSync(mac) ? mac : path.join(bundle, 'Info.plist');
}

function readPlist(f) {
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', f],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (_) { return null; }
}

// §9.5 background playback lives entirely in a plist key that `app:sync` injects into
// a gitignored, regenerated tree. Forgetting `npm run app:sync` therefore produces an
// app that installs fine and goes silent the moment the screen locks — the exact
// shape of "the feature was never built", and nothing in the build log says a word.
// So it is a gate, not a line in a checklist.
function checkBackgroundAudio(app, appex) {
  const isMac = fs.existsSync(path.join(app, 'Contents'));
  const appPlist = readPlist(plistPath(app));
  if (!appPlist) {
    console.error('✗ 读不到 App target 的 Info.plist —— 无法确认后台播放声明');
    return false;
  }
  const modes = appPlist.UIBackgroundModes || [];
  if (isMac) {
    // macOS is never suspended, so it needs nothing here — and declaring a background
    // mode it cannot use is something review asks about.
    if (modes.length) {
      console.error('✗ macOS App 声明了 UIBackgroundModes —— 它不需要，而且审核会问');
      return false;
    }
    console.log('✓ macOS App 没有 UIBackgroundModes（正确：那边进程不会被挂起）');
    return true;
  }
  if (!modes.includes('audio')) {
    console.error('✗ iOS App 的 Info.plist 里没有 UIBackgroundModes: audio');
    console.error('  播客模式 (§9.5) 会在锁屏那一刻静音，而构建日志一个字都不会说。');
    console.error('  修法：npm run app:sync（它必须在 xcodebuild archive 之前跑），然后重新归档。');
    return false;
  }
  const exPlist = appex ? readPlist(plistPath(appex)) : null;
  if (exPlist && (exPlist.UIBackgroundModes || []).length) {
    console.error('✗ 扩展 target 也声明了 UIBackgroundModes —— 它永不播放音频，不该有');
    return false;
  }
  console.log('✓ iOS App 声明了 UIBackgroundModes: audio（§9.5 后台播放），扩展 target 没有');
  return true;
}

function main() {
  // Gate B's "you cannot ship it" must hold for the iOS path too: SKIP_ZIP builds
  // (e.g. MT_SYNC_E2E) leave a .not-shippable marker in dist/, and the Xcode
  // project reads dist/ directly — so this check is the archive path's zip-refusal.
  const marker = path.join(ROOT, 'dist', '.not-shippable');
  if (fs.existsSync(marker)) {
    console.log('✗ dist/ 带 .not-shippable 标记（' + fs.readFileSync(marker, 'utf8').trim() + '）');
    console.log('  这是一个不可发布的构建 —— 归档/上传前先用正常参数重跑 node build.js。');
    process.exit(1);
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
  const inAppex = walk(resourceRoot(appex));
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

  const app = findApp(dd);
  if (!app) {
    console.error(`✗ no .app under ${dd} —— 找不到宿主 App，无法检查后台播放声明`);
    process.exit(1);
  }
  if (!checkBackgroundAudio(app, appex)) process.exit(1);
}

if (require.main === module) main();

module.exports = { resourceRoot, findApp, plistPath, checkBackgroundAudio };
