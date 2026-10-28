// app/offline-video-asr.js — page side of the Mac-only offline video subtitle bridge.
//
// Domain-design §2.8. This file does not import the listen path, the streaming
// pump, or the translation engine. The native half exists only on macOS and
// only launches `python -m offline_video_asr`. The flag defaults off.
(function (root) {
  'use strict';

  var FLAG = 'offlineVideoAsr';
  var CHANNEL = 'mtOfflineVideoAsr';
  var pendingProbe = null;

  function handler() {
    var webkit = root.webkit;
    var handlers = webkit && webkit.messageHandlers;
    return handlers && handlers[CHANNEL];
  }

  function post(msg) {
    var bridge = handler();
    if (!bridge || typeof bridge.postMessage !== 'function') return false;
    bridge.postMessage(msg);
    return true;
  }

  function trackTask(result, code) {
    if (typeof MTTelemetry === 'undefined' || !MTTelemetry || typeof MTTelemetry.track !== 'function') return;
    var props = { result: result };
    if (code) props.code = code;
    MTTelemetry.track('offline_video_asr_task', props);
  }

  function onEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'probe' && pendingProbe) {
      var done = pendingProbe;
      pendingProbe = null;
      done(ev);
      return;
    }
    if (ev.type !== 'result') return;
    if (ev.code === 'flag_off') return;
    if (ev.ok) trackTask('ok');
    else if (ev.code === 'cancelled') trackTask('cancelled', 'cancelled');
    else trackTask('fail', ev.code || 'sidecar_crash');
  }

  function probe() {
    return new Promise(function (resolve) {
      pendingProbe = resolve;
      if (!post({ type: 'probe' })) {
        pendingProbe = null;
        resolve({ type: 'probe', enabled: false, reason: 'not_mac_app' });
      }
    });
  }

  function start(inputPath, outDir) {
    if (!handler()) return { ok: false, code: 'flag_off', reason: 'not_mac_app' };
    var sent = post({ type: 'start', input: String(inputPath || ''), out: String(outDir || '') });
    return sent ? { ok: true, pending: true } : { ok: false, code: 'flag_off' };
  }

  function cancel() {
    return post({ type: 'cancel' });
  }

  root.__mtOfflineVideoAsrEvent = onEvent;
  root.OfflineVideoAsr = {
    flag: FLAG,
    channel: CHANNEL,
    probe: probe,
    start: start,
    cancel: cancel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
