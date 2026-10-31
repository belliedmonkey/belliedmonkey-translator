// test/utm.test.js — BEL-155 官网外链 UTM（src/shared/utm.js 唯一算法）。
//
// 钉：非我方 host 原样；hash 后置；四键齐全；双调幂等；china/intl 域名+campaign；
// edge_ext；privacy#sync 按 flavor（构造侧，这里验 withUtm 保 hash + campaign）。
const { loadSrc, describe, test, ok, eq, match } = require('./harness');

const EDGE_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

function load({ flavor = 'global', ua = CHROME_MAC, platform = 'MacIntel', app = false, firefox = false } = {}) {
  const window = { MT_FLAVOR: flavor };
  if (app) {
    window.webkit = { messageHandlers: { controller: { postMessage() {} } } };
  }
  const sandbox = {
    window,
    navigator: { userAgent: ua, platform },
  };
  if (firefox) sandbox.browser = { runtime: { getBrowserInfo() {} } };
  const ctx = loadSrc('src/shared/utm.js', 'MTUtm', sandbox);
  return ctx.MTUtm;
}

function params(url) {
  const u = new URL(url);
  return {
    source: u.searchParams.get('utm_source'),
    medium: u.searchParams.get('utm_medium'),
    campaign: u.searchParams.get('utm_campaign'),
    content: u.searchParams.get('utm_content'),
    hash: u.hash,
    host: u.hostname,
    path: u.pathname,
    href: u.toString(),
  };
}

describe('withUtm — 非我方 host 原样', () => {
  test('github / mailto / chrome-extension / api 不动', () => {
    const U = load();
    eq(U.withUtm('https://github.com/belliedmonkey/belliedmonkey-translator/discussions', 'discuss'),
      'https://github.com/belliedmonkey/belliedmonkey-translator/discussions');
    eq(U.withUtm('mailto:hi@belliedmonkey.com', 'x'), 'mailto:hi@belliedmonkey.com');
    eq(U.withUtm('https://api.belliedmonkey.com/models/list', 'x'),
      'https://api.belliedmonkey.com/models/list');
    eq(U.withUtm('chrome-extension://abcdef/options.html', 'x'),
      'chrome-extension://abcdef/options.html');
  });
});

describe('withUtm — hash 后置 + 四键', () => {
  test('privacy#sync：query 在 hash 前；四键齐', () => {
    const U = load({ flavor: 'china', app: true, ua: SAFARI_IPHONE, platform: 'iPhone' });
    const out = U.withUtm('https://belliedmonkey.com/privacy.html#sync', 'settings_privacy_sync');
    const p = params(out);
    eq(p.hash, '#sync');
    eq(p.host, 'belliedmonkey.com');
    eq(p.medium, 'in_app');
    eq(p.campaign, 'china');
    eq(p.content, 'settings_privacy_sync');
    eq(p.source, 'ios_app');
    ok(out.indexOf('?') < out.indexOf('#'), 'hash must follow query: ' + out);
  });
  test('intl setup：campaign=intl（禁 global）；chrome_ext', () => {
    const U = load({ flavor: 'global', ua: CHROME_MAC });
    const p = params(U.withUtm('https://belliedmonkey.cc/setup.html', 'webext_setup'));
    eq(p.campaign, 'intl');
    eq(p.source, 'chrome_ext');
    eq(p.content, 'webext_setup');
    ok(p.href.indexOf('global') < 0, p.href);
  });
});

describe('withUtm — 幂等覆盖', () => {
  test('二次 withUtm 只留一套四键，content 以最后一次为准', () => {
    const U = load({ ua: CHROME_MAC });
    const once = U.withUtm('https://belliedmonkey.cc/setup.html', 'ob_setup');
    const twice = U.withUtm(once, 'webext_setup');
    const p = params(twice);
    eq(p.content, 'webext_setup');
    eq([...twice.matchAll(/utm_source=/g)].length, 1);
    eq([...twice.matchAll(/utm_content=/g)].length, 1);
  });
});

describe('utmSource — host+device + Edge', () => {
  test('Edge=edge_ext（不并入 chrome_ext）', () => {
    eq(load({ ua: EDGE_MAC }).utmSource(), 'edge_ext');
  });
  test('Chrome=chrome_ext；Firefox=firefox_ext；Safari=safari_ext', () => {
    eq(load({ ua: CHROME_MAC }).utmSource(), 'chrome_ext');
    eq(load({ ua: FIREFOX, firefox: true }).utmSource(), 'firefox_ext');
    eq(load({ ua: SAFARI_IPHONE, platform: 'iPhone' }).utmSource(), 'safari_ext');
    eq(load({ ua: SAFARI_MAC, platform: 'MacIntel' }).utmSource(), 'safari_ext');
  });
  test('App：iPhone→ios_app；Mac→mac_app', () => {
    eq(load({ app: true, ua: SAFARI_IPHONE, platform: 'iPhone' }).utmSource(), 'ios_app');
    eq(load({ app: true, ua: SAFARI_MAC, platform: 'MacIntel' }).utmSource(), 'mac_app');
  });
});

describe('utmCampaign — china / intl', () => {
  test('flavor china→china；其它→intl', () => {
    eq(load({ flavor: 'china' }).utmCampaign(), 'china');
    eq(load({ flavor: 'global' }).utmCampaign(), 'intl');
    eq(load({ flavor: undefined }).utmCampaign(), 'intl');
  });
});

describe('privacy#sync flavor 构造（ACCEPT-U1 契约）', () => {
  test('shell-model 不再硬编码 .com —— 源码按 flavor 分流', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/shell-model.js'), 'utf8');
    ok(!/openExternal\('https:\/\/belliedmonkey\.com\/privacy\.html#sync'\)/.test(src),
      'privacy#sync 仍硬编码 .com');
    ok(/settings_privacy_sync/.test(src), '缺 settings_privacy_sync content');
    ok(/syncHost/.test(src) && /belliedmonkey\.cc/.test(src), '缺 flavor→host 分流');
  });
});
