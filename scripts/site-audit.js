#!/usr/bin/env node
/* 官网的 SEO / GEO 门禁 —— 确定性检查那一层（Script 层）。语义判断留给人和模型，
 * 判据清单在 docs/seo-geo-checklist.md。
 *
 * 为什么要有它：2026-09-10 审计时，站上同时存在「No telemetry」（假）与「匿名用量事件」
 * （真）两种口径；JSON-LD 里的 softwareVersion 停在 1.7.18 而站已跟到 1.9.0；beta.html 一边
 * noindex 一边在 sitemap 里；12 个首页的 <title> 写的是「AI Translation Company」而不是产品；
 * 产品截图 alt=""；分享卡用 128px 的图标。**每一条都没有报错**，而且每一条都是搜索引擎与
 * AI 引擎读到的第一手事实。这些东西此前全靠人记，人记不住。
 *
 * 两个站是两个仓库（国际 ~/belliedmonkey-cc / 中国 ~/belliedmonkey-com），都不在本仓库里。
 * 没 checkout 的站跳过并明说。本地工具，不进 CI（local-gates-are-not-ci）。
 *
 *   node scripts/site-audit.js            # 两站都查，任一 ✗ 即 exit 1
 *   node scripts/site-audit.js --site cc  # 只查一站
 *   node scripts/site-audit.js --blocks alternatives.html   # 打印某页每个 h2 段的词数
 *
 * ✗ = 红（exit 1）· △ = 黄（只提醒，不红）· ✓ = 过
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const SITES = [
  { key: 'cc', name: '国际 belliedmonkey.cc', host: 'https://belliedmonkey.cc',
    dir: process.env.MT_SITE_CC || path.join(os.homedir(), 'belliedmonkey-cc'), i18n: true, rootLang: 'en' },
  { key: 'com', name: '中国 belliedmonkey.com', host: 'https://belliedmonkey.com',
    dir: process.env.MT_SITE_COM || path.join(os.homedir(), 'belliedmonkey-com'), i18n: false, rootLang: 'zh-CN' },
];

// ── 判据表（改这里，不改下面的逻辑）──────────────────────────────────────────

// 首页 <title> 必须含「这是个什么产品」的词，且不得只说「这是家什么公司」。
// 2026-09-10：12 个 priority 1.0 的首页全在争 "AI Translation Company" 这个没人搜的词。
const PRODUCT_WORD = {
  en: /translat/i, 'zh-CN': /翻译/, 'zh-TW': /翻譯/, ja: /翻訳/, ko: /번역/,
  fr: /tradu/i, de: /übersetz/i, es: /traduc/i, pt: /tradu/i, ru: /перевод/i,
  ar: /ترجم/, hi: /अनुवाद/,
};
// 德语会把「公司」焊进复合词（KI-Übersetzungsunternehmen）；\b 对非 ASCII 字母不成立 —— 所以只有纯 ASCII 的词带 \b
const COMPANY_WORD = /\bCompany\b|\bEmpresa\b|Société|компания|unternehmen|شركة|翻訳会社|번역 회사|翻译公司|翻譯公司|कंपनी/i;
const TITLE_MAX = 65;

// 口径黑名单：站上任何页面的可见文本与 JSON-LD 里都不许出现。
//   no telemetry      —— Gate D（2026-09-05）之后是假话：有匿名用量事件，一个开关关掉
//   completely free   —— 不加限定的「完全免费」，红线（oss-marketing-direction）
//   only/first … iOS  —— 「iOS Safari 唯一/第一」，沉浸式翻译有 iOS 条目
const WORDING_BANNED = [
  [/\bno telemetry\b/i, '「no telemetry」是假话 —— 改成「匿名用量事件，一个开关关掉」那套口径'],
  [/\bcompletely free\b/i, '「completely free」不加限定，红线'],
  [/\b(the )?(only|first) (bilingual |translation )?(browser )?extension (for|on) (iOS|iPhone|Safari)/i, '「iOS/Safari 唯一/第一」，红线'],
];

// 2023-09 起 HowTo 不再有富结果；其余三个 2025 已退役。留着只会在 Search Console 里报警。
const SCHEMA_DEPRECATED = new Set(['HowTo', 'SpecialAnnouncement', 'ClaimReview', 'VehicleListing']);

// AI 引擎的爬虫。robots.txt 若单独给它们写 Disallow，等于自己把 GEO 那扇门关上。
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot',
  'Google-Extended', 'Bingbot', 'CCBot'];

// 分享卡：多数平台 200×200 以下不显示图；大卡要 1200×630。
const OG_MIN = { w: 1200, h: 630 };

// 「可引用段落」的形状（SE Ranking / Ahrefs 2025 的实测区间）：h2 之下一段 100–220 词，
// 最优 134–167。只对这里列出的页面数；别的页不是给 AI 引用写的。
const CITABLE_PAGES = ['alternatives.html'];
const BLOCK_WORDS = { min: 100, max: 220, bestMin: 134, bestMax: 167 };

// llms.txt 的 Links 段必须指到信息密度最高的那几页 —— 2026-09-10 它只链了 home/setup/privacy/support。
const LLMS_MUST_LINK = ['/faq.html', '/guide.html', '/youtube-dual-subtitles.html', '/safari-ios-translate-extension.html'];

const FRESH_DAYS = 90;    // SE Ranking：6 个月不动失去引用资格，3 个月内 ~3×；90 天黄一次
const FRESH_PAGES = ['index.html', 'alternatives.html'];

const HYGIENE_BAD = /(\.bad|\.orig|\.tmp|~)$/;

// ── 小工具（都是纯函数，test/site-audit.test.js 直接测）──────────────────────

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? decode(m[1] ?? m[2]) : null;
}
function tags(html, re) { return [...html.matchAll(re)].map((m) => m[0]); }
function metaContent(html, key, val) {
  const t = tags(html, /<meta\b[^>]*>/gi).find((x) => (attr(x, key) || '').toLowerCase() === val.toLowerCase());
  return t ? attr(t, 'content') : null;
}
function title(html) { const m = html.match(/<title>([^<]*)<\/title>/i); return m ? decode(m[1]).trim() : null; }
function canonical(html) {
  const t = tags(html, /<link\b[^>]*>/gi).find((x) => (attr(x, 'rel') || '').toLowerCase() === 'canonical');
  return t ? attr(t, 'href') : null;
}
function hreflangs(html) {
  const out = {};
  for (const t of tags(html, /<link\b[^>]*>/gi)) {
    if ((attr(t, 'rel') || '').toLowerCase() !== 'alternate') continue;
    const hl = attr(t, 'hreflang'); if (hl) out[hl] = attr(t, 'href');
  }
  return out;
}
function isNoindex(html) { return /noindex/i.test(metaContent(html, 'name', 'robots') || ''); }
function h1Count(html) { return (html.match(/<h1\b/gi) || []).length; }
function imgs(html) {
  return tags(html, /<img\b[^>]*>/gi).map((t) => ({ src: attr(t, 'src'), alt: attr(t, 'alt'),
    width: attr(t, 'width'), height: attr(t, 'height'), tag: t }));
}
function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1])); } catch (e) { out.push({ __parseError: e.message }); }
  }
  return out;
}
// 把 @graph / 嵌套统统摊平成对象列表，好扫 @type 与字段
function flattenLd(node, acc = []) {
  if (Array.isArray(node)) { node.forEach((n) => flattenLd(n, acc)); return acc; }
  if (node && typeof node === 'object') {
    acc.push(node);
    for (const v of Object.values(node)) if (v && typeof v === 'object') flattenLd(v, acc);
  }
  return acc;
}
function ldTypes(html) {
  const s = new Set();
  for (const o of flattenLd(jsonLd(html))) [].concat(o['@type'] || []).forEach((t) => s.add(t));
  return s;
}
// 可见文本：剥 script/style/标签。JSON-LD 另算（它也是给引擎读的，一样扫口径）。
function visibleText(html) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}
function bannedWording(html) {
  const hay = visibleText(html) + ' ' + JSON.stringify(jsonLd(html));
  return WORDING_BANNED.filter(([re]) => re.test(hay)).map(([, why]) => why);
}
// PNG: IHDR 在第 16 字节；JPEG: 扫 SOFn 段。别的格式返回 null（不判）。
function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
// h2 分段 → 每段词数（CJK 按字算，拉丁按空白分词）
function h2Blocks(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const parts = body.split(/<h2\b[^>]*>/i).slice(1);
  return parts.map((p) => {
    const heading = decode(p.slice(0, p.indexOf('</h2>')).replace(/<[^>]+>/g, '')).trim();
    const text = decode(p.slice(p.indexOf('</h2>') + 5).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const cjk = (text.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
    const latin = text.replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ').split(/\s+/).filter(Boolean).length;
    return { heading, words: cjk + latin };
  });
}
function sitemapLocs(xml) { return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()); }
function sitemapLastmod(xml) {
  const out = {};
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) out[m[1].trim()] = m[2].trim();
  return out;
}
// robots.txt：某个 UA 块里有没有 Disallow: /
function robotsBlocks(txt) {
  const blocks = {}; let cur = [];
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const [, k, v] = m;
    if (k.toLowerCase() === 'user-agent') { cur = [v.trim()]; cur.forEach((u) => (blocks[u] = blocks[u] || [])); }
    else if (k.toLowerCase() === 'disallow') cur.forEach((u) => blocks[u].push(v.trim()));
  }
  return blocks;
}
function aiBotsBlocked(txt) {
  const b = robotsBlocks(txt);
  return AI_BOTS.filter((bot) => (b[bot] || []).includes('/'));
}
// 站内相对路径 → 该页在站上的规范 URL（index.html 折成目录）
function urlOf(host, rel) {
  const u = '/' + rel.split(path.sep).join('/');
  return host + u.replace(/index\.html$/, '');
}
// 根目录那一层的语言由站决定：国际站是 en，中国站整站就是 zh-CN
function langOf(rel, rootLang = 'en') { const seg = rel.split(path.sep); return seg.length > 1 ? seg[0] : rootLang; }

function gitDate(dir, rel) {
  try { return execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], { cwd: dir, encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}
function walk(dir, base = dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    if (f === '.git' || f === 'node_modules') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, base, acc); else acc.push(path.relative(base, p));
  }
  return acc;
}

// ── 审计一站 ─────────────────────────────────────────────────────────────────

function auditSite(site, opts = {}) {
  const red = [], yellow = [], okc = [];
  const R = (m) => red.push(m), Y = (m) => yellow.push(m), OK = (m) => okc.push(m);
  if (!fs.existsSync(site.dir)) { return { skipped: `${site.dir} 没有 checkout` }; }

  const files = walk(site.dir);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  const pages = new Map();
  for (const rel of htmlFiles) pages.set(rel, fs.readFileSync(path.join(site.dir, rel), 'utf8'));

  // 冻结的 -cn 页在 vercel.json 里 308 出去，不算本站页面
  const redirected = new Set();
  const vercel = path.join(site.dir, 'vercel.json');
  if (fs.existsSync(vercel)) {
    for (const r of (JSON.parse(fs.readFileSync(vercel, 'utf8')).redirects || [])) redirected.add(r.source.replace(/^\//, ''));
  }
  const version = fs.existsSync(path.join(site.dir, 'VERSION')) ? fs.readFileSync(path.join(site.dir, 'VERSION'), 'utf8').trim() : null;
  const pkgVersion = require(path.join(ROOT, 'package.json')).version;
  if (version && version !== pkgVersion) Y(`VERSION=${version} 与本仓库 package.json=${pkgVersion} 不同（发版时应相等）`);

  // ① 每页：title / description / h1 / canonical / og / img / schema / 口径
  let titleBad = 0, descBad = 0, h1Bad = 0, canonBad = 0, ogBad = 0, imgBad = 0, schemaBad = 0, wordBad = 0, verBad = 0;
  const ogImages = new Set();
  for (const [rel, html] of pages) {
    if (redirected.has(rel)) continue;
    const noindex = isNoindex(html);
    const url = urlOf(site.host, rel);
    const lang = langOf(rel, site.rootLang);
    const isHome = path.basename(rel) === 'index.html' && (rel === 'index.html' || rel.split(path.sep).length === 2) && !rel.startsWith('try');
    const t = title(html);
    if (!t) { R(`${rel}: 没有 <title>`); titleBad++; }
    else {
      if (t.length > TITLE_MAX) { R(`${rel}: <title> ${t.length} 字符 > ${TITLE_MAX}：「${t}」`); titleBad++; }
      if (isHome && !noindex) {
        const pw = PRODUCT_WORD[lang];
        if (pw && !pw.test(t)) { R(`${rel}: 首页 <title> 没有产品词（${pw}）：「${t}」`); titleBad++; }
        if (COMPANY_WORD.test(t)) { R(`${rel}: 首页 <title> 在描述公司而不是产品：「${t}」`); titleBad++; }
      }
    }
    if (noindex) continue;   // noindex 页只要求 title，其余不判
    if (!metaContent(html, 'name', 'description')) { R(`${rel}: 没有 meta description`); descBad++; }
    const n = h1Count(html);
    if (n !== 1) { R(`${rel}: <h1> 有 ${n} 个，应恰好 1 个`); h1Bad++; }
    const c = canonical(html);
    if (!c) { R(`${rel}: 没有 canonical`); canonBad++; }
    else if (c !== url) { R(`${rel}: canonical=${c} ≠ ${url}`); canonBad++; }
    const og = metaContent(html, 'property', 'og:image');
    if (!og) { R(`${rel}: 没有 og:image`); ogBad++; }
    else {
      ogImages.add(og);
      const card = metaContent(html, 'name', 'twitter:card');
      if (card !== 'summary_large_image') { R(`${rel}: twitter:card=${card || '缺'}，应为 summary_large_image`); ogBad++; }
    }
    for (const im of imgs(html)) {
      if (im.alt === null || im.alt === '') { R(`${rel}: <img src="${im.src}"> alt 为空 —— 截图是内容不是装饰`); imgBad++; }
      if (!im.width || !im.height) { R(`${rel}: <img src="${im.src}"> 没有 width/height（lazy 图撑开布局伤 CLS）`); imgBad++; }
    }
    for (const o of jsonLd(html)) if (o.__parseError) { R(`${rel}: JSON-LD 解析失败：${o.__parseError}`); schemaBad++; }
    for (const ty of ldTypes(html)) if (SCHEMA_DEPRECATED.has(ty)) { R(`${rel}: JSON-LD 用了已退役的 ${ty}`); schemaBad++; }
    for (const o of flattenLd(jsonLd(html))) {
      if (o.softwareVersion && version && o.softwareVersion !== version) { R(`${rel}: JSON-LD softwareVersion=${o.softwareVersion} ≠ VERSION=${version}`); verBad++; }
    }
    for (const why of bannedWording(html)) { R(`${rel}: ${why}`); wordBad++; }
  }
  if (!titleBad) OK('每页 <title> 存在、≤ 65 字符，首页说的是产品');
  if (!descBad && !h1Bad && !canonBad) OK('每个可索引页有 description、恰好一个 h1、自指 canonical');
  if (!imgBad) OK('每张 <img> 有内容 alt 与 width/height');
  if (!schemaBad && !verBad) OK('JSON-LD 可解析、无退役类型、softwareVersion 与 VERSION 一致');
  if (!wordBad) OK('口径黑名单 0 命中');

  // og:image 尺寸（只判本站文件）
  let ogSizeBad = 0;
  for (const og of ogImages) {
    if (!og.startsWith(site.host)) continue;
    const rel = og.slice(site.host.length).replace(/^\//, '');
    const p = path.join(site.dir, rel);
    if (!fs.existsSync(p)) { R(`og:image ${og} 在站上不存在`); ogSizeBad++; continue; }
    const sz = imageSize(fs.readFileSync(p));
    if (sz && (sz.w < OG_MIN.w || sz.h < OG_MIN.h)) { R(`og:image ${rel} 是 ${sz.w}×${sz.h}，分享卡至少 ${OG_MIN.w}×${OG_MIN.h}`); ogSizeBad++; }
  }
  if (!ogBad && !ogSizeBad) OK('每页 og:image ≥ 1200×630，twitter:card=summary_large_image');

  // ② hreflang 成对互指（只有国际站有）
  if (site.i18n) {
    let hlBad = 0;
    for (const [rel, html] of pages) {
      const hl = hreflangs(html); if (!Object.keys(hl).length) continue;
      const me = urlOf(site.host, rel);
      for (const [code, href] of Object.entries(hl)) {
        if (href === me) continue;
        const target = href.slice(site.host.length).replace(/^\//, '').replace(/\/$/, '/index.html') || 'index.html';
        const t = pages.get(target.endsWith('/') ? target + 'index.html' : target);
        if (!t) { R(`${rel}: hreflang=${code} 指向 ${href}，文件不存在`); hlBad++; continue; }
        if (!Object.values(hreflangs(t)).includes(me)) { R(`${rel}: hreflang=${code} → ${href} 不回指本页（单向，Google 会忽略整组）`); hlBad++; }
      }
    }
    if (!hlBad) OK('hreflang 全部成对互指');
  }

  // ③ sitemap：可索引页都在、noindex 页都不在、llms.txt 在、lastmod 不早于最后一次提交
  const smPath = path.join(site.dir, 'sitemap.xml');
  if (!fs.existsSync(smPath)) R('没有 sitemap.xml');
  else {
    const xml = fs.readFileSync(smPath, 'utf8');
    const locs = new Set(sitemapLocs(xml));
    let smBad = 0;
    for (const [rel, html] of pages) {
      if (redirected.has(rel)) { if (locs.has(urlOf(site.host, rel))) { R(`sitemap 含已 308 出去的 ${rel}`); smBad++; } continue; }
      const url = urlOf(site.host, rel);
      if (isNoindex(html)) { if (locs.has(url)) { R(`sitemap 含 noindex 页 ${rel} —— 自相矛盾，Search Console 会报`); smBad++; } }
      else if (!locs.has(url)) { R(`sitemap 漏了 ${rel}`); smBad++; }
    }
    if (fs.existsSync(path.join(site.dir, 'llms.txt')) && !locs.has(site.host + '/llms.txt')) { R('sitemap 没有 llms.txt'); smBad++; }
    const lm = sitemapLastmod(xml);
    for (const [url, date] of Object.entries(lm)) {
      const rel = url.slice(site.host.length).replace(/^\//, '').replace(/\/$/, 'index.html') || 'index.html';
      const g = gitDate(site.dir, rel);
      if (g && g > date) { R(`sitemap lastmod ${date} 早于 ${rel} 的最后提交 ${g}`); smBad++; }
    }
    if (!smBad) OK(`sitemap ${locs.size} 条：可索引页齐、noindex 页不在、lastmod 不过期`);
  }

  // ④ robots.txt 没把 AI 爬虫关在门外
  const rb = path.join(site.dir, 'robots.txt');
  if (!fs.existsSync(rb)) R('没有 robots.txt');
  else {
    const blocked = aiBotsBlocked(fs.readFileSync(rb, 'utf8'));
    if (blocked.length) R(`robots.txt 屏蔽了 AI 爬虫：${blocked.join(' ')}`); else OK('robots.txt 未屏蔽任何 AI 爬虫');
  }

  // ⑤ llms.txt 必须链到信息密度最高的几页
  const llms = path.join(site.dir, 'llms.txt');
  if (fs.existsSync(llms)) {
    const txt = fs.readFileSync(llms, 'utf8');
    const miss = LLMS_MUST_LINK.filter((u) => pages.has(u.slice(1)) && !txt.includes(site.host + u));
    if (miss.length) R(`llms.txt 没链到 ${miss.join(' ')}`); else OK('llms.txt 链到了全部内容页');
  } else if (site.i18n) R('没有 llms.txt');

  // ⑥ 部署卫生：仓库根会整个发布出去，脏文件公开可访问
  const dirty = files.filter((f) => HYGIENE_BAD.test(f));
  if (dirty.length) R(`会随站点发布的脏文件：${dirty.join(' ')}`); else OK('没有 .bad/.orig/.tmp 脏文件');

  // ⑦ 可引用段落的形状
  for (const page of CITABLE_PAGES) {
    const html = pages.get(page); if (!html) continue;
    const blocks = h2Blocks(html);
    const bad = blocks.filter((b) => b.words < BLOCK_WORDS.min || b.words > BLOCK_WORDS.max);
    const meh = blocks.filter((b) => !bad.includes(b) && (b.words < BLOCK_WORDS.bestMin || b.words > BLOCK_WORDS.bestMax));
    for (const b of bad) R(`${page}: 「${b.heading}」段 ${b.words} 词，可引用段落应在 ${BLOCK_WORDS.min}–${BLOCK_WORDS.max}`);
    for (const b of meh) Y(`${page}: 「${b.heading}」段 ${b.words} 词，最优 ${BLOCK_WORDS.bestMin}–${BLOCK_WORDS.bestMax}`);
    if (!bad.length) OK(`${page}: ${blocks.length} 个答案块都在 ${BLOCK_WORDS.min}–${BLOCK_WORDS.max} 词`);
  }

  // ⑧ 新鲜度（黄）：6 个月不动就失去 AI 引用资格
  for (const page of FRESH_PAGES) {
    if (!pages.has(page)) continue;
    const g = gitDate(site.dir, page); if (!g) continue;
    const age = Math.round((Date.now() - Date.parse(g)) / 86400000);
    if (age > FRESH_DAYS) Y(`${page} 上次改动 ${g}（${age} 天前）—— 超过 ${FRESH_DAYS} 天，该刷新了`);
  }

  if (opts.blocks) {
    const html = pages.get(opts.blocks);
    if (!html) R(`--blocks ${opts.blocks}：没有这个页`);
    else for (const b of h2Blocks(html)) console.log(`    ${String(b.words).padStart(4)} 词  ${b.heading}`);
  }
  return { red, yellow, ok: okc };
}

function main(argv) {
  const only = argv.includes('--site') ? argv[argv.indexOf('--site') + 1] : null;
  const blocks = argv.includes('--blocks') ? argv[argv.indexOf('--blocks') + 1] : null;
  let anyRed = false;
  for (const site of SITES) {
    if (only && site.key !== only) continue;
    console.log(`\n${site.name}  (${site.dir})`);
    const r = auditSite(site, { blocks });
    if (r.skipped) { console.log(`  — 跳过：${r.skipped}`); continue; }
    for (const m of r.ok) console.log(`  ✓ ${m}`);
    for (const m of r.yellow) console.log(`  △ ${m}`);
    for (const m of r.red) console.log(`  ✗ ${m}`);
    console.log(`  ${r.red.length ? '✗' : '✓'} ${r.ok.length} 过 · ${r.yellow.length} 提醒 · ${r.red.length} 红`);
    if (r.red.length) anyRed = true;
  }
  if (anyRed) { console.error('\n✗ 站点审计有红项 —— 判据见 docs/seo-geo-checklist.md'); process.exit(1); }
  console.log('\n✓ 站点审计通过');
}

module.exports = {
  SITES, PRODUCT_WORD, COMPANY_WORD, WORDING_BANNED, SCHEMA_DEPRECATED, AI_BOTS, OG_MIN, BLOCK_WORDS,
  title, canonical, hreflangs, isNoindex, h1Count, imgs, jsonLd, flattenLd, ldTypes, metaContent,
  bannedWording, imageSize, h2Blocks, sitemapLocs, sitemapLastmod, robotsBlocks, aiBotsBlocked, urlOf, langOf,
  auditSite,
};
if (require.main === module) main(process.argv.slice(2));
