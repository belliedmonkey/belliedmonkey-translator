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
const { SWEEP_FN, installSweep, sweepBoth } = require('./lib/sweep.js');
// 两个 flavor 的宿主 App 包是两份不同的产物（注册表不同、默认引擎不同、
// 免费通道有无不同）。此前这里写死 dist-app，于是**中国版从来没被这套断言测过**
// —— 1.6.4 那次「中国版默认引擎不在自己注册表里」能一路出货，就是这个形状。
const FLAVOR = (() => {
  const i = process.argv.indexOf('--flavor');
  if (i >= 0 && process.argv[i + 1] === 'china') return 'china';
  return process.argv.includes('--flavor=china') ? 'china' : 'global';
})();
const APP_DIR = FLAVOR === 'china' ? 'dist-app-china' : 'dist-app';
const SRC = path.join(ROOT, APP_DIR);
// 出境同意要不要出现，独立于页面自己的判定再算一遍：中国版 **且** 包里的后端在 *.supabase.co（东京）。
// 2026-09-22 中国版切到境内后端（china.ready=true）⇒ 中国版包里这条为假，框必须消失。
// 不按 FLAVOR 写死 —— 写死的那版在翻开关当天红了四条，而产品行为是对的。
const XB_WANT = (() => {
  if (FLAVOR !== 'china') return false;
  try {
    const js = fs.readFileSync(path.join(SRC, 'Script.js'), 'utf8');
    const m = js.match(/^  url: '([^']*)'/m);
    return !!(m && /\.supabase\.co$/i.test(new URL(m[1]).hostname));
  } catch (_) { return true; }
})();

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

setTimeout(() => { console.log('\n✗ 超时（60s），没有结论'); process.exit(2); }, 60000).unref();

(async () => {
  for (const f of ['Main.html', 'Script.js', 'Style.css']) {
    if (!fs.existsSync(path.join(SRC, f))) {
      console.error(`✗ ${APP_DIR}/${f} 不存在 —— 先跑 node build.js`
        + (FLAVOR === 'china' ? ' --flavor china' : ''));
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
        // 宿主真值（AppLink.inApp 读它）：build/app-bundle.js 写在 Script.js 头部。
        hostFlag: window.MT_HOST === 'app',
        // 「在 App 里继续复习」在 App 里永远不该出现（2026-09-06 报障）。未登录时它本来
        // 就藏着，这条只防「无条件显示」的回归；登录态的正式断言在 test:sync。
        goAppHidden: !!(document.getElementById('go-app') || {}).hidden,
        outHidden: document.getElementById('signed-out').hidden,
        obShown: !document.getElementById('onboard').hidden,
        // Assert on what must be HIDDEN too. \`hidden\` is an attribute, not a
        // rendering guarantee — any author \`display\` rule beats it, and then the app
        // shows a verification-code field before a code exists.
        codeShown: getComputedStyle(document.getElementById('code-form')).display !== 'none',
        inShown: getComputedStyle(document.getElementById('signed-in')).display !== 'none',
        lede: (document.getElementById('lede').textContent || '').length,
        sendLabel: (document.getElementById('send').textContent || '').length,
        styled: getComputedStyle(document.body).getPropertyValue('--accent').trim(),
        globals: ['MT_BACKEND','LearnModel','LearnScheduler','LearnStore','LearnAuth','LearnChunk','LearnSync',
          'LearnTTS','LearnDrain','MT_I18N_MESSAGES','PageI18n','PageSettings','settingsModel',
          // §8.8 — app.js rebuilds the deck through this on every review-view entry;
          // if review.js stops exporting it, the app silently loses deck freshness.
          'LearnReview',
          // §7.2/§9.2 — the registry feeds the notes gate and the engine picker.
          'MT_PROVIDERS',
          // §9.5 出发前预载: AppDriving orchestrates it, LearnTranslateFill fills in
          // the missing translations, and TranslationAPI is the transport it rides —
          // the app translated nothing before 2026-08-23, so a missing TranslationAPI
          // here would surface as 补译文 silently doing nothing at all.
          'AppDriving', 'LearnTranslateFill', 'TranslationAPI']
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
        settingsMissing: ['app-settings','settings-back','daily','tts-mode','target-lang',
          // speech engine + its registry-declared credential fields (§7.2 / §9.1)
          'tts-engine','tts-api-key','tts-base-url','tts-model',
          'tts-voice','tts-auto','tts-rate',
          // §7.2 device-local credential for §9.2 notes
          'notes-provider','notes-api-key','notes-base-url','notes-model',
          // §7.2 device-local credential for the §9.4 transcription engine
          'stt-engine','stt-api-key','stt-base-url','stt-model',
          // §9.5 出发前预载 — the two-tap price-then-spend control and its readouts.
          'drive-preload-days','btn-drive-preload','drive-preload-note',
          'drive-audio-cache','btn-drive-clear-audio',
          // 反馈 / 评分出口（2026-09-05）：产品里此前一个 mailto 都没有
          'feedback-title','feedback-mail','feedback-rate','feedback-note',
          // 匿名用量事件的开关（Gate D，2026-09-05）：DOM 里必须在（中国版只是 hidden）
          'telemetry-block','telemetry-on','telemetry-note',
          'clean-known','settings-signout','delete-account','gear',
          // 2026-09-17 设置页信息架构：四节节头、依赖行、视频的语言、离线模型行、识别语言包行
          'sec-engines','sec-features','sec-account','sec-about','dep-review','dep-drive','dep-listen','dep-docs',
          'subtitle-video-lang','tts-offline-row','listen-pack-row','app-adv-hint-go']
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
        // The speech-engine picker must be registry-fed too — one row per
        // MT_TTS_ENGINES entry, counted against the live registry.
        ttsEngineCount: document.getElementById('tts-engine').options.length,
        // +1 是哨兵项「未配置（不朗读）」—— 与 stt 同形（2026-09-04：语音不再默认
        // 走系统自带，所以「未配置」必须在选择器里有位置可待）。
        // grantOnly 的条目（免费额度的中继，§8.10）按设计**不进选择器**：
        // 它没有可粘的 key，令牌是登录之后系统发的，手选它只会得到 401。
        // 所以判据是「用户能选的引擎都在选择器里」，不是「注册表有几条就有几条」。
        // 本机条目（type device-*，§9.6.1）只在桥在的宿主里出现；这条门禁跑在真 Chrome 里、没有桥，
        // 所以按 EngineFields.isDevice 滤掉 —— 谓词与 populate 同源，不是第二张表。
        ttsEngineWant: 1 + (window.MT_TTS_ENGINES || []).filter((e) => !e.grantOnly && !EngineFields.isDevice(e)).length,
        // The transcription-engine picker (§9.4): one 未配置 row (the correct
        // default — no zero-config STT engine exists) plus the live registry.
        sttEngineCount: document.getElementById('stt-engine').options.length,
        sttEngineWant: 1 + (window.MT_STT_ENGINES || []).filter((e) => !e.grantOnly && !EngineFields.isDevice(e)).length,   // 同上（§8.10 / §9.6.1）
        // chrome-shim seeds ttsMode='assist' SYNCHRONOUSLY, before review.js's
        // one-shot boot read — the async ensureDefaults path loses that race, which
        // is exactly how the app shipped with speech permanently off. Assert the
        // seed itself, not the settings UI: the UI can look right while the boot
        // read still saw nothing.
        // **反过来了**（2026-09-04）。原来这里断言 shim 同步播种 'assist'，
        // 因为那时语音默认可用。现在语音要用户先配引擎才有，播种 'assist' =
        // 一个点了必然失败的播放键。所以断言的是「**没有**被播种」。
        // 不变量是「**默认不出声**」，不是「没人写这个键」—— ensureDefaults 仍会
        // 显式落一个 'off'，那是对的（一个明确的关，比一个缺席的值更好读回）。
        // 会出声的两档（assist / audio-first）在用户配引擎之前都不许出现。
        ttsModeQuiet: ['assist', 'audio-first']
          .indexOf(JSON.parse(localStorage.getItem('mt:ttsMode') || 'null')) < 0,
        settingsHidden: getComputedStyle(document.getElementById('app-settings')).display === 'none',
        // review.css must survive the concatenation too — it owns the review markup.
        reviewStyled: getComputedStyle(document.querySelector('.page') || document.body).maxWidth,
      })`, returnByValue: true }, sessionId);
    const o = JSON.parse(r.result.value);

    const need = (cond, msg) => { if (!cond) { ok = false; console.log('  ✗ ' + msg); } };
    need(problems.length === 0, '控制台有错: ' + problems.join(' | '));
    need(missed.length === 0, '请求了 bundle 里不存在的路径: ' + missed.join(', '));
    need(o.globals.length === 0, '打包漏了模块: ' + o.globals.join(', '));
    need(o.hostFlag, 'Script.js 头部没有 window.MT_HOST = \'app\' —— 复习页分不清自己在哪个宿主');
    need(o.goAppHidden, '「在 App 里继续复习」在 App 里露出来了');
    // Both shipping states are real states, and the OFF one carries a promise worth
    // holding the app to: `MT_BACKEND.enabled === false` says there is "no path to an
    // account or to our server". An app whose whole job is signing in is exactly such
    // a path, so assert the absence, not just the presence.
    if (o.syncEnabled) {
      // 首次运行顶上来的是引导，不是登录界面 —— 两者有一个在就不是白屏。
      // 这条断言原本只认 #signed-out；引导上线后必须两者取或，否则它会把
      // 「首屏改好了」误报成「白屏」。
      need(!o.outHidden || o.obShown,
        '未登录时既没有登录界面也没有引导 —— 这就是那块白屏');
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
    // ── 引擎字段的显隐：**渲染后**与组件的判据逐项相等（2026-09-04）────────────
    //
    // 这是「App 设置页与扩展端不一致」那个报障的门。它必须问**渲染后的可见性**，
    // 不是 `.hidden` 的属性值 —— 一条 display 声明就能把 hidden 压掉，而那正是
    // engine-fields.js 文件头列的四处漂移里最难发现的一处。
    //
    // 判据是「与 EngineFields.visibility(entry) 相等」而不是一张写死的期望表：
    // 写死的表是第八份手抄，注册表一变它就成了谎话。
    {
      const fx = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const vis = (el) => !!(el && el.offsetParent !== null);
          const rows = (p) => ({
            key: vis(document.getElementById(p + '-key-field')),
            baseUrl: vis(document.getElementById(p + '-base-field')),
            model: vis(document.getElementById(p + '-model-field')),
          });
          const SL = EngineFields.SLOTS;
          const cases = [
            ['tts', 'tts', 'tts-engine', (window.MT_TTS_ENGINES || []).filter((e) => !e.grantOnly && !EngineFields.isDevice(e))],
            ['stt', 'stt', 'stt-engine', (window.MT_STT_ENGINES || []).filter((e) => !e.grantOnly && !EngineFields.isDevice(e))],
            ['notes', 'notes', 'notes-provider', LearnNotes.chatEngines()],
          ];
          // ── 进详细档的**第一眼**：默认（未配置）下三个框都不该露 ────────────
          //
          // 这一条是 2026-09-04 在 iPhone 模拟器上肉眼发现的，而下面那个「逐个切引擎」
          // 的循环**看不见它**：切引擎会调 paintTtsFields，那时 applyDetailMode 早已
          // 跑完，两者恰好一致。真正的缺陷只在**刚进详细档、还没动过任何引擎**的那一
          // 瞬间存在 —— .adv-only 放开了所有行，而逐引擎的判断还没再说一次话。
          // 所以判据必须是「第一眼」，不是「切过之后」。
          const firstLook = () => ({
            engine: (document.getElementById('tts-engine') || {}).value,
            key: vis(document.getElementById('tts-key-field')),
            base: vis(document.getElementById('tts-base-field')),
            model: vis(document.getElementById('tts-model-field')),
          });

          // 必须先真的进设置页：祖先 hidden 时 offsetParent 对每一个后代都是 null，
          // 于是「全部不可见」，这条断言会以一种看起来很像真发现的方式全线报错。
          document.getElementById('gear').click();
          await new Promise((r) => setTimeout(r, 120));
          // 详细档才谈得上字段显隐 —— 快速档整批 .adv-only 是收起来的。
          document.getElementById('mode-detail').click();
          await new Promise((r) => setTimeout(r, 60));
          const first = firstLook();

          // ── 未配置时点「试听一句」，界面不许说「播放中」──────────────────
          //
          // 2026-09-04 全矩阵行 7（macOS 真宿主 App）肉眼抓到：App 的
          // liveTtsConfigure 里留着一处写死的 browser 回落，于是
          // 「未配置」在试听时被静默换成系统自带，**真的出了声**，而这正是这次
          // 改动要消灭的东西。上面那两块断言都看不见它 —— 它们只读显隐、不点按钮。
          //
          // 判据是状态行的**文字**而不是 speak() 的返回值：用户看见的就是这行字，
          // 而「必然失败的按钮 + 一句谎话」正是它当时的样子。
          document.getElementById('btn-tts-test').click();
          await new Promise((r) => setTimeout(r, 300));
          const preview = {
            engine: (document.getElementById('tts-engine') || {}).value,
            note: (document.getElementById('test-tts-note').textContent || '').trim(),
          };

          const bad = [];
          let checked = 0;
          for (const [slot, prefix, selId, entries] of cases) {
            const sel = document.getElementById(selId);
            for (const e of entries) {
              sel.value = e.id;
              sel.dispatchEvent(new Event('change'));
              await new Promise((r) => setTimeout(r, 20));
              const want = EngineFields.visibility(e);
              const got = rows(prefix);
              checked += 1;
              for (const f of ['key', 'baseUrl', 'model']) {
                if (!!want[f] !== got[f]) {
                  bad.push(slot + '/' + e.id + '.' + f + ' 期望 ' + !!want[f] + ' 实际 ' + got[f]);
                }
              }
            }
          }
          // 不变量（interaction-spec「一键配置与逐引擎配置永不同屏」）：两档互斥，
          // 且快速档必须有一条**可见**的路通向详细档 —— 「只藏不给路是退化，不是简化」。
          const anyVis = (sel) => [...document.querySelectorAll(sel)].some((e) => vis(e));
          const tabsHidden = !vis(document.getElementById('mode-tabs'));
          document.getElementById('mode-quick').click();
          await new Promise((r) => setTimeout(r, 80));
          const quick = {
            adv: anyVis('#app-settings .adv-only'),
            card: anyVis('#app-settings .quick-only'),
            path: vis(document.getElementById('mode-detail')),
          };
          document.getElementById('mode-detail').click();
          await new Promise((r) => setTimeout(r, 80));
          const detail = {
            adv: anyVis('#app-settings .adv-only'),
            card: anyVis('#app-settings .quick-only'),
          };
          // 一键卡按下「配好」之后必须还在：key 还在框里、三行「测试中…」看得见。
          // 2026-09-06 用户报：粘贴 key → 点按钮 → 密码消失。真因是 applyQuickSetup 写盘后
          // paint() 重画整页，而 setupQuickCard 清空重建了这张卡。自检本身打桩掉（不发网络）。
          document.getElementById('mode-quick').click();
          await new Promise((r) => setTimeout(r, 80));
          let apply = { present: false };
          const qk = document.getElementById('qs-key'), qb = document.getElementById('qs-apply');
          if (qk && qb) {
            const stub = () => Promise.reject(new Error('gate-stub'));
            try { window.EngineTest.translation = stub; window.EngineTest.tts = stub; window.EngineTest.stt = stub; } catch (_) {}
            qk.value = 'sk-gate-0123456789'; qk.dispatchEvent(new Event('input', { bubbles: true }));
            qb.click();
            await new Promise((r) => setTimeout(r, 900));
            const qk2 = document.getElementById('qs-key'), qr = document.getElementById('qs-res');
            apply = { present: true, kept: !!qk2 && qk2.value === 'sk-gate-0123456789', sameNode: qk2 === qk,
              resVisible: !!qr && vis(qr), rows: qr ? qr.querySelectorAll('li').length : 0 };
          }
          document.getElementById('settings-back').click();
          await new Promise((r) => setTimeout(r, 60));
          return JSON.stringify({ bad, checked, slots: Object.keys(SL).length, tabsHidden, quick, detail, first, preview, apply });
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const fv = JSON.parse(fx.result.value);
      need(fv.first.engine === '',
        '进详细档时语音引擎不是「未配置」，实际 "' + fv.first.engine + '"');
      need(!fv.first.key && !fv.first.base && !fv.first.model,
        '刚进详细档、语音还没配，Key/地址/模型却露着（key=' + fv.first.key
        + ' base=' + fv.first.base + ' model=' + fv.first.model + '）—— '
        + '.adv-only 与 applyFields 都在写同一个 hidden，放开之后必须让逐引擎的判断再说一次话');
      need(fv.preview.engine === '',
        '试听前语音引擎已经不是「未配置」了，这条断言测不到它要测的东西');
      need(fv.preview.note && !/播放中/.test(fv.preview.note),
        '未配置引擎时点「试听一句」，状态行说的是 "' + fv.preview.note + '" —— '
        + '要么它撒谎说在播放（那就是有第二处 browser 回落偷偷接管了），'
        + '要么它一个字都不说（静默失败，用户没有出口）');
      need(/还没配语音引擎/.test(fv.preview.note),
        '未配置的失败要说人话并给出路，实际说的是 "' + fv.preview.note + '"');
      need(fv.checked > 0, '一个引擎都没验到 —— 三个下拉都是空的？这条断言空转了');
      // 这个 flavor 没有可一键的平台时，tabs 整块藏起来、只剩详细档 —— 那是正当状态，
      // 与「两档都在但互斥」是两种不同的正确，分开判。
      if (fv.tabsHidden) {
        need(fv.detail.adv && !fv.detail.card,
          '一键卡渲染不出来时应当只剩详细档，实际 adv=' + fv.detail.adv + ' card=' + fv.detail.card);
      } else {
        need(fv.quick.card && !fv.quick.adv,
          '快速档没有互斥：一键卡 ' + fv.quick.card + '、逐引擎控件仍可见 ' + fv.quick.adv
          + ' —— 两者共存时一键卡显示的「配没配过」当场变成谎话');
        need(fv.detail.adv && !fv.detail.card,
          '详细档没有互斥：逐引擎 ' + fv.detail.adv + '、一键卡仍可见 ' + fv.detail.card);
        need(fv.quick.path, '快速档没有一条可见的路通向详细档 —— 只藏不给路是退化，不是简化');
        need(fv.apply.present, '一键卡里找不到 #qs-key / #qs-apply，这条断言空转了');
        need(fv.apply.kept && fv.apply.sameNode,
          '按下「配好」之后一键卡被重建了：key ' + (fv.apply.kept ? '还在' : '没了')
          + '、输入框' + (fv.apply.sameNode ? '还是原来那个' : '已经换了一个')
          + ' —— 用户看到的就是「粘贴的密码消失」（1.7.14–1.7.16 的真 bug）');
        need(fv.apply.resVisible && fv.apply.rows >= 3,
          '按下「配好」之后看不到自检那几行（visible=' + fv.apply.resVisible + ' rows=' + fv.apply.rows + '）');
      }
      need(fv.bad.length === 0,
        '引擎字段的渲染结果与 EngineFields 的判据不符（' + fv.checked + ' 个引擎里 '
        + fv.bad.length + ' 处）：' + fv.bad.slice(0, 6).join(' · '));
    }

    if (o.syncEnabled) {
      const g = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          // 上一段（引擎字段走查 / 一键配置）已经写过翻译引擎的 key，而解析门**跟随翻译
          // 引擎**（§9.2）—— 自 2026-09-06 设置总线接通后那次写入会即刻传到 LearnNotes，
          // 所以「还没配 key」这个前提要自己造出来：清掉两组引擎键，等总线把门关上。
          await new Promise((r) => chrome.storage.local.remove(
            ['provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel'], () => r()));
          await new Promise((r) => setTimeout(r, 400));
          const before = LearnNotes.capable();
          const sel = document.getElementById('notes-provider');
          const opt = [...sel.options].find((x) => x.value);
          sel.value = opt ? opt.value : '';
          sel.dispatchEvent(new Event('change'));
          const key = document.getElementById('notes-api-key');
          key.value = 'k-live-gate';
          key.dispatchEvent(new Event('change'));
          await new Promise((r) => setTimeout(r, 80));
          return JSON.stringify({ before, after: LearnNotes.capable() });
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const gv = JSON.parse(g.result.value);
      need(!gv.before, '还没配 key 门就开了');
      need(gv.after, '填了 key 门没开 —— 解析要等下次启动才出现，用户会当它是坏的');
    }
    // 密码登录入口只能对演示账号露出（2026-08-28）。产品内没有任何设密码的面，
    // 所以它对普通用户 100% 失败；GoTrue 日志里实证撞了两次，其中一次是一个刚发完
    // 验证码的真实用户，连点三次后再没回来。DOM 里存在 ≠ 用户看得见，所以这里断言的
    // 是 hidden 的实际取值随输入变化，不是元素在不在。
    if (o.syncEnabled) {
      const pw = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const link = document.getElementById('app-use-pw');
          const email = document.getElementById('email');
          const seen = {};
          seen.atRest = link.hidden;
          email.value = 'someone@example.com';
          email.dispatchEvent(new Event('input'));
          await new Promise((r) => setTimeout(r, 30));
          seen.normal = link.hidden;
          email.value = 'belliedmonkey+applereview@gmail.com';
          email.dispatchEvent(new Event('input'));
          await new Promise((r) => setTimeout(r, 30));
          seen.demo = link.hidden;
          return JSON.stringify(seen);
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const pv = JSON.parse(pw.result.value);
      need(pv.atRest, '密码登录入口在首屏就露着 —— 普通用户点了必得「邮箱或密码不对」');
      need(pv.normal, '普通邮箱也露出了密码入口 —— 判据没生效');
      need(!pv.demo, '演示账号（plus-alias）看不到密码入口 —— 这会直接导致 App Review 登录不进去');
    }
    // 复习页空态在 App 里必须说 App 自己的话（2026-08-28）。整段是从扩展的
    // review.html 原样嵌进来的，原文是「打开采集开关」+ 一个跳到 App 设置的链接 ——
    // 而 App 结构上不采集（learn-collector.js 不在 app-bundle 的 MODULES 里），
    // App 设置里也没有采集开关。那是每个点进复习页的人都会撞上的死路。
    if (o.syncEnabled) {
      const em = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          // 走用户的路径：点「开始复习」，让 review.js 的 applyI18n 先跑完，
          // 再看空态说了什么。直接读初始 DOM 会漏掉「被覆盖回扩展文案」这种坏法。
          document.getElementById('review').click();
          await new Promise((r) => setTimeout(r, 200));
          return JSON.stringify({
          body: (document.querySelector('#empty [data-i18n="learn_empty_body"]') || {}).textContent || '',
          tag: (document.getElementById('empty-settings') || {}).tagName || '',
        }); })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const ev = JSON.parse(em.result.value);
      need(!/采集开关|Turn on capture/i.test(ev.body),
        '空态还在让 App 用户「打开采集开关」—— App 不采集，那个开关不存在');
      need(/扩展|extension|拡張|확장|Erweiterung|extensión|extensão|расширени|إضافة/i.test(ev.body),
        '空态没说清材料来自浏览器扩展，用户无从知道下一步做什么');
      need(ev.tag && ev.tag !== 'A',
        '空态那个「去设置」还是个链接 —— 它在 App 里指向没有采集开关的设置页，是死路');
    }
    // ── 会话夹具（2026-10-02，#532）：App 现在以**登录为前提** ────────────────────────────
    // #532 之前，未登录首页就是首页；现在 firstrun.step() 未登录恒为 'login'，横幅与引导
    // 都不渲染。无头环境既没有原生桥，也没有「两个设备包已就绪」。所以这一段给页面造一个
    // 「已登录 + 两个包就绪」的状态（假 token，只驱动渲染、不打后端），好让下面的横幅/引导
    // 判据仍然测得到 —— 它们测的是自己的逻辑，不是登录本身。
    //   会话 → `learnAuth`（chrome.storage.local，shim 垫在 localStorage 上）；
    //   设备包 → 注入脚本把 NativeSpeech.probe / LearnTTS.deviceStatus 桩成 ready。
    if (o.syncEnabled) {
      // 注入脚本在**文档开始**跑，而 bundle 是之后才定义 NativeSpeech / LearnTTS 的 ——
      // 所以不能只设一次（会被 bundle 覆盖回去），要持续把两个「设备包就绪」入口打桩，
      // 覆盖整个 boot 窗口（10s 封顶，免得留在后面）。
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        (() => {
          const patch = () => { try {
            if (window.NativeSpeech && window.NativeSpeech.probe) window.NativeSpeech.probe = async () => ({ ready: true, ok: true });
            if (window.NativeSpeech && window.NativeSpeech.ensureAssets) window.NativeSpeech.ensureAssets = async () => ({ ok: true });
            if (window.LearnTTS && window.LearnTTS.deviceStatus) window.LearnTTS.deviceStatus = async () => ({ ready: true });
            // 夹具会话是假 token：boot 的同步会 401，App 会自己登出并把会话删掉。
            // 门禁要测的不是登录，所以把 signOut 桩成空操作，让会话在场即可。
            // 直接在页面里把「当前会话」钉住：两个 flavor 的 auth 后端不同（global 直连
            // Supabase，china 走 api.belliedmonkey.com，JWT 密钥也不同），任何一方的 token
            // 另一方都不认 —— 而门禁只关心「已登录」这个状态，不关心是哪个后端签的。
            // boot 的 LearnAuth.currentStable() 是唯一读会话的入口，钉它就够。（模板字符串里
            // 注释不许出现反引号。）
            if (window.LearnAuth) {
              const mk = () => ({ accessToken: 'gate-token', refreshToken: null, expiresAt: Date.now() + 60 * 86400e3,
                email: 'gate@example.com', phone: null, userId: 'gate-uid-0001',
                backend: (window.MT_BACKEND && MT_BACKEND.url) || '' });
              window.LearnAuth.current = async () => mk();
              window.LearnAuth.currentStable = async () => mk();
              window.LearnAuth.signOut = async () => {};
            }
            // 后端请求一律按**网络错**拒绝（不是 401）：这样 boot 的同步拿不到 lastOk，
            // browserSideOk 保持 false，macOS 的「扩展未启用 ⇒ 横幅」才有得测；401 会让
            // 会话被清掉、整段夹具塌掉。只包一次，别叠 wrapper。（这段是模板字符串，注释里
            // 不许出现反引号。）
            if (!window.__mtFixtureFetch) {
              window.__mtFixtureFetch = 1;
              const _f = window.fetch;
              window.fetch = function (input) {
                const u = typeof input === 'string' ? input : (input && input.url) || '';
                if (u.indexOf('supabase.co') >= 0) return Promise.reject(new TypeError('fixture: backend blocked'));
                return _f.apply(this, arguments);
              };
            }
          } catch (_) {} };
          patch();
          const iv = setInterval(patch, 10);
          setTimeout(() => clearInterval(iv), 10000);
        })();
      ` }, sessionId);
      // 会话是**假 token**：下面注入脚本把后端请求按网络错拒掉，boot 的同步不会拿到 401，
      // 所以 App 不会自己登出（早先没有那段屏蔽时，假 token 会被 401 清掉）。`backend` 取
      // 页面自己的 MT_BACKEND.url —— 两个 flavor 不同（global 直连 supabase，china 走
      // api.belliedmonkey.com），写死一个另一个就登不进去。真 token 那条路（服务端密钥铸造）
      // 会撞 Supabase 的 OTP 限流、把门禁跑成 flaky，还只对 global 有效。
      await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.set({
        learnAuth: { accessToken: 'gate-token', refreshToken: null, expiresAt: Date.now() + 60 * 86400e3,
          email: 'gate@example.com', phone: null, userId: 'gate-uid-0001',
          backend: (window.MT_BACKEND && MT_BACKEND.url) || '' },
        'tm:on': false, onboardSeen: 1 }, r))`, awaitPromise: true }, sessionId);
      await cdp.send('Page.reload', {}, sessionId);
      await new Promise((r) => setTimeout(r, 1800));
      const sess = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({ signedIn: !document.getElementById('signed-in').hidden, signedOut: !document.getElementById('signed-out').hidden, packs: !document.getElementById('firstrun-packs').hidden, onboard: !document.getElementById('onboard').hidden, backend: (window.MT_BACKEND && MT_BACKEND.url) || '', enabled: !!(window.MT_BACKEND && MT_BACKEND.enabled) })`, returnByValue: true }, sessionId);
      const sv = JSON.parse(sess.result.value);
      if (!sv.signedIn) {
        console.log('  · 会话夹具没落到首页：' + JSON.stringify(sv));
      }
    }

    // 扩展未启用横幅（§引导）。转换器模板的两端接线都在工程里、都接着空气：
    // Swift 调 show(...) 而 bundle 里没有全局 show()，ReferenceError 被静默吞掉；
    // "open-preferences" 处理器现成而全仓库零处发送。这里断言两端都接上了。
    //
    // 平台不对称是**故意**的，也是这条断言的重点：getStateOfSafariExtension 是
    // macOS-only，iOS 既查不到状态也没有深链 —— 给一个跳不过去的按钮比不给更糟。
    if (o.syncEnabled) {
      const eb = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          // 横幅的契约是「不在引导中时」—— 首启会直接进引导，那时它被有意抑制
          // （否则和引导第 3 屏重复）。所以先退出引导，再验横幅。
          document.getElementById('onboard').hidden = true;
          const sec = document.getElementById('ext-banner');
          const act = document.getElementById('ext-banner-act');
          // 上一段把用户领进了复习页。横幅**只属于首页** —— 走用户自己的返回路径
          // 回去，再验它。
          document.getElementById('review-back').click();
          await new Promise((r) => setTimeout(r, 200));
          const snap = () => ({ banner: !sec.hidden, button: !act.hidden,
                                title: document.getElementById('ext-banner-title').textContent });
          const out = { hasShow: typeof window.show === 'function', atRest: snap() };
          if (out.hasShow) {
            window.show('mac', false, true);  await new Promise((r) => setTimeout(r, 20));
            out.macOff = snap();
            // 真机 1.7.0 build 52 实测：横幅与 #review-view 平级，而没有任何代码在
            // 进那个视图时收起它 —— 于是它钉在每一个界面最顶上，在一台已经有 2999
            // 张卡的设备上反复说「先去把扩展打开」。走用户的路径进出一次来验。
            document.getElementById('review').click(); await new Promise((r) => setTimeout(r, 200));
            out.inReview = snap();
            document.getElementById('review-back').click(); await new Promise((r) => setTimeout(r, 200));
            // #177：Swift 侧深链失败会回调 show('mac', false, false) —— 按钮必须收起，
            // 正文退回三步版。给一个点了没反应的按钮，比不给更糟。
            window.show('mac', false, false); await new Promise((r) => setTimeout(r, 20));
            out.macFailed = snap();
            out.macFailedBody = document.getElementById('ext-banner-body').textContent;
            window.show('mac');               await new Promise((r) => setTimeout(r, 20));
            out.macUnknown = snap();
            window.show('mac', false, true);  await new Promise((r) => setTimeout(r, 20));
            window.show('ios');               await new Promise((r) => setTimeout(r, 20));
            out.ios = snap();
            window.show('mac', true, true);   await new Promise((r) => setTimeout(r, 20));
            out.macOn = snap();
          }
          return JSON.stringify(out);
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const b = JSON.parse(eb.result.value);
      need(b.hasShow, '没有全局 show() —— ViewController 的 evaluateJavaScript 会静默失败，'
        + '扩展状态永远传不进页面');
      need(!b.atRest.banner, '还没收到状态就先把横幅显示出来了');

      // 后面几条都依赖 show() 存在；缺了就只报上面那一条，不要级联成一串 TypeError。
      if (b.hasShow) {
        need(b.macOff.banner && b.macOff.button, 'macOS 扩展未启用时应当显示横幅和直达按钮');
        need(!b.inReview.banner, '复习页里还挂着「先把浏览器那半边打通」横幅 —— '
          + '它与 #review-view 平级，进那个视图时必须收起，否则它会钉在每一个界面最顶上');
        need(!!b.macOff.title, '横幅标题是空的');
        need(b.ios.banner && !b.ios.button, 'iOS 上不能给直达按钮 —— '
          + 'SFSafariApplication 是 macOS-only，那个按钮点了跳不过去');
        need(!b.macOn.banner, '扩展已启用还在显示「还没启用」横幅');
        // #177 的两条：深链失败、以及状态还没查出来时，都不许给按钮。
        need(b.macFailed.banner && !b.macFailed.button,
          '深链失败后还留着「打开 Safari 扩展设置」按钮 —— 点了没反应，比不给更糟 (#177)');
        // 收起按钮之后必须补上步骤，否则只是把一条死路换成另一条。
        // #177 要守的是「收起按钮之后必须补上可执行的下一步」。原来的探针拿「文案里
        // 有没有『设置』二字」当代理，而 2026-08-31 起主路线改成了 Safari 自己的
        // 扩展图标 →「管理扩展」（三下，且不用离开当前页面；设置 App 那条降为备选）。
        // 代理过时了，判据本身没变 —— 两条路线任一都算给了下一步。
        need(/管理扩展|管理擴充功能|Manage Extensions|機能拡張を管理|확장 프로그램 관리/i
          .test(b.macFailedBody || '')
          || /Gérer les extensions|Erweiterungen verwalten|Gestionar extensiones|Gerenciar extensões|Управление расширениями|إدارة الإضافات/i
            .test(b.macFailedBody || '')
          || /设置|Settings|設定|설정|Réglages|Einstellungen|Ajustes|Настройки|الإعدادات/i
            .test(b.macFailedBody || ''),
          '深链失败后横幅收了按钮却没给步骤 —— 用户被告知「没启用」，然后无路可走');
        need(!b.macUnknown.button,
          'show(\'mac\') 这个「还不知道状态」的初次调用就给了按钮 —— canOpenPrefs 必须 fail-closed');
      }
    }
    // iOS 形态的横幅（2026-09-10，第八期 A）：5 天遥测里 App 装机 72、Safari 扩展装机 25。
    // 四条：① iOS 下 #ext-banner-setup 不带 secondary 且**渲染背景**是 accent（类名摘掉了
    // 而 CSS 没命中，正是 2026-09-02 扩展侧那个 bug 的形状）；② 首页 + 横幅里恰好一个
    // 填色按钮（#review 降次级）；③ 「我已打开」可见、三步齐全、主按钮落在 320×480 首屏内；
    // ④ 点「我已打开」→ 横幅收起、extBannerDoneAt 落盘、再来一次 show('ios') 仍收起。
    if (o.syncEnabled) {
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 320, height: 480, deviceScaleFactor: 1, mobile: true }, sessionId);
      const ib = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const $ = (id) => document.getElementById(id);
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const sget = (k) => new Promise((r) => chrome.storage.local.get(k, (o) => r(o || {})));
          const srm = (k) => new Promise((r) => chrome.storage.local.remove(k, r));
          await srm(['extBannerDoneAt', 'tm:extBannerDay']);
          $('onboard').hidden = true;
          if (!$('review-view').hidden) { $('review-back').click(); await sleep(200); }
          window.show('ios'); await sleep(20);
          // J18（2026-10-02 真机修订）：扩展引导现在默认**收起**成一行，点开才露出
          // 动作与三步。所以可见性判据要先展开，否则 doneVis / filled 全是 0。
          $('ext-banner-row').click(); await sleep(40);
          const sec = $('ext-banner');
          const bg = (el) => getComputedStyle(el).backgroundColor;
          const vis = (el) => !!(el && el.getClientRects().length);
          const accent = (() => { const d = document.createElement('div');
            d.style.cssText = 'background:var(--accent);position:absolute;left:-9999px';
            document.body.appendChild(d); const v = bg(d); d.remove(); return v; })();
          const filled = [...document.querySelectorAll('#signed-in button, #ext-banner button')]
            .filter(vis).filter((b) => bg(b) === accent).map((b) => b.id);
          const out = { banner: !sec.hidden, title: $('ext-banner-title').textContent,
            setupSecondary: $('ext-banner-setup').classList.contains('secondary'),
            setupFilled: bg($('ext-banner-setup')) === accent, filled,
            doneVis: vis($('ext-banner-done')),
            steps: $('ext-banner-steps').hidden ? 0 : $('ext-banner-steps').children.length,
            reviewSecondary: $('review').classList.contains('secondary'),
            vh: innerHeight, setupBottom: Math.round($('ext-banner-setup').getBoundingClientRect().bottom) };
          $('ext-banner-done').click(); await sleep(60);
          out.afterDone = !sec.hidden;
          out.stored = !!(await sget(['extBannerDoneAt'])).extBannerDoneAt;
          window.show('ios'); await sleep(20);
          out.afterReshow = !sec.hidden;
          out.reviewAfter = $('review').classList.contains('secondary');
          // ⑤ 一次动作即视为问过（2026-09-28，#384 重定）：点**主按钮**也算，此后不再出现。
          // 先走设置页的复位键 —— 它同时清内存里的 extBannerDone 与存储，横幅才会回来
          // （只 srm 存储不动内存，④ 之后 extBannerDone 还是 true，⑤ 的前置会假失败）。
          $('extb-restore').click(); await sleep(60);
          window.show('ios'); await sleep(20);
          out.beforeSetup = !sec.hidden;
          $('ext-banner-setup').click(); await sleep(60);
          out.afterSetup = !sec.hidden;
          out.storedBySetup = !!(await sget(['extBannerDoneAt'])).extBannerDoneAt;
          window.show('ios'); await sleep(20);
          out.afterSetupReshow = !sec.hidden;
          await srm(['extBannerDoneAt', 'tm:extBannerDay']);
          return JSON.stringify(out);
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      if (ib.exceptionDetails) throw new Error("iOS 横幅探针抛错: " + JSON.stringify(ib.exceptionDetails.exception && ib.exceptionDetails.exception.description || ib.exceptionDetails.text));
      const v = JSON.parse(ib.result.value);
      need(v.banner, 'iOS 下横幅没显示（extBannerDoneAt 已清空、不在引导中）');
      need(!!v.title, 'iOS 横幅标题是空的');
      need(!v.setupSecondary && v.setupFilled,
        `iOS 下「在 Safari 里打开扩展」不是填色主按钮（secondary=${v.setupSecondary}, filled=${v.setupFilled}）—— `
        + '#ext-banner 与 #signed-in 平级，那套按钮基样式够不到这里，规则要自己给');
      need(v.filled.length === 1 && v.filled[0] === 'ext-banner-setup',
        `横幅在场时首页应恰好一个填色按钮（ext-banner-setup），实际：${v.filled.join('、') || '无'}`);
      need(v.reviewSecondary, '横幅在场时首页 #review 没降为次级 —— 两个填色按钮并排');
      need(v.doneVis, 'iOS 横幅上没有「我已打开」');

      need(v.steps === 3, `iOS 横幅三步不齐（${v.steps}）`);
      // 2026-10-02（#540 / J18-J19）：扩展引导**故意**降到折叠线以下一行 —— 它的动作
      // 不再要求落在 320×480 首屏内（旧断言 `setupBottom <= vh` 已作废），只要这一行
      // 存在、展开后面板里的动作在 DOM 里就够了。首屏实心按钮的预算由英雄卡那两条管。
      need(!v.afterDone, '点了「我已打开」横幅还在');
      need(v.stored, '点了「我已打开」而 extBannerDoneAt 没落盘 —— 下次打开又会出现');
      need(!v.afterReshow, '点过「我已打开」之后 show(\'ios\') 又把横幅画回来了');
      need(!v.reviewAfter, '横幅收起后 #review 没有恢复为主按钮');
      need(v.beforeSetup, '清空后横幅没回来，⑤ 的前置不成立');
      need(!v.afterSetup, '点了「在 Safari 里打开扩展」横幅还在 —— 一次动作即视为问过（#384 重定）');
      need(v.storedBySetup, '点了主按钮而 extBannerDoneAt 没落盘 —— 重开 App 横幅又会出现');
      need(!v.afterSetupReshow, '点过主按钮之后 show(\'ios\') 又把横幅画回来了');
      await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    }
    // A3：未登录首屏不能是登录墙。40 个外部用户全部经 App 进来、0 激活，
    // 其中 15 个「发了验证码从没验证」—— 多半死在这一屏。冷启动就要邮箱，
    // 而用户还不知道这个 App 是干什么的。
    //
    // 但也**不能反过来假装登录可选**：App 结构上不采集（learn-collector 不在
    // app-bundle 里），材料只能经同步进来，所以未登录的 App 永远是空的。
    // 这两条一起断言：门开着，且说清楚为什么最终仍要登录。
    if (o.syncEnabled) {
      const w = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const forms = document.getElementById('signin-forms');
          const prompt = document.getElementById('signin-prompt');
          const out = { formsHidden: forms.hidden, promptShown: !prompt.hidden,
                        why: document.getElementById('signin-why').textContent,
                        // 2026-09-05：一键登录直接在卡上（藏不藏由原生桥决定，Chrome 里没有桥），
                        // 邮箱是卡上那行链接。断言的是结构，不是可见性。
                        providersInPrompt: !!prompt.querySelector('#btn-apple.provider.apple') && !!prompt.querySelector('#btn-google.provider.google'),
                        emailLinkInPrompt: !!prompt.querySelector('#btn-signin') };
          document.getElementById('btn-signin').click();
          await new Promise((r) => setTimeout(r, 30));
          out.formsAfterClick = !forms.hidden;
          return JSON.stringify(out);
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const wv = JSON.parse(w.result.value);
      need(wv.formsHidden, '未登录首屏直接摊开了登录表单 —— 那就是一堵墙');
      need(wv.promptShown, '未登录首屏没有任何说明 —— 用户不知道这是什么、也不知道下一步');
      // 2026-10-01（#532）：登录说明改成讲**登录换来了什么**（额度到账 + 两个语音包下到本机），
      // 不再是「材料只能靠同步过来」那句。判据只要求它把「为什么」说清楚（非空、够长），
      // 具体措辞由文案评审管 —— 写死某一句会随每次文案调整假红。
      need((wv.why || '').trim().length > 8,
        '登录说明是空的 —— 用户不知道登录换来了什么（#532 之前那句「材料只能靠同步」已改）');
      need(wv.formsAfterClick, '点了登录却展不开表单');
      need(wv.providersInPrompt, '一键登录（Apple / Google）没在说明卡上 —— 又躲回邮箱表单后面了');
      need(wv.emailLinkInPrompt, '「或用邮箱登录」那行链接不在说明卡上');

      // ★ 出境单独同意（2026-09-22，PIPL 第 39 条）。中国版的账号与卡片存在东京，登录就是出境。
      //   判据是**后端收到了什么**，不是框画没画：把 fetch 换成计数器，不勾就提交邮箱表单 ——
      //   发往后端的请求必须是 0；勾上再提交，必须 ≥1（证明拦的是「没同意」，不是表单本来就发不出去）。
      //   期望值由页面自己的配置算（flavor + 后端域名），不按 FLAVOR 写死：境内后端就绪那天
      //   框自己消失，这条也跟着改口，不会变成一条红着的旧规矩。
      const xb = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const $ = (id) => document.getElementById(id);
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const host = (() => { try { return new URL(MT_BACKEND.url).hostname; } catch (_) { return ''; } })();
          const expect = window.MT_FLAVOR === 'china' && MT_BACKEND.enabled && /\\.supabase\\.co$/i.test(host);
          await new Promise((r) => chrome.storage.local.remove('xbConsent', r));
          const realFetch = window.fetch; let calls = 0;
          window.fetch = async (u) => { if (String(u).includes(host)) calls++;
            return new Response('{"error":"gate-stub"}', { status: 500, headers: { 'Content-Type': 'application/json' } }); };
          // 首页卡此刻未必在渲染（首启时引导盖在上面），所以这里问的是它自己的 hidden，不是坐标。
          const out = { expect, boxVis: !$('xb-box').hidden, checked: $('xb-check').checked };
          try {
            $('signin-forms').hidden = false; $('email-form').hidden = false;
            $('email').value = 'gate@example.com';
            $('email-form').requestSubmit(); await wait(200);
            out.callsUnchecked = calls;
            out.errVis = !$('xb-box').querySelector('.xb-err').hidden && !!$('xb-box').querySelector('.xb-err').textContent;
            if (expect) { $('xb-check').click(); await wait(50); }
            out.stored = await new Promise((r) => chrome.storage.local.get(['xbConsent'], (v) => r(!!(v && v.xbConsent))));
            out.obMirrored = $('ob-xb-check').checked;
            $('email-form').requestSubmit(); await wait(300);
            out.callsChecked = calls;
          } finally {
            window.fetch = realFetch;
            await new Promise((r) => chrome.storage.local.remove('xbConsent', r));
            if (expect && $('xb-check').checked) $('xb-check').click();
            $('email').value = ''; $('send').disabled = false;
          }
          return JSON.stringify(out);
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const xv = JSON.parse(xb.result.value);
      need(xv.expect === XB_WANT,
        `出境同意的「需不需要」页面算出来是 ${xv.expect}，包里的后端地址说应当是 ${XB_WANT}（${FLAVOR} 包）—— 只有中国版且后端在境外时才需要`);
      if (xv.expect) {
        need(xv.boxVis, '中国版首页登录卡上没有出境单独同意框 —— 登录即出境，却没问过');
        need(!xv.checked, '出境同意框默认是勾上的 —— 那不叫「单独同意」');
        need(xv.callsUnchecked === 0, `没勾出境同意就提交了邮箱表单，后端收到了 ${xv.callsUnchecked} 个请求 —— 没拦住`);
        need(xv.errVis, '没勾就点登录，拦下了却一句话都没说 —— 用户只会觉得按钮坏了');
        need(xv.stored, '勾了出境同意而 xbConsent 没落盘 —— 下次打开又要再勾');
        need(xv.obMirrored, '首页卡上勾了，引导登录屏那一份没跟着勾 —— 两个框应当是同一个同意');
        need(xv.callsChecked >= 1, '勾上之后提交邮箱表单，后端一个请求都没收到 —— 上面那条「0」证明不了是同意框拦的');
      } else {
        need(!xv.boxVis, `${FLAVOR} 包的登录卡上出现了出境同意框 —— 后端不在境外时它是一句假话`);
        need(xv.callsUnchecked >= 1, `${FLAVOR} 包不勾任何框提交邮箱表单，后端没收到请求 —— 登录被误拦了`);
      }
    }
    // 首次运行引导：五屏走一遍（§引导）。断言的是**每一屏都有话说**、进度条在动、
    // 走完能落到登录表单 —— 而不是元素存不存在。
    //
    // 关键一条：iOS 那屏不能出现直达按钮。SFSafariApplication 是 macOS-only，
    // 在 iOS 上给一个跳不过去的按钮，比老老实实念三步更糟。
    if (o.syncEnabled) {
      // 手机尺寸，取**下限**而不是常见值。窗口默认 1300×900，在那个高度上「按钮被内容
      // 顶出首屏」永远不会发生 —— 而那是用户唯一会遇到它的尺寸。取 320×480 有两个理由：
      // 它是真实机型的下限；而 App 的正文用 -apple-system-body，**跟随系统动态字号**，
      // 把字调大一档就等于把可用高度砍掉一截 —— 无头环境复现不了那个变量，只能靠更小的
      // 视口把余量逼出来。中文文案比英文短两行，390×640 下测出来是 610，看着「刚好够」，
      // 而那个余量在真机上根本不存在（2026-09-01 用户截图里按钮就是没了）。
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 320, height: 480, deviceScaleFactor: 1, mobile: true }, sessionId);
      // ─── 首跑：资源包下完 ⇒ **直接落首页**（2026-10-03 用户裁定）─────────────────
      // 这一块原来靠「走完整个引导、逐屏采」—— 引导屏已整块撤掉（它只剩两个没有内容的键，
      // 外加一屏「登录，顺手领一份免费额度」+「扩展里也要登录一次」，而用户已经登录过了）。
      // 现在采的是**新形状**：不开 #onboard、直接落首页，并把 onboardSeen 落一次。
      // 内联 reset/reopen（它们在本块**之后**才定义 —— 这里引用会踩 TDZ）。
      await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.remove(['onboardSeen', 'onboardResume', 'extBannerDoneAt', 'engineChosen', 'onboardIntent', 'provider', 'apiKey'], () => chrome.storage.local.set({}, r)))`, awaitPromise: true }, sessionId);
      await cdp.send('Page.reload', {}, sessionId);
      await new Promise((r) => setTimeout(r, 1500));
      const frOb = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const $ = (id) => document.getElementById(id);
          const g = (k) => new Promise((r) => chrome.storage.local.get([k], (v) => r((v || {})[k])));
          $('packs-go').click();
          await new Promise((r) => setTimeout(r, 400));
          return JSON.stringify({ onboardHidden: $('onboard').hidden, home: !$('signed-in').hidden,
            packsHidden: $('firstrun-packs').hidden, outHidden: $('signed-out').hidden,
            seen: !!(await g('onboardSeen')) });
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      const fr = JSON.parse(frOb.result.value);
      need(fr.packsHidden && fr.home, '资源包下完之后没有落首页：' + JSON.stringify(fr));
      need(fr.onboardHidden, '引导屏又被打开了 —— 2026-10-03 裁定：就绪直接落首页');
      need(fr.outHidden, '首页出现时登录屏还露着');
      need(fr.seen, '落首页时没有把 onboardSeen 落一次（老客户端与遥测的 step 枚举还读它）');
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
    need(o.ttsModeQuiet,
      '全新安装的 ttsMode 是会出声的那一档 —— 而语音引擎默认未配置，'
      + '那就是一个点了必然失败的播放键（2026-09-04：语音要用户填了引擎才有）');
    need(o.notesPickerCount === o.notesPickerWant,
      '解析引擎选择器与注册表不同步：' + o.notesPickerCount + ' 项，应为 ' + o.notesPickerWant);
    need(!o.notesPickerHasNonChat, '解析引擎选择器混入了非 chat 类引擎 —— 门控按 type，选择器也必须');
    need(o.ttsEngineCount === o.ttsEngineWant && o.ttsEngineWant > 1,
      '语音引擎选择器与注册表不同步：' + o.ttsEngineCount + ' 项，应为 ' + o.ttsEngineWant
      + '（含哨兵项）');
    need(o.sttEngineCount === o.sttEngineWant && o.sttEngineWant > 1,
      '转写引擎选择器与注册表不同步：' + o.sttEngineCount + ' 项，应为 ' + o.sttEngineWant);

    // ─── 档位只管「引擎与密钥」一节（2026-09-17 设置页信息架构；interaction-spec）────────
    // ②③④ 三节与档位无关、永远可见；.adv-only / .quick-only 只许出现在第一节里；四个功能块首行有「依赖」行。
    {
      const r = await cdp.send('Runtime.evaluate', { expression: `(async () => {
        const vis = (el) => !!(el && el.offsetParent !== null); const $ = (id) => document.getElementById(id);
        $('gear').click(); await new Promise((r) => setTimeout(r, 120));
        $('mode-quick').click(); await new Promise((r) => setTimeout(r, 80));
        const pick = () => ({ ttsMode: vis($('tts-mode')), daily: vis($('daily')), listenLang: vis($('listen-my-lang')), videoLang: vis($('subtitle-video-lang')), counts: vis($('settings-counts')),
          ttsEngine: vis($('tts-engine')), sttEngine: vis($('stt-engine')), card: vis($('quick-setup-card')), hint: vis($('app-adv-hint-go')) });
        const quick = Object.assign(pick(), {
          advOutside: [...document.querySelectorAll('#app-settings .adv-only')].filter((e) => !e.closest('#sec-engines')).length,
          quickOutside: [...document.querySelectorAll('#app-settings .quick-only')].filter((e) => !e.closest('#sec-engines')).length,
          deps: ['dep-review', 'dep-drive', 'dep-listen', 'dep-docs'].map((id) => ($(id) || {}).textContent || '') });
        $('mode-detail').click(); await new Promise((r) => setTimeout(r, 80));
        const detail = pick();
        $('mode-quick').click(); $('settings-back').click(); await new Promise((r) => setTimeout(r, 120));   // 收尾：别把设置页留给下面的首页扫描
        return JSON.stringify({ quick, detail });
      })()`, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error('档位作用域断言失败: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
      const m = JSON.parse(r.result.value);
      need(m.quick.ttsMode && m.quick.daily && m.quick.listenLang && m.quick.videoLang && m.quick.counts, '快速档里②③节的控件该可见（语音模式 / 每日新卡 / 对话语言 / 视频语言 / 学习库计数），实际 ' + JSON.stringify(m.quick));
      need(!m.quick.ttsEngine && !m.quick.sttEngine && m.quick.card && !m.quick.hint, '快速档不该露引擎下拉与「一键配置在快速里」、该有一键卡，实际 ' + JSON.stringify(m.quick));
      need(m.quick.advOutside === 0 && m.quick.quickOutside === 0, '.adv-only / .quick-only 只许出现在「引擎与密钥」一节里，实际 adv ' + m.quick.advOutside + ' / quick ' + m.quick.quickOutside);
      need(m.detail.ttsMode && m.detail.daily && m.detail.listenLang && m.detail.counts && m.detail.ttsEngine && m.detail.sttEngine && !m.detail.card && m.detail.hint, '详细档里②③节照旧可见、引擎下拉出来、一键卡收起、顶上有「一键配置在快速里」，实际 ' + JSON.stringify(m.detail));
      need(m.quick.deps.every((x) => /依赖|Needs/.test(x)), '四个功能块首行都该有「依赖」行，实际 ' + JSON.stringify(m.quick.deps));
    }

    // ─── 深浅两色的表面扫描（scripts/lib/sweep.js）：首页、设置页、复习视图 ────────
    // 每段看得见的文字 ≥ 4.5:1。2026-09-06 之前所有门禁只跑浅色、只判「前景 ≠ 背景」。
    await installSweep(cdp, sessionId);
    const sweepView = async (label, prep, scope) => {
      const pr = await cdp.send('Runtime.evaluate', { expression: prep, awaitPromise: true, returnByValue: true }, sessionId);
      if (pr.exceptionDetails) throw new Error(label + ' 准备失败: ' + ((pr.exceptionDetails.exception || {}).description || pr.exceptionDetails.text));
      const bad = await sweepBoth(cdp, sessionId, scope);
      need(bad.length === 0, `【${label}】看不清的文字: ` + bad.slice(0, 6).join(' | ')
        + (bad.length > 6 ? ` …共 ${bad.length} 处` : ''));
    };
    await sweepView('首页', `(async () => { const $ = (id) => document.getElementById(id);
      $('onboard').hidden = true; $('signed-out').hidden = false; return 'ok'; })()`, 'body');
    await sweepView('设置页', `(async () => { const $ = (id) => document.getElementById(id);
      $('signed-out').hidden = true; $('app-settings').hidden = false;
      await settingsModel.notifySettingsShown(null); return 'ok'; })()`, '#app-settings');
    // ─── 未登录复习入口（#386）已退役（2026-10-01，#532）───────────────────────────────
    // App 现在以登录为前提：未登录首屏只剩登录，没有复习入口（材料只能经同步进来）。
    // 那一段 DOM 级判据（#signed-out-review / -btn / -desc）随之删除 —— 「未登录也能用」
    // 这条口径已由 test/app-firstrun.test.js 的 R1（未登录首屏只有登录）接管。

    // ─── 「译成」（2026-09-19）：选了落盘、选回「跟随界面语言」是**删键**、读取走同一个出口 ─────
    // App 此前没有目标语言设置，文档翻译默默译成界面语言。补上之后最要紧的是老用户行为不变：
    // 存储里没有这个键 ⇒ AppTargetLang.resolve 给出的仍是界面语言。
    {
      const tl = JSON.parse((await cdp.send('Runtime.evaluate', { expression: `(async () => {
        const $ = (id) => document.getElementById(id);
        const get = (k) => new Promise((r) => chrome.storage.local.get(k, (s) => r(s || {})));
        const fire = (v) => { $('target-lang').value = v; $('target-lang').dispatchEvent(new Event('change', { bubbles: true })); return new Promise((r) => setTimeout(r, 150)); };
        await new Promise((r) => chrome.storage.local.set({ uiLang: 'zh_CN' }, r));
        const before = await get(['targetLang', 'uiLang']);
        const follow = $('target-lang-follow').textContent;
        await fire('ja'); const afterJa = await get(['targetLang', 'uiLang']);
        const resolvedJa = AppTargetLang.resolve(afterJa, 'en-US');
        await fire(''); const afterFollow = await get(['targetLang', 'uiLang']);
        const resolvedFollow = AppTargetLang.resolve(afterFollow, 'en-US');
        return JSON.stringify({ hadKey: 'targetLang' in before, follow, ja: afterJa.targetLang, resolvedJa, keyGone: !('targetLang' in afterFollow), resolvedFollow,
          options: [...$('target-lang').options].length });
      })()`, awaitPromise: true, returnByValue: true }, sessionId)).result.value);
      need(tl.hadKey === false, '「译成」：全新状态下存储里不该有 targetLang（不播种默认值）');
      need(/简体中文/.test(tl.follow), '「译成」：第一项该写明跟随的是哪门语言，实际「' + tl.follow + '」');
      need(tl.ja === 'ja' && tl.resolvedJa === 'ja', '「译成」：选日语后该落盘并生效，实际 ' + JSON.stringify(tl));
      need(tl.keyGone && tl.resolvedFollow === 'zh-CN', '「译成」：选回「跟随界面语言」该删键并回到界面语言，实际 ' + JSON.stringify(tl));
      need(tl.options === 13, '「译成」：该是 1 + 12 项，实际 ' + tl.options);
    }

    // ─── 界面语言：**首页也要跟随**，冷启动就跟随（2026-09-25）────────────────────────
    //
    // 这条门禁背后那次事故：真机上把「界面语言」设成 English、杀掉 App 重开 ——
    // 设置页是英文，而**首页整块**（产品名下那句 lede、登录卡、分节标题「听」）与
    // **快速翻译面板**还是中文。词条一个不缺；缺的是 `PageI18n.setUiLang` 在这两条
    // 启动路径上从来没被调过 —— 全仓库只有设置页的 change 处理器和 review.js 调它。
    // 于是「进过设置页」的那一半界面是对的，没进过的那一半是错的，看着像随机。
    //
    // **为什么用日语当判据**：跑测试的 Chrome 自己是英文（或中文），拿 'en' 做期望
    // 会在「根本没调 setUiLang」时**照样绿** —— 系统回落恰好也给英文。'ja' 既不是
    // 系统语言也不是回落值（回落是 zh_CN），只有真的读了 uiLang 才可能出现。
    {
      // 期望值**从随包的文案表里取**（`MT_I18N_MESSAGES`），不写死某一句：lede 的文案
      // 2026-10-01 随 #532 换过一次（旧的两句「ブラウザで読んだ文が…」/「Sentences you read…」
      // 已作废）—— 写死就会每改一次文案假红一次。
      await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.set({ uiLang: 'ja' }, r))`, awaitPromise: true }, sessionId);
      await cdp.send('Page.reload', {}, sessionId);
      await new Promise((r) => setTimeout(r, 1800));
      const cold = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({
        brand: (document.getElementById('app-brand') || {}).textContent || '',
        lede: (document.getElementById('lede') || {}).textContent || '',
        ledeJa: (window.MT_I18N_MESSAGES && MT_I18N_MESSAGES.ja && MT_I18N_MESSAGES.ja.app_lede) || '',
        modes: (document.getElementById('modes-label') || {}).textContent || '',
        gear: (document.getElementById('gear') || {}).textContent || '' })`, returnByValue: true }, sessionId);
      const cv = JSON.parse(cold.result.value);
      need(cv.lede && cv.lede === cv.ledeJa, `界面语言：冷启动后首页的 lede 该跟随 uiLang（ja），实际「${cv.lede}」—— 首页没跟随 uiLang`);
      // 产品名原来是写死的 h1（没有 id、没有 data-i18n），整屏都变了它还是中文。
      need(cv.brand === '大肚猴翻訳', `界面语言：首页的产品名该跟随，实际「${cv.brand}」—— 它是不是又变回写死的 h1 了`);
      // 不只量一处：lede 对了而别处没跟上，说明补的那次重画没覆盖整页。
      need(!/[\u4e00-\u9fff]/.test(cv.modes) || cv.modes === '聞く',
        `界面语言：分节标题也该跟随，实际「${cv.modes}」`);
      need(!/^设置$/.test(cv.gear), `界面语言：「设置」入口也该跟随，实际「${cv.gear}」`);

      // 改语言**当场生效**，不等下次启动。设置页是写入方、只重画自己那一节，
      // 首页这一层靠 storage.onChanged 总线接 —— 断了就只有重启才对。
      const live = JSON.parse((await cdp.send('Runtime.evaluate', { expression: `(async () => {
        const sel = document.getElementById('ui-lang');
        sel.value = 'en'; sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 600));
        return JSON.stringify({
          lede: (document.getElementById('lede') || {}).textContent || '',
          ledeEn: (window.MT_I18N_MESSAGES && MT_I18N_MESSAGES.en && MT_I18N_MESSAGES.en.app_lede) || '' });
      })()`, awaitPromise: true, returnByValue: true }, sessionId)).result.value);
      need(live.lede && live.lede === live.ledeEn,
        `界面语言：换成 English 后首页该当场变，实际「${live.lede}」—— onChanged 那条总线没接上`);
      await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.remove(['uiLang'], r))`, awaitPromise: true }, sessionId);
      await cdp.send('Page.reload', {}, sessionId);
      await new Promise((r) => setTimeout(r, 1500));
      // installSweep 走 Runtime.evaluate，**重载一次就没了**，而后面还有清扫要跑。
      // 不装回来的症状是「__sweep is not defined」，看着像清扫本身坏了。
      await installSweep(cdp, sessionId);
    }

    await sweepView('复习视图', `(async () => { const $ = (id) => document.getElementById(id);
      $('app-settings').hidden = true; $('review-view').hidden = false;
      await LearnReview.start(); return 'ok'; })()`, '#review-view');

    // ─── 冷启动：点过「我已打开」之后**重开 App**，横幅不能回来（2026-09-11 全回归 F 面）────
    // 真机/模拟器上 Swift 在 didFinish 里就调 window.show('ios')，早于 app.js 里那次
    // 异步的 extBannerDoneAt 预读；预读完成后未登录路径没有再画一次横幅，于是它一直挂着。
    // 这里照原样复刻：新文档一 DOMContentLoaded 就 show('ios')，再等初始化落定后读横幅。
    if (o.syncEnabled) {
      await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.set({ extBannerDoneAt: Date.now(), onboardSeen: 1 }, r))`, awaitPromise: true }, sessionId);
      const inj = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { try { window.show('ios'); } catch (_) {} });` }, sessionId);
      await cdp.send('Page.reload', {}, sessionId);
      await new Promise((r) => setTimeout(r, 1800));
      const cold = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({ banner: !document.getElementById('ext-banner').hidden, signedOut: !document.getElementById('signed-out').hidden, onboard: !document.getElementById('onboard').hidden })`, returnByValue: true }, sessionId);
      const cv = JSON.parse(cold.result.value);
      need(!cv.onboard, '冷启动探针：引导屏不该出现（onboardSeen 已写）');
      need(!cv.banner, `冷启动（原生 show('ios') 早于 extBannerDoneAt 预读）后横幅又回来了：${JSON.stringify(cv)}`);
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier }, sessionId).catch(() => {});
      await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.remove(['extBannerDoneAt', 'onboardSeen'], r))`, awaitPromise: true }, sessionId);
    }

    // ─── 「以后再设置」只记这一次（2026-09-22，画布「以后再设置只记这一次」，用户点头）────────────
    // 判据要**真的重开 App**（重载页面；存储是 localStorage，重载后还在），逐次读回：
    //   跳过 → 不写 onboardSeen、记下停在哪屏 → 重开出「继续设置」卡而不是整条引导、横幅让路 →
    //   点继续回到那一屏 → 第 4 次重开自己收起并永久记上 · ✕ 当场永久 · 已有引擎就根本不出。
    if (o.syncEnabled) {
      const E = async (x) => JSON.parse((await cdp.send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }, sessionId)).result.value);
      const reopen = async () => { await cdp.send('Page.reload', {}, sessionId); await new Promise((r) => setTimeout(r, 1500)); };
      const store = `new Promise((r) => chrome.storage.local.get(['onboardSeen', 'onboardResume'], (v) => r(JSON.stringify(v || {}))))`;
      const view = `JSON.stringify({ onboard: !document.getElementById('onboard').hidden, step: document.body.dataset.obStep || '',
        card: !document.getElementById('ob-resume').hidden, title: document.getElementById('ob-resume-title').textContent,
        banner: !document.getElementById('ext-banner').hidden })`;
      // engineChosen 也要清（PR9）：「继续设置」卡判「这台设备配好没有」走
      // EngineState.needsSetup，它读 engineChosen。旧手抄 KEYS 恰好漏了这个键，
      // 卡永远看不见它；schema 收编后 readObSettings 读全了，前面块里领额度 /
      // 一键卡写下的 engineChosen:1 会让这张卡（正确地）判定「已配好」而收起 ——
      // 夹具要的既是「全新设备」，就得把判据的每个输入都清掉。
      const reset = (extra) => `new Promise((r) => chrome.storage.local.remove(['onboardSeen', 'onboardResume', 'extBannerDoneAt', 'engineChosen', 'onboardIntent', 'provider', 'apiKey'], () => chrome.storage.local.set(${extra || '{}'}, r)))`;
      // 原生侧在 didFinish 里调 show('ios')：不照样复刻，横幅在无头环境里本来就不出，
      //「卡在场时横幅让路」那条断言会空转（第一版证伪时摘掉让路逻辑它照样绿）。
      const injR = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { try { window.show('ios'); } catch (_) {} });` }, sessionId);
      // ─── 「以后再设置」/「继续设置」卡（#386 时代）已退役（2026-10-01，#532）──────────────
      // 跳过引导不再留一张「继续设置」卡；onboardResume 那套判据连同 #ob-resume 的 DOM 一起删。
      // 下面「我只要网页翻译 / 意图分叉 / 都要」几段仍然有效：它们走 reset() + reopen() 的
      // 真实启动路径，落到引导第 1 屏后读 dataset.obStep。
      // ─── 首屏默认「听」（2026-10-02 用户裁定 #547）───────────────────────────────
      // 这一屏**不再给选项**：没有引擎 chips、没有三条用途出口。离开首屏那一下记
      // onboard_intent{goal:'listen'} + 落盘 onboardIntent，首页的扩展横幅据此让路；
      // 网页翻译的配置引导只留在设置页（#webext-setup）。
      // 判据是**页面上的结构** + **队列里真有那条** + **落盘** + **首页真的没横幅**。
      await cdp.send('Runtime.evaluate', { expression: reset(), awaitPromise: true }, sessionId);
      // reset() 只清 onboardSeen 那几个键，**不清 tm:queue** —— 前面几块攒下的行会跟着进来，
      // 于是 `n` 数出来是 2（2026-10-03 实测）。这一块只关心自己这几秒，先把队列清空。
      await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.remove(['tm:queue'], r))`, awaitPromise: true }, sessionId);
      await reopen();
      const it = await E(`(async () => {
        try { window.MT_TELEMETRY.allowAutomation = true; } catch (_) {}
        await new Promise((r) => chrome.storage.local.set({ 'tm:on': true }, r));
        await new Promise((r) => chrome.storage.local.remove(['tm:queue', 'onboardIntent'], r));
        const $ = (id) => document.getElementById(id);
        const vis = (el) => !!(el && el.getClientRects().length);
        // packs 就绪 ⇒ boot 落首页，引导要经屏 2 的 handler 才打开。
        $('packs-go').click();
        await new Promise((r) => setTimeout(r, 300));
        const step0 = document.body.dataset.obStep || '';
        const exits = ['ob-webonly', 'ob-intent-listen', 'ob-intent-both'].filter((id) => vis($(id))).length;
        const hasChips = !!$('ob-engines');
        $('ob-next').click();
        await new Promise((r) => setTimeout(r, 400));
        const after = document.body.dataset.obStep || '';
        const q = await new Promise((r) => chrome.storage.local.get(['tm:queue', 'onboardIntent'], (v) => r(v || {})));
        const intents = (q['tm:queue'] || []).filter((x) => x && x.name === 'onboard_intent');
        window.show('ios'); await new Promise((r) => setTimeout(r, 30));
        const banner = !$('ext-banner').hidden;
        return JSON.stringify({ step0, exits, hasChips, after, stored: q.onboardIntent || '', n: intents.length,
          props: intents.length ? intents[0].props : null, banner,
          settingsEntry: !!$('webext-setup'),
          hasSpec: !!(window.MT_TELEMETRY && window.MT_TELEMETRY.spec) });
      })()`);
      need(it.step0 === '', '引导屏撤了之后不该再有 obStep：' + JSON.stringify(it));
      need(it.exits === 0, '首屏还有用途出口 —— 2026-10-02 裁定「不再给选项」：' + JSON.stringify(it));
      need(!it.hasChips, '首屏还有引擎 chips（#ob-engines）—— 不再让用户挑模型：' + JSON.stringify(it));
      // 2026-10-03：没有「离开首屏」这回事了 —— 资源包下完就落首页（上面那一段钉着）。
      need(it.stored === 'listen', '离开首屏没把默认 onboardIntent=listen 落盘：' + JSON.stringify(it));
      need(it.settingsEntry, '设置页没有网页翻译配置入口（#webext-setup）—— 它只该在设置页');
      if (it.hasSpec) {
        need(it.props && it.props.goal === 'listen', '没记下 onboard_intent{goal:listen}：' + JSON.stringify(it));
        need(it.n === 1, '一次离开记了 ' + it.n + ' 条 onboard_intent —— 应当只有一条');
      } else {
        need(it.n === 0, '中国版产物里竟然攒出了 ' + it.n + ' 条 onboard_intent');
      }
      // 默认「听」⇒ 首页不挂扩展横幅（interaction-spec「迎新页意图分叉」）。
      need(!it.banner, '默认「听」的人首页仍挂着扩展横幅 —— 他不要浏览器扩展');

      // ─── 登录失败埋点（telemetry-design §3.14）：交换那条路真的会记一条 auth_fail ──────
      // 判据是**队列里真有那条**，不是「代码里有 track 调用」—— 客户端 shape() 会把白名单外的
      // 值整条丢掉，服务端也会整条拒（同上面 onboarding 两条的理由）。打断 fetch = 真机上
      // 「连不上服务器」那一类（code:offline / http:0），正是要能读出来的那一种。
      await cdp.send('Runtime.evaluate', { expression: reset(), awaitPromise: true }, sessionId);
      await reopen();
      const af = await E(`(async () => {
        try { window.MT_TELEMETRY.allowAutomation = true; } catch (_) {}
        await new Promise((r) => chrome.storage.local.set({ 'tm:on': true }, r));
        await new Promise((r) => chrome.storage.local.remove(['tm:queue'], r));
        const realFetch = window.fetch;
        window.fetch = () => Promise.reject(new Error('Load failed'));   // 模拟连不上
        let err = null;
        try { await window.LearnAuth.signInWithIdToken('apple', 'tok', 'nonce'); } catch (e) { err = String(e && e.code); }
        window.fetch = realFetch;
        // track() 是**异步**入队（先 await enabled()，再读-改-写队列）—— 不等一下读到的永远是空。
        await new Promise((r) => setTimeout(r, 400));
        const q = await new Promise((r) => chrome.storage.local.get(['tm:queue'], (v) => r((v || {})['tm:queue'] || [])));
        const rows = q.filter((x) => x && x.name === 'auth_fail');
        return JSON.stringify({ err, n: rows.length, props: rows.length ? rows[0].props : null,
          hasSpec: !!(window.MT_TELEMETRY && window.MT_TELEMETRY.spec) });
      })()`);
      need(af.err === 'offline', '把 fetch 打断之后 signInWithIdToken 没抛 offline：' + JSON.stringify(af));
      if (af.hasSpec) {
        need(af.props && af.props.provider === 'apple' && af.props.stage === 'id_token'
          && af.props.code === 'offline' && af.props.http === 0,
          'auth_fail 没记对（provider/stage/code/http）：' + JSON.stringify(af));
        need(af.n === 1, '一次失败记了 ' + af.n + ' 条 auth_fail —— 应当只有一条');
      } else {
        need(af.n === 0, '中国版产物里竟然攒出了 auth_fail —— Gate D 说好一个字节都不发');
      }

      // ─── 设置页文字不许出界：**12 语种 × 最窄视口**（2026-10-03，设计稿已签）────────────
      // 真机截图：长文案把 .sgroup 顶破。这里逐语种把设置页打开，量每张卡片的
      // scrollWidth 是否超过 clientWidth（>1px 就是出界）。语种取自 #ui-lang 的真实 option。
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 320, height: 480, deviceScaleFactor: 1, mobile: true }, sessionId);
      const uiLangs = await E(`JSON.stringify([...document.getElementById('ui-lang').options].map((o) => o.value).filter(Boolean))`);
      const over = [];
      for (const loc of uiLangs) {
        await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.set({ uiLang: '${loc}' }, r))`, awaitPromise: true }, sessionId);
        await cdp.send('Page.reload', {}, sessionId);
        await new Promise((r) => setTimeout(r, 900));
        const r1 = (await E(`(async () => {
          const gear = document.getElementById('gear'); if (gear) gear.click();
          await new Promise((r) => setTimeout(r, 500));
          const cards = [...document.querySelectorAll('#app-settings .sgroup')].filter((c) => c.getClientRects().length);
          // 主判据＝**几何越界**（设计稿：scrollWidth 在 direction:rtl 下不记左侧溢出，只能作第二重）。
          // 每个可见后代都与卡片的内容盒（padding/border 之内）比左右两边，任一边超出 1px 即出界。
          const bad = [];
          cards.forEach((c, i) => {
            const cr = c.getBoundingClientRect();
            const cs = getComputedStyle(c);
            const L = cr.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
            const R = cr.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
            for (const el of c.querySelectorAll('*')) {
              if (!el.getClientRects().length) continue;
              const r = el.getBoundingClientRect();
              if (!r.width) continue;
              if (r.left < L - 1 || r.right > R + 1) {
                bad.push({ i, tag: el.tagName, id: el.id || '', left: Math.round(r.left - L), right: Math.round(r.right - R) });
                break;
              }
            }
            if (c.scrollWidth > c.clientWidth + 1) bad.push({ i, hint: 'scrollWidth', sw: c.scrollWidth, cw: c.clientWidth });
          });
          return JSON.stringify({ n: cards.length, bad });
        })()`));
        if (r1.n === 0) over.push(loc + ':没有量到卡片');
        else if (r1.bad.length) over.push(loc + ':' + JSON.stringify(r1.bad));
      }
      await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
      need(over.length === 0,
        '这些语种在 320px 下卡片被文字顶破（scrollWidth > clientWidth）：' + over.join(' | '));

      // ─── 误点了「我已打开」：设置里能把首页横幅找回来（画布 YEDD4VmT9Pv2htUpoWZ9ZB 板 ⑤）────
      await cdp.send('Runtime.evaluate', { expression: reset(`{ onboardSeen: 1, extBannerDoneAt: Date.now() }`), awaitPromise: true }, sessionId);
      await reopen();
      const bview = `JSON.stringify({ banner: !document.getElementById('ext-banner').hidden, settings: !document.getElementById('app-settings').hidden,
        group: !document.getElementById('g-extbanner').hidden, note: document.getElementById('extb-note').textContent,
        btn: !document.getElementById('extb-restore').hidden, done: !document.getElementById('extb-done').hidden,
        doneText: document.getElementById('extb-done').textContent, label: TranslationCore.t('app_ext_done', '我已打开') })`;
      const r0 = await E(bview);
      need(!r0.banner, '点过「我已打开」重开 App，横幅又出现了（前提不成立，下面几条会空转）：' + JSON.stringify(r0));
      await cdp.send('Runtime.evaluate', { expression: `(async () => { document.getElementById('gear').click(); await new Promise((r) => setTimeout(r, 400)); return 1; })()`, awaitPromise: true }, sessionId);
      const r1 = await E(bview);
      need(r1.settings && r1.group && r1.btn, '点过「我已打开」之后，设置里没有「Safari 扩展」那一组：' + JSON.stringify(r1));
      need(!/\{done\}/.test(r1.note) && r1.note.includes(r1.label), '「Safari 扩展」那一组说明没把按钮原话填进去：' + JSON.stringify(r1));
      await cdp.send('Runtime.evaluate', { expression: `(async () => { document.getElementById('extb-restore').click(); await new Promise((r) => setTimeout(r, 200)); return 1; })()`, awaitPromise: true }, sessionId);
      const r2 = await E(bview), st2 = await E(`new Promise((r) => chrome.storage.local.get(['extBannerDoneAt', 'tm:extBannerDay'], (v) => r(JSON.stringify(v || {}))))`);
      need(r2.done && r2.doneText && !r2.btn, '点了「重新显示」没有就地说已恢复：' + JSON.stringify(r2));
      need(!('extBannerDoneAt' in st2) && !('tm:extBannerDay' in st2), '点了「重新显示」存储里的标记还在：' + JSON.stringify(st2));
      await cdp.send('Runtime.evaluate', { expression: `(async () => { document.getElementById('settings-back').click(); await new Promise((r) => setTimeout(r, 300)); return 1; })()`, awaitPromise: true }, sessionId);
      const r3 = await E(bview);
      need(r3.banner, '在设置里恢复之后回到首页，横幅没有当场出现：' + JSON.stringify(r3));
      await cdp.send('Runtime.evaluate', { expression: `(async () => { document.getElementById('gear').click(); await new Promise((r) => setTimeout(r, 400)); return 1; })()`, awaitPromise: true }, sessionId);
      const r4 = await E(bview);
      need(!r4.group, '没点过「我已打开」（已恢复）时设置里还挂着那一组 —— 一个什么都不会发生的按钮');
      await cdp.send('Runtime.evaluate', { expression: `document.getElementById('settings-back').click()`, awaitPromise: true }, sessionId);

      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injR.identifier }, sessionId).catch(() => {});
      await cdp.send('Runtime.evaluate', { expression: reset(), awaitPromise: true }, sessionId);
    }
  } catch (e) { ok = false; console.log('  ✗ ' + (e && e.stack)); }
  chrome.cleanup(); srv.close();
  console.log(ok ? `\n✓ App 页面在真实引擎里起得来，模块齐全，样式已加载（${FLAVOR}）` : '\n✗ App 页面有问题');
  process.exit(ok ? 0 : 1);
})();
