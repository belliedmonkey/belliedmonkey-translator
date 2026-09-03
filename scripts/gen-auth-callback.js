#!/usr/bin/env node
// scripts/gen-auth-callback.js —— 第三方登录的落地页（<站点>/auth/done.html）。
//
// 这一页**什么都不做**：不读 code、不发请求、不碰 Supabase。它只是一个让浏览器能
// 落地的 https 地址 —— 真正取值的是扩展的内容脚本（§8.4.1.1 第二条跨界裁定）。
//
// 为什么需要它：Safari 上 chrome.identity.launchWebAuthFlow 不工作，而 Safari 扩展的
// `safari-web-extension://<UUID>` 源每次重装都轮换，登记不成固定回调地址。托管一个
// 自己的地址是唯一能让三个浏览器走同一条路的办法。
//
// 页面上必须写清楚「没装扩展的人到了这里该怎么办」—— 一个只写「正在完成登录…」的
// 页面，在扩展没装/被禁用时会永远停在那句话上，而那正是这个仓库最怕的形状。
//
//   node scripts/gen-auth-callback.js [--check]

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHECK = process.argv.includes('--check');
const SITES = [
  { dir: path.join(os.homedir(), 'belliedmonkey-cc'), host: 'belliedmonkey.cc', zh: false },
  { dir: path.join(os.homedir(), 'belliedmonkey-com'), host: 'belliedmonkey.com', zh: true },
];

// 与 gen-try-pages.js 同一个取法：版面从该站 setup.html 的 <style> 继承，不抄第二份。
function headStyle(dir) {
  const f = path.join(dir, 'setup.html');
  const src = fs.readFileSync(f, 'utf8');
  const head = src.slice(0, src.indexOf('</head>'));
  const a = head.indexOf('<style');
  const b = head.lastIndexOf('</style>');
  if (a < 0 || b < 0) throw new Error(`gen-auth-callback: ${f} 里找不到 <style>`);
  return head.slice(a, b + '</style>'.length);
}

function render(site) {
  const zh = site.zh;
  const T = {
    title: zh ? '正在完成登录 · 大肚猴翻译' : 'Finishing sign-in · BelliedMonkey Translator',
    h1: zh ? '正在完成登录…' : 'Finishing sign-in…',
    lede: zh
      ? '这一页会自动跳回扩展的设置页。没有跳转的话，说明这个浏览器里没有装大肚猴翻译，或者它被停用了。'
      : 'This page hands the sign-in back to the extension and closes itself. If nothing happens, BelliedMonkey Translator is not installed in this browser, or it is disabled.',
    cta: zh ? '怎么安装 →' : 'How to install →',
    safe: zh
      ? '这一页不读取、也不保存你的任何登录信息 —— 它只是一个落地地址。'
      : 'This page reads and stores nothing about your account — it is only a landing address.',
  };
  return `<!DOCTYPE html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T.title}</title>
<!-- 不进索引：它是一条流程里的中转，独立到达没有意义。 -->
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="/icon.png">
${headStyle(site.dir)}
</head>
<body>
<div class="wrap">
  <nav><a href="/" style="font-weight:700;color:var(--ink)">BelliedMonkey</a></nav>
  <section style="padding-top:56px;max-width:620px">
    <h1>${T.h1}</h1>
    <p class="lede" id="hint">${T.lede}</p>
    <p style="margin-top:22px"><a class="btn" href="/setup.html">${T.cta}</a></p>
    <p class="sub" style="margin-top:28px">${T.safe}</p>
  </section>
  <footer><span>© 2026 BelliedMonkey${zh ? '' : ', LLC'}</span><a href="/">${zh ? '首页' : 'Product'}</a></footer>
</div>
</body>
</html>
`;
}

let changed = 0; const stale = [];
for (const site of SITES) {
  if (!fs.existsSync(site.dir)) { console.log(`  跳过 ${site.host}：${site.dir} 不在`); continue; }
  const outDir = path.join(site.dir, 'auth');
  const file = path.join(outDir, 'done.html');
  const html = render(site);
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (cur === html) continue;
  if (CHECK) { stale.push(path.relative(site.dir, file) + ` (${site.host})`); continue; }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, html);
  changed += 1;
}

if (CHECK) {
  if (stale.length) {
    console.log('✗ 登录落地页与生成器不同步：');
    for (const s of stale) console.log('   ' + s);
    console.log('  跑 node scripts/gen-auth-callback.js');
    process.exit(1);
  }
  console.log('✓ 登录落地页与生成器同步');
} else {
  console.log(`✓ 登录落地页已生成（${changed} 个文件有变化）`);
}
