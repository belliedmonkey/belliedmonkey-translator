// test/app-target-lang.test.js — App 里「译成什么语言」的唯一出口（docs/domain-design.md §2.6 规则 1）。
//
// 这个设置是 2026-09-19 补上的；此前 App 默默译成界面语言。最要紧的一条是**老用户升级后行为不变**：
// 没选过「译成」= 跟随界面语言，而且不往存储里播种默认值（播种了，以后改界面语言这一项就不会跟着动）。
const path = require('path');
const { describe, test, eq } = require('./harness');
const T = require(path.join(__dirname, '..', 'app', 'target-lang.js'));

describe('AppTargetLang.resolve', () => {
  test('明说过的选择优先于一切', () => {
    eq(T.resolve({ targetLang: 'ja', uiLang: 'zh_CN' }, 'en-US'), 'ja');
  });
  test('没选过 ⇒ 跟随界面语言，并从 Chrome 的 locale 码归一到目标语言码', () => {
    eq(T.resolve({ uiLang: 'zh_CN' }, 'en-US'), 'zh-CN');
    eq(T.resolve({ uiLang: 'zh_TW' }, 'en-US'), 'zh-TW');
    eq(T.resolve({ uiLang: 'pt_BR' }, 'en-US'), 'pt');
    eq(T.resolve({ uiLang: 'hi' }, 'en-US'), 'hi');     // 注册表里没有的语言原样给引擎，不替用户改成别的
  });
  test('界面语言也是「跟随系统」⇒ 看系统语言；繁体地区归繁体', () => {
    eq(T.resolve({ uiLang: 'auto' }, 'zh-Hant-HK'), 'zh-TW');
    eq(T.resolve({}, 'zh-Hans-CN'), 'zh-CN');
    eq(T.resolve({}, 'fr-CA'), 'fr');
  });
  test('什么都读不到 ⇒ 调用方给的兜底，再不行 zh-CN', () => {
    eq(T.resolve({}, '', 'en'), 'en');
    eq(T.resolve(null, undefined), 'zh-CN');
  });
  test('空串 = 没选过（设置页选「跟随界面语言」时是删键，但读到空串也得同义）', () => {
    eq(T.resolve({ targetLang: '', uiLang: 'de' }, 'en-US'), 'de');
  });
});
