'use strict';

const { ASR_RUBRIC, ASR_VERSION } = require('./rubric.js');

function buildPrompt(item, assignment) {
  const byKey = new Map(item.candidates.map((cand) => [cand.key, cand.text]));
  const payload = {
    untrusted: true,
    itemId: item.id,
    reference: item.reference,
    candidates: [
      { slot: 'slot-1', text: byKey.get(assignment.slots['slot-1']) },
      { slot: 'slot-2', text: byKey.get(assignment.slots['slot-2']) },
    ],
  };
  return {
    messages: [
      { role: 'system', content: ASR_RUBRIC },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    payload: payload,
  };
}

function promptContainsKey(prompt, key) {
  const blob = prompt.messages.map((message) => message.content).join('\n');
  return blob.indexOf(key) !== -1;
}

module.exports = { buildPrompt, promptContainsKey, ASR_VERSION };
