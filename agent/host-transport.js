// agent/host-transport.js — stdio host credential → provider call.
//
// Node only. mcp-stdio.js is the one importer. The App bundle must not import
// this file: the registry id map below is a China-gate hit on purpose, and the
// App path does not bill host subscriptions (no OAuth into App storage).
//
// The request body is RequestShape's. This file does not invent a second
// provider table, a second body, or a client-impersonation header. A loopback
// fixture URL exists so tests can see the call; anything else uses the
// registry endpoint as stored.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REGISTRY_ID = {
  anthropic: 'claude',
  openai: 'openai',
  deepseek: 'deepseek',
};

const PROBE = 'Hi.';
const BUDGET = 32;
const TIMEOUT_MS = 20000;

let cached = null;

function loadTransport() {
  if (cached) return cached;
  const window = {};
  const context = vm.createContext({
    window: window,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    URL: URL,
    Buffer: Buffer,
  });
  const root = path.join(__dirname, '..', 'extension', 'content');
  const files = ['providers.gen.js', 'wire-format.js', 'request-shape.js'];
  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
  }
  cached = {
    providers: window.MT_PROVIDERS || [],
    WireFormat: context.WireFormat,
    RequestShape: context.RequestShape,
  };
  if (!cached.WireFormat || !cached.RequestShape) {
    throw new Error('host transport: registry shape did not load');
  }
  return cached;
}

function fixtureUrl(env) {
  const raw = env && env.MT_AGENT_TRANSPORT_FIXTURE;
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  let parsed;
  try { parsed = new URL(raw.trim()); } catch (_) { return ''; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  const host = parsed.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return '';
  return parsed.toString();
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function usageOf(json) {
  const usage = json && json.usage;
  if (!usage || typeof usage !== 'object') return null;
  const prompt = num(usage.prompt_tokens) != null ? num(usage.prompt_tokens) : num(usage.input_tokens);
  const completion = num(usage.completion_tokens) != null ? num(usage.completion_tokens) : num(usage.output_tokens);
  let total = num(usage.total_tokens);
  if (total == null && prompt != null && completion != null) total = prompt + completion;
  if (prompt == null && completion == null && total == null) return null;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

function errorName(json) {
  if (!json || typeof json !== 'object') return '';
  const err = json.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') return String(err.code || err.type || '');
  return '';
}

const CANNOT_PAY = /insufficient_quota|billing_hard_limit|payment_required|credit_balance|insufficient_credit|quota_exceeded|authentication_error|invalid_api_key|permission_error/i;

function classify(status, json, kind) {
  if (!status) return 'network_unavailable';
  if (status >= 200 && status < 300) return 'ok';
  const name = errorName(json);
  const cannot = status === 401 || status === 402 || status === 403 || CANNOT_PAY.test(name);
  if (kind === 'host_subscription' && cannot) return 'subscription_cannot_pay';
  if (cannot) return 'quota_or_key';
  if (status >= 500 || status === 408 || status === 429) return 'network_unavailable';
  return 'quota_or_key';
}

function entryFor(providers, provider) {
  const id = REGISTRY_ID[provider] || provider;
  for (let i = 0; i < providers.length; i++) {
    if (providers[i] && providers[i].id === id) return providers[i];
  }
  return null;
}

function quotaRecord(action, cred, http, code, usage) {
  const observed = !!(usage && (
    usage.prompt_tokens != null || usage.completion_tokens != null || usage.total_tokens != null
  ));
  return {
    action: action || '',
    kind: cred.kind,
    via: cred.via,
    host: cred.host,
    provider: cred.provider,
    observed: observed,
    http: http || 0,
    code: code,
    prompt_tokens: usage && usage.prompt_tokens != null ? usage.prompt_tokens : null,
    completion_tokens: usage && usage.completion_tokens != null ? usage.completion_tokens : null,
    total_tokens: usage && usage.total_tokens != null ? usage.total_tokens : null,
  };
}

function miss(action, cred, code) {
  return { ok: false, code: code, quota: quotaRecord(action, cred, 0, code, null) };
}

async function charge(input) {
  const src = input || {};
  const cred = src.cred || {};
  const env = src.env || {};
  const action = src.action || '';
  if (cred.kind !== 'host_subscription' && cred.kind !== 'host_key') {
    return miss(action, cred, 'quota_or_key');
  }
  const secret = env[cred.via];
  if (typeof secret !== 'string' || secret.trim() === '') return miss(action, cred, 'quota_or_key');
  const transport = loadTransport();
  const entry = entryFor(transport.providers, cred.provider);
  if (!entry || !entry.defaultEndpoint) return miss(action, cred, 'quota_or_key');
  const fixed = fixtureUrl(env);
  const url = fixed || transport.WireFormat.resolveEndpoint('', entry);
  const model = entry.defaultModel || '';
  const fmt = transport.WireFormat.formatFor(url, entry.type, model);
  const userText = action === 'explain_or_drill' ? String(src.text || '') : PROBE;
  const system = action === 'explain_or_drill'
    ? 'Explain the user message in one short sentence.'
    : 'Reply with OK.';
  const req = transport.RequestShape.build(fmt, {
    url: url,
    apiKey: secret.trim(),
    model: model,
    providerId: entry.id,
    system: system,
    user: userText,
    budget: BUDGET,
    targetLang: 'zh-CN',
    prefs: {},
  });
  if (!req || req.error || !req.body) return miss(action, cred, 'quota_or_key');
  const fetchImpl = src.fetch || globalThis.fetch;
  let status = 0;
  let json = null;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    try { json = JSON.parse(text); } catch (_) { json = null; }
  } catch (_) {
    return miss(action, cred, 'network_unavailable');
  }
  let code = classify(status, json, cred.kind);
  const usage = code === 'ok' ? usageOf(json) : null;
  const quota = quotaRecord(action, cred, status, code, usage);
  if (code === 'ok' && !quota.observed) {
    quota.code = 'quota_or_key';
    return { ok: false, code: 'quota_or_key', quota: quota };
  }
  return { ok: code === 'ok', code: code, quota: quota };
}

function appendQuota(file, quota) {
  if (!file || !quota) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(quota) + '\n');
}

module.exports = {
  charge,
  appendQuota,
  fixtureUrl,
  classify,
  usageOf,
  loadTransport,
};
