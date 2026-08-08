// test/learn-sync.test.js — auth and the sync client.
//
// What is asserted here is mostly what must NOT happen: that a full account does not
// look like a successful upload, that a failed push is retried rather than skipped,
// that one bad row cannot wedge sync forever, and that a half-completed account
// deletion is never reported as a whole one. Those are the paths a happy-path test
// run never reaches and a user hits on their worst day.

const { loadModule, describe, test, ok, eq, rejects } = require('./harness');

const BACKEND = {
  url: 'https://example.supabase.co',
  anonKey: 'anon-key',
  table: 'bt_chunks',
  quotaBytes: 50 * 1024 * 1024,
};

const T0 = 1700000000000;

function card(id, over) {
  return Object.assign({
    id, text: 'Sentence ' + id, tr: '译文 ' + id, lang: 'en', sourceId: 'src1',
    state: 'learning', starred: false, createdAt: T0, lastSeenAt: T0, seenCount: 1,
    sched: { s: 3, d: 5, lastReviewAt: T0, dueAt: T0, reps: 1, lapses: 0 },
  }, over);
}

// A fetch that answers from a queue of handlers and records every request.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: (init && init.method) || 'GET', init });
    for (const r of routes) {
      if (r.match(url, init)) return r.reply(url, init);
    }
    return { ok: true, status: 200, text: async () => '[]', json: async () => [] };
  };
  fn.calls = calls;
  return fn;
}
const reply = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => (body == null ? '' : JSON.stringify(body)),
  json: async () => body,
});

function fakeStore(seed = {}) {
  const meta = Object.assign({}, seed.meta);
  const items = (seed.items || []).slice();
  const reviews = (seed.reviews || []).slice();
  const sources = (seed.sources || []).slice();
  const bumps = [];
  return {
    meta, items, reviews, sources, bumps,
    getMeta: (k, d) => Promise.resolve(k in meta ? meta[k] : d),
    setMeta: (k, v) => { meta[k] = v; return Promise.resolve(); },
    allItems: () => Promise.resolve(items.slice()),
    allSources: () => Promise.resolve(sources.slice()),
    allReviews: () => Promise.resolve(reviews.slice()),
    mergeBatch: (inc) => { let added = 0; for (const c of inc) if (!items.some((x) => x.id === c.id)) { items.push(c); added++; } return Promise.resolve(added); },
    recordReview: (itemId, grade, at) => { reviews.push({ itemId, grade, at }); return Promise.resolve(); },
    evictIfNeeded: () => Promise.resolve(0),
    // §7.3. Defaults are the "nothing has been evicted here" case, so every test
    // written before tombstones existed keeps the meaning it was written with.
    tombstones: () => Promise.resolve(new Set(seed.tombs || [])),
    hasEverEvicted: () => Promise.resolve(!!seed.everEvicted),
    bumpPressure: (f, n) => { bumps.push({ f, n }); return Promise.resolve(); },
  };
}

function setup(opts = {}) {
  const LearnStore = opts.store || fakeStore();
  const fetchFn = opts.fetch || fakeFetch([]);
  const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;
  const LearnScheduler = loadModule('learn-scheduler.js', { window: {} }).LearnScheduler;
  const LearnChunk = loadModule('learn/chunk.js', {
    window: {}, LearnStore, LearnModel, LearnScheduler,
    TextEncoder, TextDecoder, Response, Date,
  }).LearnChunk;

  const LearnAuth = opts.auth || loadModule('learn/auth.js', {
    window: {}, MT_BACKEND: BACKEND, LearnStore, fetch: fetchFn, Date,
  }).LearnAuth;

  const LearnSync = loadModule('learn/sync.js', {
    window: {}, MT_BACKEND: BACKEND, LearnStore, LearnAuth, LearnChunk, LearnModel,
    fetch: fetchFn, Date, Math, TextEncoder, TextDecoder, Response,
  }).LearnSync;

  return { S: LearnSync, A: LearnAuth, C: LearnChunk, store: LearnStore, fetchFn };
}

// A signed-in session that will not expire during a test.
const liveSession = () => ({
  accessToken: 'tok', refreshToken: 'ref',
  expiresAt: Date.now() + 3600e3, email: 'a@b.c', userId: 'u1',
});

describe('LearnAuth — sessions', () => {
  function authOnly(routes, meta) {
    const store = fakeStore({ meta: meta || {} });
    const fetchFn = fakeFetch(routes);
    const A = loadModule('learn/auth.js', {
      window: {}, MT_BACKEND: BACKEND, LearnStore: store, fetch: fetchFn, Date,
    }).LearnAuth;
    return { A, store, fetchFn };
  }

  test('signed out yields a null token, which is not an error', async () => {
    const { A } = authOnly([]);
    eq(await A.token(), null);
  });

  test('verify() stores a session and token() returns it without a network call', async () => {
    const { A, fetchFn } = authOnly([{
      match: (u) => /\/verify$/.test(u),
      reply: () => reply(200, {
        access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
        user: { id: 'u1', email: 'a@b.c' },
      }),
    }]);
    const s = await A.verify('a@b.c', '123456');
    eq(s.email, 'a@b.c');
    const before = fetchFn.calls.length;
    eq(await A.token(), 'AT');
    eq(fetchFn.calls.length, before, 'a live token must not cost a request');
  });

  test('CONCURRENT callers on an expired token trigger exactly ONE refresh', async () => {
    // Rotating refresh tokens invalidate each other; a second in-flight refresh
    // therefore presents as a random sign-out that nobody can reproduce.
    let refreshes = 0;
    const { A } = authOnly([{
      match: (u) => /grant_type=refresh_token/.test(u),
      reply: () => {
        refreshes++;
        return reply(200, { access_token: 'NEW', refresh_token: 'RT2', expires_in: 3600, user: { id: 'u1' } });
      },
    }], { auth: { accessToken: 'OLD', refreshToken: 'RT', expiresAt: 1, email: 'a@b.c' } });

    const [a, b, c] = await Promise.all([A.token(), A.token(), A.token()]);
    eq(refreshes, 1);
    eq(a, 'NEW'); eq(b, 'NEW'); eq(c, 'NEW');
  });

  test('a REJECTED refresh signs out rather than retrying forever', async () => {
    const { A, store } = authOnly([{
      match: (u) => /grant_type=refresh_token/.test(u),
      reply: () => reply(400, { error: 'invalid_grant' }),
    }], { auth: { accessToken: 'OLD', refreshToken: 'DEAD', expiresAt: 1 } });
    eq(await A.token(), null);
    eq(store.meta.auth, null, 'the dead session must not be left on disk');
  });

  test('a network failure reads as offline, not as a bad code', async () => {
    const { A } = authOnly([{
      match: () => true,
      reply: () => { throw new Error('Failed to fetch'); },
    }]);
    await rejects(A.signIn('a@b.c'), (e) => e.code === 'offline');
  });

  test('sign-out drops the local session even when the provider errors', async () => {
    const { A, store } = authOnly([{ match: () => true, reply: () => reply(500, { msg: 'nope' }) }],
      { auth: liveSession() });
    await A.signOut();
    eq(store.meta.auth, null);
    eq(await A.token(), null);
  });

  test('a FAILED account deletion is reported as partial, never as success', async () => {
    // The rows really are gone and the account really is not. Reporting "deleted"
    // here would be a claim the user has no way to check.
    const { A } = authOnly([
      { match: (u, i) => i && i.method === 'DELETE', reply: () => reply(204, null) },
      { match: (u) => /functions\/v1/.test(u), reply: () => reply(500, { error: 'boom' }) },
    ], { auth: liveSession() });
    const r = await A.deleteAccount();
    eq(r.data, true);
    eq(r.account, false, 'the account half failed and must say so');
    ok(r.reason, 'a partial result without a reason is not actionable');
  });

  test('a full deletion reports both halves', async () => {
    const { A, store } = authOnly([
      { match: (u, i) => i && i.method === 'DELETE', reply: () => reply(204, null) },
      { match: (u) => /functions\/v1/.test(u), reply: () => reply(200, { deleted: 'u1' }) },
    ], { auth: liveSession() });
    const r = await A.deleteAccount();
    eq(r.data, true); eq(r.account, true);
    eq(store.meta.auth, null);
  });
});

describe('LearnSync — push', () => {
  test('signed out, push refuses with a code rather than silently doing nothing', async () => {
    const { S } = setup({ store: fakeStore({ items: [card('a')] }) });
    await rejects(S.push(T0 + 1), (e) => e.code === 'signed_out');
  });

  test('only cards touched SINCE the last push travel', async () => {
    const store = fakeStore({
      meta: { auth: liveSession(), syncPushedAt: T0 + 100 },
      items: [card('old'), card('new', { lastSeenAt: T0 + 500 })],
      sources: [{ id: 'src1', url: 'u' }],
    });
    let body = null;
    const fetchFn = fakeFetch([{
      match: (u, i) => i && i.method === 'POST',
      reply: (u, i) => { body = JSON.parse(i.body); return reply(201, [{ seq: 1 }]); },
    }]);
    const { S, C } = setup({ store, fetch: fetchFn });
    const r = await S.push(T0 + 1000);
    eq(r.pushed, 1);
    const text = await C.inflate(S.fromHex(body.blob));
    const back = C.fromJsonl(text);
    eq(back.cards.length, 1);
    eq(back.cards[0].id, 'new');
    eq(body.kind, 'bundle');
  });

  test('nothing to say ⇒ no row is written at all', async () => {
    const store = fakeStore({ meta: { auth: liveSession(), syncPushedAt: T0 + 100 }, items: [card('old')] });
    const fetchFn = fakeFetch([]);
    const { S } = setup({ store, fetch: fetchFn });
    const r = await S.push(T0 + 200);
    eq(r.pushed, 0);
    eq(fetchFn.calls.filter((c) => c.method === 'POST').length, 0,
      'an empty chunk would burn quota to say nothing');
  });

  // Reversed 2026-08-07 with §8.5 lever 1. This test used to assert the opposite
  // ("candidates never leave the device"), and that assertion is exactly what the
  // host app deadlocks on: a card only enters the deck by being reviewed, so a user
  // who reviews only in the app would push nothing forever.
  test('a corpus of nothing but candidates IS pushed', async () => {
    const store = fakeStore({
      meta: { auth: liveSession() },
      items: [card('cand', { state: 'candidate', sched: null, lastSeenAt: T0 + 900 })],
    });
    const fetchFn = fakeFetch([]);
    const { S } = setup({ store, fetch: fetchFn });
    eq((await S.push(T0 + 1000)).pushed, 1, '不上行 = App 永远拿不到第一张卡');
    eq(fetchFn.calls.filter((c) => c.method === 'POST').length, 1);
  });

  // ─── Batching (§8.4) ──────────────────────────────────────────────────────
  // Before the candidate pool travelled, a push was a few hundred cards and one
  // request was fine. Now the first push after signing in is the whole corpus —
  // ~20,000 items, ~1.7 MB compressed, and PostgREST carries bytea as a `\x` hex
  // literal, so a ~3.4 MB body in a single request that either lands or does not.

  test('a corpus larger than one batch is split across several chunks', async () => {
    const items = [];
    for (let i = 0; i < 450; i++) items.push(card('c' + i));
    const store = fakeStore({ meta: { auth: liveSession() }, items });
    const fetchFn = fakeFetch([]);
    const { S } = setup({ store, fetch: fetchFn });

    const r = await S.push(T0 + 1000);
    eq(r.chunks, 3, '450 张按 200 一批 = 3 个块');
    eq(r.pushed, 450, '分批不能丢卡');
    eq(fetchFn.calls.filter((c) => c.method === 'POST').length, 3);
  });

  test('every card appears in exactly one chunk — no gap, no duplicate', async () => {
    // The assertion that actually catches an off-by-one in the slice loop. A count
    // alone would survive `i += PUSH_BATCH - 1` (overlap) or a dropped tail.
    const items = [];
    for (let i = 0; i < 450; i++) items.push(card('c' + i));
    const store = fakeStore({ meta: { auth: liveSession() }, items });
    const posts = [];
    const fetchFn = fakeFetch([{
      match: (u, i) => i && i.method === 'POST',
      reply: (u, i) => { posts.push(JSON.parse(i.body)); return reply(201, [{ seq: posts.length }]); },
    }]);
    const { S, C } = setup({ store, fetch: fetchFn });

    await S.push(T0 + 1000);
    const seen = [];
    for (const p of posts) {
      const text = await C.inflate(S.fromHex(p.blob));
      for (const c of C.fromJsonl(text).cards) seen.push(c.id);
    }
    eq(seen.length, 450, '卡片总数对不上就是漏了或重了');
    eq(new Set(seen).size, 450, '同一张卡出现在两个块里 = 重复计费');
  });

  test('a review whose card was EVICTED still reaches the server', async () => {
    // `evictIfNeeded` deletes items and leaves their reviews behind, so an orphan
    // review is a normal consequence of a full corpus, not a corruption. `build()`
    // drops reviews whose card is not in the bundle — so without explicit handling
    // this review is dropped while PUSHED advances past it: silent, permanent loss.
    const store = fakeStore({
      meta: { auth: liveSession() },
      items: [card('alive')],
      reviews: [{ itemId: 'alive', grade: 2, at: T0 + 500 },
        { itemId: 'evicted-card', grade: 3, at: T0 + 600 }],
    });
    const posts = [];
    const fetchFn = fakeFetch([{
      match: (u, i) => i && i.method === 'POST',
      reply: (u, i) => { posts.push(JSON.parse(i.body)); return reply(201, [{ seq: 1 }]); },
    }]);
    const { S, C } = setup({ store, fetch: fetchFn });

    const r = await S.push(T0 + 1000);
    eq(r.reviews, 2, '被淘汰卡片的复习记录也必须上行');
    const text = await C.inflate(S.fromHex(posts[0].blob));
    const ids = C.fromJsonl(text).reviews.map((x) => x.itemId).sort();
    eq(ids.join(','), 'alive,evicted-card');
  });

  test('QUOTA EXCEEDED is surfaced AND the material is kept for retry', async () => {
    const store = fakeStore({ meta: { auth: liveSession() }, items: [card('a')] });
    const fetchFn = fakeFetch([{
      match: (u, i) => i && i.method === 'POST',
      reply: () => reply(500, { code: '53100', message: 'bt: quota exceeded (…)' }),
    }]);
    const { S } = setup({ store, fetch: fetchFn });
    await rejects(S.push(T0 + 1), (e) => e.code === 'quota');
    eq(store.bumps.length, 1);
    eq(store.bumps[0].f, 'quotaBlocked');
    ok(!('syncPushedAt' in store.meta),
      'advancing the cursor past a failed push would lose that material forever');
  });
});

describe('LearnSync — pull', () => {
  function rowsFrom(C, bundles) {
    return Promise.all(bundles.map(async (b, i) => ({
      seq: i + 1,
      blob: '\\x' + Array.from(new TextEncoder().encode(C.toJsonl(b)))
        .map((n) => n.toString(16).padStart(2, '0')).join(''),
    })));
  }

  test('a pulled chunk is replayed and the cursor advances', async () => {
    const store = fakeStore({ meta: { auth: liveSession() } });
    let served = false;
    const holder = {};
    const fetchFn = fakeFetch([{
      match: (u, i) => (!i || i.method === 'GET') && /seq=gt/.test(u),
      reply: () => { if (served) return reply(200, []); served = true; return reply(200, holder.rows); },
    }]);
    const { S, C } = setup({ store, fetch: fetchFn });
    holder.rows = await rowsFrom(C, [C.build([card('x'), card('y')], [{ id: 'src1', url: 'u' }], [], T0)]);

    const r = await S.pull();
    eq(r.chunks, 1);
    eq(r.cards, 2);
    eq(store.items.length, 2);
    eq(store.meta.syncCursor, 1);
  });

  test('ONE unreadable row cannot wedge sync — it is skipped, counted, and passed', async () => {
    const store = fakeStore({ meta: { auth: liveSession() } });
    let served = false;
    const hex = (s) => '\\x' + Array.from(new TextEncoder().encode(s))
      .map((n) => n.toString(16).padStart(2, '0')).join('');
    const fetchFn = fakeFetch([{
      match: (u, i) => (!i || i.method === 'GET') && /seq=gt/.test(u),
      reply: () => {
        if (served) return reply(200, []);
        served = true;
        return reply(200, [{ seq: 7, blob: hex('{"format":"someone-else/9"}\n') }]);
      },
    }]);
    const { S } = setup({ store, fetch: fetchFn });
    const r = await S.pull();
    eq(r.skipped, 1);
    eq(r.chunks, 0);
    eq(store.meta.syncCursor, 7, 'the cursor MUST move past a row we cannot use');
  });
});

describe('LearnSync — a chunk from a NEWER client', () => {
  function serve(bundleJsonl) {
    const store = fakeStore({ meta: { auth: liveSession(), syncCursor: 3 } });
    let served = false;
    const hex = (s) => '\\x' + Array.from(new TextEncoder().encode(s))
      .map((n) => n.toString(16).padStart(2, '0')).join('');
    const fetchFn = fakeFetch([
      { match: (u, i) => (!i || i.method === 'GET') && /seq=gt/.test(u),
        reply: () => { if (served) return reply(200, []); served = true;
          return reply(200, [{ seq: 9, blob: hex(bundleJsonl) }]); } },
      { match: (u, i) => i && i.method === 'POST', reply: () => reply(201, [{ seq: 10 }]) },
    ]);
    return { store, fetchFn };
  }

  test('pull STALLS and does NOT advance the cursor', async () => {
    // Skipping would step over the row permanently: upgrading later would then
    // never recover it. A stalled sync is recoverable; a skipped chunk is not.
    const setupOnce = setup();
    const b = setupOnce.C.build([card('a')], [], [], T0);
    b.header.enc = 'age-x25519';
    const { store, fetchFn } = serve(setupOnce.C.toJsonl(b));
    const { S } = setup({ store, fetch: fetchFn });

    const r = await S.pull();
    eq(r.needsUpgrade, 'age-x25519');
    eq(r.chunks, 0);
    eq(store.meta.syncCursor, 3, 'THE CURSOR MUST NOT MOVE PAST IT');
  });

  test('sync() does not push on top of what it could not read', async () => {
    const setupOnce = setup();
    const b = setupOnce.C.build([card('a')], [], [], T0);
    b.header.enc = 'age-x25519';
    const { store, fetchFn } = serve(setupOnce.C.toJsonl(b));
    store.items.push(card('local'));
    const { S } = setup({ store, fetch: fetchFn });

    const r = await S.sync(T0 + 1000);
    ok(r.pulled.needsUpgrade, 'the stall is reported');
    eq(r.pushed, null, 'nothing was pushed');
    eq(fetchFn.calls.filter((c) => c.method === 'POST').length, 0,
      'a push would land above the stalled chunk and a later compaction could sweep it');
  });
});

describe('LearnSync — compaction', () => {
  test('below the threshold, compaction writes nothing', async () => {
    const store = fakeStore({ meta: { auth: liveSession() }, items: [card('a')] });
    const fetchFn = fakeFetch([{
      match: (u, i) => (!i || i.method === 'GET'),
      reply: () => reply(200, [{ seq: 1, generation: 0 }, { seq: 2, generation: 0 }]),
    }]);
    const { S } = setup({ store, fetch: fetchFn });
    eq((await S.compact(T0)).compacted, 0);
    eq(fetchFn.calls.filter((c) => c.method === 'POST' || c.method === 'DELETE').length, 0);
  });

  test('an EMPTY corpus never compacts — it would erase the account', async () => {
    // The delete is justified only by the snapshot being complete. A device that has
    // not pulled yet has an empty corpus, and letting it write a snapshot of nothing
    // and then sweep everything below would destroy the user's whole history on
    // behalf of the one device that knows the least.
    const store = fakeStore({ meta: { auth: liveSession() }, items: [] });
    const rows = [];
    for (let i = 1; i <= 45; i++) rows.push({ seq: i, generation: 0 });
    const fetchFn = fakeFetch([
      { match: (u, i) => i && i.method === 'DELETE', reply: () => reply(204, null) },
      { match: () => true, reply: () => reply(200, rows) },
    ]);
    const { S } = setup({ store, fetch: fetchFn });

    const r = await S.compact(T0);
    eq(r.compacted, 0);
    eq(r.skipped, 'empty-corpus', '要说清楚是为什么没压缩，不能静默返回 0');
    eq(fetchFn.calls.filter((c) => c.method === 'DELETE').length, 0,
      '一次 DELETE 就抹掉了整个账号的历史');
    eq(fetchFn.calls.filter((c) => c.method === 'POST' && !/rpc/.test(c.url)).length, 0);
  });

  test('a device that has EVER evicted never compacts (§7.3)', async () => {
    // The severe half of the eviction conflict. Such a device holds a working set,
    // not the archive; its snapshot is missing whatever it evicted, and the DELETE
    // that follows would remove those rows from the server permanently — for every
    // device, of material the user never asked to delete.
    //
    // A non-empty corpus deliberately: this must not be mistaken for the empty-corpus
    // guard, and it must fire even when the device looks perfectly healthy.
    const items = [];
    for (let i = 0; i < 300; i++) items.push(card('c' + i));
    const store = fakeStore({ meta: { auth: liveSession() }, items, everEvicted: true });
    const rows = [];
    for (let i = 1; i <= 45; i++) rows.push({ seq: i, generation: 0 });
    const fetchFn = fakeFetch([
      { match: (u, i) => i && i.method === 'DELETE', reply: () => reply(204, null) },
      { match: () => true, reply: () => reply(200, rows) },
    ]);
    const { S } = setup({ store, fetch: fetchFn });

    const r = await S.compact(T0);
    eq(r.compacted, 0);
    eq(r.skipped, 'ever-evicted');
    eq(fetchFn.calls.filter((c) => c.method === 'DELETE').length, 0,
      '这一次 DELETE 会把被淘汰的内容从所有设备上永久抹掉');
    eq(fetchFn.calls.filter((c) => c.method === 'POST' && !/rpc/.test(c.url)).length, 0);
  });

  test('a large snapshot is split, and every part is written BEFORE the sweep', async () => {
    // A snapshot is the whole corpus — up to the 20,000-item cap — so it needs the
    // same batching as a push. Splitting does not weaken what compaction rests on:
    // "complete" is a property of the SET of rows above the deletion point, not of
    // there being exactly one row. But the ORDER is load-bearing — if the delete ran
    // before the last part landed, the corpus would have a hole with nothing left
    // below to recover it.
    const items = [];
    for (let i = 0; i < 450; i++) items.push(card('c' + i));
    const store = fakeStore({ meta: { auth: liveSession() }, items });
    const rows = [];
    for (let i = 1; i <= 45; i++) rows.push({ seq: i, generation: 0 });
    const order = [], bodies = [];
    const fetchFn = fakeFetch([
      { match: (u, i) => i && i.method === 'POST' && !/rpc/.test(u),
        reply: (u, i) => { order.push('POST'); bodies.push(JSON.parse(i.body)); return reply(201, [{ seq: 46 }]); } },
      { match: (u, i) => i && i.method === 'DELETE',
        reply: () => { order.push('DELETE'); return reply(204, null); } },
      { match: () => true, reply: () => reply(200, rows) },
    ]);
    const { S, C } = setup({ store, fetch: fetchFn });

    const r = await S.compact(T0);
    eq(r.cards, 450, '快照必须完整，否则它没有资格取代下面的行');
    eq(bodies.length, 3, '450 张按 200 一批 = 3 个块');
    eq(order.indexOf('DELETE'), order.length - 1, 'DELETE 必须在所有分片写完之后');

    const seen = [];
    for (const b of bodies) {
      ok(b.generation === r.generation, '同一次压缩的所有分片必须同代');
      const text = await C.inflate(S.fromHex(b.blob));
      for (const c of C.fromJsonl(text).cards) seen.push(c.id);
    }
    eq(new Set(seen).size, 450, '快照缺一张卡，就是把它从服务器上抹掉了');
  });

  test('a snapshot is COMPLETE and only rows at-or-below it are swept', async () => {
    const store = fakeStore({
      meta: { auth: liveSession() },
      items: [card('a'), card('b'), card('c')],
      sources: [{ id: 'src1', url: 'u' }],
    });
    const rows = [];
    for (let i = 1; i <= 45; i++) rows.push({ seq: i, generation: 0 });
    let body = null, deleteUrl = null;
    const fetchFn = fakeFetch([
      { match: (u, i) => i && i.method === 'POST' && !/rpc/.test(u),
        reply: (u, i) => { body = JSON.parse(i.body); return reply(201, [{ seq: 46 }]); } },
      { match: (u, i) => i && i.method === 'DELETE',
        reply: (u) => { deleteUrl = u; return reply(204, null); } },
      { match: () => true, reply: () => reply(200, rows) },
    ]);
    const { S, C } = setup({ store, fetch: fetchFn });

    const r = await S.compact(T0);
    eq(r.compacted, 45);
    eq(r.generation, 1);
    eq(r.cards, 3, 'a partial snapshot would delete rows nobody can reconstruct');
    const back = C.fromJsonl(await C.inflate(S.fromHex(body.blob)));
    eq(back.cards.length, 3);
    ok(/seq=lte\.45$/.test(deleteUrl), 'must sweep only what was read: ' + deleteUrl);
  });
});

describe('LearnSync — plumbing', () => {
  test('hex round-trips every byte value', () => {
    const { S } = setup();
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const back = S.fromHex(S.toHex(bytes));
    eq(back.length, 256);
    ok(Array.from(back).every((b, i) => b === i), 'a byte lost in hex is a corrupt chunk');
  });

  test('forget() clears the pointers and NOT the corpus', async () => {
    const store = fakeStore({ meta: { syncCursor: 9, syncPushedAt: 5 }, items: [card('a')] });
    const { S } = setup({ store });
    await S.forget();
    eq(store.meta.syncCursor, 0);
    eq(store.meta.syncPushedAt, 0);
    eq(store.items.length, 1, 'signing out is not a reason to lose what you learned');
  });
});

// ─── The echo ────────────────────────────────────────────────────────────────
// Found on 2026-08-06 running two real devices against the real backend. Every
// chunk a device pulled came straight back up as a chunk of its own:
//
//   seq 6  device A pushes 13 cards / 3 sources / 14 reviews
//   seq 7  device B pushes 13 cards / 3 sources / 14 reviews   ← the same material
//   seq 8  device A pushes 5 cards
//   seq 9  device B pushes 5 cards                              ← again
//
// Cause: push selects `touchedAt(item) > PUSHED`, and replaying a remote item writes
// the remote timestamps locally, so anything just received looks freshly touched.
// Worst case is a NEW device, whose PUSHED is 0: its first pull is immediately
// followed by a push of the ENTIRE corpus back to the server. The user pays for that
// twice out of a 50 MB quota — a 25 MB corpus fills the account by adding a device.

describe('LearnSync — 拉下来的东西不许再推回去', () => {
  function echoStore(seed) {
    const s = fakeStore(seed);
    const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;
    s.mergeBatch = (inc, srcs, opts) => {
      let added = 0;
      for (const c of inc) {
        const i = s.items.findIndex((x) => x.id === c.id);
        const merged = i < 0 ? c : LearnModel.mergeItem(s.items[i], c, opts);
        if (opts && opts.markSynced) merged.syncedAt = LearnModel.touchedAt(merged);
        if (i < 0) { s.items.push(merged); added++; } else s.items[i] = merged;
      }
      return Promise.resolve(added);
    };
    s.recordReview = (itemId, grade, at, opts) => {
      s.reviews.push(Object.assign({ itemId, grade, at }, opts && opts.viaSync ? { viaSync: 1 } : {}));
      return Promise.resolve();
    };
    return s;
  }

  // Build the wire form of a chunk the way another device would have sent it.
  async function remoteChunk(C, cards, reviews) {
    const bundle = C.build(cards, [{ id: 'src1', url: 'u', title: 't' }], reviews || [], T0 + 5000);
    const bytes = await C.deflate(C.toJsonl(bundle));
    let hex = '\\x';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex;
  }

  async function runOnce(store, chunkHex) {
    const posts = [];
    const fetchFn = fakeFetch([
      { match: (u, i) => (i && i.method) === 'POST' && /bt_chunks/.test(u),
        reply: (u, i) => { posts.push(JSON.parse(i.body)); return reply(201, [{ seq: 99 }]); } },
      { match: (u) => /seq=gt/.test(u),
        reply: (u) => reply(200, /seq=gt\.0/.test(u) ? [{ seq: 42, blob: chunkHex }] : []) },
    ]);
    const { S, store: st } = setup({ store, fetch: fetchFn });
    st.meta.auth = liveSession();
    await S.sync();
    return { posts, store: st };
  }

  test('新设备登录后不会把刚拉到的整份语料原样推回去', async () => {
    const store = echoStore({ meta: { syncCursor: 0, syncPushedAt: 0 } });
    const { C } = setup({ store });
    const hex = await remoteChunk(C, [card('a'), card('b')], [{ itemId: 'a', grade: 2, at: T0 + 1 }]);
    const { posts, store: st } = await runOnce(store, hex);
    eq(st.items.length, 2, '拉取本身应当落地');
    const cards = posts.flatMap((p) => (p.blob ? [p] : []));
    eq(cards.length, 0, `刚拉到的内容被推了回去（${cards.length} 个块）`);
  });

  test('拉到之后本地又复习过的卡，仍然要推上去', async () => {
    const store = echoStore({ meta: { syncCursor: 0, syncPushedAt: 0 } });
    const { C } = setup({ store });
    const hex = await remoteChunk(C, [card('a')], []);
    await runOnce(store, hex);
    // 本地复习：必须晚于上一次 push 的水位（push 盖的是真实当前时间，
    // 不是 T0 那套假时间 —— 第一版测试在这里把复习写成了「发生在过去」）。
    const later = Date.now() + 1000;
    const it = store.items[0];
    it.sched = { s: 4, d: 7, lastReviewAt: later, dueAt: later, reps: 2, lapses: 0 };
    const { posts } = await runOnce(store, hex);
    ok(posts.length > 0, '本地复习过的卡没有被推上去 —— 这才是真的丢数据');
  });
});

describe('LearnSync — autoSync（§8.8 页面打开即心跳）', () => {
  test('未登录 ⇒ null，且一个请求都不发', async () => {
    const { S, fetchFn } = setup();
    eq(await S.autoSync(T0), null);
    eq(fetchFn.calls.length, 0, '未登录的自动同步碰了网络');
  });

  test('已登录首跑 ⇒ 真同步一次，并盖下节流水位', async () => {
    const store = fakeStore({ meta: { auth: liveSession() } });
    const { S, fetchFn } = setup({ store });
    const at = Date.now();
    const r = await S.autoSync(at);
    ok(r && r.pulled, '成功的自动同步要把结果交给调用方');
    eq(store.meta.autoSyncAt, at, '成功后必须盖水位，否则每次打开都重跑');
    ok(fetchFn.calls.length > 0);
  });

  test('10 分钟内再触发 ⇒ null，不再发请求；过窗后恢复', async () => {
    const store = fakeStore({ meta: { auth: liveSession() } });
    const { S, fetchFn } = setup({ store });
    const at = Date.now();
    await S.autoSync(at);
    const n = fetchFn.calls.length;
    eq(await S.autoSync(at + S.AUTO_MIN_MS - 1), null, '节流窗内不许重跑');
    eq(fetchFn.calls.length, n, '节流命中却发了请求');
    ok(await S.autoSync(at + S.AUTO_MIN_MS + 1) !== null, '过窗后应当恢复心跳');
  });

  test('失败 ⇒ 静默 null、不盖水位，下次打开重试', async () => {
    const store = fakeStore({ meta: { auth: liveSession() } });
    const fetchFn = (() => {
      const calls = [];
      const fn = async (url, init) => { calls.push({ url }); throw new Error('net down'); };
      fn.calls = calls;
      return fn;
    })();
    const { S } = setup({ store, fetch: fetchFn });
    const at = Date.now();
    eq(await S.autoSync(at), null, '自动路径的失败必须静默（§8.8 规则 1）');
    eq(store.meta.autoSyncAt, undefined, '失败也盖水位 = 离线一次就静音十分钟');
    await S.autoSync(at + 1000);
    ok(fetchFn.calls.length >= 2, '失败后下次打开应当重试');
  });

  test('并发触发去重成一次 —— 两个面同时打开只跑一趟', async () => {
    const store = fakeStore({ meta: { auth: liveSession() } });
    const { S, fetchFn } = setup({ store });
    const at = Date.now();
    const [r1, r2] = await Promise.all([S.autoSync(at), S.autoSync(at)]);
    ok(r1 === r2, '两个并发调用应共享同一趟运行的结果');
    const pulls = fetchFn.calls.filter((c) => c.method === 'GET').length;
    eq(pulls, 1, `并发触发拉了 ${pulls} 次 —— 应当只有一次`);
  });
});
