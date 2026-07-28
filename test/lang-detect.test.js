// test/lang-detect.test.js — the OPTIONAL browser language detector wrapper.
//
// LangDetect exists to turn an async, may-not-exist browser API into the synchronous
// three-state accessor the engine's sync pump() can consume. The two things that must
// never break: absence looks exactly like Safari (null, forever, no throw), and any
// failure latches the whole module off rather than retrying per unit.
// See docs/domain-design.md §5.3.
const { describe, test, eq, deepEq, tick } = require('./harness');
const { makeChrome } = require('./stubs');
const { loadModule } = require('./harness');

const EN = { isReliable: true, languages: [{ language: 'en', percentage: 100 }] };

function load(opts = {}) {
  const window = {};
  const chrome = makeChrome(opts);
  const ctx = loadModule('lang-detect.js', { window, chrome });
  return { LD: ctx.LangDetect, chrome, window };
}

// Resolve whatever microtasks the stub queued, then read the cache.
const settle = () => tick(5);

describe('LangDetect — capability probe', () => {
  test('no chrome.i18n.detectLanguage (every Safari) → null forever, never throws', async () => {
    const { LD } = load();                       // stub omits detectLanguage
    eq(LD.available(), false);
    eq(LD.detect('The quick brown fox jumps over the lazy dog.'), null);
    await settle();
    eq(LD.detect('The quick brown fox jumps over the lazy dog.'), null, 'still null after settling');
  });

  test('detectLanguage present → available, and exported on window', () => {
    const { LD, window } = load({ detectLanguage: () => EN });
    eq(LD.available(), true);
    eq(window.LangDetect, LD, 'content scripts read this off window');
  });
});

describe('LangDetect — three-state accessor', () => {
  test('undefined while in flight, then the flattened answer', async () => {
    const { LD } = load({ detectLanguage: () => EN });
    eq(LD.detect('hello world'), undefined, 'first ask kicks off detection');
    eq(LD.detect('hello world'), undefined, 'still in flight — not a second request');
    await settle();
    deepEq(LD.detect('hello world'), { lang: 'en', percentage: 100, isReliable: true });
  });

  test('one request per distinct text; the answer is cached', async () => {
    let calls = 0;
    const { LD } = load({ detectLanguage: () => { calls++; return EN; } });
    LD.detect('a'); LD.detect('a'); LD.detect('a');
    await settle();
    LD.detect('a');
    eq(calls, 1, 'repeated asks for the same text hit the cache');
    LD.detect('b');
    eq(calls, 2);
  });

  test('callback-style engines (Firefox chrome.*) work too', async () => {
    const { LD } = load({ detectLanguage: () => EN, detectMode: 'callback' });
    eq(LD.detect('hello world'), undefined);
    await settle();
    deepEq(LD.detect('hello world'), { lang: 'en', percentage: 100, isReliable: true });
  });

  test('picks the winning language, and reports isReliable honestly', async () => {
    const mixed = {
      isReliable: false,
      languages: [{ language: 'fr', percentage: 30 }, { language: 'en', percentage: 70 }],
    };
    const { LD } = load({ detectLanguage: () => mixed });
    LD.detect('x');
    await settle();
    deepEq(LD.detect('x'), { lang: 'en', percentage: 70, isReliable: false },
      'isReliable is passed through untouched — the engine gates on it');
  });

  test('"und" and unreadable shapes become null, never a match', async () => {
    for (const bad of [
      { isReliable: true, languages: [{ language: 'und', percentage: 100 }] },
      { isReliable: true, languages: [] },
      { isReliable: true },
      null,
    ]) {
      const { LD } = load({ detectLanguage: () => bad });
      LD.detect('x');
      await settle();
      eq(LD.detect('x'), null, `unreadable result ${JSON.stringify(bad)} → no answer`);
    }
  });

  test('empty / non-string input is answered null without a request', () => {
    let calls = 0;
    const { LD } = load({ detectLanguage: () => { calls++; return EN; } });
    eq(LD.detect(''), null);
    eq(LD.detect(null), null);
    eq(LD.detect(42), null);
    eq(calls, 0);
  });
});

// The suite above asserts on ANSWERS. This block asserts on the timers the module
// arms — a resource-lifetime property no outcome assertion can observe. The vm
// sandbox is the seam: loadModule merges whatever globals we pass, so setTimeout
// and clearTimeout can be recorded.
describe('LangDetect — the in-flight reaper', () => {
  function loadWithTimers(opts) {
    const armed = [];
    const cleared = [];
    const ctx = loadModule('lang-detect.js', {
      window: {}, chrome: makeChrome(opts),
      setTimeout: (fn, ms) => { armed.push({ fn, ms }); return armed.length; },
      clearTimeout: (id) => cleared.push(id),
    });
    return { LD: ctx.LangDetect, armed, cleared };
  }

  test('a detection that never settles is reaped to "never"', () => {
    // Without the reaper the slot stays `undefined` forever, so the engine keeps
    // asking every tick for an answer that is never coming.
    const { LD, armed } = loadWithTimers({ detectLanguage: () => new Promise(() => {}) });
    eq(LD.detect('x'), undefined, 'in flight');
    eq(armed.length, 1, 'the reaper is armed');
    eq(armed[0].ms, 5000);
    armed[0].fn();
    eq(LD.detect('x'), null, 'reaped — the engine stops waiting');
  });

  test('the reaper is disarmed once the real answer lands', async () => {
    // Left armed, every detection holds its paragraph string alive for the full
    // timeout, so on a scrolling page the retained-string peak tracks detection RATE
    // rather than the cache cap. Nothing about the returned answer reveals this.
    const { LD, armed, cleared } = loadWithTimers({ detectLanguage: () => EN });
    LD.detect('x');
    eq(armed.length, 1, 'armed on the way out');
    await settle();
    eq(cleared.length, 1, 'and cancelled the moment the answer arrives');
  });

  test('a late reaper must not overwrite a good answer', async () => {
    const { LD, armed } = loadWithTimers({ detectLanguage: () => EN });
    LD.detect('x');
    await settle();
    armed[0].fn();                       // fires late anyway
    deepEq(LD.detect('x'), { lang: 'en', percentage: 100, isReliable: true },
      'the cached answer survives');
  });
});

describe('LangDetect — failure latches the module off', () => {
  test('a throwing detectLanguage disables it permanently, no per-unit retry', async () => {
    let calls = 0;
    const { LD } = load({ detectLanguage: () => { calls++; throw new Error('boom'); } });
    eq(LD.available(), true, 'it looked usable before we called it');
    eq(LD.detect('first'), null, 'the failure is reported as "never", not as "in flight"');
    eq(LD.available(), false, 'latched off');
    eq(LD.detect('second'), null);
    eq(LD.detect('third'), null);
    eq(calls, 1, 'a broken API is called exactly once, never once per unit');
  });

  test('a rejecting promise latches it off too', async () => {
    const { LD, chrome } = load({ detectLanguage: () => EN });
    chrome.i18n.detectLanguage = () => Promise.reject(new Error('nope'));
    eq(LD.detect('x'), undefined, 'looks in flight at first');
    await settle();
    eq(LD.available(), false);
    eq(LD.detect('x'), null);
  });

  test('chrome.runtime.lastError is treated as a failure', async () => {
    const { LD, chrome } = load({ detectLanguage: () => EN, detectMode: 'callback' });
    chrome.runtime = { lastError: { message: 'context invalidated' } };
    LD.detect('x');
    await settle();
    eq(LD.available(), false, 'latched off rather than caching a bogus answer');
  });
});
