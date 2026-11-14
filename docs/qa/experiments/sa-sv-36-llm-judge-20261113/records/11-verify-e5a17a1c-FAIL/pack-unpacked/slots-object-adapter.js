'use strict';

// Diagnostic only. Not called by the official parser or the runner.
// A lossless slots-object to array rewrite. Quotes, notes, and kinds stay as parsed.

const PROTOCOL = 'belliedmonkey.llm-judge.slots-object-to-array.candidate.v1-diag';

function fail(code) {
  return { ok: false, code: code, diagnostic: true, official: false, adaptedText: null };
}

function adaptSlotsObject(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (_) {
    return fail('bad-json');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return fail('bad-json');
  const rootKeys = Object.keys(doc);
  for (let i = 0; i < rootKeys.length; i++) {
    if (rootKeys[i] !== 'schema' && rootKeys[i] !== 'itemId' && rootKeys[i] !== 'slots') return fail('score-field');
  }
  const slots = doc.slots;
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return fail('slots');
  const names = Object.keys(slots);
  if (names.length !== 2 || names.indexOf('slot-1') === -1 || names.indexOf('slot-2') === -1) return fail('slots');
  const out = [];
  for (let i = 0; i < 2; i++) {
    const name = i === 0 ? 'slot-1' : 'slot-2';
    const value = slots[name];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('slots');
    if (Object.prototype.hasOwnProperty.call(value, 'slot') && value.slot !== name) return fail('slot-identity');
    const copy = {};
    const fields = Object.keys(value);
    for (let f = 0; f < fields.length; f++) copy[fields[f]] = value[fields[f]];
    if (!Object.prototype.hasOwnProperty.call(copy, 'slot')) copy.slot = name;
    out.push(copy);
  }
  return {
    ok: true,
    code: 'adapted',
    diagnostic: true,
    official: false,
    protocol: PROTOCOL,
    adaptedText: JSON.stringify({ schema: doc.schema, itemId: doc.itemId, slots: out }),
  };
}

module.exports = { adaptSlotsObject, PROTOCOL };
