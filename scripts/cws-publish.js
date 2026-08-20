#!/usr/bin/env node
// scripts/cws-publish.js — 用 Chrome Web Store API 传包 / 提审。
//
// 用法：
//   node scripts/cws-publish.js --check            # 只体检：凭证、item 状态，不动任何东西
//   node scripts/cws-publish.js --upload           # 传 zip，生成草稿（**不**提审）
//   node scripts/cws-publish.js --upload --publish # 传 + 提审（对外动作，需显式加这个旗标）
//
// 默认什么都不做，必须显式说要做哪一步 —— 提审是对外动作，不该是某个命令的副作用。
//
// 凭证从 .local/keys.md 读（gitignored）：
//   cws_client_id / cws_client_secret / cws_refresh_token / cws_item_id
// 前三个由 scripts/cws-auth.js 取得，item id 是扩展在商店里的 id。
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const ZIP = path.join(ROOT, 'belliedmonkeytranslator.zip');

function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  // `[^\\S\\n]*` 而不是 `\\s*`：`\\s` **包含换行**，于是一个空槽位（`key =` 后面什么都没有）
  // 会贪婪地跨行吃到下一行的内容，把下一行的字段名当成 key 返回。实测 2026-08-21：
  // 空的 cws_client_id 取到了字符串 "cws_client_secret"，于是「缺凭证」被伪装成
  // 「凭证错误」，报错指向完全错误的方向。
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

// 错误正文可能带 token 之类的东西吗？CWS 的不会，但它会带很长的 HTML。截断并压平。
const brief = (t) => String(t).replace(/\s+/g, ' ').slice(0, 300);

async function accessToken() {
  const [id, secret, refresh] = ['cws_client_id', 'cws_client_secret', 'cws_refresh_token'].map(slot);
  // client_secret **可以为空**：Google 现在给桌面应用类型签发的客户端可以不带密钥，
  // 授权走 PKCE（见 cws-auth.js）。刷新时同样只带 client_id。
  const missing = ['cws_client_id', 'cws_refresh_token'].filter((n) => !slot(n));
  if (missing.length) {
    console.error('✗ .local/keys.md 缺：' + missing.join(', '));
    console.error('  client id/secret 在 Google Cloud 控制台建；refresh token 跑 '
      + 'node scripts/cws-auth.js 取。');
    process.exit(1);
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: id,
      refresh_token: refresh, grant_type: 'refresh_token' },
    secret ? { client_secret: secret } : {})).toString(),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) {
    console.error(`✗ 换 access token 失败 HTTP ${r.status}: ${d.error || ''} ${d.error_description || ''}`);
    if (d.error === 'invalid_grant') {
      console.error('  invalid_grant 常见于：refresh token 被撤销、client secret 换过、'
        + '或 OAuth 同意屏幕还停在「测试」状态（测试模式下 refresh token 7 天就过期）。');
    }
    process.exit(1);
  }
  return d.access_token;
}

async function api(token, method, url, body, extraHeaders) {
  const headers = Object.assign({
    Authorization: 'Bearer ' + token,
    'x-goog-api-version': '2',
  }, extraHeaders || {});
  const r = await fetch(url, { method, headers, body });
  const text = await r.text();
  let d = null;
  try { d = JSON.parse(text); } catch (_) { /* 非 JSON 也要留住原文 */ }
  return { ok: r.ok, status: r.status, d, text };
}

(async () => {
  const argv = process.argv.slice(2);
  const want = { check: argv.includes('--check'), upload: argv.includes('--upload'),
    publish: argv.includes('--publish') };
  if (!want.check && !want.upload) {
    console.log('用法: node scripts/cws-publish.js --check | --upload [--publish]');
    console.log('  --check   只体检，不动任何东西');
    console.log('  --upload  传 zip 生成草稿');
    console.log('  --publish 提审（对外动作，必须与 --upload 一起显式给出）');
    process.exit(1);
  }

  const itemId = slot('cws_item_id');
  if (!itemId) { console.error('✗ .local/keys.md 缺 cws_item_id'); process.exit(1); }

  const token = await accessToken();
  console.log('✓ access token 已取得');

  // ── 体检：拿 item 的当前状态 ─────────────────────────────────────────────
  const info = await api(token, 'GET',
    `https://www.googleapis.com/chromewebstore/v1.1/items/${itemId}?projection=DRAFT`);
  if (!info.ok) {
    console.error(`✗ 读 item 失败 HTTP ${info.status}: ${brief(info.text)}`);
    if (info.status === 404) {
      console.error('  404 通常是 item id 不对，或这个 Google 账号不是该扩展的所有者/发布者。');
    }
    process.exit(1);
  }
  console.log(`  item ${itemId}`);
  console.log(`  当前状态: ${(info.d.uploadState || '?')}  crx 版本: ${info.d.crxVersion || '（草稿里还没有）'}`);
  if (Array.isArray(info.d.itemError) && info.d.itemError.length) {
    for (const e of info.d.itemError) console.log('  ⚠️ ' + brief(e.error_detail || JSON.stringify(e)));
  }

  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  console.log(`  本地 package.json: ${pkgVersion}`);

  if (!want.upload) {
    console.log('\n（--check 到此为止，什么都没动）');
    return;
  }

  // ── 传包 ────────────────────────────────────────────────────────────────
  if (!fs.existsSync(ZIP)) {
    console.error(`✗ 找不到 ${ZIP} —— 先跑 node build.js`);
    process.exit(1);
  }
  // 包里的版本才是要紧的那个：本地 package.json 与 zip 可能不同步（zip 是上一次
  // build 的产物）。这一步的教训代价很大 —— 见 verify-extension-smoke.js 的注释。
  const zipBytes = fs.readFileSync(ZIP);

  // ── 同一个版本号必须对应同一份内容 ──────────────────────────────────────
  //
  // 2026-08-21 实测：磁盘上的 zip 写着 1.6.2，但它是在 v1.6.2 打完标签之后又构建的，
  // 里面多了一个未发布的修复。传上去的话 CWS 的「1.6.2」与 GitHub Release 的「1.6.2」
  // 是两份不同的东西 —— 而两边都自称 1.6.2，事后没有任何办法分辨用户装的是哪一份。
  //
  // 所以这里硬拦：zip 的版本号必须有同名 tag，且 HEAD 必须就在那个 tag 上。
  // 要传一个「tag 之后又改过」的包，得显式加 --allow-dirty 并自己承担后果。
  const zipVersion = (() => {
    try {
      const raw = execSync(`unzip -p ${JSON.stringify(ZIP)} manifest.json`, { encoding: 'utf8' });
      return JSON.parse(raw).version;
    } catch (_) { return null; }
  })();
  console.log(`\n准备上传 ${(zipBytes.length / 1024).toFixed(0)} KB，包内版本 ${zipVersion || '?'}`);

  if (zipVersion && !argv.includes('--allow-dirty')) {
    const git = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return ''; } };
    const tag = `v${zipVersion}`;
    const tagSha = git(`git rev-list -n1 ${tag}`);
    const head = git('git rev-parse HEAD');
    const dirty = git('git status --porcelain -- extension build build.js');
    if (!tagSha) {
      console.error(`✗ 包内版本 ${zipVersion} 没有对应的 tag ${tag} —— 这个包不对应任何一次发布。`);
      process.exit(1);
    }
    if (tagSha !== head) {
      const ahead = git(`git log --oneline ${tag}..HEAD`);
      console.error(`✗ 包内版本是 ${zipVersion}，但 HEAD 不在 ${tag} 上。${tag} 之后还有：`);
      for (const l of ahead.split('\n').filter(Boolean)) console.error('    ' + l);
      console.error('  传上去的话，商店的 ' + zipVersion + ' 与已发布的 ' + zipVersion + ' 会是两份不同的内容，');
      console.error('  而两边都自称同一个版本号，事后无法分辨用户装的是哪一份。');
      console.error(`  要么发一个新版本，要么 git checkout ${tag} 后重新 build。`);
      console.error('  确实要传这个包：加 --allow-dirty。');
      process.exit(1);
    }
    if (dirty) {
      console.error('✗ 出货相关目录有未提交改动：');
      for (const l of dirty.split('\n').filter(Boolean)) console.error('    ' + l);
      console.error('  确实要传：加 --allow-dirty。');
      process.exit(1);
    }
    console.log(`✓ 包内版本 ${zipVersion} 与 tag ${tag} 一致，工作树干净`);
  }

  const up = await api(token, 'PUT',
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${itemId}`,
    zipBytes, { 'Content-Type': 'application/zip' });
  if (!up.ok || (up.d && up.d.uploadState === 'FAILURE')) {
    console.error(`✗ 上传失败 HTTP ${up.status}`);
    const errs = (up.d && up.d.itemError) || [];
    for (const e of errs) console.error('  ' + brief(e.error_detail || JSON.stringify(e)));
    if (!errs.length) console.error('  ' + brief(up.text));
    process.exit(1);
  }
  console.log(`✓ 上传完成，uploadState=${up.d.uploadState}`);

  if (!want.publish) {
    console.log('\n草稿已就位，**未提审**。确认无误后：');
    console.log('  node scripts/cws-publish.js --upload --publish');
    return;
  }

  // ── 提审 ────────────────────────────────────────────────────────────────
  const pub = await api(token, 'POST',
    `https://www.googleapis.com/chromewebstore/v1.1/items/${itemId}/publish`,
    '', { 'Content-Length': '0' });
  if (!pub.ok) {
    console.error(`✗ 提审失败 HTTP ${pub.status}: ${brief(pub.text)}`);
    process.exit(1);
  }
  console.log(`✓ 已提交：status=${JSON.stringify(pub.d.status)}`);
  for (const d of (pub.d.statusDetail || [])) console.log('  ' + d);
  console.log('\n⚠️ API 只能告诉你「提交成功」，**分不出排队中 / 已上线 / 被拒** —— '
    + '那要进开发者后台看。这一点已记在 gbrain 的发布状态页。');
})().catch((e) => { console.error('✗ ' + ((e && e.stack) || e)); process.exit(1); });
