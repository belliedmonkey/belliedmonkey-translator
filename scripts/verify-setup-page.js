/* 官网「启用扩展」页的验收 —— 守的是扩展与网站之间那条契约：
 *   扩展在自家域名注入 data-mt-extension + mt-extension-ready（content-main.js），
 *   网站的 setup.html 据此亮绿灯。
 *
 * 为什么这条契约值得一道门禁：iOS 上 App **查不到扩展有没有启用**
 * （getStateOfSafariExtension 是 macOS-only），所以这一页是整个产品里唯一能
 * 如实回答「我到底设置成功了没」的地方。这盏灯要是撒谎（没装却说已启用），
 * 比没有这盏灯更坏 —— 用户会带着「我装好了」的错误结论去等一个永远不来的译文。
 *
 * 两个站是两个仓库（国际 belliedmonkey.cc / 中国 belliedmonkey.com），都不在本仓库里。
 * 没 checkout 的站会被跳过并明说跳过了 —— 这是本地工具，不进 CI。
 * 路径可用 MT_SITE_CC / MT_SITE_COM 覆盖。
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

// 「结构化数据必须与可见正文一致」这条判据，两处都用它（FAQPage 的问答、HowTo 的步骤）。
//
// 剥标签**并去掉所有空白**。只去空白不剥标签会漏；剥标签时把标签换成空格，又会在
// `…<code>addr</code>。` 这种地方凭空多一个空格，而纯文本那份没有 —— 那正是 2026-08-30
// 中文教程页第 4 步被误报的原因。空白是这里唯一的噪声，索性整个抹掉：中文本来无空格，
// 英文去掉空格后词序仍然完整，判据不会因此变松。
function normText(t) {
  return String(t)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, '')
    .replace(/\s+/g, '');
}

const SITES = [
  { name: '国际 belliedmonkey.cc', dir: process.env.MT_SITE_CC
      || path.join(os.homedir(), 'belliedmonkey-cc'), i18n: true },
  { name: '中国 belliedmonkey.com', dir: process.env.MT_SITE_COM
      || path.join(os.homedir(), 'belliedmonkey-com'), i18n: false },
];

setTimeout(() => { console.log('\n✗ 超时（180s），没有结论'); process.exit(2); }, 180000).unref();

// content-main.js 真的还在注入吗 —— 网页那半边全靠它，先钉死这一头
function checkMarker() {
  const src = fs.readFileSync(path.join(ROOT, 'extension/content/content-main.js'), 'utf8');
  const m = src.match(/const MT_SITES = (\/.*?\/);/);
  if (!m) return ['content-main.js 里找不到 MT_SITES —— 注入标记没了，网站那盏灯永远不会亮'];
  const re = eval(m[1]);
  const bad = [];
  if (!re.test('belliedmonkey.cc') || !re.test('belliedmonkey.com')) bad.push('MT_SITES 不再匹配自家域名');
  // 放宽成通配就等于让任何网站都能探测出用户装了这个扩展 —— 那是指纹面，不是优化
  if (re.test('example.com')) bad.push('MT_SITES 匹配了外站 —— 这是指纹面泄漏');
  if (!/dataset\.mtExtension/.test(src)) bad.push('不再设置 dataset.mtExtension');
  if (!/mt-extension-ready/.test(src)) bad.push('不再派发 mt-extension-ready');
  return bad;
}

async function checkSite(site) {
  const file = path.join(site.dir, 'setup.html');
  if (!fs.existsSync(file)) { console.log(`  — 跳过：${site.dir} 没有 setup.html`); return null; }

  let blockI18n = false;   // 模拟弱网/CDN 抽风：字典与 i18n.js 一律拿不到
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (blockI18n && rel.startsWith('/i18n/')) { res.writeHead(503); return res.end(); }
    const f = path.join(site.dir, rel === '/' ? 'index.html' : rel);
    if (!f.startsWith(site.dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    res.end(fs.readFileSync(f));
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/setup.html';

  const chrome = await launchChrome();
  const bad = [];
  try {
    const cdp = await CDP.connect(chrome.port);
    const t = await cdp.send('Target.getTargets', {});
    const page = t.targetInfos.find((x) => x.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    cdp.listeners.push({ event: 'Runtime.exceptionThrown', fn: (p) => bad.push(
      'EXCEPTION ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text)) });
    cdp.listeners.push({ event: 'Log.entryAdded', fn: (p) => {
      if (p.entry.level !== 'error' || /favicon/.test(p.entry.url || '')) return;
      // 阶段 ④ 的 503 是本门禁自己造的，不是页面缺陷。
      if (blockI18n && /\/i18n\//.test(p.entry.url || '')) return;
      bad.push('ERROR ' + p.entry.text + ' ' + (p.entry.url || ''));
    } });
    await cdp.send('Page.enable', {}, sessionId);
    const ev = async (e) => JSON.parse((await cdp.send('Runtime.evaluate',
      { expression: e, awaitPromise: true, returnByValue: true }, sessionId)).result.value);
    const load = async () => {
      await cdp.send('Page.navigate', { url }, sessionId);
      await new Promise((r) => setTimeout(r, site.i18n ? 3000 : 1200));
    };

    // ① 没装扩展时：绝不能说已启用
    await load();
    let s = await ev(`JSON.stringify({
      cloaked: getComputedStyle(document.documentElement).visibility === 'hidden',
      h1: (document.querySelector('h1')||{}).innerText.trim() || '',
      steps: [...document.querySelectorAll('.step p, .howto ol li')].map(e=>e.innerText.trim()).filter(Boolean),
      wait: document.getElementById('mt-wait').innerText.trim(),
      waitShown: !document.getElementById('mt-wait').hidden,
      onShown: !document.getElementById('mt-on').hidden,
      demoShown: !document.getElementById('mt-demo').hidden,
      empty: [...document.querySelectorAll('[data-i18n],[data-i18n-html]')]
        .filter(e=>!e.innerText.trim()).map(e=>e.getAttribute('data-i18n')||e.getAttribute('data-i18n-html'))
    })`);
    if (s.cloaked) bad.push('页面仍被 i18n 遮罩挡着 —— 用户看到白屏');
    if (!s.h1) bad.push('h1 是空的');
    if (s.steps.length < 3) bad.push('三步引导不全：' + JSON.stringify(s.steps));
    if (s.empty.length) bad.push('渲染成空白的 i18n 键：' + s.empty.join(', '));
    if (!s.waitShown || !s.wait) bad.push('等待态没显示');
    // ⚠️ 最重要的一条。曾经真的坏过：i18n.js 的 `el.hidden = v === ''` 接管了每个
    // data-i18n 元素的 hidden，把「已启用」那句从一加载就露了出来。
    if (s.onShown) bad.push('没有扩展却显示「已启用」—— 这盏灯在撒谎，比没有更坏');
    if (s.demoShown) bad.push('没有扩展却露出了演示段落');

    // ② 属性路径（扩展先注入、页面后加载）
    await ev(`(()=>{document.documentElement.dataset.mtExtension='test';return'{}'})()`);
    await new Promise((r) => setTimeout(r, 1200));
    s = await ev(`JSON.stringify({on:!document.getElementById('mt-on').hidden,
      wait:!document.getElementById('mt-wait').hidden,
      demo:!document.getElementById('mt-demo').hidden,
      hasSteps:!!document.getElementById('mt-steps'),
      steps:!!(document.getElementById('mt-steps') && !document.getElementById('mt-steps').hidden),
      hasNext:!!document.getElementById('mt-next'),
      next:!!(document.getElementById('mt-next') && !document.getElementById('mt-next').hidden),
      nextLink:(()=>{const n=document.getElementById('mt-next');
        const a=n&&n.querySelector('a[href]');return a?a.getAttribute('href'):'';})(),
      nextText:(()=>{const n=document.getElementById('mt-next');
        return n?n.textContent.trim().length:0;})()})`);
    if (!s.on) bad.push('标记已注入但灯没变绿');
    if (s.wait) bad.push('等待态没收起，两句同时显示');
    if (!s.demo) bad.push('演示段落没露出');
    // 绿灯之后必须给出**下一步**。这一页能证明的只有「扩展装了且启用了」——
    // 它证明不了翻译引擎配没配，而它服务的正是刚启用、还没配的那批人：那个人此刻
    // 点悬浮按钮不会看到译文，会被送进配置引导。只把指南链接放在页脚等于没有下一步。
    if (!s.hasNext) bad.push('绿灯之后没有「下一步」那一段（#mt-next）—— '
      + '这一页证明不了引擎配没配，而它服务的正是还没配的人');
    else if (!s.next) bad.push('#mt-next 在，但绿灯之后没露出来');
    else if (!/guide|#how/.test(s.nextLink || '')) bad.push(`「下一步」指向 ${s.nextLink || '（空）'}，`
      + ' 期望指向配置指南');
    else if (s.nextText < 20) bad.push('「下一步」那一段几乎没有文字 —— i18n 键没解出来？');
    // 扩展已装好并授权之后，「去设置 → Safari 里打开」对这个人已经是做完的事；
    // 而对从扩展引导第 4 屏跳过来的 Chrome / Firefox 用户，那三步从一开始就是错的话
    // （他们的浏览器里根本没有 Safari 扩展设置）。一页「你成功了」的确认不该同时
    // 在教人做一件他不需要做的事。
    // 先断言元素**存在**，再断言它收起了。少了前一句，这条判据在没有 #mt-steps 的
    // 站点上是**空过**的 —— 元素不存在 ⇒ steps 恒为 false ⇒ 永远不报错。
    // 中国站原本就是这个情况，写这条判据时它骗过了我一次。
    if (!s.hasSteps) bad.push('页面上找不到 #mt-steps —— 这条判据会空过，等于没有');
    else if (s.steps) bad.push('检测到扩展后，Safari 三步没有收起 —— 在教一件已经做完/不适用的事');

    // ⑥ 结构化数据必须能解析，且必须是**静态**的
    //
    // JSON-LD 的语法错误会被浏览器和爬虫**静默忽略** —— 又一个「没报错也没生效」。
    // 而它对 GEO 的价值全在于机器能读懂：isAccessibleForFree / offers.price / license
    // 是 AI 推荐时的头号筛选条件，写错等于没写。
    //
    // 「静态」这一条同样要验：多数 AI 抓取器不执行 JS，被 i18n.js 注入的 JSON-LD 对
    // 它们等于不存在。所以判据是**从原始 HTML 文本里**解析，不是从渲染后的 DOM。
    for (const page of ['index.html', 'setup.html']) {
      const f = path.join(site.dir, page);
      if (!fs.existsSync(f)) continue;
      const html = fs.readFileSync(f, 'utf8');
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      if (!blocks.length) { bad.push(`${page} 里没有 JSON-LD —— GEO 的地基`); continue; }
      for (const b of blocks) {
        try {
          const d = JSON.parse(b[1]);
          const types = (d['@graph'] || [d]).map((x) => x['@type']).join(',');
          // 编造评分既违反 Google 结构化数据政策，又会被 AI 原样引用出去。
          if (JSON.stringify(d).includes('aggregateRating')) {
            bad.push(`${page} 的 JSON-LD 里有 aggregateRating —— 我们没有足够评分，那是编的`);
          }
          console.log(`  ✓ ${page} JSON-LD 可解析（${types}）`);
        } catch (e) {
          bad.push(`${page} 的 JSON-LD 解析失败：${e.message} —— 爬虫会静默忽略它`);
        }
      }
    }

    // ⑨ 教程页：必须与注册表逐字一致，且 HowTo 与可见正文对齐
    //
    // guide.html 是**生成**的（scripts/gen-setup-guide.js），因为一页写满模型名与端点
    // 的教程是最坏的那种副本：它在另一个仓库、没有构建、没有测试，而且恰恰是新用户
    // 唯一会照着抄的东西 —— 抄错一个端点，他们得到的是一个不工作的配置。
    //
    // 三条：与生成器输出逐字节相同（否则有人手改过，它已经开始漂移）；页面上出现的
    // 每个端点都必须是该 flavor 注册表里真有的；中国版还要过与 build.js 同一条合规正则。
    const guide = path.join(site.dir, 'guide.html');
    if (fs.existsSync(guide)) {
      const html = fs.readFileSync(guide, 'utf8');
      const flavor = site.dir.endsWith('-com') ? 'china' : 'global';
      let want = null;
      try { want = require('./lib/guide-render.js').build(flavor); } catch (e) { bad.push('生成教程页失败：' + e.message); }
      if (want !== null && want !== html) {
        bad.push(`guide.html 与注册表生成的结果不一致 —— 有人手改了它。跑 node scripts/gen-setup-guide.js`);
      }

      // 页面上的端点必须都在注册表里。反过来不查 —— 教程有权只讲一部分引擎。
      const known = new Set();
      for (const reg of ['providers', 'stt', 'tts']) {
        for (const e of require(`../build/${reg}.config.js`)) {
          if (!e.flavors.includes(flavor)) continue;
          const ep = (e.defaultEndpoint && typeof e.defaultEndpoint === 'object')
            ? e.defaultEndpoint[flavor] : e.defaultEndpoint;
          if (ep) known.add(ep);
          if (e.placeholder) known.add(e.placeholder);
        }
      }
      // 页面上出现的每个**模型名**也必须真实存在。
      //
      // 这一条防的是教程里最容易抄错、而且抄错了最贵的东西：一个看起来完全合理、
      // 目录里也确实列着的模型名，打过去却答「is not a valid model ID」。
      // 2026-08-30 实测撞到过一个：`deepseek/deepseek-v4-flash-latest` 在网关的模型
      // 清单里带 `~` 前缀，那个前缀不是模型名的一部分 —— 照清单抄进教程，新用户拿到的
      // 是一个不工作的配置和「这软件是坏的」的第一印象。
      //
      // 判据的来源是**注册表的默认模型 + 台账里打过的模型**：前者是我们出货时选的，
      // 后者是我们真的打过的。两者之外的名字，教程无权推荐。
      const knownModels = new Set();
      for (const reg of ['providers', 'stt', 'tts']) {
        for (const e of require(`../build/${reg}.config.js`)) {
          const dm = e.defaultModel;
          if (typeof dm === 'string' && dm) knownModels.add(dm);
          else if (dm && typeof dm === 'object') for (const v of Object.values(dm)) if (v) knownModels.add(v);
          for (const v of e.voices || []) knownModels.add(v);
        }
      }
      for (const r of require('../build/perf-ledger.config.js')) knownModels.add(r.model);

      const codes = [...html.matchAll(/<code>([^<]+)<\/code>/g)].map((x) => x[1].trim());
      for (const c of codes) {
        if (/^https?:\/\//i.test(c)) continue;            // 地址由下面那条查
        if (!knownModels.has(c)) {
          bad.push(`guide.html 上的 ${c} 既不是任何注册表的默认模型，也不在台账里 ——`
            + ' 教程无权推荐一个我们没出货也没打过的名字');
        }
      }

      const onPage = [...html.matchAll(/<code>(https?:\/\/[^<]+)<\/code>/g)].map((x) => x[1]);
      const strayEp = onPage.filter((u) => /\/(chat\/completions|messages|audio\/(speech|transcriptions))$/.test(u)
        && !known.has(u));
      for (const u of strayEp) {
        bad.push(`guide.html 上的端点 ${u} 不在 ${flavor} 注册表里 —— 教程在教一个软件里不存在的地址`);
      }

      // 语言纯度。注册表的 `label` 字段是**中文的**，即使在 global flavor 下也是 ——
      // 扩展 UI 显示的是 labelKey 指向的 _locales 条目，label 只是兜底。照搬它，英文
      // 教程页上就会出现「Google 翻译 works with no key at all」。生成器第一版就是这样，
      // 而它对机器完全合法：解析通过、结构正确、端点全对。只有人读一遍才看得出来。
      const cjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
      const prose = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
      if (flavor === 'global' && cjk.test(prose)) {
        const m2 = prose.match(new RegExp('.{0,40}' + cjk.source + '.{0,20}'));
        bad.push(`英文教程页里混进了中日韩文字：…${m2[0].replace(/\s+/g, ' ')}…`);
      }
      if (flavor === 'china' && !cjk.test(prose)) bad.push('中文教程页里一个中日韩字符都没有');

      if (flavor === 'china') {
        // 与 build.js 的 complianceGateChina 同一条正则。教程页和包体一样要过。
        const m = html.match(/ChatGPT|OpenAI|\bClaude\b|api\.openai\.com|api\.anthropic\.com/i);
        if (m) bad.push(`中国版 guide.html 里出现了合规禁词「${m[0]}」`);
      }

      for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        let d2; try { d2 = JSON.parse(b[1]); } catch (_) { continue; }
        if (d2['@type'] !== 'HowTo') continue;
        const visible = normText(html.replace(/<script[\s\S]*?<\/script>/g, ''));
        const miss = (d2.step || []).filter((st) => !visible.includes(normText(st.text)));
        if (miss.length) bad.push(`guide.html 的 HowTo 有 ${miss.length} 步不在可见正文里（如「${miss[0].name}」）`);
        else console.log(`  ✓ guide.html 由注册表生成，HowTo ${d2.step.length} 步与正文一致${flavor === 'china' ? '，合规词零命中' : ''}`);
      }
    }

    // ⑨b 中国站：每一页都必须展示 ICP 备案号并链到工信部查询页
    //
    // 已备案域名上的**每一个**页面都要展示备案号，不是首页展示就行。生成的 guide.html
    // 第一版就漏了它 —— 页脚是我照着别的页面写的，而备案那两行不在我抄的那一段里。
    // 它不会报错、不会白屏，只会在某次检查里变成一个问题。判据取自 index.html 现有的
    // 那一份，不在这里再写一遍号码。
    if (site.dir.endsWith('-com')) {
      const idx = fs.readFileSync(path.join(site.dir, 'index.html'), 'utf8');
      const icp = (idx.match(/[\u4e00-\u9fa5]{1,3}ICP备\d+号/) || [])[0];
      if (!icp) bad.push('中国站 index.html 上找不到 ICP 备案号');
      else {
        const missing = fs.readdirSync(site.dir).filter((f) => f.endsWith('.html'))
          .filter((f) => !fs.readFileSync(path.join(site.dir, f), 'utf8').includes(icp));
        if (missing.length) bad.push(`中国站这些页面没有展示备案号 ${icp}：${missing.join(', ')}`);
        else console.log(`  ✓ 中国站每一页都展示了备案号 ${icp}`);
      }
    }

    // ⑩ 预渲染的语言页
    //
    // 站点原本是运行时 i18n：一套 URL，canonical 固定指向根 —— Google 对一个 canonical
    // 只索引一种语言，于是八份翻译里有七份从来没被搜索引擎见过。预渲染给了每种语言
    // 自己的 URL 与 hreflang，那七份翻译这才成为可检索的资产。
    //
    // 四条判据。最要紧的是**不许加载 i18n.js**：它会按 localStorage 里存的语言重新
    // 渲染整页，访客上次选阿拉伯语时，/zh-CN/ 会被就地改成阿拉伯语并翻成 RTL。
    if (fs.existsSync(path.join(site.dir, 'i18n', 'i18n.js'))) {
      let gen = null;
      try { gen = require('./gen-site-langs.js'); } catch (e) { bad.push('加载语言页生成器失败：' + e.message); }
      if (gen) {
        const langs = gen.langsFrom(fs.readFileSync(path.join(site.dir, 'i18n', 'i18n.js'), 'utf8'));
        const version = fs.readFileSync(path.join(site.dir, 'VERSION'), 'utf8').trim();
        const SCRIPTS = { 'zh-CN': /[\u4e00-\u9fff]/, ar: /[\u0600-\u06ff]/, ru: /[\u0400-\u04ff]/, hi: /[\u0900-\u097f]/ };
        let n = 0;
        for (const l of langs) {
          if (l.code === 'en') continue;
          const dict = JSON.parse(fs.readFileSync(path.join(site.dir, 'i18n', l.code + '.json'), 'utf8'));
          for (const page of gen.PAGES) {
            const f = path.join(site.dir, l.code, page);
            if (!fs.existsSync(f)) { bad.push(`缺 ${l.code}/${page} —— 跑 node scripts/gen-site-langs.js`); continue; }
            const html = fs.readFileSync(f, 'utf8');
            const src = fs.readFileSync(path.join(site.dir, page), 'utf8');
            let want;
            try { want = gen.render(src, page, l.code, dict, langs, version); }
            catch (e) { bad.push(`${l.code}/${page} 生成失败：${e.message}`); continue; }
            if (want !== html) bad.push(`${l.code}/${page} 与字典不一致 —— 跑 node scripts/gen-site-langs.js`);
            if (/i18n\/i18n\.js/.test(html)) {
              bad.push(`${l.code}/${page} 还加载着 i18n.js —— 它会按 localStorage 把这一页改成别的语言`);
            }
            if (html.includes('{v}')) bad.push(`${l.code}/${page} 里漏出了 {v} 占位符`);
            const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
            if (canon !== `https://${gen.HOST}${gen.urlFor(page, l.code)}`) {
              bad.push(`${l.code}/${page} 的 canonical 是 ${canon} —— 指错了就等于把这一页并回主版本`);
            }
            // 只数 <link rel="alternate">。语言行里的 <a hreflang> 也带这个属性
            // （那是对的，它告诉爬虫链接目标的语言），但它不是 alternate 声明。
            const alts = (html.match(/<link rel="alternate" hreflang="/g) || []).length;
            if (alts !== langs.length + 1) bad.push(`${l.code}/${page} 的 hreflang 有 ${alts} 条，应为 ${langs.length + 1}（含 x-default）`);
            const re = SCRIPTS[l.code];
            if (re) {
              const prose = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
              if (!re.test(prose)) bad.push(`${l.code}/${page} 的正文里没有该语系的字符 —— 没渲染成那门语言`);
            }
            n++;
          }
        }
        if (n && !bad.length) console.log(`  ✓ ${n} 个语言页：与字典一致、canonical 自指、${langs.length + 1} 条 hreflang、无 i18n.js`);
      }
    }

    // ⑧ 官网字典：键集一致 + meta 串不许留英文兜底
    //
    // 官网仓库**一道门禁都没有**（扩展仓库那套 i18n-parity 管不到它）。两条：
    //   · 键集必须一致 —— 少一个键，那个语言的那处 UI 直接空白（i18n.js 的 fill()
    //     对 undefined 只是 console.warn，页面上什么都不会说）。
    //   · `.title` / `.desc` 这些**只出现在 <title> 与 og/meta 里**的串，不许等于 en。
    //     它们的特别之处是：错了在页面上完全看不见 —— 只有分享卡片、标签页标题和
    //     搜索结果摘要会露出来，而那三个地方谁都不会天天检查。setup/privacy/support
    //     三条曾在 6 个语言里一直是英文兜底。
    //   判据只钉这一类键，不做「所有值都不许等于 en」—— 那会因为品牌名、语言自名之类
    //   产生大量误报，而一道天天误报的门禁只会被注释掉。
    const i18nDir = path.join(site.dir, 'i18n');
    if (fs.existsSync(i18nDir)) {
      const dicts = {};
      for (const f of fs.readdirSync(i18nDir).filter((x) => x.endsWith('.json'))) {
        try { dicts[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(i18nDir, f), 'utf8')); }
        catch (e) { bad.push(`i18n/${f} 不是合法 JSON：${e.message}`); }
      }
      const en = dicts.en;
      if (en) {
        const base = Object.keys(en).sort().join('\n');
        const META = Object.keys(en).filter((k) => /\.(title|desc)$/.test(k));
        for (const [loc, d] of Object.entries(dicts)) {
          if (loc === 'en') continue;
          if (Object.keys(d).sort().join('\n') !== base) {
            const miss = Object.keys(en).filter((k) => !(k in d));
            const extra = Object.keys(d).filter((k) => !(k in en));
            bad.push(`i18n/${loc}.json 键集与 en 不一致`
              + (miss.length ? `，少：${miss.slice(0, 4).join(', ')}` : '')
              + (extra.length ? `，多：${extra.slice(0, 4).join(', ')}` : ''));
          }
          const fell = META.filter((k) => d[k] !== undefined && d[k] === en[k]);
          if (fell.length) {
            bad.push(`i18n/${loc}.json 的 ${fell.join(', ')} 还是英文原文 —— 这类串只在`
              + ' <title> 与分享卡片里露面，页面上看不出来');
          }
        }
        if (!bad.length) console.log(`  ✓ 官网 ${Object.keys(dicts).length} 份字典：键集一致，${META.length} 个 meta 串无英文兜底`);
      }
    }

    // ⑦ sitemap、内链与 FAQ 结构化数据
    //
    // GEO 的三条地基，每一条都是「写完就再也没人看一眼」的那种：
    //   · sitemap 与文件系统必须双向一致 —— 少写一条，那一页搜索引擎就不知道存在；
    //     多写一条（页面改名/删了），抓取器拿到 404，整份 sitemap 的可信度下降。
    //   · 没有孤儿页 —— 只在 sitemap 里而没有任何站内链接指过去的页面，权重近乎为零。
    //   · FAQPage 的问答必须逐字出现在可见正文里 —— 结构化数据与看得见的内容不一致
    //     违反 Google 的政策，而 AI 抓取器会交叉核对；不一致时它们信正文、丢掉标注，
    //     等于白写。这一条只能逐条比对，肉眼永远看不出来。
    const smPath = path.join(site.dir, 'sitemap.xml');
    if (fs.existsSync(smPath)) {
      const sm = fs.readFileSync(smPath, 'utf8');
      const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      // URL → 磁盘路径。`/` 与 `/zh-CN/` 都落到各自的 index.html。
      const rel = (u) => {
        const r = u.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
        return r === '' || r.endsWith('/') ? r + 'index.html' : r;
      };
      const listed = new Set(locs.map(rel));

      for (const f of listed) {
        if (!fs.existsSync(path.join(site.dir, f))) bad.push(`sitemap 里的 ${f} 在站点里不存在 —— 抓取器会拿到 404`);
      }
      // 反向：站上的内容页必须在 sitemap 里。要连**语言子目录**一起走 —— 只看顶层的话，
      // 预渲染出来的 28 个语言页会全部漏检，而那正是这一步存在的理由。
      // 排除 -cn 结尾的那两页（给商店表单用的定向链接，不进索引）。
      const htmlUnder = (d, prefix) => fs.existsSync(path.join(site.dir, d))
        && fs.statSync(path.join(site.dir, d)).isDirectory()
        ? fs.readdirSync(path.join(site.dir, d)).filter((f) => f.endsWith('.html')).map((f) => prefix + f)
        : [];
      const top = fs.readdirSync(site.dir).filter((f) => f.endsWith('.html') && !/-cn\.html$/.test(f));
      const langDirs = fs.readdirSync(site.dir)
        .filter((f) => /^[a-z]{2}(-[A-Za-z]+)?$/.test(f) && fs.statSync(path.join(site.dir, f)).isDirectory());
      const onDisk = top.concat(...langDirs.map((d) => htmlUnder(d, d + '/')));
      for (const f of onDisk) {
        if (!listed.has(f)) bad.push(`${f} 不在 sitemap 里 —— 搜索引擎不知道它存在`);
      }

      // 孤儿：每个被列出的页面都要至少被另一个页面**用 <a> 链到**。
      // 首页在链接里写作 `/zh-CN/`（不是 `/zh-CN/index.html`），两种写法都认。
      const hrefForms = (f) => {
        const forms = ['/' + f];
        if (f.endsWith('index.html')) forms.push('/' + f.slice(0, -'index.html'.length));
        return forms;
      };
      for (const f of listed) {
        if (f === 'index.html') continue;
        const pats = hrefForms(f).map((h) => new RegExp('href="' + h.replace(/[.]/g, '\\.') + '"'));
        const linked = onDisk.some((o) => o !== f
          && pats.some((re) => re.test(fs.readFileSync(path.join(site.dir, o), 'utf8'))));
        if (!linked) bad.push(`${f} 是孤儿页 —— 只在 sitemap 里，站内没有任何 <a> 指过去`);
      }
      if (!bad.length) console.log(`  ✓ sitemap ${listed.size} 页（含 ${onDisk.length - top.length} 个语言页）：与文件一一对应，且无孤儿`);
    }

    for (const f of fs.readdirSync(site.dir).filter((x) => x.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(site.dir, f), 'utf8');
      for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        let d; try { d = JSON.parse(b[1]); } catch (_) { continue; }   // 解析失败由 ⑥ 报
        if (d['@type'] !== 'FAQPage') continue;
        // 比对前必须**剥标签并归一化空白**。可见正文里一句话中间可能有个 <a>
        // （faq.html 的开源那一问就有），逐字比对会把它误报成漏写。
        // 同样重要的是先剥掉 <script>：JSON-LD 自己就在文件里，拿整份 HTML 去
        // includes() 是恒真的 —— 写这条判据时我先用那个形式自查了一遍，三页全绿，
        // 而其中一页真的对不上。判据能骗人的方向，这次是「永远通过」。
        const visible = normText(html.replace(/<script[\s\S]*?<\/script>/g, ''));
        const miss = (d.mainEntity || []).filter((q) => !visible.includes(normText(q.name))
          || !visible.includes(normText(q.acceptedAnswer.text)));
        if (miss.length) {
          bad.push(`${f} 的 FAQPage 有 ${miss.length} 条问答不在可见正文里（如「${miss[0].name.slice(0, 30)}…」）`
            + ' —— 与可见内容不一致的结构化数据会被丢弃');
        } else {
          console.log(`  ✓ ${f} FAQPage ${d.mainEntity.length} 问，逐条与可见正文一致`);
        }
      }
    }

    // ⑤ 首页的版本号必须替换成真数字
    //
    // 在此之前 `v1.6.7` 被写死在 8 份字典 + index.html 的兜底文本里（18 处）。漏改的
    // 表现不是报错，是**全站 8 种语言同时说谎**：下载按钮写着旧版本号，而它链接的
    // releases/latest 指向新版。现在文案里是 `v{v}`，由 i18n.js 从 /VERSION 替换。
    //
    // 两个方向都要验：占位符不许漏在页面上，版本号也必须真的出现。
    if (fs.existsSync(path.join(site.dir, 'VERSION'))) {
      const want = fs.readFileSync(path.join(site.dir, 'VERSION'), 'utf8').trim();

      // ⑤a 版本号有三份副本，必须是**一条被检查的链**，不是三处各写各的：
      //     package.json（唯一来源）→ 站点 /VERSION → JSON-LD 的 softwareVersion。
      // 中间两份是给**不跑 JS 的爬虫**看的，运行时替换救不了它们。
      const pkgV = require('../package.json').version;
      if (want !== pkgV) {
        bad.push(`站点 VERSION 是 ${want}，package.json 是 ${pkgV} —— 发版时漏同步了`);
      }
      for (const page of ['index.html']) {
        const f = path.join(site.dir, page);
        if (!fs.existsSync(f)) continue;
        const raw = fs.readFileSync(f, 'utf8');

        // 原始 HTML 里不许有 {v}。渲染后的判据（下面那条）看不见这个：
        // i18n.js 会把占位符换掉，但爬虫拿到的是**替换之前**的文本。
        // 2026-08-30 实测：线上下载按钮对 curl 显示 "Download for Chrome — v{v} (ZIP)"，
        // 而渲染判据全绿 —— 正是这一页做 GEO 想要的那批读者看到了一句坏掉的话。
        // 修法是静态兜底**不提版本号**（JS 补上），这样它天然不会过期。
        const m = raw.match(/.{0,50}\{v\}.{0,20}/s);
        if (m) bad.push(`${page} 的原始 HTML 里漏出 {v} —— 不跑 JS 的爬虫会原样读到：…${m[0].replace(/\s+/g, ' ')}…`);

        const sv = raw.match(/"softwareVersion"\s*:\s*"([^"]+)"/);
        if (!sv) bad.push(`${page} 的 JSON-LD 没有 softwareVersion —— 爬虫无从判断新鲜度`);
        else if (sv[1] !== want) bad.push(`${page} 的 softwareVersion 是 ${sv[1]}，VERSION 是 ${want}`);
        else console.log(`  ✓ ${page} 版本链一致：package.json = /VERSION = softwareVersion = ${want}`);
      }
      await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + srv.address().port + '/index.html' }, sessionId);
      await new Promise((r) => setTimeout(r, 3000));
      const v = await ev(`JSON.stringify({
        raw: /\\{v\\}/.test(document.body.innerText),
        has: document.body.innerText.indexOf(${JSON.stringify('v' + '')} + ${JSON.stringify(want)}) >= 0,
        dl: (document.querySelector('[data-i18n="home.installDl"]')||{}).innerText || ''
      })`);
      // 字典里带 {v} 才有「替换成功」可言。中国站没有下载区，跳过而不是假装通过。
      const dictHasV = fs.existsSync(path.join(site.dir, 'i18n', 'en.json'))
        && fs.readFileSync(path.join(site.dir, 'i18n', 'en.json'), 'utf8').includes('{v}');
      if (v.raw) bad.push('首页上漏出了未替换的 {v} 占位符');
      if (dictHasV && !v.has) bad.push(`首页没有出现 VERSION 里的版本号 v${want} —— 下载按钮: ${JSON.stringify(v.dl)}`);
      if (dictHasV && !v.raw && v.has) console.log(`  ✓ 首页渲染后显示 v${want}（i18n.js 从 /VERSION 取，非写死）`);
    }

    // ④ 断网：i18n 拿不到时，页面**仍然必须有字**
    //
    // 2026-08-29 真机第一次打开这一页时，看到的是「排版完整、一个字都没有」。
    // 站点所有文案原本只存在于 /i18n/<lang>.json 里，HTML 标签全是空的；i18n.js 或
    // 字典一旦加载失败，apply() 根本不会被调用，于是每个元素保持它的空内容。解遮罩
    // 有兜底（head 里那条 2500ms 内联定时器），所以页面一定会显示——**只是没有字**。
    // 兜底了容器，没兜底内容。
    //
    // 这条对 privacy.html / support.html 尤其要紧：那两个 URL 直接写在 App Store
    // Connect 与 Chrome 应用商店的提交表单里，审核员在弱网下看到的会是一张空白隐私政策。
    //
    // 修法是把默认语言文案内联进 HTML，让 i18n 去**替换**而不是**提供**。
    // 本地开发永远测不到这条 —— localhost 从不失败，所以只能靠这里主动拦。
    // en.json 里值为空串 = **故意**对英文隐藏该元素（i18n.js 的 `el.hidden = v === ''`）。
    // 这类元素本来就不该有文案，必须排除；靠 el.hidden 判断是错的 —— i18n 挂掉时
    // fill() 根本没跑，hidden 也就从未被设上。
    let intentionallyBlank = new Set();
    try {
      const en = JSON.parse(fs.readFileSync(path.join(site.dir, 'i18n', 'en.json'), 'utf8'));
      intentionallyBlank = new Set(Object.keys(en).filter((k) => !String(en[k]).trim()));
    } catch (_) { /* 中国站没有 i18n 目录 —— 它本来就是内联中文，天然免疫 */ }

    blockI18n = true;
    const pages = ['/setup.html', '/index.html', '/privacy.html', '/support.html']
      .filter((f) => fs.existsSync(path.join(site.dir, f.slice(1))));
    for (const page of pages) {
      const pUrl = 'http://127.0.0.1:' + srv.address().port + page;
      await cdp.send('Page.navigate', { url: pUrl }, sessionId);
      await new Promise((r) => setTimeout(r, 3200));   // 等过 head 里那条 2500ms 兜底
      const r = await ev(`JSON.stringify({
        cloaked: getComputedStyle(document.documentElement).visibility === 'hidden',
        chars: document.body.innerText.replace(/\\s+/g,'').length,
        emptyKeyed: [...document.querySelectorAll('[data-i18n],[data-i18n-html]')]
          .filter(e => !e.innerText.trim())
          .map(e => e.getAttribute('data-i18n') || e.getAttribute('data-i18n-html'))
      })`);
      if (r.cloaked) bad.push(page + '：i18n 挂掉时页面仍被遮罩挡着（纯白屏）');
      // 200 字是「像一个页面」的下限：空壳页只剩版权行，远达不到。
      if (r.chars < 200) bad.push(page + `：i18n 挂掉时正文只剩 ${r.chars} 字 —— 有排版没文字`);
      r.emptyKeyed = r.emptyKeyed.filter((k) => !intentionallyBlank.has(k));
      if (r.emptyKeyed.length) {
        bad.push(page + '：i18n 挂掉时这些元素是空的（HTML 里没有内联兜底文案）：'
          + r.emptyKeyed.slice(0, 6).join(', ') + (r.emptyKeyed.length > 6 ? ` …共 ${r.emptyKeyed.length} 个` : ''));
      }
    }
    blockI18n = false;

    // ③ 事件路径（页面先加载、扩展后注入 —— 属性没设时只能靠它）
    await load();
    if ((await ev(`JSON.stringify({on:!document.getElementById('mt-on').hidden})`)).on) {
      bad.push('重载后灯就是绿的 —— 状态没被重置');
    }
    await ev(`(()=>{document.dispatchEvent(new CustomEvent('mt-extension-ready',{detail:{version:'t'}}));return'{}'})()`);
    await new Promise((r) => setTimeout(r, 400));
    if (!(await ev(`JSON.stringify({on:!document.getElementById('mt-on').hidden})`)).on) {
      bad.push('事件路径没生效');
    }
  } finally { chrome.cleanup(); srv.close(); }
  return bad;
}

(async () => {
  let ok = true;
  console.log('扩展侧（注入标记）');
  const m = checkMarker();
  m.forEach((x) => console.log('  ✗ ' + x));
  if (m.length) ok = false; else console.log('  ✓ MT_SITES 只匹配自家域名，标记与事件都还在');

  for (const site of SITES) {
    console.log('\n' + site.name);
    const bad = await checkSite(site);
    if (bad === null) continue;
    bad.forEach((x) => console.log('  ✗ ' + x));
    if (bad.length) ok = false; else console.log('  ✓ 三条路径都对：未装不误报、属性触发、事件触发');
  }
  console.log(ok ? '\n✓ 启用页契约通过' : '\n✗ 启用页契约未通过');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
