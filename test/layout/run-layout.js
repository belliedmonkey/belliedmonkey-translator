#!/usr/bin/env node
// run-layout.js — layout regression suite runner (docs/verification-spec.md §3.2).
//
// Loads dist/ into a throwaway-profile Chrome over CDP (Extensions.loadUnpacked,
// the §2.D flow), serves test/layout/fixtures/ over localhost, intercepts the
// Google translate endpoints with canned deterministic responses (offline), and
// asserts geometry invariants on the injected .mt-translation siblings.
//
//   node test/layout/run-layout.js [--fixture <substring>] [--no-build] [--keep]
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
const ARTIFACT_DIR = path.join(__dirname, 'artifacts');
const DIST = path.join(ROOT, 'dist');

const CFG = {
  enabled: true, targetLang: 'zh-CN', provider: 'google',
  apiKey: '', apiBaseUrl: '', apiModel: '',
  textColor: '#0a7a3c', ytTextColor: '#ffffff', fontSize: '1.0', showFab: false,
};

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const argOf = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };

if (typeof WebSocket === 'undefined') {
  console.error('test:layout needs Node >= 22 (built-in WebSocket). `npm test` still runs on >= 16.');
  process.exit(1);
}

// ─── canned Google translation (deterministic, offline) ───────────────
// NOTE: the endpoint paths + urlPattern below must track the Google provider in
// extension/content/translation-api.js (translate_a/single and translate_a/t on
// translate.googleapis.com). If that provider moves, this intercept must move with
// it — drift shows up as an awaitStable timeout, and this comment is the pointer.
const fakeTranslate = (q) => q.split(/\n{2,}/).map((p) => '【译】' + p).join('\n\n');

function googleBody(url) {
  const u = new URL(url);
  if (u.pathname.includes('/translate_a/single')) {
    const q = u.searchParams.get('q') || '';
    return JSON.stringify([[[fakeTranslate(q), q]]]);
  }
  if (u.pathname.includes('/translate_a/t')) {
    return JSON.stringify(u.searchParams.getAll('q').map((q) => [fakeTranslate(q)]));
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

async function runFixture(cdp, baseUrl, file, assertLibSrc) {
  let manifest = null;
  // Everything (incl. manifest parse) lives inside the try so a failure mid-setup still
  // unregisters listeners and closes the tab (a stale Fetch listener would keep
  // answering for a dead session on every later fixture).
  let targetId = null, sessionId = null;
  let offCtx = () => {}, offClear = () => {}, offFetch = () => {};
  try {
    manifest = readManifest(file); // malformed #mt-expect fails THIS fixture, not the suite
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
      if (sid !== sessionId) return;
      if (manifest.failTranslate) {
        // Error-path fixtures: every translate request fails hard so units reach
        // the terminal error chip (retries: ~4s with backoff).
        cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' }, sessionId)
          .catch(() => { /* tab already closing */ });
        return;
      }
      const body = googleBody(p.request.url);
      cdp.send('Fetch.fulfillRequest', {
        requestId: p.requestId, responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json; charset=utf-8' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: Buffer.from(body, 'utf8').toString('base64'),
      }, sessionId).catch(() => { /* tab already closing */ });
    });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Fetch.enable',
      { patterns: [{ urlPattern: '*translate.googleapis.com*' }] }, sessionId);
    await cdp.send('Page.navigate', { url: `${baseUrl}/${file}` }, sessionId);

    const ctxId = await findExtensionContext(cdp, sessionId, isolatedCtxs);
    await evalIn(cdp, sessionId, ctxId, assertLibSrc + '; true');
    await evalIn(cdp, sessionId, ctxId,
      'new Promise(r => requestAnimationFrame(() => r(window.__mtLayout.captureBaseline())))');

    await evalIn(cdp, sessionId, ctxId, `WebpageTranslator.enable(${JSON.stringify(CFG)}); true`);
    await awaitStable(cdp, sessionId, ctxId, manifest);

    const manifestJs = JSON.stringify(manifest);
    let result = await evalIn(cdp, sessionId, ctxId, `window.__mtLayout.runAsserts(${manifestJs})`);

    if (result.pass && manifest.rerender) {
      // Settings-change path: updateSettings() = disable() + enable() — geometry
      // must come out identical (exercises revert + the __mtLayoutCss re-measure).
      const cfg2 = { ...CFG, textColor: '#0000aa' };
      await evalIn(cdp, sessionId, ctxId, `WebpageTranslator.updateSettings(${JSON.stringify(cfg2)}); true`);
      await awaitStable(cdp, sessionId, ctxId, manifest);
      const r2 = await evalIn(cdp, sessionId, ctxId, `window.__mtLayout.runAsserts(${manifestJs})`);
      if (!r2.pass) result = { ...r2, failures: r2.failures.map((f) => ({ ...f, phase: 'rerender' })) };
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
