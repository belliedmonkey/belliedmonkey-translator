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
  'extension/content/wire-format.js',    // WireFormat — endpoint resolution + wire shape.
                                         // After providers.gen.js only for readability;
                                         // it reads its globals lazily, at call time.
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
  'extension/learn/align.js',            // LearnAlign — §4.2c LLM 对齐裁决 (rides
                                         // LearnNotes.chat; explicit split action only)
  'extension/learn/exercise-pack.js',    // LearnExercisePack — §9.3 AI 题包 (rides
                                         // LearnNotes.chat; gate follows the notes gate)
  'extension/learn/driving-qa.js',       // DrivingQA — §9.5 驾车问答 (rides
                                         // LearnNotes.chat; uncached, own version)
  'extension/learn/sources-view.js',     // SourcesView — shared 来源管理 renderer
  'extension/learn/review.js',           // the review surface — SAME bytes as the extension
  'app/settings.js',                     // AppSettings — the learning layer's own knobs
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
  for (const rel of MODULES.concat([APP_JS])) {
    const abs = path.join(ROOT, rel);
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
