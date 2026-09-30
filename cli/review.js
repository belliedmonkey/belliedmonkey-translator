// cli/review.js — 交互式复习（learning-design §9.10 / §5.2 / §5.4）。
//
// 写入序列与复习页**逐字同源**（src/shared/review.js）：`applyReview` → `stateFor` →
// 技能盖章 → 更新 item → 追加复习行。
//
// **技能轮换（§5.4）**：每张卡先问 `LearnScheduler.pickSkills` 这次考哪一项。能力由
// `caps` 门控 —— CLI 有文本、没有音频/麦克风，所以 `write`（填空，纯文本、可客观判分）
// 在能力内，`listen`/`speak` 不在（§5.2：缺能力等于这个题型不存在，不是这张卡失败）。
// 当 `item.sched.s` 到了 `TIER_WRITE_S`（30 天），write 会自动出现 —— 这套旋转是既有的，
// CLI 只是把它接上。
//
// 打分逻辑是纯的，`io` 由调用方注入（readline 在启动器里）—— 交互与语义分开，前者可测。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LearnScheduler = require(path.join(ROOT, 'extension/content/learn-scheduler.js'));
const LearnModel = require(path.join(ROOT, 'extension/content/learn-model.js'));

// CLI 的能力：文本读写可以，音频/麦克风不行。这是**能力门控**，不是「先不做」。
const CAPS = { listen: false, speak: false, write: true };

// 把 cloze 渲染成一行：文字 + 每个空一处下划线。
function clozeText(cloze) {
  return (cloze.parts || []).map((p) => (p.t === 'text' ? p.v : '____')).join('');
}

function splitAnswers(raw, n) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const parts = s.includes('|') ? s.split('|') : s.split(/\s+/);
  return parts.map((x) => x.trim()).slice(0, n);
}

// io: { read(item,n,total) → raw, write(item,cloze,n,total) → raw, note(text)? }
// 向后兼容：直接传一个函数时当作 read/write 共用（旧测试的用法）。
function normalizeIO(io) {
  if (typeof io === 'function') return { read: io, write: io, note: null };
  return { read: io.read, write: io.write, note: io.note || null };
}

async function runReview(corpus, now, ioIn) {
  const io = normalizeIO(ioIn);
  const items = corpus.allItems();
  const newToday = LearnScheduler.introducedToday(corpus.allReviews(), now);
  const deck = LearnScheduler.buildDeck(items, now, LearnScheduler.DEFAULTS, newToday);
  let graded = 0;

  for (let i = 0; i < deck.length; i++) {
    const item = deck[i];
    const n = i + 1;
    const skills = LearnScheduler.pickSkills(item, CAPS, now, LearnScheduler.DEFAULTS);
    let skill = skills[0] || 'read';
    const cloze = skill === 'write' ? LearnModel.clozeFor(item.text) : null;
    const blanks = cloze ? (cloze.parts || []).filter((p) => p.t === 'blank') : [];
    if (skill === 'write' && !blanks.length) skill = 'read';   // 没有可挖的空就退回 read

    if (skill === 'write') {
      const raw = String((await io.write(item, cloze, n, deck.length)) || '');
      if (raw.trim() === 'q') break;
      const answers = splitAnswers(raw, blanks.length);
      const okAll = blanks.every((b, j) => LearnModel.clozeCheck(b.answer, answers[j] || ''));
      if (io.note) io.note((okAll ? '✓ ' : '✗ ') + (item.tr || ''));
      corpus.recordReview(item.id, okAll ? 2 : 0, Date.now(), { mode: 'write', skill: 'write' });
      graded++;
      continue;
    }

    let ans = null;
    do { ans = await io.read(item, n, deck.length); }
    while (ans != null && ans !== 'q' && !/^[0-3]$/.test(String(ans).trim()));
    if (ans == null || ans === 'q') break;
    corpus.recordReview(item.id, Number(ans), Date.now(), { mode: 'read', skill: 'read' });
    graded++;
  }

  // 有评分才落盘；只打开看一眼不留副作用（与 plan 的只读纪律一致）。
  if (graded) await corpus.save(Date.now());
  return { graded, total: deck.length };
}

module.exports = { runReview, CAPS, clozeText, splitAnswers };
