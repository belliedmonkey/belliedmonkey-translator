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

// 中国版只提供 Apple 登录（2026-09-03 用户裁定）。
//
// Google 在中国大陆连不上。留着那个按钮，对绝大多数中国版用户就是一个点了转圈然后
// 失败的东西 —— 与这一轮反复在修的「点了没反应」是同一类，只是原因在网络那一侧。
// 而「能不能连上」是**用户所在网络的事实**，客户端猜不出来，只能由 flavor 决定。
//
// 判据同 flipSyncFlag：**恰好一处**，多一处或没有都退出 —— 静默改错一处的代价是
// 中国版包里留着一个死按钮，而拆包 grep 之前没人看得见。
// ── 中国版的境内后端（§C）────────────────────────────────────────────────
//
// 读**源码树**那一份，不是产物 —— 判据要在改写之前就定下来，否则会读到自己刚写的值。
function chinaBackend() {
  const cfg = require('./extension/learn/backend.config.js');
  return (cfg && cfg.china) || { ready: false, url: '', anonKey: '' };
}
function chinaBackendReady() {
  const cn = chinaBackend();
  return cn.ready === true && !!cn.url && !!cn.anonKey;
}

// 把产物里的 url / anonKey 换成境内那一套。
//
// 与 flipSyncFlag / limitProviders 同一条纪律：**恰好一处**，否则 exit(1)。
// 一个静默的 0 处替换会产出一个「说自己是中国版、其实还在打东京」的包 ——
// 那是这个仓库最贵的那类谎，而它在产物里完全看不出来。
function switchBackend(text, what, cn) {
  const out = [['url', cn.url], ['anonKey', cn.anonKey]].reduce((acc, [key, val]) => {
    // 只匹配**顶层**那一条（行首两个空格），不碰 china 块里的同名键（四个空格）。
    const RE = new RegExp(`^  ${key}: '[^']*',`, 'm');
    const hits = acc.match(new RegExp(RE.source, 'gm')) || [];
    if (hits.length !== 1) {
      console.error(`✗ backend switch: expected exactly one top-level \`${key}\` in ${what}, got ${hits.length}`);
      process.exit(1);
    }
    return acc.replace(RE, `  ${key}: '${val}', // CHINA build: 境内后端（build.js）`);
  }, text);
  // 产物里不该再留着那个块 —— 它只是源码里的一个决策记录，进了包就是第二个可信来源。
  return out.replace(/\n  china: \{[\s\S]*?\n  \},\n/, '\n');
}

function limitProviders(text, what, list) {
  const NEEDLE = "providers: ['apple', 'google'],";
  const first = text.indexOf(NEEDLE);
  if (first < 0 || text.indexOf(NEEDLE, first + 1) >= 0) {
    console.error(`✗ providers: expected exactly one \`${NEEDLE}\` in ${what}`);
    process.exit(1);
  }
  return text.replace(NEEDLE,
    `providers: ${JSON.stringify(list).replace(/"/g, "'")}, // CHINA build: Google 在大陆连不上（build.js）`);
}

// 默认引擎必须是**本 flavor 注册表里存在**的 id。
//
// 2026-08-22 实测:中国版出货包的默认是 `provider: 'google'`,而 google 的 flavors 是
// ['global'],于是它在中国版注册表里根本不存在。运行时 `providerById` 返回 null,
// `callProvider` 的 `!p` 分支静默落到 translate.googleapis.com —— 一份刚装好、没填
// 任何 Key 的中国版,真的把 38 段译文翻了出来,输出与直接打 Google 的返回逐字相同。
//
// 而设置页的 <select> 里没有 google 这个选项,浏览器把它强制显示成第一项(DeepSeek),
// 于是**界面写着 DeepSeek,实际发的是 Google**。国内用户那条地址还不通,一段段等到
// 20 秒超时——就是「翻译中…」不动的形状。静默兜底 + 界面与运行时不一致,两样都占。
function rewriteDefaultProvider(text, what, providerId) {
  const NEEDLE = "provider: 'google',";
  const first = text.indexOf(NEEDLE);
  if (first < 0 || text.indexOf(NEEDLE, first + 1) >= 0) {
    console.error(`✗ default provider rewrite: expected exactly one \`${NEEDLE}\` in ${what}`);
    process.exit(1);
  }
  return text.replace(NEEDLE, `provider: '${providerId}', // CHINA build: google is not in this flavor's registry (build.js)`);
}

// 门禁:两个 flavor 都查。**一个 flavor 的默认值指向它自己注册表里没有的引擎,是错误**,
// 而这种错误在构建期完全看得见——上面那个 bug 出货了才被真机发现,不该再有第二次。
function defaultProviderGate(dir, label, flavor) {
  const bg = fs.readFileSync(path.join(dir, 'background.js'), 'utf8');
  const m = /provider:\s*'([a-z_]+)'/.exec(bg);
  if (!m) { err(`${label}: 在 background.js 里找不到默认 provider`); return; }
  const want = m[1];
  const reg = require('./build/providers.config.js');
  const ids = reg.filter((p) => p.flavors.includes(flavor)).map((p) => p.id);
  if (!ids.includes(want)) {
    err(`${label}: 默认引擎 '${want}' 不在 ${flavor} 注册表里(${ids.join(', ')})`
      + ' —— 运行时会静默落到 translateGoogle');
  }
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

// Per-flavor resolution, shared by all three registry emitters. An authored value is
// either a plain value or a { china, global } map; the map form is a WRITING
// convenience, never something the runtime should see — domain-design §7's rule is
// that region is decided at build time and never branches per request.
function pickFlavor(flavor) {
  return (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[flavor] ?? null) : (v ?? null);
}

function generateProviders(dir, flavor) {
  const CONFIG = require('./build/providers.config.js');
  const pick = pickFlavor(flavor);
  const providers = CONFIG
    .filter((p) => p.flavors.includes(flavor))
    .map((p) => ({
      id: p.id, type: p.type, label: pick(p.label), labelKey: p.labelKey || null,
      defaultEndpoint: pick(p.defaultEndpoint), placeholder: p.placeholder || null,
      // 跟 label / defaultEndpoint 一样支持 { china, global } 映射。原来它漏了 pick，
      // 于是两个 flavor 只能共用一个模型名 —— 而同一家厂商的国内外平台完全可能上下架
      // 不同的模型（实测 2026-08-21：moonshot 国际站已经没有 moonshot-v1-8k 了）。
      defaultModel: pick(p.defaultModel) || '',
      needsKey: !!p.needsKey, supportsBaseUrl: !!p.supportsBaseUrl,
      supportsModel: !!p.supportsModel, requiresEndpoint: !!p.requiresEndpoint, hintKey: p.hintKey || null,
      // 「去哪儿申请这把 key」。按 flavor 取，同 defaultEndpoint / label。
      keyUrl: pick(p.keyUrl) || null,
    }));
  // The model-parameter table rides this same file rather than getting one of its own.
  // providers.gen.js is already on every surface that resolves an endpoint (both
  // content_scripts blocks, options, popup, review, and the app bundle), so riding it
  // costs ZERO load-site edits — and a load site missed is the worst failure this table
  // has: the runtime would silently see an empty table, fall back to minimal bodies
  // everywhere, and never报错. (`palette.gen.js` is the precedent for one emitter
  // carrying more than one global.)
  //
  // It inherits the flavor filter for free, which it needs: `api.openai.com`,
  // `api.anthropic.com` and the bare id `openai` are the three strings in this table
  // that the China compliance grep would hit.
  //
  // The output field list is an ALLOWLIST, same discipline as the providers map above —
  // a field added to the config but not named here silently never reaches the runtime.
  // Two deliberate omissions:
  //   · `note` — maintainer evidence, not runtime data, and the field most likely to
  //     carry a vendor's error prose verbatim. Keeping it out shrinks the brand surface
  //     to `id` / `hosts` / `models`.
  //   · `!!` coercion — `temperature` and `budget` are THREE-state (true / false /
  //     absent). `!!e.temperature` would flatten "we don't know" into "not supported",
  //     which is exactly the distinction this table exists to carry. JSON.stringify
  //     drops `undefined` keys, which is precisely the encoding we want.
  const PARAMS = require('./build/model-params.config.js');
  const params = PARAMS
    .filter((e) => e.flavors.includes(flavor))
    .map((e) => ({
      id: e.id,
      hosts: (e.hosts || []).map((h) => String(h).toLowerCase()),
      models: (e.models || []).map((m) => String(m).toLowerCase()),
      temperature: 'temperature' in e ? e.temperature : undefined,
      budget: 'budget' in e ? e.budget : undefined,
      systemRole: e.systemRole || undefined,
      reasoning: e.reasoning || undefined,
    }));

  const banner = '// AUTO-GENERATED by build.js from build/providers.config.js '
    + '+ build/model-params.config.js — do not edit by hand.\n';
  // 「这个构建编进同步了吗」。内容脚本要它 —— 官网试翻页上的交接块会说「登录之后
  // 卡片才到 App」，而中国版扩展的登录入口是被整节 remove 掉的，那句话对他就是死路。
  //
  // 为什么不直接在内容脚本里加载 backend.config.js：那个文件带着后端地址与 anon key，
  // 而内容脚本会注入到**每一个页面**。判据搭已经在场的 providers.gen.js 的车，只发
  // 一个布尔值，凭证一个字节都不扩散。
  //
  // 判据取自 backend.config.js 的 enabled 本身（**按值，不按 flavor 名**）——
  // 中国版那个 false 是 build 期翻的，所以这里读的是翻过之后的值，与
  // onboard.js 的 syncOn、options.js 的 remove 分支永远一致。
  // ⚠️ 行首锚定，且**必须恰好命中一次**。第一版写的是 /enabled:\s*true/，它把文件
  // 第 25 行注释里的「enabled:true, sign-in included」也算了进去 —— 于是中国版包里
  // 这个布尔值是 true，而它决定要不要对用户说「登录之后卡片才到 App」。
  // 匹配不到就硬失败：一个静默取错的布尔值，比构建红一次贵得多。
  const cfgSrc = fs.readFileSync(path.join(dir, 'learn', 'backend.config.js'), 'utf8');
  const on = cfgSrc.match(/^\s*enabled:\s*true,/gm) || [];
  const off = cfgSrc.match(/^\s*enabled:\s*false,/gm) || [];
  if (on.length + off.length !== 1) {
    console.error(`✗ MT_SYNC_ENABLED: ${dir}/learn/backend.config.js 里 enabled 声明有 `
      + `${on.length + off.length} 处，期望恰好 1 处`);
    process.exit(1);
  }
  const syncOn = on.length === 1;

  // 默认目标语言。唯一来源是 translation-core.js 的 DEFAULT_TARGET_LANG，这里只是
  // 把它搭 providers.gen.js 的车发给**没加载 translation-core.js 的面**（设置页、
  // 引导页 —— 它们要用它决定「打开示例页面」去哪一页）。
  // 匹配不到就硬失败，理由同上：一个静默取错的默认语言会把人送到语言不对的示例页。
  const coreSrc = fs.readFileSync(path.join(dir, 'content', 'translation-core.js'), 'utf8');
  const dtl = coreSrc.match(/DEFAULT_TARGET_LANG\s*=\s*'([\w-]+)'/);
  if (!dtl) {
    console.error('✗ MT_DEFAULT_TARGET_LANG: translation-core.js 里读不到 DEFAULT_TARGET_LANG');
    process.exit(1);
  }
  // 匿名用量事件（docs/telemetry-design.md §4）：端点 + 白名单一起搭这辆车 —— 内容
  // 脚本已经加载 providers.gen.js，而它们不能加载 backend.config.js（anon key）。这里
  // 只发 URL，不发 key；边缘函数不校验 JWT。**中国版发 null**：那个 flavor 一个字节
  // 都不发（AGENTS.md 规则 4），下面的门禁会核对产物里没有端点。
  const TELEMETRY = require('./build/telemetry.config.js');
  const telemetry = flavor === 'china' ? null : {
    url: require('./extension/learn/backend.config.js').url + '/functions/v1/bt-ingest',
    spec: { common: TELEMETRY.COMMON, events: TELEMETRY.EVENTS, limits: TELEMETRY.LIMITS },
  };
  let body = `window.MT_FLAVOR = ${JSON.stringify(flavor)};\n`
    + `window.MT_VERSION = ${JSON.stringify(require('./package.json').version)};\n`
    + `window.MT_TELEMETRY = ${JSON.stringify(telemetry)};\n`
    + `window.MT_SYNC_ENABLED = ${JSON.stringify(syncOn)};\n`
    + `window.MT_DEFAULT_TARGET_LANG = ${JSON.stringify(dtl[1])};\n`
    + `window.MT_PROVIDERS = ${JSON.stringify(providers)};\n`
    + `window.MT_MODEL_PARAMS = ${JSON.stringify(params)};\n`;
  // 「哪些 host 有实测推荐」——同样搭 providers.gen.js 的车（理由同上：这个文件已经
  // 在每一个需要它的面上加载了）。它只是一个**排序提示**：一键配置卡把有实测推荐的
  // 平台排在前面，其余按注册表顺序。
  //
  // 唯一来源是 build/recommend.config.js，不新造第二份 —— 那张表已经有门禁守着
  // （每个 (平台, 能力) 必须有 default 轴），而注册表顺序是历史形成的、不是推荐序。
  // 只发 host，不发平台名/模型/理由：排序只需要 host，多发的每一个字段都是一块
  // 会漂的副本，也是中国包里多一分品牌词面。
  const recHosts = [];
  for (const r of require('./build/recommend.config.js').PICKS) {
    if (r.host && recHosts.indexOf(r.host) < 0) recHosts.push(r.host);
  }
  body += `window.MT_RECOMMENDED_HOSTS = ${JSON.stringify(recHosts)};\n`;
  fs.writeFileSync(path.join(dir, 'content', 'providers.gen.js'), banner + body);
  log(`Generated content/providers.gen.js (${flavor}: ${providers.map((p) => p.id).join(', ')}`
    + ` · ${params.length} param rows)`);
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

// extension_name 的上限是 **40**，不是 manifest 那个 45。
//
// 2026-08-29 撞到的：`altool --upload-app` 在归档成功、导出成功、上传走到最后才拒：
//   Invalid messages file. The messages.json validation failed for locale pt_BR …
//   The name field must be present, of string type, and 40 or fewer characters long.
//
// 它一次只报**一个** locale，所以「改完再传」会一个一个撞过去；而本地此前只有描述
// 有门禁，名称一道都没有。五个 locale（de/en/es/pt_BR/ru）同时超标，全靠 Apple 的
// 服务器告诉我们 —— 那是这条链上最慢、最贵的反馈点。
//
// 40 是 Safari Web Extension 的限制，比 Chrome manifest 的 45 更严。两个 flavor 都跑：
// 中国版的名称不经 applyChinaLocales 替换，同样会原样进 App Store。
const NAME_MAX = 40;

function nameLengthGate(dir) {
  const localesDir = path.join(dir, '_locales');
  const over = [];
  for (const loc of fs.readdirSync(localesDir)) {
    const f = path.join(localesDir, loc, 'messages.json');
    if (!fs.existsSync(f)) continue;
    const name = (JSON.parse(fs.readFileSync(f, 'utf8')).extension_name || {}).message;
    if (typeof name !== 'string' || !name) { over.push(`${loc}: missing or not a string`); continue; }
    // Apple 数的是字符不是字节，和它的报错口径一致（[...s] 而不是 s.length）。
    const n = [...name].length;
    if (n > NAME_MAX) over.push(`${loc}: ${n} chars (max ${NAME_MAX}) — ${JSON.stringify(name)}`);
  }
  if (over.length) {
    err(`extension_name exceeds Apple's ${NAME_MAX}-character limit — the upload is rejected\n` +
        `  AFTER a successful archive and export, and Apple reports only ONE locale per try:\n` +
        over.map((o) => '   ' + o).join('\n'));
    process.exit(1);
  }
  log(`Store name within Apple's ${NAME_MAX}-char limit (all locales)`);
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

function complianceGateChina(dir, label) {
  // bt-ingest：匿名用量事件的端点（Gate D）。中国版一个字节都不发，产物里不该有它。
const FORBIDDEN = /ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com|bt-ingest/i;
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
    err(`China compliance gate FAILED — forbidden brand/endpoint references in ${label || 'dist-china'}/:`);
    hits.slice(0, 30).forEach((h) => console.error('   ' + h));
    process.exit(1);
  }
  log(`China compliance gate passed for ${label || 'dist-china'} (no OpenAI/ChatGPT/Claude/global-endpoint references)`);
}

// ─── Speech (TTS) engine registry bundle ────────────────────────────────────
// build/tts.config.js is the single source of truth for speech engines. Same shape
// and same rules as generateProviders() above — a second capability, a second
// registry, never a hardcoded list at a call site.

function generateTts(dir, flavor) {
  const CONFIG = require('./build/tts.config.js');
  const pick = pickFlavor(flavor);
  const engines = CONFIG.filter((e) => e.flavors.includes(flavor)).map((e) => ({
    id: e.id, type: e.type, label: pick(e.label), labelKey: e.labelKey || null,
    defaultEndpoint: pick(e.defaultEndpoint), placeholder: e.placeholder || null,
    defaultModel: e.defaultModel || '', voices: e.voices || null,
    needsKey: !!e.needsKey, supportsKey: e.supportsKey === undefined ? !!e.needsKey : !!e.supportsKey,
    supportsBaseUrl: !!e.supportsBaseUrl,
    supportsModel: !!e.supportsModel, requiresEndpoint: !!e.requiresEndpoint,
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
  const pick = pickFlavor(flavor);
  const engines = CONFIG.filter((e) => e.flavors.includes(flavor)).map((e) => ({
    id: e.id, type: e.type, label: pick(e.label), labelKey: e.labelKey || null,
    defaultEndpoint: pick(e.defaultEndpoint), placeholder: e.placeholder || null,
    defaultModel: e.defaultModel || '',
    needsKey: !!e.needsKey, supportsKey: e.supportsKey === undefined ? !!e.needsKey : !!e.supportsKey,
    supportsBaseUrl: !!e.supportsBaseUrl,
    supportsModel: !!e.supportsModel, requiresEndpoint: !!e.requiresEndpoint,
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

// ─── default_locale 按 flavor ──────────────────────────────────────────────
//
// `chrome.i18n` 对**没有对应 _locales/<locale> 目录**的用户，回落到 default_locale。
// 这个值一直是 zh_CN，于是每一个我们没做本地化的市场，装完看到的是中文界面。
//
// 2026-09-04 用下载数据量出了代价：IT 是 30 天下载量第 3 名（18 次，8.9%），而
// `_locales/` 里没有 it；加上 TR 9 / VN 6 / PL 4，共 37 次 = 国际版的 21.5%。
// 这些人打开的是一个中文界面的翻译扩展。（`node scripts/store-stats.js` 的
// 「市场缺口」那一节会持续报这个数。）
//
// 所以它按 flavor 分叉，而不是一个常量：
//   · global / firefox —— `en`。国际版发到 36 个国家，英文是唯一合理的兜底。
//   · china            —— `zh_CN`。它只在中国区分发，兜底成英文纯属倒退。
//
// 门禁而不是约定：这个值改错了**不会报错**，只会让一个市场安静地读到另一种语言
// —— 和 issue #65 那个「目录名 Chrome 不认识就静默忽略」是同一类病。
function defaultLocaleGate(distDir, label, flavor) {
  const want = flavor === 'china' ? 'zh_CN' : 'en';
  const m = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
  if (m.default_locale !== want) {
    err(`${label}: default_locale is "${m.default_locale}", expected "${want}" for flavor ${flavor}`);
    process.exit(1);
  }
  // 兜底语言自己必须存在，否则回落的目的地是个空目录 —— 那比回落到别的语言更糟。
  if (!fs.existsSync(path.join(distDir, '_locales', want, 'messages.json'))) {
    err(`${label}: default_locale "${want}" has no _locales/${want}/messages.json`);
    process.exit(1);
  }
  log(`default_locale gate OK (${label}: ${want})`);
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
    // ── Gate D（docs/learning-design.md §10；2026-09-05）：匿名用量事件上线之后，
    // 「no telemetry / 无遥测」在两份 README 里都是假话；反过来，「anonymous usage /
    // 匿名用量」这句必须在。两个方向都查：只查反向，删掉整段也能过。
    if (/no telemetry/i.test(readme)) staleHits.push('README.md: still says "no telemetry" (Gate D)');
    if (!/anonymous usage/i.test(readme)) staleHits.push('README.md: no "anonymous usage" disclosure (Gate D)');
    if (/无遥测/.test(readmeZh)) staleHits.push('README.zh-CN.md: 仍写着「无遥测」(Gate D)');
    if (!/匿名用量/.test(readmeZh)) staleHits.push('README.zh-CN.md: 没有「匿名用量」的披露 (Gate D)');
    // 产品内的开关与说明：每一门 locale 都要有，且说明不能是开关那一句的复读。
    for (const loc of fs.readdirSync(path.join(distDir, '_locales'))) {
      const f = path.join(distDir, '_locales', loc, 'messages.json');
      if (!fs.existsSync(f)) continue;
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      const tog = String(m.telemetry_toggle?.message || '');
      const hint = String(m.telemetry_hint?.message || '');
      if (!tog || !hint || hint === tog) staleHits.push(`_locales/${loc} 缺 telemetry_toggle / telemetry_hint（Gate D）`);
    }
    // ── 正向判据：每一门 locale 的 hint 都必须**提到同步** ──────────────────
    //
    // 下面那张 FALSE_CLAIMS 是**逐语言手写的谎言指纹**，写它的时候有 11 门语言而它
    // 只覆盖 7 门（ko / ar / pt_BR / ru 从一开始就漏）。2026-09-04 加了 hi 之后变成
    // 12 缺 5 —— 而这个仓库自己有一句话说这种东西：**「a list a human must remember
    // to extend is not a gate, it is a wish」**。
    //
    // 所以补一条**语言无关、且不需要任何新表**的正向判据：那句 hint 必须含有本 locale
    // 自己的「同步」这个词 —— 而那个词 `app_sync` 已经在同一个 messages.json 里。
    // 两个 key 同源，所以**新增第 13 门语言会自动被覆盖**，没有谁要记得去扩哪张表。
    //
    // 取**前 8 个码点做词干**而不是整词：词形变化改的是词尾不是词干
    // （de Synchronisieren→Synchronisierung · es Sincronizar→sincronización ·
    //  ru Синхронизировать→синхронизацию）。实测 12 门全覆盖。
    // 若将来某门语言的词干比这更短而落空，它会**变红**而不是静默放行 —— 失败方向是对的。
    for (const loc of fs.readdirSync(path.join(distDir, '_locales'))) {
      const f = path.join(distDir, '_locales', loc, 'messages.json');
      if (!fs.existsSync(f)) continue;
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      const hint = String(m.learn_section_hint?.message || '');
      const word = String(m.app_sync?.message || '');
      if (!hint || !word) { staleHits.push(`_locales/${loc} 缺 learn_section_hint 或 app_sync`); continue; }
      const stem = [...word].slice(0, 8).join('').toLowerCase();
      if (!hint.toLowerCase().includes(stem)) {
        staleHits.push(`_locales/${loc} learn_section_hint 没提到同步（找「${stem}」）`
          + ' —— 不带同步限定的「不上传」在同步上线那天就是假话');
      }
    }

    // 负向判据（保留，与上面互补）：已知的几种「无条件承诺不上传」的写法。
    // 它只覆盖 7 门，所以**不能单独作数** —— 上面那条才是覆盖全部 locale 的那一条。
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
    // technicalAndInteraction：匿名用量事件（Gate D，2026-09-05）。AMO 的校验器**只允许它出现在
    // optional 里**（放进 required 会被拒：must be equal to one of the allowed values —— 09-05 实测）。
    // 与产品内那个开关的语义一致：可关的东西就该是 optional。
    const WANT_DCP_OPT = ['technicalAndInteraction'];
    const dcpOpt = m.browser_specific_settings?.gecko?.data_collection_permissions?.optional;
    if (JSON.stringify((dcpOpt || []).slice().sort()) !== JSON.stringify(WANT_DCP_OPT.slice().sort())) {
      staleHits.push(`gecko.data_collection_permissions.optional is [${dcpOpt}] — Gate D requires exactly [${WANT_DCP_OPT}]`);
    }
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
  // 兜底语言跟着 flavor 走 —— 源里是 en（国际版发 36 个国家），中国版只在中国区
  // 分发，回落成英文纯属倒退。判据在 defaultLocaleGate。
  {
    const mp = path.join(DIST, 'manifest.json');
    const mm = JSON.parse(fs.readFileSync(mp, 'utf8'));
    mm.default_locale = 'zh_CN';
    fs.writeFileSync(mp, JSON.stringify(mm, null, 2));
    // 打印**回读**的值，不是写死的字面量 —— 一句写死的日志在赋值被改坏时照样说
    // 「-> zh_CN」，那正是这个仓库最贵的那类谎。
    log('China: default_locale -> '
      + JSON.parse(fs.readFileSync(mp, 'utf8')).default_locale);
  }
  generateI18nMessages(DIST);      // rebuild i18n table from the scrubbed China locales
  // Sync OFF in the China artifact (source stays true): the China app is
  // unreleased and PIPL/cross-border compliance is unevaluated. Its own Gate,
  // its own release decision — see backend.config.js header.
  //
  // ⚠️ **必须排在 generateProviders 之前。** providers.gen.js 现在还发一个
  // window.MT_SYNC_ENABLED，而它是**读**这个文件的 enabled 得来的（按值，不按
  // flavor 名）。翻在后面的话，中国版包里那个布尔值会是 true —— 而它决定官网试翻页
  // 上要不要说「登录之后卡片才到 App」，对一个连登录入口都被 remove 掉的构建，
  // 那句话是死路。
  const cfgPath = path.join(DIST, 'learn', 'backend.config.js');
  // 两条路，由 backend.config.js 的 `china.ready` 选 —— **按值，不按 flavor 名**，
  // 与这个文件里其它 flavor 判据同一条纪律。
  //
  //   ready: false → 与从前逐字相同：关掉同步。
  //   ready: true  → 换成境内后端，**不再关同步** —— 那正是这件事的目的。
  //
  // 为什么不是「改完 url 就自动开」：地址填了不等于服务跑起来了。让开关独立于
  // 地址，是为了让「填地址」和「切过去」成为两个动作 —— 中间隔着一次真实链路验证。
  if (chinaBackendReady()) {
    const cn = chinaBackend();
    fs.writeFileSync(cfgPath, switchBackend(fs.readFileSync(cfgPath, 'utf8'),
      'dist-china/learn/backend.config.js', cn));
    log('China flavor: backend → ' + cn.url + '（境内，同步保持开启）');
  } else {
    fs.writeFileSync(cfgPath, flipSyncFlag(fs.readFileSync(cfgPath, 'utf8'), 'dist-china/learn/backend.config.js', 'off'));
    log('China flavor: sync disabled in artifact (enabled → false) —— 境内后端未就绪（china.ready=false）');
  }
  fs.writeFileSync(cfgPath, limitProviders(fs.readFileSync(cfgPath, 'utf8'),
    'dist-china/learn/backend.config.js', ['apple']));
  log('China flavor: providers → [apple]（Google 在大陆连不上）');
  generateProviders(DIST, 'china'); // overwrite providers.gen.js with the China set
  generateTts(DIST, 'china');       // …and tts.gen.js with the China speech set
  generateStt(DIST, 'china');       // …and stt.gen.js with the China transcription set

  // 默认引擎:google 只在 global 注册表里,中国版必须换成本 flavor 有的那个。
  const bgPath = path.join(DIST, 'background.js');
  fs.writeFileSync(bgPath, rewriteDefaultProvider(
    fs.readFileSync(bgPath, 'utf8'), 'dist-china/background.js', 'deepseek'));
  log('China flavor: default provider google → deepseek');
}

// 默认引擎门禁——放在 flavor 覆写之后,查的是**出货目录**里的那份。
defaultProviderGate(DIST, path.basename(DIST), FLAVOR);
defaultLocaleGate(DIST, path.basename(DIST), TARGET === 'firefox' ? 'global' : FLAVOR);

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
nameLengthGate(DIST);

// ─── Host app assets (learning-design §7.2) ─────────────────────────────────
// Built from `app/` plus the SAME shared modules the extension ships — not copies of
// them (§9: "not a second engine").
//
// **Per flavor, since 2026-08-23.** It used to be `if (FLAVOR === 'global')`, on the
// stated grounds that "the China build has no App Store presence yet" — that stopped
// being true when the China app shipped, and nothing went back to fix it. The effect:
// `app:sync` pushed the ONE global `dist-app/` into BOTH project trees, so the China
// host App carried the GLOBAL engine registry. Its settings page offered ChatGPT
// (OpenAI), Claude (Anthropic) and Google with `api.openai.com` endpoints, while the
// China extension right next to it had them stripped. Two standards inside one
// product, and it shipped that way in 1.6.4.
//
// The China-flavor gate below catches the same class next time: the host bundle is a
// concatenation of the SAME generated registries the extension uses, so if the
// extension is clean and the app is not, the two were built from different flavors.
{
  const { buildAppBundle } = require('./build/app-bundle.js');
  const APP_OUT = FLAVOR === 'china' ? 'dist-app-china' : 'dist-app';
  // syncOn flip retired with Gate B — the source flag is true; the bundle
  // concatenates it as-is.
  // 中国版从 dist-china/ 取生成物（那里才是 flavor 过滤后的注册表）。
  buildAppBundle(path.join(ROOT, APP_OUT), log,
    FLAVOR === 'china' ? { genRoot: DIST, limitProviders } : {});
  legacyBrandGate(path.join(ROOT, APP_OUT), APP_OUT, [path.join(ROOT, "app")]);
  if (FLAVOR === 'china') complianceGateChina(path.join(ROOT, APP_OUT), APP_OUT);
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
