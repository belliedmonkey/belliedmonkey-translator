#!/usr/bin/env node
// scripts/asc-submit.js — 把已经准备好的版本提交 App Store 审核。
//
// 用法：
//   node scripts/asc-submit.js <版本号>            # 只打印计划，什么都不动（默认）
//   node scripts/asc-submit.js <版本号> --apply    # 真的提交（**不可逆的对外动作**）
//
// 提审是 reviewSubmissions 三步，缺任何一步都得到一个「看起来建好了、其实没提交」的
// 空壳：
//   ① POST /reviewSubmissions        {platform} + app         → 建一次提交
//   ② POST /reviewSubmissionItems    + appStoreVersion        → 把版本挂进去
//   ③ PATCH /reviewSubmissions/{id}  {submitted:true}         → 真正递出去
// 只做①② 的话，ASC 网页上能看到一个待提交的草稿，而 Apple 那边什么都没收到。
//
// 提交之前这里会硬拦四件事，每一件都在这个项目里真的发生过：
//   · 版本状态必须是 PREPARE_FOR_SUBMISSION（别去动已上架/在审的）
//   · 必须挂了 build（#161 之前 asc.js 的 include=build 会把「未挂」误报成已挂）
//   · build 必须 VALID
//   · 主语言必须有截图（旧素材事故：商店页展示未完成状态、真实邮箱）
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const API = 'https://api.appstoreconnect.apple.com/v1';

function slot(name) {
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: slot('ascKeyId'), typ: 'JWT' });
  const body = b64({ iss: slot('ascIssuerId'), iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const key = fs.readFileSync(slot('ascKeyPath').replace(/^~/, process.env.HOME));
  return `${head}.${body}.`
    + crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
async function api(method, url, body) {
  const r = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + jwt() }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const text = await r.text();
  let d = null;
  try { d = JSON.parse(text); } catch (_) { /* 非 JSON 也要留住原文 */ }
  if (!r.ok) {
    const detail = d && d.errors ? d.errors.map((e) => `${e.title}: ${e.detail}`).join('; ') : String(text).slice(0, 500);
    throw new Error(`HTTP ${r.status} ${method} ${url} — ${detail}`);
  }
  return d;
}

(async () => {
  const argv = process.argv.slice(2);
  const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));
  const apply = argv.includes('--apply');
  if (!version) {
    console.log('用法: node scripts/asc-submit.js <版本号> [--apply]');
    process.exit(1);
  }
  console.log(apply ? '\x1b[1m模式：真的提交审核（不可逆）\x1b[0m' : '模式：只打印计划（加 --apply 才提交）');

  const apps = (await api('GET', '/apps?limit=200')).data
    .filter((a) => a.attributes.bundleId.startsWith('com.belliedmonkeytranslator'));

  const targets = [];
  for (const app of apps) {
    const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=10`
      + '&fields[appStoreVersions]=versionString,appStoreState,platform');
    for (const v of vs.data.filter((x) => x.attributes.versionString === version)) {
      const plat = v.attributes.platform;
      const label = `${app.attributes.name} [${plat}] ${version}`;

      if (v.attributes.appStoreState !== 'PREPARE_FOR_SUBMISSION') {
        console.log(`  跳过 ${label}: 状态 ${v.attributes.appStoreState}`);
        continue;
      }
      const b = await api('GET', `/appStoreVersions/${v.id}/build?fields[builds]=version,processingState`);
      if (!b.data) throw new Error(`${label}: 没有挂 build`);
      if (b.data.attributes.processingState !== 'VALID') {
        throw new Error(`${label}: build ${b.data.attributes.version} 状态 ${b.data.attributes.processingState}`);
      }
      const locs = await api('GET', `/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=25`
        + '&fields[appStoreVersionLocalizations]=locale');
      let shots = 0;
      for (const L of locs.data) {
        const sets = await api('GET', `/appStoreVersionLocalizations/${L.id}/appScreenshotSets?limit=20`);
        for (const s of sets.data) {
          const imgs = await api('GET', `/appScreenshotSets/${s.id}/appScreenshots?limit=20&fields[appScreenshots]=fileName`);
          shots += imgs.data.length;
        }
      }
      if (!shots) throw new Error(`${label}: 一张截图都没有`);

      // 「本次更新内容」为空 ⇒ Apple 在 ② 那一步报「appStoreVersions … is not in valid
      // state」，**完全不提是哪一项缺了**。2026-08-22 四条线全卡在这里，靠逐项对比
      // 本地化字段才找出来。所以这条必须在本地先拦。
      const noNotes = [];
      for (const L of locs.data) {
        const full = await api('GET', `/appStoreVersionLocalizations/${L.id}`
          + '?fields[appStoreVersionLocalizations]=locale,whatsNew');
        if (!String(full.data.attributes.whatsNew || '').trim()) noNotes.push(L.attributes.locale);
      }
      if (noNotes.length) throw new Error(`${label}: 这些本地化没有「本次更新内容」：${noNotes.join(', ')}`);

      console.log(`  ${label} · build ${b.data.attributes.version} · 截图 ${shots} 张`);
      targets.push({ appId: app.id, versionId: v.id, platform: plat, label });
    }
  }

  if (!apply) { console.log(`\n共 ${targets.length} 条线待提交。确认无误后加 --apply`); return; }

  for (const t of targets) {
    // ① 建提交 —— 但先找有没有现成的空壳可以复用。
    //
    // reviewSubmissions **不允许 DELETE**（只有 CREATE/GET/UPDATE）。所以一旦②失败，
    // 那个 READY_FOR_REVIEW 的空提交就永久留在账号里；再跑一次又新建一个，越堆越多。
    const open = (await api('GET', `/apps/${t.appId}/reviewSubmissions?limit=20`
      + '&fields[reviewSubmissions]=state,platform')).data
      .filter((r) => r.attributes.platform === t.platform && r.attributes.state === 'READY_FOR_REVIEW');
    let sub = null;
    for (const cand of open) {
      const items = await api('GET', `/reviewSubmissions/${cand.id}/items?limit=5`);
      if (!items.data.length) { sub = cand; console.log(`    （复用空提交 ${cand.id.slice(0, 8)}）`); break; }
    }
    if (!sub) {
      sub = (await api('POST', '/reviewSubmissions', {
        data: { type: 'reviewSubmissions', attributes: { platform: t.platform },
          relationships: { app: { data: { type: 'apps', id: t.appId } } } },
      })).data;
    }
    // ② 挂版本
    await api('POST', '/reviewSubmissionItems', {
      data: { type: 'reviewSubmissionItems',
        relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: t.versionId } } } },
    });
    // ③ 递出去
    await api('PATCH', `/reviewSubmissions/${sub.id}`, {
      data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } },
    });
    // 回读。PATCH 成功不等于状态到位 —— 同 asc.js bind 那条规矩。
    const back = await api('GET', `/reviewSubmissions/${sub.id}?fields[reviewSubmissions]=state,submittedDate`);
    console.log(`  ✓ ${t.label} → ${back.data.attributes.state}`);
  }
})().catch((e) => { console.error('\n✗ ' + ((e && e.message) || e)); process.exit(1); });
