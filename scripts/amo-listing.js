#!/usr/bin/env node
// scripts/amo-listing.js — 写 AMO 的商店文案（description），单一来源是
// store-assets/amo-listing.md。
//
// 用法：
//   node scripts/amo-listing.js            # 干运行：逐 locale 打印「一致 / 将写入」
//   node scripts/amo-listing.js --apply    # 真写（对外动作，必须显式给）
//   node scripts/amo-listing.js --previews           # 预览图干运行：线上几张 → 换成哪几张、什么顺序
//   node scripts/amo-listing.js --previews --apply   # 真换预览图（先传新图再删旧图，回读核张数与顺序）
//
// 同 asc.js 的分档：默认什么都不做，且**干运行本身就是校验器** —— 全部打印
// 「一致，无需改动」就等于线上与仓库同步。
//
// ── 为什么回读要先归一化 ─────────────────────────────────────────────────
// AMO 的 GET 返回的是**渲染后**的 HTML，不是你 PATCH 进去的原文：
//   · `<a href="https://belliedmonkey.cc">` 会被重写成两百字符的
//     `prod.outgoing.prod.webservices.mozgcp.net/v1/<hash>/http%3A//belliedmonkey.cc`
//   · 裸网址会被自动 linkify
// 所以「PATCH 完 GET 回来比对原文」永远不相等，照着写会得到一个永远报「不一致」
// 的判据 —— 那和永远报「一致」一样没用。判据建立在**去链接后的可见文字**上。
//
// 顺带修的一处线上缺陷：en-US 原本存的是转义过的 `&lt;a href="…"&gt;`，AMO 又把
// 里面的裸网址 linkify 了一次，于是英文商店页上直接显示那串两百字符的跳转地址。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const COPY = path.join(ROOT, 'store-assets', 'amo-listing.md');
const API = 'https://addons.mozilla.org/api/v5';

function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

function jwt() {
  const iss = slot('amo_jwt_issuer');
  const secret = slot('amo_jwt_secret');
  if (!iss || !secret) {
    console.error('✗ .local/keys.md 缺 amo_jwt_issuer / amo_jwt_secret');
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const b = b64({ iss, jti: crypto.randomBytes(8).toString('hex'), iat: now, exp: now + 240 });
  return `${h}.${b}.${crypto.createHmac('sha256', secret).update(h + '.' + b).digest('base64url')}`;
}

// store-assets/amo-listing.md → { locale: description }
function parseCopy(text) {
  const out = {};
  const re = /^## ([\w-]+) · description\n\n```\n([\s\S]*?)\n```/gm;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}

// 去链接 + 反转义 + 压空白。回读比对只在这个形式上做（理由见文件头）。
function visible(html) {
  return String(html || '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 预览图（--previews）────────────────────────────────────────────────────
// 线上预览图换成仓库里渲染的 1280×800 web 帧，顺序与 App Store 一致 —— 直接读
// scripts/asc-media.js 的 ORDER_GLOBAL，不再抄一份顺序（抄的那份就是下一次漂移）。
// AMO 的预览图不分语种，一套英文图。
//
// 先传新图、再删旧图：中途失败时商店页上最多是新旧都在，而不是一张图都没有。
// 2026-09-15 读到的线上状态：6 张、没有说明文字、两张都是 position 0 —— 顺序本来就是乱的，
// 所以回读除了张数与 id，还要核顺序。
function previewFiles() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'asc-media.js'), 'utf8');
  const m = src.match(/const ORDER_GLOBAL = \[([^\]]*)\]/);
  if (!m) { console.error('✗ scripts/asc-media.js 里找不到 ORDER_GLOBAL'); process.exit(1); }
  return m[1].split(',').map((s) => path.join(ROOT, 'store-assets', `en-web-${s.trim()}.png`));
}

async function previews(apply, id, get) {
  const files = previewFiles();
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) { console.error('✗ 缺预览图（先跑 store-assets/src/render.sh）：' + missing.map((f) => path.basename(f)).join(', ')); process.exit(1); }
  const before = await get();
  const old = before.previews || [];
  console.log(`\nAMO ${before.slug || id} · previews`);
  console.log(`  线上 ${old.length} 张 → 换成仓库 ${files.length} 张（顺序同 App Store）`);
  files.forEach((f, i) => console.log(`    ${i}  ${path.basename(f)}`));
  if (!apply) { console.log('\n（干运行。加 --apply 才真换）'); return; }

  const created = [];
  for (let i = 0; i < files.length; i++) {
    const fd = new FormData();
    fd.append('image', new Blob([fs.readFileSync(files[i])], { type: 'image/png' }), path.basename(files[i]));
    fd.append('position', String(i));
    const r = await fetch(`${API}/addons/addon/${id}/previews/`, { method: 'POST', headers: { Authorization: 'JWT ' + jwt() }, body: fd });
    const txt = await r.text();
    if (!r.ok) {
      console.error(`\n✗ 传 ${path.basename(files[i])} 失败 ${r.status}: ${txt.slice(0, 300)}（已传 ${created.length} 张，旧图一张没删）`);
      process.exit(1);
    }
    created.push(JSON.parse(txt).id);
    process.stdout.write('.');
  }
  console.log(` 新图 ${created.length} 张已传`);
  for (const p of old) {
    const r = await fetch(`${API}/addons/addon/${id}/previews/${p.id}/`, { method: 'DELETE', headers: { Authorization: 'JWT ' + jwt() } });
    if (!r.ok && r.status !== 404) { console.error(`\n✗ 删旧图 ${p.id} 失败 ${r.status}（新图都在，线上此时新旧并存）`); process.exit(1); }
  }

  // 回读：张数、id 集合、顺序。POST 返回 201 不是判据（同 ASC 的 204）。
  const after = (await get()).previews || [];
  const ordered = [...after].sort((a, b) => a.position - b.position).map((p) => p.id);
  if (JSON.stringify(ordered) !== JSON.stringify(created)) {
    console.error(`\n✗ 回读不符：线上 ${after.length} 张、按 position 排是 ${JSON.stringify(ordered)}，应为 ${JSON.stringify(created)}`);
    process.exit(1);
  }
  console.log(`\n✓ 预览图已换并回读确认：${after.length} 张，顺序同 App Store`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const id = slot('amo_addon_id');
  if (!id) { console.error('✗ .local/keys.md 缺 amo_addon_id'); process.exit(1); }
  if (!fs.existsSync(COPY)) { console.error('✗ 找不到 ' + COPY); process.exit(1); }

  const want = parseCopy(fs.readFileSync(COPY, 'utf8'));
  const locales = Object.keys(want);
  if (!locales.length) { console.error('✗ 文案文件里一个 locale 都没解析出来 —— 标题格式变了？'); process.exit(1); }

  const get = async () => {
    const r = await fetch(`${API}/addons/addon/${id}/`, { headers: { Authorization: 'JWT ' + jwt() } });
    if (!r.ok) { console.error(`✗ GET ${r.status}: ${(await r.text()).slice(0, 300)}`); process.exit(1); }
    return r.json();
  };
  if (process.argv.includes('--previews')) { await previews(apply, id, get); return; }

  // AMO 的 PATCH 会把 HTML **转义成文字**：写 `<a href>` 进去，商店页上显示的就是
  // 标签本身。所以文案里一个标签都不该有 —— 裸网址由 AMO 自己 linkify。
  const withTags = locales.filter((l) => /<[a-z][^>]*>/i.test(want[l]));
  if (withTags.length) {
    console.error('✗ 文案里有 HTML 标签，AMO 会把它转义成可见文字：' + withTags.join(', '));
    process.exit(1);
  }

  const before = await get();
  const cur = before.description || {};
  console.log(`\nAMO ${before.slug || id} · description`);
  console.log(`  线上 ${Object.keys(cur).length} 个 locale，仓库 ${locales.length} 个\n`);

  const changed = [];
  for (const loc of locales) {
    const same = visible(cur[loc]) === visible(want[loc]);
    if (same) { console.log(`  ${loc.padEnd(6)} 一致，无需改动`); continue; }
    changed.push(loc);
    console.log(`  ${loc.padEnd(6)} ${cur[loc] === undefined ? '缺失 → 新增' : '将写入（与线上不同）'}`);
    if (cur[loc] !== undefined) {
      console.log(`         线上: ${visible(cur[loc]).slice(0, 90)}…`);
      console.log(`         仓库: ${visible(want[loc]).slice(0, 90)}…`);
    }
  }

  if (!changed.length) { console.log('\n✓ 线上与仓库一致，无需改动'); return; }
  if (!apply) { console.log(`\n（干运行：${changed.length} 个 locale 待写。加 --apply 才真写）`); return; }

  const body = {};
  for (const loc of changed) body[loc] = want[loc];
  const r = await fetch(`${API}/addons/addon/${id}/`, {
    method: 'PATCH',
    headers: { Authorization: 'JWT ' + jwt(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: body }),
  });
  const txt = await r.text();
  if (!r.ok) { console.error(`\n✗ PATCH ${r.status}: ${txt.slice(0, 600)}`); process.exit(1); }

  // 回读 —— PATCH 返回 200 不是判据（同 ASC 的 204）。
  const after = await get();
  const now = after.description || {};
  // 两条判据。第二条是 2026-08-30 用一次错误的写入换来的：我把 `<a href>` 写了进去，
  // PATCH 返回 200，内容也确实上线了 —— 只是九个 locale 的页面上多了一行标签源码。
  const escaped = changed.filter((loc) => /&lt;\s*[a-z]/i.test(String(now[loc] || '')));
  const bad = changed.filter((loc) => visible(now[loc]) !== visible(want[loc]));
  if (escaped.length) {
    console.error(`\n✗ AMO 把 HTML 转义成了文字，这些 locale 的页面上会显示标签源码：${escaped.join(', ')}`);
    process.exit(1);
  }
  if (bad.length) {
    console.error(`\n✗ 回读不符：${bad.join(', ')}`);
    for (const loc of bad) console.error(`  ${loc} 线上: ${visible(now[loc]).slice(0, 120)}…`);
    process.exit(1);
  }
  console.log(`\n✓ 已写入并回读确认：${changed.join(', ')}（共 ${Object.keys(now).length} 个 locale）`);
}

main().catch((e) => { console.error('✗ ' + (e && e.message ? e.message : e)); process.exit(1); });
