// cli/store-adapter.js — 把文件语料伪装成 `LearnStore`，给 sync.js / chunk.js 用。
//
// §9.10 说「复用 learn/auth.js + learn/sync.js，在文件语料上包一层适配器」，这就是那层。
// 方法面是从两个消费者里**逐处 grep 出来的最小集**，不是把 store.js 抄一遍：
//   sync.js:  getMeta/setMeta, allItems/allSources/allReviews/allDels, currentDbName, DB_NAME,
//             clearSyncStamps, bumpPressure, hasEverEvicted
//   chunk.js: applyDels, tombstones, userDels, mergeBatch, allReviews, recordReview, evictIfNeeded
//   auth.js:  getMeta/setMeta, useDb, dbNameFor, DB_NAME
// 单库（一个账号一份语料文件），所以 useDb/currentDbName/dbNameFor 都是常数。没有淘汰机制，
// 所以 tombstones 为空、hasEverEvicted 恒 false、evictIfNeeded/bumpPressure 是空操作 ——
// 这些在 CLI 上不是「降级」，是「不适用」（文件语料不受 IndexedDB 配额约束）。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LearnModel = require(path.join(ROOT, 'extension/content/learn-model.js'));

function makeStore(corpus, state) {
  const meta = state.meta;
  const DB = 'mt-learn';
  return {
    DB_NAME: DB,
    dbNameFor: () => DB,
    currentDbName: () => DB,
    useDb: async () => {},
    getMeta: async (k, d) => (Object.prototype.hasOwnProperty.call(meta, k) ? meta[k] : (d === undefined ? null : d)),
    setMeta: async (k, v) => { if (v === null || v === undefined) delete meta[k]; else meta[k] = v; },

    allItems: async () => corpus.allItems(),
    allSources: async () => corpus.allSources(),
    allReviews: async () => corpus.allReviews(),
    allDels: async () => corpus.allDels(),
    mergeBatch: async (items, sources, opts) => corpus.mergeBatch(items, sources, opts),
    recordReview: async (itemId, grade, at, opts) => corpus.recordReview(itemId, grade, at, opts),
    applyDels: async (entries) => corpus.applyDels(entries),
    userDels: async () => new Map(corpus.allDels().map((d) => [d.id, d.at])),
    tombstones: async () => new Set(),
    evictIfNeeded: async () => {},
    hasEverEvicted: async () => false,
    // store.js 的 clearSyncStamps：把每张卡的「服务器已知」戳清掉（后端换了时整库重传，
    // §8.4.3）。CLI 的单库同样需要 —— 换后端登录后必须重新上传。
    clearSyncStamps: async () => { for (const it of corpus.allItems()) delete it.syncedAt; },
    bumpPressure: async () => {},
    touchedAt: LearnModel.touchedAt,
  };
}

module.exports = { makeStore };
