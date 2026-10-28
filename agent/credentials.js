// agent/credentials.js — which engine path can run an agent tool.
//
// Host subscription and host API key are first-class (t291u). In-app BYOK is
// the same class. The Bellied Monkey grant is auxiliary: it can run a tool,
// and it is never the only way. This module does not read secrets and does
// not return secret values. `via` is an environment-variable name or a tag.
'use strict';

const HOST_SUBSCRIPTION = Object.freeze([
  ['ANTHROPIC_AUTH_TOKEN', 'claude-code', 'anthropic'],
  ['CLAUDE_CODE_OAUTH_TOKEN', 'claude-code', 'anthropic'],
  ['OPENAI_ACCESS_TOKEN', 'codex', 'openai'],
  ['CODEX_ACCESS_TOKEN', 'codex', 'openai'],
  ['DEEPSEEK_AUTH_TOKEN', 'dsh', 'deepseek'],
]);

const HOST_KEYS = Object.freeze([
  ['ANTHROPIC_API_KEY', 'claude-code', 'anthropic'],
  ['OPENAI_API_KEY', 'codex', 'openai'],
  ['CODEX_API_KEY', 'codex', 'openai'],
  ['DEEPSEEK_API_KEY', 'dsh', 'deepseek'],
]);

function filled(env, name) {
  const value = env && env[name];
  return typeof value === 'string' && value.trim() !== '';
}

function fromTable(env, table, kind) {
  for (let i = 0; i < table.length; i++) {
    const row = table[i];
    if (filled(env, row[0])) {
      return { kind: kind, via: row[0], host: row[1], provider: row[2] };
    }
  }
  return null;
}

function resolveCredential(input) {
  const src = input || {};
  const env = src.env || {};
  const readiness = src.readiness || {};
  const subscription = fromTable(env, HOST_SUBSCRIPTION, 'host_subscription');
  if (subscription) return subscription;
  const key = fromTable(env, HOST_KEYS, 'host_key');
  if (key) return key;
  if (readiness.byok === true) return { kind: 'byok', via: 'app', host: '', provider: '' };
  if (readiness.grant === true) return { kind: 'grant', via: 'grant', host: '', provider: '' };
  if (readiness.engine === true && readiness.grant !== true) {
    return { kind: 'byok', via: 'app', host: '', provider: '' };
  }
  return { kind: 'none', via: '', host: '', provider: '' };
}

// Host subscription, host API key, and in-app BYOK do not need an account.
function runsWithoutAccount(cred) {
  const kind = cred && cred.kind;
  return kind === 'host_subscription' || kind === 'host_key' || kind === 'byok';
}

function engineReady(cred) {
  return !!(cred && cred.kind && cred.kind !== 'none');
}

function publicAuth(cred) {
  const c = cred || { kind: 'none', via: '', host: '', provider: '' };
  return { kind: c.kind, via: c.via, host: c.host, provider: c.provider };
}

module.exports = {
  HOST_SUBSCRIPTION,
  HOST_KEYS,
  resolveCredential,
  runsWithoutAccount,
  engineReady,
  publicAuth,
};
