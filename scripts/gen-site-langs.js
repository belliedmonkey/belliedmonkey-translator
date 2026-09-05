#!/usr/bin/env node
// scripts/gen-site-langs.js — 把官网的 i18n 页面**预渲染**成每语言一套静态 URL。
//
//   node scripts/gen-site-langs.js           # 生成
//   node scripts/gen-site-langs.js --check   # 只比对（干运行即校验器）
//
// ── 为什么要这一步 ────────────────────────────────────────────────────────
//
// 站点原本是**运行时** i18n：一套 URL，文案由 i18n.js 从 /i18n/<lang>.json 取来替换。
// 对人没问题，对搜索引擎是这样的：canonical 固定指向根，Google 对一个 canonical 只
// 索引一种语言 —— 于是八份翻译里有七份，搜索引擎从来没有见过。
//
// 预渲染之后每种语言有自己的 URL、自己的 canonical、以及一组 hreflang 互指。
// 那七份翻译（含刚补齐的 .desc）这才第一次成为可被检索的资产。
//
// ── 三条不能违反的约束 ────────────────────────────────────────────────────
//
// 1. **生成页不加载 i18n.js。** 它会按 localStorage 里存的语言重新渲染整页 —— 访客
//    上次选的是阿拉伯语时，/zh-CN/ 会被就地改成阿拉伯语并翻成 RTL。语言选择器换成
//    一个直接跳转的 <select>。
// 2. **不生成 /en/。** 根就是英文。多一个 /en/ 就是两个 URL 装同一份内容，
//    hreflang 里 en 与 x-default 都指向根。
// 3. **版本号在生成时就替换成真数字。** 留 `{v}` 占位符给爬虫看是 2026-08-30 刚修过
//    的那个 bug；而 i18n.js 那条「取不到就抹掉」的降级路径在中文里会产出
//    「当前为，与提交商店的源码完全一致」这种断句。生成页不走那条路，门禁钉住版本一致。
'use strict';

const fs = require('fs');
const path = require('path');

const SITE = process.env.MT_SITE_CC || path.join(process.env.HOME, 'belliedmonkey-cc');
const HOST = 'belliedmonkey.cc';
const PAGES = ['index.html', 'setup.html', 'privacy.html', 'support.html'];
// 只有这几个页面有字典，因此也只有它们的站内链接需要跟着语言走。
const LOCALIZED_HREFS = new Set(['/', '/privacy.html', '/support.html', '/setup.html']);
const RTL = new Set(['ar']);

// 语言清单与显示名的唯一来源是 i18n.js 里那个 LANGS 字面量 —— 不在这里再抄一份。
function langsFrom(js) {
  const block = js.match(/var LANGS = \[([\s\S]*?)\];/);
  if (!block) throw new Error('i18n.js 里找不到 LANGS —— 它的形状变了');
  return [...block[1].matchAll(/\['([\w-]+)',\s*'([^']+)'\]/g)].map((m) => ({ code: m[1], name: m[2] }));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 一个页面在某语言下的 URL。英文即根。
function urlFor(page, lang) {
  const p = page === 'index.html' ? '' : page;
  return lang === 'en' ? `/${p}` : `/${lang}/${p}`;
}

function hreflangBlock(page, langs) {
  const lines = langs.map((l) => `<link rel="alternate" hreflang="${l.code}" href="https://${HOST}${urlFor(page, l.code)}">`);
  lines.push(`<link rel="alternate" hreflang="x-default" href="https://${HOST}${urlFor(page, 'en')}">`);
  return '<!-- hreflang:start -->\n' + lines.join('\n') + '\n<!-- hreflang:end -->';
}

// 幂等地把 hreflang 块塞进 <head>（已有就整块替换）。
function withHreflang(html, page, langs) {
  const block = hreflangBlock(page, langs);
  if (/<!-- hreflang:start -->[\s\S]*?<!-- hreflang:end -->/.test(html)) {
    return html.replace(/<!-- hreflang:start -->[\s\S]*?<!-- hreflang:end -->/, block);
  }
  return html.replace(/(<link rel="canonical"[^>]*>)/, `$1\n${block}`);
}


// 语言之间必须有**真链接**。`<select>` 的 `<option>` 不是链接：搜索引擎跟不进去，
// 关掉 JS 的人也用不了。hreflang 确实是一条发现路径，但它是给机器的补充说明，
// 不是导航。所以每页底部放一行朴素的 <a>，顺带让「无孤儿页」那道判据自然成立。
function langRow(page, langs, current) {
  const links = langs.map((l) => (l.code === current
    ? `<strong>${esc(l.name)}</strong>`
    : `<a href="${urlFor(page, l.code)}" hreflang="${l.code}">${esc(l.name)}</a>`)).join('\n  ');
  return '<!-- langrow:start -->\n<nav aria-label="Language" style="max-width:760px;margin:28px auto 12px;'
    + 'padding:14px 20px;display:flex;flex-wrap:wrap;gap:12px;font-size:.85rem;opacity:.75">\n  '
    + links + '\n</nav>\n<!-- langrow:end -->';
}

function withLangRow(html, page, langs, current) {
  const row = langRow(page, langs, current);
  if (/<!-- langrow:start -->[\s\S]*?<!-- langrow:end -->/.test(html)) {
    return html.replace(/<!-- langrow:start -->[\s\S]*?<!-- langrow:end -->/, row);
  }
  return html.replace(/<\/body>/, row + '\n</body>');
}

function render(srcHtml, page, lang, dict, langs, version) {
  const pageKey = (srcHtml.match(/data-page="([^"]+)"/) || [])[1];
  let h = srcHtml;

  const sub = (s) => String(s).replace(/\{v\}/g, version);

  // ① 文本节点。data-i18n 走 textContent，data-i18n-html 走 innerHTML。
  //    值为空串 = 该语言下**故意隐藏**这个元素（i18n.js 的 el.hidden = v === ''）。
  const fill = (attr, asHtml) => {
    h = h.replace(new RegExp(`<(\\w+)([^>]*\\s${attr}="([^"]+)"[^>]*)>([\\s\\S]*?)</\\1>`, 'g'),
      (m, tag, attrs, key, inner) => {
        const v = dict[key];
        if (v === undefined) throw new Error(`${lang}.json 缺键 ${key}（${page}）`);
        const a = v === '' && !/\shidden\b/.test(attrs) ? attrs + ' hidden' : attrs;
        return `<${tag}${a}>${asHtml ? sub(v) : esc(sub(v))}</${tag}>`;
      });
  };
  fill('data-i18n-html', true);
  fill('data-i18n', false);

  // ② <html lang / dir>
  h = h.replace(/<html([^>]*)\slang="[^"]*"/, `<html$1 lang="${lang}"`);
  h = h.replace(/<html([^>]*)>/, (m, a) => `<html${a.replace(/\sdir="[^"]*"/, '')} dir="${RTL.has(lang) ? 'rtl' : 'ltr'}">`);

  // ③ 标题与描述（含 og / twitter 那几份副本）
  const title = dict[pageKey + '.title'];
  const desc = dict[pageKey + '.desc'];
  if (title) {
    h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
    h = h.replace(/(<meta property="og:title" content=")[^"]*(">)/, `$1${esc(title)}$2`);
    h = h.replace(/(<meta name="twitter:title" content=")[^"]*(">)/, `$1${esc(title)}$2`);
  }
  if (desc) {
    h = h.replace(/(<meta name="description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);
    h = h.replace(/(<meta property="og:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);
    h = h.replace(/(<meta name="twitter:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);
  }

  // ④ canonical / og:url 指向本语言这一份
  const self = `https://${HOST}${urlFor(page, lang)}`;
  h = h.replace(/(<link rel="canonical" href=")[^"]*(">)/, `$1${self}$2`);
  h = h.replace(/(<meta property="og:url" content=")[^"]*(">)/, `$1${self}$2`);
  h = withHreflang(h, page, langs);

  // ⑤ 站内链接跟着语言走 —— 但只对有字典的那几页。guide/faq 那些只有英文，
  //    指向 /zh-CN/faq.html 会是一个 404。
  h = h.replace(/href="(\/[^"]*)"/g, (m, href) =>
    (LOCALIZED_HREFS.has(href) ? `href="${urlFor(href === '/' ? 'index.html' : href.slice(1), lang)}"` : m));

  // ⑥ 语言选择器换成直接跳转的静态 select；同时把选择存进 localStorage，
  //    这样回到根页时它记得。
  const opts = langs.map((l) =>
    `<option value="${urlFor(page, l.code)}" data-lang="${l.code}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
  h = h.replace(/<select id="lang-select"([^>]*)>[\s\S]*?<\/select>/,
    `<select id="lang-select"$1 onchange="try{localStorage.setItem('bm-lang',this.selectedOptions[0].dataset.lang)}catch(e){}location.href=this.value">${opts}</select>`);

  // ⑦ 拿掉 i18n 运行时与遮罩：内容已经在页面里了，再跑一遍只会按 localStorage
  //    把它改成别的语言（见文件头约束 1）。遮罩留着则毫无必要地先藏起整页。
  h = h.replace(/<script src="\/i18n\/i18n\.js"><\/script>\s*/g, '');
  h = h.replace(/<style id="i18n-cloak">[\s\S]*?<\/style>\s*/g, '');
  h = h.replace(/<script>setTimeout\(function\(\)\{var c=document\.getElementById\('i18n-cloak'\)[\s\S]*?<\/script>\s*/g, '');
  h = h.replace(/<noscript><style>html\{visibility:visible!important\}<\/style><\/noscript>\s*/g, '');

  // 生成页**不需要 JavaScript**：文案已经在 HTML 里了。留着这句 noscript 是对爬虫
  // 说一句假话（noscript 的内容是会被读的），也会劝退关掉 JS 的读者。
  h = h.replace(/<noscript>[\s\S]*?requires JavaScript[\s\S]*?<\/noscript>\s*/g, '');

  h = withLangRow(h, page, langs, lang);
  h = sub(h);   // 兜底：内联的英文文案里也可能带 {v}
  return h;
}

function main(argv) {
  const check = argv.includes('--check');
  const langs = langsFrom(fs.readFileSync(path.join(SITE, 'i18n', 'i18n.js'), 'utf8'));
  const version = fs.readFileSync(path.join(SITE, 'VERSION'), 'utf8').trim();
  const onDisk = fs.readdirSync(path.join(SITE, 'i18n')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  const declared = langs.map((l) => l.code).sort();
  if (onDisk.join() !== declared.join()) {
    console.error(`✗ i18n.js 声明的语言 [${declared}] 与目录里的字典 [${onDisk}] 不一致`);
    process.exit(1);
  }

  // ── 与扩展 / App 的界面语言取全集（2026-09-04 用户裁定）──────────────────
  //
  // 「这个产品的界面能说哪些语言」的唯一注册表是 build/ui-langs.config.js。此前官网
  // 少 de/ja/ko/zh-TW、扩展少 hi —— 那几门语言的用户在对应的面上**选不到自己的语言**，
  // 而且不报错，只是看到兜底语言。
  //
  // ⚠️ **官网是另一个仓库**，本仓库的 npm test 看不到它（local-gates-are-not-ci）。
  // 所以这一条挂在这里：这个脚本本来就住在本仓库、本来就要读官网的树。
  // 判据同时管 id 与 endonym —— endonym 按定义不翻译，三个面必须逐字相同。
  const REG = require(path.join(__dirname, '..', 'build', 'ui-langs.config.js'));
  const wantIds = REG.map((l) => l.id);
  const gotIds = langs.map((l) => l.code);
  if (gotIds.join() !== wantIds.join()) {
    console.error(`✗ 官网的语言清单与 build/ui-langs.config.js 不一致（顺序也算）`);
    console.error(`  官网 : ${gotIds.join(' ')}`);
    console.error(`  注册表: ${wantIds.join(' ')}`);
    console.error('  少一门 = 那门语言的用户在官网上选不到自己的语言；多一门 = 选了没有字典。');
    process.exit(1);
  }
  const badName = langs.filter((l, i) => l.name !== REG[i].endonym);
  if (badName.length) {
    console.error('✗ endonym 与注册表不同字：'
      + badName.map((l, i) => l.code + ' 写「' + l.name + '」').join(' · '));
    process.exit(1);
  }

  const out = [];
  for (const l of langs) {
    if (l.code === 'en') continue;          // 根就是英文，不做 /en/
    const dict = JSON.parse(fs.readFileSync(path.join(SITE, 'i18n', l.code + '.json'), 'utf8'));
    for (const page of PAGES) {
      const src = fs.readFileSync(path.join(SITE, page), 'utf8');
      out.push({ file: path.join(SITE, l.code, page), html: render(src, page, l.code, dict, langs, version) });
    }
  }
  // 根页面也要有 hreflang，否则互指是单向的，Google 会忽略整组。
  for (const page of PAGES) {
    const src = fs.readFileSync(path.join(SITE, page), 'utf8');
    out.push({ file: path.join(SITE, page), html: withLangRow(withHreflang(src, page, langs), page, langs, 'en') });
  }

  // sitemap 也由这里产出。手写的那份必然会漏掉新语言/新页面，而漏掉的表现是
  // 「搜索引擎不知道它存在」—— 不报错的那一类。优先级：根 1.0 > 语言首页/教程/启用页
  // 0.8 > 内容页 0.7 > 其余。
  const extras = fs.readdirSync(SITE)
    .filter((f) => f.endsWith('.html') && !/-cn\.html$/.test(f) && !PAGES.includes(f));
  const PRI = { 'index.html': 1.0, 'setup.html': 0.8, 'guide.html': 0.8,
                'support.html': 0.5, 'privacy.html': 0.3 };
  const entries = [];
  for (const page of PAGES) entries.push([urlFor(page, 'en'), PRI[page] ?? 0.7]);
  for (const f of extras.sort()) entries.push(['/' + f, PRI[f] ?? 0.7]);
  for (const l of langs) {
    if (l.code === 'en') continue;
    // 语言页优先级压半档：它们是同一内容的翻译，不该和主版本抢
    for (const page of PAGES) entries.push([urlFor(page, l.code), Math.max(0.3, (PRI[page] ?? 0.7) - 0.2)]);
  }
  const today = new Date().toISOString().slice(0, 10);
  const sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + entries.map(([u, pr]) => `  <url>\n    <loc>https://${HOST}${u}</loc>\n    <lastmod>${today}</lastmod>\n`
        + `    <priority>${pr.toFixed(1)}</priority>\n  </url>\n`).join('')
    + '</urlset>\n';
  out.push({ file: path.join(SITE, 'sitemap.xml'), html: sm });

  let changed = 0;
  for (const o of out) {
    const cur = fs.existsSync(o.file) ? fs.readFileSync(o.file, 'utf8') : null;
    if (cur === o.html) continue;
    changed++;
    if (check) { console.log(`  ✗ ${path.relative(SITE, o.file)} 与字典不一致`); continue; }
    fs.mkdirSync(path.dirname(o.file), { recursive: true });
    fs.writeFileSync(o.file, o.html);
  }
  if (check) {
    if (changed) { console.error(`✗ ${changed} 个文件需要重新生成 —— 跑 node scripts/gen-site-langs.js`); process.exit(1); }
    console.log(`  ✓ ${out.length} 个语言页与字典一致（${langs.length - 1} 种语言 × ${PAGES.length} 页 + ${PAGES.length} 个根页）`);
    return;
  }
  console.log(`  已生成/更新 ${changed} 个文件，共 ${out.length}（${langs.length - 1} 种语言 × ${PAGES.length} 页 + 根页 hreflang）`);
}

module.exports = { render, langsFrom, urlFor, withHreflang, PAGES, SITE, HOST };
if (require.main === module) main(process.argv.slice(2));
