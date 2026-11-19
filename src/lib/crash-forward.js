// src/lib/crash-forward.js — BEL-303 content-script crash forwarder.
//
// Content scripts never load the Sentry SDK and never fetch a DSN endpoint (page CSP
// would eat it, and the write key must not live in webpage JS). They only build a
// tiny {message, stack, code, filename} record and hand it to the service worker.
//
// If the SW is unavailable (the known Safari iOS bug: the service worker can be
// permanently undefined after device lock), the record goes into a
// chrome.storage.local ring capped at 200. A later SW wake-up or extension page
// flushes it. No direct network path exists in this file.
(function (root) {
  'use strict';

  var RING_KEY = 'mt:crash:ring';
  var RING_CAP = 200;
  var installed = false;

  function storage() {
    try {
      if (root.chrome && root.chrome.storage && root.chrome.storage.local) return root.chrome.storage.local;
    } catch (_) {}
    return null;
  }

  // Keep the ring local-only and bounded. We store the raw stack on purpose: the
  // scrub happens in the SW's beforeSend, and a content-side "scrub" here would be
  // a second implementation of the redaction rules.
  function enqueue(payload) {
    var s = storage();
    if (!s) return;
    try {
      s.get([RING_KEY], function (r) {
        var q = (r && Array.isArray(r[RING_KEY])) ? r[RING_KEY] : [];
        q.push(payload);
        while (q.length > RING_CAP) q.shift();
        var obj = {};
        obj[RING_KEY] = q;
        try { s.set(obj, function () {}); } catch (_) {}
      });
    } catch (_) {}
  }

  function safeString(v, max) {
    if (v == null) return '';
    var s = String(v);
    return s.length > max ? s.slice(0, max) : s;
  }

  // The wire shape is deliberately four keys. No URL, no DOM, no page text,
  // no install id: the SW is the only side that attaches identity/limited tags.
  function payloadOf(message, stack, code, filename) {
    return {
      message: safeString(message || 'Unknown error', 500),
      stack: safeString(stack || '', 8000),
      code: safeString(code || '', 80),
      filename: safeString(filename || '', 300)
    };
  }

  function send(payload) {
    try {
      var runtime = root.chrome && root.chrome.runtime;
      if (!runtime || typeof runtime.sendMessage !== 'function') {
        enqueue(payload);
        return;
      }
      var done = false;
      var timer = setTimeout(function () { finish(false); }, 3000);
      var finish = function (ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!ok) enqueue(payload);
      };
      try {
        var ret = runtime.sendMessage({ action: 'crashReport', payload: payload }, function (resp) {
          var lastError = null;
          try { lastError = runtime.lastError; } catch (_) {}
          finish(!lastError && !!(resp && resp.ok));
        });
        if (ret && typeof ret.then === 'function') {
          ret.then(function (resp) { finish(!!(resp && resp.ok)); }, function () { finish(false); });
        }
      } catch (_) {
        finish(false);
      }
    } catch (_) {
      enqueue(payload);
    }
  }

  function install() {
    if (installed) return true;
    var proto = '';
    try { proto = String(root.location && root.location.protocol || ''); } catch (_) {}
    // Only real web pages; never extension pages or the App's file:// document.
    if (proto !== 'http:' && proto !== 'https:') return false;
    if (typeof root.addEventListener !== 'function') return false;
    installed = true;

    root.addEventListener('error', function (e) {
      try {
        var err = e && e.error;
        send(payloadOf(e && e.message, err && err.stack, (err && err.name) || 'Error', e && e.filename));
      } catch (_) {}
    });

    root.addEventListener('unhandledrejection', function (e) {
      try {
        var r = e && e.reason;
        var err = r && r.error ? r.error : r;
        send(payloadOf((err && err.message) || r || 'Unhandled rejection', (err && err.stack) || '', (err && err.name) || 'Error', ''));
      } catch (_) {}
    });

    // Ask a sleeping SW to drain the ring. Failure is expected on iOS Safari and is
    // intentionally silent — the next successful report/wake-up drains it.
    try {
      var runtime = root.chrome && root.chrome.runtime;
      if (runtime && typeof runtime.sendMessage === 'function') {
        runtime.sendMessage({ action: 'crashFlush' }, function () {
          try { void runtime.lastError; } catch (_) {}
        });
      }
    } catch (_) {}
    return true;
  }

  var api = {
    install: install,
    _payloadOf: payloadOf,
    RING_KEY: RING_KEY,
    RING_CAP: RING_CAP
  };
  root.MTCrashForward = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
