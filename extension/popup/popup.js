// popup.js

// Provider list is the build-time registry (window.MT_PROVIDERS, generated per
// from build/providers.config.js).
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
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { const m = t(el.dataset.i18nAria, ''); if (m) el.setAttribute('aria-label', m); });
}

function providerLabel(p) { return p.labelKey ? t(p.labelKey, p.label || p.id) : (p.label || p.id); }
function populateProviders() {
  const sel = $('provider');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const p of PROVIDERS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = providerLabel(p);
    sel.appendChild(o);
  }
  if (prev && providerById(prev)) sel.value = prev;
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, s => resolve(s || {}));
  });
}

function showToast(msg, duration = 2000) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

async function saveSettings(patch) {
  return new Promise(resolve => chrome.storage.local.set(patch, resolve));
}

// Say what to do BEFORE the first bad result, not after. Two mutually exclusive
// states: a keyed engine with no key (translation WILL fail — warn), or the free
// no-key engine (works, but it is not a stable endpoint and can hand back the
// original text unchanged, which reads as "the extension is broken"). A configured
// keyed engine shows nothing.
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

function updateApiKeySection(provider) {
  const p = providerById(provider) || {};
  $('apikey-section').style.display = p.needsKey ? 'block' : 'none';
  $('baseurl-row').style.display = p.supportsBaseUrl ? 'flex' : 'none';
  $('model-row').style.display = p.supportsModel ? 'flex' : 'none';
  $('api-base-url').placeholder = p.defaultBase || 'https://…';
  $('api-model').placeholder = p.defaultModel || '';
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
  // Clear the first-run dot (background.js sets it on install). Clearing the GLOBAL
  // badge is safe: the per-tab 'ON' badges are stored separately and take precedence,
  // so an active translation keeps its indicator.
  try { chrome.action.setBadgeText({ text: '' }); } catch (_) { /* best-effort */ }

  const s = await getSettings();
  _uiLang = s.uiLang || 'auto';
  applyI18n();

  // Populate UI
  $('target-lang').value = s.targetLang || 'zh-CN';
  $('ui-lang').value = s.uiLang || 'auto';
  populateProviders();
  const prov = providerById(s.provider) ? s.provider : defaultProviderId();
  $('provider').value = prov;
  $('api-key').value = s.apiKey || '';
  $('api-base-url').value = s.apiBaseUrl || '';
  $('api-model').value = s.apiModel || '';

  updateApiKeySection(prov);
  updateSetupNote(prov, s.apiKey);
  if (prov !== s.provider) await saveSettings({ provider: prov }); // persist the fallback

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
    populateProviders();  // re-localize provider option labels
    updateTranslateUI();  // re-localize the button/badge text
    updateSetupNote($('provider').value, $('api-key').value);  // …and the setup note
    showToast(t('toast_lang_switched', '语言已切换'));
  });

  $('provider').addEventListener('change', async (e) => {
    const provider = e.target.value;
    await saveSettings({ provider });
    updateApiKeySection(provider);
    updateSetupNote(provider, $('api-key').value);
    showToast(t('toast_provider_switched', '翻译引擎已切换'));
  });

  $('api-key').addEventListener('change', async (e) => {
    await saveSettings({ apiKey: e.target.value.trim() });
    updateSetupNote($('provider').value, e.target.value);
  });
  // `change` only fires on blur — the note must clear as soon as a key is typed,
  // otherwise it keeps saying "translation will not work" while the field is full.
  $('api-key').addEventListener('input', (e) => updateSetupNote($('provider').value, e.target.value));

  $('api-base-url').addEventListener('change', async (e) => {
    await saveSettings({ apiBaseUrl: e.target.value.trim() });
  });

  $('api-model').addEventListener('change', async (e) => {
    await saveSettings({ apiModel: e.target.value.trim() });
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
