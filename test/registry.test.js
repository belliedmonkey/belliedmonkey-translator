// test/registry.test.js — invariants that every capability registry must hold.
//
// There are two registries now: translation providers (docs/domain-design.md §7) and
// speech engines. The second was written to be *isomorphic* to the first and dropped
// exactly one field: `flavors`. Consequence — the China bundle shipped a brand-named
// speech engine (label "OpenAI Speech", defaultBase api.openai.com), because
// `generateTts()` never filtered and the China build has no such provider to hide it.
//
// The China compliance gate did catch it, which is why it exists. But that gate only
// fires on `node build.js --flavor china`, after a full copy + locale rewrite, and it
// reports a grep hit in a generated file rather than the missing field. These tests
// fail on the registry itself, in milliseconds, naming the entry.
//
// The rule they encode: **a registry entry declares which builds it belongs to.**
// An entry that forgets is not "defaulted to global" — it is an error, because the
// silent default is precisely how a brand reaches a bundle that may not carry one.

const { describe, test, ok, eq } = require('./harness');

const REGISTRIES = [
  { name: 'providers', entries: require('../build/providers.config.js') },
  { name: 'tts', entries: require('../build/tts.config.js') },
];

const KNOWN_FLAVORS = ['global', 'china'];

// Mirrors the FORBIDDEN regex in build.js's complianceGateChina. Kept as a literal
// rather than imported: build.js is a script that runs on require, and a second copy
// of five words is cheaper than making it importable. If it drifts, the build gate is
// still the authority — this test is the early warning, not the law.
const FORBIDDEN = /ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com/i;

describe('capability registries', () => {
  for (const { name, entries } of REGISTRIES) {
    test(`${name}: every entry declares the builds it ships in`, () => {
      for (const e of entries) {
        ok(Array.isArray(e.flavors), `${name}/${e.id} has no flavors array`);
        ok(e.flavors.length > 0, `${name}/${e.id} declares no flavor`);
        for (const f of e.flavors) {
          ok(KNOWN_FLAVORS.indexOf(f) >= 0, `${name}/${e.id} names unknown flavor ${f}`);
        }
      }
    });

    test(`${name}: nothing shipped to China carries a brand reference`, () => {
      for (const e of entries) {
        if (!e.flavors || !e.flavors.includes('china')) continue;
        // Labels can be per-flavor objects; only the China one would ship.
        const label = (e.label && typeof e.label === 'object') ? e.label.china : e.label;
        const base = (e.defaultBase && typeof e.defaultBase === 'object')
          ? e.defaultBase.china : e.defaultBase;
        for (const [field, v] of [['label', label], ['labelKey', e.labelKey],
          ['hintKey', e.hintKey], ['defaultBase', base], ['defaultModel', e.defaultModel]]) {
          if (!v) continue;
          ok(!FORBIDDEN.test(String(v)),
            `${name}/${e.id}.${field} would ship a brand reference to China: ${v}`);
        }
      }
    });
  }

  test('at least one entry is global-only, or these tests prove nothing', () => {
    // A guard on the guard: if every entry shipped everywhere, the China assertions
    // above would pass vacuously and keep passing after someone deleted the filter.
    const globalOnly = REGISTRIES.flatMap((r) => r.entries)
      .filter((e) => e.flavors && !e.flavors.includes('china'));
    ok(globalOnly.length > 0, 'no global-only entry exists — the flavor split is not being exercised');
    eq(globalOnly.every((e) => e.flavors.includes('global')), true);
  });
});

// ─── The description gate is only as good as its derivation (#69) ────────────
// build/brands.js feeds the gate that keeps `extension_description` provider-neutral.
// A derivation that silently returned [] would make that gate pass on every string,
// which is the failure mode this file exists to prevent elsewhere too — so assert the
// tokens, not just that the function runs.

describe('provider brand derivation (#69)', () => {
  const { providerBrands } = require('../build/brands.js');

  test('every branded provider contributes a token', () => {
    const brands = providerBrands().map((b) => b.toLowerCase());
    // One token per real vendor name that appears in a label, in either flavor.
    for (const expected of ['google', 'chatgpt', 'openai', 'claude', 'anthropic',
      'deepseek', 'glm', 'qwen', 'kimi', '智谱', '通义千问']) {
      ok(brands.indexOf(expected.toLowerCase()) >= 0, `品牌词漏了 "${expected}" —— 闸门会放行点名它的文案`);
    }
  });

  test('the generic words in labels are NOT treated as brands', () => {
    const brands = providerBrands().map((b) => b.toLowerCase());
    // These all appear inside labels ("Google 翻译（免费，无需 API Key）", "自定义 · Chat
    // Completions 格式"). If they leaked in, the gate would reject ordinary prose and
    // someone would delete the gate rather than fight it.
    for (const generic of ['api', 'key', 'custom', 'chat', 'completions', '翻译', '自定义', '格式']) {
      ok(brands.indexOf(generic) < 0, `"${generic}" 被当成品牌词 —— 闸门会对正常文案误报`);
    }
  });

  test('shipped descriptions name no provider, in every locale', () => {
    const fs = require('fs'), path = require('path');
    const brands = providerBrands();
    const dir = path.join(__dirname, '..', 'extension', '_locales');
    const offenders = [];
    for (const loc of fs.readdirSync(dir)) {
      const f = path.join(dir, loc, 'messages.json');
      if (!fs.existsSync(f)) continue;
      const desc = (JSON.parse(fs.readFileSync(f, 'utf8')).extension_description || {}).message || '';
      for (const b of brands) {
        if (desc.toLowerCase().indexOf(b.toLowerCase()) >= 0) offenders.push(`${loc}:${b}`);
      }
    }
    eq(offenders.length, 0, `商店描述里点名了服务商: ${offenders.join(', ')}`);
  });
});

// ─── Every locale must have a China description (#70) ────────────────────────
// `_locales/pt` was renamed `pt_BR` (#65) and descriptions.china.js kept `pt`, so the
// China build silently served Portuguese users the English `_default` — a compliant,
// brand-free, perfectly buildable wrong answer that no gate could see.

describe('China descriptions cover every locale (#70)', () => {
  test('each _locales dir has a matching key', () => {
    const fs = require('fs'), path = require('path');
    const DESC = require('../build/descriptions.china.js');
    const dir = path.join(__dirname, '..', 'extension', '_locales');
    const missing = fs.readdirSync(dir)
      .filter((loc) => fs.existsSync(path.join(dir, loc, 'messages.json')))
      .filter((loc) => !DESC[loc]);
    eq(missing.length, 0, `descriptions.china.js 缺少: ${missing.join(', ')}（会静默回落成英文）`);
  });
});
