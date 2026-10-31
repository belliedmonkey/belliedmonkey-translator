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
      'quota_or_key', 'subscription_cannot_pay', 'study_capture_off', 'network_unavailable',
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
    eq(anon.origin, '深链 / MCP（无法确认助手身份）');
    ok(!JSON.stringify(anon).includes('始终允许此助手'));
    ok(!JSON.stringify(anon).includes('收录复习'));
    ok(!JSON.stringify(anon).includes('语音包'));
    const named = confirm.buildConfirmCard('capture_to_study', { caller_id: 'host-1' });
    eq(named.assistantAllow, '始终允许此助手');
    eq(named.actionLabel, '收进复习');
    eq(named.origin, '已识别助手');
    const msg = confirm.elicitationMessage(anon);
    ok(!msg.includes('始终允许此助手'));
    ok(msg.includes('来自：深链 / MCP（无法确认助手身份）'));
    ok(!msg.includes('已识别助手'));
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
    eq(f.need_app.line, '尚未检测到本机「大肚猴翻译」。请先安装或打开 App，再重试。');
    eq(f.need_app.primary, '去安装 / 打开 App');
    eq(f.need_app.secondary, '打开安装说明');
    eq(f.need_login.line, '需要登录');
    eq(f.need_login.primary, '去登录');
    eq(f.grant_or_key_unavailable.line, '本机额度或密钥不可用');
    eq(f.grant_or_key_unavailable.primary, '去配置引擎与密钥');
    eq(f.grant_or_key_unavailable.footnote, '亦可在宿主配置自有 Key 或订阅');
    eq(f.network_unavailable.line, '网络暂时不可用');
    eq(f.network_unavailable.primary, '重试');
    eq(f.network_unavailable.secondary, '取消');
    eq(copy.FAILURE_TITLE, '还差一步');
    eq(copy.HOST_KEY_HONEST, '宿主可用自有订阅或 API Key · 大肚猴额度不是唯一路径');
    deepEq(Object.keys(copy.ACTIONS).sort(), ['capture_to_study', 'open_setup', 'pair_device', 'start_live_subtitles']);
    ok(!JSON.stringify(copy.ACTIONS).includes('整页双语'));
    ok(!JSON.stringify(copy.ACTIONS).includes('译网页'));
    ok(!JSON.stringify(copy.ACTIONS).includes('讲解或操练'));
    ok(!JSON.stringify(copy.ACTIONS).includes('收录复习'));
    ok(!JSON.stringify(copy.ACTIONS).includes('语音包'));
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

describe('BEL-151 inbound open_setup confirm', () => {
  const URL_OPEN = 'belliedmonkey://agent/v1/open_setup?step=install_app&source=mcp';

  test('open_setup needs a confirm but stays outside SENSITIVE', () => {
    // The confirm gate and the side-effect-sensitivity set are two facts.
    eq(contract.isSensitive('open_setup'), false);
    eq(contract.SENSITIVE.has('open_setup'), false);
    eq(confirm.needsConfirm('open_setup', { device: {}, assistants: {} }, ''), true);
    eq(confirm.needsConfirm('start_live_subtitles', { device: {}, assistants: {} }, ''), true);
    eq(confirm.needsConfirm('open_setup', { device: { open_setup: true }, assistants: {} }, ''), false);
    eq(confirm.needsConfirm('ready.check', { device: {}, assistants: {} }, ''), false);

    const card = confirm.buildConfirmCard('open_setup', {});
    eq(card.title, '确认调用');
    eq(card.actionLabel, '打开本机设置（安装引导）');
    eq(card.origin, '深链 / MCP（无法确认助手身份）');
    deepEq(card.touches, [
      '打开本机设置页（安装或就绪检查）',
      '确认前不开麦、不读页、不写学习库',
      '不把全文发回聊天（默认）',
    ]);
    eq(card.deviceAllow, '本机始终允许（打开设置）');
    eq(card.assistantAllow, null);
    eq(card.primary, '允许这一次');
    eq(card.cancel, '取消');
    eq(card.footnote, '确认前不开麦、不读页、不写学习库');
    ok(!JSON.stringify(card).includes('始终允许此助手'));
    // touches are honest: opening a settings page never claims the microphone.
    ok(!JSON.stringify(card.touches).includes('麦克风'));

    const named = confirm.buildConfirmCard('open_setup', { caller_id: 'host-1' });
    eq(named.assistantAllow, '始终允许此助手');
    eq(named.origin, '已识别助手');

    const msg = confirm.elicitationMessage(card);
    ok(msg.includes('打开本机设置（安装引导）'));
    ok(msg.includes('来自：深链 / MCP（无法确认助手身份）'));
    ok(msg.includes('本机始终允许（打开设置）'));
    ok(!msg.includes('始终允许此助手'));
    ok(!msg.includes(SENTENCE));
    const schema = confirm.elicitationSchema(card);
    ok(!schema.properties.assistant);
    ok(schema.properties.device);
  });

  test('deeplink open_setup: decline cancels without opening, accept opens settings', async () => {
    const opened = [];
    const cards = [];
    const ctx = {
      hostConnected: true,
      readiness: {},
      ports: { openSetup(req) { opened.push(req.step); return { ok: true }; } },
    };
    const declined = await session.handleAgentUrl(URL_OPEN, ctx, {
      confirm(card) { cards.push(card); return { allow: false }; },
      show() {},
    });
    eq(cards.length, 1);
    eq(cards[0].actionLabel, '打开本机设置（安装引导）');
    eq(declined.code, 'cancelled');
    eq(declined.message, '已取消');
    eq(opened.length, 0);
    ok(!JSON.stringify(declined).includes('已打开设置'));

    const accepted = await session.handleAgentUrl(URL_OPEN, ctx, {
      confirm() { return { allow: true }; },
      show() {},
    });
    deepEq(opened, ['install_app']);
    eq(accepted.code, 'ok');
    eq(accepted.message, '已打开设置');
  });

  test('open_setup device allow lands in grants and skips the next confirm', async () => {
    let saved = null;
    let confirms = 0;
    let opens = 0;
    const ctx = {
      hostConnected: true,
      readiness: {},
      grants: { device: {}, assistants: {} },
      ports: { openSetup() { opens++; return { ok: true }; } },
      persistGrants(next) { saved = next; },
    };
    const first = await session.handleAgentUrl(URL_OPEN, ctx, {
      confirm() { confirms++; return { allow: true, device: true }; },
      show() {},
    });
    eq(first.code, 'ok');
    eq(opens, 1);
    eq(confirms, 1);
    eq(saved.device.open_setup, true);
    ctx.grants = saved;
    const second = await session.handleAgentUrl(URL_OPEN, ctx, {
      confirm() { confirms++; return { allow: false }; },
      show() {},
    });
    eq(second.code, 'ok');
    eq(opens, 2);
    eq(confirms, 1);
  });

  test('open_setup without a decision is untrusted_denied; a bad step never opens', async () => {
    let opens = 0;
    const denied = await run.runAgentAction('open_setup', {
      scheme: 'belliedmonkey',
      hostConnected: true,
      readiness: {},
      ports: { openSetup() { opens++; return { ok: true }; } },
    });
    eq(denied.receipt.code, 'untrusted_denied');
    eq(opens, 0);
    const bad = await run.runAgentAction('open_setup', {
      scheme: 'belliedmonkey',
      hostConnected: true,
      readiness: {},
      query: { step: 'nope' },
      confirmed: { allow: true },
      ports: { openSetup() { opens++; return { ok: true }; } },
    });
    eq(bad.receipt.code, 'bad_request');
    eq(opens, 0);
  });

  test('ready.check still never asks for a confirm', async () => {
    let asked = 0;
    const receipt = await session.handleAgentUrl('belliedmonkey://agent/v1/ready.check?source=mcp', {
      hostConnected: true,
      readiness: {},
    }, {
      confirm() { asked++; return { allow: false }; },
      show() {},
    });
    eq(asked, 0);
    eq(receipt.code, 'ok');
    eq(receipt.message, copy.MESSAGES.readyOk);
  });
});

describe('BEL-104 appendix cards and host key', () => {
  const SECRET = 'sk-host-secret-should-not-leak';

  test('host API key runs a tool with login off and engine off', async () => {
    let seen = null;
    const out = await run.runAgentAction('start_live_subtitles', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: { ANTHROPIC_API_KEY: SECRET },
      readiness: { login: false, engine: false, packs: true, os: true, mic: true, grant: false, byok: false },
      confirmed: { allow: true },
      ports: { enterSubtitle(req) { seen = req; return { ok: true }; } },
    });
    eq(out.receipt.code, 'ok');
    eq(seen.auth.kind, 'host_key');
    eq(seen.auth.via, 'ANTHROPIC_API_KEY');
    eq(seen.auth.host, 'claude-code');
    ok(!JSON.stringify(out.receipt).includes(SECRET));
    ok(!JSON.stringify(seen).includes(SECRET));
  });

  test('host subscription outranks a host API key and the grant', async () => {
    let seen = null;
    const out = await run.runAgentAction('explain_or_drill', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: { DEEPSEEK_AUTH_TOKEN: SECRET, DEEPSEEK_API_KEY: 'other-secret' },
      query: { text: 'hi', mode: 'explain' },
      readiness: { login: false, engine: false, grant: true },
      confirmed: { allow: true },
      ports: { explain(req) { seen = req; return { ok: true }; } },
    });
    eq(out.receipt.code, 'ok');
    eq(seen.auth.kind, 'host_subscription');
    eq(seen.auth.via, 'DEEPSEEK_AUTH_TOKEN');
    ok(!JSON.stringify(out.receipt).includes(SECRET));
    ok(!JSON.stringify(seen).includes('other-secret'));
  });

  test('in-app BYOK outranks the grant and does not ask for login', async () => {
    let seen = null;
    const out = await run.runAgentAction('capture_to_study', {
      scheme: 'belliedmonkey',
      sourceFallback: 'deeplink',
      hostConnected: true,
      env: {},
      query: { text: 'hi' },
      readiness: { login: false, byok: true, grant: true, studyCapture: true },
      confirmed: { allow: true },
      ports: { capture(req) { seen = req; return { ok: true }; } },
    });
    eq(out.receipt.code, 'ok');
    eq(seen.auth.kind, 'byok');
  });

  test('grant alone can run, and a missing engine without any key opens key setup', async () => {
    let calls = 0;
    const granted = await run.runAgentAction('start_live_subtitles', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: {},
      readiness: { login: true, grant: true, engine: false, packs: true, os: true, mic: true },
      confirmed: { allow: true },
      ports: { enterSubtitle() { calls++; return { ok: true }; } },
    });
    eq(granted.receipt.code, 'ok');
    eq(calls, 1);
    const missing = await run.runAgentAction('start_live_subtitles', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: { ANTHROPIC_API_KEY: '   ' },
      readiness: { login: false, engine: false, grant: false, byok: false, packs: true, os: true, mic: true },
      confirmed: { allow: true },
      ports: { enterSubtitle() { calls++; return { ok: true }; } },
    });
    eq(missing.receipt.code, 'quota_or_key');
    eq(missing.receipt.message, '本机额度或密钥不可用');
    eq(missing.receipt.fix.open_setup, 'belliedmonkey://agent/v1/open_setup?step=engine&source=mcp');
    ok(!missing.receipt.fix.open_setup.includes('step=login'));
    eq(calls, 1);
    const card = confirm.failureCard('quota_or_key');
    eq(card.code, 'grant_or_key_unavailable');
    eq(card.primary, '去配置引擎与密钥');
    eq(card.footnote, copy.HOST_KEY_NOTE);
    eq(card.title, '还差一步');
  });

  test('capture still asks for login when no host key and no BYOK', async () => {
    const out = await run.runAgentAction('capture_to_study', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: {},
      query: { text: 'hi' },
      readiness: { login: false, studyCapture: true },
      confirmed: { allow: true },
      ports: { capture() { return { ok: true }; } },
    });
    eq(out.receipt.code, 'need_login');
    eq(out.receipt.message, '需要登录');
    eq(out.receipt.fix.open_setup, 'belliedmonkey://agent/v1/open_setup?step=login&source=mcp');
    const card = confirm.failureCard(out.receipt.code);
    eq(card.primary, '去登录');
    eq(card.secondary, '取消');
  });

  test('network failure retries nowhere near engine setup', async () => {
    let calls = 0;
    const out = await run.runAgentAction('translate_page', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: { OPENAI_API_KEY: SECRET },
      readiness: { ext: true, engine: true, network: false },
      confirmed: { allow: true },
      ports: { translatePage() { calls++; return { ok: true }; } },
    });
    eq(calls, 0);
    eq(out.receipt.code, 'network_unavailable');
    eq(out.receipt.message, '网络暂时不可用');
    deepEq(out.receipt.fix, {});
    const card = confirm.failureCard(out.receipt.code);
    eq(card.primary, '重试');
    eq(card.secondary, '取消');
    eq(card.footnote, '');
    ok(!JSON.stringify(card).includes('去配置引擎与密钥'));
    ok(!JSON.stringify(out.receipt.fix).includes('engine'));
    ok(!JSON.stringify(out.receipt.fix).includes('login'));
  });

  test('need_app card is the locked install line, and a port card code is not success', async () => {
    const missing = await run.runAgentAction('explain_or_drill', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: { CODEX_API_KEY: SECRET },
      query: { text: 'hi' },
      readiness: { engine: true },
      confirmed: { allow: true },
      ports: {},
    });
    eq(missing.receipt.code, 'need_app');
    eq(missing.receipt.message, '尚未检测到本机「大肚猴翻译」。请先安装或打开 App，再重试。');
    eq(confirm.failureCard('need_app').primary, '去安装 / 打开 App');
    eq(confirm.failureCard('need_app').secondary, '打开安装说明');
    ok(!missing.receipt.message.includes(SECRET));
    const aliased = await run.runAgentAction('translate_page', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: {},
      readiness: { ext: true, engine: true },
      confirmed: { allow: true },
      ports: { translatePage() { return { ok: false, code: 'grant_or_key_unavailable' }; } },
    });
    eq(aliased.receipt.code, 'quota_or_key');
    eq(aliased.receipt.message, '本机额度或密钥不可用');
    eq(aliased.receipt.ok, false);
    const unknown = await run.runAgentAction('translate_page', {
      scheme: 'belliedmonkey',
      sourceFallback: 'mcp',
      hostConnected: true,
      env: {},
      readiness: { ext: true, engine: true },
      confirmed: { allow: true },
      ports: { translatePage() { return { ok: false, code: 'not_a_code' }; } },
    });
    eq(unknown.receipt.code, 'bad_request');
    eq(unknown.receipt.ok, false);
  });

  test('CLI without elicitation only returns the need_confirm hint', async () => {
    const home = tmp();
    const log = path.join(home, 'effects.log');
    const proc = spawn(process.execPath, [path.join(ROOT, 'agent/mcp-stdio.js')], {
      env: Object.assign({}, process.env, {
        MT_AGENT_HOME: home,
        MT_AGENT_TEST_HOST: '1',
        MT_AGENT_EFFECT_LOG: log,
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    const stderr = [];
    proc.stderr.on('data', (c) => stderr.push(String(c)));
    const pending = new Map();
    let seq = 0;
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        const waiter = pending.get(msg.id);
        if (waiter) { pending.delete(msg.id); waiter(msg); }
      }
    });
    function request(method, params) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout ' + stderr.join(''))), 4000);
        pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    }
    try {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'bel104', version: '0' },
      });
      const call = await request('tools/call', { name: 'start_live_subtitles', arguments: {} });
      const rec = JSON.parse(call.result.content[0].text);
      eq(rec.code, 'need_confirm');
      eq(rec.message, '需要你在本机点确认');
      ok(!rec.message.includes('允许这一次'));
      ok(!call.result.content[0].text.includes('始终允许此助手'));
      eq(fs.existsSync(log), false);
    } finally {
      proc.kill('SIGTERM');
    }
  });

  test('App face retries network and does not send it to engine setup', () => {
    const face = fs.readFileSync(path.join(ROOT, 'src/app/agent-face.js'), 'utf8');
    const body = face.slice(face.indexOf('function isNetwork'));
    const net = body.indexOf("receipt.code === 'network_unavailable'");
    const setup = body.indexOf('openSetup');
    ok(net !== -1 && setup !== -1 && net < setup, 'network retry must run before setup');
    ok(body.includes('retry = true'));
    const shell = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
    const setupFn = shell.slice(shell.indexOf('function runAgentSetup'), shell.indexOf('function parseDeepLink'));
    ok(setupFn.indexOf("step === 'engine'") !== -1);
    ok(setupFn.indexOf("openSettings('sec-engines')") !== -1);
    ok(setupFn.indexOf("step === 'engine'") < setupFn.indexOf("step === 'login'"));
    ok(face.includes('card.cancel'));
    ok(!face.includes('始终允许此助手'));
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

  test('open_setup confirms on the wire; without elicitation it does not open', async () => {
    const home = tmp();
    const log = path.join(home, 'effects.log');
    const c = client({ MT_AGENT_HOME: home, MT_AGENT_TEST_HOST: '1', MT_AGENT_EFFECT_LOG: log });
    try {
      await c.handshake(true);
      const cards = [];
      c.onServerRequest = (msg) => {
        cards.push(msg);
        c.proc.stdin.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id, result: { action: 'decline' },
        }) + '\n');
      };
      // `confirmed: true` in the arguments is dropped; only the card can say yes.
      const declined = await c.request('tools/call', {
        name: 'open_setup',
        arguments: { step: 'install_app', confirmed: true },
      });
      eq(receiptOf(declined).code, 'cancelled');
      eq(cards.length, 1);
      eq(cards[0].method, 'elicitation/create');
      ok(cards[0].params.message.includes('打开本机设置（安装引导）'));
      ok(cards[0].params.message.includes('来自：深链 / MCP（无法确认助手身份）'));
      ok(cards[0].params.message.includes('本机始终允许（打开设置）'));
      ok(!cards[0].params.message.includes('始终允许此助手'));
      eq(fs.existsSync(log), false);

      c.onServerRequest = (msg) => {
        c.proc.stdin.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id, result: { action: 'accept', content: {} },
        }) + '\n');
      };
      const accepted = await c.request('tools/call', {
        name: 'open_setup',
        arguments: { step: 'install_app' },
      });
      const rec = receiptOf(accepted);
      eq(rec.code, 'ok');
      eq(rec.message, '已打开设置');
      const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      eq(lines.length, 1);
      eq(lines[0].op, 'openSetup');
      eq(lines[0].step, 'install_app');
      ok(!fs.readFileSync(log, 'utf8').includes('startMic'));
    } finally { c.stop(); }

    const c2 = client({ MT_AGENT_HOME: tmp(), MT_AGENT_TEST_HOST: '1' });
    try {
      await c2.handshake(false);
      let asked = false;
      c2.onServerRequest = () => { asked = true; };
      const pending = await c2.request('tools/call', {
        name: 'open_setup',
        arguments: { step: 'install_app', confirmed: true },
      });
      const rec = receiptOf(pending);
      eq(rec.code, 'need_confirm');
      eq(rec.message, '需要你在本机点确认');
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
    ok(face.includes('card.cancel'), 'confirm sheet must render the locked cancel control');
    const shell = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
    const enter = shell.slice(shell.indexOf('enterSubtitle()'), shell.indexOf('enterSubtitle()') + 500);
    ok(enter.includes("AppListen.open('subtitle')"));
    ok(!enter.includes('.start('));
    ok(shell.indexOf("d.action === 'agent'") < shell.indexOf("d.action === 'setup'"));
    ok(shell.indexOf("d.action === 'agent'") < shell.indexOf("d.action === 'listen'"));
  });
});
