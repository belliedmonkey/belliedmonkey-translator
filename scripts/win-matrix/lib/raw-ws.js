'use strict';
// lib/raw-ws.js —— 最小 RFC 6455 客户端，唯一的存在理由是**能改 Host 头**。
// Firefox 的远程代理（WebDriver BiDi）只接受 Host 为回环地址的握手：经 Windows 的 portproxy 从 Mac 连进去时，
// 默认的 Host 是 <台式机IP>:9223，一律 400；写成 127.0.0.1:9222 才 101（2026-09-18 用 curl 逐个 Host 试出来的）。
// Node 自带的 WebSocket 不让设 Host，所以手写。只实现文本帧、分片、ping/pong、close。
function rawWs(host, port, pathname, hostHeader) {
  const net = require('net'), crypto = require('crypto');
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host);
    const key = crypto.randomBytes(16).toString('base64');
    const listeners = { message: [], error: [], close: [] };
    const api = { addEventListener: (ev, fn) => listeners[ev].push(fn), send: (text) => sock.write(frame(text)), close: () => sock.end() };
    let buf = Buffer.alloc(0), upgraded = false;
    sock.on('error', (e) => { if (!upgraded) reject(e); else listeners.error.forEach((f) => f(e)); });
    sock.on('connect', () => sock.write(`GET ${pathname} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; const head = buf.slice(0, i).toString(); buf = buf.slice(i + 4); if (!/^HTTP\/1\.1 101/.test(head)) { reject(new Error('handshake: ' + head.split('\r\n')[0])); sock.destroy(); return; } upgraded = true; resolve(api); }
      for (;;) {
        if (buf.length < 2) return; const fin = buf[0] & 0x80, op = buf[0] & 0x0f; let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return; const payload = buf.slice(off, off + len); buf = buf.slice(off + len);
        if (op === 8) { listeners.close.forEach((f) => f()); sock.end(); return; }
        if (op === 9) { sock.write(frame(payload, 0xA)); continue; }
        if (op === 1 || op === 0) { api._frag = (api._frag || '') + payload.toString('utf8'); if (fin) { const data = api._frag; api._frag = ''; listeners.message.forEach((f) => f({ data })); } }
      }
    });
    function frame(data, op = 1) { const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'); const mask = crypto.randomBytes(4); const n = payload.length; const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.concat([Buffer.from([0x80 | op, 0x80 | 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; })()]) : Buffer.concat([Buffer.from([0x80 | op, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]); const masked = Buffer.alloc(n); for (let i = 0; i < n; i++) masked[i] = payload[i] ^ mask[i & 3]; return Buffer.concat([head, mask, masked]); }
  });
}

module.exports = { rawWs };
