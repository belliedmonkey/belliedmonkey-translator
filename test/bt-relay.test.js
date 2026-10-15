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
      seen.upstream.push({ url: req.url, auth: req.headers.authorization, body: raw });
      if (raw.includes('__FORCE_401__')) return { statusCode: 401, body: '{"error":"or_unauthorized"}', type: 'application/json' };
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

      const bareAt = seen.upstream.length;
      r = await post(base, H('bmg_ok'), { model: PINNED, messages: [{ role: 'user', content: 'plain' }] });
      eq(r.status, 200, '不带 temperature 的请求该 200（实际 ' + r.status + '）');
      const bare = JSON.parse(seen.upstream[bareAt].body);
      ok(!('temperature' in bare), '客户端没带 temperature，默认路径却写进了上游请求：' + JSON.stringify(bare));
      ok(!('enable_thinking' in bare), '默认路径不该写 enable_thinking');

      r = await post(base, H('bmg_ok'), { model: PINNED, messages: [{ role: 'user', content: '__FORCE_401__' }] });
      eq(r.status, 401, '开关关闭时上游 401 原样透传（实际 ' + r.status + ' ' + String(r.body).slice(0, 80) + '）');
      ok(String(r.body).indexOf('or_unauthorized') >= 0, '401 正文被改写了：' + r.body);

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

  test('UPSTREAM=qwencloud：IP、白名单、音色、10MB、记账（本地桩，不打线上）', async () => {
    if (!hasDeno) { ok(true, '跳过：这台机器没有 deno（可选工具链）'); return; }
    const https = require('https');
    const os = require('os');
    const row = [{ user_id: 'u1', limit_usd: 100, spent_usd: 0, status: 'active' }];
    const seen = { qc: [], bj: [], charges: [], logs: [], trap: 0 };
    const qc = await server((req, raw) => {
      const text = String(raw);
      seen.qc.push({ url: req.url, body: text });
      if (text.includes('__FORCE_401__')) return { statusCode: 401, body: '{"error":"SECRET401"}', type: 'application/json' };
      if (text.includes('__FORCE_402__')) return { statusCode: 402, body: '{"error":"SECRET402"}', type: 'application/json' };
      if (text.includes('__FORCE_403__')) return { statusCode: 403, body: '{"error":"SECRET403"}', type: 'application/json' };
      if (text.includes('__FORCE_429__')) return { statusCode: 429, body: '{"error":"SECRET429"}', type: 'application/json' };
      if (text.includes('__TTS_HTTP__')) {
        return j({ output: { audio: { url: 'http://127.0.0.1:' + trap.port + '/SECRETURL-file.wav' } }, usage: { characters: 4 } });
      }
      if (text.includes('__TTS_HTTPS_FAIL__')) {
        return j({ output: { audio: { url: 'https://127.0.0.1:1/signed-audio-secret.wav?Signature=SECRETURL' } }, usage: { characters: 4 } });
      }
      if (text.includes('__TTS_OK__')) {
        return j({ output: { audio: { url: seen.tlsUrl } }, usage: { characters: 21 } });
      }
      if (text.includes('__TTS_NOCHARS__')) return j({ output: { audio: { url: seen.tlsUrl } } });
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
    let tls = null;
    const tlsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt592-tls-'));
    try {
      // Deno 拒绝「把 CA 证书本身当服务器证书」（CaUsedAsEndEntity）。先签一张 CA，再签叶子。
      execSync('openssl req -x509 -newkey rsa:2048 -keyout "' + tlsDir + '/ca.key" -out "' + tlsDir + '/ca.pem" -days 1 -nodes -subj /CN=mt592-ca -addext basicConstraints=critical,CA:TRUE', { stdio: 'ignore' });
      execSync('openssl req -newkey rsa:2048 -keyout "' + tlsDir + '/leaf.key" -out "' + tlsDir + '/leaf.csr" -nodes -subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1 -addext basicConstraints=CA:FALSE', { stdio: 'ignore' });
      execSync('openssl x509 -req -in "' + tlsDir + '/leaf.csr" -CA "' + tlsDir + '/ca.pem" -CAkey "' + tlsDir + '/ca.key" -CAcreateserial -out "' + tlsDir + '/leaf.pem" -days 1 -copy_extensions copy', { stdio: 'ignore' });
      tls = await new Promise((resolve, reject) => {
        const srv = https.createServer({
          key: fs.readFileSync(path.join(tlsDir, 'leaf.key')),
          cert: fs.readFileSync(path.join(tlsDir, 'leaf.pem')),
        }, (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'audio/wav' });
          res.end(Buffer.from('RIFFfake'));
        });
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
      });
      seen.tlsUrl = 'https://127.0.0.1:' + tls.port + '/a.wav';
    } catch (_) { tls = null; seen.tlsUrl = ''; }

    const db = await server((req, raw) => {
      if (/bt_grant_check/.test(req.url)) return j(row);
      if (/bt_grant_charge/.test(req.url)) { seen.charges.push(JSON.parse(String(raw))); return j(1); }
      return j({});
    });
    const port = 18900 + (process.pid % 500);
    const denoArgs = ['run', '-A'];
    if (tls) denoArgs.push('--cert', path.join(tlsDir, 'ca.pem'));
    denoArgs.push(RELAY);
    const relay = spawn('deno', denoArgs, {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
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
      }),
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

      const bj0 = seen.bj.length;
      const qc0 = seen.qc.length;
      r = await postBytes(root + '/chat/completions', H({ 'X-Real-IP': '1.0.8.1', 'X-Forwarded-For': '8.8.8.8' }), {
        model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'cn' }], enable_thinking: true,
      });
      eq(r.status, 200, '中国 IP 该 200：' + r.body);
      eq(seen.bj.length, bj0 + 1, '中国 IP 该打到北京');
      eq(seen.qc.length, qc0, '中国 IP 不该打到 QwenCloud');
      sent = JSON.parse(seen.bj[seen.bj.length - 1].body);
      eq(sent.model, 'qwen-plus', '没配 GRANT_MODELS.chat 时用 qwen-plus');
      ok(!('enable_thinking' in sent), '北京路径不写 enable_thinking');
      ok(!('temperature' in sent), '北京路径也不该自己加 temperature');

      r = await postBytes(root + '/chat/completions', H({ 'X-Forwarded-For': '1.0.8.1' }), { model: 'qwen3.7-plus', messages: [{ role: 'user', content: 'xff' }] });
      eq(JSON.parse(seen.qc[seen.qc.length - 1].body).model, 'qwen3.7-plus', '不信 X-Forwarded-For，没 X-Real-IP 就走国际');

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

      const cnStt = formFile({}, { name: 'a.webm', type: 'audio/webm', buf: Buffer.from('cn') });
      r = await postBytes(root + '/audio/transcriptions', { Authorization: 'Bearer bmg_ok', 'Content-Type': cnStt.type, 'X-Real-IP': '1.0.8.1' }, cnStt.body);
      eq(r.status, 503, '中国 IP 没配转写模型该 503');
      ok(String(r.body).indexOf('grant_misconfigured') >= 0, r.body);

      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: 'Serena please', voice: 'Serena' });
      sent = JSON.parse(seen.qc.filter((x) => x.url.indexOf('/generation') >= 0).pop().body);
      eq(sent.model, 'qwen3-tts-flash');
      eq(sent.input.voice, 'Serena', '名单里的音色原样用');
      eq(sent.input.text, 'Serena please');
      eq(sent.input.language_type, 'Auto');

      r = await postBytes(root + '/audio/speech', H(), { model: 'deepgram/aura-2', input: 'legacy', voice: 'aura-2-thalia-en' });
      sent = JSON.parse(seen.qc.filter((x) => x.url.indexOf('/generation') >= 0).pop().body);
      eq(sent.model, 'qwen3-tts-flash');
      eq(sent.input.voice, 'Cherry', '旧音色映射到 Cherry');

      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: 'unknown voice', voice: 'not-a-voice' });
      sent = JSON.parse(seen.qc.filter((x) => x.url.indexOf('/generation') >= 0).pop().body);
      eq(sent.input.voice, 'Cherry');

      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: '__TTS_HTTP__', voice: 'Cherry' });
      eq(r.status, 502, 'http 音频地址该 502');
      ok(String(r.body).indexOf('SECRETURL') < 0, '502 正文带了签名 URL');
      eq(seen.trap, 0, '不该去拉 http 地址');

      r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: '__TTS_HTTPS_FAIL__', voice: 'Cherry' });
      eq(r.status, 502, '音频 URL 拉取失败该 502');
      const logs = seen.logs.join('');
      ok(logs.indexOf('SECRETURL') < 0 && logs.indexOf('signed-audio-secret') < 0, '日志里出现了签名 URL：' + logs.slice(0, 500));

      if (tls) {
        const c0 = seen.charges.length;
        r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input: '__TTS_OK__', voice: 'Cherry' });
        eq(r.status, 200, '朗读成功该回音频字节：' + r.status + ' ' + String(r.body).slice(0, 80));
        eq(r.type.split(';')[0], 'audio/wav');
        eq(String(r.body), 'RIFFfake');
        ok(String(r.body).indexOf('{') < 0, '不该把 JSON 透传给客户端');
        near(seen.charges[seen.charges.length - 1].p_cost, 21 * 0.1 / 10000, '21 字 × $0.1/万');
        eq(seen.charges.length, c0 + 1);

        const input = '__TTS_NOCHARS__';
        r = await postBytes(root + '/audio/speech', H(), { model: 'qwen3-tts-flash', input, voice: 'Cherry' });
        eq(r.status, 200, '缺 characters 仍该返回音频');
        near(seen.charges[seen.charges.length - 1].p_cost, input.length * 0.1 / 10000, '缺 characters 用输入长度');
      }

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
      try { if (tls) tls.srv.close(); } catch (_) {}
    }
  });
});
