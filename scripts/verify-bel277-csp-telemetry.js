#!/usr/bin/env node
// verify-bel277-csp-telemetry.js — BEL-277 的真 Chrome CSP fixture（本地门，不进 CI）。
//
// 验的是「页面 CSP connect-src 'none' ⇒ 内容脚本 fetch 必然被拦」这个真实形状下：
//   ① MTTelemetry.track/flush 经 SW 把事件 POST 到本地 ingest（直连不可能成功）；
//   ② SW 拒绝非本 build ingest 的 URL（url_not_allowed），不把它变成开放代理；
//   ③ 同一 CSP 页面上字幕菜单（DOM 回退）仍然开得出。
//
// 用法：node build.js && node scripts/verify-bel277-csp-telemetry.js
// 需要 Chrome/Edge；会临时拷一份 dist 并把端点改成 127.0.0.1 的自签 HTTPS 桩。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');
const { launchChrome } = require('../test/layout/chrome');
const { CDP } = require('../test/layout/cdp');

const ROOT = path.join(__dirname, '..');
const INGEST_PATH = '/functions/v1/bt-ingest';

function selfSignedCert(dir) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function patchDist(dist, ingestPort) {
  const providers = path.join(dist, 'content', 'providers.gen.js');
  const src = fs.readFileSync(providers, 'utf8');
  const line = src.split('\n').find((l) => l.startsWith('window.MT_TELEMETRY = '));
  if (!line) throw new Error('dist/content/providers.gen.js has no MT_TELEMETRY');
  const tel = JSON.parse(line.slice('window.MT_TELEMETRY = '.length).replace(/;$/, ''));
  const endpoints = JSON.parse(fs.readFileSync(path.join(dist, 'telemetry-endpoints.json'), 'utf8'));
  const url = `https://127.0.0.1:${ingestPort}${INGEST_PATH}`;
  tel.url = url;
  tel.allowAutomation = true;             // CDP 驱动下 navigator.webdriver=true；本门要真的发
  endpoints.ingest = [url];
  fs.writeFileSync(providers, src.replace(line, `window.MT_TELEMETRY = ${JSON.stringify(tel)};`));
  fs.writeFileSync(path.join(dist, 'telemetry-endpoints.json'), JSON.stringify(endpoints, null, 2) + '\n');
}

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bel277-csp-'));
  const dist = path.join(base, 'dist');
  fs.cpSync(path.join(ROOT, 'dist'), dist, { recursive: true });
  const cert = selfSignedCert(base);
  const received = [];
  const ingest = https.createServer(cert, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url, method: req.method, ct: req.headers['content-type'], body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => ingest.listen(0, '127.0.0.1', r));
  patchDist(dist, ingest.address().port);

  const page = http.createServer((req, res) => {
    // 这就是票面的 CSP fixture：内容脚本的 fetch 一定被这条 header 拦掉。
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self'; connect-src 'none'",
    });
    res.end('<!doctype html><title>bel277-csp</title><p>csp fixture</p>');
  });
  await new Promise((r) => page.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${page.address().port}/`;

  const chrome = await launchChrome(['--ignore-certificate-errors', '--allow-insecure-localhost']);
  const cdp = await CDP.connect(chrome.port);
  try {
    await cdp.send('Extensions.loadUnpacked', { path: dist });
    const { targetId } = await cdp.send('Target.createTarget', { url: pageUrl });
    const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', (p) => contexts.push(p.context));
    await cdp.send('Page.navigate', { url: pageUrl }, sid);

    let extContextId = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !extContextId) {
      for (const ctx of contexts) {
        try {
          const r = await cdp.send('Runtime.evaluate', {
            expression: "typeof MTTelemetry === 'object' && typeof SubtitleAdapter === 'object'",
            contextId: ctx.id,
          }, sid);
          if (r.result && r.result.value === true) { extContextId = ctx.id; break; }
        } catch (_) { /* other world */ }
      }
      if (!extContextId) await new Promise((r) => setTimeout(r, 100));
    }
    if (!extContextId) throw new Error('extension isolated world not found (content scripts not injected?)');

    const probe = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const out = {};
        // ① CSP 页上仍报得出去：track/flush 只能走 SW。
        out.track = await MTTelemetry.track('heartbeat');
        out.flush = await MTTelemetry.flush();
        // ② SW 对非本 build URL 必须拒绝。
        out.rejected = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'telemetrySend', url: 'https://evil.test/functions/v1/bt-ingest',
            init: { method: 'POST', body: '[]' } }, resolve);
        });
        // ③ 同一 CSP 页面上菜单仍然开得出（本页不在静态条目的 bounded 列表里 ⇒ DOM 回退）。
        const btn = document.createElement('button'); btn.id = 'csp-btn'; document.body.appendChild(btn);
        out.via = SubtitleAdapter._openMenu({ id: 'csp-menu', btn, closeMenu: () => {} , rows: [
          { kind: 'row', label: '行甲', checked: true, onClick: () => {} },
          { kind: 'sep' }, { kind: 'head', label: '标题乙' },
          { kind: 'row', label: '行丙', onClick: () => {} },
        ] });
        const menu = document.getElementById('csp-menu');
        out.menu = !!menu && menu.children.length === 4;
        document.getElementById('csp-menu')?.remove();
        return JSON.stringify(out);
      })()`,
      contextId: extContextId, awaitPromise: true, returnByValue: true,
    }, sid);
    if (probe.exceptionDetails) throw new Error(probe.exceptionDetails.exception?.description || probe.exceptionDetails.text);
    const v = JSON.parse(probe.result.value);
    await new Promise((r) => setTimeout(r, 300));

    if (!v.track || !v.flush) throw new Error(`CSP 页上遥测没报出去：${JSON.stringify(v)}`);
    if (!v.rejected || v.rejected.ok !== false || v.rejected.error !== 'url_not_allowed') {
      throw new Error(`SW 没拒绝外站 URL：${JSON.stringify(v.rejected)}`);
    }
    if (v.via !== 'fallback' || !v.menu) throw new Error(`CSP 页上菜单没开：${JSON.stringify(v)}`);
    if (received.length !== 1) throw new Error(`ingest 收到 ${received.length} 次请求，期望 1 次：${JSON.stringify(received)}`);
    const rows = JSON.parse(received[0].body);
    if (!Array.isArray(rows) || !rows.some((e) => e.name === 'heartbeat')) {
      throw new Error(`ingest body 里没有 heartbeat：${received[0].body}`);
    }
    if (!/text\/plain/.test(received[0].ct || '')) throw new Error(`content-type 不是 text/plain：${received[0].ct}`);
    console.log(`① CSP connect-src 'none' 下仍上报（${rows.length} 条，含 heartbeat → 本地 ingest，content-type=${received[0].ct}）`);
    console.log(`② 外站 URL 被 SW 拒绝（${v.rejected.error}），没有成为开放代理`);
    console.log(`③ 同一 CSP 页面菜单开启（via=${v.via}, rows=4）`);
    console.log('PASS: BEL-277 CSP fixture (real Chrome)');
  } finally {
    cdp.close();
    chrome.cleanup();
    page.close();
    ingest.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
