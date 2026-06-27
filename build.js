#!/usr/bin/env node
// build.js — Build and package the extension
// Usage:
//   node build.js           → Chrome/Safari build (dist/ + mobile-translator.zip)
//   node build.js firefox   → Firefox build (dist-firefox/ + mobile-translator-firefox.xpi)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGET = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';
const ROOT = __dirname;
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, TARGET === 'firefox' ? 'dist-firefox' : 'dist');
const ZIP = path.join(ROOT, TARGET === 'firefox' ? 'mobile-translator-firefox.xpi' : 'mobile-translator.zip');

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

// ─── Firefox manifest patch ────────────────────────────────────────────────
// Firefox MV3 uses background.scripts[] instead of background.service_worker

function patchManifestForFirefox() {
  const manifestPath = path.join(DIST, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Firefox MV3: replace service_worker with scripts array
  m.background = { scripts: ['background.js'] };

  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));
  log('Patched manifest.json for Firefox (background.scripts)');
}

// ─── Generate icons ────────────────────────────────────────────────────────

function generateIcons(distDir) {
  // Real PNG icons live in extension/icons/ and are copied into dist/ by
  // copyDir(). Here we just validate they are genuine PNGs (not SVG renamed),
  // since Safari/Xcode and the Chrome Web Store reject non-raster icons.
  const iconDir = path.join(distDir, 'icons');
  const isPng = (p) => {
    if (!fs.existsSync(p)) return false;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  };

  const missing = [16, 48, 128]
    .filter((s) => !isPng(path.join(iconDir, `icon${s}.png`)))
    .map((s) => `icon${s}.png`);

  if (missing.length) {
    err(`Missing or non-PNG icons: ${missing.join(', ')} — regenerate from extension/icons/icon.svg`);
    process.exit(1);
  }
  log('Icons OK (real PNG)');
}

// ─── Validate manifest ─────────────────────────────────────────────────────

function validateManifest(distDir, isFirefox) {
  const m = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
  if (m.manifest_version !== 3) { err('manifest_version must be 3'); process.exit(1); }
  if (isFirefox && !m.background?.scripts) { err('Firefox build missing background.scripts'); process.exit(1); }
  if (!isFirefox && !m.background?.service_worker) { err('Chrome build missing background.service_worker'); process.exit(1); }
  if (!m.browser_specific_settings?.gecko?.id) { err('Missing gecko.id (required for AMO)'); process.exit(1); }
  log('manifest.json valid');
}

// ─── Main ─────────────────────────────────────────────────────────────────

const isFirefox = TARGET === 'firefox';
console.log(`\n\x1b[1mBuilding Mobile Translator — ${isFirefox ? 'Firefox' : 'Chrome/Safari'}\x1b[0m\n`);

// Clean
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
if (fs.existsSync(ZIP)) fs.unlinkSync(ZIP);

// Copy sources
copyDir(SRC, DIST);
log(`Copied extension sources → ${path.basename(DIST)}/`);

// Firefox-specific patches
if (isFirefox) patchManifestForFirefox();

// Generate icons
generateIcons(DIST);

// Validate
validateManifest(DIST, isFirefox);

// Zip (Firefox .xpi is just a zip)
try {
  execSync(`cd "${DIST}" && zip -r "${ZIP}" .`, { stdio: 'pipe' });
  const zipSize = Math.round(fs.statSync(ZIP).size / 1024);
  log(`Packaged → ${path.basename(ZIP)} (${zipSize} KB)`);
} catch (e) {
  log(`zip not available — ${path.basename(DIST)}/ is ready`);
}

if (isFirefox) {
  console.log(`
\x1b[1mFirefox Build Done!\x1b[0m

本地测试（Firefox 桌面版）:
  1. 打开 about:debugging
  2. "此 Firefox" → "临时载入附加组件"
  3. 选择 \x1b[36m${ZIP}\x1b[0m（或 ${path.basename(DIST)}/manifest.json）

提交到 AMO（addons.mozilla.org）:
  1. 注册账号：https://addons.mozilla.org/developers/
  2. 提交新附加组件 → 上传 \x1b[36m${path.basename(ZIP)}\x1b[0m
  3. 选择"在 AMO 上架" → 免费公开
  4. 填写描述、截图 → 提交审核（通常 1-3 天）

Firefox Android 安装（已上架后）:
  手机 Firefox → 附加组件 → 搜索"大肚猴翻译" → 安装
`);
} else {
  console.log(`
\x1b[1mChrome Build Done!\x1b[0m

本地测试:
  chrome://extensions/ → 开发者模式 → 加载已解压 → \x1b[36m${DIST}\x1b[0m

转换为 Safari（需 macOS + Xcode）:
  xcrun safari-web-extension-converter ${DIST} --project-location ./safari-project --app-name MobileTranslator
`);
}
