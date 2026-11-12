// Offline contract for the default-chain catalog. Synthetic rows are not measurements.
'use strict';

const { describe, test, eq } = require('./harness');
const {
  checkCatalog, validateRow, referenceEditAllowed,
} = require('../eval/baselines/default-chain-check.js');

function row(extra) {
  return Object.assign({
    schema: 'belliedmonkey.default-chain-row.v1',
    synthetic: true,
    published: false,
    lane: 'user-visible-e2e',
    sample: {
      version: 'default-chain-eval-0',
      license: 'CC-BY-4.0',
      revision: 'fixture-revision',
      hash: 'abc',
      consent: 'public-license',
    },
    arm: { configured: 'e1_b1', actual: 'e1_b1', fallback: null },
    output: 'final',
    clock: { domain: 'event', monoAligned: true },
    translation: {
      input: 'oracle-transcript',
      blindCount: 2,
      arbitration: 'agreed',
      stringEqual: false,
    },
    denominator: { attempts: 5, failures: 0, timeouts: 0 },
  }, extra);
}

describe('default-chain catalog — blocked empty set, not a product score', () => {
  test('the real catalog is blocked and keeps the 16-clip smoke separate', () => {
    const report = checkCatalog();
    eq(report.ok, false);
    eq(report.status, 'blocked');
    eq(report.productMetric, null);
    eq(report.e2eMetric, null);
    eq(report.rates, null);
    eq(report.plannedTarget, 30);
    eq(report.actualCount, 0);
    eq(report.realFailures, 0);
    eq(report.smoke.role, 'sa-file-component-smoke');
    eq(report.smoke.itemCount, 16);
    eq(report.smoke.productMetric, false);
    eq(report.zh1663AudioChecked, false);
  });

  test('a synthetic complete row is not a published product score', () => {
    const got = validateRow(row({}));
    eq(got.synthetic, true);
    eq(got.published, false);
    eq(got.productMetric, null);
    eq(got.e2eMetric, null);
    eq(got.rates, null);
    eq(got.code, 'synthetic-selftest');
  });

  test('publishing a synthetic row is rejected', () => {
    eq(validateRow(row({ published: true })).code, 'synthetic-published');
  });

  test('missing hash, partial-as-final, and an unrecorded arm are blocked', () => {
    const missing = row({});
    missing.sample = Object.assign({}, missing.sample, { hash: '' });
    eq(validateRow(missing).code, 'sample-hash');
    eq(validateRow(row({ output: 'partial', e2eClaim: true })).code, 'partial-mixed');
    eq(validateRow(row({ arm: { configured: 'e1_b1', actual: '', fallback: null } })).code, 'arm');
    eq(validateRow(row({ arm: { configured: 'e1_b1', actual: 'sa', fallback: 'model_not_ready' } })).code, 'fallback-excluded');
  });

  test('event time is not render time, and an unaligned clock is blocked', () => {
    eq(validateRow(row({ renderClaim: true, clock: { domain: 'event', monoAligned: true } })).code, 'event-not-render');
    eq(validateRow(row({ clock: { domain: 'event', monoAligned: false } })).code, 'clock-unaligned');
  });

  test('pending review, string equality, a component lane, and a missing denominator do not score', () => {
    eq(validateRow(row({ translation: { input: 'asr-propagation', blindCount: 2, arbitration: 'pending', stringEqual: false } })).code, 'review-pending');
    eq(validateRow(row({ translation: { input: 'oracle-transcript', blindCount: 1, arbitration: 'agreed', stringEqual: false } })).code, 'review-pending');
    eq(validateRow(row({ translation: { input: 'oracle-transcript', blindCount: 2, arbitration: 'agreed', stringEqual: true } })).code, 'string-equal-not-quality');
    eq(validateRow(row({ lane: 'component' })).code, 'component-not-e2e');
    eq(validateRow(row({ denominator: { attempts: 5, failures: null, timeouts: 0 } })).code, 'denominator');
    eq(validateRow(row({ translation: { input: 'same-string', blindCount: 2, arbitration: 'agreed', stringEqual: false } })).code, 'translation-input');
  });

  test('cmn_hans_cn/1663 cannot be edited from a hypothesis', () => {
    eq(referenceEditAllowed({ id: 'cmn_hans_cn/1663', audioChecked: false, hypothesis: 'x' }), false);
    eq(referenceEditAllowed({ id: 'cmn_hans_cn/1663', audioChecked: true, humanTranscript: 'heard', synthetic: false }), true);
  });
});
