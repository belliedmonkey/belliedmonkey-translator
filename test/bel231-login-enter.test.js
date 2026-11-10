// test/bel231-login-enter.test.js — 1.23.3 第一优先级：登录页邮箱回车即发验证码。
//
// 真机：键盘盖住「发送验证码」，XCUITest 点它 isHittable=false，换号/重登反复卡住。
// 用户令：回车直接触发发送，不新增按钮、不改视觉。
//
// 这道门钉四件事：
//   1. 回车走表单 submit 事件，与 #send 点击落到**同一个** submitEmailCode()；
//   2. 发送中再回车不触发第二次（LearnAuth.signIn 调用次数 strictEqual 1）；
//   3. 输入法组词中的 Enter（isComposing=true）不发；
//   4. 空邮箱不发。
// 另外静态钉住 enterKeyHint 与「只有一份发送逻辑」。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc, tick } = require('./harness');

const ROOT = path.join(__dirname, '..');
const SHELL = path.join(ROOT, 'src/app/shell-model.js');
const APPSHELL = path.join(ROOT, 'src/app/AppShell.jsx');
const shellSrc = fs.readFileSync(SHELL, 'utf8');
const appShellSrc = fs.readFileSync(APPSHELL, 'utf8');

const ctx = loadSrc('src/app/shell-model.js', 'Shell', { window: {}, URL });

function mkEl(id) {
  return {
    id, hidden: false, disabled: false, value: '', textContent: '',
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatch(type, ev) { for (const fn of (this.listeners[type] || [])) fn(ev); },
    focus() { this.focused = (this.focused || 0) + 1; },
    classList: {
      added: [],
      add(c) { this.added.push(c); },
      remove() {},
    },
  };
}

function mkForm() {
  const el = mkEl('email-form');
  el.requestSubmit = function () {
    this.requested = (this.requested || 0) + 1;
    const ev = { prevented: 0, preventDefault() { this.prevented++; } };
    this.dispatch('submit', ev);
  };
  return el;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// 与 bootShell 的接线一一对应：同一个工厂、同一个 wire()。
function make(overrides) {
  const o = overrides || {};
  const els = {
    form: mkForm(),
    email: mkEl('email'),
    send: mkEl('send'),
    codeForm: mkEl('code-form'),
    code: mkEl('code'),
    prompt: mkEl('signin-prompt'),
  };
  const calls = { signIn: [], say: [], busy: [] };
  let busy = false;
  let pending = '';
  const sender = ctx.Shell.createEmailCodeSender({
    form: els.form,
    emailInput: els.email,
    sendButton: els.send,
    codeForm: els.codeForm,
    codeInput: els.code,
    prompt: els.prompt,
    t: o.t || ((k, fallback) => fallback),
    say: (msg, isErr) => { calls.say.push({ msg, isErr: !!isErr }); },
    humanError: (e) => 'human:' + ((e && e.code) || 'error'),
    setLoginBusy: (b) => {
      busy = !!b;
      calls.busy.push(busy);
      els.send.disabled = busy;
    },
    isLoginBusy: () => busy,
    LearnAuth: {
      signIn: (email) => {
        calls.signIn.push(email);
        if (o.signIn) return o.signIn(email);
        return Promise.resolve({});
      },
    },
    setPendingEmail: (v) => { pending = v; },
  });
  sender.wire();
  return { sender, els, calls, get busy() { return busy; }, get pending() { return pending; } };
}

function pressEnter(env, extra) {
  const ev = Object.assign({ key: 'Enter', isComposing: false, prevented: 0,
    preventDefault() { this.prevented++; } }, extra || {});
  env.els.email.dispatch('keydown', ev);
  return ev;
}

describe('1.23.3 登录页：回车即发验证码（同一个发送函数）', () => {
  test('★ Enter 与 #send 点击都落到 submitEmailCode()，各只调一次 LearnAuth.signIn', async () => {
    const enterEnv = make();
    enterEnv.els.email.value = '  User@Example.com  ';
    pressEnter(enterEnv);
    await tick();
    deepEq(enterEnv.calls.signIn, ['User@Example.com'], '回车：裁剪空白后发一次');
    eq(enterEnv.els.form.requested, 1, '回车走 form.requestSubmit()（submit 事件仍在）');
    eq(enterEnv.pending, 'User@Example.com', 'pendingEmail 由同一个函数写入');
    eq(enterEnv.els.form.hidden, true);
    eq(enterEnv.els.codeForm.hidden, false);
    ok(enterEnv.els.prompt.classList.added.includes('code-step'), '切到验证码第二屏');
    eq(enterEnv.els.code.focused, 1, '验证码框取焦');
    eq(enterEnv.calls.say[enterEnv.calls.say.length - 1].msg, '验证码已发送，查收邮件。');

    const clickEnv = make();
    clickEnv.els.email.value = '  User@Example.com  ';
    clickEnv.els.form.requestSubmit();       // #send 是 type=submit：点击等价于表单提交
    await tick();
    deepEq(clickEnv.calls.signIn, ['User@Example.com'], '点击：同一个函数，同一次发送');
    deepEq(clickEnv.calls.say, enterEnv.calls.say, '两条路的文案轨迹逐字相同');
    eq(clickEnv.pending, enterEnv.pending);
  });

  test('★ 发送中再按 Enter 不触发第二次：LearnAuth.signIn strictEqual 1', async () => {
    const d = deferred();
    const env = make({ signIn: () => d.promise });
    env.els.email.value = 'a@b.c';

    pressEnter(env);
    pressEnter(env);                          // 同一 tick 内重复回车（await 之前）
    await tick();
    eq(env.calls.signIn.length, 1, 'in-flight 守卫挡下第二次');
    eq(env.els.form.requested, 2, '第二次回车仍派发 submit，但发送函数入口就返回了');
    deepEq(env.calls.busy, [true], '此时仍忙于第一次发送');
    eq(env.busy, true);

    d.resolve({});
    await tick();
    eq(env.els.form.hidden, true, '第一次发送正常完成');
    deepEq(env.calls.busy, [true, false], '结束后解锁');
    eq(env.busy, false);
  });

  test('isComposing=true 的 Enter 不发送，也不拦默认行为', async () => {
    const env = make();
    env.els.email.value = 'a@b.c';
    const ev = pressEnter(env, { isComposing: true });
    await tick();
    eq(env.calls.signIn.length, 0);
    eq(env.els.form.requested, undefined, '连 submit 都不该派发');
    eq(ev.prevented, 0, '组词中的回车留给输入法');
  });

  test('空邮箱 Enter 不发送', async () => {
    const env = make();
    env.els.email.value = '   ';
    pressEnter(env);
    await tick();
    eq(env.calls.signIn.length, 0);
    deepEq(env.calls.busy, [], '连忙碌态都不该进');
    eq(env.els.send.textContent, '', '「正在发送…」不该闪一下');
  });

  test('★ 无效邮箱（abc，无 @）客户端先拦：0 次 signIn，显示 app_email_invalid', async () => {
    const keys = [];
    const env = make({
      t: (k, fallback) => { keys.push(k); return k === 'app_email_invalid' ? 'app_email_invalid' : fallback; },
    });
    env.els.email.value = 'abc';
    pressEnter(env);
    await tick();
    eq(env.calls.signIn.length, 0, '格式不对时一条 POST 都不该发');
    deepEq(env.calls.busy, [], '不进「正在发送…」状态');
    eq(env.els.send.textContent, '', '「正在发送…」不该闪一下');
    eq(env.els.form.hidden, false, '停留在邮箱页');
    eq(env.pending, '', '不写 pendingEmail');
    ok(!env.els.prompt.classList.added.includes('code-step'), '不切到验证码第二屏');
    ok(keys.includes('app_email_invalid'), '错误文案走共享表 app_email_invalid');
    const last = env.calls.say[env.calls.say.length - 1];
    eq(last.msg, 'app_email_invalid', '页面显示「邮箱格式不对」（这里用 key 代表译文）');
    eq(last.isErr, true, '按错误态上屏');
  });

  test('★ 完整地址仍只发 1 次并进验证码页（有效路径不受影响）', async () => {
    const env = make();
    env.els.email.value = 'user@example.com';
    pressEnter(env);
    await tick();
    deepEq(env.calls.signIn, ['user@example.com'], '有效地址照常发一次');
    eq(env.pending, 'user@example.com');
    eq(env.els.form.hidden, true);
    ok(env.els.prompt.classList.added.includes('code-step'), '切到验证码第二屏');
    eq(env.els.code.focused, 1);
  });

  test('非 Enter 键不发送', async () => {
    const env = make();
    env.els.email.value = 'a@b.c';
    const ev = pressEnter(env, { key: 'a' });
    await tick();
    eq(env.calls.signIn.length, 0);
    eq(env.els.form.requested, undefined);
    eq(ev.prevented, 0);
  });

  test('★ 回车不直接调发送函数：必须经过 submit 事件，出境的同意捕获闸才拦得住', async () => {
    const env = make();
    env.els.email.value = 'a@b.c';
    env.els.form.requestSubmit = function () { this.requested = (this.requested || 0) + 1; };
    pressEnter(env);
    await tick();
    eq(env.els.form.requested, 1, 'Enter 交给 requestSubmit');
    eq(env.calls.signIn.length, 0, 'requestSubmit 没有派发 submit ⇒ 不发送（证明没有绕过事件直调）');

    // 反向：捕获阶段的闸拦下 submit 时，发送函数一次都不该跑。
    const gated = make();
    gated.els.email.value = 'a@b.c';
    gated.els.form.requestSubmit = function () {
      this.requested = (this.requested || 0) + 1;
      // 模拟 #signin-prompt 捕获阶段 stopImmediatePropagation：form 上的 submit 监听收不到。
    };
    pressEnter(gated);
    await tick();
    eq(gated.calls.signIn.length, 0);
  });

  test('失败路径保持原样：humanError 上屏、表单不前进、忙碌态解锁', async () => {
    const env = make({ signIn: () => Promise.reject(Object.assign(new Error('x'), { code: 'rate_limited' })) });
    env.els.email.value = 'a@b.c';
    pressEnter(env);
    await tick();
    eq(env.els.form.hidden, false, '失败不切到验证码页');
    const last = env.calls.say[env.calls.say.length - 1];
    eq(last.msg, 'human:rate_limited');
    eq(last.isErr, true);
    eq(env.busy, false);
    eq(env.els.send.textContent, '发送验证码');
  });
});

describe('1.23.3 接线静态门（enterKeyHint / 只有一份发送逻辑）', () => {
  const inputTag = (id) => (appShellSrc.match(new RegExp('<input id="' + id + '"[\\s\\S]*?/>')) || [''])[0];

  test('★ #email 带 enterKeyHint="send"，保留 inputMode="email"，id/类名不变', () => {
    const tag = inputTag('email');
    ok(tag.includes('enterKeyHint="send"'), '#email 的键盘回车键应显示「发送」');
    ok(tag.includes('inputMode="email"'), 'inputMode 不能丢');
    ok(tag.includes('id="email"'), 'id 不能改');
  });

  test('#code 顺带 enterKeyHint="done"', () => {
    ok(inputTag('code').includes('enterKeyHint="done"'));
  });

  test('★ 发送逻辑只有一份：LearnAuth.signIn(email) 在 shell 里只出现一次', () => {
    const hits = shellSrc.match(/LearnAuth\.signIn\(email\)/g) || [];
    eq(hits.length, 1, '发送逻辑被复制了第二份');
  });

  test('bootShell 用同一个工厂 wire()，不再自己写 submit 处理器', () => {
    ok(shellSrc.includes('createEmailCodeSender({'), '工厂被接线');
    ok(shellSrc.includes('emailSender.wire()'), 'submit 与 keydown 由 wire() 一处注册');
    ok(!shellSrc.includes("$('email-form').addEventListener('submit'"), '旧的独立 submit 处理器应已移除');
    ok(shellSrc.includes('form.requestSubmit()'), '回车走 requestSubmit（守住同意闸）');
  });
});
