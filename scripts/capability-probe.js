#!/usr/bin/env node
// scripts/capability-probe.js — 「这个平台的这个模型，能不能干这件事」的横扫工具。
//
//   node scripts/capability-probe.js --list                 # 可探的平台与槽位
//   node scripts/capability-probe.js openrouter             # 四种能力全扫
//   node scripts/capability-probe.js qianwen --cap speech   # 只扫一种
//   node scripts/capability-probe.js openrouter --audio a.wav
//
// 与 scripts/perf-probe.js 的分工：那个是**纵向**的（一个模型 × 多种参数拼法，找最优
// 参数）；这个是**横向**的（多个模型 × 四种传输形状，找「谁能干什么」）。两者都写
// build/perf-ledger.config.js。
//
// ── 为什么必须有这个工具 ──────────────────────────────────────────────────
//
// 2026-08-30 我三次从厂商页面读出「做不到」，三次被一次实测推翻：
//   · DashScope 转写「要公网 URL」⇒ 它同样收 base64 data URI
//   · 千问朗读「只有 WebSocket」⇒ 只有主推那个型号是，qwen-tts 走 HTTP 直接通
//   · OpenRouter「没有可用 TTS」⇒ 我只拿一个厂商的模型名去打，deepgram/aura-2 是通的
//
// 根因是结构性的：**两家平台的语音模型都不在各自的公开目录里**。OpenRouter 的
// /models 有 396 个模型，whisper-large-v3 与 deepgram/aura-2 一个都不在；DashScope
// 连 /compatible-mode/v1/models 都是 404。所以「读目录」回答不了这个问题。
//
// ── 三件它必须做的事 ──────────────────────────────────────────────────────
//
// 1. **反向探针**：先打一个不存在的模型名 / 音色名。服务端会**自己列出允许值** ——
//    aura-2 的 90 个音色、qwen-tts 的 4 个、/audio/transcriptions 的隐藏模型集，
//    全是这样拿到的。目录读不到的，错误信息会告诉你。
// 2. **分清「模型不存在」与「参数不对」**：`Model X does not exist` 与
//    `Unknown voice "alloy"` 是两个完全不同的结论。把后者读成前者，就会漏掉一整条
//    可用的路 —— 我漏过一次。
// 3. **记回包形状**：字节 / URL / SSE 分片；以及 **Content-Type 与实际魔数是否一致**
//    （aura-2 声明 audio/pcm，body 却是 RIFF —— 照声明存会让播放拿到一个假类型）。
//
// **只读工具，不动注册表。** 决定谁进短名单是人的判断。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const KEYS_FILE = path.join(ROOT, '.local', 'keys.md');

// 扩展自己的两个模块。用它们而不是手写请求：手写的话探到的就不是我们真正会跑的路。
const WireFormat = require(path.join(ROOT, 'extension/content/wire-format.js'));
function loadRequestShape() {
  const ctx = {
    window: { WireFormat }, WireFormat, console, setTimeout, clearTimeout,
    atob: (b64) => Buffer.from(b64, 'base64').toString('latin1'),
    FormData, Blob,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'extension/content/request-shape.js'), 'utf8'), ctx);
  return ctx.window.RequestShape;
}

function slot(name) {
  if (!fs.existsSync(KEYS_FILE)) return null;
  // `[^\S\n]*` 而不是 `\s*` —— 同 perf-probe.js 那处的疤：`\s` 含换行，空槽位会跨行
  // 把下一行的字段名当值取回来，于是「缺凭证」伪装成「凭证错误」。
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS_FILE, 'utf8'));
  return m ? m[1] : null;
}

const BOGUS_MODEL = 'definitely-not-a-model-xyz';
const BOGUS_VOICE = 'definitely-not-a-voice-xyz';

// 候选池。**种子而非全集** —— 目录里查不到语音模型，所以这里既有实测通过的，也有
// 待验证的猜测；探针的价值正在于把两者分开。
const TARGETS = {
  openrouter: {
    label: 'OpenRouter', keySlot: 'key_chat_custom_chat', host: 'openrouter.ai',
    caps: {
      chat: {
        url: 'https://openrouter.ai/api/v1/chat/completions', type: 'chat-compat',
        models: ['google/gemini-3.7-flash', 'openai/gpt-5-mini', 'deepseek/deepseek-r1',
          'openai/gpt-oss-120b', 'google/gemini-3.1-flash-lite', 'qwen/qwen3.8-27b'],
      },
      transcribe: {
        url: 'https://openrouter.ai/api/v1/audio/transcriptions', type: 'transcribe-compat',
        models: ['openai/whisper-large-v3', 'openai/gpt-4o-mini-transcribe', 'openai/gpt-4o-transcribe',
          'openai/whisper-1', 'deepgram/nova-3', 'elevenlabs/scribe-v1', 'mistralai/voxtral-mini-2507'],
      },
      speech: {
        url: 'https://openrouter.ai/api/v1/audio/speech', type: 'speech-compat',
        models: ['deepgram/aura-2', 'openai/gpt-4o-mini-tts', 'elevenlabs/eleven-turbo-v2-5',
          'cartesia/sonic-2', 'inworld/tts-1'],
        voiceFor: { 'deepgram/aura-2': 'aura-2-thalia-en' },
      },
      speechChat: {
        url: 'https://openrouter.ai/api/v1/chat/completions', type: 'speech-audio-chat',
        models: ['openai/gpt-audio-mini', 'openai/gpt-audio'],
        voiceFor: { '*': 'alloy' },
      },
    },
  },
  qianwen: {
    label: '千问AI平台 (DashScope)', keySlot: 'key_chat_qwen_china', host: 'dashscope.aliyuncs.com',
    caps: {
      chat: {
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', type: 'chat-compat',
        models: ['qwen-plus', 'qwen-turbo', 'qwen-flash', 'qwen3.8-flash', 'qwen3.8-max',
          'qwen-mt-turbo', 'qwen-mt-plus', 'deepseek-v4-flash-0731', 'deepseek-v3.2',
          'kimi-k3', 'glm-4.6'],
      },
      transcribe: {
        url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        type: 'transcribe-dashscope',
        models: ['qwen-audio-3.0-asr-flash', 'qwen-audio-asr', 'qwen3-asr-flash'],
      },
      speech: {
        url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        type: 'speech-dashscope',
        models: ['qwen-tts', 'qwen-tts-latest', 'qwen-audio-3.0-tts-flash'],
        voiceFor: { '*': 'Cherry' },
      },
    },
  },
};

// 一段 0.6 秒的轻音。用轻音而不是静音：静音被一些端点判为无效输入，那种拒绝会被
// 误读成「模型不存在」。同 extension/learn/speech-input.js 的 toneWav()。
// macOS 上用系统语音合成一句真话，转写结果就可核对；没有 say 就回落到轻音。
// 轻音只能证明「可达」，证明不了「转写对不对」—— 第一版用轻音跑出来的是
// " you" / "" / "." / "Oh"，那种输出无法区分「引擎好用」与「引擎在瞎猜」。
function probeAudio() {
  const out = path.join(require('os').tmpdir(), 'mt-probe.wav');
  try {
    const { execFileSync } = require('child_process');
    const aiff = out.replace(/\.wav$/, '.aiff');
    execFileSync('say', ['-o', aiff, PROBE_PHRASE], { stdio: 'ignore' });
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, out], { stdio: 'ignore' });
    return { buf: fs.readFileSync(out), label: `系统语音「${PROBE_PHRASE}」`, phrase: PROBE_PHRASE };
  } catch (_) {
    return { buf: toneWav(), label: '内置 0.6s 轻音（无法核对转写内容）', phrase: null };
  }
}

const PROBE_PHRASE = 'The quick brown fox jumps over the lazy dog.';

function toneWav(ms = 600, rate = 16000) {
  const n = Math.floor((rate * ms) / 1000);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return b;
}

// 魔数 → 真实容器。**声明的 Content-Type 不可信**：deepgram/aura-2 声明
// audio/pcm;rate=24000 而 body 是 RIFF。照声明存，播放时会拼出一个浏览器不认的
// data: URI，而且一路上没有任何地方会报错。
function sniff(buf) {
  const s = buf.slice(0, 4).toString('latin1');
  if (s === 'RIFF') return 'audio/wav';
  if (s === 'OggS') return 'audio/ogg';
  if (s === 'fLaC') return 'audio/flac';
  if (s.slice(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return '';
}

const brief = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').slice(0, 88);

// 服务端在错误里列出的允许值。这是这个工具最值钱的一招。
function enumerated(msg) {
  const m = /(?:Supported (?:values|voices)|Input should be)\s*(?:are)?\s*:?\s*(.+)/i.exec(String(msg || ''));
  if (!m) return null;
  const items = m[1].match(/'([^']+)'|([a-z0-9][a-z0-9._-]{2,})/gi) || [];
  return items.map((x) => x.replace(/'/g, '')).filter((x) => x !== 'and' && x !== 'or');
}

async function probeOne(RS, cap, spec, model, key, audio) {
  // **模型要传给 formatFor。** 单一地址内，模型家族可以自带形状（domain-design §7
  // 第三条）：qwen-mt-* 就是这样 —— 它不收 system 消息，用 chat 形状打过去会被拒
  // 「Role must be in [user, assistant]」。不传 model 的探针会把一个**可用**的模型
  // 报成不可用，而那正是这个工具最不该犯的错。第一版就是这么错的。
  const fmt = WireFormat.formatFor(spec.url, spec.type, model);
  const voice = (spec.voiceFor && (spec.voiceFor[model] || spec.voiceFor['*'])) || undefined;
  const opts = {
    url: spec.url, apiKey: key, model,
    // 目标语言必须写死。第一版只写「你是翻译」，于是同一句 Hello. 被三个模型翻成了
    // 西班牙语、法语和中文各一份 —— 输出没法核对，探针就只剩「有没有回话」。
    system: 'Translate the user text into Simplified Chinese. Output ONLY the translation.',
    user: 'Good morning.', budget: 256,
    input: 'Hello, this is a probe.', voice,
    file: new Blob([audio], { type: 'audio/wav' }), filename: 'probe.wav',
    audioDataUri: 'data:audio/wav;base64,' + audio.toString('base64'), audioFormat: 'wav',
  };
  let req;
  try { req = RS.build(fmt, opts); } catch (e) { return { model, verdict: 'build-error', note: e.message }; }
  if (req.error) return { model, verdict: 'build-error', note: req.error };

  const t0 = Date.now();
  let resp;
  const body = req.isForm ? req.body
    : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  try {
    resp = await fetch(spec.url, { method: 'POST', headers: req.headers, body });
  } catch (e) { return { model, verdict: 'unreachable', note: brief(e.message), ms: Date.now() - t0 }; }
  const ms = Date.now() - t0;
  const ctype = (resp.headers.get('content-type') || '').split(';')[0];
  const raw = Buffer.from(await resp.arrayBuffer());

  // 二进制音频：直接就是产物
  if (!/json|text|event-stream/.test(ctype) && raw.length > 1000) {
    const real = sniff(raw);
    return {
      model, verdict: resp.ok ? 'ok' : 'http-' + resp.status, ms,
      shape: 'bytes', bytes: raw.length, ctype, sniffed: real,
      note: real && real !== ctype ? `⚠ 声明 ${ctype}，实为 ${real}` : '',
    };
  }

  const text = raw.toString('utf8');
  // **先看它是不是一个 JSON 错误。** 放在 SSE 解析之前：错误回包是 JSON 不是 SSE，
  // 交给流解析器只会得到「流里没有音频」—— 把「模型不存在」误报成「形状不对」，
  // 而那正是这个工具要分清的两件事。第一版就是这么错的。
  if (req.parseAudioStream && text.trimStart().startsWith('{')) {
    try {
      const j = JSON.parse(text);
      const em = (j.error && (j.error.message || j.error)) || j.message;
      if (em) return { model, verdict: 'rejected', ms, note: brief(em), enumerated: enumerated(em) };
    } catch (_) { /* 不是 JSON，落回流解析 */ }
  }
  // SSE
  if (req.parseAudioStream) {
    try {
      const got = req.parseAudioStream(text);
      const b = Buffer.from(got.buf);
      return { model, verdict: 'ok', ms, shape: 'sse', bytes: b.length, ctype: got.type,
        sniffed: sniff(b), note: got.transcript ? '念了：' + brief(got.transcript) : '' };
    } catch (e) {
      return { model, verdict: e.code === 'http' ? 'rejected' : 'shape-error', ms, note: brief(e.message) };
    }
  }

  let d = null;
  try { d = JSON.parse(text); } catch (_) { return { model, verdict: 'non-json', ms, note: brief(text) }; }
  const errMsg = (d.error && (d.error.message || d.error)) || d.message || null;
  if (!resp.ok || errMsg) {
    const list = enumerated(errMsg);
    return { model, verdict: 'rejected', ms, note: brief(errMsg), enumerated: list };
  }
  if (req.audioUrlFrom) {
    const u = req.audioUrlFrom(d);
    if (!u) return { model, verdict: 'shape-error', ms, note: '回包里没有音频地址' };
    const m2 = await fetch(u);
    const b = Buffer.from(await m2.arrayBuffer());
    return { model, verdict: 'ok', ms, shape: 'url', bytes: b.length,
      ctype: (m2.headers.get('content-type') || '').split(';')[0], sniffed: sniff(b),
      note: /^http:/i.test(d.output && d.output.audio && d.output.audio.url || '') ? '⚠ 回的是 http://（已升 https）' : '' };
  }
  if (cap === 'transcribe') {
    const t = req.extract ? req.extract(d) : (d.text || d.transcript || '');
    return { model, verdict: 'ok', ms, shape: 'json', note: '转写：' + JSON.stringify(String(t).slice(0, 70)),
      cost: (d.usage && d.usage.cost) };
  }
  const out = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  const u = d.usage || {};
  return { model, verdict: 'ok', ms, shape: 'json', note: brief(out), outChars: out.length,
    tokens: u.total_tokens, cost: u.cost };
}

async function run(name, only, audioPath) {
  const t = TARGETS[name];
  if (!t) { console.error(`✗ 不认识的平台 ${name}。可选：${Object.keys(TARGETS).join(', ')}`); process.exit(1); }
  const key = slot(t.keySlot);
  if (!key) { console.error(`✗ .local/keys.md 里 ${t.keySlot} 是空的`); process.exit(1); }
  const picked = audioPath
    ? { buf: fs.readFileSync(audioPath), label: audioPath, phrase: null }
    : probeAudio();
  const audio = picked.buf;
  const RS = loadRequestShape();
  console.log(`\n■ ${t.label}   host ${t.host}   音频 ${picked.label} ${audio.length} 字节\n`);

  const draft = [];
  for (const [cap, spec] of Object.entries(t.caps)) {
    if (only && only !== cap) continue;
    const fmt = WireFormat.formatFor(spec.url, spec.type, spec.models[0]);
    console.log(`── ${cap}  ${spec.url}`);
    console.log(`   形状 ${fmt}${fmt !== spec.type ? `（后缀判定，注册表 type 是 ${spec.type}）` : ''}`);

    // 反向探针：让服务端自己说它认哪些
    const neg = await probeOne(RS, cap, spec, BOGUS_MODEL, key, audio);
    if (neg.enumerated) console.log(`   服务端列出的允许值（${neg.enumerated.length}）：${neg.enumerated.slice(0, 12).join(', ')}${neg.enumerated.length > 12 ? ' …' : ''}`);
    else console.log(`   不存在的模型 → ${neg.verdict}：${neg.note || ''}`);

    for (const m of spec.models) {
      const r = await probeOne(RS, cap, spec, m, key, audio);
      const mark = r.verdict === 'ok' ? '✓' : '✗';
      const bits = [
        r.ms != null ? r.ms + 'ms' : '',
        r.shape || '',
        r.bytes ? r.bytes + 'B' : '',
        r.cost != null ? '$' + r.cost : '',
        r.tokens != null ? r.tokens + 'tok' : '',
      ].filter(Boolean).join(' ');
      console.log(`   ${mark} ${m.padEnd(34)} ${r.verdict.padEnd(12)} ${bits}  ${r.note || ''}`);
      if (r.enumerated) console.log(`       允许值：${r.enumerated.slice(0, 10).join(', ')}`);
      draft.push({ cap, model: m, ...r });
    }
    console.log('');
  }

  // 台账草稿：只给打通的与明确被拒的。unreachable 也要留痕 —— 「测过打不到」与
  // 「没测过」是两回事，后者才是台账要防的。
  console.log('── 可粘进 build/perf-ledger.config.js 的草稿 ──');
  const today = new Date().toISOString().slice(0, 10);
  for (const r of draft) {
    if (r.verdict === 'rejected' && /does not exist/i.test(r.note || '')) continue;  // 模型压根没有，不入账
    const verdict = r.verdict === 'ok' ? 'rejected' : 'unreachable';   // 能力探针不测参数 ⇒ 不产生 adopted
    console.log(`  { host: '${TARGETS[name].host}', model: '${r.model}', date: '${today}',`);
    if (r.verdict === 'ok') {
      console.log(`    baseline: { ms: ${r.ms}, thinkTokens: null, outChars: ${r.outChars != null ? r.outChars : (r.bytes || 0)}, finish: 'stop' },`);
      console.log(`    verdict: 'rejected',`);
      console.log(`    why: '能力探针（${r.cap}）：打通了。${r.note || ''} —— 参数层面没测，要 adopted 走 /perf-tune。' },`);
    } else {
      console.log(`    verdict: 'unreachable', why: '能力探针（${r.cap}）：${r.verdict} ${r.note || ''}' },`);
    }
  }
  console.log('');
}

const argv = process.argv.slice(2);
if (!argv.length || argv.includes('--help')) {
  console.log('用法: node scripts/capability-probe.js <平台> [--cap chat|transcribe|speech|speechChat] [--audio file.wav]');
  console.log('      node scripts/capability-probe.js --list');
  process.exit(argv.length ? 0 : 1);
}
if (argv[0] === '--list') {
  for (const [k, t] of Object.entries(TARGETS)) {
    const v = slot(t.keySlot);
    console.log(`  ${k.padEnd(12)} ${t.label.padEnd(26)} 槽位 ${t.keySlot.padEnd(24)} ${v ? '✓ 已填' : '✗ 空'}`);
    console.log(`  ${' '.repeat(12)} 能力：${Object.keys(t.caps).join(', ')}`);
  }
  process.exit(0);
}
const capIdx = argv.indexOf('--cap');
const audioIdx = argv.indexOf('--audio');
run(argv[0], capIdx > -1 ? argv[capIdx + 1] : null, audioIdx > -1 ? argv[audioIdx + 1] : null)
  .catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
