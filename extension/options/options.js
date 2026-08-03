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
  'learnEnabled', 'learnDailyNew',
  'ttsMode', 'ttsAutoPlay', 'ttsEngine', 'ttsBaseUrl', 'ttsApiKey', 'ttsModel', 'ttsVoice', 'ttsRate',
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

// Say what to do BEFORE the first bad result, not after. Mirrors popup.js —
// see the comment there for why both states exist.
function updateSetupNote(provider, apiKey) {
  const el = $('setup-note');
  if (!el) return;
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

function ttsReason(reason) {
  switch (reason) {
    case 'no_voice': return t('tts_no_voice', '系统里没有这门语言的语音');
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
    ttsRate:     $('tts-rate').value
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
  const s0 = await new Promise(resolve => chrome.storage.local.get(SETTINGS_KEYS, resolve));
  _uiLang = s0.uiLang || 'auto';
  applyI18n();
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
  $('text-color').value     = s.textColor   || '#0a7a3c';
  $('yt-text-color').value  = s.ytTextColor || '#ffffff';
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

  updateProviderUI(prov);
  updateColorPreview(s.textColor || '#0a7a3c');
  $('yt-color-preview').style.color = s.ytTextColor || '#ffffff';
  if (prov !== s.provider) await saveAll(); // migrate an out-of-flavor provider

  // ─── Listeners ──────────────────────────────────────────────────────

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
  $('btn-tts-test').addEventListener('click', async () => {
    applyTtsConfig();
    const note = $('tts-cache');
    const sample = t('tts_test_sample', 'This is what your review cards will sound like.');
    note.textContent = t('tts_testing', '正在合成…');
    const r = await LearnTTS.speak(sample, 'en');
    note.textContent = r.ok ? t('tts_test_ok', '播放中') : ttsReason(r.reason);
    if (r.ok) setTimeout(refreshTtsCache, 1500);
  });
  $('btn-clear-tts').addEventListener('click', async () => {
    try { await LearnStore.clearAudio(); showToast(t('toast_tts_cleared', '语音缓存已清空')); }
    catch (_) { showToast(t('toast_learn_clear_failed', '清空失败')); }
    refreshTtsCache();
  });

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

  $('learn-enabled').addEventListener('change', async () => {
    await saveAll();
    // Turning capture OFF stops collecting; it does NOT delete what was already
    // collected. Say so, rather than letting the user assume either way.
    showToast($('learn-enabled').checked
      ? t('toast_learn_on', '已开始采集学习材料')
      : t('toast_learn_off', '已停止采集（已收集的内容保留）'));
    refreshLearnStats();
  });
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
      el.textContent = msg;
      // Offering a cleanup that would free nothing is worse than offering none.
      btn.hidden = p.reclaimable === 0;
      if (!btn.hidden) {
        btn.textContent = t('learn_clean_known_n', '清理已掌握的 {n} 张卡')
          .replace('{n}', String(p.reclaimable));
      }
    } catch (_) { el.textContent = ''; btn.hidden = true; }
  }

  $('btn-clean-known').addEventListener('click', async () => {
    const n = await LearnStore.clearKnown().catch(() => -1);
    if (n < 0) { showToast(t('toast_learn_clear_failed', '清空失败')); }
    else {
      showToast(t('toast_learn_cleaned', '已清理 {n} 张已掌握的卡').replace('{n}', String(n)));
    }
    refreshLearnStats();
    refreshPressure();
  });

  $('btn-clear-learn').addEventListener('click', async () => {
    if (!window.confirm(t('learn_clear_confirm', '清空学习库？所有已采集的句子与复习进度都会被删除，且无法恢复。'))) return;
    try {
      await LearnStore.clearAll();
      showToast(t('toast_learn_cleared', '学习库已清空'));
    } catch (_) {
      showToast(t('toast_learn_clear_failed', '清空失败'));
    }
    refreshLearnStats();
    refreshPressure();
  });
  refreshLearnStats();
  refreshPressure();

  $('btn-clear-cache').addEventListener('click', async () => {
    const status = $('cache-status');
    status.textContent = t('toast_clearing', '清除中…');
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items).filter(k => k.startsWith('tr:'));
      if (keys.length === 0) {
        status.textContent = t('toast_cache_empty', '缓存为空');
        return;
      }
      chrome.storage.local.remove(keys, () => {
        status.textContent = t('toast_cache_cleared', '缓存已清除') + ` (${keys.length})`;
        showToast(t('toast_cache_cleared', '缓存已清除'));
      });
    });
  });
}

init();
