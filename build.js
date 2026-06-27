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
  const iconDir = path.join(distDir, 'icons');
  fs.mkdirSync(iconDir, { recursive: true });

  const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#0a7a3c"/>
  <path d="M68.87 75.07l-2.54-2.51.03-.03A17.52 17.52 0 0070.07 56H76V52H56V48H52v4H38v4h20.17C57.5 57.92 56.44 59.75 55 61.35c-.93-1.03-1.7-2.16-2.31-3.35h-2c.73 1.63 1.73 3.17 2.98 4.56L48.58 67.58 50 69l5-5 3.11 3.11.76-2.04zM74.5 50h-2L68 62h2l1.12-3h4.75L77 62h2l-4.5-12zm-2.62 7l1.62-4.33 1.62 4.33h-3.24z" fill="white" transform="translate(0,10)"/>
</svg>`;

  for (const size of [16, 48, 128]) {
    fs.writeFileSync(path.join(iconDir, `icon${size}.png`), svg(size));
  }
  log('Icons generated (SVG format — replace with real PNGs before store submission)');
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
