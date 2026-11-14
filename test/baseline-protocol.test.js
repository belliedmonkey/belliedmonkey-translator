// test/baseline-protocol.test.js — offline contract for the baseline inventory.
// Proves the checker, not translation quality. The synthetic fixture is tool-only.
'use strict';

const { describe, test, ok, eq } = require('./harness');
const {
  loadInventory, sampleEligible, checkAll,
} = require('../eval/baselines/check.js');

describe('baseline protocol — inventory contract, not a quality score', () => {
  test('the offline check is clean', () => {
    const errors = checkAll();
    ok(errors.length === 0, errors.join('\n'));
  });

  test('measurement, thresholds, and composite score stay unset', () => {
    const inv = loadInventory();
    eq(inv.measurement, 'none');
    eq(inv.compositeScore, null);
    eq(inv.thresholds.length, 0);
    ok(inv.forms.every((f) => f.measure === 'pending'), 'a form was marked measured');
  });

  test('a tool-only fixture is not a baseline item', () => {
    const gate = sampleEligible({
      form: 'webpage-text',
      stage: 'translation',
      text: 'TOOL_ONLY_SYNTHETIC_SENTENCE',
      authorization: { kind: 'tool-only', note: 'checker fixture' },
      redaction: { identity: true, text: true, audio: false },
      setVersion: 'should-not-matter',
    });
    eq(gate.ok, false);
    eq(gate.reason, 'tool-only');
  });

  test('an authorized record still needs identity redaction and a set version', () => {
    const noRedaction = sampleEligible({
      form: 'document', stage: 'ocr',
      authorization: { kind: 'public-license' },
      redaction: { identity: false },
      setVersion: 'samples-1',
    });
    eq(noRedaction.ok, false);
    eq(noRedaction.reason, 'redaction-identity');
    const okRecord = sampleEligible({
      form: 'document', stage: 'ocr',
      authorization: { kind: 'public-license', note: 'license name required in a real record' },
      redaction: { identity: true, text: true, audio: false },
      setVersion: 'samples-1',
    });
    eq(okRecord.ok, true);
  });
});
