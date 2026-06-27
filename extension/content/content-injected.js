// content-injected.js — Runs in PAGE WORLD (not extension context)
// Injected via <script> tag to intercept YouTube's timedtext API requests.
// This is a progressive enhancement; the MutationObserver approach in
// content-youtube.js is the primary strategy.

(function () {
  if (window.__mt_injected__) return;
  window.__mt_injected__ = true;

  const OriginalXHR = window.XMLHttpRequest;

  function InterceptedXHR() {
    const xhr = new OriginalXHR();
    let _url = '';

    const open = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...args) {
      _url = url;
      return open(method, url, ...args);
    };

    const send = xhr.send.bind(xhr);
    xhr.send = function (...args) {
      if (_url && _url.includes('timedtext')) {
        // Notify content script about the subtitle URL
        window.postMessage({
          type: '__MT_SUBTITLE_URL__',
          url: _url
        }, '*');
      }
      return send(...args);
    };

    return xhr;
  }

  // Copy static properties
  Object.setPrototypeOf(InterceptedXHR.prototype, OriginalXHR.prototype);
  Object.setPrototypeOf(InterceptedXHR, OriginalXHR);

  try {
    window.XMLHttpRequest = InterceptedXHR;
  } catch (e) {
    // Readonly in some environments — graceful fail
  }
})();
