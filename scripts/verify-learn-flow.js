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
    { id: 'listen1', text: 'Practice makes memories durable.', tr: '练习让记忆持久。',
      lang: 'en', sourceId: 'src1', state: 'learning', createdAt: now - 30 * day, lastSeenAt: now - day,
      seenCount: 8, salience: 0.5, skills: { read: 1 },
      sched: { s: 10, d: 5, lastReviewAt: now - 11 * day, dueAt: now - day, reps: 6, lapses: 0 } },
    { id: 'write1', text: 'Spaced repetition beats cramming easily.', tr: '间隔重复轻松胜过临时抱佛脚。',
      lang: 'en', sourceId: 'src1', state: 'learning', createdAt: now - 90 * day, lastSeenAt: now - day,
      seenCount: 20, salience: 0.5, skills: { read: 1, listen: 1 },
      sched: { s: 60, d: 4, lastReviewAt: now - 65 * day, dueAt: now - 5 * day, reps: 12, lapses: 0 } },
    { id: 'und1', text: 'Unknown language sentence here.', tr: '未知语言的句子。',
      lang: 'und', sourceId: 'src1', state: 'learning', createdAt: now - 9 * day, lastSeenAt: now - day,
      seenCount: 3, salience: 0.4,
      sched: { s: 1.2, d: 5, lastReviewAt: now - 2 * day, dueAt: now - 3600e3, reps: 2, lapses: 0 } },
    { id: 'cand1', text: 'A fresh candidate sentence.', tr: '一句新候选。',
      lang: 'en', sourceId: 'src1', state: 'candidate', createdAt: now - day, lastSeenAt: now - day,
      seenCount: 1, salience: 0.9 },
  ];
  const db = await LearnStore.open();
  await new Promise((res, rej) => {
    const t = db.transaction(['items', 'sources'], 'readwrite');
    for (const it of items) t.objectStore('items').put(it);
    t.objectStore('sources').put(src);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  return 'seeded';
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
      (() => {
        const voices = [{ name: 'TestVoice', lang: 'en-US', voiceURI: 'TestVoice|en-US', default: true, localService: true }];
        window.speechSynthesis = {
          getVoices: () => voices,
          addEventListener: () => {},
          cancel: () => {},
          speak: (u) => { setTimeout(() => u.dispatchEvent ? u.dispatchEvent(new Event('start')) : (u.onstart && u.onstart()), 0);
            try { const ev = new Event('start'); (u._l && u._l.forEach((f) => f(ev))); } catch (_) {} },
        };
        class U extends EventTarget { constructor(text) { super(); this.text = text; } }
        window.SpeechSynthesisUtterance = U;
        // fetch mock for the notes engine only — everything else passes through.
        const realFetch = window.fetch.bind(window);
        window.fetch = (u2, init) => {
          if (String(u2).includes('/v1/chat/completions')) {
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
    console.log('  seed:', await ev(SEED));
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
    need(listen1 && listen1.sched.reps === 7,
      '第二题推进了排程（listen1 reps ' + (listen1 && listen1.sched && listen1.sched.reps) + ' ≠ 7）');
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
    const before = await item(firstId);
    if (!(await hidden('#reveal-orig'))) await click('#reveal-orig');
    if (!(await hidden('#reveal'))) await click('#reveal');
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
      if (!(await hidden('#reveal-orig'))) await click('#reveal-orig');
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
