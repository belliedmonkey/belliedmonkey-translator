#!/usr/bin/env node
// scripts/verify-wipe.js — 「清除本机全部数据」真的清干净了吗。
//
// 这条路上的「成功」特别容易是假的，而且假得没有声音：
//
//   · indexedDB.deleteDatabase 撞上一个**还开着的连接**，会发 blocked 事件然后
//     一直挂着 —— 不抛异常、不 reject。于是清除流程顺利走完、界面报「已清除」，
//     而库原封不动。这不是假想：options 页一加载就 LearnStore.open() 拿统计，
//     所以点清除的那一刻，连接必然是开着的。
//   · 学习库**按账号分库**（mt-learn / mt-learn-<uid>），只删当前那个就是没删。
//   · Safari 的 chrome.storage 回调有不落地的先例，await 在那里会永远挂住。
//
// 所以判据只有一个形状：**清完回读**。种进去 → 点 → 重新列一遍库、重新读一遍
// storage，两边都空了才算过。任何「没报错」都不算数。
//
//   node scripts/verify-wipe.js [dist 目录]

'use strict';
const path = require('path');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const DIST = process.argv[2] || path.join(__dirname, '..', 'dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalIn(cdp, sessionId, expression, awaitPromise) {
  const r = await cdp.send('Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: !!expression && !!awaitPromise }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + expression.slice(0, 80));
  return r.result ? r.result.value : undefined;
}

// 硬超时。这一整套里每一步都可能永远不落定（这正是被测对象的病），
// 门禁自己挂住十分钟是最没用的失败方式。
const HARD = setTimeout(() => { console.log('✗ 超时：' + STEP); process.exit(1); }, 120000);
let STEP = 'launch';
const step = (s) => { STEP = s; if (process.env.WIPE_TRACE) console.log('  … ' + s); };

(async () => {
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  const problems = [];
  const notes = [];

  try {
    step('loadUnpacked');
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    const extId = loaded && loaded.id;
    if (!extId) throw new Error('Extensions.loadUnpacked 没有回 id');

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    const errs = [];
    cdp.on('Runtime.exceptionThrown', (ev, sid) => {
      if (sid === sessionId) errs.push((ev.exceptionDetails || {}).text || '');
    });
    step('navigate options');
    await cdp.send('Page.navigate',
      { url: `chrome-extension://${extId}/options/options.html` }, sessionId);
    await sleep(2500);

    // ── 种数据 ──────────────────────────────────────────────────────────────
    // 两个库（当前的 + 另一个账号的）、一个 API Key、一条翻译缓存。
    // 再**故意开着** mt-learn 的连接 —— 这就是 blocked 的条件。
    step('seed');
    const seeded = await evalIn(cdp, sessionId, `(async () => {
      await new Promise((r) => chrome.storage.local.set(
        { apiKey: 'sk-wipe-test', 'tr:openai:zh-CN:hello': '你好' }, r));
      const mk = (name) => new Promise((res) => {
        const q = indexedDB.open(name, 1);
        q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains('k')) q.result.createObjectStore('k'); };
        q.onsuccess = () => res(q.result);
        q.onerror = () => res(null);
      });
      const a = await mk('mt-learn');          // 保持打开 —— 制造 blocked 的条件
      await mk('mt-learn-otheruser').then((d) => d && d.close());
      window.__held = a;                        // 挂住，别被 GC 掉
      await LearnStore.open().catch(() => {});  // 页面自己那份句柄也开着
      const names = (await indexedDB.databases()).map((d) => d.name).filter((n) => /^mt-learn/.test(n));
      const st = await new Promise((r) => chrome.storage.local.get(null, r));
      return JSON.stringify({ dbs: names.sort(), key: st.apiKey || '', cache: Object.keys(st).filter((k) => k.startsWith('tr:')).length });
    })()`, true);
    const s0 = JSON.parse(seeded);
    notes.push(`种下：库 ${s0.dbs.join(' + ')}；apiKey=${s0.key}；缓存 ${s0.cache} 条`);
    if (s0.dbs.length < 2) problems.push(`只种进 ${s0.dbs.length} 个学习库 —— 「按账号分库」这一面没被测到，后面的断言会空转`);
    if (s0.key !== 'sk-wipe-test') problems.push('apiKey 没种进去 —— 后面的断言会空转');

    // ── 点它 ────────────────────────────────────────────────────────────────
    // confirm 打桩成「确定」。按钮本体是 busy() 包的，点完要等它走完。
    step('click wipe');
    await evalIn(cdp, sessionId,
      `(() => { window.confirm = () => true; document.getElementById('btn-wipe-all').click(); return 1; })()`);
    await sleep(6000);

    // ── 回读 ────────────────────────────────────────────────────────────────
    // 清干净会跳去引导页；跳走之后 chrome.storage 仍然读得到（同一个扩展）。
    step('read back');
    const after = await evalIn(cdp, sessionId, `(async () => {
      const names = (await indexedDB.databases()).map((d) => d.name).filter((n) => /^mt-learn/.test(n));
      const st = await new Promise((r) => chrome.storage.local.get(null, r));
      return JSON.stringify({ dbs: names.sort(), keys: Object.keys(st).sort(), url: location.pathname });
    })()`, true);
    const s1 = JSON.parse(after);
    notes.push(`清完：库 [${s1.dbs.join(', ')}]；storage 剩 ${s1.keys.length} 个键；落到 ${s1.url}`);

    if (s1.dbs.length) {
      problems.push(`学习库没删干净，还剩 ${s1.dbs.join(', ')} —— `
        + 'deleteDatabase 多半被一个没关掉的连接 blocked 住了（它不报错，只是永远不落定）');
    }
    if (s1.keys.length) {
      problems.push(`chrome.storage.local 还剩 ${s1.keys.length} 个键：${s1.keys.slice(0, 8).join(', ')}`);
    }
    if (!/onboard/.test(s1.url)) {
      problems.push(`清完没有落到引导页（在 ${s1.url}）—— 用户看不到「回到刚装好的样子」这个证据`);
    }
    if (errs.length) problems.push('清除过程中有运行期异常：' + errs.slice(0, 3).join(' | '));
  } catch (e) {
    problems.push('跑挂了：' + ((e && e.message) || e));
  } finally {
    step('teardown');
    clearTimeout(HARD);
    try { await cdp.close(); } catch (_) {}
    try { chrome.kill(); } catch (_) {}
  }

  for (const n of notes) console.log('  ' + n);
  if (problems.length) {
    for (const p of problems) console.log('  ✗ ' + p);
    console.log('\n✗ 清除本机全部数据 未通过');
    process.exit(1);
  }
  console.log('\n✓ 清除本机全部数据：两个学习库 + storage 全清，落回引导页');
  // 显式退出：CDP 的 socket 会把事件循环吊住，跑完不退等于在 CI 里挂死。
  process.exit(0);
})().catch((e) => { console.error('verify-wipe failed:', (e && e.stack) || e); process.exit(1); });
