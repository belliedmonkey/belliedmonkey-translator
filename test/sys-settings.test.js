// test/sys-settings.test.js — App 设置里「系统翻译」那一块（§9.9 / iOS 线 I-7）。
//
// 这一块最容易犯的错不是画错，是**说一句我们其实不知道的话**。系统不提供「我是不是
// 当前的默认翻译 App」这个接口（T1 尖刺逐条翻过 SDK），所以「已启用 ✓」一旦写上去，
// 一个没选中我们的人看到它只会认为功能坏了 —— 而他其实只差点一下。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');

function load(opts) {
  const o = opts || {};
  const store = Object.assign({}, o.store || {});
  const els = {};
  const mk = () => ({ textContent: '', checked: false, disabled: false, hidden: false, addEventListener() {} });
  for (const id of ['g-systrans', 'systrans-title', 'systrans-state', 'systrans-intro',
    'systrans-step1', 'systrans-step2', 'systrans-step3', 'systrans-need',
    'systrans-capture', 'systrans-capture-label', 'systrans-capture-hint']) els[id] = mk();
  const dual = (fn) => (arg, cb) => { const v = fn(arg); if (cb) { cb(v); return undefined; } return Promise.resolve(v); };
  const ctx = {
    console,
    document: { getElementById: (id) => els[id] || null, addEventListener() {} },
    chrome: {
      storage: {
        local: {
          get: dual((keys) => {
            const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
            const out = {};
            for (const k of list) if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
            return out;
          }),
          set: dual((obj) => { Object.assign(store, obj || {}); return undefined; }),
        },
        onChanged: { addListener() {} },
      },
    },
    AppVault: o.bridged === false ? { available: () => false, ack: () => null, onAck() {} }
      : { available: () => true, ack: () => (o.ack === undefined ? null : o.ack), onAck() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const rel of ['extension/content/providers.gen.js', 'extension/content/engine-state.js', 'app/sys-settings.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  }
  return { ctx, els, store, S: ctx.AppSysSettings };
}

describe('sys-settings: 设置里「系统翻译」那一块（I-7）', () => {
  test('★ 没有那条通道的壳（macOS / 老原生）整块不显示 —— 判据是通道在不在，不是 UA', async () => {
    const { els, S } = load({ bridged: false });
    await S.paint();
    eq(els['g-systrans'].hidden, true);
  });

  test('★ 绝不出现「已启用」这种猜的话 —— 系统不给「我是不是默认」的接口', () => {
    const { S } = load({});
    const all = [S.stateText(null, ''), S.stateText({ status: 0 }, 'deepseek'),
      S.stateText({ status: 0 }, ''), S.stateText({ status: -25300 }, 'deepseek')].join(' ');
    for (const bad of ['已启用', '已生效', '正在使用', '已设为默认']) {
      ok(!all.includes(bad), '不该出现「' + bad + '」：我们答不上来这件事');
    }
    const src = fs.readFileSync(path.join(ROOT, 'app', 'sys-settings.js'), 'utf8');
    ok(!/isDefault|checkDefault/.test(src), '也不该有一个假装能问出来的函数');
  });

  test('★ 三态都来自 vault-ack 的回读', () => {
    const { S } = load({});
    ok(/还没同步|Not synced/.test(S.stateText(null, 'deepseek')), '回执没到 = 还没同步');
    ok(S.stateText({ status: 0 }, 'deepseek').includes('DeepSeek'), '成功要把引擎名说出来');
    ok(/还没配置引擎/.test(S.stateText({ status: 0 }, '')), '没配引擎是另一句话，不是「已同步」');
    const failed = S.stateText({ status: -25300 }, 'deepseek');
    ok(failed.includes('-25300'), 'OSStatus 要原样带出来 —— 这是唯一能定位它的数字');
  });

  test('★ 引擎名来自注册表，不是另写一份 id → 名字的表', () => {
    const { S } = load({});
    ok(S.stateText({ status: 0 }, 'deepseek').includes('DeepSeek'));
    // 认不出来的 id 就原样显示，不编一个名字
    ok(S.stateText({ status: 0 }, 'engine_that_no_longer_exists').includes('engine_that_no_longer_exists'));
    const src = fs.readFileSync(path.join(ROOT, 'app', 'sys-settings.js'), 'utf8');
    ok(!/'openai':|"openai":/.test(src), 'sys-settings.js 里不该出现任何引擎 id 的字面表');
  });

  test('★ 采集开关跟着学习总闸走 —— 总闸关着时它是灰的，不是「看起来能点」', async () => {
    const a = load({ store: { learnEnabled: false, handoffCapture: true }, ack: { status: 0 } });
    await a.S.paint();
    eq(a.els['systrans-capture'].disabled, true);
    const b = load({ store: { learnEnabled: true }, ack: { status: 0 } });
    await b.S.paint();
    eq(b.els['systrans-capture'].disabled, false);
    eq(b.els['systrans-capture'].checked, true, '默认开');
  });

  test('三步指引与版本要求都画出来了（弹层里那句「打开大肚猴翻译」把人送到的就是这里）', () => {
    const { els, S } = load({});
    S.paintStatic();
    for (const id of ['systrans-step1', 'systrans-step2', 'systrans-step3', 'systrans-need']) {
      ok(els[id].textContent.length > 0, id + ' 不该是空的');
    }
    ok(els['systrans-need'].textContent.includes('18.4'), '版本要求要说出具体数字');
  });

  test('★ 文案键在 12 个语种里都有 —— 少一个语种就是那一格空白', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'sys-settings.js'), 'utf8');
    const keys = [...new Set((src.match(/t\('([a-z0-9_]+)'/g) || []).map((s) => s.slice(3, -1)))];
    ok(keys.length >= 10, '至少十来个键，实际 ' + keys.length);
    const locales = fs.readdirSync(path.join(ROOT, 'extension', '_locales'));
    eq(locales.length, 12);
    for (const l of locales) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', '_locales', l, 'messages.json'), 'utf8'));
      for (const k of keys) ok(m[k] && m[k].message, `${l} 缺 ${k}`);
    }
  });

  test('★ 带参数的两句在每个语种里都要留着占位符', () => {
    const locales = fs.readdirSync(path.join(ROOT, 'extension', '_locales'));
    for (const l of locales) {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', '_locales', l, 'messages.json'), 'utf8'));
      ok(m.systrans_state_ok.message.includes('{name}'), l + ' 的 systrans_state_ok 丢了 {name}');
      ok(m.systrans_state_failed.message.includes('{code}'), l + ' 的 systrans_state_failed 丢了 {code}');
    }
  });
});
