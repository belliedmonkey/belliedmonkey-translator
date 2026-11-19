// build/sentry-inject.js — BEL-303 build-time SDK bundling + DSN injection.
//
// Mirrors build/backend-inject.js: the source tree carries only an inert `.invalid`
// placeholder; the global build replaces it with the public write key from the
// environment, while the China build writes an empty DSN and no vendor file.
//
// SDK shape (arch RESULT §2): esbuild minify:true IIFE with init + captureException
// (+ captureEvent, which the SW uses so it never has to `new Error(payload.message)`).
// It is a build-time-only devDependency; runtime dependencies stay at zero.
//
// Forbidden by design: `extension/vendor/sentry/` in the source tree. The only vendor
// file is written into the global DIST after copyDir, so `copyDir` can never carry it
// into dist-china.
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { FLOOR } = require('./os-floor.config.js');
const config = require('./sentry.config.js');

const VENDOR_REL = path.join('vendor', 'sentry.min.js');
let vendorCache = null;

function vendorSource() {
  if (vendorCache) return vendorCache;
  const r = esbuild.buildSync({
    stdin: {
      contents: [
        "import { init, captureException, captureEvent } from '@sentry/browser';",
        'globalThis.Sentry = { init: init, captureException: captureException, captureEvent: captureEvent };',
      ].join('\n'),
      resolveDir: path.join(__dirname, '..'),
      sourcefile: 'sentry-vendor.js',
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['safari' + FLOOR.safari],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  vendorCache = r.outputFiles[0].text;
  return vendorCache;
}

function crashSource(root, values) {
  const src = fs.readFileSync(path.join(root, 'src', 'lib', 'crash.js'), 'utf8');
  return config.apply(src, values);
}

// App: the block becomes the first IIFE in Script.js after MT_HOST/MT_APP_VERSION.
// Global carries the minified SDK inline; China carries only the crash module, whose
// empty DSN makes init a no-op (no vendor bytes, no sentry host).
function scriptBlock(root, flavor) {
  const values = config.resolve(root, flavor);
  const crash = crashSource(root, values);
  if (flavor === 'china') return crash;
  // One outer IIFE so the crash reporter is literally the first IIFE after
  // MT_HOST / MT_APP_VERSION: the minified SDK and the crash module are its body.
  return '/* BEL-303 crash reporter (SDK esbuild minify IIFE; build-time dep only) */\n'
    + '(function () {\n' + vendorSource() + '\n' + crash + '\n})();';
}

// Extension: write the vendor file only for global DIST, then prepend the SDK import
// and crash module to background.js. The source background.js carries the SW message
// listener; its `MTCrash` calls are guarded so source-level tests still run.
function applyToDist(root, distDir, flavor) {
  const values = config.resolve(root, flavor);
  const crash = crashSource(root, values);
  const bgPath = path.join(distDir, 'background.js');
  let bg = fs.readFileSync(bgPath, 'utf8');
  let vendorWritten = false;
  if (flavor !== 'china') {
    const vendorPath = path.join(distDir, VENDOR_REL);
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
    fs.writeFileSync(vendorPath, vendorSource());
    bg = "import './vendor/sentry.min.js';\n" + crash + '\n' + bg;
    vendorWritten = true;
  } else {
    bg = crash + '\n' + bg;
  }
  fs.writeFileSync(bgPath, bg);

  // content-main.js is the webpage entry. Prepending the forwarder keeps the manifest
  // untouched (no new content_scripts file, no extra synchronous surface) and keeps
  // the SDK out of content.
  const contentMain = path.join(distDir, 'content', 'content-main.js');
  if (fs.existsSync(contentMain)) {
    const forward = fs.readFileSync(path.join(root, 'src', 'lib', 'crash-forward.js'), 'utf8');
    fs.writeFileSync(contentMain, forward + '\n' + fs.readFileSync(contentMain, 'utf8'));
  }

  return { dsnSet: Boolean(values.dsn), flavor: values.flavor, vendorWritten };
}

function describe(root, flavor) {
  const v = config.resolve(root, flavor);
  return { dsnSet: Boolean(v.dsn), release: v.release, flavor: v.flavor, source: v.source };
}

module.exports = {
  vendorSource,
  crashSource,
  scriptBlock,
  applyToDist,
  describe,
  VENDOR_REL,
  _resetVendorCache: () => { vendorCache = null; },
};
