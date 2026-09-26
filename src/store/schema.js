// store/schema.js — SETTINGS_SCHEMA, the single registry of every settings key.
//
// Before this file, the key list was hand-copied per surface: options.js
// SETTINGS_KEYS, popup.js POPUP_KEYS ("第四份手抄无门禁", its own comment admits),
// review.js READ_KEYS, docs-page.js KEYS, plus further copies in quick.js,
// quick-settings.js, handoff.js and listen.js. Eight lists that drift silently —
// the same failure class as the provider registry before `providers.gen.js`.
//
// `default` is the EFFECTIVE value when the key is absent from storage — the same
// value the consumer-side `s.x || fallback` falls back to today. useSetting()
// returns it; PR2 changes no consumer, so the `|| fallback` sites retire one page
// migration at a time. It is deliberately NOT a seeding table: background.js
// DEFAULT_SETTINGS keeps seeding what it seeds (chrome-shim notes why seeding is
// load-order-sensitive).
//
// `surfaces` names every page that reads the key today — documentation, and the
// input to keysFor(). Values: background | popup | options | review | docs |
// listen | quick | handoff | app | content.
//
// Keys marked [flow] are process markers, not configuration (extObSeen: "this
// person has seen onboarding") — settings-store carries them like any other key,
// but UI copy must never present them as a user-visible setting.
//
// The two brand hex defaults here are NOT restatements — they resolve through
// the palette registry at read time (one-registry rule; build.js's palette gate
// pins the values in the gen file, and these getters follow it). Same fallback
// the consumers use today: `s.textColor || MT_PALETTE.textColor`.
// src/ is ESM at source level, bundled to IIFE for pages (build/run-esbuild.js).

import Registry from '../lib/registry.js';

const SETTINGS_SCHEMA = (() => {
  const textColor = () => Registry.palette().textColor;
  const ytColor = () => Registry.palette().ytTextColor;

  const S = {
    // ── translation engine ────────────────────────────────────────────────
    enabled:         { default: false,    surfaces: ['background', 'options', 'popup'] },
    targetLang:      { default: 'zh-CN',  surfaces: ['background', 'options', 'popup', 'docs', 'quick'] },
    uiLang:          { default: 'auto',   surfaces: ['background', 'options', 'popup', 'review', 'docs', 'quick', 'listen'] },
    provider:        { default: 'google', surfaces: ['background', 'options', 'popup', 'review', 'docs', 'listen', 'quick'] },
    apiKey:          { default: '',       surfaces: ['background', 'options', 'popup', 'review', 'docs', 'listen', 'quick'] },
    apiBaseUrl:      { default: '',       surfaces: ['options', 'review', 'docs', 'listen', 'quick'] },
    apiModel:        { default: '',       surfaces: ['options', 'popup', 'review', 'docs', 'listen', 'quick'] },
    engineChosen:    { default: false,    surfaces: ['options', 'popup'] },
    textColor:       { default: textColor, surfaces: ['background', 'options', 'popup'] },
    ytTextColor:     { default: ytColor,  surfaces: ['options', 'review', 'content', 'popup'] },
    fontSize:        { default: '1.0',    surfaces: ['background', 'options', 'popup'] },
    showFab:         { default: true,     surfaces: ['background', 'options', 'popup'] },
    bilingualMode:   { default: 'below',  surfaces: ['background', 'options'] },
    // ── learning layer ────────────────────────────────────────────────────
    learnEnabled:    { default: false, surfaces: ['options', 'popup', 'review', 'docs', 'quick', 'handoff', 'listen'] },
    learnDailyNew:   { default: 15,    surfaces: ['options', 'popup', 'review'] },  // = LearnScheduler.DEFAULTS.dailyNew
    learnRules:      { default: null,  surfaces: ['options', 'popup', 'review', 'docs', 'quick', 'handoff', 'listen'] },
    docCapture:      { default: true,  surfaces: ['options', 'docs'] },
    docPrefetch:     { default: false, surfaces: ['docs'] },
    // ── speech: TTS ───────────────────────────────────────────────────────
    ttsMode:         { default: 'off', surfaces: ['options', 'review'] },
    ttsAutoPlay:     { default: false, surfaces: ['options', 'review'] },
    ttsEngine:       { default: '',    surfaces: ['options', 'review'] },
    ttsBaseUrl:      { default: '',    surfaces: ['options', 'review'] },
    ttsApiKey:       { default: '',    surfaces: ['options', 'review'] },
    ttsModel:        { default: '',    surfaces: ['options', 'review'] },
    ttsVoice:        { default: '',    surfaces: ['options', 'review'] },
    ttsRate:         { default: 1,     surfaces: ['options', 'review'] },
    // ── speech: STT ───────────────────────────────────────────────────────
    // popup reads the first three read-only (「配了没有实时接口」行), never writes them.
    sttEngine:       { default: '',    surfaces: ['options', 'popup', 'review'] },
    sttBaseUrl:      { default: '',    surfaces: ['options', 'popup', 'review'] },
    sttApiKey:       { default: '',    surfaces: ['options', 'popup', 'review'] },
    sttModel:        { default: '',    surfaces: ['options', 'review'] },
    // ── notes provider (listen translation target) ────────────────────────
    // listen.js and quick.js read the whole engine group + notes override group
    // through LearnNotes.resolveConfig — four keys each, all read-only there.
    notesProvider:   { default: '',    surfaces: ['options', 'review', 'listen', 'quick'] },
    notesApiKey:     { default: '',    surfaces: ['options', 'review', 'listen', 'quick'] },
    notesBaseUrl:    { default: '',    surfaces: ['options', 'review', 'listen', 'quick'] },
    notesModel:      { default: '',    surfaces: ['options', 'review', 'listen', 'quick'] },
    // ── advanced request params ───────────────────────────────────────────
    // All five default to '' = "not set". Consumer fallbacks (20 s timeout,
    // concurrency 5, budget-based maxTokens) live at the call sites that apply
    // them; '' must stay '' here or options.html would paint a value the user
    // never chose.
    reqTemperature:  { default: '', surfaces: ['options'] },
    reqMaxTokens:    { default: '', surfaces: ['options'] },
    reqTimeoutSec:   { default: '', surfaces: ['options'] },
    reqConcurrency:  { default: '', surfaces: ['options'] },
    reqCustomParams: { default: '', surfaces: ['options'], note: 'read-only: surfaced, never written by saveAll' },
    // ── flow markers ──────────────────────────────────────────────────────
    extObSeen:       { default: false, surfaces: ['popup'], note: '[flow] onboarding seen' },
    grantTail:       { default: '',    surfaces: ['popup', 'docs', 'quick'], note: '[flow] masked key tail' },
    grantBalance:    { default: null,  surfaces: ['popup'], note: '[flow]' },
    grant:           { default: '',    surfaces: ['docs'], note: '[flow]' },
    // 「以后再设置」裁定（2026-09-22，interaction-spec）：note 走 ASCII，中文引文放行注释 ——
    // no-hardcoded-copy 对字符串字面量零豁免（注释会被剥掉，不误伤）。
    onboardSeen:     { default: 0,     surfaces: ['app'], note: '[flow] 1 = done; see the later-set ruling in app.js' },
    onboardResume:   { default: null,  surfaces: ['app'], note: '[flow] {step, shows} — "later" must not mean "never" (2026-09-22)' },
    // ── quick translate / system-translate handoff ────────────────────────
    quickCapture:    { default: true,  surfaces: ['quick', 'handoff'] },
    quickHotkeys:    { default: null,  surfaces: ['quick'], note: '{translate,shot,input} — null = HotkeyCore.normalize defaults' },
    handoffCapture:  { default: true,  surfaces: ['handoff'] },
    // ── listen mode / live subtitles ──────────────────────────────────────
    listenCapture:   { default: true,  surfaces: ['listen'] },
    listenMyLang:    { default: '',    surfaces: ['listen'], note: "'' = follow uiLang" },
    listenOtherLang: { default: 'en',  surfaces: ['listen'] },
    listenAutoSpeak: { default: true,  surfaces: ['listen'] },
    subtitleCapture: { default: true,  surfaces: ['listen'] },
    subtitleVideoLang: { default: 'en', surfaces: ['listen'] },
    subtitleFontScale: { default: '',  surfaces: ['listen'] },
  };

  const KEYS = Object.keys(S);
  for (const k of KEYS) {
    if (!Array.isArray(S[k].surfaces) || !S[k].surfaces.length) {
      throw new Error(`SETTINGS_SCHEMA: ${k} must declare a non-empty surfaces list`);
    }
    if (!('default' in S[k])) throw new Error(`SETTINGS_SCHEMA: ${k} must declare a default`);
  }

  // Keys a given surface reads today. Consumers migrate onto this one list at a
  // time; a surface that needs a key it didn't declare is exactly the drift this
  // file exists to surface — add the key to `surfaces` here, not a local copy.
  function keysFor(surface) {
    const out = [];
    for (const k of KEYS) if (S[k].surfaces.includes(surface)) out.push(k);
    return out;
  }

  function defaultFor(key) {
    const e = S[key];
    if (!e) return undefined;
    return typeof e.default === 'function' ? e.default() : e.default;
  }

  return { KEYS, keysFor, defaultFor, spec: S };
})();

export default SETTINGS_SCHEMA;
