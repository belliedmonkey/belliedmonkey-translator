// cli/review.js — 交互式复习（learning-design §9.10）。
//
// 写入序列与复习页**逐字同源**（src/shared/review.js）：`applyReview` → `stateFor` →
// （技能盖章）→ 更新 item → 追加复习行。CLI v1 只走 read 档（§5.4 的 listen/write/speak
// 随后补，`pickSkills` / `skillFresh` 已是纯函数）。
//
// 打分逻辑是纯的，`ask` 由调用方注入 —— 交互（readline）与「打分语义」分开，前者可测。
// 评分 `0 again · 1 hard · 2 good · 3 easy`，`q` 退出并保存（§5）。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LearnScheduler = require(path.join(ROOT, 'extension/content/learn-scheduler.js'));

async function runReview(corpus, now, ask) {
  const items = corpus.allItems();
  const newToday = LearnScheduler.introducedToday(corpus.allReviews(), now);
  const deck = LearnScheduler.buildDeck(items, now, LearnScheduler.DEFAULTS, newToday);
  let graded = 0;
  for (let i = 0; i < deck.length; i++) {
    const item = deck[i];
    let ans = null;
    // 无效输入不静默吞掉：重新问，直到拿到 0..3 或 q（或输入流结束）。
    do { ans = await ask(item, i + 1, deck.length); }
    while (ans != null && ans !== 'q' && !/^[0-3]$/.test(String(ans).trim()));
    if (ans == null || ans === 'q') break;
    corpus.recordReview(item.id, Number(ans), Date.now(), { mode: 'read', skill: 'read' });
    graded++;
  }
  // 有评分才落盘；只打开看一眼不留副作用（与 plan 的只读纪律一致）。
  if (graded) await corpus.save(Date.now());
  return { graded, total: deck.length };
}

module.exports = { runReview };
