#!/usr/bin/env node
// build.js — Build and package the extension

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const ZIP = path.join(ROOT, 'mobile-translator.zip');

// ─── Helpers ──────────────────────────────────────────────────────────────

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, dstPath);
    else fs.copyFileSync(srcPath, dstPath);
  }
}

function log(msg) { console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
function err(msg) { console.error(`\x1b[31m✗\x1b[0m ${msg}`); }

// ─── Generate SVG icons as PNG via canvas (or write inline SVG) ───────────

function generateIcons() {
  const iconDir = path.join(DIST, 'icons');
  fs.mkdirSync(iconDir, { recursive: true });

  // Try to use canvas for real PNGs, fallback to SVG renamed as PNG
  // (Safari accepts SVG data URIs and most browsers handle SVG-as-PNG in manifest)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#0a7a3c"/>
  <path d="M68.87 75.07l-2.54-2.51.03-.03A17.52 17.52 0 0070.07 56H76V52H56V48H52v4H38v4h20.17C57.5 57.92 56.44 59.75 55 61.35c-.93-1.03-1.7-2.16-2.31-3.35h-2c.73 1.63 1.73 3.17 2.98 4.56L48.58 67.58 50 69l5-5 3.11 3.11.76-2.04zM74.5 50h-2L68 62h2l1.12-3h4.75L77 62h2l-4.5-12zm-2.62 7l1.62-4.33 1.62 4.33h-3.24z" fill="white" transform="translate(0, 10)"/>
</svg>`;

  const sizes = [16, 48, 128];

  // Try node-canvas first
  let canvasAvailable = false;
  try {
    const { createCanvas } = require('canvas');
    const { DOMParser } = require('@xmldom/xmldom');
    canvasAvailable = true;

    // Actually generate PNGs via canvas
    for (const size of sizes) {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');

      // Background
      ctx.fillStyle = '#0a7a3c';
      const r = size * 0.22;
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, r);
      ctx.fill();

      // T icon (simplified)
      ctx.fillStyle = '#ffffff';
      const s = size / 2;
      ctx.font = `bold ${Math.floor(s * 0.8)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('T', size / 2, size / 2);

      const buffer = canvas.toBuffer('image/png');
      fs.writeFileSync(path.join(iconDir, `icon${size}.png`), buffer);
      log(`Generated icon${size}.png (canvas)`);
    }
  } catch (_) {
    // Fallback: write SVG as .png files (works in Chrome/Firefox, good enough for dev)
    for (const size of sizes) {
      const sized = svg.replace('128 128', `${size} ${size}`);
      fs.writeFileSync(path.join(iconDir, `icon${size}.png`), sized);
    }
    log('Icons written as SVG (rename or convert to PNG for production)');
  }
}

// ─── Validate manifest ────────────────────────────────────────────────────

function validateManifest() {
  const manifestPath = path.join(DIST, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (m.manifest_version !== 3) { err('manifest_version must be 3'); process.exit(1); }
  if (!m.background?.service_worker) { err('Missing background.service_worker'); process.exit(1); }
  log('manifest.json valid');
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log('\n\x1b[1mBuilding Mobile Translator Extension\x1b[0m\n');

// Clean
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
if (fs.existsSync(ZIP)) fs.unlinkSync(ZIP);

// Copy sources
copyDir(SRC, DIST);
log('Copied extension sources → dist/');

// Generate icons
generateIcons();

// Validate
validateManifest();

// Zip
try {
  execSync(`cd "${ROOT}" && zip -r mobile-translator.zip dist/`, { stdio: 'pipe' });
  const zipSize = Math.round(fs.statSync(ZIP).size / 1024);
  log(`Packaged → mobile-translator.zip (${zipSize} KB)`);
} catch (e) {
  log('zip not available — dist/ is ready to load as unpacked extension');
}

console.log(`
\x1b[1mDone!\x1b[0m

Load in Chrome/Edge:
  1. Open chrome://extensions/
  2. Enable "Developer mode"
  3. Click "Load unpacked" → select \x1b[36m${DIST}\x1b[0m

Convert for Safari (requires macOS + Xcode):
  xcrun safari-web-extension-converter ${DIST} --project-location ./safari-project --app-name MobileTranslator
`);
