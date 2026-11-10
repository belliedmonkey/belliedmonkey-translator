// app/native/http-shim.js — the page half of the native HTTP bridge (1.23.4 C5).
//
// Injected at document start into the App's main WKWebView and the quick-panel
// WKWebView (both are ours; this file is NOT an extension bundle module). It wraps
// `fetch` only for the exact hosts the native side allows:
//
//   global : MaaS 主机 (POST) + TTS OSS result hosts (GET)
//   china  : the OSS result hosts only — maas never enters a China build
//
// Everything else calls the original fetch, unchanged. There is one source of truth
// for the allowlist: `__MT_HTTP_ALLOW_JSON__` is replaced by scripts/sync-app-assets.js
// with the same JSON the Swift side gets.
//
// Response shape: a real `Response` (status/ok/headers/text/json/arrayBuffer are the
// platform's own). Binary is base64 over the message channel → Uint8Array.
//
// Kill switches: `window.__MT_HTTP_OFF = true` or `window.MTHttpBridge.enabled = false`.
(function () {
  'use strict';

  var ALLOW = __MT_HTTP_ALLOW_JSON__;
  var CHANNEL = 'mtHttp';
  var seq = 0;
  var pending = Object.create(null);
  var nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  var bridge = { enabled: true };
  window.MTHttpBridge = bridge;

  function handler() {
    try {
      return window.webkit && window.webkit.messageHandlers
        ? window.webkit.messageHandlers[CHANNEL] : null;
    } catch (_) { return null; }
  }

  function off() {
    return window.__MT_HTTP_OFF === true || bridge.enabled === false;
  }

  function allowed(url, method) {
    var u;
    try { u = new URL(url, window.location && window.location.href); } catch (_) { return false; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
    var host = String(u.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || /\.local$/.test(host)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.indexOf(':') >= 0) return false;
    for (var i = 0; i < ALLOW.length; i += 1) {
      var rule = ALLOW[i];
      if (!rule || !rule.methods || rule.methods.indexOf(method) < 0) continue;
      if (rule.host && String(rule.host).toLowerCase() === host) return true;
      if (rule.re) {
        try { if (new RegExp(rule.re).test(host)) return true; } catch (_) {}
      }
    }
    return false;
  }

  function headersToObject(h) {
    var out = {};
    if (!h) return out;
    if (typeof Headers !== 'undefined' && h instanceof Headers) {
      h.forEach(function (v, k) { out[k] = v; });
      return out;
    }
    if (Array.isArray(h)) {
      h.forEach(function (p) { if (p && p.length === 2) out[p[0]] = String(p[1]); });
      return out;
    }
    Object.keys(h).forEach(function (k) { out[k] = String(h[k]); });
    return out;
  }

  function bytesToBase64(bytes) {
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function textToBase64(text) {
    if (typeof TextEncoder !== 'undefined') return bytesToBase64(new TextEncoder().encode(text));
    return btoa(unescape(encodeURIComponent(text)));
  }

  function bodyToBase64(body) {
    if (body == null) return Promise.resolve('');
    if (typeof body === 'string') return Promise.resolve(textToBase64(body));
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      return Promise.resolve(textToBase64(body.toString()));
    }
    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
      return Promise.resolve(bytesToBase64(new Uint8Array(body)));
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(body)) {
      return Promise.resolve(bytesToBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)));
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob && body.arrayBuffer) {
      return body.arrayBuffer().then(function (b) { return bytesToBase64(new Uint8Array(b)); });
    }
    return Promise.resolve(textToBase64(String(body)));
  }

  function base64ToBytes(b64) {
    var bin = atob(b64 || '');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function finish(id, payload) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (p.cleanup) p.cleanup();
    if (payload && payload.error) {
      if (payload.error === 'aborted') p.reject(new DOMException('Aborted', 'AbortError'));
      else p.reject(new TypeError('fetch failed'));
      return;
    }
    var status = payload && payload.status ? (payload.status | 0) : 502;
    var body = null;
    if (status !== 204 && status !== 205 && status !== 304 && p.method !== 'HEAD') {
      body = base64ToBytes(payload && payload.bodyBase64);
    }
    try {
      p.resolve(new Response(body, {
        status: status,
        statusText: (payload && payload.statusText) || '',
        headers: (payload && payload.headers) || {},
      }));
    } catch (e) {
      p.reject(new TypeError('fetch failed'));
    }
  }

  window.__mtHttpResolve = function (id, payload) { finish(String(id), payload || {}); };

  function viaBridge(input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (!nativeFetch || off() || !handler() || !allowed(url, method)) return null;

    var signal = init && init.signal;
    if (signal && signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));

    var id = 'h' + (++seq) + '-' + Date.now();
    return bodyToBase64(init && init.body).then(function (b64) {
      return new Promise(function (resolve, reject) {
        var onAbort = null;
        pending[id] = {
          resolve: resolve,
          reject: reject,
          method: method,
          cleanup: function () {
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          },
        };
        if (signal) {
          onAbort = function () {
            var h = handler();
            if (h) { try { h.postMessage({ id: id, cancel: true }); } catch (_) {} }
            var p = pending[id];
            if (p) { delete pending[id]; p.cleanup(); p.reject(new DOMException('Aborted', 'AbortError')); }
          };
          signal.addEventListener('abort', onAbort);
        }
        var payload = {
          id: id,
          url: url,
          method: method,
          headers: headersToObject(init && init.headers),
        };
        if (b64) payload.bodyBase64 = b64;
        try { handler().postMessage(payload); }
        catch (e) {
          var failed = pending[id];
          delete pending[id];
          if (failed) failed.cleanup();
          if (onAbort && signal) signal.removeEventListener('abort', onAbort);
          reject(new TypeError('fetch failed'));
        }
      });
    });
  }

  window.fetch = function (input, init) {
    var p = viaBridge(input, init);
    if (p) return p;
    return nativeFetch ? nativeFetch(input, init) : Promise.reject(new TypeError('fetch unavailable'));
  };
})();
