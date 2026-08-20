// build/providers.config.js — SINGLE SOURCE OF TRUTH for translation providers.
//
// Consumed at BUILD time by build.js, which filters this list by the chosen
// `flavor` (global | china), resolves per-flavor `defaultEndpoint`/`label` down to a
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
//                   It is the DEFAULT shape; the endpoint URL's path suffix refines it
//                   at runtime (content/wire-format.js, domain-design §7).
//   defaultEndpoint string | { china, global } | null. The COMPLETE request URL, path
//                   included — never an origin to append to. null = the user must
//                   supply the whole address (the generic custom endpoints); it is
//                   written out EXPLICITLY even then, because a silently absent field
//                   is how the China bundle once shipped a brand-named engine
//                   (test/registry.test.js header).
//   placeholder     string | null. Example address shown in the empty input, and only
//                   meaningful when defaultEndpoint is null. It lives here rather than
//                   in the i18n copy for the same reason every other endpoint does:
//                   a path written into UI strings is a second copy that drifts
//                   (CLAUDE.md — the DeepSeek model-name incident).
//   label           string | { china, global }. China labels are brand-free.
//   flavors         which builds include this provider.
//   supportsBaseUrl / supportsModel  whether the UI shows the endpoint / model field.
//
// There is no `path` field and there must never be one again. Splitting an endpoint
// into origin + path assumed a regularity that never held — qwen's own default already
// carries a `/compatible-mode` path segment, and `google` has no path at all — and it
// left users unable to choose between two request shapes served from one host.
//
// Verified endpoints (2026-07): GLM domestic open.bigmodel.cn vs international
// Z.ai api.z.ai; Kimi api.moonshot.cn vs api.moonshot.ai (keys are region-bound);
// Qwen dashscope.aliyuncs.com vs dashscope-intl.aliyuncs.com; DeepSeek single
// api.deepseek.com for both.

module.exports = [
  {
    id: 'google', type: 'google', flavors: ['global'],
    needsKey: false, supportsBaseUrl: false, supportsModel: false,
    // The free endpoint builds its URL with query parameters at call time
    // (translation-api.js), so it cannot be expressed as one stored address — and the
    // user can never supply one either (supportsBaseUrl:false). Declared null
    // EXPLICITLY: an absent field is the failure mode registry.test.js exists to catch.
    defaultEndpoint: null, placeholder: null,
    label: { global: 'Google 翻译（免费，无需 API Key）' }, labelKey: 'provider_google_free_long', hintKey: null,
  },
  {
    id: 'openai', type: 'chat-compat', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultEndpoint: { global: 'https://api.openai.com/v1/chat/completions' }, placeholder: null,
    defaultModel: 'gpt-4o-mini', label: { global: 'ChatGPT (OpenAI)' }, hintKey: 'hint_openai',
  },
  {
    id: 'claude', type: 'messages-compat', flavors: ['global'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultEndpoint: { global: 'https://api.anthropic.com/v1/messages' }, placeholder: null,
    defaultModel: 'claude-haiku-4-5-20251001', label: { global: 'Claude (Anthropic)' }, hintKey: 'hint_claude',
  },
  {
    id: 'deepseek', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions', placeholder: null,
    defaultModel: 'deepseek-v4-flash', label: 'DeepSeek', hintKey: 'hint_deepseek',
  },
  {
    id: 'glm', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultEndpoint: {
      china: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      global: 'https://api.z.ai/api/paas/v4/chat/completions',
    },
    placeholder: null, defaultModel: 'glm-4-flash',
    label: { china: '智谱 GLM', global: 'GLM (Z.ai)' }, hintKey: 'hint_glm',
  },
  {
    id: 'qwen', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    // The one entry whose old `defaultBase` already carried a path segment
    // (`/compatible-mode`) — the standing proof that "base = origin" never held.
    defaultEndpoint: {
      china: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      global: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    },
    placeholder: null, defaultModel: 'qwen-plus',
    label: { china: '通义千问', global: 'Qwen' }, hintKey: 'hint_qwen',
  },
  {
    // 翻译专用模型。`type` 写 chat-compat 而不是 translate-compat，是刻意的：`type` 的
    // 语义是「地址认不出来时的兜底形状」，而这个条目的真实形状由**模型名**声明
    // （domain-design §7 第三条）。用户把模型改成 qwen-plus 时，它就该退回普通对话，
    // 那正是 chat-compat 兜底给出的结果。
    id: 'qwen_mt', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultEndpoint: {
      china: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      global: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    },
    placeholder: null, defaultModel: 'qwen-mt-turbo',
    label: { china: '通义千问·翻译版', global: 'Qwen MT' }, hintKey: 'hint_qwen_mt',
  },
  {
    id: 'kimi', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true,
    defaultEndpoint: {
      china: 'https://api.moonshot.cn/v1/chat/completions',
      global: 'https://api.moonshot.ai/v1/chat/completions',
    },
    // ⚠️ 2026-08-21 实测：国际站 api.moonshot.ai 上 `moonshot-v1-8k` 已经 **404**
    // （Not found the model … or Permission denied），也就是说任何人选了 Kimi、不手填
    // 模型，第一次翻译就报错 —— 这个引擎开箱即不可用。改成实测可用的 kimi-k2.6。
    // 国内站那个值**保持不动**：手上没有 .cn 的 key，无法验证；改一个没验过的值去替换
    // 另一个没验过的值，只是把风险从一边挪到另一边。见 perf-ledger 里 api.moonshot.cn 那行。
    placeholder: null, defaultModel: { global: 'kimi-k2.6', china: 'moonshot-v1-8k' },
    label: 'Kimi', hintKey: 'hint_kimi',
  },
  {
    // Generic OpenAI Chat-Completions-format endpoint. User supplies the COMPLETE
    // endpoint URL + model + key (self-hosted / third-party / proxy). Brand-free.
    id: 'custom_chat', type: 'chat-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: true,
    defaultEndpoint: null, placeholder: 'https://your-endpoint.example/v1/chat/completions',
    defaultModel: '',
    label: { china: '自定义 · Chat Completions 格式', global: 'Custom (OpenAI-compatible)' },
    hintKey: 'hint_custom_chat',
  },
  {
    // Generic Anthropic Messages-format endpoint (also brand-free). The transport
    // sends the protocol header `anthropic-version` — a technical API-format
    // requirement for ANY Messages-compatible endpoint, NOT a Claude/brand
    // reference. See docs/domain-design.md compliance note.
    id: 'custom_msg', type: 'messages-compat', flavors: ['global', 'china'],
    needsKey: true, supportsBaseUrl: true, supportsModel: true, requiresEndpoint: true,
    defaultEndpoint: null, placeholder: 'https://your-endpoint.example/v1/messages',
    defaultModel: '',
    label: { china: '自定义 · Messages 格式', global: 'Custom (Anthropic-compatible)' },
    hintKey: 'hint_custom_msg',
  },
];
