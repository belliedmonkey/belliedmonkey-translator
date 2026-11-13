'use strict';

const { ASR_RUBRIC, ASR_VERSION } = require('./rubric.js');

function block(label, text) {
  return label + '\n<<<\n' + text + '\n>>>';
}

function buildPrompt(item, assignment) {
  const byKey = new Map(item.candidates.map((cand) => [cand.key, cand.text]));
  const slot1 = byKey.get(assignment.slots['slot-1']);
  const slot2 = byKey.get(assignment.slots['slot-2']);
  const user = [
    'ITEM ' + item.id,
    block('REFERENCE', item.reference),
    block('CANDIDATE slot-1', slot1),
    block('CANDIDATE slot-2', slot2),
    'Return only the JSON object. itemId must be ' + item.id + '.',
  ].join('\n\n');
  return {
    messages: [
      { role: 'system', content: ASR_RUBRIC },
      { role: 'user', content: user },
    ],
  };
}

function promptContainsKey(prompt, key) {
  const blob = prompt.messages.map((message) => message.content).join('\n');
  return blob.indexOf(key) !== -1;
}

module.exports = { buildPrompt, promptContainsKey, ASR_VERSION };
