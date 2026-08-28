#!/usr/bin/env node
// scripts/store-stats.js — 六个发布面的「有多少人在用」，一条命令读回来。
//
// 2026-08-28：查 Supabase 里那 40 个账号时才发现，**装机量这件事我们一直没看过**，
// 而其中两个面根本不需要新建任何东西：
//
//   · GitHub Release —— 每个 asset 自带 download_count，`gh` 的 token 已经在钥匙串里
//   · Firefox AMO   —— average_daily_users / weekly_downloads / ratings 就在
//                       amo-publish.js 早就在请求的那个 JSON 里，以前被丢掉了
//
// 这个脚本只读、不改任何东西，也**不新增任何采集**：读的是商店给运营者的数据，
// 不是用户给我们的数据（AGENTS.md 规则 4 禁的是后者）。
//
// 读不到的两个面，明说而不是留空：
//   · Chrome Web Store —— Google 不提供任何用户数/曝光/转化端点，只有后台和 CSV（#176）
//   · Apple App Store  —— analyticsReports 要走 report-request 三段式且依赖 key 角色；
//                          Supabase 侧的账号与同步量走 bt-supabase MCP，
//                          service key 刻意不落盘
//
// 用法: node scripts/store-stats.js [--json]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');

// 与 amo-publish.js 同款槽位读取：`[^\S\n]*` 而不是 `\s*`，空槽位不许跨行吃下一个字段名。
function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

async function github() {
  // gh 的 token 在 macOS 钥匙串里，这里不碰凭证本身。
  let raw;
  try {
    raw = execFileSync('gh', ['api', 'repos/:owner/:repo/releases', '--paginate',
      '--jq', '.[] | {tag: .tag_name, at: .published_at, dl: ([.assets[].download_count] | add // 0)}'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return { ok: false, why: 'gh 不可用或未登录：' + String(e.stderr || e.message).split('\n')[0] };
  }
  const rows = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { ok: true, releases: rows.length, total: rows.reduce((a, r) => a + r.dl, 0), rows };
}

async function amo() {
  const id = slot('amo_addon_id');
  if (!id) return { ok: false, why: '.local/keys.md 缺 amo_addon_id' };
  // 这个端点是公开的 —— 读装机量不需要 JWT。
  const r = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/`);
  if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
  const d = await r.json();
  return {
    ok: true, id, status: d.status,
    version: (d.current_version || {}).version || null,
    dau: d.average_daily_users ?? null,
    weekly: d.weekly_downloads ?? null,
    ratings: d.ratings || {},
  };
}

(async () => {
  const [gh, mo] = await Promise.all([github(), amo()]);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ at: new Date().toISOString(), github: gh, amo: mo }, null, 2));
    return;
  }

  console.log('\n各面使用数据 · ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z\n');

  console.log('GitHub Release（官网直装 ZIP 走的就是这条）');
  if (!gh.ok) { console.log('  ✗ ' + gh.why); } else {
    console.log(`  累计下载 ${gh.total} 次，跨 ${gh.releases} 个 release`);
    for (const r of gh.rows.slice(0, 8)) {
      console.log(`    ${r.tag.padEnd(9)} ${r.at.slice(0, 10)}  ${String(r.dl).padStart(3)}`);
    }
    if (gh.rows.length > 8) console.log(`    …其余 ${gh.rows.length - 8} 个`);
  }

  console.log('\nFirefox AMO');
  if (!mo.ok) { console.log('  ✗ ' + mo.why); } else {
    const rt = mo.ratings || {};
    console.log(`  ${mo.id}  状态 ${mo.status}  线上 ${mo.version}`);
    console.log(`  日活 ${mo.dau}   周下载 ${mo.weekly}   `
      + `评分 ${rt.count ? `${rt.average} × ${rt.count} 条` : '暂无'}`);
  }

  console.log('\nChrome Web Store');
  console.log('  — 无 API。用户数/曝光/转化只有开发者后台和 CSV 导出（见 #176）。');
  console.log('\nApple App Store · Supabase');
  console.log('  — 不在本脚本里：ASC analyticsReports 要走 report-request 三段式且依赖 key 角色；');
  console.log('    账号与同步量走 bt-supabase MCP（service key 刻意不落盘）。');
  console.log('');
})();
