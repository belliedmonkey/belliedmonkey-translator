#!/usr/bin/env node
// scripts/tel-packs.js — 语言包下载失败报表（BEL-293 P0，**只读**）。
//
//   npm run tel:packs                 # 最近 30 天
//   npm run tel:packs -- --days 180   # 最长 180 天（bt_events 原始行保留期）
//
// 连接方式与 scripts/grant-float.js 同一个模式：`.local/keys.md` 的
// `supabase_service_key` + `extension/learn/backend.config.js` 的 `url`，
// 走 PostgREST 只读查询。**不新造凭据、不打印任何 key**；缺凭据就明确报错退出。
//
// 输出三块（票面口径）：
//   ① 按 v / pack_kind / code / reason / surface 的失败分布；
//   ② 带 reason 覆盖率（带 reason fail / 全部 fail）；
//   ③ 按 (install_id, name, props->>'download_id') 去重后的计数；
//      没有 download_id 的老行单独标注，不进去重计数。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const EVENT = 'pack_download_fail';
const PAGE = 1000;

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

// 与 scripts/grant-float.js 同一份解析：`KEY = VALUE`，注释与占位值跳过。
function slots() {
  if (!fs.existsSync(KEYS)) die('.local/keys.md 不存在（只读报表需要 supabase_service_key；不会打印 key）');
  const out = {};
  for (const line of fs.readFileSync(KEYS, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && m[2] && !/^<|^\.\.\.|^TODO/i.test(m[2])) out[m[1]] = m[2];
  }
  return out;
}

// backend.config.js 是「用哪个后端」的唯一来源（与 grant-float 相同），不另写地址。
function backend() {
  const src = fs.readFileSync(path.join(ROOT, 'extension', 'learn', 'backend.config.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}

function propsOf(row) {
  const p = row && row.props;
  if (p && typeof p === 'object') return p;
  if (typeof p === 'string') { try { return JSON.parse(p) || {}; } catch (_) { return {}; } }
  return {};
}

// 纯聚合（测试可离线喂行）：不碰网络、不读文件。
function aggregate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const dist = new Map();
  const dedup = new Set();
  let withReason = 0;
  let withReasonNonLegacy = 0;
  let legacy = 0;
  let withDownloadId = 0;
  let missingDetail = 0;

  for (const row of list) {
    const p = propsOf(row);
    const key = [
      String(row && row.v || '(missing)'),
      String(p.pack_kind || '(missing)'),
      String(p.code || '(missing)'),
      String(p.reason || '(missing)'),
      String(p.surface || '(missing)'),
      String(p.detail || '(missing)'),
    ].join('\u0000');
    const cur = dist.get(key) || { v: String(row && row.v || '(missing)'), pack_kind: String(p.pack_kind || '(missing)'), code: String(p.code || '(missing)'), reason: String(p.reason || '(missing)'), surface: String(p.surface || '(missing)'), detail: String(p.detail || '(missing)'), n: 0 };
    cur.n += 1;
    dist.set(key, cur);
    if (p.reason) withReason += 1;
    // 1.23.3 老行没有 detail：保持 (missing)，绝不折算成 'other'。
    if (!p.detail) missingDetail += 1;

    const dl = p.download_id == null ? '' : String(p.download_id);
    if (!dl) { legacy += 1; continue; }
    withDownloadId += 1;
    if (p.reason) withReasonNonLegacy += 1;
    dedup.add([String(row && row.install_id || ''), EVENT, dl].join('\u0000'));
  }

  const counts = [...dist.values()].sort((a, b) =>
    (b.n - a.n) || a.v.localeCompare(b.v) || a.pack_kind.localeCompare(b.pack_kind) ||
    a.code.localeCompare(b.code) || a.reason.localeCompare(b.reason) ||
    a.surface.localeCompare(b.surface) || a.detail.localeCompare(b.detail));

  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');
  return {
    total: list.length,
    counts,
    withReason,
    withReasonNonLegacy,
    withDownloadId,
    deduped: dedup.size,
    legacy,
    missingDetail,
    reasonCoverage: pct(withReason, list.length),
    reasonCoverageWithDownloadId: pct(withReasonNonLegacy, withDownloadId),
  };
}

function format(report, days) {
  const out = [];
  out.push(`${EVENT} · 最近 ${days} 天 · ${report.total} 行`);
  out.push('');
  out.push('按 v / pack_kind / code / reason / surface / detail：');
  if (!report.counts.length) out.push('  （没有失败行）');
  for (const c of report.counts) {
    out.push(`  v=${c.v}  pack_kind=${c.pack_kind}  code=${c.code}  reason=${c.reason}  surface=${c.surface}  detail=${c.detail}  n=${c.n}`);
  }
  out.push('');
  out.push(`带 reason 覆盖率（全部 fail）：${report.withReason} / ${report.total} = ${report.reasonCoverage}`);
  out.push(`带 reason 覆盖率（有 download_id 的行）：${report.withReasonNonLegacy} / ${report.withDownloadId} = ${report.reasonCoverageWithDownloadId}`);
  out.push(`去重（install_id + name + download_id）：${report.deduped} 次下载尝试（原始 ${report.withDownloadId} 行）`);
  out.push(`无 download_id 的老行：${report.legacy} 条（单独标注；不进去重计数，也不进第二行覆盖率的分母）`);
  out.push(`无 detail 的老行（1.23.3）：${report.missingDetail} 条（显示 (missing)，不算 other、不回填）`);
  return out.join('\n');
}

async function fetchRows(url, key, days) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({
      select: 'install_id,v,props,received_at',
      name: 'eq.' + EVENT,
      received_at: 'gte.' + since,
      order: 'received_at.asc',
      limit: String(PAGE),
      offset: String(offset),
    });
    const r = await fetch(url + '/rest/v1/bt_events?' + q.toString(), {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      // 不回显请求头 / key；只回 HTTP 状态与服务端正文截断。
      throw new Error('bt_events HTTP ' + r.status + ' ' + String(body || '').slice(0, 160));
    }
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error('bt_events 返回的不是数组');
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

function parseDays(argv) {
  const i = argv.indexOf('--days');
  if (i < 0) return 30;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1 || n > 180) die('--days 必须是 1–180 的整数（bt_events 原始行保留 180 天）');
  return n;
}

async function main() {
  const days = parseDays(process.argv.slice(2));
  const k = slots();
  const service = k.supabase_service_key;
  if (!service) die('.local/keys.md 缺 supabase_service_key（只读报表需要 service role；不会打印 key）');

  let be;
  try { be = backend(); } catch (e) { die('读不到 extension/learn/backend.config.js：' + e.message); }
  const url = String(be && be.url || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(url) || /\.invalid(?::\d+)?$/.test(url)) {
    die('backend.config.js 的 url 不可用（' + url + '）—— 本机需要构建注入 / 私仓配方，脚本不会猜地址');
  }

  let rows;
  try { rows = await fetchRows(url, service, days); }
  catch (e) { die('查询失败：' + e.message); }
  console.log(format(aggregate(rows), days));
}

if (require.main === module) main().catch((e) => die(e.stack || e.message));

module.exports = { aggregate, format, propsOf };
