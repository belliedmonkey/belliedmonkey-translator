// store/schema.js — SETTINGS_SCHEMA, the single registry of every settings key.
//
// Before this file, the key list was hand-copied per surface: options.js
// SETTINGS_KEYS, popup.js POPUP_KEYS ("第四份手抄无门禁", its own comment admits),
// review.js READ_KEYS, docs-page.js KEYS, plus further copies in quick.js,
// quick-settings.js, handoff.js and listen.js. Eight lists that drift silently —
// the same failure class as the provider registry before `providers.gen.js`.
// PR9 收编完成：src/ 侧的清单已全部删掉（消费端一律 keysFor(面)，回潮由
// store-schema-i18n 的不许回潮门咬住）；extension/learn/docs-page.js 的 KEYS 是
// 仅存的一份 —— 扩展页 IIFE 独立加载，ESM 的 schema 进不了它，对账门留到它迁走。
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
    // PR6b 起 'app' 面 = App 设置页（src/app/settings-view.jsx + settings-model.js），
    // 键表 = 旧 app/settings.js KEYS 32 键逐键登记（见 store-schema-i18n 的对账门）。
    targetLang:      { default: 'zh-CN',  surfaces: ['background', 'options', 'popup', 'docs', 'quick', 'onboard', 'app'] },
    uiLang:          { default: 'auto',   surfaces: ['background', 'options', 'popup', 'review', 'docs', 'quick', 'listen', 'onboard', 'app'] },
    provider:        { default: 'google', surfaces: ['background', 'options', 'popup', 'review', 'docs', 'listen', 'quick', 'onboard', 'app'] },
    apiKey:          { default: '',       surfaces: ['background', 'options', 'popup', 'review', 'docs', 'listen', 'quick', 'onboard', 'app'] },
    apiBaseUrl:      { default: '',       surfaces: ['options', 'review', 'docs', 'listen', 'quick', 'onboard', 'app'] },
    apiModel:        { default: '',       surfaces: ['options', 'popup', 'review', 'docs', 'listen', 'quick', 'onboard', 'app'] },
    engineChosen:    { default: false,    surfaces: ['options', 'popup', 'onboard', 'app'] },
    textColor:       { default: textColor, surfaces: ['background', 'options', 'popup'] },
    ytTextColor:     { default: ytColor,  surfaces: ['options', 'review', 'content', 'popup'] },
    fontSize:        { default: '1.0',    surfaces: ['background', 'options', 'popup'] },
    showFab:         { default: true,     surfaces: ['background', 'options', 'popup'] },
    bilingualMode:   { default: 'below',  surfaces: ['background', 'options'] },
    // ── learning layer ────────────────────────────────────────────────────
    learnEnabled:    { default: false, surfaces: ['options', 'popup', 'review', 'docs', 'quick', 'handoff', 'listen', 'onboard', 'app'] },
    learnDailyNew:   { default: 15,    surfaces: ['options', 'popup', 'review', 'app'] },  // = LearnScheduler.DEFAULTS.dailyNew
    learnRules:      { default: null,  surfaces: ['options', 'popup', 'review', 'docs', 'quick', 'handoff', 'listen', 'onboard', 'app'] },
    docCapture:      { default: true,  surfaces: ['options', 'docs', 'app'] },
    docPrefetch:     { default: false, surfaces: ['docs', 'app'] },
    // ── speech: TTS ───────────────────────────────────────────────────────
    ttsMode:         { default: 'off', surfaces: ['options', 'review', 'onboard', 'app'] },
    ttsAutoPlay:     { default: false, surfaces: ['options', 'review', 'onboard', 'app'] },
    ttsEngine:       { default: '',    surfaces: ['options', 'review', 'onboard', 'app'] },
    ttsBaseUrl:      { default: '',    surfaces: ['options', 'review', 'onboard', 'app'] },
    ttsApiKey:       { default: '',    surfaces: ['options', 'review', 'onboard', 'app'] },
    ttsModel:        { default: '',    surfaces: ['options', 'review', 'onboard', 'app'] },
    // onboard 的 tts 自检要现读 voice（原版手抄清单漏了它，现读路径补上——见 pages/onboard.jsx）。
    ttsVoice:        { default: '',    surfaces: ['options', 'review', 'onboard', 'app'] },
    ttsRate:         { default: 1,     surfaces: ['options', 'review', 'app'] },
    // ── speech: STT ───────────────────────────────────────────────────────
    // popup reads the first three read-only (「配了没有实时接口」行), never writes them.
    sttEngine:       { default: '',    surfaces: ['options', 'popup', 'review', 'onboard', 'app'] },
    sttBaseUrl:      { default: '',    surfaces: ['options', 'popup', 'review', 'onboard', 'app'] },
    sttApiKey:       { default: '',    surfaces: ['options', 'popup', 'review', 'onboard', 'app'] },
    sttModel:        { default: '',    surfaces: ['options', 'review', 'onboard', 'app'] },
    // ── notes provider (listen translation target) ────────────────────────
    // The listen / quick / driving / docs surfaces read the whole engine group +
    // notes override group through LearnNotes.resolveConfig — four keys each,
    // all read-only there (engine-fields.test.js pins "App never writes them").
    // PR9: these were missing from 'docs' and 'app' until the hand-copied lists
    // retired — a keysFor()-based read would have silently dropped the group and
    // resolved the notes engine from the base group instead (the exact incident
    // shape engine-fields.test.js exists to prevent).
    notesProvider:   { default: '',    surfaces: ['options', 'review', 'docs', 'listen', 'quick', 'app'] },
    notesApiKey:     { default: '',    surfaces: ['options', 'review', 'docs', 'listen', 'quick', 'app'] },
    notesBaseUrl:    { default: '',    surfaces: ['options', 'review', 'docs', 'listen', 'quick', 'app'] },
    notesModel:      { default: '',    surfaces: ['options', 'review', 'docs', 'listen', 'quick', 'app'] },
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
    grantTail:       { default: '',    surfaces: ['popup', 'docs', 'quick', 'onboard', 'app'], note: '[flow] masked key tail' },
    grantBalance:    { default: null,  surfaces: ['popup', 'app'], note: '[flow]' },
    grant:           { default: '',    surfaces: ['docs'], note: '[flow]' },
    // 「以后再设置」裁定（2026-09-22，interaction-spec）：note 走 ASCII，中文引文放行注释 ——
    // no-hardcoded-copy 对字符串字面量零豁免（注释会被剥掉，不误伤）。
    onboardSeen:     { default: 0,     surfaces: ['app'], note: '[flow] 1 = done; see the later-set ruling in app.js' },
    onboardResume:   { default: null,  surfaces: ['app'], note: '[flow] {step, shows} — "later" must not mean "never" (2026-09-22)' },
    // ── quick translate / system-translate handoff ────────────────────────
    quickCapture:    { default: true,  surfaces: ['quick', 'handoff'] },
    quickHotkeys:    { default: null,  surfaces: ['quick'], note: '{translate,shot,input} — null = HotkeyCore.normalize defaults' },
    // App 设置页的快捷翻译总开关（quick-host.js 也读它）。读法是 `!== false`：缺键 = 开，
    // 所以 default: true 本身就是有效值，不需要播种。
    quickEnabled:    { default: true,  surfaces: ['app'] },
    handoffCapture:  { default: true,  surfaces: ['handoff'] },
    // 系统翻译弹层字号（#495，2026-09-29 裁定）：三档 0.85 / 1 / 1.2，与字幕条的
    // FONT_STEPS 同族（listen-core.js）。''=标准。只缩放弹层里原文+译文正文，叠加
    // 系统 Dynamic Type（相乘）；经 vault 快照传给扩展，改完**下次**弹层生效。
    sysTranslateFontScale: { default: '', surfaces: ['app', 'handoff'] },
    // ── listen mode / live subtitles ──────────────────────────────────────
    // 六键 App 设置页也读写（旧 app/settings.js KEYS → src/app/settings-model.js）：
    // 对话页底部两个下拉与设置页这两个是**同一份设置**（learning-design §9.6）。
    listenCapture:   { default: true,  surfaces: ['listen', 'app'] },
    listenMyLang:    { default: '',    surfaces: ['listen', 'app'], note: "'' = follow uiLang" },
    listenOtherLang: { default: 'en',  surfaces: ['listen', 'app'] },
    listenAutoSpeak: { default: true,  surfaces: ['listen', 'app'] },
    subtitleCapture: { default: true,  surfaces: ['listen', 'app'] },
    subtitleVideoLang: { default: 'en', surfaces: ['listen', 'app'] },
    subtitleFontScale: { default: '',  surfaces: ['listen'] },
    // ── drive mode（App 设置页的驾驶一节）────────────────────────────────
    // PR9：driving-model 的 SETTINGS_KEYS 已收编 —— 播客模式自己读的键全部在此
    // 登记，消费端经 keysFor('app') 取（「不在 schema 审计内」的旧豁免废除）。
    // 播放顺序由播放界面上的按钮写、读取侧按 LearnDriving.MODES 校验 —— 设置页
    // 只管要花钱的 drivePlayNotes 与预载视野 drivePreloadDays。
    drivePlaybackMode: { default: 'shuffle', surfaces: ['app'], note: "= LearnDriving.DEFAULT_MODE; player-controlled, validated against LearnDriving.MODES at read" },
    drivePlayNotes:   { default: true, surfaces: ['app'], note: "read as `!== false` — default IS the effective value" },
    drivePreloadDays: { default: 0,    surfaces: ['app'], note: '0 = today only; horizon in days' },
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
