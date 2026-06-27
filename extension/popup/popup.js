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

function updateBadge(enabled) {
  const badge = $('status-badge');
  if (enabled) {
    badge.textContent = '已开启';
    badge.classList.add('on');
  } else {
    badge.textContent = '已关闭';
    badge.classList.remove('on');
  }
}

async function sendToPage(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action });
  } catch (_) {
    // Content script may not be loaded on this page
  }
}

async function init() {
  const s = await getSettings();

  // Populate UI
  $('toggle-enabled').checked = !!s.enabled;
  $('target-lang').value = s.targetLang || 'zh-CN';
  $('provider').value = s.provider || 'google';
  $('api-key').value = s.apiKey || '';
  $('api-base-url').value = s.apiBaseUrl || '';

  updateBadge(!!s.enabled);
  updateApiKeySection(s.provider || 'google');

  // ─── Event listeners ────────────────────────────────────────────────

  $('toggle-enabled').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await saveSettings({ enabled });
    updateBadge(enabled);
    await sendToPage(enabled ? 'translatePage' : 'disablePage');
  });

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

  $('btn-translate').addEventListener('click', async () => {
    const enabled = true;
    $('toggle-enabled').checked = true;
    await saveSettings({ enabled });
    updateBadge(true);
    await sendToPage('translatePage');
    showToast('正在翻译…');
  });

  $('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
