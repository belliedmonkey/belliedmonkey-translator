// options.js

const LLM_PROVIDERS = new Set(['openai', 'claude', 'deepseek', 'glm']);
const OPENAI_COMPAT = new Set(['openai', 'deepseek', 'glm']);

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

function apiHint(provider) {
  return ({
    openai:   () => t('hint_openai',   'OpenAI API Key（sk-…）。模型：gpt-4o-mini'),
    claude:   () => t('hint_claude',   'Anthropic API Key（sk-ant-…）。模型：claude-haiku-4-5'),
    deepseek: () => t('hint_deepseek', 'DeepSeek API Key。模型：deepseek-chat'),
    glm:      () => t('hint_glm',      '智谱 AI API Key。模型：glm-4-flash（有免费额度）'),
  }[provider] || (() => ''))();
}

function showToast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function updateProviderUI(provider) {
  const hasApiKey = LLM_PROVIDERS.has(provider);
  $('apikey-fields').style.display = hasApiKey ? 'block' : 'none';
  $('baseurl-field').style.display = OPENAI_COMPAT.has(provider) ? 'block' : 'none';
  const hint = $('api-hint');
  hint.textContent = apiHint(provider);
}

function updateColorPreview(color) {
  $('color-preview').style.color = color;
}

async function saveAll() {
  const settings = {
    provider:    $('provider').value,
    apiKey:      $('api-key').value.trim(),
    apiBaseUrl:  $('api-base-url').value.trim(),
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

  $('provider').value       = s.provider    || 'google';
  $('api-key').value        = s.apiKey      || '';
  $('api-base-url').value   = s.apiBaseUrl  || '';
  $('target-lang').value    = s.targetLang  || 'zh-CN';
  $('ui-lang').value        = s.uiLang      || 'auto';
  $('text-color').value     = s.textColor   || '#0a7a3c';
  $('yt-text-color').value  = s.ytTextColor || '#ffffff';
  $('font-size').value      = scaleValue(s.fontSize);
  $('show-fab').checked     = s.showFab !== false;

  updateProviderUI(s.provider || 'google');
  updateColorPreview(s.textColor || '#0a7a3c');
  $('yt-color-preview').style.color = s.ytTextColor || '#ffffff';

  // ─── Listeners ──────────────────────────────────────────────────────

  $('provider').addEventListener('change', async (e) => {
    updateProviderUI(e.target.value);
    await saveAll();
    showToast(t('toast_provider_saved', '翻译引擎已保存'));
  });

  $('api-key').addEventListener('change', async () => { await saveAll(); showToast(t('toast_apikey_saved', 'API Key 已保存')); });
  $('api-base-url').addEventListener('change', async () => { await saveAll(); showToast(t('toast_apiurl_saved', 'API 地址已保存')); });
  $('target-lang').addEventListener('change', async () => { await saveAll(); showToast(t('toast_lang_saved', '语言已保存')); });
  $('ui-lang').addEventListener('change', async (e) => {
    _uiLang = e.target.value || 'auto';
    await saveAll();
    applyI18n();
    updateProviderUI($('provider').value); // re-localize the API hint
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
