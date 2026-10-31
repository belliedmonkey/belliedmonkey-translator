// test/site-audit.test.js — 官网 SEO/GEO 门禁（scripts/site-audit.js）的纯函数部分。
//
// 门禁本身要读两个别的仓库，进不了 CI；能进 CI 的是它的判断逻辑。这里每个用例都对应
// 2026-09-10 审计里真实出现过的一种坏形状 —— 判断错一次，站上就会多一条没人看见的假话。
const { describe, test, ok, eq, deepEq } = require('./harness');
const A = require('../scripts/site-audit.js');

describe('site-audit: 首页 <title> 说产品不说公司', () => {
  test('12 种语言都有产品词的正则，且公司词正则能抓到审计当天的 12 个标题', () => {
    const bad = {
      en: 'BelliedMonkey — AI Translation Company', de: 'BelliedMonkey – KI-Übersetzungsunternehmen',
      fr: 'BelliedMonkey — Société de traduction par IA', es: 'BelliedMonkey — Empresa de traducción con IA',
      pt: 'BelliedMonkey — Empresa de tradução com IA', ru: 'BelliedMonkey — компания ИИ-перевода',
      ar: 'BelliedMonkey — شركة ترجمة بالذكاء الاصطناعي', hi: 'BelliedMonkey — AI अनुवाद कंपनी',
      ja: 'BelliedMonkey — AI翻訳会社', ko: 'BelliedMonkey — AI 번역 회사',
      'zh-CN': '大肚猴 BelliedMonkey — AI 翻译公司', 'zh-TW': 'BelliedMonkey — AI 翻譯公司',
    };
    for (const [lang, t] of Object.entries(bad)) {
      ok(A.PRODUCT_WORD[lang], `${lang} 缺产品词正则`);
      ok(A.COMPANY_WORD.test(t), `${lang}: 「${t}」应被判为公司描述`);
    }
    ok(!A.COMPANY_WORD.test('大肚猴翻译 — 网页与视频双语对照翻译'));
    ok(A.PRODUCT_WORD['zh-CN'].test('大肚猴翻译 — 网页与视频双语对照翻译'));
    ok(A.PRODUCT_WORD.en.test('BelliedMonkey Translator — bilingual web & video translation for Safari, Chrome, Firefox'));
  });
  test('根目录的语言由站决定：中国站根就是 zh-CN', () => {
    eq(A.langOf('index.html', 'en'), 'en');
    eq(A.langOf('index.html', 'zh-CN'), 'zh-CN');
    eq(A.langOf('ja/index.html', 'en'), 'ja');
  });
});

describe('site-audit: head 解析', () => {
  const html = `<html><head><title>T &amp; U</title>
<link rel="canonical" href="https://x.cc/a.html">
<link rel="alternate" hreflang="ja" href="https://x.cc/ja/a.html">
<link rel="alternate" hreflang="x-default" href="https://x.cc/a.html">
<meta name="description" content="d">
<meta property="og:image" content="https://x.cc/og.png">
<meta name='twitter:card' content='summary'>
<meta name="robots" content="noindex,nofollow"></head>
<body><h1>a</h1><h1>b</h1>
<img src="/i.png" alt=""><img src="/j.png" alt="产品截图" width="460" height="300"></body></html>`;
  test('title 解码实体、canonical、hreflang、description、og、twitter、noindex、h1 数', () => {
    eq(A.title(html), 'T & U');
    eq(A.canonical(html), 'https://x.cc/a.html');
    deepEq(A.hreflangs(html), { ja: 'https://x.cc/ja/a.html', 'x-default': 'https://x.cc/a.html' });
    eq(A.metaContent(html, 'name', 'description'), 'd');
    eq(A.metaContent(html, 'property', 'og:image'), 'https://x.cc/og.png');
    eq(A.metaContent(html, 'name', 'twitter:card'), 'summary');   // 单引号属性也要认
    ok(A.isNoindex(html));
    eq(A.h1Count(html), 2);
  });
  test('img：空 alt 与缺尺寸都读得出来', () => {
    const im = A.imgs(html);
    eq(im.length, 2);
    eq(im[0].alt, ''); eq(im[0].width, null);
    eq(im[1].alt, '产品截图'); eq(im[1].width, '460'); eq(im[1].height, '300');
  });
  test('urlOf：index.html 折成目录，语言目录保留', () => {
    eq(A.urlOf('https://x.cc', 'index.html'), 'https://x.cc/');
    eq(A.urlOf('https://x.cc', 'zh-CN/index.html'), 'https://x.cc/zh-CN/');
    eq(A.urlOf('https://x.cc', 'faq.html'), 'https://x.cc/faq.html');
  });
});

describe('site-audit: JSON-LD', () => {
  test('@graph 摊平后能扫到退役类型与 softwareVersion', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"SoftwareApplication","softwareVersion":"1.7.18"},
      {"@type":"HowTo","step":[{"@type":"HowToStep"}]}]}</script>`;
    const types = A.ldTypes(html);
    ok(types.has('HowTo') && types.has('HowToStep') && types.has('SoftwareApplication'));
    ok(A.SCHEMA_DEPRECATED.has('HowTo'));
    ok(!A.SCHEMA_DEPRECATED.has('FAQPage'), 'FAQPage 没富结果了但没退役，留着做语义');
    const v = A.flattenLd(A.jsonLd(html)).find((o) => o.softwareVersion);
    eq(v.softwareVersion, '1.7.18');
  });
  test('解析失败要报出来而不是当没有', () => {
    const [o] = A.jsonLd('<script type="application/ld+json">{oops</script>');
    ok(o.__parseError);
  });
});

describe('site-audit: 口径黑名单', () => {
  test('可见文本与 JSON-LD 都扫；限定过的 free 与 telemetry 不误报', () => {
    eq(A.bannedWording('<p>No tracking, no telemetry.</p>').length, 1);
    eq(A.bannedWording('<script type="application/ld+json">{"featureList":["No telemetry, no ads"]}</script>').length, 1);
    eq(A.bannedWording('<p>The app is completely free.</p>').length, 1);
    eq(A.bannedWording('<p>the only translation extension for iOS Safari</p>').length, 1);
    eq(A.bannedWording('<p>Free and open source; anonymous usage events, one switch turns them off. It is not the only extension.</p>').length, 0);
    eq(A.bannedWording('<style>.x{content:"no telemetry"}</style><p>ok</p>').length, 0, 'style 里的不算可见文本');
  });
});

describe('site-audit: 图片尺寸', () => {
  test('PNG 从 IHDR 读；JPEG 从 SOF0 读；别的格式不判', () => {
    const png = Buffer.alloc(32); png[0] = 0x89; png[1] = 0x50; png.writeUInt32BE(1200, 16); png.writeUInt32BE(630, 20);
    deepEq(A.imageSize(png), { w: 1200, h: 630 });
    // FFD8 · APP0 段(长度 4) · SOF0: FFC0 len=17 precision=8 h=630 w=1200
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03]);
    deepEq(A.imageSize(jpg), { w: 1200, h: 630 });
    eq(A.imageSize(Buffer.from('GIF89a')), null);
  });
});

describe('site-audit: sitemap / robots / 段落', () => {
  test('sitemap 的 loc 与 lastmod', () => {
    const xml = '<urlset><url><loc>https://x.cc/</loc><lastmod>2026-08-30</lastmod></url><url><loc>https://x.cc/a.html</loc></url></urlset>';
    deepEq(A.sitemapLocs(xml), ['https://x.cc/', 'https://x.cc/a.html']);
    deepEq(A.sitemapLastmod(xml), { 'https://x.cc/': '2026-08-30' });
  });
  test('robots：只有专门给 AI 爬虫写 Disallow: / 才算屏蔽；* 的 Allow 不算', () => {
    deepEq(A.aiBotsBlocked('User-agent: *\nAllow: /\n\nSitemap: x'), []);
    deepEq(A.aiBotsBlocked('User-agent: GPTBot\nDisallow: /\nUser-agent: *\nDisallow: /private/'), ['GPTBot']);
    deepEq(A.aiBotsBlocked('User-agent: ClaudeBot\nDisallow: /tmp/'), []);
  });
  test('h2 分段计词：拉丁按词、CJK 按字，script/style 不算', () => {
    const html = '<style>a{}</style><h2>One</h2><p>' + 'word '.repeat(150) + '</p><h2>二</h2><p>' + '字'.repeat(120) + ' and two</p>';
    const b = A.h2Blocks(html);
    eq(b.length, 2);
    eq(b[0].heading, 'One'); eq(b[0].words, 150);
    eq(b[1].heading, '二'); eq(b[1].words, 122);
    ok(A.BLOCK_WORDS.bestMin === 134 && A.BLOCK_WORDS.bestMax === 167);
  });
});
