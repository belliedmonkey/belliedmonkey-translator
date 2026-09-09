// bt-relay — 免费额度的中继（docs/learning-design.md §8.10）。
//
// 用户裁定（2026-09-08）：「额度不走自带 key，额度走我们服务端」。所以翻译 / 朗读 /
// 转写的请求打到这里，由我们用**我们自己的**提供方 key 转发，服务端计量，每账号
// 花到 limit 就 402。提供方的 key 永不离开这台机器。
//
// 三条纪律，破了哪一条这个端点就变成别的东西：
//
//   1. **不改写形状。** 传输层（content/wire-format.js · request-shape.js）眼里这就是
//      又一个兼容端点：路径后缀决定形状，请求体和响应体原样进出。中继只做四件事 ——
//      验令牌、钉模型、砍掉白名单外的字段、记账。任何「顺便优化一下 prompt」的念头
//      都会让扩展里那份实现和这里这份分叉，而分叉的那天没人会发现。
//   2. **不碰内容。** 转发的文本不进表、不进日志。日志只有令牌 hash 的前 8 位、kind、
//      cost、ms、状态码。Gate F 那段承诺（「我们不保存、不记录内容」）就靠这一条。
//   3. **模型钉死在服务端。** 客户端能改自己的 apiModel，但那只会换来一个 403 ——
//      额度的成本估算（learning-design §8.10 规则 9）是按钉住的那个模型算的。
//
// 部署时 **不校验 JWT**（`--no-verify-jwt`）：调用方是内容脚本，它拿的是额度令牌，
// 不是 Supabase 的 JWT —— 内容脚本永不持有 learnAuth（learning-design §8.4.1.1）。
//
//   supabase secrets set OPENROUTER_GRANT_KEY=sk-or-... \
//     GRANT_MODELS='{"chat":"deepseek/deepseek-v4-flash","tts":"...","stt":"..."}' \
//     GRANT_PRICES='{"ttsPerKChar":0.015,"sttPerMB":0.02,"chatPerKTok":0.001,"chatFloor":0.0005}' \
//     GRANT_FLOAT_MIN_USD=5
//   supabase functions deploy bt-relay --no-verify-jwt

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OR_KEY = Deno.env.get('OPENROUTER_GRANT_KEY') || '';
const OR_BASE = Deno.env.get('OPENROUTER_BASE') || 'https://openrouter.ai/api/v1';
// 密钥里的 JSON 写错一个字符，模块加载期就抛 —— 整个函数变成一个没有正文的 500，
// 而 500 不会告诉任何人「你的 GRANT_MODELS 少了个引号」。解析失败要能说出是哪一个。
function envJson<T>(name: string): T | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { console.log('relay: bad JSON in ' + name); return null; }
}
const MODELS = envJson<Record<string, string>>('GRANT_MODELS') || {};
const PRICES = envJson<Record<string, number>>('GRANT_PRICES') || {};
const FLOAT_MIN = Number(Deno.env.get('GRANT_FLOAT_MIN_USD') || '5');

const PER_MIN = 60;                       // 每枚令牌每分钟的请求数
const CAP_CHAT = 64 * 1024;
const CAP_TTS = 32 * 1024;
const CAP_STT = 25 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rpc(fn: string, args: unknown) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(fn + ' ' + r.status);
  return r.json();
}

// ── 池子。低于底线就停转发，并且**说清楚是我们的问题**（503，不是 402）。
//    两句话必须分开：把「我们没钱了」说成「你用完了」，用户会去申请一把他本来
//    不需要申请的 key，而我们连自己欠了什么都不知道。
let floatCache = { at: 0, usd: Infinity };
async function floatOk(): Promise<boolean> {
  if (Date.now() - floatCache.at < 600_000) return floatCache.usd >= FLOAT_MIN;
  try {
    const r = await fetch(`${OR_BASE}/credits`, { headers: { Authorization: `Bearer ${OR_KEY}` } });
    if (!r.ok) return true;                       // 读不到不等于没钱，别自己把自己关掉
    const d = await r.json();
    const total = Number(d?.data?.total_credits ?? 0);
    const used = Number(d?.data?.total_usage ?? 0);
    floatCache = { at: Date.now(), usd: total - used };
  } catch { return true; }
  return floatCache.usd >= FLOAT_MIN;
}

// isolate 内的限速（同 bt-ingest：冷启动清零，是下限保护）。真正的上限是余额。
const bucket = new Map<string, { m: number; n: number }>();
function limited(hash: string) {
  const m = Math.floor(Date.now() / 60000);
  const b = bucket.get(hash);
  if (!b || b.m !== m) { bucket.set(hash, { m, n: 1 }); return false; }
  b.n += 1; return b.n > PER_MIN;
}

// ── 字段白名单。多出来的键一律**丢掉**（不是报错）：用户在「详细」里填的自定义参数
//    不该让整页翻译失败，但也不该由我们替他付一个我们没估算过的账。
const KEEP_CHAT = ['messages', 'temperature', 'max_tokens', 'top_p', 'response_format', 'seed'];
const KEEP_TTS = ['input', 'voice', 'response_format', 'speed'];

type Shape = 'chat' | 'tts' | 'stt';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!OR_KEY) return json({ error: 'grant_misconfigured' }, 503);

  const url = new URL(req.url);
  // 路径后缀就是形状 —— 与 wire-format.js 同一条规则（domain-design §7）。
  const p = url.pathname.replace(/^.*\/bt-relay/, '');

  if (req.method === 'GET' && p === '/spec') {
    // 巡检脚本的回读点：中继钉住的模型必须与注册表 defaultModel 逐字相同
    // （scripts/grant-float.js 断言）。两处不一致 = 客户端说的和服务端做的不是一回事。
    return json({ models: MODELS, float_min_usd: FLOAT_MIN });
  }

  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token.startsWith('bmg_')) return json({ error: 'grant_invalid' }, 401);
  const hash = await sha256Hex(token);
  const tag = hash.slice(0, 8);

  let row: { user_id: string; limit_usd: number; spent_usd: number; status: string } | undefined;
  try {
    const rows = await rpc('bt_grant_check', { p_hash: hash });
    row = Array.isArray(rows) ? rows[0] : rows;
  } catch { return json({ error: 'server' }, 500); }
  if (!row) return json({ error: 'grant_invalid' }, 401);
  if (row.status !== 'active') return json({ error: 'grant_revoked' }, 403);

  const left = Number(row.limit_usd) - Number(row.spent_usd);

  if (req.method === 'GET' && p === '/balance') {
    return json({ limit_usd: Number(row.limit_usd), spent_usd: Number(row.spent_usd), remaining_usd: left });
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  // 402 是「你用完了」，只有这一个意思。
  if (left <= 0) return json({ error: 'credit_exhausted' }, 402);
  if (limited(hash)) return json({ error: 'busy' }, 429);
  if (!(await floatOk())) return json({ error: 'grant_unavailable' }, 503);

  const shape: Shape | null = p === '/chat/completions' ? 'chat'
    : p === '/audio/speech' ? 'tts'
      : p === '/audio/transcriptions' ? 'stt' : null;
  if (!shape) return json({ error: 'not_found' }, 404);

  const model = MODELS[shape];
  // 没配这一档的模型（或 GRANT_MODELS 根本没解出来）—— 具名 503，不是静默 500。
  if (!model) { console.log('relay', tag, shape, 'no_model_configured'); return json({ error: 'grant_misconfigured' }, 503); }

  const t0 = Date.now();
  let upstream: Response;
  let charged = 0;

  try {
    if (shape === 'stt') {
      const len = Number(req.headers.get('content-length') || 0);
      if (len > CAP_STT) return json({ error: 'too_big' }, 413);
      const inForm = await req.formData();
      const out = new FormData();
      const file = inForm.get('file');
      if (!(file instanceof File)) return json({ error: 'bad_request' }, 400);
      out.set('file', file, file.name || 'audio.webm');
      out.set('model', model);                       // 钉死，忽略客户端送的
      for (const k of ['language', 'response_format', 'timestamp_granularities[]']) {
        const v = inForm.get(k);
        if (typeof v === 'string') out.set(k, v);
      }
      upstream = await fetch(`${OR_BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OR_KEY}` },
        body: out,
      });
      // 转写按上传字节估价，且**往高了估** —— 估低了就是我们替所有人多付钱，而
      // 我们看不到它。G6 由 /perf-tune 用真实账单校准 GRANT_PRICES.sttPerMB。
      // **这只是兜底**，真实花费在下面用上游的 usage.cost 覆盖（见 shape==='stt' 那一段）。
      // 按字节估转写在两个方向上都错得离谱：未压缩 PCM 高约 6 倍，mp3 低约 10 倍 ——
      // 同一句话，编码不同价钱差 60 倍。所以它只配当最后一级。
      charged = (file.size / (1024 * 1024)) * (PRICES.sttPerMB ?? 0.02);
    } else {
      const len = Number(req.headers.get('content-length') || 0);
      if (len > (shape === 'chat' ? CAP_CHAT : CAP_TTS)) return json({ error: 'too_big' }, 413);
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
      if (!body || typeof body !== 'object') return json({ error: 'bad_request' }, 400);

      // 客户端把模型改掉了 —— 具名 403，客户端给一句「改回 {model}」。
      if (typeof body.model === 'string' && body.model && body.model !== model) {
        return json({ error: 'model_not_allowed', model }, 403);
      }
      const keep = shape === 'chat' ? KEEP_CHAT : KEEP_TTS;
      const sent: Record<string, unknown> = { model };
      for (const k of keep) if (k in body) sent[k] = body[k];
      if (shape === 'chat') {
        if (!Array.isArray(sent.messages) || !sent.messages.length) return json({ error: 'bad_request' }, 400);
        sent.usage = { include: true };              // 让提供方把这一次的真实花费告诉我们
      } else if (typeof sent.input !== 'string' || !sent.input) {
        return json({ error: 'bad_request' }, 400);
      }

      upstream = await fetch(`${OR_BASE}/${shape === 'chat' ? 'chat/completions' : 'audio/speech'}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(sent),
      });
      if (shape === 'tts') {
        charged = ((sent.input as string).length / 1000) * (PRICES.ttsPerKChar ?? 0.015);
      }
    }
  } catch (e) {
    console.log('relay', tag, shape, 'upstream_error', String(e).slice(0, 120));
    return json({ error: 'upstream' }, 502);
  }

  const ms = Date.now() - t0;

  // 上游的钱的问题也是 402/403，但它说的是**我们的**账号 —— 对用户而言那是我们的
  // 问题，不是他用完了。翻译成 503，文案是「不是你用完了」。
  if (upstream.status === 402 || upstream.status === 403) {
    console.log('relay', tag, shape, 'upstream_billing', upstream.status);
    return json({ error: 'grant_unavailable' }, 503);
  }

  let out: Response;
  if (shape === 'tts') {
    const buf = await upstream.arrayBuffer();
    out = new Response(buf, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg' },
    });
  } else {
    const text = await upstream.text();
    // 转写也有真实花费可拿 —— 这一段原来没有，注释里还写着「我们看不到它」。
    // 2026-09-09 实测：`/audio/transcriptions` 的返回带 `usage: { seconds, cost }`，
    // **两种 response_format 都带**（说题那条路不要 verbose_json，照样有）。
    // 于是这一档一直在按字节记账：同一轮实测里中继扣 $0.0106，上游实收 $0.0018。
    //
    // 三级，理由同 chat 那一段：只认 usage.cost 的话，提供方哪天不返回它，
    // spent_usd 就永远是 0 —— 上限从此不再生效，而界面上一切正常。
    //   1. usage.cost —— 精确
    //   2. duration × 每分钟价 —— verbose_json 会报 duration，是个好得多的代理
    //   3. 字节 × 每 MB 价 —— 最后一级，只为「永远有个数」而存在
    if (shape === 'stt' && upstream.ok) {
      try {
        const d = JSON.parse(text);
        const cost = Number(d?.usage?.cost);
        if (Number.isFinite(cost) && cost > 0) charged = cost;
        else {
          const secs = Number(d?.usage?.seconds ?? d?.duration);
          if (Number.isFinite(secs) && secs > 0) charged = (secs / 60) * (PRICES.sttPerMin ?? 0.007);
        }
      } catch { /* 解不出来就留着上面那个按字节的兜底 */ }
    }
    if (shape === 'chat' && upstream.ok) {
      // 三级兜底，而且**必须**有第三级：只认 usage.cost 的话，提供方哪天不返回它，
      // spent_usd 就永远是 0 —— 上限从此不再生效，而界面上一切正常。这正是这个仓库
      // 反复付过学费的那种失败（出了问题但没人说）。宁可估高，也不要一个不封顶的口子。
      let got = 0;
      try {
        const d = JSON.parse(text);
        const cost = Number(d?.usage?.cost);
        if (Number.isFinite(cost) && cost > 0) got = cost;
        else {
          const tok = Number(d?.usage?.total_tokens);
          if (Number.isFinite(tok) && tok > 0) got = (tok / 1000) * (PRICES.chatPerKTok ?? 0.001);
        }
      } catch { /* 解不出来就走下面的地板价 */ }
      charged = got > 0 ? got : (PRICES.chatFloor ?? 0.0005);
    }
    out = new Response(text, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
    });
  }

  // 失败的请求不记账。记账失败也不影响这一次的响应 —— 用户已经拿到东西了，
  // 少记一次账是我们的损失，把成功的响应吞掉才是他的。
  if (upstream.ok && charged > 0) {
    try {
      const leftNow = await rpc('bt_grant_charge', {
        p_hash: hash, p_kind: shape, p_model: model, p_cost: charged, p_ms: ms,
      });
      console.log('relay', tag, shape, upstream.status, ms + 'ms', charged.toFixed(6), 'left=' + leftNow);
    } catch (e) {
      console.log('relay', tag, shape, 'charge_failed', String(e).slice(0, 80));
    }
  } else {
    console.log('relay', tag, shape, upstream.status, ms + 'ms');
  }
  return out;
});
