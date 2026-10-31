// test/agent-h2.test.js — N25 H2 dsh packaging. The launcher must load the W2
// kernel and advertise the same seven action ids. It must not add a second
// contract, a remote URL, or a Grok/Muse local plugin.
// App / extension end-to-end is not run here: this process has no App host.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { createHash } = require('crypto');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const contract = require('../agent/contract');
const copy = require('../agent/copy');

const DSH = path.join(ROOT, 'agent/hosts/dsh');
const LAUNCHER = path.join(DSH, 'stdio.js');
const SHIM = path.join(DSH, 'index.js');
const SKILL = path.join(DSH, 'skills/belliedmonkey/SKILL.md');
const README = path.join(DSH, 'README.md');
const HOSTS_README = path.join(ROOT, 'agent/hosts/README.md');
const BUNDLE_PATCH = path.join(DSH, 'cordis.patch.yml');
const REPO_PATCH = path.join(DSH, 'repo-mcp.patch.yml');
const PKG = path.join(DSH, 'package.json');
const KERNEL = path.join(ROOT, 'agent/mcp-stdio.js');
const CLAUDE_LAUNCHER = path.join(ROOT, 'agent/hosts/claude-code/stdio.js');

const HONEST = [
  'Local stdio is the daily server.',
  'Remote MCP is later.',
  'A remote MCP is not published.',
  '不要把本进程说成已上架云 MCP',
];

const CODE_FILES = [LAUNCHER, SHIM, PKG, BUNDLE_PATCH, REPO_PATCH];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function toolBullets(md) {
  const parts = md.split(/^## Tools\r?$/m);
  ok(parts.length >= 2, 'skill has no ## Tools section');
  const section = parts[1].split(/^## /m)[0];
  const names = [];
  for (const line of section.split(/\r?\n/)) {
    const m = /^- `([^`]+)`$/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

function publicToolName(serverName, rawName) {
  const joined = 'mcp__' + serverName + '__' + rawName;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_');
  if (normalized === joined && normalized.length <= 64) return normalized;
  const hash = createHash('sha256').update(serverName + '\0' + rawName).digest('hex').slice(0, 12);
  return normalized.slice(0, 64 - 12 - 1) + '_' + hash;
}

function client(script) {
  const proc = spawn(process.execPath, [script], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const stderr = [];
  const waiters = new Map();
  let seq = 0;
  proc.stderr.on('data', (c) => stderr.push(String(c)));
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
  function request(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout ' + method + ' stderr=' + stderr.join(''))), 4000);
      waiters.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  return {
    proc,
    request,
    stop() { proc.kill('SIGTERM'); },
  };
}

async function listedTools(script) {
  const c = client(script);
  try {
    const init = await c.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'h2-test', version: '0' },
    });
    const list = await c.request('tools/list', {});
    return { init, tools: list.result.tools };
  } finally {
    c.stop();
  }
}

describe('agent H2 dsh packaging', () => {
  test('bundle patch and repo overlay launch stdio and declare no tools', () => {
    const pkg = JSON.parse(read(PKG));
    eq(pkg.name, 'belliedmonkey-dsh');
    eq(pkg.version, '1.22.0-n25');
    eq(pkg.private, true);
    eq(pkg.type, 'module');
    deepEq(pkg.dsh, { bundle: { patch: './cordis.patch.yml' } });
    ok(pkg.dependencies == null, 'dsh package must not depend on a second schema');
    // 产品版本。上面的 dsh 包 version 是另一条轨，不跟这里对齐。
    eq(JSON.parse(read(path.join(ROOT, 'package.json'))).version, '1.23.1');

    const bundle = read(BUNDLE_PATCH);
    const repo = read(REPO_PATCH);
    for (const text of [bundle, repo]) {
      ok(text.includes('transport: stdio'));
      ok(text.includes('command: node'));
      ok(text.includes('serverName: belliedmonkey'));
      ok(!/^\s*url\s*:/m.test(text), 'dsh packaging declares a remote URL');
      ok(!/https?:\/\//.test(text));
      ok(!/grok|muse/i.test(text));
    }
    ok(bundle.indexOf('id: belliedmonkey-dsh') < bundle.indexOf('id: mcp-belliedmonkey'));
    ok(bundle.includes('name: belliedmonkey-dsh'));
    ok(bundle.includes("name: '@deepseek-ai/dsh-mcp-client'"));
    ok(bundle.includes('!!js globalThis.__BELLIEDMONKEY_DSH_STDIO'));
    ok(repo.includes('args: ["agent/hosts/dsh/stdio.js"]'));

    const rootMcp = JSON.parse(read(path.join(ROOT, '.mcp.json')));
    ok(!rootMcp.mcpServers.belliedmonkey, 'product server leaked into the developer .mcp.json');
  });

  test('shim and launcher have no tool schema and load agent/mcp-stdio.js', async () => {
    const src = read(LAUNCHER);
    ok(src.includes("join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp-stdio.js')"));
    ok(fs.existsSync(KERNEL));
    const shim = read(SHIM);
    ok(shim.includes('stdio.js'));
    ok(shim.includes('export function apply'));
    for (const file of CODE_FILES) {
      const text = read(file);
      for (const name of contract.ACTIONS) {
        ok(!text.includes(name), path.basename(file) + ' repeats tool ' + name);
      }
      ok(!text.includes('ready_check'), path.basename(file) + ' publishes ready_check');
      ok(!text.includes('inputSchema'), path.basename(file) + ' carries a tool schema');
    }
    const mod = await import(pathToFileURL(SHIM).href);
    eq(mod.name, 'belliedmonkey-dsh');
    eq(globalThis.__BELLIEDMONKEY_DSH_STDIO, LAUNCHER);
    mod.apply();
    eq(globalThis.__BELLIEDMONKEY_DSH_STDIO, LAUNCHER);
  });

  test('skill and install notes name the same seven tools', () => {
    const skill = read(SKILL);
    deepEq(toolBullets(skill), contract.ACTIONS.slice());
    ok(skill.includes('Do not call `ready_check`.'));
    ok(skill.includes('Do not register a tool named `ready_check`.'));
    const mapped = publicToolName('belliedmonkey', 'ready.check');
    ok(skill.includes(mapped), 'skill missing dsh mapping ' + mapped);
    ok(read(README).includes(mapped));
    ok(read(HOSTS_README).includes(mapped));
    for (const name of contract.ACTIONS) {
      if (name === 'ready.check') continue;
      const shown = publicToolName('belliedmonkey', name);
      ok(skill.includes(shown), 'skill missing ' + shown);
      eq(shown, 'mcp__belliedmonkey__' + name);
    }
    for (const file of [SKILL, README, HOSTS_README]) {
      const text = read(file);
      for (const line of HONEST) ok(text.includes(line), path.basename(file) + ' missing: ' + line);
      ok(text.includes(copy.HOST_KEY_HONEST), path.basename(file) + ' missing host-key line');
      ok(!/https?:\/\//.test(text), path.basename(file) + ' has a URL');
    }
    ok(read(README).includes('没有第二份名字 `ready_check`'));
    ok(read(README).includes('没有 H3'));
    ok(/Grok/.test(read(README)) && /Muse/.test(read(README)));
    ok(read(README).includes('OPEN'));
    ok(read(HOSTS_README).includes('dsh plugin --profile <profile> add "$PWD/agent/hosts/dsh"'));
    ok(read(HOSTS_README).includes('dsh --profile <profile> --patch "$PWD/agent/hosts/dsh/repo-mcp.patch.yml"'));
    ok(read(README).includes('ln -sfn "$PWD/agent/hosts/dsh/skills/belliedmonkey"'));
    ok(read(README).includes('本仓库不放置 `.agents/skills`'));
  });

  test('skill surfaces the locked confirm and failure copy', () => {
    const skill = read(SKILL);
    const locked = [
      copy.TITLE,
      copy.ALLOW_ONCE,
      copy.CANCEL,
      copy.FOOTNOTE,
      copy.FAILURE_TITLE,
      copy.ASSISTANT_ALLOW,
      copy.ACTIONS.start_live_subtitles.name,
      copy.ACTIONS.capture_to_study.name,
      copy.deviceAllow(copy.ACTIONS.start_live_subtitles.short),
    ];
    for (const s of locked) ok(skill.includes(s), 'skill missing locked copy: ' + s);
    for (const f of Object.values(copy.FAILURES)) {
      ok(skill.includes(f.line), f.line);
      ok(skill.includes(f.primary), f.primary);
      ok(skill.includes(f.secondary), f.secondary);
    }
    ok(skill.includes('If there is no `caller_id`, that line must not appear.'));
    ok(skill.includes('Banned near-synonyms: 语音包, 收录复习.'));
    ok(skill.includes('do not offer a one-click store install link'));
    ok(skill.includes(copy.HOST_KEY_NOTE));
    ok(skill.includes('需要你在本机点确认'));
  });

  test('dsh stdio lists the same seven tools as the W2 kernel', async () => {
    const dsh = await listedTools(LAUNCHER);
    const kernel = await listedTools(KERNEL);
    const claude = await listedTools(CLAUDE_LAUNCHER);
    eq(dsh.init.result.serverInfo.name, 'belliedmonkey');
    eq(dsh.init.result.serverInfo.version, contract.TRACK);
    ok(/not published/i.test(dsh.init.result.instructions));
    deepEq(dsh.tools.map((t) => t.name), contract.ACTIONS.slice());
    deepEq(dsh.tools, kernel.tools);
    deepEq(dsh.tools, claude.tools);
    deepEq(dsh.tools, contract.TOOLS);

    const c = client(LAUNCHER);
    try {
      await c.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'h2-test', version: '0' },
      });
      const missing = await c.request('tools/call', { name: 'ready_check', arguments: {} });
      eq(missing.error.code, -32602);
      const ready = await c.request('tools/call', { name: 'ready.check', arguments: {} });
      const receipt = JSON.parse(ready.result.content[0].text);
      eq(receipt.action, 'ready.check');
      eq(receipt.code, 'ok');
      deepEq(Object.keys(receipt), contract.RECEIPT_KEYS.slice());
      ok(!ready.result.content[0].text.includes('belliedmonkey://'));
    } finally {
      c.stop();
    }
  });
});
