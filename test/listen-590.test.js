// test/listen-590.test.js — #590（Mac 实时字幕三轮录屏回归）的验收。
//
// 纯函数部分直接跑 listen-core；模型部分按源码形状钉住（同 app-listen.test.js 的做法）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const C = require('../app/listen-core.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const MODEL = strip(read('src/app/listen-model.js'));
const BAR = read('app/native/subtitle-bar.swift');

describe('#590 · 定稿与解析（I / L / iOS 7）', () => {
  test('碎片定稿不落行：纯标点、拼音文字里只有一个字母', () => {
    for (const s of ['.', '.....', 'a..', '，', '…']) ok(C.junkFinal(s), `「${s}」应当是碎片`);
    for (const s of ['好', '嗯。', '7', 'OK.', 'you.....', 'ไป']) ok(!C.junkFinal(s), `「${s}」不是碎片`);
  });
  test('addFinal：碎片返回 null；行首悬空标点剥掉', () => {
    const s = C.newSession(1000, 0.5, 'subtitle');
    eq(C.addFinal(s, '.....', 1001, { myLang: 'en', otherLang: 'zh' }, {}), null);
    const row = C.addFinal(s, ', you, and you risk starvation.', 1002, { myLang: 'en', otherLang: 'zh' }, {});
    ok(row && row.text === 'you, and you risk starvation.', '行首的「, 」没剥掉：' + (row && row.text));
  });
  test('parseListenReply：空的「T:」不吞下一行；有标签没译文 ⇒ 译文为空（不把标签行当译文）', () => {
    const a = C.parseListenReply('T:\nX: 你好', 'hello');
    eq(a.tr, '你好'); eq(a.text, 'hello'); eq(a.tagged, false);
    const b = C.parseListenReply('T: hello there\nX:', 'hello there');
    eq(b.tr, '');
    const c = C.parseListenReply('T: hello there', 'hello there');
    eq(c.tr, '');
    const d = C.parseListenReply('T: hello\nX: 你好', 'helo');
    eq(d.text, 'hello'); eq(d.tr, '你好'); eq(d.tagged, true);
    eq(C.parseListenReply('你好', 'hello').tr, '你好');
  });
});

describe('#590 · 静音门（iOS 4 / A）', () => {
  test('极小的非零样本不算「听到过」', () => {
    const s = C.newSession(0, 0, 'subtitle');
    C.silenceCheck(s, 0.00002, 100);
    eq(s.heardAny, false);
    C.silenceCheck(s, 0.002, 200);
    eq(s.heardAny, true);
  });
  test('字幕：一次声音都没听到过时 30 秒不停，等到 FIRST_SOUND_MS', () => {
    const s = C.newSession(0, 0, 'subtitle');
    eq(C.silenceCheck(s, 0, C.SILENCE_MS + 1), false, '还没听到过声音就在 30 秒停了');
    eq(C.silenceCheck(s, 0, C.FIRST_SOUND_MS + 1), true);
  });
  test('字幕：听到过声音之后照旧 30 秒停', () => {
    const s = C.newSession(0, 0, 'subtitle');
    C.silenceCheck(s, 0.05, 1000);
    eq(C.silenceCheck(s, 0, 1000 + C.SILENCE_MS - 1), false);
    eq(C.silenceCheck(s, 0, 1000 + C.SILENCE_MS + 1), true);
  });
});

describe('#590 · 模型（K / B / G / 语言键 / iOS 7 / H）', () => {
  test('语言键：视频的语言 = subtitleVideoLang（缺省自动），译成 = listenMyLang', () => {
    ok(/myLang = videoLangOf\(v, target\)/.test(MODEL) && /const v = B\(s\.subtitleVideoLang\)/.test(MODEL), '左格没读 subtitleVideoLang');
    ok(/if \(sub\) \{\s*otherLang = target;/.test(MODEL), '右格（译成）没读 listenMyLang');
    ok(/p\.subtitleVideoLang = video/.test(MODEL) && /p\.listenMyLang = target/.test(MODEL), '字幕改语言没写到对的键');
    ok(!/chrome\.storage\.local\.set\(\{ subtitleVideoLang: lang \}\)/.test(MODEL), 'LID 仍把认出来的语言写进 subtitleVideoLang（「自动」会被改写）');
    ok(/subtitleVideoLang: \{ default: 'auto'/.test(read('src/store/schema.js')), 'schema 里 subtitleVideoLang 的缺省不是「自动」');
  });
  test('K：额度 / key 停机 ⇒ 整场停、提示可点到设置页', () => {
    ok(/function quotaHalt\(e\)/.test(MODEL) && /e\.grant \|\| e\.halt/.test(MODEL), '没有按 e.grant || e.halt 停机');
    ok(/quotaHalt\(eo\.err\)/.test(MODEL) && /quotaHalt\(passErr\)/.test(MODEL), 'translateRow / passRow 没接停机');
    ok(/TranslationCore\.haltMessage\(grantCode\)/.test(MODEL), '停机提示没用 TranslationCore.haltMessage');
    ok(/'sec-engines' : 'grant-card'/.test(MODEL), '停机提示没有去设置页的出口');
    ok(/state == "grant"/.test(BAR), '悬浮条没有 grant 态的出口');
  });
  test('B：字幕下完包接着听（不落进 idle 被画成「已暂停」）', () => {
    ok(/!== beforeGen && session\.mode !== 'subtitle'\)/.test(MODEL));
  });
  test('B 根因：VAD 包本来就在时不算「这一轮下过」（只有 downloading 进度才计）', () => {
    ok(/m\.state === 'downloading'\) vadFetched = true/.test(MODEL), 'VAD 进度回调该按 downloading 记「真下过」');
    ok(/if \(vadFetched\) \{\s*prep\.didDownload = true;\s*prep\.dlGen = /.test(MODEL), 'dlGen 只在 VAD 真下过时才加');
  });
  test('G：暂停 / 停机时离开，文案不说「还在听」', () => {
    ok(/stopped \? t\('subtitle_leave_confirm_paused'/.test(MODEL) && /stopped \? t\('listen_leave_confirm_paused'/.test(MODEL));
    for (const loc of fs.readdirSync(path.join(__dirname, '..', 'extension/_locales'))) {
      const m = JSON.parse(read(`extension/_locales/${loc}/messages.json`));
      ok(m.subtitle_leave_confirm_paused && m.listen_leave_confirm_paused, `${loc} 缺暂停态的离开文案`);
    }
  });
  test('iOS 7：字幕的源语言是视频的语言，不是译成', () => {
    ok(/cfg\.mode === 'subtitle' \? subSrcLang\(row\)/.test(MODEL), 'passRow 的 srcLang 在字幕里仍取 otherLang');
  });
  test('H：字幕那一调的截止宽于中继最长耗时', () => {
    const m = MODEL.match(/const SUB_PASS_TIMEOUT_MS = (\d+)/);
    ok(m && Number(m[1]) > 20000, '截止没有放宽');
  });
});

describe('#590 · 悬浮条（J / O）', () => {
  test('恢复的位置夹回屏幕内；悬停时文字让出控件那一排', () => {
    ok(/p\.setFrame\(MTSubtitleBar\.clamped\(p\.frame\)/.test(BAR));
    ok(/controls\.fittingSize\.height/.test(BAR));
  });
  test('空半句不顶掉上一句；新半句撤掉「这句译文失败」；原文 = 译文时不画小字', () => {
    ok(/if isPartial && !MTSubtitleBar\.meaningful\(o\) && !MTSubtitleBar\.meaningful\(t\) \{ return \}/.test(BAR));
    ok(/if isPartial && state == "tr-failed" \{ state = "listening" \}/.test(BAR));
    ok(/\|\| same$/m.test(BAR));
  });
});
