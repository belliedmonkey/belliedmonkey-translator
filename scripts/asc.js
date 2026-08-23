#!/usr/bin/env node
// scripts/asc.js — App Store Connect API 的最小命令行。
//
// 用法：
//   node scripts/asc.js builds                 # 四条线各自最近的 build 和处理状态
//   node scripts/asc.js versions               # 四条线的版本记录和审核状态
//   node scripts/asc.js bind <bundleId> <IOS|MAC_OS> <版本号> <build号>
//                                              # 把某个 build 挂到某个版本（对外动作）
//   例：node scripts/asc.js bind com.belliedmonkeytranslator IOS 1.6.4 43
//
// 为什么走 API 不走网页（`asc-api-beats-browser`）：ASC 的网页端按钮多是 hover 才挂
// 事件，JS 点不动，AX 也点不稳。API 这边一次请求就是一个确定的结果。
//
// 凭证从 .local/keys.md 读（gitignored）：ascIssuerId / ascKeyId / ascKeyPath
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const API = 'https://api.appstoreconnect.apple.com/v1';

function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  // `[^\S\n]*` 而不是 `\s*`：`\s` 含换行，空槽位会跨行吃到下一行的字段名，
  // 把「缺凭证」伪装成「凭证错误」。同 cws-publish.js / amo-publish.js 那处的疤。
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

// ASC 的 JWT：ES256，payload 带 aud，exp 官方上限 20 分钟。
function jwt() {
  const missing = ['ascIssuerId', 'ascKeyId', 'ascKeyPath'].filter((n) => !slot(n));
  if (missing.length) {
    console.error('✗ .local/keys.md 缺：' + missing.join(', '));
    process.exit(1);
  }
  const keyPath = slot('ascKeyPath').replace(/^~/, process.env.HOME);
  if (!fs.existsSync(keyPath)) {
    console.error(`✗ 私钥文件不存在：${keyPath}`);
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: slot('ascKeyId'), typ: 'JWT' });
  const body = b64({ iss: slot('ascIssuerId'), iat: now, exp: now + 900,
    aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`),
    { key: fs.readFileSync(keyPath), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

async function api(method, url, body) {
  const r = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + jwt() },
      body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let d = null;
  try { d = JSON.parse(text); } catch (_) { /* 非 JSON 也要留住原文 */ }
  if (!r.ok) {
    const detail = d && d.errors ? d.errors.map((e) => `${e.title}: ${e.detail}`).join('; ')
      : String(text).slice(0, 300);
    throw new Error(`HTTP ${r.status} ${method} ${url} — ${detail}`);
  }
  return d;
}

async function apps() {
  const d = await api('GET', '/apps?limit=200');
  return d.data.map((a) => ({ id: a.id, name: a.attributes.name,
    bundleId: a.attributes.bundleId }));
}

async function cmdBuilds() {
  for (const app of await apps()) {
    console.log(`\n■ ${app.name}  (${app.bundleId})`);
    // 必须按平台分开问。ASC 把 iOS 和 macOS 的 build 放在同一个 app 下，而 build 号
    // 是各平台独立自增的 —— 一次混着查再取前 N 条，会被号大的那个平台整个挤掉
    // （global 的 iOS 43 会盖住 macOS 24）。
    for (const plat of ['IOS', 'MAC_OS']) {
      const d = await api('GET',
        `/builds?filter[app]=${app.id}&filter[preReleaseVersion.platform]=${plat}`
        + '&limit=3&sort=-uploadedDate'
        + '&fields[builds]=version,processingState,uploadedDate,expired');
      if (!d.data.length) { console.log(`  ${plat}: （没有 build）`); continue; }
      for (const b of d.data) {
        const a = b.attributes;
        const flag = a.processingState === 'VALID' ? '✓'
          : a.processingState === 'PROCESSING' ? '…' : '✗';
        console.log(`  ${flag} ${plat.padEnd(6)} build ${String(a.version).padEnd(4)} ${a.processingState}`
          + `${a.expired ? ' (已过期)' : ''}  ${(a.uploadedDate || '').slice(0, 16).replace('T', ' ')}`);
      }
    }
  }
}

async function cmdVersions() {
  for (const app of await apps()) {
    console.log(`\n■ ${app.name}  (${app.bundleId})`);
    const d = await api('GET',
      `/apps/${app.id}/appStoreVersions?limit=30`
      + '&fields[appStoreVersions]=versionString,appStoreState,platform,createdDate');
    if (!d.data.length) { console.log('  （没有版本记录）'); continue; }
    for (const v of d.data) {
      const a = v.attributes;
      // 必须逐个问关系端点。`include=build` 在这里**不报错也不返回**关系数据 ——
      // 每个版本都显示成「未挂」，包括已上架的那些。一个静默的错误答案。
      const bd = await api('GET', `/appStoreVersions/${v.id}/build?fields[builds]=version`);
      console.log(`  ${a.versionString}  [${a.platform}]  ${a.appStoreState}`
        + `  build=${bd.data ? bd.data.attributes.version : '未挂'}`);
    }
  }
}

// 把一个 build 挂到某个版本记录上。
//
// build 号**必须显式给出**,不接受「取最新那个」——那种写法在两个平台共用一个 app、
// build 号各自独立自增时，会安静地挂上另一个平台的包（iOS 43 vs macOS 24 差 19 个号，
// 排序取首条就选错了，而 ASC 不会拦你）。
async function cmdBind(bundleId, platform, versionString, buildNumber) {
  const app = (await apps()).find((a) => a.bundleId === bundleId);
  if (!app) throw new Error(`找不到 app ${bundleId}`);

  const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=20`
    + '&fields[appStoreVersions]=versionString,appStoreState,platform');
  const v = vs.data.find((x) => x.attributes.versionString === versionString
    && x.attributes.platform === platform);
  if (!v) throw new Error(`${app.name} 没有 ${platform} 的 ${versionString} 版本记录`);
  if (v.attributes.appStoreState !== 'PREPARE_FOR_SUBMISSION') {
    throw new Error(`${app.name} ${platform} ${versionString} 状态是 `
      + `${v.attributes.appStoreState}，不是 PREPARE_FOR_SUBMISSION —— 不动它`);
  }

  const bs = await api('GET', `/builds?filter[app]=${app.id}`
    + `&filter[preReleaseVersion.platform]=${platform}&filter[version]=${buildNumber}`
    + '&fields[builds]=version,processingState');
  const b = bs.data[0];
  if (!b) throw new Error(`${app.name} ${platform} 没有 build ${buildNumber}`);
  if (b.attributes.processingState !== 'VALID') {
    throw new Error(`build ${buildNumber} 状态是 ${b.attributes.processingState}，不是 VALID`);
  }

  const before = await api('GET', `/appStoreVersions/${v.id}/build?fields[builds]=version`);
  await api('PATCH', `/appStoreVersions/${v.id}/relationships/build`,
    { data: { type: 'builds', id: b.id } });
  // 回读。PATCH 返回 204 无正文，「成功」只能靠再问一次确认 —— 不读回来就只是「没报错」。
  const after = await api('GET', `/appStoreVersions/${v.id}/build?fields[builds]=version`);
  const got = after.data ? after.data.attributes.version : null;
  console.log(`  ${app.name} [${platform}] ${versionString}: `
    + `${before.data ? before.data.attributes.version : '未挂'} → ${got}`
    + (String(got) === String(buildNumber) ? '  ✓' : '  ✗ 回读不符！'));
  return String(got) === String(buildNumber);
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'builds') return cmdBuilds();
  if (cmd === 'versions') return cmdVersions();
  if (cmd === 'bind') {
    const [bundleId, platform, versionString, buildNumber] = rest;
    if (!bundleId || !platform || !versionString || !buildNumber) {
      console.log('用法: node scripts/asc.js bind <bundleId> <IOS|MAC_OS> <版本号> <build号>');
      process.exit(1);
    }
    const ok = await cmdBind(bundleId, platform, versionString, buildNumber);
    process.exit(ok ? 0 : 1);
  }
  console.log('用法: node scripts/asc.js builds | versions | bind <bundleId> <平台> <版本> <build>');
  process.exit(1);
})().catch((e) => { console.error('✗ ' + ((e && e.message) || e)); process.exit(1); });
