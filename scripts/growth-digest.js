#!/usr/bin/env node
// scripts/growth-digest.js — 渠道 × 转化 一页看板（growth-spec §6 的读数面）。
//
// 为什么要有它：ASO 的读数散在三个脚本里 —— `store-stats.js`（各面装机）、
// `asc.js sources`（曝光构成）、`aso-rank.js`（关键词名次）。要回答「哪个渠道最值得优化」
// 得手翻三遍。这一个命令把它们收成一页，并把「离线可读」与「在线刷新」分开：
//
//   node scripts/growth-digest.js           # 读 .local/stats 里的快照，离线、秒出（默认）
//   node scripts/growth-digest.js --live    # 先刷新 store-stats 与 asc sources，再出这一页
//
// **它只读、只汇总**：不采集新数据、不写商店、不改任何字段。数据来源全部是既有脚本的
// 产物（`.local/stats/`，gitignored）。**下载量 = 首次下载**（不含更新/重下，见 #476）。
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// 主仓库的 .local（在 worktree 里跑也读主树那一份）。
const SNAPDIR = path.join(require('./lib/local-dir').mainLocalDir(ROOT), 'stats');
const { tierOf, medianRank } = require('./lib/rank-tiers');

const today = () => new Date().toISOString().slice(0, 10);

// ─── 纯逻辑（测试直接 require 这几个）────────────────────────────────────────

const pad = (s, n) => String(s == null ? '' : s).padStart(n);

function deltaText(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number') return '';
  const d = cur - prev;
  if (d === 0) return '±0';
  return (d > 0 ? '↑' : '↓') + Math.abs(d);
}

// 渠道榜。**单位不同，所以只排序、不相加** —— 「1 次 GitHub 下载」不等于「1 个 AMO 日活」。
function channelRows(snap, prev) {
  const P = (prev && prev.data) || (prev || {});
  const s = snap || {};
  const rows = [];
  const ap = s.apple || {};
  if (ap.ok) {
    // 2026-09-27 修口径（#476）：`updates` 字段是修复后的标记。旧快照没有它 ⇒ 两个
    // 定义相减会显示一个假暴跌，所以不画环比（同 store-stats.js 那处）。
    const comparable = !!(P.apple && typeof P.apple.updates === 'number');
    rows.push({ name: 'Apple App Store', value: ap.total,
      delta: comparable ? deltaText(ap.total, P.apple.total) : '',
      note: comparable ? '首次下载' : '首次下载（上份口径不同，无环比）' });
  }
  const amo = s.amo || {};
  if (amo.ok) rows.push({ name: 'Firefox AMO', value: amo.dau, delta: deltaText(amo.dau, P.amo && P.amo.dau), note: '日活 / 周下载 ' + (amo.weekly ?? '?') });
  const cws = (s.manual && s.manual.cws) || {};
  if (typeof cws.installs_28d === 'number') rows.push({ name: 'Chrome Web Store', value: cws.installs_28d, delta: deltaText(cws.installs_28d, P.manual && P.manual.cws && P.manual.cws.installs_28d), note: '28 天安装 [手工 ' + (cws.at || '?') + ']' });
  const gh = s.github || {};
  if (gh.ok) rows.push({ name: 'GitHub Release', value: gh.total, delta: deltaText(gh.total, P.github && P.github.total), note: '累计下载' });
  const sb = s.supabase || {};
  if (sb.ok) rows.push({ name: 'Supabase 账号', value: sb.accounts, delta: deltaText(sb.accounts, P.supabase && P.supabase.accounts), note: '同步账号' });
  return rows.sort((a, b) => (b.value || 0) - (a.value || 0));
}

// 关键词名次：最新一天的每个词，取近 N 次的中位，并标出「跨档」（只有跨档才算数）。
function keywordRows(docs, windowN = 5) {
  if (!docs.length) return [];
  const latest = docs[docs.length - 1];
  const rows = [];
  for (const [k, rank] of Object.entries((latest.doc && latest.doc.ranks) || {})) {
    const past = docs.map((d) => (d.doc.ranks || {})[k]).filter((x) => x !== undefined);
    const median = medianRank(past.slice(-windowN));
    const oldest = past.length > 1 ? past[0] : undefined;
    const [target, country, term] = k.split('|');
    rows.push({ target, country, term, latest: rank, median, tier: tierOf(rank),
      crossed: oldest !== undefined && tierOf(oldest) !== tierOf(rank), n: past.length });
  }
  return rows.sort((a, b) => (a.target + a.country + a.term).localeCompare(b.target + b.country + b.term));
}

// 解析 `asc.js sources` 的文本。它是给人看的表格，不是 JSON —— 这里只取三个读数：
// 每个 label 的 Impression 合计与来源构成、Tap 合计、Page view 合计，以及搜索曝光按地区。
function parseSources(text) {
  const labels = [];
  let cur = null, ev = null;
  for (const line of String(text).split('\n')) {
    const lm = /^■\s+(\S+)\s+请求/.exec(line);
    if (lm) { cur = { name: lm[1], events: {}, searchByTerr: [] }; labels.push(cur); ev = null; continue; }
    if (!cur) continue;
    const em = /^\s{2}([A-Za-z][A-Za-z ]*?)\s{2,}合计\s+(\d+)\s*$/.exec(line);
    if (em) { ev = em[1].trim(); cur.events[ev] = { total: Number(em[2]), bySource: [] }; continue; }
    if (/来自搜索的曝光/.test(line)) { ev = '@terr'; continue; }
    if (ev === '@terr') {
      const tm = /^\s{6}([A-Z]{2})\s+(\d+)\s*$/.exec(line);
      if (tm) cur.searchByTerr.push([tm[1], Number(tm[2])]);
      continue;
    }
    const sm = /^\s{6}(\S.*?)\s{2,}(\d+)\s+([\d.]+)%\s*$/.exec(line);
    if (sm && ev && cur.events[ev]) cur.events[ev].bySource.push({ source: sm[1].trim(), count: Number(sm[2]) });
  }
  return labels;
}

// ─── 读快照 ─────────────────────────────────────────────────────────────────

function readSnapshots(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    .map((f) => ({ date: f.slice(0, 10), data: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

function readRankDocs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^aso-rank-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    .map((f) => ({ date: f.replace(/^aso-rank-/, '').replace(/\.json$/, ''), doc: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

function readSources(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^sources-\d{4}-\d{2}-\d{2}\.txt$/.test(f)).sort();
  if (!files.length) return null;
  const f = files[files.length - 1];
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  return { date: f.replace(/^sources-/, '').replace(/\.txt$/, ''), text, labels: parseSources(text) };
}

// ─── 刷新（--live）───────────────────────────────────────────────────────────

function refresh() {
  // 只把**脚本路径**接上 ROOT；子命令参数原样传（早先 path.join 把 'sources'/'28'
  // 也拼成了绝对路径，asc.js 收到的是两个不存在的路径）。
  const run = (script, args) => execFileSync(process.execPath, [path.join(ROOT, script), ...args],
    { cwd: ROOT, encoding: 'utf8' });
  try { run('scripts/store-stats.js', ['--json']); }        // 自己会写快照
  catch (e) { console.error('⚠️ store-stats 刷新失败：' + String(e.message).split('\n')[0]); }
  try {
    const out = run('scripts/asc.js', ['sources', '28']);
    fs.mkdirSync(SNAPDIR, { recursive: true });
    fs.writeFileSync(path.join(SNAPDIR, `sources-${today()}.txt`), out);
  } catch (e) {
    // asc.js sources 在某条 analytics 请求被 Apple 停掉时退 1，但 stdout 仍然可用。
    if (e && e.stdout) { fs.mkdirSync(SNAPDIR, { recursive: true }); fs.writeFileSync(path.join(SNAPDIR, `sources-${today()}.txt`), e.stdout); }
    else console.error('⚠️ asc sources 刷新失败：' + String(e.message).split('\n')[0]);
  }
}

// ─── 出这一页 ───────────────────────────────────────────────────────────────

function render({ snaps, ranks, sources }) {
  const cur = snaps[snaps.length - 1];
  const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  console.log(`\n增长速览（渠道 × 转化）· 数据日 ${cur ? cur.date : '—'}`
    + (prev ? `　对比 ${prev.date}` : '　（只有一份快照，没有环比）'));

  if (!cur) {
    console.log('  没有 store-stats 快照 —— 先 `npm run store:stats`（或本命令加 --live）。');
  } else {
    console.log('\n■ 各渠道（按量排序；单位不同，只排序不相加）');
    for (const r of channelRows(cur.data, prev)) {
      console.log(`  ${r.name.padEnd(18)} ${pad(r.value, 6)}  ${r.delta ? r.delta.padStart(7) : '       '}  ${r.note}`);
    }
    const ap = cur.data.apple || {};
    if (ap.ok) {
      console.log('\n■ Apple 明细');
      const apps = Object.entries(ap.byApp || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
      console.log('  app   ' + apps.join(' · '));
      const dev = Object.entries(ap.byDev || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
      console.log('  设备  ' + dev.join(' · '));
      const terr = Object.entries(ap.terr || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`);
      console.log('  国家  ' + terr.join(' · '));
      const stars = Object.entries(cur.data.stars || {}).map(([k, m]) => `${k} ${Object.values(m).reduce((a, v) => a + ((v && v.count) || 0), 0)}`);
      console.log(`  评分  ${stars.join(' · ') || '—'}　（触发点随 1.17.0 上线）`);
      console.log(`  另计  更新 ${ap.updates ?? '?'} · 重新下载 ${ap.redownloads ?? '?'}（不含在上面）`);
    }
  }

  console.log('\n■ 曝光构成（Apple 搜索 vs 浏览；隐私抑制，只读构成/趋势）');
  if (!sources) console.log('  — 没有 sources 快照（`npm run growth:digest -- --live` 会抓一份）');
  else for (const L of sources.labels) {
    const imp = L.events.Impression;
    if (!imp) continue;
    const shares = imp.bySource.map((x) => `${x.source} ${(100 * x.count / imp.total).toFixed(1)}%`).join(' · ');
    console.log(`  ${L.name}（${sources.date}）曝光 ${imp.total}　${shares}`);
    const top = L.searchByTerr.slice(0, 5).map(([cc, n]) => `${cc} ${n}`).join(' · ');
    if (top) console.log(`      搜索曝光前 5：${top}`);
  }

  console.log('\n■ 关键词名次（最新快照；中位=近 5 次；← 跨档）');
  if (!ranks.length) console.log('  — 没有 aso-rank 快照（`npm run aso:rank`）');
  else {
    const rows = keywordRows(ranks);
    const strong = rows.filter((r) => r.latest != null);
    console.log(`  ${ranks.length} 份快照 · ${rows.length} 个词，其中 ${strong.length} 个进前 200`);
    for (const r of strong.sort((a, b) => a.latest - b.latest).slice(0, 15)) {
      const med = r.median == null ? '200+' : '#' + r.median;
      console.log(`  ${(r.target + '·' + r.country).padEnd(9)} ${r.term.padEnd(22)} #${pad(r.latest, 3)}　中位 ${med}${r.crossed ? '　← 跨档' : ''}`);
    }
  }

  console.log('\n■ 读法');
  console.log('  · 获客只有 Apple 有量（其余是零头）；所以「优化哪个渠道」= 优化 Apple 自身。');
  console.log('  · Apple 的两个杠杆：评分破零（当前 0）+ 商店页转化；排名词先做长尾（growth-spec §6）。');
  console.log('  · 激活/留存最便宜的一刀是扩展横幅那条（见 .local/stats/funnel-ext-banner-*.md）。');
  console.log('');
}

function main() {
  if (process.argv.slice(2).includes('--live')) refresh();
  render({ snaps: readSnapshots(SNAPDIR), ranks: readRankDocs(SNAPDIR), sources: readSources(SNAPDIR) });
}

if (require.main === module) main();

module.exports = { deltaText, channelRows, keywordRows, parseSources, readSnapshots, readRankDocs, readSources };
