#!/usr/bin/env node
// scripts/gen-try-pages.js — 生成官网的「现在翻一页看看」试翻页，按**目标语言**分页。
//
// 先例：guide.html 的引擎表也是从这个仓库生成进站点仓库的（scripts/lib/guide-render.js）。
// 同一个理由：数据的唯一来源在这边（build/try-pages.config.js），站点不该持有第二份。
//
// 与站点现有的 8 个 locale 目录**不是一个维度**：那些是界面语言（跟随浏览器），
// 这些是目标语言（用户在扩展里选的翻译目标）。两者正交，混在一页里会互相污染 ——
// 一个界面用中文、把英文翻成日文的人，两边都对，而单页做不到。
//
// 页面上的「下一步：登录并同步到 App」是一个**空容器**，文案与按钮由扩展的内容脚本
// 填（content-main.js 的 MT_SITES 分支）。两个理由：
//   1. 它跟随用户在**扩展里**选的界面语言（11 份），而不是站点的 8 份；
//   2. 没装扩展时它不可能出现 —— 空容器里什么都没有，不需要额外的判断。
//
//   node scripts/gen-try-pages.js [--check]
//
// --check 只比对不写盘，供门禁调用。

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const { PASSAGES, TARGETS } = require(path.join(ROOT, 'build/try-pages.config.js'));

const CHECK = process.argv.includes('--check');

// 两个站点仓库。中国版只出目标语言为中文的那一页 —— 那个 flavor 的用户目标语言
// 几乎必然是中文，而多出来的 11 页没有任何人会到达。
const SITES = [
  { dir: path.join(os.homedir(), 'belliedmonkey-cc'), host: 'belliedmonkey.cc',
    targets: TARGETS.map((t) => t.code), i18n: true },
  { dir: path.join(os.homedir(), 'belliedmonkey-com'), host: 'belliedmonkey.com',
    targets: ['zh-CN'], i18n: false },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 两个站都是**每页内联样式**，没有公共 CSS 文件。所以这里不写第二份排版，而是把该站
// setup.html 的 <head> 样式段原样搬过来 —— 它改了，重跑生成器就跟着改；写第二份的
// 那天就是两页开始漂的那天（这个仓库为「抄第二份」付过好几次代价了）。
// 取值范围是第一个 <style 到 </head> 之前的最后一个 </style>，中间夹着 cc 的 i18n
// 防白屏遮罩（style + script + noscript），一并带走正是我们要的。
function headStyle(site) {
  const f = path.join(site.dir, 'setup.html');
  const src = fs.readFileSync(f, 'utf8');
  const head = src.slice(0, src.indexOf('</head>'));
  const a = head.indexOf('<style');
  const b = head.lastIndexOf('</style>');
  if (a < 0 || b < 0) throw new Error(`gen-try-pages: ${f} 里找不到 <style> —— 排版没法继承，不生成`);
  return head.slice(a, b + '</style>'.length);
}

// 站点两边的排版令牌不同（cc 有一套 CSS 变量，com 是手写中文站），所以页面只用
// 两站都有的类：.wrap / .kicker / .lede / .sub / .howto / footer。
function render(site, target) {
  const row = TARGETS.find((t) => t.code === target);
  const src = PASSAGES[row.src];
  const zh = !site.i18n;                       // 中国版站点没有 i18n，文案直接写中文
  const i18n = (key, text) => (site.i18n ? ` data-i18n="${key}"` : '') + '>' + text;
  const paras = src.paras.map((p, i) => `      <p${i ? ' style="margin-top:12px"' : ''}>${esc(p)}</p>`).join('\n');

  const title = zh ? '翻一页看看 · 大肚猴翻译' : 'Try it on a page · BelliedMonkey Translator';
  const h1 = zh ? '就在这一页试试' : 'Try it right here';
  // 「下面这段是英文」这句必须按**这一页的源语言**说对。原来站点上那句话在每一种
  // 界面语言里都写死了「英文」，而目标是英文的那一页源文是中文 —— 照抄就是假话。
  const ledeKey = row.src === 'en' ? 'try.ledeEn' : 'try.ledeZh';
  const ledeEn = row.src === 'en'
    ? 'The paragraph below is in English. Tap the floating button at the bottom right; it should turn bilingual immediately.'
    : 'The paragraph below is in Chinese. Tap the floating button at the bottom right; it should turn bilingual immediately.';
  const ledeZh = row.src === 'en'
    ? '下面这段是英文。点页面右下角的悬浮按钮，它应该立刻变成双语对照。'
    : '下面这段是中文。点页面右下角的悬浮按钮，它应该立刻变成双语对照。';
  const waitEn = 'This page has not detected the extension yet. Turn it on first, then come back — it updates by itself.';
  const waitZh = '这一页还没检测到扩展。先把它打开，再回到这里 —— 页面会自己更新，不用刷新。';
  const waitCtaEn = 'How to turn it on →';
  const waitCtaZh = '怎么打开 →';

  const nav = site.i18n
    ? `  <nav>
    <a href="/" style="font-weight:700;color:var(--ink)">BelliedMonkey</a>
    <span class="spacer"></span>
    <select id="lang-select" class="lang-toggle" aria-label="Language"></select>
  </nav>\n`
    : `  <nav><a href="/" style="font-weight:700">大肚猴翻译</a></nav>\n`;

  return `<!DOCTYPE html>
<html lang="${zh ? 'zh-CN' : 'en'}"${site.i18n ? ' data-page="try"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="canonical" href="https://${site.host}/try/${target}.html">
<!-- 试翻页不进搜索索引：它是引导流程里的一站，独立到达没有意义，而 12 个几乎同文的
     页面进索引只会稀释站点自己的排名。 -->
<meta name="robots" content="noindex,follow">
<link rel="icon" href="/icon.png">
${headStyle(site)}
</head>
<body>
<div class="wrap">
${nav}  <section style="padding-top:40px;max-width:720px">
    <h1${site.i18n ? ' data-i18n="try.h1"' : ''}>${esc(h1)}</h1>
    <p class="lede"${site.i18n ? ` data-i18n="${ledeKey}"` : ''}>${esc(zh ? ledeZh : ledeEn)}</p>

    <!-- 没检测到扩展时才显示。默认**显示**：这一页的全部意义建立在扩展在场，
         默认藏起来会让一个没装扩展的人对着一段外语点一个不存在的悬浮球。 -->
    <p id="try-wait" class="sub"${site.i18n ? ' data-i18n="try.wait"' : ''}>${esc(zh ? waitZh : waitEn)}</p>
    <p id="try-wait-cta"><a class="btn" href="/setup.html"${site.i18n ? ' data-i18n="try.waitCta"' : ''}>${esc(zh ? waitCtaZh : waitCtaEn)}</a></p>

    <!-- 示例段落。**故意不挂 data-i18n** —— 它是给人翻的外语，翻译它就毁了这一页。
         源语言：${row.src}（目标语言 ${target}）。 -->
    <div class="howto" dir="${src.dir}">
${paras}
    </div>

    <!-- 翻完之后的下一步：登录并同步到 App。
         **空容器，由扩展的内容脚本填**（content-main.js 的 MT_SITES 分支）。
         页面这边一个字都不写，两个理由：文案跟随用户在扩展里选的界面语言；
         没装扩展时它不可能出现。
         ⚠️ 容器上不许挂 data-i18n —— i18n.js 会接管带该属性元素的 hidden。 -->
    <div id="mt-next-review" hidden></div>
  </section>

  <footer>
    <span>© 2026 BelliedMonkey${zh ? '' : ', LLC'}</span>
    <a href="/">${zh ? '首页' : 'Product'}</a>
    <a href="/setup.html">${zh ? '启用扩展' : 'Enable'}</a>
  </footer>
</div>

<script>
/* 扩展在不在。判据与 setup.html 逐字相同：属性 + 事件 + 轮询 + 回到页面时再查，
   四路冗余是因为用户会切去「设置」再切回来。 */
(function () {
  var wait = document.getElementById('try-wait');
  var cta  = document.getElementById('try-wait-cta');
  var done = false;
  function ready() {
    if (done) return;
    done = true;
    wait.hidden = true;
    if (cta) cta.hidden = true;
  }
  function present() { return !!document.documentElement.dataset.mtExtension; }
  document.addEventListener('mt-extension-ready', ready);
  if (present()) ready();
  var n = 0, t = setInterval(function () {
    if (present()) ready();
    if (done || ++n > 600) clearInterval(t);
  }, 500);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && present()) ready();
  });
})();
</script>
${site.i18n ? '<script src="/i18n/i18n.js"></script>\n' : ''}</body>
</html>
`;
}

let changed = 0; const stale = [];
for (const site of SITES) {
  if (!fs.existsSync(site.dir)) {
    console.log(`  跳过 ${site.host}：${site.dir} 不在（没 checkout 就不生成）`);
    continue;
  }
  const outDir = path.join(site.dir, 'try');
  if (!CHECK) fs.mkdirSync(outDir, { recursive: true });
  for (const target of site.targets) {
    const file = path.join(outDir, `${target}.html`);
    const html = render(site, target);
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (cur === html) continue;
    if (CHECK) { stale.push(path.relative(site.dir, file) + ` (${site.host})`); continue; }
    fs.writeFileSync(file, html);
    changed += 1;
  }
  // 表里删掉一个目标语言时，站点上那一页要跟着消失 —— 留着就是一个再也无人到达、
  // 也再也不会被更新的页面。
  if (fs.existsSync(outDir)) {
    const want = new Set(site.targets.map((t) => `${t}.html`));
    for (const f of fs.readdirSync(outDir)) {
      if (want.has(f)) continue;
      if (CHECK) { stale.push(`多余的 ${f} (${site.host})`); continue; }
      fs.unlinkSync(path.join(outDir, f));
      changed += 1;
    }
  }
}

if (CHECK) {
  if (stale.length) {
    console.log('✗ 试翻页与 build/try-pages.config.js 不同步：');
    for (const s of stale) console.log('   ' + s);
    console.log('  跑 node scripts/gen-try-pages.js');
    process.exit(1);
  }
  console.log('✓ 试翻页与注册表同步');
} else {
  console.log(`✓ 试翻页已生成（${changed} 个文件有变化）`);
}
