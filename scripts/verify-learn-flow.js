// scripts/verify-learn-flow.js — the learning suite, walked END TO END in a real
// engine. docs/learn-regression.md is the case list this implements; run it with
//
//   npm run test:learn        (needs Chrome; Node ≥22)
//
// Why this exists when npm test already covers the pure logic: the phone kept
// finding bugs the unit suite cannot see, and they were all of one shape — the
// LOGIC was right and the SURFACE was wrong. A ▶ button rendered green-on-green
// (app shell CSS leaking under review.css), a label that never got painted, a
// message that named the wrong fix. None of that exists in a vm harness.
//
// So this runner drives the SHIPPED app bundle (dist-app, shipped layout — see
// verify-app-bundle.js for why the layout matters) through the whole loop with a
// seeded corpus, and after EVERY step it sweeps the visible surface:
//
//   · every visible button / link / select carries non-empty text
//   · every visible control's foreground differs from its own background
//     (the green-on-green class, killed wholesale rather than per-instance)
//
// plus per-tier flow assertions with the DATABASE as the source of truth —
// grading writes sched, practice-fail lapses, practice-pass writes nothing.
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

// The app's own shim, injected into BOTH hosts: the extension page needs it because
// this server is not an extension origin (no chrome.*), and injecting the same bytes
// the app ships keeps the two hosts' storage semantics identical. In the app host it
// runs before the bundle's copy, which then early-returns — same code either way.
const SHIM_SRC = fs.readFileSync(path.join(ROOT, 'app/chrome-shim.js'), 'utf8');

setTimeout(() => { console.log('\n✗ 超时（240s），没有结论'); process.exit(2); }, 240000).unref();

// ─── The two hosts. Same review.js bytes, different DOM/CSS surroundings — which
// is exactly where the phone's bugs lived (the green-on-green ▶ existed ONLY in
// the app host, where the shell stylesheet cascades under review.css).
const HOSTS = [
  {
    name: 'App（dist-app · 出货布局）', isApp: true,
    page: '/Base.lproj/Main.html', scope: '#review-view',
    route: (u) => {
      const rel = u === '/' ? '/Base.lproj/Main.html' : u.split('?')[0];
      const name = path.basename(rel);
      const okp = (name === 'Main.html' && rel.startsWith('/Base.lproj/'))
        || ((name === 'Script.js' || name === 'Style.css') && !rel.startsWith('/Base.lproj/'));
      return okp ? path.join(SRC, name) : null;
    },
  },
  {
    name: '扩展复习页（dist/learn/review.html · chrome 垫片）', isApp: false,
    page: '/learn/review.html', scope: 'body',
    route: (u) => {
      const rel = decodeURIComponent(u.split('?')[0]);
      const p = path.normalize(path.join(DIST, rel));
      return p.startsWith(DIST) ? p : null;
    },
  },
];

// ─── The seeded corpus: one card per exercise tier, plus the special cases ──
// Times are fixed relative to NOW at seed time (injected — no Date.now in-page
// surprises). Ids are plain strings: LearnStore never re-derives them.
const SEED = `(async () => {
  const now = Date.now();
  const day = 86400e3;
  const src = { id: 'src1', url: 'https://example.org/a', title: 'Example Article' };
  const items = [
    { id: 'read1', text: 'The forgetting curve is steep at first.', tr: '遗忘曲线起初很陡。',
      lang: 'en', sourceId: 'src1', state: 'learning', createdAt: now - 9 * day, lastSeenAt: now - day,
      seenCount: 3, salience: 0.6,
      sched: { s: 1.5, d: 5, lastReviewAt: now - 2 * day, dueAt: now - 3600e3, reps: 2, lapses: 0 } },
    // listen1/write1 carry a FRESH speak stamp: with the speak capability open
    // (§9.4 mocks below), an unstamped speak would win their rotations and the
    // pinned listen-pick / write assertions would never render. speak coverage
    // has its own dedicated card (speak1).
    { id: 'listen1', text: 'Practice makes memories durable.', tr: '练习让记忆持久。',
      lang: 'en', sourceId: 'src1', state: 'learning', createdAt: now - 30 * day, lastSeenAt: now - day,
      seenCount: 8, salience: 0.5, skills: { read: 1, speak: now - 3600e3 },
      sched: { s: 10, d: 5, lastReviewAt: now - 11 * day, dueAt: now - day, reps: 6, lapses: 0 } },
    { id: 'write1', text: 'Spaced repetition beats cramming easily.', tr: '间隔重复轻松胜过临时抱佛脚。',
      lang: 'en', sourceId: 'src1', state: 'learning', createdAt: now - 90 * day, lastSeenAt: now - day,
      seenCount: 20, salience: 0.5, skills: { read: 1, listen: 1, speak: now - 3600e3 },
      sched: { s: 60, d: 4, lastReviewAt: now - 65 * day, dueAt: now - 5 * day, reps: 12, lapses: 0 } },
    { id: 'und1', text: 'Unknown language sentence here.', tr: '未知语言的句子。',
      lang: 'und', sourceId: 'src1', state: 'learning', createdAt: now - 9 * day, lastSeenAt: now - day,
      seenCount: 3, salience: 0.4,
      sched: { s: 1.2, d: 5, lastReviewAt: now - 2 * day, dueAt: now - 3600e3, reps: 2, lapses: 0 } },
    { id: 'cand1', text: 'A fresh candidate sentence.', tr: '一句新候选。',
      lang: 'en', sourceId: 'src1', state: 'candidate', createdAt: now - day, lastSeenAt: now - day,
      seenCount: 1, salience: 0.9 },
    // §9.4 — read/listen stamped FRESH so the rotation's least-recently-verified
    // rule lands on speak (never stamped), and no second exercise queues.
    { id: 'speak1', text: 'Reading aloud cements pronunciation.', tr: '朗读巩固发音。',
      lang: 'en', sourceId: 'src1', state: 'learning', createdAt: now - 30 * day, lastSeenAt: now - day,
      seenCount: 5, salience: 0.5, skills: { read: now - 3600e3, listen: now - 3600e3 },
      sched: { s: 10, d: 5, lastReviewAt: now - 11 * day, dueAt: now - day, reps: 4, lapses: 0 } },
  ];
  // §9.3 — pin each card's exercise VARIANT by choosing reps: the rotation is
  // deterministic in (id, reps, skill), so the walk can assert specific variants
  // instead of guessing which one the seed produced.
  const pickReps = (skill, id, want) => {
    for (let r = 0; r < 64; r++) {
      if (LearnExercises.pickExercise(skill, { id }, { reps: r, poolSize: items.length, hasAI: false }).kind === want) return r;
    }
    return 0;
  };
  items[0].sched.reps = pickReps('read', 'read1', 'mcq');
  items[1].sched.reps = pickReps('listen', 'listen1', 'listen-pick');
  items[3].sched.reps = pickReps('read', 'und1', 'recall');
  const db = await LearnStore.open();
  await new Promise((res, rej) => {
    const t = db.transaction(['items', 'sources'], 'readwrite');
    for (const it of items) t.objectStore('items').put(it);
    t.objectStore('sources').put(src);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return JSON.stringify({ listenReps: items[1].sched.reps });
})()`;

// ─── The per-step surface sweep ──────────────────────────────────────────────
// Definition of "broken surface": a visible interactive element with no text, or
// whose resolved foreground equals its resolved background. Resolution walks up
// for the background because most controls are transparent over the card.
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
  const bg = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c;
    }
    return 'rgb(255, 255, 255)';
  };
  for (const el of root.querySelectorAll('button, a, select, option, label, input[type=text], input[type=password]')) {
    if (!vis(el)) continue;
    const tag = el.tagName.toLowerCase();
    const label = (el.textContent || el.value || el.placeholder || '').trim();
    if ((tag === 'button' || tag === 'a') && !label) {
      bad.push(tag + '#' + (el.id || el.className) + ' 无文字');
      continue;
    }
    const cs = getComputedStyle(el);
    if (tag === 'button' || tag === 'a') {
      const fg = cs.color, back = bg(el);
      if (fg === back) bad.push(tag + '#' + (el.id || el.className) + ' 前景=背景 ' + fg);
    }
  }
  return bad;
}`;

async function runHost(host) {
  console.log('\n── 宿主：' + host.name + ' ──');
  const srv = http.createServer((req, res) => {
    const p = host.route(req.url);
    if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' });
    res.end(fs.readFileSync(p));
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port + host.page;

  const chrome = await launchChrome();
  let ok = true;
  const failures = [];
  const need = (cond, msg) => { if (!cond) { ok = false; failures.push(msg); console.log('  ✗ ' + msg); } };
  try {
    const cdp = await CDP.connect(chrome.port);
    const targets = await cdp.send('Target.getTargets', {});
    const page = targets.targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const problems = [];
    cdp.listeners.push({ event: 'Runtime.exceptionThrown', fn: (p) => problems.push(
      'EXCEPTION ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text)) });

    // Mock the platform speech BEFORE the bundle loads: one English voice, and a
    // speak() that fires `start` — so the listen tier is REACHABLE. The mock is
    // what makes tier behavior testable at all; nothing here asserts real audio.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      ${SHIM_SRC}
      try { localStorage.setItem('mt:learnEnabled', 'true'); } catch (_) {}
      // §9.4 — a configured transcription engine, so the speak capability gate is
      // open in both hosts (the engine itself is mocked at the fetch layer below).
      try {
        localStorage.setItem('mt:sttEngine', JSON.stringify('local'));
        localStorage.setItem('mt:sttBaseUrl', JSON.stringify('https://stt.example'));
      } catch (_) {}
      (() => {
        // Mic + recorder stubs: tier behavior is what's under test, never real audio.
        try {
          Object.defineProperty(navigator, 'mediaDevices', {
            value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
            configurable: true,
          });
        } catch (_) {}
        class FakeRecorder {
          static isTypeSupported() { return true; }
          constructor() { this.state = 'recording'; this.ondataavailable = null; this.onstop = null; }
          start() {}
          stop() {
            this.state = 'inactive';
            setTimeout(() => {
              this.ondataavailable && this.ondataavailable({ data: new Blob(['x'], { type: 'audio/mp4' }) });
              this.onstop && this.onstop();
            }, 0);
          }
        }
        window.MediaRecorder = FakeRecorder;
        const voices = [{ name: 'TestVoice', lang: 'en-US', voiceURI: 'TestVoice|en-US', default: true, localService: true }];
        // defineProperty, NOT assignment: window.speechSynthesis is a readonly
        // accessor, so a plain assignment of the mock fails SILENTLY and the
        // real engine leaks through — real system voices in getVoices(), and
        // speak() dying with gesture-policy 'not-allowed' (measured 2026-08-17).
        // The suite ran that way for weeks and passed only because nothing
        // awaited a successful playback; the driving session (§9.5) chains on
        // the done promise, which made the leak visible.
        Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
          getVoices: () => voices,
          addEventListener: () => {},
          cancel: () => {},
          // 'start' then 'end': speak()'s ok gate waits for start, and its done
          // promise resolves on end — a mock that never ends would wedge the
          // whole hands-free loop.
          speak: (u) => { setTimeout(() => u.dispatchEvent ? u.dispatchEvent(new Event('start')) : (u.onstart && u.onstart()), 0);
            setTimeout(() => u.dispatchEvent ? u.dispatchEvent(new Event('end')) : (u.onend && u.onend()), 30);
            try { const ev = new Event('start'); (u._l && u._l.forEach((f) => f(ev))); } catch (_) {} },
        } });
        class U extends EventTarget { constructor(text) { super(); this.text = text; } }
        window.SpeechSynthesisUtterance = U;
        // fetch mock for the notes engine only — everything else passes through.
        const realFetch = window.fetch.bind(window);
        window.fetch = (u2, init) => {
          // §9.4 mock transcription: echo the on-screen sentence, so speakScore
          // is 100% and the grade gate's "perfect read disables 不记得" is testable.
          // The driving steps (§9.5) steer it via __mtSttText — a string, or a
          // function returning one; undefined keeps the review-card echo.
          if (String(u2).includes('/v1/audio/transcriptions')) {
            return Promise.resolve({ ok: true, status: 200,
              text: async () => JSON.stringify({ text:
                typeof window.__mtSttText === 'function' ? window.__mtSttText()
                : window.__mtSttText !== undefined ? window.__mtSttText
                : document.getElementById('orig').textContent }) });
          }
          if (String(u2).includes('/v1/chat/completions')) {
            (window.__mtChatBodies = window.__mtChatBodies || []).push(init && init.body);
            return Promise.resolve({ ok: true, status: 200, json: async () => ({
              choices: [{ message: { content: JSON.stringify({
                words: [{ w: 'durable', g: '持久的' }], phrases: [{ p: 'spaced repetition', g: '间隔重复' }],
                grammar: '一般现在时表普遍真理。' }) } }] }) });
          }
          return realFetch(u2, init);
        };
        ${SWEEP_FN}
        window.__sweep = __sweep;
      })();` }, sessionId);

    await cdp.send('Page.navigate', { url }, sessionId);
    await new Promise((r) => setTimeout(r, 2000));

    const ev = async (expression) => {
      const r = await cdp.send('Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) {
        throw new Error('页面内异常: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
      }
      return r.result && r.result.value;
    };
    const sweep = async (step, scope) => {
      const bad = await ev(`__sweep(${JSON.stringify(scope || host.scope)})`);
      need(bad.length === 0, `【${step}】表面扫描: ` + bad.join(' | '));
    };
    const click = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}).click(), 'ok')`);
    const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').trim()`);
    const hidden = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      return !el || el.hidden || getComputedStyle(el).display === 'none'; })()`);
    const item = (id) => ev(`LearnStore.allItems().then((a) => JSON.stringify(a.find((i) => i.id === '${id}') || null))`).then(JSON.parse);

    // ─── Seed, then rebuild through the same entry the app uses ──────────────
    const seedInfo = JSON.parse(await ev(SEED));
    console.log('  seed: seeded', JSON.stringify(seedInfo));
    if (host.isApp) await ev(`document.getElementById('review-view').hidden = false; 'ok'`);
    await ev(`LearnReview.start().then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 400));

    // 1 · Deck built from the corpus, counts painted.
    need(!(await hidden('#card')), '种子语料后第一张卡没有出现');
    need((await text('#counts')).length > 0, '计数行是空的');
    await sweep('首卡');

    // The deck orders by due-ness; we don't assume which card is first. Walk up
    // to 10 screens (§5.4 appends a second exercise to cards with a stale second
    // skill, so 5 cards can be more than 5 screens), dispatching per-card
    // assertions by which item is on screen.
    const seen = new Set();
    let sawExtra = false;
    for (let i = 0; i < 10; i++) {
      if (await hidden('#card')) break;
      const orig = await ev(`document.getElementById('orig').textContent.trim()`);
      const writeMode = !(await hidden('#write-prompt'));
      const listenStage = !(await hidden('#reveal-orig'));
      const speakMode = !(await hidden('#speak-box'));
      const pickMode = !(await hidden('#ex-check'));
      const choiceMode = !pickMode && !speakMode && !(await hidden('#ex-options'));
      // §5.4 — the extra-note attribute is set at render time (its parent may still
      // be pre-reveal), so read the attribute, not the computed visibility.
      if (await ev(`!document.getElementById('extra-note').hidden`)) sawExtra = true;
      if (process.env.DEBUG_FLOW) {
        console.log('  [card', i, ']', JSON.stringify(await ev(`(async () => ({
          orig: document.getElementById('orig').textContent.trim().slice(0, 24),
          writePrompt: !document.getElementById('write-prompt').hidden,
          revealOrig: !document.getElementById('reveal-orig').hidden,
          origHidden: document.getElementById('orig').hidden,
          playDisabled: document.getElementById('play').disabled,
          audioNote: document.getElementById('audio-note').textContent,
          avEn: await LearnTTS.available('en'),
          tierListen1: LearnScheduler.tierFor((await LearnStore.allItems()).find((x)=>x.id==='listen1'), { listen: true }),
          tierWrite1: LearnScheduler.tierFor((await LearnStore.allItems()).find((x)=>x.id==='write1'), { listen: true }),
        }))()`)));
      }

      if (writeMode) {
        seen.add('write1');
        // 2 · Write tier: cloze inputs exist, tr shown, grades held back.
        const blanks = await ev(`document.querySelectorAll('#cloze input').length`);
        need(blanks > 0, '产出档没有挖空输入框');
        need(!(await hidden('#tr')) || (await text('#answer')).length > 0, '产出档没先给译文');
        need(await hidden('#grades'), '产出档在检查前就放出了评分按钮');
        await sweep('产出档');
        // Correct answers are recoverable: clozeFor is deterministic, so asking it
        // the same question the UI did yields the same blanks.
        const done = await ev(`(async () => {
          const items = await LearnStore.allItems();
          const it = items.find((x) => x.id === 'write1');
          const answers = LearnModel.clozeFor(it.text).parts
            .filter((p) => p.t === 'blank').map((p) => p.answer);
          const inputs = [...document.querySelectorAll('#cloze input')];
          inputs.forEach((inp, i) => { inp.value = answers[i] || ''; });
          document.getElementById('cloze-check').click();
          return 'checked';
        })()`);
        need(done === 'checked', '产出档检查流程没走通');
        await new Promise((r) => setTimeout(r, 150));
        need(!(await hidden('#grades')), '检查后评分按钮没出现');
        const g0disabled = await ev(`document.querySelector('.grade.g0').disabled`);
        need(g0disabled === true, '全对之后「不记得」竟然还能点 —— 客观结果没有约束评分');
        await sweep('产出档·已检查');
        await click('.grade[data-grade="2"]');
      } else if (speakMode) {
        // 3c · 说题卡 (§9.4): record → stop → 「识别中」 → transcript + score →
        // the score constrains the grades. The mock endpoint echoes the sentence,
        // so the score is 100% and 不记得 must be disabled.
        seen.add('speak');
        need(!(await ev(`document.getElementById('orig').hidden`)), '说题卡应显示原句（朗读非回忆）');
        need((await text('#speak-record')).length > 0, '录音按钮无文字');
        await sweep('说题卡');
        await click('#speak-record');                 // start recording (stubbed)
        await new Promise((r) => setTimeout(r, 250));
        need((await text('#speak-record')).length > 0, '录音态按钮无文字');
        await click('#speak-record');                 // stop → transcribe (mocked)
        await new Promise((r) => setTimeout(r, 600));
        need(!(await hidden('#speak-transcript')), '转写文本没有渲染');
        need((await text('#speak-score')).length > 0, '匹配度没有渲染');
        need(await ev(`document.querySelector('.grade.g0').disabled`) === true,
          '完美朗读后「不记得」竟然还能点 —— 客观结果没有约束评分');
        await sweep('说题卡·已评分');
        await click('.grade[data-grade="2"]');
      } else if (pickMode) {
        // 3a · 盲听选词 (§9.3): original hidden until 确认, options are real
        // buttons, exact-set correctness constrains the grades.
        seen.add('pick');
        need(await ev(`document.getElementById('orig').hidden`), '盲听选词把原文露出来了');
        const nOpts = await ev(`document.querySelectorAll('#ex-options button').length`);
        need(nOpts >= 3, '选词题选项只有 ' + nOpts + ' 个');
        await sweep('盲听选词');
        // Identify the on-screen card by which item's text matches the most
        // options, select exactly its words, confirm.
        const pickedId = await ev(`(async () => {
          const btns = [...document.querySelectorAll('#ex-options button')];
          const items = await LearnStore.allItems();
          let best = null, bestN = -1;
          for (const it of items) {
            const low = it.text.toLowerCase();
            const n = btns.filter((b) => low.includes(b.textContent.toLowerCase())).length;
            if (n > bestN) { bestN = n; best = it; }
          }
          for (const b of btns) {
            if (best.text.toLowerCase().includes(b.textContent.toLowerCase())) b.click();
          }
          document.getElementById('ex-check').click();
          return best.id;
        })()`);
        await new Promise((r) => setTimeout(r, 150));
        need(!(await hidden('#orig')), '确认后原文没出现');
        need(await ev(`document.querySelector('.grade.g0').disabled`) === true,
          '选词全对后「不记得」竟然还能点 —— 客观结果没有约束评分');
        await sweep('盲听选词·已确认');
        if (pickedId === 'listen1') seen.add('listen1');
        await click('.grade[data-grade="2"]');
      } else if (choiceMode) {
        // 3b · 译文选择题 / 理解题 (§9.3): the tap is the reveal; correct pick
        // disables 「不记得」.
        seen.add('mcq');
        const nOpts = await ev(`document.querySelectorAll('#ex-options button').length`);
        need(nOpts >= 2, '选择题选项只有 ' + nOpts + ' 个');
        need((await text('#ex-prompt')).length > 0, '选择题没有题干');
        await sweep('译文选择题');
        const pickedId = await ev(`(async () => {
          const t = document.getElementById('orig').textContent.trim();
          const items = await LearnStore.allItems();
          const it = items.find((i) => t.startsWith(i.text.slice(0, 12)));
          const btns = [...document.querySelectorAll('#ex-options button')];
          const right = btns.find((b) => b.textContent === it.tr);
          (right || btns[0]).click();
          return it.id;
        })()`);
        await new Promise((r) => setTimeout(r, 150));
        need(!(await hidden('#answer')), '选择后答案面没出现');
        need(await ev(`document.querySelector('.grade.g0').disabled`) === true,
          '选对之后「不记得」竟然还能点 —— 客观结果没有约束评分');
        await sweep('选择题·已选');
        if (pickedId === 'read1') seen.add('read1');
        if (pickedId === 'und1') seen.add('und1');
        await click('.grade[data-grade="2"]');
      } else if (listenStage) {
        seen.add('listen1');
        // 3 · Listen tier: original hidden first, its reveal labeled, play labeled.
        need((await text('#reveal-orig')).length > 0, '听懂档「显示原文」无文字');
        need((await text('#play')).length > 0, '听懂档播放按钮无文字');
        await sweep('听懂档');
        await click('#reveal-orig');
        need(!(await hidden('#orig')), '点了显示原文，原文没出现');
        await click('#reveal');
        await new Promise((r) => setTimeout(r, 100));
        await sweep('听懂档·答案面');
        await click('.grade[data-grade="2"]');
      } else {
        // read tier or the und card — tell them apart by the on-screen text.
        const isUnd = orig.startsWith('Unknown language');
        seen.add(isUnd ? 'und1' : (orig.startsWith('The forgetting') ? 'read1' : 'candX'));
        if (isUnd) {
          // 4 · The und card: play disabled, message points at OUR settings.
          const note = await text('#audio-note');
          need(/设置|语音/.test(note), 'und 卡的提示没有指路到语音设置: 「' + note + '」');
          need(await ev(`document.getElementById('play').disabled`), 'und 卡无所选语音时播放按钮应禁用');
        } else {
          need((await text('#play')).length > 0, '认读卡播放按钮无文字');
        }
        need((await text('#reveal')).length > 0, '「显示译文」无文字');
        await sweep('认读面');
        await click('#reveal');
        await new Promise((r) => setTimeout(r, 100));
        need(!(await hidden('#answer')), '点了显示译文答案没出现');
        const when = await ev(`[...document.querySelectorAll('.grade .when')].map((x) => x.textContent.trim())`);
        need(when.some((w) => w.length > 0), '评分按钮没有标注后果间隔');
        await sweep('认读·答案面');
        await click('.grade[data-grade="2"]');
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    need(seen.has('write1'), '产出档卡从未出现');
    need(seen.has('listen1'), '听懂档卡从未出现');
    need(seen.has('und1'), 'und 卡从未出现');
    need(seen.has('mcq'), '译文选择题从未出现（种子已把 read1 的 reps 钉在 mcq 上）');
    need(seen.has('pick'), '盲听选词从未出现（种子已把 listen1 的 reps 钉在 listen-pick 上）');
    need(seen.has('speak'), '说题卡从未出现（speak1 已种子化且转写引擎已配置）');
    const spoke = await ev(`LearnStore.allReviews().then((rs) => rs.some((r) => r.mode === 'speak'))`);
    need(spoke === true, '复习行里没有 mode:speak');

    // 5 · Grading wrote the schedule and stamped the skill — the DB is the truth.
    // §5.4: stamps are TIMESTAMPS now (legacy 1 = ancient); a pass must write a
    // real clock value, or the freshness window can never open.
    const read1 = await item('read1');
    need(read1 && read1.sched.s > 1.5, '评「记得」后强度没有上升（' + (read1 && read1.sched.s) + '）');
    need(read1 && read1.skills && read1.skills.read > 1e12,
      '认读通过没盖「读」技能时间戳（got ' + (read1 && read1.skills && read1.skills.read) + '）');
    const listen1 = await item('listen1');
    need(listen1 && listen1.skills && listen1.skills.listen > 1e12,
      '听懂通过没盖「听」技能时间戳');

    // 5.5 · §5.4 — the rotation appended a second exercise for a stale second
    // skill; its rows carry extra:1 + mode and never practice; and a PASSED extra
    // advanced no schedule — exactly one applyReview per due card, so listen1's
    // reps moved 6 → 7 even though its card produced two graded screens.
    need(sawExtra, '第二题（extra-note）从未出现 —— 轮换没有为过期技能追加练习');
    const extras = await ev(`LearnStore.allReviews().then((rs) => JSON.stringify(rs.filter((r) => r.extra)))`).then(JSON.parse);
    need(extras.length >= 1 && extras.every((r) => r.mode && !r.practice),
      'extra 复习行缺 mode 或误标 practice: ' + JSON.stringify(extras));
    need(listen1 && listen1.sched.reps === seedInfo.listenReps + 1,
      '第二题推进了排程（listen1 reps ' + (listen1 && listen1.sched && listen1.sched.reps)
      + ' ≠ ' + (seedInfo.listenReps + 1) + '）');
    need(listen1 && listen1.skills && listen1.skills.read > 1e12,
      '第二题（读）通过没刷新「读」的技能时间戳');

    // 6 · Deck done → practice offered; the dead end is gone.
    need(!(await hidden('#practice-setup')) || !(await hidden('#nothing-due')), '牌组结束后既无完成页也无练习入口');
    await sweep('做完态');

    // 7 · Free practice: fails count, passes don't accelerate (§5.3) — from the DB.
    await ev(`(document.getElementById('practice-pool').value = 'all', document.getElementById('practice-start').click(), 'ok')`);
    await new Promise((r) => setTimeout(r, 300));
    need(!(await hidden('#card')), '练习没有发出第一张卡');
    await sweep('练习首卡');
    // First practice card: FAIL it, snapshotting sched before.
    const firstId = await ev(`(async () => {
      const t = document.getElementById('orig').textContent.trim();
      const items = await LearnStore.allItems();
      const hit = items.find((i) => t.startsWith(i.text.slice(0, 12)));
      return hit ? hit.id : '';
    })()`);
    // §9.3 — a choice/pick exercise may be on screen in practice too; answer it
    // aiming right or wrong so the gated grade we need stays clickable.
    const answerExercise = async (id, wantCorrect) => {
      if (!(await hidden('#ex-check'))) {
        await ev(`(async () => {
          const it = (await LearnStore.allItems()).find((x) => x.id === '${id}');
          const low = it.text.toLowerCase();
          const btns = [...document.querySelectorAll('#ex-options button')];
          if (${wantCorrect}) {
            for (const b of btns) if (low.includes(b.textContent.toLowerCase())) b.click();
          } else {
            const foil = btns.find((b) => !low.includes(b.textContent.toLowerCase()));
            (foil || btns[0]).click();
          }
          document.getElementById('ex-check').click();
          return 'ok';
        })()`);
        await new Promise((r) => setTimeout(r, 150));
        return true;
      }
      if (!(await hidden('#ex-options'))) {
        await ev(`(async () => {
          const it = (await LearnStore.allItems()).find((x) => x.id === '${id}');
          const btns = [...document.querySelectorAll('#ex-options button')];
          const right = btns.find((b) => b.textContent === it.tr);
          const wrong = btns.find((b) => b.textContent !== it.tr);
          ((${wantCorrect} ? right : wrong) || btns[0]).click();
          return 'ok';
        })()`);
        await new Promise((r) => setTimeout(r, 150));
        return true;
      }
      return false;
    };

    const before = await item(firstId);
    const answeredWrong = await answerExercise(firstId, false);
    if (!answeredWrong && !(await hidden('#reveal-orig'))) await click('#reveal-orig');
    if (!answeredWrong && !(await hidden('#reveal'))) await click('#reveal');
    // Write-tier practice cards need the check first; take the cheap path if so.
    if (!(await hidden('#cloze-check'))) {
      await ev(`(async () => {
        const items = await LearnStore.allItems();
        const it = items.find((x) => x.id === '${firstId}');
        const cz = LearnModel.clozeFor(it.text);
        [...document.querySelectorAll('#cloze input')].forEach((inp, i) => { inp.value = ''; });
        document.getElementById('cloze-check').click();
        return 'ok';
      })()`);
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 100));
    await click('.grade[data-grade="0"]');
    await new Promise((r) => setTimeout(r, 250));
    const failed = await item(firstId);
    if (before && before.sched) {
      need(failed.sched.s < before.sched.s || failed.sched.dueAt < before.sched.dueAt,
        '练习答错没有打回（s ' + before.sched.s + '→' + failed.sched.s + '）');
    } else {
      need(!failed.sched, '候选卡在练习里被建了排程 —— 引入必须只走每日牌组');
    }
    // Second practice card: PASS it; sched must not move.
    if (!(await hidden('#card'))) {
      const secondId = await ev(`(async () => {
        const t = document.getElementById('orig').textContent.trim();
        const items = await LearnStore.allItems();
        const hit = items.find((i) => t.startsWith(i.text.slice(0, 12)));
        return hit ? hit.id : '';
      })()`);
      const b2 = await item(secondId);
      const answeredRight = await answerExercise(secondId, true);
      if (!answeredRight && !(await hidden('#reveal-orig'))) await click('#reveal-orig');
      if (!(await hidden('#cloze-check'))) {
        await ev(`(async () => {
          const items = await LearnStore.allItems();
          const it = items.find((x) => x.id === '${secondId}');
          const answers = LearnModel.clozeFor(it.text).parts
            .filter((p) => p.t === 'blank').map((p) => p.answer);
          [...document.querySelectorAll('#cloze input')].forEach((inp, i) => { inp.value = answers[i] || ''; });
          document.getElementById('cloze-check').click();
          return 'ok';
        })()`);
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!(await hidden('#reveal'))) await click('#reveal');
      await new Promise((r) => setTimeout(r, 100));
      await click('.grade[data-grade="2"]');
      await new Promise((r) => setTimeout(r, 250));
      const after2 = await item(secondId);
      if (b2 && b2.sched) {
        need(after2.sched.s === b2.sched.s && after2.sched.dueAt === b2.sched.dueAt,
          '练习答对改动了排程（§5.3 的不对称规则被破坏）');
      }
    }
    // Practice reviews carry their circumstances.
    const pr = await ev(`LearnStore.allReviews().then((rs) => JSON.stringify(rs.filter((r) => r.practice)))`).then(JSON.parse);
    need(pr.length >= 1 && pr.every((r) => r.mode), '练习复习记录缺 practice/mode 标记');

    // 8 · Notes gate opens live and renders from the (mocked) engine, cached.
    await ev(`(async () => {
      LearnNotes.configure({ provider: 'openai', apiKey: 'k-test', baseUrl: '', model: '' });
      return 'ok';
    })()`);
    await ev(`LearnReview.start().then(() => 'ok')`);
    await new Promise((r) => setTimeout(r, 300));
    if (!(await hidden('#card'))) {
      if (!(await hidden('#reveal-orig'))) await click('#reveal-orig');
      if (!(await hidden('#cloze-check'))) { /* skip write card for notes check */ }
      if (!(await hidden('#reveal'))) await click('#reveal');
      await new Promise((r) => setTimeout(r, 100));
      if (!(await hidden('#notes-wrap'))) {
        need((await text('#notes-btn')).length > 0, '解析按钮无文字');
        await click('#notes-btn');
        await new Promise((r) => setTimeout(r, 300));
        need((await text('#notes-box')).includes('durable'), '解析结果没有渲染出生词');
        const cached = await ev(`LearnStore.getNote ? LearnStore.getNote((await (async()=>{const t=document.getElementById('orig').textContent.trim();const i=(await LearnStore.allItems()).find((x)=>t.startsWith(x.text.slice(0,12)));return i&&i.id;})())).then((n)=>!!n) : false`);
        need(cached === true, '解析结果没有落缓存');
      }
    }

    // 9 · App-only: settings surface sweep (labels painted, pickers fed). The
    // extension's options page is a different document, covered by test:app's
    // sibling checks and the layout suite — not re-hosted here.
    if (host.isApp) {
      await ev(`(document.getElementById('review-view').hidden = true,
                document.getElementById('app-settings').hidden = false,
                AppSettings.paintStatic(), 'ok')`);
      await ev(`AppSettings.paint(null, () => {}).then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 200));
      await sweep('设置页', '#app-settings');
      need((await ev(`document.getElementById('tts-voice').options.length`)) >= 2,
        '语音选择器没有装入 mock 的系统语音');

      // ─── 10 · 驾车模式（§9.5，App 专属）────────────────────────────────────
      // Shrink the fixed recording windows so a whole session fits a test run,
      // and pin the ui language to the mock voice's language — the spoken
      // prompts are uiLang text, and the machine's locale must not decide the
      // suite's outcome.
      await ev(`(LearnDriving.DEFAULTS.SPEAK_REC_MS = 200, LearnDriving.DEFAULTS.REPLY_REC_MS = 150, 'ok')`);
      await ev(`(localStorage.setItem('mt:uiLang', JSON.stringify('en')), 'ok')`);
      const driveWait = async (ms) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
          if (!(await ev(`document.getElementById('app-drive-more').hidden`))) return true;
          await new Promise((r) => setTimeout(r, 300));
        }
        return false;
      };

      // 10 · Entry gating: exists with a usable voice, DOES NOT EXIST without one.
      await ev(`AppDriving.refreshEntry().then(() => 'ok')`);
      need((await ev(`document.getElementById('app-drive-start').hidden`)) === false,
        '驾车入口没有出现（mock 语音在，uiLang 可读）');
      await ev(`(() => { const e = (window.MT_TTS_ENGINES || []).find((x) => x.id !== 'browser');
        localStorage.setItem('mt:ttsEngine', JSON.stringify(e ? e.id : 'no-such-engine')); return 'ok'; })()`);
      await ev(`AppDriving.refreshEntry().then(() => 'ok')`);
      need((await ev(`document.getElementById('app-drive-start').hidden`)) === true,
        'TTS 不可用时驾车入口应不存在（门控而非禁用）');
      await ev(`(localStorage.setItem('mt:ttsEngine', JSON.stringify('browser')), 'ok')`);
      await ev(`AppDriving.refreshEntry().then(() => 'ok')`);

      // The main walk graded every card into the future — make the corpus DUE
      // again so the driving deck has material (the driving mode never fabricates
      // due-ness on its own; the reviewer wouldn't either).
      await ev(`(async () => {
        const items = await LearnStore.allItems();
        const day = 86400e3;
        for (const it of items) {
          if (!it.sched || !it.sched.s) continue;
          it.sched.lastReviewAt = Date.now() - Math.max(2 * it.sched.s, 1) * day;
          it.sched.dueAt = it.sched.lastReviewAt;
          await LearnStore.putItem(it);
        }
        return 'ok';
      })()`);

      // Instrument: record every spoken text + every LearnTTS.stop call.
      await ev(`(() => {
        window.__spoken = []; window.__stops = 0;
        const s = LearnTTS.speak.bind(LearnTTS), st = LearnTTS.stop.bind(LearnTTS);
        LearnTTS.speak = (text, lang) => { window.__spoken.push(text); return s(text, lang); };
        LearnTTS.stop = () => { window.__stops++; return st(); };
        return 'ok';
      })()`);
      await ev(`(document.getElementById('app-settings').hidden = true,
                document.getElementById('app-drive').hidden = false, 'ok')`);

      // 10a/10b · Session A — silence everywhere: the listen-read chain runs in
      // order, silence skips every 跟读 (no attempt ≠ failed attempt), and the
      // WHOLE listen-only session writes NOTHING (the load-bearing negative).
      // No notes engine is in storage yet, so the voice loop is naturally closed.
      const rowsBefore = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      const speakBefore = await item('speak1');
      await ev(`(window.__mtSttText = '', 'ok')`);
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 500));
      if (process.env.DEBUG_FLOW) {
        console.log('  [drive A]', JSON.stringify(await ev(`AppDriving._debug()`)));
      }
      await sweep('驾车·会话中', '#app-drive');
      need(await driveWait(40000), '驾车会话 A（全静默）没有在 40s 内走完 '
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      const spoken = await ev(`JSON.stringify(window.__spoken)`).then(JSON.parse);
      const firstCard = await ev(`(async () => {
        const items = await LearnStore.allItems();
        const hit = items.find((i) => i.text === window.__spoken[0]);
        return hit ? JSON.stringify({ text: hit.text, tr: hit.tr }) : 'null';
      })()`).then(JSON.parse);
      need(firstCard !== null, '第一段朗读不是任何卡的原文: ' + JSON.stringify(spoken[0]));
      need(firstCard && spoken[1] === firstCard.tr, '原文之后没有紧跟译文（' + JSON.stringify(spoken.slice(0, 3)) + '）');
      const rowsAfterA = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      need(rowsAfterA === rowsBefore, '纯听会话写了 ' + (rowsAfterA - rowsBefore) + ' 条复习行 —— 听不是证据，必须零写入');
      const speakAfterA = await item('speak1');
      need(JSON.stringify(speakAfterA.sched) === JSON.stringify(speakBefore.sched),
        '纯听会话动了 speak1 的排程');
      await sweep('驾车·做完态', '#app-drive');

      // 10c · Session B — perfect shadowing (voice loop still closed): due
      // speak-eligible cards auto-grade through the REVIEW path.
      await ev(`(window.__mtSttText = () => document.getElementById('app-drive-text').textContent, 'ok')`);
      await ev(`AppDriving.start().then(() => 'ok')`);
      need(await driveWait(40000), '驾车会话 B（完美跟读）没有在 40s 内走完 '
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      const speakAfterB = await item('speak1');
      need(speakAfterB.sched.reps === speakBefore.sched.reps + 1,
        '到期卡跟读没有走正式复习（speak1 reps ' + speakBefore.sched.reps + '→' + speakAfterB.sched.reps + '）');
      need(speakAfterB.sched.s > speakBefore.sched.s, '完美跟读后 s 没有上升');
      need(speakAfterB.skills && speakAfterB.skills.speak > 1e12, '跟读通过没盖「说」技能时间戳');
      const rowsAfterB = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      need(rowsAfterB > rowsAfterA, '完美跟读会话没有留下任何复习行');
      const driveRows = await ev(`LearnStore.allReviews().then((rs) =>
        JSON.stringify(rs.slice(${rowsAfterA}).filter((r) => r.mode === 'speak' && !r.practice)))`).then(JSON.parse);
      need(driveRows.length >= 1 && driveRows.every((r) => typeof r.grade === 'number'),
        '驾车跟读没有留下 mode:speak 复习行: ' + JSON.stringify(driveRows));

      // 10c(续) · Practice round — the deck is spent (nothing due), so 继续练习
      // draws the practice pool: a perfect 跟读 there writes a {practice:1,
      // mode:'speak'} row and moves NO schedule (§5.3's asymmetry, driving flavor).
      const schedAfterB = JSON.stringify(speakAfterB.sched);
      await click('#app-drive-more');
      await new Promise((r) => setTimeout(r, 500));
      need(await driveWait(40000), '驾车练习轮没有在 40s 内走完 '
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      const practiceRows = await ev(`LearnStore.allReviews().then((rs) =>
        JSON.stringify(rs.slice(${rowsAfterA}).filter((r) => r.practice && r.mode === 'speak')))`).then(JSON.parse);
      need(practiceRows.length >= 1, '驾车练习轮没有留下 practice+mode:speak 行');
      need(JSON.stringify((await item('speak1')).sched) === schedAfterB,
        '驾车练习轮的通过动了排程（§5.3 不对称被破坏）');
      const rowsAfterPractice = await ev(`LearnStore.allReviews().then((r) => r.length)`);

      // 10d · Session C — the voice Q&A loop: a chat engine lands in STORAGE
      // (AppDriving reconfigures from settings at session start, so an in-memory
      // configure would be wiped), exercises are tiered out so every recording
      // window is a reply window, and the reply sequence is deterministic: first
      // a real question, then 「没有」 forever.
      await ev(`(localStorage.setItem('mt:provider', JSON.stringify('openai')),
                localStorage.setItem('mt:apiKey', JSON.stringify('k-test')), 'ok')`);
      await ev(`(() => { window.__mtTier = LearnScheduler.DEFAULTS.TIER_SPEAK_S;
        LearnScheduler.DEFAULTS.TIER_SPEAK_S = 99999; return 'ok'; })()`);
      await ev(`(() => { let n = 0;
        window.__mtSttText = () => (++n === 1 ? 'why is this past tense here' : '没有');
        window.__mtChatBodies = []; return 'ok'; })()`);
      await ev(`AppDriving.start().then(() => 'ok')`);
      if (process.env.DEBUG_FLOW) {
        console.log('  [drive C]', JSON.stringify(await ev(`AppDriving._debug()`)));
      }
      need(await driveWait(40000), '驾车会话 C（语音问答）没有在 40s 内走完 '
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      const chatBodies = await ev(`JSON.stringify(window.__mtChatBodies || [])`).then(JSON.parse);
      need(chatBodies.length >= 1, '语音提问没有到达问答引擎');
      need(chatBodies.some((b) => /past tense/.test(b) && /Sentence/.test(b)),
        '问答请求缺问题或缺卡上下文: ' + String(chatBodies[0]).slice(0, 160));
      const spokeAnswer = await ev(`window.__spoken.some((s) => s.includes('durable'))`);
      need(spokeAnswer === true, '答案没有被朗读出来');
      need((await ev(`LearnStore.allReviews().then((r) => r.length)`)) === rowsAfterPractice,
        '问答会话写了复习行 —— 听和问都不是证据');
      await ev(`(() => { LearnScheduler.DEFAULTS.TIER_SPEAK_S = window.__mtTier; return 'ok'; })()`);

      // 10e · Pause: TTS stops, and NOTHING is written after the pause.
      await ev(`(window.__mtSttText = '', 'ok')`);
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 300));
      const stopsBefore = await ev(`window.__stops`);
      const rowsBeforePause = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      await click('#app-drive-pause');
      need((await ev(`window.__stops`)) > stopsBefore, '暂停没有调用 LearnTTS.stop');
      need((await text('#app-drive-pause')).length > 0, '暂停后按钮无文字（应转为「继续」）');
      await sweep('驾车·暂停态', '#app-drive');
      await new Promise((r) => setTimeout(r, 700));
      need((await ev(`LearnStore.allReviews().then((r) => r.length)`)) === rowsBeforePause,
        '暂停之后仍有写入');
      await ev(`(AppDriving.stop(), document.getElementById('app-drive').hidden = true, 'ok')`);
    }

    need(problems.length === 0, '控制台异常: ' + problems.join(' | '));
  } catch (e) { ok = false; console.log('  ✗ ' + (e && e.stack)); }
  chrome.cleanup(); srv.close();
  console.log(ok
    ? '  ✓ ' + host.name + '：全部通过'
    : '  ✗ ' + host.name + '：' + failures.length + ' 项问题');
  return ok;
}

(async () => {
  for (const f of ['Main.html', 'Script.js', 'Style.css']) {
    if (!fs.existsSync(path.join(SRC, f))) {
      console.error('✗ dist-app/' + f + ' 不存在 —— 先跑 node build.js'); process.exit(1);
    }
  }
  if (!fs.existsSync(path.join(DIST, 'learn/review.html'))) {
    console.error('✗ dist/learn/review.html 不存在 —— 先跑 node build.js'); process.exit(1);
  }
  let all = true;
  for (const host of HOSTS) all = (await runHost(host)) && all;
  console.log(all
    ? '\n✓ 学习套件全流程回归（双宿主）：三档 + und + 练习不对称 + 解析 + 表面扫描 全部通过'
    : '\n✗ 学习套件回归发现问题');
  process.exit(all ? 0 : 1);
})();
