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
        tryBtn: vis($('btn-sync-try')) ? ($('btn-sync-try').textContent || '').trim() : '',
      });
    })()` }, sessionId);
    const s = JSON.parse(r.result.value);
    notes.push(`视口 ${s.vh}，文档 ${s.docH}，登录区顶边 ${s.top}`);
    notes.push(`标题「${s.h2}」· ${s.who}`);
    notes.push(`下一步：${s.nextApp || '（无）'} · 按钮「${s.tryBtn || '无'}」`);

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
    if (!s.tryBtn) problems.push('登录之后没有「现在翻一页看看」的出口');
    if (errs.length) problems.push('运行期异常：' + errs.slice(0, 2).join(' | '));
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
  console.log('\n✓ 登录：#sync 落在登录框、标题说「登录」、登录之后有下一步（带邮箱 + 翻一页出口）');
  process.exit(0);
})().catch((e) => { console.error('verify-signin-flow failed:', (e && e.stack) || e); process.exit(1); });
