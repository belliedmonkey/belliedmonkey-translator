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
      steps:!!(document.getElementById('mt-steps') && !document.getElementById('mt-steps').hidden)})`);
    if (!s.on) bad.push('标记已注入但灯没变绿');
    if (s.wait) bad.push('等待态没收起，两句同时显示');
    if (!s.demo) bad.push('演示段落没露出');
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
