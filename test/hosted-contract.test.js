// test/hosted-contract.test.js — P2 client stub: route selection, quota fallback, and the
// v0.1 response checks. These are the parts that can be pure-tested without a hosted
// backend; the network half is exercised against mocks/hosted-gateway/.
//
// The failure this guards is specific: a client that quietly treats "subscription" as the
// only path, or that lets a 402 turn into a forced subscription, breaks the own-key
// invariant (AGENTS rules 2/11, BOUNDARY §3). The selection rule therefore lives here,
// not in a JSX branch.

const { describe, test, eq, ok, deepEq, loadSrc } = require('./harness');

const C = loadSrc('src/shared/hosted-contract.js', 'HostedContract');
const api = C.HostedContract;

describe('hosted contract v0.1 — routes and local fallback', () => {
  test('BYOK wins by default when an own key exists', () => {
    eq(api.chooseRoute({ hasOwnKey: true, signedIn: true, product: 'monthly', remaining: 5 }), 'byok');
    eq(api.chooseRoute({ hasOwnKey: true, signedIn: false }), 'byok');
  });

  test('subscription is a choice, not a default', () => {
    eq(api.chooseRoute({ hasOwnKey: true, signedIn: true, product: 'monthly', remaining: 5, prefer: 'subscription' }), 'subscription');
    eq(api.chooseRoute({ hasOwnKey: false, signedIn: true, product: 'yearly', remaining: 1 }), 'subscription');
    eq(api.chooseRoute({ hasOwnKey: false, signedIn: false, product: 'monthly', remaining: 5 }), 'none');
  });

  test('quota exhaustion falls back to a configured own key, never to "none" when one exists', () => {
    eq(api.fallbackAfterQuota({ hasOwnKey: true }), 'byok');
    eq(api.fallbackAfterQuota({ hasOwnKey: false }), 'none');
    eq(api.chooseRoute({ hasOwnKey: true, signedIn: true, product: 'monthly', remaining: 0, prefer: 'subscription' }), 'byok');
    eq(api.chooseRoute({ hasOwnKey: false, signedIn: true, product: 'monthly', remaining: 0 }), 'none');
  });

  test('unknown products normalize to free; only the v0.1 enum is accepted', () => {
    eq(api.productOf({ product: 'free' }), 'free');
    eq(api.productOf({ product: 'monthly' }), 'monthly');
    eq(api.productOf({ product: 'yearly' }), 'yearly');
    eq(api.productOf({ product: 'enterprise' }), 'free');
    eq(api.productOf({}), 'free');
    eq(api.isSubscription('monthly'), true);
    eq(api.isSubscription('yearly'), true);
    eq(api.isSubscription('free'), false);
  });

  test('balance rejects key-shaped material and normalizes the v0.1 fields', () => {
    const b = api.validateBalance({ product: 'monthly', remaining: 1.5, unit: 'usd', resets_at: null });
    deepEq(b, { product: 'monthly', remaining: 1.5, unit: 'usd', resets_at: null });
    let threw = false;
    try { api.validateBalance({ remaining: 1, upstream_api_key: 'sk-test-not-a-real-key' }); } catch (_) { threw = true; }
    ok(threw, 'a balance carrying upstream_api_key must be rejected');
    threw = false;
    try { api.validateBalance({ remaining: 1, note: 'sk-abcdefghijklmnop' }); } catch (_) { threw = true; }
    ok(threw, 'a key-shaped value must be rejected');
  });

  test('a quota error names the local fallback and never a payment page', () => {
    deepEq(api.validateError({ error: 'insufficient_balance', fallback: 'byok' }),
      { code: 'insufficient_balance', fallback: 'byok' });
    deepEq(api.validateError({ error: 'quota' }), { code: 'quota', fallback: '' });
    deepEq(api.validateError({ error: 'insufficient_balance' }),
      { code: 'insufficient_balance', fallback: 'byok' });
  });

  test('the hosted bearer is the bmg_ grant token, not a provider key', () => {
    eq(api.isHostedBearer({ Authorization: 'Bearer bmg_aaaaaaaaaaaa' }), true);
    eq(api.isHostedBearer({ authorization: 'Bearer sk-aaaaaaaaaaaa' }), false);
    eq(api.isHostedBearer({}), false);
  });

  test('paths are joined without a double slash and the mock base is explicit', () => {
    eq(api.pathFor('https://hosted.example/', 'balance'), 'https://hosted.example/v0/grant/balance');
    eq(api.pathFor(api.MOCK_BASE, 'relay'), api.MOCK_BASE + '/v0/relay');
    eq(api.syncPath('https://hosted.example', 'settings'), 'https://hosted.example/v0/sync/settings');
    eq(api.isMockBase(api.MOCK_BASE), true);
    eq(api.isMockBase('https://hosted.example'), false);
  });

  test('the contract version is pinned to the path the order names', () => {
    eq(api.CONTRACT_VERSION, '0.1');
  });
});
