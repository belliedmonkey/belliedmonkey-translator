// Capture China-flavor product screenshots for the App Store listing.
// Real captures of the SHIPPED dist-china surfaces (options + review page) —
// same discipline as the global store assets: photograph the product, don't mock it.
// 用法（仓库根目录）：
//   node build.js --flavor china            # 先出 dist-china
//   (cd dist-china && python3 -m http.server 8731 &)
//   node screenshots-cn/src/capture.js      # 拍出 src/assets/*.png
//   bash screenshots-cn/src/render.sh       # 合成 cn-iphone-*/cn-ipad-*
//   python3 <上传脚本>                       # 见 gbrain 发布权威页的 ASC 四步资产流程
//
// 为什么要 http 服务而不是 file://：复习页用 IndexedDB，file:// origin 下被 Chrome 拒。
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const fs = require('fs');
const OUT = path.join(__dirname, 'assets');
const BASE = 'http://127.0.0.1:8731';
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
      localStorage.setItem('mt:provider', JSON.stringify('deepseek'));
      localStorage.setItem('mt:apiKey', JSON.stringify('sk-****************************'));
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

  // ── 1. 设置页：翻译引擎卡（国内引擎 + 自带 Key + 测试连接）──
  await cdp.send('Page.navigate', { url: BASE + '/options/options.html' }, sessionId);
  await wait(2500);
  // Scroll so the translation-engine card fills the frame.
  await ev(`(() => { const c = document.querySelectorAll('section.card')[0];
    c.scrollIntoView({block:'start'}); window.scrollBy(0, -8); return 'ok'; })()`);
  await wait(400);
  await shot('cn-options-engine.png');

  // ── 2. 复习卡（读过的句子变成复习卡）──
  await cdp.send('Page.navigate', { url: BASE + '/learn/review.html' }, sessionId);
  await wait(1500);
  console.log(await ev(SEED));
  await ev(`LearnReview.start().then(() => 'ok')`);
  await wait(1200);
  // Reveal the translation so the card shows the bilingual pair + grade row.
  await ev(`(() => { const r = document.getElementById('reveal');
    if (r && !r.hidden) r.click(); return 'ok'; })()`);
  await wait(600);
  await ev(`window.scrollTo(0, 0)`);
  await shot('cn-review-card.png');

  // ── 3. 学习设置（采集 / 学习语言 / 解析引擎）：收什么、怎么学由用户定 ──
  await cdp.send('Page.navigate', { url: BASE + '/options/options.html' }, sessionId);
  await wait(2500);
  await ev(`(() => { const h = [...document.querySelectorAll('section.card h2')]
      .find((x) => /学习|采集/.test(x.textContent));
    (h ? h.closest('section.card') : document.body).scrollIntoView({block:'start'});
    window.scrollBy(0, -8); return h ? h.textContent : 'NOT FOUND'; })()`);
  await wait(400);
  await shot('cn-options-learn.png');

  // ── 桌面尺寸：Mac App Store 截图要拍 Mac 上的样子，不能塞一张手机图进去 ──
  await cdp.send('Emulation.setDeviceMetricsOverride',
    // 1100×760：页面本身有 max-width，视口再宽只会拍出一条窄内容 + 大片空白。
    // 这个尺寸让内容填满窗口，放进 Mac 窗框后比例才像真的在用。
    { width: 1100, height: 760, deviceScaleFactor: 2, mobile: false }, sessionId);
  for (const [url, name, scrollTo] of [
    [BASE + '/options/options.html', 'cn-desk-engine.png', 'first'],
    [BASE + '/learn/review.html', 'cn-desk-review.png', 'review'],
    [BASE + '/options/options.html', 'cn-desk-learn.png', 'learn'],
  ]) {
    await cdp.send('Page.navigate', { url }, sessionId);
    await wait(2200);
    if (scrollTo === 'review') {
      await ev(`LearnReview.start().then(() => 'ok')`);
      await wait(1000);
      // 首次说明卡是真实的 onboarding，但它盖住复习卡；商店图要拍稳态。
      await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /知道了/.test(x.textContent));
        if (b) b.click(); return 'ok'; })()`);
      await wait(400);
      await ev(`(() => { const r = document.getElementById('reveal'); if (r && !r.hidden) r.click(); return 'ok'; })()`);
      await wait(500);
    } else if (scrollTo === 'learn') {
      await ev(`(() => { const h = [...document.querySelectorAll('section.card h2')].find((x) => /学习|采集/.test(x.textContent));
        if (h) h.closest('section.card').scrollIntoView({ block: 'start' }); window.scrollBy(0, -10); return 'ok'; })()`);
      await wait(300);
    }
    await shot(name);
  }

  chrome.cleanup();
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
