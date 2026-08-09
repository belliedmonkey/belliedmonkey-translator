// test/learn-backup.test.js — 本地备份与空库自恢复（learning-design §7.5）。
//
// 备份的价值全在坏日子：UUID 轮换把语料桶变孤儿的那天，restoreIfEmpty 是唯一
// 的路。所以断言的重点是往返无损、节流/上限的判定、以及「空库才恢复、清空不
// 还魂」的边界 —— 而不是快照本身跑了多少次。

const { loadModule, describe, test, ok, eq, deepEq } = require('./harness');
const { makeChrome } = require('./stubs');

const T0 = 1700000000000;

function card(id, over) {
  return Object.assign({
    id, text: 'Sentence ' + id, tr: '译文 ' + id, lang: 'en', sourceId: 'src1',
    state: 'candidate', starred: false, createdAt: T0, lastSeenAt: T0, seenCount: 1, sched: null,
  }, over);
}

// 与 learn-chunk.test.js 同款假 store（备份经 exportBytes/importBytes 走它）。
function fakeStore(seed = {}) {
  const items = (seed.items || []).slice();
  const sources = (seed.sources || []).slice();
  const reviews = (seed.reviews || []).slice();
  const dels = new Map(seed.dels || []);
  const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;
  return {
    items, sources, reviews, dels,
    allItems: () => Promise.resolve(items.slice()),
    allSources: () => Promise.resolve(sources.slice()),
    allReviews: () => Promise.resolve(reviews.slice()),
    allDels: () => Promise.resolve(Array.from(dels, ([id, at]) => ({ id, at }))),
    userDels: () => Promise.resolve(new Map(dels)),
    applyDels: (entries) => {
      let n = 0;
      for (const e of entries || []) {
        const i = items.findIndex((x) => x.id === e.id);
        if (i >= 0 && LearnModel.touchedAt(items[i]) <= (e.at || 0)) { items.splice(i, 1); n++; }
        dels.set(e.id, Math.max(dels.get(e.id) || 0, e.at || 0));
      }
      return Promise.resolve(n);
    },
    mergeBatch: (inc, srcs) => {
      let added = 0;
      for (const c of inc) if (!items.some((x) => x.id === c.id)) { items.push(c); added++; }
      for (const s of srcs || []) if (!sources.some((x) => x.id === s.id)) sources.push(s);
      return Promise.resolve(added);
    },
    recordReview: (itemId, grade, at) => { reviews.push({ itemId, grade, at }); return Promise.resolve(); },
    evictIfNeeded: () => Promise.resolve(0),
    tombstones: () => Promise.resolve(new Set()),
  };
}

function setup(seed = {}) {
  const store = fakeStore(seed);
  const chrome = makeChrome({ store: seed.storage || {} });
  const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;
  const LearnScheduler = loadModule('learn-scheduler.js', { window: {} }).LearnScheduler;
  const PageSettings = loadModule('learn/page-settings.js', { window: {}, chrome }).PageSettings;
  const LearnChunk = loadModule('learn/chunk.js', {
    window: {}, LearnStore: store, LearnModel, LearnScheduler,
    TextEncoder, TextDecoder, Response, Date,
    // 无 CompressionStream —— 锻炼未压缩回退，这本身就是出货路径之一
  }).LearnChunk;
  const B = loadModule('learn/backup.js', {
    window: {}, LearnStore: store, LearnChunk, PageSettings, chrome,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Date,
  }).LearnBackup;
  return { B, store, chrome };
}

describe('LearnBackup — 编码往返', () => {
  test('encode/decode 逐字节无损（含跨分片体积）', () => {
    const { B } = setup();
    for (const n of [0, 1, 7, 0x8000 - 1, 0x8000, 0x8000 + 1, 3 * 0x8000 + 17]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
      const back = B.decode(B.encode(bytes));
      eq(back.length, n, `长度必须一致 (n=${n})`);
      let same = true;
      for (let i = 0; i < n; i++) if (back[i] !== bytes[i]) { same = false; break; }
      ok(same, `字节必须逐一相等 (n=${n})`);
    }
  });
});

describe('LearnBackup — shouldBackup 判定（纯函数）', () => {
  test('无备份必跑；6 小时内节流；过期再跑', () => {
    const { B } = setup();
    eq(B.shouldBackup(null, T0), true, '从未备份过 ⇒ 必跑');
    eq(B.shouldBackup({ at: T0 }, T0 + B.BACKUP_MIN_MS - 1), false, '节流窗口内不跑');
    eq(B.shouldBackup({ at: T0 }, T0 + B.BACKUP_MIN_MS), true, '过窗即跑');
  });
});

describe('LearnBackup — 快照与恢复', () => {
  test('maybeRun 落盘，restoreIfEmpty 在空库上恢复出同一份语料', async () => {
    const src = setup({
      items: [card('a'), card('b', { starred: true })],
      sources: [{ id: 'src1', url: 'https://example.org/x', title: 'X' }],
      reviews: [{ itemId: 'a', grade: 2, at: T0 }],
    });
    const r = await src.B.maybeRun(T0);
    eq(r.ran, true, JSON.stringify(r));
    ok(src.chrome._store.learnBackup && src.chrome._store.learnBackup.b64, '负载必须落在 storage.local');

    // “UUID 轮换”：同一份 storage.local，全新的空 IDB
    const dst = setup({ storage: src.chrome._store });
    const res = await dst.B.restoreIfEmpty();
    eq(res.restored, true, JSON.stringify(res));
    eq(dst.store.items.length, 2, '两张卡都得回来');
    eq(dst.store.sources.length, 1);
    eq(dst.store.reviews.length, 1, '复习历史也得回来');
  });

  test('非空库不恢复 —— 备份永远不许覆盖活语料', async () => {
    const src = setup({ items: [card('a')] });
    await src.B.maybeRun(T0);
    const dst = setup({ storage: src.chrome._store, items: [card('live')] });
    const res = await dst.B.restoreIfEmpty();
    eq(res.restored, false);
    eq(res.reason, 'not-empty');
    eq(dst.store.items.length, 1);
    eq(dst.store.items[0].id, 'live');
  });

  test('空语料不快照 —— 空备份不许覆盖有内容的旧备份', async () => {
    const { B, chrome } = setup({ storage: { learnBackup: { v: 1, at: T0 - 999, b64: 'KEEP' } } });
    const r = await B.maybeRun(T0 + 10 * 3600e3);
    eq(r.ran, false);
    eq(r.reason, 'empty');
    eq(chrome._store.learnBackup.b64, 'KEEP', '旧备份必须原样保留');
  });

  test('节流窗口内 maybeRun 直接跳过（不读语料不导出）', async () => {
    const { B } = setup({
      items: [card('a')],
      storage: { learnBackupMeta: { at: T0 } },
    });
    const r = await B.maybeRun(T0 + 1000);
    eq(r.ran, false);
    eq(r.reason, 'throttled');
  });

  test('备份携带 dels 台账：恢复不会复活已删的卡（§7.4）', async () => {
    const src = setup({
      items: [card('keep')],
      sources: [{ id: 'src1', url: 'https://example.org/x' }],
      dels: [['gone', T0 + 5]],
    });
    await src.B.maybeRun(T0 + 10);
    const dst = setup({ storage: src.chrome._store, items: [card('gone')] });
    // dst 有一张已被账号删除的旧卡（touchedAt=T0 < 删除时刻）——空库判定不过，
    // 单独验证 importBytes 路径：清空后恢复
    dst.store.items.length = 0;
    const res = await dst.B.restoreIfEmpty();
    eq(res.restored, true);
    eq(dst.store.items.map((i) => i.id).join(','), 'keep', '台账随备份走，删除不还魂');
    eq(dst.store.dels.get('gone'), T0 + 5);
  });

  test('clear() 删除双键 —— 清空学习库不许还魂', async () => {
    const { B, chrome } = setup({ items: [card('a')] });
    await B.maybeRun(T0);
    ok(chrome._store.learnBackup);
    await B.clear();
    eq(chrome._store.learnBackup, undefined);
    eq(chrome._store.learnBackupMeta, undefined);
  });

  test('超限跳过并把原因写进 meta（可见，不静默），旧备份不被覆盖', async () => {
    // vm 沙箱无 CompressionStream ⇒ 字节 = 明文 JSONL；3MB+ 文本必超 4MB base64。
    const big = 'x'.repeat(10000);
    const items = [];
    for (let i = 0; i < 320; i++) items.push(card('c' + i, { text: big + i, tr: big }));
    const { B, chrome } = setup({ items, storage: { learnBackup: { v: 1, at: 1, b64: 'KEEP' } } });
    const r = await B.maybeRun(T0 + 10 * 3600e3);
    eq(r.ran, false);
    eq(r.reason, 'oversize');
    ok(/oversize:/.test(chrome._store.learnBackupMeta.lastError), '原因必须落在 meta 供界面呈现');
    eq(chrome._store.learnBackup.b64, 'KEEP', '超限时旧备份必须原样保留');
  });
});
