#!/usr/bin/env node
// scripts/gen-beta-page.js —— 官网上的**内测包**下载页（belliedmonkey.cc/beta.html）。
//
// 为什么要有这一页：官网首页那个下载按钮直链 releases/latest/download/…，它是给
// 用户的。而自己要装一版还没发的包来测时，原来只有两条路：把它发成正式版（会顶掉
// 首页按钮），或者每次去 GitHub 的 release 页面手工找链接。这一页是第三条：一个
// 不进导航、不进索引、只有知道地址的人才到得了的入口。
//
// 三件事是刻意的：
//
// 1. **版面从 setup.html 的 <style> 继承**，不抄第二份配色 —— 同 gen-try-pages.js。
//    抄第二份的那天就是两页开始漂的那天。
// 2. **静态写死的那份是真相，运行时那次 fetch 只是锦上添花。**
//    第一版是反的：靠页面打开时去问 api.github.com，静态那份当兜底 —— 而
//    api.github.com 在国内常常根本请求不到，于是页面永远显示上一个版本，同时还
//    印着「所以这个链接不会停在旧版本」，在它失效的那一刻说了假话
//    （2026-09-02 用户实测：发了 1.7.4，页面还是 1.7.3）。
//    现在：每次发内测由 gh-release.js 调这个生成器把版本钉进 HTML；fetch 带超时，
//    只在**确实问到了更新的版本**时才改写，问不到就什么都不动 —— 静态那份本来就
//    是对的。
// 3. **noindex + 不进 sitemap + 首页不链接它**。它不是产品的一部分。
//
//   node scripts/gen-beta-page.js [--check]

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const SITE = path.join(os.homedir(), 'belliedmonkey-cc');
const REPO = 'belliedmonkey/belliedmonkey-translator';
const ASSET = 'belliedmonkey-translator-chrome.zip';
const CHECK = process.argv.includes('--check');

// 与 gen-try-pages.js 同一个取法：第一个 <style 到 </head> 前最后一个 </style>。
function headStyle() {
  const f = path.join(SITE, 'setup.html');
  const src = fs.readFileSync(f, 'utf8');
  const head = src.slice(0, src.indexOf('</head>'));
  const a = head.indexOf('<style');
  const b = head.lastIndexOf('</style>');
  if (a < 0 || b < 0) throw new Error(`gen-beta-page: ${f} 里找不到 <style>`);
  return head.slice(a, b + '</style>'.length);
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>内测包 · 大肚猴翻译</title>
<!-- 不进索引、不进 sitemap、首页不链接它。这一页不是产品的一部分。 -->
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="/icon.png">
${headStyle()}
<style>
  .beta-badge {
    display: inline-block; border-radius: 999px; padding: 4px 14px;
    font-size: .85rem; font-weight: 600;
    color: var(--pill-pending); background: var(--pill-pending-bg);
  }
  .beta-meta { color: var(--ink-2); font-size: .95rem; margin-top: 10px; }
  .beta-meta code { font-size: .9em; }
  .beta-steps { counter-reset: s; list-style: none; padding: 0; margin-top: 14px; }
  .beta-steps li { counter-increment: s; position: relative; padding-inline-start: 30px; margin-top: 10px; }
  .beta-steps li::before {
    content: counter(s); position: absolute; inset-inline-start: 0; top: 2px;
    width: 21px; height: 21px; border-radius: 999px; text-align: center;
    font-size: .78rem; line-height: 21px; font-weight: 700;
    color: var(--card); background: var(--ink-2);
  }
</style>
</head>
<body>
<div class="wrap">
  <nav><a href="/" style="font-weight:700;color:var(--ink)">BelliedMonkey</a></nav>

  <section style="padding-top:32px;max-width:680px">
    <p><span class="beta-badge">内测版 · 不是正式版</span></p>
    <h1 style="margin-top:14px">内测包下载</h1>
    <p class="lede">这一版还没上架，也没经过完整验证。给自己和愿意帮着试的人装的。
      要稳定的那份请回<a href="/">首页</a>下载 —— 那里始终是正式版。</p>

    <p style="margin-top:26px">
      <a class="btn btn-primary" id="dl"
         href="https://github.com/${REPO}/releases/download/{{TAG}}/${ASSET}">下载内测包 — {{TAG}}（ZIP）</a>
    </p>
    <p class="beta-meta" id="meta">{{TAG}} · 发布于 {{DATE}}</p>

    <h2 style="margin-top:40px;font-size:1.15rem">装法（Chrome / Edge，约一分钟）</h2>
    <ol class="beta-steps">
      <li>解压下载到的 ZIP，得到一个文件夹。<strong>别删它</strong> —— 扩展是从这个文件夹跑的。</li>
      <li>地址栏输 <code>chrome://extensions</code>，右上角打开「开发者模式」。</li>
      <li>点「加载已解压的扩展程序」，选中刚才那个文件夹。</li>
      <li>装过正式版的话，先把它停用 —— 两份同时开着，哪一份在干活没有确定答案。</li>
    </ol>

    <p class="beta-meta" style="margin-top:26px">
      Safari（iOS / macOS）不走这条路，它只能从 App Store 或 TestFlight 装。
    </p>
  </section>

  <footer>
    <span>© 2026 BelliedMonkey, LLC</span>
    <a href="/">首页</a>
    <a href="https://github.com/${REPO}/releases">全部版本</a>
  </footer>
</div>

<script>
/* 去问一次 GitHub 有没有更新的内测包。**这只是锦上添花** —— 上面写死的那份已经是
   对的（发版时由 gh-release.js 钉进来）。所以：带超时，失败什么都不做，也**只在问到
   更新的版本时**才改写。api.github.com 在部分网络下根本请求不到，那种情况下这一页
   仍然完全可用。 */
(function () {
  var dl = document.getElementById('dl'), meta = document.getElementById('meta');
  var pinned = '{{TAG}}';
  // 版本比大小，不是字符串比 —— 'v1.7.10' < 'v1.7.9' 在字符串序下成立。
  function newer(a, b) {
    var pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }
  var ctl = null;
  try { ctl = new AbortController(); setTimeout(function () { ctl.abort(); }, 4000); } catch (_) {}
  fetch('https://api.github.com/repos/${REPO}/releases?per_page=15',
        ctl ? { signal: ctl.signal } : undefined)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (list) {
      if (!Array.isArray(list)) return;
      for (var i = 0; i < list.length; i++) {
        var rel = list[i];
        if (!rel.prerelease || rel.draft) continue;
        if (!newer(rel.tag_name, pinned)) return;      // 不比钉住的新 → 什么都不动
        var a = (rel.assets || []).filter(function (x) { return x.name === ${JSON.stringify(ASSET)}; })[0];
        if (!a) continue;
        dl.href = a.browser_download_url;
        dl.textContent = '下载内测包 — ' + rel.tag_name + '（ZIP）';
        meta.textContent = rel.tag_name + ' · 发布于 '
          + new Date(rel.published_at).toLocaleDateString('zh-CN')
          + ' · ' + Math.round(a.size / 1024) + ' KB';
        return;
      }
    })
    .catch(function () { /* 请求不到就用钉住的那份，它本来就是对的 */ });
})();
</script>
</body>
</html>
`;

const out = path.join(SITE, 'beta.html');
const tag = process.argv.includes('--tag')
  ? process.argv[process.argv.indexOf('--tag') + 1] : null;
if (!tag && !fs.existsSync(out)) {
  console.error('✗ 首次生成要带 --tag v1.7.3（写死的兜底链接）');
  process.exit(1);
}
// 兜底链接：给了 --tag 用它，没给就沿用页面里已有的那个（重跑不会把它改回去）。
const keep = fs.existsSync(out)
  ? (/releases\/download\/(v[^/]+)\//.exec(fs.readFileSync(out, 'utf8')) || [])[1] : null;
const today = new Date().toISOString().slice(0, 10);
// 日期同样钉住：没有它，「发布于」那一行在没网时就没东西可说。重跑生成器而 tag 没变
// 时沿用页面里已有的日期，免得一次无关的重跑把发布日改成今天。
const keepDate = fs.existsSync(out)
  ? (/· 发布于 (\d{4}-\d{2}-\d{2})/.exec(fs.readFileSync(out, 'utf8')) || [])[1] : null;
const body = html.replace(/\{\{TAG\}\}/g, tag || keep)
  .replace(/\{\{DATE\}\}/g, tag && tag !== keep ? today : (keepDate || today));

if (CHECK) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  if (cur !== body) { console.log('✗ beta.html 与生成器不同步 —— 跑 node scripts/gen-beta-page.js'); process.exit(1); }
  console.log('✓ beta.html 与生成器同步');
} else {
  fs.writeFileSync(out, body);
  console.log(`✓ 已生成 ${out}（兜底 tag ${tag || keep}）`);
}
