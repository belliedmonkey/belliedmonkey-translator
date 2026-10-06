// test/diag-log.test.js — 诊断日志三道门（§0.4.1 缺口补法，2026-10-06 用户拍板：
// 手机端补打点；中国版零网络，选项 A —— L1 本机 + 手动导出先上，L2 另批）。
//
//   1. schema 白名单：事件种类固定六类，白名单外的 kind 直接丢；
//   2. **零内容**：字段白名单在 push 处强制 —— 事件里进不来用户文本/译文/URL；
//   3. write-only：L2 信箱表（deploy/diag-events.sql）永远没有 SELECT/DELETE policy。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, ok } = require('./harness');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// 纯函数/行为级：vm 加载 diag-log.js（stub 掉 storage），验证白名单真的在过滤
function loadDiag() {
  const store = {};
  const ctx = {
    window: {},
    navigator: { userAgent: 'diag-test' },
    chrome: { storage: { local: {
      get: (k, cb) => cb({ [k]: store[k] }) ,
      set: (o, cb) => { Object.assign(store, o); if (cb) cb(); },
    } } },
    setTimeout,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(read('app/diag-log.js'), ctx);
  return ctx.DiagLog;
}

test('★ schema 白名单：六类之外的事件类型直接丢', () => {
  const D = loadDiag();
  D.push('dl', { tier: 'server', phase: 'done' });
  D.push('location', { lat: 1, lng: 2 });           // 不在白名单里的 kind
  D.push('raw_text', { text: '秘密' });
  const all = D.all();
  ok(all.length === 1 && all[0].k === 'dl', `白名单外的 kind 没被丢掉（收到 ${all.length} 条）`);
});

test('★ 零内容：字段白名单在 push 处强制 —— 文本/译文进不来', () => {
  const D = loadDiag();
  D.push('speak', { lang: 'th', ok: true, text: 'สวัสดี', tr: '你好', url: 'https://secret.example/x?t=1' });
  const e = D.all()[0];
  ok(!('text' in e.f) && !('tr' in e.f) && !('url' in e.f), 'speak 事件里混进了文本/译文/URL —— 字段白名单没生效');
  ok(e.f.lang === 'th' && e.f.ok === true, '白名单内的字段反而丢了');
  // 引号与换行的注入面也顺带看一眼：why 只收字符串且截断
  D.push('dl', { path: 'a.zip', tier: 'server', phase: 'fail', why: 'x' });
  ok(D.all()[1].f.why === 'x', 'why 字段没有按字符串收');
});

test('★ 体量：200 条环形 —— 超了从头丢，不无限长', () => {
  const D = loadDiag();
  for (let i = 0; i < 260; i++) D.push('probe', { kind: 'stt', ok: true });
  ok(D.all().length === D.MAX && D.MAX === 200, `环形上限不对（${D.all().length} 条）`);
});

test('★ 接线在位：六个捕获点都在（引擎装载 / 探测 / 朗读结局 / 下载 tier / 登录 / 自愈）', () => {
  const ns = read('app/native-speech.js');
  ok(/DiagLog\.push\('tts_engine'/.test(ns), 'native-speech 没记引擎装载失败（#567 reason:load 真机不可见的根）');
  ok(/DiagLog\.push\('probe'/.test(ns), 'native-speech 没记探测结果');
  ok(/DiagLog\.push\('speak'/.test(read('extension/learn/tts.js')), 'tts.js 没记朗读结局（#568 在途失败不可见）');
  const ms = read('app/model-sources.js');
  ok(/DiagLog\.push\('dl'/.test(ms) && /phase: 'done'/.test(ms) && /phase: 'fail'/.test(ms), 'model-sources 没记 tier 失败链（泰国拉不动魔搭那类的唯一现场证据）');
  const shell = read('src/app/shell-model.js');
  ok(/DiagLog\.push\('auth'/.test(shell), '登录里程碑没记');
  ok(/DiagLog\.push\('engine_fix'/.test(shell), '脏引擎 id 自愈没记');
  // tts.js 是扩展也加载的模块 —— DiagLog 不在时必须静默（try/catch 就是宿主守卫）
  const tts = read('extension/learn/tts.js');
  ok(/try \{[\s\S]*?DiagLog\.push\('speak'[\s\S]*?\} catch/.test(tts.replace(/\n/g, ' ')) || /DiagLog\.push\('speak'[\s\S]{0,80}\} catch/.test(tts.replace(/\n/g, ' ')),
    'tts.js 的 DiagLog 调用没有 try/catch 宿主守卫 —— 扩展页会 ReferenceError');
});

test('★ 导出面：设置页有复制/清空，且不上传', () => {
  const sv = read('src/app/settings-view.jsx');
  ok(/id="diag-copy"/.test(sv) && /id="diag-clear"/.test(sv), '设置页缺诊断日志的复制/清空入口');
  ok(!/fetch\(|XMLHttpRequest/.test(sv.slice(sv.indexOf('g-diag'), sv.indexOf('g-diag') + 900)), '诊断块里出现了网络调用 —— 选项 A 是零网络，导出走剪贴板');
  const dl = read('app/diag-log.js');
  ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(dl), 'diag-log.js 里出现了网络调用 —— 它是纯本机环形日志（零内容纪律的执行点）');
});

test('★ L2 信箱表 write-only：永远没有 SELECT/DELETE policy（预埋，未部署）', () => {
  const sql = read('deploy/diag-events.sql');
  ok(/for insert with check/.test(sql), '信箱表缺 INSERT policy');
  ok(!/for select|for delete|for update/i.test(sql), '信箱表出现了 SELECT/DELETE/UPDATE policy —— 破坏 write-only 形状');
  ok(/grant insert/i.test(sql) && !/grant select/i.test(sql), '授权里有 SELECT —— 只能 INSERT');
});
