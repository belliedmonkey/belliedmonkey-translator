// yt-hook.js — runs in the PAGE (MAIN) world (manifest content_scripts world:"MAIN").
//
// YouTube serves the full timed transcript at /api/timedtext, but that URL needs
// a valid pot/signature that only YouTube's own player generates. So instead of
// forging the request, we hook fetch + XHR and CAPTURE YouTube's OWN
// /api/timedtext request and response (which already carry the valid token), then
// forward the transcript to the extension's isolated content script via
// postMessage. This is how a no-backend client gets the transcript for
// translate-ahead. Must run in world:MAIN — a <script src> injection would be
// blocked by YouTube's strict-dynamic CSP.
(() => {
  if (window.__mtYtHookInstalled) return;
  window.__mtYtHookInstalled = true;

  const MATCH = '/api/timedtext';

  function forward(url, body) {
    if (!body) return;
    try {
      window.postMessage(
        { __mtYtHook: true, type: 'timedtext', url: String(url), body: String(body) },
        '*'
      );
    } catch (_) {}
  }

  // ── fetch hook ──
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      let url = '';
      try { url = (args[0] && args[0].url) || args[0] || ''; } catch (_) {}
      const p = origFetch.apply(this, args);
      if (typeof url === 'string' && url.indexOf(MATCH) !== -1) {
        p.then((r) => {
          try { r.clone().text().then((b) => forward(url, b)).catch(() => {}); } catch (_) {}
        }).catch(() => {});
      }
      return p;
    };
  }

  // ── XMLHttpRequest hook ──
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__mtUrl = url; } catch (_) {}
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    try {
      if (this.__mtUrl && String(this.__mtUrl).indexOf(MATCH) !== -1) {
        this.addEventListener('load', () => {
          try { if (this.status === 200) forward(this.__mtUrl, this.responseText); } catch (_) {}
        });
      }
    } catch (_) {}
    return XS.apply(this, a);
  };
})();
