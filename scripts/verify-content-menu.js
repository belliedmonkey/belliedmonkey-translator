#!/usr/bin/env node
// verify-content-menu.js — BEL-277 菜单的行为冒烟（真 Chrome，本地门，不进 CI）。
//
// 验三件事，判据全部是「DOM/异常」不是「没报错」：
// ① FAB 的 SVG 经 createElementNS 落在真页面里：#mt-fab svg 存在，且
//    .mt-fab-off / .mt-fab-on 两组都在（test:layout fabStates 的前置事实）；
// ② isolated world 里 SubtitleAdapter._openMenu 可用：静态 host 优先、DOM 回退
//    也能画（静态 bundle 的渲染由 test/bel277-submenu.test.js 覆盖）；
// ③ 菜单容器行数/勾号/关闭后无残留。
//
// 真 YouTube/X 站点 E2E 需要登录/网络与真实视频，见 RESULT.md 的 pending 步骤。
//
// 用法：node scripts/verify-content-menu.js   （先 node build.js 出 dist/）
'use strict';

const http = require('http');
const path = require('path');
const { launchChrome } = require('../test/layout/chrome');
const { CDP } = require('../test/layout/cdp');

function serveBlank() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>mt-menu-probe</title><p>blank page for the menu smoke</p>');
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

async function main() {
  const dist = path.resolve(__dirname, '..', 'dist');
  const { srv, url } = await serveBlank();
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  try {
    await cdp.send('Extensions.loadUnpacked', { path: dist })
      .catch((e) => { throw new Error(`Extensions.loadUnpacked failed (${e.message}) — node build.js 先出 dist/`); });

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    // executionContextCreated 在导航过程中派发 —— 监听必须在 navigate 之前挂上，
    // 事后挂一个都收不到（首跑的坑：挂晚了收 0 个上下文）。
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', (p) => contexts.push(p.context));
    await cdp.send('Page.navigate', { url }, sid);

    // 等内容脚本跑完（content-main 尾部的哨兵是同步注入完成的标志，主世界可读）。
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: "document.documentElement.getAttribute('data-mt-injected')",
      }, sid);
      ready = r.result && r.result.value !== null && r.result.value !== undefined;
      if (!ready) await new Promise((res) => setTimeout(res, 100));
    }
    if (!ready) throw new Error('content scripts never finished injecting (data-mt-injected missing)');

    // FAB：主世界读共享 DOM。
    const fab = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify((() => {
        const svg = document.querySelector('#mt-fab svg');
        return {
          fab: !!document.getElementById('mt-fab'),
          svg: !!svg,
          states: svg ? svg.querySelectorAll('.mt-fab-off, .mt-fab-on').length : 0,
        };
      })())`,
      returnByValue: true,
    }, sid);
    const f = JSON.parse(fab.result.value);
    if (!f.fab || !f.svg || f.states !== 2) {
      throw new Error(`FAB SVG 未按 createElementNS 形态落页：${JSON.stringify(f)}（fab/svg/两组状态 g 缺一即败）`);
    }
    console.log(`① FAB + SVG OK（.mt-fab-off/.mt-fab-on 共 ${f.states} 组）`);

    // 找扩展的 isolated world：逐上下文探测 content-main 的全局。哨兵出现时
    // content-main（清单最后一个）已跑完，其 isolated world 的 contextCreated
    // 事件必然已派发（同一 socket 保序）。
    let extContextId = null;
    for (const ctx of contexts) {
      try {
        const r = await cdp.send('Runtime.evaluate', {
          expression: "typeof window.__mtMainLoaded === 'boolean'",
          contextId: ctx.id,
        }, sid);
        if (r.result && r.result.value === true) { extContextId = ctx.id; break; }
      } catch (_) { /* context belongs to another world */ }
    }
    if (!extContextId) {
      throw new Error(`扩展 isolated world 没找到（收到 ${contexts.length} 个上下文、` +
        '逐个探测 __mtMainLoaded 全部落空 —— 监听时序或内容脚本没跑）');
    }

    // isolated world 里静态 host 优先 / DOM 回退 + 开/关菜单。
    const probe = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const A = window.SubtitleAdapter;
        if (!A || typeof A._openMenu !== 'function') throw new Error('SubtitleAdapter._openMenu missing');
        const btn = document.createElement('button');
        btn.id = 'probe-btn';
        document.body.appendChild(btn);
        const rows = [
          { kind: 'row', label: '行甲', checked: true, onClick: () => {} },
          { kind: 'sep' },
          { kind: 'head', label: '标题乙' },
          { kind: 'row', label: '行丙', onClick: () => {} },
        ];
        // ① 没有全局 host（或条目没注入的本页面）⇒ DOM 回退必须开。
        const via = A._openMenu({ id: 'probe-menu', btn, rows, closeMenu: () => document.getElementById('probe-menu')?.remove() });
        const menu = document.getElementById('probe-menu');
        const out = {
          via,
          opened: !!menu,
          rows: menu ? menu.children.length : 0,
          tick: menu ? !!Array.from(menu.querySelectorAll('span')).find((s) => s.textContent === '✓') : false,
        };
        document.getElementById('probe-menu')?.remove();
        // ② 有全局 host ⇒ 必须走 host，不再画回退。
        let hostHit = 0;
        window.MTSubMenuBundle = { open() { hostHit += 1; }, close() {} };
        out.host = A._openMenu({ id: 'probe-menu-2', btn, rows, closeMenu() {} });
        out.hostHit = hostHit;
        delete window.MTSubMenuBundle;
        out.closed = !document.getElementById('probe-menu-2');
        return JSON.stringify(out);
      })()`,
      contextId: extContextId,
      awaitPromise: true,
      returnByValue: true,
    }, sid);
    if (probe.exceptionDetails) {
      throw new Error(`isolated world 菜单探测失败：${probe.exceptionDetails.exception?.description || probe.exceptionDetails.text}`);
    }
    const v = JSON.parse(probe.result.value);
    if (v.via !== 'fallback' || !v.opened || v.rows !== 4 || !v.tick || v.host !== 'bundle' || v.hostHit !== 1 || !v.closed) {
      throw new Error(`菜单行为不符：${JSON.stringify(v)}（期望 fallback / 4 行 / 勾号 / host 命中 / 关闭无残留）`);
    }
    console.log(`② host 优先 + DOM 回退 OK；③ 菜单开/关 OK（${v.rows} 个子节点、勾号在、关闭无残留）`);
    console.log('PASS: content-menu smoke');
  } finally {
    cdp.close();
    chrome.cleanup();
    srv.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
