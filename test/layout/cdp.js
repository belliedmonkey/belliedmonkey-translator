// cdp.js — zero-dependency Chrome DevTools Protocol client.
// Uses Node's built-in WebSocket (Node >= 22). Flat-session protocol:
// browser-level commands have no sessionId; page commands carry one.
'use strict';

const http = require('http');

function httpJson(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.closed = false;
    this.pending = new Map();   // id -> {resolve, reject}
    this.listeners = [];        // {event, fn}
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(`CDP ${m.error.message || JSON.stringify(m.error)}`));
        else resolve(m.result);
      } else if (m.method) {
        for (const l of this.listeners) {
          if (l.event === m.method) l.fn(m.params, m.sessionId);
        }
      }
    });
    // A dropped socket (Chrome crash) must reject every in-flight send — otherwise
    // the suite hangs forever instead of exiting 1 (silence is never success).
    const drain = (why) => () => {
      this.closed = true; // a later send() on a closed WS silently discards — never settle silently
      for (const { reject } of this.pending.values()) reject(new Error(`CDP socket ${why}`));
      this.pending.clear();
    };
    ws.addEventListener('close', drain('closed'));
    ws.addEventListener('error', drain('errored'));
  }

  static async connect(port) {
    const ver = await httpJson(port, '/json/version');
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    if (this.closed || this.ws.readyState !== 1) {
      return Promise.reject(new Error(`CDP socket not open (${method})`));
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(event, fn) {
    const l = { event, fn };
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }

  close() { try { this.ws.close(); } catch (_) { /* already closed */ } }
}

module.exports = { CDP };
