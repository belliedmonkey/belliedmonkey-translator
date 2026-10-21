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
  test('S1：标点开头的定稿 + partial 带句首 ⇒ 合并同一行入账（不单 feed 句首）', async () => {
    const partial = 'Please make three copies of this contract and send them to my office';
    const final = ', and send them to my office';
    const cut = C.rescueLeadCut(final, partial);
    ok(cut && cut.lead, '应对齐 partial 句首：' + JSON.stringify(cut));
    const merged = C.mergeRescueLead(cut.lead, cut.text);
    ok(/please make three copies/i.test(merged) && /send them to my office/i.test(merged), '合并后缺句首或正文：' + merged);
    const rows = [];
    let feedN = 0;
    const seg = C.makeSegmentRouter({
      call: (p) => {
        const m = String(p).match(/BUF:\n([\s\S]*?)\nFORCE:/);
        return Promise.resolve(JSON.stringify({ segments: [{ source: m ? m[1].trim() : '', translation: 'T' }], remainder: '' }));
      },
      emit: (list) => { for (const r of list) rows.push(r.source); },
      fallback: (t) => rows.push(t),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      idleMs: 1500, endWaitMs: 3000,
    });
    const gate = C.makeFinalGate({ dominantScript: () => 'Latin', now: () => Date.now(), idleMs: 1500 });
    const origFeed = seg.feed.bind(seg);
    seg.feed = (...args) => { feedN++; return origFeed(...args); };
    const texts = gate.push({ locale: 'en-US', text: merged, conf: 0.9, t0: 1000, t1: 4000 });
    ok(texts.length >= 1, '定稿应当放行：' + JSON.stringify(texts));
    for (const tt of texts) seg.feed('en-US', tt);
    await seg.settle('end');
    eq(feedN, texts.length, '句首与定稿应只 feed 一次（合并后）：feedN=' + feedN);
    eq(rows.length, 1, '只许一行：' + JSON.stringify(rows));
    ok(/please make three copies/i.test(rows[0]) && /send them to my office/i.test(rows[0]), '全句内容齐全：' + JSON.stringify(rows));
    ok((rows[0].match(/please make three copies/gi) || []).length <= 1, '句首不应重复：' + JSON.stringify(rows));
    seg.dispose();
    ok(/rescueLeadCut/.test(MODEL), '入口应调用 rescueLeadCut');
    ok(!/seg\.feed\(ev\.locale,\s*lead/.test(MODEL), '入口不应先 feed 句首');
    ok(/mergeRescueLead/.test(MODEL), '入口应 mergeRescueLead 再入账');
    ok(/function partialWorthRescue/.test(MODEL), 'partialWorthRescue 不该一起删');
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
  // 电平按 10 Hz 连续喂（原生的节奏）；返回第一次判停的时刻，没停返回 0。
  const feed = (s, rms, from, to) => { for (let t = from; t <= to; t += 100) if (C.silenceCheck(s, rms, t)) return t; return 0; };
  test('字幕：一次声音都没听到过时 30 秒不停，等到 FIRST_SOUND_MS', () => {
    const s = C.newSession(0, 0, 'subtitle');
    eq(feed(s, 0, 0, C.SILENCE_MS + 1000), 0, '还没听到过声音就在 30 秒停了');
    ok(feed(s, 0, C.SILENCE_MS + 1100, C.FIRST_SOUND_MS + 1000) >= C.FIRST_SOUND_MS);
  });
  test('字幕：听到过声音之后照旧 30 秒停', () => {
    const s = C.newSession(0, 0, 'subtitle');
    feed(s, 0.05, 0, 1000);
    const at = feed(s, 0, 1100, 1000 + C.SILENCE_MS + 1000);
    ok(at >= 1000 + C.SILENCE_MS && at <= 1000 + C.SILENCE_MS + 200, '该在最后一次有声后 30 秒停，实际 ' + at);
  });
  test('字幕：链路没声音时不发帧 —— 断档不算静音，静很久之后的第一帧不当场判停', () => {
    const s = C.newSession(0, 0, 'subtitle');
    C.resume(s, 0);
    // 18 分钟一帧都没有，然后声音刚起头的第一帧还没过门限
    eq(C.silenceCheck(s, 0.0005, 18 * 60000), false, '第一帧就判停了');
    eq(feed(s, 0.05, 18 * 60000 + 100, 18 * 60000 + 5000), 0);
    // 中途断档（比如视频暂停、系统不出声）也不计入
    const t1 = 18 * 60000 + 5100;
    feed(s, 0, t1, t1 + 10000);
    eq(C.silenceCheck(s, 0, t1 + 10000 + 5 * 60000), false, '断档 5 分钟后的第一帧被当成静了 5 分钟');
    ok(feed(s, 0, t1 + 10000 + 5 * 60000 + 100, t1 + 10000 + 5 * 60000 + 30000) > 0, '断档前后累计的静音满 30 秒该停');
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
    ok(/function grantHalted\(\)/.test(MODEL) && /if \(grantHalted\(\)\)/.test(MODEL), '已经停机之后 passRow 仍会再请求');
    ok(/onQuota: \(err\)/.test(MODEL) && /quotaHalt\(e\)/.test(MODEL), '断句路的额度错误没有交给停机');
    ok(/TranslationCore\.haltMessage\(grantCode\)/.test(MODEL), '停机提示没用 TranslationCore.haltMessage');
    ok(/'sec-engines' : 'grant-card'/.test(MODEL), '停机提示没有去设置页的出口');
    ok(/state == "grant"/.test(BAR), '悬浮条没有 grant 态的出口');
  });
  test('B：字幕下完包接着听（不落进 idle 被画成「已暂停」）', () => {
    ok(/!== beforeGen && session\.mode !== 'subtitle'\)/.test(MODEL));
  });
  test('「自动」不当成一门语言：归属 / 断句 prompt / 包与名额都用 videoBase()（= 开识别器的那个候选）', () => {
    ok(/function videoBase\(\) \{[\s\S]{0,120}=== 'auto' \? \(subGuess \|\| 'en'\)/.test(MODEL), 'videoBase 该把 auto 解成 subGuess || en');
    ok(/if \(!lidLang \|\| !cfg\) return '';\s*const a = videoBase\(\)/.test(MODEL), 'lidPair 该用 videoBase —— 否则「自动」下 LID 判出的语言永远算「第三门」，一句都不进');
    ok(/langs: cfg \? \[videoBase\(\), C\.baseCode\(cfg\.otherLang\)\]/.test(MODEL), 'LID（ECAPA 只比这两门）拿到字面的 auto 就永远判不出来');
    ok(/srcLang = sub \? \(base \|\| videoBase\(\)\)/.test(MODEL) && /dstLang = sub \? cfg\.otherLang/.test(MODEL), '字幕断句 prompt：源 = 识别器那门，目标 = 译成');
  });
  test('字幕的半句译文译成「译成」那门（不是视频语言）', () => {
    ok(/\(C\.modeOf\(session\)\.oneWay \|\| C\.sideOf\(text, cfg, routeDeps\) === 'me'\) \? cfg\.otherLang : cfg\.myLang/.test(MODEL));
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
  test('iOS 5：字幕暂停不拆音频会话；媒体遥控在字幕这场不暂停', () => {
    ok(/session\.mode === 'subtitle' \? \{ hold: true \} : undefined/.test(MODEL), '字幕暂停要带 hold');
    ok(/if \(recordProfile === 'subtitle'\) return/.test(read('app/native-audio.js')), '媒体会话的暂停不能停字幕');
  });
  test('H：字幕那一调的截止宽于中继最长耗时', () => {
    const m = MODEL.match(/const SUB_PASS_TIMEOUT_MS = (\d+)/);
    ok(m && Number(m[1]) > 20000, '截止没有放宽');
    ok(/timeoutMs: SUB_PASS_TIMEOUT_MS/.test(MODEL), '断句调用仍用 12 s 截止');
    ok(/err\.code === 'timeout'/.test(strip(read('app/listen-core.js'))), '超时没有单独处理');
  });
  test('H：断句调用超时后原文照出，不再自动重送', async () => {
    let t = 1e6; const timers = new Map(); let seq = 1;
    const clk = {
      now: () => t,
      setT: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: t + (ms || 0) }); return id; },
      clearT: (id) => { timers.delete(id); },
      async advance(ms) {
        const end = t + ms;
        const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
        for (;;) {
          let n = null;
          for (const [id, x] of timers) if (x.at <= end && (!n || x.at < n.x.at)) n = { id, x };
          if (!n) break;
          timers.delete(n.id); t = Math.max(t, n.x.at); n.x.fn();
          await drain();
        }
        t = end; await drain();
      },
    };
    const calls = []; const ev = [];
    const text = '第三条约定卖方应在四十五天内完成交货并开立信用证见票即付完毕';
    const r = C.makeSegmentRouter({
      call: (p) => { calls.push(p); return Promise.reject(Object.assign(new Error('aborted'), { code: 'timeout' })); },
      emit: (rows, meta) => ev.push({ rows, orig: meta.orig }),
      fallback: (s) => ev.push({ fallback: s }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    });
    r.feed('zh-CN', text);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await clk.advance(20000);
    eq(calls.length, 1, '超时后又自动送了一次：' + calls.length);
    eq(ev.length, 1, '没有把原文出行');
    eq(ev[0].fallback, undefined, '超时走了旧路，等于再翻译一次');
    eq(ev[0].rows[0].translation, '', '译文不该有内容');
    ok(String(ev[0].rows[0].source).indexOf('第三条约定') >= 0, '原文没出门');
    eq(r.state().fails.timeout, 1, '超时没记成 timeout');
    eq(r.state().fails.network || 0, 0, '超时被记成 network');
    r.dispose();
  });
  test('K：402 与额度错误停机，原文照出，不再交旧路', async () => {
    const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((res) => setTimeout(res, 0)); };
    const zh = '帮我把这份合同复印三份';
    const en = 'Please make three copies';
    async function run(err, label) {
      const calls = []; const ev = [];
      const r = C.makeSegmentRouter({
        call: (p) => { calls.push(p); return Promise.reject(err); },
        emit: (rows, meta) => ev.push({ t: 'emit', rows, orig: meta.orig }),
        fallback: (s) => ev.push({ t: 'fallback', text: s }),
        onQuota: (e) => ev.push({ t: 'quota', code: e && e.code, grant: !!(e && e.grant) }),
        onDegrade: (why) => ev.push({ t: 'degrade', why }),
        ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      });
      r.feed('zh-CN', zh);
      r.feed('en-US', en);
      r.settle('switch');
      await tick();
      eq(calls.length, 1, label + '：又请求了 ' + calls.length + ' 次');
      eq(ev.filter((e) => e.t === 'fallback').length, 0, label + '：走了旧路');
      eq(ev.filter((e) => e.t === 'degrade').length, 0, label + '：走了降级');
      const shown = ev.filter((e) => e.t === 'emit').map((e) => e.orig).join('');
      eq(shown, zh + en, label + '：原文没出门：' + shown);
      ok(ev.filter((e) => e.t === 'emit').every((e) => e.rows.every((row) => row.translation === '')), label + '：译文不该有内容');
      const q = ev.filter((e) => e.t === 'quota');
      eq(q.length, 1, label + '：停机信号次数 ' + q.length);
      eq(q[0].code, 'credit_exhausted', label + '：停机码是 ' + q[0].code);
      ok(q[0].grant, label + '：没有 grant 标记');
      r.feed('zh-CN', '后面又来了一句');
      await tick();
      eq(calls.length, 1, label + '：停机之后又请求了');
      ok(ev.some((e) => e.t === 'emit' && String(e.orig).indexOf('后面又来了一句') >= 0), label + '：后到的原文被丢掉了');
      eq(r.pending('zh-CN') + r.pending('en-US'), '', label + '：账本没清空');
      r.dispose();
      eq(ev.filter((e) => e.t === 'leak').length, 0, label + '：有泄漏');
    }
    const tagged = Object.assign(new Error('402'), { status: 402, grant: true, code: 'credit_exhausted' });
    await run(tagged, '具名 402');
    const bare = new Error('402'); bare.status = 402;
    await run(bare, '裸 402');
  });
});

describe('#592 · 硬上限不再作废在飞批次', () => {
  const bufOf = (p) => String((p && p.user) || '').split('BUF:\n')[1].split('\nFORCE:')[0].trim();
  const words = (n, mark) => Array.from({ length: n }, (_, i) => mark + i).join(' ');
  const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
  function router(call) {
    const ev = [];
    const r = C.makeSegmentRouter({
      call,
      emit: (rows, meta) => ev.push({ t: 'emit', rows, orig: meta && meta.orig }),
      fallback: (text) => ev.push({ t: 'fallback', text }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    });
    return { r, ev };
  }
  test('在飞批次 + 新字超过 SEG_HARD：不作废、不走 hardCutSentences，回包后照常出行', async () => {
    const first = words(20, 'a');
    const more = words(25, 'b');
    eq(C.segCounts(first).words, 20, '第一批不到硬上限');
    ok(C.segCounts(first + ' ' + more).words >= C.SEG_HARD.words, '加在一起过了硬上限');
    let release;
    const gate = new Promise((res) => { release = res; });
    const calls = [];
    const { r, ev } = router((p) => {
      const buf = bufOf(p);
      calls.push(buf);
      const answer = JSON.stringify({ segments: [{ source: buf, translation: 'T' }], remainder: '' });
      return calls.length === 1 ? gate.then(() => answer) : Promise.resolve(answer);
    });
    r.feed('en-US', first);
    await tick();
    eq(calls.length, 1, '到软上限送出第一批，实际 ' + calls.length);
    r.feed('en-US', more);
    await tick();
    eq(calls.length, 1, '新字过硬上限又送了一批：' + calls.length);
    eq(ev.filter((e) => e.t === 'fallback').length, 0, '在飞期间走了旧路');
    ok(r.state().busy, '在飞批次被作废了');
    ok(r.state().maxWait.words >= 25, '新字没留在 wait：' + r.state().maxWait.words);
    release();
    await tick();
    ok(ev.some((e) => e.t === 'emit' && String(e.orig).indexOf('a0') >= 0), '第一批回包没有出行');
    eq(ev.filter((e) => e.t === 'fallback').length, 0, '回包后走了旧路');
    ok(calls.length >= 2, '尾巴没有再送模型');
    ok(calls[1].indexOf('b0') >= 0 && calls[1].indexOf('a0') < 0, '第二批混进了已经送出的字：' + calls[1]);
    r.dispose();
  });
  test('wait 自己超过硬上限时只送前缀；没有句末标点就整段仍送模型', async () => {
    const head = words(15, 'h') + '.';
    const tail = words(30, 't') + '.';
    const all = head + ' ' + tail;
    ok(C.segCounts(all).words >= C.SEG_HARD.words, '整段过了硬上限');
    const calls = [];
    let release;
    const gate = new Promise((res) => { release = res; });
    const { r, ev } = router((p) => {
      const buf = bufOf(p);
      calls.push(buf);
      const answer = JSON.stringify({ segments: [{ source: buf, translation: 'T' }], remainder: '' });
      return calls.length === 1 ? gate.then(() => answer) : Promise.resolve(answer);
    });
    r.feed('en-US', all);
    await tick();
    eq(calls.length, 1, '第一批没有发出');
    ok(calls[0].indexOf('h14') >= 0 && calls[0].indexOf('t0') < 0, '第一批不是前缀：' + calls[0]);
    eq(ev.filter((e) => e.t === 'fallback').length, 0, '超长 wait 走了旧路');
    ok(String(r.pending('en-US')).indexOf('t0') >= 0, '尾巴没留在账本');
    release();
    await tick();
    ok(calls.length >= 2 && calls[1].indexOf('t0') >= 0, '尾巴没有再送模型');
    eq(ev.filter((e) => e.t === 'fallback').length, 0, '尾巴出行前走了旧路');
    const blob = words(45, 'z');
    ok(C.segCounts(blob).words >= C.SEG_HARD.words, '无标点段过了硬上限');
    const calls2 = [];
    const b = router((p) => { calls2.push(bufOf(p)); return new Promise(() => {}); });
    b.r.feed('en-US', blob);
    await tick();
    eq(calls2.length, 1, '无标点段没有整段送模型');
    ok(calls2[0].indexOf('z0') >= 0 && calls2[0].indexOf('z44') >= 0, '无标点段被切开了');
    eq(b.ev.filter((e) => e.t === 'fallback').length, 0, '无标点段走了旧路');
    r.dispose(); b.r.dispose();
  });
  test('超时仍原文照出译文留空；empty-reply 与 fail-max 仍走旧路', async () => {
    const slow = words(20, 's');
    const tmo = router((p) => Promise.reject(Object.assign(new Error('aborted'), { code: 'timeout' })));
    tmo.r.feed('en-US', slow);
    await tick();
    eq(tmo.ev.filter((e) => e.t === 'fallback').length, 0, '超时走了旧路，等于再翻译一次');
    const shown = tmo.ev.filter((e) => e.t === 'emit');
    eq(shown.length, 1, '超时没有把原文出行');
    eq(shown[0].rows[0].translation, '', '超时译文不该有内容');
    ok(String(shown[0].rows[0].source).indexOf('s0') >= 0, '超时原文没出门');
    tmo.r.dispose();

    let n = 0;
    const empty = router(() => { n++; return JSON.stringify({ segments: [], remainder: '' }); });
    empty.r.feed('en-US', words(20, 'e'));
    await tick(); await tick();
    ok(n >= 2, '空回复没有补调，实际 ' + n);
    ok(empty.ev.some((e) => e.t === 'fallback'), '空回复用完补调仍走了模型路');
    eq(empty.r.pending('en-US'), '', '空回复硬切后账本还有字');
    empty.r.dispose();

    const fail = router(() => Promise.reject(new Error('net')));
    fail.r.feed('en-US', 'Good morning. See you tomorrow.');
    fail.r.settle('stop'); await tick();
    fail.r.settle('stop'); await tick();
    ok(fail.ev.some((e) => e.t === 'fallback'), '连续两次失败没有交旧路');
    eq(fail.r.pending('en-US'), '', 'fail-max 之后账本还有字');
    fail.r.dispose();
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
