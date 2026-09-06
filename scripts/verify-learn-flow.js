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
// 2026-09-06 起来自 scripts/lib/sweep.js：判据是 WCAG 比值（不再是「前景 ≠ 背景」的
// 字符串相等），而且每次 sweep 都在深色 + 浅色下各扫一遍。原来这里那份只判相等、只跑
// 浅色，于是深色底上 1.9:1 的默认链接蓝一路绿着上了商店。
const { SWEEP_FN, installSweep, sweepBoth } = require('./lib/sweep.js');

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
      // §9.4 —— 语音与转写**都要显式配置**，两个能力门才是开的。
      //
      // TTS 这一段是 2026-09-04 补的：在那之前它靠的是「默认引擎 = browser」这个
      // 隐式默认，而那天默认改成了「未配置」（语音是核心体验，系统自带撑不起它）。
      // 夹具跟着显式化是**对的方向** —— 一个依赖隐式默认的测试，在默认变了的那天
      // 会以「功能坏了」的样子报出来，而实际坏的是它自己的前提。
      // 下面 mock 了 speechSynthesis 的音色，所以这里选 browser 才对得上。
      try {
        localStorage.setItem('mt:ttsEngine', JSON.stringify('browser'));
        localStorage.setItem('mt:ttsMode', JSON.stringify('assist'));
      } catch (_) {}
      // 转写引擎（引擎本身在下面的 fetch 层被 mock）。
      try {
        localStorage.setItem('mt:sttEngine', JSON.stringify('local'));
        // 完整接口地址（含路径）。以前这里存的是 base，靠注册表补出 /v1/audio/transcriptions
        // —— 那个拼接已经删掉了（零拼接无条件），所以夹具必须存用户真正会填的东西。
        localStorage.setItem('mt:sttBaseUrl', JSON.stringify('https://stt.example/v1/audio/transcriptions'));
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
        // §9.5 出发前预载 runs on an ENDPOINT speech engine (the on-device voice caches
        // nothing by construction), and that path plays through an Audio element fed a
        // data: URL. Headless Chrome refuses autoplay without a gesture, so a real clip
        // would come back blocked and stop the session — the platform, not the feature.
        // Stub the sink the way speechSynthesis is stubbed above: resolve, then end. What
        // this suite measures is which requests go out, not whether Chrome makes sound.
        window.Audio = class extends EventTarget {
          constructor(src) { super(); this.src = src; window.__mtAudioSrcs =
            (window.__mtAudioSrcs || 0) + 1; }
          play() { setTimeout(() => this.dispatchEvent(new Event('ended')), 20); return Promise.resolve(); }
          pause() {}
        };
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
          // §9.5 出发前预载 needs an engine that actually returns BYTES — the
          // on-device voice caches nothing by construction, so with that engine alone
          // the whole audio half of the preload would be untestable.
          if (String(u2).includes('/v1/audio/speech')) {
            window.__mtSpeechCount = (window.__mtSpeechCount || 0) + 1;
            return Promise.resolve({ ok: true, status: 200,
              headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
              arrayBuffer: async () => new Uint8Array([73, 68, 51, 4, 0, 0]).buffer });
          }
          if (String(u2).includes('/v1/chat/completions')) {
            const body = init && init.body;
            (window.__mtChatBodies = window.__mtChatBodies || []).push(body);
            // §9.5 补译文 rides the SAME endpoint as the notes engine, so the mock has
            // to tell them apart or a translation comes back as a notes JSON blob.
            // The system prompts are the discriminator (notes.js buildPrompt vs
            // translation-api.js buildSystemPrompt) — matching on those is matching on
            // what the two features actually send.
            const isTranslate = String(body).indexOf('professional translator') >= 0;
            if (isTranslate) {
              (window.__mtTranslateCount = (window.__mtTranslateCount || 0) + 1);
              // Both json() and text(): the notes transport reads the parsed body,
              // TranslationAPI reads the raw text. A mock that only answers one of them
              // fails as "resp.text is not a function" — a mock bug wearing the costume
              // of a product bug.
              const payload = { choices: [{ message: { content: '【译】mock translation' } }] };
              return Promise.resolve({ ok: true, status: 200,
                headers: { get: () => null },
                json: async () => payload, text: async () => JSON.stringify(payload) });
            }
            // The notes gate re-checks that every vocabulary word appears VERBATIM in
            // the sentence (§9.2's anti-hallucination check), so a fixed word makes the
            // mock fail on every card whose text does not happen to contain it. Lift a
            // real word out of the request instead: the preload steps need notes to
            // SUCCEED for the whole deck, or playback re-requests them and the
            // "zero network" assertion measures the mock, not the feature.
            const said = JSON.parse(body || '{}');
            const last = ((said.messages || []).slice(-1)[0] || {}).content || '';
            // Only the "Sentence (xx): …" line. Matching the whole message picks up the
            // literal word "Translation" from the line below it — not in the sentence,
            // so the gate rejects the answer and every card comes back bad_output.
            const sent = (String(last).match(/Sentence[^:]*:([^\\n]*)/) || [, ''])[1];
            const w = (String(sent).match(/[A-Za-z][A-Za-z'-]{3,}/g) || ['durable']).pop();
            // 'durable' stays alongside it so the older steps that look for that marker
            // keep working: the gate needs ONE verbatim hit, and tolerates strays.
            const notesPayload = { choices: [{ message: { content: JSON.stringify({
              words: [{ w, g: '持久的' }, { w: 'durable', g: '持久的' }],
              phrases: [], grammar: '一般现在时表普遍真理。' }) } }] };
            return Promise.resolve({ ok: true, status: 200,
              headers: { get: () => null },
              json: async () => notesPayload, text: async () => JSON.stringify(notesPayload) });
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
      const bad = await sweepBoth(cdp, sessionId, scope || host.scope);
      need(bad.length === 0, `【${step}】表面扫描: ` + bad.slice(0, 8).join(' | ')
        + (bad.length > 8 ? ` …共 ${bad.length} 处` : ''));
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

      // ─── 10 · 播客模式（§9.5，App 专属）────────────────────────────────────
      // 这个模式是**播放器**：一张卡播完自动进下一张，全程没有等用户的环节，而且
      // **什么都不写**。所以这一节最要紧的断言是反向的——整场跑完，复习行数与排程
      // 一个字节都不能变。
      //
      // 走查用「顺序播放」：默认是随机，而随机永不结束（绕圈重洗），没有可等的终点。
      await ev(`(localStorage.setItem('mt:uiLang', JSON.stringify('en')),
                localStorage.setItem('mt:drivePlaybackMode', JSON.stringify('sequential')),
                // 解析默认是**开**的（2026-08-18）；前几步要的是纯听读，所以显式关掉。
                localStorage.setItem('mt:drivePlayNotes', JSON.stringify(false)), 'ok')`);
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
        '播客入口没有出现（mock 语音在，uiLang 可读）');
      await ev(`(() => { const e = (window.MT_TTS_ENGINES || []).find((x) => x.id !== 'browser');
        localStorage.setItem('mt:ttsEngine', JSON.stringify(e ? e.id : 'no-such-engine')); return 'ok'; })()`);
      await ev(`AppDriving.refreshEntry().then(() => 'ok')`);
      need((await ev(`document.getElementById('app-drive-start').hidden`)) === true,
        'TTS 不可用时播客入口应不存在（门控而非禁用）');
      await ev(`(localStorage.setItem('mt:ttsEngine', JSON.stringify('browser')), 'ok')`);
      await ev(`AppDriving.refreshEntry().then(() => 'ok')`);

      // 让语料重新到期，播客牌库才有料（播客模式自己从不制造到期）。
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

      // ─── 10′ · 设置总线：改了设置，入口与 ▶ 自己刷新（2026-09-06 报障）────────
      // 全程**不调 refreshEntry()、不刷新页面**：只写 chrome.storage（一键配置与设置页
      // 的写法），然后等。修前：review.js 只在启动时读一次设置、垫片没有 onChanged，
      // 配好语音 key 回到首页，入口停在「没配」时的结论，要重启 App。
      const until = async (expr, ms) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { if (await ev(expr)) return true; await new Promise((r) => setTimeout(r, 100)); }
        return false;
      };
      const wset = (obj) => ev(`new Promise((r) => chrome.storage.local.set(${JSON.stringify(obj)}, () => r('ok')))`);
      await ev(`(document.getElementById('review-view').hidden = false, 'ok')`);
      await ev(`LearnReview.start().then(() => 'ok')`);
      need(!(await hidden('#card')), '10′ 前提：语料重新到期后复习视图应有一张卡在屏上');
      await wset({ ttsEngine: '' });
      need(await until(`document.getElementById('app-drive-start').hidden === true`, 1500),
        '清掉语音引擎后 1.5s 内播客入口没有自己消失 —— 设置总线没接到 driving.js');
      need(await until(`document.getElementById('play').disabled === true`, 1500),
        '清掉引擎后复习卡的 ▶ 没有自己禁用 —— review.js 没订阅设置变化');
      await wset({ ttsEngine: 'browser', ttsMode: 'assist' });
      need(await until(`document.getElementById('app-drive-start').hidden === false`, 2500),
        '配回语音引擎后播客入口没有自己回来（修前要重启 App 才出现）');
      // 屏上这张卡可能是 und 卡（种子里有一张）：那时 ▶ 本来就该禁用并说「语言未知」，
      // 这里要的是「门自己重算过」—— 音频块回来了，且要么 ▶ 可用、要么说明是 und。
      need(await until(`!document.getElementById('audio').hidden && (!document.getElementById('play').disabled
        || /und|未知|unknown|不明|알 수 없|inconnue|unbekannt|desconocid|неизвест|غير معروف/i.test(document.getElementById('audio-note').textContent))`, 2500),
        '配回引擎后复习卡的 ▶ 没有自己重算（既没变可用，也没说明是 und 卡）');
      await wset({ ttsMode: 'off' });
      need(await until(`document.getElementById('audio').hidden === true`, 1500),
        '朗读模式关掉后当前卡的音频块没有自己隐藏');
      await wset({ ttsMode: 'assist' });
      need(await until(`!document.getElementById('audio').hidden`, 1500), '朗读模式开回来后音频块没有回来');
      await ev(`(document.getElementById('review-view').hidden = true, 'ok')`);

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

      // 10a · 一整场顺序播放：原文紧跟译文，自动推进到底，且**零写入**。
      const rowsBefore = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      const speakBefore = await item('speak1');
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 500));
      if (process.env.DEBUG_FLOW) {
        console.log('  [drive A]', JSON.stringify(await ev(`AppDriving._debug()`)));
      }
      await sweep('播客·会话中', '#app-drive');
      need(await driveWait(40000), '播客会话没有在 40s 内自动走完 '
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      const spoken = await ev(`JSON.stringify(window.__spoken)`).then(JSON.parse);
      const firstCard = await ev(`(async () => {
        const items = await LearnStore.allItems();
        const hit = items.find((i) => i.text === window.__spoken[0]);
        return hit ? JSON.stringify({ text: hit.text, tr: hit.tr }) : 'null';
      })()`).then(JSON.parse);
      need(firstCard !== null, '第一段朗读不是任何卡的原文: ' + JSON.stringify(spoken[0]));
      // 三遍结构：第一遍只有原句，第二遍才是 原句 → 译句。所以译句在第 3 段。
      need(firstCard && spoken[1] === firstCard.text && spoken[2] === firstCard.tr,
        '三遍结构不对，应为 原句/原句/译句（' + JSON.stringify(spoken.slice(0, 4)) + '）');
      const deckLen = (await ev(`AppDriving._debug()`)).deck;
      // 一张卡三遍（§9.5）：原句读三次、译句一次。段数下限因此是 卡数×4，而不是 ×2。
      need(spoken.length >= deckLen * 4,
        '播放段数少于「每张卡三遍」—— 三遍结构没生效或有卡没播到: ' + spoken.length + ' vs ' + deckLen * 4);
      const firstCardSpokenCount = spoken.filter((x) => x === firstCard.text).length;
      need(firstCardSpokenCount >= 3,
        '第一张卡的原句只被读了 ' + firstCardSpokenCount + ' 次，应当是三次（第一/二/三遍）');
      // 这一条是本模式的核心契约，反向断言，load-bearing。
      const rowsAfterA = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      need(rowsAfterA === rowsBefore,
        '播客模式写了 ' + (rowsAfterA - rowsBefore) + ' 条复习行 —— 它只曝光，永不评分');
      const speakAfterA = await item('speak1');
      need(JSON.stringify(speakAfterA.sched) === JSON.stringify(speakBefore.sched),
        '播客模式动了 speak1 的排程');
      need(!speakAfterA.skills || speakAfterA.skills.speak === (speakBefore.skills || {}).speak,
        '播客模式盖了技能戳 —— 听不是证据');
      await sweep('播客·做完态', '#app-drive');

      // 10b · 播放模式按钮：轮换、落盘、且不打断正在播的音频。
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 400));
      const modeBefore = (await ev(`AppDriving._debug()`)).mode;
      const stopsBeforeMode = await ev(`window.__stops`);
      await click('#app-drive-mode');
      await new Promise((r) => setTimeout(r, 300));
      const modeAfter = (await ev(`AppDriving._debug()`)).mode;
      need(modeAfter !== modeBefore, '模式按钮没换模式（' + modeBefore + '）');
      need((await ev(`window.__stops`)) === stopsBeforeMode,
        '换播放模式打断了正在播的音频 —— 它只该改变这张卡结束之后的事');
      need((await ev(`JSON.parse(localStorage.getItem('mt:drivePlaybackMode'))`)) === modeAfter,
        '播放模式没有落盘');
      need((await text('#app-drive-mode')).length > 0, '模式按钮没有文字');

      // 10c · 随机播放：每张卡恰好一次，不是「每次随机抽一张」。
      await ev(`(localStorage.setItem('mt:drivePlaybackMode', JSON.stringify('shuffle')), 'ok')`);
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 400));
      const dbg = await ev(`AppDriving._debug()`);
      need(dbg.mode === 'shuffle', '没有切到随机播放');
      const sorted = dbg.order.slice().sort((a, b) => a - b);
      need(sorted.length === dbg.deck && sorted.every((v, i) => v === i),
        '随机播放的顺序不是一个排列（有重复或遗漏）: ' + JSON.stringify(dbg.order));

      // 10d · 播放解析：未解析过的卡当场补解析并读出来（§9.2 的一次收费落在这里）。
      await ev(`(localStorage.setItem('mt:drivePlaybackMode', JSON.stringify('sequential')),
                localStorage.setItem('mt:drivePlayNotes', JSON.stringify(true)),
                localStorage.setItem('mt:provider', JSON.stringify('openai')),
                localStorage.setItem('mt:apiKey', JSON.stringify('k-test')), 'ok')`);
      await ev(`(async () => { for (const it of await LearnStore.allItems()) {
        try { await LearnStore.putNote(it.id, null, {}); } catch (_) {}
      } return 'ok'; })()`);
      await ev(`(window.__spoken = [], window.__mtChatBodies = [], 'ok')`);
      // 解析跟读（§9.5）：封面要跟着念到哪一行就换一张，而且**不过桥**。数两件事 ——
      // artworkLocal 被调了几次（逐行），以及过桥的 artwork 被调了几次（卡级）。
      await ev(`(() => {
        window.__artLocal = 0; window.__artLocalSrc = [];
        const orig = NativeAudio.artworkLocal;
        window.__artActive = [];
        NativeAudio.artworkLocal = (u) => {
          window.__artLocal++; window.__artLocalSrc.push(String(u).length);
          window.__artActive.push(AppDriving._debug().notesActive);
          return orig(u);
        };
        window.__artIds = [];
        const origArt = NativeAudio.artwork;
        NativeAudio.artwork = (id, u) => { window.__artIds.push(String(id)); return origArt(id, u); };
        return 'ok';
      })()`);
      const rowsBeforeNotes = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      // 费用提示是「正在发生」的话，只在会话进行中显示。start() 的 promise 落定时
      // 第一张卡已经开播、第一帧已经画过，所以这里查是确定的 —— 而多睡哪怕 500ms，
      // 这个 5 张卡的 mock 会话就已经跑完了（真机上不会，但测试不能赌时序）。
      await ev(`AppDriving.start().then(() => 'ok')`);
      need((await text('#app-drive-cost')).length > 0, '播放解析时没有显示费用提示 · debug='
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      need(await driveWait(60000), '开了播放解析的会话没有在 60s 内走完 '
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      const notesBodies = await ev(`JSON.stringify(window.__mtChatBodies || [])`).then(JSON.parse);
      need(notesBodies.length >= 1, '没解析过的卡没有触发自动解析');

      // ─── 解析跟读的两条判据 ───────────────────────────────────────────────
      // 1. 封面真的逐行换过。解析只有一行时不拆（execSpeak 的 `> 1` 门），所以这里的
      //    下界取 1：这一步的 mock 解析可能只产出一行。
      const artLocal = await ev(`window.__artLocal`);
      need(artLocal >= 1, '解析段一次都没更新封面 —— 歌词式高亮没生效');
      // **解析文本回来之后必须再推一次封面**（从「没有解析」变成「三行压暗铺着」）。
      // 这一次走过桥那条，而它按 id 去重 —— 去重键要是只有卡片 id，这次更新会被静默
      // 吃掉，锁屏上永远没有解析区。2026-08-26 在模拟器上就是这么发现的：连拍八帧，
      // 八帧的封面一模一样。
      // 高亮真的逐行推进过。`_debug()` 里的 notesActive 是权威 —— 连拍截图撞那一帧
      // 是碰运气（一段音频几秒就播完）。这里记录每次 artworkLocal 时的 active 值。
      const seenActive = await ev(`JSON.stringify(window.__artActive || [])`).then(JSON.parse);
      need(seenActive.length >= 1, '没有记录到任何高亮行');
      const artIds = await ev(`JSON.stringify((window.__artIds || []))`).then(JSON.parse);
      need(artIds.some((x) => /:n$/.test(x)),
        '解析铺上之后没有再推一次封面 —— 去重键把它吃掉了：' + JSON.stringify(artIds));
      // 2. **逐行那几次不过桥。** 这是整个设计成立的前提：一张 1024² PNG ≈123 KB，
      //    跟着每一行过桥就是白烧。过桥的次数应当等于卡数量级，而不是行数量级。
      // `__mtNative` 只在下面装了假桥之后才存在；这一步跑在它之前，所以要兜底。
      const artPosted = await ev(`(window.__mtNative || []).filter((m) => m.type === 'now-playing-artwork').length`);
      need(artPosted <= (await ev(`AppDriving._debug().deck`)) + 1,
        '逐行封面过桥了 —— artworkLocal 应该只更新 mediaSession，不 post（过桥 '
        + artPosted + ' 次）');
      await ev(`(window.__artLocal = 0, 'ok')`);
      const spokeNotes = await ev(`window.__spoken.some((s) => s.indexOf('durable') >= 0
        && s.indexOf('持久的') >= 0)`);
      need(spokeNotes === true, '解析内容没有被读出来: '
        + JSON.stringify((await ev(`JSON.stringify(window.__spoken.slice(0, 8))`).then(JSON.parse))));
      need((await ev(`LearnStore.allReviews().then((r) => r.length)`)) === rowsBeforeNotes,
        '播放解析的会话写了复习行 —— 解析也不是证据');
      await sweep('播客·播放解析', '#app-drive');
      await ev(`(localStorage.setItem('mt:drivePlayNotes', JSON.stringify(false)), 'ok')`);

      // 10d′ · **本次真机 bug 的回归用例。** 解析引擎**没配**时打开播放解析：
      // 必须出现一句具名说明，而不是像 build 38 那样静默无事发生。
      //
      // 现有的 10d 永远抓不到这个 bug —— 它在打开开关的同一次写入里把 provider/apiKey
      // 也喂好了，自己造出了真机上不成立的前提。这条用例把那两个键**清掉**。
      await ev(`(localStorage.removeItem('mt:provider'),
                localStorage.removeItem('mt:apiKey'),
                localStorage.removeItem('mt:notesProvider'),
                localStorage.removeItem('mt:notesApiKey'),
                localStorage.setItem('mt:drivePlayNotes', JSON.stringify(true)), 'ok')`);
      await ev(`(window.__spoken = [], window.__mtChatBodies = [], 'ok')`);
      await ev(`AppDriving.start().then(() => 'ok')`);
      const dbgNoEngine = await ev(`AppDriving._debug()`);
      need(dbgNoEngine.playNotes === true && dbgNoEngine.notesOk === false,
        '这条用例要的正是「开关开着但引擎没配」，实际 ' + JSON.stringify(dbgNoEngine));
      need((await text('#app-drive-cost')).length > 0,
        '开关开着、引擎没配 —— 界面上一个字都没说。这正是 build 38 的症状');
      need((await ev(`window.__mtChatBodies.length`)) === 0, '引擎没配却发出了解析请求');
      await sweep('播客·解析引擎缺失', '#app-drive');
      await ev(`(AppDriving.stop(), 'ok')`);

      // 10d″ · 暂停 → 「解析这句」 → 解析被读出来 → **回到暂停且 seg 不变**。
      await ev(`(localStorage.setItem('mt:provider', JSON.stringify('openai')),
                localStorage.setItem('mt:apiKey', JSON.stringify('k-test')),
                localStorage.setItem('mt:drivePlayNotes', JSON.stringify(false)), 'ok')`);
      // 给每张卡种一份**合法**的缓存解析（生词取自该卡自己的原句），这样按需解析走的是
      // 缓存命中、不经过「生词必须出自原句」那道回验门。否则这条用例的成败取决于 mock
      // 返回的生词碰巧出现在哪张卡里 —— 那是运气，不是断言。
      await ev(`(async () => {
        for (const it of await LearnStore.allItems()) {
          const w = String(it.text || '').split(/\s+/).find((x) => x.length > 3) || it.text;
          await LearnStore.putNote(it.id, { words: [{ w, g: 'durable-marker' }], phrases: [], grammar: '' },
            { v: LearnNotes.PROMPT_VERSION });
        }
        return 'ok';
      })()`);
      await ev(`(window.__spoken = [], 'ok')`);
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 200));
      await click('#app-drive-pause');
      const segAtPause = (await ev(`AppDriving._debug()`)).seg;
      need((await ev(`document.getElementById('app-drive-explain').hidden`)) === false,
        '暂停时没有出现「解析这句」按钮');
      await ev(`(window.__spoken = [], 'ok')`);
      await click('#app-drive-explain');
      const explained = await (async () => {
        const until = Date.now() + 20000;
        while (Date.now() < until) {
          if ((await ev(`AppDriving._debug()`)).state === 'paused'
              && (await ev(`window.__spoken.length`)) > 0) return true;
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      })();
      need(explained, '按需解析没有在 20s 内读完并回到暂停 '
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      need(await ev(`window.__spoken.some((s) => s.indexOf('durable-marker') >= 0)`),
        '按需解析的内容没有被读出来: ' + JSON.stringify(await ev(`JSON.stringify(window.__spoken)`))
        + ' note=' + JSON.stringify(await text('#app-drive-note')));
      need((await ev(`AppDriving._debug()`)).seg === segAtPause,
        'seg 变了 —— 「继续」会从错的那一段重来');
      need((await text('#app-drive-notes')).length > 0, '按需解析的文字没有显示出来');
      await sweep('播客·按需解析', '#app-drive');
      await ev(`(AppDriving.stop(), 'ok')`);

      // ─── 10e′ · 后台播放的退化路径与接管路径（§9.5「后台与锁屏播放」）─────
      // 这个宿主里**没有原生桥**（Chrome 不是 App），所以第一半验的是「今天的行为一字
      // 未改」：桥不在 ⇒ 隐藏照旧暂停，且界面上不该多出任何一句解释 —— 从没承诺过后台
      // 播放的宿主解释「为什么会停」是噪音。
      //
      // 第二半注入一个假桥再跑一遍。没有它，这一整个功能在自动化里就只有「不生效」那一
      // 条分支被走到，而那条分支恰恰是**改动之前就成立**的 —— 全绿也证明不了任何事。
      need((await ev(`NativeAudio.available()`)) === false, '桥不该存在于这个宿主里');
      need((await ev(`AppDriving._debug().bg`)) === false, '没有桥就不该判定为可后台播');
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 300));
      need((await text('#app-drive-cost')).indexOf('后台') < 0,
        '没有桥的宿主上不该出现任何关于后台播放的解释：' + (await text('#app-drive-cost')));
      await ev(`(document.dispatchEvent(new Event('visibilitychange')), 'ok')`);
      // jsdom/CDP 里 visibilityState 恒为 visible，所以直接验判据本身而不是靠改可见性：
      // 分支是 `visible → return` 在前，`backgroundCapable() → return` 在后。
      need((await ev(`AppDriving._debug().bg`)) === false, '判据不该因为一次事件而翻转');
      await ev(`(AppDriving.stop(), 'ok')`);

      // 假桥：postMessage 记账，然后手工喂一条 session-ready 回去。
      await ev(`(() => {
        window.__mtNative = [];
        window.webkit = { messageHandlers: { mtAudio: {
          postMessage: (m) => { window.__mtNative.push(m); },
        } } };
        return 'ok';
      })()`);
      need((await ev(`NativeAudio.available()`)) === true, '假桥没被认出来');
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 300));
      need(await ev(`window.__mtNative.some((m) => m.type === 'session-start')`),
        '会话开始时没有向原生要音频会话');
      // 会话还没 ready ⇒ 仍然不能后台播。「桥在」不等于 setCategory 成功了。
      need((await ev(`AppDriving._debug().bg`)) === false, 'ready 之前就判定可后台播');
      await ev(`(window.NativeAudio._fromNative({ type: 'session-ready', platform: 'macos', suspends: false }), 'ok')`);
      need((await ev(`AppDriving._debug().bg`)) === true,
        '不会挂起进程的宿主（macOS）应该无条件可后台播 —— 这里误加 returnsAudio 门就会让'
        + '默认装机的 Mac 用户莫名其妙没有后台播放');
      need(await ev(`window.__mtNative.some((m) => m.type === 'now-playing' && m.title)`),
        '没有把卡片正文推给「正在播放」');

      // ─── 锁屏封面（§9.5）────────────────────────────────────────────────
      // 这里是封面唯一一次在**真引擎**里被画出来的地方：vm harness 没有 canvas，
      // 而 file:// 下 canvas 的污染陷阱只有真 WebKit/Chromium 才碰得到。
      const artMsgs = `window.__mtNative.filter((m) => m.type === 'now-playing-artwork')`;
      need((await ev(`${artMsgs}.length`)) >= 1, '换卡时没有推封面');
      need(await ev(`${artMsgs}[0].image.indexOf('data:image/png') === 0`),
        '封面不是 data URL —— toDataURL 可能被 canvas 污染挡住了');
      const artKB = Math.round((await ev(`${artMsgs}[0].image.length`)) / 1024);
      console.log(`  [封面] 1024² PNG ≈ ${artKB} KB`);
      need(artKB < 900, `封面 ${artKB} KB 过大 —— 换卡都要过一趟桥，得换编码或降尺寸`);

      // ─── mediaSession：iOS 上真正决定锁屏/灵动岛长什么样的那一半 ──────────
      // 2026-08-25 实证：WebKit 会为页面里的 <audio> 自己发布一套 now-playing，
      // 标题取自 document.title —— 模拟器锁屏上显示的就是「大肚猴翻译 · 复习」，
      // 而不是我们从原生侧写进去的卡片原文。所以这一半必须走 navigator.mediaSession。
      // Chrome 也实现了它，于是这里能用真引擎验，不必等真机。
      need(await ev(`NativeAudio.mediaSessionWired()`), 'mediaSession 的遥控没接上');
      need(await ev(`!!(navigator.mediaSession && navigator.mediaSession.metadata)`),
        'mediaSession 没有 metadata —— 锁屏上会退回页面标题');
      const msTitle = await ev(`navigator.mediaSession.metadata.title`);
      need(msTitle && msTitle.indexOf('大肚猴') < 0,
        'mediaSession 标题是页面标题而不是卡片原文：' + JSON.stringify(msTitle));
      need(await ev(`(navigator.mediaSession.metadata.artwork || []).length > 0`),
        'mediaSession 没有封面 —— 那正是锁屏上那个空方块');
      const msArtSrc = await ev(`navigator.mediaSession.metadata.artwork[0].src`);
      need(/^(blob:|data:image\/png)/.test(msArtSrc || ''),
        'mediaSession 的封面不是我们画的那张：' + JSON.stringify(String(msArtSrc).slice(0, 40)));
      // 四个遥控 action 必须都注册上。⏪10/⏩10 只有在 nexttrack/previoustrack 有处理
      // 函数时才会被引擎换掉 —— 少注册一个，锁屏上就会退回那两个假动作按钮。
      const acts = await ev(`JSON.stringify(NativeAudio.mediaActions())`);
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack']) {
        need(acts.indexOf('"' + a + '"') >= 0, 'mediaSession 的 ' + a + ' 没注册上：' + acts);
      }

      // **同一张卡只推一次。** 这是「封面走独立消息、按卡片 id 去重」的全部理由：
      // 一张 1024² 的图跟着每次重绘过桥就是白烧。
      //
      // ⚠️ 直接调 NativeAudio.artwork 两次来验，**不是**靠「点几下重绘再数一遍」——
      // 后者是空转的：pushArtwork 只在 openCard 里调，重绘压根走不到去重那一行，
      // 于是把去重整段删掉它照样绿（第一版就是这么写的，删掉去重后仍然全过）。
      const artBefore = await ev(`${artMsgs}.length`);
      await ev(`(NativeAudio.artwork('probe-same-id', 'data:image/png;base64,AAAA'),
                 NativeAudio.artwork('probe-same-id', 'data:image/png;base64,BBBB'), 'ok')`);
      need((await ev(`${artMsgs}.length`)) === artBefore + 1,
        '同一张卡推了不止一次封面 —— 按 id 去重没生效');
      // 反面：换个 id 必须推得出去，否则上面那条可以靠「永远不推」骗过去。
      await ev(`(NativeAudio.artwork('probe-other-id', 'data:image/png;base64,CCCC'), 'ok')`);
      need((await ev(`${artMsgs}.length`)) === artBefore + 2,
        '换了卡片 id 却没推封面 —— 去重把该推的也挡了');
      // 遥控 = 屏幕按钮的第二个表面：按下去必须真的动播放器。
      const before = (await ev(`AppDriving._debug()`)).state;
      await ev(`(window.NativeAudio._fromNative({ type: 'remote', command: 'pause' }), 'ok')`);
      need((await ev(`AppDriving._debug().state`)) === 'paused',
        '锁屏的暂停键没有停住播放器（之前是 ' + before + '）');
      await ev(`(window.NativeAudio._fromNative({ type: 'remote', command: 'play' }), 'ok')`);
      need((await ev(`AppDriving._debug().state`)) !== 'paused', '锁屏的播放键没有续上');
      // 真正的中断：系统没说 shouldResume 就不许自己开口。
      await ev(`(window.NativeAudio._fromNative({ type: 'interrupt', phase: 'begin' }), 'ok')`);
      need((await ev(`AppDriving._debug().state`)) === 'paused', '中断开始没有暂停');
      await ev(`(window.NativeAudio._fromNative({ type: 'interrupt', phase: 'end', resume: false }), 'ok')`);
      need((await ev(`AppDriving._debug().state`)) === 'paused',
        '系统没说可以恢复，播放器却自己开口了');
      await ev(`(window.NativeAudio._fromNative({ type: 'interrupt', phase: 'end', resume: true }), 'ok')`);
      need((await ev(`AppDriving._debug().state`)) !== 'paused', 'shouldResume 之后没有自动续播');
      await ev(`(AppDriving.stop(), 'ok')`);
      need(await ev(`window.__mtNative.some((m) => m.type === 'session-stop')`),
        '退出会话没有收掉锁屏卡片');
      // iOS 形状：会挂起 ⇒ 还要看引擎产不产音频字节。
      await ev(`(window.NativeAudio._fromNative({ type: 'session-ready', platform: 'ios', suspends: true }), 'ok')`);
      need((await ev(`AppDriving._debug().bg`)) === false,
        '设备内置语音（returnsAudio: false）在会挂起的宿主上不该被判定为可后台播');
      await ev(`(delete window.webkit, 'ok')`);

      // ─── 10f · 出发前预载（§9.5）────────────────────────────────────────
      // 这一节的**判据只有一条**：预载跑完之后，再走一次播客会话，网络请求数一个都不涨。
      // 前面每一道门都能在有网的情况下变绿，只有这条断言能分辨「真的离线可用」和
      // 「看起来在下载」。
      //
      // 用 endpoint 语音引擎跑：设备内置语音按构造就不产生字节，用它测预载等于什么都没测。
      await ev(`(AppDriving.stop(), 'ok')`);
      const epEngine = await ev(`(() => { const e = (window.MT_TTS_ENGINES || [])
        .find((x) => x.returnsAudio && x.supportsBaseUrl); return e ? e.id : ''; })()`);
      need(!!epEngine, '注册表里没有会返回音频的语音引擎 —— 预载没法测');
      await ev(`(localStorage.setItem('mt:ttsEngine', JSON.stringify(${JSON.stringify(epEngine)})),
                localStorage.setItem('mt:ttsBaseUrl', JSON.stringify('http://127.0.0.1:9/v1/audio/speech')),
                localStorage.setItem('mt:ttsApiKey', JSON.stringify('k-test')),
                localStorage.setItem('mt:ttsVoice', JSON.stringify('alloy')),
                localStorage.setItem('mt:drivePlaybackMode', JSON.stringify('sequential')),
                localStorage.setItem('mt:drivePlayNotes', JSON.stringify(true)),
                localStorage.setItem('mt:drivePreloadDays', JSON.stringify(0)),
                localStorage.setItem('mt:provider', JSON.stringify('openai')),
                localStorage.setItem('mt:apiKey', JSON.stringify('k-test')), 'ok')`);
      // 抹掉一张卡的译文，让**补译文**这条路真的被走到。整副牌都自带 tr 的话
      // trMissing 恒为 0，这一节就只测了音频与解析，而补译文正是这次新加的能力。
      await ev(`(async () => {
        const items = await LearnStore.allItems();
        const it = items.find((x) => x.tr && (!x.anchor || x.anchor.k !== 'media'));
        if (it) { it.tr = ''; await LearnStore.putItem(it); window.__barecard = it.id; }
        return 'ok';
      })()`);
      need(!!(await ev(`window.__barecard`)), '找不到可以清掉译文的卡 —— 补译文这条路没被覆盖');

      // 清干净：解析缓存、补译文缓存、音频缓存都归零，否则「预载有没有起作用」无从判断。
      await ev(`(async () => {
        for (const it of await LearnStore.allItems()) {
          try { await LearnStore.putNote(it.id, null, {}); } catch (_) {}
          try { await LearnStore.putNote(LearnTranslateFill.keyFor(it.id), null, {}); } catch (_) {}
        }
        await LearnStore.clearAudio();
        return 'ok';
      })()`);
      // **不要**在这里调 AppSettings.wire —— app.js 启动时已经接过一次线了（app.js:440）。
      // 再接一次就是同一个按钮上挂两个监听器：一次点击跑两遍处理函数，于是「第二下开跑」
      // 的那一下里，第二遍处理函数看到状态已经是 running，立刻把刚开跑的这一轮停掉。
      // （事件计数器看不见这件事：事件只有一个，处理函数跑了两遍。）
      await ev(`AppSettings.paint(null, () => {}).then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 200));

      // 第一下 = 只算账。**零请求**是这一步的全部内容：账单要是靠发请求算出来的，
      // 「先看清楚再决定花不花钱」就是假的。
      await ev(`(window.__mtSpeechCount = 0, window.__mtChatBodies = [], 'ok')`);
      await click('#btn-drive-preload');
      const priced = await (async () => {
        const until = Date.now() + 20000;
        while (Date.now() < until) {
          if ((await text('#drive-preload-note')).length > 0
              && !(await ev(`document.getElementById('btn-drive-preload').disabled`))) return true;
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      })();
      need(priced, '预载账单没有在 20s 内出来: ' + JSON.stringify(await text('#drive-preload-note')));
      need((await ev(`window.__mtSpeechCount`)) === 0 && (await ev(`window.__mtChatBodies.length`)) === 0,
        '算账那一步发了请求 —— 「第一下不花钱」是这个按钮的构成要件，不是文案');
      const priceLine = await text('#drive-preload-note');
      need(/\d/.test(priceLine), '账单里没有任何数字，用户无从判断要花多少: ' + priceLine);
      const confirmLabel = await text('#btn-drive-preload');
      need(confirmLabel.length > 0 && /\d/.test(confirmLabel),
        '按钮没有变成带调用次数的确认态: ' + confirmLabel);
      await sweep('播客·预载账单', '#app-settings');

      // 第二下 = 真跑。
      await click('#btn-drive-preload');
      const ran = await (async () => {
        const until = Date.now() + 90000;
        while (Date.now() < until) {
          const label = await text('#btn-drive-preload');
          if (label === (await ev(`PageI18n.t('drive_preload', '预载离线资源')`))) return true;
          await new Promise((r) => setTimeout(r, 400));
        }
        return false;
      })();
      need(ran, '预载没有在 90s 内跑完: ' + JSON.stringify(await text('#drive-preload-note')));
      need((await ev(`window.__mtSpeechCount`)) > 0, '预载没有合成任何音频');
      need((await ev(`LearnTranslateFill.cached(window.__barecard).then((h) => !!(h && h.data))`)) === true,
        '没有译文的卡没有被补上译文 —— 补译文没跑，或者结果没落缓存');
      need((await ev(`LearnStore.allItems().then((xs) => {
        const it = xs.find((x) => x.id === window.__barecard); return it && it.tr; })`)) === '',
        '补译文写进了 item.tr —— 它是派生物，永不写回语料（§7.2/§9.5）');
      need((await ev(`LearnStore.audioStats().then((s) => s.count)`)) > 0, '音频缓存里什么都没有');
      const tally = await text('#drive-preload-note');
      need(/\d/.test(tally), '结束没有报账: ' + tally);
      need((await ev(`document.getElementById('drive-audio-cache').textContent`)).length > 0,
        '音频缓存读数没有刷新');
      await sweep('播客·预载完成', '#app-settings');

      // **王冠断言**：预载之后再听一整轮，网络请求一个都不涨。
      const rowsBeforePreloadRun = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      await ev(`(window.__mtSpeechCount = 0, window.__mtChatBodies = [], window.__spoken = [], 'ok')`);
      await ev(`(document.getElementById('app-settings').hidden = true,
                document.getElementById('app-drive').hidden = false, 'ok')`);
      await ev(`AppDriving.start().then(() => 'ok')`);
      need(await driveWait(90000), '预载之后的会话没有在 90s 内走完 '
        + JSON.stringify(await ev(`AppDriving._debug()`)));
      need((await ev(`window.__mtSpeechCount`)) === 0,
        '预载之后播放仍然发了 ' + (await ev(`window.__mtSpeechCount`)) + ' 次语音合成请求 —— '
        + '这个功能的定义就是这个数字为 0');
      need((await ev(`window.__mtChatBodies.length`)) === 0,
        '预载之后播放仍然发了解析/翻译请求');
      need((await ev(`window.__spoken.length`)) > 0, '整轮一句话都没读 —— 上面的 0 是空跑出来的');
      need((await ev(`LearnStore.allReviews().then((r) => r.length)`)) === rowsBeforePreloadRun,
        '预载 + 播放写了复习行 —— 这个模式只曝光，永不评分');
      await ev(`(AppDriving.stop(), 'ok')`);

      // 10f′ · 引擎没配 ⇒ 账单必须说话，且**零请求**。与 10d′ 同型：先清引擎再点。
      await ev(`(localStorage.removeItem('mt:provider'),
                localStorage.removeItem('mt:apiKey'),
                localStorage.removeItem('mt:notesProvider'),
                localStorage.removeItem('mt:notesApiKey'), 'ok')`);
      await ev(`(document.getElementById('app-drive').hidden = true,
                document.getElementById('app-settings').hidden = false, 'ok')`);
      await ev(`AppSettings.paint(null, () => {}).then(() => 'ok')`);
      await ev(`(window.__mtSpeechCount = 0, window.__mtChatBodies = [], 'ok')`);
      await click('#btn-drive-preload');
      await new Promise((r) => setTimeout(r, 1500));
      const noEngineLine = await text('#drive-preload-note');
      need(noEngineLine.indexOf('\n') > 0 || noEngineLine.length > 0, '账单是空的');
      // 英文文案是「notes engine」（2026-09-06 起 App 会按存储里的 uiLang 即时切语言，这一步
      // 跑在 en 下 —— 以前能过是因为 review.js 从不刷新 PageI18n，页面一直停在中文）。
      need(/解析引擎|analysis engine|notes engine|解析エンジン|해설 엔진|moteur|Analyse-Engine|motor de|movimiento|движок|محرّك/.test(noEngineLine),
        '引擎没配，账单里一个字都没提 —— 这正是 build 38 的症状: ' + noEngineLine
        + ' · 状态 ' + JSON.stringify(await ev(`(({ playNotes, notesOk }) => ({ playNotes, notesOk }))(AppDriving._debug())`))
        + ' · 存储 ' + await ev(`JSON.stringify({ pn: localStorage.getItem('mt:drivePlayNotes'), p: localStorage.getItem('mt:provider'), np: localStorage.getItem('mt:notesProvider') })`));
      need((await ev(`window.__mtChatBodies.length`)) === 0, '引擎没配却发出了解析/翻译请求');
      await sweep('播客·预载缺引擎', '#app-settings');

      // 10f‴ · 语音引擎配坏了（endpoint 引擎缺地址）：账单要说出**原因**，不是症状。
      // 这条路有个陷阱：available() 失败会让 speakableDeck 把每一张卡都判成读不出来，
      // 于是账单本来会只说「没有可听读的卡」—— 一句正确但没用的话。
      await ev(`(localStorage.setItem('mt:ttsEngine', JSON.stringify(${JSON.stringify(epEngine)})),
                localStorage.removeItem('mt:ttsBaseUrl'), 'ok')`);
      await ev(`AppSettings.paint(null, () => {}).then(() => 'ok')`);
      await ev(`(window.__mtSpeechCount = 0, 'ok')`);
      await click('#btn-drive-preload');
      await new Promise((r) => setTimeout(r, 1500));
      const badLine = await text('#drive-preload-note');
      const badCopy = (await ev(`PageI18n.t('drive_preload_tts_bad', '')`)).split('{reason}')[0];
      need(badCopy.length > 0 && badLine.indexOf(badCopy) >= 0,
        '语音引擎缺地址时账单没有点名原因: ' + badLine);
      need((await ev(`window.__mtSpeechCount`)) === 0, '算账那一步又发了合成请求');
      await sweep('播客·预载语音引擎坏', '#app-settings');
      await ev(`(localStorage.setItem('mt:ttsBaseUrl',
        JSON.stringify('http://127.0.0.1:9/v1/audio/speech')), 'ok')`);

      // 10f″ · 不产生缓存的引擎：如实说明，不假装在下载音频。
      await ev(`(localStorage.setItem('mt:ttsEngine', JSON.stringify('browser')),
                localStorage.setItem('mt:provider', JSON.stringify('openai')),
                localStorage.setItem('mt:apiKey', JSON.stringify('k-test')), 'ok')`);
      await ev(`AppSettings.paint(null, () => {}).then(() => 'ok')`);
      await ev(`(window.__mtSpeechCount = 0, 'ok')`);
      await click('#btn-drive-preload');
      await new Promise((r) => setTimeout(r, 1500));
      const naLine = await text('#drive-preload-note');
      need(naLine.length > 0, '内置语音下的账单是空的');
      const naCopy = await ev(`PageI18n.t('drive_preload_no_audio_cache', '')`);
      need(naCopy.length > 0 && naLine.indexOf(naCopy) >= 0,
        '内置语音下没有说明「不产生缓存、本来就能离线」—— 用户会以为音频预载失败了: ' + naLine);
      need((await ev(`window.__mtSpeechCount`)) === 0, '不产生缓存的引擎却发了合成请求');
      await sweep('播客·预载内置语音', '#app-settings');
      await ev(`(document.getElementById('app-settings').hidden = true,
                document.getElementById('app-drive').hidden = false,
                localStorage.setItem('mt:drivePlayNotes', JSON.stringify(false)), 'ok')`);

      // 10e · Pause: TTS stops, and NOTHING is written after the pause.
      await ev(`AppDriving.start().then(() => 'ok')`);
      await new Promise((r) => setTimeout(r, 300));
      const stopsBefore = await ev(`window.__stops`);
      const rowsBeforePause = await ev(`LearnStore.allReviews().then((r) => r.length)`);
      await click('#app-drive-pause');
      need((await ev(`window.__stops`)) > stopsBefore, '暂停没有调用 LearnTTS.stop');
      need((await text('#app-drive-pause')).length > 0, '暂停后按钮无文字（应转为「继续」）');
      await sweep('播客·暂停态', '#app-drive');
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
