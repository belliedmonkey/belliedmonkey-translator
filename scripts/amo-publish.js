#!/usr/bin/env node
// scripts/amo-publish.js — 用 AMO（addons.mozilla.org）API 传包 / 建版本。
//
// 用法：
//   node scripts/amo-publish.js --check             # 只体检：凭证、附加组件状态，不动任何东西
//   node scripts/amo-publish.js --upload            # 传 xpi 并等校验，**不**建版本
//   node scripts/amo-publish.js --upload --publish  # 传 + 建版本（对外动作，需显式加旗标）
//
// 与 cws-publish.js 同一套分档：默认什么都不做，提交是对外动作，不该是副作用。
//
// 凭证从 .local/keys.md 读（gitignored）：amo_jwt_issuer / amo_jwt_secret / amo_addon_id
// 取凭证：https://addons.mozilla.org/developers/addon/api/key/
//
// ── 与 CWS 的鉴权差异 ──────────────────────────────────────────────────────
// AMO 不走 OAuth：拿一对长期的 issuer + secret，**每次请求自己签一个短命 JWT**
// （HS256，官方要求 5 分钟内过期）。没有同意屏幕、没有回调地址、没有 refresh token
// 七天过期那一套。代价是 secret 是长期凭证，泄露了要去后台撤销。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { assertVersionIntegrity, versionInZip } = require('./lib/release-gate.js');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const XPI = path.join(ROOT, 'belliedmonkeytranslator-firefox.xpi');
const API = 'https://addons.mozilla.org/api/v5';

function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  // `[^\S\n]*` 而不是 `\s*`：`\s` 含换行，空槽位会跨行吃到下一行的字段名，
  // 把「缺凭证」伪装成「凭证错误」。同 cws-publish.js 那处的疤。
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

const brief = (t) => String(t).replace(/\s+/g, ' ').slice(0, 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// AMO 要的 JWT：HS256，payload 只有 iss / jti / iat / exp，且 exp 必须很近。
function jwt() {
  const iss = slot('amo_jwt_issuer');
  const secret = slot('amo_jwt_secret');
  const missing = ['amo_jwt_issuer', 'amo_jwt_secret'].filter((n) => !slot(n));
  if (missing.length) {
    console.error('✗ .local/keys.md 缺：' + missing.join(', '));
    console.error('  取凭证：https://addons.mozilla.org/developers/addon/api/key/');
    console.error('  用**拥有该附加组件的那个 Firefox 账号**登录。secret 只显示一次。');
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  // 官方要求 exp - iat <= 5 分钟。给 4 分钟，留出时钟偏差的余量。
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ iss, jti: crypto.randomBytes(8).toString('hex'), iat: now, exp: now + 240 });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function api(method, url, body, headers) {
  const r = await fetch(url, {
    method,
    headers: Object.assign({ Authorization: 'JWT ' + jwt() }, headers || {}),
    body,
  });
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
    console.log('用法: node scripts/amo-publish.js --check | --upload [--publish]');
    console.log('  --check   只体检，不动任何东西');
    console.log('  --upload  传 xpi 并等 AMO 校验完成（不建版本）');
    console.log('  --publish 建版本（对外动作，必须与 --upload 一起显式给出）');
    process.exit(1);
  }

  const addonId = slot('amo_addon_id');
  if (!addonId) { console.error('✗ .local/keys.md 缺 amo_addon_id'); process.exit(1); }

  // ── 体检 ────────────────────────────────────────────────────────────────
  const info = await api('GET', `${API}/addons/addon/${encodeURIComponent(addonId)}/`);
  if (!info.ok) {
    console.error(`✗ 读附加组件失败 HTTP ${info.status}: ${brief(info.text)}`);
    if (info.status === 401) {
      console.error('  401 = 签名不被接受：issuer/secret 抄错了，或这个账号不是该附加组件的所有者。');
    }
    process.exit(1);
  }
  console.log('✓ 凭证可用');
  console.log(`  ${addonId}`);
  console.log(`  状态: ${info.d.status}   线上版本: ${(info.d.current_version || {}).version || '?'}`);
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  console.log(`  本地 package.json: ${pkgVersion}`);

  if (!want.upload) { console.log('\n（--check 到此为止，什么都没动）'); return; }

  // ── 版本完整性：同一个版本号必须对应同一份内容 ────────────────────────────
  //
  // 与 CWS 同一条硬拦，实现在 lib/release-gate.js（三条发布路共用一份）。
  if (!fs.existsSync(XPI)) {
    console.error(`✗ 找不到 ${XPI} —— 先跑 node build.js firefox`);
    process.exit(1);
  }
  const xpiVersion = versionInZip(XPI);
  console.log(`\n准备上传 ${(fs.statSync(XPI).size / 1024).toFixed(0)} KB，包内版本 ${xpiVersion || '?'}`);
  // `--tag` 与 gh-release 对齐：让「从某个 tag 重出正确产物」在这两条路上也是**被验证过的**
  // 操作，而不是只能 --allow-dirty 绕过去。三条路共用一道门禁的意义，就是三条路都能走完
  // 同一套恢复流程 —— 少一个入口，那条路上的人就只剩绕过去这一个选择。
  assertVersionIntegrity({ version: xpiVersion, what: '这个包', allowDirty: argv.includes('--allow-dirty'), tag: (argv[argv.indexOf('--tag') + 1] && argv.includes('--tag')) ? argv[argv.indexOf('--tag') + 1] : undefined });

  // ── 上传 ────────────────────────────────────────────────────────────────
  const fd = new FormData();
  fd.append('upload', new Blob([fs.readFileSync(XPI)]), path.basename(XPI));
  fd.append('channel', 'listed');
  const up = await api('POST', `${API}/addons/upload/`, fd);
  if (!up.ok) { console.error(`✗ 上传失败 HTTP ${up.status}: ${brief(up.text)}`); process.exit(1); }
  const uuid = up.d.uuid;
  console.log(`✓ 已上传，uuid=${uuid}，等待 AMO 校验…`);

  // AMO 是异步校验：传完不等于通过。轮询到 processed，再看 valid。
  let val = null;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const st = await api('GET', `${API}/addons/upload/${uuid}/`);
    if (!st.ok) { console.error(`✗ 查校验状态失败 HTTP ${st.status}: ${brief(st.text)}`); process.exit(1); }
    if (st.d.processed) { val = st.d; break; }
    if (i % 5 === 4) console.log(`  …仍在校验（${(i + 1) * 3} 秒）`);
  }
  if (!val) { console.error('✗ 3 分钟内没有校验完成'); process.exit(1); }

  const v = val.validation || {};
  console.log(`校验完成：valid=${val.valid}  错误 ${v.errors ?? '?'}  警告 ${v.warnings ?? '?'}`);
  for (const m of (v.messages || []).slice(0, 12)) {
    if (m.type === 'error' || m.type === 'warning') {
      console.log(`  [${m.type}] ${brief(m.message)}${m.description ? ' — ' + brief(String(m.description)) : ''}`);
    }
  }
  if (!val.valid) {
    console.error('\n✗ 校验没过，不会建版本。上面的 error 行就是原因。');
    process.exit(1);
  }

  if (!want.publish) {
    console.log('\n校验通过，**未建版本**。确认无误后：');
    console.log('  node scripts/amo-publish.js --upload --publish');
    return;
  }

  // ── 建版本（= 提交审核）────────────────────────────────────────────────
  const created = await api('POST', `${API}/addons/addon/${encodeURIComponent(addonId)}/versions/`,
    JSON.stringify({ upload: uuid }), { 'Content-Type': 'application/json' });
  if (!created.ok) {
    console.error(`✗ 建版本失败 HTTP ${created.status}: ${brief(created.text)}`);
    // AMO 常见的两种：版本号重复、需要附源码。两种都要把原话给用户看。
    process.exit(1);
  }
  console.log(`✓ 版本已创建：${created.d.version}`);
  console.log('  审核状态可用 --check 复查（AMO 与 CWS 不同，这边 API 读得出审核结果）。');
})().catch((e) => { console.error('✗ ' + ((e && e.stack) || e)); process.exit(1); });
