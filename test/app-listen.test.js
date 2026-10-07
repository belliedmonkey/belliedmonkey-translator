// test/app-listen.test.js — 「对话 · 实时听译」的纯逻辑（learning-design §9.6）。
//
// 守四件事：
//   1. 归属：按住「我说」期间（含松手后的尾巴）到达的定稿是我的，其余是对方的。
//   2. 进语料的门：译文没到不写；星绕过一切；开关关着不写；白名单与 §6 的门各挡各的。
//   3. 进语料的形状：来源 conv:<id>、锚点 k:'conv'、学的永远是外语那一侧。
//   4. 静音计时与会话计时：30 s 没声音才算静，暂停不计入已听时长。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');
const C = require('../app/listen-core.js');
const LANGS = require('../build/langs.config.js');
const LearnRules = require('../extension/content/learn-rules.js');

// 生产里 listen.js 注入的就是这一个；测试里也用真的，不用替身 —— 归属判得准不准，
// 一半取决于它对真实句子的表现。
const DEPS = { dominantScript: LearnRules.dominantScript };
const pair = (myLang, otherLang) => ({ myLang, otherLang, registry: LANGS });

const T0 = 1_757_000_000_000;
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MODEL = read('src/app/listen-model.js');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

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

  test('★ speakPump 每句必须超时 — speakOut 挂住不得阻塞整条队列（#565 六轮真机教训）', () => {
    const fn = MODEL.slice(MODEL.indexOf('async function speakPump'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    ok(/Promise\.race/.test(body), 'speakPump 没有 Promise.race —— speakOut 挂住（下载卡死/网络不通）时整条朗读队列死锁');
    ok(/timeout/.test(body), '超时的 reason 不是 "timeout" —— onSpeakResult 要认它');
    ok(/30000|TTS_SENTENCE_TIMEOUT/.test(body), '超时值不见了 —— 30 s 是模型装载+重试窗口的余量');
  });

  test('★ assets / timeout 类失败第一次就说 — 不等 3 次（#565 六轮：模型没下好不是瞬态错误）', () => {
    const fn = MODEL.slice(MODEL.indexOf('function onSpeakResult'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    ok(/assets.*timeout|timeout.*assets/.test(body), 'onSpeakResult 没有把 assets/timeout 单独分出来 —— 它们不会自愈，等 3 次只是在等一个不会来的好转');
    ok(!/speakFails\+\+/.test(body.split(/assets.*timeout|timeout.*assets/)[0].split('speakFails')[0]) || /assets/.test(body),
      'assets/timeout 在 speakFails++ 之前就要 return —— 否则第一次失败被静默吞掉');
  });

  test('★ ensureDeviceReady 按语言过滤 — 泰语模型没下好不得堵死中文（#565 六轮 build 88 回归）', () => {
    const tts = read('extension/learn/tts.js');
    ok(/ensureDeviceReady\(.*langOpt\)/.test(tts), 'ensureDeviceReady 没有 langOpt 参数 —— 全量检查会把「泰语 105 MB 没下好」当成「整个引擎不可用」');
    ok(/deviceStatus\(.*langOpt\)/.test(tts), 'deviceStatus 没有 langOpt 参数 —— 全量探会堵死其他语言');
    ok(/speakOut.*langOpt|ensureDeviceReady.*baseLang/.test(tts.replace(/\n/g, ' ')), 'speak() 没有传语言给 ensureDeviceReady —— 中文会被泰语的下载卡住');
  });

  test('★ 朗读引擎不可用不得静默 — 脏 id 自愈 + 听译第一句就说（2026-10-06 中国版中泰全哑真机）', () => {
    // 根因：09-09~09-22 之间「登录即领取」给中国版写进过 grant_speech；方案 C（8748ada2）起
    // 它只在国际版注册表里 ⇒ engine() 为 null ⇒ 听译每句被 ttsReady() 哑跳、零提示，且
    // 更新安装永不再过首启。两道修：ensureDeviceTts 把「解析不了的 id」当脏数据重写成
    // device；autoSpeak 的 'tts' 跳过第一句就出可见提示。
    const shell = stripComments(read('src/app/shell-model.js'));
    ok(/resolvable = \(id\).*Registry\.ttsEngines\(\)/.test(shell.replace(/\n/g, ' ')),
      'ensureDeviceTts 没有按注册表判「能不能解析」—— 脏 id 会被当成「用户选过」而永不自愈（中泰全哑的根）');
    ok(/ttsEngine: 'device', ttsApiKey: ''/.test(shell),
      '自愈重写 device 时没有清掉脏引擎的 key 残留');
    const model = stripComments(read('src/app/listen-model.js'));
    ok(/autoSkip === 'tts' && !ttsHinted/.test(model),
      'autoSpeak 对引擎不可用还是静默跳过 —— #565 六轮「不静默」漏了这一类');
    ok(/listen_tts_unusable/.test(model), '引擎不可用的提示没有走具名文案键');
    ok(!/if \(autoSkip\) return;/.test(model), 'autoSkip 的早退把提示吞了 —— 早退分支里必须先判 tts 那一类');
  });

  test('★ 听译进场只探/只下当前语言对的模型 — 中英对话不得拉泰语（2026-10-06，90 号包真机）', () => {
    // a1e9a232 修了包屏两条路（probePacks/runFirstRunPacks），漏了 beginPipeline：不传
    // langOpt = 探注册表全量（zh+en+th）⇒ 包屏按 zh/en 省下的泰语 105MB 在进场时被补判
    // 「未就绪」开下，会话堵在「准备中…」。与 speak()、包屏同一条纪律：这场念什么就下什么。
    const model = stripComments(read('src/app/listen-model.js'));
    ok(/\}, undefined, deviceLocales\(cfg\)\)/.test(model),
      'beginPipeline 的 ensureDeviceReady 没传 deviceLocales(cfg) —— 全量探测会把包屏按对省下的泰语在进场时补下');
  });

  test('★ vits 的 dataDir 为空必须传空串 — 传目录会被当 espeak 数据目录校验 phontab 而拒载（#567 真凶，2026-10-06 sherpa stderr 实锤）', () => {
    // 后果链：vits 在任何包里都没装载成功过（tts-failed reason:load）⇒ 泰语全靠系统语音兜底
    // ⇒ iOS 没装泰语系统语音 ⇒ 真机泰语全哑。Mac 压测：修复前 12/12 必败，修复后 24/24 全绿。
    const swift = read('app/native/speech-bridge.swift');
    ok(/dataDir: m\.dataDir\.isEmpty \? "" : d\.appendingPathComponent\(m\.dataDir\)\.path/.test(swift),
      'vits dataDir 没有按「空即传空串」处理 —— appendingPathComponent("") 会把模型目录传成 espeak 数据目录，sherpa 找不到 phontab 直接拒载');
  });

  test('★ 登录进行中 = 入口全部锁定（2026-10-06 用户裁定）', () => {
    // 此前 apple-result/webauth-result 回调第一行就 disabled=false，然后才进入秒级的
    // 「正在登录…」验证等待 —— 窗口期 Apple/Google/邮箱全都能再点。原则：从点击到流程
    // 终了（成功离屏 / 失败与取消才解锁），这一屏所有登录入口保持 disabled。
    const src = read('src/app/shell-model.js');
    ok(/const LOGIN_ENTRY_IDS = \['btn-apple', 'btn-google', 'btn-signin', 'send', 'verify'/.test(src),
      'setLoginBusy 没有覆盖全部登录入口（Apple/Google/邮箱展开/发送/验证码）');
    ok(/function setLoginBusy\(busy\)/.test(src), '缺 setLoginBusy 统一入口');
    const stripped = src.replace(/\/\/.*$/gm, '');
    // 原 bug 的形状就是它：回调顶部裸的单按钮解锁（先解锁、后进入秒级验证等待）—— 禁绝
    ok(!/\$\('btn-(apple|google)'\)\.disabled = false/.test(stripped),
      '回调里还有裸的单按钮解锁 —— 那正是「登录中还能点」的窗口');
    ok((stripped.match(/setLoginBusy\(true\)/g) || []).length >= 4,
      '四个登录入口（Apple/Google/邮箱/验证码）没有都走 setLoginBusy 锁定');
    // 成功路径复位（2026-10-06 真机 b92：登录成功跳到「先把两个语音包下好」后页尾仍挂
    // 「正在登录…」—— #status 在 app/index.html 里游离于各 section 之外，任何屏都看得见）。
    const showFn = stripped.slice(stripped.indexOf('async function show('), stripped.indexOf('async function show(') + 2600);
    ok(/if \(session\) say\(''\)/.test(showFn),
      'show() 成功落屏后没有清登录等待文案 —— 「正在登录…」会挂在后续每一屏的页尾');
    ok(/setLoginBusy\(false\)/.test(showFn),
      'show(null)（登出回登录面）没有复位登录锁 —— 成功路径按裁定不解锁，登出再不复位按钮就全死了');
  });

  test('★ 听译内切语言要按新对补包 — 不必退出重进（2026-10-06，92 号包真机）', () => {
    const model = stripComments(read('src/app/listen-model.js'));
    ok(/async function ensurePacksForPair\(\)/.test(model), '没抽出共用的按对补包段（进场与改语言要用同一段）');
    ok(/if \(!\(await ensurePacksForPair\(\)\)\) return;/.test(model), 'beginPipeline 没走共用的补包段');
    const lc = model.slice(model.indexOf('function langChange'), model.indexOf('function setAutoSpeak'));
    ok(/ensurePacksForPair\(\)/.test(lc), 'langChange 改语言没有按新对补包 —— zh/en 切泰语不触发下载，必须退出重进');
  });

  test('★ 包屏只下载所选语言对的模型 — 没选泰语就不下 105 MB（2026-10-05 用户拍板）', () => {
    // 用户 12:33 拍板：首启只下载所选语言对的朗读模型。原来 probePacks 和 runFirstRunPacks
    // 都传全部模型（zh+en+th），选中文/English 也会去下泰语 105 MB（真机 88：显示
    // 「正在下载离线模型 · th · 9%」，语言对里根本没有泰语）。
    const model = read('src/app/shell-model.js');
    ok(/deviceStatus\(DEVICE_TTS_ENGINE,\s*firstRunLocales\(s\)\)/.test(model),
      'probePacks 没有把 firstRunLocales(s) 传给 deviceStatus —— 会去探全部模型（含没选的泰语）');
    ok(/ensureDeviceReady\(onProg,\s*DEVICE_TTS_ENGINE,\s*firstRunLocales\(s\)\)/.test(model),
      'runFirstRunPacks 没有把 firstRunLocales(s) 传给 ensureDeviceReady —— 会去下载全部模型（含没选的泰语 105 MB）');
    const tts = read('extension/learn/tts.js');
    ok(/Array\.isArray\(langOpt\)/.test(tts),
      'deviceStatus 没有接受数组形式的 langOpt —— 语言对是一对（两个语言），单个 string 不够');
    ok(/models\.length === 0/.test(tts),
      '过滤后模型列表为空时没有视为就绪 —— 选了 fr↔de 这类没有离线模型的语言会被当成「没准备好」');
  });

  test('泰语：自己念的被认回来（带识别差异）⇒ 判为回声（2026-10-04 真机回归）', () => {
    // 泰文无词间空格、又不在 CJK_CHAR 里 —— 原来的切法把整句拼成一个巨型「词」，包含度退化成
    // 整串相等，识别差异哪怕一个字符都放行 ⇒ 自己念的泰语被当成新句子翻回中文。
    const g = C.makeEchoGuard();
    g.speaking('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0);
    // 认回来时差了几个字符/声调符号（ASR 对合成语音的典型差异）
    ok(g.isEcho('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0 + 900), '完全相同没拦住');
    ok(g.isEcho('ราคานี้ รวมภาษีและค่าขนส่งแล้ว', T0 + 900), '多个空格没拦住');
    ok(g.isEcho('ราคานี้รวมภาษีและค่าขนส่ง', T0 + 900), '截掉结尾没拦住（回声消除半路才收敛，同上一条）');
    ok(g.isEcho('ัราคานี้รวมภาษีและค่าขนส่งแล้ว', T0 + 900), '开头多认了一个声调符号没拦住');
    eq(g.dropped(), 4);
  });

  test('泰语：对方真说的话不被误杀（裁定 5）', () => {
    const g = C.makeEchoGuard();
    g.speaking('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0);
    ok(!g.isEcho('เราส่งของได้ภายในหกสัปดาห์', T0 + 900), '另一句泰语被误杀了');
    ok(!g.isEcho('Can you do four weeks instead?', T0 + 900));
    eq(g.dropped(), 0);
  });

  test('识别质量严重劣化（重合度只有 ~35%）⇒ 仍判回声（#565 四轮）', () => {
    // 扬声器→空气→麦克风→识别器 一圈的 bigram 重合度可能掉到 0.6 以下；0.35 的门限要能接住。
    // 构造一个只共享约一半字符的变体（模拟识别大面积替换/丢字）。
    const g = C.makeEchoGuard();
    g.speaking('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0);
    // 换掉一半的字符（模拟 ASR 把一半的词换成了同音异形）
    ok(g.isEcho('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0 + 900), '完全相同：门限太低了？');
    // 完全不同的一句：不应误杀
    ok(!g.isEcho('กรุงเทพมหานครเป็นเมืองหลวง', T0 + 900), '完全不同的一句被误杀了（门限降过头）');
  });

  test('泰语定稿晚到（念完 2.5 s 才落）⇒ 仍判回声（#565 二轮，2026-10-05 真机回归）', () => {
    // 系统语音出声比 didFinish 晚、Dictation 转写器定稿又晚落 —— 1500 ms 的窗盖不住「念完→定稿」
    // 这一整段，回声定稿落在窗外被当成新句子。ECHO_TAIL_MS 提到 3000 后，晚到的定稿也要拦得住。
    const g = C.makeEchoGuard();
    g.speaking('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0);
    g.spoke(T0 + 2000);                                    // 念了两秒
    ok(g.isEcho('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0 + 2000 + 2500), '念完 2.5 s 才到的定稿没拦住');
    ok(!g.isEcho('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0 + 2000 + C.ECHO_TAIL_MS + 100), '窗口外仍被拦（窗口失效）');
    // 晚到的窗口里，对方真说的另一句泰语仍不被误杀
    ok(!g.isEcho('เราส่งของได้ภายในหกสัปดาห์', T0 + 2000 + 2500), '晚到窗口里误杀了另一句泰语');
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
  // 2026-09-18：Mac harness 用 conv.pcm 读回的真实序列（en-US 路，t0/t1 毫秒、conf 均值）
  test('句头救回：低置信的拉丁短片被紧接的高置信片接回，去掉开头的标点垃圾', () => {
    const g = C.makeFinalGate(DEPS);
    deepEq(g.push({ locale: 'en-US', text: ',... The', conf: 0.25, t0: 16200, t1: 17520 }), []);
    eq(g.held('en-US'), ',... The');
    deepEq(g.push({ locale: 'en-US', text: 'quote already includes freight and insurance, but not customs duties.', conf: 0.98, t0: 17520, t1: 21420 }),
      ['The', 'quote already includes freight and insurance, but not customs duties.']);
    eq(g.held('en-US'), '', '接回之后不再扣着');
    deepEq(g.push({ locale: 'en-US', text: ' we', conf: 0.01, t0: 31300, t1: 31780 }), []);
    deepEq(g.push({ locale: 'en-US', text: 'need to see a sample first before we decide on the order', conf: 0.99, t0: 31780, t1: 34360 }),
      ['we', 'need to see a sample first before we decide on the order']);
  });
  test('句头救回：中文整句期间 en 路吐的长串垃圾不扣、只有标点的片接回来也不会出字', () => {
    const g = C.makeFinalGate(DEPS);
    deepEq(g.push({ locale: 'en-US', text: 'Rugua, Ting, Xing, Cho,', conf: 0.27, t0: 0, t1: 1200 }), []);
    eq(g.held('en-US'), '', '四个词的垃圾不算句头');
    deepEq(g.push({ locale: 'en-US', text: ' Wu,', conf: 0.21, t0: 1200, t1: 1500 }), []);
    deepEq(g.push({ locale: 'en-US', text: ' P, Hua.', conf: 0.16, t0: 4019, t1: 4900 }), []);
    deepEq(g.push({ locale: 'en-US', text: ',...', conf: 0.01, t0: 4900, t1: 5800 }), []);
    eq(g.held('en-US'), ',...', '只扣最近的一小片，前面的 P, Hua. 已作废');
    deepEq(g.push({ locale: 'en-US', text: 'We can ship the 1st batch next', conf: 0.91, t0: 5800, t1: 7540 }), ['We can ship the 1st batch next'], '扣住的只有标点 ⇒ 不出字');
  });
  test('句头救回：不紧接（隔了停顿）的低置信片丢掉；文字系不对的片永不扣；zh 路不受影响', () => {
    const g = C.makeFinalGate(DEPS);
    deepEq(g.push({ locale: 'en-US', text: ' we', conf: 0.05, t0: 1000, t1: 1300 }), []);
    deepEq(g.push({ locale: 'en-US', text: 'need to see a sample', conf: 0.95, t0: 2600, t1: 4000 }), ['need to see a sample'], '隔了 1.3 s，不是同一句');
    deepEq(g.push({ locale: 'zh-CN', text: 'The', conf: 0.87, t0: 16920, t1: 17340 }), [], 'zh 路吐英文：丢');
    eq(g.held('zh-CN'), '');
    deepEq(g.push({ locale: 'zh-CN', text: '报', conf: 0.78, t0: 12000, t1: 12180 }), ['报'], 'CJK 碎片照收');
    deepEq(g.push({ locale: 'en-US', text: 'Sure.', conf: 0.59, t0: 24300, t1: 25700 }), ['Sure.']);
  });
  test('再看置信度：拉丁文字系低置信的碎片丢，CJK 碎片不按置信度丢', () => {
    ok(!C.acceptDeviceFinal({ locale: 'en-US', text: 'Rugua, Ting, Xing, Cho', conf: 0.26 }, DEPS), 'en 路对中文音频的低置信拼音要丢');
    ok(C.acceptDeviceFinal({ locale: 'en-US', text: 'Sure.', conf: 0.59 }, DEPS));
    ok(C.acceptDeviceFinal({ locale: 'zh-CN', text: '家', conf: 0.34 }, DEPS), '中文碎片是正文的一部分');
    ok(C.acceptDeviceFinal({ locale: 'zh-CN', text: '。', conf: 0.42 }, DEPS), '标点不判文字系');
    ok(!C.acceptDeviceFinal({ locale: 'zh-CN', text: '   ', conf: 1 }, DEPS));
  });
  // 2026-10-06（真机「说中文转成泰文」追根）：老表只有 CJK+拉丁，th/ru/ar 的 want 恒为空
  // ⇒ 文字系这道检查对泰语路一个都不过；老「已知脚本」白名单也只列 5 种，zh 路吐泰文/西里尔没人拦。
  test('文字系覆盖泰/俄/阿：locale 的 want 不再为空，跨文字系照样丢', () => {
    ok(C.acceptDeviceFinal({ locale: 'th-TH', text: 'สวัสดีครับ', conf: -1 }, DEPS), '泰文 locale 收泰文');
    ok(!C.acceptDeviceFinal({ locale: 'th-TH', text: 'Hello there', conf: -1 }, DEPS), '泰文 locale 吐拉丁：丢');
    ok(C.acceptDeviceFinal({ locale: 'ru-RU', text: 'Спасибо', conf: -1 }, DEPS));
    ok(!C.acceptDeviceFinal({ locale: 'ru-RU', text: '谢谢', conf: -1 }, DEPS), '俄文 locale 吐汉字：丢');
    ok(!C.acceptDeviceFinal({ locale: 'zh-CN', text: 'Спасибо', conf: 0.9 }, DEPS), '中文 locale 吐西里尔：丢（老白名单漏网）');
    ok(!C.acceptDeviceFinal({ locale: 'zh-CN', text: 'สวัสดี', conf: 0.9 }, DEPS), '中文 locale 吐泰文：丢');
    ok(C.acceptDeviceFinal({ locale: 'ja-JP', text: 'これはにほんごです', conf: 0.9 }, DEPS), 'ja 路收假名');
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
  // 2026-10-06（真机「断句不生效 / 说完很久不进历史 / 不播放译文」）：尾部防抖在「一直在说」时
  // 每次 add 都被重置 ⇒ 永不落行。泰文又没句末标点，emitDone 也切不动。绝对上限是唯一出路。
  test('绝对上限：说话不停又没标点，也必须在 STREAM_MAX_MS 内落行', () => {
    const timers = []; let id = 0;
    const out = [];
    const sc = C.makeStreamCutter((l, s) => out.push(l + '|' + s), {
      flushMs: 1200, maxAgeMs: 4000,
      setTimeout: (fn, ms) => { timers.push({ id: ++id, fn, ms }); return id; },
      clearTimeout: (t) => { const i = timers.findIndex((x) => x.id === t); if (i >= 0) timers.splice(i, 1); },
    });
    for (let i = 0; i < 20; i++) sc.add('th-TH', 'ครับ');   // 连续 20 片，每次都刷新闲置防抖
    eq(out.length, 0, '没到绝对上限前先攒着');
    eq(sc.pending('th-TH').split(/\s+/).filter(Boolean).length, 20, '20 片都还在缓冲里');
    const hard = timers.reduce((a, b) => (a == null ? b : (b.ms > a.ms ? b : a)), null);
    eq(hard.ms, 4000, '绝对上限就是 STREAM_MAX_MS');
    hard.fn();
    eq(out.length, 1, '到点必须发出去 —— 这就是「很久不进历史」的修法');
    ok(/ครับ/.test(out[0]), out[0]);
    eq(sc.pending('th-TH'), '', '发完清空');
  });
  test('绝对上限：落行后重新计时，不会被上一段的旧计时提前切', () => {
    const timers = []; let id = 0;
    const out = [];
    const sc = C.makeStreamCutter((l, s) => out.push(l + '|' + s), {
      flushMs: 1200, maxAgeMs: 4000,
      setTimeout: (fn, ms) => { timers.push({ id: ++id, fn, ms }); return id; },
      clearTimeout: (t) => { const i = timers.findIndex((x) => x.id === t); if (i >= 0) timers.splice(i, 1); },
    });
    sc.add('th-TH', 'หนึ่ง');
    const h1 = timers.reduce((a, b) => (b.ms > a.ms ? b : a));
    h1.fn();                                   // 到上限，发出去
    eq(out.length, 1);
    timers.length = 0;                         // 两只定时器都已耗掉
    sc.add('th-TH', 'สอง');                     // 新一段：重新起一个完整上限
    const h2 = timers.reduce((a, b) => (b.ms > a.ms ? b : a));
    eq(h2.ms, 4000);
    ok(h2.id !== h1.id, '是新的计时，不是旧的');
  });
  // 归属改由端上 LID 模型给（§9.6.1.3，2026-10-07）：模型判出哪门语言，就只收那一路 ——
  // 这就是「半句闪错语言」的根治（旧办法在没有信息时随机先画一路，再靠置信度仲裁往回改）。
  test('归属由 LID 给：半句与定稿都只收 LID 判定的那一路；没判出来时什么都不上屏', () => {
    ok(C.sideMatchesLid('zh-CN', 'zh'), 'zh 判词收 zh 路');
    ok(C.sideMatchesLid('zh-TW', 'zh'), '地区变体同短码');
    ok(C.sideMatchesLid('th-TH', 'th'));
    ok(C.sideMatchesLid('yue-CN', 'yue'), '粤语短码对齐（识别器 locale 也是 yue-CN）');
    ok(!C.sideMatchesLid('th-TH', 'zh'), 'LID 说中文 ⇒ 泰文路不上屏');
    ok(!C.sideMatchesLid('zh-CN', 'th'), 'LID 说泰文 ⇒ 中文路不上屏');
    ok(!C.sideMatchesLid('zh-CN', ''), 'LID 还没判出来 ⇒ 不上屏（不是先画一路）');
    ok(!C.sideMatchesLid('', 'zh'));
    eq(C.lidBase('zh-CN'), 'zh'); eq(C.lidBase('TH'), 'th');
  });
  test('模型里半句与定稿两处闸都接了「稳定的 LID 判词」；旧的手写规则已退场', () => {
    eq((MODEL.match(/C\.sideMatchesLid\(ev && ev\.locale, lidStable\(\)\)/g) || []).length, 2, '半句与定稿各一道 LID 闸');
    ok(/const LID_SETTLE_MS = \d+/.test(MODEL), '判词要稳住才算数（难音频上 LID 会乱跳）');
    ok(/function lidStable\(\)/.test(MODEL), '没有 lidStable');
    ok(/NativeSpeech\.onLid\(/.test(MODEL), '没有订阅 LID 判词');
    ok(/NativeSpeech\.ensureLid\(/.test(MODEL), '没有把 LID 模型纳入下载');
    ok(/lidOn\(\);/.test(MODEL), '新会话没有重置 LID 语言');
    ok(!/partialEstablished/.test(MODEL), '手写的「定稿确立」启发式应已退场');
    ok(!/makeFinalArbiter|arbScore/.test(MODEL), '置信度仲裁应已退场');
  });
  test('旧的跨语言仲裁/半句择一已从 listen-core 退场（归属改由 LID 给）', () => {
    eq(typeof C.makeFinalArbiter, 'undefined');
    eq(typeof C.arbScore, 'undefined');
    eq(typeof C.pickPartial, 'undefined');
    eq(typeof C.lidBase, 'function');
    eq(typeof C.sideMatchesLid, 'function');
  });

  // 「播放进行中 + 同语言 ⇒ 丢」（2026-10-06，95/96 真机时序：回声总在 speak 后 ~500ms、播放进行中到达）。
  test('回声闸：playingLangs 报朗读进行中的语言；播完即空；没 spoke 也有兜底上限', () => {
    const g = C.makeEchoGuard();
    eq([...g.playingLangs(T0)].length, 0, '还没开口');
    g.speaking('ราคานี้รวมภาษีและค่าขนส่งแล้ว', T0, 'th-TH');
    ok(g.playingLangs(T0 + 500).has('th'), '朗读进行中该报 th（真机回声就在这段时间到）');
    ok(!g.playingLangs(T0 + 500).has('zh'), '没在读 zh');
    g.spoke(T0 + 2000);
    eq([...g.playingLangs(T0 + 2100)].length, 0, '播完就不该再算「进行中」');
    const g2 = C.makeEchoGuard();
    g2.speaking('สวัสดีครับ', T0, 'th');
    eq([...g2.playingLangs(T0 + 999999)].length, 0, '没收到 spoke 时的兜底上限');
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

// ── 实时字幕模式（learning-design §9.8，2026-09-14 实现第一步：纯逻辑）────────────────
describe('ListenCore — 实时字幕模式：模式表、单向归属、进复习的形状', () => {
  const ZH_EN = pair('zh', 'en');
  test('MODES：字幕单向、不朗读、不改边、静态门限、字幕档会话、独立采集开关', () => {
    const m = C.MODES.subtitle;
    deepEq([m.oneWay, m.autoSpeak, m.flip, m.staticGate, m.recognizers, m.profile, m.captureKey],
      [true, false, false, true, 1, 'subtitle', 'subtitleCapture']);
    const c = C.MODES.conv;
    deepEq([c.oneWay, c.autoSpeak, c.flip, c.staticGate, c.recognizers, c.profile, c.captureKey],
      [false, true, true, false, 2, 'conv', 'listenCapture']);
    eq(C.modeOf(C.newSession(T0, 0.5)).id, 'conv', '不传模式 = 对话，老调用不变');
    eq(C.modeOf(C.newSession(T0, 0.5, 'subtitle')).id, 'subtitle');
    eq(C.modeOf(C.newSession(T0, 0.5, 'bogus')).id, 'conv', '不认识的模式名退回对话');
  });
  test('字幕模式每句都归对方：外语句、母语句、识别器给了 me 都一样', () => {
    const s = C.newSession(T0, 0.5, 'subtitle');
    eq(C.addFinal(s, 'The quote includes freight.', T0 + 1000, ZH_EN, DEPS).who, 'them');
    const zh = C.addFinal(s, '这个报价含运费', T0 + 2000, ZH_EN, DEPS);
    eq(zh.who, 'them');
    eq(zh.guessed, false);
    eq(C.addFinal(s, 'Next one please', T0 + 3000, ZH_EN, { who: 'me' }).who, 'them', '单向：连识别器的 who 也不认');
  });
  test('进复习的形状：k:conv + mode:subtitle；对话的锚点逐字节不变（没有 mode 键）', () => {
    const cfg = { lang: 'en', otherLang: 'en', targetLang: 'zh', label: '实时字幕' };
    const s = C.newSession(T0, 0.5, 'subtitle');
    const r = C.addFinal(s, 'Lead time is forty-five days.', T0 + 5000, ZH_EN, DEPS);
    r.tr = '交期是四十五天。';
    const d = C.draftFor(r, s, cfg);
    eq(d.anchor.k, 'conv');
    eq(d.anchor.mode, 'subtitle');
    eq(d.anchor.who, 'them');
    eq(d.sourceId, 'conv:' + s.id);
    eq(d.text, 'Lead time is forty-five days.');
    eq(d.tr, '交期是四十五天。');
    eq(d.lang, 'en');
    const title = C.sourceFor(s, '实时字幕').title;
    ok(/^实时字幕 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(title), title);
    const cs = C.newSession(T0, 0.5);
    const cr = C.addFinal(cs, 'Lead time is forty-five days.', T0 + 5000, ZH_EN, DEPS);
    cr.tr = '交期是四十五天。';
    ok(!('mode' in C.draftFor(cr, cs, cfg).anchor), '对话的锚点不能多出 mode 键');
  });
  test('采集开关：字幕进复习关着不写；星绕过；这次不留记录连星也挡', () => {
    const s = C.newSession(T0, 0.5, 'subtitle');
    const r = C.addFinal(s, 'Hello there', T0, ZH_EN, DEPS);
    r.tr = '你好';
    eq(C.shouldWrite(r, s, { captureOn: false, lang: 'en' }), false);
    r.starred = true;
    eq(C.shouldWrite(r, s, { captureOn: false, lang: 'en' }), true);
    s.ephemeral = true;
    eq(C.shouldWrite(r, s, { captureOn: true, lang: 'en' }), false);
  });
});

describe('ListenCore — 字幕模式的静态静音门', () => {
  const feed = (s, rms, from, blocks) => {
    let hit = false;
    for (let i = 0; i < blocks; i++) hit = C.silenceCheck(s, rms, from + i * 100) || hit;
    return hit;
  };
  test('★ 持续配乐不抬门限、不判静音（自适应那套会把音乐当环境噪声抬门限）', () => {
    const s = C.newSession(T0, 0.5, 'subtitle');
    ok(!feed(s, 0.02, T0, 600), '60 秒配乐不该判静音');
    eq(s.noiseFloor, null, '字幕模式不摸底噪');
    eq(C.noiseGate(s), C.SILENCE_RMS);
  });
  test('30 秒低于固定下限才算静音；计时从最后一次有声算起', () => {
    const s = C.newSession(T0, 0.5, 'subtitle');
    feed(s, 0.05, T0, 50);                               // 有声到 T0+4900
    ok(!feed(s, 0.001, T0 + 5000, 290), '29 秒还不算');
    ok(feed(s, 0.001, T0 + 34000, 20), '过了 30 秒算静音');
  });
});

describe('ListenCore — 实时字幕入口判定与声音来源', () => {
  test('入口原因按顺序：老壳隐藏 → 本机识别器不可用（系统 / 语言）→ Mac 系统声音版本（2026-09-17：没有 no-live / no-key）', () => {
    const OK = { sources: ['mic', 'system'], system: 'ok' };
    eq(C.entryGate({ caps: null, deviceOk: true }), 'hidden', '老原生壳没回 audio-caps：整行不显示');
    eq(C.entryGate({ caps: OK, deviceOk: false }), 'device-os', '本机识别器不可用 ⇒ 系统太旧那句');
    eq(C.entryGate({ caps: OK, deviceOk: false, deviceReason: 'os' }), 'device-os');
    eq(C.entryGate({ caps: OK, deviceOk: false, deviceReason: 'locale' }), 'locale', '语言不支持是另一句');
    eq(C.entryGate({ caps: { system: 'os' }, deviceOk: false }), 'device-os', '本机不可用先说本机');
    eq(C.entryGate({ caps: { system: 'os' }, deviceOk: true }), 'os', '本机可用再判 Mac 系统声音版本');
    eq(C.entryGate({ caps: OK, deviceOk: true }), '');
    eq(C.entryGate({ caps: { system: 'unsupported' }, deviceOk: true }), '', 'iOS 没有系统声音也可用（麦克风听外放）');
    for (const k of ['liveOk', 'keyOk']) ok(!/no-live|no-key/.test(C.entryGate({ caps: OK, deviceOk: true, [k]: false })), k + ' 不再是判据');
  });
  test('★ 没收到 system:ok 绝不给 system（老壳会无视 source、静默开麦克风）', () => {
    eq(C.captureSource({ system: 'ok' }), 'system');
    eq(C.captureSource({ system: 'unsupported' }), 'mic');
    eq(C.captureSource({ system: 'os' }), null);
    eq(C.captureSource(null), null);
    eq(C.captureSource({}), null);
  });
});

describe('ListenCore — 实时字幕条字号三档（§9.8 协议补充决定 9）', () => {
  test('A− / A+ 在 0.85 / 1 / 1.2 之间走，走到头不动；不在档上的值先就近落档', () => {
    eq(C.fontStep(1, 1), 1.2);
    eq(C.fontStep(1.2, 1), 1.2, '最大档再 A+ 不动');
    eq(C.fontStep(1, -1), 0.85);
    eq(C.fontStep(0.85, -1), 0.85, '最小档再 A− 不动');
    eq(C.fontStep(undefined, 1), 1.2, '没存过 = 1');
    eq(C.fontStep(3, -1), 1, '手改成 3 ⇒ 落到 1.2 再往下一档');
    deepEq(C.FONT_STEPS, [0.85, 1, 1.2]);
  });
});

describe('SourcesView — 实时字幕句子在来源页单独成组（§9.8）', () => {
  // PR7b：源从 extension/learn/sources-view.js（IIFE，模块求值期读 MT_PALETTE 拼样式，
  // 所以要先垫）换到 src/shared/sources-view.js —— 纯逻辑层不再读调色板，垫片随之退役。
  const SV = loadSrc('src/shared/sources-view.js', 'SourcesView').SourcesView;
  test('conv:// 来源按卡上的 anchor.mode 分成「对话」与「实时字幕」两组，互不串', () => {
    const sources = [{ id: 'conv:a', url: 'conv://a', title: '对话 · 1' }, { id: 'conv:b', url: 'conv://b', title: '实时字幕 · 2' }];
    const items = [
      { id: 'i1', sourceId: 'conv:a', anchor: { k: 'conv', who: 'them' } },
      { id: 'i2', sourceId: 'conv:b', anchor: { k: 'conv', mode: 'subtitle', who: 'them' } },
      { id: 'i3', sourceId: 'conv:b', anchor: { k: 'conv', mode: 'subtitle', who: 'them' } },
    ];
    deepEq(SV.groupConversations(items, sources).map((g) => [g.sourceId, g.count]), [['conv:a', 1]], '缺省（对话）不收字幕句');
    deepEq(SV.groupConversations(items, sources, 'subtitle').map((g) => [g.sourceId, g.count]), [['conv:b', 2]]);
  });
});
