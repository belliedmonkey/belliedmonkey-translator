// v4 → v5 upgrade, MEASURED in a real Chrome rather than reasoned about.
//
// The claim under test is store.js's own comment: "every create is guarded by
// `contains`, so bumping the version never touches existing data." That holds right
// up until someone adds an index to an EXISTING store — which `contains` does not
// guard at all — and the failure would land on users who already have a corpus, the
// worst possible audience for it.
//
// Runs on a local http origin, not the extension origin. IndexedDB upgrade semantics
// are origin-independent, and store.js's own `open()` is what executes, so this tests
// the SHIPPED upgrade path rather than a retyped copy of it.
//
// ─── Run this on EVERY `DB_VERSION` bump ─────────────────────────────────────
//   npm run test:idb          (needs Chrome; see docs/verification-spec.md §3.3)
//
// `SEED_PREV` below is the schema of the version users are UPGRADING FROM. When the
// version moves again, seed the then-current shipped schema — the whole value of this
// check is that it starts from what real users actually have on disk.
//
// What it caught while being written (all three verified by deliberately breaking
// store.js and watching this go red):
//   · forgetting to bump DB_VERSION       → the new store is never created
//   · adding an index to an EXISTING store → `contains` does not guard that at all
//   · deleting and recreating a store      → every user's corpus silently emptied
//
// The v4→v5 scene alone CANNOT prove the `contains` guard around a brand-new store:
// on that path every store already exists, so guarded and unguarded behave
// identically. Scene 2 below exists for exactly that gap — per-account databases
// (§account switch) create a store set FROM NOTHING, which is the only path where
// that guard is the branch actually taken.
//
// The v5 run ALSO exercises `deleteItems` (§7.4) against the upgraded data, because
// its three claims — item AND its reviews go, the ledger records it, `everEvicted`
// stays untouched — are IndexedDB plumbing `npm test` structurally cannot see.
'use strict';
const REPO = require('path').join(__dirname, '..');
const { launchChrome } = require(REPO + '/test/layout/chrome.js');
const { CDP } = require(REPO + '/test/layout/cdp.js');
const fs = require('fs');
const http = require('http');

const MODEL_SRC = fs.readFileSync(REPO + '/extension/content/learn-model.js', 'utf8');
const STORE_SRC = fs.readFileSync(REPO + '/extension/learn/store.js', 'utf8');

const SEED_PREV = `new Promise((resolve) => {
  const req = indexedDB.open('mt-learn', 4);
  req.onupgradeneeded = () => {
    const db = req.result;
    const s = db.createObjectStore('items', { keyPath: 'id' });
    s.createIndex('state','state'); s.createIndex('lang','lang');
    s.createIndex('createdAt','createdAt'); s.createIndex('salience','salience');
    db.createObjectStore('sources', { keyPath: 'id' });
    const r = db.createObjectStore('reviews', { keyPath: 'seq', autoIncrement: true });
    r.createIndex('itemId','itemId'); r.createIndex('at','at');
    db.createObjectStore('meta', { keyPath: 'k' });
    const a = db.createObjectStore('audio', { keyPath: 'k' });
    a.createIndex('at','at'); a.createIndex('bytes','bytes');
    const tb = db.createObjectStore('tombs', { keyPath: 'id' });
    tb.createIndex('at','at');
    db.createObjectStore('notes', { keyPath: 'id' });
  };
  req.onsuccess = () => {
    const db = req.result;
    // v4 has NO 'dels' store — asking for it here throws synchronously and the
    // promise never settles (the exact hang this file's header warns about).
    const t = db.transaction(['items','meta','reviews','tombs','notes'],'readwrite');
    t.objectStore('items').put({ id:'old-1', text:'kept across upgrade', state:'known', salience:0.4, createdAt:1 });
    t.objectStore('items').put({ id:'old-2', text:'also kept', state:'candidate', salience:0.2, createdAt:2 });
    t.objectStore('meta').put({ k:'syncPushedAt', v:12345 });
    t.objectStore('reviews').add({ itemId:'old-1', grade:3, at:999 });
    t.objectStore('reviews').add({ itemId:'old-2', grade:2, at:998 });
    t.objectStore('tombs').put({ id:'old-tomb', at: 5 });
    t.objectStore('notes').put({ id:'old-note', data:{ words:[] }, at: 7 });
    t.oncomplete = () => { db.close(); resolve('seeded v4'); };
    t.onerror = () => resolve('SEED TX FAILED: ' + t.error);
  };
  req.onerror = () => resolve('SEED FAILED: ' + req.error);
})`;

// The try/catch is load-bearing, not decoration. `db.transaction([... 'dels'])`
// throws SYNCHRONOUSLY when the store is missing — which is exactly what a botched
// upgrade produces — and without this the throw escapes the .then, the promise never
// settles, and the checker HANGS. A check that hangs is indistinguishable from one
// still working, so a real defect reads as "still running" instead of "✗".
const CHECK_NEXT = `new Promise((resolve) => {
  LearnStore.open().then((db) => {
   try {
    const out = { version: db.version, stores: [...db.objectStoreNames].sort() };
    const t = db.transaction(['items','meta','reviews','tombs','notes','dels'],'readwrite');
    const gi = t.objectStore('items').getAll();
    const gm = t.objectStore('meta').getAll();
    const gr = t.objectStore('reviews').getAll();
    const gt = t.objectStore('tombs').getAll();
    const gn = t.objectStore('notes').getAll();
    t.objectStore('dels').put({ id:'d1', at: 11 });
    const gd = t.objectStore('dels').getAll();
    t.oncomplete = () => {
      out.items = gi.result.map(i => i.id).sort();
      out.itemText = (gi.result.find(i=>i.id==='old-1')||{}).text;
      out.meta = gm.result;
      out.reviews = gr.result.length;
      out.tombs = gt.result;
      out.notes = gn.result.map(n => n.id);
      out.dels = gd.result;
      out.itemIndexes = [...db.transaction('items').objectStore('items').indexNames].sort();
      resolve(JSON.stringify(out));
    };
    t.onerror = () => resolve('TX FAILED: ' + t.error);
   } catch (e) { resolve('THREW: ' + (e && e.name) + ' ' + (e && e.message)); }
  }, (e) => resolve('OPEN REJECTED: ' + e));
})`;

// ─── 第二幕：从零创建一个按账号库 ────────────────────────────────────────
// 分库把一条以前走不到的路变成了日常路径：**一个全新的库**。这里的判据有两条，
// 第二条才是分库的全部意义 —— 新库建出来之后，主库必须一寸未动。
const CHECK_FRESH = `new Promise((resolve) => {
  const out = {};
  LearnStore.useDb(LearnStore.dbNameFor('u-second'))
    .then(() => LearnStore.open())
    .then((db) => {
      out.name = db.name;
      out.version = db.version;
      out.stores = [...db.objectStoreNames].sort();
      out.itemIndexes = [...db.transaction('items').objectStore('items').indexNames].sort();
      return LearnStore.putItem({ id:'second-1', text:'belongs to the other account',
                                  lang:'en', createdAt: 1, state:'candidate' });
    })
    .then(() => LearnStore.allItems())
    .then((its) => { out.freshItems = its.map((i) => i.id).sort(); })
    .then(() => LearnStore.useDb(LearnStore.DB_NAME))
    .then(() => LearnStore.allItems())
    .then((back) => { out.primaryItems = back.map((i) => i.id).sort(); resolve(JSON.stringify(out)); })
    .catch((e) => resolve('THREW: ' + (e && (e.stack || e.message || e))));
})`;

// §7.4 against the UPGRADED database: the shipped deleteItems, not a retype.
const CHECK_DELETE = `LearnStore.deleteItems(['old-1'], 50000)
  .then((n) => Promise.all([
    Promise.resolve(n),
    LearnStore.allItems(), LearnStore.allReviews(), LearnStore.allDels(),
    LearnStore.hasEverEvicted(),
  ]))
  .then(([n, items, reviews, dels, evicted]) => JSON.stringify({
    deleted: n,
    items: items.map(i => i.id).sort(),
    reviews: reviews.map(r => r.itemId),
    ledger: dels.map(d => d.id).sort(),
    everEvicted: evicted,
  }), (e) => 'DELETE FAILED: ' + e)`;

setTimeout(() => { console.log('\n✗ 超时（90s），没有结论'); process.exit(2); }, 90000).unref();

(async () => {
  const srv = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset=utf-8><title>idb</title>');
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/';

  const chrome = await launchChrome();
  let ok = true;
  try {
    const cdp = await CDP.connect(chrome.port);
    const targets = await cdp.send('Target.getTargets', {});
    const page = targets.targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await new Promise((r) => setTimeout(r, 800));

    const evalIn = async (expression) => {
      const r = await cdp.send('Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) {
        return 'EXCEPTION: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description);
      }
      return r.result && r.result.value;
    };

    console.log('  seed:', await evalIn(SEED_PREV));
    // Load exactly as the extension does: plain scripts defining globals.
    // learn-model.js first — store.js's deleteItems reads LearnModel.touchedAt.
    await evalIn(MODEL_SRC + '\n;' + STORE_SRC + '\n;"loaded"');
    const raw = await evalIn(CHECK_NEXT);
    console.log('  v5  :', raw);

    if (typeof raw !== 'string' || raw[0] !== '{') {
      throw new Error('检查没有拿到结果，而是: ' + raw);
    }
    const o = JSON.parse(raw);
    const need = (cond, msg) => { if (!cond) { ok = false; console.log('  ✗ ' + msg); } };
    need(o.version === 5, 'version 不是 5，是 ' + o.version);
    need(o.stores.join(',') === 'audio,dels,items,meta,notes,reviews,sources,tombs', '表集合不对: ' + o.stores);
    need(o.items.join(',') === 'old-1,old-2', 'v4 的条目丢了: ' + o.items);
    need(o.itemText === 'kept across upgrade', '条目内容被改写了');
    need(o.reviews === 2, '复习记录丢了');
    need(JSON.stringify(o.meta) === '[{"k":"syncPushedAt","v":12345}]', 'meta 丢了/变了: ' + JSON.stringify(o.meta));
    need(o.itemIndexes.join(',') === 'createdAt,lang,salience,state', 'items 索引被改动了: ' + o.itemIndexes);
    need(o.tombs.length === 1 && o.tombs[0].id === 'old-tomb', 'v4 的墓碑丢了: ' + JSON.stringify(o.tombs));
    need(o.notes.join(',') === 'old-note', 'v4 的 notes 丢了: ' + o.notes);
    need(o.dels.length === 1 && o.dels[0].id === 'd1', 'dels 不可写');

    const rawDel = await evalIn(CHECK_DELETE);
    console.log('  del :', rawDel);
    if (typeof rawDel !== 'string' || rawDel[0] !== '{') throw new Error('删除检查没有结果: ' + rawDel);
    const d = JSON.parse(rawDel);
    need(d.deleted === 1, 'deleteItems 报数不对: ' + d.deleted);
    need(d.items.join(',') === 'old-2', '删错了条目: ' + d.items);
    need(d.reviews.join(',') === 'old-2', '被删卡的复习行必须一并删: ' + d.reviews);
    need(d.ledger.join(',') === 'd1,old-1', '台账没落: ' + d.ledger);
    need(d.everEvicted === false, '用户删除绝不能碰 everEvicted（否则本机永久失去压实资格）');

    const rawFresh = await evalIn(CHECK_FRESH);
    console.log('  new :', rawFresh);
    if (typeof rawFresh !== 'string' || rawFresh[0] !== '{') throw new Error('全新库检查没有结果: ' + rawFresh);
    const n = JSON.parse(rawFresh);
    need(n.name === 'mt-learn-u-second', '库名不对: ' + n.name);
    need(n.version === 5, '全新库的 version 不是 5，是 ' + n.version);
    need(n.stores.join(',') === 'audio,dels,items,meta,notes,reviews,sources,tombs',
      '全新库的表集合不全 —— `contains` 守卫这条路上是唯一被执行的分支: ' + n.stores);
    need(n.itemIndexes.join(',') === 'createdAt,lang,salience,state',
      '全新库的 items 索引不全: ' + n.itemIndexes);
    need(n.freshItems.join(',') === 'second-1',
      '全新库看见了别的账号的条目 —— 分库没有生效: ' + n.freshItems);
    need(n.primaryItems.join(',') === 'old-2',
      '建了新库之后主库被动过 —— 分库的全部意义就是它不该被动: ' + n.primaryItems);
  } catch (e) { ok = false; console.log('  ✗ ' + (e && e.stack)); }
  chrome.cleanup(); srv.close();
  console.log(ok ? '\n✓ v4→v5 旧数据完整保留 + 按账号新库从零建全且不碰主库' : '\n✗ 升级路径有问题');
  process.exit(ok ? 0 : 1);
})();
