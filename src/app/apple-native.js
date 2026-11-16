// src/app/apple-native.js — BEL-272: native Sign in with Apple failure semantics.
//
// The Swift bridge reports the ASAuthorizationError code and domain alongside its
// legacy `error` string. This module is the ONE place that turns those numbers into
// the bounded `auth_fail.code` value and drives the two exits on the login card.
//
// Contract choice (telemetry-design §3.14, `auth_fail` whitelist):
//   props are exactly provider / stage / code / http / attempt; `code` is 'id'
//   (/^[a-z0-9_-]{1,32}$/). There is no field for a numeric code or a domain, so
//   BOTH travel in `code` as `apple_<domain-class>_<code>`:
//
//     ASAuthorizationError domain  -> apple_asauth_1000
//     NSCocoaErrorDomain           -> apple_cocoa_4097
//     NSURLErrorDomain             -> apple_url_-1009
//     NSOSStatusErrorDomain        -> apple_os_-128
//     AKAuthenticationError        -> apple_ak_-7003
//     anything else                -> apple_other_42
//
//   Cancellation is NOT a failure: it keeps the existing `canceled` result/code
//   semantics (and a neutral sentence), and never becomes `apple_failed`.
//   A successful authorization without an identityToken is `apple_no_token`;
//   a bridge that predates BEL-272 (error only) is `apple_no_code`.
//
// No user identifier, token, or free text is ever put into the event.

export const APPLE_CANCELED_CODE = 1001;
export const APPLE_ERROR_DOMAIN = 'com.apple.AuthenticationServices.AuthorizationError';

const DOMAIN_TOKENS = [
  [APPLE_ERROR_DOMAIN, 'asauth'],
  ['ASAuthorizationErrorDomain', 'asauth'],
  ['NSCocoaErrorDomain', 'cocoa'],
  ['NSURLErrorDomain', 'url'],
  ['NSOSStatusErrorDomain', 'os'],
  ['AKAuthenticationError', 'ak'],
];

// A short, stable class for the NSError domain. Unknown domains are `other`;
// the raw domain never reaches an event prop (it can be long and is not bounded).
export function appleDomainClass(domain) {
  const d = String(domain == null ? '' : domain).trim();
  if (!d) return 'other';
  for (const [known, token] of DOMAIN_TOKENS) {
    if (d === known) return token;
  }
  // Defensive: older SDKs sometimes report the domain with a bundle prefix.
  if (/\.AuthorizationError$/i.test(d)) return 'asauth';
  return 'other';
}

function appleCodeToken(code) {
  if (code === '' || code == null) return 'unknown';
  const n = Number(code);
  if (!Number.isFinite(n) || Math.trunc(n) !== n) return 'unknown';
  return String(n);
}

function isCanceledResult(r) {
  if (String(r.error || '') === 'canceled') return true;
  // Belt and braces: if a host sends the numeric code without the string, the
  // ASAuthorizationError.canceled code still means "user backed out", not failure.
  return appleDomainClass(r.errorDomain) === 'asauth'
    && appleCodeToken(r.errorCode) === String(APPLE_CANCELED_CODE);
}

// The auth_fail.code for a failed native result. Callers only use this when the
// result is a failure; cancellation is handled separately (see classify below).
export function appleEventCode(result) {
  const r = result && typeof result === 'object' ? result : {};
  const error = String(r.error || '');
  if (error === 'canceled' || isCanceledResult(r)) return 'canceled';
  if (error === 'no_identity_token') return 'apple_no_token';
  if (error === 'encode') return 'apple_encode';
  if (error === 'apple_failed' && r.errorCode == null && !r.errorDomain) return 'apple_no_code';
  if (r.errorCode == null && !r.errorDomain) return 'apple_unknown';
  return 'apple_' + appleDomainClass(r.errorDomain) + '_' + appleCodeToken(r.errorCode);
}

// success | canceled | failed. `code` is '' | 'canceled' | appleEventCode().
export function classifyAppleResult(result) {
  const r = result && typeof result === 'object' ? result : {};
  if (!r.error) return { kind: 'success', code: '' };
  if (isCanceledResult(r)) return { kind: 'canceled', code: 'canceled' };
  return { kind: 'failed', code: appleEventCode(r) };
}

// Drives the failure block on the login card:
//   · retry  -> the same startAppleSignIn() path (a fresh ASAuthorizationController
//               in the bridge, so the system sheet can appear again);
//   · other  -> expand the existing email form; Google stays visible beside it.
// `$` is injected so this logic can be exercised without a DOM.
export function createAppleFailureUi(options) {
  const o = options || {};
  const $ = o.$ || (() => null);
  const t = o.t || ((k, fallback) => fallback || '');
  const say = o.say || (() => {});
  const noteNative = o.noteNative || (() => {});
  const start = o.start || (() => {});
  const openOther = o.openOther || (() => {});
  const el = (id) => {
    try { return $(id); } catch (_) { return null; }
  };
  let lastCode = '';
  let wired = false;

  function paint() {
    const text = el('apple-fail-text');
    if (text) {
      text.textContent = t('app_apple_no_credential',
        '没有拿到 Apple 凭据。可以重试 Apple 登录，或改用邮箱 / Google。');
    }
    const retry = el('btn-apple-retry');
    if (retry) retry.textContent = t('app_apple_retry', '重试 Apple 登录');
    const other = el('btn-apple-other');
    if (other) other.textContent = t('app_apple_other', '改用邮箱/Google');
  }

  function hide() {
    const panel = el('apple-fail');
    if (panel) panel.hidden = true;
  }

  function show() {
    paint();
    const panel = el('apple-fail');
    if (panel) panel.hidden = false;
  }

  // Emits the existing `canceled` semantic, never apple_failed, and says so
  // without the word "失败" (user cancel is not a broken login).
  function canceled() {
    lastCode = 'canceled';
    hide();
    say(t('app_apple_canceled', '已取消 Apple 登录，可以再点一次。'));
    try { noteNative('canceled'); } catch (_) {}
    return { kind: 'canceled', code: 'canceled' };
  }

  function failed(result) {
    const classified = classifyAppleResult(result);
    if (classified.kind === 'canceled') return canceled();
    if (classified.kind !== 'failed') { hide(); return classified; }
    lastCode = classified.code;
    const panel = el('apple-fail');
    if (panel) {
      show();
      say('');
    } else {
      // Old host HTML: keep the sentence on the status line rather than going silent.
      say(t('app_apple_no_credential',
        '没有拿到 Apple 凭据。可以重试 Apple 登录，或改用邮箱 / Google。'), true);
    }
    try { noteNative(classified.code); } catch (_) {}
    return classified;
  }

  function wire() {
    if (wired) return;
    wired = true;
    const retry = el('btn-apple-retry');
    if (retry) retry.addEventListener('click', () => { hide(); start(); });
    const other = el('btn-apple-other');
    if (other) other.addEventListener('click', () => { hide(); openOther(); });
  }

  return { wire, hide, show, canceled, failed, classify: classifyAppleResult, code: () => lastCode };
}
