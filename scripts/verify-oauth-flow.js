#!/usr/bin/env node
// scripts/verify-oauth-flow.js —— 第三方登录：**只有票跨界，会话不跨界**（§8.4.1.2）
//
//   node scripts/verify-oauth-flow.js [dist目录]
//
// 这道门禁存在的唯一理由：整条链上最要命的性质是「内容脚本拿到的东西换不出任何
// 东西」。那是个**否定性**的性质 —— 代码看起来正确、单测也绿，都不能证明它成立；
// 只有把真扩展装进真浏览器、走一遍真回调、然后回读内容脚本那一侧的存储，才算数。
//
// 四条断言：
//   ① 回调页把 code + state 递进了 storage，且**只有这两样**（没有 token / 邮箱）
//   ② 内容脚本可读的键面里**没有 learnAuth** —— 这是 §8.4.1 的硬性不变量
//   ③ 兑换发生在**扩展页**，不在内容脚本（内容脚本一个 Supabase 请求都不该发）
//   ④ state 不符时整条流程停住，且不发请求
//
// 不打真实的 Google/Apple：那需要真账号与人工点击，是发版前人工验证的事
// （见 plans 里的三条人工项）。这里假冒的是**回调之后**那一段 —— 恰好是我们自己
// 写的、也是唯一会出错的那一段。

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const DIST = process.argv[2] || path.join(__dirname, '..', 'dist');
const SITE = process.env.MT_SITE_CC || path.join(os.homedir(), 'belliedmonkey-cc');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const problems = []; const notes = [];
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  // Supabase 的每一个请求都记下来。判据里「内容脚本没发请求」靠的就是它。
  const supabaseHits = [];
  try {
    async function intercept(sessionId) {
      await cdp.send('Fetch.enable', { patterns: [
        { urlPattern: 'https://belliedmonkey.cc/*' },
        { urlPattern: 'https://*.supabase.co/*' },
      ] }, sessionId);
    }
    cdp.on('Fetch.requestPaused', async (p, sid) => {
      try {
        const u = new URL(p.request.url);
        if (u.hostname.endsWith('.supabase.co')) {
          // **来源**才是判据，不是时间先后。内容脚本发的请求带页面 origin
          // （https://belliedmonkey.cc），扩展页发的带 chrome-extension://。
          // 第一版按「回调之后 N 秒内」算，结果把跳转后扩展页的兑换算在了回调页
          // 头上 —— 那是把时序当因果。
          const h = p.request.headers || {};
          supabaseHits.push({ url: p.request.url, origin: h.Origin || h.origin || '' });
          // 兑换端点回一个像样的 session，好让后半段能继续走。
          await cdp.send('Fetch.fulfillRequest', {
            requestId: p.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' },
              { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: Buffer.from(JSON.stringify({
              access_token: 'FAKE-ACCESS', refresh_token: 'FAKE-REFRESH', expires_in: 3600,
              user: { id: 'u-oauth', email: 'oauth@example.com' },
            })).toString('base64'),
          }, sid);
          return;
        }
        const rel = decodeURIComponent(u.pathname);
        const f = path.join(SITE, rel === '/' ? 'index.html' : rel);
        if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
          await cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404, body: '' }, sid);
          return;
        }
        await cdp.send('Fetch.fulfillRequest', {
          requestId: p.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: MIME[path.extname(f)] || 'text/plain' }],
          body: fs.readFileSync(f).toString('base64'),
        }, sid);
      } catch (_) {
        try { await cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' }, sid); } catch (__) {}
      }
    });

    const loaded = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    const extId = loaded && loaded.id;
    if (!extId) throw new Error('Extensions.loadUnpacked 没有回 id');
    notes.push('扩展 id ' + extId);

    // 服务工作线程：兑换**不该**发生在这里，但读存储要靠它（内容脚本那一侧的证据）。
    // 它是异步起来的 —— 装完就去找必然找不到（同 verify-extension-smoke 的等法）。
    let swS = null;
    for (let i = 0; i < 60 && !swS; i += 1) {
      const { targetInfos } = await cdp.send('Target.getTargets', {});
      const sw = (targetInfos || []).find((t) => t.type === 'service_worker'
        && String(t.url || '').includes(extId));
      if (sw) ({ sessionId: swS } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true }));
      else await sleep(150);
    }
    if (!swS) throw new Error('service worker 未启动 —— 读不到存储就没法验这条链');
    await cdp.send('Runtime.enable', {}, swS);
    const evIn = async (sid, expr) => {
      const r = await cdp.send('Runtime.evaluate',
        { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result && r.result.value;
    };
    const readStore = async (keys) => JSON.parse(await evIn(swS,
      `new Promise(r => chrome.storage.local.get(${JSON.stringify(keys)}, o => r(JSON.stringify(o))))`));

    // 跨界那一刻到底写进来了什么 —— 用 storage 事件抓，而不是事后回读。
    // 事后回读会被后续的兑换清掉（票是一次性的），那时看到 null 说明不了任何事。
    await evIn(swS, `self.__mtWrites = [];
      chrome.storage.onChanged.addListener((ch, area) => {
        for (const k of Object.keys(ch)) self.__mtWrites.push({ k, v: ch[k].newValue });
      }); 1`);

    // ── ⓪ 按钮点了到底会不会真的去 provider ────────────────────────────────
    //
    // 这一条是**行为**断言，不是结构断言。第一版代码写的是「先开一个空窗、算完
    // URL 再塞给它」，而带 noopener 的 window.open 按规范**返回 null** ——
    // 按钮点了什么都不发生，而代码看起来完全正确、单测也全绿。
    // 只有真的点一次、看落到哪个域，才抓得住这一类。
    {
      const { targetId: t0 } = await cdp.send('Target.createTarget',
        { url: `chrome-extension://${extId}/options/options.html#sync` });
      const { sessionId: s0 } = await cdp.send('Target.attachToTarget', { targetId: t0, flatten: true });
      await cdp.send('Runtime.enable', {}, s0);
      await sleep(2500);
      const btns = JSON.parse(await evIn(s0, `JSON.stringify(
        ['btn-sync-apple','btn-sync-google'].map(id => { const e = document.getElementById(id);
          return { id, vis: !!(e && e.getClientRects().length), off: !!(e && e.disabled) }; }))`));
      notes.push('按钮: ' + JSON.stringify(btns));
      const live = btns.filter((b) => b.vis && !b.off);
      if (!live.length) {
        problems.push('设置页上没有一个可点的第三方登录按钮 —— providers 表配了却没渲染？');
      } else {
        const seen = [];
        const poll = async () => {
          const { targetInfos } = await cdp.send('Target.getTargets', {});
          for (const t of targetInfos) if (t.url && !seen.includes(t.url)) seen.push(t.url);
        };
        await evIn(s0, `document.getElementById(${JSON.stringify(live[0].id)}).click(); 1`);
        for (let i = 0; i < 40; i += 1) { await poll(); await sleep(250); }
        const hit = seen.find((u) => /\/auth\/v1\/authorize\?provider=/.test(u));
        notes.push('点击落点: ' + (hit ? hit.slice(0, 90) : '（没有新标签）'));
        if (!hit) {
          problems.push(`点了 ${live[0].id} 之后没有任何标签去往 authorize —— `
            + '「点了没反应」。带 noopener 的 window.open 返回 null，别指望拿到窗口对象');
        }
      }
    }

    // 先种一个 pending —— 相当于用户刚在设置页点过「用 Google 登录」。
    await evIn(swS, `new Promise(r => chrome.storage.local.set(${JSON.stringify({
      learnAuthPkce: { verifier: 'V-VERIFIER', state: 'S-STATE', provider: 'google', at: Date.now() },
    })}, () => r(1)))`);

    // ── ① 走一遍回调页 ───────────────────────────────────────────────────
    let { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    let att = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, att.sessionId);
    await cdp.send('Page.enable', {}, att.sessionId);
    await intercept(att.sessionId);
    const before = supabaseHits.length;
    await cdp.send('Page.navigate',
      { url: 'https://belliedmonkey.cc/auth/done.html?code=THE-CODE&state=S-STATE' }, att.sessionId);
    await sleep(2500);

    const writes = JSON.parse(await evIn(swS, 'JSON.stringify(self.__mtWrites || [])'));
    const ticketWrite = writes.find((w) => w.k === 'learnAuthCode' && w.v);
    notes.push('跨界写入: ' + JSON.stringify(writes.map((w) => w.k)));
    if (!ticketWrite) {
      problems.push('回调页没有把 code 递进 storage —— 内容脚本那一支没跑');
    } else {
      if (ticketWrite.v.code !== 'THE-CODE') problems.push('票里的 code 不对: ' + ticketWrite.v.code);
      const extra = Object.keys(ticketWrite.v).filter((k) => !['code', 'state', 'at'].includes(k));
      if (extra.length) problems.push('票里多了不该有的字段: ' + extra.join(', '));
    }

    // ③ 兑换必须来自扩展页，不能来自页面 origin。
    const fromPage = supabaseHits.slice(before).filter((h) => /^https?:\/\//.test(h.origin));
    if (fromPage.length) {
      problems.push(`有 ${fromPage.length} 个 Supabase 请求来自页面 origin（${fromPage[0].origin}）`
        + ' —— 兑换必须发生在扩展页，内容脚本只递票');
    } else notes.push('没有任何 Supabase 请求来自页面 origin ✓');

    // ② 会话永不跨界：内容脚本可读的键列表里不许有 learnAuth。
    // 判据是「**读**会话」，不是「提到过 learnAuth」—— 注释里写着「不许读 learnAuth」
    // 的警告本身是好事，把它算成违规会逼人删掉警告。剥注释再看。
    const { stripComments } = require('../test/lib/strip-comments.js');
    const cm = stripComments(fs.readFileSync(path.join(DIST, 'content/content-main.js'), 'utf8'));
    const reads = [...cm.matchAll(/learnAuth(?!Code|Pkce)\b/g)];
    if (reads.length) {
      problems.push(`content-main.js 里有 ${reads.length} 处 learnAuth（非 Code/Pkce）`
        + ' —— §8.4.1 的硬性不变量：会话永不进内容脚本');
    } else notes.push('内容脚本从不碰 learnAuth（只碰一次性的 learnAuthCode）✓');

    // ── ④ 扩展页兑换：票被用掉，session 落盘 ────────────────────────────
    ({ targetId } = await cdp.send('Target.createTarget',
      { url: `chrome-extension://${extId}/options/options.html#sync` }));
    att = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, att.sessionId);
    await intercept(att.sessionId);
    await sleep(3000);
    const after = await readStore(['learnAuth', 'learnAuthCode', 'learnAuthPkce', 'learnUserId']);
    notes.push('兑换后: ' + JSON.stringify({
      hasSession: !!after.learnAuth, uid: after.learnUserId,
      ticketLeft: !!after.learnAuthCode, pkceLeft: !!after.learnAuthPkce,
    }));
    if (!after.learnAuth || after.learnAuth.accessToken !== 'FAKE-ACCESS') {
      problems.push('扩展页没有把票换成 session');
    }
    if (after.learnAuthCode) problems.push('票没被用掉 —— 下次开设置页会重放一次必然失败的兑换');
    // **用过的那一份**必须消失。而设置页每次加载都会为下一次备一份新的，所以
    // 「learnAuthPkce 存在」本身不是问题 —— 判据是它不再是我们种下去的那个 verifier。
    // 第一版按「存在即失败」判，于是加了 ⓪ 那一段之后它自己红了：那是判据错，不是代码错。
    if (after.learnAuthPkce && after.learnAuthPkce.verifier === 'V-VERIFIER') {
      problems.push('用过的 verifier 还在 —— 它必须是一次性的');
    }
    if (after.learnUserId !== 'u-oauth') problems.push('learnUserId 没写 —— 跨面交接靠它');

    // ── ⑤ state 不符：停住，且不发请求 ──────────────────────────────────
    await evIn(swS, `new Promise(r => chrome.storage.local.remove(['learnAuth','learnUserId'], () => r(1)))`);
    await evIn(swS, `new Promise(r => chrome.storage.local.set(${JSON.stringify({
      learnAuthPkce: { verifier: 'V2', state: 'RIGHT', provider: 'google', at: Date.now() },
      learnAuthCode: { code: 'C2', state: 'WRONG', at: Date.now() },
    })}, () => r(1)))`);
    const mark = supabaseHits.length;
    ({ targetId } = await cdp.send('Target.createTarget',
      { url: `chrome-extension://${extId}/options/options.html#sync` }));
    att = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, att.sessionId);
    await intercept(att.sessionId);
    await sleep(2500);
    const post = await readStore(['learnAuth', 'learnAuthCode', 'learnAuthPkce']);
    const sent = supabaseHits.slice(mark).filter((h) => /grant_type=pkce/.test(h.url));
    notes.push(`state 不符：换取请求 ${sent.length} 个，会话 ${post.learnAuth ? '有' : '无'}`);
    if (sent.length) problems.push('state 不符还去换票 —— 那等于把别人塞的票当成自己的');
    if (post.learnAuth) problems.push('state 不符却拿到了会话');
    if (post.learnAuthPkce && post.learnAuthPkce.verifier === 'V2') {
      problems.push('state 不符之后，那一份 verifier 没被清掉');
    }
  } finally {
    try { await cdp.close(); } catch (_) {}
    chrome.cleanup();
  }

  console.log(notes.join('\n'));
  console.log('');
  if (problems.length) {
    console.log('✗ 第三方登录流程失败:');
    for (const p of problems) console.log('   ' + p);
    process.exit(1);
  }
  console.log('✓ 第三方登录：只有票跨界（会话没有）→ 扩展页兑换 → 票与 verifier 一次性 → state 不符即停');
})().catch((e) => { console.error('oauth flow failed:', (e && e.stack) || e); process.exit(1); });
