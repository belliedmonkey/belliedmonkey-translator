#!/usr/bin/env node
// scripts/verify-extension-smoke.js — 「装进浏览器之后，它真的能翻一段吗」。
//
// 为什么这个门必须存在（2026-08-19/20，一天之内栽了三次）：
//   · 1.5.4 的回退发出去是**空转** —— 调用方开了、接收方还锁着，而所有门禁全绿。
//   · 1.5.5 的路线记忆被一次偶发失败毒化，整页后半段全挂 —— 门禁同样全绿。
//   · 1.5.8 被报「完全不可用」时，我手上没有任何一条能回答「装上去到底行不行」的证据。
//
// 已有的门各自只看一层：npm test 看模块，test:layout 用 google 通道看渲染，
// test:app 看宿主页起不起得来。**没有一条**覆盖「真实安装 × 用户那种自定义端点 ×
// 端到端出译文」。这一条补的就是它。
//
// 判据是端到端的、并且**说得出走的哪条路**：
//   1. 扩展装得上，service worker 起得来，三个扩展页面都渲染出内容且无运行期错误；
//   2. 配一个 custom_chat 的本地端点，打开网页点翻译，页面上真的出现译文；
//   3. 报告这次走的是直连还是扩展后台 —— 两条路的失败长得一样，不说出来就查不动。
//
//   node scripts/verify-extension-smoke.js [dist 目录]

'use strict';
const http = require('http');
const path = require('path');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const DIST = process.argv[2] || path.join(__dirname, '..', 'dist');
const MARK = '【译文到达】';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>smoke</title></head>
<body><p id="p1">Spaced repetition is an evidence-based learning technique.</p>
<p id="p2">The forgetting curve describes how memory fades over time.</p></body></html>`;

// 端点**故意不带** Access-Control-Allow-Origin：这正是用户那个企业网关的形状。
// 直连会被浏览器挡在预检那一步，只有走扩展后台才通得过 —— 于是这个 fixture 同时
// 验证了「后台优先」这条路是真的活着，而不是只在单测里活着。
// 陷阱被打中的记录。数组而不是布尔：打中时要能说出**当时发了哪些字段**，
// 「多发了一个」和「整套乐观请求体又回来了」是两种不同的回归。
const trapHits = [];

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') { res.writeHead(403); res.end('nope'); return; }
      if (req.url.startsWith('/v1/chat/completions')) {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
          let parsed = {};
          try { parsed = JSON.parse(body); } catch (_) {}
          // 这条 400 是**一个永远不该被打中的陷阱**。
          //
          // 它以前是相反的意思：带 temperature 就拒，靠请求体协商让掉再发才拿得到
          // 200 —— 于是它证明的是「被拒之后能自愈」。协商已随 #159 删除，因为它取决
          // 于对方的错误信息长什么样（那条真实的三层嵌套里，字段名排在第 100 个字符，
          // 而截断上限是 300）。现在的契约强得多：127.0.0.1 不在能力表里 ⇒ 最小必要集
          // ⇒ temperature 从一开始就不会发出去。语义从「犯了错能改」变成「从一开始
          // 就没犯」，所以命中次数必须是 0，收尾处断言。
          //
          // 响应体照原样保留企业网关那三层包裹：万一哪天陷阱真的被打中，报错要长得跟
          // 真机上那条一模一样，而不是一个手写的平坦错误。
          if ('temperature' in parsed) {
            trapHits.push(Object.keys(parsed).join(','));
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ object: 'response', error: {
              code: 'MPE-001',
              message: JSON.stringify({ error: { type: 'llm_call_failed', treace_id: 'x'.repeat(30),
                message: JSON.stringify({ error: {
                  message: "Unsupported parameter: 'temperature' is not supported with this model.",
                  type: 'invalid_request_error', param: 'temperature', code: null } }) } }),
            } }));
            return;
          }
          const text = ((parsed.messages || []).slice(-1)[0] || {}).content || '';
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: MARK + text.slice(0, 12) } }] }));
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalIn(cdp, sessionId, expression, contextId) {
  const r = await cdp.send('Runtime.evaluate',
    Object.assign({ expression, returnByValue: true, awaitPromise: true },
      contextId ? { contextId } : {}), sessionId);
  if (r.exceptionDetails) {
    throw new Error(`eval failed: ${r.exceptionDetails.text} ${(r.exceptionDetails.exception || {}).description || ''}`);
  }
  return r.result ? r.result.value : undefined;
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  const problems = [];
  const notes = [];

  try {
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: DIST });
    const extId = loaded && loaded.id;
    if (!extId) throw new Error('Extensions.loadUnpacked 没有回 id');
    // 装的到底是哪个版本 —— 一天下来「你测的是哪版」问了三次，让产物自己说。
    // 同时对照 package.json:两者不一致 = dist/ 是旧的,这条冒烟就在验一个过期的包。
    const distManifest = JSON.parse(require('fs').readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
    const pkgVersion = require(path.join(__dirname, '..', 'package.json')).version;
    notes.push(`扩展 id ${extId}`);
    notes.push(`装入版本 ${distManifest.version}（package.json 是 ${pkgVersion}，来源 ${DIST}）`);
    if (distManifest.version !== pkgVersion) {
      problems.push(`dist/ 是 ${distManifest.version}、package.json 是 ${pkgVersion} —— 这次冒烟验的是一个过期的包，先 node build.js`);
    }

    // ── 1. service worker 起得来吗（background.js 加载期是否炸掉）────────────
    let swSession = null;
    for (let i = 0; i < 60 && !swSession; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const sw = targetInfos.find((t) => t.type === 'service_worker' && (t.url || '').includes(extId));
      if (sw) ({ sessionId: swSession } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true }));
      else await sleep(150);
    }
    if (!swSession) { problems.push('service worker 未启动'); }
    notes.push(`service worker ${swSession ? '已启动' : '未启动'}`);

    // ── 2. 三个扩展页面渲染 + 运行期错误 ────────────────────────────────────
    for (const p of ['options/options.html', 'popup/popup.html', 'learn/review.html']) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const errs = [];
      const off1 = cdp.on('Runtime.exceptionThrown', (ev, sid) => {
        if (sid === sessionId) errs.push(`EXCEPTION ${(ev.exceptionDetails || {}).text || ''}`);
      });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/${p}` }, sessionId);
      await sleep(2000);
      const len = await evalIn(cdp, sessionId, 'document.body ? document.body.innerText.trim().length : -1');
      // 弹窗在**未配置**状态下是刻意折叠的（只留一个入口），所以字数会贴着这道门槛。
      // 字数本来就是「页面死没死」的粗代理；对这一页换成真判据：那唯一的入口在不在、
      // 可不可点。一个加载期炸掉的页面满足不了它，而一次正当的文案改动也不会误伤。
      if (p.includes('popup')) {
        const note = JSON.parse(await evalIn(cdp, sessionId, `(() => {
          const el = document.getElementById('setup-note');
          const vis = !!(el && el.getClientRects().length);
          return JSON.stringify({ vis, text: vis ? el.textContent.trim().length : 0,
            clickable: !!(el && el.classList.contains('clickable')) });
        })()`));
        if (!note.vis || note.text < 8 || !note.clickable) {
          problems.push(`未配置时弹窗没给出可点的那一个入口：${JSON.stringify(note)}`
            + ' —— 这一页此刻只剩这一件事可做，它没了就等于什么都没有');
        }
      } else if (!(len > 60)) {
        problems.push(`${p} 几乎是空白页（可见文本 ${len}）—— 加载期就炸了`);
      }
      for (const e of errs) problems.push(`${p}: ${e}`);
      notes.push(`${p} 可见文本 ${len} 字符`);
      off1();
      await cdp.send('Target.closeTarget', { targetId });
    }

    // ── 2b. 设置页真的能用：面板展开、值存得住、重开还在 ─────────────────────
    //
    // 上面那一轮只证明页面没炸。它证明不了 saveAll() 这条路 —— 那是**整体覆盖式**的：
    // 每次从 DOM 读全部字段写回存储，所以任何一个新控件只要 init() 里漏了回填，用户
    // 下一次改别的字段就会把它悄悄清空。这种坏法在「页面能打开」这个断言下完全隐形，
    // 而它正是 1.5.4 那种「全门禁绿着发出去、结果是空转」的形状。
    {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      const errs = [];
      const off = cdp.on('Runtime.exceptionThrown', (ev, sid) => {
        if (sid !== sessionId) return;
        const d = ev.exceptionDetails || {};
        // 「Uncaught (in promise)」这行 text 本身不含任何信息 —— 真正的原因在
        // exception.description 里。只报 text 的话，报错等于「出错了」。
        const ex = d.exception || {};
        errs.push([d.text, ex.description || ex.value || '', d.url ? `@${d.url}:${d.lineNumber}` : '']
          .filter(Boolean).join(' | ').replace(/\s+/g, ' ').slice(0, 240));
      });
      await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options/options.html` }, sessionId);
      await sleep(2500);

      // 新引擎条目真的出现在下拉里 —— 注册表加一条却渲染不出来，是另一种全绿的空转。
      const engines = await evalIn(cdp, sessionId,
        `JSON.stringify([...document.getElementById('provider').options].map(o => o.value))`);
      if (!JSON.parse(engines).includes('qwen_mt')) {
        problems.push(`引擎下拉里没有 qwen_mt：${engines}`);
      }
      notes.push(`引擎下拉 ${JSON.parse(engines).length} 项，含 qwen_mt: ${JSON.parse(engines).includes('qwen_mt')}`);

      // 默认必须是折叠的 —— 「默认不设置」这件事，界面上的对应物就是它不占地方。
      const hidden0 = await evalIn(cdp, sessionId, `document.getElementById('advanced-config').hidden`);
      if (hidden0 !== true) problems.push('高级参数面板默认不是折叠的');

      // 点开 → 填值 → 触发 change（saveAll 挂在 change 上，不是 input）
      await evalIn(cdp, sessionId, `(() => {
        document.getElementById('btn-advanced').click();
        const t = document.getElementById('adv-temperature');
        t.value = '0.7';
        t.dispatchEvent(new Event('change', { bubbles: true }));
        const c = document.getElementById('adv-concurrency');
        c.value = '3';
        c.dispatchEvent(new Event('change', { bubbles: true }));
        return 1;
      })()`);
      await sleep(1200);
      const hidden1 = await evalIn(cdp, sessionId, `document.getElementById('advanced-config').hidden`);
      if (hidden1 !== false) problems.push('点了「高级参数」面板没有展开');

      // 落到存储里没有 —— 只看输入框的值等于什么都没验。
      const stored = await evalIn(cdp, sessionId,
        `new Promise(r => chrome.storage.local.get(['reqTemperature','reqConcurrency'], v => r(JSON.stringify(v))))`);
      const sv = JSON.parse(stored);
      if (Number(sv.reqTemperature) !== 0.7) problems.push(`reqTemperature 没存住: ${stored}`);
      if (Number(sv.reqConcurrency) !== 3) problems.push(`reqConcurrency 没存住: ${stored}`);

      // ── API Key 只敲 input、**不失焦**，也必须落盘 ────────────────────────
      //
      // 2026-08-29 真机（iPhone 14 Pro / iOS 26.5）：在手机上粘好 API Key 之后直接
      // 锁屏，回到设置页输入框是空的 —— `change` 只在失焦时触发，而锁屏/切 App
      // 根本不给它这个机会。Key 被**静默丢弃**：没有报错、没有提示，用户以为填好了，
      // 看到的却是每段都「翻译失败」。把「配置没保存」伪装成「产品是坏的」。
      //
      // 这条测试当年就写在这个文件里，注释还明明白白写着「saveAll 挂在 change 上，
      // 不是 input」—— 它是**绕着这个 bug 写的**，所以从来抓不到它。现在反过来钉住：
      // 只派发 input，等过防抖，然后读存储。
      await evalIn(cdp, sessionId, `(() => {
        const k = document.getElementById('api-key');
        k.value = 'sk-input-only-no-blur';
        k.dispatchEvent(new Event('input', { bubbles: true }));
        return 1;
      })()`);
      await sleep(1500);   // 防抖 500ms + 写存储的余量
      const keyStored = await evalIn(cdp, sessionId,
        `new Promise(r => chrome.storage.local.get(['apiKey'], v => r(String((v||{}).apiKey || ''))))`);
      if (keyStored !== 'sk-input-only-no-blur') {
        problems.push(`API Key 只敲 input 不失焦时没落盘（存储里是 ${JSON.stringify(keyStored)}）`
          + ' —— 用户粘完 Key 直接锁屏就会静默丢失');
      } else {
        notes.push('API Key 只敲 input、不失焦 → 已落盘 ✓');
      }
      // 收尾：清掉这个假 Key，别污染后面的用例
      await evalIn(cdp, sessionId, `(() => {
        const k = document.getElementById('api-key');
        k.value = '';
        k.dispatchEvent(new Event('change', { bubbles: true }));
        return 1;
      })()`);
      await sleep(800);

      // 重开页面 —— init() 的回填。漏了这步，值还在存储里，但下一次任何 change 都会
      // 把它写成空。所以这里再改一个**别的**字段，然后回来看这两个键还在不在。
      await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/options/options.html` }, sessionId);
      await sleep(2500);
      const back = await evalIn(cdp, sessionId, `document.getElementById('adv-temperature').value`);
      if (String(back) !== '0.7') problems.push(`重开后高级参数没回填（读到 ${JSON.stringify(back)}）`);
      await evalIn(cdp, sessionId, `(() => {
        const f = document.getElementById('font-size');
        f.value = f.options[f.options.length - 1].value;
        f.dispatchEvent(new Event('change', { bubbles: true }));
        return 1;
      })()`);
      await sleep(1200);
      const after = JSON.parse(await evalIn(cdp, sessionId,
        `new Promise(r => chrome.storage.local.get(['reqTemperature','reqConcurrency'], v => r(JSON.stringify(v))))`));
      if (Number(after.reqTemperature) !== 0.7 || Number(after.reqConcurrency) !== 3) {
        problems.push(`改别的字段把高级参数冲掉了: ${JSON.stringify(after)} —— saveAll 是整体覆盖式的，回填漏了`);
      }

      // ── 一把 key 配好全部：写进去的三组，必须扛得住下一次 saveAll ──────────
      //
      // 这是这个功能唯一的高危回归，而且**只在真浏览器里成立** —— 它是 DOM 回填的
      // 问题，纯函数层测不到。组件只返回 patch，由 applyQuickSetup 先回填控件再
      // saveAll()；少回填一个控件，用户手上的表现就是「我配好了，过一分钟又没了」。
      //
      // 三条连通性测试在这里必定失败（配的是注册表里的真实 host，这台机器上打不通），
      // 无所谓 —— 写入在测试之前就已经发生，而这一幕验的正是写入活不活得下来。
      const qsHave = await evalIn(cdp, sessionId, `!!document.getElementById('qs-apply')`);
      if (!qsHave) {
        problems.push('设置页上没有「一把 key 配好全部」的按钮 —— 卡没渲染');
      } else {
        // 申请入口：注册表里的 keyUrl 要真的走到 DOM 上。这条只有真浏览器验得了 ——
        // 中间隔着 build.js 生成器的 allowlist（漏字段不会有任何测试红）与渲染器的
        // hidden 分支（没有地址就整行隐藏，看起来和「没做」一模一样）。
        const link = JSON.parse(await evalIn(cdp, sessionId, `(() => {
          const a = document.getElementById('qs-key-link');
          return JSON.stringify({ has: !!a, hidden: a ? a.hidden : null,
            href: a ? a.getAttribute('href') : '', text: a ? a.textContent.trim() : '' });
        })()`));
        if (!link.has || link.hidden || !/^https:\/\//.test(link.href || '')) {
          problems.push('一键配置里没有可用的「去申请 key」入口：' + JSON.stringify(link)
            + ' —— 注册表的 keyUrl 没走到 DOM（多半是 build.js 生成器的 allowlist 漏了）');
        }

        await evalIn(cdp, sessionId, `(() => {
          const k = document.getElementById('qs-key');
          k.value = 'sk-smoke-test';
          document.getElementById('qs-apply').click();
          return 1;
        })()`);
        await sleep(2500);
        const wrote = JSON.parse(await evalIn(cdp, sessionId,
          `new Promise(r => chrome.storage.local.get(['provider','ttsEngine','ttsMode','sttEngine'], v => r(JSON.stringify(v))))`));
        if (!wrote.ttsEngine || !wrote.sttEngine || wrote.ttsMode !== 'assist') {
          problems.push(`一键配置没把三组写进去: ${JSON.stringify(wrote)}`);
        } else {
          // 改一个完全无关的字段，触发整体覆盖式的 saveAll()
          await evalIn(cdp, sessionId, `(() => {
            const f = document.getElementById('font-size');
            f.value = f.options[0].value;
            f.dispatchEvent(new Event('change', { bubbles: true }));
            return 1;
          })()`);
          await sleep(1200);
          const still = JSON.parse(await evalIn(cdp, sessionId,
            `new Promise(r => chrome.storage.local.get(['provider','ttsEngine','ttsMode','sttEngine'], v => r(JSON.stringify(v))))`));
          // 配好之后的出口。翻译那一路在这台机器上打不通（配的是真实 host），所以
          // 这里只验**它没有在失败时冒出来** —— 一个「去用吧」出现在三条红勾下面，
          // 比没有出口更糟。成功路径由 test/quick-setup.test.js 的分支断言覆盖。
          const tryState = JSON.parse(await evalIn(cdp, sessionId, `(() => {
            const b = document.getElementById('qs-try');
            return JSON.stringify({ has: !!b, hidden: b ? b.hidden : null,
              text: b ? b.textContent.trim() : '' });
          })()`));
          if (!tryState.has) {
            problems.push('设置页的一键配置里没有「去用」按钮（#qs-try）—— showTry 没接上');
          } else if (!tryState.hidden) {
            problems.push('翻译自检失败，却还是把「去用」的出口露了出来：' + JSON.stringify(tryState)
              + ' —— 那会把失败推迟到一个更难解释的地方发生');
          }

          let drift = 0;
          for (const k of ['provider', 'ttsEngine', 'ttsMode', 'sttEngine']) {
            if (still[k] !== wrote[k]) {
              drift++;
              problems.push(`改别的字段把一键配置冲掉了：${k} ${JSON.stringify(wrote[k])} → ${JSON.stringify(still[k])}`
                + ' —— applyQuickSetup 少回填了一个控件');
            }
          }
          // 打出来，否则「这一幕跑没跑」和「跑了并且通过」在输出上一模一样。
          console.log('一键配置 写入→改别的字段后仍是 ' + JSON.stringify(still)
            + (drift ? ' ✗' : ' ✓'));
        }
      }
      notes.push(`高级参数 存→重开→改别的字段后仍是 ${JSON.stringify(after)}`);

      // ── 2c 幕：一键配置与逐引擎配置永不同屏，且不许按过期快照覆盖 ────────────
      //
      // 这一整套 smoke 在此之前**一次都没点过 #mode-detail**，而这次的裁定正是一条
      // 渲染可见性的不变量。判据一律用 getClientRects —— 读 el.hidden 正是把一个
      // CSS 泄漏送上 App Store 的那种读法。
      const vis = `(el=>!!(el&&el.getClientRects().length))`;
      // 「永不同屏」说的是**一键配置卡 vs 逐引擎配置控件**，不是「快速模式下只许有
      // 一张卡」。原来这份清单里还有 learn-card（采集）和 sync-section（登录）——
      // 它们跟引擎配置毫无关系，只是当初被顺手打上了 adv-only。
      // 那个误分组的代价是实打实的：默认模式下**采集开关和登录入口都看不见**，
      // 而官网上那两个按钮（「去打开采集」「打开设置去登录」）正是往那里送人的
      // （2026-09-01 / 09-02 两次真机实测）。清单收回它真正管的那几个。
      const ENGINE_CARDS = ['engine-card', 'tts-card'];
      const mode1 = JSON.parse(await evalIn(cdp, sessionId, `(()=>{const vis=${vis};
        return JSON.stringify({quick:vis(document.getElementById('quick-setup-card')),
          adv:${JSON.stringify(ENGINE_CARDS)}
            .filter(id=>vis(document.getElementById(id))),
          // 反过来也要断言：采集开关与登录入口在**快速模式下必须看得见** ——
          // 它们是这个产品的另外两个入口，藏起来等于没有。
          learn:vis(document.getElementById('learn-card')),
          sync:vis(document.getElementById('sync-section'))});})()`));
      if (!mode1.quick || mode1.adv.length) {
        problems.push(`快速视图不对：一键卡 ${mode1.quick}，却露着 ${mode1.adv.join('/') || '（无）'}`);
      }
      if (!mode1.learn) {
        problems.push('快速视图里采集开关（#learn-card）不可见 —— 官网那个「去打开采集」'
          + '把人送到这里，而开关藏着');
      }
      if (!mode1.sync) {
        problems.push('快速视图里登录入口（#sync-section）不可见 —— 引导里那个'
          + '「打开设置去登录」把人送到这里，而登录框藏着');
      }
      await evalIn(cdp, sessionId, `(()=>{document.getElementById('mode-detail').click();return 1})()`);
      await sleep(400);
      const mode2 = JSON.parse(await evalIn(cdp, sessionId, `(()=>{const vis=${vis};
        // 四组 × 四个字段。id 齐全只是**必要**条件：谁把某一组重新手写回去，id 照样
        // 都在。真正要守的是「四组都由 learn/engine-fields.js 生成」，判据是它的输出
        // 标记 .ef-slot —— 手写的 markup 没有这个类。
        const need=['provider','api-key','api-base-url','api-model',
          'tts-engine','tts-api-key','tts-base-url','tts-model',
          'notes-provider','notes-api-key','notes-base-url','notes-model',
          'stt-engine','stt-api-key','stt-base-url','stt-model'];
        return JSON.stringify({quick:vis(document.getElementById('quick-setup-card')),
          engine:vis(document.getElementById('engine-card')),
          missing:need.filter(id=>!document.getElementById(id)),
          slots:document.querySelectorAll('.ef-slot').length,
          text:document.body.innerText.trim().length});})()`));
      if (mode2.quick) {
        problems.push('详细视图里一键卡还在 —— 一键配置与逐引擎配置同屏');
      } else if (!mode2.engine) {
        problems.push('详细视图里翻译引擎卡不见了');
      } else if (mode2.slots !== 4) {
        problems.push(`设置页只有 ${mode2.slots} 组由共用组件生成，期望 4（翻译/朗读/解析/转写）`
          + ' —— 有一组被重新手写了，以后加字段它不会跟着长出来');
      } else if (mode2.missing.length) {
        // 组件生成 DOM 这条新路径必须真的产出 saveAll() 要读的那些 id。少一个，
        // saveAll 会在 assertSaveFields 抛错 —— 但那要等用户去改一个字段才发生。
        problems.push('详细视图里缺少核心控件：' + mode2.missing.join(', ')
          + ' —— EngineFields 没渲染出 saveAll() 需要的 id');
      } else if (mode2.text < 60) {
        problems.push(`详细视图可见文本只有 ${mode2.text} 字符 —— 是不是加载期就炸了`);
      } else {
        console.log(`详细视图 ✓ 一键卡已隐藏，4 组均由共用组件生成、16 个核心控件齐全，可见文本 ${mode2.text} 字符`);
      }

      // ★ 过期快照：这一条在改之前的代码上是**红**的。
      // 在「详细」里敲一把 key（只发 input，不失焦），切回「快速」，用一键卡配一次。
      // 一键卡若按加载时的快照判「翻译没配过」，就会把刚敲的那把 key 覆盖掉。
      await evalIn(cdp, sessionId, `(()=>{const k=document.getElementById('api-key');
        k.value='sk-typed-by-hand'; k.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`);
      await sleep(900);
      await evalIn(cdp, sessionId, `(()=>{document.getElementById('mode-quick').click();return 1})()`);
      await sleep(300);
      await evalIn(cdp, sessionId, `(()=>{const k=document.getElementById('qs-key');
        k.value='sk-pasted-into-card'; document.getElementById('qs-apply').click(); return 1})()`);
      await sleep(2600);
      const kept = JSON.parse(await evalIn(cdp, sessionId,
        `new Promise(r => chrome.storage.local.get(['apiKey'], v => r(JSON.stringify(v))))`));
      if (kept.apiKey !== 'sk-typed-by-hand') {
        problems.push(`一键卡按过期快照覆盖了用户刚输入的 key：期望 sk-typed-by-hand，`
          + `实际 ${JSON.stringify(kept.apiKey)} —— settings 快照没有在点击那一刻现读`);
      } else {
        console.log('过期快照 ✓ 一键卡读到了「详细」里刚敲的 key，没有覆盖它');
      }

      // ── 自定义参数：按引擎存，最容易坏在「切引擎」这一步 ──────────────────
      //
      // 它是按 providerId 索引的一张表，而设置页上只有一个输入框。切引擎时若不重新
      // 回填，输入框里留着上一个引擎的内容，用户随手一改就把 A 的参数存到了 B 名下。
      // 那种坏法在「值存住了吗」这个断言下完全隐形 —— 值确实存住了，只是存错了地方。
      const CUSTOM = '{"thinking":{"type":"disabled"}}';
      await evalIn(cdp, sessionId, `(() => {
        const p = document.getElementById('provider');
        p.value = 'custom_chat'; p.dispatchEvent(new Event('change', { bubbles: true }));
        return 1;
      })()`);
      await sleep(900);
      await evalIn(cdp, sessionId, `(() => {
        const c = document.getElementById('adv-custom');
        c.value = ${JSON.stringify(CUSTOM)};
        c.dispatchEvent(new Event('change', { bubbles: true }));
        return 1;
      })()`);
      await sleep(900);

      // 切到别的引擎：输入框必须**清空**（那个引擎没设过）
      await evalIn(cdp, sessionId, `(() => {
        const p = document.getElementById('provider');
        p.value = 'deepseek'; p.dispatchEvent(new Event('change', { bubbles: true }));
        return 1;
      })()`);
      await sleep(900);
      const onOther = await evalIn(cdp, sessionId, `document.getElementById('adv-custom').value`);
      if (String(onOther).trim()) {
        problems.push(`切到别的引擎后自定义参数没清空（读到 ${JSON.stringify(onOther)}）`
          + ' —— 用户随手一改就会把上一个引擎的参数存到这个引擎名下');
      }

      // 切回来：必须还在
      await evalIn(cdp, sessionId, `(() => {
        const p = document.getElementById('provider');
        p.value = 'custom_chat'; p.dispatchEvent(new Event('change', { bubbles: true }));
        return 1;
      })()`);
      await sleep(900);
      const back2 = await evalIn(cdp, sessionId, `document.getElementById('adv-custom').value`);
      if (String(back2) !== CUSTOM) {
        problems.push(`切回原引擎后自定义参数丢了（读到 ${JSON.stringify(back2)}）`);
      }

      // 存储里必须是**按引擎索引的一张表**，而不是一个裸字符串
      const storedCustom = JSON.parse(await evalIn(cdp, sessionId,
        `new Promise(r => chrome.storage.local.get(['reqCustomParams'], v => r(JSON.stringify(v.reqCustomParams || null))))`));
      if (!storedCustom || storedCustom.custom_chat !== CUSTOM || 'deepseek' in storedCustom) {
        problems.push(`reqCustomParams 结构不对: ${JSON.stringify(storedCustom)}`);
      }
      notes.push(`自定义参数 按引擎隔离 ✓（存储键: ${Object.keys(storedCustom || {}).join(',')}）`);
      // 清掉，后面那段翻译要的是干净配置
      await evalIn(cdp, sessionId,
        `new Promise(r => chrome.storage.local.remove(['reqCustomParams'], () => r(1)))`);
      for (const e of errs) problems.push(`options 交互期异常: ${e}`);
      off();
      await cdp.send('Target.closeTarget', { targetId });
      // 这一段往存储里写了东西，后面那段翻译要的是干净配置，所以清掉。
      if (swSession) {
        await evalIn(cdp, swSession,
          `new Promise(r => chrome.storage.local.remove(['reqTemperature','reqConcurrency'], () => r(1)))`);
      }
    }

    // ── 3. 配置成用户那种形状：custom_chat + 自填完整端点 ────────────────────
    if (swSession) {
      await evalIn(cdp, swSession, `new Promise(r => chrome.storage.local.set(${JSON.stringify({
        provider: 'custom_chat', apiKey: 'smoke-key',
        apiBaseUrl: `${base}/v1/chat/completions`, apiModel: 'smoke-model',
        targetLang: 'zh-CN', enabled: true, showFab: true,
      })}, () => r(1)))`);
    }

    // ── 4. 打开网页，点翻译，看页面上有没有真的出现译文 ──────────────────────
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const isolated = new Set();
    const offCtx = cdp.on('Runtime.executionContextCreated', (p, sid) => {
      if (sid === sessionId && p.context.auxData && p.context.auxData.type === 'isolated') isolated.add(p.context.id);
    });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: `${base}/page.html` }, sessionId);

    let ctxId = null;
    for (let i = 0; i < 80 && !ctxId; i++) {
      for (const id of [...isolated].reverse()) {
        try {
          if (await evalIn(cdp, sessionId, "typeof WebpageTranslator === 'object'", id)) { ctxId = id; break; }
        } catch (_) { /* stale */ }
      }
      if (!ctxId) await sleep(150);
    }
    if (!ctxId) {
      problems.push('内容脚本从未就绪 —— WebpageTranslator 没出现（IIFE 在加载期炸了？）');
    } else {
      await evalIn(cdp, sessionId, `WebpageTranslator.enable(${JSON.stringify({
        provider: 'custom_chat', apiKey: 'smoke-key',
        apiBaseUrl: `${base}/v1/chat/completions`, apiModel: 'smoke-model',
        targetLang: 'zh-CN',
      })}); true`, ctxId);

      let got = '';
      for (let i = 0; i < 100; i++) {
        got = await evalIn(cdp, sessionId,
          `Array.from(document.querySelectorAll('.mt-translation')).map(n => n.innerText).join(' | ')`, ctxId);
        if (got && got.includes(MARK)) break;
        await sleep(200);
      }
      if (got && got.includes(MARK)) notes.push(`页面译文: ${got.slice(0, 80)}`);
      else problems.push(`页面上没有出现译文（.mt-translation = ${JSON.stringify(got)}）`);

      // 走的哪条路 —— 端点故意不给 CORS 头，通得过就只可能是后台。
      const diag = await evalIn(cdp, sessionId,
        `(async () => { const d = {}; try { await TranslationAPI.translate('Hello there.', 'zh-CN', 'custom_chat',
           'smoke-key', ${JSON.stringify(`${base}/v1/chat/completions`)}, 'smoke-model', { noCache: true, diag: d }); }
           catch (e) { d.error = String(e && e.message || e); } return JSON.stringify(d); })()`, ctxId);
      notes.push(`诊断: ${diag}`);
      const d = JSON.parse(diag || '{}');
      if (d.route !== 'proxy') {
        problems.push(`通路是 ${JSON.stringify(d.route)}，期望 proxy —— 端点没有 CORS 头，直连本就该被挡`);
      }
      // 表外的 host 只该发协议要求的最小必要字段。这一行报的是真实发出的键，
      // 所以「多发了什么」在失败时是直接可读的，不用回去翻服务端日志。
      notes.push(`请求体字段: ${JSON.stringify(d.bodyKeys)}（能力表命中: ${d.paramRow || '无 —— 走最小必要集'}）`);
      if (d.bodyKeys && d.bodyKeys.some((k) => k !== 'model' && k !== 'messages')) {
        problems.push(`表外端点收到了可选字段: ${d.bodyKeys.join(',')} —— 最小必要集只该有 model 与 messages`);
      }
    }
    offCtx();
  } finally {
    try { await cdp.close(); } catch (_) {}
    chrome.cleanup();
    srv.close();
  }

  if (trapHits.length) {
    problems.push(`带 temperature 的请求被发了 ${trapHits.length} 次（字段: ${trapHits.join(' | ')}）`
      + ' —— 127.0.0.1 不在能力表里，一个可选字段都不该发');
  }

  console.log(notes.join('\n'));
  console.log('');
  if (problems.length) {
    console.log('✗ 安装冒烟失败:');
    for (const p of problems) console.log('   ' + p);
    process.exit(1);
  }
  console.log('✓ 真实安装 → 严格 CORS 端点 → 表外走最小必要集（陷阱 0 次命中）→ 页面出译文，全通（通路：扩展后台）');
})().catch((e) => { console.error('smoke failed:', (e && e.stack) || e); process.exit(1); });
