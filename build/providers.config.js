// build/providers.config.js — SINGLE SOURCE OF TRUTH for translation providers.
//
// Consumed at BUILD time by build.js, which writes extension/content/ →
// dist/content/providers.gen.js (`window.MT_PROVIDERS`). The runtime
// (translation-api.js, options.js, popup.js) reads only that generated file —
// never this one.
//
// There is ONE build for everyone (docs/domain-design.md §7.1). The former
// global/china flavor split is gone: it produced a deliberately reduced product for
// one group of users. Compliance pressure is resolved by narrowing DISTRIBUTION
// SCOPE, not the feature set.
//
// Field notes:
//   type            'google' | 'chat-compat' (OpenAI Chat Completions format)
//                   | 'messages-compat' (Anthropic Messages format). Type names are
//                   BRAND-FREE on purpose — the transport is keyed by request
//                   FORMAT, never by vendor.
//   defaultBase     string | null. null = user must supply a base URL (the generic
//                   custom endpoints).
//   altBases        optional [{ labelKey, url }]. Providers that operate more than
//                   one regional endpoint declare them here, and the options page
//                   renders an endpoint picker that writes the chosen URL into the
//                   existing `apiBaseUrl` setting. No new setting key, no runtime
//                   region branch — the registry stays the only place a URL lives.
//                   Keys are region-bound: a key issued for one endpoint does not
//                   work on the other.
//   supportsBaseUrl / supportsModel  whether the UI shows the base-URL / model field.
//
// Verified endpoints (2026-07): GLM domestic open.bigmodel.cn vs international
// Z.ai api.z.ai; Kimi api.moonshot.cn vs api.moonshot.ai; Qwen
// dashscope.aliyuncs.com vs dashscope-intl.aliyuncs.com; DeepSeek single
// api.deepseek.com for both.

module.exports = [
  {
    id: 'google', type: 'google',
    needsKey: false, supportsBaseUrl: false, supportsModel: false,
    label: 'Google 翻译（免费，无需 API Key）', labelKey: 'provider_google_free_long', hintKey: null,
  },
  {
    id: 'openai', type: 'chat-compat',
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: 'https://api.openai.com', path: '/v1/chat/completions',
    defaultModel: 'gpt-4o-mini', label: 'ChatGPT (OpenAI)', hintKey: 'hint_openai',
  },
  {
    id: 'claude', type: 'messages-compat',
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: 'https://api.anthropic.com', path: '/v1/messages',
    defaultModel: 'claude-haiku-4-5-20251001', label: 'Claude (Anthropic)', hintKey: 'hint_claude',
  },
  {
    id: 'deepseek', type: 'chat-compat',
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: 'https://api.deepseek.com', path: '/v1/chat/completions',
    defaultModel: 'deepseek-v4-flash', label: 'DeepSeek', hintKey: 'hint_deepseek',
  },
  {
    id: 'glm', type: 'chat-compat',
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: 'https://api.z.ai',
    altBases: [
      { labelKey: 'endpoint_intl', url: 'https://api.z.ai' },
      { labelKey: 'endpoint_cn', url: 'https://open.bigmodel.cn' },
    ],
    path: '/api/paas/v4/chat/completions', defaultModel: 'glm-4-flash',
    label: 'GLM 智谱 (Z.ai)', hintKey: 'hint_glm',
  },
  {
    id: 'qwen', type: 'chat-compat',
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: 'https://dashscope-intl.aliyuncs.com/compatible-mode',
    altBases: [
      { labelKey: 'endpoint_intl', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode' },
      { labelKey: 'endpoint_cn', url: 'https://dashscope.aliyuncs.com/compatible-mode' },
    ],
    path: '/v1/chat/completions', defaultModel: 'qwen-plus',
    label: 'Qwen 通义千问', hintKey: 'hint_qwen',
  },
  {
    id: 'kimi', type: 'chat-compat',
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultBase: 'https://api.moonshot.ai',
    altBases: [
      { labelKey: 'endpoint_intl', url: 'https://api.moonshot.ai' },
      { labelKey: 'endpoint_cn', url: 'https://api.moonshot.cn' },
    ],
    path: '/v1/chat/completions', defaultModel: 'moonshot-v1-8k',
    label: 'Kimi', hintKey: 'hint_kimi',
  },
  {
    // Generic OpenAI Chat-Completions-format endpoint. User supplies base URL +
    // model + key (self-hosted / third-party / proxy). Brand-free.
    id: 'custom_chat', type: 'chat-compat',
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresBaseUrl: true,
    defaultBase: null, path: '/v1/chat/completions', defaultModel: '',
    label: 'Custom (OpenAI-compatible)', hintKey: 'hint_custom_chat',
  },
  {
    // Generic Anthropic Messages-format endpoint (also brand-free). The transport
    // sends the protocol header `anthropic-version` — a technical API-format
    // requirement for ANY Messages-compatible endpoint, NOT a Claude/brand
    // reference. See docs/domain-design.md.
    id: 'custom_msg', type: 'messages-compat',
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresBaseUrl: true,
    defaultBase: null, path: '/v1/messages', defaultModel: '',
    label: 'Custom (Anthropic-compatible)', hintKey: 'hint_custom_msg',
  },
];
