// agent/test-host.js — in-process stand-in used only when MT_AGENT_TEST_HOST=1.
//
// It still goes through the confirm gate. It records effects and never starts
// a microphone. It is not a remote MCP and it is not a plugin wrapper.
'use strict';

const fs = require('fs');

function create(logPath) {
  function write(op, extra) {
    if (!logPath) return;
    fs.appendFileSync(logPath, JSON.stringify(Object.assign({ op, micStarted: false }, extra || {})) + '\n');
  }
  return {
    readiness: {
      login: true,
      packs: true,
      engine: true,
      os: true,
      ext: true,
      mic: true,
      studyCapture: true,
    },
    ports: {
      openSetup(req) { write('openSetup', { step: req.step || '' }); return { ok: true }; },
      enterSubtitle(req) {
        write('enterSubtitle', { videoLang: req.langs && req.langs.videoLang || '' });
        return { ok: true };
      },
      translatePage() { write('translatePage'); return { ok: true }; },
      translateCaptions() { write('translateCaptions'); return { ok: true }; },
      capture(req) {
        write('capture', { chars: Array.from(String(req.text || '')).length });
        return { ok: true };
      },
      explain(req) { write('explain', { mode: req.mode || '' }); return { ok: true }; },
    },
  };
}

module.exports = { create };
