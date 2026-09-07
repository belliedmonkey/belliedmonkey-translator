// test/app-listen.test.js — 「对话 · 实时听译」的纯逻辑（learning-design §9.6）。
//
// 守四件事：
//   1. 归属：按住「我说」期间（含松手后的尾巴）到达的定稿是我的，其余是对方的。
//   2. 进语料的门：译文没到不写；星绕过一切；开关关着不写；白名单与 §6 的门各挡各的。
//   3. 进语料的形状：来源 conv:<id>、锚点 k:'conv'、学的永远是外语那一侧。
//   4. 静音计时与会话计时：30 s 没声音才算静，暂停不计入已听时长。
const { describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');

const T0 = 1_757_000_000_000;

describe('ListenCore — 归属 (§9.6「我说」)', () => {
  test('默认是对方说的', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, 'Does this bus go to the airport?', T0 + 1000);
    eq(r.who, 'them');
    eq(s.firstText, 'Does this bus go to the airport?');
  });
  test('按住期间到达的是我的，松手后 800 ms 内的也是', () => {
    const s = C.newSession(T0, 0.5);
    C.holdStart(s, T0 + 5000);
    eq(C.addFinal(s, '去机场，末班车几点', T0 + 6000).who, 'me');
    C.holdEnd(s, T0 + 7000);
    eq(C.addFinal(s, '晚上还有吗', T0 + 7500).who, 'me');
    eq(C.addFinal(s, 'Yes, until midnight.', T0 + 9000).who, 'them');
    // 我说的句子累积成一段，松手时整段交给翻译
    eq(s.myPartial, '去机场，末班车几点 晚上还有吗');
    // 第一句标题摘的是对方说的
    eq(s.firstText, 'Yes, until midnight.');
  });
  test('空白定稿不入表', () => {
    const s = C.newSession(T0, 0.5);
    eq(C.addFinal(s, '   ', T0), null);
    eq(s.rows.length, 0);
  });
});

describe('ListenCore — 进语料的门', () => {
  const deps = { langAllowed: (lang, text, langs) => !langs || langs.indexOf(lang) >= 0, shouldCapture: () => true };
  const cfg = { captureOn: true, lang: 'en', otherLang: 'en', targetLang: 'zh-CN', langs: null, registry: [] };
  test('译文没到不写；到了就写；写过不再写', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, 'Hello there.', T0);
    eq(C.shouldWrite(r, s, cfg, deps), false);
    r.tr = '你好。';
    eq(C.shouldWrite(r, s, cfg, deps), true);
    r.written = true;
    eq(C.shouldWrite(r, s, cfg, deps), false);
  });
  test('开关关着不写；星绕过开关、白名单与门', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, 'Hello there.', T0); r.tr = '你好。';
    eq(C.shouldWrite(r, s, Object.assign({}, cfg, { captureOn: false }), deps), false);
    r.starred = true;
    eq(C.shouldWrite(r, s, Object.assign({}, cfg, { captureOn: false, langs: ['ja'] }), { langAllowed: () => false, shouldCapture: () => false }), true);
  });
  test('白名单与 §6 的门各自能挡', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, 'Hello there.', T0); r.tr = '你好。';
    eq(C.shouldWrite(r, s, Object.assign({}, cfg, { langs: ['ja'] }), deps), false);
    eq(C.shouldWrite(r, s, cfg, { langAllowed: () => true, shouldCapture: () => false }), false);
  });
});

describe('ListenCore — 进语料的形状', () => {
  const cfg = { lang: 'en', otherLang: 'en', targetLang: 'zh-CN', label: '对话' };
  test('对方说的：text=外语，tr=中文；来源与锚点按会话', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, 'It leaves from across the street.', T0 + 4000); r.tr = '它从马路对面发车。';
    const d = C.draftFor(r, s, cfg);
    eq(d.text, 'It leaves from across the street.');
    eq(d.tr, '它从马路对面发车。');
    eq(d.lang, 'en');
    eq(d.sourceId, 'conv:' + s.id);
    eq(d.anchor.k, 'conv');
    eq(d.anchor.who, 'them');
    eq(d.anchor.startMs, 4000);
    eq(d.playedThrough, true);
    eq(d.kind, 'sentence');
    const src = C.sourceFor(s, '对话');
    eq(src.id, 'conv:' + s.id);
    eq(src.url, 'conv://' + s.id);
    ok(src.title.startsWith('对话 · '), src.title);
    ok(src.title.endsWith('It leaves from'), src.title);   // 标题摘第一句前 12 字
  });
  test('我说的：text=译出的外语，tr=我说的中文', () => {
    const s = C.newSession(T0, 0.5);
    C.holdStart(s, T0);
    const r = C.addFinal(s, '那 12 路多久一班', T0 + 100); r.tr = 'How often does the 12 run?';
    const d = C.draftFor(r, s, cfg);
    eq(d.text, 'How often does the 12 run?');
    eq(d.tr, '那 12 路多久一班');
    eq(d.anchor.who, 'me');
  });
});

describe('ListenCore — 静音与计时', () => {
  test('30 s 没声音才算静；有声就重置', () => {
    const s = C.newSession(T0, 0.5);
    eq(C.silenceCheck(s, 0.0001, T0 + 29_000), false);
    eq(C.silenceCheck(s, 0.0001, T0 + 30_000), true);
    eq(C.silenceCheck(s, 0.2, T0 + 31_000), false);      // 有声：重置
    eq(C.silenceCheck(s, 0.0001, T0 + 60_000), false);   // 离上次有声才 29 s
    eq(C.silenceCheck(s, 0.0001, T0 + 61_000), true);
  });
  test('rmsOf 对静音是 0，对满幅方波接近 1', () => {
    eq(C.rmsOf(new Int16Array(100)), 0);
    const sq = new Int16Array(100); for (let i = 0; i < 100; i++) sq[i] = i % 2 ? 32767 : -32768;
    ok(C.rmsOf(sq) > 0.99);
  });
  test('暂停不计入已听时长；小结数字与行表一致', () => {
    const s = C.newSession(T0, 0.5);
    C.pause(s, T0 + 10_000);
    eq(C.listenedMs(s, T0 + 50_000), 10_000);
    C.resume(s, T0 + 50_000);
    eq(C.listenedMs(s, T0 + 55_000), 15_000);
    const a = C.addFinal(s, 'One.', T0 + 51_000); a.tr = '一。'; a.written = true; a.starred = true;
    C.holdStart(s, T0 + 52_000);
    C.addFinal(s, '二', T0 + 53_000);
    deepEq(C.summary(s, T0 + 55_000), { seconds: 15, them: 1, me: 1, written: 1, starred: 1 });
    eq(C.fmtClock(15_000), '00:15');
    eq(C.fmtClock(754_000), '12:34');
  });
});

describe('ListenCore — 边说边译策略', () => {
  test('防抖后只发一次；闭合时同文本复用译文，不再发', async () => {
    const calls = [];
    const timers = [];
    const inc = C.makeIncremental(async (text) => { calls.push(text); return 'TR(' + text + ')'; }, {
      debounceMs: 900,
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      clearTimeout: (id) => { timers[id - 1] = null; },
    });
    let got = null;
    inc.result((text, tr) => { got = [text, tr]; });
    inc.onPartial('Sorry, the last');
    inc.onPartial('Sorry, the last train');
    // 只有最后一个计时器活着
    eq(timers.filter(Boolean).length, 1);
    timers.filter(Boolean)[0]();
    await new Promise((r) => setTimeout(r, 0));
    deepEq(calls, ['Sorry, the last train']);
    deepEq(got, ['Sorry, the last train', 'TR(Sorry, the last train)']);
    eq(inc.close('Sorry, the last train'), 'TR(Sorry, the last train)');
    eq(inc.close('Something else'), '');
    eq(calls.length, 1);
  });
});
