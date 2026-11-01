#!/usr/bin/env node
// Duo sim · Duo-06 / Duo-08 像素 · DEBUG 登录注入（复用 AC-D3/D4 bridge 助手）
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
const OUT = path.join(ROOT, 'qa-evidence-duo', 'pixel-06-08-run');
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
  const FAKE_LEFT = 48;
  const report = {
    at: new Date().toISOString(),
    loginPath: 'DEBUG-injectSession',
    ac: {},
    tip: '',
    xcodeDefault: '',
    notes: [],
    fakeLeftPt: FAKE_LEFT,
  };
  try { report.tip = sh('git rev-parse --short HEAD').trim(); } catch (_) {}
  try { report.xcodeDefault = sh('/usr/bin/xcode-select -p').trim(); } catch (_) {}

  log('▶ refresh session (no token print)');
  const sess = await refreshSession();
  log('  email ok · userId len=' + String(sess.userId || '').length);

  log('▶ find MTTestBridge');
  let base = await findBase();
  if (!base) {
    try { sh(`xcrun simctl launch ${UDID} ${BUNDLE}`); } catch (_) {}
    for (let i = 0; i < 40 && !base; i++) { await sleep(500); base = await findBase(); }
  }
  if (!base) throw new Error('no MTTestBridge on 8790-8799');
  log('  bridge ' + base);

  for (let i = 0; i < 60; i++) {
    try {
      if (await evalOk(base, '!!(window.__mtTest && window.__mtTest.injectSession)')) break;
    } catch (_) {}
    await sleep(500);
    if (i === 59) throw new Error('__mtTest.injectSession missing — rebuild with testHarness');
  }

  log('▶ injectSession + reload');
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
  if (!injObj || !injObj.ok) throw new Error('injectSession failed');
  log('  inject ok');
  await sleep(1200);

  // Hinge open → dualRegular / home regular
  try { hinge('open'); log('  hinge open'); } catch (e) { log('  hinge open fail: ' + e.message); }
  await sleep(800);

  // Ensure on home
  await evalOk(base, `(() => { const L=window.AppListen; if (L && document.getElementById('app-listen') && !document.getElementById('app-listen').hidden) { try{L.leave();}catch(e){} } return true; })()`);
  await sleep(400);

  log('▶ Duo-06 home heroes');
  const home = await evalOk(base, `(() => {
    const q = (id) => document.getElementById(id);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return {
        top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        w: r.width, h: r.height,
        hidden: !!(el.hidden || st.display === 'none' || st.visibility === 'hidden'),
        opacity: st.opacity,
        inView: r.top >= -1 && r.bottom <= (window.innerHeight || 0) + 1,
      };
    };
    const heroes = document.querySelector('.heroes');
    const hc = heroes ? getComputedStyle(heroes) : null;
    const listen = q('app-listen-entry');
    const subs = q('app-subs-entry');
    const badgeL = q('app-listen-entry-badge');
    const badgeS = q('app-subs-entry-badge');
    const needLive = q('app-listen-need-live');
    const needSubs = q('app-subs-need');
    const whyLive = q('app-listen-need-live-why');
    const whySubs = q('app-subs-need-why');
    const needEl = (needLive && !needLive.hidden) ? needLive : needSubs;
    const why = ((whyLive && whyLive.textContent) || (whySubs && whySubs.textContent) || '').trim();
    return {
      signedIn: !!(q('signed-in') && !q('signed-in').hidden),
      w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY || 0,
      heroesDisplay: hc && hc.display,
      heroesCols: hc && hc.gridTemplateColumns,
      listen: box(listen), subs: box(subs),
      listenDisabled: !!(listen && listen.disabled),
      subsDisabled: !!(subs && subs.disabled),
      badgeListen: box(badgeL), badgeSubs: box(badgeS),
      badgeListenText: badgeL ? badgeL.textContent : null,
      badgeSubsText: badgeS ? badgeS.textContent : null,
      need: box(needEl), why,
      lc: window.__mtLayoutContext || null,
    };
  })()`);
  fs.writeFileSync(path.join(OUT, 'pixel-06-home.json'), JSON.stringify(home, null, 2));
  screenshot('pixel-06-home-open');

  // Dark appearance frame
  try {
    sh(`xcrun simctl ui ${UDID} appearance dark`);
    await sleep(700);
    screenshot('pixel-06-home-dark');
    sh(`xcrun simctl ui ${UDID} appearance light`);
    await sleep(400);
  } catch (e) { report.notes.push('dark-skip:' + e.message); }

  const twoCol = !!(home && (home.heroesDisplay === 'grid' || (home.heroesCols && /\\s/.test(String(home.heroesCols)))));
  const gated = !!(home && (home.subsDisabled || home.listenDisabled));
  const badgeOk = !!(home && (
    home.badgeSubsText === '暂不可用' || home.badgeListenText === '暂不可用' ||
    (home.subsDisabled && home.badgeSubs && !home.badgeSubs.hidden) ||
    (home.listenDisabled && home.badgeListen && !home.badgeListen.hidden)
  ));
  const whyOk = !!(home && home.why && home.why.length > 8 && !home.why.includes('…'));
  const firstScreen = !home || !home.need || home.need.hidden || !!home.need.inView;
  const d6pass = !!(home && home.signedIn && home.w >= 700 && twoCol && gated && badgeOk && whyOk && firstScreen);
  report.ac['Duo-06'] = d6pass ? 'PASS' : 'FAIL';
  report.notes.push('d6 twoCol=' + twoCol + ' gated=' + gated + ' badgeOk=' + badgeOk
    + ' why=' + JSON.stringify(home && home.why) + ' w=' + (home && home.w)
    + ' firstScreen=' + firstScreen + ' badgeSubs=' + JSON.stringify(home && home.badgeSubsText));

  // ── Duo-08 ──
  log('▶ Duo-08 listen + fake left inset ' + FAKE_LEFT);
  try { hinge('open'); } catch (_) {}
  await sleep(300);
  // Prefer opening dialogue listen (not subtitle)
  await evalOk(base, `(() => {
    try { if (window.__mtTest && __mtTest.mockLiveOk) __mtTest.mockLiveOk(true); } catch (e) {}
    return true;
  })()`);
  // Force entry capable if possible then open
  await evalOk(base, `(() => {
    try {
      if (window.AppListen && AppListen.open) { AppListen.open(); return 'AppListen'; }
    } catch (e) {}
    const b = document.getElementById('app-listen-entry');
    if (b && !b.disabled) { b.click(); return 'click'; }
    return 'noop';
  })()`);
  await sleep(900);
  // If still gated, open via listenModel if exposed
  await evalOk(base, `(() => {
    const el = document.getElementById('app-listen');
    if (el && !el.hidden) return 'open';
    try { if (window.listenModel && listenModel.open) { listenModel.open(); return 'model'; } } catch (e) {}
    try {
      // DEBUG: temporarily clear disabled by synthetic open path used in AC-D3
      if (window.__mtTest && __mtTest.openListen) { __mtTest.openListen('listen'); return 'test'; }
    } catch (e) {}
    return el ? ('hidden=' + el.hidden) : 'no-el';
  })()`);
  await sleep(600);

  const geom = await evalOk(base, `(() => {
    const FAKE = ${FAKE_LEFT};
    const root = document.documentElement;
    root.style.setProperty('--mt-safe-left', FAKE + 'px');
    let bar = document.getElementById('mt-fake-vbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mt-fake-vbar';
      bar.style.cssText = 'position:fixed;left:0;top:0;bottom:0;width:' + FAKE + 'px;background:rgba(255,120,40,0.35);border-right:2px solid #f60;z-index:99999;pointer-events:none;';
      document.body.appendChild(bar);
    }
    // force reflow
    void document.body.offsetWidth;
    const listen = document.getElementById('app-listen');
    const ptt = document.getElementById('app-listen-ptt') || document.querySelector('.listen-ptt-wrap');
    const btn = document.querySelector('.listen-ptt-btn');
    let star = document.querySelector('.listen-star');
    const back = document.getElementById('app-listen-back');
    if (!star) {
      const wrap = document.querySelector('.listen-history') || document.getElementById('app-listen-history-wrap') || listen;
      if (wrap) {
        const row = document.createElement('div');
        row.className = 'listen-row';
        row.innerHTML = '<div class="listen-body"><div class="listen-orig">避让测星</div></div><button type="button" class="listen-star" id="mt-fake-star">☆</button>';
        wrap.prepend(row);
        star = document.getElementById('mt-fake-star');
      }
    }
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height, right: r.right };
    };
    const stL = listen ? getComputedStyle(listen) : null;
    const stP = ptt ? getComputedStyle(ptt) : null;
    return {
      listenHidden: listen ? listen.hidden : null,
      presentation: root.getAttribute('data-mt-presentation'),
      padLeft: stL && stL.paddingLeft,
      pttPadLeft: stP && stP.paddingLeft,
      pttPos: stP && stP.position,
      listen: box(listen), ptt: box(ptt), btn: box(btn), star: box(star), back: box(back),
      starW: star ? star.getBoundingClientRect().width : null,
      starH: star ? star.getBoundingClientRect().height : null,
      btnH: btn ? btn.getBoundingClientRect().height : null,
      w: window.innerWidth, h: window.innerHeight,
      mtSafeLeft: getComputedStyle(root).getPropertyValue('--mt-safe-left').trim(),
    };
  })()`);
  fs.writeFileSync(path.join(OUT, 'pixel-08-geom.json'), JSON.stringify(geom, null, 2));
  screenshot('pixel-08-listen-fake-inset');

  const minLeft = FAKE_LEFT + 12 - 1;
  const btnLeft = geom && geom.btn ? geom.btn.left : null;
  const backLeft = geom && geom.back ? geom.back.left : null;
  const starLeft = geom && geom.star ? geom.star.left : null;
  const starSizeOk = !!(geom && geom.starW >= 43.5 && geom.starH >= 43.5);
  const btnSizeOk = !(geom && geom.btn) || (geom.btnH >= 43.5);
  const clearBtn = btnLeft == null || btnLeft >= minLeft;
  const clearBack = backLeft == null || backLeft >= minLeft;
  const clearStar = starLeft == null || starLeft >= minLeft;
  const padOk = !!(geom && geom.padLeft && parseFloat(geom.padLeft) >= FAKE_LEFT + 11);
  // Must have entered listen UI
  const inListen = !!(geom && geom.listenHidden === false);
  const d8pass = !!(inListen && padOk && clearBtn && clearBack && clearStar && starSizeOk && btnSizeOk);
  report.ac['Duo-08'] = d8pass ? 'PASS' : 'FAIL';
  report.notes.push('d8 inListen=' + inListen + ' padLeft=' + (geom && geom.padLeft)
    + ' btnLeft=' + btnLeft + ' backLeft=' + backLeft + ' starLeft=' + starLeft
    + ' star=' + (geom && geom.starW) + 'x' + (geom && geom.starH) + ' btnH=' + (geom && geom.btnH)
    + ' clear=' + JSON.stringify({ clearBtn, clearBack, clearStar, padOk, starSizeOk, btnSizeOk }));

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'run.log'), logLines.join('\\n') + '\\n');
  log('▶ DONE Duo-06=' + report.ac['Duo-06'] + ' Duo-08=' + report.ac['Duo-08']);
  console.log(JSON.stringify(report, null, 2));
  if (report.ac['Duo-06'] !== 'PASS' || report.ac['Duo-08'] !== 'PASS') process.exitCode = 2;
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
