// agent/device-bridge-store.js — the Node/CLI store for the BEL-151 device client.
//
// device-bridge.js is deliberately I/O-free: the App bundles it into a page that
// has no `fs`, so the 0600 JSON file it used to create for a CLI pairing lives
// here instead. Node callers that want the old default use createNodeClient();
// every other caller (the App, the probes, the tests) passes its own store.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const bridge = require('./device-bridge');

function fileStore(file) {
  const target = file || process.env.MT_AGENT_DEVICE_STORE
    || path.join(os.homedir(), '.belliedmonkey', 'agent-device.json');
  function readAll() {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  function writeAll(all) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  }
  return {
    path: target,
    getItem(key) {
      const value = readAll()[key];
      return value == null ? null : value;
    },
    setItem(key, value) {
      const all = readAll();
      all[key] = String(value);
      writeAll(all);
    },
    removeItem(key) {
      const all = readAll();
      delete all[key];
      writeAll(all);
    },
  };
}

let defaultStoreRef = null;
function defaultStore() {
  if (!defaultStoreRef) defaultStoreRef = fileStore();
  return defaultStoreRef;
}

// The old createClient() default, now explicit. One device id per install.
function createNodeClient(options) {
  const opts = Object.assign({}, options || {});
  if (!opts.store) opts.store = defaultStore();
  return bridge.createClient(opts);
}

module.exports = { fileStore, defaultStore, createNodeClient };
