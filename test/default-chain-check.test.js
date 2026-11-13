// Offline contract for the default-chain catalog. Synthetic rows are not measurements.
'use strict';

const { describe, test, eq } = require('./harness');
const {
  checkCatalog, validateRow, referenceEditAllowed, checkZh1663,
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
    eq(report.zh1663AudioChecked, true);
    eq(report.humanVerifiedCount, 1);
    eq(report.approvedPlannedSetCount, 0);
    eq(report.code, 'empty-set');
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

  test('cmn_hans_cn/1663 cannot be edited from a hypothesis or from a matching ear check', () => {
    eq(referenceEditAllowed({ id: 'cmn_hans_cn/1663', audioChecked: false, hypothesis: 'x' }), false);
    eq(referenceEditAllowed({
      id: 'cmn_hans_cn/1663',
      audioChecked: true,
      humanTranscript: 'heard',
      synthetic: false,
      transcriptMismatchOrUncertain: false,
    }), false);
  });

  test('the 1663 ear record fails closed when it is missing, rehashed, or the reference moves', () => {
    const frozen = {
      id: 'cmn_hans_cn/1663/17125746560393607835.wav',
      raw: '智利首选登山目的地科茶莫山谷 (Cochamó Valley) 被称为南美洲的优胜美地 (Yosemite)，这里有各式各样的花岗岩大石壁和峭壁。',
      referenceSha256: 'd726ed1cc7579ab6956c65da8d9b8baba44cc53353264af38cc3198200dabb1a',
      audioSha256: '0b242eb4c06512556915e53463bb712beaffc56bcee751865c7461d79e93e95c',
      audioBytes: 856378,
    };
    eq(checkZh1663(null, frozen).code, 'zh1663-missing');
    eq(checkZh1663(null, frozen).humanVerifiedCount, 0);
    const review = {
      id: 'cmn_hans_cn/1663',
      reviewer: 'ZHAO ZHANG',
      reviewedAt: '2026-11-13T09:23+08:00',
      timezone: 'Asia/Shanghai',
      raw: frozen.raw,
      audio: { sha256: frozen.audioSha256, bytes: 856378 },
      questions: { latinParentheticalSpoken: '两处都读出', transcriptMismatchOrUncertain: false },
    };
    const badHash = JSON.parse(JSON.stringify(review));
    badHash.audio.sha256 = 'f'.repeat(64);
    eq(checkZh1663(badHash, frozen).code, 'zh1663-hash');
    const moved = JSON.parse(JSON.stringify(review));
    moved.raw = frozen.raw + '。';
    eq(checkZh1663(moved, frozen).code, 'zh1663-reference');
    const changedFrozen = Object.assign({}, frozen, { referenceSha256: 'a'.repeat(64) });
    eq(checkZh1663(review, changedFrozen).code, 'zh1663-reference');
    const ok = checkZh1663(review, frozen);
    eq(ok.audioChecked, true);
    eq(ok.humanVerifiedCount, 1);
    eq(ok.approvedPlannedSetCount, 0);
  });
});
