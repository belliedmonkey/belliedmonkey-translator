// popup.js

const LLM_PROVIDERS = new Set(['openai', 'claude', 'deepseek', 'glm']);
const OPENAI_COMPAT = new Set(['openai', 'deepseek', 'glm']); // support custom base URL

const $ = id => document.getElementById(id);

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
  $('btn-translate').textContent = pageTranslated ? '查看原文' : '翻译本页';
  const badge = $('status-badge');
  badge.textContent = pageTranslated ? '已翻译' : '未翻译';
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

  // Populate UI
  $('target-lang').value = s.targetLang || 'zh-CN';
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
    showToast('语言已切换');
  });

  $('provider').addEventListener('change', async (e) => {
    const provider = e.target.value;
    await saveSettings({ provider });
    updateApiKeySection(provider);
    showToast('翻译引擎已切换');
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
      showToast('已恢复原文');
    } else {
      await sendToPage('translatePage');
      pageTranslated = true;
      updateTranslateUI();
      showToast('正在翻译…');
    }
  });

  $('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
