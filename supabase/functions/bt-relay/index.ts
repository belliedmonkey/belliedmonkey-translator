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
//
// ── 同一份代码的第二个部署：中国版的境内中继（方案 C，learning-design §8.10.1）──
//
// 原文只走境内：境内机器上用 Deno 跑**这同一个文件**，上游换成阿里云百炼的兼容模式。
// **账本与账号同库**（2026-09-22 用户裁定）：`SUPABASE_URL` 指**部署处那台** —— 境内中继部署在
// 境内时，账本就是境内后端那份（`deploy/china/grants.sql` 建的表）。过境的只有身份，没有原文。
// 领取也由它代转（POST /claim → `SUPABASE_URL` 的 bt-grant，只带登录令牌），所以中国版产物里
// 一个东京的额度路径都没有（build/china-gate.js 按这一条验）。部署契约：deploy/china-relay/README.md。
//
//   UPSTREAM=dashscope  UPSTREAM_KEY=sk-...  CLAIM_PROXY=1
//   GRANT_MODELS='{"chat":"<注册表 qwen 的中国区 defaultModel>"}'
//   GRANT_PRICES='{"chatPerKTok":…,"chatFloor":…}'   ← 按百炼实价填，不许照抄上面那组
//
// 不设 UPSTREAM 时行为与从前**逐字相同**（OpenRouter、读余额、usage.include、没有 /claim）。
//
// ── 第三个值：UPSTREAM=qwencloud（#592，2026-10-15，默认关，未部署）──
//
// 不设、或仍是 openrouter / dashscope 时，下面这个分支不执行，请求体与状态码与现在相同。
// 打开之后按 X-Real-IP 选上游（复用 bt-models 的 isChina，不读客户端可伪造的 X-Forwarded-For）：
//   非中国 → QwenCloud 国际按量（https://docs.qwencloud.com ，2026-10-15）
//     聊天  POST {QWENCLOUD_CHAT_BASE}/chat/completions     模型 qwen3.7-plus
//     朗读  POST QWENCLOUD_TTS_URL                          模型 qwen3-tts-flash
//     转写  同一条 chat/completions + input_audio            模型 qwen3-asr-flash
//   中国   → 现有百炼兼容模式（UPSTREAM_KEY + UPSTREAM_BASE，默认 dashscope 北京）
// 两个基址不设时就是文档上的地址。单测把它们指到本地桩。密钥：非中国 QWENCLOUD_KEY，中国 UPSTREAM_KEY。
// 段表读不到就 503 grant_misconfigured，不把所有人当成非中国。
// 价格（活动折扣不计入，常量在下面）：
//   聊天 qwen3.7-plus ≤256K  输入 $0.40 / 输出 $1.60 每百万 token
//     https://docs.qwencloud.com/changelog/model-deprecations/old-models  “from 0.4 / from 1.6”
//   朗读 qwen3-tts-flash     $0.1 / 万字符（usage.characters；汉字按 2 计已含在返回值里）
//   转写 qwen3-asr-flash     usage.seconds × $0.000035

import { parseChinaCidrs, isChina } from "../bt-models/china-ip.ts";

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// 上游是谁。认三个值；认不出的值当配置错误（503），不猜。
// qwencloud 是 #592 的开关：不设时与从前逐字相同。
const UPSTREAM = Deno.env.get('UPSTREAM') || 'openrouter';
const IS_OR = UPSTREAM === 'openrouter';
const IS_QC = UPSTREAM === 'qwencloud';
const KNOWN_UPSTREAM = IS_OR || UPSTREAM === 'dashscope' || IS_QC;
const OR_KEY = IS_OR ? (Deno.env.get('OPENROUTER_GRANT_KEY') || '') : (Deno.env.get('UPSTREAM_KEY') || '');
const OR_BASE = IS_OR
  ? (Deno.env.get('OPENROUTER_BASE') || 'https://openrouter.ai/api/v1')
  : (Deno.env.get('UPSTREAM_BASE') || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
// 代转领取（只给境内中继开）。东京那个部署不设它 —— 那里客户端直接打 bt-grant。
// 代转的目标是 `SUPABASE_URL`（部署处那台）⇒ 境内部署时领取落在**境内**库，账本同库。
const CLAIM_PROXY = Deno.env.get('CLAIM_PROXY') === '1';
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

// QwenCloud 国际（只在 UPSTREAM=qwencloud 且非中国 IP 时用）。基址不设 = 文档上的地址。
const QC_KEY = Deno.env.get('QWENCLOUD_KEY') || '';
const QC_CHAT_BASE = (Deno.env.get('QWENCLOUD_CHAT_BASE') || 'https://maas.qwencloudapi.com/compatible-mode/v1').replace(/\/+$/, '');
const QC_TTS_URL = Deno.env.get('QWENCLOUD_TTS_URL') || 'https://maas.qwencloudapi.com/api/v1/services/aigc/multimodal-generation/generation';
const QC_CHAT = 'qwen3.7-plus';
const QC_TTS = 'qwen3-tts-flash';
const QC_STT = 'qwen3-asr-flash';
// 2026-10-15。来源见文件头。活动折扣（$0.32 / $1.28）不计入。
const QC_CHAT_IN_PER_M = 0.40;
const QC_CHAT_OUT_PER_M = 1.60;
const QC_TTS_PER_10K = 0.1;
const QC_ASR_PER_SEC = 0.000035;
// 编码后的 base64 超过这个长度就拒绝。10 MB 以下留余量（9 MiB）。
const QC_B64_MAX = 9 * 1024 * 1024;
// 旧客户端仍会送来这些模型名。接受并换成钉死的模型，不退回 OpenRouter。
const QC_LEGACY: Record<Shape, string> = {
  chat: 'deepseek/deepseek-v4-flash',
  tts: 'deepgram/aura-2',
  stt: 'openai/whisper-1',
};
// qwen3-tts-flash 非实时音色。2026-10-15
// https://docs.qwencloud.com/developer-guides/speech/voice-list/qwen-tts
const QC_FLASH_VOICES = new Set([
  'Cherry', 'Serena', 'Ethan', 'Chelsie', 'Momo', 'Vivian', 'Moon', 'Maia', 'Kai', 'Nofish',
  'Bella', 'Jennifer', 'Ryan', 'Katerina', 'Aiden', 'Eldric Sage', 'Mia', 'Mochi', 'Bellona',
  'Vincent', 'Bunny', 'Neil', 'Elias', 'Arthur', 'Nini', 'Seren', 'Pip', 'Stella', 'Bodega',
  'Sonrisa', 'Alek', 'Dolce', 'Sohee', 'Ono Anna', 'Lenn', 'Emilien', 'Andre', 'Radio Gol',
  'Jada', 'Dylan', 'Li', 'Marcus', 'Roy', 'Peter', 'Sunny', 'Eric', 'Rocky', 'Kiki',
]);

function qcAcceptsClientModel(shape: Shape, name: string): boolean {
  const intl = shape === 'chat' ? QC_CHAT : shape === 'tts' ? QC_TTS : QC_STT;
  return name === QC_LEGACY[shape] || name === intl;
}
function qcVoice(v: unknown): string {
  return typeof v === 'string' && QC_FLASH_VOICES.has(v) ? v : 'Cherry';
}
function isJsonObjectFormat(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  return keys.length === 1 && o.type === 'json_object';
}
function redactUrl(s: string): string {
  return s.replace(/https?:\/\/\S+/gi, '[url]');
}
function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: string[] = [];
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i];
    const b = i + 1 < n ? bytes[i + 1] : 0;
    const c = i + 2 < n ? bytes[i + 2] : 0;
    const v = (a << 16) | (b << 8) | c;
    out.push(alphabet[(v >> 18) & 63], alphabet[(v >> 12) & 63]);
    out.push(i + 1 < n ? alphabet[(v >> 6) & 63] : '=');
    out.push(i + 2 < n ? alphabet[v & 63] : '=');
  }
  return out.join('');
}

// 段表只在开关打开时读。读不到就整档 503，不把所有人当成非中国。
let CN_V4: { base: number; mask: number; bits: number }[] = [];
let CN_V6: string[] = [];
let CN_BAD = false;
if (IS_QC) {
  try {
    const txt = await Deno.readTextFile(new URL("../bt-models/cn-cidrs.txt", import.meta.url));
    const nets = parseChinaCidrs(txt);
    if (!nets.v4.length) throw new Error('empty');
    CN_V4 = nets.v4;
    CN_V6 = nets.v6;
  } catch (e) {
    CN_BAD = true;
    console.log('relay cn_cidr ' + redactUrl(String(e)).slice(0, 80));
  }
}

const PER_MIN = 60;                       // 每枚令牌每分钟的请求数
const CAP_CHAT = 64 * 1024;
const CAP_TTS = 32 * 1024;
const CAP_STT = 25 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 账本的两种走法。境内中继设 LEDGER_URL + LEDGER_KEY：只经 bt-grant-ledger 那个窄口查 / 扣额度，
// **不持有 service_role**（那是整个库的最高权限 —— 用户 2026-09-22 裁定：中继不拿它）。
// 东京那个部署不设它，照旧直连 RPC，行为不变。境内部署时 LEDGER_URL 指境内后端的窄口。
const LEDGER_URL = (Deno.env.get('LEDGER_URL') || '').replace(/\/+$/, '');
const LEDGER_KEY = Deno.env.get('LEDGER_KEY') || '';
const LEDGER_PATH: Record<string, string> = { bt_grant_check: '/check', bt_grant_charge: '/charge' };

async function rpc(fn: string, args: unknown) {
  if (LEDGER_URL) {
    const r = await fetch(LEDGER_URL + LEDGER_PATH[fn], {
      method: 'POST',
      headers: { 'x-ledger-key': LEDGER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(fn + ' ' + r.status);
    return r.json();
  }
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
  // 余额接口是 OpenRouter 独有的。百炼没有同形状的读法 —— 读不到不等于没钱（同下面那条），
  // 放行；那一侧的池子靠百炼控制台的余额告警盯，写在 deploy/china-relay/README.md。
  if (!IS_OR) return true;
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

// 端口：Supabase 上不设 PORT，照旧 Deno.serve(handler)（行为不变）。境内部署在腾讯云
// 「Web 函数」里时平台要求监听 0.0.0.0:9000，由 scf_bootstrap 传 PORT=9000 进来。
const PORT = Deno.env.get('PORT');
const serve = (h: (req: Request) => Response | Promise<Response>) =>
  PORT ? Deno.serve({ port: Number(PORT), hostname: '0.0.0.0' }, h) : Deno.serve(h);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // qwencloud 的密钥按 IP 分两把，缺哪一把在选完上游之后再 503。不设开关时这一行与从前相同。
  if (!KNOWN_UPSTREAM || (!IS_QC && !OR_KEY) || (IS_QC && CN_BAD)) return json({ error: 'grant_misconfigured' }, 503);

  const url = new URL(req.url);
  // 路径后缀就是形状 —— 与 wire-format.js 同一条规则（domain-design §7）。
  // 境内部署没有 /functions/v1/bt-relay 这段前缀，替换不命中，路径原样就是后缀。
  const p = url.pathname.replace(/^.*\/bt-relay/, '');

  // 代转领取：原样把登录令牌交给 `SUPABASE_URL` 的 bt-grant（境内部署时就是境内那台，
  // 账本与账号同库），原样把回答交回去。不看、不存、不改。
  // 过境的是身份（登录本身就已经过境，且有出境单独同意 #399），不是原文。
  if (CLAIM_PROXY && req.method === 'POST' && p === '/claim') {
    try {
      const r = await fetch(`${URL_}/functions/v1/bt-grant`, {
        method: 'POST',
        headers: {
          apikey: req.headers.get('apikey') || '',
          Authorization: req.headers.get('Authorization') || '',
        },
      });
      return new Response(await r.text(), {
        status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch { return json({ error: 'server' }, 502); }
  }

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

  let qcIsChina = false;
  let model = MODELS[shape];
  if (IS_QC) {
    qcIsChina = isChina(req.headers.get('x-real-ip') || '', CN_V4, CN_V6);
    if (qcIsChina) model = shape === 'chat' ? (MODELS.chat || 'qwen-plus') : (MODELS[shape] || '');
    else model = shape === 'chat' ? QC_CHAT : shape === 'tts' ? QC_TTS : QC_STT;
    const key = qcIsChina ? OR_KEY : QC_KEY;
    if (!model || !key) {
      console.log('relay', tag, shape, !model ? 'no_model_configured' : 'no_key');
      return json({ error: 'grant_misconfigured' }, 503);
    }
  } else if (!model) {
    // 没配这一档的模型（或 GRANT_MODELS 根本没解出来）—— 具名 503，不是静默 500。
    console.log('relay', tag, shape, 'no_model_configured');
    return json({ error: 'grant_misconfigured' }, 503);
  }
  const qcIntl = IS_QC && !qcIsChina;

  const t0 = Date.now();
  let upstream: Response;
  let charged = 0;

  try {
    if (shape === 'stt') {
      const len = Number(req.headers.get('content-length') || 0);
      if (len > CAP_STT) return json({ error: 'too_big' }, 413);
      const inForm = await req.formData();
      if (qcIntl) {
        // QwenCloud 转写：chat/completions + input_audio。时间戳档不接，不退回 OpenRouter。
        // 文档：https://docs.qwencloud.com/api-reference/speech-recognition/qwen-asr/openai （2026-10-15）
        const fmt = inForm.get('response_format');
        const tg = inForm.get('timestamp_granularities[]');
        if (fmt === 'verbose_json' || typeof tg === 'string') {
          return json({ error: 'timestamps_unsupported' }, 400);
        }
        const file = inForm.get('file');
        if (!(file instanceof File)) return json({ error: 'bad_request' }, 400);
        const clientModel = inForm.get('model');
        if (typeof clientModel === 'string' && clientModel && clientModel !== model && !qcAcceptsClientModel('stt', clientModel)) {
          return json({ error: 'model_not_allowed', model }, 403);
        }
        if (4 * Math.ceil(file.size / 3) > QC_B64_MAX) return json({ error: 'audio_too_large' }, 413);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = ((file.type || 'application/octet-stream').split(';')[0].trim().toLowerCase()) || 'application/octet-stream';
        const sent: Record<string, unknown> = {
          model,
          stream: false,
          messages: [{
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: `data:${mime};base64,${encodeBase64(bytes)}` } }],
          }],
        };
        const lang = inForm.get('language');
        if (typeof lang === 'string' && lang) sent.asr_options = { language: lang };
        upstream = await fetch(`${QC_CHAT_BASE}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${QC_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sent),
        });
      } else {
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
      }
    } else {
      const len = Number(req.headers.get('content-length') || 0);
      if (len > (shape === 'chat' ? CAP_CHAT : CAP_TTS)) return json({ error: 'too_big' }, 413);
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
      if (!body || typeof body !== 'object') return json({ error: 'bad_request' }, 400);

      // 客户端把模型改掉了 —— 具名 403，客户端给一句「改回 {model}」。
      // qwencloud 额外接受旧客户端的模型名，以及国际钉死名（中国 IP 会改写成北京的模型）。
      if (typeof body.model === 'string' && body.model && body.model !== model) {
        if (!(IS_QC && qcAcceptsClientModel(shape, body.model))) {
          return json({ error: 'model_not_allowed', model }, 403);
        }
      }
      if (qcIntl && shape === 'chat') {
        // 顶层 enable_thinking 由服务端写，不进客户端白名单。不写 temperature。
        // response_format 只留恰好 {"type":"json_object"}；带着它就丢掉 max_tokens
        // （结构化输出页：截断会得到非法 JSON）。2026-10-15
        // https://docs.qwencloud.com/api-reference/chat/openai-chat
        // https://docs.qwencloud.com/developer-guides/text-generation/thinking
        // https://docs.qwencloud.com/developer-guides/text-generation/structured-output
        if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: 'bad_request' }, 400);
        const sent: Record<string, unknown> = { model, enable_thinking: false };
        for (const k of KEEP_CHAT) if (k in body) sent[k] = body[k];
        if ('response_format' in sent && !isJsonObjectFormat(sent.response_format)) delete sent.response_format;
        if (isJsonObjectFormat(sent.response_format)) delete sent.max_tokens;
        upstream = await fetch(`${QC_CHAT_BASE}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${QC_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sent),
        });
      } else if (qcIntl && shape === 'tts') {
        // https://docs.qwencloud.com/api-reference/speech-synthesis/qwen-tts （2026-10-15）
        // language_type 的默认值是 Auto。音色不在 qwen3-tts-flash 名单里就用 Cherry。
        if (typeof body.input !== 'string' || !body.input) return json({ error: 'bad_request' }, 400);
        const sent = {
          model,
          input: { text: body.input, voice: qcVoice(body.voice), language_type: 'Auto' },
        };
        upstream = await fetch(QC_TTS_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${QC_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sent),
        });
        if (upstream.ok) {
          const raw = await upstream.text();
          let audioUrl = '';
          let chars = NaN;
          try {
            const d = JSON.parse(raw);
            audioUrl = typeof d?.output?.audio?.url === 'string' ? d.output.audio.url : '';
            chars = Number(d?.usage?.characters);
          } catch { audioUrl = ''; }
          charged = (Number.isFinite(chars) ? chars : (body.input as string).length) * QC_TTS_PER_10K / 10000;
          if (!audioUrl.startsWith('https://')) {
            console.log('relay', tag, 'tts', 'audio_url');
            return json({ error: 'upstream' }, 502);
          }
          let audio: Response;
          try {
            audio = await fetch(audioUrl, { redirect: 'manual' });
          } catch (e) {
            console.log('relay', tag, 'tts', 'audio_fetch', redactUrl(String(e)).slice(0, 120));
            return json({ error: 'upstream' }, 502);
          }
          if (audio.status !== 200) {
            console.log('relay', tag, 'tts', 'audio_fetch', String(audio.status));
            return json({ error: 'upstream' }, 502);
          }
          const buf = new Uint8Array(await audio.arrayBuffer());
          const ctype = audio.headers.get('content-type') || 'audio/wav';
          upstream = new Response(buf, { status: 200, headers: { 'content-type': ctype } });
        }
      } else {
        const keep = shape === 'chat' ? KEEP_CHAT : KEEP_TTS;
        const sent: Record<string, unknown> = { model };
        for (const k of keep) if (k in body) sent[k] = body[k];
        if (shape === 'chat') {
          if (!Array.isArray(sent.messages) || !sent.messages.length) return json({ error: 'bad_request' }, 400);
          // 让提供方把这一次的真实花费告诉我们。只有 OpenRouter 认这个字段；百炼的兼容模式
          // 不认的字段不该由我们替它试（model-params 那条纪律），它的花费走 total_tokens 那一级。
          if (IS_OR) sent.usage = { include: true };
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
    }
  } catch (e) {
    const raw = String(e);
    const msg = (IS_QC ? redactUrl(raw) : raw).slice(0, 120);
    console.log('relay', tag, shape, 'upstream_error', msg);
    return json({ error: 'upstream' }, 502);
  }

  const ms = Date.now() - t0;

  // 上游的钱的问题也是 402/403，但它说的是**我们的**账号 —— 对用户而言那是我们的
  // 问题，不是他用完了。翻译成 503，文案是「不是你用完了」。
  // qwencloud 打开时 401 同样改写（密钥是我们的）。开关关闭时 401 仍原样透传。
  if (upstream.status === 402 || upstream.status === 403 || (IS_QC && upstream.status === 401)) {
    console.log('relay', tag, shape, 'upstream_billing', upstream.status);
    return json({ error: 'grant_unavailable' }, 503);
  }
  if (IS_QC && upstream.status === 429) {
    console.log('relay', tag, shape, 'upstream_rate_limited');
    return json({ error: 'upstream_rate_limited' }, 429);
  }

  let out: Response;
  const ttsAsAudio = shape === 'tts' && !(qcIntl && !upstream.ok);
  if (ttsAsAudio) {
    const buf = await upstream.arrayBuffer();
    out = new Response(buf, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg' },
    });
  } else {
    const text = await upstream.text();
    let qcRewrite: string | null = null;
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
    if (qcIntl && shape === 'stt' && upstream.ok) {
      // 收成 {text}。缺 usage.seconds 就记 0，并写 usage_missing（不含音频、不含 URL）。
      let content: unknown;
      let secs = NaN;
      let hasSecs = false;
      try {
        const d = JSON.parse(text);
        content = d?.choices?.[0]?.message?.content;
        hasSecs = !!d?.usage && Object.prototype.hasOwnProperty.call(d.usage, 'seconds');
        secs = Number(d?.usage?.seconds);
      } catch { content = undefined; }
      if (typeof content !== 'string') {
        console.log('relay', tag, 'stt', 'bad_asr_body');
        return json({ error: 'upstream' }, 502);
      }
      qcRewrite = JSON.stringify({ text: content });
      if (hasSecs && Number.isFinite(secs) && secs >= 0) charged = secs * QC_ASR_PER_SEC;
      else {
        charged = 0;
        console.log('relay', tag, shape, 'usage_missing');
      }
    } else if (shape === 'stt' && upstream.ok) {
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
    if (qcIntl && shape === 'chat' && upstream.ok) {
      // prompt_tokens / completion_tokens × qwen3.7-plus 标价。两个字段都缺失才走 chatFloor。
      let missing = true;
      let got = 0;
      try {
        const d = JSON.parse(text);
        const usage = d?.usage;
        const pt = Number(usage?.prompt_tokens);
        const ct = Number(usage?.completion_tokens);
        const hasP = !!usage && Object.prototype.hasOwnProperty.call(usage, 'prompt_tokens') && Number.isFinite(pt);
        const hasC = !!usage && Object.prototype.hasOwnProperty.call(usage, 'completion_tokens') && Number.isFinite(ct);
        if (hasP || hasC) {
          missing = false;
          got = ((hasP ? pt : 0) / 1e6) * QC_CHAT_IN_PER_M + ((hasC ? ct : 0) / 1e6) * QC_CHAT_OUT_PER_M;
        }
      } catch { /* 走地板价 */ }
      charged = missing ? (PRICES.chatFloor ?? 0.0005) : got;
    } else if (shape === 'chat' && upstream.ok) {
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
    out = new Response(qcRewrite != null ? qcRewrite : text, {
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
