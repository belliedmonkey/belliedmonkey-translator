// test/bel272-apple-native.test.js — BEL-272: native Apple sign-in failure exits.
//
// The production bug: 18×/9 users hit `auth_fail/apple_failed` with stage=native and
// http=0 (didCompleteWithError before any id_token), the screen only offered the
// sentence "Apple 登录没能完成…", and there was no way to reopen the system sheet.
//
// This gate pins four things:
//   1. the bridge passes the ASAuthorizationError code+domain through (cancelled and
//      non-cancelled), while the no-id_token callback shape stays {error:...};
//   2. the page encodes BOTH into the existing auth_fail.code field (no new props)
//      and never emits apple_failed for a real ASAuthorizationError code or cancel;
//   3. the failure card has retry + email/Google exits, and retry re-enters the same
//      Apple start path so the system sheet can appear again;
//   4. cancel keeps the neutral `canceled` semantic (copy has no "失败").
//
// DOM behaviour is exercised through the injected `$` / element doubles because the
// suite is deliberately jsdom-free (docs/domain-design.md §10).

const fs = require('fs');
const path = require('path');
const { describe, test, loadModule, loadSrc, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const AppleNative = loadSrc('src/app/apple-native.js', 'AppleNative').AppleNative;
const GEN = require('../supabase/functions/bt-ingest/events.gen.json');
const ID = /^[a-z0-9_-]{1,32}$/;

const AUTH_DOMAIN = 'com.apple.AuthenticationServices.AuthorizationError';

// ── element doubles, just enough for createAppleFailureUi ────────────────────
function mkEl(id) {
  return {
    id, hidden: false, textContent: '', listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatch(type, ev) { for (const fn of (this.listeners[type] || [])) fn(ev); },
  };
}
function mkUi(extra) {
  const els = {};
  for (const id of ['apple-fail', 'apple-fail-text', 'btn-apple-retry', 'btn-apple-other']) els[id] = mkEl(id);
  els['apple-fail'].hidden = true;
  const calls = { start: 0, other: 0, note: [], say: [] };
  const ui = AppleNative.createAppleFailureUi(Object.assign({
    $: (id) => els[id],
    t: (k, fallback) => fallback,
    say: (msg, isErr) => calls.say.push({ msg, isErr: !!isErr }),
    noteNative: (code) => calls.note.push(code),
    start: () => { calls.start++; },
    openOther: () => { calls.other++; },
  }, extra || {}));
  return { ui, els, calls };
}

describe('BEL-272 原生桥：ASAuthorizationError code/domain 透传', () => {
  const swift = read('app/native/apple-signin-bridge.swift');
  const errBlock = (() => {
    const i = swift.indexOf('didCompleteWithError error: Error)');
    return i < 0 ? '' : swift.slice(i, swift.indexOf('func presentationAnchor', i));
  })();

  test('didCompleteWithError reads NSError code AND domain', () => {
    ok(errBlock, '找不到 didCompleteWithError 实现');
    ok(/let ns = error as NSError/.test(errBlock), '没有把 error 桥成 NSError');
    ok(/let code = ns\.code/.test(errBlock), '没有读 NSError.code');
    ok(/let domain = ns\.domain/.test(errBlock), '没有读 NSError.domain');
  });

  test('canceled 分支回传 error:canceled + code/domain，且不是 apple_failed', () => {
    ok(/if code == ASAuthorizationError\.canceled\.rawValue \{/.test(errBlock),
      'canceled 判据不再是 ASAuthorizationError.canceled');
    ok(/deliver\(error: "canceled", errorCode: code, errorDomain: domain\)/.test(errBlock),
      'canceled 没有把 code/domain 交给页面');
    const canceledBranch = errBlock.slice(errBlock.indexOf('canceled.rawValue'),
      errBlock.indexOf('deliver(error: "apple_failed"'));
    ok(!/apple_failed/.test(canceledBranch), 'canceled 分支里出现了 apple_failed');
  });

  test('非 canceled 分支回传 error:apple_failed + 原样 code/domain', () => {
    ok(/deliver\(error: "apple_failed", errorCode: code, errorDomain: domain\)/.test(errBlock),
      '非 canceled 失败没有把 code/domain 交给页面');
  });

  test('deliver 的 payload 只在有值时多两个键；no_identity_token 形状不变', () => {
    ok(/private func deliver\(token: String\? = nil, nonce: String\? = nil, error: String\? = nil,/.test(swift),
      'deliver 签名没加 errorCode/errorDomain');
    ok(/errorCode: Int\? = nil, errorDomain: String\? = nil/.test(swift),
      'deliver 的可选参数类型不对');
    ok(/if let c = errorCode \{ payload\["errorCode"\] = c \}/.test(swift), 'payload 没写 errorCode');
    ok(/if let d = errorDomain \{ payload\["errorDomain"\] = d \}/.test(swift), 'payload 没写 errorDomain');
    const noToken = swift.slice(swift.indexOf('guard let cred'),
      swift.indexOf('func authorizationController', swift.indexOf('guard let cred')));
    ok(/deliver\(error: "no_identity_token"\)/.test(noToken),
      'no_identity_token 被加上了额外字段 —— 旧回调形状必须不变');
  });

  test('每次 begin() 都新建 controller 并 performRequests（重试能再弹系统面板）', () => {
    const begin = swift.slice(swift.indexOf('private func begin()'), swift.indexOf('// MARK: - 结果'));
    ok(/let c = ASAuthorizationController\(authorizationRequests: \[req\]\)/.test(begin),
      'begin 没有新建 ASAuthorizationController');
    ok(/controller = c/.test(begin), 'controller 没被强引用');
    ok(/c\.performRequests\(\)/.test(begin), 'begin 没有 performRequests —— 面板不会出现');
  });
});

describe('BEL-272 事件契约：code 同时承载 domain + ASAuthorizationError.code', () => {
  const cases = [
    [{ error: 'apple_failed', errorCode: 1000, errorDomain: AUTH_DOMAIN }, 'apple_asauth_1000'],
    [{ error: 'apple_failed', errorCode: 1002, errorDomain: AUTH_DOMAIN }, 'apple_asauth_1002'],
    [{ error: 'apple_failed', errorCode: 1004, errorDomain: AUTH_DOMAIN }, 'apple_asauth_1004'],
    [{ error: 'apple_failed', errorCode: 1005, errorDomain: AUTH_DOMAIN }, 'apple_asauth_1005'],
    [{ error: 'apple_failed', errorCode: 4097, errorDomain: 'NSCocoaErrorDomain' }, 'apple_cocoa_4097'],
    [{ error: 'apple_failed', errorCode: -1009, errorDomain: 'NSURLErrorDomain' }, 'apple_url_-1009'],
    [{ error: 'apple_failed', errorCode: -128, errorDomain: 'NSOSStatusErrorDomain' }, 'apple_os_-128'],
    [{ error: 'apple_failed', errorCode: 42, errorDomain: 'SomeOtherDomain' }, 'apple_other_42'],
    [{ error: 'apple_failed', errorCode: 1000 }, 'apple_other_1000'],
    [{ error: 'apple_failed' }, 'apple_no_code'],
    [{ error: 'no_identity_token' }, 'apple_no_token'],
    [{ error: 'encode' }, 'apple_encode'],
    [{ error: 'something_else' }, 'apple_unknown'],
  ];
  for (const [result, expected] of cases) {
    test(JSON.stringify(result) + ' -> ' + expected, () => {
      eq(AppleNative.appleEventCode(result), expected);
      ok(ID.test(expected), 'event code 不符合 auth_fail 的 id 规则: ' + expected);
      ok(expected.length <= 32, 'event code 超过 32 字符: ' + expected);
    });
  }

  test('ASAuthorizationError 的真实失败码不再落回 apple_failed', () => {
    for (const code of [1000, 1002, 1003, 1004, 1005, 1006]) {
      const c = AppleNative.appleEventCode({ error: 'apple_failed', errorCode: code, errorDomain: AUTH_DOMAIN });
      ok(c !== 'apple_failed', 'code ' + code + ' 仍然被写成 apple_failed');
      ok(c.indexOf('asauth') > -1, 'code ' + code + ' 没有记录 ASAuthorizationError 域');
    }
  });

  test('canceled 走既有 canceled 语义，不是 apple_failed', () => {
    const c = AppleNative.classifyAppleResult({ error: 'canceled', errorCode: 1001, errorDomain: AUTH_DOMAIN });
    eq(c.kind, 'canceled');
    eq(c.code, 'canceled');
    ok(c.code !== 'apple_failed', 'cancel 被当成了 apple_failed');
    // 只带数字码的宿主也要归到取消，而不是失败。
    const numeric = AppleNative.classifyAppleResult({ error: 'apple_failed', errorCode: 1001, errorDomain: AUTH_DOMAIN });
    eq(numeric.kind, 'canceled');
    eq(numeric.code, 'canceled');
  });

  test('success 结果不产生 code', () => {
    const c = AppleNative.classifyAppleResult({ idToken: 't', nonce: 'n' });
    eq(c.kind, 'success');
    eq(c.code, '');
  });
});

describe('BEL-272 事件属性 ⊆ 已部署的 auth_fail 白名单', () => {
  test('events.gen.json 的 auth_fail 就是五个键；code 是 id 型', () => {
    deepEq(Object.keys(GEN.events.auth_fail).sort(),
      ['attempt', 'code', 'http', 'provider', 'stage'].sort(),
      'auth_fail 白名单变了 —— 先过 domain-design，再改这里');
    eq(GEN.events.auth_fail.code, 'id');
    deepEq(GEN.events.auth_fail.provider.slice().sort(), ['apple', 'email', 'google', 'phone', 'unknown'].sort());
    deepEq(GEN.events.auth_fail.stage.slice().sort(),
      ['authorize', 'exchange', 'id_token', 'native', 'otp', 'password', 'post_login', 'prepare', 'unknown', 'verify'].sort());
  });

  test('真实 noteAuthFail 发的 props 是白名单子集，code 是编码后的值', () => {
    const sent = [];
    const ctx = loadModule('learn/auth.js', {
      window: {},
      MT_BACKEND: { url: 'https://x.example', anonKey: 'anon', table: 'bt_chunks' },
      PageSettings: { read: async () => ({ ok: true, data: {} }), write: async () => ({ ok: true }), removeKeys: async () => ({ ok: true }) },
      LearnStore: { getMeta: async () => null, setMeta: async () => {} },
      crypto: require('crypto').webcrypto,
      TextEncoder,
      btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      MTTelemetry: { track: (name, props) => sent.push({ name, props }) },
      fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    });
    const A = ctx.LearnAuth;
    A.noteAuthFail('apple', 'native', 'apple_asauth_1000');
    eq(sent.length, 1);
    eq(sent[0].name, 'auth_fail');
    const props = sent[0].props;
    const allowed = new Set(Object.keys(GEN.events.auth_fail));
    for (const k of Object.keys(props)) ok(allowed.has(k), '发了白名单外的属性: ' + k);
    eq(props.provider, 'apple');
    eq(props.stage, 'native');
    eq(props.code, 'apple_asauth_1000');
    eq(props.http, 0);
    eq(props.attempt, '1');

    A.noteAuthFail('apple', 'native', 'canceled');
    eq(sent[1].props.code, 'canceled');
    ok(sent[1].props.code !== 'apple_failed', 'cancel 仍被记成 apple_failed');
    for (const k of Object.keys(sent[1].props)) ok(allowed.has(k), 'cancel 发了白名单外的属性: ' + k);
  });
});

describe('BEL-272 失败卡：两个出口 / 重试复用 Apple 入口 / canceled 不画失败', () => {
  test('失败时显示重试 + 改用邮箱/Google，文案说没拿到凭据、可以重试', () => {
    const { ui, els, calls } = mkUi();
    const out = ui.failed({ error: 'apple_failed', errorCode: 1000, errorDomain: AUTH_DOMAIN });
    eq(out.kind, 'failed');
    eq(out.code, 'apple_asauth_1000');
    eq(els['apple-fail'].hidden, false, '失败卡没有显示');
    ok(els['apple-fail-text'].textContent.indexOf('没有拿到 Apple 凭据') > -1, '文案没说凭据没拿到');
    ok(els['apple-fail-text'].textContent.indexOf('重试') > -1, '文案没说可以重试');
    eq(els['btn-apple-retry'].textContent, '重试 Apple 登录');
    eq(els['btn-apple-other'].textContent, '改用邮箱/Google');
    deepEq(calls.note, ['apple_asauth_1000'], '事件 code 不是编码后的 ASAuthorizationError 值');
    ok(calls.note.indexOf('apple_failed') < 0, '仍然发 apple_failed');
    deepEq(calls.say, [{ msg: '', isErr: false }], '失败卡自己承载文案，状态行应清空');
  });

  test('点「重试 Apple 登录」重新进同一个 Apple 启动路径，并先收掉失败卡', () => {
    const { ui, els, calls } = mkUi();
    ui.wire();
    ui.failed({ error: 'apple_failed', errorCode: 1002, errorDomain: AUTH_DOMAIN });
    els['btn-apple-retry'].dispatch('click', {});
    eq(calls.start, 1, '重试没有调用 Apple 启动路径');
    eq(els['apple-fail'].hidden, true, '重试后面板还挡着');
  });

  test('点「改用邮箱/Google」打开现有邮箱表单，并收掉失败卡', () => {
    const { ui, els, calls } = mkUi();
    ui.wire();
    ui.failed({ error: 'apple_failed', errorCode: 1004, errorDomain: AUTH_DOMAIN });
    els['btn-apple-other'].dispatch('click', {});
    eq(calls.other, 1, '改道出口没有打开邮箱/Google');
    eq(els['apple-fail'].hidden, true);
  });

  test('canceled：不显示失败卡，文案不含「失败」，发 canceled 而不是 apple_failed', () => {
    const { ui, els, calls } = mkUi();
    const out = ui.canceled();
    eq(out.kind, 'canceled');
    eq(out.code, 'canceled');
    eq(els['apple-fail'].hidden, true, '取消后还挂着失败卡');
    eq(calls.say.length, 1);
    ok(calls.say[0].msg.indexOf('失败') < 0, '取消文案里出现了「失败」: ' + calls.say[0].msg);
    ok(/取消/.test(calls.say[0].msg), '取消文案没有说明已取消');
    deepEq(calls.note, ['canceled'], '取消没有发既有 canceled 语义');
    ok(calls.note.indexOf('apple_failed') < 0, '取消被记成 apple_failed');
  });

  test('把 canceled 结果喂给 failed() 也走取消分支（防御式）', () => {
    const { ui, els, calls } = mkUi();
    const out = ui.failed({ error: 'apple_failed', errorCode: 1001, errorDomain: AUTH_DOMAIN });
    eq(out.kind, 'canceled');
    eq(els['apple-fail'].hidden, true);
    deepEq(calls.note, ['canceled']);
  });
});

describe('BEL-272 壳接线：首点与重试是同一个 startAppleSignIn', () => {
  const shell = read('src/app/shell-model.js');
  const jsx = read('src/app/AppShell.jsx');

  test('壳从 apple-native.js 引入编码器与失败卡', () => {
    ok(/import \{ createAppleFailureUi, classifyAppleResult \} from '\.\/apple-native\.js'/.test(shell),
      'shell-model 没引入 BEL-272 模块');
    ok(/appleFailure = createAppleFailureUi\(\{/.test(shell), '壳没有创建失败卡');
    ok(/start: startAppleSignIn/.test(shell), '失败卡的重试没有接到 startAppleSignIn');
    ok(/openOther: openEmailForms/.test(shell), '失败卡的改道没有接到邮箱表单');
  });

  test('首点与重试都调 startAppleSignIn；它 postMessage 到原生桥', () => {
    ok(/\$\('btn-apple'\)\.addEventListener\('click', startAppleSignIn\)/.test(shell),
      'Apple 首点没有走 startAppleSignIn');
    const startFn = shell.slice(shell.indexOf('function startAppleSignIn()'),
      shell.indexOf('// macOS now opens the default browser'));
    ok(/window\.webkit\.messageHandlers\.mtAppleSignIn\.postMessage\(\{\}\)/.test(startFn),
      'startAppleSignIn 没有重新 postMessage（系统面板不会回来）');
    ok(/appleFailure\.hide\(\)/.test(startFn), '重试前没有先收掉失败卡');
  });

  test('apple-result 失败走分类器：canceled 与 failed 分开，不再直接发 error 字符串', () => {
    ok(/const outcome = classifyAppleResult\(r\)/.test(shell), 'apple-result 没有分类');
    ok(/appleFailure\.canceled\(\)/.test(shell), 'canceled 没有走取消语义');
    ok(/appleFailure\.failed\(r\)/.test(shell), '失败没有走失败卡');
    ok(!/noteAuthFail\('apple', 'native', \(r && r\.error\)/.test(shell),
      '还在把原生 error 字符串原样塞进 auth_fail.code');
  });

  test('失败卡的两个出口也纳入登录锁（点击重试后不能重复开流程）', () => {
    const m = shell.match(/const LOGIN_ENTRY_IDS = \[([\s\S]*?)\];/);
    ok(m, '找不到 LOGIN_ENTRY_IDS');
    ok(/'btn-apple-retry'/.test(m[1]), '重试按钮不在登录锁里');
    ok(/'btn-apple-other'/.test(m[1]), '改道按钮不在登录锁里');
  });

  test('AppShell 的失败卡默认隐藏，两个按钮 / 文案节点都在，且无写死中文', () => {
    ok(/<div id="apple-fail" className="apple-fail" role="alert" hidden>/.test(jsx),
      '失败卡不存在或默认没隐藏');
    ok(/<p id="apple-fail-text"><\/p>/.test(jsx), '失败文案节点不是空的（会漏出写死中文）');
    ok(/<button id="btn-apple-retry" type="button" className="secondary"><\/button>/.test(jsx),
      '重试按钮缺失/不是次级样式');
    ok(/<button id="btn-apple-other" type="button" className="link"><\/button>/.test(jsx),
      '改道按钮缺失/不是文字链接');
    ok(!/[一-鿿]/.test(jsx.slice(jsx.indexOf('id="apple-fail"'), jsx.indexOf('id="btn-signin"'))),
      '失败卡区域写了硬中文 —— 由 t() 画');
  });
});
