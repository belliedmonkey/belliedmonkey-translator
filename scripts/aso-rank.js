#!/usr/bin/env node
/* 关键词名次追踪（近似）—— 同一个词，改 keywords 之前和之后排第几。
 *
 * 为什么要有它：2026-09-25 之前，App Store 的关键词与 subtitle 自 09-15 起冻结，**从来没测过
 * 效果**。第一次测就发现 subtitle 的前两个词 `live subtitles` 在美国店排 200 名外、第一个
 * 关键词 `interpreter` 也在 200 名外 —— 我们以为在争的词，其实根本没排上。
 *
 * ⚠️ 这是**近似值**，读法有三条限制，写在这里免得被当成真名次：
 *   ① 数据来自 iTunes Search API（公开、不要凭证），它**不是**商店 App 里的搜索算法：没有个性化、
 *      不分设备，每天也会抖。ASC 的分析报表里**没有搜索词**这一份（156 份逐个查过），所以名次只能这样近似。
 *   ② 只返回前 200 条 —— 200 名外一律记 null（打印成 200+）。
 *   ③ **只当趋势看**：同一个词、多次快照的中位数，只认「跨档」变化（200+ → 前 100 → 前 50 → 前 10）。
 *      ASO 的成败看 `asc.js sources` 的「来自搜索的曝光」与 `asc.js installs` 的下载，名次只做辅助。
 *
 * 限流：约 20 次/分钟，所以每次请求间隔 3 秒；整份词表约 4 分钟。
 *
 *   node scripts/aso-rank.js                 # 全部目标，写快照并与历史对比
 *   node scripts/aso-rank.js --target ios    # 只跑一个目标（ios / mac / ios-cn / mac-cn）
 *   node scripts/aso-rank.js --country us    # 只跑一个店面
 *
 * 词表：store-assets/aso-keywords.json。快照：.local/stats/aso-rank-<日期>.json（gitignored）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIST = path.join(ROOT, 'store-assets', 'aso-keywords.json');
const SNAPDIR = path.join(ROOT, '.local', 'stats');

// 目标 → 找哪个 app、用哪个 entity。Mac 版在 `software` 里搜不到，必须 `macSoftware`。
const TARGETS = {
  'ios':    { bundleId: 'com.belliedmonkeytranslator',    entity: 'software' },
  'mac':    { bundleId: 'com.belliedmonkeytranslator',    entity: 'macSoftware' },
  'ios-cn': { bundleId: 'com.belliedmonkeytranslator.cn', entity: 'software' },
  'mac-cn': { bundleId: 'com.belliedmonkeytranslator.cn', entity: 'macSoftware' },
};
const LIMIT = 200;
const GAP_MS = 3000;
const TIERS = [10, 50, 100, 200];
const tierOf = (r) => (r == null ? '200+' : `前${TIERS.find((t) => r <= t)}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rankOf(term, country, { bundleId, entity }) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}`
    + `&entity=${entity}&limit=${LIMIT}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url);
    if (r.status === 403 || r.status === 429) { await sleep(20000); continue; }   // 被限流：退一步再来
    if (!r.ok) throw new Error(`HTTP ${r.status} ${term}@${country}`);
    const rs = (await r.json()).results || [];
    // 按 bundleId **精确**匹配：国际版的 id 是中国版 id 的前缀，前缀匹配会把两者混在一起。
    const i = rs.findIndex((x) => x.bundleId === bundleId);
    return { rank: i >= 0 ? i + 1 : null, n: rs.length, top: rs[0] ? rs[0].trackName : '' };
  }
  throw new Error(`连续被限流 ${term}@${country}`);
}

function history() {
  if (!fs.existsSync(SNAPDIR)) return [];
  return fs.readdirSync(SNAPDIR).filter((f) => /^aso-rank-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    .map((f) => ({ f, d: JSON.parse(fs.readFileSync(path.join(SNAPDIR, f), 'utf8')) }));
}
const key = (t, c, term) => `${t}|${c}|${term}`;
function median(xs) {
  // 200 名外按 201 参与排序，这样「一半时候没排上」的中位数会诚实地落在 200+。
  const v = xs.map((x) => (x == null ? 201 : x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const m = v[Math.floor((v.length - 1) / 2)];
  return m > LIMIT ? null : m;
}

(async () => {
  const argv = process.argv.slice(2);
  const pick = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const onlyTarget = pick('--target');
  const onlyCountry = pick('--country');

  const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  const jobs = [];
  for (const [t, byCountry] of Object.entries(list)) {
    if (t.startsWith('_')) continue;
    if (!TARGETS[t]) throw new Error(`词表里的目标「${t}」不认识（可选：${Object.keys(TARGETS).join(' / ')}）`);
    if (onlyTarget && t !== onlyTarget) continue;
    for (const [c, terms] of Object.entries(byCountry)) {
      if (onlyCountry && c !== onlyCountry) continue;
      for (const term of terms) jobs.push({ t, c, term });
    }
  }
  if (!jobs.length) { console.error('✗ 没有要跑的词（检查 --target / --country）'); process.exit(1); }

  const hist = history();
  const today = new Date().toISOString().slice(0, 10);
  const snap = { at: new Date().toISOString(), note: '近似名次（iTunes Search API），只当趋势看', ranks: {} };

  console.log(`\n关键词名次（近似）· ${today} · ${jobs.length} 个词 · 约 ${Math.ceil(jobs.length * GAP_MS / 60000)} 分钟`);
  let lastGroup = '';
  for (const [i, j] of jobs.entries()) {
    if (i) await sleep(GAP_MS);
    const g = `${j.t} · ${j.c}`;
    if (g !== lastGroup) { console.log(`\n■ ${g}`); lastGroup = g; }
    let res;
    try { res = await rankOf(j.term, j.c, TARGETS[j.t]); }
    catch (e) { console.log(`  ${j.term.padEnd(30)} ✗ ${e.message}`); continue; }
    snap.ranks[key(j.t, j.c, j.term)] = res.rank;

    const past = hist.map((h) => h.d.ranks[key(j.t, j.c, j.term)]).filter((x) => x !== undefined);
    const prev = past.length ? past[past.length - 1] : undefined;
    const med = median([...past.slice(-4), res.rank]);
    let mark = '';
    if (prev !== undefined && tierOf(prev) !== tierOf(res.rank)) mark = `  ← 跨档：${tierOf(prev)} → ${tierOf(res.rank)}`;
    const shown = res.rank == null ? '200+' : `#${res.rank}`;
    console.log(`  ${j.term.padEnd(30)} ${shown.padStart(5)}`
      + `${past.length ? `   近 ${Math.min(past.length + 1, 5)} 次中位 ${med == null ? '200+' : '#' + med}` : ''}`
      + `   第一名：${res.top.slice(0, 26)}${mark}`);
  }

  fs.mkdirSync(SNAPDIR, { recursive: true });
  // 同一天多次跑，后一次覆盖前一次 —— 中位数按「天」算，不按「次」。
  const file = path.join(SNAPDIR, `aso-rank-${today}.json`);
  if (!onlyTarget && !onlyCountry) fs.writeFileSync(file, JSON.stringify(snap, null, 2));
  else {
    // 只跑了一部分：合并进当天的快照，不把别的词抹掉。
    const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { at: snap.at, note: snap.note, ranks: {} };
    Object.assign(cur.ranks, snap.ranks);
    fs.writeFileSync(file, JSON.stringify(cur, null, 2));
  }
  console.log(`\n快照：${path.relative(ROOT, file)}（历史 ${hist.length} 份）`);
  console.log('（近似名次。ASO 的成败看 `node scripts/asc.js sources` 的搜索曝光与 `installs` 的下载。）');
})().catch((e) => { console.error('✗ ' + ((e && e.message) || e)); process.exit(1); });
