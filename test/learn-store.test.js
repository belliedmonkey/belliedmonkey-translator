// test/learn-store.test.js — what this device forgets.
//
// `learn/store.js` has never had a test, because it is IndexedDB and the zero-dep vm
// harness has no IndexedDB. But the module BODY never touches it — `open()` does,
// lazily — so the file loads fine against a stub, and the two decisions that actually
// discard user data can be asserted on directly.
//
// That split is the point: everything else in store.js is "write what the pure
// function returned". These are the parts where a wrong answer loses material the
// user cannot get back, so these are the parts that must not rest on inspection.
//
// STILL NOT COVERED HERE (see docs/verification-spec.md): the v2→v3 upgrade on a real
// database, and the IndexedDB writes themselves. Those need a real browser.

const { loadModule, describe, test, eq, ok } = require('./harness');

function store() {
  // A stub that would throw if touched — proof the module body really is IO-free.
  const indexedDB = { open: () => { throw new Error('store.js touched indexedDB at load time'); } };
  return loadModule('learn/store.js', { window: {}, indexedDB, LearnModel: {}, LearnScheduler: {} }).LearnStore;
}

const T0 = 1700000000000;
const item = (id, over) => Object.assign({
  id, state: 'candidate', starred: false, salience: 0.5, createdAt: T0,
}, over);

describe('LearnStore — eviction picks what the scheduler already gave up on', () => {
  const S = store();

  test('under the cap, nothing is doomed', () => {
    eq(S.doomedFor([item('a'), item('b')], 5).length, 0);
  });

  test('a starred card is never evicted, even as the worst candidate by every rank', () => {
    // Starring is the one explicit "keep this" the user has. If pressure could
    // override it the feature would be worse than useless — it would be a lie.
    const items = [
      item('star', { state: 'known', salience: 0, createdAt: 0, starred: true }),
      item('plain', { state: 'known', salience: 0.9, createdAt: T0 }),
    ];
    const doomed = S.doomedFor(items, 1).map((i) => i.id);
    eq(doomed.join(','), 'plain');
  });

  test("'known' goes before a candidate, which goes before what you are learning", () => {
    const items = [
      item('learning', { state: 'learning' }),
      item('candidate', { state: 'candidate' }),
      item('known', { state: 'known' }),
    ];
    eq(S.doomedFor(items, 1).map((i) => i.id).join(','), 'known,candidate');
  });

  test('within a state, lowest salience first, then oldest', () => {
    const items = [
      item('hi', { salience: 0.9, createdAt: T0 }),
      item('lo', { salience: 0.1, createdAt: T0 }),
      item('mid-old', { salience: 0.5, createdAt: 1 }),
      item('mid-new', { salience: 0.5, createdAt: T0 }),
    ];
    eq(S.doomedFor(items, 1).map((i) => i.id).join(','), 'lo,mid-old,mid-new');
  });

  test('a corpus of nothing but starred cards over the cap evicts NOTHING', () => {
    // The corpus then sits over its cap, which is correct: the alternative is
    // breaking the starred promise, and §7.1 already requires the pressure to be
    // visible to the user rather than resolved behind their back.
    const items = ['a', 'b', 'c'].map((id) => item(id, { starred: true }));
    eq(S.doomedFor(items, 1).length, 0);
  });
});

describe('LearnStore — tombstones are bounded, and forget the oldest (§7.3)', () => {
  const S = store();

  test('under the cap nothing is forgotten', () => {
    eq(S.staleTombs([{ id: 'a', at: 1 }, { id: 'b', at: 2 }], 5).length, 0);
  });

  test('the OLDEST tombstones go first', () => {
    // Direction matters and is easy to get backwards. Forgetting the NEWEST would
    // un-evict what the user just cleaned up — the exact churn §7.3 exists to stop —
    // while forgetting the oldest degrades to pre-tombstone behaviour for material
    // they let go of long ago.
    const rows = [{ id: 'new', at: 300 }, { id: 'old', at: 100 }, { id: 'mid', at: 200 }];
    eq(S.staleTombs(rows, 1).map((r) => r.id).join(','), 'old,mid');
  });

  test('a tombstone with no timestamp is treated as the oldest, not the newest', () => {
    // Rows written before `at` existed must not outrank real ones and survive
    // forever while fresher tombstones are dropped around them.
    const rows = [{ id: 'dated', at: 500 }, { id: 'undated' }];
    eq(S.staleTombs(rows, 1).map((r) => r.id).join(','), 'undated');
  });

  test('trimming does not reorder the caller\'s array', () => {
    // `staleTombs` sorts, and an in-place sort of the caller's rows would silently
    // corrupt any later use of them.
    const rows = [{ id: 'c', at: 3 }, { id: 'a', at: 1 }, { id: 'b', at: 2 }];
    S.staleTombs(rows, 1);
    eq(rows.map((r) => r.id).join(','), 'c,a,b');
  });
});

describe('LearnStore — the user-delete ledger is bounded the same way (§7.4)', () => {
  const S = store();

  test('under the cap nothing is forgotten', () => {
    eq(S.staleDels([{ id: 'a', at: 1 }, { id: 'b', at: 2 }], 5).length, 0);
  });

  test('the OLDEST deletes go first — a forgotten delete degrades to "the card returns once"', () => {
    const rows = [{ id: 'new', at: 300 }, { id: 'old', at: 100 }, { id: 'mid', at: 200 }];
    eq(S.staleDels(rows, 1).map((r) => r.id).join(','), 'old,mid');
  });

  test('trimming does not reorder the caller\'s array', () => {
    const rows = [{ id: 'c', at: 3 }, { id: 'a', at: 1 }, { id: 'b', at: 2 }];
    S.staleDels(rows, 1);
    eq(rows.map((r) => r.id).join(','), 'c,a,b');
  });
});

describe('LearnStore — the module is IO-free until you call it', () => {
  test('loading store.js does not open a database', () => {
    // If this ever regresses, store.js becomes unloadable in any context without
    // IndexedDB — and it is loaded by the popup and options pages too.
    ok(store().doomedFor, 'loaded without touching indexedDB');
  });
});

// ─── §8.4.1 — a rejected open() must not be memoized ─────────────────────────
// One transient IndexedDB failure (first launch after an update, mid-
// onupgradeneeded, is the classic moment) used to stick for the whole page
// session: every later call failed instantly and the app painted "signed out /
// empty" until relaunch. Success stays memoized; failure retries.

describe('LearnStore — open() 拒绝不粘（§8.4.1）', () => {
  const { rejects } = require('./harness');

  function storeWithFlakyIdb() {
    let calls = 0;
    const fakeDb = { objectStoreNames: { contains: () => true } };
    const indexedDB = {
      open: () => {
        calls++;
        const req = {};
        setTimeout(() => {
          if (calls === 1) { req.error = new Error('transient idb failure'); req.onerror && req.onerror(); }
          else { req.result = fakeDb; req.onsuccess && req.onsuccess(); }
        }, 0);
        return req;
      },
    };
    const S = loadModule('learn/store.js', { window: {}, indexedDB, LearnModel: {}, LearnScheduler: {}, setTimeout, clearTimeout }).LearnStore;
    return { S, fakeDb, callCount: () => calls };
  }

  test('第一次失败、第二次成功 —— 失败不被记忆，成功之后才记忆', async () => {
    const { S, fakeDb, callCount } = storeWithFlakyIdb();
    await rejects(S.open(), /transient idb failure/);
    const db = await S.open();
    eq(db, fakeDb, '存储恢复后的下一次调用必须自愈');
    eq(callCount(), 2);
    const again = await S.open();
    eq(again, fakeDb);
    eq(callCount(), 2, '成功路径的记忆保持不变 —— 不许每次都重开数据库');
  });
});
