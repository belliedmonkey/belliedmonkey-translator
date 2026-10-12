// test/listen-r5.test.js — 1.19.4 第 5 轮（fix/1194-r5）的纯逻辑验收。
//
// 覆盖：
//   C1 进度句在拉丁本名/就绪清单与汉字之间补空格；
//   B1 中文路 → 英文路的候补转交，必须同样过「朗读中同语言硬闸」与文字回声检查
//      （提案 §3.0 0-b / L2；用 113/114 的真实回声样本 she. / theafternew.）；
//   A  识别语言名额（改稿 H）：三种状态、已用 N / 上限、最久没用默认让出、当前语言对不可让出、
//      首启多选超额标记。
const { describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');

// ── 假时钟（与 listen-r14 同形）────────────────────────────────────────────────
function fakeClock() {
  let t = 5_000_000, seq = 1;
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

// ══ C1 ════════════════════════════════════════════════════════════════════════
describe('C1 — 进度句在拉丁本名/就绪清单与汉字之间补空格', () => {
  test('★ 「…中文、English已就绪」⇒「…中文、English 已就绪」', () => {
    const s = C.fillPrepDetail('{what}下载中 · {pct}% · {ready}已就绪', '日本語', 0, '基础组件、中文、English');
    ok(s.indexOf('English 已就绪') >= 0, '拉丁本名后没补空格：' + JSON.stringify(s));
    ok(s.indexOf('English已就绪') < 0, '仍然粘着：' + JSON.stringify(s));
  });
  test('就绪清单以汉字结尾时不补空格（中文、Japanese 两种都不粘也不多空）', () => {
    const s = C.fillPrepDetail('{what}下载中 · {pct}% · {ready}已就绪', '日本語', 60, '基础组件、中文');
    ok(s.indexOf('中文已就绪') >= 0, '汉字结尾被多加了空格：' + JSON.stringify(s));
    ok(s.indexOf('中文 已就绪') < 0, '汉字结尾不该加空格：' + JSON.stringify(s));
  });
  test('回归对照：{what} 侧 Latin 本名接汉字仍补空格、其它占位照常替换', () => {
    const s = C.fillPrepDetail('{what}下载中 · {pct}% · {ready}已就绪', 'English', 42, '基础组件');
    ok(s.indexOf('English 下载中') >= 0, 'what 侧没补空格：' + JSON.stringify(s));
    ok(s.indexOf('42%') >= 0, 'pct 没替换：' + JSON.stringify(s));
    ok(s.indexOf('基础组件已就绪') >= 0, JSON.stringify(s));
  });
});

// ══ B1 ════════════════════════════════════════════════════════════════════════
// 读作对照：App 正在朗读英文译文时，中文通道把读声收成拉丁短句 —— 这两条是 113/114 的真样本。
const ECHO_SAMPLES = ['she.', 'theafternew.', ', you, Hitong Fu Ben Bing song?', '去'];

function makeGate(o) {
  const clk = fakeClock();
  const got = [], diags = [];
  const opt = o || {};
  const g = C.makeTransferGate({
    now: clk.now, setTimeout: clk.setT, clearTimeout: clk.clearT, waitMs: 1500,
    canXfer: () => true,
    targetLang: () => 'en',
    playing: opt.playing,
    isEcho: opt.isEcho,
    onXfer: (text, locale, cand) => got.push({ text, locale, cand }),
    onDiag: (k, e) => diags.push({ k, e }),
  });
  return { g, clk, got, diags, kinds: () => diags.map((d) => d.k) };
}

describe('B1 — 转交执行前必须过回声闸（L2 修补）', () => {
  test('★ 朗读英文中，中文路候补 she. 被「朗读中同语言硬闸」拦住，不转交', async () => {
    const playing = new Set(['en']);
    const { g, clk, got, kinds } = makeGate({ playing: () => playing, isEcho: () => false });
    ok(g.offer({ text: C.xferClean('she。'), locale: 'en-US' }), '先应作为候补挂起');
    await clk.advance(1600);
    eq(got.length, 0, '回声中不该转交：' + JSON.stringify(got));
    ok(kinds().indexOf('intake:xfer-echo') >= 0, '没有记 intake:xfer-echo：' + JSON.stringify(kinds()));
  });
  test('★ 朗读英文中，中文路候补 theafternew. 也被拦（113/114 真样本）', async () => {
    const playing = new Set(['en']);
    const { g, clk, got, kinds } = makeGate({ playing: () => playing, isEcho: () => false });
    g.offer({ text: 'theafternew.', locale: 'en-US' });
    await clk.advance(1600);
    eq(got.length, 0, 'echo: ' + JSON.stringify(got));
    ok(kinds().indexOf('intake:xfer-echo') >= 0, JSON.stringify(kinds()));
  });
  test('★ 播完后窗口内，文字与刚读出的内容相似 ⇒ 文字闸拦（isEcho）', async () => {
    const { g, clk, got, kinds } = makeGate({ playing: () => new Set(), isEcho: (s) => /^yes/i.test(s) });
    g.offer({ text: 'Yes.', locale: 'en-US' });
    await clk.advance(1600);
    eq(got.length, 0, '文字回声不该转交：' + JSON.stringify(got));
    ok(kinds().indexOf('intake:xfer-echo') >= 0, JSON.stringify(kinds()));
  });
  test('★ 反例：朗读结束、不是回声 ⇒ 真人插话照常转交（R14 不回退）', async () => {
    const { g, clk, got, kinds } = makeGate({ playing: () => new Set(), isEcho: () => false });
    g.offer({ text: 'Yes please.', locale: 'en-US' });
    await clk.advance(1600);
    deepEq(got.map((x) => x.text), ['Yes please.'], '正常候补必须照交：' + JSON.stringify(got));
    ok(kinds().indexOf('intake:xfer') >= 0, JSON.stringify(kinds()));
  });
  test('★ 反例：对方真人插话不被误杀 —— 另一门语言的真人话照收，不因朗读而丢', () => {
    // 朗读英文时，中文通道说出的真人中文：归属闸按设计拒（不是英文路），但不该被当成回声候补。
    const zh = C.intakeDecide({ base: 'zh-CN', lid: 'en', text: '帮我把这份合同复印三份送到办公室', pttSwitch: null, playing: new Set(['en']), now: 1, isEcho: () => false });
    eq(zh.admit, false); eq(zh.reason, 'attrib'); eq(zh.xfer, false, '汉字真人话不该当回声候补');
    // 朗读英文时，中文是**归属语言**（说中文键）：真人中文照收（规则 g 只丢正在朗读的那门）。
    const zhOwn = C.intakeDecide({ base: 'zh-CN', lid: 'zh', text: '等一下', pttSwitch: null, playing: new Set(['en']), now: 1, isEcho: () => false });
    eq(zhOwn.admit, true, '朗读英文时对方说中文必须照收：' + JSON.stringify(zhOwn));
  });
  test('★ 非候补（长句/汉字）不进这条路，行为不变', () => {
    for (const s of ECHO_SAMPLES.slice(2)) {
      const cand = C.isXferCandidate({ base: 'zh-CN', lid: 'en', text: s });
      ok(cand === false, '不该是候补：' + s);
    }
  });
});

// ══ A：名额纯逻辑 ════════════════════════════════════════════════════════════
const CATALOG = [
  { code: 'zh', label: '中文' }, { code: 'en', label: 'English' },
  { code: 'th', label: 'ไทย' }, { code: 'ja', label: '日本語' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' },
];

describe('A — 识别语言名额：三种状态 / 已用 N 上限 / 让出', () => {
  test('★ 三种状态：占名额=ready、装过但让出=recoverable、没装过=absent', () => {
    const r = C.quotaRows({ catalog: CATALOG, reserved: ['zh-CN', 'en-US', 'th-TH'], installed: { zh: true, en: true, th: true, ja: true }, max: 5 });
    const by = {};
    for (const row of r.rows) by[row.code] = row;
    eq(by.zh.state, 'ready'); eq(by.en.state, 'ready'); eq(by.th.state, 'ready');
    eq(by.ja.state, 'recoverable', '装过但没预留 ⇒ 可补回');
    eq(by.fr.state, 'absent'); eq(by.de.state, 'absent');
    eq(r.used, 3); eq(r.max, 5); eq(r.full, false);
  });
  test('★ 「已用 N / 上限」的 N 是占名额的语言数，上限读原生（不写死 5）', () => {
    const r = C.quotaRows({ catalog: CATALOG, reserved: ['zh', 'en', 'th', 'ja', 'fr'], installed: {}, max: 5 });
    eq(r.used, 5); eq(r.full, true);
    const r7 = C.quotaRows({ catalog: CATALOG, reserved: ['zh', 'en', 'th', 'ja', 'fr'], installed: {}, max: 7 });
    eq(r7.max, 7); eq(r7.full, false, '上限 7 时 5 门没满');
  });
  test('★ 当前语言对的两门不能被让出', () => {
    ok(!C.canYield('zh', ['zh', 'en']), '中文是当前语言对，不能让出');
    ok(!C.canYield('en-US', ['zh', 'en']), '英语是当前语言对，不能让出');
    ok(C.canYield('fr', ['zh', 'en']));
  });
  test('★ 默认让出「最久没用」的那门（按最后一次听译时间）', () => {
    const pick = C.pickYield(['zh', 'en', 'th', 'ja', 'fr'], ['zh', 'en'], { th: 100, ja: 50, fr: 20 });
    eq(pick, 'fr', '应选时间戳最小的 fr');
    const none = C.pickYield(['zh', 'en', 'th', 'ja'], ['zh', 'en'], {});
    ok(none === 'th' || none === 'ja', '都没记录时挑一门非当前语言对：' + none);
    eq(C.pickYield(['zh', 'en'], ['zh', 'en'], {}), '', '只剩当前语言对时没有可让出的');
  });
  test('★ 首启多选：超过上限的标「未就绪·第 N 门」，已在名额里的先保留', () => {
    const plan = C.quotaSelectPlan({ selected: ['zh', 'en', 'th', 'ja', 'fr', 'de'], reserved: [], installed: { th: true }, max: 5 });
    deepEq(plan.keep, ['zh', 'en', 'th', 'ja', 'fr']);
    eq(plan.later.length, 1); eq(plan.later[0].code, 'de'); eq(plan.later[0].nth, 6);
    const plan2 = C.quotaSelectPlan({ selected: ['zh', 'en', 'th', 'ja', 'fr', 'de'], reserved: ['de'], installed: {}, max: 5 });
    ok(plan2.keep.indexOf('de') >= 0, '已在名额里的语言先保留');
    eq(plan2.later.length, 1);
  });
});
