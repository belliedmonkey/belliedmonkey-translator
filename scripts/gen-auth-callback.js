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
    lede: zh ? '正把登录结果交回扩展…' : 'Handing the sign-in back to the extension…',
    // 这一页**能知道**扩展在不在（内容脚本会在 <html> 上打 data-mt-extension），
    // 所以不许猜。2026-09-03 用户在 Safari iOS 上就卡在原来那句「如果没反应，
    // 可能是没装或被停用」——两种猜测，一个都没帮到他。
    noExt: zh
      ? '这个浏览器里没有检测到大肚猴翻译。Safari 需要你**允许它在这个网站上运行**：点地址栏左边的「ぇA」→ 扩展 → 大肚猴翻译 → 允许。允许之后刷新这一页即可。'
      : 'BelliedMonkey Translator was not detected in this browser. Safari needs you to allow it on this site: tap “ぇA” in the address bar → Extensions → BelliedMonkey Translator → Allow, then reload this page.',
    stuck: zh
      ? '扩展在，但这一页没能把结果交回去。把下面这串复制到设置页的登录区，也能完成登录：'
      : 'The extension is here but this page could not hand the result back. Copy the string below into the sign-in area of Settings to finish:',
    reload: zh ? '刷新这一页' : 'Reload this page',
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

    <!-- 三支，由页面自己判定，见下面的脚本。默认全隐藏：默认显示任何一支都是猜。 -->
    <div id="no-ext" hidden>
      <p class="lede">${T.noExt}</p>
      <p style="margin-top:18px"><a class="btn" href="/setup.html">${T.cta}</a>
        &nbsp;<a class="btn" href="" onclick="location.reload();return false">${T.reload}</a></p>
    </div>
    <div id="stuck" hidden>
      <p class="lede">${T.stuck}</p>
      <p><code id="ticket" style="word-break:break-all;font-size:.85em"></code></p>
    </div>

    <p class="sub" style="margin-top:28px">${T.safe}</p>
  </section>
  <footer><span>© 2026 BelliedMonkey${zh ? '' : ', LLC'}</span><a href="/">${zh ? '首页' : 'Product'}</a></footer>
</div>

<script>
/* 这一页有三种结局，它**分得清**是哪一种，所以不许说「可能是 A 也可能是 B」：
     ① 扩展接住了 → 这一页会被导航走，下面的计时器根本不会跑到
     ② 没检测到扩展 → 说清楚 Safari 要按站点授权（iOS 上这是最常见的一种）
     ③ 扩展在、却没接住 → 把票显示出来，让用户手工完成
   ③ 里把 code 显示给用户是**安全的**，理由与它能过内容脚本是同一条：
   没有只存在扩展那一侧的 code_verifier，这串东西换不出任何东西。 */
(function () {
  var q = new URLSearchParams(location.search);
  var code = q.get('code'), state = q.get('state');
  if (!code) return;                       // 不是回调，什么都不做
  setTimeout(function () {
    var has = !!document.documentElement.dataset.mtExtension;
    document.getElementById('hint').hidden = true;
    if (!has) { document.getElementById('no-ext').hidden = false; return; }
    document.getElementById('ticket').textContent = code + '.' + (state || '');
    document.getElementById('stuck').hidden = false;
  }, 3000);
})();
</script>
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
