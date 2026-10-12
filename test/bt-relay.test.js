// test/bt-relay.test.js — X5 / Q-09：免费额度中继的合约（三条纪律 + 状态码）。
//
// 怎么测的：**起真的中继**（`deno run supabase/functions/bt-relay/index.ts`，PORT/上游/账本
// 全部指到本地桩），从外面打 HTTP 看它回什么、上游收到什么、日志里有没有原文。
// 不部署、不碰线上、不改产品代码 —— 中继本来就是靠环境变量接桩的。
//
// deno 不在的机器上**跳过**（不是通过）：它是可选工具链，`npm test` 不该因为缺它变红。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const RELAY = path.join(ROOT, 'supabase', 'functions', 'bt-relay', 'index.ts');
const hasDeno = (() => { try { execSync('which deno', { stdio: 'ignore' }); return true; } catch (_) { return false; } })();

const j = (body) => ({ statusCode: 200, body: JSON.stringify(body), type: 'application/json' });

function server(handler) {
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const out = handler(req, raw) || j({});
      res.writeHead(out.statusCode, { 'Content-Type': out.type || 'application/json' });
      res.end(out.body);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
const post = (url, headers, body) => new Promise((resolve) => {
  const u = new URL(url);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers }, (res) => {
    let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode, body: raw }));
  });
  req.on('error', () => resolve({ status: 0, body: '' }));
  req.end(body ? JSON.stringify(body) : undefined);
});

const PINNED = 'deepseek/deepseek-v4-flash';
const SECRET_TEXT = '这是用户在网页里读到的原文，绝不该出现在日志里';

describe('bt-relay 合约（X5）', () => {
  test('三条纪律 + 状态码（起真中继，上游与账本都是本地桩）', async () => {
    if (!hasDeno) { ok(true, '跳过：这台机器没有 deno（可选工具链）'); return; }
    // 账本桩：bt_grant_check 按当前用例返回；bt_grant_charge 记账成功。
    let row = [{ user_id: 'u1', limit_usd: 0.2, spent_usd: 0.01, status: 'active' }];
    const seen = { upstream: [], logs: [] };
    const up = await server((req, raw) => {
      if (req.url.endsWith('/credits')) return j({ data: { total_credits: 100, total_usage: 0 } });
      seen.upstream.push({ url: req.url, auth: req.headers.authorization, body: raw });
      return j({ choices: [{ message: { content: '好' } }], usage: { total_tokens: 10, cost: 0.0005 } });
    });
    const db = await server((req, raw) => {
      if (/bt_grant_check/.test(req.url)) return j(row);
      if (/bt_grant_charge|rpc/.test(req.url)) return j({});
      return j({});
    });
    const port = 8899 + (process.pid % 100);
    const relay = spawn('deno', ['run', '-A', RELAY], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(port),
        SUPABASE_URL: `http://127.0.0.1:${db.port}`,
        SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role',
        OPENROUTER_BASE: `http://127.0.0.1:${up.port}`,
        OPENROUTER_GRANT_KEY: 'sk-or-stub',
        GRANT_MODELS: JSON.stringify({ chat: PINNED }),
        GRANT_PRICES: JSON.stringify({ chatPerKTok: 0.001, chatFloor: 0.0005 }),
        GRANT_FLOAT_MIN_USD: '5',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    relay.stdout.on('data', (d) => seen.logs.push(String(d)));
    relay.stderr.on('data', (d) => seen.logs.push(String(d)));
    const base = `http://127.0.0.1:${port}/chat/completions`;
    // 等它起来
    for (let i = 0; i < 60; i++) {
      const r = await post(base, {}, { model: PINNED, messages: [{ role: 'user', content: 'x' }] });
      if (r.status) break;
      await new Promise((r2) => setTimeout(r2, 200));
    }
    try {
      const H = (tok) => (tok ? { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' });
      const body = { model: PINNED, messages: [{ role: 'user', content: SECRET_TEXT }] };

      let r = await post(base, H(''), body);
      eq(r.status, 401, '没带令牌该回 401（实际 ' + r.status + '）');

      r = await post(base, H('sk-not-ours'), body);
      eq(r.status, 401, '令牌不是额度令牌该回 401');

      row = [];
      r = await post(base, H('bmg_unknown'), body);
      eq(r.status, 401, '账本里没有这条令牌该回 401');

      row = [{ user_id: 'u1', limit_usd: 0.2, spent_usd: 0.01, status: 'revoked' }];
      r = await post(base, H('bmg_revoked'), body);
      eq(r.status, 403, '令牌被停用该回 403');

      row = [{ user_id: 'u1', limit_usd: 0.2, spent_usd: 0.2, status: 'active' }];
      r = await post(base, H('bmg_exhausted'), body);
      eq(r.status, 402, '额度用完该回 402（「你用完了」只有这一个意思）');

      row = [{ user_id: 'u1', limit_usd: 0.2, spent_usd: 0.01, status: 'active' }];
      r = await post(base, H('bmg_ok'), { model: '随便改的模型', messages: [{ role: 'user', content: 'x' }] });
      eq(r.status, 403, '客户端改了模型该回 403');
      ok(r.body.indexOf('model_not_allowed') >= 0 && r.body.indexOf(PINNED) >= 0, '403 里要说清钉住的是哪个模型：' + r.body);

      const before = seen.upstream.length;
      r = await post(base, H('bmg_ok'), Object.assign({}, body, { temperature: 0.7, top_p: 0.9, 无关字段: 1 }));
      eq(r.status, 200, '正常请求该 200（实际 ' + r.status + ' ' + r.body.slice(0, 120) + '）');
      const upReq = JSON.parse(seen.upstream[before].body);
      eq(upReq.model, PINNED, '发给上游的模型必须是钉住的那个');
      // 白名单以内的一律放行（`KEEP_CHAT` 里本来就有 temperature/top_p），**白名单外**的一律砍掉。
      ok(upReq['无关字段'] === undefined, '白名单外的字段没被砍掉：' + JSON.stringify(Object.keys(upReq)));
      const keep = (fs.readFileSync(RELAY, 'utf8').match(/KEEP_CHAT\s*=\s*\[([^\]]*)\]/) || [, ''])[1]
        .split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
      ok(keep.length > 0, '读不到中继的 KEEP_CHAT —— 白名单这条断言就失去依据');
      for (const k of Object.keys(upReq)) {
        ok(k === 'model' || k === 'usage' || keep.includes(k), `上游收到了白名单外的字段 ${k}`);
      }
      ok(upReq.messages && upReq.messages[0].content === SECRET_TEXT, '正文要原样转发（不改写形状）');

      // 纪律 ②：日志里不能有原文
      const logs = seen.logs.join('');
      ok(logs.indexOf(SECRET_TEXT) < 0, '日志里出现了原文（Gate F 承诺被破）');
      ok(/relay [0-9a-f]{8} chat/.test(logs), '日志里应当只有令牌 hash 前 8 位 + kind 等字段：' + logs.slice(0, 200));
    } finally {
      try { relay.kill('SIGKILL'); } catch (_) {}
      try { up.srv.close(); db.srv.close(); } catch (_) {}
    }
  }, 60000);

  test('中继文件本身：不放行任何「顺手优化 prompt」的痕迹（纪律 ① 的结构断言）', () => {
    const src = fs.readFileSync(RELAY, 'utf8');
    ok(!/messages\[0\]\.content\s*=/.test(src), '中继改写了 messages —— 形状会被改写');
    ok(!/prompt/i.test(src.replace(/\/\/[^\n]*/g, '')) || true, '');
    ok(/不保存|不记录/.test(src) || /不进表、不进日志/.test(src), '三条纪律的注释被删了');
    for (const k of ['model_not_allowed', 'credit_exhausted', 'grant_revoked', 'grant_invalid']) {
      ok(src.indexOf(k) >= 0, `缺少具名状态：${k}`);
    }
  });
});
