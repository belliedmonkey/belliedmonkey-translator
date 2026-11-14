// build/backend-inject.js — resolve the sync backend host / anon key at build time.
//
// BEL-172 (P0 scrub): the OSS tree must not carry a real backend host or anon key.
// `extension/learn/backend.config.js` ships inert placeholders; this module replaces them
// with values from the environment (or a gitignored `.local/backend.env`) when building.
//
// Order of precedence:
//   1. process.env: MT_BACKEND_URL / MT_BACKEND_ANON_KEY
//                   MT_CHINA_BACKEND_URL / MT_CHINA_BACKEND_ANON_KEY / MT_CHINA_RELAY_URL
//   2. .local/backend.env (KEY=VALUE lines; gitignored — the maintainer's machine)
//   3. leave the placeholder (an un-injected build points at *.invalid on purpose)
//
// Safety: a `service_role` JWT is refused, not injected. A key that must stay secret never
// belongs in a client bundle; this module makes that a build error rather than a comment.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const SENTINEL = {
  url: 'https://backend.invalid',
  anonKey: 'PUBLIC_ANON_KEY_INJECTED_AT_BUILD',
  chinaUrl: 'https://cn.backend.invalid',
  chinaAnonKey: 'PUBLIC_CN_ANON_KEY_INJECTED_AT_BUILD',
  chinaRelay: 'https://relay.invalid',
};

// Every inert constant from the source. A shipped artifact may not carry any of them
// as its ACTIVE url/anonKey.
const PLACEHOLDERS = new Set(Object.values(SENTINEL));

const ENV = {
  url: 'MT_BACKEND_URL',
  anonKey: 'MT_BACKEND_ANON_KEY',
  chinaUrl: 'MT_CHINA_BACKEND_URL',
  chinaAnonKey: 'MT_CHINA_BACKEND_ANON_KEY',
  chinaRelay: 'MT_CHINA_RELAY_URL',
};

// BEL-259: the only escape hatch, and it is for local preview. The string must be
// exactly "1"; anything else is treated as absent. `placeholderMode()` also answers
// the release-context question so build.js can refuse it before it writes anything.
const PLACEHOLDER_ENV = 'MT_ALLOW_PLACEHOLDER_BACKEND';

function envTruthy(v) {
  return typeof v === 'string' && v.trim() !== '' && !/^(0|false|no|off)$/i.test(v.trim());
}

function releaseReason(env = process.env) {
  if (envTruthy(env.CI)) return `CI=${env.CI}`;
  if (env.MT_RELEASE === '1') return 'MT_RELEASE=1';
  const ctx = String(env.MT_BUILD_CONTEXT || '').trim();
  if (/^(release|store|upload|publish|tf|prod|production)\b/i.test(ctx)) {
    return `MT_BUILD_CONTEXT=${ctx}`;
  }
  const lifecycle = String(env.npm_lifecycle_event || '').trim();
  if (/^(release|publish|upload)/i.test(lifecycle)) {
    return `npm_lifecycle_event=${lifecycle}`;
  }
  return null;
}

function placeholderMode(env = process.env) {
  const raw = env[PLACEHOLDER_ENV];
  if (raw !== '1') return { enabled: false, refused: null, raw: raw === undefined ? null : raw };
  return { enabled: true, refused: releaseReason(env), raw };
}

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

function jwtPayload(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_) {
    return null;
  }
}

function jwtRole(key) {
  const payload = jwtPayload(key);
  return payload && typeof payload.role === 'string' ? payload.role : null;
}

function sha8(value) {
  return value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8) : 'none';
}

function hostOf(value) {
  try { return new URL(String(value)).hostname.toLowerCase(); } catch (_) { return ''; }
}

function checkUrl(value, name) {
  let u;
  try { u = new URL(value); } catch (_) { throw new Error(`${name} is not a valid URL`); }
  if (u.protocol !== 'https:') throw new Error(`${name} must be https`);
  if (/\.invalid$/i.test(u.hostname)) throw new Error(`${name} still points at an .invalid placeholder`);
  return value;
}

function checkAnonKey(value, name) {
  if (/service_role/i.test(value)) {
    throw new Error(`${name} looks like a service_role key — never inject that into a client build`);
  }
  const role = jwtRole(value);
  if (role && role !== 'anon') {
    throw new Error(`${name} has JWT role=${role}; only a publishable anon key may be injected`);
  }
  return value;
}

function resolve(root, env = process.env) {
  const file = parseEnvFile(path.join(root, '.local', 'backend.env'));
  const pick = (k) => {
    const key = ENV[k];
    const v = env[key];
    if (typeof v === 'string' && v.trim()) return { value: v.trim(), source: 'env' };
    const f = file[key];
    if (typeof f === 'string' && f.trim()) return { value: f.trim(), source: 'file' };
    return { value: '', source: 'none' };
  };
  const picked = Object.fromEntries(Object.keys(ENV).map((k) => [k, pick(k)]));
  const values = Object.fromEntries(Object.entries(picked).map(([k, p]) => [k, p.value]));
  // Where each value came from. Kept alongside the values (not inside them) so the
  // gate can print `env MT_BACKEND_URL` / `file .local/backend.env:…` / `none`
  // without ever printing the value itself.
  values.sources = Object.fromEntries(Object.entries(picked).map(([k, p]) => [k, p.source]));
  if (values.url) checkUrl(values.url, ENV.url);
  if (values.anonKey) checkAnonKey(values.anonKey, ENV.anonKey);
  if (values.chinaUrl) checkUrl(values.chinaUrl, ENV.chinaUrl);
  if (values.chinaAnonKey) checkAnonKey(values.chinaAnonKey, ENV.chinaAnonKey);
  if (values.chinaRelay) checkUrl(values.chinaRelay, ENV.chinaRelay);
  if (values.url && values.chinaUrl && values.url === values.chinaUrl) {
    throw new Error(`${ENV.url} and ${ENV.chinaUrl} are identical — the two flavors must not share a backend`);
  }
  if (values.anonKey && values.chinaAnonKey && values.anonKey === values.chinaAnonKey) {
    throw new Error(`${ENV.anonKey} and ${ENV.chinaAnonKey} are identical — a token from one backend is not valid on the other`);
  }
  values.injected = Boolean(values.url || values.anonKey || values.chinaUrl || values.chinaAnonKey || values.chinaRelay);
  return values;
}

function replaceOnce(text, from, to, label) {
  const parts = text.split(from);
  if (parts.length !== 2) {
    throw new Error(`backend-inject: ${label} placeholder appears ${parts.length - 1} time(s), expected exactly 1`);
  }
  return parts[0] + to + parts[1];
}

function apply(text, values) {
  let out = text;
  const pairs = [
    [SENTINEL.url, values.url, 'MT_BACKEND_URL'],
    [SENTINEL.anonKey, values.anonKey, 'MT_BACKEND_ANON_KEY'],
    [SENTINEL.chinaUrl, values.chinaUrl, 'MT_CHINA_BACKEND_URL'],
    [SENTINEL.chinaAnonKey, values.chinaAnonKey, 'MT_CHINA_BACKEND_ANON_KEY'],
    [SENTINEL.chinaRelay, values.chinaRelay, 'MT_CHINA_RELAY_URL'],
  ];
  for (const [from, to, label] of pairs) {
    if (to) out = replaceOnce(out, from, to, label);
  }
  return out;
}

function configPath(root) {
  return path.join(root, 'extension', 'learn', 'backend.config.js');
}

// Load the injected config into the require cache so build.js and every registry that
// does `require('../extension/learn/backend.config.js')` sees the same values.
function install(root) {
  const values = resolve(root);
  const file = configPath(root);
  const text = apply(fs.readFileSync(file, 'utf8'), values);
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(text, file);
  require.cache[file] = m;
  return { values, config: m.exports };
}

// Rewrite the copied dist config with injected values (used right after copyDir).
function applyToDir(dir, root) {
  const values = resolve(root);
  const file = path.join(dir, 'learn', 'backend.config.js');
  const text = apply(fs.readFileSync(configPath(root), 'utf8'), values);
  fs.writeFileSync(file, text);
  return values;
}

// ─── BEL-259: shipped-backend gate ──────────────────────────────────────────
//
// Policy, not resolution: this runs at the build entry, before any artifact is
// written, and refuses a build whose ACTIVE backend is still a placeholder.
//
// Active fields only, by flavor:
//   global / firefox → cfg.url / cfg.anonKey
//   china (ready)    → cfg.china.url / cfg.china.anonKey
//   china (!ready)   → cfg.url / cfg.anonKey (sync is off; these are still the
//                      values the artifact would use)
//
// BEL-260: `previousUrl` is deliberately OUTSIDE these criteria. The China build
// writes `previousUrl: 'https://backend.invalid'` as a sentinel meaning "the
// previous backend was not CN"; bindCorpus only compares it, never requests it,
// and never writes it to storage. Treating it as a placeholder here would reject
// the shipped CN sentinel. The public china-gate still scans every *.supabase.co
// host, so leaving previousUrl out of this gate does not weaken that invariant.
function activePair(config, flavor) {
  const cfg = config || {};
  const china = cfg.china || {};
  if (flavor === 'china' && china.ready === true) {
    return {
      kind: 'china',
      url: china.url,
      anonKey: china.anonKey,
      urlEnv: ENV.chinaUrl,
      anonKeyEnv: ENV.chinaAnonKey,
      sourceUrl: 'chinaUrl',
      sourceAnonKey: 'chinaAnonKey',
    };
  }
  return {
    kind: 'intl',
    url: cfg.url,
    anonKey: cfg.anonKey,
    urlEnv: ENV.url,
    anonKeyEnv: ENV.anonKey,
    sourceUrl: 'url',
    sourceAnonKey: 'anonKey',
  };
}

function sourceFor(values, key, envKey) {
  const sources = values && values.sources;
  return { source: (sources && sources[key]) || 'none', envKey };
}

function checkShippable(config, opts = {}) {
  const flavor = opts.flavor === 'china' ? 'china' : 'global';
  const active = activePair(config, flavor);
  const values = opts.values || {};
  const result = {
    ok: true,
    flavor,
    active: active.kind,
    host: '',
    anonKeySha8: 'none',
    sources: {
      url: sourceFor(values, active.sourceUrl, active.urlEnv),
      anonKey: sourceFor(values, active.sourceAnonKey, active.anonKeyEnv),
    },
    violations: [],
    warnings: [],
  };
  const add = (kind, message) => result.violations.push({ kind, message });
  const url = String(active.url || '').trim();
  const key = String(active.anonKey || '').trim();

  let u = null;
  if (!url) {
    add('placeholder', `${active.urlEnv} is empty`);
  } else {
    try { u = new URL(url); } catch (_) { add('invalid', `${active.urlEnv} is not a valid URL`); }
    if (u) {
      result.host = u.hostname.toLowerCase();
      // A placeholder URL is also `.invalid`; keep one message, not two.
      if (PLACEHOLDERS.has(url)) add('placeholder', `${active.urlEnv} equals a build placeholder constant`);
      else if (/\.invalid$/i.test(result.host)) {
        add('placeholder', `${active.urlEnv} still points at an .invalid placeholder (${result.host})`);
      }
    }
  }

  if (!key) {
    add('placeholder', `${active.anonKeyEnv} is empty`);
  } else {
    result.anonKeySha8 = sha8(key);
    if (PLACEHOLDERS.has(key)) add('placeholder', `${active.anonKeyEnv} equals a build placeholder constant`);
  }

  // Same-origin check: a supabase URL needs a JWT with a matching `ref`; a
  // non-supabase URL must not carry a supabase `ref`. A non-JWT key is not
  // rejected by itself (the CN backend's key shape is not ours to assume) —
  // only the mismatch we can actually prove is.
  if (u && key && !PLACEHOLDERS.has(key)) {
    const payload = jwtPayload(key);
    const host = u.hostname.toLowerCase();
    if (/(^|\.)supabase\.co$/i.test(host)) {
      const ref = host.split('.')[0];
      if (!payload) add('origin', `${active.anonKeyEnv} is not a JWT — cannot prove it belongs to project ${ref}`);
      else if (!payload.ref) add('origin', `${active.anonKeyEnv} has no JWT ref — expected project ${ref}`);
      else if (payload.ref !== ref) add('origin', `${active.anonKeyEnv} JWT ref ${payload.ref} != supabase project ${ref}`);
    } else if (payload && payload.ref) {
      add('origin', `${active.anonKeyEnv} carries a supabase JWT ref (${payload.ref}) but ${active.urlEnv} is not a supabase host`);
    }
  }

  if (opts.allowPlaceholder) {
    // Local preview only: placeholders are tolerated, but a provable
    // cross-backend mix is still a failure.
    result.warnings = result.violations.filter((v) => v.kind === 'placeholder');
    result.violations = result.violations.filter((v) => v.kind !== 'placeholder');
  }
  result.ok = result.violations.length === 0;
  return result;
}

function sourceLabel(s) {
  if (s.source === 'env') return `env ${s.envKey}`;
  if (s.source === 'file') return `file .local/backend.env:${s.envKey}`;
  return `none (${s.envKey} not set)`;
}

function formatShippableFailure(result) {
  const lines = [
    `backend gate FAILED — flavor=${result.flavor} (${result.active}); this build must not ship`,
    `  url: ${result.host || '(none)'}  source=${sourceLabel(result.sources.url)}`,
    `  anonKey: sha256:${result.anonKeySha8}  source=${sourceLabel(result.sources.anonKey)}`,
  ];
  for (const v of result.violations) lines.push(`  · ${v.message}`);
  return lines.join('\n');
}

function assertShippable(config, opts = {}) {
  const result = checkShippable(config, opts);
  if (!result.ok) {
    const e = new Error(formatShippableFailure(result));
    e.result = result;
    throw e;
  }
  return result;
}

module.exports = {
  install,
  applyToDir,
  apply,
  resolve,
  checkShippable,
  assertShippable,
  formatShippableFailure,
  placeholderMode,
  releaseReason,
  jwtPayload,
  jwtRole,
  sha8,
  hostOf,
  SENTINEL,
  PLACEHOLDERS,
  ENV,
  PLACEHOLDER_ENV,
  parseEnvFile,
};
