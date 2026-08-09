// learn/drain.js — move captures from the bounded outbox into the corpus.
// EXTENSION PAGES ONLY (it opens IndexedDB — see learn/store.js for why).
//
// The content script cannot write the corpus itself (wrong origin), and the service
// worker cannot be relied on to do it (it goes permanently undefined on Safari iOS
// after device lock). So the drain runs opportunistically: whenever any extension
// page opens — the review page, the popup, the options page — it sweeps whatever
// the outbox has accumulated and clears it.

var LearnDrain = (() => {
  function keysOf(index) {
    return (Array.isArray(index) ? index : []).map((e) => e && e.k).filter(Boolean);
  }

  function readOutbox() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([LearnModel.OUTBOX_INDEX, LearnModel.OUTBOX_DROPPED], (res) => {
          const dropped = ((res || {})[LearnModel.OUTBOX_DROPPED] || {}).n || 0;
          const index = (res || {})[LearnModel.OUTBOX_INDEX];
          const keys = keysOf(index);
          if (!keys.length) { resolve({ keys: [], batches: [], dropped }); return; }
          chrome.storage.local.get(keys, (blobs) => {
            const batches = keys.map((k) => (blobs || {})[k]).filter(Boolean);
            resolve({ keys, batches, dropped });
          });
        });
      } catch (_) { resolve({ keys: [], batches: [], dropped: 0 }); }
    });
  }

  // Captures the content script had to drop never reach the corpus, so this is the
  // only chance to record that they existed at all (learning-design.md §7.1).
  function carryDropped(n) {
    if (!n) return Promise.resolve();
    return LearnStore.bumpPressure('dropped', n)
      .then(() => new Promise((r) => {
        try { chrome.storage.local.remove([LearnModel.OUTBOX_DROPPED], () => r()); } catch (_) { r(); }
      }))
      .catch(() => {});
  }

  // The drain re-checks learnRules (learning-design §4.1/§8.9): the outbox may
  // hold batches captured BEFORE a rule landed (the 30s flush cadence, a rule set
  // on another surface, a rules pull). Filtered items are the user's intent, not
  // pressure — they are NOT counted into `lq:dropped`. A failed read filters
  // nothing (fail-open, §7.4.5): draining under uncertainty beats losing captures.
  function readRules() {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(['learnRules'], (r) => resolve((r && r.learnRules) || null)); }
      catch (_) { resolve(null); }
    });
  }

  function ruleFilter(batches, rules) {
    if (typeof LearnRules === 'undefined' || !rules) return batches;
    const out = [];
    for (const b of batches) {
      if (b.url && LearnRules.isBlocked(b.url, rules)) continue;
      const items = (b.items || []).filter((it) => it && (it.starred
        || LearnRules.langAllowed(it.lang, it.text, rules.langs,
          (typeof window !== 'undefined' && window.MT_LANGS) || null)));
      if (items.length) out.push(Object.assign({}, b, { items }));
    }
    return out;
  }

  // Returns the number of items merged. Never throws — a drain that fails leaves the
  // outbox untouched and simply reports 0, so the next page open retries it.
  function run() {
    return Promise.all([readOutbox(), readRules()]).then(([{ keys, batches, dropped }, rules]) => {
      if (!batches.length) return carryDropped(dropped).then(() => 0);
      batches = ruleFilter(batches, rules);
      const items = [];
      const sources = [];
      const seenSrc = new Set();
      for (const b of batches) {
        for (const it of (b.items || [])) items.push(it);
        if (b.sourceId && !seenSrc.has(b.sourceId)) {
          seenSrc.add(b.sourceId);
          sources.push({ id: b.sourceId, url: b.url || '', title: b.title || '' });
        }
      }
      if (!items.length) {
        return clear(keys).then(() => 0);
      }
      return LearnStore.mergeBatch(items, sources)
        .then(() => LearnStore.evictIfNeeded())
        .then(() => carryDropped(dropped))
        .then(() => clear(keys))
        .then(() => items.length);
    }).catch(() => 0);
  }

  function clear(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(keys.concat([LearnModel.OUTBOX_INDEX]), () => resolve());
      } catch (_) { resolve(); }
    });
  }

  return { run };
})();
