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
const { describe, test, ok, eq, deepEq } = require('./harness');

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
function postFull(url, headers, body) {
  const payload = body == null ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: Object.assign({}, headers, payload ? { 'Content-Length': payload.length } : {}),
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e), headers: {} }));
    req.end(payload || undefined);
  });
}
function getFull(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET' }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e), headers: {} }));
    req.end();
  });
}
function postBytes(url, headers, body) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: Object.assign({ 'Content-Length': payload.length }, headers),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        type: String(res.headers['content-type'] || ''),
      }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e), type: '' }));
    req.end(payload);
  });
}
function formFile(fields, file) {
  const boundary = '----mt592boundary';
  const chunks = [
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="'
      + file.name + '"\r\nContent-Type: ' + file.type + '\r\n\r\n'),
    file.buf,
    Buffer.from('\r\n'),
  ];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
  }
  chunks.push(Buffer.from('--' + boundary + '--\r\n'));
  return { body: Buffer.concat(chunks), type: 'multipart/form-data; boundary=' + boundary };
}

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
      seen.upstream.push({ url: req.url, auth: req.headers.authorization, body: raw, sse: req.headers['x-dashscope-sse'] || '' });
      if (String(req.url).endsWith('/audio/speech')) {
        return { statusCode: 200, body: 'RIFFkeep', type: 'audio/mpeg' };
      }
      if (raw.includes('__FORCE_401__')) return { statusCode: 401, body: '{"error":"or_unauthorized"}', type: 'application/json' };
      return j({ choices: [{ message: { content: '好' } }], usage: { total_tokens: 10, cost: 0.0005 } });
    });
    const db = await server((req, raw) => {
      if (/bt_grant_check/.test(req.url)) return j(row);
      if (/bt_grant_charge|rpc/.test(req.url)) return j({});
      return j({});
    });
    const port = 8899 + (process.pid % 100);
    const openEnv = Object.assign({}, process.env, {
      PORT: String(port),
      SUPABASE_URL: `http://127.0.0.1:${db.port}`,
      SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role',
      OPENROUTER_BASE: `http://127.0.0.1:${up.port}`,
      OPENROUTER_GRANT_KEY: 'sk-or-stub',
      GRANT_MODELS: JSON.stringify({ chat: PINNED, tts: 'deepgram/aura-2' }),
      GRANT_PRICES: JSON.stringify({ chatPerKTok: 0.001, chatFloor: 0.0005, ttsPerKChar: 0.015 }),
      GRANT_FLOAT_MIN_USD: '5',
    });
    delete openEnv.UPSTREAM;
    const relay = spawn('deno', ['run', '-A', RELAY], {
      cwd: ROOT,
      env: openEnv,
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

      const bareAt = seen.upstream.length;
      r = await post(base, H('bmg_ok'), { model: PINNED, messages: [{ role: 'user', content: 'plain' }] });
      eq(r.status, 200, '不带 temperature 的请求该 200（实际 ' + r.status + '）');
      const bare = JSON.parse(seen.upstream[bareAt].body);
      ok(!('temperature' in bare), '客户端没带 temperature，默认路径却写进了上游请求：' + JSON.stringify(bare));
      ok(!('enable_thinking' in bare), '默认路径不该写 enable_thinking');

      r = await post(base, H('bmg_ok'), { model: PINNED, messages: [{ role: 'user', content: '__FORCE_401__' }] });
      eq(r.status, 401, '开关关闭时上游 401 原样透传（实际 ' + r.status + ' ' + String(r.body).slice(0, 80) + '）');
      ok(String(r.body).indexOf('or_unauthorized') >= 0, '401 正文被改写了：' + r.body);

      r = await postBytes('http://127.0.0.1:' + port + '/audio/speech', H('bmg_ok'), {
        model: 'deepgram/aura-2', input: 'hello', voice: 'aura-2-thalia-en', response_format: 'mp3',
      });
      eq(r.status, 200, 'UPSTREAM 未设置时朗读仍走原路径：' + r.status + ' ' + String(r.body).slice(0, 80));
      eq(r.body, 'RIFFkeep', '原路径该原样交回上游字节');
      eq(r.type.split(';')[0], 'audio/mpeg');
      const ttsUp = seen.upstream.filter((x) => String(x.url).endsWith('/audio/speech')).pop();
      const ttsSent = JSON.parse(ttsUp.body);
      eq(ttsSent.model, 'deepgram/aura-2');
      eq(ttsSent.input, 'hello', '原路径的 input 仍是字符串');
      eq(ttsSent.voice, 'aura-2-thalia-en');
      eq(ttsSent.response_format, 'mp3');
      eq(ttsUp.sse, '', '原路径不该加 X-DashScope-SSE');

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
    ok(src.indexOf('https://docs.qwencloud.com/changelog/model-deprecations/old-models') >= 0,
      'qwen3.7-plus 标价的来源页不在中继里');
    ok(src.indexOf('0.40') >= 0 && src.indexOf('1.60') >= 0, '标价常量不在中继里');
  });

  test('注册表：免费额度三档钉住 QwenCloud 的模型与 Cherry', () => {
    const chat = require('../build/providers.config.js').find((x) => x.id === 'grant');
    const speech = require('../build/tts.config.js').find((x) => x.id === 'grant_speech');
    const stt = require('../build/stt.config.js').find((x) => x.id === 'grant_stt');
    const chatModel = chat.defaultModel && chat.defaultModel.global ? chat.defaultModel.global : chat.defaultModel;
    eq(chatModel, 'qwen3.7-plus');
    eq(speech.defaultModel, 'qwen3-tts-flash');
    eq(speech.voices.join(','), 'Cherry');
    eq(stt.defaultModel, 'qwen3-asr-flash');
  });

  test('UPSTREAM=qwencloud：不看 IP、白名单、音色、10MB、记账（本地桩，不打线上）', async () => {
    if (!hasDeno) { ok(true, '跳过：这台机器没有 deno（可选工具链）'); return; }
    const row = [{ user_id: 'u1', limit_usd: 100, spent_usd: 0, status: 'active' }];
    const seen = { qc: [], bj: [], charges: [], logs: [], trap: 0 };
    const sse = (events) => ({
      statusCode: 200,
      body: events.map((o) => 'data: ' + JSON.stringify(o) + '\n\n').join(''),
      type: 'text/event-stream',
    });
    const qc = await server((req, raw) => {
      const text = String(raw);
      seen.qc.push({ url: req.url, auth: req.headers.authorization, sse: req.headers['x-dashscope-sse'] || '', body: text });
      if (text.includes('__FORCE_401__')) return { statusCode: 401, body: '{"error":"SECRET401"}', type: 'application/json' };
      if (text.includes('__FORCE_402__')) return { statusCode: 402, body: '{"error":"SECRET402"}', type: 'application/json' };
      if (text.includes('__FORCE_403__')) return { statusCode: 403, body: '{"error":"SECRET403"}', type: 'application/json' };
      if (text.includes('__FORCE_429__')) return { statusCode: 429, body: '{"error":"SECRET429"}', type: 'application/json' };
      if (text.includes('__TTS_SSE_OK__')) {
        return sse([
          { output: { audio: { data: Buffer.from([1, 2, 3]).toString('base64') } } },
          { output: { audio: { data: Buffer.from([4]).toString('base64') } } },
          { output: { audio: { data: '', url: 'http://127.0.0.1:' + trap.port + '/SECRETURL-file.wav' } }, usage: { characters: 21 } },
        ]);
      }
      if (text.includes('__TTS_SSE_NOCHARS__')) {
        return sse([
          { output: { audio: { data: Buffer.from([7]).toString('base64') } } },
          { output: { audio: { data: '' } } },
        ]);
      }
      if (text.includes('__TTS_SSE_ERR__')) {
        return sse([
          { output: { audio: { data: Buffer.from([9]).toString('base64') } } },
          { code: 'CODETEXT_SECRET', output: { audio: { data: Buffer.from([8]).toString('base64'), url: 'http://127.0.0.1:' + trap.port + '/SECRETURL-file.wav' } } },
        ]);
      }
      if (text.includes('__TTS_SSE_EMPTY__')) {
        return sse([
          { output: { audio: { data: '' } } },
          { output: { audio: { data: '', url: 'http://127.0.0.1:' + trap.port + '/SECRETURL-empty.wav' } }, usage: { characters: 4 } },
        ]);
      }
      if (text.includes('input_audio')) {
        if (text.includes(Buffer.from('__ASR_NOSECS__').toString('base64'))) {
          return j({ choices: [{ message: { content: 'hi' } }], usage: {} });
        }
        return j({ choices: [{ message: { content: 'heard' } }], usage: { seconds: 2 } });
      }
      if (text.includes('__NO_USAGE__')) return j({ choices: [{ message: { content: 'x' } }] });
      return j({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1000000, completion_tokens: 1000000 } });
    });
    const bj = await server((req, raw) => {
      seen.bj.push({ url: req.url, body: String(raw) });
      return j({ choices: [{ message: { content: '北京' } }], usage: { total_tokens: 10 } });
    });
    const trap = await server(() => { seen.trap += 1; return j({}); });

    const db = await server((req, raw) => {
      if (/bt_grant_check/.test(req.url)) return j(row);
      if (/bt_grant_charge/.test(req.url)) { seen.charges.push(JSON.parse(String(raw))); return j(1); }
      return j({});
    });
    const port = 18900 + (process.pid % 500);
    const denoArgs = ['run', '-A', RELAY];
    const qcEnv = Object.assign({}, process.env, {
      PORT: String(port),
      SUPABASE_URL: 'http://127.0.0.1:' + db.port,
      SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role',
      UPSTREAM: 'qwencloud',
      QWENCLOUD_KEY: 'sk-qc-stub',
      QWENCLOUD_CHAT_BASE: 'http://127.0.0.1:' + qc.port + '/v1',
      QWENCLOUD_TTS_URL: 'http://127.0.0.1:' + qc.port + '/generation',
      UPSTREAM_KEY: 'sk-bj-stub',
      UPSTREAM_BASE: 'http://127.0.0.1:' + bj.port + '/v1',
      GRANT_MODELS: JSON.stringify({ tts: 'qwen-tts-beijing' }),
      GRANT_PRICES: JSON.stringify({ chatFloor: 0.0005, chatPerKTok: 0.001, ttsPerKChar: 0.015, sttPerMB: 0.02 }),
      GRANT_FLOAT_MIN_USD: '5',
    });
    // 这条测的是「变量未设置 = 全量」。父进程如果导出了名单，不能漏进来。
    delete qcEnv.QWENCLOUD_ALLOW_TOKEN_HASHES;
    const relay = spawn('deno', denoArgs, {
      cwd: ROOT,
      env: qcEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    relay.stdout.on('data', (d) => seen.logs.push(String(d)));
    relay.stderr.on('data', (d) => seen.logs.push(String(d)));
    const root = 'http://127.0.0.1:' + port;
    const H = (extra) => Object.assign({
      Authorization: 'Bearer bmg_ok', 'Content-Type': 'application/json',
    }, extra || {});
    const near = (got, want, msg) => ok(Math.abs(Number(got) - want) < 1e-9, msg + ' got=' + got + ' want=' + want);
    try {
      let up = false;
      for (let i = 0; i < 60; i++) {
        const r = await post(root + '/chat/completions', H(), { model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'ping' }] });
        if (r.status) { up = r.status === 200; break; }
        await new Promise((r2) => setTimeout(r2, 200));
      }
      ok(up, '中继没起来：' + seen.logs.join('').slice(0, 400));
      seen.qc.length = 0;
      seen.charges.length = 0;

      let r = await postBytes(root + '/chat/completions', H(), { model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'hi' }], top_p: 0.9, max_tokens: 20, '无关字段': 1 });
      eq(r.status, 200, '国际聊天该 200：' + r.body);
      let sent = JSON.parse(seen.qc[0].body);
      eq(sent.model, 'qwen3.7-plus');
      eq(sent.enable_thinking, false);
      ok(!('temperature' in sent), '没带 temperature 却出现了：' + JSON.stringify(sent));
      ok(!('usage' in sent), '不该向 QwenCloud 写 usage.include');
      ok(sent['无关字段'] === undefined, '白名单外的字段没丢掉');
      eq(sent.top_p, 0.9);
      eq(sent.max_tokens, 20);
      eq(seen.bj.length, 0, '非中国请求不该打到北京');
      near(seen.charges[0].p_cost, 2, '100 万 + 100 万 token 应按 0.40+1.60');
      eq(seen.charges[0].p_model, 'qwen3.7-plus');

      const n0 = seen.qc.length;
      r = await postBytes(root + '/chat/completions', H(), {
        model: 'qwen3.7-plus',
        messages: [{ role: 'user', content: 'json' }],
        response_format: { type: 'json_object' },
        max_tokens: 30,
      });
      eq(r.status, 200, 'json_object 该 200');
      sent = JSON.parse(seen.qc[n0].body);
      deepEq(sent.response_format, { type: 'json_object' });
      ok(!('max_tokens' in sent), '带 json_object 时 max_tokens 该丢掉：' + JSON.stringify(sent));

      r = await postBytes(root + '/chat/completions', H(), {
        model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'x' }],
        response_format: { type: 'text' }, max_tokens: 11,
      });
      sent = JSON.parse(seen.qc[seen.qc.length - 1].body);
      ok(!('response_format' in sent), '不是恰好 json_object 的 response_format 该丢掉');
      eq(sent.max_tokens, 11, '没带 json_object 时 max_tokens 留着');

      r = await postBytes(root + '/chat/completions', H({ 'X-Real-IP': '8.8.8.8' }), { model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: 'old' }] });
      eq(r.status, 200, '旧模型名该被换成钉死的模型');
      eq(JSON.parse(seen.qc[seen.qc.length - 1].body).model, 'qwen3.7-plus');

      r = await postBytes(root + '/chat/completions', H(), { model: 'other-model', messages: [{ role: 'user', content: 'x' }] });
      eq(r.status, 403, '别的模型名该 403');

      const ipCases = [
        ['大陆', { 'X-Real-IP': '1.0.8.1' }],
        ['非大陆', { 'X-Real-IP': '8.8.8.8' }],
        ['空', { 'X-Real-IP': '' }],
      ];
      const sameBodies = { chat: [], tts: [], stt: [] };
      const ttsStatus = [];
      for (const [label, extra] of ipCases) {
        const bjBefore = seen.bj.length;
        r = await postBytes(root + '/chat/completions', H(extra), {
          model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'same-chat' }], enable_thinking: true,
        });
        eq(r.status, 200, label + ' 聊天该 200：' + r.body);
        eq(seen.bj.length, bjBefore, label + ' 聊天不该打到北京桩');
        let hit = seen.qc[seen.qc.length - 1];
        eq(hit.url, '/v1/chat/completions', label + ' 聊天 URL ' + hit.url);
        eq(hit.auth, 'Bearer sk-qc-stub', label + ' 聊天密钥');
        sent = JSON.parse(hit.body);
        eq(sent.model, 'qwen3.7-plus', label + ' 聊天模型');
        eq(sent.enable_thinking, false, label + ' 聊天仍由服务端写 enable_thinking');
        ok(!('temperature' in sent), label + ' 聊天不该自己加 temperature');
        sameBodies.chat.push(hit.body);

        r = await postBytes(root + '/audio/speech', H(extra), {
          model: 'qwen3-tts-flash', input: 'same-tts', voice: 'Cherry',
        });
        ttsStatus.push(r.status);
        ok(String(r.body).indexOf('grant_misconfigured') < 0, label + ' 朗读不该 503：' + r.body);
        hit = seen.qc.filter((x) => x.url.indexOf('/generation') >= 0).pop();
        eq(hit.auth, 'Bearer sk-qc-stub', label + ' 朗读密钥');
        sent = JSON.parse(hit.body);
        eq(sent.model, 'qwen3-tts-flash', label + ' 朗读模型');
        eq(sent.input.text, 'same-tts', label);
        eq(sent.input.voice, 'Cherry', label);
        eq(sent.input.language_type, 'Auto', label);
        sameBodies.tts.push(hit.body);
        eq(seen.bj.length, bjBefore, label + ' 朗读不该打到北京桩');

        const fd = formFile({ model: 'qwen3-asr-flash' }, { name: 'a.webm', type: 'audio/webm', buf: Buffer.from('same-stt') });
        r = await postBytes(root + '/audio/transcriptions', Object.assign({
          Authorization: 'Bearer bmg_ok', 'Content-Type': fd.type,
        }, extra), fd.body);
        eq(r.status, 200, label + ' 转写该 200：' + r.body);
        deepEq(JSON.parse(r.body), { text: 'heard' });
        hit = seen.qc[seen.qc.length - 1];
        eq(hit.url, '/v1/chat/completions', label + ' 转写 URL ' + hit.url);
        eq(hit.auth, 'Bearer sk-qc-stub', label + ' 转写密钥');
        sent = JSON.parse(hit.body);
        eq(sent.model, 'qwen3-asr-flash', label + ' 转写模型');
        eq(sent.stream, false, label);
        sameBodies.stt.push(hit.body);
        eq(seen.bj.length, bjBefore, label + ' 转写不该打到北京桩');
      }
      eq(sameBodies.chat[0], sameBodies.chat[1], '大陆与非大陆的聊天请求体不同');
      eq(sameBodies.chat[0], sameBodies.chat[2], '大陆与空地址的聊天请求体不同');
      eq(sameBodies.tts[0], sameBodies.tts[1], '大陆与非大陆的朗读请求体不同');
      eq(sameBodies.tts[0], sameBodies.tts[2], '大陆与空地址的朗读请求体不同');
      eq(sameBodies.stt[0], sameBodies.stt[1], '大陆与非大陆的转写请求体不同');
      eq(sameBodies.stt[0], sameBodies.stt[2], '大陆与空地址的转写请求体不同');
      eq(ttsStatus[0], ttsStatus[1], '朗读状态码因地址而不同');
      eq(ttsStatus[0], ttsStatus[2], '空地址的朗读状态码不同');
      ok(ttsStatus[0] !== 503, '朗读不该因没配大陆模型而 503，实际 ' + ttsStatus[0]);

      r = await postBytes(root + '/chat/completions', H({ 'X-Forwarded-For': '1.0.8.1' }), { model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'xff' }] });
      eq(JSON.parse(seen.qc[seen.qc.length - 1].body).model, 'qwen3.7-plus', '不读 X-Forwarded-For，请求仍走国际');

      const sttFd = formFile({ model: 'qwen3-asr-flash' }, { name: 'a.webm', type: 'audio/webm;codecs=opus', buf: Buffer.from('not-a-real-webm') });
      const sttAt = seen.qc.length;
      r = await postBytes(root + '/audio/transcriptions', { Authorization: 'Bearer bmg_ok', 'Content-Type': sttFd.type }, sttFd.body);
      eq(r.status, 200, '转写该 200：' + r.body);
      deepEq(JSON.parse(r.body), { text: 'heard' });
      sent = JSON.parse(seen.qc[sttAt].body);
      eq(sent.model, 'qwen3-asr-flash');
      eq(sent.stream, false);
      ok(!('asr_options' in sent), '没指定语种时不传 asr_options');
      const data = sent.messages[0].content[0].input_audio.data;
      ok(data.startsWith('data:audio/webm;base64,'), 'MIME 该去掉 codecs：' + data.slice(0, 40));
      ok(data.indexOf('codecs') < 0, 'data URL 里不该留 codecs');
      near(seen.charges[seen.charges.length - 1].p_cost, 2 * 0.000035, '2 秒 × $0.000035');
      eq(seen.charges[seen.charges.length - 1].p_model, 'qwen3-asr-flash');

      const langFd = formFile({ language: 'en' }, { name: 'a.webm', type: 'audio/webm', buf: Buffer.from('x') });
      r = await postBytes(root + '/audio/transcriptions', { Authorization: 'Bearer bmg_ok', 'Content-Type': langFd.type }, langFd.body);
      eq(JSON.parse(seen.qc[seen.qc.length - 1].body).asr_options.language, 'en');

      const beforeTs = seen.qc.length;
      const tsFd = formFile({ response_format: 'verbose_json' }, { name: 'a.webm', type: 'audio/webm', buf: Buffer.from('x') });
      r = await postBytes(root + '/audio/transcriptions', { Authorization: 'Bearer bmg_ok', 'Content-Type': tsFd.type }, tsFd.body);
      eq(r.status, 400, '时间戳档该 400');
      ok(String(r.body).indexOf('timestamps_unsupported') >= 0, r.body);
      eq(seen.qc.length, beforeTs, '时间戳档不该转发');

      const nOver = Math.floor((9 * 1024 * 1024) / 4) * 3 + 1;
      const big = formFile({}, { name: 'big.webm', type: 'audio/webm', buf: Buffer.alloc(nOver, 1) });
      const beforeBig = seen.qc.length;
      r = await postBytes(root + '/audio/transcriptions', { Authorization: 'Bearer bmg_ok', 'Content-Type': big.type }, big.body);
      eq(r.status, 413, '超过 9 MiB base64 该 413，实际 ' + r.status + ' ' + String(r.body).slice(0, 120));
      ok(String(r.body).indexOf('audio_too_large') >= 0, r.body);
      eq(seen.qc.length, beforeBig, '超限不该转发');

      const noSec = formFile({}, { name: 'a.webm', type: 'audio/webm', buf: Buffer.from('__ASR_NOSECS__') });
      const chargesBefore = seen.charges.length;
      r = await postBytes(root + '/audio/transcriptions', { Authorization: 'Bearer bmg_ok', 'Content-Type': noSec.type }, noSec.body);
      eq(r.status, 200, '缺秒数仍回文本');
      eq(seen.charges.length, chargesBefore, '缺秒数不该记账');
      ok(seen.logs.join('').indexOf('usage_missing') >= 0, '缺秒数该写 usage_missing');

      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: 'Serena please', voice: 'Serena' });
      const serena = seen.qc.filter((x) => x.url.indexOf('/generation') >= 0).pop();
      sent = JSON.parse(serena.body);
      eq(serena.sse, 'enable', '朗读请求头要带 X-DashScope-SSE: enable');
      eq(sent.model, 'qwen3-tts-flash');
      eq(sent.input.voice, 'Serena', '名单里的音色原样用');
      eq(sent.input.text, 'Serena please');
      eq(sent.input.language_type, 'Auto');
      ok(!('stream' in sent) && !('stream' in sent.input), '不该加 input.stream 或其他请求字段');

      r = await postBytes(root + '/audio/speech', H(), { model: 'deepgram/aura-2', input: 'legacy', voice: 'aura-2-thalia-en' });
      sent = JSON.parse(seen.qc.filter((x) => x.url.indexOf('/generation') >= 0).pop().body);
      eq(sent.model, 'qwen3-tts-flash');
      eq(sent.input.voice, 'Cherry', '旧音色映射到 Cherry');

      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: 'unknown voice', voice: 'not-a-voice' });
      sent = JSON.parse(seen.qc.filter((x) => x.url.indexOf('/generation') >= 0).pop().body);
      eq(sent.input.voice, 'Cherry');

      const chargesBeforeSse = seen.charges.length;
      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: '__TTS_SSE_OK__', voice: 'Cherry' });
      eq(r.status, 200, '多包 Base64 该拼成音频：' + r.status + ' ' + String(r.body).slice(0, 80));
      eq(r.type.split(';')[0], 'application/octet-stream', '文档没写容器，不该声明 wav 或 mpeg');
      eq(Buffer.from(r.body, 'utf8').toString('hex'), '01020304', '按包顺序拼接，最后一包空 data 不计入');
      ok(r.body.indexOf('RIFF') < 0, '不该加 WAV 头');
      ok(r.body.indexOf('SECRETURL') < 0 && r.body.indexOf('{') < 0, '不该把 URL 或 JSON 交回客户端');
      eq(seen.trap, 0, '不该去请求 output.audio.url');
      near(seen.charges[seen.charges.length - 1].p_cost, 21 * 0.1 / 10000, '21 字 × $0.1/万');
      eq(seen.charges.length, chargesBeforeSse + 1);

      const input = '__TTS_SSE_NOCHARS__';
      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input, voice: 'Cherry' });
      eq(r.status, 200, '缺 characters 仍该返回拼好的字节');
      eq(Buffer.from(r.body, 'utf8')[0], 7);
      near(seen.charges[seen.charges.length - 1].p_cost, input.length * 0.1 / 10000, '缺 characters 用输入长度');

      const chargesBeforeErr = seen.charges.length;
      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: '__TTS_SSE_ERR__', voice: 'Cherry' });
      eq(r.status, 502, '中途报错该 502');
      eq(String(r.body), '{"error":"upstream"}');
      ok(String(r.body).indexOf('CODETEXT_SECRET') < 0, '502 正文带了 code');
      ok(seen.logs.join('').indexOf('CODETEXT_SECRET') < 0, 'code 正文进了日志');
      ok(seen.logs.join('').indexOf('tts sse sse_code') >= 0, '中途报错该记 sse_code');

      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: '__TTS_SSE_EMPTY__', voice: 'Cherry' });
      eq(r.status, 502, '没有任何音频数据该 502');
      eq(String(r.body), '{"error":"upstream"}');
      ok(seen.logs.join('').indexOf('tts sse sse_empty') >= 0, '空音频该记 sse_empty');
      eq(seen.charges.length, chargesBeforeErr, '失败不该记账');
      eq(seen.trap, 0, '空 data 带了 URL 也不该去拉');
      ok(seen.logs.join('').indexOf('SECRETURL') < 0, '日志里出现了签名 URL');

      r = await postBytes(root + '/chat/completions', H(), { model: 'qwen3.7-plus', messages: [{ role: 'user', content: '__NO_USAGE__' }] });
      near(seen.charges[seen.charges.length - 1].p_cost, 0.0005, '两个 token 字段都缺失时走 chatFloor');

      for (const marker of ['__FORCE_401__', '__FORCE_402__', '__FORCE_403__']) {
        r = await postBytes(root + '/chat/completions', H(), { model: 'qwen3.7-plus', messages: [{ role: 'user', content: marker }] });
        eq(r.status, 503, marker + ' 该改写 503，实际 ' + r.status);
        ok(String(r.body).indexOf('grant_unavailable') >= 0, r.body);
        ok(String(r.body).indexOf('SECRET') < 0, '不该把上游正文透回去：' + r.body);
      }
      r = await postBytes(root + '/chat/completions', H(), { model: 'qwen3.7-plus', messages: [{ role: 'user', content: '__FORCE_429__' }] });
      eq(r.status, 429, '上游 429 该回 429');
      ok(String(r.body).indexOf('upstream_rate_limited') >= 0, r.body);
      ok(String(r.body).indexOf('SECRET429') < 0, '429 不该透传上游正文');
      ok(String(r.body).indexOf('"busy"') < 0, '上游限流不该说成自己的 busy');
    } finally {
      try { relay.kill('SIGKILL'); } catch (_) {}
      try { qc.srv.close(); bj.srv.close(); trap.srv.close(); db.srv.close(); } catch (_) {}
    }
  });

  test('QWENCLOUD_ALLOW_TOKEN_HASHES：名单内走 QwenCloud，名单外与空串走旧路径', async () => {
    if (!hasDeno) { ok(true, '跳过：这台机器没有 deno（可选工具链）'); return; }
    const crypto = require('crypto');
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
    const TOKEN_IN = 'bmg_in_allow';
    const TOKEN_OUT = 'bmg_out_allow';
    const TOKEN_CASE = 'bmg_In_allow';
    const hashIn = sha(TOKEN_IN);
    const seen = { qc: [], or: [], bj: [], charges: [], credits: 0 };
    const qc = await server((req, raw) => {
      seen.qc.push({ url: req.url, auth: req.headers.authorization, body: String(raw) });
      return j({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1000000, completion_tokens: 1000000 } });
    });
    const bj = await server((req, raw) => {
      seen.bj.push({ url: req.url, auth: req.headers.authorization, body: String(raw) });
      return j({ choices: [{ message: { content: '北京' } }], usage: { total_tokens: 10 } });
    });
    const or = await server((req, raw) => {
      if (String(req.url).endsWith('/credits')) {
        seen.credits += 1;
        return j({ data: { total_credits: 10, total_usage: 0 } });
      }
      const text = String(raw);
      seen.or.push({ url: req.url, auth: req.headers.authorization, body: text });
      if (text.includes('__FORCE_401__')) return { statusCode: 401, body: '{"error":"or_unauthorized"}', type: 'application/json' };
      return j({ choices: [{ message: { content: '旧' } }], usage: { cost: 0.02, total_tokens: 10 } });
    });
    const row = [{ user_id: 'u1', limit_usd: 100, spent_usd: 0, status: 'active' }];
    const db = await server((req, raw) => {
      if (/bt_grant_check/.test(req.url)) return j(row);
      if (/bt_grant_charge/.test(req.url)) { seen.charges.push(JSON.parse(String(raw))); return j(1); }
      return j({});
    });
    const procs = [];
    const near = (got, want, msg) => ok(Math.abs(Number(got) - want) < 1e-9, msg + ' got=' + got + ' want=' + want);
    const reset = () => { seen.qc.length = 0; seen.or.length = 0; seen.bj.length = 0; seen.charges.length = 0; seen.credits = 0; };
    function noLeak(r, label) {
      const blob = String(r.body) + '\n' + Object.keys(r.headers || {}).join('\n') + '\n' + Object.values(r.headers || {}).join('\n');
      ok(blob.indexOf(TOKEN_IN) < 0 && blob.indexOf(TOKEN_OUT) < 0 && blob.indexOf(TOKEN_CASE) < 0, label + ' 响应里有令牌明文');
      ok(blob.toLowerCase().indexOf(hashIn) < 0, label + ' 响应里有名单上的哈希');
    }
    function logsClean(logs, label) {
      const text = logs.join('');
      ok(text.indexOf(TOKEN_IN) < 0 && text.indexOf(TOKEN_OUT) < 0 && text.indexOf(TOKEN_CASE) < 0, label + ' 日志里有令牌明文');
      ok(text.toLowerCase().indexOf(hashIn) < 0, label + ' 日志里有完整哈希');
    }
    function boot(port, allow) {
      const logs = [];
      const env = Object.assign({}, process.env, {
        PORT: String(port),
        SUPABASE_URL: 'http://127.0.0.1:' + db.port,
        SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role',
        UPSTREAM: 'qwencloud',
        QWENCLOUD_KEY: 'sk-qc-stub',
        QWENCLOUD_CHAT_BASE: 'http://127.0.0.1:' + qc.port + '/v1',
        UPSTREAM_KEY: 'sk-bj-stub',
        UPSTREAM_BASE: 'http://127.0.0.1:' + bj.port + '/v1',
        OPENROUTER_GRANT_KEY: 'sk-or-stub',
        OPENROUTER_BASE: 'http://127.0.0.1:' + or.port + '/v1',
        GRANT_MODELS: JSON.stringify({ chat: PINNED }),
        GRANT_PRICES: JSON.stringify({ chatPerKTok: 0.001, chatFloor: 0.0005 }),
        GRANT_FLOAT_MIN_USD: '5',
      });
      if (allow === undefined) delete env.QWENCLOUD_ALLOW_TOKEN_HASHES;
      else env.QWENCLOUD_ALLOW_TOKEN_HASHES = allow;
      const relay = spawn('deno', ['run', '-A', RELAY], {
        cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      relay.stdout.on('data', (d) => logs.push(String(d)));
      relay.stderr.on('data', (d) => logs.push(String(d)));
      const proc = { relay, logs, root: 'http://127.0.0.1:' + port };
      procs.push(proc);
      return proc;
    }
    async function waitUp(proc) {
      for (let i = 0; i < 50; i++) {
        const r = await postFull(proc.root + '/chat/completions', { 'Content-Type': 'application/json' }, { model: PINNED, messages: [{ role: 'user', content: 'x' }] });
        if (r.status) return;
        await new Promise((r2) => setTimeout(r2, 200));
      }
      throw new Error('中继没起来：' + proc.logs.join('').slice(0, 400));
    }
    const H = (tok, extra) => Object.assign({
      Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
    }, extra || {});
    const basePort = 19700 + (process.pid % 40) * 3;
    try {
      // 名单项带空格，哈希用大写。令牌头里 Bearer 后面多两个空格，验令牌前会 trim。
      const listed = boot(basePort, '  ' + hashIn.toUpperCase() + ' , deadbeef ');
      await waitUp(listed);
      reset();

      let r = await postFull(listed.root + '/chat/completions', {
        Authorization: 'Bearer   ' + TOKEN_IN, 'Content-Type': 'application/json',
      }, { model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'hi' }] });
      eq(r.status, 200, '名单内该走 QwenCloud：' + r.status + ' ' + String(r.body).slice(0, 160));
      eq(seen.qc.length, 1, '名单内该打到 QwenCloud');
      eq(seen.or.length, 0, '名单内不该打到 OpenRouter');
      eq(seen.bj.length, 0, '名单内不该打到北京');
      eq(seen.credits, 0, '名单内不查 OpenRouter 余额');
      let sent = JSON.parse(seen.qc[0].body);
      eq(sent.model, 'qwen3.7-plus');
      eq(sent.enable_thinking, false);
      ok(!('usage' in sent), 'QwenCloud 路径不写 usage.include');
      eq(seen.qc[0].auth, 'Bearer sk-qc-stub');
      near(seen.charges[0].p_cost, 2, '名单内按 0.40+1.60 记账');
      eq(seen.charges[0].p_model, 'qwen3.7-plus');
      noLeak(r, '名单内 200');

      reset();
      r = await postFull(listed.root + '/chat/completions', H(TOKEN_IN, { 'X-Real-IP': '1.0.8.1' }), {
        model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'cn' }],
      });
      eq(r.status, 200, '名单内的大陆 IP 也走 QwenCloud：' + r.body);
      eq(seen.qc.length, 1, '名单内大陆 IP 该打到 QwenCloud');
      eq(seen.bj.length, 0, '名单内大陆 IP 不该打到北京');
      eq(seen.or.length, 0, '名单内大陆 IP 不该改走 OpenRouter');
      sent = JSON.parse(seen.qc[0].body);
      eq(sent.model, 'qwen3.7-plus');
      eq(sent.enable_thinking, false);
      ok(!('usage' in sent), 'QwenCloud 路径不写 usage.include');
      eq(seen.qc[0].auth, 'Bearer sk-qc-stub');
      near(seen.charges[0].p_cost, 2, '大陆 IP 也按 0.40+1.60 记账');
      noLeak(r, '名单内大陆');

      reset();
      r = await postFull(listed.root + '/chat/completions', H(TOKEN_OUT, { 'X-Real-IP': '1.0.8.1' }), {
        model: PINNED, messages: [{ role: 'user', content: 'old' }],
      });
      eq(r.status, 200, '名单外该走旧路径：' + r.status + ' ' + String(r.body).slice(0, 160));
      eq(seen.or.length, 1, '名单外该打到 OpenRouter');
      eq(seen.qc.length, 0, '名单外不该打到 QwenCloud');
      eq(seen.bj.length, 0, '名单外的中国 IP 也不该改走北京');
      sent = JSON.parse(seen.or[0].body);
      eq(sent.model, PINNED, '名单外钉 GRANT_MODELS，不钉 qwen3.7-plus');
      deepEq(sent.usage, { include: true });
      ok(!('enable_thinking' in sent), '旧路径不写 enable_thinking');
      eq(seen.or[0].auth, 'Bearer sk-or-stub');
      ok(seen.credits >= 1, '名单外要查 OpenRouter 余额');
      near(seen.charges[0].p_cost, 0.02, '名单外按 usage.cost 记账，不用 0.40/1.60');
      eq(seen.charges[0].p_model, PINNED);
      noLeak(r, '名单外 200');

      const hops = () => seen.qc.length + seen.or.length + seen.bj.length;
      const beforeCase = hops();
      r = await postFull(listed.root + '/chat/completions', H(TOKEN_CASE), {
        model: PINNED, messages: [{ role: 'user', content: 'case' }],
      });
      eq(r.status, 200, '令牌大小写不同就不是同一枚，该走旧路径');
      eq(hops(), beforeCase + 1);
      eq(seen.or.length, 2, '大小写不同的令牌不在名单里');
      eq(seen.qc.length, 0);
      noLeak(r, '大小写不同');

      const beforeNew = hops();
      r = await postFull(listed.root + '/chat/completions', H(TOKEN_OUT), {
        model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'new' }],
      });
      eq(r.status, 403, '名单外的新模型名该 403，实际 ' + r.status + ' ' + r.body);
      ok(String(r.body).indexOf('model_not_allowed') >= 0 && String(r.body).indexOf(PINNED) >= 0, r.body);
      eq(hops(), beforeNew, '403 不该转发');
      noLeak(r, '名单外 403');

      r = await postFull(listed.root + '/chat/completions', H(TOKEN_OUT), {
        model: PINNED, messages: [{ role: 'user', content: '__FORCE_401__' }],
      });
      eq(r.status, 401, '名单外的上游 401 该原样透传，实际 ' + r.status);
      ok(String(r.body).indexOf('or_unauthorized') >= 0, '401 正文被改写了：' + r.body);
      ok(String(r.body).indexOf('grant_unavailable') < 0, r.body);
      noLeak(r, '名单外 401');

      const spec = await getFull(listed.root + '/spec');
      eq(spec.status, 200, '/spec 该 200');
      noLeak(spec, '/spec');
      ok(spec.body.indexOf('qwen3.7-plus') < 0, '/spec 不该改成国际钉死名：' + spec.body);
      logsClean(listed.logs, '名单已设置');
      ok(/relay [0-9a-f]{8} chat/.test(listed.logs.join('')), '日志仍用哈希前 8 位');
      try { listed.relay.kill('SIGKILL'); } catch (_) {}

      const unset = boot(basePort + 1, undefined);
      await waitUp(unset);
      reset();
      r = await postFull(unset.root + '/chat/completions', H(TOKEN_OUT), {
        model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'all' }],
      });
      eq(r.status, 200, '变量未设置该全量走 QwenCloud：' + r.status + ' ' + String(r.body).slice(0, 160));
      eq(seen.qc.length, 1);
      eq(seen.or.length, 0, '未设置名单时不该走 OpenRouter');
      eq(seen.bj.length, 0);
      eq(seen.credits, 0, '全量 QwenCloud 不查 OpenRouter 余额');
      sent = JSON.parse(seen.qc[0].body);
      eq(sent.model, 'qwen3.7-plus');
      eq(sent.enable_thinking, false);
      ok(!('usage' in sent));
      near(seen.charges[0].p_cost, 2, '未设置名单时仍按 QwenCloud 标价记账');
      noLeak(r, '未设置');
      logsClean(unset.logs, '变量未设置');
      try { unset.relay.kill('SIGKILL'); } catch (_) {}

      const empty = boot(basePort + 2, '');
      await waitUp(empty);
      reset();
      r = await postFull(empty.root + '/chat/completions', H(TOKEN_IN), {
        model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'empty' }],
      });
      eq(r.status, 403, '空串是空名单，新模型名该 403，实际 ' + r.status + ' ' + r.body);
      ok(String(r.body).indexOf(PINNED) >= 0, r.body);
      eq(seen.qc.length, 0, '空名单不该打到 QwenCloud');
      eq(seen.or.length, 0, '403 不该转发');
      eq(seen.bj.length, 0);
      noLeak(r, '空串 403');

      r = await postFull(empty.root + '/chat/completions', {
        Authorization: 'Bearer   ' + TOKEN_IN, 'Content-Type': 'application/json',
      }, { model: PINNED, messages: [{ role: 'user', content: 'empty-ok' }] });
      eq(r.status, 200, '空名单里原先会命中的令牌也走旧路径：' + r.status + ' ' + String(r.body).slice(0, 160));
      eq(seen.qc.length, 0);
      eq(seen.bj.length, 0);
      eq(seen.or.length, 1);
      sent = JSON.parse(seen.or[0].body);
      eq(sent.model, PINNED);
      deepEq(sent.usage, { include: true });
      eq(seen.or[0].auth, 'Bearer sk-or-stub');
      ok(seen.credits >= 1, '空名单走旧路径，要查余额');
      near(seen.charges[0].p_cost, 0.02, '空名单按 usage.cost 记账');
      noLeak(r, '空串 200');
      logsClean(empty.logs, '空串');
    } finally {
      for (const p of procs) { try { p.relay.kill('SIGKILL'); } catch (_) {} }
      try { qc.srv.close(); bj.srv.close(); or.srv.close(); db.srv.close(); } catch (_) {}
    }
  });

  test('段表文件不在旁边时，UPSTREAM=qwencloud 的聊天不再 503', async () => {
    if (!hasDeno) { ok(true, '跳过：这台机器没有 deno（可选工具链）'); return; }
    const src = fs.readFileSync(RELAY, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    ok(code.indexOf('cn-cidrs') < 0, '代码还在读段表');
    ok(code.indexOf('parseChinaCidrs') < 0, '代码还在解析段表');
    ok(code.indexOf('isChina') < 0, '代码还在调用 isChina');
    ok(code.indexOf('x-real-ip') < 0, '代码还在读 x-real-ip');

    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt592-nocidr-'));
    const fnDir = path.join(dir, 'bt-relay');
    fs.mkdirSync(fnDir);
    fs.copyFileSync(RELAY, path.join(fnDir, 'index.ts'));
    ok(!fs.existsSync(path.join(dir, 'bt-models', 'cn-cidrs.txt')), '临时目录里不该有段表');
    const row = [{ user_id: 'u1', limit_usd: 100, spent_usd: 0, status: 'active' }];
    const seen = { n: 0 };
    const qc = await server(() => {
      seen.n += 1;
      return j({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    });
    const db = await server((req) => {
      if (/bt_grant_check/.test(req.url)) return j(row);
      if (/bt_grant_charge/.test(req.url)) return j(1);
      return j({});
    });
    const port = 23100 + (process.pid % 200);
    const env = Object.assign({}, process.env, {
      PORT: String(port),
      SUPABASE_URL: 'http://127.0.0.1:' + db.port,
      SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role',
      UPSTREAM: 'qwencloud',
      QWENCLOUD_KEY: 'sk-qc-stub',
      QWENCLOUD_CHAT_BASE: 'http://127.0.0.1:' + qc.port + '/v1',
    });
    delete env.QWENCLOUD_ALLOW_TOKEN_HASHES;
    const logs = [];
    const relay = spawn('deno', ['run', '-A', path.join(fnDir, 'index.ts')], {
      cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    relay.stdout.on('data', (d) => logs.push(String(d)));
    relay.stderr.on('data', (d) => logs.push(String(d)));
    try {
      let r = { status: 0, body: '' };
      for (let i = 0; i < 60; i++) {
        r = await post('http://127.0.0.1:' + port + '/chat/completions', {
          Authorization: 'Bearer bmg_ok', 'Content-Type': 'application/json',
        }, { model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'nocidr' }] });
        if (r.status) break;
        await new Promise((r2) => setTimeout(r2, 200));
      }
      eq(r.status, 200, '段表不在旁边仍该 200：' + r.status + ' ' + String(r.body).slice(0, 160) + ' ' + logs.join('').slice(0, 300));
      ok(String(r.body).indexOf('grant_misconfigured') < 0, r.body);
      eq(seen.n, 1, '该打到国际桩，实际 ' + seen.n);
    } finally {
      try { relay.kill('SIGKILL'); } catch (_) {}
      try { qc.srv.close(); db.srv.close(); } catch (_) {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
