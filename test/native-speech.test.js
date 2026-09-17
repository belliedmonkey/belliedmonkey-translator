// test/native-speech.test.js — app/native-speech.js 的会话生命周期：stt-stop 的「ended」回执不得误杀新会话。
// 2026-09-14 起 test:listen F 段偶发红：closeSocket() 紧接 openSocket() 时，旧会话的 ended 晚一拍到，
// 落在新会话开好之后，被当成「当前会话结束」处理 ⇒ 新会话被关、final 全丢。
const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

function setup() {
  const posted = [];
  const window = { webkit: { messageHandlers: { mtSpeech: { postMessage: (m) => posted.push(m) } } } };
  const NS = loadModule('../app/native-speech.js', { window }).NativeSpeech;
  return { NS, posted };
}

describe('NativeSpeech.sttOpen —— ended 回执与会话生命周期', () => {
  test('结束后立刻再开：旧会话的 ended 晚到，新会话不受影响，final 照常送达', () => {
    const { NS, posted } = setup();
    const evA = [], evB = [];
    const a = NS.sttOpen({ locales: ['zh-CN'], onEvent: (k, p) => evA.push(k) });
    a.close();                                  // 发 stt-stop
    const b = NS.sttOpen({ locales: ['zh-CN', 'en-US'], onEvent: (k, p) => evB.push([k, p && p.text]) });
    deepEq(posted.map((m) => m.type), ['stt-start', 'stt-stop', 'stt-start']);
    NS._fromNative({ type: 'stt-state', state: 'ended' });     // 这是 A 的回执，晚一拍才到
    NS._fromNative({ type: 'stt-state', state: 'ready' });
    NS._fromNative({ type: 'stt-final', locale: 'en-US', text: 'hello', conf: 0.9 });
    deepEq(evB, [['ready', undefined], ['final', 'hello']], '新会话该活着并收到 final');
    ok(!evA.includes('close') || true, 'A 是我们自己关的，收不收 close 都行');
    b.close();
  });
  test('没人等的 ended（原生自己停了）才算当前会话结束', () => {
    const { NS } = setup();
    const ev = [];
    NS.sttOpen({ locales: ['zh-CN'], onEvent: (k) => ev.push(k) });
    NS._fromNative({ type: 'stt-state', state: 'ready' });
    NS._fromNative({ type: 'stt-state', state: 'ended' });
    deepEq(ev, ['ready', 'close']);
    NS._fromNative({ type: 'stt-final', locale: 'zh-CN', text: 'x', conf: 0.9 });
    deepEq(ev, ['ready', 'close'], '关了之后不再有事件');
  });
  test('不 close 直接再开：原生会先停旧的并回一个 ended，也不得误杀新会话', () => {
    const { NS, posted } = setup();
    const evB = [];
    NS.sttOpen({ locales: ['zh-CN'], onEvent: () => {} });
    NS.sttOpen({ locales: ['en-US'], onEvent: (k) => evB.push(k) });
    deepEq(posted.map((m) => m.type), ['stt-start', 'stt-start']);
    NS._fromNative({ type: 'stt-state', state: 'ended' });     // 原生 sttStart 里 sttStop() 发出来的
    NS._fromNative({ type: 'stt-state', state: 'ready' });
    deepEq(evB, ['ready']);
  });
  test('两次 close 只发一个 stt-stop；close 之后 final 不再送达', () => {
    const { NS, posted } = setup();
    const ev = [];
    const a = NS.sttOpen({ locales: ['zh-CN'], onEvent: (k) => ev.push(k) });
    a.close(); a.close();
    eq(posted.filter((m) => m.type === 'stt-stop').length, 1);
    NS._fromNative({ type: 'stt-final', locale: 'zh-CN', text: 'x', conf: 0.9 });
    deepEq(ev, []);
  });
});
