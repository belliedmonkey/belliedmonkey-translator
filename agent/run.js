// agent/run.js — runAgentAction. Sensitive work does not run without a confirm
// decision or an existing grant (AC-A2). Receipts are §5 and carry no text,
// transcript, translation, or content (AC-A7).
'use strict';

const copy = require('./copy');
const {
  CODE_SET, RECEIPT_KEYS, EXPLAIN_MODES, TEXT_MAX, SETUP_STEPS,
  isSensitive, fixFor,
} = require('./contract');
const { sourceOf, callerIdOf, langOf, hostnameOf } = require('./parse');
const { hasGrant, remember } = require('./grants-model');
const { resolveCredential, runsWithoutAccount, engineReady, publicAuth } = require('./credentials');

function newId() {
  const bytes = new Uint8Array(8);
  const web = typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues;
  if (web) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return 'agt_' + hex;
}

function receipt(action, code, message, fix) {
  if (!CODE_SET.has(code)) {
    throw new Error('failure code outside §6');
  }
  const rec = {
    ok: code === 'ok',
    action: action || '',
    code,
    message: message || '',
    fix: fix && typeof fix === 'object' ? fix : {},
    receipt_id: newId(),
  };
  const keys = Object.keys(rec);
  if (keys.length !== RECEIPT_KEYS.length || RECEIPT_KEYS.some((k) => !Object.prototype.hasOwnProperty.call(rec, k))) {
    throw new Error('receipt shape drifted from §5');
  }
  return rec;
}

function codePoints(s) {
  return Array.from(String(s || '')).length;
}

function suppliedText(query, confirmed) {
  const fromQuery = query && (query.text || query.quote);
  if (fromQuery) return String(fromQuery);
  if (confirmed && confirmed.paste) return String(confirmed.paste);
  return '';
}

function readinessGaps(readiness, hostConnected) {
  const r = readiness || {};
  const pairs = [
    ['login', 'need_login'],
    ['packs', 'need_packs'],
    ['engine', 'need_engine'],
    ['os', 'need_os'],
    ['ext', 'need_ext'],
    ['mic', 'need_permission_mic'],
    ['network', 'network_unavailable'],
  ];
  const gaps = [];
  for (const [key, code] of pairs) {
    if (r[key] === false) gaps.push(code);
  }
  const measured = pairs.some(([key]) => r[key] === true || r[key] === false);
  if (!hostConnected && !measured) gaps.push('need_app');
  return gaps;
}

function siteLine(host) {
  const line = copy.FAILURES.site_unsupported.line;
  return host ? line + '（' + host + '）' : line;
}

function messageFor(code, extra) {
  const fail = copy.failureRow(code);
  if (fail) {
    if (code === 'site_unsupported' || fail.code === 'site_unsupported') return siteLine(extra && extra.host);
    return fail.line;
  }
  const m = copy.MESSAGES;
  switch (code) {
    case 'need_confirm': return m.needConfirm;
    case 'cancelled': return m.cancelled;
    case 'untrusted_denied': return m.untrusted;
    case 'bad_request': return (extra && extra.bad) || m.badRequest;
    case 'unsupported_action': return m.unsupported;
    case 'need_os': return m.needOs;
    case 'study_capture_off': return m.studyOff;
    default: return '';
  }
}

function credentialOf(ctx) {
  return resolveCredential({ env: ctx && ctx.env, readiness: ctx && ctx.readiness });
}

const ENGINE_ACTIONS = new Set([
  'start_live_subtitles',
  'translate_page',
  'translate_video_captions',
  'explain_or_drill',
]);

// Provider wire for stdio. capture_to_study is a local write, not this
// transport. start_live_subtitles stays off this wire.
const HOST_BILLABLE = new Set([
  'translate_page',
  'translate_video_captions',
  'explain_or_drill',
]);

function preconditions(action, ctx) {
  const query = ctx.query || {};
  const scheme = ctx.scheme;
  const source = sourceOf(query, ctx.sourceFallback);
  const r = ctx.readiness || {};
  const cred = credentialOf(ctx);
  const fail = (code, extra) => receipt(
    action, code, messageFor(code, extra), fixFor(code, scheme, source));

  if (action === 'ready.check' || action === 'open_setup') return null;

  // Offline is recoverable. The card retries; it does not open key or login setup.
  if (r.network === false && ENGINE_ACTIONS.has(action)) return fail('network_unavailable');

  if (action === 'start_live_subtitles') {
    // No host key, no BYOK, no grant, and the engine is known missing:
    // send the user to their own key. Do not make login the only door.
    if (!engineReady(cred) && r.engine === false) return fail('quota_or_key');
    if (!runsWithoutAccount(cred) && r.login === false) return fail('need_login');
    if (r.packs === false) return fail('need_packs');
    if (r.os === false) return fail('need_os');
    if (r.mic === false) return fail('need_permission_mic');
    return null;
  }
  if (action === 'translate_page' || action === 'translate_video_captions') {
    if (r.ext !== true) return fail('need_ext');
    if (!engineReady(cred) && r.engine === false) return fail('quota_or_key');
    if (action === 'translate_video_captions' && typeof ctx.siteSupported === 'function') {
      const host = hostnameOf(query.url);
      if (ctx.siteSupported(query.url) === false) return fail('site_unsupported', { host });
    }
    return null;
  }
  if (action === 'capture_to_study') {
    if (!runsWithoutAccount(cred) && r.login === false) return fail('need_login');
    if (r.studyCapture === false) return fail('study_capture_off');
    const text = suppliedText(query, null);
    if (text && codePoints(text) > TEXT_MAX) return fail('bad_request', { bad: copy.MESSAGES.textTooLong });
    return null;
  }
  if (action === 'explain_or_drill') {
    if (query.mode && !EXPLAIN_MODES.has(String(query.mode))) {
      return fail('bad_request');
    }
    if (!engineReady(cred) && r.engine === false) return fail('need_engine');
    const text = suppliedText(query, null);
    if (text && codePoints(text) > TEXT_MAX) return fail('bad_request', { bad: copy.MESSAGES.textTooLong });
    return null;
  }
  return fail('unsupported_action');
}

function successMessage(action, query) {
  if (action === 'open_setup') return copy.MESSAGES.openedSetup;
  if (action === 'start_live_subtitles') return copy.MESSAGES.openedSubtitles;
  if (action === 'capture_to_study') return copy.MESSAGES.captured;
  if (action === 'explain_or_drill') {
    return String(query && query.mode) === 'drill' ? copy.MESSAGES.drilled : copy.MESSAGES.explained;
  }
  if (action === 'translate_page' || action === 'translate_video_captions') return copy.MESSAGES.readyOk;
  return copy.MESSAGES.readyOk;
}

function portFor(action, ports) {
  const p = ports || {};
  if (action === 'open_setup') return p.openSetup;
  if (action === 'start_live_subtitles') return p.enterSubtitle;
  if (action === 'translate_page') return p.translatePage;
  if (action === 'translate_video_captions') return p.translateCaptions;
  if (action === 'capture_to_study') return p.capture;
  if (action === 'explain_or_drill') return p.explain;
  return null;
}

function missingCode(action) {
  if (action === 'translate_page' || action === 'translate_video_captions') return 'need_ext';
  if (action === 'explain_or_drill') return 'need_app';
  if (action === 'capture_to_study') return 'need_app';
  return 'need_app';
}

function langs(query) {
  return {
    lang: langOf(query && query.lang),
    videoLang: langOf(query && query.video_lang),
    myLang: langOf(query && query.my_lang),
  };
}

async function runAgentAction(action, ctx) {
  const query = ctx.query || {};
  const scheme = ctx.scheme;
  const source = sourceOf(query, ctx.sourceFallback);
  const callerId = callerIdOf(query);
  const grants = ctx.grants || { device: {}, assistants: {} };

  if (action === 'ready.check') {
    const gaps = readinessGaps(ctx.readiness, ctx.hostConnected !== false);
    const message = gaps.length
      ? copy.MESSAGES.gapPrefix + gaps.join(',')
      : copy.MESSAGES.readyOk;
    return { receipt: receipt(action, 'ok', message, {}) };
  }

  if (action === 'open_setup') {
    const step = query.step ? String(query.step) : '';
    if (step && SETUP_STEPS.indexOf(step) === -1) {
      return { receipt: receipt(action, 'bad_request', copy.MESSAGES.badRequest, {}) };
    }
  }

  const blocked = preconditions(action, ctx);
  if (blocked) return { receipt: blocked };

  const granted = hasGrant(grants, action, callerId);
  const confirmed = ctx.confirmed;
  if (isSensitive(action) && !granted && !(confirmed && confirmed.allow === true)) {
    return {
      receipt: receipt(action, 'untrusted_denied', copy.MESSAGES.untrusted, {}),
    };
  }

  let nextGrants = grants;
  if (confirmed && confirmed.allow === true && isSensitive(action)
      && (confirmed.device || (confirmed.assistant && callerId))) {
    nextGrants = remember(grants, action, confirmed, callerId);
    if (typeof ctx.persistGrants === 'function') {
      try { ctx.persistGrants(nextGrants); }
      catch (_) { /* allow-once still proceeds when persistence fails */ }
    }
  }

  if (action === 'capture_to_study') {
    const text = suppliedText(query, confirmed);
    if (!text) {
      return { receipt: receipt(action, 'bad_request', copy.MESSAGES.badRequest, {}) };
    }
    if (codePoints(text) > TEXT_MAX) {
      return { receipt: receipt(action, 'bad_request', copy.MESSAGES.textTooLong, {}) };
    }
  }

  const cred = credentialOf(ctx);
  let chargedOk = false;
  if (HOST_BILLABLE.has(action)
      && (cred.kind === 'host_subscription' || cred.kind === 'host_key')
      && typeof ctx.charge === 'function') {
    let billed = null;
    try {
      billed = await ctx.charge({
        action,
        cred: publicAuth(cred),
        env: ctx.env || {},
        text: suppliedText(query, confirmed),
      });
    } catch (_) {
      billed = { ok: false, code: 'network_unavailable' };
    }
    if (billed && billed.quota && typeof ctx.observeQuota === 'function') {
      try { ctx.observeQuota(billed.quota); } catch (_) {}
    }
    if (!billed || billed.ok !== true) {
      const code = billed && CODE_SET.has(billed.code) ? billed.code : 'quota_or_key';
      return { receipt: receipt(action, code, messageFor(code, {}), fixFor(code, scheme, source)) };
    }
    chargedOk = true;
  }

  const fn = portFor(action, ctx.ports);
  if (typeof fn !== 'function') {
    if (chargedOk) {
      return { receipt: receipt(action, 'ok', successMessage(action, query), {}), grants: nextGrants };
    }
    const code = missingCode(action);
    return { receipt: receipt(action, code, messageFor(code, {}), fixFor(code, scheme, source)) };
  }

  let portResult = { ok: true };
  if (typeof fn === 'function') {
    const text = suppliedText(query, confirmed);
    try {
      portResult = await fn({
        action,
        step: query.step ? String(query.step) : '',
        mode: query.mode && EXPLAIN_MODES.has(String(query.mode)) ? String(query.mode) : 'explain',
        text,
        langs: langs(query),
        site: hostnameOf(query.url),
        auth: publicAuth(cred),
      }) || { ok: true };
    } catch (_) {
      return { receipt: receipt(action, 'bad_request', copy.MESSAGES.badRequest, {}) };
    }
  }

  if (portResult && portResult.ok === false && portResult.code && portResult.code !== 'ok') {
    // Card code and wire code differ for the grant/key failure. A code outside
    // §6 must not fall through to ok.
    const code = portResult.code === 'grant_or_key_unavailable' ? 'quota_or_key' : portResult.code;
    if (!CODE_SET.has(code)) {
      return { receipt: receipt(action, 'bad_request', copy.MESSAGES.badRequest, {}) };
    }
    const extra = {};
    if (code === 'site_unsupported') extra.host = hostnameOf(query.url);
    return { receipt: receipt(action, code, messageFor(code, extra), fixFor(code, scheme, source)) };
  }

  return { receipt: receipt(action, 'ok', successMessage(action, query), {}), grants: nextGrants };
}

function cancelledReceipt(action) {
  return receipt(action, 'cancelled', copy.MESSAGES.cancelled, {});
}

function needConfirmReceipt(action, scheme, source) {
  return receipt(action, 'need_confirm', copy.MESSAGES.needConfirm, {});
}

function unsupportedReceipt(action, scheme, source) {
  return receipt(action || '', 'unsupported_action', copy.MESSAGES.unsupported, {});
}

function badRequestReceipt(action) {
  return receipt(action || '', 'bad_request', copy.MESSAGES.badRequest, {});
}

module.exports = {
  receipt,
  preconditions,
  readinessGaps,
  runAgentAction,
  cancelledReceipt,
  needConfirmReceipt,
  unsupportedReceipt,
  badRequestReceipt,
  suppliedText,
};
