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
