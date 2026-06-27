// options.js

const LLM_PROVIDERS = new Set(['openai', 'claude', 'deepseek', 'glm']);
const OPENAI_COMPAT = new Set(['openai', 'deepseek', 'glm']);

const API_HINTS = {
  openai:   'OpenAI API Key（sk-…）。模型：gpt-4o-mini',
  claude:   'Anthropic API Key（sk-ant-…）。模型：claude-haiku-4-5',
  deepseek: 'DeepSeek API Key。模型：deepseek-chat',
  glm:      '智谱 AI API Key。模型：glm-4-flash（有免费额度）'
};

const $ = id => document.getElementById(id);

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
  hint.textContent = API_HINTS[provider] || '';
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
    textColor:   $('text-color').value,
    fontSize:    $('font-size').value,
    showFab:     $('show-fab').checked
  };
  await new Promise(resolve => chrome.storage.local.set(settings, resolve));
}

async function init() {
  const s = await new Promise(resolve => chrome.storage.local.get(null, resolve));

  $('provider').value       = s.provider    || 'google';
  $('api-key').value        = s.apiKey      || '';
  $('api-base-url').value   = s.apiBaseUrl  || '';
  $('target-lang').value    = s.targetLang  || 'zh-CN';
  $('text-color').value     = s.textColor   || '#0a7a3c';
  $('font-size').value      = s.fontSize    || '0.9em';
  $('show-fab').checked     = s.showFab !== false;

  updateProviderUI(s.provider || 'google');
  updateColorPreview(s.textColor || '#0a7a3c');

  // ─── Listeners ──────────────────────────────────────────────────────

  $('provider').addEventListener('change', async (e) => {
    updateProviderUI(e.target.value);
    await saveAll();
    showToast('翻译引擎已保存');
  });

  $('api-key').addEventListener('change', async () => { await saveAll(); showToast('API Key 已保存'); });
  $('api-base-url').addEventListener('change', async () => { await saveAll(); showToast('API 地址已保存'); });
  $('target-lang').addEventListener('change', async () => { await saveAll(); showToast('语言已保存'); });
  $('font-size').addEventListener('change', async () => { await saveAll(); showToast('字号已保存'); });
  $('show-fab').addEventListener('change', async () => { await saveAll(); });

  $('text-color').addEventListener('input', (e) => {
    updateColorPreview(e.target.value);
  });
  $('text-color').addEventListener('change', async () => { await saveAll(); showToast('颜色已保存'); });

  $('toggle-eye').addEventListener('click', () => {
    const input = $('api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  $('btn-clear-cache').addEventListener('click', async () => {
    const status = $('cache-status');
    status.textContent = '清除中…';
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items).filter(k => k.startsWith('tr:'));
      if (keys.length === 0) {
        status.textContent = '缓存为空';
        return;
      }
      chrome.storage.local.remove(keys, () => {
        status.textContent = `已清除 ${keys.length} 条翻译缓存`;
        showToast('缓存已清除');
      });
    });
  });
}

init();
