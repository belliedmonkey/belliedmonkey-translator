// 在 Node（腾讯云 Web 函数的原生运行环境）里提供 bt-relay 用到的那两样 Deno API：
// Deno.env.get 与 Deno.serve。**只做这两样** —— 中继的逻辑仍是 supabase/functions/bt-relay/
// index.ts 那一份（由 build-scf.sh 用 deno bundle 转成 relay.mjs），这里不许长出第二份逻辑。
//
// 为什么不直接带 Deno 进去：Linux 版 deno 解压 95 MB，且要 glibc ≥ 2.18，而云函数的运行
// 环境未必满足；Node 18+ 自带 fetch / Request / Response / FormData，缺的只有这两个入口。
import http from 'node:http';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;   // Node 18 没有全局 crypto

function serve(a, b) {
  const opts = typeof a === 'function' ? {} : (a || {});
  const handler = typeof a === 'function' ? a : b;
  const port = Number(opts.port || 8000);
  const hostname = opts.hostname || '0.0.0.0';
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const url = `http://${req.headers.host || 'localhost'}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      }
      const hasBody = body && req.method !== 'GET' && req.method !== 'HEAD';
      const out = await handler(new Request(url, { method: req.method, headers, body: hasBody ? body : undefined }));
      const buf = Buffer.from(await out.arrayBuffer());
      const h = {};
      out.headers.forEach((v, k) => { h[k] = v; });
      res.writeHead(out.status, h);
      res.end(buf);
    } catch (e) {
      console.log('shim: handler threw', String(e).slice(0, 120));
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"server"}');
    }
  });
  server.listen(port, hostname, () => console.log(`Listening on http://${hostname}:${port}/`));
  return server;
}

globalThis.Deno = { env: { get: (k) => process.env[k] }, serve };
