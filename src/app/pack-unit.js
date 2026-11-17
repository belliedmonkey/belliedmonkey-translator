// src/app/pack-unit.js — BEL-226/268/269：一次离线包下载单元的遥测契约。
//
// 从 shell-model.js 抽出来（BEL-290 follow-up）：首启包屏（shell-model 的
// runPackUnit）与听译页两处裸调 NativeSpeech.ensureVad（listen-model）必须共用
// 同一条 start → ok/fail、同一个 download_id、同一张失败 code 表。放在这里而不是
// 各写一份，是为了「首启路径」与「听译预热/开麦路径」不会漂移。
//
// 纯函数 + 注入 telemetry，不摸 DOM / React；shell-model 继续 re-export
// reportPackUnit（既有测试与调用点不变）。
export async function reportPackUnit(telemetry, info, fn, failCode) {
  let token = null;
  try { token = await telemetry.packStart(info); } catch (_) {}
  try {
    const r = await fn();
    if (token) { try { await telemetry.packOk(token); } catch (_) {} }
    return r;
  } catch (e) {
    if (token) {
      // BEL-293：tier / size 可能在 fn 里才确定（LID/TTS 要等 ModelSources 的
      // attempts），progress 由调用方已有的进度回调写进 info。packStart 不发
      // 这些键，但 token 带着它们到唯一失败出口。
      try {
        if (info && typeof info === 'object') {
          if (info.tier != null) token.tier = info.tier;
          if (info.size != null) token.size = info.size;
          if (info.progress != null) token.progress = info.progress;
        }
      } catch (_) { /* 归因缺字段不能挡失败 */ }
      try { await telemetry.packFail(token, e, failCode(e)); } catch (_) {}
    }
    throw e;
  }
}

// BEL-226：从实际模型地址判断 source。自家中继（api.belliedmonkey.com/models/）
// 背后由服务端按 IP 选托管，客户端看不见 ⇒ 'other'，不按 flavor 猜 GitHub /
// ModelScope；只有清单/服务器给的地址本身就是那些域才归过去。
export function packSourceFromSpec(spec) {
  try {
    const models = spec ? [].concat(spec) : [];
    for (const m of models) {
      for (const f of ((m && m.files) || [])) {
        const raw = String((f && f.url) || '');
        if (!raw) continue;
        let host = '';
        try { host = new URL(raw).hostname.toLowerCase(); } catch (_) { host = raw.toLowerCase(); }
        if (/github/.test(host)) return 'github';
        if (/modelscope/.test(host)) return 'modelscope';
      }
    }
  } catch (_) { /* 判断不了就是 other */ }
  return 'other';
}

// BEL-293：包规格里的声明大小（字节）。`files[].size` 是清单唯一来源；
// 系统 ASR 包由系统决定、拿不到 ⇒ 0（未知）。负数/非数字一律 0。
export function packSizeFromSpec(spec) {
  let total = 0;
  const seen = new Set();
  try {
    for (const m of (spec ? [].concat(spec) : [])) {
      for (const f of ((m && m.files) || [])) {
        const n = Number(f && f.size);
        if (!Number.isFinite(n) || n <= 0) continue;
        // 中英朗读共用一个 zip：zh / en 两条清单各指向同一 path，求和会把 146 MB
        // 记成 293 MB。按文件 path（没有就 url）去重；没有标识的仍逐条计。
        const key = (f && (f.path || f.url)) || '';
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        total += n;
      }
    }
  } catch (_) { /* 判断不了就是未知 */ }
  return Math.min(Math.max(Math.floor(total), 0), 9999999999);
}

// BEL-293：ModelSources.run 的 attempts 最后一级就是这次失败的 tier。
// 只有 cache / server / server-alt / builtin / builtin-alt 是真实换源层级；
// 没有 attempts（直调原生 / 清单单地址）⇒ 返回空串，调用方整键省略（不写 none）。
const PACK_TIERS = ['cache', 'server', 'server-alt', 'builtin', 'builtin-alt'];
export function packTierFromAttempts(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i] && list[i].source;
    if (PACK_TIERS.indexOf(s) >= 0) return s;
  }
  return '';
}

// BEL-226/268：pack_download_fail 的 code 只发 id 型（注册表 'id'），不塞系统
// 长文/路径。原生 ensureAssets / ensureDeviceReady 失败只带 `{reason}`（没有
// e.code），所以把失败阶段作为**既有 code 的后缀**发出去：download + asr →
// download_asr（base/tts/vad 同理）。仍以 `download` 开头 ⇒ 老看板按前缀统计
// 不换口径；阶段未知/不认识时退回 `download`。不新增 `stage` 属性：
// events.gen.json 没有这个键，bt-ingest 会整条拒收（HTTP 200）。
// mtSttTimeout / mtTtsFailed / mtBaseFailed 的旧 code 优先，保持看板兼容。
//
// BEL-293：TTS 不再把 why 一刀切掉 —— code 仍是 `tts_failed`（看板前缀/口径不变），
// why 由 packFail 从结构化 `e.reason` 清洗后写进 `detail`。这里不改 code。
export function packFailCode(e, stage) {
  if (!e) return 'download';
  if (e.mtSttTimeout) return 'timeout';
  if (e.mtTtsFailed) return 'tts_failed';
  if (e.mtBaseFailed) return 'base_failed';
  const code = String(e.code || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 32);
  const base = /^[a-z0-9_-]+$/.test(code) ? code : 'download';
  const stages = ['base', 'asr', 'tts', 'vad'];
  // 显式 e.stage 优先（原生/调用方若已标注）；它不认识时再退回本次 runPackUnit 的阶段。
  const explicit = String(e.stage || '').toLowerCase();
  const fallback = String(stage || '').toLowerCase();
  const st = stages.indexOf(explicit) >= 0 ? explicit
    : (stages.indexOf(fallback) >= 0 ? fallback : '');
  // 只在兜底码 `download` 上加后缀：旧 code（timeout/tts_failed/自定义 id）原样保留，
  // 不让这次增强改变既有看板的口径。
  if (!st || base !== 'download') return base;
  return (base + '_' + st).slice(0, 32);
}
