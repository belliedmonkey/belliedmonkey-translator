// build/app-bundle.js — build the host app's web assets.
//
// The app is a `WKWebView` on a `file://` origin loading ONE html, ONE script and ONE
// stylesheet. That shape is not an aesthetic preference — it is what keeps the Xcode
// project disposable:
//
//   `safari-project/` is gitignored and regenerated with `safari-web-extension-
//   converter`, which resets the project's file list (release-checklist #72). The
//   converter's App target already references exactly `Main.html`, `Script.js` and
//   `Style.css`. Emitting those three names, and no others, means the app's assets can
//   change forever without a single pbxproj edit — so regeneration stays a safe,
//   routine operation instead of the thing that deletes your work.
//
// The cost is that the shared modules are concatenated rather than loaded as separate
// files. Worth it: the alternative is either hand-maintaining the Xcode project or
// re-discovering "new files never enter the bundle" (see the ios-sim note in
// verification-spec) every time the app grows a module.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Order matters — these are IIFEs assigning globals, exactly as the extension's
// manifest loads them, and each depends on the ones above it. Keep this list in sync
// with what `app/app.js` actually uses; an unused module here is dead weight shipped
// to a phone, and a missing one is a blank screen.
const MODULES = [
  'app/chrome-shim.js',                  // FIRST — the rest read `chrome` at load time
  'extension/learn/backend.config.js',   // MT_BACKEND
  'extension/learn/page-settings.js',    // settings reader (uses chrome.storage)
  'extension/content/i18n-messages.js',  // MT_I18N_MESSAGES
  'extension/content/palette.gen.js',    // MT_PALETTE — generated brand palette
                                         // (sources-view chips read it)
  'extension/learn/i18n.js',             // t() / applyI18n()
  'extension/content/learn-model.js',    // LearnModel — ids, merge semantics, touchedAt
  'extension/content/learn-rules.js',    // LearnRules — 来源治理 pure logic (§4.1/§7.4/§8.9)
  'extension/content/learn-scheduler.js',// LearnScheduler — retrievability / buildDeck
  'extension/content/learn-exercises.js',// LearnExercises — §9.3 variant generation (pure)
  'extension/content/learn-driving.js',  // LearnDriving — §9.5 driving-session state
                                         // machine + reply intents + write decision (pure)
  'extension/content/tts.gen.js',        // generated speech-engine registry
  'extension/content/stt.gen.js',        // generated transcription-engine registry (§9.4)
  'extension/content/providers.gen.js',  // generated provider registry — the notes
                                         // gate and the app's engine picker both
                                         // read it (§7.2 / §9.2)
  'extension/learn/app-link.js',         // AppLink —— 「去 App 里复习」的地址与出口。
  'extension/learn/feedback.js',         // MTFeedback —— 反馈 / 评分出口；settings.js 与 review.js 引用
                                         // App 宿主里那个按钮本就不该出现（人已经在
                                         // App 里了），但 review.js 引用它，漏了这一行
                                         // 就是加载期 ReferenceError —— 同 engine-state
                                         // 那次（见下）。
  'extension/content/engine-state.js',   // EngineState — provider 归一化 + 「配好了没有」。
                                         // translation-api.js 的 providerById /
                                         // defaultProvider / resolveProvider 全部转调它，
                                         // 所以它**必须**跟着进 App 包。2026-09-01 漏了这一行：
                                         // App 里每次补译文都抛 `EngineState is not defined`，
                                         // 被 driving.js 收成一句 translate_failed —— 整条
                                         // 补译文在 App 上是死的，而扩展那边一切正常。
  'extension/content/wire-format.js',    // WireFormat — endpoint resolution + wire shape.
                                         // After providers.gen.js only for readability;
                                         // it reads its globals lazily, at call time.
  'extension/content/request-shape.js',  // RequestShape — 请求体：发哪些可选字段 + 怎么
                                         // 解回来。必须在 wire-format.js 之后（用它的
                                         // hostOf）、在四条传输之前。
  'extension/content/translation-api.js',// TranslationAPI — §9.5 补译文 的传输。The app
                                         // translated nothing until 2026-08-23; that
                                         // boundary gave way for ONE button (§7.2), and
                                         // this file is what it rides. Reusing the
                                         // extension's transport verbatim is the point:
                                         // a second translate path would be a second
                                         // prompt and a second format branch to drift.
                                         // Needs MT_PROVIDERS / WireFormat / RequestShape
                                         // above it; it has zero TranslationCore
                                         // dependency, which is why it can be here at all.
  'extension/content/langs.gen.js',      // generated learnable-language registry (§4.1)
  'extension/learn/store.js',            // LearnStore — the app's own corpus (§7.2)
  'extension/learn/tts.js',              // LearnTTS
  'extension/learn/speech-input.js',     // LearnSpeech — §9.4 录音 + BYO 转写
  'extension/learn/drain.js',            // LearnDrain — a no-op here (no outbox), see below
  'extension/learn/auth.js',             // LearnAuth
  'extension/learn/chunk.js',            // LearnChunk
  'extension/learn/sync.js',             // LearnSync
  'extension/learn/notes.js',            // LearnNotes — review.js references it; the
                                         // app's own settings may hold a chat engine
                                         // + key (§7.2), else the gate stays closed
  'app/translate-fill.js',               // LearnTranslateFill — §9.5 补译文. App-only,
                                         // so it lives in app/ rather than
                                         // extension/learn/: 播客模式 ships no bytes into
                                         // the extension. Needs LearnNotes (config
                                         // resolution) and TranslationAPI above it.
  'extension/learn/align.js',            // LearnAlign — §4.2c LLM 对齐裁决 (rides
                                         // LearnNotes.chat; explicit split action only)
  'extension/learn/exercise-pack.js',    // LearnExercisePack — §9.3 AI 题包 (rides
                                         // LearnNotes.chat; gate follows the notes gate)
  'extension/learn/engine-test.js',      // EngineTest —— engine-fields 与 quick-setup 的
                                         // 「测试连接」都调它。**是 test/app-bundle 的
                                         // 门禁把它逼出来的**：不加这一行，包拼得出来、
                                         // App 也起得来，只有用户真去点那个按钮时才
                                         // ReferenceError —— 同 engine-state.js 那次。
                                         // 依赖 LearnNotes/LearnTTS/LearnSpeech/
                                         // TranslationAPI/WireFormat，都排在它前面。
  'extension/learn/engine-fields.js',    // EngineFields —— 「这个引擎该露出哪几个框」的
                                         // **唯一**实现。它抽出来正是因为规则已经漂了，
                                         // 而它自己的文件头点名了 app/settings.js 的三处
                                         // 手抄。不进这个列表，App 那边就只能继续手抄
                                         // —— 2026-09-04 用户报的「App 设置页与扩展不一致」
                                         // 就是这么来的。
  'extension/learn/quick-setup.js',      // QuickSetup —— 「一把 key 配好全部」。它自述
                                         // 「一个渲染器，两个 host」，且不碰 chrome.storage
                                         // （算出 patch 交给 host 写盘），App 是第三个 host。
                                         // 必须在 engine-fields.js 之后：快速档收起的正是
                                         // 它渲染的那些字段。
  'extension/learn/sources-view.js',     // SourcesView — shared 来源管理 renderer
  'extension/learn/review.js',           // the review surface — SAME bytes as the extension
  'app/settings.js',                     // AppSettings — the learning layer's own knobs
  'app/now-playing-art.js',              // NowPlayingArt — §9.5 锁屏封面：把当前卡片画成
                                         // 一张 1024² 的图交给原生。纯 canvas 图元（file://
                                         // 下画外部图会污染 canvas），颜色读 CSS token。
                                         // 必须在 driving.js 之前：openCard 会调它。
  'app/native-audio.js',                 // NativeAudio — §9.5 后台/锁屏播放的宿主能力
                                         // 适配器。无依赖（锁屏上的字由调用方传入，
                                         // 同 notesToSpeech(notes, labels) 的纪律）。
                                         // 必须在 driving.js 之前：那边在 wire() 里
                                         // 注册回调。桥不在时全是 no-op，所以它在
                                         // Chrome 的 test:learn 里也照常加载。
  'app/driving.js',                      // AppDriving — §9.5 orchestrator (app-only;
                                         // the extension page cannot autoplay)
];

// `drain.js` ships even though the app has no outbox: with the shim's empty
// `chrome.storage`, `LearnDrain.run()` finds nothing and returns — a natural no-op
// rather than a branch someone has to remember. Capture happens in browsers only
// (domain-design §9.2); the app receives material through sync, never through a drain.

const APP_JS = 'app/app.js';             // always last: it drives the modules above

function buildAppBundle(outDir, log, opts) {
  opts = opts || {};
  fs.mkdirSync(outDir, { recursive: true });

  const parts = [
    '// GENERATED by build/app-bundle.js — do not edit.',
    '// Sources: ' + MODULES.concat([APP_JS]).join(', '),
    '',
  ];
  // 生成物必须跟着 flavor 走。`generateProviders/Tts/Stt` 把**全局**那一份写进
  // `extension/content/`，中国版那一份只覆盖到 `dist-china/content/`。这里如果照旧读
  // `extension/`，中国版宿主 App 拿到的就是国际版注册表 —— 设置页列出 ChatGPT /
  // Claude / Google，而它旁边的中国版扩展早把这些滤掉了（1.6.4 就这么出货的）。
  //
  // 只重定向**生成物**：手写模块两个 flavor 完全相同，从 dist 读它们只会让「源码在
  // extension/」这件事变得不真。
  const GENERATED = new Set([
    'i18n-messages.js', 'palette.gen.js', 'providers.gen.js',
    'tts.gen.js', 'stt.gen.js', 'langs.gen.js',
  ]);
  const srcFor = (rel) => {
    if (!opts.genRoot) return path.join(ROOT, rel);
    const base = path.basename(rel);
    if (!rel.startsWith('extension/content/') || !GENERATED.has(base)) return path.join(ROOT, rel);
    const alt = path.join(opts.genRoot, 'content', base);
    // 缺了就报错，**不回落**到 extension/ —— 回落正是上一版那个 bug 的形状：拿到了
    // 另一个 flavor 的东西，而全程没有一行警告。
    if (!fs.existsSync(alt)) throw new Error(`app bundle: genRoot 里缺 content/${base}（${alt}）`);
    return alt;
  };

  for (const rel of MODULES.concat([APP_JS])) {
    const abs = srcFor(rel);
    if (!fs.existsSync(abs)) {
      // Hard fail. A missing module would produce a bundle that loads and then throws
      // on first use — i.e. an app that opens to a blank screen, which is the failure
      // mode hardest to trace back to the build.
      throw new Error(`app bundle: missing source ${rel}`);
    }
    let text = fs.readFileSync(abs, 'utf8');
    // MT_SYNC=on: the bundle concatenates backend.config.js from SOURCE, so the
    // self-use flip must happen here too — dist/ and dist-app/ are two separate
    // emission paths and flipping only one shipped a phone build with sync on
    // while the Chrome side silently reverted (2026-08-09).
    if (opts.syncOn && rel === 'extension/learn/backend.config.js') {
      text = opts.flipSyncFlag(text, rel + ' (app bundle)');
    }
    // 中国版 App 只提供 Apple 登录：Google 在大陆连不上（build.js 的 limitProviders）。
    // **这里必须单独做一次** —— App 包拼的是**源码**那份 backend.config.js，不是
    // dist-china 里那份，所以 build.js 对 dist-china 的改写在这条路上完全不生效。
    // 同一份文件、两条发射路径，2026-08-09 的 sync 翻转就是在这里漏过一次。
    if (opts.limitProviders && rel === 'extension/learn/backend.config.js') {
      text = opts.limitProviders(text, rel + ' (app bundle)', ['apple']);
    }
    parts.push(`// ─── ${rel} ${'─'.repeat(Math.max(0, 60 - rel.length))}`);
    parts.push(text);
    parts.push('');
  }

  fs.writeFileSync(path.join(outDir, 'Script.js'), parts.join('\n'));

  // ─── The review surface is INLINED, not a second page ────────────────────
  // Three filenames is the whole deal (see the header), so the app cannot have a
  // `Review.html`. Its markup is lifted out of the extension's own `review.html` at
  // build time instead of being retyped here: one implementation, two hosts. If the
  // extension's review page grows a section, the app gets it on the next build.
  const reviewHtml = fs.readFileSync(path.join(ROOT, 'extension/learn/review.html'), 'utf8');
  const body = reviewHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!body) throw new Error('app bundle: cannot find <body> in extension/learn/review.html');
  // Drop its <script> tags — the app loads those modules through Script.js, in its
  // own order, and a duplicate load would run every IIFE twice.
  const markup = body[1].replace(/<script[\s\S]*?<\/script>/gi, '').trim();

  let html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const SLOT = '<!--REVIEW-->';
  if (html.indexOf(SLOT) < 0) throw new Error(`app bundle: app/index.html has no ${SLOT} slot`);

  // ─── ID collisions are the standing hazard of inlining, so fail the BUILD ──
  //
  // Both documents were written as whole pages, each free to use any id. Merged, a
  // duplicate id does NOT error anywhere — `getElementById` simply returns the first
  // match, so one page silently drives the other page's element. It cost a build and
  // a screenshot to notice `counts` (review.js wrote its own counts into the app
  // shell's element, and the app's card totals vanished).
  //
  // The app shell yields on a clash: `review.html` is a SHARED source and must not be
  // renamed to suit one host. Prefix the shell's id with `app-`.
  const idsOf = (s) => [...s.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const clash = idsOf(html.replace(SLOT, '')).filter((id) => idsOf(markup).indexOf(id) >= 0);
  if (clash.length) {
    throw new Error('app bundle: id collision with review.html: ' + clash.join(', ')
      + ' — rename the one in app/index.html (prefix `app-`), never the shared file');
  }

  html = html.replace(SLOT, markup);
  fs.writeFileSync(path.join(outDir, 'Main.html'), html);

  // Same for styles: the shared Organic token sheet FIRST (both halves below
  // consume it and declare no colour of their own — see the concatenation-trap
  // note in each), then review.css (it owns the review markup), then the app
  // shell's, which is written to sit on top of it.
  const palette = require(path.join(ROOT, 'build/palette.config.js'));
  fs.writeFileSync(path.join(outDir, 'Style.css'), [
    '/* GENERATED by build/app-bundle.js — do not edit. */',
    '/* ─── organic tokens (build/palette.config.js) ─── */',
    palette.tokensCss(),
    '/* ─── extension/learn/review.css ─── */',
    fs.readFileSync(path.join(ROOT, 'extension/learn/review.css'), 'utf8'),
    '/* ─── app/style.css ─── */',
    fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8'),
  ].join('\n'));

  const bytes = fs.statSync(path.join(outDir, 'Script.js')).size;
  if (log) log(`  app bundle → ${path.relative(ROOT, outDir)}/ (Script.js ${(bytes / 1024).toFixed(0)} KB)`);
  return { modules: MODULES.length + 1, bytes };
}

module.exports = { buildAppBundle, MODULES, APP_JS };
