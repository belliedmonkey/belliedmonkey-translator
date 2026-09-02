#!/usr/bin/env node
// scripts/verify-signin-flow.js — 登录这一步的两个「成功了但没有下一步」。
//
// 两条都是 2026-09-02 真机上报的，而且都属于本仓库最贵的那一族：**出了事界面不说**。
//
//   ① 「打开设置去登录」落在设置页顶部，不是登录框。
//      openOptionsPage() 不接受 hash，人到了得自己在一整页设置里找。改成
//      options.html#sync 之后还要防第二个坑：滚动必须排在 applyDetailMode() 之后，
//      那一步会增删卡片，滚完再改布局落点就偏了。
//   ② 登录成功之后是个死胡同。界面变成邮箱 + 用量 + 三个管理按钮，一个字都没说
//      接下来该干什么 —— 而登录本身对用户没有价值，它的价值全在后面那两件事上：
//      去翻一页，以及**在 App 里用同一个账号登录**。
//      「两边同一个账号」这句话此前在全仓只出现一次，且只在 App 引导的最后一屏，
//      也就是只有已经装了 App 的人才看得到。
//
// 判据一律读渲染坐标与真实文字，不读属性、不查 CSS 写了什么。
// 视口取手机尺寸：窗口默认 1300×900，那个高度上 sync 区本来就在屏幕里，
// 锚点滚没滚过去根本测不出来（第一版探针就是这样，scrolled=225 却全绿）。
//
//   node scripts/verify-signin-flow.js [dist 目录]

'use strict';
const path = require('path');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const DIST = process.argv[2] || path.join(__dirname, '..', 'dist');
const EMAIL = 'tester@example.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  const problems = []; const notes = [];
  const HARD = setTimeout(() => { console.log('✗ 超时'); process.exit(1); }, 150000);

  try {
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    const extId = loaded && loaded.id;
    if (!extId) throw new Error('Extensions.loadUnpacked 没有回 id');

    // 种一个会话。**这不是在测登录本身**（那要真发验证码），测的是登录之后画什么。
    let sw = null;
    for (let i = 0; i < 60 && !sw; i += 1) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      sw = targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId));
      if (!sw) await sleep(150);
    }
    if (!sw) throw new Error('service worker 没起来');
    const swAtt = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, swAtt.sessionId);
    await cdp.send('Runtime.evaluate', {
      expression: `new Promise(r=>chrome.storage.local.set({learnAuth:{email:${JSON.stringify(EMAIL)},`
        + `userId:'u-test',accessToken:'x',refreshToken:'y',expiresAt:Date.now()+3600000}},()=>r(1)))`,
      awaitPromise: true, returnByValue: true }, swAtt.sessionId);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    const errs = [];
    cdp.on('Runtime.exceptionThrown', (ev, sid) => {
      if (sid === sessionId) errs.push((ev.exceptionDetails || {}).text || '');
    });
    // 手机视口，取下限：锚点要真的需要滚动，这条断言才有意义。
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 640, deviceScaleFactor: 1, mobile: true }, sessionId);
    await cdp.send('Page.navigate',
      { url: `chrome-extension://${extId}/options/options.html#sync` }, sessionId);
    await sleep(3500);

    const r = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const $ = (id) => document.getElementById(id);
      const vis = (el) => !!(el && el.getClientRects().length);
      const sec = $('sync-section');
      const box = sec ? sec.getBoundingClientRect() : null;
      return JSON.stringify({
        secVisible: vis(sec),
        h2: ((sec && sec.querySelector('h2')) || {}).textContent || '',
        top: box ? Math.round(box.top) : null,
        vh: innerHeight,
        docH: document.documentElement.scrollHeight,
        who: ($('sync-who') || {}).textContent || '',
        nextVisible: vis($('sync-next')),
        nextApp: ($('sync-next-app') || {}).textContent || '',
        cardsBtn: vis($('btn-sync-cards')) ? ($('btn-sync-cards').textContent || '').trim() : '',
        appBtn: vis($('btn-sync-app')) ? ($('btn-sync-app').textContent || '').trim() : '',
        appUid: $('btn-sync-app') ? ($('btn-sync-app').dataset.uid || '') : '',
      });
    })()` }, sessionId);
    const s = JSON.parse(r.result.value);
    notes.push(`视口 ${s.vh}，文档 ${s.docH}，登录区顶边 ${s.top}`);
    notes.push(`标题「${s.h2}」· ${s.who}`);
    notes.push(`下一步：${s.nextApp || '（无）'} · 按钮「${s.cardsBtn || '无'}」/「${s.appBtn || '无'}」uid=${s.appUid || '（无）'}`);

    if (!s.secVisible) problems.push('登录区不可见 —— adv-only 又回来了？');
    // ① 锚点
    if (s.docH > s.vh && (s.top < -20 || s.top > s.vh * 0.5)) {
      problems.push(`带 #sync 打开时，登录区顶边在 ${s.top}（视口 ${s.vh}）——`
        + ' 没有滚到跟前。人是从一个写着「去登录」的按钮点过来的，落点必须是登录框。');
    }
    if (!/登录|Sign in|ログイン|로그인|Connexion|Anmelden|Iniciar|Entrar|Вход|تسجيل/.test(s.h2)) {
      problems.push(`登录区标题是「${s.h2}」，里面没有「登录」——`
        + ' 从「去登录」点过来看到一个只写着「同步」的标题，会让人以为走错了地方');
    }
    // ② 登录之后的下一步
    if (!s.nextVisible) problems.push('登录成功之后没有「下一步」那一块 —— 界面停在邮箱 + 用量 + 三个管理按钮');
    if (!s.nextApp.includes(EMAIL)) {
      problems.push(`「下一步」那句话里没有刚登录的邮箱：${JSON.stringify(s.nextApp)}`
        + ' —— 「用同一个账号」不带具体值时，用户没有可对照的东西');
    }
    if (!/App/i.test(s.nextApp)) problems.push('「下一步」没提到 App —— 登录的价值全在那一边');
    // 登录之后的下一步必须**往前**，不是往回。
    //
    // 原来这里唯一的按钮是「现在翻一页看看」—— 那正是引导 try 屏干的事，
    // 把刚登录完的人送回上一步（2026-09-02 链路核查）。登录的价值在后面两件事上：
    // 看到自己的卡，以及让它们出现在 App 里。
    if (!s.cardsBtn) problems.push('登录之后没有「去看你的卡」的出口 —— 那是这条链的下一环');
    if (!s.appBtn) {
      problems.push('登录之后没有通往 App 的出口 —— 「怎么在另一台设备看到卡」'
        + '在这之前只有一句纯文本，无任何可点');
    } else if (!s.appUid) {
      problems.push('通往 App 的按钮没带 userId —— App 那边就发现不了「两边不是同一个账号」');
    }
    if (errs.length) problems.push('运行期异常：' + errs.slice(0, 2).join(' | '));

    // ── ②b #learn 锚点：「去打开采集」必须落在那个开关上 ────────────────────
    //
    // 官网试翻页上采集关着时那个按钮写的是「去打开采集」。它原来只开设置页顶部，
    // 而采集开关那张卡当时还带着 adv-only —— 默认模式下**根本看不见**。
    // 按钮点了、人到了、开关不在（2026-09-02 用户实测）。
    const { targetId: lid } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const lAtt = await cdp.send('Target.attachToTarget', { targetId: lid, flatten: true });
    await cdp.send('Runtime.enable', {}, lAtt.sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 640, deviceScaleFactor: 1, mobile: true }, lAtt.sessionId);
    await cdp.send('Page.navigate',
      { url: `chrome-extension://${extId}/options/options.html#learn` }, lAtt.sessionId);
    await sleep(3000);
    const lr = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const $ = (id) => document.getElementById(id);
      const vis = (el) => !!(el && el.getClientRects().length);
      const card = $('learn-card'); const sw = $('learn-enabled');
      const b = card ? card.getBoundingClientRect() : null;
      return JSON.stringify({ cardVis: vis(card), swVis: vis(sw),
        top: b ? Math.round(b.top) : null, vh: innerHeight,
        docH: document.documentElement.scrollHeight });
    })()` }, lAtt.sessionId);
    const lv = JSON.parse(lr.result.value);
    notes.push(`#learn：采集卡 ${lv.cardVis ? '可见' : '不可见'}，开关 ${lv.swVis ? '可见' : '不可见'}，顶边 ${lv.top}`);
    if (!lv.cardVis || !lv.swVis) {
      problems.push('带 #learn 打开设置页，采集开关不可见 —— adv-only 又回来了？'
        + '按钮上写着「去打开采集」，而那个开关看不见');
    } else if (lv.docH > lv.vh && (lv.top < -20 || lv.top > lv.vh * 0.5)) {
      problems.push(`带 #learn 打开时采集卡顶边在 ${lv.top}（视口 ${lv.vh}）—— 没有滚到跟前`);
    }

    // ── ③ 复习页 → App 的交接（learning-design §8.4.1.1）──────────────────
    const { targetId: rid } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const rAtt = await cdp.send('Target.attachToTarget', { targetId: rid, flatten: true });
    await cdp.send('Runtime.enable', {}, rAtt.sessionId);
    await cdp.send('Page.navigate',
      { url: `chrome-extension://${extId}/learn/review.html` }, rAtt.sessionId);
    await sleep(3000);
    const rr = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const b = document.getElementById('go-app');
      return JSON.stringify({
        exists: !!b,
        vis: !!(b && b.getClientRects().length),
        text: b ? (b.textContent || '').trim() : '',
        href: b ? (b.dataset.href || '') : '',
        // 页面到底活没活。review.js 一旦解析失败，整页是空的，而上面那些断言
        // 会全部读到 false —— 那时报「按钮不在」是**错的诊断**。
        counts: (document.getElementById('counts') || {}).textContent || '',
      });
    })()` }, rAtt.sessionId);
    const rv = JSON.parse(rr.result.value);
    notes.push(`复习页：按钮 ${rv.vis ? '「' + rv.text + '」' : '不可见'} → ${rv.href || '（无）'}`);
    if (!rv.counts.trim()) {
      problems.push('复习页头部的计数是空的 —— review.js 可能整份没解析（语法错的表现就是这个，'
        + '不是一行报错）。先看 npm test 的「出货的 JS 都解析得了」。');
    } else if (!rv.vis) {
      problems.push('已登录，复习页却没有「在 App 里继续复习」的按钮 —— 跨面交接断在这里');
    } else if (!/^belliedmonkey(cn)?:\/\/review\?uid=/.test(rv.href)) {
      problems.push(`交接地址形状不对：${rv.href} —— 期望 belliedmonkey://review?uid=<不透明 id>`);
    } else if (rv.href.includes('@')) {
      problems.push(`交接地址里出现了邮箱：${rv.href} —— §8.4.1.1 裁定只传不透明 userId`);
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
    console.log('\n✗ 登录流程未通过');
    process.exit(1);
  }
  console.log('\n✓ 登录：#sync 落在登录框、标题说「登录」、登录之后有下一步（带邮箱 + 去看卡 + 去 App）');
  process.exit(0);
})().catch((e) => { console.error('verify-signin-flow failed:', (e && e.stack) || e); process.exit(1); });
