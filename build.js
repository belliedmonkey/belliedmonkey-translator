#!/usr/bin/env node
// build.js — Build and package the extension
// Usage:
//   node build.js                    → Chrome/Safari build, GLOBAL flavor (dist/)
//   node build.js --flavor china     → Chrome/Safari build, CHINA flavor (dist-china/)
//   node build.js firefox            → Firefox build (dist-firefox/)
//
// Flavor: GLOBAL ships Google/OpenAI/Claude/DeepSeek/GLM/Qwen/Kimi + custom.
// CHINA ships domestic only (DeepSeek/GLM/Qwen/Kimi + brand-free custom endpoints)
// and MUST contain no OpenAI/ChatGPT/Claude brand strings or api.openai.com /
// api.anthropic.com endpoints (App Store Guideline 5). Enforced by the compliance
// gate below. Provider set is the single source of truth in build/providers.config.js.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const argv = process.argv.slice(2);
const TARGET = argv.includes('firefox') ? 'firefox' : 'chrome';

function readFlavor() {
  const i = argv.findIndex((a) => a === '--flavor');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const kv = argv.find((a) => a.startsWith('--flavor='));
  return kv ? kv.split('=')[1] : 'global';
}
const FLAVOR = readFlavor() === 'china' ? 'china' : 'global';

const ROOT = __dirname;
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT,
  TARGET === 'firefox' ? 'dist-firefox' : (FLAVOR === 'china' ? 'dist-china' : 'dist'));
const ZIP = path.join(ROOT,
  TARGET === 'firefox' ? 'belliedmonkeytranslator-firefox.xpi'
    : (FLAVOR === 'china' ? 'belliedmonkeytranslator-china.zip' : 'belliedmonkeytranslator.zip'));

// Set to a reason string when the build is deliberately NOT shippable. dist/ is
// still written (so it can be loaded unpacked for testing) but the packaged
// artifact is withheld — see the Gate B escape hatch in validateManifest().
let SKIP_ZIP = null;

// RETIRED as of Gate B (v1.4.0, 2026-08-09): the source switch is now true, so
// `MT_SYNC=on` is a no-op kept only so old muscle memory / scripts don't fail.
// It used to flip the OUTPUT's `enabled` while the source stayed false — the
// self-use TestFlight channel for builds 14–23.
const SYNC_ON = process.env.MT_SYNC === 'on';

// Single-occurrence flip of the shipping switch inside a module's TEXT.
// Refuses to guess: zero or multiple matches fail the build, so a reshaped
// backend.config.js cannot be silently half-flipped. Since Gate B this runs in
// the OPPOSITE direction, for the CHINA flavor only: the China app is
// unreleased and its data-export compliance (PIPL, cross-border) has not been
// evaluated, so its artifact ships with sync OFF until that is its own gated
// release decision.
function flipSyncFlag(text, what, direction) {
  const on = direction === 'on';
  const NEEDLE = on ? 'enabled: false,' : 'enabled: true,';
  const first = text.indexOf(NEEDLE);
  if (first < 0 || text.indexOf(NEEDLE, first + 1) >= 0) {
    console.error(`✗ sync flip: expected exactly one \`${NEEDLE}\` in ${what}`);
    process.exit(1);
  }
  return text.replace(NEEDLE, on
    ? 'enabled: true, // flipped at build time — NOT SHIPPABLE'
    : 'enabled: false, // CHINA build: sync off until its own compliance gate (build.js)');
}

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

if (FLAVOR === 'china' && TARGET === 'firefox') { err('--flavor china is only for the Chrome/Safari build'); process.exit(1); }

// ─── i18n bundle ────────────────────────────────────────────────────────────
// chrome.i18n.getMessage is locked to the browser/OS locale and can't be switched
// at runtime. To support a user-selectable UI language we ship a synchronous JS
// table of all locale messages, consulted by t() before falling back to
// chrome.i18n. Generated from _locales/ so it never drifts.

// Chrome resolves `_locales/<dir>` ONLY for names on its supported-locale list, and it
// fails silently: an unsupported directory is simply never read, so `__MSG_*` in the
// manifest falls back to default_locale and the Chrome Web Store does not even offer that
// language for a store listing. Nothing in the repo can tell you — `_locales/pt` shipped a
// complete, key-identical, JSON-valid messages.json for three releases while Chrome ignored
// every byte of it, and it was only caught by noticing the store dashboard said 10 languages
// where the package had 11 (issue #65).
//
// So the directory names are a build gate, like version drift and data_collection_permissions.
// List per https://developer.chrome.com/docs/extensions/reference/api/i18n — note there is no
// bare `pt` (only pt_BR / pt_PT) and no bare `en_*` shortcuts beyond the ones below.
const CHROME_LOCALES = new Set([
  'am', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en_GB', 'en_US', 'es',
  'es_419', 'et', 'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id', 'it',
  'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no', 'pl', 'pt_BR', 'pt_PT',
  'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'vi',
  'zh_CN', 'zh_TW',
]);

function generateI18nMessages(dir) {
  const localesDir = path.join(dir, '_locales');
  const out = {};
  for (const loc of fs.readdirSync(localesDir)) {
    const f = path.join(localesDir, loc, 'messages.json');
    if (!fs.existsSync(f)) continue;
    if (!CHROME_LOCALES.has(loc)) {
      err(`_locales/${loc} is not a locale Chrome recognises — it would be silently ignored ` +
          `(no bare "pt": use pt_BR / pt_PT). See issue #65.`);
      process.exit(1);
    }
    let raw;
    try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { err(`Bad JSON in _locales/${loc}/messages.json`); process.exit(1); }
    const flat = {};
    for (const [k, v] of Object.entries(raw)) { if (v && typeof v.message === 'string') flat[k] = v.message; }
    out[loc] = flat;
  }
  const banner = '// AUTO-GENERATED by build.js from _locales/*/messages.json — do not edit by hand.\n';
  const body = 'window.MT_I18N_MESSAGES = ' + JSON.stringify(out) + ';\n';
  fs.writeFileSync(path.join(dir, 'content', 'i18n-messages.js'), banner + body);
  log(`Generated content/i18n-messages.js (${Object.keys(out).length} locales)`);
}

// ─── Provider registry bundle (per flavor) ──────────────────────────────────
// build/providers.config.js is the single source of truth. Filter it by flavor,
// resolve per-flavor defaultBase/label to single values, and emit providers.gen.js
// (window.MT_FLAVOR + window.MT_PROVIDERS) read by translation-api / options / popup.

function generateProviders(dir, flavor) {
  const CONFIG = require('./build/providers.config.js');
  const pick = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[flavor] ?? null) : (v ?? null);
  const providers = CONFIG
    .filter((p) => p.flavors.includes(flavor))
    .map((p) => ({
      id: p.id, type: p.type, label: pick(p.label), labelKey: p.labelKey || null,
      defaultBase: pick(p.defaultBase), path: p.path || null, defaultModel: p.defaultModel || '',
      needsKey: !!p.needsKey, supportsBaseUrl: !!p.supportsBaseUrl,
      supportsModel: !!p.supportsModel, requiresBaseUrl: !!p.requiresBaseUrl, hintKey: p.hintKey || null,
    }));
  const banner = '// AUTO-GENERATED by build.js from build/providers.config.js — do not edit by hand.\n';
  const body = `window.MT_FLAVOR = ${JSON.stringify(flavor)};\nwindow.MT_PROVIDERS = ${JSON.stringify(providers)};\n`;
  fs.writeFileSync(path.join(dir, 'content', 'providers.gen.js'), banner + body);
  log(`Generated content/providers.gen.js (${flavor}: ${providers.map((p) => p.id).join(', ')})`);
}

// ─── Palette registry bundle ────────────────────────────────────────────────
// build/palette.config.js is the single source of truth for every brand colour
// (design/handoff.md §1). Emits the runtime JS module and the shared CSS token
// sheet; legacyBrandGate() below refuses to ship the pre-2026-08 green.

function generatePalette(dir) {
  const P = require('./build/palette.config.js');
  const banner = '// AUTO-GENERATED by build.js from build/palette.config.js — do not edit by hand.\n';
  const body = `window.MT_PALETTE = ${JSON.stringify(P.runtime)};\n${P.roundBtnCssJs()}\n`;
  fs.writeFileSync(path.join(dir, 'content', 'palette.gen.js'), banner + body);
  fs.writeFileSync(path.join(dir, 'styles', 'organic-tokens.gen.css'), P.tokensCss());
  log('Generated content/palette.gen.js + styles/organic-tokens.gen.css');
}

// The pre-rebrand green family must never ship again. Only the storage
// migration in background.js may mention the legacy defaults (it retires them).
// `label` distinguishes the two gated artifacts (dist and dist-app).
function legacyBrandGate(dir, label, extraSrcDirs) {
  const P = require('./build/palette.config.js');
  // No blanket file exemptions — that shape was a hole (anything else in an
  // exempted file shipped ungated). background.js instead gets an EXACT
  // occurrence budget: precisely the one-shot migration's mention and nothing
  // more. Everything else: zero.
  const expected = { 'background.js': { '#0a7a3c': 1 } };
  // Legacy colours in every spelling that has actually appeared in this repo:
  // lowercase hex plus the rgba() triples the round buttons used pre-refactor.
  const forbidden = [...P.forbiddenLegacy, '10,122,60', '10, 122, 60'];
  const offenders = [];
  const count = (text, needle) => text.split(needle).length - 1;
  const scanFile = (p, rel) => {
    const text = fs.readFileSync(p, 'utf8').toLowerCase();
    const budget = expected[rel] || {};
    for (const needle of forbidden) {
      const n = count(text, needle);
      if (n !== (budget[needle] || 0)) offenders.push(`${rel} (${needle} ×${n}, expected ${budget[needle] || 0})`);
    }
  };
  const walk = (root, d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(root, p); continue; }
      if (!/\.(js|css|html|json|svg)$/.test(e.name)) continue;
      // posix-normalized so the expected-budget keys match on every OS
      scanFile(p, path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(dir, dir);
  // dist-app's Script.js is a concatenation — scanning the SOURCES it is built
  // from keeps per-file attribution instead of exempting the whole bundle.
  for (const extra of extraSrcDirs || []) walk(extra, extra);
  if (offenders.length) {
    err(`Legacy brand colours in ${label}: ${offenders.join(', ')} — palette lives in build/palette.config.js`);
    process.exit(1);
  }

  // Membership pin for the files that MUST keep literal brand hexes (page-injected
  // CSS and the mascot can't read a JS registry; the page stylesheets keep only
  // registry-known hexes): every 6-digit hex they use has to be a value the
  // registry knows, so a registry recolour turns this gate red instead of
  // letting those files silently keep the old brand.
  const known = new Set(
    [...Object.values(P.ramps), ...Object.values(P.runtime), ...Object.values(P.migration)]
      .filter((v) => typeof v === 'string' && v.startsWith('#'))
      .map((v) => v.toLowerCase()));
  ['#ffffff', '#000000'].forEach((n) => known.add(n));
  const pinned = ['styles/floating-button.css', 'styles/bilingual.css', 'icons/icon.svg',
    'options/options.html', 'popup/popup.css', 'options/options.css', 'learn/review.css',
    'background.js'].filter((f) => fs.existsSync(path.join(dir, f)));
  const drift = [];
  for (const f of pinned) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase();
    for (const hex of text.match(/#[0-9a-f]{6}\b/g) || []) {
      if (!known.has(hex)) drift.push(`${f} (${hex})`);
    }
  }
  if (drift.length) {
    err(`Brand hex not in the palette registry: ${drift.join(', ')} — add it to build/palette.config.js or use a registry colour`);
    process.exit(1);
  }
  log(`Palette gate OK (${label}: legacy budget exact; pinned files match the registry)`);
}

// ─── China: brand-free _locales ─────────────────────────────────────────────
// Rewrites dist-china/_locales/*/messages.json so the manifest's __MSG__ resolves
// to a China-safe description, and strips brand hint keys (hint_openai/hint_claude)
// that are unused in China but would otherwise carry OpenAI/Claude strings past the
// compliance gate. The i18n table is regenerated from these afterward.

// Which message keys belong ONLY to entries the China bundle does not ship — so their
// strings (which may name a brand) never reach the compliance gate.
//
// This used to be a hand-written list, `['hint_openai', 'hint_claude']`. That list was
// correct for the provider registry and silently wrong the moment a SECOND registry
// (speech engines) arrived with a brand hint of its own. Derive it from the registries
// instead: a list a human must remember to extend is not a gate, it is a wish. The
// derived set must match the old literal for providers — it does.
function chinaOnlyStripKeys() {
  const keysOf = (e) => [e.hintKey, e.labelKey].filter(Boolean);
  const out = new Set(), kept = new Set();
  for (const reg of [require('./build/providers.config.js'), require('./build/tts.config.js'), require('./build/stt.config.js')]) {
    for (const e of reg) for (const k of keysOf(e)) (e.flavors.includes('china') ? kept : out).add(k);
  }
  // A key shared with an entry China DOES ship must survive.
  return [...out].filter((k) => !kept.has(k));
}

// Brand words come from build/brands.js so a test can require them — see the note
// there about why this cannot live in build.js.
const { providerBrands } = require("./build/brands.js");

// ─── Gate: the store description must not name providers (issue #69) ───────
// `extension_description` had drifted to naming 4 of 9 providers — and the one it
// omitted was `google`, the zero-config default every new user meets first. Completing
// the list would only move the bug to the next registry change (and 9 names do not fit
// a 132-character store summary anyway), so the description describes the CAPABILITY
// and this gate keeps it that way.
//
// GLOBAL builds only. The China description is generated at build time from
// descriptions.china.js and already has the forbidden-brand grep over dist-china/.
function descriptionBrandGate(dir) {
  const brands = providerBrands();
  const localesDir = path.join(dir, '_locales');
  const hits = [];
  for (const loc of fs.readdirSync(localesDir)) {
    const f = path.join(localesDir, loc, 'messages.json');
    if (!fs.existsSync(f)) continue;
    const desc = (JSON.parse(fs.readFileSync(f, 'utf8')).extension_description || {}).message || '';
    for (const b of brands) {
      if (desc.toLowerCase().indexOf(b.toLowerCase()) >= 0) hits.push(`${loc}: "${b}" in ${JSON.stringify(desc.slice(0, 90))}`);
    }
  }
  if (hits.length) {
    err('extension_description names a provider — the registry is the single source of truth\n' +
        '  (CLAUDE.md: never re-state a model name, endpoint or provider list in UI strings).\n' +
        '  Describe the capability instead; the list will drift the moment the registry changes.\n' +
        hits.map((h) => '   ' + h).join('\n'));
    process.exit(1);
  }
  log(`Store description is provider-neutral (checked ${brands.length} brand tokens)`);
}

// ─── Gate: Apple caps the description at 112 characters ────────────────────
// Apple's App Store Connect validator rejects the whole upload with
//   "Invalid messages file … The description field must be present, of string type,
//    and 112 or fewer characters long."
// per offending locale. Chrome's store summary allows 132, which is what the #69
// rewrite was checked against — so six locales sailed through every local gate, built
// fine, installed fine on the simulator, and only failed at the TestFlight upload.
// Nothing before that point can see it, which is exactly why it is a gate now.
//
// Runs for BOTH flavors: the China descriptions are generated at build time and are
// just as capable of being too long.
const DESC_MAX = 112;

function descriptionLengthGate(dir) {
  const localesDir = path.join(dir, '_locales');
  const over = [];
  for (const loc of fs.readdirSync(localesDir)) {
    const f = path.join(localesDir, loc, 'messages.json');
    if (!fs.existsSync(f)) continue;
    const desc = (JSON.parse(fs.readFileSync(f, 'utf8')).extension_description || {}).message;
    if (typeof desc !== 'string' || !desc) { over.push(`${loc}: missing or not a string`); continue; }
    const n = [...desc].length;
    if (n > DESC_MAX) over.push(`${loc}: ${n} chars (max ${DESC_MAX}) — ${JSON.stringify(desc.slice(0, 60))}…`);
  }
  if (over.length) {
    err(`extension_description exceeds Apple's ${DESC_MAX}-character limit — App Store Connect\n` +
        `  rejects the upload, one error per locale, after a successful archive and export:\n` +
        over.map((o) => '   ' + o).join('\n'));
    process.exit(1);
  }
  log(`Store description within Apple's ${DESC_MAX}-char limit (all locales)`);
}

function applyChinaLocales(dir) {
  const DESC = require('./build/descriptions.china.js');
  const STRIP_KEYS = chinaOnlyStripKeys();
  const localesDir = path.join(dir, '_locales');
  for (const loc of fs.readdirSync(localesDir)) {
    const f = path.join(localesDir, loc, 'messages.json');
    if (!fs.existsSync(f)) continue;
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    let dirty = false;
    if (raw.extension_description) {
      // A locale with no China description must FAIL the build, not silently take the
      // English `_default`. That fallback hid #70 for two weeks: `_locales/pt` was
      // renamed `pt_BR` (#65) and `descriptions.china.js` kept the old `pt` key, so
      // Portuguese users of the China build would have seen an English description —
      // a compliant, brand-free, perfectly buildable wrong answer.
      //
      // `_default` stays, but now only as the last line of defence for a locale dir
      // that appears without warning; on the normal path it is never reached, and if
      // it ever is, this throws first. Deleting it instead would write `undefined`
      // into messages.json, which is worse than an English fallback.
      if (!DESC[loc]) {
        err(`no China description for locale "${loc}" — add it to build/descriptions.china.js.\n` +
            `  Falling back to English would ship a wrong description that still builds and still passes\n` +
            `  the brand grep (that is exactly how #70 survived). Present keys: ${Object.keys(DESC).filter((k) => k !== '_default').join(', ')}`);
        process.exit(1);
      }
      raw.extension_description.message = DESC[loc];
      dirty = true;
    }
    for (const k of STRIP_KEYS) { if (raw[k]) { delete raw[k]; dirty = true; } }
    if (dirty) fs.writeFileSync(f, JSON.stringify(raw, null, 2) + '\n');
  }
  log('Applied China-flavor locales (brand-free description + stripped brand hints)');
}

// ─── Compliance gate (China only) ───────────────────────────────────────────
// Fails the build if any brand reference to OpenAI/ChatGPT/Claude or a global
// endpoint leaks into the China bundle. `anthropic-version` (a protocol header for
// the generic Messages format) is intentionally NOT flagged — it is not a brand
// reference. See docs/domain-design.md.

function complianceGateChina(dir) {
  const FORBIDDEN = /ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com/i;
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|json|html|css|txt)$/.test(e.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (FORBIDDEN.test(line)) hits.push(`${path.relative(dir, p)}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
  })(dir);
  if (hits.length) {
    err(`China compliance gate FAILED — forbidden brand/endpoint references in dist-china/:`);
    hits.slice(0, 30).forEach((h) => console.error('   ' + h));
    process.exit(1);
  }
  log('China compliance gate passed (no OpenAI/ChatGPT/Claude/global-endpoint references)');
}

// ─── Speech (TTS) engine registry bundle ────────────────────────────────────
// build/tts.config.js is the single source of truth for speech engines. Same shape
// and same rules as generateProviders() above — a second capability, a second
// registry, never a hardcoded list at a call site.

function generateTts(dir, flavor) {
  const CONFIG = require('./build/tts.config.js');
  const engines = CONFIG.filter((e) => e.flavors.includes(flavor)).map((e) => ({
    id: e.id, type: e.type, label: e.label, labelKey: e.labelKey || null,
    defaultBase: e.defaultBase ?? null, path: e.path || null,
    defaultModel: e.defaultModel || '', voices: e.voices || null,
    needsKey: !!e.needsKey, supportsBaseUrl: !!e.supportsBaseUrl,
    supportsModel: !!e.supportsModel, requiresBaseUrl: !!e.requiresBaseUrl,
    returnsAudio: !!e.returnsAudio, hintKey: e.hintKey || null,
  }));
  const banner = '// AUTO-GENERATED by build.js from build/tts.config.js — do not edit by hand.\n';
  fs.writeFileSync(path.join(dir, 'content', 'tts.gen.js'),
    banner + `window.MT_TTS_ENGINES = ${JSON.stringify(engines)};\n`);
  log(`Generated content/tts.gen.js (${flavor}: ${engines.map((e) => e.id).join(', ')})`);
}

// ─── Speech-input (transcription) engine registry bundle ────────────────────
// build/stt.config.js is the single source of truth for transcription engines
// (learning-design §9.4). Same shape and rules as generateTts() above — a third
// capability, a third registry, never a hardcoded list at a call site.

function generateStt(dir, flavor) {
  const CONFIG = require('./build/stt.config.js');
  const engines = CONFIG.filter((e) => e.flavors.includes(flavor)).map((e) => ({
    id: e.id, type: e.type, label: e.label, labelKey: e.labelKey || null,
    defaultBase: e.defaultBase ?? null, path: e.path || null,
    defaultModel: e.defaultModel || '',
    needsKey: !!e.needsKey, supportsBaseUrl: !!e.supportsBaseUrl,
    supportsModel: !!e.supportsModel, requiresBaseUrl: !!e.requiresBaseUrl,
    hintKey: e.hintKey || null,
  }));
  const banner = '// AUTO-GENERATED by build.js from build/stt.config.js — do not edit by hand.\n';
  fs.writeFileSync(path.join(dir, 'content', 'stt.gen.js'),
    banner + `window.MT_STT_ENGINES = ${JSON.stringify(engines)};\n`);
  log(`Generated content/stt.gen.js (${flavor}: ${engines.map((e) => e.id).join(', ')})`);
}

// ─── Learnable-language registry bundle ─────────────────────────────────────
// build/langs.config.js is the single source of truth for the learning-language
// whitelist (learning-design §4.1). Not flavored: language names carry no brand.

function generateLangs(dir) {
  const CONFIG = require('./build/langs.config.js');
  const langs = CONFIG.map((l) => ({
    code: l.code, labelKey: l.labelKey || null, label: l.label, scripts: l.scripts || [],
  }));
  const banner = '// AUTO-GENERATED by build.js from build/langs.config.js — do not edit by hand.\n';
  fs.writeFileSync(path.join(dir, 'content', 'langs.gen.js'),
    banner + `window.MT_LANGS = ${JSON.stringify(langs)};\n`);
  log(`Generated content/langs.gen.js (${langs.map((l) => l.code).join(', ')})`);
}

// ─── Firefox manifest patch ────────────────────────────────────────────────

function patchManifestForFirefox() {
  const manifestPath = path.join(DIST, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  m.background = { scripts: ['background.js'] };
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));
  log('Patched manifest.json for Firefox (background.scripts)');
}

// ─── Generate icons ────────────────────────────────────────────────────────

function generateIcons(distDir) {
  const iconDir = path.join(distDir, 'icons');
  const isPng = (p) => {
    if (!fs.existsSync(p)) return false;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
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
  // Firefox requires an explicit data-collection disclosure on every new AMO
  // submission since 2025-11-03; AMO's validator hard-fails without it. Since Gate B
  // (v1.4.0, 2026-08-09) the honest value is THREE entries: `websiteContent` (page /
  // transcript text goes to the user's chosen provider, and captured sentences go to
  // sync), `browsingActivity` (the sync source table is URL + title + time — §8.6:
  // "the sensitive column is the URL"), and `personallyIdentifyingInfo` (the account
  // is an email address). The exact-value check lives in the Gate B block below —
  // this one only guards presence, which AMO itself enforces.
  const dcp = m.browser_specific_settings?.gecko?.data_collection_permissions?.required;
  if (!Array.isArray(dcp) || dcp.length === 0) {
    err('Missing gecko.data_collection_permissions.required (AMO rejects the upload without it)');
    process.exit(1);
  }
  // A version literal inside a translated string has as many copies as there are
  // locales and tracks none of them: `about_line` said "v1.0.0" in all eleven while
  // the manifest was 1.3.0, and nothing anywhere noticed. Same disease as a model
  // name in a hint — one registry, N consumers (AGENTS.md).
  for (const loc of fs.readdirSync(path.join(distDir, '_locales'))) {
    const f = path.join(distDir, '_locales', loc, 'messages.json');
    if (!fs.existsSync(f)) continue;
    const msgs = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [k, v] of Object.entries(msgs)) {
      if (/\bv?\d+\.\d+\.\d+\b/.test(String(v && v.message))) {
        err(`_locales/${loc}/messages.json key "${k}" hardcodes a version: ` +
            `"${v.message}"\nRender it from chrome.runtime.getManifest().version instead — ` +
            `a version inside a translation has N copies and tracks none of them.`);
        process.exit(1);
      }
    }
  }

  // ─── Sync flag ↔ privacy promise, coupled mechanically ───────────────────
  // learning-design.md §10 Gate B. Turning sync on makes four sentences false at
  // once ("no account", "we receive nothing", "never uploaded", "no servers of
  // ours in the middle" as applied to the corpus). Every one of them is somewhere
  // a build cannot see — the README, a website, a store listing — so the only
  // thing that can be checked here is the one that lives in this repo. A promise
  // whose upkeep depends on someone remembering at release time is the kind that
  // gets broken; this makes forgetting fail the build instead.
  const backend = require('./extension/learn/backend.config.js');
  if (backend.enabled) {
    // Gate B is LIVE (v1.4.0): the switch is on, so this block now guards the
    // opposite direction — no stale "never uploaded / no account" sentence may
    // survive anywhere the repo can see. Three checks, each a real incident
    // class: the English README (the original gate), the Chinese README (was
    // ungated and shipped without even the Gate A bullet), and the in-product
    // learn_section_hint × 11 locales (README row 3's UI twin, was ungated).
    const staleHits = [];
    const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
    if (readme.includes('**No account, no tracking, no telemetry.**')) {
      staleHits.push('README.md: "No account, no tracking, no telemetry"');
    }
    if (readme.includes('it is never uploaded')) {
      staleHits.push('README.md: "it is never uploaded"');
    }
    const readmeZh = fs.readFileSync(path.join(__dirname, 'README.zh-CN.md'), 'utf8');
    if (readmeZh.includes('无账号、无追踪、无遥测')) {
      staleHits.push('README.zh-CN.md: 「无账号、无追踪、无遥测」');
    }
    // The false-claim fingerprints across the 11 locales. Any hint that promises
    // no-upload WITHOUT the sync qualifier is a lie the moment sync ships.
    const FALSE_CLAIMS = [
      /不会上传/, /不會上傳/, /Nothing is uploaded, and/, /アップロードは一切行われず/,
      /Nichts wird hochgeladen, und/, /No se sube nada\./, /Rien n'est envoyé\./,
    ];
    for (const loc of fs.readdirSync(path.join(distDir, '_locales'))) {
      const f = path.join(distDir, '_locales', loc, 'messages.json');
      if (!fs.existsSync(f)) continue;
      const hint = String(JSON.parse(fs.readFileSync(f, 'utf8')).learn_section_hint?.message || '');
      if (FALSE_CLAIMS.some((re) => re.test(hint))) {
        staleHits.push(`_locales/${loc} learn_section_hint still claims no-upload`);
      }
    }
    // The declaration must be the full Gate B value, not merely present.
    const WANT_DCP = ['websiteContent', 'browsingActivity', 'personallyIdentifyingInfo'];
    if (JSON.stringify((dcp || []).slice().sort()) !== JSON.stringify(WANT_DCP.slice().sort())) {
      staleHits.push(`gecko.data_collection_permissions.required is [${dcp}] — Gate B requires exactly [${WANT_DCP}]`);
    }
    if (staleHits.length) {
      // Escape hatch for end-to-end verification, and ONLY that: it forbids the
      // shippable artifact instead of weakening the invariant — dist/ is built
      // (loadable unpacked) but no .zip, and a .not-shippable marker blocks the
      // iOS archive path via verify:ios.
      if (process.env.MT_SYNC_E2E === '1') {
        SKIP_ZIP = 'sync enabled with stale privacy copy (MT_SYNC_E2E)';
        log(`\x1b[33mGate B bypassed for E2E testing — no .zip will be produced.\x1b[0m`);
      } else {
        err(`sync is enabled (learn/backend.config.js) but stale privacy copy survives:\n` +
            staleHits.map((s) => `  · ${s}`).join('\n') + `\n` +
            `Every one of these is false the moment an account exists — see ` +
            `docs/learning-design.md §10 Gate B.\n` +
            `To build a test bundle without shipping one: MT_SYNC_E2E=1 node build.js`);
        process.exit(1);
      }
    }
  }

  // The extension version (manifest) and the repo version (package.json) are bumped
  // by the same release step and must not drift — they silently did through 1.1.0.
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
  if (m.version !== pkgVersion) {
    err(`version drift: manifest.json ${m.version} != package.json ${pkgVersion} — bump both`);
    process.exit(1);
  }
  log('manifest.json valid');
}

// ─── Main ─────────────────────────────────────────────────────────────────

const isFirefox = TARGET === 'firefox';
console.log(`\n\x1b[1mBuilding Mobile Translator — ${isFirefox ? 'Firefox' : 'Chrome/Safari'} · flavor: ${FLAVOR}\x1b[0m\n`);

// Clean
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
if (fs.existsSync(ZIP)) fs.unlinkSync(ZIP);

// Regenerate committed source bundles (always GLOBAL into extension/, so the
// source tree never flips per flavor). China overrides them in DIST after copy.
generateI18nMessages(SRC);
generateProviders(SRC, 'global');
generateTts(SRC, 'global');
generateStt(SRC, 'global');
generateLangs(SRC);
generatePalette(SRC);

// Copy sources
copyDir(SRC, DIST);
log(`Copied extension sources → ${path.basename(DIST)}/`);

// MT_SYNC=on retired (Gate B): sync is on in source. Warn instead of failing so
// old scripts keep working, but make clear nothing special happened.
if (SYNC_ON) {
  log('\x1b[33mMT_SYNC=on is a no-op since v1.4.0 — sync is publicly enabled in source (Gate B).\x1b[0m');
}

// Flavor overrides applied to DIST only
if (FLAVOR === 'china') {
  applyChinaLocales(DIST);
  generateI18nMessages(DIST);      // rebuild i18n table from the scrubbed China locales
  generateProviders(DIST, 'china'); // overwrite providers.gen.js with the China set
  generateTts(DIST, 'china');       // …and tts.gen.js with the China speech set
  generateStt(DIST, 'china');       // …and stt.gen.js with the China transcription set
  // Sync OFF in the China artifact (source stays true): the China app is
  // unreleased and PIPL/cross-border compliance is unevaluated. Its own Gate,
  // its own release decision — see backend.config.js header.
  const cfgPath = path.join(DIST, 'learn', 'backend.config.js');
  fs.writeFileSync(cfgPath, flipSyncFlag(fs.readFileSync(cfgPath, 'utf8'), 'dist-china/learn/backend.config.js', 'off'));
  log('China flavor: sync disabled in artifact (enabled → false)');
}

// Firefox-specific patches
if (isFirefox) patchManifestForFirefox();

// Generate icons
generateIcons(DIST);

// Palette gate — no legacy brand colours may ship
legacyBrandGate(DIST, path.basename(DIST));

// Validate
validateManifest(DIST, isFirefox);

// China compliance gate (after all DIST content is final)
if (FLAVOR === 'china') complianceGateChina(DIST);

// Store-description gate (global builds only — see the function comment)
if (FLAVOR !== 'china') descriptionBrandGate(DIST);

// Length gate runs for BOTH flavors — Apple rejects the upload, not the build.
descriptionLengthGate(DIST);

// ─── Host app assets (learning-design §7.2) ─────────────────────────────────
// Built from `app/` plus the SAME shared modules the extension ships — not copies of
// them (§9: "not a second engine"). Global flavor only for now: the app is an Apple
// surface and the China build has no App Store presence yet, so building it there
// would ship an untested target rather than a feature.
if (FLAVOR === 'global') {
  const { buildAppBundle } = require('./build/app-bundle.js');
  // syncOn flip retired with Gate B — the source flag is true; the bundle
  // concatenates it as-is.
  buildAppBundle(path.join(ROOT, "dist-app"), log, {});
  legacyBrandGate(path.join(ROOT, "dist-app"), "dist-app", [path.join(ROOT, "app")]);
}

// ─── .not-shippable marker — closes the iOS archive hole ───────────────────
// release-checklist「Gate B 的缺口」: SKIP_ZIP withholds the .zip, but the iOS
// shippable is an .xcarchive built FROM dist/, which SKIP_ZIP never touched —
// so a bypassed build could still reach TestFlight/App Store unimpeded. The
// marker travels with dist/; scripts/verify-ios-bundle.js refuses (exit 1) when
// it is present, and a normal build removes it.
const MARKER = path.join(DIST, '.not-shippable');
if (SKIP_ZIP) fs.writeFileSync(MARKER, SKIP_ZIP + '\n');
else if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER);

// Zip (Firefox .xpi is just a zip)
if (SKIP_ZIP) {
  log(`\x1b[33mNOT packaged — ${SKIP_ZIP}.\x1b[0m`);
  log(`${path.basename(DIST)}/ is loadable unpacked for testing only.`);
} else try {
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
`);
} else if (FLAVOR === 'china') {
  console.log(`
\x1b[1mChina Build Done!\x1b[0m (domestic providers only)

本地测试:
  chrome://extensions/ → 开发者模式 → 加载已解压 → \x1b[36m${DIST}\x1b[0m

转换为 Safari（中国版,独立 bundle id）:
  bash build-safari.sh china
`);
} else {
  console.log(`
\x1b[1mChrome Build Done!\x1b[0m (global providers)

本地测试:
  chrome://extensions/ → 开发者模式 → 加载已解压 → \x1b[36m${DIST}\x1b[0m

转换为 Safari（需 macOS + Xcode）:
  xcrun safari-web-extension-converter ${DIST} --project-location ./safari-project --app-name "BelliedMonkey Translator"
`);
}
