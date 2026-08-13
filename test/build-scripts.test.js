// test/build-scripts.test.js — the two release scripts' layout assumptions.
//
// Both scripts were written against the iOS/dual-platform layout the converter emits
// by default, and both got a macOS bundle wrong in a way that looked like something
// else entirely:
//
//   · `sync-app-assets.js` looks for `Shared (App)`. A `--macos-only` project has no
//     such folder, so it printed "未生成，跳过" — indistinguishable from "no project
//     here" — and patched nothing. The shipped macOS 1.4.1 host app therefore carried
//     the converter's 979-byte template Main.html instead of our 19543-byte app, for
//     three releases, with no output ever saying so.
//   · `verify-ios-bundle.js` walks the .appex from its root. macOS keeps resources in
//     `Contents/Resources/`, so all 71 dist files came back "NOT in the built
//     extension" — a false alarm shaped exactly like the real 2026-08-04 accident
//     (the whole `learn/` directory genuinely missing from the appex).
//
// The rule both encode: **a layout you don't recognise is an error, not an absence.**

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, eq, deepEq } = require('./harness');

const { classifyProject } = require('../scripts/sync-app-assets.js');
const { resourceRoot } = require('../scripts/verify-ios-bundle.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-build-scripts-'));
}
function mk(...parts) {
  const p = path.join(...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

describe('sync-app-assets: project layout classification', () => {
  test('a project root that does not exist is absent — silence is correct here', () => {
    const root = tmpdir();
    const res = classifyProject(path.join(root, 'safari-project'));
    eq(res.state, 'absent');
    deepEq(res.dirs, []);
  });

  test('the dual-platform layout is recognised and yields its Shared (App) dir', () => {
    const root = mk(tmpdir(), 'safari-project');
    const shared = mk(root, 'BelliedMonkey Translator', 'Shared (App)');
    mk(root, 'BelliedMonkey Translator', 'iOS (App)');
    mk(root, 'BelliedMonkey Translator', 'macOS (App)');
    const res = classifyProject(root);
    eq(res.state, 'ok');
    deepEq(res.dirs, [shared]);
  });

  // The regression itself: the tree IS there, so reporting "absent" (and moving on)
  // is the one answer that ships a broken app. It must be its own state.
  test('a --macos-only flat layout is unrecognized, NOT absent', () => {
    const root = mk(tmpdir(), 'safari-project-macos');
    mk(root, 'BelliedMonkey Translator', 'BelliedMonkey Translator');
    mk(root, 'BelliedMonkey Translator', 'BelliedMonkey Translator Extension');
    const res = classifyProject(root);
    eq(res.state, 'unrecognized', 'a present-but-unpatchable project must not read as absent');
    deepEq(res.dirs, []);
  });

  test('an empty project root is unrecognized too — something made it, nothing usable in it', () => {
    const root = mk(tmpdir(), 'safari-project');
    eq(classifyProject(root).state, 'unrecognized');
  });
});

describe('verify-ios-bundle: appex resource root', () => {
  test('iOS bundle — resources sit at the appex root', () => {
    const appex = mk(tmpdir(), 'Extension.appex');
    mk(appex, 'content');
    eq(resourceRoot(appex), appex);
  });

  test('macOS bundle — resources sit under Contents/Resources', () => {
    const appex = mk(tmpdir(), 'Extension.appex');
    const res = mk(appex, 'Contents', 'Resources');
    mk(res, 'content');
    eq(resourceRoot(appex), res);
  });

  // Guards the discriminator itself: `Contents/` alone (no Resources) is not the
  // macOS resource layout, and picking it would report every file missing again.
  test('Contents/ without Resources/ falls back to the appex root', () => {
    const appex = mk(tmpdir(), 'Extension.appex');
    mk(appex, 'Contents', 'MacOS');
    eq(resourceRoot(appex), appex);
  });
});
