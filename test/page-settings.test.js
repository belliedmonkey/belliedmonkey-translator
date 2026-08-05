// test/page-settings.test.js — reading settings from an extension page.
//
// Pins a platform behaviour, not a preference: on Safari iOS an extension page's
// `chrome.storage.local.get([...])` came back with nothing while the content script
// on the same device read the same keys successfully. Every setting appeared to
// revert; the user re-entered their API key on every visit.

const { loadModule, describe, test, ok, eq } = require('./harness');

function load(getImpl) {
  const chrome = { storage: { local: { get: getImpl, set: () => {} } } };
  return loadModule('learn/page-settings.js', { window: {}, chrome }).PageSettings;
}

const KEYS = ['provider', 'apiKey', 'targetLang'];

describe('PageSettings.read', () => {
  test('the normal path is ONE call — the fallback must not cost everyone', async () => {
    let calls = 0;
    const P = load((q, cb) => { calls++; setTimeout(() => cb({ provider: 'deepseek', apiKey: 'K' }), 0); });
    const s = await P.read(KEYS);
    eq(s.provider, 'deepseek');
    eq(calls, 1, 'a working array read must not trigger the full-bucket fallback');
  });

  test('an EMPTY array read falls back to a full read and recovers the values', async () => {
    // The Safari iOS shape. Without the fallback this returns {} and the page paints
    // defaults over real saved settings.
    const queries = [];
    const P = load((q, cb) => {
      queries.push(q);
      setTimeout(() => cb(q === null
        ? { provider: 'deepseek', apiKey: 'K', targetLang: 'ja', 'tr:x': 'cache noise' }
        : {}), 0);
    });
    const s = await P.read(KEYS);
    eq(s.provider, 'deepseek');
    eq(s.targetLang, 'ja');
    eq(queries.length, 2);
    eq(queries[1], null, 'the fallback is the full read');
    ok(!('tr:x' in s), 'the translation cache must not leak into settings');
  });

  test('a callback that hands back UNDEFINED does not throw or hang', async () => {
    const P = load((q, cb) => setTimeout(() => cb(undefined), 0));
    const s = await Promise.race([
      P.read(KEYS),
      new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG')), 2000)),
    ]);
    eq(Object.keys(s).length, 0);
  });

  test('a THROWING storage layer resolves to {} rather than rejecting', async () => {
    const P = load(() => { throw new Error('no storage'); });
    const s = await P.read(KEYS);
    eq(Object.keys(s).length, 0);
  });

  test('a genuinely empty profile costs the extra read once and returns {}', async () => {
    let calls = 0;
    const P = load((q, cb) => { calls++; setTimeout(() => cb({}), 0); });
    const s = await P.read(KEYS);
    eq(Object.keys(s).length, 0);
    eq(calls, 2, 'first run pays one extra read on a nearly empty bucket — acceptable');
  });
});
