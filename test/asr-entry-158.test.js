// test/asr-entry-158.test.js — #158 D1–D4：AI 字幕入口平台提示、opening 兜底、商店链接、iPad 判据。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok, deepEq, loadModule } = require('./harness');

const ROOT = path.join(__dirname, '..');
const A = loadModule(['content/device.js', 'content/asr-source.js', 'learn/app-link.js'], {
  window: {},
}).AsrSource;
const Device = loadModule(['content/device.js'], {}).Device;

describe('#158 asr-source — D4 iPad via Device', () => {
  test('isHandheld uses Device.classOf (Mac vs iPad desktop UA)', () => {
    const navMac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140', maxTouchPoints: 0 };
    const navIpad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18 Safari/605', maxTouchPoints: 5 };
    eq(Device.classOf(navMac), 'desktop');
    eq(Device.classOf(navIpad), 'tablet');
    const src = fs.readFileSync(path.join(ROOT, 'extension/content/asr-source.js'), 'utf8');
    ok(/Device\.classOf/.test(src), 'asr-source delegates handheld to Device.classOf');
    ok(!/\/iPhone\|iPad\|iPod\//.test(src.slice(src.indexOf('function isHandheld'), src.indexOf('function appPointer'))),
      'isHandheld must not use legacy UA regex');
  });
});

describe('#158 asr-source — D1 no_app platform_only', () => {
  test('startFrom on non-Apple sets platform_only phase', () => {
    A._resetListenPhase();
    global.AppLink = { applePlatform: () => false, open: () => {}, storeUrl: () => '' };
    global.MTTelemetry = { track: () => {} };
    try {
      const r = A.startFrom('notice', { duration: 60 }, { streaming: false }, {});
      deepEq(r, { ok: false, reason: 'no_app' });
      eq(A.getListenPhase(), 'platform_only');
    } finally {
      delete global.AppLink;
      delete global.MTTelemetry;
      A._resetListenPhase();
    }
  });
});

describe('#158 asr-source — D3 no auto App Store on fallback', () => {
  test('openListenApp does not window.open store in AppLink callback', () => {
    const src = fs.readFileSync(path.join(ROOT, 'extension/content/asr-source.js'), 'utf8');
    const fn = src.slice(src.indexOf('function openListenApp'), src.indexOf('function appPointer'));
    ok(!/window\.open\(AppLink\.storeUrl/.test(fn), 'must not auto-open App Store on deeplink fallback');
    ok(/kind === 'store' \? 'not_opened'/.test(fn), 'fallback sets not_opened phase');
  });
});

describe('#158 asr-source — D2 opening phase', () => {
  test('openListenApp enters opening; timer fallback → not_opened', () => {
    const ctx = loadModule(['content/device.js', 'learn/app-link.js', 'content/asr-source.js'], {
      window: {},
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 },
      document: { addEventListener: () => {}, removeEventListener: () => {}, hidden: false },
      MTTelemetry: { track: () => {} },
    });
    const Asr = ctx.AsrSource;
    Asr._resetListenPhase();
    let fb;
    ctx.AppLink = {
      applePlatform: () => true,
      open: (uid, onFallback) => { fb = onFallback; return 'belliedmonkey://listen'; },
      storeUrl: () => 'https://apps.apple.com/app/id6787190032',
    };
    try {
      Asr.startFrom('popup', { duration: 90 }, { streaming: false }, {});
      eq(Asr.getListenPhase(), 'opening');
      fb('store');
      eq(Asr.getListenPhase(), 'not_opened');
    } finally {
      Asr._resetListenPhase();
    }
  });
});

describe('#158 popup — D1 no_app uses asr_platform_only', () => {
  test('onTranscribe handles no_app without popup_asr_none_found', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/pages/popup.jsx'), 'utf8');
    ok(/reason === 'no_app'/.test(src), 'no_app branch');
    ok(/asr_platform_only/.test(src), 'uses asr_platform_only');
    ok(/setAsrNote\(t\('asr_platform_only'/.test(src), 'no_app sets asr_platform_only note');
  });
});

describe('#158 popup — D2 no immediate window.close on App listen', () => {
  test('onAppRowClick does not close popup; blur handler may', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/pages/popup.jsx'), 'utf8');
    const rowFn = src.slice(src.indexOf('function onAppRowClick'), src.indexOf('async function onTranscribe'));
    ok(!/window\.close/.test(rowFn), 'app row click must not synchronously close popup');
    const listenFn = src.slice(src.indexOf('function openListenFromPopup'), src.indexOf('function onAppRowClick'));
    ok(/addEventListener\('blur'/.test(listenFn), 'blur closes popup when App opens');
    ok(!/AppLink\.open[\s\S]{0,200}window\.close/.test(listenFn), 'must not close right after AppLink.open');
  });
});

describe('#158 popup — D4 Device.classOf for handheld', () => {
  test('popup uses Device.classOf not iPad UA regex alone', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/pages/popup.jsx'), 'utf8');
    ok(/Device\.classOf/.test(src), 'handheld via Device.classOf');
    ok(!/\/iPhone\|iPad\|iPod\//.test(src.split('function Popup')[1] || src), 'no legacy handheld UA regex in popup');
  });
});

describe('#158 i18n — two new keys in all locales', () => {
  test('asr_platform_only and asr_app_not_opened present in 13 locales', () => {
    const dir = path.join(ROOT, 'extension/_locales');
    for (const loc of fs.readdirSync(dir)) {
      const f = path.join(dir, loc, 'messages.json');
      if (!fs.existsSync(f)) continue;
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      ok(m.asr_platform_only && m.asr_platform_only.message, loc + ' asr_platform_only');
      ok(m.asr_app_not_opened && m.asr_app_not_opened.message, loc + ' asr_app_not_opened');
    }
  });
});
