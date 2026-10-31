// test/speech-chunks.test.js — 播放与预热的切分**唯一来源**（2026-10-03，播客模式段落朗读）。
//
// 为什么值得一条门：这条路原来把整张卡一次喂给合成器（段落被读成一条平线），改成逐句之后，
// 播放与预热必须枚举**同一批**文本 —— 两边不一致就会「预热的是另一段话、缓存永远打不中」，
// 而那是**用户多付一次钱**的错，不是听感偏好。切分只在这个模块里定义，两处都调它。
const { describe, test, ok, eq, loadSrc } = require('./harness');

const fakeModel = (parts, record) => ({
  splitSentences: (t, lang) => { if (record) record.push([t, lang]); return parts; },
});

function load(seed = {}) {
  return loadSrc('src/app/speech-chunks.js', 'SpeechChunks', seed).SpeechChunks;
}

describe('speechChunks —— 切句只此一处', () => {
  test('空 / 纯空白 / null ⇒ 空数组（不合成一句空话）', () => {
    const S = load();
    eq(S.speechChunks('').length, 0);
    eq(S.speechChunks('   \n\t ').length, 0);
    eq(S.speechChunks(null).length, 0);
    eq(S.speechChunks(undefined).length, 0);
  });

  test('单句 ⇒ 一条（与从前的行为逐字相同 —— 短卡不该被改动）', () => {
    const S = load();
    const one = S.speechChunks('Hello there, friend.');
    eq(one.length, 1);
    eq(one[0], 'Hello there, friend.');
  });

  test('拿得到 LearnModel ⇒ 用它的切分（卡片 / 对齐 / 文档同一套规则）', () => {
    const rec = [];
    const S = load({ LearnModel: fakeModel(['一。', '二。', '三。'], rec) });
    const out = S.speechChunks('一。二。三。', 'zh');
    eq(out.length, 3);
    eq(rec.length, 1, '没有把整段交给 LearnModel');
    eq(rec[0][1], 'zh', '语言提示没有透传（Intl.Segmenter 靠它）');
  });

  test('拿不到 LearnModel ⇒ 回落正则仍能断句（英文与 CJK 都要）', () => {
    const S = load();
    eq(S.speechChunks('First one. Second one! Third one?').length, 3);
    eq(S.speechChunks('第一句。第二句！第三句？').length, 3);
  });

  test('LearnModel 抛错 ⇒ 回落，不把整段吞掉', () => {
    const S = load({ LearnModel: { splitSentences: () => { throw new Error('boom'); } } });
    eq(S.speechChunks('One. Two. Three.').length, 3);
  });

  test('LearnModel 回空数组 ⇒ 回落，不静默无声', () => {
    const S = load({ LearnModel: fakeModel([]) });
    ok(S.speechChunks('One. Two.').length >= 1, 'LearnModel 回空时整段被吞了');
  });

  test('**不许丢字**：所有块拼起来（忽略空白）等于原文', () => {
    const text = 'The committee postponed the vote. It will meet again on Friday.';
    const S = load({ LearnModel: fakeModel(['The committee postponed the vote.', 'It will meet again on Friday.']) });
    const joined = S.speechChunks(text, 'en').join('').replace(/\s+/g, '');
    eq(joined, text.replace(/\s+/g, ''));
  });

  test('句间停顿是个正数（播放那条路要用它）', () => {
    const S = load();
    ok(Number.isFinite(S.SPEECH_GAP_MS) && S.SPEECH_GAP_MS > 0,
      'SPEECH_GAP_MS 不是正数：' + S.SPEECH_GAP_MS);
  });
});
