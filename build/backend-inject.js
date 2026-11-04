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
const Module = require('module');

const SENTINEL = {
  url: 'https://backend.invalid',
  anonKey: 'PUBLIC_ANON_KEY_INJECTED_AT_BUILD',
  chinaUrl: 'https://cn.backend.invalid',
  chinaAnonKey: 'PUBLIC_CN_ANON_KEY_INJECTED_AT_BUILD',
  chinaRelay: 'https://relay.invalid',
};

const ENV = {
  url: 'MT_BACKEND_URL',
  anonKey: 'MT_BACKEND_ANON_KEY',
  chinaUrl: 'MT_CHINA_BACKEND_URL',
  chinaAnonKey: 'MT_CHINA_BACKEND_ANON_KEY',
  chinaRelay: 'MT_CHINA_RELAY_URL',
};

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

function jwtRole(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload.role === 'string' ? payload.role : null;
  } catch (_) {
    return null;
  }
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
    const v = env[ENV[k]];
    if (typeof v === 'string' && v.trim()) return v.trim();
    const f = file[ENV[k]];
    return typeof f === 'string' && f.trim() ? f.trim() : '';
  };
  const values = {
    url: pick('url'),
    anonKey: pick('anonKey'),
    chinaUrl: pick('chinaUrl'),
    chinaAnonKey: pick('chinaAnonKey'),
    chinaRelay: pick('chinaRelay'),
  };
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

module.exports = { install, applyToDir, apply, resolve, SENTINEL, ENV, jwtRole, parseEnvFile };
