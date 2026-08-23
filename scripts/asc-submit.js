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

// 撤审。**排队位置会清零**（中国版上次首提排了 40 天），所以只对明确点名的
// bundle id 生效 —— 不接受「撤全部」，那种批量操作在这里只会是误操作。
async function cancelReview(version, bundleIds, apply) {
  const apps = (await api('GET', '/apps?limit=200')).data.filter((a) => bundleIds.includes(a.attributes.bundleId));
  if (apps.length !== bundleIds.length) throw new Error('有 bundle id 找不到对应 app');
  for (const app of apps) {
    const subs = (await api('GET', `/apps/${app.id}/reviewSubmissions?limit=25`
      + '&fields[reviewSubmissions]=state,platform,submittedDate')).data
      .filter((r) => ['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(r.attributes.state));
    for (const sub of subs) {
      const items = await api('GET', `/reviewSubmissions/${sub.id}/items?limit=10&include=appStoreVersion`);
      const vers = (items.included || []).filter((x) => x.type === 'appStoreVersions'
        && x.attributes.versionString === version);
      if (!vers.length) { console.log(`  跳过 ${app.attributes.name} [${sub.attributes.platform}]：不含 ${version}`); continue; }
      console.log(`  ${apply ? '撤回' : '将撤回'} ${app.attributes.name} [${sub.attributes.platform}] ${version}`
        + `  (${sub.attributes.state}, 提交于 ${String(sub.attributes.submittedDate).slice(0, 16)})`);
      if (!apply) continue;
      await api('PATCH', `/reviewSubmissions/${sub.id}`, {
        data: { type: 'reviewSubmissions', id: sub.id, attributes: { canceled: true } },
      });
      const back = await api('GET', `/reviewSubmissions/${sub.id}?fields[reviewSubmissions]=state`);
      console.log(`    → ${back.data.attributes.state}`);
    }
  }
}

(async () => {
  const argv = process.argv.slice(2);
  const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));
  const apply = argv.includes('--apply');
  const cancelIdx = argv.indexOf('--cancel');
  if (cancelIdx >= 0) {
    const ids = argv.slice(cancelIdx + 1).filter((a) => a.startsWith('com.'));
    if (!version || !ids.length) {
      console.log('用法: node scripts/asc-submit.js <版本号> --cancel <bundleId> [<bundleId>…] [--apply]');
      process.exit(1);
    }
    console.log(apply ? '\x1b[1m模式：真的撤审（排队位置会清零）\x1b[0m' : '模式：只打印计划');
    await cancelReview(version, ids, apply);
    if (!apply) console.log('\n（只是计划。确认无误后加 --apply）');
    return;
  }
  if (!version) {
    console.log('用法: node scripts/asc-submit.js <版本号> [--only <bundleId>]… [--apply]');
    process.exit(1);
  }
  console.log(apply ? '\x1b[1m模式：真的提交审核（不可逆）\x1b[0m' : '模式：只打印计划（加 --apply 才提交）');

  // `--only <bundleId>`（可重复）：只提点名的那条线。默认是全提 —— 而「全提」在发布
  // 途中是危险的默认值：本轮国际版 iOS 已就绪、中国版两个包却正要重出，一次 --apply
  // 会把还要重传的包一起送进审核，而撤审的代价是排队位置清零。
  const only = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--only' && argv[i + 1]) only.push(argv[i + 1]);
  const apps = (await api('GET', '/apps?limit=200')).data
    .filter((a) => a.attributes.bundleId.startsWith('com.belliedmonkeytranslator'))
    .filter((a) => !only.length || only.includes(a.attributes.bundleId));
  if (only.length && !apps.length) throw new Error(`--only 点名的 bundle id 一个都没匹配上: ${only.join(', ')}`);

  const targets = [];
  for (const app of apps) {
    const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=10`
      + '&fields[appStoreVersions]=versionString,appStoreState,platform');
    for (const v of vs.data.filter((x) => x.attributes.versionString === version)) {
      const plat = v.attributes.platform;
      const label = `${app.attributes.name} [${plat}] ${version}`;

      // 可提交的两种状态：还没提交过，或开发者自己撤回过。
      // DEVELOPER_REJECTED 是**撤审后 Apple 给的状态**，不是「被审核拒了」——
      // 撤审重提正是要从这里走回去。在审中的一律跳过（不去动别人的排队）。
      const SUBMITTABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];
      if (!SUBMITTABLE.includes(v.attributes.appStoreState)) {
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
