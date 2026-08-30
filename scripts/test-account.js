#!/usr/bin/env node
// scripts/test-account.js — 测试账号的一键重置 / 播种。
//
//   node scripts/test-account.js status                # 服务端现状（只读）
//   node scripts/test-account.js login --send          # 发一封验证码到测试邮箱
//   node scripts/test-account.js login --code 123456   # 验证并存下 refresh token（一次性）
//   node scripts/test-account.js reset                 # 干运行
//   node scripts/test-account.js reset --apply         # 真的清空
//   node scripts/test-account.js seed [张数]           # 干运行
//   node scripts/test-account.js seed 120 --apply      # 真的播种
//
// ── 为什么用账号自己的 JWT 而不是 service key ──────────────────────────────
//
// service key 能改任何人的行；这个脚本只需要改一个账号的。用测试账号自己的 token，
// RLS 会把它**在服务端**限制在自己的行上 —— 也就是说「误删主账号」不是靠我小心，
// 是靠数据库拒绝。仓库里刻意没存 service key，这条不打算改。
//
// 代价是要登录一次。登录之后存的是 refresh token（脚本自己续期），所以只有第一次
// 需要验证码 —— 重置与播种从此无人值守。
//
// ── 两道守卫 ──────────────────────────────────────────────────────────────
//
// 1. 邮箱白名单：token 解出来的 email 必须是测试账号。不是就拒绝，连只读都不给 ——
//    一把放错槽位的主账号 token 会让 `reset --apply` 变成一次真实的数据丢失。
// 2. 破坏性动作默认干运行，且做完必须回读。
//
// ⚠️ 这个脚本只清**服务端**。设备本地的 IndexedDB 要在 App／扩展里清，或删应用重装。
//    「全新用户」这件事在两边各有一半。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const SLOT = 'supabase_test_refresh_token';
const TEST_EMAIL = 'belliedmonkey.en@gmail.com';

const BACKEND = require(path.join(ROOT, 'extension/learn/backend.config.js'));
const URL_BASE = BACKEND.url;
const ANON = BACKEND.anonKey;

function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}
function saveSlot(name, value) {
  const line = `${name} = ${value}`;
  let txt = fs.existsSync(KEYS) ? fs.readFileSync(KEYS, 'utf8') : '';
  if (new RegExp('^' + name + '[^\\S\\n]*=', 'm').test(txt)) {
    txt = txt.replace(new RegExp('^' + name + '[^\\S\\n]*=.*$', 'm'), line);
  } else {
    txt += (txt.endsWith('\n') ? '' : '\n') + line + '\n';
  }
  fs.writeFileSync(KEYS, txt);
}

// JWT 的 payload。**只用来读 email 做守卫**，不做任何验签 —— 验签是服务端的事，
// 这里要防的是「人把错的 token 贴进了槽位」，不是伪造。
function jwtEmail(accessToken) {
  try {
    const p = JSON.parse(Buffer.from(String(accessToken).split('.')[1], 'base64url').toString('utf8'));
    return String(p.email || '').toLowerCase();
  } catch (_) { return ''; }
}

async function api(pathname, init) {
  const r = await fetch(URL_BASE + pathname, Object.assign({}, init, {
    headers: Object.assign({ apikey: ANON, 'Content-Type': 'application/json' }, (init && init.headers) || {}),
  }));
  const text = await r.text();
  let d = null; try { d = text ? JSON.parse(text) : null; } catch (_) { /* 非 JSON 也要留住原文 */ }
  return { ok: r.ok, status: r.status, body: d, raw: text };
}

// 用 refresh token 换一个新的 access token。Supabase 的 refresh token 是**轮转**的：
// 用过就换新的，所以每次都要把新的存回去 —— 不存，下一次就用不了了。
async function session() {
  const rt = slot(SLOT);
  if (!rt) {
    console.error(`✗ .local/keys.md 里没有 ${SLOT}`);
    console.error('  先跑一次：node scripts/test-account.js login --send');
    process.exit(1);
  }
  const r = await api('/auth/v1/token?grant_type=refresh_token',
    { method: 'POST', body: JSON.stringify({ refresh_token: rt }) });
  if (!r.ok) {
    console.error(`✗ 续期失败 ${r.status}：${(r.body && (r.body.error_description || r.body.msg)) || r.raw.slice(0, 160)}`);
    console.error('  refresh token 可能过期了，重新登录一次：node scripts/test-account.js login --send');
    process.exit(1);
  }
  if (r.body.refresh_token && r.body.refresh_token !== rt) saveSlot(SLOT, r.body.refresh_token);
  const email = jwtEmail(r.body.access_token);
  if (email !== TEST_EMAIL) {
    console.error(`✗ **守卫拦下**：这个 token 属于 ${email || '(读不出邮箱)'}，不是测试账号 ${TEST_EMAIL}`);
    console.error('  这个脚本只对测试账号动手。放错槽位的 token 不会被用来删任何东西。');
    process.exit(1);
  }
  return { token: r.body.access_token, email, userId: r.body.user && r.body.user.id };
}

const auth = (t) => ({ Authorization: 'Bearer ' + t });

async function cmdLogin(argv) {
  if (argv.includes('--send')) {
    const r = await api('/auth/v1/otp', { method: 'POST', body: JSON.stringify({ email: TEST_EMAIL, create_user: true }) });
    if (!r.ok) { console.error(`✗ 发送失败 ${r.status}：${r.raw.slice(0, 200)}`); process.exit(1); }
    console.log(`  ✓ 验证码已发往 ${TEST_EMAIL}`);
    console.log('  收到后跑：node scripts/test-account.js login --code <六位码>');
    return;
  }
  const i = argv.indexOf('--code');
  if (i < 0) { console.error('用法: login --send | login --code <六位码>'); process.exit(1); }
  const code = argv[i + 1];
  const r = await api('/auth/v1/verify', { method: 'POST', body: JSON.stringify({ type: 'email', email: TEST_EMAIL, token: code }) });
  if (!r.ok) { console.error(`✗ 验证失败 ${r.status}：${(r.body && (r.body.error_description || r.body.msg)) || r.raw.slice(0, 160)}`); process.exit(1); }
  const email = jwtEmail(r.body.access_token);
  if (email !== TEST_EMAIL) { console.error(`✗ 验证回来的账号是 ${email}，不是测试账号 —— 不存`); process.exit(1); }
  saveSlot(SLOT, r.body.refresh_token);
  console.log(`  ✓ 已登录 ${email}，refresh token 存进 .local/keys.md 的 ${SLOT}（长度 ${r.body.refresh_token.length}）`);
  console.log('  以后重置与播种都不再需要验证码。');
}

async function chunkRows(s) {
  const r = await api('/rest/v1/bt_chunks?select=seq,kind,generation,created_at&order=seq.asc', { headers: auth(s.token) });
  if (!r.ok) { console.error(`✗ 读取失败 ${r.status}：${r.raw.slice(0, 160)}`); process.exit(1); }
  return r.body || [];
}

async function cmdStatus() {
  const s = await session();
  const rows = await chunkRows(s);
  console.log(`\n■ ${s.email}`);
  console.log(`  user id      ${s.userId}`);
  console.log(`  chunk 行数   ${rows.length}`);
  if (rows.length) {
    const by = {};
    for (const r of rows) by[r.kind] = (by[r.kind] || 0) + 1;
    console.log(`  按 kind      ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`  最早         ${rows[0].created_at}`);
    console.log(`  最新         ${rows[rows.length - 1].created_at}`);
    console.log('\n  → 这是一个**有数据的账号**。要变成全新用户跑 reset --apply。');
  } else {
    console.log('\n  → 服务端是空的：登录后同步下来会是一个**全新用户**。');
    console.log('  （设备本地的 IndexedDB 不在这里，要另外清 —— 见文件头。）');
  }
}

async function cmdReset(argv) {
  const apply = argv.includes('--apply');
  const s = await session();
  const rows = await chunkRows(s);
  console.log(`\n■ ${s.email}  现有 ${rows.length} 条 chunk`);
  if (!rows.length) { console.log('  已经是空的，无需操作。'); return; }
  if (!apply) {
    console.log(`  将删除全部 ${rows.length} 条（干运行；加 --apply 才真删）`);
    return;
  }
  // RLS 已经把范围限死在自己的行上，这里的 gt.0 只是「全部」的写法。
  const r = await api('/rest/v1/bt_chunks?seq=gt.0', { method: 'DELETE', headers: auth(s.token) });
  if (!r.ok) { console.error(`✗ 删除失败 ${r.status}：${r.raw.slice(0, 200)}`); process.exit(1); }
  const left = await chunkRows(s);          // 回读。DELETE 成功不等于删干净了。
  console.log(`  已删除 ${rows.length} 条，回读剩余 ${left.length} 条 ${left.length === 0 ? '✓' : '✗ 没删干净！'}`);
  if (left.length) process.exit(1);
  console.log('\n  → 服务端已清空。设备端请在 App／扩展里清本地库，或删应用重装。');
}

async function cmdSeed(argv) {
  const apply = argv.includes('--apply');
  const n = Number(argv.find((a) => /^\d+$/.test(a))) || 120;
  const seedArg = argv.indexOf('--seed');
  const seed = seedArg > -1 ? Number(argv[seedArg + 1]) : 1;

  const { buildCorpus } = require('./lib/seed-corpus.js');
  const Chunk = require(path.join(ROOT, 'extension/learn/chunk.js'));
  const now = Date.now();
  const c = buildCorpus({ count: n, seed, now });
  const bundle = Chunk.build(c.cards, c.sources, c.reviews, now, [], null);
  const bytes = await Chunk.deflate(Chunk.toJsonl(bundle));

  const by = {};
  for (const x of c.cards) by[x.state] = (by[x.state] || 0) + 1;
  const due = c.cards.filter((x) => x.sched && x.sched.dueAt <= now).length;
  console.log(`\n■ 语料（seed ${seed}，可复现）`);
  console.log(`  卡片 ${c.cards.length}：${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  来源 ${c.sources.length} · 复习记录 ${c.reviews.length} · 今天到期 ${due}`);
  console.log(`  压缩后 ${bytes.length} 字节`);

  const s = await session();
  const before = await chunkRows(s);
  if (!apply) {
    console.log(`\n  将向 ${s.email} 追加 1 条 chunk（现有 ${before.length} 条）。干运行；加 --apply 才真写。`);
    console.log('  提示：要「全新账号 + 一份语料」，先 reset --apply 再 seed --apply。');
    return;
  }
  const hex = '\\x' + Buffer.from(bytes).toString('hex');
  const r = await api('/rest/v1/bt_chunks', {
    method: 'POST',
    headers: Object.assign(auth(s.token), { Prefer: 'return=representation' }),
    body: JSON.stringify({ kind: 'bundle', blob: hex, generation: 0 }),
  });
  if (!r.ok) { console.error(`✗ 写入失败 ${r.status}：${r.raw.slice(0, 200)}`); process.exit(1); }
  const after = await chunkRows(s);
  console.log(`\n  已写入。chunk ${before.length} → ${after.length} ${after.length === before.length + 1 ? '✓' : '✗ 数目不对！'}`);
  if (after.length !== before.length + 1) process.exit(1);
  console.log('  → 在设备上登录该账号并同步，就会拉到这份语料。');
}

module.exports = { TEST_EMAIL, jwtEmail, SLOT };

const argv = process.argv.slice(2);
const cmd = argv[0];
const run = require.main === module
  ? { status: cmdStatus, login: () => cmdLogin(argv), reset: () => cmdReset(argv), seed: () => cmdSeed(argv) }[cmd]
  : (() => {});
if (require.main !== module) { /* 被 require 时只导出，不执行 */ } else if (!run) {
  console.log('用法: node scripts/test-account.js <status|login|reset|seed> [...]');
  console.log(`  测试账号固定为 ${TEST_EMAIL} —— 守卫会拒绝任何别的账号`);
  process.exit(cmd ? 1 : 0);
}
if (require.main === module) run().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
