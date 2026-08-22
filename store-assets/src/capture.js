// Capture GLOBAL-flavor product screenshots for the App Store / CWS / AMO listings.
// Real captures of the SHIPPED dist/ surfaces — same discipline as screenshots-cn:
// photograph the product, don't mock it.
//
// 只拍手机上的两张学习界面（f3/f4）。另外两张是「网页正在被翻译」的实拍：
//   f1-article.png  Mac Safari 里真实译好的一页（真机截图，见 store-assets/README）
//   f2-video.png    YouTube 双语字幕（同上）
// 它们需要真实扩展跑在真实站点上，headless 里造不出来，所以不在这个脚本里。
//
// 用法（仓库根目录）：
//   node build.js                           # 先出 dist/
//   (cd dist && python3 -m http.server 8732 &)
//   node store-assets/src/capture.js        # 拍出 src/assets/f3,f4
//   bash store-assets/src/render.sh         # 合成 40 张出货图
//   node scripts/asc-media.js --apply       # 传到 ASC（默认只打印计划）
//
// 为什么要 http 服务而不是 file://：复习页用 IndexedDB，file:// origin 下被 Chrome 拒。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const fs = require('fs');
const OUT = path.join(__dirname, 'assets');
const BASE = 'http://127.0.0.1:8732';
const SHIM = fs.readFileSync(path.join(ROOT, 'app/chrome-shim.js'), 'utf8');

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = await launchChrome();
  const cdp = await CDP.connect(chrome.port);
  const targets = await cdp.send('Target.getTargets', {});
  const page = targets.targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 402, height: 874, deviceScaleFactor: 3, mobile: true }, sessionId);
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
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('captured', name);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── f3：学习统计（读过多少、该复习多少）──
  //
  // 旧图（08-15）印着真实邮箱 belliedmonkey@gmail.com —— 公开商店图不该有。
  // 这里不登录，页面自然显示未登录态，没有任何账号信息。
  await cdp.send('Page.navigate', { url: BASE + '/learn/review.html' }, sessionId);
  await wait(1800);
  console.log(await ev(SEED));
  await cdp.send('Page.reload', {}, sessionId);
  await wait(2200);
  // 首次说明卡是真实的 onboarding，但它只出现一次，不该代表产品的常态。
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /知道了|Got it/i.test(x.textContent));
    if (b) b.click(); return b ? 'dismissed' : 'none'; })()`);
  await wait(600);
  await ev(`window.scrollTo(0, 0)`);
  await shot('f3-phone-stats.png');

  // ── f4：复习卡（读过的句子变成卡片）──
  await ev(`LearnReview.start().then(() => 'ok')`);
  await wait(1400);
  // 首次说明卡是真实的 onboarding，但它盖住复习卡；商店图要拍稳态。
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /知道了|Got it/i.test(x.textContent));
    if (b) b.click(); return 'ok'; })()`);
  await wait(400);
  // recall 卡有 #reveal；选择题没有，走真实用户流程：答对 → 卡片展示双语对照 + 评分按钮。
  // 那正是旧 f4 拍的那个状态，也是这套学习循环最说明问题的一屏。
  await ev(`(() => { const r = document.getElementById('reveal'); if (r && !r.hidden) { r.click(); return 'reveal'; }
    const opt = [...document.querySelectorAll('button,li,div')].find((x) => /浓缩咖啡是一种高浓度咖啡/.test(x.textContent) && x.textContent.length < 80);
    if (opt) { opt.click(); return 'answered'; }
    return 'none'; })()`);
  await wait(1200);
  await ev(`(() => { const r = document.getElementById('reveal'); if (r && !r.hidden) r.click(); return 'ok'; })()`);
  await wait(700);
  await ev(`window.scrollTo(0, 0)`);
  await shot('f4-phone-card.png');

  chrome.cleanup();
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
