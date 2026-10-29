// test/agent-h1.test.js — N25 H1 packaging. Wrappers must launch the W2 kernel
// and name the same seven action ids. They must not add a second contract,
// a remote URL, or a Grok/Muse local plugin.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const contract = require('../agent/contract');
const copy = require('../agent/copy');

const LAUNCHER = path.join(ROOT, 'agent/hosts/claude-code/stdio.js');
const SKILL = path.join(ROOT, 'agent/hosts/claude-code/skills/belliedmonkey/SKILL.md');
const HOSTS_README = path.join(ROOT, 'agent/hosts/README.md');
const CODEX_README = path.join(ROOT, 'agent/hosts/codex/README.md');
const CLAUDE_MCP = path.join(ROOT, 'agent/hosts/claude-code/.mcp.json');
const PLUGIN = path.join(ROOT, 'agent/hosts/claude-code/.claude-plugin/plugin.json');
const CODEX_TOML = path.join(ROOT, '.codex/config.toml');

const HONEST = [
  'Local stdio is the daily server.',
  'Remote MCP is later.',
  'A remote MCP is not published.',
  '不要把本进程说成已上架云 MCP',
];

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

function dottedTools(md) {
  const line = md.split(/\r?\n/).find((l) => l.includes('`ready.check` · `open_setup`'));
  ok(line, 'missing the seven-tool line');
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    ok(!/grok|muse/i.test(ent.name), 'packaging path names a Grok/Muse plugin: ' + ent.name);
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
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

describe('agent H1 Claude Code + Codex packaging', () => {
  test('Claude Code plugin and Codex config launch the same stdio file', () => {
    const mcp = JSON.parse(read(CLAUDE_MCP));
    const names = Object.keys(mcp.mcpServers);
    deepEq(names, ['belliedmonkey']);
    const server = mcp.mcpServers.belliedmonkey;
    eq(server.type, 'stdio');
    eq(server.command, 'node');
    deepEq(server.args, ['${CLAUDE_PLUGIN_ROOT}/stdio.js']);
    ok(server.url == null, 'Claude Code packaging declares a remote URL');

    const plugin = JSON.parse(read(PLUGIN));
    eq(plugin.name, 'belliedmonkey');
    eq(plugin.version, '1.22.0-n25');
    ok(!plugin.mcpServers, 'plugin.json must not grow a second server map');

    const toml = read(CODEX_TOML);
    eq((toml.match(/^\[mcp_servers\.[^\]]+\]/gm) || []).join('\n'), '[mcp_servers.belliedmonkey]');
    ok(/^command = "node"$/m.test(toml));
    ok(/^args = \["agent\/hosts\/claude-code\/stdio\.js"\]$/m.test(toml));
    ok(!/https?:\/\//.test(toml));
    ok(!/^url\s*=/m.test(toml));

    const rootMcp = JSON.parse(read(path.join(ROOT, '.mcp.json')));
    ok(!rootMcp.mcpServers.belliedmonkey, 'product server leaked into the developer .mcp.json');

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
    // 产品版本。插件 version（上面的 1.22.0-n25）是另一条轨，不跟这里对齐。
    eq(pkg.version, '1.22.3');
    eq(pkg.scripts['agent:mcp'], 'node agent/mcp-stdio.js');
  });

  test('launcher has no tool schema and loads agent/mcp-stdio.js', () => {
    const src = read(LAUNCHER);
    ok(src.includes("path.join(__dirname, '..', '..', 'mcp-stdio.js')"));
    ok(fs.existsSync(path.join(ROOT, 'agent/mcp-stdio.js')));
    for (const name of contract.ACTIONS) ok(!src.includes(name), 'launcher repeats tool ' + name);
    ok(!src.includes('ready_check'));
    ok(!/grok|muse/i.test(src));
    const files = walk(path.join(ROOT, 'agent/hosts'), []);
    ok(files.indexOf(LAUNCHER) !== -1);
  });

  test('skill, READMEs, and Codex docs name the same seven tools', () => {
    const skill = read(SKILL);
    deepEq(toolBullets(skill), contract.ACTIONS.slice());
    ok(skill.includes('Do not call `ready_check`.'));
    deepEq(dottedTools(read(HOSTS_README)), contract.ACTIONS.slice());
    deepEq(dottedTools(read(CODEX_README)), contract.ACTIONS.slice());
    ok(read(CODEX_README).includes('没有第二份名字 `ready_check`'));
    for (const file of [SKILL, HOSTS_README, CODEX_README]) {
      const text = read(file);
      for (const line of HONEST) ok(text.includes(line), path.basename(file) + ' missing: ' + line);
      ok(text.includes(copy.HOST_KEY_HONEST), path.basename(file) + ' missing host-key line');
      ok(!/https?:\/\//.test(text), path.basename(file) + ' has a URL');
    }
    ok(read(HOSTS_README).includes('codex mcp add belliedmonkey -- node "$PWD/agent/hosts/claude-code/stdio.js"'));
    ok(read(HOSTS_README).includes('claude mcp add --transport stdio --scope user belliedmonkey -- node "$PWD/agent/hosts/claude-code/stdio.js"'));
    ok(read(HOSTS_README).includes('claude --plugin-dir "$PWD/agent/hosts/claude-code"'));
    ok(read(CODEX_README).includes('codex mcp add belliedmonkey -- node "$PWD/agent/hosts/claude-code/stdio.js"'));
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

  test('stdio launcher returns the W2 tool list and rejects ready_check', async () => {
    const c = client(LAUNCHER);
    try {
      const init = await c.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'h1-test', version: '0' },
      });
      eq(init.result.serverInfo.name, 'belliedmonkey');
      eq(init.result.serverInfo.version, contract.TRACK);
      ok(/not published/i.test(init.result.instructions));
      const list = await c.request('tools/list', {});
      deepEq(list.result.tools.map((t) => t.name), contract.ACTIONS.slice());
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
