#!/usr/bin/env node
// scripts/grant-float.js — 免费额度的巡检（docs/learning-design.md §8.10）。
//
//   node scripts/grant-float.js            # 只读：池子、领取数、花费、中继回读
//   node scripts/grant-float.js --sweep    # 顺便清掉 90 天以外的流水（cron 的兜底）
//
// 为什么要有它：额度是**我们的钱**，而唯一会告诉我们「花超了」的东西是账单。
// 池子低于 GRANT_FLOAT_MIN_USD 时中继会自己停下并对用户说「不是你用完了」，
// 但那时用户已经撞上了 —— 每周跑一次这个脚本是为了在那之前补钱。
//
// 三个读回判据（不是「没报错」）：
//   1. 池子余额高于停转发底线（`GRANT_FLOAT_MIN_USD`，现在是 5 美元）。低于它，
//      中继对**所有人**回 503「不是你用完了」—— 这是保护，不是故障，但你得先知道。
//   2. 中继 /spec 钉住的模型 == 注册表里 grant 条目的 defaultModel（两处一致）
//   3. 30 天花费 < 已领取数 × limit（大于就是记账错了，不是用得多）

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const SWEEP = process.argv.includes('--sweep');

function slots() {
  if (!fs.existsSync(KEYS)) die('.local/keys.md 不存在');
  const out = {};
  for (const line of fs.readFileSync(KEYS, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && m[2] && !/^<|^\.\.\.|^TODO/i.test(m[2])) out[m[1]] = m[2];
  }
  return out;
}
function die(msg) { console.error('✗ ' + msg); process.exit(1); }
function limitUsd() {
  try { return Number(backend().grant && backend().grant.limitUsd) || 0.2; } catch { return 0.2; }
}
const usd = (n) => '$' + Number(n).toFixed(2);

// backend.config.js 是「用哪个后端」的唯一来源（learning-design §8.4.1）——
// 这里也读它，不另写一个地址。
function backend() {
  const src = fs.readFileSync(path.join(ROOT, 'extension', 'learn', 'backend.config.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}

async function main() {
  const k = slots();
  const be = backend();
  const service = k.supabase_service_key;
  const orKey = k.key_openrouter_grant;

  console.log('免费额度巡检 · ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
  console.log('后端 ' + be.url);
  console.log('');

  // ── 1. 池子（我们在提供方那边还剩多少钱）
  if (!orKey) {
    console.log('池子      ？ —— .local/keys.md 缺 key_openrouter_grant');
    console.log('          去 https://openrouter.ai/settings/keys 建一把普通 key（不设 limit），');
    console.log('          充值在 https://openrouter.ai/settings/credits');
  } else {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: 'Bearer ' + orKey },
      });
      const d = await r.json();
      const total = Number(d?.data?.total_credits ?? 0);
      const used = Number(d?.data?.total_usage ?? 0);
      const left = total - used;
      // 20 美元 = 100 人份，是「不用惦记」的线；5 美元是中继自己停下的底线。
      const mark = left >= 20 ? '✓' : left >= 5 ? '⚠' : '✗';
      console.log(`池子      ${mark} 剩 ${usd(left)}（充值 ${usd(total)} · 已用 ${usd(used)}）`
        + ` ≈ ${Math.floor(left / limitUsd())} 人份`);
      if (left < 5) console.log('          低于底线 —— 中继现在对所有人回 503「不是你用完了」，该补钱了');
      else if (left < 20) console.log(`          还能撑 ${Math.floor((left - 5) / limitUsd())} 人；跌到 $5 中继就会自己停下`);
      console.log('          ⚠ 这把 key 和你日常翻译用的是同一把（keys.md 有记）——');
      console.log('            这个读数是**整个账号**的余额，你自己花的也算在里面。');
      console.log('            免费额度单独花了多少，看下面「花费」那一行。');
    } catch (e) { console.log('池子      ✗ 读不到：' + e.message); }
  }

  // ── 2. 领取与花费（我们的库）
  if (!service) {
    console.log('额度      ？ —— .local/keys.md 缺 supabase_service_key');
    console.log('          在 Supabase → Project Settings → API → service_role（secret）');
  } else {
    const rpc = async (fn, args) => {
      const r = await fetch(`${be.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      });
      if (!r.ok) throw new Error(fn + ' HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
      return r.json();
    };
    try {
      const rows = await rpc('bt_grant_stats');
      const s = Array.isArray(rows) ? rows[0] : rows;
      const limit = Number(be.grant && be.grant.limitUsd) || 0.2;
      const ceiling = Number(s.grants) * limit;
      console.log(`额度      ${s.grants} 枚已领（${s.active} 枚有效，今天 ${s.claimed_today} 枚）`);
      console.log(`花费      累计 ${usd(s.spent_total)} / 上限 ${usd(ceiling)} · 近 30 天 ${usd(s.spent_30d)}`);
      if (Number(s.spent_total) > ceiling + 0.01) {
        console.log('          ✗ 花费超过「已领取数 × 单人上限」—— 记账错了，不是用得多');
      }
      if (SWEEP) {
        const r = await fetch(`${be.url}/rest/v1/bt_grant_usage?at=lt.${new Date(Date.now() - 90 * 864e5).toISOString()}`, {
          method: 'DELETE',
          headers: { apikey: service, Authorization: 'Bearer ' + service, Prefer: 'return=minimal' },
        });
        console.log('清扫      ' + (r.ok ? '✓ 90 天以外的流水已删' : '✗ HTTP ' + r.status));
      }
    } catch (e) { console.log('额度      ✗ ' + e.message); }
  }

  // ── 3. 中继回读：钉住的模型必须与注册表逐字相同
  try {
    const r = await fetch(`${be.url}/functions/v1/bt-relay/spec`);
    if (!r.ok) { console.log('中继      ✗ /spec HTTP ' + r.status); }
    else {
      const spec = await r.json();
      console.log('中继      ✓ 钉住 ' + Object.entries(spec.models || {}).map(([k, v]) => k + '=' + v).join(' · '));
      const want = registryModels();
      for (const [slot, model] of Object.entries(want)) {
        if (!model) continue;
        const got = (spec.models || {})[slot];
        if (got !== model) {
          console.log(`          ✗ ${slot}：注册表说 ${model}，中继钉的是 ${got || '（没有）'}`);
          console.log('            客户端显示的和服务端执行的不是一回事 —— 改 GRANT_MODELS 或改注册表');
        }
      }
    }
  } catch (e) { console.log('中继      ✗ ' + e.message); }
}

// 注册表里 grant 三个条目的 defaultModel（G3 之前还没有，返回空对象）。
function registryModels() {
  const out = {};
  const files = { chat: 'providers.config.js', tts: 'tts.config.js', stt: 'stt.config.js' };
  for (const [slot, f] of Object.entries(files)) {
    const p = path.join(ROOT, 'build', f);
    if (!fs.existsSync(p)) continue;
    try {
      const list = require(p);
      const arr = Array.isArray(list) ? list : (list.PROVIDERS || list.ENGINES || list.default || []);
      const hit = (Array.isArray(arr) ? arr : []).find((e) => e && e.id === 'grant');
      if (hit) out[slot] = hit.defaultModel;
    } catch { /* 注册表还没加 grant 条目 —— G3 的事 */ }
  }
  return out;
}

main().catch((e) => die(e.stack || e.message));
