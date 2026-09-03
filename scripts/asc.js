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

// **可编辑 = 还没交出去。** 两个状态都算：
//   PREPARE_FOR_SUBMISSION —— 从来没提交过
//   DEVELOPER_REJECTED     —— **自己撤审后 Apple 给的状态**，不是「被审核拒了」
//
// 只认前者的代价 2026-09-03 当场付过：中国版为合规撤审之后，renameversion 拒绝动它，
// 于是「撤完就走不回去」—— 而撤审是不可逆的，排队位置已经清零了。asc-media.js 与
// asc-submit.js 早就认了两个，这个文件的四处没跟上。判据写在一处，别再抄第五份。
//
// 不在这里面的（READY_FOR_SALE / WAITING_FOR_REVIEW / IN_REVIEW）是**对外事实**，
// 改它等于篡改历史，所以仍然一律拒绝。
const EDITABLE_STATES = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];
const isEditable = (v) => EDITABLE_STATES.includes(v.attributes.appStoreState);

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
  if (!isEditable(v)) {
    throw new Error(`${app.name} ${platform} ${versionString} 状态是 `
      + `${v.attributes.appStoreState}，不可编辑（只动 ${EDITABLE_STATES.join(' / ')}）—— 不动它`);
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

// 给一条还没提审过的版本记录改版本号。ASC 每个平台同时只允许一条在途版本，所以当一个
// 从未发出去的草稿需要换号时，唯一的路是改它 —— newversion 会（正确地）拒绝新建。
//
// 1.6.8 就是这样：四条线的草稿都建好了、素材也传了，但它一次都没发出去，而 v1.6.8 这个
// tag 已经落在 29 个提交之前。改名比新建划算得多：截图、ASO 文案、审核联系方式全留在原地。
//
// 只动可编辑状态（见 EDITABLE_STATES）。已上架或在审的版本号是对外事实，改它等于篡改历史。
async function cmdRenameVersion(bundleId, platform, fromVersion, toVersion, apply) {
  const app = (await apps()).find((a) => a.bundleId === bundleId);
  if (!app) throw new Error(`找不到 app ${bundleId}`);
  const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=30`
    + `&filter[platform]=${platform}`
    + '&fields[appStoreVersions]=versionString,appStoreState,platform');
  if (vs.data.find((x) => x.attributes.versionString === toVersion)) {
    console.log(`  ${app.name} [${platform}] 已经是 ${toVersion} 了  ✓（不动）`);
    return true;
  }
  const v = vs.data.find((x) => x.attributes.versionString === fromVersion);
  if (!v) throw new Error(`${app.name} [${platform}] 没有 ${fromVersion} 的版本记录`);
  if (!isEditable(v)) {
    throw new Error(`${app.name} [${platform}] ${fromVersion} 状态是 `
      + `${v.attributes.appStoreState}，不可编辑（只动 ${EDITABLE_STATES.join(' / ')}）—— 不动它`);
  }
  if (!apply) {
    console.log(`  ${app.name} [${platform}] ${fromVersion} → ${toVersion}（干运行）`);
    return true;
  }
  await api('PATCH', `/appStoreVersions/${v.id}`, { data: {
    type: 'appStoreVersions', id: v.id, attributes: { versionString: toVersion },
  } });
  // 回读。同 bind：PATCH 返回 204 无正文，「没报错」不等于「改对了」。
  const after = await api('GET', `/appStoreVersions/${v.id}`
    + '?fields[appStoreVersions]=versionString,appStoreState');
  const got = after.data && after.data.attributes.versionString;
  console.log(`  ${app.name} [${platform}] ${fromVersion} → ${got}`
    + (got === toVersion ? '  ✓' : '  ✗ 回读不符！'));
  return got === toVersion;
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

// ─── ASO：商店文案（keywords / subtitle / description / promotionalText）────────
//
// 2026-08-30 之前，这个仓库的工具链**只写过 whatsNew**，从没碰过任何一个影响搜索的字段。
// 代价在实读时才看到：国际版 iOS 的 zh-Hans keywords 与 description **整份是英文**，
// 而 macOS 同一个 locale 是中文的 —— 中文用户在 App Store 搜「翻译」命中不到 iOS 那条，
// 而 iOS 是用户最多的一条线。它不报错、不被拒，只是安静地把一个市场的搜索量清零。
//
// 三条从 API 实测出来、决定了下面这些函数形状的事实：
//
//  ① **每个 app 有两条 appInfo**：一条 READY_FOR_SALE（线上快照，只读），一条
//     PREPARE_FOR_SUBMISSION（可编辑）。写到前者上 Apple 可能接受但不生效 ——
//     正是这个仓库最怕的「没报错但没发生」。所以 cmdAppInfo 按 state 选，命中数 ≠ 1 就抛。
//  ② **appInfo 不分平台**：name/subtitle 是 app 级的，iOS 与 macOS 共用一条。所以
//     cmdAppInfo 的签名里**没有 platform 参数** —— 有了就是在暗示一个不存在的自由度。
//  ③ keywords / description 随版本锁定，**提审后要等下一版**；promotionalText 不参与
//     搜索排序但**不需要过审、随时可改**，是上线后唯一还能动的文案位（--promo-only）。
function parseAso(md) {
  const out = {};
  const re = /^##\s+(国际版|中国版)\s*·\s*([A-Za-z-]+)\s*·\s*(\w+)\s*$/gm;
  let m;
  while ((m = re.exec(md))) {
    const rest = md.slice(m.index + m[0].length);
    const f = rest.match(/```[a-z]*\n([\s\S]*?)```/);
    if (!f) continue;
    const key = `${m[1]}·${m[2]}`;
    (out[key] || (out[key] = {}))[m[3]] = f[1].trim();
  }
  return out;
}

// 干运行 == 验证器。取现值、取目标值，相等打「一致」，不等才打「将写入」。
// 这样跑第二遍就是验证 —— 不需要第二个工具，也不需要人记得去验。cmdNotes 那版的
// 干运行只会说「将写入 N 字」，不比较，于是验证是一件要靠自觉的事。
function diffLine(label, field, cur, want) {
  const same = String(cur || '').trim() === String(want).trim();
  return { same, line: `  ${label} ${field.padEnd(16)}`
    + (same ? `一致，无需改动 (${[...String(want)].length} 字)`
            : `将写入 ${[...String(want)].length} 字（现 ${[...String(cur || '')].length} 字）`) };
}

const ASO_VERSION_FIELDS = ['keywords', 'description', 'promotionalText'];

async function cmdAso(bundleId, platform, versionString, file, apply, promoOnly) {
  const app = (await apps()).find((a) => a.bundleId === bundleId);
  if (!app) throw new Error(`找不到 app ${bundleId}`);
  const flavor = bundleId.endsWith('.cn') ? '中国版' : '国际版';
  const aso = parseAso(require('fs').readFileSync(file, 'utf8'));

  const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=30`
    + `&filter[platform]=${platform}`
    + '&fields[appStoreVersions]=versionString,appStoreState,platform');
  const v = vs.data.find((x) => x.attributes.versionString === versionString);
  if (!v) throw new Error(`${app.name} 没有 ${platform} 的 ${versionString} 版本记录`);
  // promotionalText 不需要过审，所以 --promo-only 这一档允许已上架的版本。
  // 其余字段随版本锁定，动已上架/在审的版本没有意义，硬拦（同 cmdBind 的门禁）。
  if (!promoOnly && !isEditable(v)) {
    throw new Error(`${app.name} ${platform} ${versionString} 状态是 `
      + `${v.attributes.appStoreState}，不是 PREPARE_FOR_SUBMISSION —— 不动它`
      + '（只改促销语请加 --promo-only）');
  }

  const fields = promoOnly ? ['promotionalText'] : ASO_VERSION_FIELDS;
  const locs = await api('GET', `/appStoreVersions/${v.id}/appStoreVersionLocalizations`
    + '?limit=50&fields[appStoreVersionLocalizations]=locale,keywords,description,promotionalText');
  let ok = true;
  for (const L of locs.data) {
    const locale = L.attributes.locale;
    // 方向是「以商店的 locale 列表为准去文件里找」，不是反过来 —— 反过来会让
    // 「商店有 zh-Hans、文件里忘了写」变成静默跳过，而那正是本轮要修的那类缺陷。
    const want = aso[`${flavor}·${locale}`];
    const label = `${app.name} [${platform}] ${locale}`;
    if (!want) {
      console.log(`  ${label}: ✗ ${file} 里没有「## ${flavor} · ${locale} · …」段`);
      ok = false;
      continue;
    }
    const patch = {};
    for (const f of fields) {
      if (want[f] === undefined) continue;
      const d = diffLine(label, f, L.attributes[f], want[f]);
      console.log(d.line);
      if (!d.same) patch[f] = want[f];
    }
    if (!apply || !Object.keys(patch).length) continue;
    await api('PATCH', `/appStoreVersionLocalizations/${L.id}`,
      { data: { type: 'appStoreVersionLocalizations', id: L.id, attributes: patch } });
    // 回读。PATCH 返回 204 无正文，「没报错」不等于「写进去了」。
    const back = await api('GET', `/appStoreVersionLocalizations/${L.id}`
      + '?fields[appStoreVersionLocalizations]=locale,keywords,description,promotionalText');
    for (const f of Object.keys(patch)) {
      const got = String(back.data.attributes[f] || '').trim();
      const same = got === String(patch[f]).trim();
      console.log(`  ${label} ${f.padEnd(16)}回读 ${[...got].length} 字 ${same ? '✓' : '✗ 不符！'}`);
      if (!same) ok = false;
    }
  }

  // ── 反向的一遍：文件里有、商店里还没有的 locale，建出来 ──────────────────
  //
  // 上面那一遍**故意**以商店的 locale 列表为准（见那里的注释）。但只有那一遍的话，
  // 「文件里新写了 ja，商店上还没有 ja」就是静默跳过 —— 与它要防的缺陷同一形状，
  // 只是方向相反。所以两个方向各跑一遍，谁都不许安静。
  //
  // promotionalText 那一档不建 locale：它允许动已上架的版本，而在一个已上架版本上
  // 凭空加一门语言不是「改促销语」该做的事。
  if (!promoOnly) {
    const have = new Set(locs.data.map((L) => L.attributes.locale));
    const missing = Object.keys(aso)
      .filter((k) => k.startsWith(flavor + '·'))
      .map((k) => k.slice(flavor.length + 1))
      .filter((loc) => !have.has(loc));
    for (const locale of missing) {
      const want = aso[`${flavor}·${locale}`];
      const label = `${app.name} [${platform}] ${locale}`;
      const attrs = { locale };
      for (const f of ASO_VERSION_FIELDS) if (want[f] !== undefined) attrs[f] = want[f];
      if (attrs.description === undefined) {
        console.log(`  ${label}: ✗ 新 locale 缺 description —— Apple 不接受空描述`);
        ok = false;
        continue;
      }
      if (!apply) { console.log(`  ${label}: 将**新建**（${Object.keys(attrs).filter((k) => k !== 'locale').join(', ')}）`); continue; }
      const made = await api('POST', '/appStoreVersionLocalizations', { data: {
        type: 'appStoreVersionLocalizations',
        attributes: attrs,
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } },
      } });
      // 回读。POST 返回 201 带 body，但那是**请求的回声**；再 GET 一次才是商店的状态。
      const back = await api('GET', `/appStoreVersionLocalizations/${made.data.id}`
        + '?fields[appStoreVersionLocalizations]=locale,keywords,description,promotionalText');
      let good = true;
      for (const f of Object.keys(attrs)) {
        if (String(back.data.attributes[f] || '').trim() !== String(attrs[f]).trim()) good = false;
      }
      console.log(`  ${label}: 已新建 ${good ? '✓ 回读一致' : '✗ 回读不符！'}`);
      if (!good) ok = false;
    }
  }
  return ok;
}

// app 级字段。**无 platform 参数**，见上面 ②。
async function cmdAppInfo(bundleId, file, apply) {
  const app = (await apps()).find((a) => a.bundleId === bundleId);
  if (!app) throw new Error(`找不到 app ${bundleId}`);
  const flavor = bundleId.endsWith('.cn') ? '中国版' : '国际版';
  const aso = parseAso(require('fs').readFileSync(file, 'utf8'));

  const infos = await api('GET', `/apps/${app.id}/appInfos?limit=10`
    + '&fields[appInfos]=appStoreState');
  // 见上面 ①：必须唯一命中可编辑那条，不唯一就抛 —— 不猜。
  const editable = (infos.data || []).filter((x) => x.attributes.appStoreState !== 'READY_FOR_SALE');
  if (editable.length !== 1) {
    throw new Error(`${app.name} 的可编辑 appInfo 命中 ${editable.length} 条（应为 1）`
      + ' —— 写到 READY_FOR_SALE 那条上 Apple 可能接受但不生效，所以这里不猜');
  }
  const inf = editable[0];

  const locs = await api('GET', `/appInfos/${inf.id}/appInfoLocalizations?limit=20`
    + '&fields[appInfoLocalizations]=locale,name,subtitle');
  let ok = true;
  for (const L of locs.data) {
    const locale = L.attributes.locale;
    const want = aso[`${flavor}·${locale}`];
    const label = `${app.name} ${locale}`;
    if (!want) { console.log(`  ${label}: ✗ ${file} 里没有这个 locale`); ok = false; continue; }
    const patch = {};
    for (const f of ['name', 'subtitle']) {
      if (want[f] === undefined) continue;
      const d = diffLine(label, f, L.attributes[f], want[f]);
      console.log(d.line);
      if (!d.same) patch[f] = want[f];
    }
    if (!apply || !Object.keys(patch).length) continue;
    await api('PATCH', `/appInfoLocalizations/${L.id}`,
      { data: { type: 'appInfoLocalizations', id: L.id, attributes: patch } });
    const back = await api('GET', `/appInfoLocalizations/${L.id}`
      + '?fields[appInfoLocalizations]=locale,name,subtitle');
    for (const f of Object.keys(patch)) {
      const got = String(back.data.attributes[f] || '').trim();
      const same = got === String(patch[f]).trim();
      console.log(`  ${label} ${f.padEnd(16)}回读「${got}」${same ? '✓' : '✗ 不符！'}`);
      if (!same) ok = false;
    }
  }

  // 反向的一遍，同 cmdAso 里那一段的理由。
  const have = new Set(locs.data.map((L) => L.attributes.locale));
  const missing = Object.keys(aso)
    .filter((k) => k.startsWith(flavor + '·'))
    .map((k) => k.slice(flavor.length + 1))
    .filter((loc) => !have.has(loc));
  for (const locale of missing) {
    const want = aso[`${flavor}·${locale}`];
    const label = `${app.name} ${locale}`;
    if (!want.name) { console.log(`  ${label}: ✗ 新 locale 缺 name`); ok = false; continue; }
    const attrs = { locale, name: want.name };
    if (want.subtitle !== undefined) attrs.subtitle = want.subtitle;
    if (!apply) { console.log(`  ${label}: 将**新建** name「${attrs.name}」subtitle「${attrs.subtitle || ''}」`); continue; }
    const made = await api('POST', '/appInfoLocalizations', { data: {
      type: 'appInfoLocalizations',
      attributes: attrs,
      relationships: { appInfo: { data: { type: 'appInfos', id: inf.id } } },
    } });
    const back = await api('GET', `/appInfoLocalizations/${made.data.id}`
      + '?fields[appInfoLocalizations]=locale,name,subtitle');
    const good = ['name', 'subtitle'].every((f) => attrs[f] === undefined
      || String(back.data.attributes[f] || '').trim() === String(attrs[f]).trim());
    console.log(`  ${label}: 已新建 ${good ? '✓ 回读一致' : '✗ 回读不符！'}`);
    if (!good) ok = false;
  }
  return ok;
}

// 只读全景，兼作改动前后的快照。三类标红都是「不报错但有损失」的形状。
// 把商店上现有的文案按 aso.md 的格式打出来 —— 用来把「商店上有、文件里没有」的字段
// 收编进单一来源。发现它的场景：中国版的 description 一直在商店上活着，而 aso.md 里
// 压根没有这个字段，于是那份文案不受任何门禁管，改了也没人知道。
async function cmdDump(bundleId, platform) {
  const app = (await apps()).find((a) => a.bundleId === bundleId);
  if (!app) throw new Error(`找不到 ${bundleId}`);
  const flavor = bundleId.endsWith('.cn') ? '中国版' : '国际版';
  const infos = await api('GET', `/apps/${app.id}/appInfos?limit=10&fields[appInfos]=appStoreState`);
  const out = [];
  for (const inf of (infos.data || []).filter((x) => x.attributes.appStoreState !== 'READY_FOR_SALE')) {
    const locs = await api('GET', `/appInfos/${inf.id}/appInfoLocalizations?limit=20`
      + '&fields[appInfoLocalizations]=locale,name,subtitle');
    for (const L of locs.data) {
      for (const f of ['name', 'subtitle']) {
        if (L.attributes[f]) out.push(`## ${flavor} · ${L.attributes.locale} · ${f}\n\n\`\`\`\n${L.attributes[f]}\n\`\`\`\n`);
      }
    }
  }
  const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=8`
    + '&fields[appStoreVersions]=versionString,platform,appStoreState');
  const v = (vs.data || []).find((x) => x.attributes.platform === platform
    && isEditable(x));
  if (v) {
    const locs = await api('GET', `/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=25`
      + '&fields[appStoreVersionLocalizations]=locale,keywords,description,promotionalText');
    for (const L of locs.data) {
      for (const f of ASO_VERSION_FIELDS) {
        if (L.attributes[f]) out.push(`## ${flavor} · ${L.attributes.locale} · ${f}\n\n\`\`\`\n${L.attributes[f]}\n\`\`\`\n`);
      }
    }
  }
  console.log(out.join('\n'));
  return true;
}

async function cmdAsoAudit() {
  const LIM = { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000 };
  let bad = 0;
  for (const app of await apps()) {
    if (!/belliedmonkeytranslator/.test(app.bundleId)) continue;
    console.log(`\n■ ${app.name}  (${app.bundleId})`);
    const infos = await api('GET', `/apps/${app.id}/appInfos?limit=10&fields[appInfos]=appStoreState`);
    for (const inf of (infos.data || []).filter((x) => x.attributes.appStoreState !== 'READY_FOR_SALE')) {
      const locs = await api('GET', `/appInfos/${inf.id}/appInfoLocalizations?limit=20`
        + '&fields[appInfoLocalizations]=locale,name,subtitle');
      for (const L of locs.data) {
        const a = L.attributes;
        for (const f of ['name', 'subtitle']) {
          const v = a[f] || '';
          const n = [...v].length;
          const empty = !n;
          if (empty) bad++;
          console.log(`  [appInfo ${a.locale}] ${f.padEnd(16)}${String(n).padStart(4)}/${LIM[f]}`
            + (empty ? '  ✗ 空着 —— 高权重索引位浪费' : `  ${v.slice(0, 40)}`));
        }
      }
    }
    const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=8`
      + '&fields[appStoreVersions]=versionString,platform,appStoreState');
    for (const v of (vs.data || []).filter(isEditable)) {
      const locs = await api('GET', `/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=20`
        + '&fields[appStoreVersionLocalizations]=locale,keywords,description,promotionalText');
      for (const L of locs.data) {
        const a = L.attributes;
        for (const f of ASO_VERSION_FIELDS) {
          const v2 = a[f] || '';
          const n = [...v2].length;
          const pct = Math.round((n / LIM[f]) * 100);
          const notes = [];
          if (!n) notes.push('✗ 空');
          // keywords 占用率低是效率问题，不是正确性问题 —— 报出来但不算失败。
          if (f === 'keywords' && n && pct < 60) notes.push(`占用率 ${pct}% —— 浪费了 ${LIM[f] - n} 个高权重字符`);
          // 语种不符是本轮那个 bug 的机器判据，算失败。
          if (/^zh/.test(a.locale) && n) {
            const letters = [...v2].filter((c) => /[A-Za-z\u4e00-\u9fff]/.test(c));
            const ascii = letters.length ? letters.filter((c) => /[A-Za-z]/.test(c)).length / letters.length : 0;
            if (ascii >= 0.8) { notes.push(`✗ ASCII 占比 ${Math.round(ascii * 100)}% —— 中文 locale 写成了英文`); bad++; }
          }
          if (!n) bad++;
          console.log(`  [${v.attributes.platform} ${a.locale}] ${f.padEnd(16)}`
            + `${String(n).padStart(4)}/${LIM[f]}  ${notes.join(' · ')}`);
        }
      }
    }
  }
  console.log(`\n${bad ? '✗ ' + bad + ' 处需要处理' : '✓ 无空字段、无语种不符'}`);
  return bad === 0;
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

// ─── installs：下载量。两条线各占多少、在哪些国家、什么设备 ─────────────────
//
// 2026-09-03 之前这个问题**答不了**：账号从没接过任何分析数据，
// analyticsReportRequests 是 0，商店评论两条线都是 0 条，同步后端又分不出 flavor
// （中国版的 App 也带登录，chunks 里没有客户端标记）。
//
// 走的是 salesReports 而不是 analyticsReports，两个理由：
//   ① **立刻可读**。analyticsReports 要先 POST 一个请求，然后等 Apple 异步生成
//      实例，一次性快照通常要等一天上下；salesReports 是现成的。
//   ② 它按天/周切片，且每行自带 Country Code 与 Device —— 正好是要问的三个维度。
//
// 三件从实测中长出来的形状：
//   · **不是 JSON**。返回的是 gzip 的 TSV，所以不能走 api()；Accept 要 a-gzip。
//   · **没数据的那天返回 404**，不是空报表。404 必须当成「那天没人下载」而不是错误，
//     否则拉 40 天会在第一个安静的日子里炸掉。
//   · **周报表的 reportDate 必须落在那一周里**（Apple 的周以周日结束）。
//
// 免费 app 的 Units 就是下载次数。Device 列是真实设备（iPhone / iPad / Desktop），
// 而 Supported Platforms 那列写的是「iOS and macOS」——是包支持什么，不是用户用什么。
// 拿后者当设备分布会得到一个「100% 全平台」的废话。
async function cmdInstalls(days) {
  const vendor = slot('ascVendorNumber');
  if (!vendor) {
    console.error('✗ .local/keys.md 缺 ascVendorNumber');
    console.error('  在 App Store Connect 的「付款和财务报告」页左上角灰色小字里：');
    console.error('  https://appstoreconnect.apple.com/itc/payments_and_financial_reports/#/');
    process.exit(1);
  }
  const zlib = require('zlib');
  const APPS = {};
  for (const a of await apps()) APPS[a.id] = a.name;

  const fetchDay = async (date) => {
    const u = API + '/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES'
      + '&filter[reportSubType]=SUMMARY&filter[vendorNumber]=' + vendor
      + '&filter[reportDate]=' + date;
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + jwt(), Accept: 'application/a-gzip' } });
    if (r.status === 404) return null;                 // 那天没人下载 —— 正常，不是错误
    if (!r.ok) throw new Error(`${date}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    const buf = Buffer.from(await r.arrayBuffer());
    try { return zlib.gunzipSync(buf).toString('utf8'); } catch (_) { return buf.toString('utf8'); }
  };

  const rows = []; let quiet = 0; let live = 0;
  const d0 = new Date();
  for (let i = 1; i <= days; i += 1) {
    const d = new Date(d0); d.setDate(d.getDate() - i);
    const t = await fetchDay(d.toISOString().slice(0, 10));
    if (!t) { quiet += 1; continue; }
    live += 1;
    const lines = t.trim().split('\n');
    const head = lines[0].split('\t').map((h) => h.trim());
    for (const l of lines.slice(1)) {
      const c = l.split('\t');
      rows.push(Object.fromEntries(head.map((h, j) => [h, (c[j] || '').trim()])));
    }
  }
  if (!rows.length) {
    console.log(`最近 ${days} 天没有任何下载记录（${quiet} 天无报表）。`);
    return;
  }
  const units = (r) => Number(r.Units || 0);
  const nameOf = (r) => APPS[r['Apple Identifier']] || r['Apple Identifier'];
  const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
  const byApp = new Map(); const byDev = new Map(); const byTerr = new Map();
  let total = 0;
  for (const r of rows) {
    const n = units(r); total += n;
    add(byApp, nameOf(r), n);
    add(byDev, nameOf(r) + '\u0000' + (r.Device || '?'), n);
    add(byTerr, r['Country Code'] + '\u0000' + nameOf(r), n);
  }
  const dates = rows.map((r) => r['Begin Date']).sort();
  console.log(`\n下载量 · 最近 ${days} 天（${dates[0]} → ${dates[dates.length - 1]}；`
    + `${live} 天有下载，${quiet} 天安静）· 合计 ${total}\n`);

  console.log('■ 按 app');
  for (const [k, v] of [...byApp].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(5)}  ${(100 * v / total).toFixed(0)}%`);
  }
  console.log('\n■ 按设备');
  for (const [k, v] of [...byDev].sort((a, b) => b[1] - a[1])) {
    const [app, dev] = k.split('\u0000');
    console.log(`  ${app.padEnd(28)} ${dev.padEnd(10)} ${String(v).padStart(5)}`);
  }
  console.log('\n■ 按国家/地区');
  const terr = new Map();
  for (const [k, v] of byTerr) {
    const [cc, app] = k.split('\u0000');
    if (!terr.has(cc)) terr.set(cc, new Map());
    add(terr.get(cc), app, v);
  }
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  for (const [cc, m] of [...terr].sort((a, b) => sum(b[1]) - sum(a[1]))) {
    const s = sum(m);
    const parts = [...m].sort((a, b) => b[1] - a[1]).map(([a, v]) => `${a} ${v}`).join(' · ');
    console.log(`  ${cc.padEnd(4)} ${String(s).padStart(4)}  ${(100 * s / total).toFixed(1).padStart(5)}%  ${parts}`);
  }
  console.log(`\n  共 ${terr.size} 个国家/地区`);
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
async function cmdDevices(udid, name, macFlag) {
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
    // platform 原来写死 IOS。注册一台 Mac 时那是错的，而 ASC 的报错
    // （「no devices from which to generate a provisioning profile」）指不到这里
    // —— 2026-09-03 给 macOS 归档拉描述文件时才发现。
    // 判据用 UDID 的形状：Apple Silicon 的 Mac 是 `00006020-…` 这种 8-16 位分段，
    // iPhone 是 `00008120-…`（前缀不同）或 40 位十六进制。显式传 --mac 最保险。
    attributes: { name: name || 'test device', udid, platform: macFlag ? 'MAC_OS' : 'IOS' } } });
  const a = (r && r.data && r.data.attributes) || {};
  if (!a.udid) { console.error('✗ 注册没有回读到 udid：' + JSON.stringify(r).slice(0, 300)); return false; }
  console.log(`✓ 已注册：${a.udid}  ${a.name}  (${a.status})`);
  return true;
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'devices') {
    const macFlag = rest.includes('--mac');
    const args = rest.filter((x) => x !== '--mac');
    const ok = await cmdDevices(args[0], args.slice(1).join(' '), macFlag);
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'aso') {
    if (rest[0] === '--audit') { const ok = await cmdAsoAudit(); process.exit(ok ? 0 : 1); }
    const [bundleId, platform, versionString, file] = rest;
    if (!bundleId || !platform || !versionString || !file) {
      console.log('用法: node scripts/asc.js aso <bundleId> <IOS|MAC_OS> <版本> <aso.md> [--apply] [--promo-only]');
      console.log('      node scripts/asc.js aso --audit');
      process.exit(1);
    }
    const ok = await cmdAso(bundleId, platform, versionString, file,
      rest.includes('--apply'), rest.includes('--promo-only'));
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'appinfo') {
    const [bundleId, file] = rest;
    if (!bundleId || !file) {
      console.log('用法: node scripts/asc.js appinfo <bundleId> <aso.md> [--apply]');
      console.log('  ⚠️ 无 platform 参数 —— name/subtitle 是 app 级的，iOS 与 macOS 共用一条');
      process.exit(1);
    }
    const ok = await cmdAppInfo(bundleId, file, rest.includes('--apply'));
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'dump') {
    const [bundleId, platform] = rest;
    if (!bundleId || !platform) {
      console.log('用法: node scripts/asc.js dump <bundleId> <IOS|MAC_OS>   # 按 aso.md 格式打印商店现有文案');
      process.exit(1);
    }
    const ok = await cmdDump(bundleId, platform);
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
  if (cmd === 'renameversion') {
    const [bundleId, platform, fromV, toV] = rest;
    if (!bundleId || !platform || !fromV || !toV) {
      console.log('用法: node scripts/asc.js renameversion <bundleId> <IOS|MAC_OS> <旧版本> <新版本> [--apply]');
      process.exit(1);
    }
    const ok = await cmdRenameVersion(bundleId, platform, fromV, toV, rest.includes('--apply'));
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
  if (cmd === 'installs') {
    // 默认 30 天。免费 app 的 Units 就是下载次数。
    const n = Math.max(1, Math.min(365, parseInt(rest[0], 10) || 30));
    await cmdInstalls(n);
    return;
  }
  console.log('用法: node scripts/asc.js builds | versions | reviews [条数] | installs [天数]'
    + ' | aso --audit'
    + ' | aso <bundleId> <平台> <版本> <aso.md> [--apply] [--promo-only]'
    + ' | appinfo <bundleId> <aso.md> [--apply]'
    + ' | dump <bundleId> <平台>'
    + ' | devices [UDID [名称] [--mac]]'
    + ' | newversion <bundleId> <平台> <版本> [--apply]'
    + ' | renameversion <bundleId> <平台> <旧版本> <新版本> [--apply]'
    + ' | notes <bundleId> <平台> <版本> <文案md> [--apply]'
    + ' | bind <bundleId> <平台> <版本> <build>');
  process.exit(1);
})().catch((e) => { console.error('✗ ' + ((e && e.message) || e)); process.exit(1); });
