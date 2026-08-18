// test/learn-driving-qa.test.js — §9.5 driving Q&A engine.
//
// The load-bearing properties: the gate IS the notes gate (no second capability
// definition to drift), the prompt carries the card context verbatim and the
// answer language, transport errors pass through with their named codes, and
// there is NO cache — every ask is exactly one chat call (the stated cost
// contract, pinned by call counting).

const { loadModule, describe, test, ok, eq } = require('./harness');

function load(chatImpl, capable) {
  const calls = [];
  const LearnNotes = {
    capable: () => !!capable,
    chat: async (system, user) => {
      calls.push({ system, user });
      return chatImpl(system, user);
    },
  };
  const ctx = loadModule('learn/driving-qa.js', { window: {}, LearnNotes });
  return { QA: ctx.DrivingQA, calls };
}

const ITEM = { id: 'c1', lang: 'en', text: 'The roof leaked.', tr: '屋顶漏了。' };

describe('DrivingQA — gate and prompt shape (§9.5)', () => {
  test('capable() follows the notes gate exactly', () => {
    ok(load(async () => 'x', true).QA.capable());
    ok(!load(async () => 'x', false).QA.capable());
  });

  test('the user message carries sentence, translation and the question verbatim', async () => {
    const { QA, calls } = load(async () => ' Because it is past tense. ', true);
    const out = await QA.ask(ITEM, 'why leaked not leaks', 'zh-CN');
    eq(out, 'Because it is past tense.', '答案应裁剪空白');
    eq(calls.length, 1);
    ok(calls[0].user.indexOf('The roof leaked.') >= 0, '原句在');
    ok(calls[0].user.indexOf('屋顶漏了。') >= 0, '译文在');
    ok(calls[0].user.indexOf('why leaked not leaks') >= 0, '问题在');
    ok(calls[0].system.indexOf('zh-CN') >= 0, '回答语言进 system prompt');
    ok(calls[0].system.indexOf('{answerLang}') < 0, '占位符必须被替换');
  });

  test('no cache: two identical asks are two calls (the stated cost contract)', async () => {
    const { QA, calls } = load(async () => 'answer', true);
    await QA.ask(ITEM, 'same question', 'en');
    await QA.ask(ITEM, 'same question', 'en');
    eq(calls.length, 2, '每问一次调用，不缓存');
  });

  test('transport errors pass through with their named codes', async () => {
    const { QA } = load(async () => {
      const e = new Error('HTTP 500'); e.code = 'http'; e.status = 500; throw e;
    }, true);
    let got = null;
    try { await QA.ask(ITEM, 'q', 'en'); } catch (e) { got = e; }
    ok(got, '应抛错');
    eq(got.code, 'http', '错误码透传');
  });
});
