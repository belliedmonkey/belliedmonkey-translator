// agent/contract.js — N25 P0 action ids, §6 codes, §5 receipt shape.
//
// Tool names are the action ids literally, including the dot in ready.check.
// There is no second public name. Remote MCP is not this file: stdio is the
// daily server, and it advertises this same schema so a later remote server
// can reuse it without inventing actions.
'use strict';

const TRACK = '1.22.0-n25';

const ACTIONS = Object.freeze([
  'ready.check',
  'open_setup',
  'start_live_subtitles',
  'translate_page',
  'translate_video_captions',
  'capture_to_study',
  'explain_or_drill',
]);

const P1_ACTIONS = Object.freeze([
  'listen.start',
  'subtitle.export',
  'learn.open_review',
  'doc.translate',
]);

const SENSITIVE = new Set([
  'start_live_subtitles',
  'translate_page',
  'translate_video_captions',
  'capture_to_study',
  'explain_or_drill',
]);

// Deeplink §6, frozen. `ok` is the success code in the same set.
const CODES = Object.freeze([
  'ok',
  'need_confirm',
  'cancelled',
  'unsupported_action',
  'bad_request',
  'untrusted_denied',
  'need_app',
  'need_ext',
  'need_login',
  'need_packs',
  'need_engine',
  'need_os',
  'need_permission_mic',
  'site_unsupported',
  'quota_or_key',
  // Host subscription token was sent and the provider refused to bill it.
  // The card stays grant_or_key_unavailable. The grant is not a fallback.
  'subscription_cannot_pay',
  'study_capture_off',
  'network_unavailable',
]);

const CODE_SET = new Set(CODES);

const RECEIPT_KEYS = Object.freeze([
  'ok', 'action', 'code', 'message', 'fix', 'receipt_id',
]);

const SOURCES = new Set(['agent', 'mcp', 'deeplink', 'web', 'ext']);

const SETUP_STEPS = Object.freeze([
  'install_app', 'install_ext', 'login', 'packs', 'mic', 'engine',
]);

const EXPLAIN_MODES = new Set(['explain', 'drill']);

const TEXT_MAX = 2000;

const SCHEMES = Object.freeze({
  global: 'belliedmonkey',
  china: 'belliedmonkeycn',
});

function isSensitive(action) {
  return SENSITIVE.has(action);
}

function schemeForFlavor(flavor) {
  return flavor === 'china' ? SCHEMES.china : SCHEMES.global;
}

function setupLink(scheme, step, source) {
  const src = SOURCES.has(source) ? source : 'agent';
  const q = new URLSearchParams({ step, source: src });
  return scheme + '://agent/v1/open_setup?' + q.toString();
}

function fixFor(code, scheme, source) {
  const step = {
    need_app: 'install_app',
    need_ext: 'install_ext',
    need_login: 'login',
    need_packs: 'packs',
    need_permission_mic: 'mic',
    need_engine: 'engine',
    // Own key / host key setup. Not the login screen, and not the grant claim.
    quota_or_key: 'engine',
    subscription_cannot_pay: 'engine',
    grant_or_key_unavailable: 'engine',
  }[code];
  // network_unavailable is recoverable. It must not open engine, auth, or login.
  if (!step || code === 'network_unavailable') return {};
  return { open_setup: setupLink(scheme, step, source) };
}

// Shared query keys. Per-action keys are added on the tool, still a subset of
// the deeplink query surface. Unknown keys are accepted and ignored.
const COMMON_PROPS = {
  source: { type: 'string', enum: ['agent', 'mcp', 'deeplink', 'web', 'ext'] },
  v: { type: 'string', description: 'Contract minor version. Default 1.' },
  caller: { type: 'string', description: 'Untrusted display name. Not an identity.' },
  caller_id: { type: 'string', description: 'Stable caller id, if the host has one.' },
  lang: { type: 'string' },
  return: { type: 'string', description: 'Ignored until a return allowlist exists.' },
};

function tool(name, description, extra) {
  const properties = Object.assign({}, COMMON_PROPS, extra || {});
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      additionalProperties: true,
    },
  };
}

const TOOLS = Object.freeze([
  tool('ready.check',
    'Report local readiness. Does not change settings, permissions, or the study library. Gaps use the frozen failure codes inside message. The receipt has no page text.'),
  tool('open_setup',
    'Open the existing setup step. Optional step: install_app, install_ext, login, packs, mic, engine. step=engine is the user API key. A host API key calls the provider. A host subscription uses that same call; if the provider will not bill it, the receipt is subscription_cannot_pay and the grant is not a silent success.',
    { step: { type: 'string', enum: SETUP_STEPS.slice() } }),
  tool('start_live_subtitles',
    'Open the live-subtitle surface after the user confirms. Does not start the microphone. Optional video_lang and my_lang.',
    { video_lang: { type: 'string' }, my_lang: { type: 'string' } }),
  tool('translate_page',
    'Ask the extension to translate the current page after the user confirms. App-only calls return need_ext. Optional url is a hint, not a fetch. Optional text: empty is a billing probe; non-empty is one host page-MT shot (the caller segments, at most 2000 code points). Probe success is not a full page done. The receipt does not echo the text or the translation.',
    { url: { type: 'string' }, text: { type: 'string' } }),
  tool('translate_video_captions',
    'Ask the extension for in-page video captions after the user confirms. Unsupported sites return site_unsupported. Optional url is a hint, not a fetch. Optional text: empty is a billing probe; non-empty is one host caption-MT shot (the caller segments, at most 2000 code points). Probe success is not a full page done. The receipt does not echo the text or the translation.',
    { url: { type: 'string' }, text: { type: 'string' } }),
  tool('capture_to_study',
    'Save a sentence to the study library after the user confirms. Requires text or quote (or a paste on the confirm card). The receipt does not echo the sentence.',
    { text: { type: 'string' }, quote: { type: 'string' } }),
  tool('explain_or_drill',
    'Explain or lightly drill a sentence after the user confirms. mode is explain or drill (default explain). The receipt does not echo the sentence.',
    {
      text: { type: 'string' },
      quote: { type: 'string' },
      mode: { type: 'string', enum: ['explain', 'drill'] },
    }),
]);

function assertToolNames() {
  const names = TOOLS.map((t) => t.name);
  if (names.join('\n') !== ACTIONS.join('\n')) {
    throw new Error('tool names drifted from action ids');
  }
  if (names.indexOf('ready_check') !== -1) {
    throw new Error('ready_check is not a public tool name');
  }
}

assertToolNames();

module.exports = {
  TRACK,
  ACTIONS,
  P1_ACTIONS,
  SENSITIVE,
  CODES,
  CODE_SET,
  RECEIPT_KEYS,
  SOURCES,
  SETUP_STEPS,
  EXPLAIN_MODES,
  TEXT_MAX,
  SCHEMES,
  TOOLS,
  isSensitive,
  schemeForFlavor,
  setupLink,
  fixFor,
};
