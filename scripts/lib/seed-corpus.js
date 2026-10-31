// scripts/lib/seed-corpus.js — 造一份「老用户」的语料，用客户端**自己的**模型与调度代码。
//
// 为什么不手搓 JSON：卡片的存储形状（makeItem）与调度状态（freshSched/applyReview）
// 是产品逻辑，手写一份会立刻和真实用户的状态分叉 —— 而这份语料存在的意义恰恰是
// 「让测试账号看起来像真的用过」。分叉了就白造。
//
// 所以这里只做两件事：编真实的句子，然后按一条**可复现**的复习历史把它们喂给
// 真正的调度器。随机数是种子化的：同一个 seed 造出来的语料逐字节相同，
// 这样「重置 → 播种 → 复现某个 bug」才是可重复的实验，而不是每次都不一样。
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const Model = require(path.join(ROOT, 'extension/content/learn-model.js'));
const Sched = require(path.join(ROOT, 'extension/content/learn-scheduler.js'));

// 种子化 PRNG（mulberry32）。用它而不是 Math.random，理由见文件头。
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 四篇真实来源 + 每篇若干句。句子是英文的、长短不一、有从句有专名 —— 那正是
// 真实采集会得到的东西；全用短句会让分页、换行、朗读时长这些面都测不到。
const SOURCES = [
  { host: 'en.wikipedia.org', title: 'Coffee — Wikipedia', url: 'https://en.wikipedia.org/wiki/Coffee', lang: 'en',
    sents: [
      ['Coffee is a beverage prepared from roasted coffee beans.', '咖啡是一种由烘焙过的咖啡豆制成的饮料。'],
      ['Darkly colored, bitter, and slightly acidic, coffee has a stimulating effect on humans, primarily due to its caffeine content.', '咖啡颜色深、味苦、略带酸味，对人有提神作用，主要来自其中的咖啡因。'],
      ['The two most commonly grown coffee bean types are C. arabica and C. robusta.', '最常种植的两种咖啡豆是阿拉比卡和罗布斯塔。'],
      ['Coffee production is a major source of income for developing countries.', '咖啡生产是许多发展中国家的重要收入来源。'],
      ['Once ripe, coffee berries are picked, processed, and dried.', '咖啡果实成熟后会被采摘、处理并晒干。'],
    ] },
  { host: 'www.economist.com', title: 'Why the world is running short of sand', url: 'https://www.economist.com/sand', lang: 'en',
    sents: [
      ['Sand is the most-consumed natural resource on the planet after water and air.', '沙子是地球上除水和空气之外消耗量最大的自然资源。'],
      ['Desert sand is too smooth and rounded to bind properly in concrete.', '沙漠里的沙子太光滑圆润，无法在混凝土中良好黏合。'],
      ['Illegal sand mining has hollowed out riverbeds across South and South-East Asia.', '非法采砂已经掏空了南亚与东南亚的许多河床。'],
      ['Replacing river sand with crushed rock is possible, but it costs more.', '用碎石替代河沙是可行的，只是成本更高。'],
    ] },
  { host: 'www.newyorker.com', title: 'The Art of Slow Reading', url: 'https://www.newyorker.com/slow-reading', lang: 'en',
    sents: [
      ['Reading slowly is not the opposite of reading well; it is a precondition for it.', '读得慢并不是读得好的反面，而是它的前提。'],
      ['A sentence you had to stop at is a sentence you are likely to remember.', '一句让你停下来的话，往往就是你会记住的那句。'],
      ['The eye moves faster than comprehension, and the gap is where meaning is lost.', '眼睛比理解快，而那道缝隙正是意义流失的地方。'],
      ['Annotation is less about recording than about being forced to decide what matters.', '做批注与其说是记录，不如说是被迫决定什么重要。'],
    ] },
  { host: 'www.youtube.com', title: 'How CPUs actually work', url: 'https://www.youtube.com/watch?v=seed0001', lang: 'en',
    sents: [
      ['Every instruction the processor executes goes through fetch, decode, and execute.', '处理器执行的每一条指令都要经过取指、译码、执行。'],
      ['A cache miss can cost hundreds of cycles, which is why locality matters so much.', '一次缓存未命中可能耗费数百个周期，这就是局部性如此重要的原因。'],
      ['Branch prediction lets the pipeline keep working before the condition is known.', '分支预测让流水线在条件尚未确定时就继续工作。'],
    ] },
];

// 一条可复现的复习历史：把卡片按「学了多久」分层，然后真的调用 applyReview 喂进去。
// 分层刻意不均匀 —— 真实用户的牌堆就是少数熟卡 + 一堆刚学 + 一大片候选。
const HISTORY = [
  { share: 0.10, reviews: 8, grades: [2, 2, 3, 2, 2, 3, 2, 2], label: '熟' },
  { share: 0.15, reviews: 4, grades: [2, 1, 2, 2], label: '中' },
  { share: 0.20, reviews: 2, grades: [1, 2], label: '新学' },
  { share: 0.15, reviews: 1, grades: [0], label: '刚忘过' },
  { share: 0.40, reviews: 0, grades: [], label: '候选（从没复习过）' },
];

// 造语料。now 注入而不是 Date.now() —— 同 makeItem 的规矩，也让「造一份三个月前
// 开始学的账号」变成一个参数而不是改代码。
function buildCorpus({ count = 120, seed = 1, now = Date.now(), spanDays = 90 } = {}) {
  const rand = rng(seed);
  const DAY = Sched.DAY;
  const cards = [];
  const sources = [];
  const reviews = [];

  for (const s of SOURCES) {
    sources.push({ id: Model.sourceId(s.url), url: s.url, title: s.title, host: s.host, firstSeenAt: now - spanDays * DAY });
  }

  // 句子不够就循环补，但每轮换一个后缀，免得 itemId 撞成同一张卡。
  const flat = [];
  for (const s of SOURCES) for (const [text, tr] of s.sents) flat.push({ s, text, tr });
  let i = 0;
  while (cards.length < count) {
    const base = flat[i % flat.length];
    const round = Math.floor(i / flat.length);
    const text = round === 0 ? base.text : `${base.text} (${round + 1})`;
    const createdAt = now - Math.floor(rand() * spanDays) * DAY;
    const card = Model.makeItem({
      text, tr: base.tr, lang: base.s.lang, targetLang: 'zh-CN',
      sourceId: Model.sourceId(base.s.url), kind: 'sentence',
      dwellMs: 2500 + Math.floor(rand() * 6000), seenCount: 1 + Math.floor(rand() * 3),
      starred: false,
    }, createdAt, Model.DEFAULTS);
    cards.push(card);
    i++;
  }

  // 按分层给复习历史。**走真正的 applyReview** —— 状态与真实用户逐字段一致。
  let idx = 0;
  for (const band of HISTORY) {
    const n = Math.round(cards.length * band.share);
    for (let k = 0; k < n && idx < cards.length; k++, idx++) {
      const c = cards[idx];
      if (!band.reviews) continue;
      c.state = 'learning';
      let sched = Sched.freshSched(c.createdAt);
      let at = c.createdAt;
      for (const g of band.grades) {
        at += Math.max(1, Math.round((sched.s || 0.5) * DAY * (0.8 + rand() * 0.5)));
        if (at > now) at = now - Math.floor(rand() * DAY);
        sched = Sched.applyReview(sched, g, at, Sched.DEFAULTS);
        reviews.push({ itemId: c.id, at, grade: g, mode: 'read' });
      }
      c.sched = sched;
      c.lastSeenAt = Math.max(c.lastSeenAt, at);
      c.state = Sched.stateFor ? (Sched.stateFor(c, Sched.DEFAULTS) || 'learning') : 'learning';
    }
  }

  return { cards, sources, reviews };
}

module.exports = { buildCorpus, SOURCES, HISTORY };
