// options.js

// Provider list is the build-time registry (window.MT_PROVIDERS, generated per
// flavor from build/providers.config.js). No hardcoded provider list here.
const PROVIDERS = (window.MT_PROVIDERS || []);
// 归一化只有一份实现：content/engine-state.js。原来这里的 defaultProviderId 还硬写着
// `|| 'google'` 兜底 —— 那是注册表规则禁止的第五份副本，而且对中国版是错的：
// google 的 flavors 是 ['global']，那个 id 在中国版注册表里根本不存在。
// 用户**主动点选过**引擎没有？出厂默认不算。判据见 content/engine-state.js：
// 故意选了免费引擎的人必须能满足「配好了」，否则悬浮球会一直把他弹回引导页。
let _engineChosen = false;
const providerById = (id) => EngineState.byId(id);
const defaultProviderId = () => EngineState.defaultId();



const $ = id => document.getElementById(id);

const SETTINGS_KEYS = [
  'enabled', 'targetLang', 'uiLang', 'provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'engineChosen',
  'textColor', 'ytTextColor', 'fontSize', 'showFab',
  'learnEnabled', 'learnDailyNew', 'learnRules',
  'ttsMode', 'ttsAutoPlay', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
  // §9.2 (2026-08-09 二): dedicated notes engine — empty notesProvider = follow
  // the translation engine's whole group (LearnNotes.resolveConfig owns the rule).
  'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
  // §9.4: transcription engine for the 说 exercise — never follows any group.
  'sttEngine', 'sttBaseUrl', 'sttApiKey', 'sttModel',
  // 高级参数（#159）。**默认不设置** —— 空字符串写回存储，读取处按「没设」处理。
  // 它们刻意不进 background.js 的 DEFAULT_SETTINGS：那会让「没设置」与「设成了默认值」
  // 无法区分，而前两项要靠这个区分来让能力表在冲突时赢。
  'reqTemperature', 'reqMaxTokens', 'reqTimeoutSec', 'reqConcurrency',
  // 自定义请求参数：`{ [providerId]: "原样字符串" }`。**只在这里读，不进 saveAll()** ——
  // 那个函数是整体覆盖式的，只从 DOM 读当前引擎那一个输入框，直接写会把其它引擎的
  // 条目抹掉。写走下面的 writeCustomParams（读-改-写），与 learnRules 同一个模式。
  'reqCustomParams',
];

// i18n: localized string by the UI language (user-selectable `uiLang`, default = OS
// locale), consulting the bundled MT_I18N_MESSAGES table, then chrome.i18n, then the
// in-markup fallback. chrome.i18n.getMessage alone can't be switched at runtime.
let _uiLang = 'auto';
function normalizeLocale(tag) {
  const T = window.MT_I18N_MESSAGES || {};
  if (!tag) return '';
  const s = String(tag).replace(/-/g, '_');
  if (T[s]) return s;
  const base = s.split('_')[0];
  if (base === 'zh') return T.zh_CN ? 'zh_CN' : (T.zh_TW ? 'zh_TW' : '');
  if (T[base]) return base;
  for (const k of Object.keys(T)) if (k.split('_')[0] === base) return k;
  return '';
}
function effectiveLocale() {
  if (_uiLang && _uiLang !== 'auto') { const n = normalizeLocale(_uiLang); if (n) return n; }
  try { const n = normalizeLocale(chrome.i18n.getUILanguage()); if (n) return n; } catch (_) {}
  return 'zh_CN';
}
const t = (key, fb) => {
  try {
    const T = window.MT_I18N_MESSAGES;
    if (T) { const loc = effectiveLocale(); const m = T[loc] && T[loc][key]; if (m) return m; }
    const cm = chrome.i18n.getMessage(key); if (cm) return cm;
  } catch (_) {}
  return fb;
};
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { const m = t(el.dataset.i18n, ''); if (m) el.textContent = m; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { const m = t(el.dataset.i18nPlaceholder, ''); if (m) el.placeholder = m; });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { const m = t(el.dataset.i18nTitle, ''); if (m) el.title = m; });
  const dt = t('options_title', ''); if (dt) document.title = dt;
}

// Provider <select> is populated from the registry; label comes from labelKey
// (localizable) or the flavor-resolved literal label.
// 界面语言变化时要重填一次下拉（选项文本会变），但不能动用户已选的引擎。
function populateProviders() {
  const sel = $('provider');
  if (sel) EngineFields.populate(sel, PROVIDERS, { t, selected: sel.value });
}

// The MODEL NAME belongs to the registry (build/providers.config.js `defaultModel`),
// not to the translators. It used to be hardcoded inside each localized hint — a
// consumer that never re-read the registry, so it drifted: the DeepSeek hint still
// said `deepseek-chat` long after the API stopped accepting that name, while the
// model PLACEHOLDER two lines below already showed the correct one. Render it from
// the same source instead (AGENTS.md — "one registry, N consumers"; the hints keep
// only the facts the registry doesn't own: the sk-… prefix, GLM's free tier, Kimi's
// per-region platform). The separator lives inside the localized label because it is
// script-specific (full-width ：in CJK, a space before : in French).
function apiHint(provider) {
  const p = providerById(provider);
  if (!p) return '';
  const hint = p.hintKey ? t(p.hintKey, '') : '';
  if (!p.defaultModel) return hint;                 // custom endpoints have no default
  const label = t('label_default_model', '默认模型：');
  const gap = /[。．！？]$/.test(hint) ? '' : ' ';   // CJK sentences don't take a space
  return `${hint}${hint ? gap : ''}${label}${p.defaultModel}`;
}


function showToast(msg, duration = 2500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// interaction-spec 全局原则 (IO 在途，控件不可用): shared wrapper — the triggering
// control goes disabled before the first await and comes back only on settle
// (success, failure, or throw). Re-entry while in flight is refused outright.
function busy(el, fn) {
  return async (...args) => {
    if (el.disabled) return;
    el.disabled = true;
    try { return await fn(...args); } finally { el.disabled = false; }
  };
}

// Say what to do BEFORE the first bad result, not after. Mirrors popup.js —
// see the comment there for why both states exist.
let _settingsReadFailed = false;
function updateSetupNote(provider, apiKey) {
  const el = $('setup-note');
  if (!el) return;
  // A storage failure outranks onboarding advice: telling someone to fill in a key
  // while we cannot read the one they already saved is worse than saying nothing.
  if (_settingsReadFailed) return;
  // 与弹窗、悬浮球同一份判据（content/engine-state.js）。只剩两支 —— 原来那句
  // 「当前使用免费通道，不需要 API Key」2026-09-01 去掉了：决策不再为免费通道开特例，
  // 第一优先级是一键配置，而那句话的作用是安抚一个我们其实想让他去配的人。
  if (EngineState.needsSetup({ provider, apiKey, engineChosen: _engineChosen })) {
    // needsSetup 为真有**两个不同的原因**，而它们不能共用一句话：
    //   · 当前引擎真的需要 Key，而 Key 是空的
    //   · 当前引擎**不需要 Key**（出厂默认那个免费的），用户只是从没配过
    // 原来两支都说「这个引擎需要 API Key」—— 对第二种人那是**假话**：他屏幕上
    // 明明写着「Google 翻译（免费，无需 API）」，而提示说它需要 Key。
    // 2026-09-02 真机截图实证。
    //
    // 第二支也**不许**变回「你可以先用免费通道」——2026-09-01 裁定去掉的正是那句，
    // 它的作用是安抚一个我们其实想让他去配的人。说事实：还没配过，去配。
    el.textContent = EngineState.needsKey({ provider })
      ? t('setup_need_key', '这个引擎需要 API Key。填入下面的 Key 之后翻译才会工作。')
      : t('setup_not_configured', '还没配过翻译引擎。用上面的一键配置，或切到「详细」里选一个引擎并填上 Key。');
    el.classList.add('warn');
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// 与引导页第 2 屏同一个组件、同一套 id。挂一次，之后靠 paint() 重画。
// onChange 在这一页**不写存储** —— 写盘走 saveAll()（整体覆盖式，DOM 才是真相源）。
let chatCore = null;
let chatClearedEndpoint = false;
function mountChatCore(values) {
  chatCore = EngineFields.render($('engine-core'), {
    slot: 'chat', t, head: false, values,
    onChange: (patch) => { if ('apiBaseUrl' in patch && patch.apiBaseUrl === '') chatClearedEndpoint = true; },
  });
  // 这一页额外的东西，挂进组件交回来的那几行里。挂在行**内**是构成要件：
  // 字段按 visibility 收起时它们跟着收，不会出现「字段藏了、提示还在」。
  const ex = $('engine-extras').content;
  const [apiHintEl, baseHint, modelHint] = ex.querySelectorAll('p.hint');
  chatCore.rows.key.inputRow.append(ex.querySelector('#toggle-eye'));
  chatCore.rows.key.row.append(apiHintEl);
  chatCore.rows.baseUrl.row.append(baseHint);
  chatCore.rows.model.row.append(modelHint);
}

function updateProviderUI(provider) {
  // 露哪几个框、示例地址、示例模型全归组件；这里只剩这一页独有的两件事。
  if (chatCore) chatCore.paint();
  $('api-hint').textContent = apiHint(provider);
  // Hooked here rather than at each call site: updateProviderUI already re-runs on
  // load, on engine change and on UI-language change — every moment the note can go stale.
  updateSetupNote(provider, $('api-key').value);
}

// The engine list comes from the build-time registry (window.MT_TTS_ENGINES,
// generated from build/tts.config.js). No hardcoded engine list here — same rule as
// the translation providers.
const TTS_ENGINES = (window.MT_TTS_ENGINES || []);
const ttsEngineById = (id) => TTS_ENGINES.find((e) => e.id === id) || null;

// 与引导页第 2 屏**同一个组件、同一套 id**。挂一次，之后靠 paint() 重画。
// onChange 在这一页**不写存储** —— 写盘走 saveAll()（整体覆盖式，DOM 才是真相源）；
// 这里只记下组件有没有帮我们清掉端点，好让 toast 说实话。
let ttsCore = null;
let ttsClearedEndpoint = false;
function mountTtsCore(values) {
  ttsCore = EngineFields.render($('tts-core'), {
    slot: 'tts', t, head: false, values,
    onChange: (patch) => { if ('ttsBaseUrl' in patch && patch.ttsBaseUrl === '') ttsClearedEndpoint = true; },
  });
}

// 引擎自检的失败具名与「服务端原话」，实现在 learn/engine-test.js —— 那张表现在有
// **四个**消费者（这三个按钮 + 引导页 + 一键配置卡）。它以前住在这个文件的闭包里，
// 于是引导页只能自己手写一份，同一个 401 在两个页面上说两种话。
function engineTestReason(e) { return EngineTest.reason(e, t); }
function serverLine(e) { return EngineTest.serverLine(e, t); }

function ttsReason(reason) {
  switch (reason) {
    case 'no_voice': return t('tts_no_voice', '系统里没有这门语言的语音');
    case 'no_voice_und': return t('tts_no_voice_und', '这张卡的语言未知 —— 在设置里选一个朗读语音后即可朗读');
    case 'unsupported': return t('tts_unsupported', '这个浏览器不提供内置语音');
    case 'no_base': return t('tts_no_base', '还没填语音端点地址');
    case 'no_key': return t('tts_no_key', '还没填语音 API Key');
    case 'blocked': return t('tts_blocked', '浏览器拦下了自动播放，点一下播放');
    case 'http': return t('tts_http', '语音服务返回了错误');
    default: return t('tts_failed', '这句暂时读不出来');
  }
}

function applyTtsConfig() {
  LearnTTS.configure({
    engineId: $('tts-engine').value,
    baseUrl: $('tts-base-url').value.trim(),
    // Read straight off the form, so it is by definition the new semantics.
    apiKey: $('tts-api-key').value.trim(),
    model: $('tts-model').value.trim(),
    voice: $('tts-voice').value,
    rate: Number($('tts-rate').value) || 1,
  });
}

async function refreshTtsCache() {
  const el = $('tts-cache');
  if (!el) return;
  try {
    const st = await LearnStore.audioStats();
    const e = ttsEngineById($('tts-engine').value);
    // The browser engine cannot return audio data, so it can never populate a
    // cache — say that rather than showing a permanent "0 KB" that looks broken.
    if (e && !e.returnsAudio) { el.textContent = t('tts_cache_na', '设备内置语音不产生缓存'); return; }
    el.textContent = st.count
      ? t('tts_cache', '语音缓存 {n} 条 · 约 {mb} MB（上限 {cap} MB）')
          .replace('{n}', String(st.count))
          .replace('{mb}', String(Math.max(1, Math.round(st.bytes / 1048576))))
          .replace('{cap}', String(Math.round(LearnStore.MAX_AUDIO_BYTES / 1048576)))
      : t('tts_cache_empty', '语音缓存为空');
  } catch (_) { el.textContent = ''; }
}

// Voices for the browser engine are discovered at runtime and arrive LATE — see
// LearnTTS.loadVoices. Registry engines declare their voices, and a self-hosted one
// declares none, so the field falls back to free text via a single "default" option.
async function updateTtsUI(selectedVoice) {
  const mode = $('tts-mode').value;
  $('tts-config').hidden = mode === 'off';
  const e = ttsEngineById($('tts-engine').value) || TTS_ENGINES[0];
  if (!e) return;
  $('tts-engine-hint').textContent = e.hintKey ? t(e.hintKey, '') : '';
  // 四个核心控件归组件（露哪几个、示例地址、示例模型全在它那里）。
  if (ttsCore) ttsCore.paint();

  const sel = $('tts-voice');
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = t('tts_voice_auto', '自动（按卡片语言挑选）');
  sel.appendChild(auto);

  applyTtsConfig();
  if (e.type === 'browser') {
    const voices = await LearnTTS.loadVoices();
    for (const v of voices) {
      const o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = `${v.name} — ${v.lang}`;
      sel.appendChild(o);
    }
  } else if (e.voices) {
    for (const v of e.voices) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    }
  }
  sel.value = [...sel.options].some((o) => o.value === selectedVoice) ? selectedVoice : '';
  applyTtsConfig();
  refreshTtsCache();
}

function updateColorPreview(color) {
  $('color-preview').style.color = color;
}

// ─── 自定义请求参数：按引擎存，走读-改-写 ────────────────────────────────
//
// 与 learnRules 同一个模式（见本文件下方那条注释：「learnRules is NOT part of
// saveAll(): it is a single JSON key written whole」）。原因也一样：saveAll 整体覆盖，
// 而这是一张按引擎索引的表，DOM 上只有当前引擎那一格。
let customParams = {};

async function writeCustomParams(providerId, text) {
  if (!providerId) return;
  const next = Object.assign({}, customParams);
  // 空 ⇒ 删掉这个引擎的条目，而不是留一个空字符串。存储里没有该键 = 没设过。
  if (String(text || '').trim()) next[providerId] = text;
  else delete next[providerId];
  customParams = next;
  await new Promise((r) => chrome.storage.local.set({ reqCustomParams: next }, r));
}

// 校验只影响**提示**，不影响保存 —— JSON 打了一半时用户的输入不能丢。
// 运行时解析不了就当没填（request-shape.js 的 customFor 同一条规矩）。
function updateCustomNote() {
  const el = $('adv-custom');
  const note = $('adv-custom-note');
  const raw = String(el.value || '').trim();
  if (!raw) { note.textContent = ''; return; }
  let obj;
  try { obj = JSON.parse(raw); } catch (e) {
    note.textContent = t('options_adv_custom_bad', '解析不了，本次不会发送：') + e.message;
    return;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    note.textContent = t('options_adv_custom_notobj', '需要是一个 JSON 对象，本次不会发送。');
    return;
  }
  const dropped = Object.keys(obj).filter((k) => RequestShape.CUSTOM_FORBIDDEN.indexOf(k) >= 0);
  const kept = Object.keys(obj).filter((k) => RequestShape.CUSTOM_FORBIDDEN.indexOf(k) < 0);
  const none = t('options_adv_custom_none', '（无）');
  note.textContent = t('options_adv_custom_ok', '将发送：') + (kept.join(', ') || none)
    + (dropped.length ? '\n' + t('options_adv_custom_dropped', '不可覆盖，已忽略：') + dropped.join(', ') : '');
}

// 「留空 = 不设置」的读取器。返回空串而不是 0/NaN：saveAll 是整体覆盖式的，
// 一个 NaN 会把用户明确设过的值悄悄清成 0，而 0 恰好是 temperature 上最危险的值。
function advNum(id, key) {
  const raw = String($(id).value || '').trim();
  if (raw === '') return '';
  const n = Number(raw);
  if (!isFinite(n)) return '';
  const [lo, hi] = RequestShape.CLAMP[key];
  return Math.max(lo, Math.min(hi, n));
}

// 「表赢，但界面上说明原因」的落点。能力表说当前 host+模型不收某个参数时，那个格子
// 里的值不会被发送 —— 静默丢弃是这套设计里最难被发现的失败（服务端不会为此报错），
// 所以在它旁边直接说出来，并把输入框置灰，让「填了没用」变成看得见的事。
function updateAdvancedNotes() {
  let caps = {};
  try {
    caps = RequestShape.paramsFor(
      WireFormat.resolveEndpoint($('api-base-url').value.trim(),
        (window.MT_PROVIDERS || []).find((p) => p.id === $('provider').value)),
      $('api-model').value.trim()) || {};
  } catch (_) { caps = {}; }
  const rows = [
    ['adv-temperature', caps.temperature],
    ['adv-max-tokens', caps.budget],
  ];
  for (const [id, cap] of rows) {
    const off = cap === false;
    $(id).disabled = off;
    $(id + '-note').textContent = off
      ? t('options_adv_unsupported', '当前模型不接受此参数，本次不会发送。')
      : '';
  }
}

// saveAll() 是**整体覆盖式**的：它按字面量从 DOM 读下面每一个字段。
// 少一个元素，`$('x').value` 就在 null 上抛 —— 而所有调用点都是无 catch 的
// `await saveAll()`，于是**每次保存都静默什么都不存**：不写盘、不弹 toast、界面
// 毫无变化。更坏的是 smoke 里那条「一键配置扛住整体覆盖」的断言会因此**变绿**
// （什么都没写，所以前后相等）。
//
// 所以这道断言必须在最前面、而且必须**响**。刻意不写成 `el ? el.value : ''` ——
// 那会把「元素不在」翻译成「用户清空了」，把一次崩溃换成一次静默清零。
//
// 推论：这张页面**永不 remove() 任何 section**（sync-section 是唯一的例外，它一个
// 字段都不进 saveAll）。要收起一张卡就用 hidden —— 元素还在 DOM 里，值照样读得到。
const SAVE_FIELDS = ['api-base-url', 'api-key', 'api-model', 'font-size', 'learn-daily-new', 'learn-enabled', 'notes-api-key', 'notes-base-url', 'notes-model', 'notes-provider', 'provider', 'show-fab', 'stt-api-key', 'stt-base-url', 'stt-engine', 'stt-model', 'target-lang', 'text-color', 'tts-api-key', 'tts-autoplay', 'tts-base-url', 'tts-engine', 'tts-mode', 'tts-model', 'tts-rate', 'tts-voice', 'ui-lang', 'yt-text-color'];
function assertSaveFields() {
  const missing = SAVE_FIELDS.filter((id) => !$(id));
  if (missing.length) {
    // 开发者可见的断言，永不到用户眼前 —— 所以是英文，不进 i18n。
    throw new Error('saveAll: controls missing from the DOM (a section was removed '
      + 'rather than hidden): ' + missing.join(', '));
  }
}

async function saveAll() {
  assertSaveFields();
  const settings = {
    provider:    $('provider').value,
    apiKey:      $('api-key').value.trim(),
    apiBaseUrl:  $('api-base-url').value.trim(),
    apiModel:    $('api-model').value.trim(),
    targetLang:  $('target-lang').value,
    uiLang:      $('ui-lang').value,
    textColor:   $('text-color').value,
    ytTextColor: $('yt-text-color').value,
    fontSize:    $('font-size').value,
    showFab:     $('show-fab').checked,
    learnEnabled: $('learn-enabled').checked,
    learnDailyNew: Math.max(1, Math.min(200, Number($('learn-daily-new').value) || LearnScheduler.DEFAULTS.dailyNew)),
    ttsMode:     $('tts-mode').value,
    ttsAutoPlay: $('tts-autoplay').checked,
    ttsEngine:   $('tts-engine').value,
    ttsBaseUrl:  $('tts-base-url').value.trim(),
    ttsApiKey:   $('tts-api-key').value.trim(),
    ttsModel:    $('tts-model').value.trim(),
    ttsVoice:    $('tts-voice').value,
    ttsRate:     $('tts-rate').value,
    notesProvider: $('notes-provider').value,
    notesApiKey:   $('notes-api-key').value.trim(),
    notesBaseUrl:  $('notes-base-url').value.trim(),
    notesModel:    $('notes-model').value.trim(),
    // 空 ⇒ 存空串（= 没设置）。非空才钳制，钳制范围与 request-shape.js 的 CLAMP 同源，
    // 因为界面钳过之后运行时还会再钳一次 —— 存储可能来自同步、来自 App、来自旧版本。
    reqTemperature: advNum('adv-temperature', 'reqTemperature'),
    reqMaxTokens:   advNum('adv-max-tokens', 'reqMaxTokens'),
    reqTimeoutSec:  advNum('adv-timeout', 'reqTimeoutSec'),
    reqConcurrency: advNum('adv-concurrency', 'reqConcurrency'),
    sttEngine:     $('stt-engine').value,
    sttApiKey:     $('stt-api-key').value.trim(),
    sttBaseUrl:    $('stt-base-url').value.trim(),
    sttModel:      $('stt-model').value.trim(),
  };
  await new Promise(resolve => chrome.storage.local.set(settings, resolve));
}

// Map a stored fontSize to a valid scale option. Legacy values ('0.9em', '14px')
// predate the relative-scale model → default to 1.0 (match the original).
const SCALE_OPTS = ['0.8', '0.9', '1.0', '1.1', '1.25'];
function scaleValue(v) { return SCALE_OPTS.includes(v) ? v : '1.0'; }

async function init() {
  // Explicit keys, never get(null): the same bucket holds the unbounded `tr:` cache
  // and the `lq:` learning outbox (docs/learning-design.md §7).
  // `resolve(s || {})`, not bare `resolve` — popup.js has always had the guard and
  // this file did not, which is the entire difference between the popup working on
  // Safari iOS and this page being inert there. A callback that arrives with no
  // value resolves to `undefined`, the next line reads `.uiLang` off it, init()
  // rejects, and NOTHING after this point runs: no provider list, no listeners, no
  // learning stats. The page still renders, because all of that is static HTML — so
  // it looks fine and does nothing.
  // PageSettings, not a bare get: extension pages on Safari iOS read back nothing
  // (learn/page-settings.js). Symptom was every setting appearing to revert — you
  // re-entered your API key on every visit — while the content script read the same
  // keys fine and translated with the configured provider.
  // A failed read is NOT an empty profile. Painting defaults over a storage failure
  // is how "your API key silently reverted to the free channel" happened.
  const _s = await PageSettings.read(SETTINGS_KEYS);
  // Fold the migration's result into the values we are about to paint, so the field
  // shows the complete address on THIS visit rather than the next one.
  const s0 = _s.data;
  if (!_s.ok) {
    _settingsReadFailed = true;
    try {
      const el = $('setup-note');
      if (el) {
        el.textContent = t('settings_read_failed',
          '读不到已保存的设置，下面显示的是默认值——请不要在此保存，否则会覆盖掉你原来的配置。（{why}）')
          .replace('{why}', _s.error || '');
        el.classList.add('warn');
        el.style.display = 'block';
      }
    } catch (_) {}
  }
  _uiLang = s0.uiLang || 'auto';
  applyI18n();
  // Single source: the manifest. `about_line` used to carry "· v1.0.0" inside every
  // localized string, so the version had eleven copies and none of them tracked the
  // build — exactly the failure the provider registry rule exists to prevent.
  try {
    const el = $('about-version');
    if (el) el.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (_) {}
  const s = s0;

  // A stored provider from another flavor may not exist in this build → fall
  // back to the first registry provider available here.
  const prov = providerById(s.provider) ? s.provider : defaultProviderId();
  // 引擎 / Key / 地址 / 模型四样由组件按 values 预填，不再逐个 set —— 手工回填就是
  // 第二份「有哪几个字段」的清单，加字段时必然漏掉它。
  mountChatCore({ ...s, provider: prov });
  $('target-lang').value    = s.targetLang  || 'zh-CN';
  $('ui-lang').value        = s.uiLang      || 'auto';
  $('text-color').value     = s.textColor   || window.MT_PALETTE.textColor;
  $('yt-text-color').value  = s.ytTextColor || window.MT_PALETTE.ytTextColor;
  $('font-size').value      = scaleValue(s.fontSize);
  $('show-fab').checked     = s.showFab !== false;
  // Capture is OFF until the user turns it on once — never default-on on upgrade.
  $('learn-enabled').checked = s.learnEnabled === true;
  $('learn-daily-new').value = Number(s.learnDailyNew) > 0 ? Number(s.learnDailyNew) : LearnScheduler.DEFAULTS.dailyNew;
  // 回填是必须的，不是可选的：saveAll() 整体覆盖，任何一个控件没回填，用户下一次改
  // 别的字段就会把它清空。空值回填成空字符串 —— 那正是「没设置」的表示。
  $('adv-temperature').value = s.reqTemperature === '' || s.reqTemperature == null ? '' : s.reqTemperature;
  $('adv-max-tokens').value = s.reqMaxTokens === '' || s.reqMaxTokens == null ? '' : s.reqMaxTokens;
  $('adv-timeout').value = s.reqTimeoutSec === '' || s.reqTimeoutSec == null ? '' : s.reqTimeoutSec;
  $('adv-concurrency').value = s.reqConcurrency === '' || s.reqConcurrency == null ? '' : s.reqConcurrency;
  customParams = (s.reqCustomParams && typeof s.reqCustomParams === 'object') ? s.reqCustomParams : {};
  $('adv-custom').value = customParams[s.provider] || '';
  updateCustomNote();
  updateAdvancedNotes();
  $('tts-mode').value      = s.ttsMode || 'off';
  $('tts-autoplay').checked = s.ttsAutoPlay !== false;
  $('tts-rate').value      = String(Number(s.ttsRate) > 0 ? Number(s.ttsRate) : 1);
  // 引擎 / Key / 地址 / 模型四样由组件按 values 预填，这里不再逐个 set —— 手工回填
  // 就是第二份「哪几个字段」的清单，加字段时必然漏。
  mountTtsCore({ ...s, ttsEngine: s.ttsEngine || LearnTTS.DEFAULTS.engineId });
  await updateTtsUI(s.ttsVoice || '');

  // §9.2 (2026-08-09 二) — dedicated notes engine. Option "" = follow the
  // translation engine (the default, and the pre-feature behaviour); the
  // candidate list is the registry filtered by LearnNotes' own type rule, so
  // "what counts as a chat engine" cannot drift between the gate and this picker.
  // 第四个槽。条目是 LearnNotes 过滤过的对话引擎表 —— 「什么算对话引擎」的判据只有
  // 一份，在 LearnNotes 那里，不能在这里另写一份 type 白名单。
  let notesCore = null;
  let notesClearedEndpoint = false;
  function mountNotesCore(values) {
    notesCore = EngineFields.render($('notes-core'), {
      slot: 'notes', t, head: false, values, entries: LearnNotes.chatEngines(),
      onChange: (patch) => { if ('notesBaseUrl' in patch && patch.notesBaseUrl === '') notesClearedEndpoint = true; },
    });
  }
  function updateNotesUI(id) {
    if (notesCore) notesCore.paint();
    // '' ⇒ 跟随翻译引擎 ⇒ 这一组一个框都不露，连测试按钮一起收起来。
    $('notes-config').hidden = !id;
  }
  mountNotesCore(s);
  updateNotesUI($('notes-provider').value);

  // §9.4 — transcription engine for the 说 exercise. Option "" = not configured =
  // the speak form does not exist (the correct default; there is no zero-config
  // transcription engine and never will be — §12). Candidates come from the
  // generated registry; nothing engine-specific is restated here.
  // 四个核心控件由共用组件生成（与引导页第 2 屏同一个组件、同一套 id）。
  // 组件只负责「有哪几个框、露哪几个」；写盘仍然走这一页的 saveAll()，所以
  // onChange 在这里**不写存储** —— 只记下它有没有帮我们清掉端点，好让 toast 说实话。
  let sttClearedEndpoint = false;
  const sttCore = EngineFields.render($('stt-core'), {
    slot: 'stt', t, head: false, values: s,
    onChange: (patch) => { if ('sttBaseUrl' in patch && patch.sttBaseUrl === '') sttClearedEndpoint = true; },
  });
  function updateSttUI(id) {
    const e = (window.MT_STT_ENGINES || []).find((x) => x.id === id) || null;
    // 组件自己按条目决定露哪几个框；这里只剩「没选引擎就连测试按钮一起收起来」。
    if (sttCore) sttCore.paint();
    $('stt-config').hidden = !e;
  }
  updateSttUI($('stt-engine').value);

  updateProviderUI(prov);
  updateColorPreview(s.textColor || window.MT_PALETTE.textColor);
  $('yt-color-preview').style.color = s.ytTextColor || window.MT_PALETTE.ytTextColor;
  if (prov !== s.provider) await saveAll(); // migrate an out-of-flavor provider

  // ─── Listeners ──────────────────────────────────────────────────────

  $('notes-provider').addEventListener('change', async (e) => {
    // 组件的 change 监听先跑并清端点；这里只读它的回报。
    const cleared = notesClearedEndpoint; notesClearedEndpoint = false;
    updateNotesUI(e.target.value);
    await saveAll();
    showToast(cleared ? t('toast_endpoint_cleared', '换引擎了，接口地址已清空') : t('toast_saved', '已保存'));
  });
  for (const id of ['notes-api-key', 'notes-base-url', 'notes-model']) {
    $(id).addEventListener('change', async () => { await saveAll(); });
  }

  $('stt-engine').addEventListener('change', async (e) => {
    // 清端点由组件做（两个 host 都要），这里只读它的回报 —— 静默丢掉用户填过的地址
    // 是这条规则要防的事，所以 toast 必须说出来。
    const cleared = sttClearedEndpoint; sttClearedEndpoint = false;
    updateSttUI(e.target.value);
    await saveAll();
    showToast(cleared ? t('toast_endpoint_cleared', '换引擎了，接口地址已清空') : t('toast_saved', '已保存'));
  });
  for (const id of ['stt-api-key', 'stt-base-url', 'stt-model']) {
    $(id).addEventListener('change', async () => { await saveAll(); });
  }

  $('provider').addEventListener('change', async (e) => {
    // 组件的 change 监听在挂载时注册，**先于**这一条跑；这里只读它的回报。
    const cleared = chatClearedEndpoint; chatClearedEndpoint = false;
    // 记下「这是一次主动选择」。出厂默认的免费引擎不算 —— 那正是新判据要区分的：
    // 全新安装的人应当被推去配一次，而故意选了免费引擎的人不该被反复弹回引导页。
    // 单独写盘，不进 saveAll()：它是一次事件的记录，不是一个可编辑的设置。
    _engineChosen = true;
    try { chrome.storage.local.set({ engineChosen: 1 }); } catch (_) {}
    updateProviderUI(e.target.value);
    await saveAll();
    updateAdvancedNotes();     // 换引擎 = 换 host = 能力可能整组变了
    // ⚠️ 自定义参数按引擎存，切引擎必须**重新回填**。不做的话输入框里还留着上一个
    // 引擎的内容，用户随手一改就把 A 的参数存到了 B 名下。
    $('adv-custom').value = customParams[e.target.value] || '';
    updateCustomNote();
    showToast(cleared ? t('toast_endpoint_cleared', '换引擎了，接口地址已清空')
      : t('toast_provider_saved', '翻译引擎已保存'));
  });

  $('api-key').addEventListener('change', async () => { await saveAll(); showToast(t('toast_apikey_saved', 'API Key 已保存')); });
  // `change` only fires on blur — clear the note as soon as a key is typed.
  $('api-key').addEventListener('input', (e) => updateSetupNote($('provider').value, e.target.value));
  $('api-base-url').addEventListener('change', async () => {
    await saveAll(); updateAdvancedNotes(); showToast(t('toast_apiurl_saved', 'API 地址已保存'));
  });
  $('api-model').addEventListener('change', async () => {
    await saveAll(); updateAdvancedNotes(); showToast(t('toast_model_saved', '模型已保存'));
  });

  // ── 文本框：input 也必须落盘（防抖），不能只靠 change ─────────────────────
  //
  // `change` 只在**失焦**时触发。用户在手机上粘好 API Key 之后直接锁屏、切到别的
  // App、或者直接退出设置页，change 根本没有机会触发 —— Key 被**静默丢弃**：没有
  // 报错、没有提示，而用户以为已经填好了。
  //
  // 2026-08-29 真机实测（iPhone 14 Pro / iOS 26.5）：粘完 Key 锁屏，回来输入框是空的；
  // 引擎已经是 DeepSeek 但没有 Key，于是每段都报「翻译失败」。用户侧看到的是「我明明
  // 填了 Key，它还是不工作」—— 这正是新用户路径上最贵的一种失败，因为它把「配置没
  // 保存」伪装成了「产品是坏的」。
  //
  // 防抖 500ms：打字过程中不必每个字符写一次存储，但停手半秒就必须落盘。change 那一路
  // 原样保留（失焦时立即存 + toast），两者叠加是幂等的。
  //
  // 九个框一起改而不是只改 api-key：同一个陷阱在另外八个里一模一样，只修被抓到的那个，
  // 下一次仍然会中招。adv-custom **故意不在此列** —— 它的中间态是解析不了的 JSON，
  // 理由写在下面它自己那条注释里。
  const SAVE_ON_INPUT = [
    'api-key', 'api-base-url', 'api-model',
    'notes-api-key', 'notes-base-url', 'notes-model',
    'stt-api-key', 'stt-base-url', 'stt-model',
    // 2026-08-31 补：语音那三个框一直不在这里，只靠 change 失焦保存 —— 粘完 key
    // 直接关页面就丢。与 1.6.8 修过的「API Key 只在 change 保存被静默丢弃」同族，
    // 当时改了九个框，漏的正是这三个。
    'tts-api-key', 'tts-base-url', 'tts-model',
  ];
  let _inputSaveTimer = null;
  for (const id of SAVE_ON_INPUT) {
    const el = $(id);
    if (!el) continue;              // 不同 flavor 可能少某个面板，缺了就跳过
    el.addEventListener('input', () => {
      clearTimeout(_inputSaveTimer);
      _inputSaveTimer = setTimeout(() => { saveAll(); }, 500);
    });
  }

  // 折叠沿用来源管理那条（options.js 的 btn-manage-sources）：button + hidden 容器，
  // 不用 <details>（这个页面里一个都没有），也不写 display 规则（options.css:7 已有
  // `[hidden]{display:none!important}`，再写一条就是那次「面板永远展开」的事故）。
  // 不加 busy()：这里没有 IO。
  // ── 重看引导 ────────────────────────────────────────────────────────────
  // 清掉 extObSeen 只是让 popup 的入口重新出现；引导页本身**读的是活状态**
  // （引擎、Key、采集开关、语言 chips 都从 chrome.storage 现读），所以重看时
  // 显示的是用户当前的真实配置，不是一段静态回放。
  // 把已配好的 Key 显示成空白会让人以为设置丢了 —— 那比不给重看更糟。
  //
  // ⚠️ window.open 必须**同步**发生在这次点击里。一旦先 await 过，用户手势就用掉了,
  // Safari 会把随后的 window.open 当弹窗拦掉 —— 表现是「点了没反应」，控制台没有
  // 任何东西，本地 Chrome 也测不出来（Chrome 对这条宽松）。2026-09-01 用户在真机上
  // 报的就是这个。所以顺序是**先开页，再清标记**：两件事本来也不互相依赖，引导页
  // 读的是活状态，extObSeen 只影响弹窗那个入口。
  // ── 清除本机全部数据 ────────────────────────────────────────────────────
  // 「所有数据」散在四处，少清一处就是没清：
  //   1. chrome.storage.local —— 设置、四个 API Key、翻译缓存 tr:*、登录会话，
  //      以及 LearnBackup 的本地备份（它也存在这里，见 learn/backup.js）
  //   2. mt-learn* 那组 IndexedDB —— **按账号分库**，不止当前那一个
  //   3. 登录态本身 —— 不登出的话，缓存的 session 会在下一次打开时把语料同步回来，
  //      用户看到的是「清了又长回来」
  //   4. 学习库的活句柄 —— 不关掉，deleteDatabase 会 blocked 然后永远挂着
  //
  // 判据是**回读**，不是「没报错」：清完重新列一遍库、重新读一遍 storage，
  // 都空了才敢跳走。这条路上「成功」太容易是假的（deleteDatabase 的 blocked
  // 不抛异常、Safari 的 storage 回调可能根本不落地）。
  async function wipeEverything() {
    // 先记下**现在有哪些键**。回读时比的是这一份，见下面那段注释。
    const before = await new Promise((r) => {
      setTimeout(() => r([]), 3000);
      try { chrome.storage.local.get(null, (o) => r(Object.keys(o || {}))); } catch (_) { r([]); }
    });
    try { await LearnAuth.signOut(); } catch (_) { /* 没登录 / 网络不通都不该挡住清除 */ }
    try { await LearnStore.closeDb(); } catch (_) {}
    await deleteLearnDbs();
    await new Promise((r) => {
      let done = false;
      const fin = () => { if (!done) { done = true; r(); } };
      // Safari 上 storage 回调不落地是有先例的（见 learn/page-settings.js），
      // 而一个不落地的回调会把整个清除流程钉死在这一行。
      setTimeout(fin, 3000);
      try { chrome.storage.local.clear(fin); } catch (_) { fin(); }
    });
    // 回读。
    //
    // 判据是「**原来那些键**还在不在」，不是「storage 是不是空的」。
    // 这一页上还活着的代码（自动同步、本地备份）会在清完之后的几毫秒里写回一两个
    // 时间戳 —— 那不是用户的数据，拿它判失败就是在为一件已经做成的事报错。
    // 用户要的是「我的东西没了」，而这条判据恰好说的就是那句话。
    const after = await new Promise((r) => {
      setTimeout(() => r(null), 3000);
      try { chrome.storage.local.get(null, (o) => r(o || {})); } catch (_) { r(null); }
    });
    const dbs = await learnDbNames();
    // 读不回来 ⇒ 不知道 ⇒ 按失败处理（谎报成功比报失败贵得多）。
    const leftover = after ? before.filter((k) => k in after)
      : [t('wipe_left_unreadable', '存储读不回来')];
    return { leftover, dbsLeft: dbs };
  }

  // 列出还存在的 mt-learn* 库。
  //
  // ⚠️ 没有 indexedDB.databases() 时**不能**退回「返回当前库名」——那只是一个名字，
  // 不是「库还在」的证据。第一版就是那么写的，后果是：删成功了，回读照样数出 1 个，
  // 于是**永远报「没有清干净」**。2026-09-02 用户在真机上撞到的就是它。
  // 没有那个 API 时改成逐个**探测**：用 open 打开，如果触发了 onupgradeneeded，
  // 说明它本来不存在（是这次 open 新建的）—— 立刻回滚删掉，并如实报「不存在」。
  async function learnDbNames() {
    try {
      if (indexedDB.databases) {
        const l = await indexedDB.databases();
        return (l || []).map((d) => d && d.name).filter((n) => n && /^mt-learn/.test(n));
      }
    } catch (_) { /* 有这个 API 但调用失败 ⇒ 走下面的探测 */ }
    const cur = LearnStore.currentDbName ? LearnStore.currentDbName() : LearnStore.DB_NAME;
    const names = cur ? [cur] : [];
    const alive = [];
    for (const n of names) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await new Promise((r) => {
        let fresh = false;
        let req;
        setTimeout(() => r(true), 2500);      // 探不出来就当它还在：宁可报失败，不可谎报成功
        try { req = indexedDB.open(n); } catch (_) { r(true); return; }
        req.onupgradeneeded = () => { fresh = true; };
        req.onsuccess = () => {
          try { req.result.close(); } catch (_) {}
          if (fresh) { try { indexedDB.deleteDatabase(n); } catch (_) {} }
          r(!fresh);
        };
        req.onerror = () => r(true);
      });
      if (exists) alive.push(n);
    }
    return alive;
  }

  async function deleteLearnDbs() {
    const names = await learnDbNames();
    await Promise.all(names.map((n) => new Promise((r) => {
      // blocked 不结束请求 —— 它只是在说「还有人开着」。给个上限，然后靠回读定胜负。
      setTimeout(r, 4000);
      let req;
      try { req = indexedDB.deleteDatabase(n); } catch (_) { r(); return; }
      req.onsuccess = r; req.onerror = r;
    })));
  }

  $('btn-wipe-all').addEventListener('click', busy($('btn-wipe-all'), async () => {
    // 兜底串必须整条写在 t() 的第二个参数上，不能用 + 拆行：拆了之后第二段的中文
    // 就不在兜底位上，零硬编码文案那道门禁会红（它是对的 —— 那正是漏译的形状）。
    if (!window.confirm(t('options_wipe_confirm', '清除这台设备上的全部数据？API Key、全部设置、已采集的句子与复习进度都会被删除，并会退出登录。此操作无法撤销。\n\n已同步到云端的内容不受影响 —— 重新登录会把它们同步回来。'))) return;
    const r = await wipeEverything().catch((e) => ({ leftover: ['(' + ((e && e.message) || e) + ')'], dbsLeft: [] }));
    if (r.leftover.length || r.dbsLeft.length) {
      // 说实话，并且**说得出剩了什么**。原来只有一句「没有清干净」——那句话对用户
      // 和对我都毫无信息：不知道剩的是 Key 还是一个时间戳，也就不知道该不该担心。
      // 半清干净了却报「已清除」仍然是更糟的那一边：用户会拿着一台他以为干净的
      // 设备去卖掉。
      const what = r.leftover.concat(r.dbsLeft).slice(0, 4).join('、');
      showToast(t('toast_wipe_failed_what', '没有清干净，还剩：{what}。请再试一次。')
        .replace('{what}', what), 6000);
      return;
    }
    // location 导航不受用户手势限制（不同于 window.open），这里不需要提前调。
    location.replace(chrome.runtime.getURL('onboard/onboard.html'));
  }));

  // 登录之后那个「现在翻一页看看」。地址与引导页、一键配置卡走同一个 tryUrl ——
  // 按目标语言选示例页。window.open 必须同步发生在这次点击里（见下面那段注释）。
  if ($('btn-sync-try')) {
    $('btn-sync-try').addEventListener('click', () => {
      try { window.open(QuickSetup.tryUrl($('target-lang') && $('target-lang').value), '_blank', 'noopener'); } catch (_) {}
    });
  }

  $('btn-reonboard').addEventListener('click', () => {
    try { window.open(chrome.runtime.getURL('onboard/onboard.html'), '_blank'); } catch (_) {}
    try { chrome.storage.local.remove(['extObSeen'], () => {}); } catch (_) {}
  });

  // ── ZIP 直装提示 ────────────────────────────────────────────────────────
  // 官网早就说了这句（home.installS4，8 语言都有），但装完的人不会回去看官网。
  //
  // 判据用商店分配的固定 id：直装（unpacked）时 Chrome 按公钥现算一个 id，与商店那个
  // 不同。这个常量是公开的，README.md:35 与官网 index.html 都写着它。
  // **不用 chrome.management** —— 那要一个会吓到用户的权限，为一句提示不值得。
  //
  // Firefox 不做这个判断：browser_specific_settings.gecko.id 在 AMO 安装与临时安装
  // 是同一个值，自分发 XPI 本来也必须签名。写一个注定失效的检查比不写更坏。
  const CWS_ID = 'ilnmffeejeohomjelipejdldhkjeoinf';
  try {
    const isFirefox = typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo;
    if (!isFirefox && chrome.runtime.id && chrome.runtime.id !== CWS_ID) {
      const el = $('unpacked-note');
      if (el) {
        el.textContent = t('extob_unpacked_note',
          '你是用 ZIP 直接装的：这一份不会自动更新。新版本请到官网下载，或改从商店安装以获得自动更新。');
        el.hidden = false;
      }
    }
  } catch (_) { /* 判断不出来就不说 —— 说错比不说更坏 */ }

  $('btn-advanced').addEventListener('click', () => {
    const box = $('advanced-config');
    box.hidden = !box.hidden;
    if (!box.hidden) updateAdvancedNotes();
  });
  // 输入时只更新提示（不写存储），失焦时才落盘 —— 打字过程中每个字符都写一次存储
  // 既无必要，也会让「解析不了」的中间态反复触发运行时刷新。
  $('adv-custom').addEventListener('input', updateCustomNote);
  $('adv-custom').addEventListener('change', async () => {
    await writeCustomParams($('provider').value, $('adv-custom').value);
    try { RequestShape.refresh(); } catch (_) {}
    updateCustomNote();
    showToast(t('toast_saved', '已保存'));
  });

  for (const id of ['adv-temperature', 'adv-max-tokens', 'adv-timeout', 'adv-concurrency']) {
    $(id).addEventListener('change', async () => {
      await saveAll();
      // 运行时缓存了这四个值（request-shape.js 的 _prefs）。它自己也监听 storage 变化，
      // 但这个页面与内容脚本不在同一个上下文，所以这里显式刷一次自己的那份。
      try { RequestShape.refresh(); } catch (_) {}
      updateAdvancedNotes();
      showToast(t('toast_saved', '已保存'));
    });
  }
  $('target-lang').addEventListener('change', async () => { await saveAll(); showToast(t('toast_lang_saved', '语言已保存')); });
  $('ui-lang').addEventListener('change', async (e) => {
    _uiLang = e.target.value || 'auto';
    await saveAll();
    applyI18n();
    populateProviders();                     // re-localize option labels
    updateProviderUI($('provider').value);   // re-localize the API hint
    showToast(t('toast_lang_saved', '语言已保存'));
  });
  $('font-size').addEventListener('change', async () => { await saveAll(); showToast(t('toast_fontsize_saved', '字号已保存')); });
  $('show-fab').addEventListener('change', async () => { await saveAll(); });

  $('text-color').addEventListener('input', (e) => {
    updateColorPreview(e.target.value);
  });
  $('text-color').addEventListener('change', async () => { await saveAll(); showToast(t('toast_color_saved', '颜色已保存')); });

  $('yt-text-color').addEventListener('input', (e) => {
    $('yt-color-preview').style.color = e.target.value;
  });
  $('yt-text-color').addEventListener('change', async () => { await saveAll(); showToast(t('toast_yt_color_saved', 'YouTube 字幕颜色已保存')); });

  $('toggle-eye').addEventListener('click', () => {
    const input = $('api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // ─── 语音 (TTS) ─────────────────────────────────────────────────────

  $('tts-mode').addEventListener('change', async () => {
    await saveAll();
    await updateTtsUI($('tts-voice').value);
    showToast(t('toast_saved', '已保存'));
  });
  $('tts-engine').addEventListener('change', async () => {
    // 组件的 change 监听在挂载时就注册了，**先于**这一条跑，所以到这里读到的是它的
    // 结果，不能在读之前清零。换引擎清端点这件事 TTS 以前没有，是并进共用组件之后
    // 顺带获得的 —— 把一个引擎的地址留给另一个引擎，正是 notes.js 明文禁止的事。
    const cleared = ttsClearedEndpoint; ttsClearedEndpoint = false;
    // Engine defaults differ, so the model placeholder and voice list must follow
    // the engine BEFORE the user is asked to pick a voice for it.
    await updateTtsUI('');
    await saveAll();
    showToast(cleared ? t('toast_endpoint_cleared', '换引擎了，接口地址已清空') : t('toast_saved', '已保存'));
  });
  for (const id of ['tts-base-url', 'tts-api-key', 'tts-model', 'tts-voice', 'tts-rate']) {
    $(id).addEventListener('change', async () => { await saveAll(); showToast(t('toast_saved', '已保存')); });
  }
  $('tts-autoplay').addEventListener('change', async () => { await saveAll(); });
  // Same late-arrival race as the review page: a voice list built before the
  // platform published its voices would stay empty forever.
  LearnTTS.onVoicesChanged(() => { updateTtsUI($('tts-voice').value); });

  // A test button, because every failure mode here is invisible until you try:
  // a voice the system does not have, a URL that is not serving, a wrong key.
  // ── 引擎自检 ×3（interaction-spec 全局原则：在途禁用 + 具名失败）──────
  // 每个测试都走该功能真正用的传输：翻译走 TranslationAPI.translate，解析走
  // LearnNotes.chat，转写走 LearnSpeech 的 postAudio。自己另写一遍请求，
  // 测出来的「通了」就不代表功能能用。
  // The URL line is the point of this whole surface. With a user-supplied endpoint the
  // most common failure is a wrong ADDRESS, and no error text can say which address we
  // called — a 404 and a CORS rejection read identically to the user. Echoing it turns
  // "it says Load failed" into a screenshot we can act on in one round trip (both of
  // PR #145's bugs arrived as a settings-page screenshot). The key is never in this
  // line — only the URL the transport actually requested.
  //
  // The success branch reads `r.url` for the same reason (an endpoint that answers but
  // is not the one the user meant is invisible otherwise), but no test callback returns
  // it yet: on success the URL lives inside the transport and recomputing it here would
  // be a second copy that drifts. It arrives with the shared endpoint resolver (#147).
  const withUrl = (text, url) => text + (url
    ? '\n' + t('engine_test_url', '请求地址：{url}').replace('{url}', String(url))
    : '');

  // 「这次是从哪儿发出去的」。浏览器扩展有两条通路，它们的跨域待遇完全不同：内容脚本
  // 以**当前网页的身份**发送（会触发 OPTIONS 预检，严格网关会拒），扩展后台则不受
  // 跨域约束、不发预检。两条路失败起来长得一模一样，不说出来就只能靠 DevTools 里
  // 有没有 preflight 行去倒推——而那需要用户会看 Network 面板。
  const withRoute = (text, route) => text + (route
    ? '\n' + t('engine_test_route', '通路：{route}').replace('{route}',
        route === 'proxy' ? t('engine_test_route_proxy', '扩展后台（不受跨域限制，不发预检）')
          : t('engine_test_route_direct', '直连（从页面发出，会先发 OPTIONS 预检）'))
    : '');


  // 发请求之前的离线形状检查。运行时不做这件事：逐字发送是本次改动的承诺，而一个根路径
  // 端点虽然罕见却是合法的。但自检是用户「东西坏了」时会来的地方，把「地址少了路径」从
  // CORS / 不可达里切出来，命中率最高的位置就在这里 —— 那两种失败在 WebKit 里长得一模
  // 一样（2026-08-13 实测），只有离线检查能确定地区分。
  const assertEndpointShape = (url) => EngineTest.assertEndpointShape(url);
  const runTest = (btn, note, fn) => busy($(btn), async () => {
    const el = $(note);
    el.textContent = t('engine_test_running', '测试中…');
    try {
      const r = await fn();
      el.textContent = withRoute(withUrl(
        t('engine_test_ok', '✓ 通了 · {ms}ms').replace('{ms}', String(r.ms))
          + (r.sample ? ' · ' + t('engine_test_sample', '返回：') + r.sample : ''),
        r.url), r.route);
    } catch (e) {
      console.error('[engine-test]', (e && e.url) || '', e);
      el.textContent = withRoute(withUrl('✗ ' + engineTestReason(e), e && e.url), e && e.route);
    }
  });

  $('btn-test-provider').addEventListener('click', runTest('btn-test-provider', 'test-provider-note', async () => {
    await saveAll();
    assertEndpointShape($('api-base-url').value);
    const t0 = Date.now();
    // noCache: 一个可能不发请求的「测试连接」是有害的。缓存键里带了端点与模型之后
    // 同配置重测仍然会命中，而重测的全部意义就是**再打一次**（2026-08-19 实测：改完
    // 地址点测试，1ms 返回「通了」，一个包都没出去）。
    // `diag` 是出参：传输层把**真正请求的地址**和**走了哪条通路**填进来。这两样以前
    // 只有失败时才看得见（错误对象上带着），成功时反而什么都没有——于是「它到底走的
    // 哪条路、打的哪个地址」只能靠版本号和时间戳倒推，2026-08-19 为此来回了三轮。
    const diag = {};
    const out = await TranslationAPI.translate('Hello.', $('target-lang').value || 'zh-CN',
      $('provider').value, $('api-key').value.trim(), $('api-base-url').value.trim(), $('api-model').value.trim(),
      { noCache: true, diag });
    if (!out || !String(out).trim()) { const e = new Error('empty'); e.code = 'bad_output'; throw e; }
    return { ms: Date.now() - t0, sample: String(out).trim().slice(0, 40), url: diag.url, route: diag.route };
  }));

  $('btn-test-notes').addEventListener('click', runTest('btn-test-notes', 'test-notes-note', async () => {
    await saveAll();
    // The notes group may be empty and follow the translation group instead
    // (LearnNotes.resolveConfig owns that rule) — check whichever field is in play.
    assertEndpointShape($('notes-provider').value ? $('notes-base-url').value : $('api-base-url').value);
    return EngineTest.notes(await new Promise((r) =>
      chrome.storage.local.get(SETTINGS_KEYS, (v) => r(v || {}))));
  }));

  $('btn-test-stt').addEventListener('click', runTest('btn-test-stt', 'test-stt-note', async () => {
    await saveAll();
    return EngineTest.stt({
      engineId: $('stt-engine').value, apiKey: $('stt-api-key').value.trim(),
      baseUrl: $('stt-base-url').value.trim(),
      model: $('stt-model').value.trim(),
    });
  }));

  $('btn-tts-test').addEventListener('click', busy($('btn-tts-test'), async () => {
    applyTtsConfig();
    const note = $('tts-cache');
    const sample = t('tts_test_sample', 'This is what your review cards will sound like.');
    note.textContent = t('tts_testing', '正在合成…');
    const r = await LearnTTS.speak(sample, 'en');
    note.textContent = r.ok ? t('tts_test_ok', '播放中') : ttsReason(r.reason);
    if (r.ok) {
      setTimeout(refreshTtsCache, 1500);
      // 播放也算在途 (同 review ▶): the button stays down until the sample ends —
      // bounded, because Chrome's speechSynthesis occasionally swallows `end`
      // (backgrounded tab) and nothing on this page ever calls stop().
      await Promise.race([
        (r.done || Promise.resolve()).catch(() => {}),
        new Promise((res) => setTimeout(res, 15000)),
      ]);
    }
  }));
  $('btn-clear-tts').addEventListener('click', busy($('btn-clear-tts'), async () => {
    try { await LearnStore.clearAudio(); showToast(t('toast_tts_cleared', '语音缓存已清空')); }
    catch (_) { showToast(t('toast_learn_clear_failed', '清空失败')); }
    refreshTtsCache();
  }));

  // ─── 导出 / 导入 ────────────────────────────────────────────────────
  // Same chunk format sync will use, so this is not throwaway plumbing — and it
  // works today, with no account and no server (learning-design §8.2).

  $('btn-export-learn').addEventListener('click', busy($('btn-export-learn'), async () => {
    try {
      const { bytes, header } = await LearnChunk.exportBytes(Date.now());
      if (!header.counts.cards) { showToast(t('toast_export_empty', '还没有可导出的卡片')); return; }
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = LearnChunk.fileName(Date.now());
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(t('toast_exported', '已导出 {n} 张卡片').replace('{n}', String(header.counts.cards)));
    } catch (_) {
      showToast(t('toast_export_failed', '导出失败'));
    }
  }));

  $('btn-import-learn').addEventListener('click', () => $('import-file').click());
  // The visible trigger is 选择文件 (#btn-import-learn), so THAT is what locks
  // during the bulk import — the hidden input can't show a disabled state.
  $('import-file').addEventListener('change', busy($('btn-import-learn'), async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                       // so re-picking the same file re-fires
    if (!file) return;
    try {
      const stats = await LearnChunk.importBytes(new Uint8Array(await file.arrayBuffer()));
      // Merging, never replacing: an import adds to what is here. Re-importing the
      // same file changes nothing (replay is idempotent), which is what makes it
      // safe to just try again if a transfer was interrupted.
      let msg = t('toast_imported', '已导入 {n} 张卡片').replace('{n}', String(stats.cards));
      if (stats.skipped) msg += ' · ' + t('toast_import_skipped', '{n} 行无法解析已跳过').replace('{n}', String(stats.skipped));
      showToast(msg);
    } catch (err) {
      const c = err && err.code;
      showToast(c === 'bad_format' ? t('toast_import_bad_format', '这不是学习库导出文件')
        : c === 'enc_unsupported' ? t('toast_import_upgrade', '这个文件来自更新版本的扩展，升级后才能导入。文件本身没有问题。')
        : t('toast_import_failed', '导入失败'));
    }
    await refreshLearnStats();
    await refreshPressure();
  }));

  // ─── Learning (记忆层) ──────────────────────────────────────────────

  async function refreshLearnStats() {
    const el = $('learn-stats');
    if (!el) return;
    try {
      // Opening this page is also one of the few chances to drain the outbox into
      // the corpus — the content script cannot (wrong origin) and the service
      // worker cannot be trusted to (Safari iOS).
      await LearnDrain.run();
      const st = await LearnStore.stats();
      const due = LearnScheduler.dueCount(await LearnStore.allItems(), Date.now());
      el.textContent = st.total
        ? t('learn_stats', '学习库 {n} 条 · 待复习 {due} · 约 {kb} KB')
            .replace('{n}', String(st.total))
            .replace('{due}', String(due))
            .replace('{kb}', String(Math.max(1, Math.round(st.approxChars / 1024))))
        : t('learn_stats_empty', '学习库为空');
    } catch (_) {
      el.textContent = '';   // silent + total (domain-design §9.1 law 2)
    }
  }

  $('learn-enabled').addEventListener('change', busy($('learn-enabled'), async () => {
    await saveAll();
    // Turning capture OFF stops collecting; it does NOT delete what was already
    // collected. Say so, rather than letting the user assume either way.
    showToast($('learn-enabled').checked
      ? t('toast_learn_on', '已开始采集学习材料')
      : t('toast_learn_off', '已停止采集（已收集的内容保留）'));
    await refreshLearnStats();
  }));
  $('learn-daily-new').addEventListener('change', async () => {
    await saveAll();
    $('learn-daily-new').value = Math.max(1, Math.min(200, Number($('learn-daily-new').value) || LearnScheduler.DEFAULTS.dailyNew));
    showToast(t('toast_saved', '已保存'));
  });
  $('btn-open-review').addEventListener('click', () => {
    window.open(chrome.runtime.getURL('learn/review.html'), '_blank');
  });
  // Storage pressure, stated with numbers. Same live state as the review page —
  // learning-design.md §7.1; never surfaced in a web page (law 2).
  async function refreshPressure() {
    const el = $('learn-pressure');
    const btn = $('btn-clean-known');
    if (!el) return;
    try {
      const p = await LearnStore.pressure();
      if (!p) { el.textContent = ''; btn.hidden = true; return; }
      let msg = '';
      if (p.dropped > 0) {
        msg = t('learn_pressure_dropped', '有 {n} 条采集内容没能存下来（学习库满时会发生）。')
          .replace('{n}', String(p.dropped));
      } else if (p.evicted > 0) {
        msg = t('learn_pressure_evicted', '学习库已满，已自动淘汰 {n} 张旧卡为新内容腾地方。')
          .replace('{n}', String(p.evicted));
      } else if (p.atCap || p.nearCap) {
        msg = t('learn_pressure_near', '学习库快满了（{n} / {cap}）。')
          .replace('{n}', String(p.total)).replace('{cap}', String(p.cap));
      }
      // §7.5 — 备份失败不是丢失（语料还活着），但对开了学习的用户不许静默。
      try {
        const bm = await LearnBackup.meta();
        if (bm && bm.lastError) {
          msg += (msg ? ' ' : '') + t('learn_backup_failed', '本地备份未能写入（{why}）。学习库本身不受影响。')
            .replace('{why}', String(bm.lastError));
        }
      } catch (_) {}
      el.textContent = msg;
      // Offering a cleanup that would free nothing is worse than offering none.
      btn.hidden = p.reclaimable === 0;
      if (!btn.hidden) {
        btn.textContent = t('learn_clean_known_n', '清理已掌握的 {n} 张卡')
          .replace('{n}', String(p.reclaimable));
      }
    } catch (_) { el.textContent = ''; btn.hidden = true; }
  }

  // §4.2: heal pre-rule long cards. Explicit, visible, propagates like a delete.
  // Two phases behind the one consented press: the free structural pass, then —
  // when a chat engine is configured — the §4.2c LLM adjudication of what the
  // structural pass refused (rides the user's own key, mechanically verified).
  $('btn-split-long').addEventListener('click', busy($('btn-split-long'), async () => {
    const r = await LearnStore.splitLongItems().catch(() => null);
    if (!r) { showToast(t('learn_split_failed', '拆分失败')); await refreshLearnStats(); await refreshPressure(); return; }
    let llm = null;
    let rt = null;
    if (r.skipped) {
      try {
        LearnNotes.configure(LearnNotes.resolveConfig(await new Promise((res) =>
          chrome.storage.local.get(SETTINGS_KEYS, (v) => res(v || {})))));
        if (LearnNotes.capable()) llm = await LearnAlign.healUnalignable();
      } catch (_) { llm = null; }
      // §4.2d last resort: re-translate per source sentence — aligned by
      // construction, and the only rescue for a truncated stored translation.
      try {
        rt = await LearnAlign.healByRetranslate((s, target) =>
          TranslationAPI.translate(s, target || $('target-lang').value || 'zh-CN',
            $('provider').value, $('api-key').value.trim(),
            $('api-base-url').value.trim(), $('api-model').value.trim()));
      } catch (_) { rt = null; }
    }
    const healed = (llm ? llm.split : 0) + (rt ? rt.split : 0);
    const parents = r.parents + healed;
    const children = r.children + (llm ? llm.children : 0) + (rt ? rt.children : 0);
    const skipped = Math.max(0, r.skipped - healed);
    if (!parents && !skipped) { showToast(t('learn_split_none', '没有可拆分的长段卡')); }
    else {
      let msg = t('learn_split_done', '已把 {p} 张长段卡拆成 {c} 张句子卡')
        .replace('{p}', String(parents)).replace('{c}', String(children));
      if (skipped) msg += t('learn_split_skipped', '（{k} 张译文对不齐，保持原样）')
        .replace('{k}', String(skipped));
      showToast(msg, 4000);
    }
    await refreshLearnStats();
    await refreshPressure();
  }));

  $('btn-clean-known').addEventListener('click', busy($('btn-clean-known'), async () => {
    const n = await LearnStore.clearKnown().catch(() => -1);
    if (n < 0) { showToast(t('toast_learn_clear_failed', '清空失败')); }
    else {
      showToast(t('toast_learn_cleaned', '已清理 {n} 张已掌握的卡').replace('{n}', String(n)));
    }
    await refreshLearnStats();
    await refreshPressure();
  }));

  $('btn-clear-learn').addEventListener('click', busy($('btn-clear-learn'), async () => {
    if (!window.confirm(t('learn_clear_confirm', '清空学习库？所有已采集的句子与复习进度都会被删除，且无法恢复。'))) return;
    try {
      await LearnStore.clearAll();
      // §7.5 清空守卫：用户要的清空不许下次打开由备份还魂。
      await LearnBackup.clear();
      showToast(t('toast_learn_cleared', '学习库已清空'));
    } catch (_) {
      showToast(t('toast_learn_clear_failed', '清空失败'));
    }
    await refreshLearnStats();
    await refreshPressure();
  }));
  // §7.5 — 空库先从本地备份恢复，再画首屏统计（restore 与 drain 都幂等，但
  // 恢复在前才能让首屏直接看到完整语料）；随后打一次节流内的快照。
  await LearnBackup.restoreIfEmpty();
  LearnBackup.maybeRun();
  refreshLearnStats();
  refreshPressure();

  // ─── 来源治理 (interaction-spec 「来源治理」) ─────────────────────────
  // learnRules is NOT part of saveAll(): it is a single JSON key written whole,
  // stamped with updatedAt so the `g` row's LWW (§8.9) has something to compare.

  let learnRules = s.learnRules || null;

  async function writeRules(mutate) {
    // 成形只有一处（LearnRules.withUpdate）—— 这段逻辑曾经被抄了四份，第四份漏了
    // updatedAt，于是那台设备的规则永远输给远端、也永远推不上去，全程零报错。
    const base = learnRules;
    learnRules = LearnRules.withUpdate(base, mutate(base || { v: 1, block: [], langs: null }));
    await new Promise((r) => chrome.storage.local.set({ learnRules }, r));
    renderGovernance();
    // A deliberate rules edit deserves a prompt push (rides the next chunk, §8.9).
    // Signed out / disabled resolves to null — nothing to catch loudly.
    if (typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) {
      LearnSync.autoSync(Date.now(), { force: true }).then((r) => {
        if (r) refreshSyncAfterGovernance();
      }).catch(() => {});
    }
  }

  function refreshSyncAfterGovernance() {
    refreshLearnStats();
    refreshPressure();
  }

  function renderLangChipsUI() {
    const box = $('learn-langs');
    if (!box) return;
    SourcesView.renderLangChips(box, {
      registry: window.MT_LANGS || [],
      langs: learnRules && learnRules.langs,
      t,
      // MUST return the promise: SourcesView's lock() holds the chip disabled
      // until this settles. Dropping it re-enables mid-write and reopens the
      // stale-closure lost-update race (two quick taps, first language lost).
      onChange: (langs) => writeRules(() => ({ langs }))
        .then(() => showToast(t('toast_saved', '已保存'))),
    });
  }

  async function renderSourcesManager() {
    const box = $('sources-manager');
    if (!box || box.hidden) return;
    let items = [], sources = [];
    try {
      [items, sources] = await Promise.all([LearnStore.allItems(), LearnStore.allSources()]);
    } catch (_) {}
    SourcesView.render(box, {
      items, sources, rules: learnRules, t,
      onDelete: async ({ host, itemIds, sourceIds }) => {
        if (!itemIds.length) { showToast(t('learn_delete_none', '这个来源已没有可删的卡')); return; }
        if (!window.confirm(t('learn_delete_confirm', '删除 {host} 的 {n} 张卡？会同步到所有设备，不可恢复。')
          .replace('{host}', host).replace('{n}', String(itemIds.length)))) return;
        try {
          const n = await LearnStore.deleteItems(itemIds, Date.now());
          await LearnStore.deleteSourcesIfOrphan(sourceIds);
          showToast(t('learn_delete_done', '已删除 {n} 张卡').replace('{n}', String(n)));
        } catch (_) { showToast(t('toast_learn_clear_failed', '清空失败')); }
        renderSourcesManager();
        refreshLearnStats();
        refreshPressure();
        // The delete must reach the server promptly — it is account intent (§7.4).
        if (typeof MT_BACKEND !== 'undefined' && MT_BACKEND.enabled) {
          LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
        }
      },
      onBlock: (p) => writeRules((r) => ({
        block: (r.block || []).indexOf(p) >= 0 ? r.block : (r.block || []).concat([p]),
      })),
      onUnblock: (p) => writeRules((r) => ({ block: (r.block || []).filter((x) => x !== p) })),
      onAddRule: (p) => writeRules((r) => ({
        block: (r.block || []).indexOf(p) >= 0 ? r.block : (r.block || []).concat([p]),
      })),
      onInvalidRule: () => showToast(t('learn_block_invalid', '规则格式不对')),
    });
  }

  function renderGovernance() {
    renderLangChipsUI();
    renderSourcesManager();
  }

  $('btn-manage-sources').addEventListener('click', busy($('btn-manage-sources'), async () => {
    const box = $('sources-manager');
    box.hidden = !box.hidden;
    await renderSourcesManager();
  }));
  renderLangChipsUI();

  // A rules change from elsewhere (a sync pull's `g` row, the popup's 本站
  // toggle, the app) repaints this page while it is open.
  try {
    chrome.storage.onChanged.addListener((changes) => {
      if ('learnRules' in changes) {
        learnRules = changes.learnRules.newValue || null;
        renderGovernance();
      }
    });
  } catch (_) {}

  // ─── Sync (可选) ────────────────────────────────────────────────────
  // learning-design.md §8. Signed out is the DEFAULT, not a degraded mode, so
  // nothing in this block may make the rest of the page depend on it.

  // Sync ships disabled (see backend.config.js). Remove the section rather than
  // hide it: a disabled-but-present control is something users try, and something
  // the next person assumes is live.
  if (!MT_BACKEND.enabled) {
    const sec = $('sync-section');
    if (sec) sec.remove();
  }

  function syncSay(msg) { const el = $('sync-status'); if (el) el.textContent = msg || ''; }

  // Every failure here gets its own sentence. "同步失败" tells a user nothing about
  // whether to wait, retry, sign in again, or delete something — and this is a
  // surface they deliberately turned on, so §9.1 law 2 requires it be told.
  function syncError(e) {
    const code = (e && e.code) || '';
    if (code === 'offline') return t('sync_err_offline', '连不上服务器，稍后会自动重试。已学的内容都在本机。');
    if (code === 'quota') return t('sync_err_quota', '云端空间已满，新内容暂时不再上传（本机不受影响）。清理已掌握的卡可以腾出空间。');
    if (code === 'signed_out') return t('sync_err_signed_out', '登录已失效，请重新登录。');
    if (code === 'enc_unsupported') return t('sync_err_upgrade', '云端有这个版本还读不了的内容（可能来自更新版本的扩展）。请升级扩展后再同步——那些内容没有丢，只是暂时读不了。');
    if (code === 'rate_limited') return t('sync_err_rate', '验证码发得太频繁了，等几分钟再试。');
    // 归属闸的两个 code（sync.js 的 ownerGate）。少了这两行，它们会以英文 code 原文
    // 落到用户眼前 —— 下面那个 e.message 是兜底，不是文案。
    if (code === 'owner_mismatch') return t('sync_err_owner_mismatch', '这台设备上的学习库属于另一个账号。用原来那个邮箱登录，或先清除本机全部数据再重来。');
    if (code === 'owner_unknown') return t('sync_err_owner_unknown', '这台设备上的学习库有归属，但现在没有登录。登录之后才能继续同步。');
    return (e && e.message) || t('sync_err_generic', '同步没能完成');
  }

  // Adaptive unit. A fixed "MB" reads 0.0 for everything under ~50 KB, which is
  // where a real corpus lives for a long time against a 50 MB quota — so the number
  // meant to show usage growing showed nothing growing, right up until it mattered.
  const fmtSize = (n) => (n < 1024 * 1024
    ? Math.round(n / 1024) + ' KB'
    : (n / 1024 / 1024).toFixed(1) + ' MB');

  async function refreshSyncUI() {
    const s = await LearnAuth.current().catch(() => null);
    // Re-bind on every refresh: this runs at page load AND after every sign-in /
    // sign-out, which is exactly the set of moments the answer can change.
    try { await LearnAuth.bindCorpus(s); } catch (_) {}
    $('sync-out').hidden = !!s;
    $('sync-in').hidden = !s;
    if (!s) {
      $('sync-usage').textContent = '';
      // Storage-read failure ≠ signed out (§8.4.1). The sign-in form still
      // shows (a real re-login always works), but the status line must name
      // the failure instead of implying the session is gone.
      if (LearnAuth.lastLoadError()) {
        syncSay(t('sync_status_storage_error', '读不到登录状态（存储读取失败），稍后自动重试 —— 这不代表已退出登录。'));
      }
      return;
    }
    $('sync-who').textContent = t('sync_signed_in', '已登录：{email}').replace('{email}', s.email || '');
    try {
      const u = await LearnSync.usage();
      $('sync-usage').textContent = t('sync_usage', '云端已用 {used} / {quota} · {n} 个数据块')
        .replace('{used}', fmtSize(u.bytes)).replace('{quota}', fmtSize(u.quota))
        .replace('{n}', String(u.chunks));
    } catch (_) { $('sync-usage').textContent = ''; }

    // 下一步。**带上刚登录的这个邮箱** —— 「用同一个账号」这句话不带具体值时，
    // 用户没有可对照的东西；带上之后他在 App 里输入的那一刻就能比对。
    const next = $('sync-next');
    if (next) {
      $('sync-next-app').textContent = t('sync_next_app',
        '接下来：在 iPhone / Mac 的 App 里用同一个邮箱（{email}）登录，这些卡才会出现在那边。')
        .replace('{email}', s.email || '');
      next.hidden = false;
    }
  }

  if (MT_BACKEND.enabled) {
  // busy() on both auth buttons: the OTP endpoint is server-rate-limited, so a
  // repeat tap here burns the user's OWN limit (sync_err_rate exists because of it).
  $('btn-sync-code').addEventListener('click', busy($('btn-sync-code'), async () => {
    const email = $('sync-email').value.trim();
    if (!email) { syncSay(t('sync_need_email', '先填邮箱')); return; }
    syncSay(t('sync_sending', '发送中…'));
    try {
      await LearnAuth.signIn(email);
      $('sync-code-row').hidden = false;
      $('sync-code').focus();
      syncSay(t('sync_code_sent', '验证码已发到 {email}，填在下面。').replace('{email}', email));
    } catch (e) { syncSay(syncError(e)); }
  }));

  $('btn-sync-verify').addEventListener('click', busy($('btn-sync-verify'), async () => {
    syncSay(t('sync_verifying', '验证中…'));
    try {
      await LearnAuth.verify($('sync-email').value.trim(), $('sync-code').value.trim());
      $('sync-code').value = '';
      $('sync-code-row').hidden = true;
      await refreshSyncUI();
      syncSay(t('sync_signed_in_now', '已登录。第一次同步可能要几秒。'));
      await runSync();
    } catch (e) {
      syncSay(e && e.status === 403 || e && e.status === 401
        ? t('sync_bad_code', '验证码不对或已过期，重新发一个。')
        : syncError(e));
    }
  }));

  async function runSync() {
    // interaction-spec 全局原则「IO 在途，控件不可用」——手动同步按钮全程禁用。
    $('btn-sync-now').disabled = true;
    syncSay(t('sync_running', '同步中…'));
    try {
      const r = await LearnSync.sync(Date.now());
      // "Needs upgrade" is not a failure and must not be worded as one: nothing was
      // lost, nothing is corrupt, and the fix is not something to debug.
      if (r.pulled.needsUpgrade) syncSay(t('sync_err_upgrade', '云端有这个版本还读不了的内容（可能来自更新版本的扩展）。请升级扩展后再同步——那些内容没有丢，只是暂时读不了。'));
      else syncSay(t('sync_done', '同步完成 · 收到 {in} 张 · 上传 {out} 张')
        .replace('{in}', String(r.pulled.cards)).replace('{out}', String((r.pushed && r.pushed.pushed) || 0)));
      await Promise.all([refreshLearnStats(), refreshPressure(), refreshSyncUI()]);
    } catch (e) { syncSay(syncError(e)); }
    finally { $('btn-sync-now').disabled = false; }
  }
  $('btn-sync-now').addEventListener('click', runSync);

  $('btn-sync-out').addEventListener('click', busy($('btn-sync-out'), async () => {
    await LearnAuth.signOut();
    // The corpus stays. Signing out is not a reason to lose what you learned, and a
    // user who expects otherwise is better surprised in this direction.
    await LearnSync.forget();
    await refreshSyncUI();
    syncSay(t('sync_signed_out', '已退出登录。本机的学习库原样保留。'));
  }));

  // busy() here is load-bearing: a double-click used to issue TWO account
  // deletions against an irreversible endpoint.
  $('btn-sync-delete').addEventListener('click', busy($('btn-sync-delete'), async () => {
    if (!window.confirm(t('sync_delete_confirm', '删除云端数据与账号？服务器上的所有内容与这个账号都会被删除，无法恢复。本机的学习库会保留。'))) return;
    syncSay(t('sync_deleting', '删除中…'));
    try {
      const r = await LearnAuth.deleteAccount();
      await LearnSync.forget();
      await refreshSyncUI();
      // A half-done deletion is reported as half-done. Saying "已删除" when the
      // account survived would be a claim the user cannot verify.
      syncSay(r.account
        ? t('sync_deleted', '云端数据与账号都已删除。本机的学习库保留。')
        : t('sync_deleted_partial', '云端数据已删除，但账号没能删掉（{why}）。可以重试或联系我们。')
            .replace('{why}', String(r.reason || '')));
    } catch (e) { syncSay(syncError(e)); }
  }));

  refreshSyncUI();
  // §8.8 — opening this page is the heartbeat (throttled + silent inside autoSync;
  // signed-out resolves to null). Only a run that actually happened repaints, so the
  // quiet path stays quiet.
  LearnSync.autoSync().then((r) => {
    if (r) return Promise.all([refreshLearnStats(), refreshPressure(), refreshSyncUI()]);
  }).catch(() => {});

  }   // end if (MT_BACKEND.enabled)

  $('btn-clear-cache').addEventListener('click', busy($('btn-clear-cache'), async () => {
    const status = $('cache-status');
    status.textContent = t('toast_clearing', '清除中…');
    await new Promise((done) => {
      chrome.storage.local.get(null, (items) => {
        const keys = Object.keys(items || {}).filter(k => k.startsWith('tr:'));
        if (keys.length === 0) {
          status.textContent = t('toast_cache_empty', '缓存为空');
          done();
          return;
        }
        chrome.storage.local.remove(keys, () => {
          status.textContent = t('toast_cache_cleared', '缓存已清除') + ` (${keys.length})`;
          showToast(t('toast_cache_cleared', '缓存已清除'));
          done();
        });
      });
    });
  }));

  // ── 一把 key 配好全部（QuickSetup）──────────────────────────────────
  //
  // 组件只返回 patch。这里**先把值回填进控件、跑各自的 update*UI、再 saveAll()** ——
  // 反过来做（组件自己写存储）的话，用户下一次改任何一个字段，saveAll 就会用旧 DOM
  // 把刚配好的三组全部覆盖回去。静默，且必然。
  //
  // 副作用是个礼物：ttsMode 已经是 'assist'，updateTtsUI 会把 #tts-config 当场展开 ——
  // 用户看到语音卡长出来，就是「它真的动了」的物理证据。
  async function applyQuickSetup(plan) {
    const w = plan.writes;
    const put = (key, id) => { if (key in w && $(id)) $(id).value = w[key]; };
    put('provider', 'provider'); put('apiKey', 'api-key');
    put('apiBaseUrl', 'api-base-url'); put('apiModel', 'api-model');
    put('ttsMode', 'tts-mode'); put('ttsBaseUrl', 'tts-base-url');
    put('ttsApiKey', 'tts-api-key'); put('ttsModel', 'tts-model');
    put('sttBaseUrl', 'stt-base-url'); put('sttApiKey', 'stt-api-key'); put('sttModel', 'stt-model');
    if ('ttsAutoPlay' in w && $('tts-autoplay')) $('tts-autoplay').checked = w.ttsAutoPlay;

    if ('provider' in w) {
      updateProviderUI(w.provider);
      if ($('adv-custom')) { $('adv-custom').value = customParams[w.provider] || ''; }
      updateCustomNote(); updateAdvancedNotes();
    }
    if ('ttsEngine' in w) { $('tts-engine').value = w.ttsEngine; await updateTtsUI(w.ttsVoice || ''); }
    if ('sttEngine' in w) { $('stt-engine').value = w.sttEngine; updateSttUI(w.sttEngine); }
    await saveAll();                       // 现在 DOM 就是真相，覆盖是安全的
  }

  // ── 快速 / 详细 ──────────────────────────────────────────────────────
  //
  // **只切 hidden，永不 remove()。** 理由写在 saveAll() 上方那段注释里：那个函数
  // 按字面量读 28 个控件、零 null 保护，从 DOM 里拿掉一张卡会让每次保存静默失败。
  //
  // 模式**单独存**（optDetailMode），不进 SETTINGS_KEYS —— 它是 UI 状态不是配置，
  // 混进去等于让 saveAll 的整体覆盖去管一个跟配置无关的东西（learnRules /
  // reqCustomParams 也是同样的理由单独存的）。
  const DETAIL_KEY = 'optDetailMode';
  // 这个 flavor 有没有可一键的平台。没有它，空 flavor 那条路藏掉卡片之后，用户点一下
  // 「快速」就会把一个空壳放出来。
  let _quickAvailable = true;
  function applyDetailMode(on) {
    for (const el of document.querySelectorAll('.adv-only')) el.hidden = !on;
    // .quick-only 是 .adv-only 的补集：一键配置卡与逐引擎配置**永不同屏**。
    // 共存时用户在「详细」里改了引擎，一键卡显示的「已配过/没配过」当场变成谎话，
    // 而它下一次被按下就会照着那份谎话覆盖存储。裁定见 docs/interaction-spec.md。
    for (const el of document.querySelectorAll('.quick-only')) el.hidden = on || !_quickAvailable;
    const q = $('mode-quick'); const d = $('mode-detail');
    if (q) q.setAttribute('aria-selected', String(!on));
    if (d) d.setAttribute('aria-selected', String(!!on));
  }
  const setDetail = (on) => {
    applyDetailMode(on);
    try { chrome.storage.local.set({ [DETAIL_KEY]: !!on }); } catch (_) {}
  };
  if ($('mode-quick')) $('mode-quick').addEventListener('click', () => setDetail(false));
  if ($('mode-detail')) $('mode-detail').addEventListener('click', () => setDetail(true));

  // 这份已存的配置，一键卡表示得了吗（null = 表示不了 / 还没配过）。
  _engineChosen = !!s0.engineChosen;
  const _quickShows = (typeof QuickSetup !== 'undefined') ? QuickSetup.represents(s0) : null;

  // 默认「快速」，除非用户上次切到过详细。
  let _detail = false;
  try {
    const r = await new Promise((res) => chrome.storage.local.get([DETAIL_KEY], (v) => res(v || {})));
    _detail = r[DETAIL_KEY] === true;
  } catch (_) {}

  if ($('quick-setup')) {
    QuickSetup.render($('quick-setup'), {
      t,
      // 现读而不是快照：s0 是页面加载时读的，之后永不更新。详见 quick-setup.js 里
      // 那段注释 —— 拿旧快照判「配没配过」会覆盖用户刚在「详细」里输入的 key。
      readSettings: () => PageSettings.read(SETTINGS_KEYS),
      // 配过的回显出来。一个空输入框在已经配好的页面上是假话：它看起来像「你还没配」，
      // 而此刻唯一能做的动作（粘一把新 key）会覆盖掉现有配置。
      prefill: _quickShows ? { host: _quickShows.host, key: s0.apiKey } : null,
      // 「现在翻一页看看」按目标语言选示例页。传 s0 的快照够用：改目标语言会重画这一页。
      targetLang: s0.targetLang,
      // 读不到已存设置时不许配：往一份读不出来的档案上盖三组配置，正是
      // settings_read_failed 那句警告存在的理由。
      disabled: _settingsReadFailed,
      onApply: applyQuickSetup,
      // 设置页配完就没有下一步了。引导页不传 —— 它自己有「现在翻一页看看」那一屏。
      showTry: true,
    });
    if (!$('quick-setup').children.length && $('quick-setup-card')) {
      // 这个 flavor 没有可一键的平台。不留空壳，也不给一个其中一边可证为空的二选一 ——
      // 那比没有这个选择更糟。_quickAvailable 让 applyDetailMode 之后也一直藏着它。
      _quickAvailable = false;
      _detail = true;
      if ($('mode-tabs')) $('mode-tabs').hidden = true;
    }
  }
  // 读不到已存设置时一键配置是 disabled 的，同样没有可做的事 —— 也强制展开，
  // 否则用户面对的是一张什么都点不了的页面。
  if (_settingsReadFailed) _detail = true;
  // 已经配过、但一键卡表示不了这份配置（比如用 DeepSeek 配的，它不在任何一键平台里，
  // 或者是从引导页的「三引擎分别配」配好的）—— 快速视图里**没有一个控件能显示他的
  // 配置**，把他丢在那一页等于让他对着一张空卡猜自己配没配过。
  // 这一条不写进 optDetailMode：它是「这份数据长什么样」的推论，不是用户的偏好。
  if (!_quickShows && String(s0.apiKey || '').trim()) _detail = true;
  applyDetailMode(_detail);

  // ── #sync 锚点 ──────────────────────────────────────────────────────────
  //
  // 别处（引导页的「打开设置去登录」、官网试翻页的下一步块）把人往登录送时，落点
  // 必须是**看得见的登录框**，而不是页面顶部 —— 送到顶部等于让人在一整页设置里
  // 自己找，那正是这条路原来断掉的方式。
  //
  // 位置要紧：必须排在 applyDetailMode() **之后**。那一步会增删 .adv-only /
  // .quick-only 的卡片，滚完再改布局，落点就偏了。
  // 也不能靠浏览器的原生锚点跳转 —— 那发生在这一页 paint 之前。
  // 再等一帧，让 applyDetailMode 引起的重排真正落定。
  if (location.hash === '#sync') {
    const jump = () => {
      const sec = $('sync-section');
      if (!sec || sec.hidden) return;      // 同步没编进这个构建 ⇒ 整节已被 remove
      try { sec.scrollIntoView({ block: 'start' }); } catch (_) { sec.scrollIntoView(); }
      const email = $('sync-email');
      const out = $('sync-out');
      // 已登录时没有邮箱框可聚焦（那一支显示的是 #sync-in）。
      if (email && out && !out.hidden) { try { email.focus({ preventScroll: true }); } catch (_) { email.focus(); } }
    };
    try { requestAnimationFrame(() => requestAnimationFrame(jump)); } catch (_) { jump(); }
  }
}

// A bare `init()` turns any throw inside it into a silent unhandled rejection, which
// is exactly how the failure above stayed invisible: the page looked rendered and was
// simply dead. Surface it instead — on a surface the user opened deliberately, a
// broken settings page must not be quiet (domain-design §9.1 law 2).
init().catch((e) => {
  try {
    console.error('[options] init failed:', e);
    const el = document.getElementById('setup-note');
    if (el) {
      // {err} carries the actual failure. The first version built the detail into
      // the FALLBACK string — dead the moment the key resolves, so localized users
      // got a generic sentence and the one clue worth reporting was dropped.
      el.textContent = t('options_init_failed', '设置页没能加载完（{err}）。请重新打开这个页面；若仍然如此，请把这条信息反馈给我们。')
        .replace('{err}', String((e && e.message) || e));
      el.classList.add('warn');
      el.style.display = 'block';
    }
  } catch (_) {}
});
