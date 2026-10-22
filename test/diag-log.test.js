// test/diag-log.test.js — 诊断日志三道门（§0.4.1 缺口补法，2026-10-06 用户拍板：
// 手机端补打点；中国版零网络，选项 A —— L1 本机 + 手动导出先上，L2 另批）。
//
//   1. schema 白名单：事件种类固定集合，白名单外的 kind 直接丢；
//   2. **零内容**：字段白名单在 push 处强制 —— 事件里进不来用户文本/译文/URL；
//   3. write-only：L2 信箱表（deploy/diag-events.sql）永远没有 SELECT/DELETE policy。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, ok } = require('./harness');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// 纯函数/行为级：vm 加载 diag-log.js（stub 掉 storage），验证白名单真的在过滤
function loadDiagCtx(over) {
  const store = {};
  const net = [];
  const ctx = {
    window: Object.assign({}, over && over.window),
    navigator: { userAgent: 'diag-test' },
    chrome: { storage: { local: {
      get: (k, cb) => cb({ [k]: store[k] }) ,
      set: (o, cb) => { Object.assign(store, o); if (cb) cb(); },
    } } },
    setTimeout,
    Date,
    fetch: async (url, opts) => { net.push({ url, body: opts && opts.body }); return { ok: true, status: 201 }; },
  };
  vm.createContext(ctx);
  vm.runInContext(read('app/diag-log.js'), ctx);
  ctx.__net = net;
  return ctx;
}
function loadDiag(over) { return loadDiagCtx(over).DiagLog; }

test('★ schema 白名单：白名单之外的事件类型直接丢', () => {
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

test('★ 导出面：设置页有复制/清空；上报只投 write-only 信箱（L2，2026-10-06 用户拍板提前启用）', () => {
  const sv = read('src/app/settings-view.jsx');
  ok(/id="diag-copy"/.test(sv) && /id="diag-clear"/.test(sv), '设置页缺诊断日志的复制/清空入口');
  const dl = read('app/diag-log.js');
  // 上报形状钉死：唯一 fetch、地址是信箱表、POST、凭证只用 backend 的 anonKey、失败静默
  const hits = (dl.match(/fetch\(/g) || []).length;
  ok(hits === 1, `diag-log.js 里应有且仅有一次 fetch（实际 ${hits}）—— 上报器只有信箱一个出口`);
  ok(/\/rest\/v1\/bt_diag_events/.test(dl), '上报地址不是 bt_diag_events 信箱');
  ok(/method: 'POST'/.test(dl), '上报不是 POST');
  ok(/apikey: b\.anonKey/.test(dl) && !/service_role|supabase_service/i.test(dl), '上报凭证用了 anon 之外的钥匙');
  ok(dl.slice(dl.indexOf('async function doUpload')).includes('catch (_) {}'), '上报失败不静默 —— 会打扰用户或挡功能');
});

test('★ L2 信箱表 write-only：永远没有 SELECT/DELETE policy（中国库已部署 2026-10-06；东京库待建）', () => {
  const sql = read('deploy/diag-events.sql');
  ok(/for insert with check/.test(sql), '信箱表缺 INSERT policy');
  ok(!/for select|for delete|for update/i.test(sql), '信箱表出现了 SELECT/DELETE/UPDATE policy —— 破坏 write-only 形状');
  ok(/grant insert/i.test(sql) && !/grant select/i.test(sql), '授权里有 SELECT —— 只能 INSERT');
});

test('★ 内容字段只存本机：自动上报与手动导出两条离机路都剥离原文（只留计数/原因/长度）', async () => {
  const ctx = loadDiagCtx();
  const D = ctx.DiagLog;
  ctx.window.MT_BACKEND = { url: 'https://backend.example', anonKey: 'anon' };
  D.push('seg', { reason: 'gate-drop', calls: 2, json_bad: 0, text: '用户说的原话', rem: '剩下', raw: '{"segments":[]}', why: 'conf' });
  D.push('dl', { tier: 'server', phase: 'fail', why: 'http' });
  // 本机侧：raw buffer 仍保留内容（「只存本机」是承诺，不是丢弃）
  ok(D.all()[0].f.text === '用户说的原话', '本机 all() 应当保留原文');
  // 离机路 1：手动导出
  const exp = D.exportText();
  ok(exp.indexOf('用户说的原话') < 0 && exp.indexOf('剩下') < 0 && exp.indexOf('segments') < 0, '手动导出里还有原文内容：' + exp);
  ok(/"text_len":6/.test(exp) && /"rem_len":2/.test(exp) && /"raw_len":15/.test(exp), '导出没有留下长度：' + exp);
  ok(/"reason":"gate-drop"/.test(exp) && /"why":"conf"/.test(exp), '导出把原因也剥了');
  ok(/"tier":"server"/.test(exp) && /"phase":"fail"/.test(exp), '非 seg 事件被连带改动');
  // 离机路 2：自动上报（L2 信箱）
  await D.doUpload();
  ok(ctx.__net.length === 1, 'doUpload 没有发一次请求（实际 ' + ctx.__net.length + '）');
  const body = String(ctx.__net[0].body || '');
  ok(body.indexOf('用户说的原话') < 0 && body.indexOf('剩下') < 0 && body.indexOf('segments') < 0, '自动上报里还有原文内容：' + body);
  ok(/"text_len":6/.test(body), '自动上报没有留下长度：' + body);
  ok(/bt_diag_events/.test(ctx.__net[0].url), '上报地址不是信箱表');
});

test('★ mic 类：收白名单字段、拒 text/url（1.19.4 r3d）', () => {
  const D = loadDiag();
  D.push('mic', { phase: 'req', seq: 1, state: 'granted', text: '秘密', url: 'https://x' });
  const e = D.all()[0];
  ok(e && e.k === 'mic', 'mic 事件应被接收');
  ok(e.f.phase === 'req' && e.f.seq === 1, '白名单字段丢失');
  ok(!('text' in e.f) && !('url' in e.f), 'mic 事件混进了文本/URL');
});

test('★ MT_BUILD_SHA：exportText head 与 doUpload app_build 带上（1.19.4 r3d）', async () => {
  const ctx = loadDiagCtx({ window: { MT_BUILD_SHA: 'abc123def456', MT_FLAVOR: 'intl' } });
  // loadDiagCtx merges into window after create — ensure DiagLog sees it
  ctx.window.MT_BUILD_SHA = 'abc123def456';
  ctx.window.MT_BACKEND = { url: 'https://backend.example', anonKey: 'anon' };
  const D = ctx.DiagLog;
  D.push('probe', { kind: 'stt', ok: true });
  const exp = D.exportText();
  ok(/"build_sha": "abc123def456"/.test(exp) || /"build_sha":"abc123def456"/.test(exp), 'exportText 缺 build_sha：' + exp.slice(0, 200));
  await D.doUpload();
  ok(ctx.__net.length === 1, 'doUpload 未发请求');
  const body = String(ctx.__net[0].body || '');
  ok(/"app_build":"abc123def456"/.test(body), 'doUpload 缺 app_build：' + body.slice(0, 300));
});
