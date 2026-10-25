// agent/parse.js — parseAgentDeepLink. Old listen / review / setup URLs return null
// so the existing parser keeps them. Agent links are only /agent/v1/<action>.
'use strict';

const { ACTIONS, SOURCES } = require('./contract');

const KNOWN = new Set(ACTIONS);

function splitParts(url) {
  const host = url.hostname ? [decodeURIComponent(url.hostname)] : [];
  const path = (url.pathname || '').split('/').filter(Boolean).map((seg) => {
    try { return decodeURIComponent(seg); }
    catch (_) { return null; }
  });
  if (path.some((seg) => seg == null)) return null;
  return host.concat(path);
}

function queryOf(url) {
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  return query;
}

function parseAgentDeepLink(input) {
  let url;
  try { url = new URL(String(input || '')); }
  catch (_) { return { error: 'bad_request' }; }
  if (url.protocol !== 'belliedmonkey:' && url.protocol !== 'belliedmonkeycn:') return null;
  const parts = splitParts(url);
  if (!parts) return { error: 'bad_request', scheme: url.protocol.slice(0, -1) };
  if (parts[0] !== 'agent') return null;
  const scheme = url.protocol.slice(0, -1);
  const query = queryOf(url);
  if (parts.length !== 3 || parts[1] !== 'v1' || !parts[2]) {
    return { error: 'bad_request', scheme, query, action: '' };
  }
  const action = parts[2];
  if (!KNOWN.has(action)) {
    return { error: 'unsupported_action', scheme, query, action };
  }
  return { scheme, query, action };
}

function sourceOf(query, fallback) {
  const s = query && query.source;
  if (SOURCES.has(s)) return s;
  return fallback || 'agent';
}

function callerIdOf(query) {
  const id = query && query.caller_id != null ? String(query.caller_id) : '';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) return '';
  return id;
}

function langOf(value) {
  const s = value == null ? '' : String(value);
  if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(s)) return '';
  return s;
}

function hostnameOf(value) {
  const raw = value == null ? '' : String(value);
  if (!raw) return '';
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
    const host = new URL(withScheme).hostname;
    if (!host || host.length > 253 || /[\r\n]/.test(host)) return '';
    return host;
  } catch (_) { return ''; }
}

module.exports = {
  parseAgentDeepLink,
  sourceOf,
  callerIdOf,
  langOf,
  hostnameOf,
};
