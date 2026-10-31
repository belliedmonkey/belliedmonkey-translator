#!/usr/bin/env node
// verify-content-inject.js — content 同步注入面的冷注入预算门（React 迁移 PR8a 立门）。
//
// 量什么：manifest content_scripts 列表全部执行完成的时刻。content-main.js 是列表的
// 最后一个文件，末尾把 performance.now() 写在 <html data-mt-injected> 上 —— isolated
// world 写、页面主世界可读（Attribute 走共享 DOM），本脚本在主世界轮询读它。
//   为什么不用 window.__mtMainLoaded：那在 isolated world 里赋值，主世界的 evaluate
// 看不见 —— main world 陷阱。DOM 属性是两个世界共享的。
// 另量 #mt-fab 出现时刻（前奏 MutationObserver 记 window.__mtFabAt）：懒加载后它
// 晚于同步注入完成，**只报告不设门** —— 预算门守的是同步面，懒加载的真实代价如实
// 展示在数字里。
//
// 判据（PR8a 预算）：9 次新标签冷注入的 sync 中位数 ≤ 基线 + 10ms。
// 基线（2026-09-28，PR7c 代码 + 本门安装的同一测量法，本机 M-series Mac）：
//   sync 中位 19.7ms（min 19.3 / max 20.4，n=9）、#mt-fab 出现 37.6ms 中位。
//   fab 只报告不设门：懒加载的真实代价如实展示。
// 「冷注入」的口径：extension 已加载（throwaway profile + loadUnpacked），每个样本
// 是一个新标签页的新文档；磁盘缓存为热（第 2 个样本起脚本走缓存）。未来 PR 用同一
// 口径量，增幅才有意义 —— 绝对值随机器浮动，PIN 只对同一台机器负责。
//
// 用法：
//   node scripts/verify-content-inject.js            # 跑门（9 样本，红即 exit 1）
//   node scripts/verify-content-inject.js --pin      # 只测并打印建议 PIN 值
// 需要真 Chrome（与 test:layout 同一套基建），是本地门，不进 CI。
'use strict';

const http = require('http');
const path = require('path');
const { launchChrome } = require('../test/layout/chrome');
const { CDP } = require('../test/layout/cdp');

// ── 门参数 ────────────────────────────────────────────────────────────────────
// SYNC_PIN：基线 sync 中位数（ms）。改同步注入面的 PR 超过 PIN+10 即红。
// 重新钉基线的正当理由：换测量口径、换机器、或 PR7c 那样**正当的**同步面增长
// （要在 PR 描述里给数字并说明为什么值得）。偷懒的理由（懒得优化）不成立。
const SYNC_PIN = 20; // 2026-09-28 本机 M-series 实测基线 19.7ms（PR7c 代码）
const SYNC_BUDGET_MS = 10;
const RUNS = 9;
const WARMUP_RUNS = 2; // loadUnpacked 后的头两次导航带着扩展冷启动，不计入

const PRELUDE = `(function () {
  if (window.__mtFabAt !== undefined) return;
  window.__mtFabAt = null;
  var mo = new MutationObserver(function () {
    if (document.getElementById('mt-fab')) {
      window.__mtFabAt = performance.now();
      mo.disconnect();
    }
  });
  // 观察点必须是 document 而不是 documentElement：本前奏在 document_start 执行，
  // 那一刻 documentElement 还是 null，observe(null) 会抛错、观察器永远装不上。
  mo.observe(document, { childList: true, subtree: true });
})();`;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function serveBlank() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>mt-inject-probe</title><p>blank page for the inject budget gate</p>');
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

async function measureOnce(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE }, sid);
    await cdp.send('Page.navigate', { url }, sid);
    // content scripts 是 document_idle —— 给足上限，轮询到哨兵出现为止。
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          inj: document.documentElement.getAttribute('data-mt-injected'),
          fab: (typeof window.__mtFabAt === 'number') ? window.__mtFabAt
             : (document.getElementById('mt-fab') ? performance.now() : null)
        })`,
        returnByValue: true,
      }, sid);
      const v = JSON.parse(r.result.value);
      if (v.inj !== null) return v;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('data-mt-injected never appeared within 15s — content-main.js sentinel missing?');
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

async function main() {
  const pinOnly = process.argv.includes('--pin');
  const dist = path.resolve(__dirname, '..', 'dist');
  const { srv, url } = await serveBlank();
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  try {
    await cdp.send('Extensions.loadUnpacked', { path: dist })
      .catch((e) => { throw new Error(`Extensions.loadUnpacked failed (${e.message}) — build dist/ first (node build.js).`); });

    const samples = [];
    for (let i = 0; i < WARMUP_RUNS + RUNS; i++) {
      const v = await measureOnce(cdp, url);
      if (i >= WARMUP_RUNS) samples.push(v);
    }
    const syncs = samples.map((s) => Number(s.inj));
    const fabs = samples.filter((s) => s.fab !== null).map((s) => Number(s.fab));

    if (fabs.length !== samples.length) {
      throw new Error(`#mt-fab only appeared in ${fabs.length}/${samples.length} runs — measurement is vacuous. ` +
        'The FAB must mount on a plain page (showFab defaults true).');
    }
    const syncMed = median(syncs);
    const fabMed = median(fabs);

    console.log(`sync  inject median: ${syncMed.toFixed(1)}ms  (min ${Math.min(...syncs).toFixed(1)} / max ${Math.max(...syncs).toFixed(1)}, n=${samples.length})`);
    console.log(`#mt-fab appears at: ${fabMed.toFixed(1)}ms median (reported, not gated — lazy-load cost shown as-is)`);

    if (pinOnly) {
      console.log(`\n建议 PIN：SYNC_PIN = ${Math.round(syncMed)};  FAB_PIN = ${Math.round(fabMed)};  （钉进本文件头注释与门常量，注明日期与机器）`);
      return;
    }

    const limit = SYNC_PIN + SYNC_BUDGET_MS;
    if (syncMed > limit) {
      console.error(`\nRED: sync inject median ${syncMed.toFixed(1)}ms > ${SYNC_PIN}+${SYNC_BUDGET_MS}ms。` +
        '同步注入面超预算 —— 看这次 PR 往 manifest content_scripts 列表里加了什么字节。' +
        '若增长正当（同 PR 描述给数字），按头注释规则重新钉 SYNC_PIN。');
      process.exit(1);
    }
    console.log(`PASS: sync ${syncMed.toFixed(1)}ms ≤ ${SYNC_PIN}+${SYNC_BUDGET_MS}ms`);
  } finally {
    cdp.close();
    chrome.cleanup();
    srv.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
