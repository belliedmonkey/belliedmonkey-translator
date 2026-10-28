// agent/confirm.js — AgentConfirm card model.
//
// Anonymous cards do not contain 始终允许此助手 (AC-A3). The strings are the
// copy lock. This module does not render and does not execute.
'use strict';

const copy = require('./copy');
const { isSensitive } = require('./contract');
const { hasGrant } = require('./grants-model');
const { callerIdOf } = require('./parse');

function actionCopy(action) {
  return copy.ACTIONS[action] || null;
}

function buildConfirmCard(action, query) {
  const spec = actionCopy(action);
  const callerId = callerIdOf(query);
  const name = spec ? spec.name : action;
  // Unlocked actions have no short name. The slot stays the action id.
  const short = spec ? spec.short : action;
  const card = {
    title: copy.TITLE,
    action,
    actionLabel: name,
    origin: callerId ? copy.ORIGIN_KNOWN : copy.ORIGIN_UNKNOWN,
    touches: spec ? spec.touches.slice() : [],
    footnote: copy.FOOTNOTE,
    primary: copy.ALLOW_ONCE,
    cancel: copy.CANCEL,
    deviceAllow: copy.deviceAllow(short),
    assistantAllow: callerId ? copy.ASSISTANT_ALLOW : null,
    paste: null,
  };
  if (action === 'capture_to_study') {
    const has = query && (query.text || query.quote);
    if (!has) card.paste = copy.PASTE_PROMPT;
  }
  return card;
}

function failureCard(code) {
  const row = copy.failureRow(code);
  if (!row) return null;
  return {
    title: copy.FAILURE_TITLE,
    code: row.code,
    line: row.line,
    primary: row.primary,
    secondary: row.secondary,
    footnote: row.footnote,
  };
}

// Elicitation message is a UI surface, so it carries the locked strings.
// It does not carry text, quote, url, or a transcript.
function elicitationMessage(card) {
  const lines = [card.title];
  if (card.origin) lines.push(copy.ORIGIN_PREFIX + card.origin);
  lines.push(card.actionLabel);
  lines.push.apply(lines, card.touches.concat([
    card.footnote,
    card.primary,
    card.cancel,
  ]));
  if (card.deviceAllow) lines.push(card.deviceAllow);
  if (card.assistantAllow) lines.push(card.assistantAllow);
  if (card.paste) lines.push(card.paste);
  return lines.join('\n');
}

function elicitationSchema(card) {
  const properties = {
    once: { type: 'boolean', title: card.primary, description: card.footnote },
  };
  if (card.deviceAllow) {
    properties.device = { type: 'boolean', title: card.deviceAllow };
  }
  if (card.assistantAllow) {
    properties.assistant = { type: 'boolean', title: card.assistantAllow };
  }
  if (card.paste) {
    properties.paste = { type: 'string', title: card.paste };
  }
  return { type: 'object', properties, additionalProperties: false };
}

function decisionFromElicitation(result, card) {
  if (!result || (result.action !== 'accept')) {
    return { allow: false };
  }
  const content = result.content && typeof result.content === 'object' ? result.content : {};
  return {
    allow: true,
    device: content.device === true,
    // Only a card that offered the control can set it. The anon card's
    // schema has no assistant property; ignore a forged one anyway.
    assistant: !!(card && card.assistantAllow) && content.assistant === true,
    paste: card && card.paste && typeof content.paste === 'string' ? content.paste : '',
  };
}

function needsConfirm(action, grants, callerId) {
  if (!isSensitive(action)) return false;
  return !hasGrant(grants, action, callerId);
}

module.exports = {
  buildConfirmCard,
  failureCard,
  elicitationMessage,
  elicitationSchema,
  decisionFromElicitation,
  needsConfirm,
  actionCopy,
};
