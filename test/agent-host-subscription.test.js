// test/agent-host-subscription.test.js — ARCH-SHORT host-subscription-cli-wire §6.
//
// E1 host_key calls the provider, usage is observed, the receipt stays secret-free.
// E2 host_subscription that cannot pay returns subscription_cannot_pay and does
//    not fall through to the host API key or the Bellied Monkey grant.
// E3 a non-empty OAuth token is not a silent grant: the provider is asked, a
//    refusal is not ok, and capture_to_study / start_live_subtitles do not bill.
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { describe, test, ok, eq } = require('./harness');
const { charge, fixtureUrl, loadTransport } = require('../agent/host-transport');
const confirm = require('../agent/confirm');

const ROOT = path.join(__dirname, '..');
const KEY = 'sk-test-host-key';
const SUB = 'sub-token-should-not-leak';
const OTHER = 'key-should-not-be-used';
const OAUTH = 'oauth-token-should-not-leak';
const SENTENCE = 'The harbor is quiet today.';
const PAGE = 'https://page-token-not-for-provider.example/a';
const VIDEO = 'https://video-token-not-for-provider.example/b';
const REPLY = 'OK-FROM-PROVIDER';

const HOST_ENV = [
  'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_ACCESS_TOKEN', 'CODEX_ACCESS_TOKEN', 'DEEPSEEK_AUTH_TOKEN',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'DEEPSEEK_API_KEY',
  'MT_AGENT_TEST_HOST', 'MT_AGENT_TRANSPORT_FIXTURE', 'MT_AGENT_READINESS',
  'MT_AGENT_QUOTA_LOG', 'MT_AGENT_EFFECT_LOG', 'MT_AGENT_SITE', 'MT_AGENT_HOME',
];

function childEnv(extra) {
  const env = Object.assign({}, process.env);
  for (let i = 0; i < HOST_ENV.length; i++) delete env[HOST_ENV[i]];
  return Object.assign(env, extra);
}

function listen(onRequest) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => onRequest(req, body, res));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function prepare(home, readiness) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'grants.json'), JSON.stringify({
    device: {
      translate_page: true,
      translate_video_captions: true,
      explain_or_drill: true,
      capture_to_study: true,
      start_live_subtitles: true,
    },
    assistants: {},
  }));
  const readyFile = path.join(home, 'readiness.json');
  fs.writeFileSync(readyFile, JSON.stringify(readiness));
  return readyFile;
}

function mcp(env) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'agent/mcp-stdio.js')], {
    env: env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  let seq = 0;
  const waiters = new Map();
  const stderr = [];
  proc.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const waiter = waiters.get(msg.id);
      if (waiter) { waiters.delete(msg.id); waiter(msg); }
    }
  });
  return {
    proc: proc,
    stderr: stderr,
    request(method, params) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('timeout ' + method + ' ' + stderr.join('').slice(0, 400)));
        }, 8000);
        waiters.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    stop() { proc.kill('SIGTERM'); },
  };
}

async function handshake(client) {
  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'host-sub-e2e', version: '0' },
  });
}

function receiptOf(msg) {
  return JSON.parse(msg.result.content[0].text);
}

function quotaLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function noSecret(text, label) {
  ok(!text.includes(KEY), label + ' leaked host key');
  ok(!text.includes(SUB), label + ' leaked subscription');
  ok(!text.includes(OTHER), label + ' leaked other key');
  ok(!text.includes(OAUTH), label + ' leaked oauth');
}

const READY = {
  login: false,
  packs: true,
  engine: false,
  os: true,
  ext: true,
  mic: true,
  studyCapture: true,
  grant: true,
  byok: false,
};

describe('ARCH-SHORT host-subscription-cli-wire §6', () => {
  test('E1 host_key meters translate_page, captions, and explain', async () => {
    const seen = [];
    const server = await listen((req, body, res) => {
      seen.push({
        path: req.url,
        auth: req.headers.authorization || '',
        body: body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: REPLY } }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }));
    });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-e1-'));
    const quotaFile = path.join(home, 'quota.log');
    const port = server.address().port;
    const client = mcp(childEnv({
      MT_AGENT_HOME: home,
      MT_AGENT_READINESS: prepare(home, READY),
      MT_AGENT_QUOTA_LOG: quotaFile,
      MT_AGENT_TRANSPORT_FIXTURE: 'http://127.0.0.1:' + port + '/v1/chat/completions',
      DEEPSEEK_API_KEY: KEY,
    }));
    try {
      await handshake(client);
      const page = receiptOf(await client.request('tools/call', {
        name: 'translate_page', arguments: { url: PAGE },
      }));
      const caps = receiptOf(await client.request('tools/call', {
        name: 'translate_video_captions', arguments: { url: VIDEO },
      }));
      const explained = receiptOf(await client.request('tools/call', {
        name: 'explain_or_drill', arguments: { text: SENTENCE, mode: 'explain' },
      }));
      eq(page.code, 'ok');
      eq(caps.code, 'ok');
      eq(explained.code, 'ok');
      eq(seen.length, 3);
      const deepseek = loadTransport().providers.find((row) => row.id === 'deepseek');
      for (let i = 0; i < seen.length; i++) {
        eq(seen[i].auth, 'Bearer ' + KEY);
        eq(seen[i].path, '/v1/chat/completions');
        const body = JSON.parse(seen[i].body);
        eq(body.model, deepseek.defaultModel);
        ok(!seen[i].body.includes(PAGE), 'page url was sent to the provider');
        ok(!seen[i].body.includes(VIDEO), 'video url was sent to the provider');
      }
      ok(seen[0].body.includes('Hi.'));
      ok(seen[1].body.includes('Hi.'));
      ok(seen[2].body.includes(SENTENCE));
      const lines = quotaLines(quotaFile);
      eq(lines.length, 3);
      eq(lines[0].action, 'translate_page');
      eq(lines[1].action, 'translate_video_captions');
      eq(lines[2].action, 'explain_or_drill');
      for (let i = 0; i < lines.length; i++) {
        eq(lines[i].kind, 'host_key');
        eq(lines[i].via, 'DEEPSEEK_API_KEY');
        eq(lines[i].provider, 'deepseek');
        eq(lines[i].observed, true);
        eq(lines[i].http, 200);
        eq(lines[i].prompt_tokens, 3);
        eq(lines[i].completion_tokens, 1);
        eq(lines[i].total_tokens, 4);
      }
      const dumped = JSON.stringify({ page, caps, explained, lines });
      noSecret(dumped, 'E1');
      ok(!dumped.includes(SENTENCE), 'sentence echoed onto the receipt or quota log');
      ok(!dumped.includes(REPLY), 'provider text echoed onto the receipt');
      ok(!dumped.includes(PAGE));
    } finally {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('E2 subscription that cannot pay does not fall through to a key or the grant', async () => {
    const seen = [];
    const server = await listen((req, body, res) => {
      seen.push({ auth: req.headers.authorization || '', body: body });
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'insufficient_quota', message: 'billing' } }));
    });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-e2-'));
    const quotaFile = path.join(home, 'quota.log');
    const port = server.address().port;
    const client = mcp(childEnv({
      MT_AGENT_HOME: home,
      MT_AGENT_READINESS: prepare(home, READY),
      MT_AGENT_QUOTA_LOG: quotaFile,
      MT_AGENT_TRANSPORT_FIXTURE: 'http://127.0.0.1:' + port + '/v1/chat/completions',
      DEEPSEEK_AUTH_TOKEN: SUB,
      DEEPSEEK_API_KEY: OTHER,
    }));
    try {
      await handshake(client);
      const explained = receiptOf(await client.request('tools/call', {
        name: 'explain_or_drill', arguments: { text: SENTENCE, mode: 'explain' },
      }));
      const page = receiptOf(await client.request('tools/call', {
        name: 'translate_page', arguments: { url: PAGE },
      }));
      eq(explained.ok, false);
      eq(explained.code, 'subscription_cannot_pay');
      eq(explained.message, '本机额度或密钥不可用');
      eq(page.code, 'subscription_cannot_pay');
      ok(explained.fix.open_setup.includes('step=engine'));
      ok(!explained.fix.open_setup.includes('step=login'));
      eq(confirm.failureCard(explained.code).code, 'grant_or_key_unavailable');
      eq(seen.length, 2);
      eq(seen[0].auth, 'Bearer ' + SUB);
      eq(seen[1].auth, 'Bearer ' + SUB);
      ok(!seen[0].auth.includes(OTHER));
      ok(!seen[1].body.includes(OTHER));
      const lines = quotaLines(quotaFile);
      eq(lines.length, 2);
      eq(lines[0].kind, 'host_subscription');
      eq(lines[0].via, 'DEEPSEEK_AUTH_TOKEN');
      eq(lines[0].code, 'subscription_cannot_pay');
      eq(lines[0].observed, false);
      eq(lines[0].http, 401);
      noSecret(JSON.stringify({ explained, page, lines }), 'E2');
      ok(!JSON.stringify(explained).includes(SENTENCE));
    } finally {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('E3 OAuth alone is not a silent grant, and capture does not bill', async () => {
    const seen = [];
    const server = await listen((req, body, res) => {
      seen.push({
        path: req.url,
        apiKey: req.headers['x-api-key'] || '',
        auth: req.headers.authorization || '',
        body: body,
      });
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'authentication_error' } }));
    });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-e3-'));
    const quotaFile = path.join(home, 'quota.log');
    const port = server.address().port;
    const client = mcp(childEnv({
      MT_AGENT_HOME: home,
      MT_AGENT_READINESS: prepare(home, READY),
      MT_AGENT_QUOTA_LOG: quotaFile,
      MT_AGENT_TRANSPORT_FIXTURE: 'http://127.0.0.1:' + port + '/v1/messages',
      ANTHROPIC_AUTH_TOKEN: OAUTH,
    }));
    try {
      await handshake(client);
      const explained = receiptOf(await client.request('tools/call', {
        name: 'explain_or_drill', arguments: { text: SENTENCE, mode: 'drill' },
      }));
      eq(explained.ok, false);
      eq(explained.code, 'subscription_cannot_pay');
      eq(seen.length, 1);
      eq(seen[0].path, '/v1/messages');
      eq(seen[0].apiKey, OAUTH);
      eq(seen[0].auth, '');
      ok(seen[0].body.includes(SENTENCE));
      const claude = loadTransport().providers.find((row) => row.id === 'claude');
      eq(JSON.parse(seen[0].body).model, claude.defaultModel);

      const captured = receiptOf(await client.request('tools/call', {
        name: 'capture_to_study', arguments: { text: SENTENCE },
      }));
      eq(seen.length, 1);
      eq(captured.code, 'need_app');
      eq(captured.ok, false);
      ok(!JSON.stringify(captured).includes(SENTENCE));

      const live = receiptOf(await client.request('tools/call', {
        name: 'start_live_subtitles', arguments: {},
      }));
      eq(seen.length, 1);
      eq(live.code, 'need_app');
      const lines = quotaLines(quotaFile);
      eq(lines.length, 1);
      eq(lines[0].kind, 'host_subscription');
      eq(lines[0].via, 'ANTHROPIC_AUTH_TOKEN');
      eq(lines[0].provider, 'anthropic');
      eq(lines[0].code, 'subscription_cannot_pay');
      noSecret(JSON.stringify({ explained, captured, live, lines }), 'E3');

      const docs = [
        'agent/hosts/README.md',
        'agent/hosts/codex/README.md',
        'agent/hosts/dsh/README.md',
        'agent/hosts/claude-code/skills/belliedmonkey/SKILL.md',
        'agent/hosts/dsh/skills/belliedmonkey/SKILL.md',
      ];
      for (let i = 0; i < docs.length; i++) {
        const text = fs.readFileSync(path.join(ROOT, docs[i]), 'utf8');
        ok(text.includes('subscription_cannot_pay'), docs[i]);
        ok(text.includes('不是成功') || text.includes('not a grant and is not success'), docs[i]);
        ok(!text.includes('runs these tools without a Bellied Monkey grant'), docs[i]);
      }
    } finally {
      client.stop();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('host_key rejection stays quota_or_key and a 200 without usage is not paid', async () => {
    const calls = [];
    async function fakeFetch(url, opts) {
      calls.push({ url: url, opts: opts });
      const status = calls.length === 1 ? 401 : 200;
      const json = calls.length === 1
        ? { error: { code: 'invalid_api_key' } }
        : { choices: [{ message: { content: REPLY } }] };
      return {
        status: status,
        async text() { return JSON.stringify(json); },
      };
    }
    const env = { DEEPSEEK_API_KEY: KEY };
    const cred = { kind: 'host_key', via: 'DEEPSEEK_API_KEY', host: 'dsh', provider: 'deepseek' };
    const rejected = await charge({
      action: 'explain_or_drill',
      cred: cred,
      env: env,
      text: SENTENCE,
      fetch: fakeFetch,
    });
    eq(rejected.ok, false);
    eq(rejected.code, 'quota_or_key');
    eq(rejected.quota.observed, false);
    ok(!JSON.stringify(rejected).includes(KEY));
    ok(!JSON.stringify(rejected).includes(SENTENCE));
    const unpaid = await charge({
      action: 'translate_page',
      cred: cred,
      env: env,
      fetch: fakeFetch,
    });
    eq(unpaid.ok, false);
    eq(unpaid.code, 'quota_or_key');
    eq(unpaid.quota.observed, false);
    eq(calls.length, 2);
    eq(fixtureUrl({ MT_AGENT_TRANSPORT_FIXTURE: 'https://example.com/v1/chat/completions' }), '');
    eq(fixtureUrl({ MT_AGENT_TRANSPORT_FIXTURE: 'http://127.0.0.1:9/v1/messages' }), 'http://127.0.0.1:9/v1/messages');
  });
});
