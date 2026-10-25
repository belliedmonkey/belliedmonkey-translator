// test/agent-w2.test.js — N25 W2 stdio MCP + minimal W1 confirm gate.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const contract = require('../agent/contract');
const copy = require('../agent/copy');
const parse = require('../agent/parse');
const confirm = require('../agent/confirm');
const run = require('../agent/run');
const session = require('../agent/session');

const SENTENCE = 'SECRET-SENTENCE-99';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-agent-'));
}

describe('agent W1 parse + confirm + receipt', () => {
  test('old listen / review / setup links are not agent links', () => {
    eq(parse.parseAgentDeepLink('belliedmonkey://listen'), null);
    eq(parse.parseAgentDeepLink('belliedmonkey://review?uid=abc'), null);
    eq(parse.parseAgentDeepLink('belliedmonkey://setup?from=system-translate'), null);
    eq(parse.parseAgentDeepLink('belliedmonkeycn://listen'), null);
  });

  test('ready.check keeps the dot; both schemes parse', () => {
    const g = parse.parseAgentDeepLink('belliedmonkey://agent/v1/ready.check?source=mcp&unused=1');
    eq(g.action, 'ready.check');
    eq(g.scheme, 'belliedmonkey');
    eq(g.query.source, 'mcp');
    eq(g.query.unused, '1');
    const c = parse.parseAgentDeepLink('belliedmonkeycn:///agent/v1/ready.check');
    eq(c.action, 'ready.check');
    eq(c.scheme, 'belliedmonkeycn');
  });

  test('P1 and unknown actions are unsupported_action, not a new id', () => {
    eq(parse.parseAgentDeepLink('belliedmonkey://agent/v1/listen.start').error, 'unsupported_action');
    eq(parse.parseAgentDeepLink('belliedmonkey://agent/v1/ready_check').error, 'unsupported_action');
    eq(parse.parseAgentDeepLink('belliedmonkey://agent/v1/nope').error, 'unsupported_action');
  });

  test('failure codes are exactly deeplink §6', () => {
    deepEq(contract.CODES.slice(), [
      'ok', 'need_confirm', 'cancelled', 'unsupported_action', 'bad_request',
      'untrusted_denied', 'need_app', 'need_ext', 'need_login', 'need_packs',
      'need_engine', 'need_os', 'need_permission_mic', 'site_unsupported',
      'quota_or_key', 'study_capture_off',
    ]);
  });

  test('receipt is §5 and never carries the sentence', async () => {
    let seen = null;
    const out = await run.runAgentAction('capture_to_study', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      query: { text: SENTENCE },
      readiness: { login: true, studyCapture: true },
      confirmed: { allow: true },
      ports: { capture(req) { seen = req.text; return { ok: true, content: req.text }; } },
    });
    const rec = out.receipt;
    deepEq(Object.keys(rec), ['ok', 'action', 'code', 'message', 'fix', 'receipt_id']);
    eq(rec.ok, true);
    eq(rec.code, 'ok');
    eq(rec.action, 'capture_to_study');
    eq(rec.message, '已收进复习');
    ok(!JSON.stringify(rec).includes(SENTENCE), 'receipt echoed the sentence');
    ok(!('content' in rec) && !('text' in rec) && !('transcript' in rec) && !('translation' in rec));
    eq(seen, SENTENCE);
  });

  test('sensitive action without confirm does not touch the port', async () => {
    let calls = 0;
    const out = await run.runAgentAction('start_live_subtitles', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      readiness: { login: true, packs: true, os: true, mic: true },
      ports: { enterSubtitle() { calls++; return { ok: true }; } },
    });
    eq(calls, 0);
    eq(out.receipt.code, 'untrusted_denied');
    eq(contract.CODE_SET.has(out.receipt.code), true);
  });

  test('confirm then subtitle surface does not start a microphone', async () => {
    const ops = [];
    const out = await run.runAgentAction('start_live_subtitles', {
      scheme: 'belliedmonkey',
      sourceFallback: 'deeplink',
      hostConnected: true,
      readiness: { login: true, packs: true, os: true, mic: true },
      confirmed: { allow: true },
      ports: {
        enterSubtitle() { ops.push('enter'); return { ok: true }; },
        start() { ops.push('start'); return { ok: true }; },
      },
    });
    deepEq(ops, ['enter']);
    eq(out.receipt.code, 'ok');
    eq(out.receipt.message, copy.MESSAGES.openedSubtitles);
  });

  test('anon card has no assistant allow; caller display name is not an id', () => {
    const anon = confirm.buildConfirmCard('start_live_subtitles', { caller: 'Claude' });
    eq(anon.assistantAllow, null);
    eq(anon.title, '确认调用');
    eq(anon.primary, '允许这一次');
    eq(anon.cancel, '取消');
    eq(anon.actionLabel, '开实时双语字幕');
    eq(anon.deviceAllow, '本机始终允许（实时字幕）');
    eq(anon.footnote, '确认前不开麦、不读页、不写学习库');
    ok(!JSON.stringify(anon).includes('始终允许此助手'));
    ok(!JSON.stringify(anon).includes('收录复习'));
    ok(!JSON.stringify(anon).includes('语音包'));
    const named = confirm.buildConfirmCard('capture_to_study', { caller_id: 'host-1' });
    eq(named.assistantAllow, '始终允许此助手');
    eq(named.actionLabel, '收进复习');
    const msg = confirm.elicitationMessage(anon);
    ok(!msg.includes('始终允许此助手'));
    ok(!msg.includes(SENTENCE));
    const schema = confirm.elicitationSchema(anon);
    ok(!schema.properties.assistant);
    ok(confirm.elicitationSchema(named).properties.assistant);
  });

  test('locked failure lines', () => {
    const f = copy.FAILURES;
    eq(f.need_permission_mic.line, '需要麦克风 / 系统音频权限');
    eq(f.need_permission_mic.primary, '去开启权限');
    eq(f.need_packs.line, '需要下载语言包');
    eq(f.need_packs.primary, '去下载语言包');
    eq(f.need_ext.line, '需要浏览器扩展');
    eq(f.need_ext.primary, '安装扩展说明');
    eq(f.need_ext.secondary, '复制给 AI 的说明');
    eq(f.site_unsupported.line, '当前网站暂不支持视频双语字幕');
    eq(f.site_unsupported.primary, '改用实时字幕');
    eq(f.need_engine.line, '还没配置翻译引擎');
    eq(f.need_engine.primary, '去配置引擎与密钥');
    eq(copy.FAILURE_TITLE, '还差一步');
  });

  test('no extension and unsupported site use §6 codes and do not call the port', async () => {
    let calls = 0;
    const ext = await run.runAgentAction('translate_page', {
      scheme: 'belliedmonkeycn',
      sourceFallback: 'mcp',
      query: { source: 'mcp' },
      readiness: { ext: false },
      confirmed: { allow: true },
      ports: { translatePage() { calls++; return { ok: true }; } },
    });
    eq(ext.receipt.code, 'need_ext');
    eq(ext.receipt.message, '需要浏览器扩展');
    eq(ext.receipt.fix.open_setup, 'belliedmonkeycn://agent/v1/open_setup?step=install_ext&source=mcp');
    eq(calls, 0);
    const site = await run.runAgentAction('translate_video_captions', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      query: { url: 'https://example.com/watch?v=1' },
      readiness: { ext: true, engine: true },
      siteSupported() { return false; },
      confirmed: { allow: true },
      ports: { translateCaptions() { calls++; return { ok: true }; } },
    });
    eq(site.receipt.code, 'site_unsupported');
    eq(site.receipt.message, '当前网站暂不支持视频双语字幕（example.com）');
    eq(calls, 0);
  });

  test('ready.check does not write grants and lists only measured gaps', async () => {
    const dir = tmp();
    const file = path.join(dir, 'grants.json');
    const out = await run.runAgentAction('ready.check', {
      scheme: 'belliedmonkey',
      hostConnected: false,
      readiness: null,
      grantsFile: file,
    });
    eq(out.receipt.code, 'ok');
    eq(out.receipt.message, '缺口 need_app');
    eq(fs.existsSync(file), false);
    const measured = await run.runAgentAction('ready.check', {
      scheme: 'belliedmonkey',
      hostConnected: true,
      readiness: { login: false, packs: true, engine: null, os: null, ext: null, mic: null },
    });
    eq(measured.receipt.message, '缺口 need_login');
  });

  test('device grant skips a later confirm; caller string does not', async () => {
    const grants = { device: { start_live_subtitles: true }, assistants: { 'shown-name': { start_live_subtitles: true } } };
    let calls = 0;
    const okRun = await run.runAgentAction('start_live_subtitles', {
      scheme: 'belliedmonkey',
      hostConnected: true,
      readiness: { login: true, packs: true, os: true, mic: true },
      grants,
      ports: { enterSubtitle() { calls++; return { ok: true }; } },
    });
    eq(okRun.receipt.code, 'ok');
    eq(calls, 1);
    calls = 0;
    const denied = await run.runAgentAction('capture_to_study', {
      scheme: 'belliedmonkey',
      hostConnected: true,
      query: { text: 'hi', caller: 'shown-name' },
      readiness: { login: true, studyCapture: true },
      grants,
      ports: { capture() { calls++; return { ok: true }; } },
    });
    eq(denied.receipt.code, 'untrusted_denied');
    eq(calls, 0);
  });

  test('deeplink session asks confirm before the port, anon card stays anon', async () => {
    const seen = [];
    let card = null;
    const receipt = await session.handleAgentUrl('belliedmonkey://agent/v1/start_live_subtitles?caller=Claude', {
      hostConnected: true,
      readiness: { login: true, packs: true, os: true, mic: true },
      ports: { enterSubtitle() { seen.push('enter'); return { ok: true }; } },
    }, {
      confirm(c) { card = c; seen.push('confirm'); return { allow: true }; },
      show() {},
    });
    deepEq(seen, ['confirm', 'enter']);
    eq(card.assistantAllow, null);
    eq(receipt.code, 'ok');
    ok(!JSON.stringify(receipt).includes('transcript'));
  });
});

describe('agent W2 stdio MCP', () => {
  function client(env) {
    const proc = spawn(process.execPath, [path.join(ROOT, 'agent/mcp-stdio.js')], {
      env: Object.assign({}, process.env, env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let seq = 0;
    const waiters = new Map();
    const stderr = [];
    proc.stderr.on('data', (c) => stderr.push(String(c)));
    let onServerRequest = null;
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        ok(!line.includes('\n'), 'stdout line contains a newline');
        if (msg.method && msg.id != null) {
          if (onServerRequest) onServerRequest(msg);
          continue;
        }
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
    async function handshake(elicitation) {
      const caps = elicitation ? { elicitation: { form: {} } } : {};
      const init = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: caps,
        clientInfo: { name: 'w2-test', version: '0' },
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      return init;
    }
    return {
      proc,
      request,
      handshake,
      stderr: () => stderr.join(''),
      set onServerRequest(fn) { onServerRequest = fn; },
      stop() { proc.kill('SIGTERM'); },
    };
  }

  function receiptOf(msg) {
    const text = msg.result && msg.result.content && msg.result.content[0] && msg.result.content[0].text;
    return JSON.parse(text);
  }

  test('stdio starts, tool names are the action ids, ready_check is rejected', async () => {
    const home = tmp();
    const c = client({ MT_AGENT_HOME: home, MT_FLAVOR: 'global' });
    try {
      const init = await c.handshake(false);
      eq(init.result.serverInfo.name, 'belliedmonkey');
      eq(init.result.serverInfo.version, '1.22.0-n25');
      ok(/not published/i.test(init.result.instructions));
      const list = await c.request('tools/list', {});
      const names = list.result.tools.map((t) => t.name);
      deepEq(names, contract.ACTIONS.slice());
      ok(names.indexOf('ready.check') !== -1);
      ok(names.indexOf('ready_check') === -1);
      const missing = await c.request('tools/call', { name: 'ready_check', arguments: {} });
      eq(missing.error.code, -32602);
      const ready = await c.request('tools/call', { name: 'ready.check', arguments: {} });
      const rec = receiptOf(ready);
      eq(rec.action, 'ready.check');
      eq(rec.code, 'ok');
      eq(rec.message, '缺口 need_app');
      ok(!String(ready.result.content[0].text).startsWith('belliedmonkey://'), 'tool echoed a deeplink');
      eq(ready.result.isError, false);
    } finally { c.stop(); }
  });

  test('sensitive call confirms via elicitation and does not start the mic', async () => {
    const home = tmp();
    const log = path.join(home, 'effects.log');
    const c = client({
      MT_AGENT_HOME: home,
      MT_AGENT_TEST_HOST: '1',
      MT_AGENT_EFFECT_LOG: log,
    });
    try {
      await c.handshake(true);
      let elicited = null;
      let askedAgain = false;
      c.onServerRequest = (msg) => {
        elicited = msg;
        c.proc.stdin.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { action: 'accept', content: { device: true } },
        }) + '\n');
      };
      const call = await c.request('tools/call', {
        name: 'start_live_subtitles',
        arguments: { confirmed: true, caller: 'Claude', video_lang: 'en' },
      });
      const rec = receiptOf(call);
      eq(rec.code, 'ok');
      eq(rec.action, 'start_live_subtitles');
      ok(elicited && elicited.method === 'elicitation/create', 'confirm gate did not run');
      ok(!elicited.params.message.includes('始终允许此助手'));
      ok(elicited.params.message.includes('确认调用'));
      ok(elicited.params.message.includes('允许这一次'));
      ok(elicited.params.message.includes('本机始终允许（实时字幕）'));
      const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      eq(lines.length, 1);
      eq(lines[0].op, 'enterSubtitle');
      eq(lines[0].micStarted, false);
      ok(!fs.readFileSync(log, 'utf8').includes('startMic'));
      const grants = JSON.parse(fs.readFileSync(path.join(home, 'grants.json'), 'utf8'));
      eq(grants.device['start_live_subtitles'], true);
      eq(grants.assistants['Claude'], undefined);

      c.onServerRequest = () => { askedAgain = true; };
      const again = await c.request('tools/call', { name: 'start_live_subtitles', arguments: {} });
      eq(receiptOf(again).code, 'ok');
      eq(askedAgain, false);
    } finally { c.stop(); }
  });

  test('decline, missing elicitation, and page text stay inside §6', async () => {
    const home = tmp();
    const log = path.join(home, 'effects.log');
    const c = client({ MT_AGENT_HOME: home, MT_AGENT_TEST_HOST: '1', MT_AGENT_EFFECT_LOG: log });
    try {
      await c.handshake(true);
      c.onServerRequest = (msg) => {
        ok(!msg.params.message.includes(SENTENCE));
        c.proc.stdin.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id, result: { action: 'cancel' },
        }) + '\n');
      };
      const cancelled = await c.request('tools/call', {
        name: 'capture_to_study',
        arguments: { text: SENTENCE, quote: SENTENCE },
      });
      eq(receiptOf(cancelled).code, 'cancelled');
      ok(!JSON.stringify(cancelled.result).includes(SENTENCE));
      eq(fs.existsSync(log), false);
    } finally { c.stop(); }

    const c2 = client({ MT_AGENT_HOME: tmp() });
    try {
      await c2.handshake(false);
      let asked = false;
      c2.onServerRequest = () => { asked = true; };
      const pending = await c2.request('tools/call', { name: 'translate_page', arguments: { confirmed: true } });
      const rec = receiptOf(pending);
      eq(rec.code, 'need_ext');
      eq(asked, false);
      eq(contract.CODE_SET.has(rec.code), true);
    } finally { c2.stop(); }
  });

  test('spec names the seven tools, the stdio command, and the fake-MCP failure', () => {
    const spec = fs.readFileSync(path.join(ROOT, 'architecture/SPEC-AGENT-W2-MCP-IMPL-2026-10-26.md'), 'utf8');
    for (const name of contract.ACTIONS) ok(spec.includes('`' + name + '`'), 'spec missing ' + name);
    ok(spec.includes('npm run agent:mcp'));
    ok(spec.includes('node agent/mcp-stdio.js'));
    ok(/假 MCP[\s\S]{0,80}FAIL/.test(spec) || spec.includes('假 MCP / 仅 echo 深链字符串却标 D3') && spec.includes('FAIL'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    eq(pkg.scripts['agent:mcp'], 'node agent/mcp-stdio.js');
    const face = fs.readFileSync(path.join(ROOT, 'src/app/agent-face.js'), 'utf8');
    ok(!face.includes('始终允许此助手'), 'anon face hardcodes the assistant allow');
    const shell = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
    const enter = shell.slice(shell.indexOf('enterSubtitle()'), shell.indexOf('enterSubtitle()') + 500);
    ok(enter.includes("AppListen.open('subtitle')"));
    ok(!enter.includes('.start('));
    ok(shell.indexOf("d.action === 'agent'") < shell.indexOf("d.action === 'setup'"));
    ok(shell.indexOf("d.action === 'agent'") < shell.indexOf("d.action === 'listen'"));
  });
});
