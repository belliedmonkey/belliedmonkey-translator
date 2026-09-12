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


describe('ListenCore — 嘈杂环境下的静音门限（自适应）', () => {
  // 每块 PCM 约 100 ms；摸底期 2500 ms ⇒ 前 25 块用来摸环境底噪。
  const feed = (s, rms, from, blocks) => {
    let hit = false;
    for (let i = 0; i < blocks; i++) hit = C.silenceCheck(s, rms, from + i * 100) || hit;
    return hit;
  };
  const warm = (s, noise, at) => feed(s, noise, at, 26);   // 摸完底噪

  test('安静房间：门限不动，仍是 0.004 那个下限', () => {
    const s = C.newSession(T0, 0.5);
    warm(s, 0.001, T0);
    eq(C.noiseGate(s), C.SILENCE_RMS || 0.004);
  });

  test('嘈杂环境：门限跟着底噪抬起来，但封顶', () => {
    const a = C.newSession(T0, 0.5);
    warm(a, 0.01, T0);
    eq(Math.round(C.noiseGate(a) * 1000) / 1000, 0.025);      // 0.01 × 2.5
    const b = C.newSession(T0, 0.5);
    warm(b, 0.05, T0);                                         // 极吵
    eq(C.noiseGate(b), C.NOISE_CEIL, '再吵也不能高到把正常说话判成静音');
  });

  test('★ 嘈杂环境里 30 秒没人说话 ⇒ 真的会暂停（固定门限时永远不会）', () => {
    const s = C.newSession(T0, 0.5);
    const noise = 0.01;                       // 咖啡厅级底噪，高过写死的 0.004
    // 用旧的固定门限判：0.01 >= 0.004 恒成立 ⇒ lastVoiceAt 每块都被刷新 ⇒ 永不暂停。
    // 这正是要修的那个 bug：「30 秒静音自动暂停」是防止一直烧钱的唯一闸门。
    ok(noise >= 0.004, '前提：这个底噪确实高过旧的固定门限');
    warm(s, noise, T0);
    const hit = feed(s, noise, T0 + 2600, 320);   // 再喂 32 秒的纯底噪
    ok(hit, '嘈杂环境下 30 秒只有底噪，应该判定为静音并暂停');
  });

  test('嘈杂环境里正常说话仍判为有声，不会被误暂停', () => {
    const s = C.newSession(T0, 0.5);
    warm(s, 0.01, T0);
    const hit = feed(s, 0.06, T0 + 2600, 320);    // 32 秒持续说话
    ok(!hit, '说话的能量远高于门限，不该被判成静音');
  });

  test('摸底期取最小值：开头就有人说话也不会把门限抬歪', () => {
    const s = C.newSession(T0, 0.5);
    // 摸底的 2.5 秒里一半在说话、一半是停顿 —— 停顿处才是底噪
    for (let i = 0; i < 26; i++) C.silenceCheck(s, i % 2 ? 0.08 : 0.002, T0 + i * 100);
    ok(C.noiseGate(s) <= 0.006, '门限该落在停顿处的底噪附近，实际 ' + C.noiseGate(s));
  });

  test('★ 真说话不会被当成噪声：停顿把「连续有声」的计时清掉', () => {
    const s = C.newSession(T0, 0.5);
    warm(s, 0.002, T0);
    const gate0 = C.noiseGate(s);
    // 说 3 秒、停 0.5 秒，来回十轮 —— 真实说话的样子。若没有「停顿清计时」这一条，
    // 说话会被当成环境噪声，门限一路抬高，最后连说话都判成静音。
    let at = T0 + 2600;
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 30; i++) { C.silenceCheck(s, 0.07, at); at += 100; }
      for (let i = 0; i < 5; i++) { C.silenceCheck(s, 0.002, at); at += 100; }
    }
    eq(C.noiseGate(s), gate0, '说话带停顿，门限不该被抬 —— 实际 ' + gate0 + ' → ' + C.noiseGate(s));
  });

  test('环境从安静走到嘈杂，门限跟着走（静音期的样本持续修正底噪）', () => {
    const s = C.newSession(T0, 0.5);
    warm(s, 0.001, T0);
    const quiet = C.noiseGate(s);
    feed(s, 0.008, T0 + 2600, 600);               // 环境变吵，但还没到说话的量级
    ok(C.noiseGate(s) > quiet, '门限该跟着抬，实际 ' + quiet + ' → ' + C.noiseGate(s));
  });
});

// ── 本机转写路（learning-design §9.6.1，2026-09-12 尖刺读数定下的规则）──────────────
describe('ListenCore — 本机转写路：locale、收 final 的规则、串句', () => {
  test('toLocale：短码 → 识别器 locale；不认识的原样', () => {
    eq(C.toLocale('zh'), 'zh-CN'); eq(C.toLocale('en'), 'en-US'); eq(C.toLocale('ja'), 'ja-JP');
    eq(C.toLocale('zh-TW'), 'zh-TW'); eq(C.toLocale('pt'), 'pt-BR'); eq(C.toLocale('xx-YY'), 'xx-YY'); eq(C.toLocale(''), '');
  });
  test('先看文字系：zh 路吐出的英文、en 路吐出的汉字都丢', () => {
    ok(!C.acceptDeviceFinal({ locale: 'zh-CN', text: 'We can chip the first bach netotayf', conf: 0.9 }, DEPS), 'zh 路对英文音频的高置信垃圾要丢');
    ok(!C.acceptDeviceFinal({ locale: 'en-US', text: '如果定金周五之前到账', conf: 0.9 }, DEPS));
    ok(C.acceptDeviceFinal({ locale: 'zh-CN', text: '如果定进周五之前到张', conf: 0.9 }, DEPS));
    ok(C.acceptDeviceFinal({ locale: 'en-US', text: 'We can ship the first batch', conf: 0.95 }, DEPS));
  });
  test('再看置信度：拉丁文字系低置信的碎片丢，CJK 碎片不按置信度丢', () => {
    ok(!C.acceptDeviceFinal({ locale: 'en-US', text: 'Rugua, Ting, Xing, Cho', conf: 0.26 }, DEPS), 'en 路对中文音频的低置信拼音要丢');
    ok(C.acceptDeviceFinal({ locale: 'en-US', text: 'Sure.', conf: 0.59 }, DEPS));
    ok(C.acceptDeviceFinal({ locale: 'zh-CN', text: '家', conf: 0.34 }, DEPS), '中文碎片是正文的一部分');
    ok(C.acceptDeviceFinal({ locale: 'zh-CN', text: '。', conf: 0.42 }, DEPS), '标点不判文字系');
    ok(!C.acceptDeviceFinal({ locale: 'zh-CN', text: '   ', conf: 1 }, DEPS));
  });
  test('串句：时间片按 locale 串起来、按句末标点切；尾巴超时放出；两路互不串', () => {
    const timers = []; let id = 0;
    const out = [];
    const sc = C.makeStreamCutter((l, s) => out.push(l + '|' + s), {
      flushMs: 1200, setTimeout: (fn) => { timers.push({ id: ++id, fn }); return id; }, clearTimeout: (t) => { const i = timers.findIndex((x) => x.id === t); if (i >= 0) timers.splice(i, 1); },
    });
    sc.add('zh-CN', '如果定进');
    sc.add('en-US', 'We can ship the');
    sc.add('zh-CN', '周五之前到张我们下周二就能发第一批货');
    sc.add('zh-CN', '。这个报家里');
    sc.add('en-US', 'first batch next Tuesday.');
    deepEq(out, ['zh-CN|如果定进周五之前到张我们下周二就能发第一批货。', 'en-US|We can ship the first batch next Tuesday.']);
    eq(sc.pending('zh-CN'), '这个报家里');
    // 尾巴：没有标点 ⇒ 等超时
    const last = timers[timers.length - 1]; last.fn();
    deepEq(out.slice(2), ['zh-CN|这个报家里']);
    eq(sc.pending('zh-CN'), '');
    // 只有标点的片段不成句（真机上识别器会把上一句的句号单独吐出来）
    sc.add('en-US', '.'); sc.add('zh-CN', '。');
    for (const t of timers.splice(0)) t.fn();
    eq(out.length, 3, '「.」「。」不该成行');
  });
  test('addFinal 收 deps.who：归属由识别器那一路直接给，不再按语言猜', () => {
    const s = C.newSession(T0, 0.5);
    const r1 = C.addFinal(s, 'Bonjour, vous êtes prêt ?', T0 + 1000, pair('en', 'fr'), Object.assign({}, DEPS, { who: 'them' }));
    eq(r1.who, 'them'); eq(r1.guessed, false);
    const r2 = C.addFinal(s, 'Yes, ready when you are.', T0 + 3000, pair('en', 'fr'), Object.assign({}, DEPS, { who: 'me' }));
    eq(r2.who, 'me'); eq(r2.guessed, false);
    // 没给 who：照旧按语言判（zh/en 对）
    eq(C.addFinal(s, '去机场，末班车几点', T0 + 5000, pair('zh', 'en'), DEPS).who, 'me');
  });
});

describe('ListenCore — 远程「修正 + 翻译」契约（§9.6.1）', () => {
  test('提示词：system 写明源/目标语言与两行标签；user 带上下文（最老在前）、候选词、原句', () => {
    const p = C.buildListenPrompt({ text: '如果定进周五之前到张', alts: ['到账', '到账'], who: 'me', srcName: '简体中文', dstName: 'English',
      context: [{ who: 'them', text: 'Can you ship next week?', tr: '下周能发货吗？' }] });
    ok(/correction stage/.test(p.system) && /T: <corrected sentence in 简体中文>/.test(p.system) && /X: <translation in English>/.test(p.system), p.system);
    ok(p.user.includes('[them] Can you ship next week?  ⇒ 下周能发货吗？'), '上下文行带译文');
    ok(p.user.includes('Recognizer candidates: 到账') && !p.user.includes('到账 | 到账'), '候选词去重');
    ok(p.user.endsWith('Transcript sentence:\n如果定进周五之前到张'));
    eq(C.LISTEN_PASS, 'one');
  });
  test('解析：双标签取两行；只有 X 或无标签 ⇒ 原文不丢、整段当译文；全角冒号也认', () => {
    deepEq(C.parseListenReply('T: 如果订金周五之前到账\nX: If the deposit arrives by Friday\n', '原'), { text: '如果订金周五之前到账', tr: 'If the deposit arrives by Friday', tagged: true });
    deepEq(C.parseListenReply('X: only translation', '原'), { text: '原', tr: 'only translation', tagged: false });
    deepEq(C.parseListenReply('```\njust text\n```', '原'), { text: '原', tr: 'just text', tagged: false });
    eq(C.parseListenReply('T：中文冒号\nX：ok', '原').text, '中文冒号');
  });
  test('接受门：同音字修正过门；换语言、长度差太多、没改都不过', () => {
    ok(C.acceptCorrection('如果定进周五之前到张', '如果订金周五之前到账', DEPS));
    ok(!C.acceptCorrection('如果定进周五之前到张', 'If the deposit arrives', DEPS), '文字系变了');
    ok(!C.acceptCorrection('a b c', 'a b c d e f g h', DEPS), '长度比超 1.3');
    ok(!C.acceptCorrection('same', 'same', DEPS), '没改不算修正');
    ok(!C.acceptCorrection('x', '', DEPS));
  });
  test('上下文：取最近 6 行、不含本行、最老在前', () => {
    const rows = []; for (let i = 1; i <= 9; i++) rows.push({ who: i % 2 ? 'them' : 'me', text: 't' + i, tr: i < 9 ? 'x' + i : '' });
    const ctx = C.contextRows(rows, rows[8]);
    eq(ctx.length, 6); eq(ctx[0].text, 't3'); eq(ctx[5].text, 't8'); eq(ctx[5].tr, 'x8');
    ok(!ctx.some((c) => c.text === 't9'), '不含本行');
  });
});

describe('ListenCore — 回声 token：混排按段切，不把整句拆成字母', () => {
  test('带一个汉字前缀的英文句不再和另一句英文「六成重合」', () => {
    const sq = C.makeSpeakQueue();
    sq.noteSpoken('译：Please confirm the price.', T0);
    ok(!sq.spokenRecently('译：Delivery takes forty five days.', T0 + 5000), '两句英文只共享「译」和几个字母，不该算刚读过');
    ok(sq.spokenRecently('译：Please confirm the price.', T0 + 5000), '同一句仍算刚读过');
    ok(sq.spokenRecently('Please confirm the price', T0 + 5000), '去掉前缀与标点也算');
  });
});

describe('ListenCore — latencySummary（时延埋点的汇总）', () => {
  test('按 lat.pass / lat.ttsStart 算 p50/p90/max，缺字段的行不算', () => {
    const rows = [{ lat: { pass: 100, ttsStart: 200, ttsEngine: 'device' } }, { lat: { pass: 300 } }, { lat: { pass: 200, ttsStart: 400, ttsEngine: 'browser' } }, { text: 'no lat' }];
    const s = C.latencySummary(rows);
    eq(s.n, 3); eq(s.pass.n, 3); eq(s.pass.p50, 200); eq(s.pass.max, 300);
    eq(s.ttsStart.n, 2); eq(s.ttsStart.p50, 400); deepEq(s.ttsEngines, { device: 1, browser: 1 });
    eq(C.latencySummary([]).pass.p50, null);
  });
});
