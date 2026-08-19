#!/usr/bin/env node
// run-layout.js — layout regression suite runner (docs/verification-spec.md §3.2).
//
// Loads dist/ into a throwaway-profile Chrome over CDP (Extensions.loadUnpacked,
// the §2.D flow), serves test/layout/fixtures/ over localhost, intercepts the
// Google translate endpoints with canned deterministic responses (offline), and
// asserts geometry invariants on the injected .mt-translation siblings.
//
//   node test/layout/run-layout.js [--fixture <substring>] [--no-build] [--keep]
//                                  [--artifacts <dir>]
//
// Exit 0 = all fixtures green. Any failure (or missing Chrome) exits 1 — never
// a silent skip.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { CDP } = require('./cdp');
const { launchChrome } = require('./chrome');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const DIST = path.join(ROOT, 'dist');

const CFG = {
  enabled: true, targetLang: 'zh-CN', provider: 'google',
  apiKey: '', apiBaseUrl: '', apiModel: '',
  textColor: '#0a7a3c', ytTextColor: '#ffffff', fontSize: '1.0', showFab: false,
};

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const argOf = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };

// ─── artifact dir (concurrency-safe) ───────────────────────────────────
// Two suites running at once (a second worktree, a rerun while the first is
// still going) would otherwise overwrite each other's screenshots and
// results.json — the second run's "evidence" would be a mix of both. So the
// default dir is claimed with a pid lock; a run that finds a LIVE holder falls
// back to `artifacts-<pid>/` and says so, instead of silently clobbering.
function claimArtifactDir() {
  const explicit = argOf('--artifacts') || process.env.MT_LAYOUT_ARTIFACTS;
  if (explicit) { fs.mkdirSync(explicit, { recursive: true }); return { dir: explicit, lock: null }; }
  const preferred = path.join(__dirname, 'artifacts');
  fs.mkdirSync(preferred, { recursive: true });
  const lock = path.join(preferred, '.lock');
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
    return { dir: preferred, lock };
  } catch (_) {
    const holder = parseInt(fs.readFileSync(lock, 'utf8').trim(), 10);
    if (!holder || holder === process.pid || !alive(holder)) {   // stale lock (killed run) → take it
      fs.writeFileSync(lock, String(process.pid));
      return { dir: preferred, lock };
    }
    const own = `${preferred}-${process.pid}`;
    fs.mkdirSync(own, { recursive: true });
    console.log(`note: artifacts/ is in use by pid ${holder} — writing to ${path.basename(own)}/ instead`);
    return { dir: own, lock: null };
  }
}

if (typeof WebSocket === 'undefined') {
  console.error('test:layout needs Node >= 22 (built-in WebSocket). `npm test` still runs on >= 16.');
  process.exit(1);
}

const { dir: ARTIFACT_DIR, lock: ARTIFACT_LOCK } = claimArtifactDir();
function releaseArtifactDir() {
  if (!ARTIFACT_LOCK) return;
  try {
    if (fs.readFileSync(ARTIFACT_LOCK, 'utf8').trim() === String(process.pid)) fs.rmSync(ARTIFACT_LOCK);
  } catch (_) { /* already gone */ }
}

// ─── canned Google translation (deterministic, offline) ───────────────
// NOTE: the endpoint paths + urlPattern below must track the Google provider in
// extension/content/translation-api.js (translate_a/single and translate_a/t on
// translate.googleapis.com). If that provider moves, this intercept must move with
// it — drift shows up as an awaitStable timeout, and this comment is the pointer.
// Marks every non-empty LINE, not every blank-line paragraph: a real engine returns a
// changed string for each line of a line-structured block, and marking only the first
// line would leave the rest byte-identical to the original — an artifact the renderer
// now (correctly) suppresses, which would make line-wise fixtures look under-rendered.
// A line that is ALREADY the target language is echoed back unchanged, because that is
// exactly what a real provider does with it (see fixture 28).
// Uses the PRODUCTION predicate rather than a hand-rolled proxy, so "what a provider
// echoes back" cannot drift away from "what the engine considers already-translated".
const { isAlreadyTargetLanguage } = require('../harness')
  .loadModule('translation-core.js', { window: {}, navigator: { language: 'en-US' } })
  .TranslationCore;
// An echoed line is NOT returned byte-identical: real providers re-typeset CJK, dropping
// the spaces around an embedded Latin word (Google returned "我会创建一个 Obsidian 文档"
// as "我会创建一个Obsidian文档"). Modelling that is what makes the renderer's comparison
// honest — a byte-identical echo would let a too-strict `norm()` pass. Found on macOS
// Safari; encoded here so it cannot regress.
const dropCjkSpaces = (s) => s
  .replace(/\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu, '')
  .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])\s+/gu, '$1');
// `echoRe` (fixture manifest, optional) names lines the provider should hand BACK
// unchanged. The production predicate covers this for zh/ja/ko targets, but it
// deliberately answers "no" for a Latin target — and a real provider asked to render
// English into English still echoes. Fixtures with a Latin target declare the echo
// explicitly rather than having the harness guess at a language.
const fakeTranslate = (q, cfg, echoRe) => q.split('\n')
  .map((line) => (!line.trim() ? line
    : (isAlreadyTargetLanguage(line, cfg.targetLang) || (echoRe && echoRe.test(line)))
      ? dropCjkSpaces(line)
      : '【译】' + line))
  .join('\n');

// Every `q` the extension put on a provider URL, both endpoint shapes.
function queriesOf(url) {
  const u = new URL(url);
  return u.searchParams.getAll('q');
}

function googleBody(url, cfg, echoRe) {
  const u = new URL(url);
  if (u.pathname.includes('/translate_a/single')) {
    const q = u.searchParams.get('q') || '';
    return JSON.stringify([[[fakeTranslate(q, cfg, echoRe), q]]]);
  }
  if (u.pathname.includes('/translate_a/t')) {
    return JSON.stringify(u.searchParams.getAll('q').map((q) => [fakeTranslate(q, cfg, echoRe)]));
  }
  return JSON.stringify([[['', '']]]);
}

// ─── fixture manifest ──────────────────────────────────────────────────
function readManifest(file) {
  const html = fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
  const m = html.match(/<script type="application\/json" id="mt-expect">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${file}: missing #mt-expect manifest`);
  return JSON.parse(m[1]);
}

// ─── static fixture server ─────────────────────────────────────────────
function serveFixtures() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const file = path.join(FIXTURE_DIR, path.basename(new URL(req.url, 'http://x').pathname));
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// 把扩展的 service worker 纳入 Fetch 拦截。CDP 的 Fetch 域是**按 target 生效**的，
// 页面那份管不到 SW —— 而 #153 之后翻译默认就是从 SW 发出的，所以不挂它等于整套
// mock 失效（实测：1/36 通过，还打了真网络，跑了 559 秒）。
//
// SW 是懒启动的，扩展刚加载时可能还没起来；这里带重试地等一会儿。等不到就放行，
// 让 fixture 自己的断言去报错——在这里 throw 只会把「SW 没起来」伪装成别的失败。
async function attachServiceWorkers(cdp, swSessions, tries = 20) {
  const attached = new Set();
  for (let i = 0; i < tries; i++) {
    let targets = [];
    try { ({ targetInfos: targets = [] } = await cdp.send('Target.getTargets')); } catch (_) { return; }
    const sws = targets.filter((t) => t.type === 'service_worker' && /^chrome-extension:\/\//.test(t.url || ''));
    for (const t of sws) {
      if (attached.has(t.targetId)) continue;
      attached.add(t.targetId);
      try {
        const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*translate.googleapis.com*' }] }, sid);
        swSessions.add(sid);
      } catch (_) { /* SW 正好被回收，跳过 */ }
    }
    if (swSessions.size) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

// ─── per-fixture drive ─────────────────────────────────────────────────
async function evalIn(cdp, sessionId, contextId, expression) {
  const r = await cdp.send('Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true, contextId }, sessionId);
  if (r.exceptionDetails) {
    throw new Error(`in-page eval failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`);
  }
  return r.result ? r.result.value : undefined;
}

async function findExtensionContext(cdp, sessionId, isolatedCtxs) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    for (const ctxId of [...isolatedCtxs].reverse()) {
      try {
        const ok = await evalIn(cdp, sessionId, ctxId,
          "typeof WebpageTranslator === 'object' && window.__mtMainLoaded === true");
        if (ok === true) return ctxId;
      } catch (_) { /* stale context — keep looking */ }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('extension isolated world never became ready (content scripts not injected?)');
}

// Count only FINAL states, not placeholders: the renderer injects a counted
// .mt-translation sibling already in the 'pending' (loading) state, so a raw node
// count reaches `expected` before any fetch resolves and asserts would measure the
// transient chip. Default mode counts canned-marker translations; 'error' mode
// (failTranslate fixtures) counts terminal error chips (they carry cursor:pointer).
const COUNT_EXPRS = {
  marker: "[...document.querySelectorAll('.mt-translation')].filter(e => e.textContent.includes('【译】')).length",
  error: "[...document.querySelectorAll('.mt-translation')].filter(e => e.style.cursor === 'pointer').length",
};
async function awaitStable(cdp, sessionId, ctxId, manifest) {
  const expected = manifest.unitCount;
  const countExpr = COUNT_EXPRS[manifest.countMode || 'marker'];
  const deadline = Date.now() + (manifest.timeoutMs || 15000);
  let streak = 0;
  while (Date.now() < deadline) {
    const n = await evalIn(cdp, sessionId, ctxId, countExpr);
    streak = (n === expected) ? streak + 1 : 0;
    if (streak >= 4) return; // stable for ~600ms
    await new Promise((r) => setTimeout(r, 150));
  }
  const diag = await evalIn(cdp, sessionId, ctxId, `JSON.stringify({
    translations: document.querySelectorAll('.mt-translation').length,
    settled: ${countExpr},
    units: document.querySelectorAll('[data-mt-processed]').length,
    texts: [...document.querySelectorAll('.mt-translation')].map(e => e.textContent.slice(0, 40)),
  })`);
  throw new Error(`never reached ${expected} stable settled translations; state=${diag}`);
}

// Node-side asserts over what was actually sent to the provider. `expectNotRequested`
// is the one that matters: a unit the engine skips renders exactly like a unit whose
// echoed translation the renderer suppressed, so the DOM cannot tell them apart — only
// the absent request can. `expectRequested` is the over-suppression guard for it.
function checkRequests(manifest, requested) {
  const failures = [];
  const seen = requested.join('\n');
  for (const needle of manifest.expectNotRequested || []) {
    if (seen.includes(needle)) {
      failures.push({
        name: 'expectNotRequested', sel: needle.slice(0, 40),
        detail: 'text was sent to the provider but should have been skipped before the request',
      });
    }
  }
  for (const needle of manifest.expectRequested || []) {
    if (!seen.includes(needle)) {
      failures.push({
        name: 'expectRequested', sel: needle.slice(0, 40),
        detail: 'text was never sent to the provider — over-suppressed',
      });
    }
  }
  return failures;
}

function mergeFailures(result, extra) {
  if (!extra.length) return result;
  const failures = [...(result.failures || []), ...extra];
  return { ...result, pass: false, failures };
}

async function runFixture(cdp, baseUrl, file, assertLibSrc) {
  let manifest = null;
  // Everything (incl. manifest parse) lives inside the try so a failure mid-setup still
  // unregisters listeners and closes the tab (a stale Fetch listener would keep
  // answering for a dead session on every later fixture).
  let targetId = null, sessionId = null;
  // 扩展 service worker 的 session。**每个 fixture 都要挂**：#153 之后翻译默认从后台
  // 发出（一次请求、无预检），所以 mock 若只拦页面这一条，整套 fixture 的假翻译全部
  // 落空、还会打到真网络上去。SW 会被回收再起，所以每个 fixture 都重新认一次。
  const swSessions = new Set();
  let offCtx = () => {}, offClear = () => {}, offFetch = () => {};
  // Per-fixture settings overlay. Almost every fixture wants the default zh-CN target;
  // the ones exercising a Latin target (where the same-language skip depends on the
  // browser's own detector, not on script) declare `"cfg": {"targetLang": "en"}`.
  let fixtureCfg = CFG;
  let echoRe = null;
  // Every text the page actually asked the provider to translate. Some behaviour is
  // invisible in the DOM and only observable here: when the engine skips a unit
  // up front, the renderer's identical-output backstop would have suppressed the same
  // line anyway, so the rendered result is byte-identical either way — the difference
  // is the request that was never sent (the user's quota). `expectNotRequested` is the
  // only assertion that can see it.
  const requested = [];
  try {
    manifest = readManifest(file); // malformed #mt-expect fails THIS fixture, not the suite
    fixtureCfg = { ...CFG, ...(manifest.cfg || {}) };
    echoRe = manifest.echoRe ? new RegExp(manifest.echoRe, 'u') : null;
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));

    const isolatedCtxs = new Set();
    offCtx = cdp.on('Runtime.executionContextCreated', (p, sid) => {
      if (sid === sessionId && p.context.auxData && p.context.auxData.type === 'isolated') {
        isolatedCtxs.add(p.context.id);
      }
    });
    offClear = cdp.on('Runtime.executionContextsCleared', (_p, sid) => {
      if (sid === sessionId) isolatedCtxs.clear();
    });
    offFetch = cdp.on('Fetch.requestPaused', (p, sid) => {
      // sid 既可能是页面的，也可能是扩展 service worker 的（见下面的 swSessions）。
      // §5.5 之后 error-path fixture 必须两条路一起挡：内容脚本直连失败后会把同一个
      // 请求交给后台重发，只挡页面这一条的话，后台会绕过注入把它翻译成功——2026-08-19
      // fixture 12 就是这么由红变「35/36」的。
      if (sid !== sessionId && !swSessions.has(sid)) return;
      if (manifest.failTranslate) {
        // Error-path fixtures: every translate request fails hard so units reach
        // the terminal error chip (retries: ~4s with backoff).
        // 必须回到**请求所在的那个 session**（sid），不是页面的。回错了那条被暂停的
        // 请求永远不会被解决，于是 proxyFetch 一直挂到超时——症状是单元停在「翻译中…」
        // 而不是变成错误芯片。
        cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' }, sid)
          .catch(() => { /* tab already closing */ });
        return;
      }
      requested.push(...queriesOf(p.request.url));
      const body = googleBody(p.request.url, fixtureCfg, echoRe);
      cdp.send('Fetch.fulfillRequest', {
        requestId: p.requestId, responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json; charset=utf-8' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: Buffer.from(body, 'utf8').toString('base64'),
      }, sid).catch(() => { /* tab already closing */ });
    });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Fetch.enable',
      { patterns: [{ urlPattern: '*translate.googleapis.com*' }] }, sessionId);
    await attachServiceWorkers(cdp, swSessions);
    await cdp.send('Page.navigate', { url: `${baseUrl}/${file}` }, sessionId);

    const ctxId = await findExtensionContext(cdp, sessionId, isolatedCtxs);
    await evalIn(cdp, sessionId, ctxId, assertLibSrc + '; true');
    await evalIn(cdp, sessionId, ctxId,
      'new Promise(r => requestAnimationFrame(() => r(window.__mtLayout.captureBaseline())))');

    await evalIn(cdp, sessionId, ctxId, `WebpageTranslator.enable(${JSON.stringify(fixtureCfg)}); true`);
    await awaitStable(cdp, sessionId, ctxId, manifest);

    const manifestJs = JSON.stringify(manifest);
    let result = await evalIn(cdp, sessionId, ctxId, `window.__mtLayout.runAsserts(${manifestJs})`);
    result = mergeFailures(result, checkRequests(manifest, requested));

    // Async in-page behavioral phases (assert-lib): each one drives real
    // gestures/selections in the page and tags its failures with a phase name.
    //   selection    — SPA re-renders never destroy a live selection (fixture 33)
    //   interaction  — page content keeps behaving as the page wrote it
    //                  (interaction-spec: 翻译文字插入后不要影响网页原有内容的
    //                  交互动作 — fixtures 34–35)
    //   keeperGuards — the selection keeper's non-behaviors (fixture 36)
    const inPagePhase = async (res, spec, fn, phase) => {
      if (!res.pass || !spec) return res;
      const r = await evalIn(cdp, sessionId, ctxId, `window.__mtLayout.${fn}(${JSON.stringify(spec)})`);
      return r.pass ? res : { ...r, failures: r.failures.map((f) => ({ ...f, phase })) };
    };
    result = await inPagePhase(result, manifest.selection, 'checkSelectionPreserved', 'selection');
    result = await inPagePhase(result, manifest.interaction, 'checkInteractionPreserved', 'interaction');
    result = await inPagePhase(result, manifest.keeperGuards, 'checkKeeperGuards', 'keeperGuards');

    if (result.pass && manifest.rerender) {
      // Settings-change path: updateSettings() = disable() + enable() — geometry
      // must come out identical (exercises revert + the __mtLayoutCss re-measure).
      const cfg2 = { ...fixtureCfg, textColor: '#0000aa' };
      await evalIn(cdp, sessionId, ctxId, `WebpageTranslator.updateSettings(${JSON.stringify(cfg2)}); true`);
      await awaitStable(cdp, sessionId, ctxId, manifest);
      const r2 = await evalIn(cdp, sessionId, ctxId, `window.__mtLayout.runAsserts(${manifestJs})`);
      if (!r2.pass) result = { ...r2, failures: r2.failures.map((f) => ({ ...f, phase: 'rerender' })) };
    }

    if (result.pass && manifest.resize) {
      // Viewport-change path (issue #28): rotation / window resize / media-query
      // breakpoint. The renderer froze viewport-time PIXEL geometry into inline
      // styles; after the resize it must re-measure and re-mirror the NEW
      // original geometry (and undo a now-wrong flex-row wrap fix).
      const rz = manifest.resize;
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: rz.width, height: rz.height, deviceScaleFactor: 1, mobile: !!rz.mobile }, sessionId);
      // Let the page reflow, the renderer's debounced invalidation fire, and the
      // next tick repaint. Generous: the debounce + a 350ms tick + settle.
      await evalIn(cdp, sessionId, ctxId, `new Promise(r => setTimeout(r, ${rz.settleMs || 1500}))`);
      await awaitStable(cdp, sessionId, ctxId, manifest);
      // The originals legitimately MOVED — re-baseline so the post-resize asserts
      // compare the mirror against the new original geometry. `false` keeps the
      // horizontal-overflow cap at the new innerWidth instead of baking in an
      // overflow the stale translation may be causing right now.
      await evalIn(cdp, sessionId, ctxId, 'window.__mtLayout.captureBaseline(false)');
      const rzManifest = JSON.stringify({ ...manifest, ...(manifest.resizeManifest || {}) });
      const r3 = await evalIn(cdp, sessionId, ctxId, `window.__mtLayout.runAsserts(${rzManifest})`);
      if (!r3.pass) result = { ...r3, failures: r3.failures.map((f) => ({ ...f, phase: 'resize' })) };
    }

    return { file, name: manifest.name, ...result };
  } catch (err) {
    return { file, name: manifest ? manifest.name : file, pass: false, failures: [{ name: 'harness', sel: '-', detail: err.message }] };
  } finally {
    // Screenshot best-effort on BOTH outcomes — a failing fixture is exactly when
    // the artifact matters for human eyeballing.
    if (sessionId) {
      try {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
        fs.writeFileSync(path.join(ARTIFACT_DIR, file.replace(/\.html$/, '.png')),
          Buffer.from(shot.data, 'base64'));
      } catch (_) { /* tab dead — nothing to capture */ }
    }
    offCtx(); offClear(); offFetch();
    if (targetId && !flag('--keep')) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// ─── main ──────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  if (!flag('--no-build')) {
    const b = spawnSync('node', ['build.js'], { cwd: ROOT, stdio: 'pipe' });
    if (b.status !== 0) { console.error('build.js failed:\n' + b.stderr); process.exit(1); }
  } else if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    console.error('--no-build given but dist/ is missing — run node build.js first.');
    process.exit(1);
  }
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const filter = argOf('--fixture');
  const fixtures = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.html')).sort()
    .filter((f) => !filter || f.includes(filter));
  if (!fixtures.length) { console.error('no fixtures matched'); process.exit(1); }

  const server = await serveFixtures();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const assertLibSrc = fs.readFileSync(path.join(__dirname, 'assert-lib.js'), 'utf8');

  // Load a per-run COPY of dist/: unpacked extensions live-read their load path, so
  // a concurrent `node build.js` (second suite run, another worktree) would swap
  // files under a running Chrome mid-fixture.
  const runDist = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mt-layout-dist-'));
  fs.cpSync(DIST, runDist, { recursive: true });

  let chrome, cdp;
  const results = [];
  const cleanup = (force) => {
    try { if (cdp) cdp.close(); } catch (_) { /* already closed */ }
    if (chrome && (force || !flag('--keep'))) chrome.cleanup();
    fs.rmSync(runDist, { recursive: true, force: true });
    releaseArtifactDir();
  };
  // Ctrl-C mid-run must not orphan the Chrome process or leak the tmp profile/dist —
  // explicit termination overrides --keep (keep is for normal completion only).
  process.on('SIGINT', () => { cleanup(true); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(true); process.exit(143); });
  try {
    chrome = await launchChrome();
    cdp = await CDP.connect(chrome.port);
    await cdp.send('Extensions.loadUnpacked', { path: runDist }).catch((e) => {
      throw new Error(`Extensions.loadUnpacked failed (${e.message}) — see docs/verification-spec.md §2.D for the CDP flow and fallbacks.`);
    });

    for (const f of fixtures) {
      const r = await runFixture(cdp, baseUrl, f, assertLibSrc);
      results.push(r);
      const mark = r.pass ? '✅' : '❌';
      console.log(`${mark} ${f} (${r.name || '?'})`);
      for (const fail of (r.failures || [])) {
        console.log(`     ${fail.phase ? `[${fail.phase}] ` : ''}${fail.name} @ ${fail.sel}: ${fail.detail}`);
      }
    }
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exitCode = 1;
  } finally {
    if (!flag('--keep')) { cleanup(); server.close(); }
  }

  fs.writeFileSync(path.join(ARTIFACT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} fixtures green in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failed.length || process.exitCode) process.exitCode = 1;
  if (flag('--keep')) {
    // Keep the event loop (and thus the fixture server + Chrome + tabs) alive for
    // debugging — process.exit() here would kill the server the log advertises.
    console.log(`--keep: Chrome + tabs left running (CDP port ${chrome ? chrome.port : '?'}), fixtures served at ${baseUrl}. Ctrl-C to end.`);
  } else {
    process.exit(process.exitCode || 0);
  }
})();
