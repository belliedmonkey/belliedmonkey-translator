/* scripts/verify-grant.js — 免费额度的端到端门禁（docs/learning-design.md §8.10）。
 *
 * 它验的是**只有真浏览器答得了**的那一段：额度用完之后，页面上到底发生了什么。
 *
 *   · 纯逻辑套件已经钉住了「哪个码说哪句话」与「停机后不再发请求」（test/grant-*.test.js）。
 *   · 但那两件事都发生在模块内部。用户看到的是**页面上那一行字**，而它经过渲染器、
 *     i18n、真实的 fetch 与真实的 402 —— 这中间任何一环断了，单测都是绿的。
 *
 * 判据故意**不硬编码中文**：headless Chrome 的界面语言不一定是中文，而一个只在中文
 * 环境下成立的断言，在 CI 上要么假绿要么假红。改成拿模块自己算出的那句话去比 DOM ——
 * 这样它同时还守住「渲染器用的就是那份共享文案」，而不是自己抄了一份。
 *
 * 用法：node scripts/verify-grant.js
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const ROOT = path.resolve(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));

const OK_BEFORE_402 = 2;                 // 前两段正常返回，第三段起 402
const TOKEN = 'bmg_verifygrantverifygrantverifygrantverify1';
const MODEL = 'deepseek/deepseek-v4-flash';

let ok = true;
const fail = (m) => { ok = false; console.log('  ✗ ' + m); };
const pass = (m) => console.log('  ✓ ' + m);
setTimeout(() => { console.log('\n✗ 超时'); process.exit(2); }, 120000).unref();

// ── 产物副本：把中继地址与 MT_GRANT 改指本机 ────────────────────────────
function prepareDist(port) {
  const src = path.join(ROOT, 'dist');
  if (!fs.existsSync(src)) throw new Error('先跑 node build.js —— dist/ 不在');
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-grant-'));
  fs.cpSync(src, run, { recursive: true });
  const gen = path.join(run, 'content', 'providers.gen.js');
  let t = fs.readFileSync(gen, 'utf8');
  const base = `http://127.0.0.1:${port}`;
  // 真实后端主机 → 本机。**照字面替换**，不重建注册表：门禁要验的是出货的那份产物，
  // 自己拼一份等于验了一个不存在的东西。
  const before = t;
  t = t.replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, base);
  if (t === before) throw new Error('providers.gen.js 里没有后端地址可替换 —— 注册表形状变了？');
  t = t.replace('window.MT_GRANT = null;',
    `window.MT_GRANT = ${JSON.stringify({ vendor: 'test', vendorLabel: 'TestVendor', limitUsd: 0.2, claimUrl: base + '/functions/v1/bt-grant', models: { chat: MODEL } })};`);
  fs.writeFileSync(gen, t);
  for (const f of ['tts.gen.js', 'stt.gen.js']) {
    const p = path.join(run, 'content', f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, base));
  }
  return run;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>grant fixture</title></head>
<body>${Array.from({ length: 6 }, (_, i) =>
  `<p>Paragraph number ${i + 1}. The lead time is four weeks and the unit price is twelve dollars.</p>`).join('\n')}</body></html>`;

(async () => {
  const seen = { chat: [], grant: [] };
  const srv = http.createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = q.url.split('?')[0];
    if (u === '/functions/v1/bt-grant') {
      seen.grant.push({ auth: q.headers.authorization || '' });
      r.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return r.end(JSON.stringify({ token: TOKEN, limit_usd: 0.2, spent_usd: 0, reused: false }));
    }
    if (u === '/functions/v1/bt-relay/chat/completions') {
      let body = ''; q.on('data', (c) => { body += c; });
      return q.on('end', () => {
        seen.chat.push({ auth: q.headers.authorization || '', body });
        if (seen.chat.length <= OK_BEFORE_402) {
          r.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
          return r.end(JSON.stringify({ choices: [{ message: { content: '【译】ok' } }] }));
        }
        // 额度用完：中继的具名 402。这一枚就是整条链要认的那个东西。
        r.writeHead(402, { ...cors, 'Content-Type': 'application/json' });
        r.end(JSON.stringify({ error: 'credit_exhausted' }));
      });
    }
    if (u === '/page.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(PAGE); }
    r.writeHead(404); r.end();
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port;
  const runDist = prepareDist(port);

  const chrome = await launchChrome();
  let cdp;
  try {
    cdp = await CDP.connect(chrome.port);
    await cdp.send('Extensions.loadUnpacked', { path: runDist });
    await new Promise((r) => setTimeout(r, 1200));

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const isolated = new Set();
    cdp.on('Runtime.executionContextCreated', (p, sid) => {
      if (sid === sessionId && p.context.auxData && p.context.auxData.type === 'isolated') isolated.add(p.context.id);
    });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/page.html` }, sessionId);
    await new Promise((r) => setTimeout(r, 2000));

    const evalIn = async (ctx, expr) => {
      const r = await cdp.send('Runtime.evaluate',
        { expression: expr, returnByValue: true, awaitPromise: true, contextId: ctx }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result ? r.result.value : undefined;
    };
    let ctx = null;
    for (const c of [...isolated].reverse()) {
      try { if (await evalIn(c, "typeof WebpageTranslator === 'object'")) { ctx = c; break; } } catch (_) {}
    }
    if (!ctx) throw new Error('内容脚本没注入 —— 扩展没装上？');

    // 额度那一档：provider = grant，key = 令牌，模型钉住。这正是 LearnGrant.plan 写出来的形状。
    await evalIn(ctx, `WebpageTranslator.enable(${JSON.stringify({
      enabled: true, targetLang: 'zh-CN', provider: 'grant', apiKey: TOKEN,
      apiBaseUrl: '', apiModel: MODEL, textColor: '#0a7a3c', fontSize: '1.0', showFab: false,
    })}); true`);
    await new Promise((r) => setTimeout(r, 10000));

    // ── 断言 ────────────────────────────────────────────────────────────
    if (seen.chat.length === 0) { fail('中继一次请求都没收到 —— 这一轮什么也没证明'); }
    else pass(`中继收到 ${seen.chat.length} 次请求（前 ${OK_BEFORE_402} 次 200，之后 402）`);

    // 停机的判据是**同一段不会被再请求一次**，不是「某个时间窗里没有新请求」。
    //
    // 第一版写的就是后者，而它**证伪失败**：拆掉停机闸之后请求从 5 次涨到 14 次，
    // 那条断言照样绿 —— 因为重试在第一个观测点之前就全跑完了，两次采样之间自然
    // 没有新请求。一个两边都绿的门禁不是门禁。
    //
    // 重试恰恰是多出来那 9 次的来源（MAX_RETRIES 次 × 每段），所以「有没有同一段被
    // 请求两次」把两种世界干净地分开：停机 = 每段至多一次；不停机 = 必然出现重复。
    const texts = seen.chat.map((c) => {
      try {
        const j = JSON.parse(c.body);
        const u = (j.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('');
        return u;
      } catch (_) { return ''; }
    }).filter(Boolean);
    const dup = new Map();
    for (const x of texts) dup.set(x, (dup.get(x) || 0) + 1);
    const repeated = [...dup.entries()].filter(([, n]) => n > 1);
    if (!texts.length) fail('一条请求体都解不出来 —— 这条断言在空转');
    else if (repeated.length) {
      fail(`额度用完之后还在重试：${repeated.length} 段被请求了多次`
        + `（最多 ${Math.max(...repeated.map(([, n]) => n))} 次）—— 引擎没停机`);
    } else pass(`停机了：${texts.length} 次请求覆盖 ${dup.size} 段，没有任何一段被重试`);

    const want = await evalIn(ctx, "TranslationCore.grantHaltMessage('credit_exhausted')");
    const plain = await evalIn(ctx, 'TranslationCore.MSG.error');
    if (!want || want === plain) fail('停机文案与普通失败文案相同，或者是空的');
    const shown = await evalIn(ctx,
      `[...document.querySelectorAll('.mt-translation')].map(e => e.textContent)`);
    const hit = (shown || []).filter((x) => x === want).length;
    if (!hit) fail(`页面上没有那一行停机文案。期望 ${JSON.stringify(want)}，实际 ${JSON.stringify((shown || []).slice(0, 4))}`);
    else pass(`页面上 ${hit} 段显示了停机文案，且与共享文案逐字相同`);
    if ((shown || []).some((x) => x === plain)) fail('还有段落显示的是普通「翻译失败，点此重试」—— 额度用完时重试是没有意义的动作');
    else pass('没有段落退回普通重试文案');

    const bad = seen.chat.filter((c) => !/^Bearer bmg_/.test(c.auth));
    if (bad.length) fail(`有 ${bad.length} 次请求没带额度令牌`);
    else pass('每次请求都带着额度令牌，且没有别的凭证');
    if (seen.chat.some((c) => /eyJ/.test(c.auth))) fail('请求头里出现了 JWT —— 登录凭证漏进了中继请求');
    else pass('中继请求里没有登录凭证');
    const sentModel = seen.chat.map((c) => { try { return JSON.parse(c.body).model; } catch (_) { return ''; } });
    if (sentModel.some((m) => m !== MODEL)) fail(`发出去的模型不是钉住的那个：${JSON.stringify(sentModel)}`);
    else pass('每次都发钉住的模型 —— 不发就会撞 403 model_not_allowed');
    // ── 第二幕：真的点一次「领取」──────────────────────────────────────
    //
    // 上面那一幕验的是「额度用完之后」。而**领取这个按钮从没在真界面上点过** ——
    // 纯逻辑套件验的是 plan() 算出什么，端到端验的是停机，中间这一段（点击 → 领取
    // → 写三槽）只有真扩展页答得了。按钮点了什么都不发生，是这个仓库反复撞到的
    // 那一类：代码看着对、单测全绿。
    {
      const loaded = await cdp.send('Extensions.loadUnpacked', { path: runDist }).catch(() => null);
      const extId = (loaded && loaded.id) || null;
      // 上面已经装过一次，第二次会回同一个 id 或报已装 —— 两种都行，取得到就继续。
      let id = extId;
      if (!id) {
        const { targetInfos } = await cdp.send('Target.getTargets', {});
        const sw = (targetInfos || []).find((x) => x.type === 'service_worker' && /chrome-extension:/.test(x.url || ''));
        id = sw ? String(sw.url).split('/')[2] : null;
      }
      if (!id) fail('拿不到扩展 id —— 领取那一幕没法验');
      else {
        const { targetId: t2 } = await cdp.send('Target.createTarget',
          { url: `chrome-extension://${id}/options/options.html#grant` });
        const { sessionId: s2 } = await cdp.send('Target.attachToTarget', { targetId: t2, flatten: true });
        await cdp.send('Runtime.enable', {}, s2);
        const ev2 = async (expr) => {
          const r = await cdp.send('Runtime.evaluate',
            { expression: expr, awaitPromise: true, returnByValue: true }, s2);
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
          return r.result ? r.result.value : undefined;
        };
        // 种一个「已登录」的会话。auth.js 只在 token 过期时才去刷新，所以给一个
        // 远未过期的就够 —— 这一幕要验的是领取按钮，不是登录本身。
        const SESSION = {
          accessToken: 'fake-session-jwt', refreshToken: 'fake-refresh',
          expiresAt: Date.now() + 3600e3, user: { id: 'u-test', email: 't@example.invalid' },
        };
        await ev2(`new Promise(r => chrome.storage.local.set({ learnAuth: ${JSON.stringify(SESSION)} }, r))`);
        await new Promise((r) => setTimeout(r, 2500));
        // 重画一次：卡是跟着登录态画的，而我们是在页面起来之后才种的会话。
        await ev2('typeof refreshSyncUI === "function" ? refreshSyncUI() : null').catch(() => {});
        await new Promise((r) => setTimeout(r, 1500));

        const card = await ev2(`(() => { const b = document.getElementById('grant-box');
          const btn = b && b.querySelector('button.gr-action');
          const note = b && b.querySelector('.gr-note');
          return JSON.stringify({ vis: !!(b && b.getClientRects().length),
            btn: btn ? btn.textContent : null, note: note ? note.textContent : '' }); })()`);
        const c = JSON.parse(card);
        if (!c.vis) fail('设置页上看不到额度卡');
        else if (!c.btn) fail('额度卡上没有「领取」按钮');
        else if (!c.note || c.note.length < 80) fail(`领取按钮前没有那段披露（长度 ${c.note.length}）—— Gate F 的构成要件`);
        else if (/\{vendor\}/.test(c.note)) fail('披露里的占位符没被代掉');
        else pass('卡在、按钮在、披露在（且占位符已代掉）');

        if (c.btn) {
          await ev2(`document.querySelector('#grant-box button.gr-action').click(); 1`);
          await new Promise((r) => setTimeout(r, 3000));
          const got = JSON.parse(await ev2(`new Promise(r => chrome.storage.local.get(
            ['provider','apiKey','apiModel','ttsEngine','sttEngine','grantTail','grant','grantBalance'],
            o => r(JSON.stringify(o))))`));
          if (!seen.grant.length) fail('点了领取，但假后端一次请求都没收到 —— 按钮是死的');
          else pass(`领取请求发出去了（${seen.grant.length} 次），且带着会话凭证`);
          if (got.provider !== 'grant') fail(`翻译那一槽没写成额度：${got.provider}`);
          else if (got.apiKey !== TOKEN) fail('翻译那一槽的 key 不是领到的令牌');
          else if (got.apiModel !== MODEL) fail(`模型没被钉住：${got.apiModel}`);
          else if (got.ttsEngine !== 'grant_speech' || got.sttEngine !== 'grant_stt') {
            fail(`朗读/转写两槽没写对：${got.ttsEngine} / ${got.sttEngine}`);
          } else pass('三槽都写成了额度那一档，且模型被钉住');
          if (got.grantTail !== TOKEN.slice(-8)) fail('grantTail 没写对');
          else if (!got.grant || !got.grantBalance) fail('领取记录或余额缓存没写');
          else pass('三个标记都落盘了（尾八位 / 领取记录 / 余额缓存）');
          if (JSON.stringify(got.grant).includes(TOKEN)) fail('领取记录里出现了完整令牌 —— 只该存尾八位');
          else pass('落盘的记录里没有完整令牌');
        }
      }
    }
  } catch (e) {
    fail(String((e && e.message) || e));
  } finally {
    try { chrome.cleanup(); } catch (_) {}
    srv.close();
    try { fs.rmSync(runDist, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(ok ? '\n✓ 免费额度端到端：停机、文案、令牌、钉住的模型 全部通过'
    : '\n✗ 免费额度端到端有问题');
  process.exit(ok ? 0 : 1);
})();
