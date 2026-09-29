// cli/plan.js — 只读复习计划（learning-design §9.10）。
//
// **不写任何数据**（与 §9.5「出发前预载」同一条纪律）：只调调度器的纯函数，读语料、
// 算今日牌库与未来 N 天，一个字节都不落盘。`buildDeck` / `buildDeckAhead` / `introducedToday`
// / `dueCount` 都是 `learn-scheduler.js` 的既有函数，CLI 不新增任何调度实现。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LearnScheduler = require(path.join(ROOT, 'extension/content/learn-scheduler.js'));

function buildPlan(corpus, now, days) {
  const items = corpus.allItems();
  const reviews = corpus.allReviews();
  // 今日已引入的新卡从**同步过的复习日志**推导（§5），不写设备本地 meta。
  const newToday = LearnScheduler.introducedToday(reviews, now);
  const due = LearnScheduler.dueCount(items, now, LearnScheduler.DEFAULTS);
  const deck = LearnScheduler.buildDeck(items, now, LearnScheduler.DEFAULTS, newToday);
  const horizon = Math.max(0, Math.floor(Number(days) || 0));
  const ahead = horizon > 0
    ? LearnScheduler.buildDeckAhead(items, now, LearnScheduler.DEFAULTS, newToday, horizon)
    : null;
  return { deck, ahead, due, newToday, total: items.length, horizon };
}

module.exports = { buildPlan };
