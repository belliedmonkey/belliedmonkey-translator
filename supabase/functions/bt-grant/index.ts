// bt-grant — 领一枚免费额度令牌（docs/learning-design.md §8.10）。
//
// 用户拿到的**不是**提供方的 API key，而是一枚只有我们的中继认识的令牌
// （`bmg_` + 43 字符）。提供方的 key 只在 bt-relay 的环境变量里，永不离开服务器。
// 这是 2026-09-08 用户裁定「额度不走自带 key，额度走我们服务端」的入口那一半。
//
// 这个函数的全部权限都只针对**调用者自己**：user id 从 JWT 经 GoTrue 解出来，
// 不接受任何 user id 入参（同 bt-delete-account）。幂等在 SQL 里（bt_grant_claim
// 的 on conflict），不在这里 —— 两台设备同时点「领取」必须得到同一枚令牌（D1）。
//
//   supabase secrets set GRANT_KEK=<base64 32 字节> GRANT_LIMIT_USD=0.2 GRANT_DAILY_CAP=50
//   supabase functions deploy bt-grant

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const KEK_B64 = Deno.env.get('GRANT_KEK') || '';
const LIMIT_USD = Number(Deno.env.get('GRANT_LIMIT_USD') || '0.2');
const DAILY_CAP = Number(Deno.env.get('GRANT_DAILY_CAP') || '50');
const IP_PER_HOUR = 5;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// 错误只回一个 snake_id：客户端按它选文案（grant_err_*），而一个带细节的错误正文
// 迟早会把我们自己的配置抄给攻击者。
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 令牌加密另存一份，只为 D1：换设备再领要能回传**同一枚**。库泄露单独无用 ——
// KEK 在函数密钥里，不在库里。
async function kek() {
  return crypto.subtle.importKey('raw', unb64(KEK_B64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function seal(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kek(), new TextEncoder().encode(plain));
  return { ct: b64(new Uint8Array(ct)), iv: b64(iv) };
}
async function open_(ct: string, iv: string) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await kek(), unb64(ct));
  return new TextDecoder().decode(pt);
}

async function rpc(fn: string, args: unknown) {
  return fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
}

// isolate 内的限速（同 bt-ingest：冷启动清零，是下限保护不是配额系统）。
// 真正的上限是 SQL 里的 user_id 主键（一人一枚）与全局日上限。
const perIp = new Map<string, { h: number; n: number }>();
function ipLimited(ip: string) {
  const h = Math.floor(Date.now() / 3600000);
  const b = perIp.get(ip);
  if (!b || b.h !== h) { perIp.set(ip, { h, n: 1 }); return false; }
  b.n += 1; return b.n > IP_PER_HOUR;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!KEK_B64) return json({ error: 'grant_misconfigured' }, 503);

  // ⚠️ 这一支在**部署为 verify_jwt: true 时基本走不到**：平台的 JWT 校验跑在我们的
  // 代码之前，没带 Authorization 会直接被它挡成
  //   401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
  // ——**不是**我们这里的 {"error":"session"}（2026-09-08 部署后实测）。所以客户端映射
  // 错误码时，401 的两种正文格式都要认成「登录过期了」，不能只匹配 snake_id。
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'session' }, 401);

  // 经 GoTrue 解析调用者，不在这里解 JWT —— 自己解会接受一个格式正确但已吊销的 token。
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON } });
  if (!who.ok) return json({ error: 'session' }, 401);
  const user = await who.json();
  if (!user?.id) return json({ error: 'session' }, 401);

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (ipLimited(ip)) return json({ error: 'busy' }, 429);

  const token = 'bmg_' + b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = await sha256Hex(token);
  const { ct, iv } = await seal(token);

  // 日上限在 SQL 里判（只拦新铸，不拦已经领过的人）—— 见 schema.sql 里 bt_grant_claim
  // 上面那段注释：在这里先查后插会漏判，先插后查已经铸出去了。
  const res = await rpc('bt_grant_claim', {
    p_user: user.id, p_hash: hash, p_ct: ct, p_iv: iv,
    p_limit: LIMIT_USD, p_daily_cap: DAILY_CAP,
  });
  if (!res.ok) return json({ error: 'server' }, 500);
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return json({ error: 'server' }, 500);

  if (row.capped) return json({ error: 'busy' }, 429);

  if (row.reused) {
    if (row.status !== 'active') return json({ error: 'revoked' }, 409);
    const existing = await open_(row.token_ct, row.token_iv);
    return json({
      token: existing, limit_usd: Number(row.limit_usd),
      spent_usd: Number(row.spent_usd), reused: true,
    });
  }

  return json({ token, limit_usd: LIMIT_USD, spent_usd: 0, reused: false });
});
