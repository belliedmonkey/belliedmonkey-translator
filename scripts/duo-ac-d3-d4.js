#!/usr/bin/env node
// Duo sim · AC-D3 / AC-D4 + Duo-04/05 像素 · DEBUG 登录注入
// 用法：先 boot Duo + 装好带 testHarness 的 Debug App，再：
//   DEVELOPER_DIR=…/Xcode-27.1.0.app/Contents/Developer node scripts/duo-ac-d3-d4.js
// 不打印 token / OTP。

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const UDID = process.env.DUO_UDID || 'DAAD1963-71E9-409D-8C0E-083E7DE2650F';
const BUNDLE = 'com.belliedmonkeytranslator';
const OUT = path.join(ROOT, 'qa-evidence-duo', 'ac-d3-d4-run');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const SLOT = 'supabase_test_refresh_token';
const TEST_EMAIL = 'belliedmonkey.en@gmail.com';

fs.mkdirSync(OUT, { recursive: true });
const logLines = [];
function log(s) { const line = String(s); logLines.push(line); console.log(line); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function slot(name) {
  const txt = fs.readFileSync(KEYS, 'utf8');
  const re = new RegExp('^' + name + '\\s*[:=]\\s*(\\S+)', 'm');
  const m = txt.match(re);
  return m ? m[1] : null;
}

function backendUrl() {
  // Prefer extension backend.config.js global url
  const p = path.join(ROOT, 'extension', 'learn', 'backend.config.js');
  const t = fs.readFileSync(p, 'utf8');
  const m = t.match(/url:\s*'(https:\/\/[^']+supabase[^']*)'/);
  return (m && m[1]) || 'https://cavezcufztzqsohpjmup.supabase.co';
}

function anonKey() {
  const p = path.join(ROOT, 'extension', 'learn', 'backend.config.js');
  const t = fs.readFileSync(p, 'utf8');
  const m = t.match(/anonKey:\s*'([^']+)'/);
  return m ? m[1] : '';
}

async function refreshSession() {
  const rt = slot(SLOT);
  if (!rt) throw new Error('no refresh token in keys');
  const url = backendUrl() + '/auth/v1/token?grant_type=refresh_token';
  const r = await fetch(url, {
    method: 'POST',
    headers: { apikey: anonKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rt }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('refresh failed ' + r.status);
  // rotate refresh in keys if changed (same as test-account.js) — do not log value
  if (body.refresh_token && body.refresh_token !== rt) {
    let txt = fs.readFileSync(KEYS, 'utf8');
    const re = new RegExp('^(' + SLOT + '\\s*[:=]\\s*)(\\S+)', 'm');
    if (re.test(txt)) txt = txt.replace(re, '$1' + body.refresh_token);
    else txt += '\n' + SLOT + ': ' + body.refresh_token + '\n';
    fs.writeFileSync(KEYS, txt);
  }
  const email = (() => {
    try {
      const p = JSON.parse(Buffer.from(String(body.access_token).split('.')[1], 'base64url').toString('utf8'));
      return p.email || null;
    } catch (_) { return null; }
  })();
  if (email !== TEST_EMAIL) throw new Error('wrong account email');
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || rt,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    email,
    userId: body.user && body.user.id,
    backend: backendUrl(),
  };
}

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body || '') },
      timeout: 8000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: d ? JSON.parse(d) : null, raw: d }); }
        catch (e) { resolve({ status: res.statusCode, json: null, raw: d }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function findBase() {
  // 8790 上可能躺着别的 mt-test / tunnel；必须选到带 injectSession 的活页。
  for (let p = 8790; p <= 8799; p++) {
    const b = `http://127.0.0.1:${p}`;
    try {
      const r = await httpJson('GET', b + '/ping');
      if (r.status !== 200) continue;
      try {
        const ev = await httpJson('POST', b + '/eval', '!!(window.__mtTest && window.__mtTest.injectSession)');
        if (ev.json && ev.json.ok && ev.json.result === true) return b;
      } catch (_) {}
    } catch (_) {}
  }
  return null;
}

async function evalJs(base, js) {
  const r = await httpJson('POST', base + '/eval', js);
  if (!r.json || r.json.ok === false) {
    const err = (r.json && (r.json.error || r.json.result)) || r.raw;
    throw new Error('eval fail: ' + String(err).slice(0, 200));
  }
  return r.json.result;
}

async function evalOk(base, js) {
  return evalJs(base, js);
}

async function runAsync(base, jsExpr) {
  // runAsync 本身返回 Promise —— WK evaluateJavaScript 不能序列化 Promise，
  // 所以这里吞掉 Code=5，靠 last() 轮询（同 scripts/test-mac.js）。
  try {
    await evalJs(base, `__mtTest.runAsync(async () => { return (${jsExpr}); })`);
  } catch (_) { /* unsupported Promise type — expected */ }
  for (let i = 0; i < 80; i++) {
    let last = null;
    try { last = await evalJs(base, '__mtTest.last()'); } catch (_) {}
    if (last != null) {
      if (last && last.ok === false) throw new Error('runAsync: ' + (last.error || 'fail'));
      return last && last.value !== undefined ? last.value : last;
    }
    await sleep(100);
  }
  throw new Error('runAsync timeout');
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function screenshot(tag, display) {
  const dest = path.join(OUT, tag + '.png');
  try {
    // Duo 合盖时默认 framebuffer 可能是内屏黑图；外屏用 --display=primary（1398×2034）
    const disp = display ? ` --display=${display}` : '';
    sh(`xcrun simctl io ${UDID} screenshot${disp} ${JSON.stringify(dest)}`);
    log('screenshot ' + tag + (display ? ' display=' + display : ''));
  } catch (e) {
    log('screenshot fail ' + tag + ': ' + e.message);
  }
  return dest;
}

function hinge(cmd) {
  sh(`hinge -d ${UDID} ${cmd}`);
}

async function main() {
  const report = {
    at: new Date().toISOString(),
    loginPath: 'DEBUG-injectSession',
    ac: {},
    tip: '',
    xcodeDefault: '',
    notes: [],
  };
  try { report.tip = sh('git rev-parse --short HEAD').trim(); } catch (_) {}
  try { report.xcodeDefault = sh('/usr/bin/xcode-select -p').trim(); } catch (_) {}

  log('▶ refresh session (no token print)');
  const sess = await refreshSession();
  log('  email ok · userId len=' + String(sess.userId || '').length);

  log('▶ find MTTestBridge');
  let base = await findBase();
  if (!base) {
    // launch app
    try { sh(`xcrun simctl launch ${UDID} ${BUNDLE}`); } catch (_) {}
    for (let i = 0; i < 40 && !base; i++) { await sleep(500); base = await findBase(); }
  }
  if (!base) throw new Error('no MTTestBridge on 8790-8799');
  log('  bridge ' + base);

  // wait harness
  for (let i = 0; i < 60; i++) {
    try {
      if (await evalOk(base, '!!(window.__mtTest && window.__mtTest.injectSession)')) break;
    } catch (_) {}
    await sleep(500);
    if (i === 59) throw new Error('__mtTest.injectSession missing — rebuild with testHarness');
  }

  log('▶ injectSession + reload');
  // Pass session via JSON; do not log it
  const sessLit = JSON.stringify({
    accessToken: sess.accessToken,
    refreshToken: sess.refreshToken,
    expiresAt: sess.expiresAt,
    email: sess.email,
    userId: sess.userId,
    backend: sess.backend,
  });
  const inj = await runAsync(base, `JSON.stringify(await __mtTest.injectSession(${sessLit}))`);
  const injObj = typeof inj === 'string' ? JSON.parse(inj) : inj;
  log('  inject ok=' + !!(injObj && injObj.ok) + ' email=' + (injObj && injObj.email));
  if (!injObj || !injObj.ok) throw new Error('injectSession failed');

  await evalOk(base, 'location.reload(), true');
  await sleep(2500);
  // re-find bridge after reload (port sticky)
  base = await findBase() || base;
  for (let i = 0; i < 60; i++) {
    try {
      if (await evalOk(base, '!!(window.__mtTest && document.getElementById("signed-in"))')) break;
    } catch (_) {}
    await sleep(500);
  }

  // Ensure signed-in visible
  let signed = await evalOk(base, `!!(document.getElementById('signed-in') && !document.getElementById('signed-in').hidden)`);
  if (!signed) {
    // session in storage but UI not painted — re-inject and soft-reload again
    await runAsync(base, `JSON.stringify(await __mtTest.injectSession(${sessLit}))`);
    await evalOk(base, 'location.reload(), true');
    await sleep(3000);
    base = await findBase() || base;
    signed = await evalOk(base, `!!(document.getElementById('signed-in') && !document.getElementById('signed-in').hidden)`);
  }
  log('  signed-in visible=' + signed);
  if (!signed) {
    report.ac['AC-D3'] = 'FAIL';
    report.ac['AC-D4'] = 'FAIL';
    report.ac['pixel-04'] = 'BLOCKED';
    report.ac['pixel-05'] = 'BLOCKED';
    report.notes.push('login UI not reached after injectSession');
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    process.exit(2);
  }

  // ── AC-D4：首页 regular 门控原因完整可见 ──
  log('▶ AC-D4 hinge open → home heroes');
  try { hinge('close'); await sleep(800); } catch (_) {}
  // Ensure on home (not listen)
  await evalOk(base, `(() => { const L=window.AppListen; if (L && document.getElementById('app-listen') && !document.getElementById('app-listen').hidden) { try{L.leave();}catch(e){} } return true; })()`);
  await sleep(500);

  hinge('open');
  await sleep(1500);
  // refresh entry so gate reasons paint
  await runAsync(base, `(async () => { if (window.AppListen && AppListen.refreshEntry) await AppListen.refreshEntry(); return true; })()`);
  await sleep(800);

  const d4 = await evalOk(base, `(() => {
    const q = (id) => document.getElementById(id);
    const text = (id) => { const e=q(id); return e ? (e.textContent||'').trim() : ''; };
    const vis = (id) => { const e=q(id); return !!(e && !e.hidden); };
    // dualRegular: both hero suffixes '' and sometimes '2' — gather gate why lines
    const heroes = [];
    for (const sfx of ['', '2']) {
      const listenBtn = q('app-listen-entry'+sfx);
      const subsBtn = q('app-subs-entry'+sfx);
      const listenWhy = text('app-listen-need-why'+sfx) || text('app-listen-entry-why'+sfx);
      const subsWhy = text('app-subs-need-why'+sfx) || text('app-subs-entry-why'+sfx);
      // listen-view uses need why ids — probe via entryView
      heroes.push({
        sfx,
        listenHidden: listenBtn ? listenBtn.hidden : null,
        listenDisabled: listenBtn ? listenBtn.disabled : null,
        listenHint: text('app-listen-entry-hint'+sfx),
        subsHidden: subsBtn ? subsBtn.hidden : null,
        subsDisabled: subsBtn ? subsBtn.disabled : null,
        subsHint: text('app-subs-entry-hint'+sfx),
      });
    }
    let ev = null;
    try { ev = window.AppListen && AppListen.entryView ? { a: AppListen.entryView(''), b: AppListen.entryView('2') } : null; } catch (e) { ev = String(e); }
    const signedIn = vis('signed-in');
    const homeW = window.innerWidth; const homeH = window.innerHeight;
    const lc = (window.__mtLayoutContext) || null;
    return { signedIn, homeW, homeH, heroes, ev, lc };
  })()`);
  fs.writeFileSync(path.join(OUT, 'ac-d4-home.json'), JSON.stringify(d4, null, 2));
  screenshot('ac-d4-home-open');

  // 产品 09:42：门控原因行须首屏入视、无需滚动（「全文未截断但需滚」不算签字 PASS）
  const d4geom = await evalOk(base, `(() => {
    const need = document.getElementById('app-listen-need-live') || document.getElementById('app-listen-need-live-why');
    const why = document.getElementById('app-listen-need-live-why');
    const heroes = document.querySelector('.heroes');
    const heroesNeed = document.querySelector('.heroes-need');
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, hidden: !!el.hidden,
        inView: r.top >= 0 && r.bottom <= vh + 1 && r.height > 0 };
    };
    return {
      vh, scrollY: window.scrollY || window.pageYOffset || 0,
      need: box(need), why: box(why), heroes: box(heroes), heroesNeed: box(heroesNeed),
      whyText: why ? (why.textContent || '').trim() : '',
      needHidden: need ? !!need.hidden : null,
    };
  })()`);
  fs.writeFileSync(path.join(OUT, 'ac-d4-viewport.json'), JSON.stringify(d4geom, null, 2));
  const firstScreenOk = !!(d4geom && d4geom.need && d4geom.need.inView && d4geom.scrollY === 0
    && (d4geom.needHidden === false || (d4geom.why && d4geom.why.inView)));
  // If gate not shown (need hidden), first-screen gate N/A — still require heroes in view
  const firstScreenGate = (d4geom && d4geom.needHidden === true)
    ? !!(d4geom.heroes && d4geom.heroes.inView)
    : firstScreenOk;
  report.notes.push('D4 firstScreen=' + firstScreenGate + ' need=' + JSON.stringify(d4geom && d4geom.need)
    + ' vh=' + (d4geom && d4geom.vh));

  // Assert gate reasons from entryView
  const evA = d4 && d4.ev && d4.ev.a;
  const listenWhy = evA && evA.listen && (evA.listen.why || '');
  const subsWhy = evA && evA.subs && (evA.subs.needWhy || '');
  const listenNeed = !!(evA && evA.listen && evA.listen.needShown);
  const subsNeed = !!(evA && evA.subs && evA.subs.needShown);
  // AC-D4: on regular home, if gated, why text must be complete (no truncation as sole content)
  // Even if both ok (mock later), we first capture natural gate; then if both enabled, artificially
  // we still require hero cards visible with hint text.
  const heroesVisible = !!(evA && evA.listen && evA.listen.hidden === false && evA.subs && evA.subs.hidden !== true);
  const whyComplete = (() => {
    const parts = [];
    if (listenNeed) parts.push(listenWhy);
    if (subsNeed) parts.push(subsWhy);
    if (!parts.length) {
      // not gated — still require hints present on both cards
      return !!(evA && evA.listen && evA.listen.hint && evA.subs && (evA.subs.hint || !evA.subs.hidden));
    }
    return parts.every((w) => w && w.length >= 8 && !/…\s*$/.test(w) && w !== '...');
  })();
  const d4pass = !!(d4 && d4.signedIn && heroesVisible && whyComplete && firstScreenGate
    && (d4.homeW >= 700 || (d4.lc && d4.lc.horizontalSizeClass === 'regular')));
  report.ac['AC-D4'] = d4pass ? 'PASS' : 'FAIL';
  report.ac['AC-D4-firstScreen'] = firstScreenGate ? 'PASS' : 'FAIL';
  report.notes.push('D4 listenNeed=' + listenNeed + ' why=' + JSON.stringify(listenWhy).slice(0, 80)
    + ' subsNeed=' + subsNeed + ' why=' + JSON.stringify(subsWhy).slice(0, 80)
    + ' w=' + (d4 && d4.homeW));
  log('  AC-D4 ' + report.ac['AC-D4']);

  // ── AC-D3：字幕跨姿态 + PiP ✕=暂停听 ──
  log('▶ AC-D3 mockLiveOk → open subtitle → start → hinge → pipClose');
  hinge('close');
  await sleep(1000);

  await evalOk(base, '__mtTest.mockLiveOk(1), true');
  await runAsync(base, `(async () => { if (window.AppListen && AppListen.refreshEntry) await AppListen.refreshEntry(); return true; })()`);
  await sleep(400);

  // Open subtitle UI (bypass disabled button via public open)
  await evalOk(base, `(window.AppListen.open('subtitle'), true)`);
  await sleep(600);
  const onSubs = await evalOk(base, `!!(document.getElementById('app-listen') && !document.getElementById('app-listen').hidden)`);
  log('  subtitle UI open=' + onSubs);
  if (!onSubs) {
    report.ac['AC-D3'] = 'FAIL';
    report.ac['pixel-04'] = 'BLOCKED';
    report.ac['pixel-05'] = 'BLOCKED';
    report.notes.push('could not open subtitle UI');
  } else {
    // DEBUG 强制 listening（产品 09:25：字幕 UI 进入后可用钩模拟听译态）
    await evalOk(base, `__mtTest.mockLiveOk(1), true`);
    let st0 = JSON.parse(await evalOk(base, `JSON.stringify(__mtTest.forceListening())`));
    log('  forceListening ' + JSON.stringify(st0));
    st0 = JSON.parse(await evalOk(base, `JSON.stringify(AppListen._debug())`));
    log('  after force phase=' + st0.phase + ' mode=' + st0.mode + ' id=' + st0.id);

    // Inject a caption-like final for pixel (timeline)
    if (st0.id) {
      await evalOk(base, `__mtTest.injectFinal(${JSON.stringify('Hello from Duo outer')}, {tr:${JSON.stringify('来自外屏的你好')}, who:'them'}), true`);
      await sleep(300);
    }

    screenshot('pixel-04-outer-closed');
    screenshot('pixel-04-lcd-primary', 'primary');
    screenshot('ac-d3-outer-closed');

    // pause / resume semantics across hinge
    const phaseBefore = st0.phase;
    hinge('open');
    await sleep(1200);
    let stOpen = JSON.parse(await evalOk(base, `JSON.stringify(AppListen._debug())`));
    screenshot('pixel-05-inner-open');
    screenshot('ac-d3-inner-open');
    hinge('close');
    await sleep(1200);
    let stBack = JSON.parse(await evalOk(base, `JSON.stringify(AppListen._debug())`));

    // Explicit pause then resume via toggle
    if (stBack.phase === 'listening') {
      await evalOk(base, `(AppListen.pause('user'), true)`);
      await sleep(400);
    }
    let stPaused = JSON.parse(await evalOk(base, `JSON.stringify(AppListen._debug())`));
    await evalOk(base, `(AppListen.resume && AppListen.resume(), true)`);
    // resume may need resumeByUser via toggle
    if (stPaused.phase === 'paused') {
      await evalOk(base, `(AppListen.toggle(), true)`);
      await sleep(500);
    }
    let stResumed = JSON.parse(await evalOk(base, `JSON.stringify(AppListen._debug())`));

    // Ensure listening for PiP ✕ test
    if (stResumed.phase !== 'listening') {
      await evalOk(base, `__mtTest.forceListening(), true`);
      await sleep(200);
      stResumed = JSON.parse(await evalOk(base, `JSON.stringify(AppListen._debug())`));
    }

    const pipWay = await evalOk(base, `__mtTest.simPipClose()`);
    await sleep(400);
    let stPip = JSON.parse(await evalOk(base, `JSON.stringify(AppListen._debug())`));
    log('  pipClose via=' + pipWay + ' phase=' + stPip.phase + ' pauseReason=' + stPip.pauseReason + ' id=' + stPip.id);

    const sameSid = !!(st0.id && stPip.id && st0.id === stPip.id);
    const pipPaused = stPip.phase === 'paused' && (stPip.pauseReason === 'user' || !stPip.pauseReason || stPip.pauseReason === 'user');
    const notEnded = stPip.phase !== 'ended';
    const pauseResumeOk = stPaused.phase === 'paused' && (stResumed.phase === 'listening' || stResumed.phase === 'preparing' || stResumed.phase === 'paused');
    // Across hinge: session id must hold
    const hingeOk = stOpen.id === st0.id && stBack.id === st0.id;

    const d3pass = !!(onSubs && sameSid && notEnded && pipPaused && hingeOk);
    report.ac['AC-D3'] = d3pass ? 'PASS' : 'FAIL';
    report.notes.push('D3 phase0=' + phaseBefore + ' open=' + stOpen.phase + ' back=' + stBack.phase
      + ' paused=' + stPaused.phase + ' pip=' + stPip.phase + '/' + stPip.pauseReason
      + ' sameSid=' + sameSid + ' hingeOk=' + hingeOk + ' pipWay=' + pipWay);
    log('  AC-D3 ' + report.ac['AC-D3']);

    // Pixel Duo-04/05：DOM 启发式（深色舞台 + mode-subtitle；内屏须有最近侧栏）。半成功不得 PASS。
    const pix = await evalOk(base, `(() => {
      const sec = document.getElementById('app-listen');
      const stage = document.getElementById('app-subs-pip');
      const hist = document.getElementById('app-listen-history-wrap');
      const cs = stage ? getComputedStyle(stage) : null;
      const bg = cs ? cs.backgroundColor : '';
      const dark = (bg || "").indexOf("15, 23, 42") >= 0 || (bg || "").indexOf("15,23,42") >= 0;
      const modeSub = !!(sec && sec.classList.contains('mode-subtitle'));
      const tr = document.querySelector('.subs-tr');
      const orig = document.querySelector('.subs-orig');
      const histDisp = hist ? getComputedStyle(hist).display : 'none';
      const title = document.getElementById('app-listen-history-title');
      return {
        modeSub, dark, bg,
        stageHidden: stage ? !!stage.hidden : null,
        tr: tr ? (tr.textContent || '').trim() : '',
        orig: orig ? (orig.textContent || '').trim() : '',
        histDisplay: histDisp,
        histTitle: title ? (title.textContent || '').trim() : '',
        w: window.innerWidth,
      };
    })()`);
    // closed was already shot; re-open for open-pose measure
    hinge('open');
    await sleep(1000);
    const pixOpen = await evalOk(base, `(() => {
      const sec = document.getElementById('app-listen');
      const stage = document.getElementById('app-subs-pip');
      const hist = document.getElementById('app-listen-history-wrap');
      const cs = stage ? getComputedStyle(stage) : null;
      const bg = cs ? cs.backgroundColor : '';
      const dark = (bg || "").indexOf("15, 23, 42") >= 0 || (bg || "").indexOf("15,23,42") >= 0;
      const modeSub = !!(sec && sec.classList.contains('mode-subtitle'));
      const histDisp = hist ? getComputedStyle(hist).display : 'none';
      const title = document.getElementById('app-listen-history-title');
      const tr = document.querySelector('.subs-tr');
      return {
        modeSub, dark, bg, histDisplay: histDisp,
        histTitle: title ? (title.textContent || '').trim() : '',
        tr: tr ? (tr.textContent || '').trim() : '',
        w: window.innerWidth,
      };
    })()`);
    screenshot('pixel-05-lcd1');
    hinge('close');
    await sleep(800);
    fs.writeFileSync(path.join(OUT, 'pixel-dom.json'), JSON.stringify({ closed: pix, open: pixOpen }, null, 2));
    const p04 = !!(pix && pix.modeSub && pix.dark && pix.stageHidden === false);
    const p05 = !!(pixOpen && pixOpen.modeSub && pixOpen.dark && pixOpen.histDisplay !== 'none'
      && /最近/.test(pixOpen.histTitle || ''));
    report.ac['pixel-04'] = p04 ? 'PASS' : 'FAIL';
    report.ac['pixel-05'] = p05 ? 'PASS' : 'FAIL';
    report.notes.push('pixel04=' + JSON.stringify(pix).slice(0, 180));
    report.notes.push('pixel05=' + JSON.stringify(pixOpen).slice(0, 180));
    fs.writeFileSync(path.join(OUT, 'ac-d3-states.json'), JSON.stringify({
      st0, stOpen, stBack, stPaused, stResumed, stPip, pipWay, pix, pixOpen,
    }, null, 2));
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'run.log'), logLines.join('\n'));
  log('▶ done · ' + OUT);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error('✗', e && e.stack || e);
  process.exit(1);
});
