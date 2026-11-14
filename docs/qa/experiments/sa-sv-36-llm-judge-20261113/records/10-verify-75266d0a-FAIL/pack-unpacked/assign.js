'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function assignItems(items, seed) {
  const rand = mulberry32(seed);
  return items.map((item) => {
    const keys = item.candidates.map((cand) => cand.key);
    const swap = rand() < 0.5;
    const order = swap ? [keys[1], keys[0]] : [keys[0], keys[1]];
    return {
      id: item.id,
      slots: { 'slot-1': order[0], 'slot-2': order[1] },
    };
  });
}

function sampleIds(ids, seed, count) {
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const pool = ids.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

module.exports = { assignItems, sampleIds };
