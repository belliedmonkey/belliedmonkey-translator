// bt-grant-ledger — 额度账本的窄口（learning-design §8.10.1 方案 C，2026-09-22）。
//
// 境内中继（腾讯云云函数）要查额度、扣额度，而账本在这个项目里。原来的做法是把
// service_role 交给中继 —— 那是**整个库的最高权限**，放到另一家云上，那边出一次事就是
// 全部用户数据暴露，而中继真正要的只有两个动作。所以用户 2026-09-22 裁定：service_role
// 不出这个项目，中继只拿一把**只能做这两件事**的专用钥匙。
//
// 这把钥匙泄露的最坏后果：有人能查某个令牌 hash 的余额（要先知道 hash），或者给某个令牌
// 多记账（只会让它早用完，不能加额度、不能读任何内容、不能碰任何别的表）。
//
//   POST /check   {"p_hash": "<64 位 hex>"}                       → bt_grant_check 的原样结果
//   POST /charge  {"p_hash", "p_kind", "p_model", "p_cost", "p_ms"} → bt_grant_charge 的原样结果
//   头 x-ledger-key: <LEDGER_KEY>
//
//   supabase secrets set LEDGER_KEY=<openssl rand -hex 32>
//   supabase functions deploy bt-grant-ledger --no-verify-jwt
//
// 不校验 JWT：调用方是一台服务器，不是登录用户；身份就是那把钥匙。

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LEDGER_KEY = Deno.env.get('LEDGER_KEY') || '';
const MAX_COST = 0.05;             // 单次记账的上限（美元）：一次请求不可能花这么多，超了就是钥匙被滥用

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 等长比较，别让比较时间泄露钥匙前缀。
function same(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function rpc(fn: string, args: unknown) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
}

const HEX64 = /^[0-9a-f]{64}$/;

Deno.serve(async (req) => {
  if (!LEDGER_KEY) return json({ error: 'ledger_misconfigured' }, 503);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!same(req.headers.get('x-ledger-key') || '', LEDGER_KEY)) return json({ error: 'forbidden' }, 403);

  const p = new URL(req.url).pathname.replace(/^.*\/bt-grant-ledger/, '');
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (!b || typeof b.p_hash !== 'string' || !HEX64.test(b.p_hash)) return json({ error: 'bad_request' }, 400);

  if (p === '/check') return rpc('bt_grant_check', { p_hash: b.p_hash });

  if (p === '/charge') {
    const cost = Number(b.p_cost), ms = Number(b.p_ms);
    if (!['chat', 'tts', 'stt'].includes(String(b.p_kind))) return json({ error: 'bad_request' }, 400);
    if (typeof b.p_model !== 'string' || !b.p_model || b.p_model.length > 100) return json({ error: 'bad_request' }, 400);
    if (!Number.isFinite(cost) || cost <= 0 || cost > MAX_COST) return json({ error: 'bad_request' }, 400);
    if (!Number.isFinite(ms) || ms < 0) return json({ error: 'bad_request' }, 400);
    return rpc('bt_grant_charge', { p_hash: b.p_hash, p_kind: b.p_kind, p_model: b.p_model, p_cost: cost, p_ms: Math.round(ms) });
  }
  return json({ error: 'not_found' }, 404);
});
