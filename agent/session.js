// agent/session.js — one confirm-then-run pass for an agent/v1 URL.
// The App face supplies confirm() and show(). Ports run only after that.
'use strict';

const { buildConfirmCard, failureCard, needsConfirm } = require('./confirm');
const { callerIdOf, parseAgentDeepLink, sourceOf } = require('./parse');
const { emptyGrants } = require('./grants-model');
const {
  runAgentAction, cancelledReceipt, unsupportedReceipt, badRequestReceipt, preconditions,
} = require('./run');

async function handleAgentUrl(raw, ctx, ui) {
  const parsed = parseAgentDeepLink(raw);
  const show = async (rec) => {
    if (ui && typeof ui.show === 'function') await ui.show(rec, failureCard(rec.code));
    return rec;
  };
  if (!parsed) return null;
  if (parsed.error === 'bad_request') return show(badRequestReceipt(parsed.action || ''));
  if (parsed.error === 'unsupported_action') return show(unsupportedReceipt(parsed.action));

  const query = parsed.query || {};
  const callerId = callerIdOf(query);
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
  if (blocked) return show(blocked);

  if (needsConfirm(parsed.action, grants, callerId)) {
    const card = buildConfirmCard(parsed.action, query);
    let decision = { allow: false };
    if (ui && typeof ui.confirm === 'function') decision = await ui.confirm(card) || { allow: false };
    if (!decision.allow) return show(cancelledReceipt(parsed.action));
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

module.exports = { handleAgentUrl, requestPairing };
