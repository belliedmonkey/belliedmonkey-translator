#!/usr/bin/env node
// store-assets/src/capture.js —— 拍商店图里「扩展自己的页面」那三屏（复习卡 / 学习统计 / 一键配置），
// 按 语言 × 设备档位 各拍一张：
//
//   assets/{en,zh}-{phone,tablet,desk}-{card,stats,onboard}.png
//
// 设备档位是 2026-09-06 加的硬规矩（见 ../README.md「一条硬规矩」）：手机商店图只放手机
// 视口拍的东西，iPad 放平板视口，Mac / Chrome 商店放桌面视口。此前 f3/f4/f6 只有手机一档，
// 被塞进 2880 宽的 Mac 图里；反过来 Mac 窗口被塞进手机图里，正文一个字都看不清。
//
// 语言也是拍出来的，不是合成时贴的：界面文案由页面自己的 uiLang 设置决定，英文商店图
// 就该是英文界面（此前 en-* 商店图里的复习页是中文界面）。语料本身始终是 EN→ZH 的对照，
// 那是产品在做的事。
//
//   node build.js && node store-assets/src/capture.js            # 全部 18 张
//   node store-assets/src/capture.js --lang en --tier phone      # 只拍一格
//
// 实拍纪律与 screenshots-cn 相同：真 Chrome 打开出货的 dist/（http，file:// 下 IndexedDB 被拒），
// 种一个像真库的语料，走真实用户流程；缺的只有环境（系统语音打桩、不登录、不填真 key）。
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '../..');
const OUT = path.join(__dirname, 'assets');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const SHIM = fs.readFileSync(path.join(ROOT, 'app/chrome-shim.js'), 'utf8');
const argv = process.argv.slice(2);
const pick = (flag, all) => { const i = argv.indexOf(flag); return i < 0 ? all : argv[i + 1].split(','); };
const LANGS = pick('--lang', ['en', 'zh']);
const TIERS = pick('--tier', ['phone', 'tablet', 'desk']);
const METRICS = {
  phone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },      // iPhone 6.9"
  tablet: { width: 1032, height: 1376, deviceScaleFactor: 2, mobile: true },   // iPad 13"
  // 1100×760：页面本身有 max-width，视口再宽只会拍出一条窄内容 + 大片空白（同 screenshots-cn）。
  desk: { width: 1100, height: 760, deviceScaleFactor: 2, mobile: false },
};
const UI_LANG = { en: 'en', zh: 'zh-CN' };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// One card per tier so the review surface looks like a real corpus, plus the
// counts header. Mirrors verify-learn-flow's seed shape.
const SEED = `(async () => {
  const now = Date.now(), day = 86400e3;
  const src = { id: 'src1', url: 'https://en.wikipedia.org/wiki/Espresso', title: 'Espresso - Wikipedia' };
  const mk = (id, text, tr, s, ago, extra) => Object.assign({
    id, text, tr, lang: 'en', targetLang: 'zh-CN', sourceId: 'src1', state: 'learning',
    createdAt: now - 30 * day, lastSeenAt: now - day, seenCount: 4, salience: 0.6,
    sched: { s, d: 5, lastReviewAt: now - ago * day, dueAt: now - 3600e3, reps: 3, lapses: 0 },
  }, extra || {});
  const pool = [
    ['Espresso is a concentrated form of coffee produced by forcing hot water under high pressure through finely ground coffee beans.', '浓缩咖啡是一种高浓度咖啡，通过高压热水流过精细研磨的咖啡豆制成。'],
    ['Spaced repetition is an evidence-based learning technique.', '间隔重复是一种有实证依据的学习方法。'],
    ['Reviews are scheduled just before the material is forgotten.', '复习被安排在材料即将被遗忘之前。'],
    ['Reading widely builds vocabulary naturally.', '广泛阅读能自然地积累词汇。'],
    ['Comprehensible input plays a central role in learning.', '可理解的输入在学习中扮演核心角色。'],
    ['The forgetting curve shows how memory fades over time.', '遗忘曲线展示了记忆如何随时间衰退。'],
    ['Children learn their first language without formal teaching.', '儿童无需正式教学就能学会母语。'],
    ['Newly learned words need more frequent review.', '新学的单词需要更频繁的复习。'],
  ];
  const items = [];
  // A lived-in library: a handful due now, a long tail already learned.
  for (let i = 0; i < 62; i++) {
    const [text, tr] = pool[i % pool.length];
    const due = i < 14;                       // 待复习
    const known = i >= 44;                    // 已掌握
    const s = known ? 190 + (i % 7) * 6 : due ? 1.2 + (i % 5) * 0.9 : 9 + (i % 11) * 2.5;
    const ago = due ? s * 1.6 : s * 0.25;
    items.push(mk('c' + i, i === 1 ? pool[1][0] : text, i === 1 ? pool[1][1] : tr, s, ago,
      i % 3 === 0 ? { skills: { read: now - 3600e3 } } : null));
  }
  // 首卡（R 最低 ⇒ 牌组第一张）钉在本地题型上：AI 题包在离线抓图环境里必然失败，
  // 那条「已换用本地题型」提示是产品诚实的失败面，但不属于商店图。
  const first = items[0];
  first.sched.s = 0.9; first.sched.lastReviewAt = now - 9 * day;   // 最久未复习 ⇒ 排第一
  for (let r = 0; r < 64; r++) {
    if (LearnExercises.pickExercise('read', { id: first.id }, { reps: r, poolSize: items.length, hasAI: true }).kind === 'recall') {
      first.sched.reps = r; break;
    }
  }
  const db = await LearnStore.open();
  await new Promise((res, rej) => {
    const t = db.transaction(['items', 'sources'], 'readwrite');
    for (const it of items) t.objectStore('items').put(it);
    t.objectStore('sources').put(src);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return 'seeded';
})()`;
// 复习卡要拍「答对之后」：选项题点文本恰好等于原句译文的那个；recall 卡点「显示译文」。
const PAIRS = Object.fromEntries([...SEED.matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]));
const ANSWER = `(() => { const r = document.getElementById('reveal'); if (r && !r.hidden && r.offsetParent) { r.click(); return 'reveal'; }
  const pairs = ${JSON.stringify(PAIRS)}; const orig = (document.getElementById('orig') || {}).textContent || '';
  const want = Object.entries(pairs).find(([k]) => orig.trim().startsWith(k.slice(0, 30)));
  const opt = [...document.querySelectorAll('.ex-option')].find((x) => want && x.textContent.trim() === want[1] && x.offsetParent);
  if (opt) { opt.click(); return 'answered'; } return 'none:' + orig.slice(0, 20); })()`;
const DISMISS = `(() => { const b = [...document.querySelectorAll('button')].find((x) => /知道了|Got it/i.test(x.textContent)); if (b) b.click(); return !!b; })()`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'learn/review.html'))) throw new Error('dist/ 不存在或不完整，先 node build.js');
  const srv = http.createServer((q, r) => {
    const f = path.join(dist, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); r.end(fs.readFileSync(f));
  }).listen(0); await new Promise((r) => srv.on('listening', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  setTimeout(() => { console.log('timeout'); process.exit(1); }, 300000).unref();
  const t0 = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t0.targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    ${SHIM}
    (() => {
      const voices = [{ name: 'Ting-Ting', lang: 'zh-CN', voiceURI: 'zh', default: true, localService: true },
                      { name: 'Samantha', lang: 'en-US', voiceURI: 'en', default: false, localService: true }];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => voices, addEventListener: () => {}, cancel: () => {}, resume: () => {},
        speak: (u) => { setTimeout(() => u.dispatchEvent && u.dispatchEvent(new Event('start')), 0);
                        setTimeout(() => u.dispatchEvent && u.dispatchEvent(new Event('end')), 40); },
      } });
      class U extends EventTarget { constructor(t) { super(); this.text = t; } }
      window.SpeechSynthesisUtterance = U;
    })();
    try {
      localStorage.setItem('mt:ttsVoice', JSON.stringify('en'));
      localStorage.setItem('mt:ttsEngine', JSON.stringify('browser'));   // 1.7.14 起朗读不再默认系统语音；不配就会印一行「还没配语音引擎」
      localStorage.setItem('mt:learnEnabled', 'true');
      localStorage.setItem('mt:provider', JSON.stringify('google'));
      // 不写 apiKey：免费通道不需要，商店图也不该出现任何像密钥的东西。
      localStorage.setItem('mt:ttsMode', JSON.stringify('assist'));
    } catch (_) {}
  ` }, sessionId);
  const ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const go = async (url) => { await cdp.send('Page.navigate', { url }, sessionId); await sleep(1800); };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('captured', name);
  };
  await go(BASE + '/learn/review.html');
  console.log(await ev(SEED));
  for (const lang of LANGS) {
    await ev(`localStorage.setItem('mt:uiLang', JSON.stringify(${JSON.stringify(UI_LANG[lang])}))`);
    for (const tier of TIERS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', METRICS[tier], sessionId);
      const P = `${lang}-${tier}-`;
      // ── stats：复习页首屏（计数 header + 首卡）。不登录，页面显示「未登录，仅本机数据」──
      await go(BASE + '/learn/review.html'); await sleep(800);
      await ev(DISMISS); await sleep(500); await ev('window.scrollTo(0, 0)');
      await shot(P + 'stats.png');
      // ── card：答对之后的双语对照 + 四档评分，这套学习循环最说明问题的一屏 ──
      await ev(`LearnReview.start().then(() => 'ok')`); await sleep(1200);
      await ev(DISMISS); await sleep(400);
      console.log(' ', await ev(ANSWER)); await sleep(900);
      await ev(`(() => { const r = document.getElementById('reveal'); if (r && !r.hidden && r.offsetParent) r.click(); return 'ok'; })()`); await sleep(600);
      // 手机首屏放不下评分行：把它滚进来（真用户就是这么看的）；桌面/平板整卡都在首屏。
      await ev(tier === 'phone' ? `(() => { const c = document.getElementById('card'); if (c) c.scrollIntoView({ block: 'start' }); })()` : 'window.scrollTo(0, 0)');
      await sleep(300);
      await shot(P + 'card.png');
      // ── onboard：引导第二屏「选一个翻译引擎」，一键配置卡，平台 + 一把假 key ──
      await go(BASE + '/onboard/onboard.html'); await sleep(600);
      await ev(`(() => { document.getElementById('ob-next').click(); return document.body.dataset.obStep; })()`); await sleep(600);
      console.log(' ', await ev(`(() => {
        const sel = document.getElementById('qs-platform'); const key = document.getElementById('qs-key');
        if (!sel || !key) return 'no-quick:' + document.body.dataset.obStep;
        const o = [...sel.options].find((x) => /openrouter/i.test(x.textContent + x.value)); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        key.value = 'sk-or-v1-' + 'x'.repeat(48); key.dispatchEvent(new Event('input', { bubbles: true }));
        key.blur(); return 'quick:' + (o ? o.textContent : sel.value); })()`));
      await sleep(500); await ev('window.scrollTo(0, 0)');
      await shot(P + 'onboard.png');
    }
  }
  srv.close(); chrome.cleanup(); process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
