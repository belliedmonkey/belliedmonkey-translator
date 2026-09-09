#!/usr/bin/env node
// scripts/subscription-auth-probe.js —— 订阅登录（Codex / Claude）到底能不能给我们用。
//
//   node scripts/subscription-auth-probe.js claude     # 登录一次 Claude Pro/Max 并实测
//   node scripts/subscription-auth-probe.js codex      # 登录一次 ChatGPT Plus/Pro 并实测
//   node scripts/subscription-auth-probe.js <家> --reuse   # 用上次存下的 token，不再登录
//   node scripts/subscription-auth-probe.js <家> --model <名>  # 换个模型再打（名字错会得 400）
//
// **它只回答一个问题，但那个问题决定整个架构：**
//
//   后端会不会因为「你不是官方 CLI」而拒绝我们？
//
// 判据是**同一个 token、同一个请求体，只换 User-Agent 打两次**：
//   A（对照）＝ 官方 CLI 的 UA        —— 应该通。不通说明是别的原因（token/端点/请求体）
//   B（真正要测的）＝ 普通浏览器 UA   —— **这一条决定一切**
//
//   B 通  ⇒ 浏览器/扩展路线可行，而且**不需要伪装任何东西** —— 这是「光明正大」的那条路。
//   B 拒  ⇒ 后端在按客户端身份挡人。要么只能走能设 UA 的原生（那就是刻意伪装，要另行裁定），
//           要么这一家只做不了。
//
// 为什么模型请求从 Node 发而不是从浏览器发：扩展的 fetch 走 `host_permissions`，CORS 对它
// 本来就不成立（`extension/content/translation-api.js` 的 background 代理路线），所以 CORS
// 不是变量。真正的变量只有 UA，而 Node 可以随意设 UA —— 浏览器不能，这正是问题所在。
//
// 浏览器只用来做一件事：**让你登录**。回调走本机回环监听（和官方 CLI 同一个做法），
// 所以不需要任何浏览器自动化。
//
// ⚠️ **token 只写进 `.local/`（gitignored），永不打印、永不进日志。**
//     打印的只有：HTTP 状态码、响应体的前若干字符（已做脱敏）、耗时。
//
// 背景与裁定：`docs/subscription-auth-research.md`（2026-09-09）。
// 流程细节的出处：`docs/oauth-design.md`（2026-06-28，逆向提取，**可能已漂移** ——
// 端点 404 / 参数被拒时先怀疑它过期了，而不是怀疑你自己填错了）。
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, '.local', 'subscription-tokens.json');

// ── 两家的流程参数（出处 docs/oauth-design.md §1）────────────────────────────
//
// client_id 是**官方 CLI 的**。这一点无法回避：OAuth 的 client_id 必须由授权服务器认识，
// 而我们没有注册过。它是这条路上唯一一处「不得不借用」的东西 —— 与 UA 不同，UA 是可选的，
// 这个不是。写在这里是为了让它显眼，不是为了让它被忽略。
const VENDORS = {
  codex: {
    label: 'ChatGPT / Codex 订阅',
    authorize: 'https://auth.openai.com/oauth/authorize',
    token: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    redirect: 'http://localhost:1455/auth/callback',
    port: 1455,
    scope: 'openid profile email offline_access',
    extra: { id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true' },
    tokenForm: true,                       // form-urlencoded
    // 官方 CLI 的 UA 形状，见 codex-rs/login/src/auth/default_client.rs 的 get_codex_user_agent()
    cliUA: 'codex_cli_rs/0.5.0 (Macos 15.5; arm64) probe',
    // ⚠️ Codex 后端接受哪些模型名，我没有一手依据（仓库台账里只有走公开 API 的
    //    gpt-5-mini / gpt-5-nano）。名字错了会得到 400，**而 400 很容易被误读成「被挡了」**
    //    —— 所以判读那一段专门写了「两条都不通先怀疑模型名」。用 --model 覆盖。
    model: 'gpt-5-codex',
    call(token, accountId, ua) {
      return {
        url: 'https://chatgpt.com/backend-api/codex/responses',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': ua,
          'originator': 'codex_cli_rs',
          'OpenAI-Beta': 'responses=experimental',
          'accept': 'text/event-stream',
          ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          instructions: 'Reply with exactly: OK',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
          stream: true,
          store: false,
        }),
      };
    },
  },
  claude: {
    label: 'Claude Pro / Max 订阅',
    authorize: 'https://claude.ai/oauth/authorize',
    token: 'https://platform.claude.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    redirect: 'http://localhost:53692/callback',
    port: 53692,
    scope: 'org:create_api_key user:profile user:inference',
    extra: { code: 'true' },
    tokenForm: false,                      // JSON
    cliUA: 'claude-cli/1.0.0 (external, cli)',
    model: 'claude-haiku-4-5-20251001',   // 注册表里的默认档，最便宜；--model 可覆盖
    call(token, _accountId, ua) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Authorization': `Bearer ${token}`,     // OAuth 走 Bearer，不是 x-api-key
          'Content-Type': 'application/json',
          'User-Agent': ua,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
          // Anthropic **官方**为浏览器直连开的口子 —— 我们的 messages-compat 本来就在发它
          'anthropic-dangerous-direct-browser-access': 'true',
          'x-app': 'cli',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 16,
          // docs/oauth-design.md §2.5 记着：OAuth 鉴权要求 system 第一块是 Claude Code 那句，
          // 否则不放行。**这本身就是一处「携带别人的身份」** —— 探针如实照做并单独报一行，
          // 好让「去掉它还通不通」变成一个可测的问题，而不是一句传说。
          system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        }),
      };
    },
  },
};

// 一个普通 Chrome 的 UA —— 浏览器里我们**只能**发这个（User-Agent 是 fetch 的禁用头）。
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const redact = (s) => String(s == null ? '' : s)
  .replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1…')
  .replace(/(Bearer\s+[A-Za-z0-9._-]{6})[A-Za-z0-9._-]+/gi, '$1…')
  .replace(/("(?:access_token|refresh_token|id_token)"\s*:\s*")[^"]+/g, '$1…');

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (_) { return {}; }
}
function saveStore(obj) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(obj, null, 2), { mode: 0o600 });
}

// ── 登录：本机回环监听接回调，和官方 CLI 同一个做法 ──────────────────────────
async function login(v) {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const url = new URL(v.authorize);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', v.clientId);
  url.searchParams.set('redirect_uri', v.redirect);
  url.searchParams.set('scope', v.scope);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  for (const [k, val] of Object.entries(v.extra || {})) url.searchParams.set(k, val);

  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const got = new URL(req.url, `http://localhost:${v.port}`);
      const c = got.searchParams.get('code');
      const st = got.searchParams.get('state');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(c
        ? '<h2>拿到了，回终端看结果。这个标签页可以关了。</h2>'
        : '<h2>没拿到 code。回终端看错误。</h2>');
      srv.close();
      if (!c) return reject(new Error('回调里没有 code：' + redact(got.search)));
      if (st !== state) return reject(new Error('state 不匹配 —— 中止（可能是别的登录串台了）'));
      resolve(c);
    });
    srv.on('error', (e) => reject(new Error(
      `本机 ${v.port} 端口起不来：${e.message}\n（官方 CLI 正在跑？先关掉它再试）`)));
    srv.listen(v.port, '127.0.0.1', () => {
      console.log(`\n① 在浏览器里打开下面这个链接，用你的${v.label}账号登录：\n`);
      console.log('   ' + url.toString() + '\n');
      console.log(`② 登录完成后浏览器会跳回 localhost:${v.port}，本脚本自动接住。等着就行。\n`);
    });
    setTimeout(() => { srv.close(); reject(new Error('10 分钟没等到回调，放弃')); }, 10 * 60 * 1000);
  });

  const body = { grant_type: 'authorization_code', client_id: v.clientId,
    code, code_verifier: verifier, redirect_uri: v.redirect, state };
  const r = await fetch(v.token, {
    method: 'POST',
    headers: { 'Content-Type': v.tokenForm ? 'application/x-www-form-urlencoded' : 'application/json',
      'User-Agent': v.cliUA },
    body: v.tokenForm ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`换 token 失败 HTTP ${r.status}：${redact(text).slice(0, 300)}`);
  const tok = JSON.parse(text);
  if (!tok.access_token) throw new Error('响应里没有 access_token：' + redact(text).slice(0, 200));

  // account_id 藏在 access_token 的 JWT claim 里（Codex 那条要它当请求头）
  let accountId = null;
  try {
    const claims = JSON.parse(Buffer.from(tok.access_token.split('.')[1], 'base64').toString('utf8'));
    accountId = (claims['https://api.openai.com/auth'] || {}).chatgpt_account_id || null;
  } catch (_) {}

  console.log('✓ 登录成功，token 已存进 .local/subscription-tokens.json（600 权限，gitignored）');
  return { access_token: tok.access_token, refresh_token: tok.refresh_token || null,
    accountId, at: new Date().toISOString() };
}

// ── 实测：同一个 token、同一个体，只换 UA 打两次 ────────────────────────────
async function callOnce(v, tok, ua, label) {
  const req = v.call(tok.access_token, tok.accountId, ua);
  const t0 = Date.now();
  let r, text;
  try {
    r = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
    text = await r.text();
  } catch (e) {
    console.log(`  ${label.padEnd(22)} ✗ 传输层失败：${e.message}`);
    return { ok: false, transport: false };
  }
  const ms = Date.now() - t0;
  const ok = r.status >= 200 && r.status < 300;
  const snippet = redact(text).replace(/\s+/g, ' ').trim().slice(0, 160);
  console.log(`  ${label.padEnd(22)} ${ok ? '✓' : '✗'} HTTP ${r.status}  ${ms}ms`);
  if (snippet) console.log(`  ${' '.repeat(22)}   ${snippet}`);
  return { ok, status: r.status, ms, snippet };
}

(async () => {
  const which = process.argv[2];
  const reuse = process.argv.includes('--reuse');
  const v = VENDORS[which];
  if (!v) {
    console.error('用法：node scripts/subscription-auth-probe.js <claude|codex> [--reuse]');
    process.exit(2);
  }

  console.log(`\n订阅登录探针 · ${v.label}`);
  console.log('目的：后端会不会因为「你不是官方 CLI」而拒绝我们。判据是只换 UA 打两次。\n');

  const mi = process.argv.indexOf('--model');
  if (mi > 0 && process.argv[mi + 1]) v.model = process.argv[mi + 1];

  const store = loadStore();
  let tok = reuse ? store[which] : null;
  if (!tok) {
    tok = await login(v);
    store[which] = tok;
    saveStore(store);
  } else {
    console.log('（--reuse：用上次存下的 token，不重新登录）');
  }

  console.log(`\n实测 —— 模型：${v.model}\n`);
  const a = await callOnce(v, tok, v.cliUA, 'A 官方 CLI 的 UA');
  const b = await callOnce(v, tok, BROWSER_UA, 'B 普通浏览器 UA');

  console.log('\n── 判读 ──');
  if (!a.ok && !b.ok) {
    console.log('两条都不通 ⇒ **这不是 UA 的问题**。先怀疑：token 过期 / 端点已漂移');
    console.log('（docs/oauth-design.md 是 2026-06-28 逆向提取的）/ 请求体形状变了 / 模型名不对。');
    console.log('把上面两行状态码与响应片段贴回来，我按它改。');
  } else if (b.ok) {
    console.log('**B 通了 ⇒ 浏览器/扩展路线可行，而且不需要伪装任何东西。**');
    console.log('这就是「光明正大」的那条路：我们发自己的 UA，后端照样接。');
    console.log('⇒ 可以直接在扩展里做，不必为它写原生代码。');
  } else {
    console.log('**B 被拒而 A 通了 ⇒ 后端在按客户端身份挡人。**');
    console.log('浏览器发不出官方 UA（User-Agent 是 fetch 的禁用头），所以这一家在扩展里做不了。');
    console.log('剩下的选择只有两个，都要你再裁定一次：');
    console.log('  ① 只做 iOS/macOS 原生（原生能设 UA —— 但那就是刻意伪装，不再是「光明正大」）；');
    console.log('  ② 这一家不做。');
  }
  console.log('');
})().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
