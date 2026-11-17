// test/bel290-quick-setup-telemetry.test.js — BEL-290 拍 B：一键设定的成功/失败遥测。
//
// 走真实的 src/shared/quick-setup-view.jsx：一个够用的假 DOM 让 render() 建出卡，
// 点 #qs-apply 触发那条命令式异步流。断言的是 track() 收到的 name + props，不是
// 源码里有没有某一行。
//
// 覆盖：ok 的 wrote any/none、replaced grant/none；precheck no_key/no_base；
// read 失败的两条路（{ok:false} 与抛错）；write 失败（onApply 抛错，且 props 里
// 没有 e.message）；surface 三值；surface 缺失时不发（fail-closed）。
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc, tick } = require('./harness');

const ROOT = path.join(__dirname, '..');
const WireFormat = require('../extension/content/wire-format.js');

const HOST = 'api.acme.test';
const PROVIDERS = [
  { id: 'acme', type: 'chat-compat', needsKey: true, defaultEndpoint: 'https://' + HOST + '/v1/chat/completions', defaultModel: 'acme-chat', keyUrl: 'https://acme.test/key', oneClick: true },
  { id: 'custom_chat', type: 'chat-compat', needsKey: true, requiresEndpoint: true, defaultEndpoint: '', defaultModel: 'custom-chat', oneClick: true },
];
const TTS = [{ id: 'acme_tts', needsKey: true, defaultEndpoint: 'https://' + HOST + '/v1/audio/speech', oneClick: true }];
const STT = [{ id: 'acme_stt', needsKey: true, defaultEndpoint: 'https://' + HOST + '/v1/audio/transcriptions', oneClick: true }];

// ── 假 DOM：render() 实际用到的那些方法 ────────────────────────────────────
function makeDom() {
  const byId = new Map();
  function el(tag) {
    let text = '';
    const e = {
      tagName: tag, id: '', className: '', hidden: false, disabled: false,
      value: '', type: '', placeholder: '', href: '', target: '', rel: '',
      autocomplete: '', autocapitalize: '', spellcheck: false, style: {}, dataset: {},
      children: [], parentNode: null, _listeners: {},
      get textContent() { return text; },
      set textContent(v) { text = v == null ? '' : String(v); if (text === '') e.children = []; },
      append(...nodes) {
        for (const n of nodes) {
          if (!n) continue;
          n.parentNode = e; e.children.push(n);
          if (n.id) byId.set(n.id, n);
        }
      },
      appendChild(n) { e.append(n); return n; },
      addEventListener(type, fn) { (e._listeners[type] = e._listeners[type] || []).push(fn); },
      removeEventListener() {},
      click() {
        const fns = e._listeners.click || [];
        return Promise.all(fns.map((fn) => fn({ target: e, preventDefault() {}, stopPropagation() {} })));
      },
      focus() {},
      remove() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; },
      setAttribute() {}, getAttribute() { return ''; }, removeAttribute() {},
    };
    return e;
  }
  const head = el('head');
  const body = el('body');
  const doc = {
    head, body,
    createElement: (tag) => el(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  return { doc, byId, makeBox() { const b = el('div'); b.ownerDocument = doc; return b; } };
}

function loadView(tracked, engineCalls) {
  const window = {
    MT_PROVIDERS: PROVIDERS, MT_TTS_ENGINES: TTS, MT_STT_ENGINES: STT,
    MT_RECOMMENDED_HOSTS: [HOST], MT_DEFAULT_TARGET_LANG: 'zh-CN', MT_FLAVOR: 'global',
  };
  const EngineTest = {
    translation: async (cfg) => { engineCalls.push(['translation', cfg]); return { ms: 1 }; },
    tts: async (cfg) => { engineCalls.push(['tts', cfg]); return { ms: 1 }; },
    stt: async (cfg) => { engineCalls.push(['stt', cfg]); return { ms: 1 }; },
    format: () => '✓',
  };
  const ctx = loadSrc('src/shared/quick-setup-view.jsx', 'QuickSetupView', {
    window, WireFormat, EngineTest,
    MTTelemetry: { track: (name, props) => tracked.push({ name, props: props || {} }) },
  });
  return ctx.QuickSetupView;
}

const BASE_SETTINGS = {};

function mount(opts) {
  const tracked = [];
  const engineCalls = [];
  const View = loadView(tracked, engineCalls);
  const dom = makeDom();
  const box = dom.makeBox();
  const optsFull = Object.assign({
    t: (k, fb) => fb || k,
    surface: 'ext_settings',
    readSettings: async () => ({ ok: true, data: BASE_SETTINGS }),
    replaceKeyTail: async () => '',
    targetLang: 'zh-CN',
    onApply: async () => {},
  }, opts || {});
  View.render(box, optsFull);
  const key = dom.doc.getElementById('qs-key');
  const base = dom.doc.getElementById('qs-base');
  const btn = dom.doc.getElementById('qs-apply');
  ok(btn, 'render() 没有建出 #qs-apply —— 假 DOM 或组件坏了');
  return { tracked, engineCalls, dom, box, key, base, btn };
}

const failEvents = (tracked) => tracked.filter((e) => e.name === 'setup_apply_fail');
const okEvents = (tracked) => tracked.filter((e) => e.name === 'setup_apply_ok');

describe('BEL-290 · setup_apply_ok', () => {
  test('wrote any / replaced none + surface ext_settings', async () => {
    const m = mount({ surface: 'ext_settings' });
    m.key.value = 'sk-new';
    await m.btn.click();
    await tick(0);
    eq(failEvents(m.tracked).length, 0, '成功路径不该发 fail');
    eq(okEvents(m.tracked).length, 1, '一次成功只发一条');
    deepEq(okEvents(m.tracked)[0].props, { surface: 'ext_settings', wrote: 'any', replaced: 'none' });
    eq(m.engineCalls.length, 3, '三个槽都该跑自检');
    eq(m.engineCalls.every((c) => c[1].surface === 'setup_quick'), true, 'engine_test 的 surface 是 setup_quick');
  });

  test('wrote none（三槽早已配好）+ surface app_feature', async () => {
    const m = mount({
      surface: 'app_feature',
      readSettings: async () => ({ ok: true, data: { apiKey: 'sk-mine', ttsApiKey: 'sk-mine', sttEngine: 'acme_stt' } }),
    });
    m.key.value = 'sk-new';
    await m.btn.click();
    await tick(0);
    eq(okEvents(m.tracked).length, 1);
    deepEq(okEvents(m.tracked)[0].props, { surface: 'app_feature', wrote: 'none', replaced: 'none' });
  });

  test('replaced grant：尾号命中免费额度槽 ⇒ replaced grant + surface onboard', async () => {
    const m = mount({
      surface: 'onboard',
      readSettings: async () => ({ ok: true, data: { apiKey: 'bmg_abc12345', grantTail: 'abc12345' } }),
      replaceKeyTail: async () => 'abc12345',
    });
    m.key.value = 'sk-new';
    await m.btn.click();
    await tick(0);
    eq(okEvents(m.tracked).length, 1);
    deepEq(okEvents(m.tracked)[0].props, { surface: 'onboard', wrote: 'any', replaced: 'grant' });
  });

  test('三个 surface 都发得出去，第四种值 fail-closed', async () => {
    for (const surface of ['ext_settings', 'app_feature', 'onboard']) {
      const m = mount({ surface });
      m.key.value = 'sk-new';
      await m.btn.click();
      await tick(0);
      eq(okEvents(m.tracked)[0].props.surface, surface);
    }
    const bad = mount({ surface: 'ext_setting' });
    bad.key.value = 'sk-new';
    await bad.btn.click();
    await tick(0);
    eq(bad.tracked.length, 0, '表外 surface 不该发事件（客户端会整条丢弃）');
  });
});

describe('BEL-290 · setup_apply_fail precheck', () => {
  test('空 key → precheck/no_key，surface 原样带上', async () => {
    const m = mount({ surface: 'onboard' });
    m.key.value = '   ';
    await m.btn.click();
    eq(failEvents(m.tracked).length, 1);
    deepEq(failEvents(m.tracked)[0].props, { surface: 'onboard', stage: 'precheck', code: 'no_key' });
    eq(okEvents(m.tracked).length, 0);
  });

  test('自定义平台缺地址 → precheck/no_base', async () => {
    const m = mount({ surface: 'ext_settings', prefill: { custom: true } });
    m.key.value = 'sk-new';
    m.base.value = '';
    await m.btn.click();
    eq(failEvents(m.tracked).length, 1);
    deepEq(failEvents(m.tracked)[0].props, { surface: 'ext_settings', stage: 'precheck', code: 'no_base' });
  });
});

describe('BEL-290 · setup_apply_fail read / write', () => {
  test('readSettings 返回 {ok:false} → read/storage', async () => {
    const m = mount({ surface: 'app_feature', readSettings: async () => ({ ok: false, error: 'disk' }) });
    m.key.value = 'sk-new';
    await m.btn.click();
    eq(failEvents(m.tracked).length, 1);
    deepEq(failEvents(m.tracked)[0].props, { surface: 'app_feature', stage: 'read', code: 'storage' });
  });

  test('readSettings 抛错 → read/storage（抛错与返回值同一类）', async () => {
    const m = mount({ surface: 'onboard', readSettings: async () => { throw new Error('boom'); } });
    m.key.value = 'sk-new';
    await m.btn.click();
    eq(failEvents(m.tracked).length, 1);
    deepEq(failEvents(m.tracked)[0].props, { surface: 'onboard', stage: 'read', code: 'storage' });
  });

  test('onApply 抛错 → write/storage，且 e.message 不进 props', async () => {
    const secret = 'quota-bucket/path/secret-key-name';
    const m = mount({ surface: 'ext_settings', onApply: async () => { throw new Error(secret); } });
    m.key.value = 'sk-new';
    await m.btn.click();
    await tick(0);
    eq(failEvents(m.tracked).length, 1);
    deepEq(failEvents(m.tracked)[0].props, { surface: 'ext_settings', stage: 'write', code: 'storage' });
    ok(!JSON.stringify(m.tracked).includes(secret), '写盘错误的 message 泄漏进了遥测');
    eq(okEvents(m.tracked).length, 0, '写盘失败绝不能同时发 ok');
  });
});

describe('BEL-290 · 三个宿主把 surface 传进同一个渲染器', () => {
  const fs = require('fs');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const cases = [
    ['src/pages/options.jsx', 'ext_settings'],
    ['src/app/settings-view.jsx', 'app_feature'],
    ['src/pages/onboard.jsx', 'onboard'],
  ];
  for (const [file, surface] of cases) {
    test(`${file} → renderQuickSetup({ surface: '${surface}' })`, () => {
      const src = read(file);
      const i = src.indexOf('renderQuickSetup(');
      ok(i >= 0, file + ' 没有挂一键卡');
      const block = src.slice(i, i + 1800);
      ok(block.includes("surface: '" + surface + "'"), file + ' 没把 surface 传给一键卡');
    });
  }
});
