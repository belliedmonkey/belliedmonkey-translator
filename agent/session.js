// agent/session.js — one confirm-then-run pass for an agent/v1 URL.
// The App face supplies confirm() and show(). Ports run only after that.
'use strict';

const { buildConfirmCard, failureCard, needsConfirm } = require('./confirm');
const { callerIdOf, parseAgentDeepLink, pendingIdOf, sourceOf } = require('./parse');
const { emptyGrants } = require('./grants-model');
const {
  runAgentAction, cancelledReceipt, unsupportedReceipt, badRequestReceipt,
  failureReceipt, preconditions,
} = require('./run');

// BEL-151 B-PUSH: a heartbeat pending becomes the SAME action link the deep-link
// path already understands. It is built in memory and never handed to the OS:
// the caller passes it straight to handleAgentUrl / presentAgentDeepLink, so the
// copy-locked card, the 120 s timeout and the allow→confirm order stay single-
// sourced. Invalid ids/actions return '' rather than a component-shaped URL.
function pendingHref(pending, scheme) {
  const p = pending || {};
  const pendingId = pendingIdOf(p.pending_id);
  const action = String(p.action || '').trim();
  if (!pendingId || !/^[A-Za-z0-9._:-]{1,64}$/.test(action)) return '';
  const proto = scheme === 'belliedmonkeycn' ? 'belliedmonkeycn' : 'belliedmonkey';
  return proto + '://agent/v1/' + encodeURIComponent(action)
    + '?source=mcp&pending_id=' + encodeURIComponent(pendingId);
}

// BEL-151 GAP-2. The decision goes back to the Worker through the same device
// bridge that carries pairing/heartbeat, only after the user decided. A missing
// bridge or a failed POST never becomes an `openedSubtitles` claim.
async function sendDecision(deviceBridge, pendingId, decision) {
  if (!deviceBridge || typeof deviceBridge.confirm !== 'function') return null;
  try {
    return await deviceBridge.confirm({ pending_id: pendingId, decision });
  } catch (_) {
    return { ok: false, code: 'network_unavailable', sent: false };
  }
}

async function rememberPending(deviceBridge, pendingId, action) {
  if (!deviceBridge || typeof deviceBridge.rememberPending !== 'function') return;
  try {
    await deviceBridge.rememberPending({ pending_id: pendingId, action });
  } catch (_) { /* local pre-card bookkeeping only; the POST is still authoritative */ }
}

function callbackFailureCode(result) {
  const code = result && result.code;
  if (code === 'bad_request') return 'bad_request';
  // No local session / refused grant: the honest next step is to allow this
  // device again, not to retry the pending decision behind the user's back.
  if (code === 'not_paired' || code === 'need_login' || code === 'unauthorized') return 'need_login';
  return 'network_unavailable';
}

async function handleAgentUrl(raw, ctx, ui) {
  const parsed = parseAgentDeepLink(raw);
  const show = async (rec) => {
    if (ui && typeof ui.show === 'function') await ui.show(rec, failureCard(rec.code));
    return rec;
  };
  if (!parsed) return null;
  const errorPending = parsed.query ? pendingIdOf(parsed.query.pending_id) : '';
  if (parsed.error === 'bad_request') {
    if (errorPending) await sendDecision(ctx.deviceBridge, errorPending, 'deny');
    return show(badRequestReceipt(parsed.action || ''));
  }
  if (parsed.error === 'unsupported_action') {
    if (errorPending) await sendDecision(ctx.deviceBridge, errorPending, 'deny');
    return show(unsupportedReceipt(parsed.action));
  }

  const query = parsed.query || {};
  const callerId = callerIdOf(query);
  const pendingId = pendingIdOf(query.pending_id);
  let readiness = ctx.readiness || {};
  if (typeof readiness === 'function') readiness = await readiness();
  const grants = ctx.grants || emptyGrants();
  const full = {
    query,
    scheme: parsed.scheme,
    sourceFallback: sourceOf(query, 'deeplink'),
    readiness: readiness || {},
    hostConnected: ctx.hostConnected !== false,
    ports: ctx.ports || {},
    grants,
    persistGrants: ctx.persistGrants,
    siteSupported: ctx.siteSupported,
    env: ctx.env,
    deviceBridge: ctx.deviceBridge,
    confirmed: null,
  };

  const blocked = preconditions(parsed.action, full);
  if (blocked) {
    // A local gate still has to close the Worker's pending: leaving it open
    // would make the cloud wait until TTL for a decision this App already knows
    // cannot run.
    if (pendingId) await sendDecision(ctx.deviceBridge, pendingId, 'deny');
    return show(blocked);
  }

  // A local grant can skip the card for an ordinary deep link, but a Worker
  // pending_confirm is waiting for an explicit decision: never answer it with a
  // remembered device grant the user did not just give.
  if (needsConfirm(parsed.action, grants, callerId) || pendingId) {
    const card = buildConfirmCard(parsed.action, query);
    // Remember before the card so an explicit disconnect while it is open can
    // clear the same pending id (CONTRACT §4).
    if (pendingId) await rememberPending(ctx.deviceBridge, pendingId, parsed.action);
    let decision = { allow: false };
    if (ui && typeof ui.confirm === 'function') decision = await ui.confirm(card) || { allow: false };
    if (!decision.allow) {
      if (pendingId) await sendDecision(ctx.deviceBridge, pendingId, 'deny');
      return show(cancelledReceipt(parsed.action));
    }
    if (pendingId) {
      const sent = await sendDecision(ctx.deviceBridge, pendingId, 'allow');
      if (!sent || sent.ok !== true) {
        return show(failureReceipt(
          parsed.action, callbackFailureCode(sent), parsed.scheme, full.sourceFallback));
      }
    }
    full.confirmed = decision;
  }

  const out = await runAgentAction(parsed.action, full);
  return show(out.receipt);
}

// BEL-151 local pairing entry. pair_device is not a public N25 tool and is not
// reachable from an agent/v1 deeplink on purpose: only the App's own pairing
// control asks for this confirm, so a remote assistant cannot initiate pairing.
// The cloud calls happen inside runAgentAction only after the user's yes.
async function requestPairing(ctx, ui) {
  const base = ctx || {};
  let readiness = base.readiness || {};
  if (typeof readiness === 'function') readiness = await readiness();
  const query = base.query || {};
  const callerId = callerIdOf(query);
  const grants = base.grants || emptyGrants();
  const full = Object.assign({}, base, {
    query,
    scheme: base.scheme || 'belliedmonkey',
    sourceFallback: base.sourceFallback || 'agent',
    readiness: readiness || {},
    hostConnected: base.hostConnected !== false,
    ports: base.ports || {},
    grants,
    confirmed: null,
  });
  const action = 'pair_device';
  const blocked = preconditions(action, full);
  if (blocked) {
    if (ui && typeof ui.show === 'function') await ui.show(blocked, failureCard(blocked.code));
    return blocked;
  }
  if (needsConfirm(action, grants, callerId)) {
    const card = buildConfirmCard(action, query);
    let decision = { allow: false };
    if (ui && typeof ui.confirm === 'function') decision = await ui.confirm(card) || { allow: false };
    if (!decision.allow) {
      const rec = cancelledReceipt(action);
      if (ui && typeof ui.show === 'function') await ui.show(rec, failureCard(rec.code));
      return rec;
    }
    full.confirmed = decision;
  }
  const out = await runAgentAction(action, full);
  if (ui && typeof ui.show === 'function') await ui.show(out.receipt, failureCard(out.receipt.code));
  return out.receipt;
}

module.exports = { handleAgentUrl, requestPairing, pendingHref };
