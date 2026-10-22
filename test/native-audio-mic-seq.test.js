// test/native-audio-mic-seq.test.js — 1.19.4 r3d：mic seq / orphan / stale 零内容诊断
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, ok, eq } = require('./harness');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function loadNativeAudio() {
  const posts = [];
  const diag = [];
  const handler = { postMessage: (b) => posts.push(b) };
  const ctx = {
    window: { webkit: { messageHandlers: { mtAudio: handler } } },
    DiagLog: { push: (k, f) => diag.push({ k, f }) },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(read('app/native-audio.js'), ctx);
  return { api: ctx.NativeAudio || ctx.window.NativeAudio, posts, diag, ctx };
}

test('D1 mic SCHEMA：text 被拒（经 diag-log 白名单）', () => {
  const store = {};
  const ctx = {
    window: {},
    navigator: { userAgent: 't' },
    chrome: { storage: { local: {
      get: (k, cb) => cb({ [k]: store[k] }),
      set: (o, cb) => { Object.assign(store, o); if (cb) cb(); },
    } } },
    setTimeout, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(read('app/diag-log.js'), ctx);
  ctx.DiagLog.push('mic', { phase: 'req', seq: 1, text: '秘密' });
  const e = ctx.DiagLog.all()[0];
  ok(e && e.k === 'mic' && e.f.phase === 'req' && !('text' in e.f), JSON.stringify(e));
});

test('D2 orphan：mic=null 仍记 mic 事件且 reason=orphan', () => {
  const { api, diag } = loadNativeAudio();
  ok(api.available(), '桥应可用');
  api.micStart(16000, { seq: 1, onState: () => {}, deliver: 'level' });
  api.micStop();   // mic = null，期望 seq 仍保留
  const calls = [];
  // stop 后迟到 granted
  api._fromNative({ type: 'mic-state', state: 'granted', seq: 1 });
  const micEv = diag.filter((d) => d.k === 'mic');
  ok(micEv.some((d) => d.f.phase === 'on' && d.f.reason === 'orphan' && d.f.state === 'granted'),
    '应有 orphan：' + JSON.stringify(micEv));
  eq(calls.length, 0);
});

test('D3 stale：seq 不符 ⇒ phase=stale 且 onState 不调', () => {
  const { api, diag } = loadNativeAudio();
  const calls = [];
  api.micStart(16000, { seq: 2, onState: (st, r, src, seq) => calls.push({ st, r, src, seq }), deliver: 'level' });
  api._fromNative({ type: 'mic-state', state: 'granted', seq: 1, reason: 'x' });
  ok(diag.some((d) => d.k === 'mic' && d.f.phase === 'stale' && d.f.seq === 1), JSON.stringify(diag));
  eq(calls.length, 0, 'stale 不应调 onState：' + JSON.stringify(calls));
  // 正确 seq 仍转发
  api._fromNative({ type: 'mic-state', state: 'granted', seq: 2 });
  eq(calls.length, 1);
  ok(calls[0].st === 'granted' && calls[0].seq === 2, JSON.stringify(calls[0]));
});

test('D4 形状：beginPipeline / keepAliveOn / micStart 含 mic 打点', () => {
  const model = read('src/app/listen-model.js');
  ok(/DiagLog\.push\('mic'[\s\S]*phase:\s*'ka_begin'/.test(model) || /phase:\s*'ka_begin'[\s\S]*DiagLog\.push\('mic'/.test(model)
    || /phase: 'ka_begin'/.test(model) && /DiagLog\.push\('mic'/.test(model), '缺 ka_begin');
  ok(/phase: 'ka_done'/.test(model), '缺 ka_done');
  ok(/phase: 'req'/.test(model) && /micSeq \+= 1/.test(model), '缺 req / micSeq');
  ok(/body\.seq = Number\(mic\.seq\)/.test(read('app/native-audio.js')), 'native-audio 未写 seq');
  ok(/micJsSeq/.test(read('app/native/audio-bridge.swift')), 'audio-bridge 缺 micJsSeq');
});

test('D5 mic-start post 带 seq', () => {
  const { api, posts } = loadNativeAudio();
  api.micStart(24000, { seq: 7, onState: () => {} });
  ok(posts.some((b) => b && b.type === 'mic-start' && b.seq === 7), JSON.stringify(posts));
});
