// src/shared/utm.js — App/扩展 → 官网外链的唯一 UTM 助手（BEL-155）。
//
// 只改写 belliedmonkey.cc|.com；其它 host / mailto / 商店 / API / auth 原样返回。
// hash（#sync / #usage）必须落在 query 之后 —— 用 URL API，toString 自带这个顺序。
// 四键幂等覆盖：二次 withUtm 安全。utm_campaign 禁输出 flavor 字面 `global`，一律 intl。
//
// utm_source 探测与 MTFeedback.host+device 同规则，并补 Edge=edge_ext（Edg/）。
// **禁**在 feedback.js 另写一份 —— feedback 调 window.MTUtm / 本模块导出。

import Registry from '../lib/registry.js';

const OUR_HOSTS = new Set(['belliedmonkey.cc', 'belliedmonkey.com']);

function utmSource() {
  // 原生桥先判：WKWebView 的 UA 在 macOS 上也带 Safari，靠 UA 分不出 App。
  try {
    if (typeof window !== 'undefined'
        && window.webkit && window.webkit.messageHandlers
        && window.webkit.messageHandlers.controller) {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      const p = (typeof navigator !== 'undefined' && navigator.platform) || '';
      const s = ua + ' ' + p;
      if (/iPad/i.test(s) || /iPhone|iPod/i.test(s)) return 'ios_app';
      if (/Mac/i.test(s)) return 'mac_app';
      return 'ios_app'; // 少见平台不发明新 source
    }
  } catch (_) {}
  try {
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo) {
      return 'firefox_ext';
    }
  } catch (_) {}
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Firefox/i.test(ua)) return 'firefox_ext';
  if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg\//i.test(ua)) return 'safari_ext';
  if (/Edg\//i.test(ua)) return 'edge_ext';
  return 'chrome_ext';
}

function utmCampaign() {
  try {
    return (Registry.flavor() === 'china') ? 'china' : 'intl';
  } catch (_) {
    return 'intl';
  }
}

function withUtm(url, content) {
  if (url == null || url === '') return url;
  let u;
  try { u = new URL(String(url)); } catch (_) { return url; }
  if (!OUR_HOSTS.has(u.hostname)) return url;
  u.searchParams.set('utm_source', utmSource());
  u.searchParams.set('utm_medium', 'in_app');
  u.searchParams.set('utm_campaign', utmCampaign());
  u.searchParams.set('utm_content', content == null ? '' : String(content));
  return u.toString();
}

export { withUtm, utmSource, utmCampaign };
export default { withUtm, utmSource, utmCampaign };
