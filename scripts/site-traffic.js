#!/usr/bin/env node
/* 官网 belliedmonkey.cc 的访问统计（Vercel Web Analytics）。
 *
 * 为什么要有它：2026-09-24 之前，这份数据只有浏览器里的 dashboard 能看 —— 而看它要
 * 屏幕解锁、窗口在前台、cua-driver 拿到接管已登录 Chrome 的授权，三道门缺一不可。
 * **Hobby 档只留 30 天**，过期的永远补不回来，所以「等有空再看」等于「不看」。
 *
 * 真实端点是 `/v1/query/web-analytics/…`（2026 年公开的）。别再猜 `/v1/web-analytics/stats`
 * 或 `/v1/analytics` 那几个名字 —— 全是 404，我 2026-09-24 一个个试过。
 * 参数名是 **since / until**（ISO），不是 from / to：后者不报错，会被**静默忽略**，
 * 于是你拿到的是「全部历史」而不是你要的窗口，且看不出来。
 *
 * 凭证在 .local/keys.md（gitignored）：vercelToken / vercelProjectCc。
 * ⚠️ Vercel 个人账户（Hobby）**没有只读令牌**，这把钥匙是全权的。
 *
 *   node scripts/site-traffic.js          # 近 7 天
 *   node scripts/site-traffic.js 30       # 近 30 天（Hobby 的上限）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');

function keyOf(name) {
  if (!fs.existsSync(KEYS)) return '';
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : '';
}

const TOKEN = keyOf('vercelToken');
const PROJECT = keyOf('vercelProjectCc');
if (!TOKEN || !PROJECT) {
  console.error('✗ .local/keys.md 里缺 vercelToken 或 vercelProjectCc');
  console.error('  建令牌：https://vercel.com/account/settings/tokens（Hobby 没有只读档，建短期的）');
  process.exit(1);
}

const days = Math.max(1, Math.min(30, Number(process.argv[2] || 7)));
const until = new Date();
const since = new Date(until.getTime() - days * 864e5);
const Q = `projectId=${PROJECT}&since=${since.toISOString()}&until=${until.toISOString()}`;

async function api(pathname, extra = '') {
  const r = await fetch(`https://api.vercel.com/v1/query/web-analytics/${pathname}?${Q}${extra}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${pathname} ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

// 只列我们真的会看的四个维度。`by` 的合法值由服务端给出，写错会 400 并把全表回给你：
// hour day week month year country deviceType environment requestPath referrerHostname osName …
const DIMS = [
  ['按页面', 'requestPath'],
  ['按来源站（空 = 直接打开 / 从 App 跳过来）', 'referrerHostname'],
  ['按国家', 'country'],
  ['按设备', 'deviceType'],
];

(async () => {
  const fmt = (d) => d.toISOString().slice(0, 10);
  console.log(`\n官网 belliedmonkey.cc · 近 ${days} 天（${fmt(since)} → ${fmt(until)}）`);
  console.log('Vercel Web Analytics · Hobby 档只留 30 天\n');

  const total = await api('visits/count');
  const d = total.data || {};
  console.log(`■ 合计   访客 ${d.visitors}   页面浏览 ${d.pageviews}\n`);

  for (const [label, by] of DIMS) {
    const rows = (await api('visits/aggregate', `&by=${by}&limit=12`)).data || [];
    console.log(`■ ${label}`);
    if (!rows.length) { console.log('   （无数据）\n'); continue; }
    for (const r of rows) {
      const name = String(r[by] === '' || r[by] == null ? '（无）' : r[by]).slice(0, 40);
      console.log(`   ${name.padEnd(42)} 访客 ${String(r.visitors).padStart(5)}   浏览 ${String(r.pageviews).padStart(5)}`);
    }
    console.log('');
  }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
