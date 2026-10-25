// agent/grants-model.js — pure allow table. No filesystem (the App bundle
// must not import node builtins). Display-name `caller` is not a key.
'use strict';

function emptyGrants() {
  return { device: {}, assistants: {} };
}

function hasDeviceGrant(grants, action) {
  return !!(grants && grants.device && grants.device[action] === true);
}

function hasAssistantGrant(grants, action, callerId) {
  if (!callerId) return false;
  const row = grants && grants.assistants && grants.assistants[callerId];
  return !!(row && row[action] === true);
}

function hasGrant(grants, action, callerId) {
  return hasDeviceGrant(grants, action) || hasAssistantGrant(grants, action, callerId);
}

function remember(grants, action, decision, callerId) {
  const next = {
    device: Object.assign({}, grants && grants.device),
    assistants: Object.assign({}, grants && grants.assistants),
  };
  if (decision && decision.device) next.device[action] = true;
  if (decision && decision.assistant && callerId) {
    const row = Object.assign({}, next.assistants[callerId]);
    row[action] = true;
    next.assistants[callerId] = row;
  }
  return next;
}

module.exports = {
  emptyGrants,
  hasDeviceGrant,
  hasAssistantGrant,
  hasGrant,
  remember,
};
