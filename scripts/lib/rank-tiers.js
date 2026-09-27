// scripts/lib/rank-tiers.js — 关键词名次的分档与中位数，一处实现。
//
// 为什么抽出来：`aso-rank.js` 打印名次与「跨档」，`growth-digest.js` 要把多天快照卷成
// 「近 N 次中位 + 跨档」—— 分档边界（10 / 50 / 100 / 200）必须是同一个真相，否则两张
// 报表会对同一个词给出两个档位。同 `scripts/lib/asc-client.js` 的理由。
'use strict';

const TIERS = [10, 50, 100, 200];
// 名次 → 档位。null（200 名外）单独一档。
const tierOf = (r) => (r == null ? '200+' : `前${TIERS.find((t) => r <= t)}`);

// 中位数：200 名外按 201 参与排序，这样「一半时候没排上」的中位数会诚实地落到 200+。
function medianRank(values) {
  const v = values.map((x) => (x == null ? 201 : x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const m = v[Math.floor((v.length - 1) / 2)];
  return m > 200 ? null : m;
}

module.exports = { TIERS, tierOf, medianRank };
