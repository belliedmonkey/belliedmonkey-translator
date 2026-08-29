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

  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
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
      demo:!document.getElementById('mt-demo').hidden})`);
    if (!s.on) bad.push('标记已注入但灯没变绿');
    if (s.wait) bad.push('等待态没收起，两句同时显示');
    if (!s.demo) bad.push('演示段落没露出');

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
