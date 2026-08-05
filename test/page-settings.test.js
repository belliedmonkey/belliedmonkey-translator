// test/page-settings.test.js — reading settings from an extension page.
//
// The shape being pinned was found with Safari Web Inspector, not guessed. On the
// simulator the two forms of the SAME call disagree:
//
//   callback form → cb(undefined), silently
//   promise form  → rejects "Failed to create extension storage directory."
//
// The storage layer was broken; the callback form reported that as an empty result;
// the page painted defaults over the user's saved provider and API key. So the
// contract here is not "return data" — it is **distinguish failure from empty**.

const { loadModule, describe, test, ok, eq } = require('./harness');

function load(getImpl, lastError) {
  const chrome = {
    runtime: { lastError: lastError || null },
    storage: { local: { get: getImpl, set: () => {} } },
  };
  return loadModule('learn/page-settings.js', { window: {}, chrome }).PageSettings;
}

const KEYS = ['provider', 'apiKey', 'targetLang'];

describe('PageSettings.read', () => {
  test('a normal callback read returns ok with only the requested keys', async () => {
    const P = load((q, cb) => { setTimeout(() => cb({ provider: 'deepseek', 'tr:x': 'noise' }), 0); });
    const r = await P.read(KEYS);
    eq(r.ok, true);
    eq(r.data.provider, 'deepseek');
    ok(!('tr:x' in r.data), 'the translation cache must not leak into settings');
  });

  test('a REJECTING promise form reports ok:false and carries the reason', async () => {
    // The real Safari path. The message is the only thing that tells a user their
    // storage is broken rather than empty.
    const P = load(() => Promise.reject(new Error('Failed to create extension storage directory.')));
    const r = await P.read(KEYS);
    eq(r.ok, false);
    ok(/storage directory/.test(r.error), r.error);
  });

  test('a callback handed UNDEFINED is a FAILURE, not an empty profile', async () => {
    // This is the whole bug: treating it as {} is what painted defaults over a saved
    // API key. It must not come back ok:true.
    const P = load((q, cb) => { setTimeout(() => cb(undefined), 0); });
    const r = await P.read(KEYS);
    eq(r.ok, false);
  });

  test('chrome.runtime.lastError is surfaced even when a value arrives', async () => {
    const P = load((q, cb) => { setTimeout(() => cb({}), 0); }, { message: 'quota' });
    const r = await P.read(KEYS);
    eq(r.ok, false);
    eq(r.error, 'quota');
  });

  test('a genuinely empty profile is ok:true with no keys — NOT a failure', async () => {
    // The counterpart that keeps the rule honest: first run must not scream.
    const P = load((q, cb) => { setTimeout(() => cb({}), 0); });
    const r = await P.read(KEYS);
    eq(r.ok, true);
    eq(Object.keys(r.data).length, 0);
  });

  test('a THROWING storage layer settles as a failure rather than hanging', async () => {
    const P = load(() => { throw new Error('no storage'); });
    const r = await Promise.race([
      P.read(KEYS),
      new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG')), 2000)),
    ]);
    eq(r.ok, false);
  });
});
