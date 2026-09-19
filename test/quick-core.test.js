// test/quick-core.test.js — 「交来的文字」的纯逻辑 HandoffCore（docs/domain-design.md §2.6）。
//
// 这里会**静默**出错的几件事：密码管理器打了隐藏标记的剪贴板被读走发出去；忘了 ⌘C 时把上一段再花一次钱翻一遍；
// 原文已是目标语言时回一句空话；截图识别的行框按错顺序拼，译文通顺但对不上原文。
const path = require('path');
const { describe, test, eq, ok, deepEq } = require('./harness');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'app', 'quick-core.js'));
const H = require(path.join(ROOT, 'app', 'handoff.js'));

describe('HandoffCore — 目标语言', () => {
  const zhOnly = (text, t) => /^zh/.test(t) && /[一-鿿]/.test(text);
  test('原文不是目标语言 ⇒ 照设置翻', () => deepEq(C.chooseTarget('Hello there', 'zh-CN', zhOnly), { lang: 'zh-CN', reversed: false, from: '' }));
  test('原文已是目标语言 ⇒ 反向到英文，并记下是从哪种语言反过来的', () => deepEq(C.chooseTarget('委员会推迟了表决', 'zh-CN', zhOnly), { lang: 'en', reversed: true, from: 'zh-CN' }));
  test('目标是英文而判据说「已是」⇒ 反向到中文（不会反到自己）', () => eq(C.chooseTarget('x', 'en', () => true).lang, 'zh-CN'));
  test('没有判据（判不出语种）⇒ 照常翻，不猜', () => eq(C.chooseTarget('Bonjour', 'en', null).reversed, false));
});

describe('HandoffCore — 零权限路径的三个陷阱', () => {
  test('带隐藏标记 ⇒ concealed，且**不把文字带出来**（哪怕同时给了文字）', () => deepEq(C.classifyClipboard({ text: 'hunter2', concealed: true }, ''), { kind: 'concealed', text: '' }));
  test('空、只有空白、不是文字 ⇒ empty', () => { for (const c of [{}, { text: '  \n' }, { text: 42 }, null]) eq(C.classifyClipboard(c, '').kind, 'empty'); });
  test('与上一次完全相同（首尾空白不算差别）⇒ same', () => eq(C.classifyClipboard({ text: ' The vote. ' }, 'The vote.').kind, 'same'));
  test('隐藏标记优先于「和上次一样」', () => eq(C.classifyClipboard({ text: 'a', concealed: true }, 'a').kind, 'concealed'));
  test('正常 ⇒ ok，文字去掉首尾空白', () => deepEq(C.classifyClipboard({ text: ' New text ' }, 'Old'), { kind: 'ok', text: 'New text' }));
});

describe('HandoffCore — 没有可翻译的文字', () => {
  test('只有空白、数字、符号 ⇒ 没有', () => { for (const s of ['', '   ', '12 345', '→ — ✓', '3.14 × 2']) eq(C.hasLetters(s), false, JSON.stringify(s)); });
  test('任何文字系统的字母都算', () => { for (const s of ['a', '中', 'ع', 'क', '1 я']) eq(C.hasLetters(s), true, s); });
});

describe('HandoffCore.splitUnits — 长文逐段出', () => {
  test('空行分段；段内的硬换行并成空格', () => deepEq(C.splitUnits('First line\nstill first.\n\nSecond.'), ['First line still first.', 'Second.']));
  test('过长的一段在句末切，每段都不超上限，拼回去一个字不少', () => {
    const para = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const u = C.splitUnits(para, 200);
    ok(u.length > 1); for (const x of u) { ok(x.length <= 200, String(x.length)); ok(/\.$/.test(x), '该切在句末：' + x.slice(-12)); }
    eq(u.join(' '), para);
  });
  test('没有句末标点也没有空白 ⇒ 硬切，不死循环', () => { const u = C.splitUnits('字'.repeat(250), 100); eq(u.length, 3); eq(u.join(''), '字'.repeat(250)); });
  test('短文本 ⇒ 一段；空 ⇒ 零段', () => { deepEq(C.splitUnits('Hi.'), ['Hi.']); deepEq(C.splitUnits(' \n\n '), []); });
});

describe('HandoffCore.assembleLines — 截图行框 → 阅读顺序', () => {
  const L = (text, x, y, w, h) => ({ text, box: { x, y, w: w || 0.4, h: h || 0.04 } });
  test('乱序交来 ⇒ 先上后下、同一行先左后右', () => eq(C.assembleLines([L('world', 0.5, 0.101), L('second line', 0.1, 0.15), L('Hello', 0.1, 0.1)]), 'Hello world second line'));
  test('行距大于 0.8 个行高 ⇒ 另起一段', () => eq(C.assembleLines([L('Title', 0.1, 0.1), L('Body text', 0.1, 0.3)]), 'Title\n\nBody text'));
  test('中日韩的行之间不加空格；与拉丁文相接时加', () => {
    eq(C.assembleLines([L('委员会推迟了', 0.1, 0.1), L('表决。', 0.1, 0.145)]), '委员会推迟了表决。');
    eq(C.assembleLines([L('使用', 0.1, 0.1), L('Safari 浏览器', 0.1, 0.145)]), '使用 Safari 浏览器');
  });
  test('空行框、没有 box 的一概丢掉；全空 ⇒ 空串', () => { eq(C.assembleLines([{ text: ' ', box: {} }, { text: 'x' }, null]), ''); eq(C.assembleLines(null), ''); });
});

describe('HandoffCore.captureState — 面板底栏的那一句', () => {
  test('翻成了、采集开着 ⇒ saved；关着 ⇒ off', () => { eq(C.captureState('Hi there', '你好', true), 'saved'); eq(C.captureState('Hi there', '你好', false), 'off'); });
  test('太长 ⇒ long（优先于开关：关着也说太长没有意义，但不能说 saved）', () => eq(C.captureState('a'.repeat(2001), '译', true), 'long'));
  test('没翻成、或译文等于原文 ⇒ 什么都不显示', () => { eq(C.captureState('Hi', '', true), ''); eq(C.captureState('Hi', ' Hi ', true), ''); });
  test('与唯一写入者同一组常量 —— 面板说「已存入」而写入者拒收，是最难看的一种谎', () => {
    eq(C.MAX_CAPTURE_CHARS, H.MAX_CHARS); deepEq(C.VIAS.slice().sort(), H.VIAS.slice().sort());
    eq(H.whyNot({ v: 1, text: 'a'.repeat(C.MAX_CAPTURE_CHARS), tr: '译', lang: 'en', trLang: 'zh-CN', ts: 1e12, via: 'select' }, { learnEnabled: true, quickCapture: true }, {}, 1e12 + 1), '');
  });
});
