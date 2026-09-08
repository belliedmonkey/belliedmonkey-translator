// test/app-listen.test.js — 「对话 · 实时听译」的纯逻辑（learning-design §9.6）。
//
// 守四件事：
//   1. 归属：按住「我说」期间（含松手后的尾巴）到达的定稿是我的，其余是对方的。
//   2. 进语料的门：译文没到不写；星绕过一切；开关关着不写；白名单与 §6 的门各挡各的。
//   3. 进语料的形状：来源 conv:<id>、锚点 k:'conv'、学的永远是外语那一侧。
//   4. 静音计时与会话计时：30 s 没声音才算静，暂停不计入已听时长。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');
const LANGS = require('../build/langs.config.js');
const LearnRules = require('../extension/content/learn-rules.js');

// 生产里 listen.js 注入的就是这一个；测试里也用真的，不用替身 —— 归属判得准不准，
// 一半取决于它对真实句子的表现。
const DEPS = { dominantScript: LearnRules.dominantScript };
const pair = (myLang, otherLang) => ({ myLang, otherLang, registry: LANGS });

const T0 = 1_757_000_000_000;

describe('ListenCore — 定稿入表（归属按语言，§9.6）', () => {
  const ZH_EN = pair('zh', 'en');
  test('外语句归对方、母语句归我 —— 全程没有任何按住动作', () => {
    const s = C.newSession(T0, 0.5);
    eq(C.addFinal(s, 'Does this bus go to the airport?', T0 + 1000, ZH_EN, DEPS).who, 'them');
    eq(C.addFinal(s, '去机场，末班车几点', T0 + 6000, ZH_EN, DEPS).who, 'me');
    eq(C.addFinal(s, 'Yes, until midnight.', T0 + 9000, ZH_EN, DEPS).who, 'them');
    // 会话标题摘的是对方说的第一句
    eq(s.firstText, 'Does this bus go to the airport?');
    // 粘性兜底的依据：最后一条归了谁
    eq(s.lastWho, 'them');
  });
  test('判得准的行不标「猜的」；行上带 pinned 位供 ↔ 钉住', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, '这个交期可以接受', T0, ZH_EN, DEPS);
    eq(r.guessed, false);
    eq(r.pinned, false);
  });
  test('↔ 改边：翻转、钉住，并交回旧方向的快照供回收语料', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, 'Five weeks works.', T0, ZH_EN, DEPS);
    r.tr = '五周可以。';
    const before = C.flipWho(r);
    eq(before.who, 'them');
    eq(before.text, 'Five weeks works.');
    eq(before.tr, '五周可以。');
    eq(r.who, 'me');
    eq(r.guessed, false);
    eq(r.pinned, true);
    // 再点一次转回去
    eq(C.flipWho(r).who, 'me');
    eq(r.who, 'them');
  });
  test('空白定稿不入表', () => {
    const s = C.newSession(T0, 0.5);
    eq(C.addFinal(s, '   ', T0, ZH_EN, DEPS), null);
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
  // myLang / registry 是归属判断要的；lang / otherLang / targetLang 是语料形状要的。
  const cfg = { lang: 'en', otherLang: 'en', myLang: 'zh', targetLang: 'zh-CN', label: '对话', registry: LANGS };
  test('对方说的：text=外语，tr=中文；来源与锚点按会话', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, 'It leaves from across the street.', T0 + 4000, cfg, DEPS); r.tr = '它从马路对面发车。';
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
  test('我说的：text=译出的外语，tr=我说的中文（归属由中文这件事本身判出来）', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, '那 12 路多久一班', T0 + 100, cfg, DEPS); r.tr = 'How often does the 12 run?';
    eq(r.who, 'me');
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
    const ZH_EN = pair('zh', 'en');
    const a = C.addFinal(s, 'One.', T0 + 51_000, ZH_EN, DEPS); a.tr = '一。'; a.written = true; a.starred = true;
    C.addFinal(s, '第二句是中文，所以归我', T0 + 53_000, ZH_EN, DEPS);
    deepEq(C.summary(s, T0 + 55_000),
      { seconds: 15, them: 1, me: 1, written: 1, starred: 1, flips: 0, ephemeral: false });
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

describe('ListenCore — 复制全文（macOS 宽屏右栏）', () => {
  test('一行原文一行译文、空行分段；我说的行带前缀；未译行只有原文，界面词不进剪贴板', () => {
    const s = { rows: [
      { who: 'other', text: 'Where is the gate?', tr: '登机口在哪？' },
      { who: 'me', text: '往前走。', tr: 'Go straight.' },
      { who: 'other', text: 'Thanks.', tr: '' },
    ] };
    eq(C.transcriptText(s, '我：'), 'Where is the gate?\n登机口在哪？\n\n我：往前走。\nGo straight.\n\nThanks.');
    eq(C.transcriptText({ rows: [] }, '我：'), '');
    eq(C.transcriptText(null, '我：'), '');
  });
});


describe('ListenCore — 按语言归属（2026-09-08，取代按住说话）', () => {
  const zhEn = pair('zh', 'en');
  test('中英：中文归我、英文归对方，都不是猜的', () => {
    const s = C.newSession(T0, 0.5);
    eq(C.sideOf('Our lead time is about six weeks.', zhEn, DEPS), 'them');
    eq(C.sideOf('能压到四周吗？我们客户那边催得紧。', zhEn, DEPS), 'me');
    deepEq(C.attributeByLang(s, 'Five weeks works.', T0, zhEn, DEPS), { who: 'them', guessed: false });
    deepEq(C.attributeByLang(s, '好，就这么定。', T0, zhEn, DEPS), { who: 'me', guessed: false });
  });

  test('中日：假名一出现就判得出，哪怕句子里汉字更多', () => {
    const zhJa = pair('zh', 'ja');
    // dominantScript 对这句会说 Han（汉字比假名多），但只要有假名它就是日文 ——
    // 这正是 CJK_RULES「出现即判」而不是「计数取多」的理由。
    eq(LearnRules.dominantScript('納期は六週間です'), 'Han');
    eq(C.sideOf('納期は六週間です', zhJa, DEPS), 'them');
    eq(C.sideOf('这个交期我们可以接受', zhJa, DEPS), 'me');
  });

  test('中韩、中俄、中阿：另一边有独立文字系统，全判得出', () => {
    eq(C.sideOf('안녕하세요 반갑습니다', pair('zh', 'ko'), DEPS), 'them');
    eq(C.sideOf('Это слишком дорого', pair('zh', 'ru'), DEPS), 'them');
    eq(C.sideOf('هذا سعر جيد', pair('zh', 'ar'), DEPS), 'them');
  });

  test('拉丁对拉丁：判不出，返回空 —— 这是已知边界，不是 bug', () => {
    const enFr = pair('en', 'fr');
    eq(C.sideOf('Our lead time is six weeks.', enFr, DEPS), '');
    eq(C.sideOf('Le delai nous convient.', enFr, DEPS), '');
  });

  test('没有文字系统可比时（纯数字、纯标点、空串）返回空', () => {
    const zh = pair('zh', 'en');
    eq(C.sideOf('3.20', zh, DEPS), '');
    eq(C.sideOf('...!?', zh, DEPS), '');
    eq(C.sideOf('', zh, DEPS), '');
  });

  test('注册表不认识的语言 ⇒ 空集 ⇒ 判不出，不抛', () => {
    eq(C.sideOf('anything', pair('zz', 'yy'), DEPS), '');
    eq(C.scriptsOf('zz', LANGS).size, 0);
  });

  test('没注入判断器时不判，也不抛', () => {
    eq(C.sideOf('Hello', pair('zh', 'en'), {}), '');
    eq(C.sideOf('Hello', pair('zh', 'en'), null), '');
  });

  test('判不出时：先跟上一句同一边（粘性）', () => {
    const s = C.newSession(T0, 0.5);
    s.lastWho = 'me';
    deepEq(C.attributeByLang(s, '3.20', T0, pair('en', 'fr'), DEPS), { who: 'me', guessed: true });
    s.lastWho = 'them';
    deepEq(C.attributeByLang(s, '3.20', T0, pair('en', 'fr'), DEPS), { who: 'them', guessed: true });
  });

  test('判不出、又没有上一句 ⇒ 归对方（错误往安静的方向倒）', () => {
    const s = C.newSession(T0, 0.5);
    eq(s.lastWho, '');
    // 归错成「我」会把这句译成对方的语言并朗读出来 —— 当着客户念一句莫名其妙的话。
    deepEq(C.attributeByLang(s, 'Le delai nous convient.', T0, pair('en', 'fr'), DEPS),
      { who: 'them', guessed: true });
  });

  test('两边选成同一种语言时恒判不出 —— 界面必须在源头禁掉它', () => {
    // 这条是回归护栏：设置那边要做「选重了自动对调」，万一漏了，这里说明后果。
    const same = pair('zh', 'zh');
    eq(C.sideOf('这个交期可以吗', same, DEPS), '');
    eq(C.sideOf('Hello there', same, DEPS), '');
  });
});

describe('ListenCore — 汉字圈的顺序纪律，两处必须一致', () => {
  test('listen-core 的 CJK_RULES 与 translation-core 的 SCRIPT_OF_TARGET 同序（ja 在 zh 前）', () => {
    const order = (src, re) => [...src.matchAll(re)].map((m) => m[1]);
    const core = fs.readFileSync(path.join(__dirname, '..', 'app', 'listen-core.js'), 'utf8');
    const tc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', 'translation-core.js'), 'utf8');
    const mine = order(core.slice(core.indexOf('const CJK_RULES')), /\['(ja|ko|zh)',/g).slice(0, 3);
    const theirs = order(tc.slice(tc.indexOf('const SCRIPT_OF_TARGET')), /\/\^(ja|ko|zh)\\b\/i/g).slice(0, 3);
    eq(mine.length, 3, '没在 listen-core.js 里解析到 CJK_RULES 的三条 —— 改名了就同步改这条门禁');
    eq(theirs.length, 3, '没在 translation-core.js 里解析到 SCRIPT_OF_TARGET 的三条');
    eq(mine.join(','), theirs.join(','),
      '两张汉字圈的表漂了。日文里也有汉字，所以假名必须先判 —— 顺序反了，'
      + '一句日文会被当成中文，归属和翻译方向一起错。');
    eq(mine[0], 'ja', 'ja 必须排在最前');
  });
});

describe('ListenCore — 回声闸（朗读被自己录回去）', () => {
  test('朗读窗口内、同一段文本 ⇒ 判为回声', () => {
    const g = C.makeEchoGuard();
    g.speaking('从付定金起，我们的交期大约是六周。', T0);
    ok(g.isEcho('从付定金起，我们的交期大约是六周。', T0 + 800));
    eq(g.dropped(), 1);
  });

  test('朗读期间对方插话 ⇒ 不误杀（裁定 5 要保住的正是这一句）', () => {
    const g = C.makeEchoGuard();
    g.speaking('从付定金起，我们的交期大约是六周。', T0);
    ok(!g.isEcho('Can you do four weeks instead?', T0 + 900));
    ok(!g.isEcho('这个价格我们再谈谈。', T0 + 900));
    eq(g.dropped(), 0);
  });

  test('只截到后半段也算 —— 回声消除半路才收敛', () => {
    const g = C.makeEchoGuard();
    g.speaking('At ten thousand units we can do three twenty per piece', T0);
    ok(g.isEcho('we can do three twenty per piece', T0 + 600));
  });

  test('播完之后还防一会儿，过了窗口就不再拦', () => {
    const g = C.makeEchoGuard();
    g.speaking('五周可以。', T0);
    g.spoke(T0 + 2000);
    ok(g.isEcho('五周可以。', T0 + 2000 + C.ECHO_TAIL_MS - 50));
    ok(!g.isEcho('五周可以。', T0 + 2000 + C.ECHO_TAIL_MS + 50));
  });

  test('登记项有上限，最老的会被挤掉', () => {
    const g = C.makeEchoGuard();
    for (let i = 0; i < 6; i++) g.speaking('句子编号 ' + i + ' 的内容在这里', T0 + i);
    ok(g.size() <= 4);
  });

  test('空文本不登记也不误判', () => {
    const g = C.makeEchoGuard();
    g.speaking('', T0);
    g.speaking('   ', T0);
    eq(g.size(), 0);
    ok(!g.isEcho('', T0));
  });
});

describe('ListenCore — 朗读队列（裁定 7：排队逐句读完）', () => {
  test('三句接连入队，按顺序出队', () => {
    const q = C.makeSpeakQueue();
    q.push({ rid: 1, text: '五周可以。', lang: 'zh' });
    q.push({ rid: 2, text: '我们今天把形式发票发给你。', lang: 'zh' });
    q.push({ rid: 3, text: '模具费是一次性的。', lang: 'zh' });
    eq(q.size(), 3);
    eq(q.next().rid, 1);
    eq(q.next().rid, 2);
    eq(q.next().rid, 3);
    eq(q.next(), null);
  });

  test('同一行重复入队 ⇒ 覆盖，不排两遍（改边后重译会走到这里）', () => {
    const q = C.makeSpeakQueue();
    q.push({ rid: 7, text: '旧译文', lang: 'zh' });
    q.push({ rid: 7, text: '改边后的新译文', lang: 'en' });
    eq(q.size(), 1);
    const j = q.next();
    eq(j.text, '改边后的新译文');
    eq(j.lang, 'en');
  });

  test('drop 摘掉还没出队的那一行；clear 清空', () => {
    const q = C.makeSpeakQueue();
    q.push({ rid: 1, text: 'a a a', lang: 'en' });
    q.push({ rid: 2, text: 'b b b', lang: 'en' });
    q.drop(1);
    eq(q.size(), 1);
    eq(q.peek().rid, 2);
    q.clear();
    eq(q.size(), 0);
    eq(q.peek(), null);
  });

  test('同一段话 60 秒内不读第二遍 —— 回声漏过第一层时，环在这里断掉', () => {
    const q = C.makeSpeakQueue();
    q.noteSpoken('从付定金起，我们的交期大约是六周。', T0);
    ok(q.spokenRecently('从付定金起，我们的交期大约是六周。', T0 + 5000));
    ok(!q.spokenRecently('这是完全不同的另一句话内容。', T0 + 5000));
    ok(!q.spokenRecently('从付定金起，我们的交期大约是六周。', T0 + C.SPOKEN_WINDOW_MS + 1000));
  });

  test('空文本不入队、不登记', () => {
    const q = C.makeSpeakQueue();
    q.push({ rid: 1, text: '', lang: 'zh' });
    q.push(null);
    eq(q.size(), 0);
    q.noteSpoken('', T0);
    ok(!q.spokenRecently('', T0));
  });
});


describe('ListenCore — 这次不留记录（裁定 6）', () => {
  const ZH_EN = pair('zh', 'en');
  const cfg = { lang: 'en', otherLang: 'en', myLang: 'zh', targetLang: 'zh-CN', label: '对话',
    registry: LANGS, captureOn: true, langs: null };
  const deps = { langAllowed: () => true, shouldCapture: () => true };
  test('默认是留记录的', () => {
    const s = C.newSession(T0, 0.5);
    eq(s.ephemeral, false);
    const r = C.addFinal(s, 'Five weeks works.', T0, ZH_EN, DEPS); r.tr = '五周可以。';
    eq(C.shouldWrite(r, s, cfg, deps), true);
  });
  test('勾了就一句都不写 —— 而且**星也不写**', () => {
    const s = C.newSession(T0, 0.5);
    s.ephemeral = true;
    const r = C.addFinal(s, 'Five weeks works.', T0, ZH_EN, DEPS); r.tr = '五周可以。';
    eq(C.shouldWrite(r, s, cfg, deps), false);
    r.starred = true;                       // 星在别处绕过一切门，这里也不行
    eq(C.shouldWrite(r, s, cfg, deps), false,
      '星的语义是「绕过一切门确保进复习」；这一场根本不写盘，所以界面上那颗星也不该出现');
  });
  test('小结如实报出这一场没留记录', () => {
    const s = C.newSession(T0, 0.5);
    s.ephemeral = true;
    C.addFinal(s, 'Five weeks works.', T0 + 1000, ZH_EN, DEPS);
    const sum = C.summary(s, T0 + 5000);
    eq(sum.ephemeral, true);
    eq(sum.written, 0);
  });
  test('改过边的次数进小结 —— 归属判得准不准的唯一体感指标', () => {
    const s = C.newSession(T0, 0.5);
    const r = C.addFinal(s, 'Five weeks works.', T0, ZH_EN, DEPS);
    s.flips = (s.flips || 0) + 1; C.flipWho(r);
    eq(C.summary(s, T0 + 1000).flips, 1);
  });
});
