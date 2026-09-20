// test/setup-done.test.js —「配好了」的回执（画布第 7 页 · SetupDone / SetupFrom）。
//
// 用户 2026-09-20 在真机上报的：领完免费额度 / 填完 key 之后没有任何一处告诉他配好了。
// 这一层最容易犯的错不是画得难看，是**在没有证据的时候说「可以用了」** ——
// 领免费额度此前就是这样：一次自检都不跑，直接说「免费额度已配好」。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');

function load(opts) {
  const o = opts || {};
  const store = Object.assign({ provider: 'deepseek', apiKey: 'sk-x' }, o.store || {});
  const els = {};
  const mk = (id) => ({
    id, textContent: '', className: '', hidden: false, children: [],
    appendChild(c) { this.children.push(c); },
    append(...c) { this.children.push(...c); },
    addEventListener(t, fn) { this.onclick = fn; },
  });
  for (const id of ['setup-done', 'setup-done-title', 'setup-done-rows', 'setup-done-note', 'setup-done-act']) els[id] = mk(id);
  const tested = [];
  const dual = (fn) => (arg, cb) => { const v = fn(arg); if (cb) { cb(v); return undefined; } return Promise.resolve(v); };
  const ctx = {
    console,
    document: {
      getElementById: (id) => els[id] || null,
      createElement: (tag) => mk(tag),
    },
    chrome: { storage: { local: { get: dual(() => Object.assign({}, store)) }, onChanged: { addListener() {} } } },
    EngineTest: {
      translation: async (cfg) => { tested.push('chat'); if (o.failChat) throw Object.assign(new Error('bad'), { code: 'auth' }); return { ms: 512 }; },
      tts: async () => { tested.push('tts'); if (o.failTts) throw Object.assign(new Error('bad'), { code: 'auth' }); return { ms: 300 }; },
      stt: async () => { tested.push('stt'); return { ms: 400 }; },
      format: (r, e) => (e ? '✗ ' + (e.code || '') : '✓ 通了 · ' + r.ms + 'ms'),
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'setup-done.js'), 'utf8'), ctx, { filename: 'setup-done.js' });
  return { ctx, els, tested, D: ctx.AppSetupDone };
}

describe('setup-done: 「配好了」的回执（画布第 7 页）', () => {
  test('★ 没跑过自检就不说「可以用了」—— 一个槽都没写时整块不出现', async () => {
    const { D, els, tested } = load({});
    const r = await D.show([]);
    eq(r.shown, false);
    eq(els['setup-done'].hidden, true);
    eq(tested.length, 0, '没写槽就不该发请求');
  });

  test('★ 真的跑一次自检 —— 这正是领免费额度此前缺的那一步', async () => {
    const { D, tested } = load({});
    const r = await D.show(['chat']);
    deepEq(tested, ['chat']);
    eq(r.ok, true);
  });

  test('★ 有一项没通就不说「可以用了」，标题与话都换掉', async () => {
    const { D, els } = load({ failChat: true });
    const r = await D.show(['chat', 'tts']);
    eq(r.ok, false);
    ok(!els['setup-done-title'].textContent.includes('可以用了'), '标题不能还说可以用了');
    ok(/还不能用/.test(els['setup-done-title'].textContent));
    eq(els['setup-done-note'].className, 'note w', '失败用警示样式');
    eq(els['setup-done-act'].hidden, true, '没通过时不给「下一步」—— 下一步是改，不是走');
  });

  test('★ 「解析」没有独立端点可测 —— 不假装测过它', async () => {
    const { D, tested } = load({});
    await D.show(['chat', 'notes']);
    deepEq(tested, ['chat'], 'notes 跟随翻译，不单独发请求');
  });

  test('★ 下一步按「从哪来」变，而系统翻译那一支**没有按钮**', () => {
    const { D } = load({});
    const sys = D.nextFor('systrans');
    eq(sys.btn, null, 'iOS 送不回去 —— 给一个点了没用的按钮比不给更糟');
    ok(/回到刚才那个 App/.test(sys.line));
    const st = D.nextFor('settings');
    ok(st.btn && st.btn.text, '自己走进设置的人给一个回首页');
    ok(/快速翻译面板/.test(D.nextFor('quick').line));
  });

  test('mark 只认闭集里的来处，脏值不改变状态', () => {
    const { D } = load({});
    eq(D.current(), 'settings', '默认是「自己走进来的」');
    D.mark('systrans'); eq(D.current(), 'systrans');
    D.mark('../../etc'); eq(D.current(), 'systrans', '认不出来的值不该改状态');
  });

  test('★ 文案键在 12 个语种里都有', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'setup-done.js'), 'utf8');
    // 只认 `t('key', '兜底')` 这个形状 —— 光匹配 t('…') 会把 createElement('div') 也算进来。
    const keys = [...new Set((src.match(/\bt\('([a-z0-9_]+)',/g) || []).map((s) => s.slice(3, -2)))];
    ok(keys.length >= 8, '至少八个键，实际 ' + keys.length);
    for (const l of fs.readdirSync(path.join(ROOT, 'extension', '_locales'))) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', '_locales', l, 'messages.json'), 'utf8'));
      for (const k of keys) ok(m[k] && m[k].message, `${l} 缺 ${k}`);
    }
  });
});

describe('setup-done: 接线（深链、两条配置路、engineChosen）', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8');
  const settings = fs.readFileSync(path.join(ROOT, 'app', 'settings.js'), 'utf8');

  test('★ 深链的 from 不再被丢掉 —— 那句「回到刚才的 App」全靠它', () => {
    ok(/from: String\(u\.searchParams\.get\('from'\)/.test(app), 'parseDeepLink 要读 from');
    ok(/d\.from === 'system-translate'/.test(app), 'setup 分支要认它');
    ok(/setup_from_systrans/.test(app), '顶上那一行要落地（interaction-spec :980 写了很久）');
  });

  test('★ 两条配置路都要给回执 —— 领免费额度那条是重点', () => {
    const quick = settings.slice(settings.indexOf('async function applyQuickSetup'), settings.indexOf('async function markEngineChosen'));
    ok(/AppSetupDone\.show/.test(quick), '一键卡配完要给回执');
    const grant = settings.slice(settings.indexOf('grant_claimed_toast'));
    ok(/AppSetupDone\.show/.test(grant.slice(0, 900)), '领免费额度配完也要给回执（此前一次自检都不跑）');
  });

  test('★ engineChosen 在 App 里要写 —— 不写就会在选了免费引擎之后仍说「没配过」', () => {
    ok(/engineChosen: 1/.test(settings), 'App 侧要有写入点');
    const fn = settings.slice(settings.indexOf('async function markEngineChosen'));
    ok(/if \(!w\.provider\) return;/.test(fn.slice(0, 400)), '只在真的写了 provider 时才算「选过」');
  });

  test('离开设置页要把回执收掉 —— 留着会让下一次进来看到一段与此刻无关的「可以用了」', () => {
    const close = app.slice(app.indexOf('async function closeSettings'), app.indexOf('async function closeSettings') + 600);
    ok(/AppSetupDone\.hide\(\)/.test(close));
    ok(/setup-from'\)\.hidden = true/.test(close));
  });
});
