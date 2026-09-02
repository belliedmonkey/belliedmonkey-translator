#!/usr/bin/env node
// scripts/verify-site-handoff.js — 官网试翻页上那个「下一步」块，真的会被填出来吗。
//
// 这条链路是产品里最容易断而最不容易被发现的一段：用户在网页上翻译成功了，然后
// **什么都不会发生** —— 卡片留在本机，App 永远是空的，而没有任何界面提过这件事。
// 2026-09-01 用户在真机上走完整条引导后报的就是它。
//
// 为什么必须用真实主机名：内容脚本的判据是 `location.hostname` 匹配
// belliedmonkey.(cc|com)（content-main.js 的 MT_SITES —— 那是**安全边界**，
// 只在自家域名注入探测标记，放宽等于给任何网站一个指纹面）。在 127.0.0.1 上测
// 等于测了另一条分支，永远发现不了这里的问题。
//
// 怎么把那个主机名指到本地：**CDP 的 Fetch 请求拦截**，不是本地服务器 + DNS 改写。
// 后者试过两版都不行：http:// 被 HSTS 预加载无条件升级成 https://（--disable-features
// 对预加载项无效），而 --host-resolver-rules 被 Chrome 直接忽略 —— 实测本地服务器
// 零命中，页面打到了**真站**上，标题是 Vercel 的「404: NOT_FOUND」。一道会偷偷访问
// 生产环境的门禁，测的根本不是本地这份改动。拦截不依赖 DNS，也绕不开。
//
// 判据一律**读渲染**，不读属性：
//   · 没装扩展 ⇒ 容器在 DOM 里但一个字都没有（页面只发空壳）
//   · 装了扩展 ⇒ 标题/正文/按钮都有真文字，按钮指向复习页
//   · 采集关着 ⇒ 换一套文案，按钮改指设置页（把人送去空复习页是骗他）
//
//   node scripts/verify-site-handoff.js [dist 目录]

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const DIST = process.argv[2] || path.join(__dirname, '..', 'dist');
const SITE = process.env.MT_SITE_CC || path.join(os.homedir(), 'belliedmonkey-cc');
const PAGE = '/try/zh-CN.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(path.join(SITE, PAGE))) {
    console.log(`  — 跳过：${SITE}${PAGE} 不在（站点没 checkout，本地工具不进 CI）`);
    process.exit(0);
  }

  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  const problems = [];
  const notes = [];
  const HARD = setTimeout(() => { console.log('✗ 超时'); process.exit(1); }, 150000);

  const probe = `(() => {
    const b = document.getElementById('mt-next-review');
    const vis = (el) => !!(el && el.getClientRects().length);
    if (!b) return JSON.stringify({ box: false });
    const btn = b.querySelector('button');
    const link = b.querySelector('a[href]');
    return JSON.stringify({
      box: true, shown: vis(b), text: (b.textContent || '').trim().length,
      h2: ((b.querySelector('h2') || {}).textContent || '').trim(),
      btnText: ((btn || {}).textContent || '').trim(),
      btnHref: btn ? (btn.dataset.href || '') : '',
      linkHref: link ? link.getAttribute('href') : '',
    });
  })()`;

  // 把 belliedmonkey.cc 的每一个请求就地兑现成站点仓库里的文件。
  async function intercept(sessionId) {
    await cdp.send('Fetch.enable',
      { patterns: [{ urlPattern: 'https://belliedmonkey.cc/*' }] }, sessionId);
  }
  cdp.on('Fetch.requestPaused', async (p, sid) => {
    try {
      const u = new URL(p.request.url);
      const rel = decodeURIComponent(u.pathname);
      const f = path.join(SITE, rel === '/' ? 'index.html' : rel);
      if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        await cdp.send('Fetch.fulfillRequest',
          { requestId: p.requestId, responseCode: 404, body: '' }, sid);
        return;
      }
      const buf = fs.readFileSync(f);
      await cdp.send('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: MIME[path.extname(f)] || 'text/plain' }],
        body: buf.toString('base64'),
      }, sid);
    } catch (_) {
      try { await cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' }, sid); } catch (__) {}
    }
  });

  async function open(url, sessionId) {
    await cdp.send('Page.navigate', { url }, sessionId);
    await sleep(2500);
  }
  async function ev(sessionId, expr) {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result ? r.result.value : undefined;
  }

  // 启用页那个「下一步」按钮长什么样。两次都用它 —— 装扩展前后各读一次，
  // 差别本身就是断言的内容。
  const nextProbe = `(() => {
    const box = document.getElementById('mt-next');
    const a = box && box.querySelector('a[href]');
    return JSON.stringify({ has: !!box, href: a ? a.getAttribute('href') : '',
      text: a ? (a.textContent || '').trim() : '' });
  })()`;

  try {
    // ── ① 没装扩展：容器在，但一个字都没有 ──────────────────────────────
    let { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    let att = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, att.sessionId);
    await intercept(att.sessionId);
    await open(`https://belliedmonkey.cc${PAGE}`, att.sessionId);
    const before = JSON.parse(await ev(att.sessionId, probe));
    notes.push(`未装扩展：容器 ${before.box ? '在' : '不在'}，文字 ${before.text} 字`);
    if (!before.box) problems.push('页面上没有 #mt-next-review 容器 —— 跑 node scripts/gen-try-pages.js');
    else if (before.text > 0) problems.push('没装扩展，块里却已经有文字 —— 页面自己写了文案？'
      + '它应当是空壳，文案由扩展按用户的界面语言填');
    else if (before.shown) problems.push('没装扩展，空块却显示出来了');

    // 先看**没装扩展**时的样子：站点自己发的仍然是那篇指南 —— 对还没有配置页可进的人
    // 那是对的，接管不许把它也改掉。
    let t2 = await cdp.send('Target.createTarget', { url: 'about:blank' });
    let a2 = await cdp.send('Target.attachToTarget', { targetId: t2.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, a2.sessionId);
    await intercept(a2.sessionId);
    await open('https://belliedmonkey.cc/setup.html', a2.sessionId);
    // 站点脚本只有检测到扩展才露出 #mt-next；这里没有扩展，所以直接读 DOM 里的 href。
    const bare = JSON.parse(await ev(a2.sessionId, nextProbe));
    notes.push(`启用页（未装扩展）：${bare.href || '（无）'}`);
    if (!bare.has) problems.push('启用页上没有 #mt-next —— 站点结构变了？');
    else if (!/guide/.test(bare.href || '')) {
      problems.push(`没装扩展时「下一步」指向 ${bare.href}，期望仍是站点的配置指南 ——`
        + ' 那个人还没有配置页可进');
    }

    // ── ② 装上扩展：块被填出来，按钮指向复习页 ──────────────────────────
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    const extId = loaded && loaded.id;
    if (!extId) throw new Error('Extensions.loadUnpacked 没有回 id');
    // 采集默认是关的。先测「关着」这一支，再打开测「开着」那一支 —— 两支文案不同，
    // 而把一个没开采集的人送去空复习页，是把失败推迟到下一屏。
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    att = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, att.sessionId);
    await intercept(att.sessionId);
    await open(`https://belliedmonkey.cc${PAGE}`, att.sessionId);
    const off = JSON.parse(await ev(att.sessionId, probe));
    notes.push(`采集关：标题「${off.h2}」按钮「${off.btnText}」链接 ${off.linkHref || '（无）'}`);
    if (!off.shown) problems.push('装了扩展，块却没露出来 —— MT_SITES 分支没跑到？');
    if (!off.h2) problems.push('块里没有标题 —— i18n 键没解出来');
    if (!off.btnText) problems.push('块里没有按钮');
    if (off.linkHref) problems.push('采集关着时不该给「直接去登录」—— 还没有卡可同步');

    // 打开采集，重开一次页面
    const swTargets = await cdp.send('Target.getTargets');
    const sw = swTargets.targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId));
    if (!sw) problems.push('service worker 没起来，改不了 learnEnabled');
    else {
      const swAtt = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, swAtt.sessionId);
      await cdp.send('Runtime.evaluate', {
        expression: 'new Promise((r)=>chrome.storage.local.set({learnEnabled:true},()=>r(1)))',
        awaitPromise: true, returnByValue: true }, swAtt.sessionId);
      ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
      att = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, att.sessionId);
      await intercept(att.sessionId);
      await open(`https://belliedmonkey.cc${PAGE}`, att.sessionId);
      const on = JSON.parse(await ev(att.sessionId, probe));
      notes.push(`采集开：标题「${on.h2}」按钮「${on.btnText}」链接 ${on.linkHref || '（无）'}`);
      if (!on.shown) problems.push('采集开着时块没露出来');
      if (!on.btnText) problems.push('采集开着时块里没有按钮');
      if (on.btnText === off.btnText) {
        problems.push('采集开/关两支的按钮文案一样 —— 其中一支没生效，'
          + '而把没开采集的人送去空复习页正是要避免的事');
      }
      if (!/options\/options\.html#sync$/.test(on.linkHref || '')) {
        problems.push(`采集开着时「直接去登录」指向 ${on.linkHref || '（无）'}，期望 options/options.html#sync`);
      }
    }

    // 再看**装了扩展**时：内容脚本应当把它接管成引导页。
    t2 = await cdp.send('Target.createTarget', { url: 'about:blank' });
    a2 = await cdp.send('Target.attachToTarget', { targetId: t2.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, a2.sessionId);
    await intercept(a2.sessionId);
    await open('https://belliedmonkey.cc/setup.html', a2.sessionId);
    const took = JSON.parse(await ev(a2.sessionId, nextProbe));
    notes.push(`启用页（装了扩展）：「${took.text}」→ ${took.href || '（无）'}`);
    if (!/^chrome-extension:\/\/[a-z]+\/onboard\/onboard\.html$/.test(took.href || '')) {
      problems.push(`装了扩展时「下一步」仍指向 ${took.href} —— 站在这一页的人已经装好了，`
        + '正确的下一步是直接进配置引导，不是再读一篇文章');
    }
    if (took.text === bare.text) {
      problems.push(`接管前后按钮文案都是「${took.text}」—— 地址变了而话没变，`
        + '「打开配置指南」指向一个引导页是骗人的');
    }
  } catch (e) {
    problems.push('跑挂了：' + ((e && e.message) || e));
  } finally {
    clearTimeout(HARD);
    try { await cdp.close(); } catch (_) {}
    try { chrome.kill ? chrome.kill() : chrome.cleanup(); } catch (_) {}
  }

  for (const n of notes) console.log('  ' + n);
  if (problems.length) {
    console.log('');
    for (const p of problems) console.log('  ✗ ' + p);
    console.log('\n✗ 官网交接未通过');
    process.exit(1);
  }
  console.log('\n✓ 官网试翻页：空壳 → 装上扩展就被填出来，采集开/关两支各自成立');
  process.exit(0);
})().catch((e) => { console.error('verify-site-handoff failed:', (e && e.stack) || e); process.exit(1); });
