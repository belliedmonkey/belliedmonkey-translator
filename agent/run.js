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
  const fail = copy.FAILURES[code];
  if (fail) {
    if (code === 'site_unsupported') return siteLine(extra && extra.host);
    return fail.line;
  }
  const m = copy.MESSAGES;
  switch (code) {
    case 'need_confirm': return m.needConfirm;
    case 'cancelled': return m.cancelled;
    case 'untrusted_denied': return m.untrusted;
    case 'bad_request': return (extra && extra.bad) || m.badRequest;
    case 'unsupported_action': return m.unsupported;
    case 'need_login': return m.needLogin;
    case 'need_app': return (extra && extra.unwired) || m.needApp;
    case 'need_os': return m.needOs;
    case 'quota_or_key': return m.quota;
    case 'study_capture_off': return m.studyOff;
    default: return '';
  }
}

function preconditions(action, ctx) {
  const query = ctx.query || {};
  const scheme = ctx.scheme;
  const source = sourceOf(query, ctx.sourceFallback);
  const r = ctx.readiness || {};
  const fail = (code, extra) => receipt(
    action, code, messageFor(code, extra), fixFor(code, scheme, source));

  if (action === 'ready.check' || action === 'open_setup') return null;

  if (action === 'start_live_subtitles') {
    if (r.login === false) return fail('need_login');
    if (r.packs === false) return fail('need_packs');
    if (r.os === false) return fail('need_os');
    if (r.mic === false) return fail('need_permission_mic');
    return null;
  }
  if (action === 'translate_page' || action === 'translate_video_captions') {
    if (r.ext !== true) return fail('need_ext');
    if (r.engine === false) return fail('quota_or_key');
    if (action === 'translate_video_captions' && typeof ctx.siteSupported === 'function') {
      const host = hostnameOf(query.url);
      if (ctx.siteSupported(query.url) === false) return fail('site_unsupported', { host });
    }
    return null;
  }
  if (action === 'capture_to_study') {
    if (r.login === false) return fail('need_login');
    if (r.studyCapture === false) return fail('study_capture_off');
    const text = suppliedText(query, null);
    if (text && codePoints(text) > TEXT_MAX) return fail('bad_request', { bad: copy.MESSAGES.textTooLong });
    return null;
  }
  if (action === 'explain_or_drill') {
    if (query.mode && !EXPLAIN_MODES.has(String(query.mode))) {
      return fail('bad_request');
    }
    if (r.engine === false) return fail('need_engine');
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

  const fn = portFor(action, ctx.ports);
  if (typeof fn !== 'function') {
    const code = missingCode(action);
    const extra = {};
    if (code === 'need_app' && action === 'capture_to_study') extra.unwired = copy.MESSAGES.captureUnwired;
    if (code === 'need_app' && action === 'explain_or_drill') extra.unwired = copy.MESSAGES.explainUnwired;
    return { receipt: receipt(action, code, messageFor(code, extra), fixFor(code, scheme, source)) };
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
      }) || { ok: true };
    } catch (_) {
      return { receipt: receipt(action, 'bad_request', copy.MESSAGES.badRequest, {}) };
    }
  }

  if (portResult && portResult.ok === false && CODE_SET.has(portResult.code) && portResult.code !== 'ok') {
    const code = portResult.code;
    const extra = {};
    if (code === 'need_app' && action === 'capture_to_study') extra.unwired = copy.MESSAGES.captureUnwired;
    if (code === 'need_app' && action === 'explain_or_drill') extra.unwired = copy.MESSAGES.explainUnwired;
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
