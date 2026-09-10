#!/usr/bin/env node
/* 更新日志：从 store-assets/release-notes-*.md 生成 CHANGELOG.md（仓库）与 changelog.html（官网）。
 *
 * 为什么要生成而不是手写：那 22 份发布说明是 asc.js notes 的唯一真源，内容原样上到 App Store，
 * 是**已经公开**的语料 —— 只是没人知道去 store-assets/ 找。搜索引擎与 AI 引擎需要一个「这个软件
 * 最近在动」的信号（SE Ranking：6 个月不更新失去 AI 引用资格），而这一页是唯一能随发版自动
 * 刷新的那个。手写一份第二真源必然漂移。
 *
 *   node scripts/gen-changelog.js           # 写两处
 *   node scripts/gen-changelog.js --check   # 门禁：与发布说明不一致就红
 *
 * 版本日期取该版发布说明**首次进仓库**的提交日 —— 不是文件里写的（里面没写），也不是商店过审日
 * （那要问 ASC）。三者里它最接近「这一版出门的那天」且可重放。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NOTES = path.join(ROOT, 'store-assets');
const SITE = process.env.MT_SITE_CC || path.join(process.env.HOME, 'belliedmonkey-cc');

// 发布说明的标题写法经历过三代（1.5.x 商店文案草稿 / 1.6.x 起「国际版 · en-US」/ -ios -macos 分文件）。
// 这里按含义找，不按字面找。
const EN_HEAD = /en-US|English|英文/;
const ZH_HEAD = /zh-Hans|简体中文/;

function sections(md) {
  const out = [];
  for (const m of md.matchAll(/^## (.+)$\n([\s\S]*?)(?=^## |\Z)/gm)) out.push({ head: m[1].trim(), body: m[2] });
  return out;
}
function bulletsOf(body) {
  const fence = body.match(/```[^\n]*\n([\s\S]*?)```/);
  const text = (fence ? fence[1] : body).trim();
  return text.split('\n').map((l) => l.replace(/^\s*[·•\-*]\s*/, '').trim()).filter(Boolean);
}
function pick(md, re) {
  const s = sections(md).find((x) => re.test(x.head) && !/中国版/.test(x.head));
  return s ? bulletsOf(s.body) : null;
}
function firstCommitDate(file) {
  try {
    const d = execFileSync('git', ['log', '--diff-filter=A', '--format=%cs', '--follow', '--', path.relative(ROOT, file)], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    return d[d.length - 1] || null;
  } catch { return null; }
}
const semver = (v) => v.split('.').map(Number);
const cmp = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

function collect() {
  const byVer = new Map();
  for (const f of fs.readdirSync(NOTES)) {
    const m = f.match(/^release-notes-(\d+\.\d+\.\d+)(-ios|-macos)?\.md$/);
    if (!m) continue;
    const v = m[1];
    if (!byVer.has(v)) byVer.set(v, []);
    byVer.get(v).push({ file: path.join(NOTES, f), suffix: m[2] || '' });
  }
  const releases = [];
  for (const [version, files] of byVer) {
    // 优先无后缀的那份，其次 -ios，再次 -macos；哪份先有 en/zh 就用哪份
    files.sort((a, b) => ['', '-ios', '-macos'].indexOf(a.suffix) - ['', '-ios', '-macos'].indexOf(b.suffix));
    let en = null, zh = null, date = null;
    for (const { file } of files) {
      const md = fs.readFileSync(file, 'utf8');
      en = en || pick(md, EN_HEAD);
      zh = zh || pick(md, ZH_HEAD);
      const d = firstCommitDate(file);
      if (d && (!date || d < date)) date = d;
    }
    if (!en && !zh) continue;
    releases.push({ version, date, en: en || [], zh: zh || [] });
  }
  return releases.sort((a, b) => cmp(a.version, b.version));
}

function renderMd(rel) {
  let s = '# Changelog\n\n> **生成的文件，不要手改。** 来源是 `store-assets/release-notes-*.md`（App Store「新功能」栏的唯一真源）；\n> 改内容请改那里，然后跑 `node scripts/gen-changelog.js`。日期是该版发布说明首次进仓库的那天。\n\n';
  for (const r of rel) {
    s += `## ${r.version}${r.date ? ` — ${r.date}` : ''}\n\n`;
    if (r.en.length) s += r.en.map((l) => `- ${l}`).join('\n') + '\n\n';
    if (r.zh.length) s += '<details><summary>中文</summary>\n\n' + r.zh.map((l) => `- ${l}`).join('\n') + '\n\n</details>\n\n';
  }
  return s;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderHtml(rel, style) {
  const latest = rel[0];
  const items = rel.map((r) => `
<h2 id="v${r.version}">${r.version}${r.date ? ` <time datetime="${r.date}">${r.date}</time>` : ''}</h2>
<ul>
${r.en.map((l) => `  <li>${esc(l)}</li>`).join('\n')}
</ul>${r.zh.length ? `
<details lang="zh-Hans"><summary>中文</summary>
<ul>
${r.zh.map((l) => `  <li>${esc(l)}</li>`).join('\n')}
</ul>
</details>` : ''}`).join('\n');
  const desc = `What changed in each version of BelliedMonkey Translator, newest first. Latest: ${latest.version}${latest.date ? ` (${latest.date})` : ''}.`;
  return `<!DOCTYPE html>
<html lang="en" data-page="changelog">
<head>
<title>Changelog — BelliedMonkey Translator</title>
<link rel="canonical" href="https://belliedmonkey.cc/changelog.html">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://belliedmonkey.cc/changelog.html">
<meta property="og:title" content="Changelog — BelliedMonkey Translator">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://belliedmonkey.cc/media/og-card.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://belliedmonkey.cc/media/og-card.jpg">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/icon.png">
${style}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Changelog — BelliedMonkey Translator",
  "description": ${JSON.stringify(desc)},
  "url": "https://belliedmonkey.cc/changelog.html",
  "dateModified": ${JSON.stringify(latest.date || '')},
  "about": { "@type": "SoftwareApplication", "name": "BelliedMonkey Translator", "url": "https://belliedmonkey.cc/", "softwareVersion": ${JSON.stringify(latest.version)} }
}
</script>
</head>
<body>
<nav>
  <a class="brand" href="/">BelliedMonkey</a>
  <span class="spacer"></span>
  <a href="/guide.html">Setup guide</a>
  <a href="/faq.html">FAQ</a>
  <a href="/setup.html">Set up</a>
</nav>

<h1>Changelog</h1>
<p class="lede">What changed in each version of BelliedMonkey Translator, newest first. The same text goes to the App Store, Chrome Web Store and Firefox Add-ons; the source of every release is on <a href="https://github.com/belliedmonkey/belliedmonkey-translator/releases" rel="noopener">GitHub Releases</a>.</p>
${items}

<footer>
  <span>© 2026 BelliedMonkey, LLC</span>
  <a href="/">Product</a>
  <a href="/guide.html">Setup guide</a>
  <a href="/faq.html">FAQ</a>
  <a href="/privacy.html">Privacy</a>
  <a href="/support.html">Support</a>
  <a href="https://github.com/belliedmonkey/belliedmonkey-translator" target="_blank" rel="noopener">Source code</a>
</footer>
</body>
</html>
`;
}

function main(argv) {
  const check = argv.includes('--check');
  const rel = collect();
  if (!rel.length) { console.error('✗ 没找到任何发布说明'); process.exit(1); }
  // 样式与 faq.html 同一份：那页是手写的，这里直接借它的 <style>，两页才不会各长各的
  const faq = fs.readFileSync(path.join(SITE, 'faq.html'), 'utf8');
  const style = (faq.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  const outs = [
    { file: path.join(ROOT, 'CHANGELOG.md'), text: renderMd(rel) },
    { file: path.join(SITE, 'changelog.html'), text: renderHtml(rel, style) },
  ];
  let changed = 0;
  for (const o of outs) {
    const cur = fs.existsSync(o.file) ? fs.readFileSync(o.file, 'utf8') : null;
    if (cur === o.text) continue;
    changed++;
    if (check) { console.log(`  ✗ ${path.relative(process.env.HOME, o.file)} 与发布说明不一致`); continue; }
    fs.writeFileSync(o.file, o.text);
  }
  if (check) {
    if (changed) { console.error('✗ 跑 node scripts/gen-changelog.js'); process.exit(1); }
    console.log(`  ✓ CHANGELOG.md 与 changelog.html 与 ${rel.length} 份发布说明一致（最新 ${rel[0].version}）`);
    return;
  }
  console.log(`  已写 ${changed} 个文件：${rel.length} 个版本，最新 ${rel[0].version}（${rel[0].date}）`);
}

module.exports = { sections, bulletsOf, pick, collect, renderMd };
if (require.main === module) main(process.argv.slice(2));
