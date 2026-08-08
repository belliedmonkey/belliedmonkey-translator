// v2 → v3 upgrade, MEASURED in a real Chrome rather than reasoned about.
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
// One thing it CANNOT prove: the `contains` guard around a brand-new store. On the
// v2→v3 path that store does not exist yet, so guarded and unguarded behave
// identically. The guard is a convention for paths that skip versions, not something
// this run exercises — do not read a green here as evidence for it.
'use strict';
const REPO = require('path').join(__dirname, '..');
const { launchChrome } = require(REPO + '/test/layout/chrome.js');
const { CDP } = require(REPO + '/test/layout/cdp.js');
const fs = require('fs');
const http = require('http');

const STORE_SRC = fs.readFileSync(REPO + '/extension/learn/store.js', 'utf8');

const SEED_PREV = `new Promise((resolve) => {
  const req = indexedDB.open('mt-learn', 3);
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
  };
  req.onsuccess = () => {
    const db = req.result;
    // v3 has NO 'notes' store — asking for it here throws synchronously and the
    // promise never settles (the exact hang this file's header warns about; this
    // seed had it once, from a careless replace that hit the wrong transaction).
    const t = db.transaction(['items','meta','reviews','tombs'],'readwrite');
    t.objectStore('items').put({ id:'old-1', text:'kept across upgrade', state:'known', salience:0.4, createdAt:1 });
    t.objectStore('items').put({ id:'old-2', text:'also kept', state:'candidate', salience:0.2, createdAt:2 });
    t.objectStore('meta').put({ k:'syncPushedAt', v:12345 });
    t.objectStore('reviews').add({ itemId:'old-1', grade:3, at:999 });
    t.objectStore('tombs').put({ id:'old-tomb', at: 5 });
    t.oncomplete = () => { db.close(); resolve('seeded v3'); };
    t.onerror = () => resolve('SEED TX FAILED: ' + t.error);
  };
  req.onerror = () => resolve('SEED FAILED: ' + req.error);
})`;

// The try/catch is load-bearing, not decoration. `db.transaction([... 'tombs'])`
// throws SYNCHRONOUSLY when the store is missing — which is exactly what a botched
// upgrade produces — and without this the throw escapes the .then, the promise never
// settles, and the checker HANGS. A check that hangs is indistinguishable from one
// still working, so a real defect reads as "still running" instead of "✗".
const CHECK_NEXT = `new Promise((resolve) => {
  LearnStore.open().then((db) => {
   try {
    const out = { version: db.version, stores: [...db.objectStoreNames].sort() };
    const t = db.transaction(['items','meta','reviews','tombs','notes'],'readwrite');
    const gi = t.objectStore('items').getAll();
    const gm = t.objectStore('meta').getAll();
    const gr = t.objectStore('reviews').getAll();
    const gt = t.objectStore('tombs').getAll();
    t.objectStore('notes').put({ id:'n1', data:{ words:[] }, at: 9 });
    const gn = t.objectStore('notes').getAll();
    t.oncomplete = () => {
      out.items = gi.result.map(i => i.id).sort();
      out.itemText = (gi.result.find(i=>i.id==='old-1')||{}).text;
      out.meta = gm.result;
      out.reviews = gr.result.length;
      out.tombs = gt.result;
      out.notes = gn.result;
      out.itemIndexes = [...db.transaction('items').objectStore('items').indexNames].sort();
      resolve(JSON.stringify(out));
    };
    t.onerror = () => resolve('TX FAILED: ' + t.error);
   } catch (e) { resolve('THREW: ' + (e && e.name) + ' ' + (e && e.message)); }
  }, (e) => resolve('OPEN REJECTED: ' + e));
})`;

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
    // Load store.js exactly as the extension does: a plain script that defines a global.
    await evalIn(STORE_SRC + '\n;"loaded"');
    const raw = await evalIn(CHECK_NEXT);
    console.log('  v3  :', raw);

    if (typeof raw !== 'string' || raw[0] !== '{') {
      throw new Error('检查没有拿到结果，而是: ' + raw);
    }
    const o = JSON.parse(raw);
    const need = (cond, msg) => { if (!cond) { ok = false; console.log('  ✗ ' + msg); } };
    need(o.version === 4, 'version 不是 4，是 ' + o.version);
    need(o.stores.join(',') === 'audio,items,meta,notes,reviews,sources,tombs', '表集合不对: ' + o.stores);
    need(o.items.join(',') === 'old-1,old-2', 'v2 的条目丢了: ' + o.items);
    need(o.itemText === 'kept across upgrade', '条目内容被改写了');
    need(o.reviews === 1, '复习记录丢了');
    need(JSON.stringify(o.meta) === '[{"k":"syncPushedAt","v":12345}]', 'meta 丢了/变了: ' + JSON.stringify(o.meta));
    need(o.itemIndexes.join(',') === 'createdAt,lang,salience,state', 'items 索引被改动了: ' + o.itemIndexes);
    need(o.tombs.length === 1 && o.tombs[0].id === 'old-tomb', 'v3 的墓碑丢了: ' + JSON.stringify(o.tombs));
    need(o.notes.length === 1 && o.notes[0].id === 'n1', 'notes 不可写');
  } catch (e) { ok = false; console.log('  ✗ ' + (e && e.stack)); }
  chrome.cleanup(); srv.close();
  console.log(ok ? '\n✓ v3→v4：旧数据完整保留（含墓碑），notes 已建且可写' : '\n✗ 升级路径有问题');
  process.exit(ok ? 0 : 1);
})();
