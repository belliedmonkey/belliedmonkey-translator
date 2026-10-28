#!/usr/bin/env node
// agent/mcp-stdio.js — BelliedMonkey stdio MCP (daily default).
//
// Start: `node agent/mcp-stdio.js` or `npm run agent:mcp`.
// stdout is JSON-RPC only. Logs go to stderr.
// Remote MCP is not served here. Tool names are the N25 action ids.
'use strict';

const fs = require('fs');
const { TOOLS, TRACK, schemeForFlavor } = require('./contract');
const {
  buildConfirmCard, elicitationMessage, elicitationSchema, decisionFromElicitation, needsConfirm,
} = require('./confirm');
const { callerIdOf } = require('./parse');
const { loadGrants, grantsFile, saveGrants } = require('./grants');
const { create: createTestHost } = require('./test-host');
const {
  runAgentAction, cancelledReceipt, needConfirmReceipt, preconditions,
} = require('./run');

const PROTOCOL_FALLBACK = '2025-06-18';

function stderr(line) {
  try { process.stderr.write(line + '\n'); } catch (_) {}
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

let protocolVersion = PROTOCOL_FALLBACK;
let clientElicitation = false;
const pending = new Map();
let nextId = 1;
let chain = Promise.resolve();

function requestClient(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function schemeNow() {
  return schemeForFlavor(process.env.MT_FLAVOR === 'china' ? 'china' : 'global');
}

function testHost() {
  if (process.env.MT_AGENT_TEST_HOST !== '1') return null;
  return createTestHost(process.env.MT_AGENT_EFFECT_LOG);
}

function readinessNow() {
  const host = testHost();
  if (host) return host.readiness;
  const file = process.env.MT_AGENT_READINESS;
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const keys = ['login', 'packs', 'engine', 'os', 'ext', 'mic', 'studyCapture'];
    const out = {};
    for (const k of keys) {
      if (parsed[k] === true || parsed[k] === false) out[k] = parsed[k];
      else out[k] = null;
    }
    return out;
  } catch (_) {
    return null;
  }
}

function portsNow() {
  const host = testHost();
  if (host) return host.ports;
  return {};
}

function siteSupportedNow() {
  if (process.env.MT_AGENT_TEST_HOST === '1' && process.env.MT_AGENT_SITE === 'no') {
    return function () { return false; };
  }
  return null;
}

function toolText(receipt) {
  return {
    content: [{ type: 'text', text: JSON.stringify(receipt) }],
    isError: false,
  };
}

async function elicit(card) {
  if (!clientElicitation) return null;
  try {
    const params = {
      message: elicitationMessage(card),
      requestedSchema: elicitationSchema(card),
    };
    if (protocolVersion >= '2025-06-18') params.mode = 'form';
    const res = await requestClient('elicitation/create', params);
    return decisionFromElicitation(res, card);
  } catch (_) {
    return null;
  }
}

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    const err = new Error('unknown tool');
    err.rpc = -32602;
    throw err;
  }
  const query = args && typeof args === 'object' ? Object.assign({}, args) : {};
  // Tool arguments cannot confirm themselves. Drop anything that looks like a bypass.
  delete query.confirmed;
  delete query.allow;
  delete query.grant;
  delete query.content;
  const scheme = schemeNow();
  const file = grantsFile();
  const grants = loadGrants(file);
  const callerId = callerIdOf(query);
  const ctx = {
    query,
    scheme,
    sourceFallback: 'mcp',
    readiness: readinessNow(),
    hostConnected: process.env.MT_AGENT_TEST_HOST === '1' || !!process.env.MT_AGENT_READINESS,
    ports: portsNow(),
    grants,
    persistGrants(next) { saveGrants(next, file); },
    siteSupported: siteSupportedNow(),
    env: process.env,
    confirmed: null,
  };
  const blocked = preconditions(name, ctx);
  if (blocked) return blocked;
  if (needsConfirm(name, grants, callerId)) {
    const card = buildConfirmCard(name, query);
    const decision = await elicit(card);
    if (!decision) return needConfirmReceipt(name, scheme, 'mcp');
    if (!decision.allow) return cancelledReceipt(name);
    ctx.confirmed = decision;
  }
  const out = await runAgentAction(name, ctx);
  return out.receipt;
}

async function onMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  if (msg.method == null && msg.id != null) {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(msg.error);
    else waiter.resolve(msg.result);
    return;
  }
  if (msg.id == null) {
    if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') return;
    return;
  }
  try {
    if (msg.method === 'initialize') {
      const params = msg.params || {};
      protocolVersion = typeof params.protocolVersion === 'string' && params.protocolVersion
        ? params.protocolVersion : PROTOCOL_FALLBACK;
      const caps = params.capabilities || {};
      clientElicitation = !!caps.elicitation;
      result(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'belliedmonkey', version: TRACK },
        instructions: 'Local stdio MCP for BelliedMonkey Translator. This is the daily default. A remote MCP is not published. Tool names are the N25 action ids, including ready.check. Sensitive tools confirm on this machine before any microphone, page read, or study-library write. Each result is a receipt JSON object. Receipts omit page text, transcripts, and translations.',
      });
      return;
    }
    if (msg.method === 'ping') {
      result(msg.id, {});
      return;
    }
    if (msg.method === 'tools/list') {
      result(msg.id, { tools: TOOLS });
      return;
    }
    if (msg.method === 'tools/call') {
      const params = msg.params || {};
      const receipt = await callTool(params.name, params.arguments);
      result(msg.id, toolText(receipt));
      return;
    }
    error(msg.id, -32601, 'method not found');
  } catch (err) {
    const code = err && err.rpc ? err.rpc : -32603;
    const message = code === -32602 ? 'unknown tool' : 'internal error';
    stderr('mcp ' + message);
    error(msg.id, code, message);
  }
}

function enqueue(msg) {
  chain = chain.then(() => onMessage(msg)).catch((err) => {
    stderr('mcp loop ' + (err && err.message ? 'failed' : 'failed'));
  });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).replace(/\r$/, '');
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (_) { stderr('mcp ignored a non-json line'); continue; }
    if (msg && msg.method == null && msg.id != null) {
      onMessage(msg);
      continue;
    }
    enqueue(msg);
  }
});
process.stdin.on('end', () => {
  chain.then(() => process.exit(0));
});
