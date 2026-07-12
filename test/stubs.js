// test/stubs.js — reusable browser-global stubs for the vm sandbox.

// In-memory chrome.storage.local + chrome.i18n. `store` is the backing object so a
// test can seed/inspect it. onChanged is a no-op recorder (translation-core adds a
// listener at load; we don't need to fire it).
function makeChrome(opts = {}) {
  const store = opts.store || {};
  const listeners = [];
  return {
    _store: store,
    _fireChange(changes) { listeners.forEach((l) => l(changes)); },
    i18n: {
      getUILanguage: () => opts.uiLanguage || 'en-US',
      getMessage: (key) => (opts.messages && opts.messages[key]) || '',
    },
    storage: {
      local: {
        get: (keys, cb) => {
          let out = {};
          if (keys == null) out = Object.assign({}, store);
          else if (typeof keys === 'string') out[keys] = store[keys];
          else if (Array.isArray(keys)) keys.forEach((k) => { out[k] = store[k]; });
          else Object.keys(keys).forEach((k) => { out[k] = k in store ? store[k] : keys[k]; });
          if (cb) cb(out);
          return Promise.resolve(out);
        },
        set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); return Promise.resolve(); },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
}

// Deterministic fake DOM good enough for TranslationCore.createPager. scrollHeight is
// modeled from text length / width / font-size (monospace-ish), so pagination is
// reproducible without a real layout engine. `Mg` (the one-line reference) → 1 line.
function makeFakeDocument() {
  const byId = {};
  function makeEl() {
    let _text = '';
    const style = {};
    const el = {
      id: '',
      style,
      get textContent() { return _text; },
      set textContent(v) { _text = v == null ? '' : String(v); },
      get scrollHeight() {
        const fontSize = parseFloat(style.fontSize) || 16;
        const width = parseFloat(style.width) || 300;
        const contentW = Math.max(1, width - 20);        // padding: 0 10px
        const charW = fontSize * 0.55;
        const perLine = Math.max(1, Math.floor(contentW / charW));
        const lines = Math.max(1, Math.ceil(_text.length / perLine));
        return Math.round(lines * fontSize * 1.3);
      },
      setAttribute(name, value) {
        if (name === 'id') { el.id = String(value); byId[el.id] = el; return; } // reflect like real DOM
        el['_attr_' + name] = String(value);
      },
      getAttribute(name) {
        if (name === 'id') return el.id || null;
        const v = el['_attr_' + name]; return v == null ? null : v;
      },
      remove() { if (el.id) delete byId[el.id]; },
      appendChild(child) { if (child.id) byId[child.id] = child; return child; },
    };
    return el;
  }
  const body = makeEl();
  return {
    body,
    documentElement: body,
    getElementById: (id) => byId[id] || null,
    createElement: () => makeEl(),
  };
}

// A fetch stub that returns programmed responses in order (or via a handler fn) and
// records every call. Each programmed entry: {status?, json?, headers?}.
function makeFetch(program) {
  const calls = [];
  async function fetchStub(url, opts) {
    calls.push({ url, opts });
    const r = typeof program === 'function'
      ? program(url, opts, calls.length - 1)
      : program[Math.min(calls.length - 1, program.length - 1)];
    const status = r.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: r.statusText || '',
      json: async () => (typeof r.json === 'function' ? r.json() : r.json),
      headers: { get: (h) => (r.headers && r.headers[h.toLowerCase()]) || null },
    };
  }
  fetchStub.calls = calls;
  return fetchStub;
}

module.exports = { makeChrome, makeFakeDocument, makeFetch };
