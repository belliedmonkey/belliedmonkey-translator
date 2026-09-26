// lib/registry.js — the ONLY place in src/ that touches the window.MT_* globals.
//
// The generated registries (providers.gen.js, langs.gen.js, palette.gen.js,
// i18n-messages.js, MT_MODEL_PARAMS inside providers.gen.js) stay standalone
// <script> tags — domain-design §10.7: they are build output shared with every
// non-React consumer, and bundling them would fork the registry the one-registry
// rule exists to prevent. src/ code reaches them through the getters below, and
// test/src-boundaries.test.js fails the build if `MT_` appears anywhere else in
// src/. Getters read through at call time on purpose: script order puts the gen
// files first, but a getter that snapshots at load would turn that order
// guarantee into a load-time crash instead of a clean undefined.

// src/ is ESM at source level and ships bundled to IIFE (build/run-esbuild.js) —
// the source files are never loaded raw by a page, unlike the extension's IIFE
// scripts. test/harness.js loadSrc() bundles them the same way the build does.

const Registry = (() => {
  const g = () => (typeof window !== 'undefined' ? window : globalThis);

  // Raw read, for names not worth a named accessor. Returns undefined when the
  // registry is absent (china flavor, stripped page) — callers fall back.
  function get(name) { return g()[name]; }

  const providers = () => get('MT_PROVIDERS') || [];
  const palette = () => get('MT_PALETTE') || {};
  const langs = () => get('MT_LANGS') || [];
  const messages = () => get('MT_I18N_MESSAGES') || {};
  const modelParams = () => get('MT_MODEL_PARAMS') || {};
  const version = () => get('MT_VERSION') || '';
  // 免费额度规格（providers.gen.js 顺带发射，§8.10）；null = 本版没有额度（中国版）。
  const grant = () => get('MT_GRANT') || null;
  // 转写引擎注册表（stt.gen.js，中国版生成物无品牌词）；[] = 没加载，调用方收起那一节。
  const sttEngines = () => get('MT_STT_ENGINES') || [];
  // 同步后端开关（backend.config.js，var 挂 window）。null = 中国版没有后端 —— 心跳的
  // 守卫读它，而不是让 src/ 直接摸 MT_BACKEND（src-boundaries 门）。
  const backend = () => get('MT_BACKEND') || null;

  return { get, providers, palette, langs, messages, modelParams, version,
    grant, sttEngines, backend };
})();

export default Registry;
