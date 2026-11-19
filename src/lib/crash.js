// src/lib/crash.js — BEL-303 P0 JS crash reporter (App WebView + extension SW).
//
// This file is a plain IIFE, not an ES module: the App is one concatenated Script.js
// (see build/app-bundle.js) and the service worker is copied as-is. The SDK is a
// build-time-only esbuild bundle written by build/sentry-inject.js (global dist only);
// runtime dependencies stay at zero.
//
// The DSN in this source is a `.invalid` placeholder on purpose. The global build
// replaces the CONFIG line below with the public write key from the build environment;
// the China build replaces it with an empty string. Never commit a real DSN.
//
// Boundaries implemented here (arch RESULT §2–§4, user ACCEPT):
//   · only init + captureEvent for the two crash paths; traces 0, no Replay/Feedback
//   · recursive beforeSend scrub: message, exception.value, frame urls/queries, extra,
//     contexts, user, breadcrumbs; whole `request` deleted; diag text/rem/raw keys deleted
//   · beforeBreadcrumb drops console/fetch/xhr/navigation/ui
//   · empty DSN ⇒ no init, no network
//   · ≤5 events per install per session, ≤20 per day
//   · install_id is a tag only; no setUser; launch_id/op_id only if supplied
//   · Safari masked (`webkit-masked-url://hidden/`) / stackless events from our own
//     extension are still reported, tagged masked=1 / stackless=1
//   · business failures (402 / no_base / timeout / credit_exhausted / http /
//     translate_fail) are never captured
(function (root) {
  'use strict';

  // build/sentry-inject.js replaces this exact line. Keep it one line and keep the
  // source value inert (`.invalid`).
  var CONFIG = {"dsn":"https://public@crash.invalid/1","release":"0.0.0","flavor":"global","environment":"production"};

  var RATE = { key: 'mt:crash:rate', sessionMax: 5, dayMax: 20 };
  var RING_KEY = 'mt:crash:ring';
  var RING_CAP = 200;
  var INSTALL_KEY = 'mt:crash:install';
  var BUSINESS = /^(402|no_base|timeout|credit_exhausted|http|translate_fail|rate_limited|bad_json|expected_array|batch_size|mixed_install_ids|grant_event_failed)$/i;
  var CRASH_REASONS = { error: 1, uncaught: 1, unhandledrejection: 1, crash: 1 };
  var DIAG_KEYS = { text: 1, rem: 1, raw: 1 };
  var SECRET_KEYS = {
    authorization: 1, cookie: 1, 'set-cookie': 1, 'x-api-key': 1, apikey: 1,
    'api_key': 1, token: 1, access_token: 1, refresh_token: 1, password: 1,
    secret: 1, dsn: 1, 'x-sentry-auth': 1
  };
  var TAG_KEYS = { install_id: 1, launch_id: 1, op_id: 1, host: 1, flavor: 1, masked: 1, stackless: 1 };
  var BREADCRUMB_DROP = /^(console|fetch|xhr|navigation|ui)(\..*)?$/i;

  var initialized = false;
  var handlersInstalled = false;
  var installId = '';
  // BEL-294/BEL-295: telemetry.js owns buildNo(); it registers the function here so
  // the crash path uses the same single implementation (no second helper).
  var buildNoFn = null;
  function setBuildNo(fn) {
    if (typeof fn === 'function') buildNoFn = fn;
  }
  function buildNoValue() {
    try {
      if (!buildNoFn) return undefined;
      var b = buildNoFn();
      return (b === undefined || b === null) ? undefined : String(b);
    } catch (_) { return undefined; }
  }
  var sessionId = (function () {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    } catch (_) {}
    return 's' + Date.now().toString(36) + Math.random().toString(16).slice(2);
  })();

  function storage() {
    try {
      if (root.chrome && root.chrome.storage && root.chrome.storage.local) return root.chrome.storage.local;
    } catch (_) {}
    return null;
  }
  function sget(keys) {
    return new Promise(function (resolve) {
      var s = storage();
      if (!s) return resolve({});
      try { s.get(keys, function (r) { resolve(r || {}); }); } catch (_) { resolve({}); }
    });
  }
  function sset(obj) {
    return new Promise(function (resolve) {
      var s = storage();
      if (!s) return resolve();
      try { s.set(obj, function () { resolve(); }); } catch (_) { resolve(); }
    });
  }
  function sremove(keys) {
    return new Promise(function (resolve) {
      var s = storage();
      if (!s) return resolve();
      try { s.remove(keys, function () { resolve(); }); } catch (_) { resolve(); }
    });
  }

  function uuid() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
      if (root.crypto && root.crypto.getRandomValues) {
        var b = new Uint8Array(16);
        root.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        var h = Array.prototype.map.call(b, function (x) {
          return ('0' + x.toString(16)).slice(-2);
        }).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
      }
    } catch (_) {}
    return '';
  }

  function ensureInstallId() {
    if (installId) return Promise.resolve(installId);
    return sget(['tm:id', INSTALL_KEY]).then(function (r) {
      var id = (r && (r[INSTALL_KEY] || r['tm:id'])) || '';
      if (!/^[a-z0-9-]{8,64}$/i.test(String(id))) id = uuid();
      if (!id) id = 'unknown';
      installId = String(id).slice(0, 64);
      var obj = {};
      obj[INSTALL_KEY] = installId;
      return sset(obj).then(function () { return installId; });
    });
  }

  // ── scrub ────────────────────────────────────────────────────────────────
  function scrubString(input) {
    var s = String(input == null ? '' : input);
    if (!s) return s;
    // URLs keep origin + path; query/fragment (tokens, search text) go.
    s = s.replace(/https?:\/\/[^\s"'<>]+/gi, function (u) {
      try {
        var x = new URL(u);
        return x.origin + x.pathname;
      } catch (_) {
        return u.replace(/[?#].*$/, '');
      }
    });
    s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
    s = s.replace(/\b(?:bmg_|sk-)[A-Za-z0-9_-]{8,}/g, '[redacted-token]');
    s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]');
    s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]');
    s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]');
    s = s.replace(/\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{1,4}\b/gi, '[redacted-ip]');
    s = s.replace(/([?&](?:token|key|api_key|apikey|access_token|authorization|password|secret)=)[^&\s]+/gi, '$1[redacted]');
    return s;
  }

  function scrubValue(value, key, depth) {
    if (depth > 12) return undefined;
    if (typeof value === 'string') return scrubString(value);
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < value.length; i += 1) {
        var av = scrubValue(value[i], key, depth + 1);
        if (av !== undefined) arr.push(av);
      }
      return arr;
    }
    var lk = String(key || '').toLowerCase();
    if (lk === 'query') return undefined;
    var out = {};
    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j += 1) {
      var k = keys[j];
      var kl = k.toLowerCase();
      if (DIAG_KEYS[kl] || SECRET_KEYS[kl] || kl === 'request') continue;
      var sv = scrubValue(value[k], k, depth + 1);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }

  function scrubFrames(frames) {
    if (!Array.isArray(frames)) return frames;
    var out = [];
    for (var i = 0; i < frames.length; i += 1) {
      var f = frames[i];
      if (!f || typeof f !== 'object') continue;
      var g = {};
      var keys = Object.keys(f);
      for (var j = 0; j < keys.length; j += 1) {
        var k = keys[j];
        var kl = k.toLowerCase();
        if (kl === 'query') continue;
        if (kl === 'filename' || kl === 'abs_path' || kl === 'url' || kl === 'module') {
          g[k] = scrubString(f[k]);
        } else if (kl === 'vars' || kl === 'context') {
          g[k] = scrubValue(f[k], k, 0);
        } else {
          g[k] = f[k];
        }
      }
      out.push(g);
    }
    return out;
  }

  function scrubTags(tags) {
    var out = {};
    if (!tags || typeof tags !== 'object') return out;
    var keys = Object.keys(tags);
    for (var i = 0; i < keys.length; i += 1) {
      if (TAG_KEYS[keys[i]]) out[keys[i]] = scrubString(String(tags[keys[i]]));
    }
    return out;
  }

  function scrubBreadcrumbs(bc) {
    if (!bc) return bc;
    var values = Array.isArray(bc) ? bc : (Array.isArray(bc.values) ? bc.values : []);
    var kept = [];
    for (var i = 0; i < values.length; i += 1) {
      var c = values[i];
      if (!c || typeof c !== 'object') continue;
      if (BREADCRUMB_DROP.test(String(c.category || ''))) continue;
      kept.push(scrubValue(c, 'breadcrumb', 0));
    }
    if (Array.isArray(bc)) return kept;
    bc.values = kept;
    return bc;
  }

  function beforeBreadcrumb(crumb) {
    if (!crumb || typeof crumb !== 'object') return null;
    if (BREADCRUMB_DROP.test(String(crumb.category || ''))) return null;
    return scrubValue(crumb, 'breadcrumb', 0);
  }

  function beforeSend(event) {
    if (!event || typeof event !== 'object') return event;
    delete event.request;   // whole object: bodies, headers, query, cookies
    delete event.user;      // no setUser; install_id is the only identity
    if (typeof event.message === 'string') event.message = scrubString(event.message);
    if (event.logentry && typeof event.logentry.message === 'string') {
      event.logentry.message = scrubString(event.logentry.message);
    }
    if (event.exception && Array.isArray(event.exception.values)) {
      for (var i = 0; i < event.exception.values.length; i += 1) {
        var v = event.exception.values[i];
        if (!v || typeof v !== 'object') continue;
        if (typeof v.value === 'string') v.value = scrubString(v.value);
        if (v.stacktrace && Array.isArray(v.stacktrace.frames)) {
          v.stacktrace.frames = scrubFrames(v.stacktrace.frames);
        }
        if (v.mechanism && typeof v.mechanism === 'object') v.mechanism = scrubValue(v.mechanism, 'mechanism', 0);
      }
    }
    if (event.extra) event.extra = scrubValue(event.extra, 'extra', 0);
    if (event.contexts) event.contexts = scrubValue(event.contexts, 'contexts', 0);
    if (event.breadcrumbs) event.breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
    event.tags = scrubTags(event.tags);
    var b = buildNoValue();
    if (b !== undefined) event.dist = b;
    return event;
  }

  // ── business failures are not crashes ───────────────────────────────────
  function isBusinessFailure(payload) {
    var p = payload || {};
    var reason = String(p.reason || '').trim();
    if (reason) {
      if (BUSINESS.test(reason)) return true;
      if (!CRASH_REASONS[reason.toLowerCase()]) return true;   // unknown reason → translate_fail path
    }
    var msg = String(p.message || '');
    if (!msg) return false;
    // Only exact code words, never the substring "http" inside a URL/stack.
    if (BUSINESS.test(msg.trim())) return true;
    return false;
  }

  // ── stack parsing (captureEvent, never new Error(payload.message)) ──────
  function parseFrames(stack) {
    var text = String(stack == null ? '' : stack);
    if (!text || /webkit-masked-url:/i.test(text)) return [];
    var lines = text.split('\n');
    var frames = [];
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var m = /^\s*at\s+(?:(.*?)\s+\()?((?:[a-zA-Z][a-zA-Z0-9+.-]*:)?[^()\s]+):(\d+):(\d+)\)?\s*$/.exec(line);
      if (!m) continue;
      frames.push({
        function: scrubString(m[1] || '?'),
        filename: scrubString(m[2]),
        lineno: Number(m[3]) || 0,
        colno: Number(m[4]) || 0,
        in_app: !/^(?:chrome-extension|safari-web-extension|moz-extension|file):/i.test(m[2])
      });
    }
    frames.reverse();   // V8 prints newest first; Sentry expects oldest first
    return frames;
  }

  // ── rate limit: ≤5/install/session, ≤20/install/day ─────────────────────
  function allow() {
    return sget([RATE.key]).then(function (r) {
      var st = (r && r[RATE.key]) || {};
      var day = new Date().toISOString().slice(0, 10);
      if (st.day !== day) { st.day = day; st.dayCount = 0; }
      if (st.session !== sessionId) { st.session = sessionId; st.sessionCount = 0; }
      var dayCount = Number(st.dayCount) || 0;
      var sessionCount = Number(st.sessionCount) || 0;
      if (sessionCount >= RATE.sessionMax || dayCount >= RATE.dayMax) return false;
      st.dayCount = dayCount + 1;
      st.sessionCount = sessionCount + 1;
      var obj = {};
      obj[RATE.key] = st;
      return sset(obj).then(function () { return true; });
    });
  }

  // ── report ───────────────────────────────────────────────────────────────
  function report(payload, source) {
    if (!initialized) return Promise.resolve(false);
    if (!payload || typeof payload !== 'object' || isBusinessFailure(payload)) return Promise.resolve(false);
    var message = String(payload.message == null ? '' : payload.message).slice(0, 500);
    if (!message) return Promise.resolve(false);
    return allow().then(function (ok) {
      if (!ok) return false;
      return ensureInstallId().then(function (id) {
        var stack = payload.stack == null ? '' : String(payload.stack);
        var masked = /webkit-masked-url:/i.test(stack);
        var frames = masked ? [] : parseFrames(stack);
        var stackless = frames.length === 0;
        var tags = {
          install_id: id,
          host: source || 'extension',
          flavor: CONFIG.flavor || 'global'
        };
        if (masked) tags.masked = '1';
        if (stackless) tags.stackless = '1';
        if (payload.launch_id) tags.launch_id = String(payload.launch_id).slice(0, 64);
        if (payload.op_id) tags.op_id = String(payload.op_id).slice(0, 64);
        var event = {
          message: message,
          level: 'error',
          platform: 'javascript',
          tags: tags,
          exception: {
            values: [{
              type: String(payload.type || 'Error').slice(0, 80),
              value: message,
              stacktrace: frames.length ? { frames: frames } : undefined
            }]
          }
        };
        if (payload.filename) event.extra = { filename: String(payload.filename).slice(0, 300) };
        if (payload.code) {
          event.extra = event.extra || {};
          event.extra.code = String(payload.code).slice(0, 120);
        }
        try {
          var S = root.Sentry;
          if (!S || typeof S.captureEvent !== 'function') return false;
          S.captureEvent(beforeSend(event));
          return true;
        } catch (_) {
          return false;
        }
      });
    }).catch(function () { return false; });
  }

  function captureException(err, ctx) {
    var c = ctx || {};
    var e = err || {};
    return report({
      reason: c.reason || 'error',
      type: (e && e.name) || c.type || 'Error',
      message: (e && e.message) || c.message || String(e || 'Unknown error'),
      stack: (e && e.stack) || c.stack || '',
      filename: c.filename,
      code: c.code,
      launch_id: c.launch_id,
      op_id: c.op_id
    }, c.host || 'extension');
  }

  // ── host allowlist ──────────────────────────────────────────────────────
  function protocolOf() {
    try { return String(root.location && root.location.protocol || '').toLowerCase(); } catch (_) { return ''; }
  }
  function hostAllowed(opts) {
    var p = protocolOf();
    var o = opts || {};
    // Explicit host from the caller (App block / background.js). No global sniffing:
    // src/ may not read MT_* outside lib/registry.js.
    if (o.host === 'app') return p === 'file:';
    if (o.host === 'extension') return p === 'chrome-extension:' || p === 'safari-web-extension:' || p === 'moz-extension:';
    return false;
  }

  // ── global handlers (App; SW has its own error events) ──────────────────
  function installGlobal() {
    if (handlersInstalled) return;
    if (typeof root.addEventListener !== 'function') return;
    handlersInstalled = true;
    root.addEventListener('error', function (e) {
      try {
        captureException(e && e.error, {
          reason: 'error',
          message: e && e.message,
          stack: (e && e.error && e.error.stack) || '',
          filename: e && e.filename,
          host: 'app'
        });
      } catch (_) {}
    });
    root.addEventListener('unhandledrejection', function (e) {
      try {
        var r = e && e.reason;
        captureException(r && r.error ? r.error : r, {
          reason: 'unhandledrejection',
          message: (r && r.message) || String(r || 'Unhandled rejection'),
          stack: (r && r.stack) || '',
          host: 'app'
        });
      } catch (_) {}
    });
  }

  // ── ring flush (content writes it when the SW is asleep) ────────────────
  function flushRing() {
    if (!initialized) return Promise.resolve(0);
    return sget([RING_KEY]).then(function (r) {
      var q = (r && Array.isArray(r[RING_KEY])) ? r[RING_KEY].slice(-RING_CAP) : [];
      if (!q.length) return 0;
      return sremove([RING_KEY]).then(function () {
        var n = 0;
        var chain = Promise.resolve();
        for (var i = 0; i < q.length; i += 1) {
          (function (item) {
            chain = chain.then(function () {
              return report(item, (item && item.host) || 'extension').then(function (ok) { if (ok) n += 1; });
            });
          })(q[i]);
        }
        return chain.then(function () { return n; });
      });
    }).catch(function () { return 0; });
  }

  // ── init ─────────────────────────────────────────────────────────────────
  function init(opts) {
    var o = opts || {};
    if (initialized) return true;
    var dsn = o.dsn !== undefined ? String(o.dsn || '') : String(CONFIG.dsn || '');
    if (!dsn || !/^https:\/\//i.test(dsn)) return false;
    if (!hostAllowed(o)) return false;
    var S = o.Sentry || root.Sentry;
    if (!S || typeof S.init !== 'function') return false;
    var dist = buildNoValue();
    var cfg = {
      dsn: dsn,
      release: String(CONFIG.release || ''),
      environment: String(CONFIG.environment || 'production'),
      sendDefaultPii: false,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      defaultIntegrations: false,
      maxBreadcrumbs: 0,
      beforeSend: beforeSend,
      beforeBreadcrumb: beforeBreadcrumb
    };
    if (dist) cfg.dist = dist;
    try {
      S.init(cfg);
    } catch (_) {
      return false;
    }
    initialized = true;
    installGlobal();
    flushRing();
    return true;
  }

  var api = {
    init: init,
    report: report,
    captureException: captureException,
    captureEvent: function (event, source) {
      if (!initialized || !event || typeof event !== 'object') return false;
      try {
        root.Sentry.captureEvent(beforeSend(event));
        return true;
      } catch (_) { return false; }
    },
    flushRing: flushRing,
    hostAllowed: hostAllowed,
    buildNo: buildNoValue,
    setBuildNo: setBuildNo,
    // test/debug surface
    _config: CONFIG,
    _beforeSend: beforeSend,
    _beforeBreadcrumb: beforeBreadcrumb,
    _scrub: scrubString,
    _scrubValue: scrubValue,
    _parseFrames: parseFrames,
    _isBusinessFailure: isBusinessFailure,
    _hostAllowed: hostAllowed,
    _allow: allow,
    _reset: function () {
      initialized = false;
      handlersInstalled = false;
      installId = '';
    },
    RING_KEY: RING_KEY,
    RING_CAP: RING_CAP,
    RATE: RATE
  };
  root.MTCrash = api;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
