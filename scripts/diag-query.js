#!/usr/bin/env node
// scripts/diag-query.js — 诊断信箱查询（§0.4.1 L2：上报到自有后端，排障自己查）。
// 用法：
//   npm run diag:latest            # 每个 install 的最新一包 + 最近事件摘要
//   npm run diag:dump -- <uuid>    # 某个 install 的全部事件（完整 JSON）
// 走 SSH 直连中国库（root@49.233.0.7，密钥 ~/.ssh/tencent_bt.key）；东京库建表后加 --tokyo。
'use strict';
const { execFileSync } = require('child_process');

const KEY = `${process.env.HOME}/.ssh/tencent_bt.key`;

// ssh 的远端命令必须是一个参数（execFileSync 不经本地 shell 拆词）；SQL 用 JSON.stringify
// 双引号包裹，远端 shell 原样交给 psql -c。
const q = (sql) => execFileSync('ssh', ['-i', KEY, '-o', 'IdentitiesOnly=yes', 'root@49.233.0.7',
  `cd /opt/bt/deploy/china && docker compose exec -T db psql -U postgres -At -c ${JSON.stringify(sql)}`],
  { encoding: 'utf8', timeout: 30000 });

const arg = process.argv[2];
try {
  if (arg === 'dump') {
    const id = process.argv[3];
    if (!/^[0-9a-f-]{10,40}$/i.test(id || '')) { console.error('用法: npm run diag:dump -- <install_uuid>'); process.exit(1); }
    const rows = q(`select created_at, events from bt_diag_events where install_id='${id}' order by created_at desc limit 20`);
    for (const line of rows.trim().split('\n').filter(Boolean)) {
      const [at, ...rest] = line.split('|');
      console.log(`\n═══ ${at} ═══`);
      try {
        const ev = JSON.parse(rest.join('|'));
        for (const e of (ev.entries || [])) console.log(new Date(e.t).toISOString(), e.k, JSON.stringify(e.f));
      } catch (_) { console.log(rest.join('|').slice(0, 400)); }
    }
  } else {
    const rows = q(`select install_id, max(created_at), count(*), (array_agg(app_version order by created_at desc))[1], (array_agg(flavor order by created_at desc))[1] from bt_diag_events group by install_id order by max(created_at) desc limit 10`);
    console.log('install                              最近上报            包数  版本    flavor');
    for (const line of rows.trim().split('\n').filter(Boolean)) {
      console.log(line.split('|').join('  '));
    }
    const last = q(`select events->'entries' from bt_diag_events order by created_at desc limit 1`);
    const entries = JSON.parse(last.trim());
    console.log(`\n最新一包的末 8 条：`);
    for (const e of (entries || []).slice(-8)) console.log(new Date(e.t).toISOString(), e.k, JSON.stringify(e.f));
  }
} catch (e) {
  console.error('✗ 查询失败：', e.message.split('\n')[0]);
  process.exit(1);
}
