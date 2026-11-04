// test/listen-bel188.test.js — BEL-188：LID 归属导致「自动」字幕的 final 全被丢。
//
// 守两件事：
//   1. 喂给端上 LID（ECAPA）的候选**必须是两门真语言**；「自动」时要由 deviceLocales()
//      解析成 en-US + zh-CN，不能把字面量 'auto' 送进去（native 会过滤掉，只剩一门 ⇒
//      LLR 恒为 0 ⇒ 一条判词都不出）。
//   2. LID 完全没判词时，「自动」字幕不能把两路 final 都丢掉：按 final 文字的**主文字系**
//      在两门候选里唯一匹配，并在同一时间窗内只放行一路（不会两路都上屏）。
//
// 纯逻辑，不启动原生桥。生产里传的 script 就是 LearnRules.dominantScript。
const { describe, test, ok, eq } = require('./harness');
const C = require('../app/listen-core.js');
const LANGS = require('../build/langs.config.js');
const LearnRules = require('../extension/content/learn-rules.js');

const lang = (code) => LANGS.filter((e) => e.code === code)[0];
const AUTO_CFG = { myLang: 'auto', otherLang: 'zh', registry: LANGS };
const LOCALES = ['en-US', 'zh-CN'];
const noLid = (over) => Object.assign({
  candidates: C.lidPairLangs(AUTO_CFG, LOCALES),
  prefer: 'en',
  registry: LANGS,
  script: 'Latin',
  since: 0,
  graceMs: 2500,
  windowMs: 1500,
  now: 10000,
  last: null,
}, over || {});
const decide = (base, text, fb) => C.intakeDecide({
  base, lid: '', lidRaw: '', noLid: fb, pttSwitch: null, now: (fb && fb.now) || 10000,
  playing: new Set(), text, isEcho: () => false,
});

describe('BEL-188 · 送到端上 LID 的候选语言', () => {
  test('「自动」字幕：解析成两路识别器的真实语言，字面量 auto 被排除', () => {
    eq(C.baseCode('auto'), 'auto', '前提：baseCode(auto) 就是字面量 auto');
    eq(JSON.stringify(C.lidPairLangs(AUTO_CFG, LOCALES)), JSON.stringify(['en', 'zh']));
    eq(JSON.stringify(C.lidPairLangs({ myLang: 'auto', otherLang: 'zh' }, ['en-US', 'zh-CN', 'en-GB'])),
      JSON.stringify(['en', 'zh']), '去重且最多两门');
  });
  test('钉死视频语言 / 对话：仍按用户选的两门（不经 deviceLocales）', () => {
    eq(JSON.stringify(C.lidPairLangs({ myLang: 'en', otherLang: 'zh' }, ['en-US'])), JSON.stringify(['en', 'zh']));
    eq(JSON.stringify(C.lidPairLangs({ myLang: 'ja', otherLang: 'en' }, [])), JSON.stringify(['ja', 'en']));
  });
  test('候选为空时不会造出 auto 这种假语言', () => {
    eq(JSON.stringify(C.lidPairLangs({ myLang: 'auto', otherLang: 'auto' }, [])), JSON.stringify([]));
  });
});

describe('BEL-188 · lid 有值：仍按 LID 归属（回归）', () => {
  test('判成 en ⇒ en 放行、zh 丢', () => {
    const en = C.intakeDecide({ base: 'en', lid: 'en', pttSwitch: null, now: 1, playing: new Set(), text: 'hello', isEcho: () => false });
    const zh = C.intakeDecide({ base: 'zh', lid: 'en', pttSwitch: null, now: 1, playing: new Set(), text: '你好', isEcho: () => false });
    eq(en.admit, true); eq(en.fallback, '');
    eq(zh.admit, false); eq(zh.reason, 'attrib');
  });
  test('第三门判词（lidRaw=fr、lidPair 为空）⇒ 仍走 no-lid 兜底，不能全丢', () => {
    const d = C.intakeDecide({
      base: 'en', lid: '', lidRaw: 'fr', noLid: noLid(), pttSwitch: null, now: 10000,
      playing: new Set(), text: 'hello world', isEcho: () => false,
    });
    eq(d.admit, true); eq(d.fallback, 'no-lid');
  });
  test('两门内的判词正在 0.5s 确认期（lid 空、lidRaw=en）⇒ 不兜底', () => {
    const d = C.intakeDecide({
      base: 'en', lid: '', lidRaw: 'en', noLid: noLid(), pttSwitch: null, now: 10000,
      playing: new Set(), text: 'hello world', isEcho: () => false,
    });
    eq(d.admit, false); eq(d.reason, 'attrib');
  });
});

describe('BEL-188 · lid 空 + 自动字幕：确定性兜底', () => {
  test('英文文字 + en-US 路 ⇒ 放行，日志标记 fallback=no-lid', () => {
    const d = decide('en', 'Hello, this is in English.', noLid({ script: 'Latin' }));
    eq(d.admit, true); eq(d.fallback, 'no-lid');
    eq(JSON.stringify(d.note), JSON.stringify({ base: 'en', at: 10000 }));
  });
  test('同一段英文被 zh 路也吐出来 ⇒ zh 丢（不能两路都上屏）', () => {
    const en = decide('en', 'Hello, this is in English.', noLid({ script: 'Latin' }));
    const zh = decide('zh', 'Hello, this is in English.', noLid({ script: 'Latin' }));
    eq(en.admit, true); eq(zh.admit, false); eq(zh.reason, 'attrib');
  });
  test('中文文字 + zh 路 ⇒ 放行；en 路的中文幻觉丢', () => {
    const zh = decide('zh', '你好，这是一段中文。', noLid({ script: 'Han' }));
    const en = decide('en', '你好，这是一段中文。', noLid({ script: 'Han' }));
    eq(zh.admit, true); eq(zh.fallback, 'no-lid');
    eq(en.admit, false); eq(en.reason, 'attrib');
  });
  test('文字系分不开（纯数字）⇒ 用「自动」默认候选 prefer，只放行它', () => {
    const en = decide('en', '12345', noLid({ script: '' }));
    const zh = decide('zh', '12345', noLid({ script: '' }));
    eq(en.admit, true); eq(zh.admit, false);
  });
  test('同一时间窗内换了另一路 ⇒ 第二条丢；窗口过了才放行', () => {
    let last = null;
    const run = (base, script, now) => {
      const d = decide(base, script === 'Han' ? '你好' : 'hello', noLid({ script, now, last }));
      if (d.note) last = d.note;
      return d;
    };
    eq(run('zh', 'Han', 1000).admit, true);
    eq(run('en', 'Latin', 1200).admit, false, '1.5s 内另一路不许再上屏');
    eq(run('en', 'Latin', 3000).admit, true, '窗口过去后可以换路');
  });
  test('开场 2.5s 内先等真判词；等不到才兜底', () => {
    eq(decide('en', 'hello', noLid({ since: 9000, now: 10000 })).admit, false);
    eq(decide('en', 'hello', noLid({ since: 1000, now: 10000 })).admit, true);
  });
  test('默认候选不在两门里 ⇒ 回落到第一门，不把两路都丢光', () => {
    const d = decide('zh', '12345', noLid({ script: '', prefer: 'en', candidates: ['zh', 'ja'] }));
    eq(d.admit, true); eq(d.note.base, 'zh');
  });
  test('非「自动」字幕 / 没给 noLid ⇒ 仍按原样 attrib（不误放）', () => {
    const pinned = C.intakeDecide({
      base: 'en', lid: '', lidRaw: '', pttSwitch: null, now: 10000,
      playing: new Set(), text: 'hello', isEcho: () => false,
    });
    eq(pinned.admit, false); eq(pinned.reason, 'attrib');
    eq(C.finalAdmit({ base: 'en', lid: '', now: 1 }).admit, false);
  });
  test('候选里没有这一路 ⇒ 丢（不认识的识别器不因兜底混进来）', () => {
    eq(decide('ja', 'こんにちは', noLid({ script: 'Kana' })).admit, false);
  });
});
