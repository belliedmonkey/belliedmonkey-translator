'use strict';

const { VERDICT_SCHEMA, FINDING_KINDS } = require('./schema.js');

function fail(code) {
  return { ok: false, code: code, verdict: null };
}

function extra(obj, allow) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'type';
  const bad = Object.keys(obj).filter((key) => allow.indexOf(key) === -1);
  return bad.length ? bad[0] : null;
}

function isSlice(haystack, quote) {
  return typeof quote === 'string' && (quote === '' || haystack.indexOf(quote) !== -1);
}

function checkFinding(finding, reference, hypothesis) {
  const bad = extra(finding, ['kind', 'refQuote', 'hypQuote', 'reason']);
  if (bad) return 'finding-field';
  if (FINDING_KINDS.indexOf(finding.kind) === -1) return 'finding-kind';
  if (typeof finding.reason !== 'string' || !finding.reason.length || finding.reason.length > 400) return 'reason';
  if (!isSlice(reference, finding.refQuote) || !isSlice(hypothesis, finding.hypQuote)) return 'quote';
  if (finding.kind === 'omission' && !finding.refQuote) return 'quote';
  if (finding.kind === 'addition' && !finding.hypQuote) return 'quote';
  if (finding.kind !== 'omission' && finding.kind !== 'addition' && (!finding.refQuote || !finding.hypQuote)) {
    return 'quote';
  }
  return null;
}

function leaked(text, labels, reference, hypotheses) {
  for (const label of labels) {
    if (text.indexOf(label) === -1) continue;
    if (reference.indexOf(label) !== -1) continue;
    if (hypotheses.some((hyp) => hyp.indexOf(label) !== -1)) continue;
    return true;
  }
  return false;
}

function parseVerdict(text, item, assignment) {
  if (typeof text !== 'string') return fail('bad-json');
  const labels = [assignment.slots['slot-1'], assignment.slots['slot-2']];
  const hypotheses = item.candidates.map((cand) => cand.text);
  if (leaked(text, labels, item.reference, hypotheses)) return fail('identity-leak');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (_) {
    return fail('bad-json');
  }
  const bad = extra(doc, ['schema', 'itemId', 'slots']);
  if (bad === 'type') return fail('bad-json');
  if (bad) return fail('score-field');
  if (doc.schema !== VERDICT_SCHEMA) return fail('verdict-schema');
  if (doc.itemId !== item.id) return fail('item-id');
  if (!Array.isArray(doc.slots) || doc.slots.length !== 2) return fail('slots');
  const bySlot = new Map(item.candidates.map((cand) => {
    const slot = assignment.slots['slot-1'] === cand.key ? 'slot-1' : 'slot-2';
    return [slot, cand.text];
  }));
  const seen = new Set();
  const slots = [];
  for (const slot of doc.slots) {
    const slotBad = extra(slot, ['slot', 'abstain', 'confidence', 'note', 'findings']);
    if (slotBad) return fail('score-field');
    if (slot.slot !== 'slot-1' && slot.slot !== 'slot-2') return fail('slot');
    if (seen.has(slot.slot)) return fail('slot');
    seen.add(slot.slot);
    if (typeof slot.abstain !== 'boolean') return fail('abstain');
    if (typeof slot.confidence !== 'number' || !Number.isFinite(slot.confidence) || slot.confidence < 0 || slot.confidence > 1) {
      return fail('confidence');
    }
    if (typeof slot.note !== 'string' || slot.note.length > 400) return fail('note');
    if (!Array.isArray(slot.findings)) return fail('findings');
    if (slot.abstain && (slot.findings.length || !slot.note.length)) return fail('abstain');
    const findings = [];
    for (const finding of slot.findings) {
      const why = checkFinding(finding, item.reference, bySlot.get(slot.slot));
      if (why) return fail(why);
      findings.push({
        kind: finding.kind,
        refQuote: finding.refQuote,
        hypQuote: finding.hypQuote,
        reason: finding.reason,
      });
    }
    slots.push({
      slot: slot.slot,
      abstain: slot.abstain,
      confidence: slot.confidence,
      note: slot.note,
      findings: findings,
    });
  }
  if (!seen.has('slot-1') || !seen.has('slot-2')) return fail('slot');
  return {
    ok: true,
    code: 'parsed',
    verdict: { schema: VERDICT_SCHEMA, itemId: item.id, slots: slots },
  };
}

module.exports = { parseVerdict };
