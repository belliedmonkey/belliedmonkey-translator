// scripts/verify-sync-consistency.js — 多设备同步一致性的端到端回归（真 Chrome）。
// interaction-spec「多设备同步一致性 — 2026-08-09（用户裁定）」的可执行版：
//
//   王冠断言：宿主 A（扩展复习页）评分并上传后，宿主 B（App 出货布局）空库拉取，
//   两端复习页头部的计数行（总计 + 待复习/学习中/候选/已掌握）逐字相等。
//
// 另验：进入即同步（每次打开页面都强制同步、穿透 10 分钟节流）、常驻状态行五态
// （未登录 / 同步中 / 同步完成·时间 / 离线 / 恢复）、断网自愈（online 事件）、
// 收敛（无活动的第二次同步不再产生新上传）。
//
// 2026-08-09 增两幕（learning-design §7.4/§8.9）：设备 B 按域名删除 example.org
// 的卡并设屏蔽规则 → 强制同步（d 行 + g 行上行）→ 设备 C（全新空库）拉取后，
// 计数与 B 删除后逐字相等、learnRules 里有 B 设的规则 —— 用户删除与治理规则
// 都必须传播，否则「多设备一致」对删除是假话。
//
// 假后端是 Node 进程级的 `cloud` 对象，blob 存 hex 原样转发、从不解包 —— 两个宿主
// 先后启动、共享同一片云，正是「两台设备一个账号」的形状。静态路由在发文件时就地
// 把 backend.config 的 url 指向本服务器、enabled 翻 true —— 页面的进入级同步走的是
// 与真机完全同构的自然启动路径，不靠事后注入。
//
//   npm run test:sync        （需 Chrome；Node ≥22；先 node build.js）
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const SRC = path.join(ROOT, 'dist-app');
const DIST = path.join(ROOT, 'dist');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const SHIM_SRC = fs.readFileSync(path.join(ROOT, 'app/chrome-shim.js'), 'utf8');

setTimeout(() => { console.log('\n✗ 超时（240s），没有结论'); process.exit(2); }, 240000).unref();

// ─── 进程级假云：两台“设备”共享的唯一后端状态 ────────────────────────────────
const cloud = { seq: 0, rows: [], gets: 0, posts: 0 };

// ─── 宿主（沿用 verify-learn-flow 的双宿主形状） ────────────────────────────
const HOSTS = {
  ext: {
    name: '设备 A · 扩展复习页', page: '/learn/review.html', scope: 'body',
    route: (u) => {
      const rel = decodeURIComponent(u.split('?')[0]);
      const p = path.normalize(path.join(DIST, rel));
      return p.startsWith(DIST) ? p : null;
    },
  },
  app: {
    name: '设备 B · App（dist-app · 出货布局）', page: '/Base.lproj/Main.html', scope: 'body',
    route: (u) => {
      const rel = u === '/' ? '/Base.lproj/Main.html' : u.split('?')[0];
      const name = path.basename(rel);
      const okp = (name === 'Main.html' && rel.startsWith('/Base.lproj/'))
        || ((name === 'Script.js' || name === 'Style.css') && !rel.startsWith('/Base.lproj/'));
      return okp ? path.join(SRC, name) : null;
    },
  },
};

const SEED_A = `(async () => {
  const now = Date.now();
  const day = 86400e3;
  const src = { id: 'src1', url: 'https://example.org/a', title: 'Example Article' };
  const items = [
    { id: 'read1', text: 'The forgetting curve is steep at first.', tr: '遗忘曲线起初很陡。',
      lang: 'en', sourceId: 'src1', state: 'learning', createdAt: now - 9 * day, lastSeenAt: now - day,
      seenCount: 3, salience: 0.6,
      sched: { s: 1.5, d: 5, lastReviewAt: now - 2 * day, dueAt: now - 3600e3, reps: 2, lapses: 0 } },
    { id: 'known1', text: 'Mastery accrues slowly then suddenly.', tr: '掌握是先慢后快的。',
      lang: 'en', sourceId: 'src1', state: 'learning', createdAt: now - 300 * day, lastSeenAt: now - day,
      seenCount: 30, salience: 0.5, skills: { read: 1, listen: 1 },
      sched: { s: 200, d: 4, lastReviewAt: now - 10 * day, dueAt: now + 100 * day, reps: 20, lapses: 0 } },
    { id: 'cand1', text: 'A fresh candidate sentence.', tr: '一句新候选。',
      lang: 'en', sourceId: 'src1', state: 'candidate', createdAt: now - day, lastSeenAt: now - day,
      seenCount: 1, salience: 0.9 },
    { id: 'cand2', text: 'Another waiting candidate.', tr: '又一句候选。',
      lang: 'en', sourceId: 'src1', state: 'candidate', createdAt: now - day, lastSeenAt: now - 3600e3,
      seenCount: 1, salience: 0.8 },
    // 第二来源：§7.4 删除幕删掉 example.org 之后，它是必须幸存的对照组。
    { id: 'other1', text: 'A sentence from another site.', tr: '来自另一个站点的句子。',
      lang: 'en', sourceId: 'src2', state: 'candidate', createdAt: now - day, lastSeenAt: now - day,
      seenCount: 1, salience: 0.7 },
  ];
  const src2 = { id: 'src2', url: 'https://other.io/post', title: 'Other Post' };
  const db = await LearnStore.open();
  await new Promise((res, rej) => {
    const t = db.transaction(['items', 'sources'], 'readwrite');
    for (const it of items) t.objectStore('items').put(it);
    t.objectStore('sources').put(src);
    t.objectStore('sources').put(src2);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return 'seeded';
})()`;

// §8.4.1：会话在 chrome.storage.local 的 learnAuth —— 种在出货代码真正读的位置。
const SEED_AUTH = `new Promise((r) => chrome.storage.local.set({ learnAuth: {
  accessToken: 't-e2e', refreshToken: 'r-e2e',
  expiresAt: Date.now() + 3600e3, email: 'e2e@example.org', userId: 'u-e2e',
} }, () => r(null))).then(() => (LearnAuth._reset ? LearnAuth._reset() : null)).then(() => 'auth-seeded')`;

// ─── 服务器：REST 假云优先，静态文件兜底（发文件时改写 backend 配置） ────────
function serve(host) {
  const srv = http.createServer((req, res) => {
    const u = req.url;
    const body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      // 假云路由
      if (u.startsWith('/rest/v1/bt_chunks')) {
        if (req.method === 'GET') {
          cloud.gets++;
          const m = /seq=gt\.(\d+)/.exec(u);
          const cursor = m ? Number(m[1]) : 0;
          const rows = cloud.rows.filter((r) => r.seq > cursor).slice(0, 200)
            .map((r) => ({ seq: r.seq, blob: r.blob }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(rows));
        }
        if (req.method === 'POST') {
          cloud.posts++;
          const rec = JSON.parse(Buffer.concat(body).toString('utf8'));
          const row = { seq: ++cloud.seq, kind: rec.kind, blob: rec.blob, generation: rec.generation || 0 };
          cloud.rows.push(row);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify([row]));
        }
        if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
      }
      if (u.startsWith('/rest/v1/rpc/bt_usage')) {
        const bytes = cloud.rows.reduce((n, r) => n + (r.blob.length - 2) / 2, 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ bytes, chunks: cloud.rows.length, quota: 50 * 1024 * 1024 }]));
      }
      if (u.startsWith('/auth/v1/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      // 静态文件（就地改写 backend 配置 —— 页面的进入级同步天然指向本服务器）
      const p = host.route(u);
      if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      let data = fs.readFileSync(p);
      const base = path.basename(p);
      if (base === 'backend.config.js' || base === 'Script.js') {
        const origin = 'http://' + req.headers.host;
        data = Buffer.from(data.toString('utf8')
          .replace(/enabled: (?:false|true),/, 'enabled: true,')
          .replace(/url: '[^']+'/, `url: '${origin}'`), 'utf8');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' });
      res.end(data);
    });
  }).listen(0);
  return new Promise((r) => srv.on('listening', () => r(srv)));
}

// ─── 每宿主一轮：起服务器 + Chrome，回调里拿驱动函数 ─────────────────────────
let ok = true;
const failures = [];
const need = (cond, msg) => { if (!cond) { ok = false; failures.push(msg); console.log('  ✗ ' + msg); } };

const SWEEP_FN = `
function __sweep(scope) {
  const bad = [];
  const root = document.querySelector(scope) || document.body;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  };
  for (const el of root.querySelectorAll('button, a, select')) {
    if (!vis(el)) continue;
    const label = (el.textContent || el.value || '').trim();
    if (!label) bad.push(el.tagName.toLowerCase() + '#' + (el.id || el.className) + ' 无文字');
  }
  return bad;
}`;

async function withHost(host, fn) {
  console.log('\n── ' + host.name + ' ──');
  const srv = await serve(host);
  const url = 'http://127.0.0.1:' + srv.address().port + host.page;
  const chrome = await launchChrome();
  try {
    const cdp = await CDP.connect(chrome.port);
    const targets = await cdp.send('Target.getTargets', {});
    const page = targets.targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    const problems = [];
    cdp.listeners.push({ event: 'Runtime.exceptionThrown', fn: (p) => problems.push(
      'EXCEPTION ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text)) });

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      ${SHIM_SRC}
      try { localStorage.setItem('mt:learnEnabled', 'true'); } catch (_) {}
      (() => {
        const voices = [{ name: 'TestVoice', lang: 'en-US', voiceURI: 'TestVoice|en-US', default: true, localService: true }];
        window.speechSynthesis = { getVoices: () => voices, addEventListener: () => {}, cancel: () => {}, resume: () => {},
          speak: (u) => { try { const ev = new Event('start'); u.dispatchEvent && u.dispatchEvent(ev); } catch (_) {} } };
        class U extends EventTarget { constructor(text) { super(); this.text = text; } }
        window.SpeechSynthesisUtterance = U;
        ${SWEEP_FN}
        window.__sweep = __sweep;
      })();` }, sessionId);

    const nav = async () => {
      await cdp.send('Page.navigate', { url }, sessionId);
      await new Promise((r) => setTimeout(r, 1600));
    };
    const ev = async (expression) => {
      const r = await cdp.send('Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) {
        throw new Error('页面内异常: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
      }
      return r.result && r.result.value;
    };
    const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').trim()`);
    const waitLine = async (substr, ms) => {
      const until = Date.now() + (ms || 8000);
      for (;;) {
        const s = await text('#sync-line');
        if (s.includes(substr)) return s;
        if (Date.now() > until) return s;
        await new Promise((r) => setTimeout(r, 150));
      }
    };
    const offline = async (on) => {
      if (on) {
        await cdp.send('Network.emulateNetworkConditions',
          { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
      } else {
        // 保持 Network 域启用、只翻 offline 位。曾试过跟一发 Network.disable
        // ——那会把仿真卡死在网络服务层（onLine 已回 true、fetch 却瞬间失败且
        // 一个请求都到不了服务器），别再试。
        await cdp.send('Network.emulateNetworkConditions',
          { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
      }
    };

    await nav();
    await fn({ nav, ev, text, waitLine, offline, problems });
    need(problems.length === 0, '页面异常: ' + problems.join(' | '));
  } finally {
    chrome.cleanup();
    srv.close();
  }
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'learn/review.html')) || !fs.existsSync(path.join(SRC, 'Script.js'))) {
    console.log('✗ 先跑 node build.js（需要 dist/ 与 dist-app/）');
    process.exit(2);
  }

  let countsA = '';
  let countsB2 = '';

  // ─── 设备 A：扩展复习页 —— 未登录态 → 登录 → 进入即同步 → 评分 → 上传 ─────
  await withHost(HOSTS.ext, async ({ nav, ev, text, waitLine }) => {
    // 1 · 未登录：状态行必须显示「未登录，仅本机数据」（用户裁定）
    const signedOut = await waitLine('未登录', 4000);
    need(signedOut.includes('未登录'), `未登录态状态行不对: 「${signedOut}」`);

    // 2 · 种语料 + 登录，重开页面 —— 打开即进入，进入即强制同步
    console.log('  seed:', await ev(SEED_A));
    console.log('  auth:', await ev(SEED_AUTH));
    const gets0 = cloud.gets;
    await nav();
    const done1 = await waitLine('同步完成');
    need(done1.includes('同步完成'), `进入后状态行未到「同步完成」: 「${done1}」`);
    need(cloud.gets > gets0, '进入没有触发拉取 —— 进入即同步失效');
    need(cloud.rows.length > 0, '本地语料没有上传到云端');

    // 3 · 计数行含总计与四状态
    const counts0 = await text('#counts');
    need(/总计 5/.test(counts0), `总计缺失或不对: 「${counts0}」`);
    for (const label of ['待复习', '学习中', '候选', '已掌握']) {
      need(counts0.includes(label), `计数行缺「${label}」: 「${counts0}」`);
    }

    // 4 · 评一张卡（读档：显示译文 → 记得），让复习进度产生并上传
    await ev(`(document.querySelector('#reveal').click(), 'ok')`);
    await new Promise((r) => setTimeout(r, 200));
    await ev(`(document.querySelector('[data-grade="2"]').click(), 'ok')`);
    await new Promise((r) => setTimeout(r, 400));
    const rowsBefore = cloud.rows.length;
    await ev(`LearnSync.autoSync(Date.now(), { force: true }).then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 400));
    need(cloud.rows.length > rowsBefore, '评分后的复习进度没有上传');

    // 5 · 记录 A 的最终计数（王冠断言的左手边）
    await ev(`LearnReview.start().then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 300));
    countsA = await text('#counts');
    console.log('  A 计数: ' + countsA);
    const bad = await ev(`__sweep('body')`);
    need(bad.length === 0, '表面扫描: ' + bad.join(' | '));
  });

  // ─── 设备 B：App 出货布局 —— 空库登录 → 进入即拉取 → 计数逐字一致 ──────────
  await withHost(HOSTS.app, async ({ nav, ev, text, waitLine, offline }) => {
    console.log('  auth:', await ev(SEED_AUTH));
    const rowsStable = cloud.rows.length;
    await nav();   // 进入 App：启动即强制同步（quietSync force）
    await new Promise((r) => setTimeout(r, 800));
    // 进复习视图（App 的复习页字节与扩展相同）
    await ev(`document.getElementById('review-view').hidden = false; 'ok'`);
    await ev(`LearnReview.start().then(() => 'ok')`);
    const done1 = await waitLine('同步完成');
    need(done1.includes('同步完成'), `B 进入后状态行未到「同步完成」: 「${done1}」`);

    const countsB = await text('#counts');
    console.log('  B 计数: ' + countsB);
    need(countsB === countsA,
      `王冠断言失败 —— 两台设备计数不一致：\n    A: 「${countsA}」\n    B: 「${countsB}」`);

    // 收敛：B 没有本地改动，它的同步不得产生新上传
    need(cloud.rows.length === rowsStable, `无活动的拉取产生了 ${cloud.rows.length - rowsStable} 个新上传 —— 收敛破了`);

    // 进入即同步穿透节流：再进入一次，拉取计数必须增长
    const gets1 = cloud.gets;
    await nav();
    await new Promise((r) => setTimeout(r, 800));
    need(cloud.gets > gets1, '第二次进入没有再同步 —— 节流没有被进入穿透');

    // ─── §7.4/§8.9 两幕：B 按域名删除 + 设屏蔽规则，随同步上行 ────────────
    await ev(`document.getElementById('review-view').hidden = false; 'ok'`);
    await ev(`LearnReview.start().then(() => 'ok')`);
    await waitLine('同步完成');

    // 删除 example.org 的全部卡（与 options/复习页 ⋯ 走完全相同的模块路径）。
    const deleted = await ev(`(async () => {
      const [items, srcs] = await Promise.all([LearnStore.allItems(), LearnStore.allSources()]);
      const doomed = LearnRules.doomedFor(items, srcs, 'example.org');
      const n = await LearnStore.deleteItems(doomed.itemIds, Date.now());
      await LearnStore.deleteSourcesIfOrphan(doomed.sourceIds);
      return n;
    })()`);
    need(deleted === 4, `按域名删除应删 4 张，实际 ${deleted}`);
    // 屏蔽规则（弹窗「本站」写的就是这同一个键）。
    await ev(`new Promise((r) => chrome.storage.local.set({ learnRules:
      { v: 1, block: ['example.org'], langs: null, updatedAt: Date.now() } }, () => r('ok')))`);
    const rowsBeforeDel = cloud.rows.length;
    await ev(`LearnSync.autoSync(Date.now(), { force: true }).then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 500));
    need(cloud.rows.length > rowsBeforeDel, '删除与规则没有上传（d/g 行缺席）');

    await ev(`LearnReview.start().then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 300));
    countsB2 = await text('#counts');
    console.log('  B 删除后计数: ' + countsB2);
    need(/总计 1/.test(countsB2), `删除后应剩 1 张（other.io 幸存）: 「${countsB2}」`);

    // 离线：断网强制同步 → 状态行报离线；恢复 + online 事件 → 回到同步完成
    await waitLine('同步完成');
    await offline(true);
    await ev(`LearnSync.autoSync(Date.now(), { force: true }).then(() => 'ok')`);
    const off = await waitLine('离线');
    need(off.includes('离线'), `断网后状态行不对: 「${off}」`);
    await offline(false);
    // 网络仿真的撤销是异步落地的：立刻派发 online 会让自愈同步撞上仍在生效的
    // 断网仿真（真机上不存在这个窗口——OS 的 online 事件本身就是网络已恢复的
    // 信号）。等一拍再派发。
    await new Promise((r) => setTimeout(r, 600));
    // 网络仿真的撤销是异步落地的：等一拍再派发 online（真机上 OS 的 online
    // 事件本身就是网络已恢复的信号，不存在这个窗口）。
    await new Promise((r) => setTimeout(r, 600));
    await ev(`window.dispatchEvent(new Event('online')); 'ok'`);
    const back = await waitLine('同步完成');
    need(back.includes('同步完成'), `网络恢复后状态行未回到同步完成: 「${back}」`);

    const bad = await ev(`__sweep('#review-view')`);
    need(bad.length === 0, '表面扫描: ' + bad.join(' | '));
  });

  // ─── 设备 C：全新空库 —— 只靠日志重放，必须收敛到 B 删除后的世界 ──────────
  // 这是 §7.4 的收敛论证落地成断言：卡片行、复习行、d 行、g 行按 seq 依次重放，
  // 终态 = 删除后的语料 + B 设的规则。少删一张或规则缺席，删除传播就是假的。
  await withHost(HOSTS.ext, async ({ ev, nav, text, waitLine }) => {
    console.log('  auth:', await ev(SEED_AUTH));
    await nav();
    const done = await waitLine('同步完成');
    need(done.includes('同步完成'), `C 进入后状态行未到「同步完成」: 「${done}」`);
    await ev(`LearnReview.start().then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 300));
    const countsC = await text('#counts');
    console.log('  C 计数: ' + countsC);
    need(countsC === countsB2,
      `删除没有传播到新设备：\n    B(删后): 「${countsB2}」\n    C:      「${countsC}」`);
    const rules = await ev(`new Promise((r) => chrome.storage.local.get(['learnRules'], (v) => r(v.learnRules || null)))`);
    need(rules && Array.isArray(rules.block) && rules.block.indexOf('example.org') >= 0,
      `规则没有传播到新设备: ${JSON.stringify(rules)}`);

    // ─── §7.5 备份恢复幕：登出 + 删库，唯一救生通道是本地备份 ────────────
    // 登出在先，故意堵死「同步治愈」这条路 —— 恢复出的计数只可能来自备份。
    const countsPreWipe = await text('#counts');
    const bk = await ev(`LearnBackup.maybeRun(Date.now() + 8 * 3600e3).then((r) => JSON.stringify(r))`);
    need(/"ran":true/.test(bk), `强制快照没有落盘: ${bk}`);
    await ev(`new Promise((r) => chrome.storage.local.remove(['learnAuth'], () => r('ok')))`);
    await ev(`new Promise((res) => {
      const q = indexedDB.deleteDatabase('mt-learn');
      q.onsuccess = () => res('deleted');
      q.onerror = () => res('error: ' + q.error);
      q.onblocked = () => res('blocked-pending');   // 连接还开着：随导航关闭后完成
    })`);
    await nav();
    const lineC = await waitLine('未登录', 6000);
    need(lineC.includes('未登录'), `登出后状态行应为未登录（同步治愈已被堵死）: 「${lineC}」`);
    await ev(`LearnReview.start().then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 300));
    const countsRestored = await text('#counts');
    console.log('  C 删库+登出后计数(仅备份可救): ' + countsRestored);
    need(countsRestored === countsPreWipe,
      `备份恢复失败 —— 删库前后计数不一致:\n    前: 「${countsPreWipe}」\n    后: 「${countsRestored}」`);
  });


  // ─── 设备 D：同一台机器换账号 —— 旧账号的语料不得以新身份出网 ────────────
  // 真机 1.7.0 build 52 实证的缺陷：本地库没有账号维度，换账号后四个计数一模一样，
  // 而真正的损害是旧账号的语料会被 push 进新账号的云端（syncedAt 挡板只在拉取路径
  // 盖章，本机自采的卡对它完全免疫）。
  //
  // 判据是 **POST 数不涨**，不是「上传了 0 张卡」：分库之后新账号本来就该同步
  // （它有自己的空库），所以「零请求」不再是这一幕的正确判据；一个字节都不该出网的
  // 是**旧账号那份语料**。
  await withHost(HOSTS.ext, async ({ ev, nav, text, waitLine }) => {
    console.log('  auth:', await ev(SEED_AUTH));
    await nav();
    await waitLine('同步完成');
    await ev(`LearnReview.start().then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 300));
    const countsOwner = await text('#counts');
    const dbOwner = await ev(`LearnStore.currentDbName()`);
    console.log('  D 本人: ' + countsOwner + '  库=' + dbOwner);
    need(dbOwner === 'mt-learn', `本人应当用主库，实际 ${dbOwner}`);

    // 换成另一个账号 —— 同一台设备、同一份本地语料。
    await ev(`new Promise((r) => chrome.storage.local.set({ learnAuth: {
      accessToken: 't-other', refreshToken: 'r-other',
      expiresAt: Date.now() + 3600e3, email: 'other@example.org', userId: 'u-other',
    } }, () => r(null))).then(() => (LearnAuth._reset ? LearnAuth._reset() : null)).then(() => 'switched')`);
    // 判据取在**进入即同步之前**：新账号将要使用的那个库，此刻必须是空的。
    // 这就是用户报的那件事的直接陈述 ——「新账号不该复用上一个账号的进度」。
    //
    // 这里**不**拿 POST 数当判据。假云没有 RLS，新账号会拉到旧账号的行，随后
    // §7.4 那条「拉下来的删除意图会回声一次」就合法地把它们推回去 —— 那是假云的
    // 形状，不是缺陷。真实后端按 user_id 隔离，回声的是它自己的行。归属不符时
    // 「一个请求都不发」由 test/learn-sync.test.js 的九条钉住，那里没有假云的干扰。
    const preItems = await ev(`new Promise((res) => {
      const q = indexedDB.open('mt-learn-u-other');
      q.onsuccess = () => {
        const db = q.result;
        if (!db.objectStoreNames.contains('items')) { db.close(); return res(0); }
        const g = db.transaction('items').objectStore('items').getAll();
        g.onsuccess = () => { const n = g.result.length; db.close(); res(n); };
        g.onerror = () => { db.close(); res(-1); };
      };
      q.onerror = () => res(0);
    })`);
    need(preItems === 0,
      `新账号的库在第一次同步之前就已经有 ${preItems} 条 —— 上一个账号的进度被复用了`);

    await nav();
    await new Promise((r) => setTimeout(r, 2500));
    const dbOther = await ev(`LearnStore.currentDbName()`);
    console.log('  D 换人后: 库=' + dbOther + '  换前该库条目=' + preItems);
    need(dbOther === 'mt-learn-u-other',
      `换账号后没有切库（这正是「新账号看到上一个账号的进度」的机制）：${dbOther}`);

    // 换回去：原账号的语料必须原样还在。分库的全部意义就是它没被销毁。
    await ev(SEED_AUTH);
    await nav();
    await waitLine('同步完成');
    await ev(`LearnReview.start().then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 300));
    const dbBack = await ev(`LearnStore.currentDbName()`);
    const countsBack = await text('#counts');
    console.log('  D 换回来: ' + countsBack + '  库=' + dbBack);
    need(dbBack === 'mt-learn', `换回原账号没有回到主库：${dbBack}`);
    need(countsBack === countsOwner,
      `换回原账号后计数变了：\n    原: 「${countsOwner}」\n    回: 「${countsBack}」`);
  });

  console.log('');
  if (ok) {
    console.log('✓ 多设备同步一致性回归全部通过：未登录态 · 进入即同步 · 上传/拉取 · '
      + '两端计数逐字一致 · 收敛零新上传 · 节流穿透 · 离线可见 · online 自愈 · '
      + '删除跨设备传播（d 行）· 规则跨设备传播（g 行）· 备份恢复（登出+删库仅靠本地备份复原） · 换账号（新账号的库开局为空，换回原账号计数逐字还原）');
    process.exit(0);
  }
  console.log(`✗ ${failures.length} 项失败`);
  process.exit(1);
})().catch((e) => { console.error('✗ ' + (e && e.message)); process.exit(1); });
