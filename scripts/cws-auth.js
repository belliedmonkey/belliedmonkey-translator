#!/usr/bin/env node
// scripts/cws-auth.js — 一次性取得 Chrome Web Store API 的 refresh token。
//
// 用法：
//   node scripts/cws-auth.js
//
// 它做什么：
//   1. 读 .local/keys.md 里的 cws_client_id / cws_client_secret
//   2. 在 127.0.0.1 上起一个一次性回调服务器
//   3. 打印授权链接（**你在浏览器里点同意**——这一步只能是你，它用的是你的 Google 账号）
//   4. 收到回调后换取 refresh token，**直接写回 .local/keys.md**
//
// 为什么把 token 直接写文件而不是打印出来：它是长期凭证，打印出来就会进终端记录、
// 进会话记录。写文件是唯一不让它路过任何日志的做法。
//
// ⚠️ 回调地址这件事被 Google 改过两次，两条老路都死了：
//   · out-of-band（`urn:ietf:wg:oauth:2.0:oob`，把 code 抄下来粘贴）—— 2022 年停用
//   · 桌面应用的**隐式 loopback**（任意 127.0.0.1 端口）—— 现在也被封，实测 2026-08-21
//     报 400 invalid_request：「The loopback flow has been blocked in order to keep
//     users secure.」
//
// 现在走的是第三条：客户端类型建成 **Web 应用**，把 `http://localhost:<端口>` **显式
// 登记**为授权重定向 URI。那不是被封的隐式 loopback，而是一个正常登记过的回调地址
// （Google 对 localhost 例外允许 http）。代价是端口必须**固定**并与登记的一字不差。
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  // `[^\\S\\n]*` 而不是 `\\s*`：`\\s` **包含换行**，于是一个空槽位（`key =` 后面什么都没有）
  // 会贪婪地跨行吃到下一行的内容，把下一行的字段名当成 key 返回。实测 2026-08-21：
  // 空的 cws_client_id 取到了字符串 "cws_client_secret"，于是「缺凭证」被伪装成
  // 「凭证错误」，报错指向完全错误的方向。
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

// 写回 keys.md：已有该行就替换，没有就追加。保持文件本身的 `key = value` 写法。
function writeSlot(name, value) {
  let s = fs.readFileSync(KEYS, 'utf8');
  const re = new RegExp('^(' + name + '\\s*=).*$', 'm');
  if (re.test(s)) s = s.replace(re, `$1 ${value}`);
  else s = s.replace(/\s*$/, '\n') + `${name.padEnd(25)} = ${value}\n`;
  fs.writeFileSync(KEYS, s);
}

// PKCE：给**没有密钥**的客户端用的。Google 现在给「桌面应用」类型签发的客户端可以
// 不带 client_secret（下载的 JSON 里只有 client_id / project_id / auth_uri / token_uri），
// 那时授权码要靠 code_verifier 而不是密钥来证明是同一个客户端换的。
// 有密钥就带上密钥，没有就走 PKCE —— 两种都支持，因为控制台给哪种不由我们决定。
function pkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');    // 64 字符，在 43–128 内
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

(async () => {
  const id = slot('cws_client_id');
  const secret = slot('cws_client_secret');          // 可以为空 —— 见上
  if (!id) {
    console.error('✗ .local/keys.md 里缺 cws_client_id。');
    console.error('  先在 Google Cloud 控制台建一个 OAuth 客户端（类型：桌面应用），');
    console.error('  把 client id 填进去，再跑这个脚本。client_secret 可留空（走 PKCE）。');
    process.exit(1);
  }
  console.log(secret ? '模式：client_secret' : '模式：PKCE（该客户端没有密钥，这是正常的）');
  const { verifier, challenge } = pkce();

  // 端口必须固定：它要和控制台里登记的那个重定向 URI 一字不差。随机端口是隐式 loopback
  // 的做法，而那条路已经被封（见文件头）。默认 8976，可用 cws_redirect_port 覆盖。
  const port = Number(slot('cws_redirect_port') || 8976);
  const redirect = `http://localhost:${port}`;
  const server = http.createServer();
  try {
    await new Promise((res, rej) => {
      server.once('error', rej);
      server.listen(port, '127.0.0.1', res);
    });
  } catch (e) {
    console.error(`✗ 端口 ${port} 起不来：${e.code === 'EADDRINUSE' ? '已被占用' : e.message}`);
    console.error('  换一个：在 .local/keys.md 加一行 cws_redirect_port = 9123，');
    console.error('  并把控制台里登记的重定向 URI 同步改成 http://localhost:9123');
    process.exit(1);
  }
  console.log(`回调地址 ${redirect} —— 必须与控制台里登记的**完全一致**`);

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?'
    + new URLSearchParams({
      client_id: id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: SCOPE,
      // access_type=offline 才会给 refresh token；prompt=consent 强制**每次**都给，
      // 否则第二次授权同一个客户端时 Google 只回 access token，你会拿到一个没有
      // refresh token 的响应然后一头雾水。
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();

  console.log('\n在浏览器里打开下面这个链接并点「继续 / 允许」：\n');
  console.log('  ' + authUrl + '\n');
  console.log('（正在 ' + redirect + ' 等回调，完成后本脚本会自己收尾）\n');
  execFile('open', [authUrl], () => {});      // macOS：顺手替你打开，失败也不影响

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('5 分钟内没有收到回调')), 300000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirect);
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<meta charset="utf-8"><h2>${c ? '授权完成，可以关掉这个页面了。' : '授权失败：' + err}</h2>`);
      clearTimeout(timer);
      if (c) resolve(c); else reject(new Error('授权被拒绝：' + err));
    });
  }).finally(() => server.close());

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({
      client_id: id, code, code_verifier: verifier,
      grant_type: 'authorization_code', redirect_uri: redirect,
    }, secret ? { client_secret: secret } : {})).toString(),
  });
  const d = await r.json();
  if (!r.ok || !d.refresh_token) {
    console.error('✗ 换取 refresh token 失败：HTTP ' + r.status);
    // 只打印错误字段，绝不打印整个响应 —— 里面可能有 access_token。
    console.error('  ' + (d.error || '') + ' ' + (d.error_description || ''));
    if (r.ok && !d.refresh_token) {
      console.error('  拿到了 access token 但没有 refresh token —— 通常是漏了 prompt=consent，'
        + '或这个客户端此前已经授权过。到 https://myaccount.google.com/permissions 撤销后重试。');
    }
    process.exit(1);
  }

  writeSlot('cws_refresh_token', d.refresh_token);
  console.log('✓ refresh token 已写入 .local/keys.md（未打印到终端）');
  console.log('  下一步：node scripts/cws-publish.js --check');
})().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
