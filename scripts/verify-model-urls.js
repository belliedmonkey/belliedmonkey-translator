#!/usr/bin/env node
// scripts/verify-model-urls.js — 离线朗读包**真的下得到**吗（2026-10-03 加，Kokoro 接入）。
//
// 为什么单列一个脚本而不是进 `npm test`：它要**联网**，而 `npm test` 必须能在离线机器上跑。
// 但它守的那件事很硬 —— 包是首启的**硬门**（#532）：清单里的 url 打不通，用户就卡在屏 2，
// 而 App 侧的表现只是「下不动」，不报错、也不回退。所以发布前必须真去握手一次。
//
//   node scripts/verify-model-urls.js           # HEAD 每个 url 与 url_alt，核对 content-length
//   node scripts/verify-model-urls.js --range   # 再取头 1 MB 比对 sha256 前缀（慢，防 CDN 换文件）
'use strict';
const https = require('https');
const crypto = require('crypto');
const { MT_DEVICE_TTS_MODELS, MT_DEVICE_LID, MT_DEVICE_VAD } = require('../app/device-models.config.js');
const ranged = process.argv.includes('--range');

function request(url, opts, hops = 0) {
  // 魔搭的 CDN 对没有 User-Agent 的请求直接 403（2026-10-03 实测：node 默认 UA 403，
  // 带常见浏览器 UA 拿得到 206）—— 探测要像真客户端。
  const o = Object.assign({ headers: {} }, opts);
  o.headers = Object.assign({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Accept: '*/*' }, opts.headers || {});
  return new Promise((resolve) => {
    const req = https.request(url, o, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 4) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(request(next, opts, hops + 1));
        return;
      }
      const cr = String(res.headers['content-range'] || '');
      const m = /\/(\d+)\s*$/.exec(cr);
      const body = { status: res.statusCode, cr, len: 0, hops };
      if (m) body.len = Number(m[1]);
      else if (opts.method !== 'HEAD') {
        // 范围 GET 没给 content-range 时，靠累计 body 长度也判不出来 —— 只报状态。
        let n = 0; res.on('data', (c) => { n += c.length; });
        res.on('end', () => { body.len = Number(res.headers['content-length'] || n); resolve(body); });
        return;
      } else body.len = Number(res.headers['content-length'] || 0);
      res.resume();
      resolve(body);
    });
    req.on('error', (e) => resolve({ status: 0, err: e.code || String(e) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, err: 'timeout' }); });
    req.end();
  });
}

const head = (url) => request(url, { method: 'HEAD', timeout: 30000 });
// HEAD 在很多 CDN 上给 `content-length: 0`（魔搭就是），所以拿不到长度时再发一个
// **范围 GET `bytes=0-0`**：响应的 `content-range: bytes 0-0/<总长>` 才是真长度。
const probe = (url) => request(url, { method: 'GET', timeout: 45000, headers: { Range: 'bytes=0-0' } });

const getRange = (url, bytes) => new Promise((resolve) => {
  const req = https.request(url, { method: 'GET', timeout: 60000, headers: { Range: `bytes=0-${bytes - 1}` } }, (res) => {
    const h = crypto.createHash('sha256');
    let n = 0;
    res.on('data', (c) => { h.update(c); n += c.length; });
    res.on('end', () => resolve({ status: res.statusCode, bytes: n, sha: h.digest('hex') }));
  });
  req.on('error', (e) => resolve({ status: 0, err: e.code || String(e) }));
  req.on('timeout', () => { req.destroy(); resolve({ status: 0, err: 'timeout' }); });
  req.end();
});

(async () => {
  let bad = 0, checked = 0;
  for (const m of [...MT_DEVICE_TTS_MODELS, MT_DEVICE_LID, MT_DEVICE_VAD]) {
    for (const f of m.files) {
      const urls = ['global', 'china']
        .map((fl) => [fl, f.url[fl]])
        .filter(([, u]) => typeof u === 'string' && u);
      for (const [tag, u] of urls) {
        checked++;
        let r = await head(u);
        if (r.status !== 200 || r.len !== f.size) r = await probe(u);
        const ok = (r.status === 200 || r.status === 206) && r.len === f.size;
        if (!ok) bad++;
        console.log(`${ok ? '✓' : '✗'} ${m.lang || m.kind || 'lid'} ${tag} ${r.status} ${r.len === f.size ? '' : `len=${r.len} 期望 ${f.size} `}${r.err || ''}${r.cr ? ' [' + r.cr + ']' : ''}\n    ${u}`);
        if (ok && ranged) {
          const g = await getRange(u, 1024 * 1024);
          const expect = require('fs').existsSync('.local/device-models/' + f.path)
            ? crypto.createHash('sha256').update(require('fs').readFileSync('.local/device-models/' + f.path).slice(0, 1024 * 1024)).digest('hex') : null;
          const same = expect ? (g.sha === expect) : null;
          console.log(`    头 1 MB：${g.bytes} 字节${same === null ? '（本地没有原包，跳过比对）' : same ? ' ✓ 与本地包一致' : ' ✗ 与本地包不一致'}`);
          if (same === false) bad++;
        }
      }
    }
  }
  console.log(bad ? `\n✗ ${bad}/${checked} 个地址不可用 —— 别带着这个发布：包是首启硬门，下不动用户就卡在屏 2。` : `\n✓ ${checked} 个地址全部可用且长度一致。`);
  process.exit(bad ? 1 : 0);
})();
