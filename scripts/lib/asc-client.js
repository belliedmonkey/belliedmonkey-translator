// scripts/lib/asc-client.js — App Store Connect 的凭证、JWT、请求与销售报表，一处实现。
//
// 为什么抽出来：`asc.js` 与 `store-stats.js` 都要问 Apple 同样的问题（下载量、评分），
// 而这四样东西（凭证槽位读取 / ES256 JWT / 错误体解包 / 销售报表的 gzip TSV）每一样
// 都带着实测长出来的形状。抄第二份 = 两份会漂移，而漂移的那一份只会在你最需要它的
// 时候骗你。同 `scripts/lib/release-gate.js`（三条发布路共用一份门禁）的做法。
//
// **这个文件只读、不写。** 任何 PATCH/POST 留在调用方，别让「读数据」的模块带上
// 改商店的能力。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const API = 'https://api.appstoreconnect.apple.com/v1';

// `[^\S\n]*` 而不是 `\s*`：`\s` 含换行，空槽位会跨行吃到下一行的字段名，
// 把「缺凭证」伪装成「凭证错误」。同 cws-publish.js / amo-publish.js 那处的疤。
function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

// 抛而不是 exit：`asc.js` 顶层有 .catch 打印 `✗ <message>` 并退 1，行为不变；
// 而 `store-stats.js` 要的是「这一面读不到，其余照常打印」—— 一个 exit 会让
// 缺一把 key 就整张报表消失。
function jwt() {
  const missing = ['ascIssuerId', 'ascKeyId', 'ascKeyPath'].filter((n) => !slot(n));
  if (missing.length) throw new Error('.local/keys.md 缺：' + missing.join(', '));
  const keyPath = slot('ascKeyPath').replace(/^~/, process.env.HOME);
  if (!fs.existsSync(keyPath)) throw new Error(`私钥文件不存在：${keyPath}`);
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

// 复合键的分隔符。**不能用空格，也不能用任何会出现在数据里的字符** —— app 名字里就有
// 空格（"BelliedMonkey Translator"），用空格拆回来会把名字截成 "BelliedMonkey"，
// 而两个 flavor 的名字前缀不同，症状不会立刻显形。
const SEP = '\u0000';
const cut = (k) => { const i = k.indexOf(SEP); return [k.slice(0, i), k.slice(i + 1)]; };

// ─── 销售报表 ───────────────────────────────────────────────────────────────
//
// 走 salesReports 而不是 analyticsReports，两个理由：
//   ① **立刻可读**。analyticsReports 要先 POST 一个请求再等 Apple 异步生成实例，
//      一次性快照通常要等一天上下；salesReports 是现成的。
//   ② 它按天切片，且每行自带 Country Code 与 Device —— 正好是要问的三个维度。
//
// 三件从实测中长出来的形状：
//   · **不是 JSON**。返回的是 gzip 的 TSV，所以不走 api()；Accept 要 a-gzip。
//   · **没数据的那天返回 404**，不是空报表。404 必须当成「那天没人下载」而不是错误，
//     否则拉 40 天会在第一个安静的日子里炸掉。
//   · 免费 app 的 Units 就是下载次数。Device 列是真实设备（iPhone / iPad / Desktop），
//     而 Supported Platforms 那列写的是「iOS and macOS」—— 是包支持什么，不是用户用
//     什么。拿后者当设备分布会得到一个「100% 全平台」的废话。
async function salesDay(vendor, date) {
  const u = API + '/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES'
    + '&filter[reportSubType]=SUMMARY&filter[vendorNumber]=' + vendor
    + '&filter[reportDate]=' + date;
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + jwt(), Accept: 'application/a-gzip' } });
  if (r.status === 404) return null;                 // 那天没人下载 —— 正常，不是错误
  if (!r.ok) throw new Error(`${date}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  try { return zlib.gunzipSync(buf).toString('utf8'); } catch (_) { return buf.toString('utf8'); }
}

// 拉最近 days 天的原始行。**不打印任何东西** —— 展示留给调用方，
// 因为 asc.js 要的是详表、store-stats.js 要的是一行摘要。
async function salesRows(days) {
  const vendor = slot('ascVendorNumber');
  if (!vendor) {
    // 地址必须给全：这个号 **API 查不到**，只能去网页上抄，
    // 只说「缺 ascVendorNumber」等于把人扔在原地。
    throw new Error('.local/keys.md 缺 ascVendorNumber —— 在 App Store Connect'
      + '「付款和财务报告」页左上角的灰色小字里：\n'
      + '  https://appstoreconnect.apple.com/itc/payments_and_financial_reports/#/');
  }
  const rows = []; let quiet = 0; let live = 0;
  const d0 = new Date();
  for (let i = 1; i <= days; i += 1) {
    const d = new Date(d0); d.setDate(d.getDate() - i);
    const t = await salesDay(vendor, d.toISOString().slice(0, 10));
    if (!t) { quiet += 1; continue; }
    live += 1;
    const lines = t.trim().split('\n');
    const head = lines[0].split('\t').map((h) => h.trim());
    for (const l of lines.slice(1)) {
      const c = l.split('\t');
      rows.push(Object.fromEntries(head.map((h, j) => [h, (c[j] || '').trim()])));
    }
  }
  const dates = rows.map((r) => r['Begin Date']).sort();
  return { rows, live, quiet, from: dates[0] || null, to: dates[dates.length - 1] || null };
}

// 三个维度的汇总。同样一处实现 —— 两个调用方展示不同，但「怎么算」必须只有一份，
// 否则两张报表会给出两个总数，而没人知道该信哪个。
function aggregateSales(rows, appNames) {
  const nameOf = (r) => (appNames && appNames[r['Apple Identifier']]) || r['Apple Identifier'];
  const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
  const byApp = new Map(); const byDev = new Map(); const byTerr = new Map();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.Units || 0); total += n;
    add(byApp, nameOf(r), n);
    add(byDev, nameOf(r) + SEP + (r.Device || '?'), n);
    add(byTerr, r['Country Code'] + SEP + nameOf(r), n);
  }
  // 国家维度再折一层：cc -> (app -> n)，两个调用方都要这个形状。
  const terr = new Map();
  for (const [k, v] of byTerr) {
    const [cc, app] = cut(k);
    if (!terr.has(cc)) terr.set(cc, new Map());
    add(terr.get(cc), app, v);
  }
  return { total, byApp, byDev, byTerr, terr };
}

module.exports = { ROOT, KEYS, API, SEP, cut, slot, jwt, api, apps, salesDay, salesRows, aggregateSales };
