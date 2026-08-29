#!/usr/bin/env node
// scripts/asc.js — App Store Connect API 的最小命令行。
//
// 用法：
//   node scripts/asc.js builds                 # 四条线各自最近的 build 和处理状态
//   node scripts/asc.js versions               # 四条线的版本记录和审核状态
//   node scripts/asc.js reviews [条数]         # App Store 用户评论（默认 20 条）
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

// 建一条新的 App Store 版本记录。`bind` 只会挂 build，不会建版本 —— 这一步以前是在
// ASC 网页上手点的，于是它既没有干运行也没有回读，而发版流程里其余每一步都有。
//
// 幂等：同 (app, platform, versionString) 已存在就直接返回它，不重复建。ASC 允许同一个
// 平台只有一条未发布版本，重复 POST 会拿到一个语焉不详的 409。
async function cmdNewVersion(bundleId, platform, versionString, apply) {
  const app = (await apps()).find((a) => a.bundleId === bundleId);
  if (!app) throw new Error(`找不到 app ${bundleId}`);

  const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=30`
    + `&filter[platform]=${platform}`
    + '&fields[appStoreVersions]=versionString,appStoreState,platform');
  const exist = vs.data.find((x) => x.attributes.versionString === versionString);
  if (exist) {
    console.log(`  ${app.name} [${platform}] ${versionString} 已存在 · `
      + `${exist.attributes.appStoreState}  ✓（不重复建）`);
    return true;
  }
  // 同平台已有一条在途版本时，ASC 不允许再建一条。先说清楚是哪一条，而不是让 POST
  // 抛一个看不懂的 409。
  const busy = vs.data.find((x) => x.attributes.appStoreState !== 'READY_FOR_SALE'
    && x.attributes.appStoreState !== 'REPLACED_WITH_NEW_VERSION');
  if (busy) {
    throw new Error(`${app.name} [${platform}] 已有在途版本 `
      + `${busy.attributes.versionString}（${busy.attributes.appStoreState}）—— `
      + '同平台同时只能有一条。先让它上架或撤审，再建 ' + versionString);
  }
  if (!apply) {
    console.log(`  ${app.name} [${platform}] 将新建版本 ${versionString}（干运行）`);
    return true;
  }
  await api('POST', '/appStoreVersions', { data: {
    type: 'appStoreVersions',
    attributes: { platform, versionString },
    relationships: { app: { data: { type: 'apps', id: app.id } } },
  } });
  // 回读。POST 的返回体不算数 —— 判据是「再问一次，它在那里」。
  const after = await api('GET', `/apps/${app.id}/appStoreVersions?limit=30`
    + `&filter[platform]=${platform}`
    + '&fields[appStoreVersions]=versionString,appStoreState,platform');
  const got = after.data.find((x) => x.attributes.versionString === versionString);
  console.log(`  ${app.name} [${platform}] ${versionString}: `
    + (got ? `已建 · ${got.attributes.appStoreState}  ✓` : '✗ 回读不到，没建成'));
  return !!got;
}

// 把发布说明写进每个本地化的 whatsNew。
//
// 这一步以前没有工具 —— `asc-submit.js` 只**检查** whatsNew 是否为空，写是在 ASC 网页上
// 手点的。2026-08-22 四条线全部卡在提审，真因就是这六处一处都没填，而 Apple 报的是
// 「appStoreVersions is not in valid state」，不告诉你缺哪一项。一个只有检查、没有写入
// 的步骤，就是在等人忘记。
//
// 文案来源是 store-assets/release-notes-<版本>.md：按 `## <国际版|中国版> · <locale>`
// 取其后的第一个围栏块。flavor 由 bundleId 是否以 .cn 结尾决定 —— 两条线的文案必须不同
// （中国版没有 OpenAI Speech，「把语音下到本机」对它多数用户不成立）。
function parseNotes(md, flavor) {
  const out = {};
  const re = /^##\s+(国际版|中国版)\s*·\s*([A-Za-z-]+)\s*$/gm;
  let m;
  while ((m = re.exec(md))) {
    if (m[1] !== flavor) continue;
    const rest = md.slice(m.index + m[0].length);
    const f = rest.match(/```[a-z]*\n([\s\S]*?)```/);
    if (f) out[m[2]] = f[1].trim();
  }
  return out;
}

async function cmdNotes(bundleId, platform, versionString, file, apply) {
  const app = (await apps()).find((a) => a.bundleId === bundleId);
  if (!app) throw new Error(`找不到 app ${bundleId}`);
  const flavor = bundleId.endsWith('.cn') ? '中国版' : '国际版';
  const md = require('fs').readFileSync(file, 'utf8');
  const notes = parseNotes(md, flavor);
  if (!Object.keys(notes).length) throw new Error(`${file} 里没有「## ${flavor} · <locale>」段`);

  const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=30`
    + `&filter[platform]=${platform}`
    + '&fields[appStoreVersions]=versionString,appStoreState,platform');
  const v = vs.data.find((x) => x.attributes.versionString === versionString);
  if (!v) throw new Error(`${app.name} 没有 ${platform} 的 ${versionString} 版本记录`);

  const locs = await api('GET', `/appStoreVersions/${v.id}/appStoreVersionLocalizations`
    + '?limit=50&fields[appStoreVersionLocalizations]=locale,whatsNew');
  let ok = true;
  for (const L of locs.data) {
    const locale = L.attributes.locale;
    const text = notes[locale];
    if (!text) {
      console.log(`  ${app.name} [${platform}] ${locale}: ✗ 文案文件里没有这个 locale —— 提审会被挡`);
      ok = false;
      continue;
    }
    if (!apply) { console.log(`  ${app.name} [${platform}] ${locale}: 将写入 ${text.length} 字（干运行）`); continue; }
    await api('PATCH', `/appStoreVersionLocalizations/${L.id}`,
      { data: { type: 'appStoreVersionLocalizations', id: L.id, attributes: { whatsNew: text } } });
    // 回读。PATCH 返回 204 无正文，「没报错」不等于「写进去了」。
    const back = await api('GET', `/appStoreVersionLocalizations/${L.id}`
      + '?fields[appStoreVersionLocalizations]=locale,whatsNew');
    const got = String((back.data.attributes.whatsNew || '')).trim();
    const same = got === text.trim();
    console.log(`  ${app.name} [${platform}] ${locale}: ${got.length} 字 ${same ? '✓' : '✗ 回读不符！'}`);
    if (!same) ok = false;
  }
  return ok;
}

// 用户原话 —— 这个产品没有遥测，所以商店评论是极少数能听见真实用户的渠道之一。
// 2026-08-28 查那 40 个账号时才发现我们从没读过它：AMO 0 条评分，App Store 这边
// 一直没看。纯 JSON，复用同一个 api()，不需要 analyticsReports 那套三段式。
async function cmdReviews(limit) {
  for (const app of await apps()) {
    // 评论挂在 app 记录上（不分平台），四条线里两个 app 记录各读一次。
    const d = await api('GET', `/apps/${app.id}/customerReviews`
      + `?limit=${limit}&sort=-createdDate`
      + '&fields[customerReviews]=rating,title,body,reviewerNickname,createdDate,territory');
    const rows = (d && d.data) || [];
    console.log(`\n${app.name}  (${app.bundleId})  ${rows.length} 条`);
    if (!rows.length) { console.log('  （暂无评论）'); continue; }
    const avg = rows.reduce((a, r) => a + (r.attributes.rating || 0), 0) / rows.length;
    console.log(`  本页均分 ${avg.toFixed(1)}`);
    for (const r of rows) {
      const a = r.attributes;
      console.log(`  ${'★'.repeat(a.rating || 0).padEnd(5, '·')} ${(a.createdDate || '').slice(0, 10)}`
        + `  ${a.territory || '?'}  ${a.reviewerNickname || ''}`);
      if (a.title) console.log(`    ${a.title}`);
      if (a.body) console.log(`    ${String(a.body).replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
  return true;
}


// 真机直装要求 UDID 在开发者账号的设备列表里，否则签名阶段才失败 —— 那时报的是
// 「没有匹配的 provisioning profile」，看不出真正原因是设备没注册。所以先注册、再打包。
async function cmdDevices(udid, name) {
  if (!udid) {
    const d = await api('GET', '/devices?limit=200&fields[devices]=name,udid,deviceClass,status,platform');
    const rows = (d && d.data) || [];
    console.log(`共 ${rows.length} 台`);
    for (const r of rows) {
      const a = r.attributes;
      console.log(`  ${(a.status || '?').padEnd(8)} ${(a.deviceClass || '').padEnd(14)}`
        + ` ${a.udid}  ${a.name || ''}`);
    }
    return true;
  }
  // 已经在册就不要重复注册：ASC 对重复 UDID 返回 409，而那和「注册失败」长得一样。
  const cur = await api('GET', '/devices?limit=200&fields[devices]=name,udid,status');
  const hit = ((cur && cur.data) || []).find((r) => (r.attributes.udid || '').toLowerCase() === udid.toLowerCase());
  if (hit) {
    console.log(`✓ 已在册：${hit.attributes.udid}  ${hit.attributes.name}`
      + `  (${hit.attributes.status})`);
    return hit.attributes.status === 'ENABLED';
  }
  const r = await api('POST', '/devices', { data: { type: 'devices',
    attributes: { name: name || 'test device', udid, platform: 'IOS' } } });
  const a = (r && r.data && r.data.attributes) || {};
  if (!a.udid) { console.error('✗ 注册没有回读到 udid：' + JSON.stringify(r).slice(0, 300)); return false; }
  console.log(`✓ 已注册：${a.udid}  ${a.name}  (${a.status})`);
  return true;
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'devices') {
    const ok = await cmdDevices(rest[0], rest.slice(1).join(' '));
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'builds') return cmdBuilds();
  if (cmd === 'versions') return cmdVersions();
  if (cmd === 'reviews') {
    const n = Number(rest[0]) > 0 ? Math.min(Number(rest[0]), 200) : 20;
    const ok = await cmdReviews(n);
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'bind') {
    const [bundleId, platform, versionString, buildNumber] = rest;
    if (!bundleId || !platform || !versionString || !buildNumber) {
      console.log('用法: node scripts/asc.js bind <bundleId> <IOS|MAC_OS> <版本号> <build号>');
      process.exit(1);
    }
    const ok = await cmdBind(bundleId, platform, versionString, buildNumber);
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'newversion') {
    const [bundleId, platform, versionString] = rest;
    if (!bundleId || !platform || !versionString) {
      console.log('用法: node scripts/asc.js newversion <bundleId> <IOS|MAC_OS> <版本号> [--apply]');
      process.exit(1);
    }
    const ok = await cmdNewVersion(bundleId, platform, versionString, rest.includes('--apply'));
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'notes') {
    const [bundleId, platform, versionString, file] = rest;
    if (!bundleId || !platform || !versionString || !file) {
      console.log('用法: node scripts/asc.js notes <bundleId> <IOS|MAC_OS> <版本号> <文案md> [--apply]');
      process.exit(1);
    }
    const ok = await cmdNotes(bundleId, platform, versionString, file, rest.includes('--apply'));
    process.exit(ok ? 0 : 1);
  }
  console.log('用法: node scripts/asc.js builds | versions | reviews [条数]'
    + ' | devices [UDID [名称]]'
    + ' | newversion <bundleId> <平台> <版本> [--apply]'
    + ' | notes <bundleId> <平台> <版本> <文案md> [--apply]'
    + ' | bind <bundleId> <平台> <版本> <build>');
  process.exit(1);
})().catch((e) => { console.error('✗ ' + ((e && e.message) || e)); process.exit(1); });
