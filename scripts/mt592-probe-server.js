#!/usr/bin/env node
// #592 — 真机 XCUITest 通过局域网 GET 触发 Mac 侧 devicectl 只读核对（测试进程在设备上跑）。
const http = require('http');
const { probe } = require('./mt592-ext-path.js');

const PORT = Number(process.env.MT592_PROBE_PORT || '59292');
const HOST = process.env.MT592_PROBE_BIND || '0.0.0.0';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/ext-path' || req.url === '/ext-path/')) {
    let body;
    try {
      body = JSON.stringify(probe());
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  res.writeHead(404);
  res.end('not found\n');
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`mt592-probe-server listening on http://${HOST}:${PORT}\n`);
});
