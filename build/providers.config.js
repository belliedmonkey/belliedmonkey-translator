// build/providers.config.js — SINGLE SOURCE OF TRUTH for translation providers.
//
// Consumed at BUILD time by build.js, which filters this list by the chosen
// `flavor` (global | china), resolves per-flavor `defaultBase`/`label` down to a
// single value, and writes extension/content/... → dist/content/providers.gen.js
// (`window.MT_FLAVOR` + `window.MT_PROVIDERS`). The runtime (translation-api.js,
// options.js, popup.js) reads only that generated file — never this one.
//
// Per docs/domain-design.md: region↔provider separation is a BUILD/DISTRIBUTION
// concern, not a runtime per-request branch. China builds must contain NO
// OpenAI/ChatGPT/Claude brand strings and NO api.openai.com / api.anthropic.com
// endpoints (Guideline 5 — Chinese MIIT permitting). build.js enforces this with
// a compliance grep gate over dist-china/.
//
// Field notes:
//   type            'google' | 'chat-compat' (OpenAI Chat Completions format)
//                   | 'messages-compat' (Anthropic Messages format). BRAND-FREE
//                   type names on purpose so the China bundle carries no brand word.
//   defaultBase     string | { china, global } | null. null = user must supply a
//                   base URL (the generic custom endpoints).
//   label           string | { china, global }. China labels are brand-free.
//   flavors         which builds include this provider.
//   supportsBaseUrl / supportsModel  whether the UI shows the base-URL / model field.
//
// Verified endpoints (2026-07): GLM domestic open.bigmodel.cn vs international
// Z.ai api.z.ai; Kimi api.moonshot.cn vs api.moonshot.ai (keys are region-bound);
// Qwen dashscope.aliyuncs.com vs dashscope-intl.aliyuncs.com; DeepSeek single
// api.deepseek.com for both.

module.exports = [
  {
    id: 'google', type: 'google', flavors: ['global'],
    needsKey: false, supportsBaseUrl: false, supportsModel: false,
    label: { global: 'Google 翻译（免费，无需 API Key）' }, labelKey: 'provider_google_free_long', hintKey: null,
  },
  {
    id: 'openai', type: 'chat-compat', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: { global: 'https://api.openai.com' }, path: '/v1/chat/completions',
    defaultModel: 'gpt-4o-mini', label: { global: 'ChatGPT (OpenAI)' }, hintKey: 'hint_openai',
  },
  {
    id: 'claude', type: 'messages-compat', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: { global: 'https://api.anthropic.com' }, path: '/v1/messages',
    defaultModel: 'claude-haiku-4-5-20251001', label: { global: 'Claude (Anthropic)' }, hintKey: 'hint_claude',
  },
  {
    id: 'deepseek', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: 'https://api.deepseek.com', path: '/v1/chat/completions',
    defaultModel: 'deepseek-v4-flash', label: 'DeepSeek', hintKey: 'hint_deepseek',
  },
  {
    id: 'glm', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: { china: 'https://open.bigmodel.cn', global: 'https://api.z.ai' },
    path: '/api/paas/v4/chat/completions', defaultModel: 'glm-4-flash',
    label: { china: '智谱 GLM', global: 'GLM (Z.ai)' }, hintKey: 'hint_glm',
  },
  {
    id: 'qwen', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: {
      china: 'https://dashscope.aliyuncs.com/compatible-mode',
      global: 'https://dashscope-intl.aliyuncs.com/compatible-mode',
    },
    path: '/v1/chat/completions', defaultModel: 'qwen-plus',
    label: { china: '通义千问', global: 'Qwen' }, hintKey: 'hint_qwen',
  },
  {
    id: 'kimi', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: { china: 'https://api.moonshot.cn', global: 'https://api.moonshot.ai' },
    path: '/v1/chat/completions', defaultModel: 'moonshot-v1-8k',
    label: 'Kimi', hintKey: 'hint_kimi',
  },
  {
    // Generic OpenAI Chat-Completions-format endpoint. User supplies base URL +
    // model + key (self-hosted / third-party / proxy). Brand-free.
    id: 'custom_chat', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresBaseUrl: true,
    defaultBase: null, path: '/v1/chat/completions', defaultModel: '',
    label: { china: '自定义 · Chat Completions 格式', global: 'Custom (OpenAI-compatible)' },
    hintKey: 'hint_custom_chat',
  },
  {
    // Generic Anthropic Messages-format endpoint (also brand-free). The transport
    // sends the protocol header `anthropic-version` — a technical API-format
    // requirement for ANY Messages-compatible endpoint, NOT a Claude/brand
    // reference. See docs/domain-design.md compliance note.
    id: 'custom_msg', type: 'messages-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresBaseUrl: true,
    defaultBase: null, path: '/v1/messages', defaultModel: '',
    label: { china: '自定义 · Messages 格式', global: 'Custom (Anthropic-compatible)' },
    hintKey: 'hint_custom_msg',
  },
];
