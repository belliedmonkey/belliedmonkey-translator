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
        settingsMissing: ['app-settings','settings-back','daily','tts-mode',
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
        // The speech-engine picker must be registry-fed too — one row per
        // MT_TTS_ENGINES entry, counted against the live registry.
        ttsEngineCount: document.getElementById('tts-engine').options.length,
        // +1 是哨兵项「未配置（不朗读）」—— 与 stt 同形（2026-09-04：语音不再默认
        // 走系统自带，所以「未配置」必须在选择器里有位置可待）。
        ttsEngineWant: 1 + (window.MT_TTS_ENGINES || []).length,
        // The transcription-engine picker (§9.4): one 未配置 row (the correct
        // default — no zero-config STT engine exists) plus the live registry.
        sttEngineCount: document.getElementById('stt-engine').options.length,
        sttEngineWant: 1 + (window.MT_STT_ENGINES || []).length,
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
            ['tts', 'tts', 'tts-engine', (window.MT_TTS_ENGINES || [])],
            ['stt', 'stt', 'stt-engine', (window.MT_STT_ENGINES || [])],
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
          document.getElementById('settings-back').click();
          await new Promise((r) => setTimeout(r, 60));
          return JSON.stringify({ bad, checked, slots: Object.keys(SL).length, tabsHidden, quick, detail, first, preview });
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
      }
      need(fv.bad.length === 0,
        '引擎字段的渲染结果与 EngineFields 的判据不符（' + fv.checked + ' 个引擎里 '
        + fv.bad.length + ' 处）：' + fv.bad.slice(0, 6).join(' · '));
    }

    if (o.syncEnabled) {
      const g = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
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
          // 从第一屏重新走：点 next 直到最后一屏
          for (let i = 0; i < 5; i++) {
            const kv = $('ob-kv').hidden ? [] : $('ob-kv').querySelectorAll('div span');
            seen.push({ title: $('ob-title').textContent, text: $('ob-text').textContent,
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
                        btns: ['ob-prefs', 'ob-setup', 'ob-next', 'ob-skip']
                          .filter((id) => !!($(id) && $(id).getClientRects().length))
                          .map((id) => ({ id, bg: getComputedStyle($(id)).backgroundColor })),
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
            if (i < 4) {
              const btn = $('ob-next').hidden ? $('ob-setup') : $('ob-next');
              btn.click(); await new Promise((r) => setTimeout(r, 30));
            }
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
          out2.providerCount = (window.MT_PROVIDERS || []).length;
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
      need(seen.length === 5, '引导不是五屏，实际 ' + seen.length);
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
  } catch (e) { ok = false; console.log('  ✗ ' + (e && e.stack)); }
  chrome.cleanup(); srv.close();
  console.log(ok ? `\n✓ App 页面在真实引擎里起得来，模块齐全，样式已加载（${FLAVOR}）` : '\n✗ App 页面有问题');
  process.exit(ok ? 0 : 1);
})();
