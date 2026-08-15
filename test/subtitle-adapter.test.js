// test/subtitle-adapter.test.js — the adapter→engine settings wiring.
//
// Why this file exists: the subtitle path shipped a bug where the engine's
// same-language target language was frozen at construction. `createSubtitleUI`
// builds its engine at module scope, BEFORE init/enable/updateSettings have ever
// assigned `settings`, so passing `settings.targetLang` handed the engine
// `undefined` — it fell back to DEFAULT_TARGET_LANG and stayed there for the whole
// session, ignoring whatever target language the user actually chose.
//
// translation-core.test.js locks the CORE half (createEngine re-reads a getter).
// This file locks the ADAPTER half — that the adapter actually passes a getter
// rather than a value. That wiring line is where the bug lived, and a core-only
// test would stay green if someone changed it back.
const { describe, test, eq, ok } = require('./harness');
const { loadModule } = require('./harness');

// Minimal TranslationCore that records the cfg the adapter hands to the engine.
// The adapter only needs createPager + createSubtitleEngine at construction time.
function loadAdapter() {
  const seen = {};
  const TranslationCore = {
    DEFAULT_TARGET_LANG: 'zh-CN',
    createPager: () => ({ pageize: (t) => [t], destroy() {} }),
    createSubtitleEngine: (cfg) => {
      seen.cfg = cfg;
      return {
        setItems() {}, pump() {}, activeAt: () => null,
        stateOf: () => ({ state: '', translation: '' }),
        retry() {}, reset() { seen.resets = (seen.resets || 0) + 1; },
        get items() { return []; },
      };
    },
  };
  // updateSettings() calls clearOverlay(), and init() starts the 250ms display
  // loop — neither is what we're testing, so give them somewhere harmless to land.
  const document = { getElementById: () => null };
  // window.MT_PALETTE comes from the SAME registry the build emits — the test
  // sandbox must not restate colour values (build/palette.config.js is the
  // single source; palette.gen.js is its runtime emission).
  const { runtime: MT_PALETTE } = require('../build/palette.config.js');
  const ctx = loadModule('subtitle-adapter.js', {
    window: { MT_PALETTE }, TranslationCore, document,
    setInterval: () => 0, clearInterval: () => {},
  });
  return { SubtitleAdapter: ctx.SubtitleAdapter, seen, TranslationCore };
}

// Enough of a spec to construct; nothing here runs until the display loop starts,
// and these tests never start it.
const SPEC = {
  ids: { overlay: 'ov', orig: 'o', trans: 't', btn: 'b', menu: 'm', meas: 'meas' },
  hasMedia: () => false,
  mediaKey: () => '',
  getCurrentTime: () => 0,
  acquire: async () => null,
  placeOverlay: () => false,
  fontPx: () => 16,
  textWidth: () => 300,
  translate: async (x) => x,
  labels: { btnTitle: '', subOn: '', subOff: '' },
};

describe('SubtitleAdapter — settings wiring', () => {
  test('targetLang reaches the engine as a GETTER, not a frozen value', () => {
    const { SubtitleAdapter, seen } = loadAdapter();
    SubtitleAdapter.createSubtitleUI(SPEC);
    eq(typeof seen.cfg.targetLang, 'function',
      'a plain value here is the bug: settings is still {} at construction, so the ' +
      'engine would freeze on DEFAULT_TARGET_LANG for the whole session');
  });

  test('before any settings assignment it reads DEFAULT_TARGET_LANG', () => {
    const { SubtitleAdapter, seen } = loadAdapter();
    SubtitleAdapter.createSubtitleUI(SPEC);
    eq(seen.cfg.targetLang(), 'zh-CN', 'the fallback still applies pre-init');
  });

  test('REGRESSION: updateSettings changes what the engine reads', () => {
    const { SubtitleAdapter, seen } = loadAdapter();
    const ui = SubtitleAdapter.createSubtitleUI(SPEC);
    ui.updateSettings({ targetLang: 'ja' });
    eq(seen.cfg.targetLang(), 'ja',
      'the user picked ja; the same-language check must follow it');
    ui.updateSettings({ targetLang: 'en' });
    eq(seen.cfg.targetLang(), 'en', 'and keeps following it on later changes');
  });

  test('init/enable also feed the engine, not just updateSettings', () => {
    const { SubtitleAdapter, seen } = loadAdapter();
    const ui = SubtitleAdapter.createSubtitleUI(SPEC);
    ui.init({ targetLang: 'ko', enabled: false });
    eq(seen.cfg.targetLang(), 'ko', 'init path');
    ui.enable({ targetLang: 'fr' });
    eq(seen.cfg.targetLang(), 'fr', 'enable path');
  });

  test('the optional browser detector is passed through, absent by default', () => {
    // LangDetect is not defined in this sandbox — the same shape as every Safari.
    // The adapter must degrade to null rather than throwing on the typeof guard.
    const { SubtitleAdapter, seen } = loadAdapter();
    SubtitleAdapter.createSubtitleUI(SPEC);
    ok(seen.cfg.detect === null || seen.cfg.detect === undefined,
      'no detector on this surface → the engine gets nothing to consult');
  });
});
