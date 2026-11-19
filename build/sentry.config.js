// build/sentry.config.js — BEL-303 build-time crash config (mirror backend-inject.js).
//
// The source keeps a `.invalid` placeholder only. The global build injects the public
// write key from the environment (or a gitignored `.local/sentry.env`); the China
// build always injects an empty DSN, so `MTCrash.init()` cannot emit a single request.
//
// Never print the DSN. This module's logs/errors only say "set" / "empty".
'use strict';

const fs = require('fs');
const path = require('path');

// The exact one-line placeholder in src/lib/crash.js. build/sentry-inject.js replaces
// the whole line; a source edit that changes it must fail loudly, not silently ship
// the placeholder.
const CONFIG_PREFIX = 'var CONFIG = ';
const PLACEHOLDER = {
  dsn: 'https://public@crash.invalid/1',
  release: '0.0.0',
  flavor: 'global',
  environment: 'production',
};
const ENV_DSN = 'MT_SENTRY_DSN';
const ENV_FILE = ['.local', 'sentry.env'];

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

function dsnFromEnv(root, env) {
  const direct = env[ENV_DSN];
  if (typeof direct === 'string' && direct.trim()) return { value: direct.trim(), source: 'env' };
  const file = parseEnvFile(path.join(root, ...ENV_FILE));
  const v = file[ENV_DSN];
  if (typeof v === 'string' && v.trim()) return { value: v.trim(), source: 'file' };
  return { value: '', source: 'none' };
}

function validDsn(dsn) {
  try {
    const u = new URL(String(dsn));
    if (u.protocol !== 'https:') return false;
    if (!u.username) return false;
    if (!/^\d+$/.test(u.pathname.replace(/^\//, ''))) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// flavor=china ⇒ always empty (defence in depth on top of the CN compliance gate).
// flavor=global with no DSN ⇒ empty: an unconfigured preview must not try to reach
// the inert `.invalid` placeholder at runtime.
function resolve(root, flavor, env) {
  const e = env || process.env;
  const cn = flavor === 'china';
  const picked = cn ? { value: '', source: 'china' } : dsnFromEnv(root, e);
  const dsn = picked.value && validDsn(picked.value) ? picked.value : '';
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    dsn,
    release: String(pkg.version || ''),
    flavor: cn ? 'china' : 'global',
    environment: cn ? 'production' : (e.MT_BUILD_CONTEXT || 'production'),
    source: picked.source,
  };
}

function apply(text, values) {
  const lines = String(text).split('\n');
  let at = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trimStart().startsWith(CONFIG_PREFIX)) {
      if (at !== -1) throw new Error('sentry-inject: CONFIG line appears more than once');
      at = i;
    }
  }
  if (at === -1) throw new Error('sentry-inject: CONFIG line not found in src/lib/crash.js');
  const v = values || {};
  const config = {
    dsn: String(v.dsn || ''),
    release: String(v.release || ''),
    flavor: String(v.flavor || 'global'),
    environment: String(v.environment || 'production'),
  };
  const indent = (lines[at].match(/^\s*/) || [''])[0];
  lines[at] = indent + CONFIG_PREFIX + JSON.stringify(config) + ';';
  return lines.join('\n');
}

module.exports = {
  PLACEHOLDER,
  CONFIG_PREFIX,
  ENV_DSN,
  ENV_FILE,
  resolve,
  apply,
  validDsn,
  parseEnvFile,
};
