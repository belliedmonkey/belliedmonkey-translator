// test/learn-driving.test.js — 播客模式 (§9.5) 的纯逻辑.
//
// 这个模式**什么都不写**——没有 review 行、没有技能戳、不动 lastSeenAt、不碰调度器。
// 所以这份测试守的不是「进度算得对不对」，而是三件播放器该做对的事：
//
//   1. **播放顺序**。随机必须是「每张一次的随机排列」，不是「每次随机抽一张」——
//      后者会重复播某些卡而另一些永远轮不到，在十几张的牌库上一眼就看得出来。
//   2. **一张卡播完自动进下一张**，中间没有任何等待用户的环节。
//   3. **失败要分得开**：整机级失败（自动播放被拦、不支持语音）该停下并说明，
//      单卡级失败（这张卡的语言没有音色）该说一声然后跳过——用一条规则处理两者，
//      要么一张坏卡毁掉整场，要么整机故障被当成跳卡而空转。

const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');

const D = loadModule('learn-driving.js', { window: {} }).LearnDriving;

// 可预测的 rand：按给定序列返回，用完循环。Fisher-Yates 的输出因此完全确定。
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('LearnDriving — 播放顺序 (§9.5)', () => {
  test('默认是随机播放', () => {
    eq(D.DEFAULT_MODE, 'shuffle');
    eq(D.DEFAULTS.mode, 'shuffle');
  });

  test('模式按钮循环走完四种再回到起点', () => {
    const seen = [];
    let m = D.DEFAULT_MODE;
    for (let i = 0; i < D.MODES.length; i++) { seen.push(m); m = D.nextMode(m); }
    deepEq(seen.slice().sort(), D.MODES.slice().sort(), '四种模式都要能轮到');
    eq(m, D.DEFAULT_MODE, '轮一圈要回到起点');
    eq(D.nextMode('nonsense'), D.DEFAULT_MODE, '未知模式按一下要回到默认，不能卡住按钮');
  });

  test('非随机模式的顺序就是原序', () => {
    for (const m of ['sequential', 'loop', 'repeat-one']) {
      deepEq(D.buildOrder(4, m), [0, 1, 2, 3], m);
    }
  });

  test('随机是「每张一次的排列」，不是「每次抽一张」', () => {
    const o = D.buildOrder(5, 'shuffle', seq([0.9, 0.1, 0.7, 0.3, 0.5]));
    eq(o.length, 5);
    deepEq(o.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4],
      '每张卡必须恰好出现一次 —— 重复或遗漏就是「每次抽一张」的症状');
  });

  test('顺序播放走到头就结束，其余三种永不结束', () => {
    const order = [0, 1, 2];
    eq(D.advance(2, order, 'sequential').done, true);
    eq(D.advance(1, order, 'sequential').pos, 2);
    eq(D.advance(2, order, 'loop').done, false);
    eq(D.advance(2, order, 'loop').pos, 0, '循环播放要绕回开头');
    eq(D.advance(0, order, 'repeat-one').pos, 0, '单曲循环停在原地');
    eq(D.advance(0, order, 'repeat-one').done, false);
  });

  test('随机播放绕圈时重新洗牌 —— 第二轮不是第一轮的重播', () => {
    // 第一轮的排列固定；走到最后一张再 advance 会拿到一份新排列。
    const first = D.buildOrder(4, 'shuffle', seq([0.99, 0.01, 0.99, 0.01]));
    const r = D.advance(first[3], first, 'shuffle', seq([0.01, 0.99, 0.01, 0.99]));
    eq(r.done, false);
    eq(r.order.length, 4);
    deepEq(r.order.slice().sort((a, b) => a - b), [0, 1, 2, 3]);
    eq(r.pos, r.order[0], '新一轮要从新排列的第一张开始');
  });

  test('下一张按钮在单曲循环里也必须能跳走', () => {
    // 一个不理会自己「下一张」按钮的播放器是坏的。
    const order = [0, 1, 2];
    eq(D.advance(0, order, 'repeat-one', null, true).pos, 1);
  });
});

describe('LearnDriving — 一张卡三遍 (§9.5)', () => {
  const item = { id: 'a', text: 'Hello', tr: '你好', lang: 'en' };
  const shape = (segs) => segs.map((x) => x.what + x.pass);

  test('默认（含解析）：原句 / 原句+译句+解析 / 原句', () => {
    deepEq(shape(D.cardPlan(item).segments),
      ['source1', 'source2', 'tr2', 'notes2', 'source3']);
    eq(D.PASSES, 3);
  });

  test('关掉解析：第二遍只剩原句+译句，三遍结构不变', () => {
    deepEq(shape(D.cardPlan(item, { playNotes: false }).segments),
      ['source1', 'source2', 'tr2', 'source3']);
  });

  test('没有译文的卡：三遍都只有原句 —— 这就是「播三遍」对一张裸卡的正确读法', () => {
    deepEq(shape(D.cardPlan({ id: 'b', text: 'Solo' }, { playNotes: false }).segments),
      ['source1', 'source2', 'source3']);
  });

  test('hasTr 让有补译文缓存的裸句卡也读译句 —— 但 item.tr 一个字都没被改', () => {
    // §9.5 补译文：译文是**派生物**，缓存在 notes 表旁边，永不写进 item.tr（写了也
    // 同步不出去，见 §7.2）。所以 cardPlan 必须能从外面被告知「这张卡有译文了」。
    const bare = { id: 'b', text: 'Solo' };
    deepEq(shape(D.cardPlan(bare, { playNotes: false, hasTr: true }).segments),
      ['source1', 'source2', 'tr2', 'source3']);
    eq('tr' in bare, false, 'cardPlan 不该往卡上写任何东西');
  });

  test('hasTr:false 压过卡上真有的 tr —— 缓存与计划永远说同一件事', () => {
    // 反向：预热失败/缓存被清时，编排器要能说「这张卡这次没有译句」，而不是让计划
    // 承诺一段播不出来的音频。
    deepEq(shape(D.cardPlan(item, { playNotes: false, hasTr: false }).segments),
      ['source1', 'source2', 'source3']);
  });

  test('不传 hasTr 时按卡自己的 tr 走 —— 老调用方行为一字不变', () => {
    deepEq(shape(D.cardPlan(item, { playNotes: false }).segments),
      ['source1', 'source2', 'tr2', 'source3']);
    deepEq(shape(D.cardPlan({ id: 'b', text: 'Solo' }, { playNotes: false }).segments),
      ['source1', 'source2', 'source3']);
  });

  test('解析默认是开的（2026-08-18 用户裁定）', () => {
    eq(D.DEFAULTS.playNotes, true);
  });

  test('每段都带 pass —— 摊平之后界面靠它区分第一遍和第三遍的原句', () => {
    const segs = D.cardPlan(item).segments;
    ok(segs.every((x) => typeof x.what === 'string' && typeof x.pass === 'number'), JSON.stringify(segs));
    eq(segs[0].pass, 1);
    eq(segs[segs.length - 1].pass, 3);
    eq(segs.filter((x) => x.what === 'source').length, 3, '原句必须恰好读三次');
  });
});

// §9.5 开卡并行预热：前瞻下一张卡的音频，需要「下一张是谁」而 advance 回答不了这个
// 问题 —— 它会重洗牌、会消耗随机数，拿它偷看等于提前把随机序列走掉。
describe('LearnDriving — peekNext：非破坏性前瞻 (§9.5)', () => {
  test('顺序 / 循环：下一张就是原序的下一位', () => {
    for (const m of ['sequential', 'loop']) {
      eq(D.peekNext(0, [0, 1, 2], m), 1, m);
      eq(D.peekNext(1, [0, 1, 2], m), 2, m);
    }
  });

  test('单曲循环前瞻到自己 —— 那正是它接下来要播的', () => {
    eq(D.peekNext(1, [0, 1, 2], 'repeat-one'), 1);
  });

  test('走到需要重洗的边界返回 null —— 不猜', () => {
    // 随机与循环绕圈时，下一张是重洗之后才定的。预热一个猜测就是为一张不会播的卡花钱。
    eq(D.peekNext(2, [0, 1, 2], 'shuffle'), null);
    eq(D.peekNext(2, [0, 1, 2], 'loop'), null);
    eq(D.peekNext(2, [0, 1, 2], 'sequential'), null, '顺序播放走到头就没有下一张了');
  });

  test('拿不到随机数，也改不了 order —— 这是它存在的全部理由', () => {
    // 「不消耗随机」在这里是**结构性**的，不是行为性的：签名里根本没有 rand 那一格。
    // 断言 arity 才杀得死变异——写成「传一个计数 rand 进去看它没被调用」是假绿的：
    // 函数不接这个参数，计数当然是 0，把 peekNext 改成偷偷调 Math.random 也照样过。
    eq(D.peekNext.length, 3, 'peekNext 多出一个参数就说明随机（或别的状态）溜进了前瞻');

    const order = D.buildOrder(4, 'shuffle', seq([0.9, 0.1, 0.7, 0.3]));
    const before = order.slice();
    D.peekNext(order[0], order, 'shuffle');
    D.peekNext(order[3], order, 'shuffle');   // 边界那一次尤其不能重洗
    deepEq(order, before, '前瞻改了 order，真正的播放顺序就被偷看这一下改掉了');
  });

  test('空牌库 / 不在 order 里的位置 ⇒ null，绝不抛', () => {
    eq(D.peekNext(0, [], 'sequential'), null);
    eq(D.peekNext(0, null, 'shuffle'), null);
    eq(D.peekNext(9, [0, 1, 2], 'loop'), null);
  });

  test('advance 与 peekNext 在同一步上一致（不绕圈时）', () => {
    const order = [2, 0, 1];
    for (const m of ['sequential', 'loop', 'shuffle']) {
      const a = D.advance(2, order, m, () => 0.5, false);
      eq(D.peekNext(2, order, m), a.pos, m + '：偷看到的和真走一步得到的必须是同一张');
    }
  });
});

describe('LearnDriving — notesToSpeech (§9.5)', () => {
  const labels = { words: '生词：', phrases: '短语：', grammar: '语法：' };

  test('三段都在时读成一段话，标签由调用方给', () => {
    const s = D.notesToSpeech({
      words: [{ w: 'curve', g: '曲线' }, { w: 'bend', g: '弯曲' }],
      phrases: [{ p: 'over time', g: '随时间' }],
      grammar: '一般现在时',
    }, labels);
    ok(s.indexOf('生词：curve，曲线') === 0, s);
    ok(s.indexOf('短语：over time，随时间') > 0, s);
    ok(s.indexOf('语法：一般现在时') > 0, s);
  });

  test('缺项只是少一段，不是空串', () => {
    const s = D.notesToSpeech({ words: [], phrases: [], grammar: '只有语法' }, labels);
    eq(s, '语法：只有语法');
  });

  test('没有可说的内容返回空串 —— 调用方据此跳过，而不是播一段静音', () => {
    // 播空字符串会让界面停在一个和「卡住了」完全一样的状态上。
    eq(D.notesToSpeech(null, labels), '');
    eq(D.notesToSpeech({ words: [], phrases: [], grammar: '' }, labels), '');
    eq(D.notesToSpeech({ words: [{ w: 'x' }], phrases: [{ g: 'y' }], grammar: '  ' }, labels), '',
      '半截条目不算内容');
  });
});

describe('LearnDriving — reduce：三遍走完自动进下一张 (§9.5)', () => {
  // 真实形状：段是对象、带遍次。
  const seg = (what, pass) => ({ what, pass });
  const ctx = { plan: { segments: [seg('source', 1), seg('source', 2), seg('tr', 2), seg('source', 3)] } };
  const ctxN = { plan: { segments: [seg('source', 1), seg('source', 2), seg('tr', 2), seg('notes', 2), seg('source', 3)] } };
  const run = (st, ev, arg, c) => D.reduce(st, ev, arg, c || ctx);

  test('三遍连着走完再推进，中间没有任何等用户的环节', () => {
    let r = run({ name: 'idle' }, 'card_ready');
    eq(r.state.name, 'speaking');
    deepEq(r.effects, [{ t: 'speak', what: 'source' }], '第一遍：只读原句');

    r = run(r.state, 'tts_done');
    eq(r.effects[0].what, 'source', '第二遍从原句开始');
    r = run(r.state, 'tts_done');
    eq(r.effects[0].what, 'tr', '第二遍接译句');
    r = run(r.state, 'tts_done');
    eq(r.effects[0].what, 'source', '第三遍：只读原句');

    r = run(r.state, 'tts_done');
    eq(r.state.name, 'advancing', '三遍走完必须直接推进 —— 不再有「有没有疑问」');
    deepEq(r.effects, [{ t: 'advance' }]);
  });

  test('开了解析时，第二遍的译句之后先取解析再播', () => {
    let r = run({ name: 'speaking', seg: 2 }, 'tts_done', null, ctxN);
    eq(r.state.name, 'fetching_notes');
    deepEq(r.effects, [{ t: 'fetch_notes' }]);

    r = run(r.state, 'notes_ready', '生词：curve，曲线', ctxN);
    eq(r.state.name, 'speaking');
    eq(r.effects[0].what, 'notes');
    eq(r.effects[0].text, '生词：curve，曲线', '要播的文本随效果一起走，不能和显示的不一致');

    r = run(r.state, 'tts_done', null, ctxN);
    eq(r.effects[0].what, 'source', '解析之后还有第三遍');
    r = run(r.state, 'tts_done', null, ctxN);
    eq(r.state.name, 'advancing');
  });

  test('解析为空 = 跳过这一段，不是播一段空音频', () => {
    const r = run({ name: 'fetching_notes', seg: 3 }, 'notes_ready', '   ', ctxN);
    eq(r.state.name, 'speaking', '跳过解析之后还有第三遍，不是直接推进');
    eq(r.effects[0].what, 'source');
  });

  test('解析失败只跳过这一段，整场继续，并说清楚', () => {
    const r = run({ name: 'fetching_notes', seg: 3 }, 'notes_fail', 'no_base', ctxN);
    eq(r.state.name, 'advancing');
    eq(r.effects[0].t, 'note');
    eq(r.effects[0].code, 'no_base', '要说是哪一种失败，不能默默跳过');
  });
});

describe('LearnDriving — reduce：失败要分得开 (§9.5)', () => {
  const ctx = { plan: { segments: [{ what: 'source', pass: 1 }, { what: 'tr', pass: 2 }] } };

  test('整机级失败停下并报原因 —— 它在每张卡上都会重演', () => {
    for (const code of ['blocked', 'unsupported']) {
      const r = D.reduce({ name: 'speaking', seg: 0 }, 'tts_fail', code, ctx);
      eq(r.state.name, 'stopped_error', code);
      ok(r.effects.some((f) => f.t === 'note' && f.code === code), code);
    }
  });

  test('单卡级失败说一声然后跳过 —— 别让一张坏卡毁掉整场', () => {
    for (const code of ['no_voice', 'no_voice_und', 'empty']) {
      const r = D.reduce({ name: 'speaking', seg: 0 }, 'tts_fail', code, ctx);
      eq(r.state.name, 'advancing', code);
      ok(r.effects.some((f) => f.t === 'note' && f.code === code), code);
      ok(r.effects.some((f) => f.t === 'advance'), code);
    }
  });

  // 2026-08-23，模拟器实证。判据从前写成「fatal = blocked || unsupported」，于是**其余
  // 每一个引擎级原因都被当成单卡级**：端点连不上时，20 张卡跳 20 次、十二秒走完，界面上
  // 打出「本轮听完了」，而一声都没读出来。§9.5 的出发前预载让这件事从罕见变成常态 ——
  // 它的全部用途就是端点够不着的场景。
  test('连不上端点是整机级的 —— 它在每张卡上都会重演，绝不能跳 20 次然后说「听完了」', () => {
    for (const code of ['network', 'no_base', 'no_key', 'http', undefined]) {
      const r = D.reduce({ name: 'speaking', seg: 0 }, 'tts_fail', code, ctx);
      eq(r.state.name, 'stopped_error', String(code));
      ok(r.effects.some((f) => f.t === 'stop_tts'), String(code));
    }
  });

  test('note 效果带 src —— 两个引擎共用 reason 码，不带来源就会说错功能', () => {
    // `no_base` 对语音和解析都成立。少了 src，一个够不着的**语音**端点会被报成
    // 「这张卡的解析没成功」：说的是另一个功能，指的是另一个设置区。
    const tts = D.reduce({ name: 'speaking', seg: 0 }, 'tts_fail', 'no_base', ctx);
    eq(tts.effects.find((f) => f.t === 'note').src, 'tts');
    const notes = D.reduce({ name: 'fetching_notes', seg: 0 }, 'notes_fail', 'no_base', ctx);
    eq(notes.effects.find((f) => f.t === 'note').src, 'notes');
  });
});

describe('LearnDriving — reduce：控制键 (§9.5)', () => {
  const ctx = { plan: { segments: [{ what: 'source', pass: 1 }, { what: 'tr', pass: 2 }] } };

  test('暂停/停止在任何状态下都可用 —— 它们是中断，不是二次触发', () => {
    for (const st of ['speaking', 'fetching_notes']) {
      const p = D.reduce({ name: st, seg: 0 }, 'tap_pause', null, ctx);
      eq(p.state.name, 'paused', st);
      ok(p.effects.some((f) => f.t === 'stop_tts'), st);
      eq(D.reduce({ name: st, seg: 0 }, 'tap_stop', null, ctx).state.name, 'idle', st);
    }
  });

  test('暂停记住是哪一段，继续时从那一段重来', () => {
    const paused = D.reduce({ name: 'speaking', seg: 1 }, 'tap_pause', null, ctx);
    eq(paused.state.seg, 1);
    const r = D.reduce(paused.state, 'tap_resume', null, ctx);
    eq(r.state.name, 'speaking');
    eq(r.effects[0].what, 'tr', '继续要回到译文，而不是从原文重头念');
  });

  test('切到后台（锁屏、来电、切 App）= 暂停，恢复只能靠手点', () => {
    const r = D.reduce({ name: 'speaking', seg: 0 }, 'hidden', null, ctx);
    eq(r.state.name, 'paused');
    ok(r.effects.some((f) => f.t === 'stop_tts'));
    // 已经暂停时再收到 hidden 必须是 no-op，否则会把 seg 冲掉。
    const again = D.reduce(r.state, 'hidden', null, ctx);
    eq(again.state.seg, 0);
    deepEq(again.effects, []);
  });

  test('换播放模式不打断正在播的音频 —— 这是开车时能按它的全部理由', () => {
    const r = D.reduce({ name: 'speaking', seg: 0 }, 'tap_mode', null, ctx);
    eq(r.state.name, 'speaking', '状态不能变');
    eq(r.state.seg, 0);
    deepEq(r.effects, [{ t: 'mode_next' }], '只发一个换模式的效果，不发 stop_tts');
  });

  test('下一张会先停掉当前音频，再强制推进', () => {
    const r = D.reduce({ name: 'speaking', seg: 0 }, 'tap_next', null, ctx);
    eq(r.state.name, 'advancing');
    ok(r.effects.some((f) => f.t === 'stop_tts'));
    const adv = r.effects.find((f) => f.t === 'advance');
    eq(adv.force, true, '手动跳过要能越过单曲循环');
  });

  test('再听一遍从这张卡的第一段重来', () => {
    const r = D.reduce({ name: 'speaking', seg: 1 }, 'tap_repeat', null, ctx);
    eq(r.effects[0].what, 'source');
    eq(r.state.seg, 0);
  });

  test('只有顺序播放会走到 session_done', () => {
    const r = D.reduce({ name: 'advancing' }, 'deck_done', null, ctx);
    eq(r.state.name, 'session_done');
    deepEq(r.effects, [{ t: 'done' }]);
  });
});

describe('LearnDriving — 暂停时的「解析这句」(§9.5)', () => {
  const seg = (what, pass) => ({ what, pass });
  const ctx = { plan: { segments: [seg('source', 1), seg('source', 2), seg('tr', 2), seg('source', 3)] } };

  test('只从暂停态进得去', () => {
    for (const st of ['speaking', 'fetching_notes', 'idle', 'advancing']) {
      const r = D.reduce({ name: st, seg: 1 }, 'tap_explain', null, ctx);
      ok(r.state.name !== 'explain_fetch', st + ' 不该能触发按需解析');
    }
    const r = D.reduce({ name: 'paused', seg: 1 }, 'tap_explain', null, ctx);
    eq(r.state.name, 'explain_fetch');
    deepEq(r.effects, [{ t: 'fetch_notes', onDemand: true }]);
  });

  test('取到 → 朗读 → 回到暂停，且 seg 原样带回', () => {
    // seg 带不回来，「继续」就会从错的那一段重来 —— 用户会听到一段他刚听完的东西。
    let r = D.reduce({ name: 'paused', seg: 2 }, 'tap_explain', null, ctx);
    eq(r.state.seg, 2);
    r = D.reduce(r.state, 'notes_ready', '生词：curve，曲线', ctx);
    eq(r.state.name, 'explain_speak');
    eq(r.effects[0].what, 'notes');
    eq(r.effects[0].text, '生词：curve，曲线');
    eq(r.state.seg, 2);
    r = D.reduce(r.state, 'tts_done', null, ctx);
    eq(r.state.name, 'paused', '读完必须回到暂停，不能顺势恢复整场');
    eq(r.state.seg, 2, 'seg 丢了 —— 继续会跳段');
    deepEq(r.effects, []);
  });

  test('继续之后从原来那一段接着播', () => {
    const paused = { name: 'paused', seg: 2 };
    const r = D.reduce(paused, 'tap_resume', null, ctx);
    eq(r.effects[0].what, 'tr', '第 2 段是译句');
  });

  test('解析为空 / 失败都回到暂停并具名，不停在中间态', () => {
    let r = D.reduce({ name: 'explain_fetch', seg: 1 }, 'notes_ready', '  ', ctx);
    eq(r.state.name, 'paused');
    eq(r.effects[0].code, 'notes_empty');
    eq(r.state.seg, 1);

    r = D.reduce({ name: 'explain_fetch', seg: 1 }, 'notes_fail', 'no_engine', ctx);
    eq(r.state.name, 'paused');
    eq(r.effects[0].code, 'no_engine', '要说出是哪一种失败');
  });

  test('按需朗读期间：暂停/停止/下一张仍然可用，且下一张先停音频', () => {
    for (const st of ['explain_fetch', 'explain_speak']) {
      eq(D.reduce({ name: st, seg: 1 }, 'tap_stop', null, ctx).state.name, 'idle', st);
      const p = D.reduce({ name: st, seg: 1 }, 'tap_pause', null, ctx);
      eq(p.state.name, 'paused', st);
      const nx = D.reduce({ name: st, seg: 1 }, 'tap_next', null, ctx);
      eq(nx.state.name, 'advancing', st);
      ok(nx.effects.some((f) => f.t === 'stop_tts'),
        st + '：不先停音频，按需朗读会盖住下一张卡的原文');
    }
  });
});

describe('LearnDriving — 这个模式不写任何进度 (§9.5)', () => {
  test('模块表面上没有任何写进度的东西', () => {
    // 反向断言，load-bearing：这些函数存在过，是上一版播客模式推进度用的。
    // 它们的消失就是「这个模式只曝光、不评分」这条契约本身。
    for (const gone of ['speakRepOutcome', 'drivingGradeFor', 'classifyReply']) {
      eq(typeof D[gone], 'undefined', gone + ' 还在 —— 播客模式不该有写进度的路径');
    }
  });

  test('reduce 产生的效果里没有任何写操作', () => {
    const ctx = { plan: { segments: [{ what: 'source', pass: 1 }, { what: 'tr', pass: 2 }, { what: 'notes', pass: 2 }] } };
    const evs = [['card_ready'], ['tts_done'], ['tts_done'], ['notes_ready', 'x'],
      ['tts_done'], ['tap_next'], ['tap_repeat'], ['tap_pause'], ['tap_resume']];
    let st = { name: 'idle' };
    const kinds = new Set();
    for (const [ev, arg] of evs) {
      const r = D.reduce(st, ev, arg, ctx);
      st = r.state;
      for (const f of r.effects) kinds.add(f.t);
    }
    const ALLOWED = ['speak', 'fetch_notes', 'advance', 'stop_tts', 'note', 'done', 'mode_next'];
    for (const k of kinds) {
      ok(ALLOWED.indexOf(k) >= 0, '出现了计划外的效果 ' + k + ' —— 写路径是从这里溜进来的');
    }
  });
});

// §9.5「解析跟读」。解析从「整段念一次」改成「按生词/短语/语法三块逐行念」，锁屏封面
// 跟着高亮当前行。这里守的是切分本身：
//
//   · 空块不产行 —— 产一个空行等于产一个空 utterance，听起来和卡住一模一样；
//   · 整段版必须与逐行版**逐字一致** —— 不一致就意味着预热的和朗读的是两段话，
//     缓存永远打不中而用户多付一次钱；
//   · 行数有上界 3 —— 「出发前预载」在解析还没取回时靠它给出诚实的估算。
describe('LearnDriving.notesToLines — 解析切成可跟读的行', () => {
  const L = { words: 'W:', phrases: 'P:', grammar: 'G:' };
  const full = {
    words: [{ w: 'curve', g: '曲线' }, { w: 'bend', g: '弯曲' }],
    phrases: [{ p: 'over time', g: '随时间' }],
    grammar: '一般现在时',
  };

  test('三块齐全 ⇒ 三行，各带各的标签', () => {
    const lines = D.notesToLines(full, L);
    eq(lines.length, 3);
    ok(lines[0].indexOf('W:') === 0 && lines[0].indexOf('curve') > 0, lines[0]);
    ok(lines[1].indexOf('P:') === 0, lines[1]);
    ok(lines[2].indexOf('G:') === 0, lines[2]);
  });

  test('空块不产行 —— 空行就是空 utterance，听起来和卡住一样', () => {
    eq(D.notesToLines({ words: [], phrases: [], grammar: '' }, L).length, 0);
    eq(D.notesToLines({ words: full.words, phrases: [], grammar: '  ' }, L).length, 1);
    eq(D.notesToLines(null, L).length, 0);
  });

  test('半截条目不算内容（缺释义的词、缺释义的短语都不产行）', () => {
    eq(D.notesToLines({ words: [{ w: 'x' }], phrases: [{ p: 'y' }], grammar: '' }, L).length, 0);
  });

  test('NOTE_LINES_MAX 就是实际的上界 —— 两者脱钩，预载账单会少报', () => {
    const many = { words: Array.from({ length: 40 }, (_, i) => ({ w: 'w' + i, g: 'g' + i })),
      phrases: [{ p: 'p', g: 'g' }], grammar: 'x' };
    eq(D.notesToLines(many, L).length, D.NOTE_LINES_MAX);
  });

  test('行数恒 ≤ 3 —— 预载账单的上界靠这条成立', () => {
    const many = { words: Array.from({ length: 40 }, (_, i) => ({ w: 'w' + i, g: 'g' + i })),
      phrases: Array.from({ length: 20 }, (_, i) => ({ p: 'p' + i, g: 'g' + i })),
      grammar: 'x。y。z。' };
    ok(D.notesToLines(many, L).length <= 3, '切分粒度变了，预载的估算就不再是上界');
  });

  test('整段版 = 逐行版 join —— 两者不一致就意味着预热的和朗读的是两段话', () => {
    for (const n of [full, { words: full.words, phrases: [], grammar: '' },
      { words: [], phrases: [], grammar: '只有语法' }, {}]) {
      eq(D.notesToSpeech(n, L), D.notesToLines(n, L).join('。'), JSON.stringify(n));
    }
  });
});

// §9.5「后台与锁屏播放」。锁屏/车机/耳机/媒体键是屏幕上那四个按钮的第二个表面，
// 所以这一整节验的其实是一句话：**状态机不该因为多了一个表面而长出任何东西。**
describe('LearnDriving.nativeEvent — 遥控 → 会话事件', () => {
  const ev = (msg, st) => D.nativeEvent(msg, st || 'speaking');

  test('四个遥控键映射到既有事件，没有一个是新的', () => {
    eq(ev({ type: 'remote', command: 'play' }), 'tap_resume');
    eq(ev({ type: 'remote', command: 'pause' }), 'tap_pause');
    eq(ev({ type: 'remote', command: 'next' }), 'tap_next');
    eq(ev({ type: 'remote', command: 'previous' }), 'tap_repeat');
  });

  test('「上一曲」是再听一遍，不是上一张 —— 随机排列里往回退没有定义', () => {
    eq(D.REMOTE_EVENTS.previous, 'tap_repeat');
    ok(!Object.values(D.REMOTE_EVENTS).includes('tap_prev'), '不存在这样的事件，也不该存在');
  });

  test('播放/暂停切换键按当前状态倒向，和屏幕按钮用同一个判据', () => {
    eq(ev({ type: 'remote', command: 'toggle' }, 'speaking'), 'tap_pause');
    for (const st of D.PAUSED_LIKE) {
      eq(ev({ type: 'remote', command: 'toggle' }, st), 'tap_resume', st + ' 看起来是停着的');
    }
  });

  test('中断开始就暂停；结束只有系统说 shouldResume 才自动续播', () => {
    eq(ev({ type: 'interrupt', phase: 'begin' }), 'tap_pause');
    eq(ev({ type: 'interrupt', phase: 'end', resume: true }), 'tap_resume');
    // 系统没说可以恢复 ⇒ 停着等人。「切后台不是中断」那条规约缩窄之后，剩下的正是这个。
    eq(ev({ type: 'interrupt', phase: 'end', resume: false }), null);
    eq(ev({ type: 'interrupt', phase: 'end' }), null, '字段缺失按不恢复算');
  });

  test('拔耳机暂停，重连不自动播', () => {
    eq(ev({ type: 'route', change: 'device-lost' }), 'tap_pause');
    eq(ev({ type: 'route', change: 'device-added' }), null,
      '重连自动外放是所有音乐 App 都在避免的那件事');
  });

  test('认不出的消息一律不动播放器', () => {
    eq(ev(null), null);
    eq(ev({}), null);
    eq(ev({ type: 'session-ready' }), null);
    eq(ev({ type: 'remote', command: 'seek' }), null, '时间轴我们根本不给，seek 更不该有动作');
  });

  test('nativeEvent 只会产出 reduce 认识的事件', () => {
    const KNOWN = ['tap_resume', 'tap_pause', 'tap_next', 'tap_repeat'];
    const msgs = [
      { type: 'remote', command: 'play' }, { type: 'remote', command: 'pause' },
      { type: 'remote', command: 'next' }, { type: 'remote', command: 'previous' },
      { type: 'remote', command: 'toggle' },
      { type: 'interrupt', phase: 'begin' }, { type: 'interrupt', phase: 'end', resume: true },
      { type: 'route', change: 'device-lost' },
    ];
    for (const m of msgs) {
      const e = ev(m);
      ok(e === null || KNOWN.indexOf(e) >= 0, '产出了状态机不认识的事件：' + e);
    }
  });
});
