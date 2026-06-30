// popup.js

const LLM_PROVIDERS = new Set(['openai', 'claude', 'deepseek', 'glm']);
const OPENAI_COMPAT = new Set(['openai', 'deepseek', 'glm']); // support custom base URL

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
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { const m = t(el.dataset.i18nAria, ''); if (m) el.setAttribute('aria-label', m); });
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, s => resolve(s || {}));
  });
}

function showToast(msg, duration = 2000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

async function saveSettings(patch) {
  return new Promise(resolve => chrome.storage.local.set(patch, resolve));
}

function updateApiKeySection(provider) {
  const section = $('apikey-section');
  const baseUrlRow = $('baseurl-row');
  if (LLM_PROVIDERS.has(provider)) {
    section.style.display = 'block';
    baseUrlRow.style.display = OPENAI_COMPAT.has(provider) ? 'flex' : 'none';
  } else {
    section.style.display = 'none';
  }
}

let pageTranslated = false; // whether the current page is currently translated

function updateTranslateUI() {
  $('btn-translate').textContent = pageTranslated ? t('btn_view_original', '查看原文') : t('btn_translate_page', '翻译本页');
  const badge = $('status-badge');
  badge.textContent = pageTranslated ? t('status_translated', '已翻译') : t('status_untranslated', '未翻译');
  badge.classList.toggle('on', pageTranslated);
}

async function sendToPage(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { action });
  } catch (_) {
    return null; // content script not loaded on this page (e.g. chrome://)
  }
}

async function queryPageTranslated() {
  const resp = await sendToPage('getPageStatus');
  return !!(resp && resp.enabled);
}

async function init() {
  const s = await getSettings();
  _uiLang = s.uiLang || 'auto';
  applyI18n();

  // Populate UI
  $('target-lang').value = s.targetLang || 'zh-CN';
  $('ui-lang').value = s.uiLang || 'auto';
  $('provider').value = s.provider || 'google';
  $('api-key').value = s.apiKey || '';
  $('api-base-url').value = s.apiBaseUrl || '';

  updateApiKeySection(s.provider || 'google');

  // Reflect the CURRENT page's translation state (not a stored default).
  pageTranslated = await queryPageTranslated();
  updateTranslateUI();

  // ─── Event listeners ────────────────────────────────────────────────

  $('target-lang').addEventListener('change', async (e) => {
    await saveSettings({ targetLang: e.target.value });
    showToast(t('toast_lang_switched', '语言已切换'));
  });

  $('ui-lang').addEventListener('change', async (e) => {
    _uiLang = e.target.value || 'auto';
    await saveSettings({ uiLang: e.target.value });
    applyI18n();
    updateTranslateUI(); // re-localize the button/badge text
    showToast(t('toast_lang_switched', '语言已切换'));
  });

  $('provider').addEventListener('change', async (e) => {
    const provider = e.target.value;
    await saveSettings({ provider });
    updateApiKeySection(provider);
    showToast(t('toast_provider_switched', '翻译引擎已切换'));
  });

  $('api-key').addEventListener('change', async (e) => {
    await saveSettings({ apiKey: e.target.value.trim() });
  });

  $('api-base-url').addEventListener('change', async (e) => {
    await saveSettings({ apiBaseUrl: e.target.value.trim() });
  });

  // Toggle password visibility
  $('toggle-eye').addEventListener('click', () => {
    const input = $('api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Toggle: 翻译本页 ↔ 查看原文. Re-translating is cache-first (TranslationAPI cache).
  $('btn-translate').addEventListener('click', async () => {
    if (pageTranslated) {
      await sendToPage('disablePage');
      pageTranslated = false;
      updateTranslateUI();
      showToast(t('toast_restored_original', '已恢复原文'));
    } else {
      await sendToPage('translatePage');
      pageTranslated = true;
      updateTranslateUI();
      showToast(t('toast_translating', '正在翻译…'));
    }
  });

  $('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
