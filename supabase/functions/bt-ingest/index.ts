// bt-ingest — 匿名用量事件的唯一入口（docs/telemetry-design.md §4）。
//
// 部署时 **不校验 JWT**（`--no-verify-jwt`）：调用方是注入到每个页面的内容脚本，
// 而 build.js 的铁律是 anon key 不能进内容脚本 —— 所以这个端点只认 URL，不认 key。
// 代价是任何人都能往这里 POST，因此这里的校验是**白名单 + 硬上限**，不是「大致合理」：
//
//   · 事件名、属性键、枚举值必须在 events.gen.json（由 build/telemetry.config.js 生成）里
//   · 字符串 ≤ 64 字符，且不能含 http / @ —— 没人能把 URL、邮箱、原文塞进来
//   · 单条 ≤ 1 KB、单批 ≤ 50 条、请求体 ≤ 64 KB、每个 install_id 每分钟 ≤ 60 条
//   · flavor 只收 'global'：中国版按设计一个字节都不发，收到就是有人伪造
//
// telemetry_off 不落库：收到即删掉该 install_id 的全部行，并给 bt_optouts 计一次数。
//
//   supabase functions deploy bt-ingest --no-verify-jwt

import spec from './events.gen.json' with { type: 'json' };

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const ID = /^[a-z0-9_-]{1,32}$/;
const LANG = /^[a-z]{2,3}$/;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const LIMITS = spec.limits as { batch: number; eventBytes: number; bodyBytes: number; perMinute: number; strMax: number };

type Rule = string | string[];
function okValue(rule: Rule, v: unknown): boolean {
  if (Array.isArray(rule)) return typeof v === 'string' && rule.includes(v);
  if (typeof v === 'string' && (v.length > LIMITS.strMax || /http|@/i.test(v))) return false;
  switch (rule) {
    case 'int': return Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e10;
    case 'id': return typeof v === 'string' && ID.test(v);
    case 'uuid': return typeof v === 'string' && UUID.test(v);
    case 'semver': return typeof v === 'string' && SEMVER.test(v);
    case 'lang': return typeof v === 'string' && (v === '' || LANG.test(v));
    case 'iso': {
      if (typeof v !== 'string') return false;
      const t = Date.parse(v); return Number.isFinite(t) && Math.abs(t - Date.now()) < WEEK_MS;
    }
    default: return false;
  }
}

// 一条事件 → 可入库的行，或一个拒绝理由。**多出来的键一律拒**：白名单的意义就在这。
function validate(e: Record<string, unknown>): { row?: Record<string, unknown>; why?: string } {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return { why: 'not_object' };
  if (JSON.stringify(e).length > LIMITS.eventBytes) return { why: 'too_big' };
  const common = spec.common as Record<string, Rule>;
  const events = spec.events as Record<string, Record<string, Rule>>;
  const name = e.name;
  if (typeof name !== 'string' || !(name in events)) return { why: 'unknown_event' };
  const allowed = new Set(['name', 'props', ...Object.keys(common)]);
  for (const k of Object.keys(e)) if (!allowed.has(k)) return { why: 'unknown_key:' + k };
  for (const [k, rule] of Object.entries(common)) {
    if (!(k in e)) { if (k === 'device' || k === 'ui') continue; return { why: 'missing:' + k }; }
    if (!okValue(rule, e[k])) return { why: 'bad:' + k };
  }
  const propSpec = events[name];
  const props = (e.props ?? {}) as Record<string, unknown>;
  if (typeof props !== 'object' || Array.isArray(props)) return { why: 'bad:props' };
  for (const k of Object.keys(props)) {
    if (!(k in propSpec)) return { why: 'unknown_prop:' + k };
    if (!okValue(propSpec[k], props[k])) return { why: 'bad_prop:' + k };
  }
  return {
    row: {
      install_id: e.install_id, ts: e.ts, v: e.v, flavor: e.flavor, host: e.host,
      device: e.device ?? '', ui: e.ui ?? '', name, props,
    },
  };
}

// 每个 isolate 内的限速。冷启动会清零 —— 这是下限保护，不是配额系统；真正的上限是
// 单批 50 条 + 单条 1 KB + 表的 180 天保留。
const bucket = new Map<string, { m: number; n: number }>();
function limited(id: string, count: number): boolean {
  const m = Math.floor(Date.now() / 60000);
  const b = bucket.get(id);
  if (!b || b.m !== m) { bucket.set(id, { m, n: count }); return count > LIMITS.perMinute; }
  b.n += count; return b.n > LIMITS.perMinute;
}

async function rest(path: string, init: RequestInit) {
  return fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const len = Number(req.headers.get('content-length') || 0);
  if (len > LIMITS.bodyBytes) return json({ error: 'too_big' }, 413);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const list = Array.isArray(body) ? body : (body && typeof body === 'object' && Array.isArray((body as { events?: unknown }).events))
    ? (body as { events: unknown[] }).events : null;
  if (!list) return json({ error: 'expected_array' }, 400);
  if (list.length === 0 || list.length > LIMITS.batch) return json({ error: 'batch_size' }, 400);

  const rows: Record<string, unknown>[] = [];
  const rejected: string[] = [];
  const offs = new Set<string>();
  for (const e of list) {
    const r = validate(e as Record<string, unknown>);
    if (!r.row) { rejected.push(r.why!); continue; }
    if (r.row.name === 'telemetry_off') { offs.add(r.row.install_id as string); continue; }
    rows.push(r.row);
  }

  // 限速按 install_id 计。一个批里混了多个 id 本身就可疑 —— 整批拒。
  const ids = new Set([...rows.map((r) => r.install_id as string), ...offs]);
  if (ids.size > 1) return json({ error: 'mixed_install_ids' }, 400);
  const id = [...ids][0];
  if (id && limited(id, list.length)) return json({ error: 'rate_limited' }, 429);

  // 关闭 = 删光。先删再插不会出错：同一批里 off 之后的事件不该再有，有也当没有。
  if (offs.size) {
    const del = await rest(`bt_events?install_id=eq.${id}`, { method: 'DELETE' });
    if (!del.ok) return json({ error: 'delete_failed' }, 500);
    const day = new Date().toISOString().slice(0, 10);
    await rest('rpc/bt_optout_bump', { method: 'POST', body: JSON.stringify({ d: day }) });
    return json({ deleted: true, rejected });
  }

  if (rows.length) {
    const ins = await rest('bt_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
    if (!ins.ok) return json({ error: 'insert_failed', detail: (await res_text(ins)).slice(0, 200) }, 500);
  }
  return json({ accepted: rows.length, rejected });
});

async function res_text(r: Response) { try { return await r.text(); } catch { return ''; } }
