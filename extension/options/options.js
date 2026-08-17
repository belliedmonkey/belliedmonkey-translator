// options.js

// Provider list is the build-time registry (window.MT_PROVIDERS, generated per
// flavor from build/providers.config.js). No hardcoded provider list here.
const PROVIDERS = (window.MT_PROVIDERS || []);
const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;
const defaultProviderId = () => (PROVIDERS[0] && PROVIDERS[0].id) || 'google';

const $ = id => document.getElementById(id);

const SETTINGS_KEYS = [
  'enabled', 'targetLang', 'uiLang', 'provider', 'apiKey', 'apiBaseUrl', 'apiModel',
  'textColor', 'ytTextColor', 'fontSize', 'showFab',
  'learnEnabled', 'learnDailyNew', 'learnRules',
  'ttsMode', 'ttsAutoPlay', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
  // §9.2 (2026-08-09 二): dedicated notes engine — empty notesProvider = follow
  // the translation engine's whole group (LearnNotes.resolveConfig owns the rule).
  'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
  // §9.4: transcription engine for the 说 exercise — never follows any group.
  'sttEngine', 'sttBaseUrl', 'sttApiKey', 'sttModel',
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
function providerLabel(p) { return p.labelKey ? t(p.labelKey, p.label || p.id) : (p.label || p.id); }
function populateProviders() {
  const sel = $('provider');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const p of PROVIDERS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = providerLabel(p);
    sel.appendChild(opt);
  }
  if (prev && providerById(prev)) sel.value = prev;
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
  const p = providerById(provider) || {};
  const needsKey = !!p.needsKey;
  const hasKey = !!(apiKey || '').trim();
  if (needsKey && !hasKey) {
    el.textContent = t('setup_need_key', '这个引擎需要 API Key。填入下面的 Key 之后翻译才会工作。');
    el.classList.add('warn');
    el.style.display = 'block';
  } else if (!needsKey) {
    el.textContent = t('setup_free_channel', '当前使用免费通道，不需要 API Key —— 适合先看看效果。它的响应不稳定，偶尔会把原文原样返回；换成任一 LLM 引擎并填入你自己的 Key，会稳定得多，质量也更好。');
    el.classList.remove('warn');
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function updateProviderUI(provider) {
  const p = providerById(provider) || {};
  $('apikey-fields').style.display = p.needsKey ? 'block' : 'none';
  $('baseurl-field').style.display = p.supportsBaseUrl ? 'block' : 'none';
  $('model-field').style.display = p.supportsModel ? 'block' : 'none';
  $('api-base-url').placeholder = p.defaultBase || 'https://…';
  $('api-model').placeholder = p.defaultModel || '';
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
function ttsEngineLabel(e) { return e.labelKey ? t(e.labelKey, e.label || e.id) : (e.label || e.id); }

function populateTtsEngines(selected) {
  const sel = $('tts-engine');
  sel.innerHTML = '';
  for (const e of TTS_ENGINES) {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = ttsEngineLabel(e);
    sel.appendChild(o);
  }
  sel.value = ttsEngineById(selected) ? selected : (TTS_ENGINES[0] && TTS_ENGINES[0].id) || 'browser';
}

// 引擎自检的失败具名。三个引擎共用一张表：用户看到的应该是「哪里不对、
// 怎么改」，而不是一句「测试失败」。code 由各模块抛出（transport 层已具名）。
function engineTestReason(e) {
  const code = (e && e.code) || '';
  switch (code) {
    case 'no_base': return t('engine_test_no_base', '还没填端点地址');
    case 'no_key': return t('engine_test_no_key', '还没填 API Key');
    case 'no_engine': return t('engine_test_no_engine', '还没选引擎');
    case 'network': return t('stt_network', '连不上端点——检查地址是否可达；自建服务还需允许跨域访问（CORS）');
    case 'timeout': return t('engine_test_timeout', '端点没有在超时前回应');
    case 'empty_output': return t('notes_test_empty', '模型没有返回正文——思考（推理）型模型不适合，请换对话模型');
    case 'bad_output': return t('engine_test_bad_output', '端点通了，但返回的内容无法解析');
    case 'http': return t('engine_test_http', 'HTTP {n} —— {hint}')
      .replace('{n}', String(e.status || '?'))
      .replace('{hint}', e.status === 401 || e.status === 403
        ? t('engine_test_hint_key', 'key 不对或没有权限')
        : e.status === 404 ? t('engine_test_hint_404', '地址或模型名不对')
        : t('engine_test_hint_other', '服务端拒绝了这次请求'));
    default: return (e && e.message) || t('engine_test_failed', '没通');
  }
}

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
  $('tts-baseurl-field').style.display = e.supportsBaseUrl ? 'block' : 'none';
  $('tts-key-field').style.display = e.needsKey ? 'block' : 'none';
  $('tts-model-field').style.display = e.supportsModel ? 'block' : 'none';
  $('tts-model').placeholder = e.defaultModel || '';

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

async function saveAll() {
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

  populateProviders();
  // A stored provider from another flavor may not exist in this build → fall
  // back to the first registry provider available here.
  const prov = providerById(s.provider) ? s.provider : defaultProviderId();
  $('provider').value       = prov;
  $('api-key').value        = s.apiKey      || '';
  $('api-base-url').value   = s.apiBaseUrl  || '';
  $('api-model').value      = s.apiModel    || '';
  $('target-lang').value    = s.targetLang  || 'zh-CN';
  $('ui-lang').value        = s.uiLang      || 'auto';
  $('text-color').value     = s.textColor   || window.MT_PALETTE.textColor;
  $('yt-text-color').value  = s.ytTextColor || window.MT_PALETTE.ytTextColor;
  $('font-size').value      = scaleValue(s.fontSize);
  $('show-fab').checked     = s.showFab !== false;
  // Capture is OFF until the user turns it on once — never default-on on upgrade.
  $('learn-enabled').checked = s.learnEnabled === true;
  $('learn-daily-new').value = Number(s.learnDailyNew) > 0 ? Number(s.learnDailyNew) : LearnScheduler.DEFAULTS.dailyNew;
  $('tts-mode').value      = s.ttsMode || 'off';
  $('tts-autoplay').checked = s.ttsAutoPlay !== false;
  $('tts-base-url').value  = s.ttsBaseUrl || '';
  $('tts-api-key').value   = s.ttsApiKey || '';
  $('tts-model').value     = s.ttsModel || '';
  $('tts-rate').value      = String(Number(s.ttsRate) > 0 ? Number(s.ttsRate) : 1);
  populateTtsEngines(s.ttsEngine || LearnTTS.DEFAULTS.engineId);
  await updateTtsUI(s.ttsVoice || '');

  // §9.2 (2026-08-09 二) — dedicated notes engine. Option "" = follow the
  // translation engine (the default, and the pre-feature behaviour); the
  // candidate list is the registry filtered by LearnNotes' own type rule, so
  // "what counts as a chat engine" cannot drift between the gate and this picker.
  function populateNotesEngines(selected) {
    const sel = $('notes-provider');
    sel.innerHTML = '';
    const follow = document.createElement('option');
    follow.value = '';
    follow.textContent = t('notes_follow', '跟随翻译引擎（默认）');
    sel.appendChild(follow);
    for (const p of LearnNotes.chatEngines()) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = providerLabel(p);
      sel.appendChild(o);
    }
    sel.value = LearnNotes.chatEngines().some((p) => p.id === selected) ? selected : '';
  }
  function updateNotesUI(id) {
    const p = (window.MT_PROVIDERS || []).find((x) => x.id === id) || null;
    $('notes-config').hidden = !p;
    if (!p) return;
    $('notes-key-field').hidden = !p.needsKey;
    $('notes-baseurl-field').hidden = !p.supportsBaseUrl;
    $('notes-model-field').hidden = !p.supportsModel;
  }
  populateNotesEngines(s.notesProvider || '');
  $('notes-api-key').value  = s.notesApiKey || '';
  $('notes-base-url').value = s.notesBaseUrl || '';
  $('notes-model').value    = s.notesModel || '';
  updateNotesUI($('notes-provider').value);

  // §9.4 — transcription engine for the 说 exercise. Option "" = not configured =
  // the speak form does not exist (the correct default; there is no zero-config
  // transcription engine and never will be — §12). Candidates come from the
  // generated registry; nothing engine-specific is restated here.
  function populateSttEngines(selected) {
    const sel = $('stt-engine');
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('stt_engine_none', '未配置（不出「说」题）');
    sel.appendChild(none);
    for (const e of (window.MT_STT_ENGINES || [])) {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.labelKey ? t(e.labelKey, e.label || e.id) : (e.label || e.id);
      sel.appendChild(o);
    }
    sel.value = (window.MT_STT_ENGINES || []).some((e) => e.id === selected) ? selected : '';
  }
  function updateSttUI(id) {
    const e = (window.MT_STT_ENGINES || []).find((x) => x.id === id) || null;
    $('stt-config').hidden = !e;
    if (!e) return;
    $('stt-key-field').hidden = !e.needsKey;
    $('stt-baseurl-field').hidden = !e.supportsBaseUrl;
    $('stt-model-field').hidden = !e.supportsModel;
    $('stt-base-url').placeholder = e.defaultBase || 'https://…';
    $('stt-model').placeholder = e.defaultModel || '';
  }
  populateSttEngines(s.sttEngine || '');
  $('stt-api-key').value  = s.sttApiKey || '';
  $('stt-base-url').value = s.sttBaseUrl || '';
  $('stt-model').value    = s.sttModel || '';
  updateSttUI($('stt-engine').value);

  updateProviderUI(prov);
  updateColorPreview(s.textColor || window.MT_PALETTE.textColor);
  $('yt-color-preview').style.color = s.ytTextColor || window.MT_PALETTE.ytTextColor;
  if (prov !== s.provider) await saveAll(); // migrate an out-of-flavor provider

  // ─── Listeners ──────────────────────────────────────────────────────

  $('notes-provider').addEventListener('change', async (e) => {
    updateNotesUI(e.target.value);
    await saveAll();
    showToast(t('toast_saved', '已保存'));
  });
  for (const id of ['notes-api-key', 'notes-base-url', 'notes-model']) {
    $(id).addEventListener('change', async () => { await saveAll(); });
  }

  $('stt-engine').addEventListener('change', async (e) => {
    updateSttUI(e.target.value);
    await saveAll();
    showToast(t('toast_saved', '已保存'));
  });
  for (const id of ['stt-api-key', 'stt-base-url', 'stt-model']) {
    $(id).addEventListener('change', async () => { await saveAll(); });
  }

  $('provider').addEventListener('change', async (e) => {
    updateProviderUI(e.target.value);
    await saveAll();
    showToast(t('toast_provider_saved', '翻译引擎已保存'));
  });

  $('api-key').addEventListener('change', async () => { await saveAll(); showToast(t('toast_apikey_saved', 'API Key 已保存')); });
  // `change` only fires on blur — clear the note as soon as a key is typed.
  $('api-key').addEventListener('input', (e) => updateSetupNote($('provider').value, e.target.value));
  $('api-base-url').addEventListener('change', async () => { await saveAll(); showToast(t('toast_apiurl_saved', 'API 地址已保存')); });
  $('api-model').addEventListener('change', async () => { await saveAll(); showToast(t('toast_model_saved', '模型已保存')); });
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
    // Engine defaults differ, so the model placeholder and voice list must follow
    // the engine BEFORE the user is asked to pick a voice for it.
    await updateTtsUI('');
    await saveAll();
    showToast(t('toast_saved', '已保存'));
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

  const runTest = (btn, note, fn) => busy($(btn), async () => {
    const el = $(note);
    el.textContent = t('engine_test_running', '测试中…');
    try {
      const r = await fn();
      el.textContent = withUrl(
        t('engine_test_ok', '✓ 通了 · {ms}ms').replace('{ms}', String(r.ms))
          + (r.sample ? ' · ' + t('engine_test_sample', '返回：') + r.sample : ''),
        r.url);
    } catch (e) {
      console.error('[engine-test]', (e && e.url) || '', e);
      el.textContent = withUrl('✗ ' + engineTestReason(e), e && e.url);
    }
  });

  $('btn-test-provider').addEventListener('click', runTest('btn-test-provider', 'test-provider-note', async () => {
    await saveAll();
    const t0 = Date.now();
    const out = await TranslationAPI.translate('Hello.', $('target-lang').value || 'zh-CN',
      $('provider').value, $('api-key').value.trim(), $('api-base-url').value.trim(), $('api-model').value.trim());
    if (!out || !String(out).trim()) { const e = new Error('empty'); e.code = 'bad_output'; throw e; }
    return { ms: Date.now() - t0, sample: String(out).trim().slice(0, 40) };
  }));

  $('btn-test-notes').addEventListener('click', runTest('btn-test-notes', 'test-notes-note', async () => {
    await saveAll();
    LearnNotes.configure(LearnNotes.resolveConfig(await new Promise((r) =>
      chrome.storage.local.get(SETTINGS_KEYS, (v) => r(v || {})))));
    return LearnNotes.test();
  }));

  $('btn-test-stt').addEventListener('click', runTest('btn-test-stt', 'test-stt-note', async () => {
    await saveAll();
    LearnSpeech.configure({
      engineId: $('stt-engine').value, apiKey: $('stt-api-key').value.trim(),
      baseUrl: $('stt-base-url').value.trim(), model: $('stt-model').value.trim(),
    });
    return LearnSpeech.test();
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
    const base = learnRules || { v: 1, block: [], langs: null };
    learnRules = Object.assign({}, base, mutate(base), { v: 1, updatedAt: Date.now() });
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
