// options.js

// Provider list is the build-time registry (window.MT_PROVIDERS, generated per
// flavor from build/providers.config.js). No hardcoded provider list here.
const PROVIDERS = (window.MT_PROVIDERS || []);
const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;
const defaultProviderId = () => (PROVIDERS[0] && PROVIDERS[0].id) || 'google';

const $ = id => document.getElementById(id);

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
    showFab:     $('show-fab').checked
  };
  await new Promise(resolve => chrome.storage.local.set(settings, resolve));
}

// Map a stored fontSize to a valid scale option. Legacy values ('0.9em', '14px')
// predate the relative-scale model → default to 1.0 (match the original).
const SCALE_OPTS = ['0.8', '0.9', '1.0', '1.1', '1.25'];
function scaleValue(v) { return SCALE_OPTS.includes(v) ? v : '1.0'; }

async function init() {
  const s0 = await new Promise(resolve => chrome.storage.local.get(null, resolve));
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
