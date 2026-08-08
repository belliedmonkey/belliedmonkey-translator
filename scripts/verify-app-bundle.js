// scripts/verify-app-bundle.js — does the host app's page actually come up?
//
//   npm run test:app        (needs Chrome; Node ≥22)
//
// The app is a WKWebView on a `file://` origin, and its failure mode is a **blank
// white screen with nothing in any log** — a 404 on a stylesheet or script produces
// exactly that, and an iOS screenshot of it is indistinguishable from a screenshot of
// a view that has not painted yet. So this loads the built bundle in a real engine and
// asserts on the DOM.
//
// ─── Serve it in the SHIPPED LAYOUT, not a convenient one ────────────────────
// This is the whole reason the file exists in this shape. The Safari converter puts
// `Main.html` in `Base.lproj/` while `Script.js` and `Style.css` sit at the bundle
// ROOT — hence `../Script.js`. The first version of this check served all three flat
// from one directory, so same-directory hrefs resolved, the DOM assertions passed, and
// the app was still a blank screen on the simulator. **A green check against a layout
// the product does not use is worse than no check**: it costs the same and it converts
// "unverified" into "verified".

'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const SRC = path.join(ROOT, 'dist-app');

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

setTimeout(() => { console.log('\n✗ 超时（60s），没有结论'); process.exit(2); }, 60000).unref();

(async () => {
  for (const f of ['Main.html', 'Script.js', 'Style.css']) {
    if (!fs.existsSync(path.join(SRC, f))) {
      console.error(`✗ dist-app/${f} 不存在 —— 先跑 node build.js`);
      process.exit(1);
    }
  }

  const missed = [];
  const srv = http.createServer((req, res) => {
    // Bundle layout: /Base.lproj/Main.html, /Script.js, /Style.css
    const rel = req.url === '/' ? '/Base.lproj/Main.html' : req.url;
    const name = path.basename(rel);
    const inBaseLproj = rel.startsWith('/Base.lproj/');
    const ok = (name === 'Main.html' && inBaseLproj)
      || ((name === 'Script.js' || name === 'Style.css') && !inBaseLproj);
    // Chrome asks for /favicon.ico on its own; that is the browser, not the page.
    if (!ok) { if (name !== "favicon.ico") missed.push(rel); res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'text/plain' });
    res.end(fs.readFileSync(path.join(SRC, name)));
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/Base.lproj/Main.html';

  const chrome = await launchChrome();
  let ok = true;
  try {
    const cdp = await CDP.connect(chrome.port);
    const targets = await cdp.send('Target.getTargets', {});
    const page = targets.targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const problems = [];
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    cdp.listeners.push({ event: 'Runtime.exceptionThrown', fn: (p) => problems.push(
      'EXCEPTION ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text)) });
    cdp.listeners.push({ event: 'Log.entryAdded', fn: (p) => {
      if (p.entry.level !== 'error') return;
      if (/favicon\.ico/.test(p.entry.url || '')) return;
      problems.push('ERROR ' + p.entry.text + ' ' + (p.entry.url || ''));
    } });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await new Promise((r) => setTimeout(r, 2500));

    const r = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        text: document.body.innerText.trim().length,
        syncEnabled: !!(window.MT_BACKEND && MT_BACKEND.enabled),
        outHidden: document.getElementById('signed-out').hidden,
        // Assert on what must be HIDDEN too. \`hidden\` is an attribute, not a
        // rendering guarantee — any author \`display\` rule beats it, and then the app
        // shows a verification-code field before a code exists.
        codeShown: getComputedStyle(document.getElementById('code-form')).display !== 'none',
        inShown: getComputedStyle(document.getElementById('signed-in')).display !== 'none',
        lede: (document.getElementById('lede').textContent || '').length,
        sendLabel: (document.getElementById('send').textContent || '').length,
        styled: getComputedStyle(document.body).getPropertyValue('--green').trim(),
        globals: ['MT_BACKEND','LearnModel','LearnScheduler','LearnStore','LearnAuth','LearnChunk','LearnSync',
          'LearnTTS','LearnDrain','MT_I18N_MESSAGES','PageI18n','PageSettings','AppSettings',
          // §8.8 — app.js rebuilds the deck through this on every review-view entry;
          // if review.js stops exporting it, the app silently loses deck freshness.
          'LearnReview',
          // §7.2/§9.2 — the registry feeds the notes gate and the engine picker.
          'MT_PROVIDERS']
          .filter((g) => typeof window[g] === 'undefined'),
        // The review surface is INLINED from extension/learn/review.html at build
        // time. If that lift silently produced nothing, everything above still
        // passes and the app just has no review page — so name the elements
        // review.js will \`addEventListener\` on, because a missing one throws during
        // its boot and takes the whole bundle down with it.
        reviewMissing: ['review-view','card','counts','empty','nothing-due','pressure',
          'pressure-fix','open-settings','empty-settings','orig','src','progress',
          // Stage A (§5.1): strength bar, one-time explainer, cap hint
          'strength','strength-bar','strength-label','howto','howto-ok','cap-hint',
          // Stage B (§5.3): free practice
          'practice-setup','practice-pool','practice-batch','practice-start','practice-open','practice-note',
          // Stage C (§5.2): mastery ladder — badges, shadowing hint, write-tier cloze
          'badges','badge-read','badge-listen','badge-write','badge-full',
          'shadow','cloze','cloze-check','write-prompt','write-replaced','grades',
          // Stage D (§9.2): sentence notes — present in the DOM even while the
          // capability gate keeps the wrap hidden (no key configured yet)
          'notes-wrap','notes-btn','notes-box','notes-cost']
          .filter((id) => !document.getElementById(id)),
        reviewHidden: getComputedStyle(document.getElementById('review-view')).display === 'none',
        // Stage 4. The dead end this replaced was two taps deep (review page → 设置 →
        // the shim throws), so assert the elements exist — and that the
        // Apple-required in-app account deletion is among them: per learning-design
        // §10 Gate B the app cannot ship without it, which makes its absence a
        // release blocker rather than a missing feature.
        settingsMissing: ['app-settings','settings-back','daily','tts-mode','tts-auto','tts-rate',
          // §7.2 device-local credential for §9.2 notes
          'notes-provider','notes-key','notes-base','notes-model',
          'clean-known','settings-signout','delete-account','gear']
          .filter((id) => !document.getElementById(id)),
        // The engine picker must be REGISTRY-fed and chat-only: one 不使用 row plus
        // every chat-capable registry entry, and never the google translation
        // channel (excluded by TYPE — §9.2). Counted against the live registry, so
        // adding an engine to the registry can never silently miss the app.
        notesPickerCount: document.getElementById('notes-provider').options.length,
        notesPickerWant: 1 + (window.LearnNotes ? LearnNotes.chatEngines().length : -99),
        notesPickerHasNonChat: [...document.getElementById('notes-provider').options].some(
          (o) => o.value && !(window.MT_PROVIDERS || []).some((p) => p.id === o.value
            && (p.type === 'chat-compat' || p.type === 'messages-compat'))),
        // chrome-shim seeds ttsMode='assist' SYNCHRONOUSLY, before review.js's
        // one-shot boot read — the async ensureDefaults path loses that race, which
        // is exactly how the app shipped with speech permanently off. Assert the
        // seed itself, not the settings UI: the UI can look right while the boot
        // read still saw nothing.
        ttsModeSeeded: localStorage.getItem('mt:ttsMode') === JSON.stringify('assist'),
        settingsHidden: getComputedStyle(document.getElementById('app-settings')).display === 'none',
        // review.css must survive the concatenation too — it owns the review markup.
        reviewStyled: getComputedStyle(document.querySelector('.page') || document.body).maxWidth,
      })`, returnByValue: true }, sessionId);
    const o = JSON.parse(r.result.value);

    const need = (cond, msg) => { if (!cond) { ok = false; console.log('  ✗ ' + msg); } };
    need(problems.length === 0, '控制台有错: ' + problems.join(' | '));
    need(missed.length === 0, '请求了 bundle 里不存在的路径: ' + missed.join(', '));
    need(o.globals.length === 0, '打包漏了模块: ' + o.globals.join(', '));
    // Both shipping states are real states, and the OFF one carries a promise worth
    // holding the app to: `MT_BACKEND.enabled === false` says there is "no path to an
    // account or to our server". An app whose whole job is signing in is exactly such
    // a path, so assert the absence, not just the presence.
    if (o.syncEnabled) {
      need(!o.outHidden, '登录界面没显示出来 —— 这就是那块白屏');
      need(!o.codeShown, '验证码表单在没发码时就显示了 —— [hidden] 被某条 display 规则压过了');
      need(!o.inShown, '已登录界面在未登录时就显示了');
      need(o.text > 40, '页面几乎没有文字（' + o.text + '），八成是白屏');
      need(o.lede > 0 && o.sendLabel > 0, '文案没渲染（i18n 没跑）');
    } else {
      need(o.outHidden && !o.inShown, '同步关闭时仍然给出了登录入口 —— 这正是那个开关承诺不会发生的事');
      need(o.text > 10, '同步关闭时页面是空的 —— 至少要说清楚为什么没有内容');
    }
    // §9.2 live gate — pasting a key must open the notes gate WITHOUT a relaunch:
    // settings save reconfigures LearnNotes directly, and the gate is re-asked per
    // card. review.js reads settings once at load, so if that reconfigure call is
    // lost, this is the check that knows (the DOM assertions above cannot see it).
    // Only meaningful when the account surface exists (sync-enabled builds — the
    // disabled build returns from boot before wire() attaches any listener).
    if (o.syncEnabled) {
      const g = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const before = LearnNotes.capable();
          const sel = document.getElementById('notes-provider');
          const opt = [...sel.options].find((x) => x.value);
          sel.value = opt ? opt.value : '';
          sel.dispatchEvent(new Event('change'));
          const key = document.getElementById('notes-key');
          key.value = 'k-live-gate';
          key.dispatchEvent(new Event('change'));
          await new Promise((r) => setTimeout(r, 80));
          return JSON.stringify({ before, after: LearnNotes.capable() });
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const gv = JSON.parse(g.result.value);
      need(!gv.before, '还没配 key 门就开了');
      need(gv.after, '填了 key 门没开 —— 解析要等下次启动才出现，用户会当它是坏的');
    }
    // Style.css 404s silently; without this the page still "works" and looks broken.
    need(!!o.styled, '样式没加载 —— Style.css 的路径又错了');
    // The review surface, in both shipping states — it is inlined at build time and
    // its absence is invisible to every assertion above.
    need(o.reviewMissing.length === 0, '复习页没被嵌进来，缺: ' + o.reviewMissing.join(', '));
    need(o.reviewHidden, '复习视图在没进入之前就显示了');
    need(o.reviewStyled && o.reviewStyled !== 'none', 'review.css 没进 Style.css');
    need(o.settingsMissing.length === 0, '设置页元素缺: ' + o.settingsMissing.join(', ')
      + (o.settingsMissing.indexOf('delete-account') >= 0
        ? '（删除账号是 Apple 的上架硬要求，§10 Gate B）' : ''));
    need(o.settingsHidden, '设置页在没进入之前就显示了');
    need(o.ttsModeSeeded, 'ttsMode 没被 shim 播种成 assist —— App 里语音又会永远关着');
    need(o.notesPickerCount === o.notesPickerWant,
      '解析引擎选择器与注册表不同步：' + o.notesPickerCount + ' 项，应为 ' + o.notesPickerWant);
    need(!o.notesPickerHasNonChat, '解析引擎选择器混入了非 chat 类引擎 —— 门控按 type，选择器也必须');
  } catch (e) { ok = false; console.log('  ✗ ' + (e && e.stack)); }
  chrome.cleanup(); srv.close();
  console.log(ok ? '\n✓ App 页面在真实引擎里起得来，模块齐全，样式已加载' : '\n✗ App 页面有问题');
  process.exit(ok ? 0 : 1);
})();
