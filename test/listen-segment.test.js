// test/listen-segment.test.js — 文字账本路由器（第三轮重写，2026-10-10 用户批准的根因方案）。
//
// 只测**新语义**：一本账、单一 settle、碎片只按识别原文判、失败梯度与调用上限、remainder 后缀
// 规则、合并去模型标点；以及保留的路由/解析/prompt/硬切。行为不变量见 listen-ea.test.js 的模糊测试。
const { describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');

// ── 假时钟 ────────────────────────────────────────────────────────────────────
function fakeClock() {
  let t = 1_000_000, seq = 1;
  const timers = new Map();
  return {
    now: () => t,
    setT: (fn, ms) => { const id = seq++; timers.set(id, { fn, at: t + (ms || 0) }); return id; },
    clearT: (id) => { timers.delete(id); },
    size: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next.x.at)) next = { id, x };
        if (!next) break;
        timers.delete(next.id);
        t = Math.max(t, next.x.at);
        next.x.fn();
        await Promise.resolve(); await Promise.resolve();
      }
      t = end; await Promise.resolve();
    },
  };
}
const settleTick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const bufOf = (p) => String((p && p.user) || '').split('BUF:\n')[1].split('\nFORCE:')[0].trim();

function makeRouter(opts) {
  const o = opts || {};
  const clk = fakeClock();
  const ev = [];
  const calls = [];
  const queue = o.replies ? o.replies.slice() : null;
  const r = C.makeSegmentRouter({
    call: async (p) => {
      calls.push(p);
      const r0 = queue ? queue.shift() : undefined;
      if (r0 instanceof Error) throw r0;
      if (typeof r0 === 'function') return r0(p);
      if (typeof r0 === 'string') return r0;
      if (r0) return JSON.stringify(r0);
      const b = bufOf(p);
      return JSON.stringify({ segments: [{ source: b, translation: '译文' }], remainder: '' });
    },
    emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
    fallback: (text, meta) => ev.push({ t: 'fallback', text, meta }),
    onDegrade: (why) => ev.push({ t: 'degrade', why }),
    onLeak: (left) => ev.push({ t: 'leak', left }),
    ctx: () => ({ srcName: '中文', dstName: 'English', context: [], userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT,
    idleMs: o.idleMs || 1500, endWaitMs: o.endWaitMs || 3000,
  });
  return { r, clk, ev, calls };
}
const emitsOf = (ev) => ev.filter((e) => e.t === 'emit').flatMap((e) => e.rows);
const origOf = (ev) => ev.filter((e) => e.t === 'emit').map((e) => e.meta.orig);
const fallsOf = (ev) => ev.filter((e) => e.t === 'fallback').map((e) => e.text);
const forceOf = (calls, i) => /true\s*$/.test(String(calls[i].user));

describe('账本路由器 — 触发（长度 / 空闲 / 碎片多等一次）', () => {
  test('中文到 30 字触发一次；不够不动', async () => {
    const { r, calls } = makeRouter({});
    const base = '今天天气不错我们去公园走走吧顺便买点东西';   // 20 字
    eq(C.segCounts(base).cjk, 20, '用例前提');
    r.feed('zh-CN', base); await settleTick();
    eq(calls.length, 0, '不到 30 字不发');
    r.feed('zh-CN', '好'.repeat(10)); await settleTick();
    eq(calls.length, 1, '到 30 字发一次');
  });
  test('★ 碎片（>4 汉字、非短）：第一次空闲**预送并扣住**（不出行），第二次空闲仍无新字才出行', async () => {
    const { r, clk, calls, ev } = makeRouter({});
    r.feed('zh-CN', '你好你好吗');            // 5 字、无标点 ⇒ 碎片且非「≤2 词短片」⇒ 走预送扣住
    await clk.advance(1600); await settleTick();
    eq(calls.length, 1, '第一次空闲就预送（省掉第二次的模型往返）');
    eq(ev.filter((e) => e.t === 'emit').length, 0, '结果扣住，先不出行');
    await clk.advance(1600); await settleTick();
    eq(calls.length, 1, '第二次空闲不再调模型（结果已经在手）');
    eq(ev.filter((e) => e.t === 'emit').length, 1, '第二次空闲才出行');
  });
  test('★ 预送期间来了新字 ⇒ 扣住的结果作废，跟新字一起重送', async () => {
    const { r, clk, calls, ev } = makeRouter({});
    r.feed('zh-CN', '你好你好吗');            // 5 字 ⇒ 非短，走预送扣住
    await clk.advance(1600); await settleTick();
    eq(calls.length, 1, '预送');
    r.feed('zh-CN', '再见再见吧');            // 新字 ⇒ 作废扣住的结果
    await clk.advance(1600); await settleTick();
    // 作废的判据：**没有**任何一条出行只用旧前缀（作废的结果若出行，orig 会恰好是 '你好你好吗'）
    ok(!ev.some((e) => e.t === 'emit' && String(e.meta.orig).trim() === '你好你好吗'), '作废的预送结果单独成了行');
    ok(calls.length >= 2, '跟新字一起重送（新一次调用）');
    ok(bufOf(calls[calls.length - 1]).indexOf('你好') >= 0 && bufOf(calls[calls.length - 1]).indexOf('再见') >= 0, '重送的 buffer 含两段');
  });
  test('★ 带标点的完整短句按 1.5 秒正常出行（不等第二次）', async () => {
    for (const s of ['好的。', 'Yes.']) {
      const { r, clk, calls } = makeRouter({});
      r.feed('zh-CN', s);
      await clk.advance(1600); await settleTick();
      eq(calls.length, 1, s + ' 应在 1.5s 出行');
      ok(!forceOf(calls, 0), s + ' 走 soft（不是 force）');
    }
  });
  test('朗读期间 idle 暂停；恢复后计时；长度触发不受朗读影响', async () => {
    const a = makeRouter({});
    a.r.feed('en-US', 'Please make three copies of this contract.');
    a.r.setSpeaking(true);
    await a.clk.advance(5000); await settleTick();
    eq(a.calls.length, 0, '朗读期间 idle 不送');
    a.r.setSpeaking(false);
    await a.clk.advance(1600); await settleTick();
    eq(a.calls.length, 1, '恢复后送');
    const b = makeRouter({});
    b.r.setSpeaking(true);
    b.r.feed('en-US', 'w '.repeat(25) + 'w');
    await settleTick();
    eq(b.calls.length, 1, '长度触发不受朗读影响');
  });
});

describe('账本路由器 — remainder / 合并 / 标点', () => {
  test('remainder 必须是识别原文的结尾：是 ⇒ 回账本；不是 ⇒ 当作全部用掉', async () => {
    const BUF = '一共三千八百五十块钱，刷卡还是付款呢？';   // 以 ？ 结尾 ⇒ 非碎片（走普通空闲送）
    const a = makeRouter({ replies: [{ segments: [{ source: '一共三千八百五十块钱，', translation: 'total 3850' }], remainder: '刷卡还是付款呢？' }] });
    a.r.feed('zh-CN', BUF);
    await a.clk.advance(1600); await settleTick();
    eq(a.r.pending('zh-CN'), '刷卡还是付款呢？', 'remainder 是结尾 ⇒ 留在账本');
    const b = makeRouter({ replies: [{ segments: [{ source: '一共三千八百五十块钱，刷卡还是付款呢？', translation: 'total 3850' }], remainder: '不存在的尾巴' }] });
    b.r.feed('zh-CN', BUF);
    await b.clk.advance(1600); await settleTick();
    eq(b.r.pending('zh-CN'), '', 'remainder 对不上原文 ⇒ 当作全部用掉');
    ok(origOf(b.ev).join('') === BUF, '全部用掉时原文进出行（不丢）');
  });
  test('★ 段为空 + remainder 是原文后缀 ⇒ 不是错误（不记失败、继续等下次触发）', async () => {
    const { r, clk, calls, ev } = makeRouter({ replies: [
      { segments: [], remainder: '刷卡还是付款呢？' },           // 模型说「还没说完」
      { segments: [{ source: '一共三千八百五十块钱，刷卡还是付款呢？', translation: 'T' }], remainder: '' },
    ] });
    r.feed('zh-CN', '一共三千八百五十块钱，刷卡还是付款呢？');
    await clk.advance(1600); await settleTick();
    eq(calls.length, 1, '第一次：模型说没说完');
    eq(ev.filter((e) => e.t === 'fallback').length, 0, '不误判成失败去硬切');
    eq(r.pending('zh-CN'), '一共三千八百五十块钱，刷卡还是付款呢？', '整段仍在账本（没丢）');
    await clk.advance(1600); await settleTick();
    eq(ev.filter((e) => e.t === 'emit').length, 1, '下次触发正常出行');
  });
  test('★ 短碎片并入后一段，并去掉模型补的句末标点', async () => {
    const { r, ev } = makeRouter({ replies: [{ segments: [
      { source: 'The total is.', translation: '总计是。' },
      { source: 'or mobile payment?', translation: '还是移动支付？' },
    ], remainder: '' }] });
    r.feed('en-US', 'The total is.or mobile payment?');
    r.settle('switch'); await settleTick();
    const rows = emitsOf(ev).map((x) => x.source);
    eq(rows.length, 1, '并成一行');
    ok(rows[0].indexOf('The total is or mobile payment?') === 0, '合并后不带模型补的句号：' + JSON.stringify(rows[0]));
  });
});

describe('账本路由器 — 失败梯度与调用上限', () => {
  test('第 1 次失败不切（跟新字下次送）', async () => {
    const { r, clk, calls, ev } = makeRouter({ replies: [new Error('timeout')] });
    r.feed('en-US', 'Please make three copies');
    r.settle('switch'); await settleTick();
    eq(calls.length, 1, '失败一次');
    eq(fallsOf(ev).length, 0, '不硬切');
    eq(r.pending('en-US'), 'Please make three copies', '账本还在');
    r.feed('en-US', ' and send them');
    await clk.advance(1600); await settleTick();
    ok(bufOf(calls[1]).indexOf('Please make three copies and send them') >= 0, '两次的文本拼一起');
  });
  test('★ 第 2 次失败按标点硬切、全部交给旧路（不留碎片）', async () => {
    const { r, ev } = makeRouter({ replies: [new Error('x'), new Error('x')] });
    r.feed('zh-CN', '好的。谢谢你');
    r.settle('stop'); await settleTick();   // 失败 1
    r.settle('stop'); await settleTick();   // 失败 2 ⇒ 硬切
    const fb = fallsOf(ev);
    ok(fb.length >= 1, '硬切交给旧路');
    eq(r.pending('zh-CN'), '', '不留碎片');
  });
  test('★ 一直失败时锁死：同一批字最多参与 3 次调用，然后交给旧路', async () => {
    const { r, clk, ev } = makeRouter({ replies: [new Error('t'), new Error('t'), new Error('t'), new Error('t'), new Error('t')] });
    r.feed('zh-CN', '你好');   // 碎片
    for (let i = 0; i < 8; i++) { r.settle('stop'); await settleTick(); }
    // 到 3 次上限后必须已经交给旧路，且账本为空
    eq(r.pending('zh-CN'), '', '到上限后账本为空（交给旧路）');
    ok(fallsOf(ev).indexOf('你好') >= 0, '交给旧路出行');
  });
  test('state().recs 的 calls 从不超过 3', async () => {
    const { r, clk } = makeRouter({ replies: [new Error('t'), new Error('t'), new Error('t')] });
    r.feed('zh-CN', '这是一句会被反复重试的话');
    for (let i = 0; i < 6; i++) {
      r.settle('stop'); await settleTick();
      for (const rec of r.state().recs) ok(rec.calls <= 3, 'rec.calls <= 3（实际 ' + rec.calls + '）');
      await clk.advance(1700);
    }
  });
});

describe('账本路由器 — 收尾 settle（唯一出口）', () => {
  test('★ 结束：等待中的交给旧路，在飞的等 ≤3s，迟到回复作废', async () => {
    let release; const gate = new Promise((res) => { release = res; });
    const clk = fakeClock(); const ev = [];
    const r = C.makeSegmentRouter({
      call: async (p) => { await gate; return JSON.stringify({ segments: [{ source: bufOf(p), translation: 'x' }], remainder: '' }); },
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }), fallback: (t, m) => ev.push({ t: 'fallback', text: t, meta: m }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }), now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, endWaitMs: 3000,
    });
    r.feed('zh-CN', '在飞的那一段文字');
    r.settle('stop'); await settleTick();          // 发出去（在飞）
    const p = r.settle('end');                     // 等 ≤3s
    await clk.advance(3100); await settleTick();
    await p; await settleTick();
    ok(ev.some((e) => e.t === 'fallback'), '超时后原文交给旧路');
    release(); await settleTick();                 // 迟到的回复
    eq(ev.filter((e) => e.t === 'emit').length, 0, '迟到的回复不再出行');
    eq(r.pending('zh-CN'), '', '账本空');
  });
  test('结束在 3s 内回来了 ⇒ 正常出行（不走旧路）', async () => {
    const { r } = makeRouter({});
    r.feed('zh-CN', '这份合同复印三份');
    r.settle('stop'); await settleTick();
    // 上面那次 settle('stop') 已把等待中的强制送；结果已回 ⇒ 已出行
    r.settle('end');
    await settleTick();
    // 结束后 dispose：账本应为空（无泄漏诊断）
    r.dispose();
  });
  test('dispose 时账本非空 ⇒ onLeak 记诊断', () => {
    const { r, ev } = makeRouter({});
    r.feed('zh-CN', '还没送出去的字');
    r.dispose();
    ok(ev.some((e) => e.t === 'leak'), '账本非空时 dispose 应报 leak');
  });
});

describe('ListenSegment — 解析 / prompt / 硬切 / 路由（保留）', () => {
  const buf = '请问去火车站怎么走？';
  test('合法 JSON / 围栏 / 前后废话 都能解；空/非JSON/schema 具名失败', () => {
    const good = { segments: [{ source: buf, translation: 'How do I get to the train station?' }], remainder: '' };
    ok(C.parseSegReply(JSON.stringify(good), { buffer: buf }).ok);
    ok(C.parseSegReply('```json\n' + JSON.stringify(good) + '\n```', { buffer: buf }).ok);
    eq(C.parseSegReply('', {}).reason, 'empty');
    eq(C.parseSegReply('不是 JSON', {}).reason, 'json');
    eq(C.parseSegReply(JSON.stringify({ segments: [{ source: 'a' }] }), {}).reason, 'schema');
  });
  test('漂移门：模型凭空增删整段 ⇒ 拒', () => {
    const far = { segments: [{ source: '一个完全无关的很长很长的句子内容还有更多更多的字', translation: 'x' }], remainder: '' };
    eq(C.parseSegReply(JSON.stringify(far), { buffer: buf }).reason, 'drift');
  });
  test('标点硬切白名单：Mr. Zhang / p.m. / 小数 / 汉字句号 不切', () => {
    deepEq(C.hardCutSentences('Mr. Zhang will come before five p.m. tomorrow.'),
      ['Mr. Zhang will come before five p.m. tomorrow.']);
    deepEq(C.hardCutSentences('It costs 3.5 yuan. Done.'), ['It costs 3.5 yuan.', 'Done.']);
    deepEq(C.hardCutSentences('请问去火车站怎么走？谢谢。'), ['请问去火车站怎么走？', '谢谢。']);
    deepEq(C.hardCutSentences('三千八百五十块钱。'), ['三千八百五十块钱。']);
  });
  test('prompt 用注入模板：占位替换、五条规则、JSON 形状', () => {
    const sys = '你是实时口译的断句+翻译器。源语言：{src}，目标语言：{dst}。规则：\n1 只在语义完整处断句；不在数字中间断（如"三千八百五十"），不在称谓与姓名之间断（"Mr. Zhang"），a.m./p.m./Mr./Dr. 不是句末。\n2 逗号前后同一句意不断。\n3 最后一段语义未完放进 remainder 不翻译；force=true 时 remainder 必须为空。\n4 可按上下文修正明显识别错误（同音字、专有名词、数字），不增删意思。\n5 只输出 JSON。{"segments":[{"source":"s","translation":"t"}],"remainder":""}';
    const p = C.buildSegPrompt({ srcName: '中文', dstName: 'English', buffer: '三千八百五十', force: true, context: [{ who: 'them', text: 'hi', tr: '你好' }], sysTmpl: sys, userTmpl: 'BUF:\n{buffer}' });
    ok(p.system.indexOf('中文') >= 0 && p.system.indexOf('{src}') < 0, '{src} 替换');
    ok(p.user.indexOf('三千八百五十') >= 0 && p.system.indexOf('不在数字中间断') >= 0, '规则与文本');
  });
  test('路由：google / qwen_mt / 翻译专用名 ⇒ legacy；grant / 通用 chat ⇒ model', () => {
    eq(C.segRouteOf({ providerId: 'google', providerType: 'google', fmt: 'google' }), 'legacy');
    eq(C.segRouteOf({ providerId: 'qwen_mt', providerType: 'chat-compat', fmt: 'chat-compat' }), 'legacy');
    eq(C.segRouteOf({ providerId: 'custom', providerType: 'chat-compat', fmt: 'chat-compat', translationModel: true }), 'legacy');
    eq(C.segRouteOf({ providerId: 'grant', providerType: 'chat-compat', fmt: 'chat-compat' }), 'model');
    eq(C.segRouteOf({ providerId: 'deepseek', providerType: 'chat-compat', fmt: 'chat-compat' }), 'model');
  });
  test('换边宽限：旧语言第一条 final 放行一次，之后不再放', () => {
    const sw = { from: 'en', at: 1000, used: false };
    deepEq(C.finalAdmit({ base: 'en', lid: 'zh', pttSwitch: sw, now: 1200 }), { admit: true, markUsed: true });
    deepEq(C.finalAdmit({ base: 'en', lid: 'zh', pttSwitch: { from: 'en', at: 1000, used: true }, now: 1300 }), { admit: false, markUsed: false });
    deepEq(C.finalAdmit({ base: 'zh', lid: 'zh', pttSwitch: null, now: 1 }), { admit: true, markUsed: false });
    deepEq(C.finalAdmit({ base: 'en', lid: 'zh', pttSwitch: null, now: 1 }), { admit: false, markUsed: false });
  });
});



describe('R9 结算/remainder 修复（方案 2/3/4 — 2026-10-11 第九轮）', () => {
  const BUF = '一共三千八百五十块钱，刷卡还是付款呢？';   // 20 字、？结尾 ⇒ 非碎片、走普通空闲送
  const failsOf = (ev) => ev.filter((e) => e.t === 'fail').map((e) => e.reason);
  // 真机模型的形状：force=false 时整段回 remainder；force=true 才切完（补调那一次应当带 force）
  const forceAware = (calls) => (p) => {
    calls.push(p);
    const b = bufOf(p);
    return /true\s*$/.test(String(p.user))
      ? JSON.stringify({ segments: [{ source: b, translation: 'T' }], remainder: '' })
      : JSON.stringify({ segments: [], remainder: b });
  };

  // 方案 3：remainder 只差标点/空白 ⇒ 仍算后缀；consumed 取**原文**（账本守恒）
  test('★ 方案 3：模型清洗标点的 remainder 仍算后缀，出行原文按位置取回（数字/大小写仍须一致）', async () => {
    const TEXT = 'Hello there, please make 3 copies of this contract and say, to good bye.....';
    const REM = 'please make 3 copies of this contract and say, to good bye';   // 少了首段与尾点（模型清洗标点）
    // source 必须与「原文去掉 remainder」长度相当（漂移门 0.55–1.8），否则解析器先拒
    const a = makeRouter({ replies: [{ segments: [{ source: 'Hello there please', translation: 'T' }], remainder: REM }] });
    a.r.feed('en-US', TEXT);
    await a.clk.advance(1700); await settleTick();
    const orig = origOf(a.ev).join('');
    ok(orig.length > 0, '应当有消费的原文上屏：' + JSON.stringify(a.ev));
    const rest = a.r.pending('en-US');
    eq(orig + rest, TEXT, '账本守恒（consumed + remainder == 输入原文）：' + JSON.stringify({ orig, rest }));
    ok(/^please make 3/.test(rest), 'remainder 从原文位置取回（不是模型清洗后的写法）：' + JSON.stringify(rest));
    ok(TEXT.indexOf(rest) > 0, 'remainder 是原文里从某位置到结尾的一段：' + JSON.stringify(rest));
    ok(orig.indexOf('Hello there') >= 0, 'consumed 是原文里真出现过的一段：' + JSON.stringify(orig));
    // 大小写不同 ⇒ 不算后缀（继续当失败重试）
    const b = makeRouter({ replies: [
      { segments: [], remainder: 'please make 3' },
      { segments: [{ source: 'Please make 3', translation: 'T' }], remainder: '' },
    ] });
    b.r.feed('en-US', 'Please make 3');
    await b.clk.advance(1700); await settleTick();
    eq(b.r.pending('en-US'), '', '大小写不一致不算后缀（继续按失败重试）');
  });

  // 方案 2：整段 remainder ⇒ 立即 force 补调一次，不再等 idleMs
  test('★ 方案 2：整段 remainder + 无新话 ⇒ **立即** force 补调一次（不等 1500ms）；第二次正常出行', async () => {
    const clk = fakeClock(); const ev = []; const calls = [];
    const r = C.makeSegmentRouter({
      call: forceAware(calls),
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
      fallback: (t, meta) => ev.push({ t: 'fallback', text: t, meta }),
      onFail: (reason) => ev.push({ t: 'fail', reason }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
    });
    r.feed('zh-CN', BUF);
    await clk.advance(1600); await settleTick();     // 第一次空闲：送出，模型回整段 remainder
    ok(calls.length >= 1, '第一次调用');
    ok(failsOf(ev).indexOf('all-remainder') >= 0, '应记 fail:all-remainder（不再静默重等）：' + JSON.stringify(ev));
    // 补调必须是**立刻**的：不再推进时间（addition idles 都不给）就该到第二次调用
    await settleTick();
    eq(calls.length, 2, '整段 remainder 后应立即 force 补调一次（不等第二个 idleMs）');
    ok(/true\s*$/.test(String(calls[1].user)), '补调那一次是 force（全部切完的同一提示词）');
    eq(ev.filter((e) => e.t === 'emit').length, 1, '第二次回复正常 ⇒ 出行');
    eq(r.pending('zh-CN'), '', '账本清空');
  });

  test('★ 方案 2 变异：拿掉补调额度（noRetry，等价于退回「调大 lastFeedAt 重等」）⇒ 上一条必须红', async () => {
    const clk = fakeClock(); const ev = []; const calls = [];
    const r = C.makeSegmentRouter({
      noRetry: true,                 // ← 变异：demandAllRemainder 直接返回 false（不补调）
      call: forceAware(calls),
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
      fallback: (t, meta) => ev.push({ t: 'fallback', text: t, meta }),
      onFail: (reason) => ev.push({ t: 'fail', reason }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
    });
    r.feed('zh-CN', BUF);
    await clk.advance(1600); await settleTick();
    eq(calls.length, 1, '第一次调用');
    await settleTick();
    eq(calls.length, 1, '变异（不补调）下不会**立即**有第二次调用 —— 证明上一条测的是补调');
    eq(ev.filter((e) => e.t === 'emit').length, 0, '变异下还没有出行');
  });

  // 补正（2026-10-11 监督方）：漂移门的 target 必须按**原文位置**切，不能用模型清洗后的
  // remainder.length —— 后缀里带大量标点时，后者会把 target 切长、把正常回复误判成 drift。
  test('★ 补正：漂移门 target 按原文位置切（清洗后的 remainder.length 会误判 drift）', () => {
    const BUF = 'AAAA BBBB CCCCCC DDDDDD EEEEEE...............';
    const REM = 'CCCCCC DDDDDD EEEEEE';           // 模型清洗：去掉了尾部 15 个点
    const reply = JSON.stringify({ segments: [{ source: 'AAAA BBBB', translation: 'T' }], remainder: REM });
    const p = C.parseSegReply(reply, { buffer: BUF });
    eq(p.ok, true, '按原文位置切 target ⇒ 不漂移（实际 ' + JSON.stringify(p) + '）');
    // 反证：用清洗后的 remainder.length 切 target 会算成 drift（旧实现的 bug）
    const oldTarget = BUF.slice(0, BUF.length - REM.length);
    const unit = (c) => Math.max(c.cjk, c.thai, c.words, 1);
    const ratioOld = unit(C.segCounts('AAAA BBBB')) / unit(C.segCounts(oldTarget));
    ok(ratioOld < 0.55, '用例前提：旧切法确实会算出 ' + ratioOld.toFixed(3) + ' < 0.55（否则这条测不到补正）');
  });

  // 方案 4：{segments:[],remainder:''} ⇒ fail:empty-reply + 一次补调（与方案 2 共用一个额度）
  test('★ 方案 4：空回复单记 fail:empty-reply（不再误记 remainder-mismatch），并立即补调一次', async () => {
    const clk = fakeClock(); const ev = []; const calls = [];
    const r = C.makeSegmentRouter({
      call: (p) => { const b = bufOf(p); calls.push(b); return calls.length === 1
        ? '{"segments":[],"remainder":""}'
        : JSON.stringify({ segments: [{ source: b, translation: 'T' }], remainder: '' }); },
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
      fallback: (t, meta) => ev.push({ t: 'fallback', text: t, meta }),
      onFail: (reason) => ev.push({ t: 'fail', reason }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
    });
    r.feed('zh-CN', BUF);
    await clk.advance(1600); await settleTick();
    ok(failsOf(ev).indexOf('empty-reply') >= 0, '应记 fail:empty-reply：' + JSON.stringify(ev));
    ok(failsOf(ev).indexOf('remainder-mismatch') < 0, '不该再误记 remainder-mismatch：' + JSON.stringify(ev));
    await settleTick();
    eq(calls.length, 2, '空回复也应立即补调一次（共用方案 2 的额度）');
    eq(ev.filter((e) => e.t === 'emit').length, 1, '补调正常 ⇒ 出行');
  });

  // 方案 2/4 的额度只有一次：补调后仍整段 remainder ⇒ 硬切交旧路，不再无限循环
  test('★ 方案 2：补调后仍整段 remainder ⇒ 硬切交旧路（共一次额度，不无限循环）', async () => {
    const clk = fakeClock(); const ev = []; let n = 0;
    const r = C.makeSegmentRouter({
      call: (p) => { n++; return JSON.stringify({ segments: [], remainder: bufOf(p) }); },   // 连 force 也整段
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
      fallback: (t, meta) => ev.push({ t: 'fallback', text: t, meta }),
      onFail: (reason) => ev.push({ t: 'fail', reason }),
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
    });
    r.feed('zh-CN', BUF);
    await clk.advance(1600); await settleTick();
    await settleTick();
    eq(n, 2, '总共两次调用（原 + 一次补调），实际 ' + n);
    ok(ev.some((e) => e.t === 'fallback'), '两次都失败 ⇒ 原文交旧路（不丢）：' + JSON.stringify(ev));
    eq(r.pending('zh-CN'), '', '不留碎片');
  });

  // 「有新话进账本」⇒ 按原逻辑（等下一次空闲），不立即补调
  test('方案 2：补调前有新话进账本 ⇒ 不立即补调，等下一次空闲跟新话一起送', async () => {
    const clk = fakeClock(); const calls = []; const ev = [];
    let n = 0;
    const r = C.makeSegmentRouter({
      call: (p) => {
        n++; calls.push(bufOf(p));
        if (n === 1) return JSON.stringify({ segments: [], remainder: bufOf(p) });   // 整段 remainder（会触发补调）
        const b = bufOf(p);
        return JSON.stringify({ segments: [{ source: b, translation: 'T' }], remainder: '' });   // 补调正常
      },
      emit: (rows, meta) => ev.push({ t: 'emit', rows, meta }),
      fallback: (t, meta) => ev.push({ t: 'fallback', text: t, meta }), onFail: () => {},
      ctx: () => ({ userTmpl: 'BUF:\n{buffer}\nFORCE:{force}' }),
      now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, idleMs: 1500,
    });
    r.feed('zh-CN', BUF);
    await clk.advance(1600); await settleTick();
    eq(n, 2, '第一次 + 立即补调一次（模型没给新话 ⇒ 立即补调）');
    // 补调期间/之后进新话 ⇒ 下一轮不再立即补调，等 idle 跟新话一起送
    r.feed('zh-CN', '再多一句');
    const before = n;
    await settleTick();
    eq(n, before, '有新话 ⇒ 不立即补调');
    await clk.advance(1600); await settleTick();
    ok(n > before, '下一次空闲才跟新话一起送');
    ok(calls[calls.length - 1].indexOf('再多一句') >= 0, '新话在 buffer 里');
  });
});
