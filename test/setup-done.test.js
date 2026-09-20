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
    // 一键卡这条路走 onResults（自检跑完、拿着卡自己的结果），**不在 onApply 里显示**：
    // onApply 在自检之前调用，那一刻说任何结论都是猜的（2026-09-20 真机：标题「可以用了」
    // 与一个 ✗ 并排挂了几十秒）。
    const quick = settings.slice(settings.indexOf('async function applyQuickSetup'), settings.indexOf('async function markEngineChosen'));
    ok(!/AppSetupDone\.show/.test(quick), 'applyQuickSetup 里不许显示回执 —— 那时候还没测');
    const render = settings.slice(settings.indexOf('QuickSetup.render('), settings.indexOf('QuickSetup.render(') + 900);
    ok(/onResults:/.test(render), '一键卡要传 onResults');
    ok(/AppSetupDone\.show\(plan && plan\.tests, \{ results \}\)/.test(render), '回执要拿卡的结果，不自己再测一遍');
    const grant = settings.slice(settings.indexOf('grant_claimed_toast'));
    ok(/AppSetupDone\.show/.test(grant.slice(0, 900)), '领免费额度配完也要给回执（此前一次自检都不跑）');
  });

  test('★ 同一次配置只测一遍 —— 两块自检并排，既矛盾又是两倍的钱', () => {
    const qs = fs.readFileSync(path.join(ROOT, 'extension', 'learn', 'quick-setup.js'), 'utf8');
    ok(/opts\.onResults\(p, results\)/.test(qs), '一键卡要把结果交出去');
    const done = fs.readFileSync(path.join(ROOT, 'app', 'setup-done.js'), 'utf8');
    const body = done.slice(done.indexOf('async function show('));
    ok(/opts && Array\.isArray\(opts\.results\)/.test(body), 'show 要认 opts.results');
    // 给了结果就不许进自测分支：runSlot 只能在 else 里被调用
    const elseBranch = body.slice(body.indexOf('} else {'), body.indexOf('// **没通过就不说'));
    ok(/runSlot\(slot, s\)/.test(elseBranch), 'runSlot 只在「没给结果」那一支里跑');
    ok(!/runSlot/.test(body.slice(0, body.indexOf('} else {'))), '给了结果的那一支不许再测');
  });

  test('★ 测完之前标题不许说「可以用了」', () => {
    const done = fs.readFileSync(path.join(ROOT, 'app', 'setup-done.js'), 'utf8');
    const body = done.slice(done.indexOf('async function show('));
    // 自测那一支：初始标题必须是中性的
    ok(/setup_done_checking/.test(body), '自测时初始标题要中性（正在检查…）');
    // 第一个 ✗ 一落地就改口，而不是等 Promise.all
    const fail = body.slice(body.indexOf('const failNow'), body.indexOf('const failNow') + 300);
    ok(/setup_done_failed_title/.test(fail), 'failNow 要当场把标题改成「还不能用」');
    ok(/failNow\(\);/.test(body.slice(body.indexOf('} catch (e) {'))), '失败分支要调 failNow');
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

// ── 首页的「把系统翻译设成默认」横幅（画布第 7 页 · Discover / DiscoverWhen）─────
//
// 这一层最容易犯的错是**替用户回答一个我们答不上来的问题**：系统不提供「我是不是默认
// 翻译 App」这个接口。所以「已设好」只能由用户自己说，「已在用」只能由「真的收到过
// 句子」来证明 —— 两者都不许猜。
describe('sys-banner: 首页的发现横幅（画布第 7 页）', () => {
  const ROOT2 = path.join(__dirname, '..');
  function loadB(opts) {
    const o = opts || {};
    const store = Object.assign({}, o.store || {});
    const els = {};
    const mk = (id) => ({ id, textContent: '', hidden: false, children: [], appendChild(c) { this.children.push(c); }, addEventListener() {} });
    for (const id of ['systrans-banner', 'systrans-banner-title', 'systrans-banner-body',
      'systrans-banner-steps', 'systrans-banner-done', 'systrans-banner-go']) els[id] = mk(id);
    const dual = (fn) => (arg, cb) => { const v = fn(arg); if (cb) { cb(v); return undefined; } return Promise.resolve(v); };
    const ctx = {
      console,
      document: { getElementById: (id) => els[id] || null, createElement: (tag) => mk(tag) },
      chrome: {
        storage: {
          local: {
            get: dual((keys) => { const list = Array.isArray(keys) ? keys : Object.keys(keys || {}); const out = {}; for (const k of list) if (k in store) out[k] = store[k]; return out; }),
            set: dual((obj) => { Object.assign(store, obj); return undefined; }),
          },
        },
      },
      AppVault: { available: () => o.bridged !== false },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const rel of ['extension/content/providers.gen.js', 'extension/content/engine-state.js', 'app/sys-banner.js']) {
      vm.runInContext(fs.readFileSync(path.join(ROOT2, rel), 'utf8'), ctx, { filename: rel });
    }
    return { els, store, B: ctx.AppSysBanner };
  }
  const configured = { provider: 'deepseek', apiKey: 'sk-x' };

  test('★ 没有那条通道的壳（macOS / 老原生）永不出现', async () => {
    const { B } = loadB({ bridged: false, store: configured });
    eq(await B.decide({}), 'none');
  });

  test('★ 引擎都没配就别谈入口 —— 此刻首页该说的是别的事', async () => {
    const { B } = loadB({ store: {} });
    eq(await B.decide({}), 'none');
    const ok = loadB({ store: configured });
    eq(await ok.B.decide({}), 'ask');
  });

  test('★ 首页不能同时挂两张「还差一步」—— 扩展那张先', async () => {
    const { B } = loadB({ store: configured });
    eq(await B.decide({ extBannerShown: true }), 'none');
    eq(await B.decide({ extBannerShown: false }), 'ask');
  });

  test('★ 「我已设好」只能由用户说 —— 说过就永不再出现', async () => {
    const { B, store } = loadB({ store: configured });
    eq(await B.decide({}), 'ask');
    await B.markDone();
    ok(store.systransBannerDoneAt, '要落一个键');
    eq(await B.decide({}), 'none');
  });

  test('★ 「已在用」的唯一判据是真的收到过句子 —— 不是「我们觉得他设好了」', async () => {
    const { B } = loadB({ store: Object.assign({ systransSeenAt: 1 }, configured) });
    eq(await B.decide({}), 'used');
    // 用户自己关掉过 ⇒ 即便后来收到句子也不再打扰他
    const shut = loadB({ store: Object.assign({ systransSeenAt: 1, systransBannerDoneAt: 1 }, configured) });
    eq(await shut.B.decide({}), 'none');
  });

  test('别的视图开着 / 引导进行中都不出现', async () => {
    const { B } = loadB({ store: configured });
    eq(await B.decide({ away: true }), 'none');
    eq(await B.decide({ onboarding: true }), 'none');
  });

  test('★ 没有「打开设置」按钮 —— 它只会把人带到别处', () => {
    // **先剥注释**：这个文件的注释里正好写着「为什么不用 openSettingsURLString」，
    // 不剥就会被自己的解释绊倒（本仓踩过同一个坑：负向断言要先去掉注释）。
    const src = fs.readFileSync(path.join(ROOT2, 'app', 'sys-banner.js'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    ok(!/openSettingsURLString|prefs:root|App-prefs/.test(src),
      'openSettingsURLString 打开的是我们自己 App 的设置页，不是「设置 › App › 翻译」');
    const html = fs.readFileSync(path.join(ROOT2, 'app', 'index.html'), 'utf8');
    const at = html.indexOf('id="systrans-banner"');
    const sec = html.slice(at, html.indexOf('</section>', at));
    eq((sec.match(/<button/g) || []).length, 2, '只有「我已设好」与「在复习库里看」两个按钮');
  });

  test('★ 三步与设置块共用同一份文案键 —— 同一件事不许有两种说法', () => {
    const src = fs.readFileSync(path.join(ROOT2, 'app', 'sys-banner.js'), 'utf8');
    for (const k of ['systrans_step1', 'systrans_step2', 'systrans_step3']) ok(src.includes(k), '要复用 ' + k);
  });

  test('★ 收进句子那一刻要记一笔 —— 否则「已在用」永远判不出来', () => {
    const vm2 = fs.readFileSync(path.join(ROOT2, 'app', 'vault-mirror.js'), 'utf8');
    ok(/systransSeenAt/.test(vm2), 'vault-mirror 摄入成功后要落这个键');
    // 从**发出 ack 那一处**往后看，不是从协议表里那个字符串 —— 后者在文件开头。
    const seg = vm2.slice(vm2.indexOf("post({ type: 'inbox-ack'"));
    ok(/out\.written > 0/.test(seg), '只有真的写进库才算「在用」，被门拦下的不算');
  });

  test('★ 文案键在 12 个语种里都有', () => {
    const src = fs.readFileSync(path.join(ROOT2, 'app', 'sys-banner.js'), 'utf8');
    const keys = [...new Set((src.match(/\bt\('([a-z0-9_]+)',/g) || []).map((s) => s.slice(3, -2)))];
    ok(keys.length >= 6, '实际 ' + keys.length);
    for (const l of fs.readdirSync(path.join(ROOT2, 'extension', '_locales'))) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT2, 'extension', '_locales', l, 'messages.json'), 'utf8'));
      for (const k of keys) ok(m[k] && m[k].message, `${l} 缺 ${k}`);
    }
  });
});
