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
          'LearnTTS','LearnDrain','MT_I18N_MESSAGES','PageI18n','PageSettings','AppSettings',
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
          'clean-known','settings-signout','delete-account','gear','gear2',
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
            doneVis: vis($('ext-banner-done')), checkVis: vis($('ext-banner-check')),
            steps: $('ext-banner-steps').hidden ? 0 : $('ext-banner-steps').children.length,
            reviewSecondary: $('review').classList.contains('secondary'),
            vh: innerHeight, setupBottom: Math.round($('ext-banner-setup').getBoundingClientRect().bottom) };
          $('ext-banner-done').click(); await sleep(60);
          out.afterDone = !sec.hidden;
          out.stored = !!(await sget(['extBannerDoneAt'])).extBannerDoneAt;
          window.show('ios'); await sleep(20);
          out.afterReshow = !sec.hidden;
          out.reviewAfter = $('review').classList.contains('secondary');
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
      need(v.checkVis, 'iOS 横幅上没有「不确定？打开检测页看绿灯」那句');
      need(v.steps === 3, `iOS 横幅三步不齐（${v.steps}）`);
      need(v.setupBottom !== null && v.setupBottom <= v.vh,
        `320×480 下横幅主按钮底边在 ${v.setupBottom}px，视口只有 ${v.vh}px —— 插图把动作顶出首屏了`);
      need(!v.afterDone, '点了「我已打开」横幅还在');
      need(v.stored, '点了「我已打开」而 extBannerDoneAt 没落盘 —— 下次打开又会出现');
      need(!v.afterReshow, '点过「我已打开」之后 show(\'ios\') 又把横幅画回来了');
      need(!v.reviewAfter, '横幅收起后 #review 没有恢复为主按钮');
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
      need(/同步|sync|同期|동기|synchron|sincroniz|синхрон|مزامنة/i.test(wv.why),
        '登录说明没讲清「材料只能靠同步过来」—— 那会让登录看起来像可选的');
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
      const ob = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const $ = (id) => document.getElementById(id);
          const sec = $('onboard');
          sec.hidden = false; $('signed-out').hidden = true;
          window.show('ios');                        // 先把平台设成 iOS
          await new Promise((r) => setTimeout(r, 20));
          const seen = [];
          const vis = (el) => !!(el && el.getClientRects().length);
          // 按**页面自报的屏名**走（document.body.dataset.obStep），不是固定点 5 次。
          // 原来的写法「for (i < 5)」再断言「seen.length === 5」，数的是循环次数不是屏数 ——
          // 屏数变了它照样是 5（最后一屏被采两遍），**结构上就红不了**。2026-09-22 登录屏
          // 挪到第 2 屏之后，「那一屏点了只翻页、根本不登录」就是这样溜进 main 的。
          for (let i = 0; i < 8; i++) {
            const step = document.body.dataset.obStep || '';
            const kv = $('ob-kv').hidden ? [] : $('ob-kv').querySelectorAll('div span');
            // 「就地试一句」：没有引擎时点「翻这一句」，必须**说出一句话**，不是空着、不是一直「正在翻译…」。
            let tryRes = null;
            if (step === 'firstuse') {
              const src = $('ob-try-src'), out = $('ob-try-out');
              tryRes = { shown: vis($('ob-try')), src: src ? src.textContent : '',
                         tr: vis($('ob-try-tr')), say: vis($('ob-try-say')) };
              const setS = (o) => new Promise((r) => chrome.storage.local.set(o, r));
              const clickAndWait = async () => {
                $('ob-try-tr').click();
                for (let k = 0; k < 60; k++) {
                  await new Promise((r) => setTimeout(r, 50));
                  if (!out.hidden && !$('ob-try-tr').disabled) break;
                }
                return { out: out.hidden ? '' : out.textContent, cls: out.className,
                         stuck: $('ob-try-tr').disabled };
              };
              // **两个场景都钉死状态**，不靠环境碰巧。第一版只点一次、断言「结果是 bad」——
              // 而这里设置是空的、国际版默认引擎是不用 key 的 Google，于是它走的根本不是
              // 「没有引擎」那一支，是「真去翻、无头环境连不上外网、报错」：测的是环境。
              const keep = await new Promise((r) => chrome.storage.local.get(['provider', 'apiKey'], (v) => r(v || {})));
              // ① 没有引擎：选一个必须填 key 的引擎、key 留空
              await setS({ provider: 'deepseek', apiKey: '' });
              tryRes.none = await clickAndWait();
              // ② 有引擎：给 key、把传输桩掉 —— 判据是「译文落到结果行」，不是去打外网
              const realTr = TranslationAPI.translate;
              TranslationAPI.translate = async () => '【桩】这是一句译文';
              await setS({ provider: 'deepseek', apiKey: 'sk-gate-0123456789' });
              try { tryRes.okRun = await clickAndWait(); } finally { TranslationAPI.translate = realTr; }
              await new Promise((r) => chrome.storage.local.remove(['provider', 'apiKey'], r));
              if (keep.provider || keep.apiKey) await setS(keep);
            }
            // 出境同意：登录屏上那一份在不在；不勾点主按钮，必须**原地不动**（不登录、不结束引导）。
            let xbOb = null;
            if (step === 'signin') {
              xbOb = { vis: !!$('ob-xb-box').getClientRects().length };
              if (xbOb.vis && !$('ob-xb-check').checked) {
                $('ob-next').click(); await new Promise((r) => setTimeout(r, 50));
                xbOb.stayed = document.body.dataset.obStep === 'signin' && !sec.hidden;
                xbOb.err = !!$('ob-xb-box').querySelector('.xb-err').getClientRects().length;
              }
            } else xbOb = { vis: !!$('ob-xb-box').getClientRects().length };
            seen.push({ step, tryRes, xbOb, nextText: vis($('ob-next')) ? $('ob-next').textContent : '',
                        // 第一屏改版（画布板 B2，2026-09-24）：引擎名一行、出口、主按钮下那句话。
                        // 逐屏采，不是走完之后回头找 —— 回头找会读到最后一屏（同上面那条教训）。
                        chips: $('ob-engines').hidden ? [] : [...$('ob-engines').querySelectorAll('span')].map((x) => x.textContent),
                        exitText: vis($('ob-webonly')) ? $('ob-webonly-text').textContent : '',
                        hintText: $('ob-hint').hidden ? '' : $('ob-hint').textContent,
                        alt: vis($('ob-alt')) ? $('ob-alt').textContent : '',
                        title: $('ob-title').textContent, text: $('ob-text').textContent,
                        w: $('ob-fill').style.width, prefs: !$('ob-prefs').hidden,
                        steps: $('ob-steps').hidden ? 0 : $('ob-steps').children.length,
                        next: !$('ob-next').hidden,
                        // 每个可见行动键的**渲染背景**，以及页面自己解析出来的 accent。
                        // 判据不能是类名：secondary 挂对了而 CSS 没命中，正是
                        // 2026-09-02 扩展侧那个 bug 的形状。
                        // e977a51 那次「实测背景是 rgb(198,113,57)」是人工验的，
                        // 没落成门禁 —— 这就是补上的那一条。
                        accentBg: (() => {
                          const d = document.createElement('div');
                          d.style.cssText = 'background:var(--accent);position:absolute;left:-9999px';
                          document.body.appendChild(d);
                          const v = getComputedStyle(d).backgroundColor; d.remove(); return v;
                        })(),
                        // ob-alt / ob-try-* 是 2026-09-22 加的：页脚外的按钮不纳入，
                        // 这一条就看不见「翻这一句」与「继续」两个填色按钮并排。
                        btns: ['ob-prefs', 'ob-setup', 'ob-next', 'ob-alt', 'ob-skip', 'ob-try-tr', 'ob-try-say']
                          .filter((id) => !!($(id) && $(id).getClientRects().length))
                          .map((id) => ({ id, bg: getComputedStyle($(id)).backgroundColor })),
                        // 「以后再设置」必须**渲染成文字链**，不是第三个等宽按钮（#386 画布，
                        // 照 ext 屏 2026-09-02「等宽灰按钮」那次先例）。判据是渲染出来的样子，
                        // 不是类名 —— class="link" 挂着而规则没命中，正是 2026-09-24 真机
                        // 上看到的那个形状（#onboard 不在 button.link 的 :where 名单里）。
                        // ⚠️ 这一整段在模板字符串里，注释里也不许出现反引号。
                        skip: (() => {
                          const el = $('ob-skip');
                          if (!el || !el.getClientRects().length) return null;
                          const cs = getComputedStyle(el);
                          return { bg: cs.backgroundColor, border: cs.borderTopWidth,
                                   deco: cs.textDecorationLine,
                                   w: Math.round(el.getBoundingClientRect().width),
                                   nextW: $('ob-next') && $('ob-next').getClientRects().length
                                     ? Math.round($('ob-next').getBoundingClientRect().width) : 0 };
                        })(),
                        // 「首屏看不看得见能点的东西」。判据是渲染坐标：#onboard 的父级
                        // #app 是普通 block，所以 flex 那条高度链是断的，overflow 也好
                        // sticky 也好，都可能静默失效 —— 失效的样子就是这个数字大过视口。
                        fold: (() => {
                          const vis = (el) => !!(el && el.getClientRects().length);
                          const n = $('ob-next'), t = $('ob-setup');
                          const key = vis(n) ? n : (vis(t) ? t : null);
                          return { vh: innerHeight,
                            key: key ? Math.round(key.getBoundingClientRect().bottom) : null };
                        })(),
                        // 引擎说明只在「浏览器里的两件事」那屏存在，必须当场取 ——
                        // 循环结束后再读会读到最后一屏的卡片，断言就永远空转。
                        kv0: kv.length ? kv[0].textContent : '' });
            // 'ext' 那一屏**没有「继续」**：主行动是「在网页上完成设置」，它同时前进
            // 一屏。所以遍历也得走那个按钮 —— 照旧点 ob-next 会卡死在那一屏，而门禁
            // 会报成「屏数不对」，指向完全错误的原因。
            // 最后一屏（ext）不点：它的主按钮是收尾键，点了会结束引导、开外链。
            if (step === 'ext' || sec.hidden) break;
            // 登录屏走「先不登录」：它的主按钮是**真的去登录**（无头环境里没有 Apple 桥，
            // 会退到邮箱 = 结束引导），而那正是这一屏该有的样子。
            const btn = step === 'signin' ? $('ob-alt')
              : ($('ob-next').hidden ? $('ob-setup') : $('ob-next'));
            btn.click(); await new Promise((r) => setTimeout(r, 30));
          }
          // 「继续」在不在，必须在**主循环里逐屏采**。原来我另起了一个循环回头找那一屏
          // —— 它会把引导又点走一遍，于是这一条和横幅那一条读到的都是走完之后的状态，
          // 两条一起报假失败，而报的原因完全指向别处。
          const extScreen = seen.find((x) => x.steps > 0);
          const out2 = { seen,
            extScreenHasNext: extScreen ? extScreen.next : null,
            hasLangScreen: seen.some((x) => x.title === '学习语言'),
            bannerDuringOb: !document.getElementById('ext-banner').hidden };
          // 收拾干净：这一段把 #onboard 打开了，不还原的话后面的横幅断言会被
          // paintExtBanner 的「引导进行中不挂横幅」抑制掉，报成假失败。
          sec.hidden = true;
          // 「可以先用免费通道」这句只有在注册表真有 needsKey:false 的引擎时才成立。
          // 中国版一个都没有（google 是 global-only），说了就是假话 ——
          // 与 1.6.4 那次「中国版默认引擎不在自己注册表里」同一种形状。
          out2.backendOn = !!(window.MT_BACKEND && window.MT_BACKEND.enabled);
          out2.providerCount = (window.MT_PROVIDERS || []).length;
          out2.providerLabels = (window.MT_PROVIDERS || []).map((x) => String((x && x.label) || ''));
          out2.freeChannel = (window.MT_PROVIDERS || []).some((x) => x && !x.needsKey);
          out2.engineNote = seen.map((x) => x.kv0).filter(Boolean).join(' | ');
          return JSON.stringify(out2);
        })()`, awaitPromise: true, returnByValue: true }, sessionId);
      await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
      const ov = JSON.parse(ob.result.value);
      const seen = ov.seen;
      // 引导进行中不能同时挂着扩展横幅 —— 那会把同一句话说两遍。
      // 这条是模拟器实测抓出来的：断言查内容对不对，查不出重复。
      // 引导里不许再推荐免费通道 —— 无论这个 flavor 的注册表里有没有免费条目。
      //
      // 这条原来只在**没有**免费条目时才检查（防「中国版说着一个它没有的东西」）。
      // 2026-09-01 裁定之后它对两个 flavor 都成立：决策不为免费通道开特例，第一优先级
      // 是一键配置，而「没有 Key 也能先用」这句话的作用正是劝人别配。
      // 免费引擎仍然选得到，只是不再由我们推荐 —— 那是用户的选择，不是我们的建议。
      need(ov.providerCount > 0, 'window.MT_PROVIDERS 读不到 —— 下面那条断言会空转');
      need(!!ov.engineNote, '没抓到引擎说明文案 —— 断言会空转');
      need(!/免费通道|free channel|無料|무료|gratuit|kostenlos|gratis|бесплат|المجانية/i.test(ov.engineNote || ''),
        '引导里又出现了「可以先用免费通道」—— 2026-09-01 裁定：不再推荐它');
      need(!ov.bannerDuringOb, '引导进行中还挂着扩展横幅 —— 第 3 屏说的就是这件事，'
        + '两个一起显示等于把同一句话一字不差地重复一遍');
      // 2026-09-22 屏序：welcome → signin → firstuse → ext（signin 按 MT_BACKEND.enabled）。
      const order = seen.map((x) => x.step).join(' → ');
      const want = ov.backendOn ? 'welcome → signin → firstuse → ext' : 'welcome → firstuse → ext';
      need(order === want, `引导屏序是「${order}」，期望「${want}」`);
      // ★ 登录屏的主按钮**不许是「继续」**。它原来能登录，是因为它是最后一屏、那个按钮其实
      //   是「结束引导、落到首页登录卡上」；挪到中间之后若没跟着改，这一屏就只是一张说明，
      //   点了只翻页。判据与语种无关：拿「就地试一句」那屏的「继续」来比。
      const si = seen.find((x) => x.step === 'signin');
      const fu = seen.find((x) => x.step === 'firstuse');
      if (ov.backendOn) {
        need(si && si.nextText && fu && si.nextText !== fu.nextText,
          '登录屏的主按钮是「' + (si && si.nextText) + '」—— 与普通的「继续」一样，点了只会翻页、不会登录');
        need(si && !!si.alt, '登录屏没有「先不登录」—— 不想登录的人只能整条引导跳过');
        need(si && !/最后一步/.test(si.title), '登录屏标题还写着「最后一步」—— 它已经不是最后一屏了');
        const xbWant = XB_WANT;
        need(si && si.xbOb && si.xbOb.vis === xbWant,
          `引导登录屏${xbWant ? '没有' : '出现了'}出境单独同意框（${FLAVOR} 包）`);
        if (xbWant) {
          need(si.xbOb.stayed, '引导登录屏上没勾出境同意就点了登录，引导却往下走了 —— 没拦住');
          need(si.xbOb.err, '引导登录屏上没勾就点登录，拦下了却没说为什么');
        }
        need(!seen.some((x) => x.step !== 'signin' && x.xbOb && x.xbOb.vis),
          '出境同意框漏到了登录屏以外的引导屏上');
      }
      // ★ 「就地试一句」：素材内置、两个动作都在；没有引擎时点「翻这一句」必须说出一句话。
      // ★ **填色的是哪一个**，不只是「至多一个」。那条计数门禁在「就地试一句」上是绿的 ——
      //   填色的确实只有一个，只是填成了「继续」而不是「翻这一句」，人一眼看到的主行动是
      //   「跳过去」。2026-09-22 截图才看出来。
      const filledIds = (x) => (x && x.btns || []).filter((b) => x.accentBg && b.bg === x.accentBg).map((b) => b.id);
      need(fu && filledIds(fu).join() === 'ob-try-tr',
        '「就地试一句」那一屏填色的是「' + (fu ? filledIds(fu).join('、') : '') + '」—— 主行动应当是「翻这一句」，不是「继续」');
      if (ov.backendOn) {
        need(si && filledIds(si).join() === 'ob-next',
          '登录屏填色的是「' + (si ? filledIds(si).join('、') : '') + '」—— 主行动应当是登录那个按钮');
        need(si && !(si.btns || []).some((b) => b.id === 'ob-skip'),
          '登录屏又挂着「以后再设置」—— 与「先不登录」两个相近的「不」并排，分不清哪个是跳过这一屏');
      }
      // ★ 第一屏（画布板 B2 / telemetry-design §3.9 提案 B）：引擎名**从注册表来**、出口在、时长那句在。
      //   写死牌子名的后果只有中国版看得见（它的注册表里没有 GPT / Claude），所以判据不是
      //   「有没有 chip」，是「每个 chip 都能在 MT_PROVIDERS 的 label 里找到」。
      const we = seen.find((x) => x.step === 'welcome');
      const chips = (we && we.chips || []).filter((c) => c !== '…');
      need(chips.length >= 2, '第一屏没渲染引擎名：' + JSON.stringify(we && we.chips));
      const stray = chips.filter((c) => !(ov.providerLabels || []).some((l) => String(l).startsWith(c)));
      need(stray.length === 0, '第一屏的引擎名不是从 MT_PROVIDERS 来的（写死了？）：' + JSON.stringify(stray));
      need(we && we.exitText.trim().length > 1, '第一屏没有「我只要网页翻译 →」那条出口');
      need(we && /\d/.test(we.hintText || ''), '主按钮下那句「两步，约 30 秒」没出来：' + JSON.stringify(we && we.hintText));
      need(!seen.some((x) => x.step !== 'welcome' && (x.exitText || (x.chips || []).length)),
        '引擎名或那条出口漏到了第一屏以外的屏上');
      // ★「以后再设置」是文字链，不是第三个等宽按钮（2026-09-24 Mac 真机上抓到的：
      //   `#onboard` 不在 app/style.css 里 `button.link` 那条 :where 名单中，于是类名挂着、
      //   规则没命中）。三条判据各自独立：没有填色、没有边框、和主按钮不一样宽。
      for (const s of seen.map((x) => x.skip).filter(Boolean)) {
        need(/rgba\(0, 0, 0, 0\)|transparent/.test(s.bg),
          '「以后再设置」被渲染成了填色按钮（背景 ' + s.bg + '）—— 它该是文字链');
        need(parseFloat(s.border) === 0,
          '「以后再设置」有边框（' + s.border + '）—— 那是按钮的样子，不是文字链');
        need(!(s.nextW && Math.abs(s.w - s.nextW) < 8),
          '「以后再设置」和主按钮一样宽（' + s.w + 'px）—— 等宽的两个键分不出主次，正是 ext 屏 2026-09-02 那次的坑');
      }
      need(fu && fu.tryRes && fu.tryRes.shown, '「就地试一句」那一屏没有露出试一句的区块');
      need(fu && fu.tryRes && fu.tryRes.src.trim().length > 10, '「就地试一句」没有内置的示例句');
      need(fu && fu.tryRes && fu.tryRes.tr && fu.tryRes.say, '「翻这一句 / 听这一句」两个按钮不全');
      const none = fu && fu.tryRes && fu.tryRes.none, okRun = fu && fu.tryRes && fu.tryRes.okRun;
      need(none && !none.stuck && okRun && !okRun.stuck, '点了「翻这一句」之后按钮一直是禁用的 —— 请求没落定');
      // 没有引擎：要**具名**说出来，而且不带 ✗ —— 带 ✗ 的是传输失败，那是另一件事。
      need(none && none.cls === 'bad' && none.out && !/^✗/.test(none.out),
        '没有引擎时点「翻这一句」，结果行是「' + (none && none.out) + '」(' + (none && none.cls) + ') —— '
        + '应当具名说「还没有可用的翻译引擎」，不是空着、不是一直「正在翻译…」、也不是一条传输报错');
      need(okRun && okRun.cls === 'ok' && okRun.out === '【桩】这是一句译文',
        '有引擎时点「翻这一句」，结果行是「' + (okRun && okRun.out) + '」—— 译文没有落到结果行');
      const blank = seen.map((x, i) => (x.title && x.text) ? null : i).filter((x) => x !== null);
      need(blank.length === 0, '这几屏标题或正文是空的（i18n 键没落到）：' + blank.join(','));
      need(seen[0].w !== seen[seen.length - 1].w, '进度条从头到尾没动');
      const iosStep = seen.find((x) => x.steps > 0);
      need(iosStep && iosStep.steps === 3, 'iOS 的启用扩展屏应当念三步，实际 '
        + (iosStep ? iosStep.steps : 0) + ' 步');
      need(!seen.some((x) => x.prefs), 'iOS 上出现了「打开 Safari 扩展设置」按钮 —— '
        + 'SFSafariApplication 是 macOS-only，那个按钮点了跳不过去');
      // 启用扩展那一屏不许有「继续」：App 在 iOS 上判不了扩展启没启用，一个「继续」
      // 只能是「假装你做完了」。主行动是「在网页上完成设置」，它同时前进一屏。
      need(ov.extScreenHasNext === false, '启用扩展那一屏又出现了「继续」按钮 —— '
        + '没设置好就该去网站设置，不该给一个原地跳过的口子');
      // 选语言只该有一处（扩展引导的采集屏，chips 就在开关旁边）。App 引导里那一屏
      // 2026-09-01 删了：给一个还没启用的功能配过滤器，而且排在登录之前、根本没同步。
      need(ov.hasLangScreen === false, 'App 引导里又出现了选语言那一屏 —— 与扩展引导重复');
      // ★ 每一屏的行动键都要落在首屏之内。'ext' 屏上它是 #ob-setup（那一屏没有「继续」），
      //   而那一屏恰恰是内容最多的一屏：三张插图 + 三行步骤。2026-09-01 真机上正是它
      //   把按钮顶出了视口，用户看到的是一屏图，没有任何能点的东西。
      // ★ 任一屏至多一个填色按钮。两个并排时用户看不出该点哪个 —— 这一族问题在
      //   两个面上各犯过一次（App 是两个白按钮，扩展是两个填色按钮），而两侧门禁
      //   当时都只数个数、从不看长相。
      const filled = seen.map((x, i) => ({ i,
        on: (x.btns || []).filter((b) => x.accentBg && b.bg === x.accentBg) }))
        .filter((x) => x.on.length > 1);
      need(filled.length === 0, filled.length
        ? `第 ${filled[0].i + 1} 屏有 ${filled[0].on.length} 个填色按钮：`
          + filled[0].on.map((b) => b.id).join('、') + ' —— 并排的两个主行动'
        : '');

      const below = seen.map((x, i) => ({ i, f: x.fold }))
        .filter((x) => x.f && x.f.key !== null && x.f.key > x.f.vh);
      need(below.length === 0, below.length
        ? `第 ${below[0].i + 1} 屏的行动键在首屏之外（底边 ${below[0].f.key} > 视口 `
          + `${below[0].f.vh}）—— 页脚没吸住，用户看到的是一屏图，没有能点的东西`
        : '');
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
      AppSettings.paintStatic(); await AppSettings.paint(null, () => {}); return 'ok'; })()`, '#app-settings');
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
      const jaLede = 'ブラウザで読んだ文がここに同期され、復習できます。';
      await cdp.send('Runtime.evaluate', { expression: `new Promise((r) => chrome.storage.local.set({ uiLang: 'ja' }, r))`, awaitPromise: true }, sessionId);
      await cdp.send('Page.reload', {}, sessionId);
      await new Promise((r) => setTimeout(r, 1800));
      const cold = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({
        brand: (document.getElementById('app-brand') || {}).textContent || '',
        lede: (document.getElementById('lede') || {}).textContent || '',
        modes: (document.getElementById('modes-label') || {}).textContent || '',
        gear: (document.getElementById('gear') || {}).textContent || '' })`, returnByValue: true }, sessionId);
      const cv = JSON.parse(cold.result.value);
      need(cv.lede === jaLede, `界面语言：冷启动后首页的 lede 该是日文，实际「${cv.lede}」—— 首页没跟随 uiLang`);
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
        return JSON.stringify({ lede: (document.getElementById('lede') || {}).textContent || '' });
      })()`, awaitPromise: true, returnByValue: true }, sessionId)).result.value);
      need(/^Sentences you read/.test(live.lede),
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
      const reset = (extra) => `new Promise((r) => chrome.storage.local.remove(['onboardSeen', 'onboardResume', 'extBannerDoneAt', 'provider', 'apiKey'], () => chrome.storage.local.set(${extra || '{}'}, r)))`;
      // 原生侧在 didFinish 里调 show('ios')：不照样复刻，横幅在无头环境里本来就不出，
      //「卡在场时横幅让路」那条断言会空转（第一版证伪时摘掉让路逻辑它照样绿）。
      const injR = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { try { window.show('ios'); } catch (_) {} });` }, sessionId);
      await cdp.send('Runtime.evaluate', { expression: reset(), awaitPromise: true }, sessionId);
      await reopen();
      const v0 = await E(view);
      need(v0.onboard && v0.step === 'welcome', '全新状态下引导没从第 1 屏开始：' + JSON.stringify(v0));
      // 走到第 2 屏再跳过 —— 停在哪屏要被记住，不能一律回到开头。第 2 屏（登录屏）不挂「以后再设置」
      //（它有自己的「先不登录」），所以在第 1 屏跳过：判据是记下的 step 与卡上的「还差几步」对得上。
      await cdp.send('Runtime.evaluate', { expression: `document.getElementById('ob-skip').click()`, awaitPromise: true }, sessionId);
      await new Promise((r) => setTimeout(r, 300));
      const s1 = (await E(store));
      need(!s1.onboardSeen, '点「以后再设置」又写了 onboardSeen —— 那就是「永远不」，不是「以后」');
      need(s1.onboardResume && s1.onboardResume.step === 'welcome' && s1.onboardResume.shows === 0,
        '跳过后没记下停在哪一屏：' + JSON.stringify(s1));
      await reopen();
      const v1 = await E(view);
      need(!v1.onboard, '跳过过的人重开 App 又被整条引导挡住了 —— 回来的应当是一张卡');
      need(v1.card, '跳过过的人重开 App，首页没有「继续设置」卡');
      need(/\d/.test(v1.title), '「继续设置」卡标题没说还差几步：「' + v1.title + '」');
      need(!v1.banner, '「继续设置」卡与扩展横幅同时挂在首页 —— 两张「还差一步」');
      await cdp.send('Runtime.evaluate', { expression: `document.getElementById('ob-resume-go').click()`, awaitPromise: true }, sessionId);
      await new Promise((r) => setTimeout(r, 200));
      const v2 = await E(view);
      need(v2.onboard && v2.step === 'welcome' && !v2.card, '点「从上次停下的地方继续」没回到停下的那一屏：' + JSON.stringify(v2));
      // 次数上限：已经出现过 1 次；再重开 2 次（第 2、3 次）仍在，第 4 次自己收起并永久记上。
      await reopen(); await reopen();
      const v3 = await E(view), s3 = (await E(store));
      need(v3.card && s3.onboardResume && s3.onboardResume.shows === 3, '第 3 次重开时卡应当还在、计数为 3：' + JSON.stringify({ v3, s3 }));
      await reopen();
      const v4 = await E(view), s4 = (await E(store));
      need(!v4.card && !v4.onboard && s4.onboardSeen && !s4.onboardResume, '第 4 次重开卡还在纠缠，或没永久收起：' + JSON.stringify({ v4, s4 }));
      // ✕ = 当场永久。
      await cdp.send('Runtime.evaluate', { expression: reset(`{ onboardResume: { step: 'firstuse', shows: 0 } }`), awaitPromise: true }, sessionId);
      await reopen();
      const v5 = await E(view);
      need(v5.card && /2/.test(v5.title), '停在最后一屏之前的「还差几步」不对（firstuse 之后还剩 2 屏）：' + JSON.stringify(v5));
      await cdp.send('Runtime.evaluate', { expression: `document.getElementById('ob-resume-close').click()`, awaitPromise: true }, sessionId);
      await new Promise((r) => setTimeout(r, 200));
      const s5 = (await E(store));
      await reopen();
      const v6 = await E(view);
      need(s5.onboardSeen && !s5.onboardResume && !v6.card && !v6.onboard, '点 ✕ 没有永久收起：' + JSON.stringify({ s5, v6 }));
      // 已经配好引擎（自己去设置里填了 key）⇒ 什么都不出，并永久收起。
      await cdp.send('Runtime.evaluate', { expression: reset(`{ onboardResume: { step: 'welcome', shows: 0 }, provider: 'deepseek', apiKey: 'sk-gate-0123456789' }`), awaitPromise: true }, sessionId);
      await reopen();
      const v7 = await E(view), s7 = (await E(store));
      need(!v7.card && !v7.onboard && s7.onboardSeen, '已经配好引擎还在提示「继续设置」：' + JSON.stringify({ v7, s7 }));
      // 反面：卡收起之后横幅要能回来（否则上面那条「让路」可能只是横幅整个坏了）。v6：✕ 之后、没引擎。
      need(v6.banner, '✕ 收起卡之后扩展横幅没回来 —— 「让路」那条断言可能是空转的');
      // ─── 「我只要网页翻译 →」：记一条 web_only，并把人送到讲扩展那一屏（telemetry-design §3.9 B）────
      // 判据是**队列里真的有那条**，不是「代码里有 track 调用」—— 客户端的 shape() 会把
      // 白名单外的属性整条丢掉，少生成一次 providers.gen.js 这一行就凭空消失而没人看得见
      // （同扩展侧 verify-onboard 里那条的理由）。顺带钉住「一次引导只记一条」。
      await cdp.send('Runtime.evaluate', { expression: reset(), awaitPromise: true }, sessionId);
      await reopen();
      const wo = await E(`(async () => {
        try { window.MT_TELEMETRY.allowAutomation = true; } catch (_) {}
        await new Promise((r) => chrome.storage.local.set({ 'tm:on': true }, r));
        await new Promise((r) => chrome.storage.local.remove(['tm:queue'], r));
        const step0 = document.body.dataset.obStep || '';
        document.getElementById('ob-webonly').click();
        await new Promise((r) => setTimeout(r, 400));
        const after = document.body.dataset.obStep || '';
        // 再走一次收尾：这一次**不许**再记第二条（§3 表：离开时一条）。
        const fin = document.getElementById('ob-setup');
        if (fin && !fin.hidden) fin.click();
        await new Promise((r) => setTimeout(r, 400));
        const q = await new Promise((r) => chrome.storage.local.get(['tm:queue'], (v) => r((v || {})['tm:queue'] || [])));
        const all = q.filter((x) => x && x.name === 'onboarding_done');
        return JSON.stringify({ step0, after, n: all.length, props: all.length ? all[0].props : null,
          hasSpec: !!(window.MT_TELEMETRY && window.MT_TELEMETRY.spec),
          onboard: !document.getElementById('onboard').hidden });
      })()`);
      need(wo.step0 === 'welcome', '「我只要网页翻译」探针没有从第 1 屏开始：' + JSON.stringify(wo));
      // 出口本身两个 flavor 都要有：它首先是给用户的一条路，其次才是证据。
      need(wo.after === 'ext', '点完没把人送到讲扩展那一屏，而是停在「' + wo.after + '」');
      if (wo.hasSpec) {
        need(wo.props && wo.props.result === 'web_only' && wo.props.surface === 'app' && wo.props.step === 'welcome',
          '点「我只要网页翻译」没记下 result:web_only：' + JSON.stringify(wo));
        need(wo.props && ['0-2', '3-9', '10-29', '30+'].includes(wo.props.dwell),
          '那一条没带 dwell（§3.9 提案 A）：' + JSON.stringify(wo.props));
        need(wo.n === 1, '一次引导记了 ' + wo.n + ' 条 onboarding_done —— 应当只有一条（离开时那一条）');
      } else {
        // 中国版：产物里根本没有 MT_TELEMETRY（Gate D 的承诺是「一个字节都不发」）。
        // 这里的判据因此反过来：点完出口，队列必须仍然是空的 —— 与扩展侧 verify-onboard 同一条。
        need(wo.n === 0, '中国版产物里竟然攒出了 ' + wo.n + ' 条 onboarding_done —— Gate D 说好一条都不发');
      }

      // ─── 误点了「我已打开」：设置里能把首页横幅找回来（画布 YEDD4VmT9Pv2htUpoWZ9ZB 板 ⑤）────
      await cdp.send('Runtime.evaluate', { expression: reset(`{ onboardSeen: 1, extBannerDoneAt: Date.now() }`), awaitPromise: true }, sessionId);
      await reopen();
      const bview = `JSON.stringify({ banner: !document.getElementById('ext-banner').hidden, settings: !document.getElementById('app-settings').hidden,
        group: !document.getElementById('g-extbanner').hidden, note: document.getElementById('extb-note').textContent,
        btn: !document.getElementById('extb-restore').hidden, done: !document.getElementById('extb-done').hidden,
        doneText: document.getElementById('extb-done').textContent, label: TranslationCore.t('app_ext_done', '我已打开') })`;
      const r0 = await E(bview);
      need(!r0.banner, '点过「我已打开」重开 App，横幅又出现了（前提不成立，下面几条会空转）：' + JSON.stringify(r0));
      await cdp.send('Runtime.evaluate', { expression: `(async () => { document.getElementById('gear2').click(); await new Promise((r) => setTimeout(r, 400)); return 1; })()`, awaitPromise: true }, sessionId);
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
      await cdp.send('Runtime.evaluate', { expression: `(async () => { document.getElementById('gear2').click(); await new Promise((r) => setTimeout(r, 400)); return 1; })()`, awaitPromise: true }, sessionId);
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
