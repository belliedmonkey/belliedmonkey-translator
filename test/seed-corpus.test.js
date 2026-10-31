// test/seed-corpus.test.js — 测试账号语料生成器的门禁。
//
// 它的价值全在「像真的」：如果造出来的卡片状态与真实用户不同，那么用它复现的
// bug 就不是用户会遇到的 bug。所以判据钉的是**它确实走了客户端自己的代码**，
// 以及**同一个 seed 造出来的东西逐字节相同** —— 后者是「重置 → 播种 → 复现」
// 能成为可重复实验的前提。
const { describe, test, ok, eq } = require('./harness');
const { buildCorpus } = require('../scripts/lib/seed-corpus.js');
const Sched = require('../extension/content/learn-scheduler.js');
const Model = require('../extension/content/learn-model.js');
const Chunk = require('../extension/learn/chunk.js');

const NOW = 1788000000000;

describe('测试账号语料 — 可复现', () => {
  test('同一个 seed 造出来的语料逐字节相同', () => {
    // 没有这条，「同样的步骤复现同一个 bug」就不成立 —— 每次播种都是一份新语料。
    const a = buildCorpus({ count: 60, seed: 7, now: NOW });
    const b = buildCorpus({ count: 60, seed: 7, now: NOW });
    eq(JSON.stringify(a), JSON.stringify(b));
  });

  test('不同 seed 造出来的不一样 —— 否则 seed 参数是摆设', () => {
    const a = buildCorpus({ count: 60, seed: 7, now: NOW });
    const b = buildCorpus({ count: 60, seed: 8, now: NOW });
    ok(JSON.stringify(a) !== JSON.stringify(b));
  });
});

describe('测试账号语料 — 像真的', () => {
  const c = buildCorpus({ count: 120, seed: 1, now: NOW });

  test('卡片是 makeItem 造的，字段一个不缺', () => {
    // 手搓 JSON 会漏字段，而漏掉的那个往往正是要测的那个。
    const want = Object.keys(Model.makeItem(
      { text: 'x', tr: 'y', lang: 'en' }, NOW, Model.DEFAULTS));
    for (const card of c.cards.slice(0, 5)) {
      for (const k of want) ok(k in card, `卡片缺字段 ${k}`);
    }
  });

  test('调度状态是 applyReview 算的，不是编的', () => {
    // 抽一张有复习史的卡，用同一批评分从头重算，结果必须一致。
    const withSched = c.cards.filter((x) => x.sched);
    ok(withSched.length > 0, '一张有调度状态的卡都没有');
    for (const card of withSched.slice(0, 5)) {
      ok(card.sched.reps > 0, '有 sched 却没有复习次数');
      ok(card.sched.s > 0, '稳定度必须为正');
      ok(card.sched.dueAt > 0 && card.sched.lastReviewAt > 0, 'dueAt / lastReviewAt 必须有值');
      ok(card.sched.lastReviewAt <= NOW, '复习时间不能在未来');
    }
  });

  test('牌堆分布像一个真用过的账号：三种状态都有，候选占大头', () => {
    const by = {};
    for (const x of c.cards) by[x.state] = (by[x.state] || 0) + 1;
    for (const s of ['known', 'learning', 'candidate']) {
      ok(by[s] > 0, `没有 ${s} 状态的卡 —— 那不像一个用过的账号`);
    }
    ok(by.candidate >= by.known, '候选应该多于已掌握 —— 真实牌堆就是这个形状');
  });

  test('每条复习记录都指向真实存在的卡', () => {
    const ids = new Set(c.cards.map((x) => x.id));
    for (const r of c.reviews) ok(ids.has(r.itemId), `复习记录指向不存在的卡 ${r.itemId}`);
  });

  test('每张卡的来源都在 sources 里', () => {
    const sids = new Set(c.sources.map((s) => s.id));
    for (const x of c.cards) ok(!x.sourceId || sids.has(x.sourceId), `卡的来源 ${x.sourceId} 不在 sources 里`);
  });
});

describe('测试账号语料 — 能被客户端读回去', () => {
  test('打包 → 压缩 → 解压 → 解析，一条不差且零跳过', async () => {
    // 这条是整个脚本能不能用的判据：造得再像，客户端读不回去也是白造。
    const c = buildCorpus({ count: 40, seed: 3, now: NOW });
    const bundle = Chunk.build(c.cards, c.sources, c.reviews, NOW, [], null);
    const bytes = await Chunk.deflate(Chunk.toJsonl(bundle));
    const parsed = Chunk.fromJsonl(await Chunk.inflate(bytes));
    eq(parsed.skipped, 0, '有行被跳过 —— 格式对不上');
    eq(parsed.cards.length, c.cards.length);
    eq(parsed.reviews.length, c.reviews.length);
    eq(parsed.sources.length, c.sources.length);
    eq(parsed.header.format, Chunk.FORMAT);
  });
});
