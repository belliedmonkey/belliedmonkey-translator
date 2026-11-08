// app/secure-store.js — 本机 Keychain 的 JS 半边（1.21.2 泰语 Grok BYOK）。
// 原生：app/native/secure-store-bridge.swift（通道 mtSecure；#if !CHINA；iOS+Mac）。
//
// 页面只经这里存/取命名密钥。回执里 get 才带 value（进内存），ack 永不含值。
// 无桥（china / 老壳 / 浏览器扩展）⇒ 全部方法安静失败：present=false。
(function () {
  'use strict';
  const CHANNEL = 'mtSecure';
  const pending = new Map(); // req → { resolve }
  let seq = 0;

  function post(msg) {
    try {
      const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[CHANNEL];
      if (!h || typeof h.postMessage !== 'function') return false;
      h.postMessage(msg);
      return true;
    } catch (_) { return false; }
  }

  function available() {
    try {
      return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[CHANNEL]);
    } catch (_) { return false; }
  }

  function reqId() {
    seq += 1;
    return 's' + seq + '-' + Date.now().toString(36);
  }

  function wait(req, ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        pending.delete(req);
        resolve({ ok: false, present: false, status: -1, value: '' });
      }, ms || 4000);
      pending.set(req, {
        resolve: (m) => {
          clearTimeout(t);
          pending.delete(req);
          resolve(m);
        },
      });
    });
  }

  function onNative(msg) {
    if (!msg || !msg.req) return;
    const p = pending.get(msg.req);
    if (!p) return;
    const present = msg.present === true;
    p.resolve({
      ok: true,
      present: present,
      status: Number(msg.status) || 0,
      account: String(msg.account || ''),
      // value 只在 secure-value 且 present 时出现；别处永不带。
      value: present && typeof msg.value === 'string' ? msg.value : '',
    });
  }

  async function set(account, value) {
    const a = String(account || '').trim();
    if (!a) return { ok: false, present: false, status: -1 };
    if (!available()) return { ok: false, present: false, status: -2 };
    const req = reqId();
    const waiter = wait(req);
    if (!post({ type: 'secure-set', account: a, value: String(value == null ? '' : value), req: req })) {
      pending.delete(req);
      return { ok: false, present: false, status: -2 };
    }
    return waiter;
  }

  async function get(account) {
    const a = String(account || '').trim();
    if (!a) return { ok: false, present: false, status: -1, value: '' };
    if (!available()) return { ok: false, present: false, status: -2, value: '' };
    const req = reqId();
    const waiter = wait(req);
    if (!post({ type: 'secure-get', account: a, req: req })) {
      pending.delete(req);
      return { ok: false, present: false, status: -2, value: '' };
    }
    return waiter;
  }

  async function clear(account) {
    return set(account, '');
  }

  window.AppSecureStore = { available, set, get, clear, onNative };
})();
