'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CATALOG = 'eval/baselines/default-chain-catalog.json';
const LANES = new Set(['component', 'default-stage', 'user-visible-e2e']);
const INPUTS = new Set(['oracle-transcript', 'asr-propagation']);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function blocked(row, code) {
  return {
    ok: false,
    code: code,
    status: 'blocked',
    productMetric: null,
    e2eMetric: null,
    rates: null,
    synthetic: !!(row && row.synthetic),
    published: false,
  };
}

function validateRow(row) {
  if (!row || row.schema !== 'belliedmonkey.default-chain-row.v1') return blocked(row, 'schema');
  if (typeof row.synthetic !== 'boolean') return blocked(row, 'synthetic-flag');
  if (row.synthetic === true && row.published === true) return blocked(row, 'synthetic-published');
  if (!LANES.has(row.lane)) return blocked(row, 'lane');
  const sample = row.sample || {};
  for (const key of ['version', 'license', 'revision', 'hash']) {
    if (!sample[key]) return blocked(row, 'sample-' + key);
  }
  if (sample.consent !== 'user-consented' && sample.consent !== 'public-license') {
    return blocked(row, 'consent');
  }
  const arm = row.arm || {};
  if (!arm.configured || !arm.actual) return blocked(row, 'arm');
  if (arm.fallback) return blocked(row, 'fallback-excluded');
  if (arm.configured !== arm.actual) return blocked(row, 'arm-mismatch');
  if (row.output !== 'partial' && row.output !== 'final') return blocked(row, 'output');
  if (row.output === 'partial' && (row.e2eClaim === true || row.productClaim === true)) {
    return blocked(row, 'partial-mixed');
  }
  const clock = row.clock || {};
  if (clock.domain !== 'event' && clock.domain !== 'render') return blocked(row, 'clock-domain');
  if (clock.monoAligned !== true) return blocked(row, 'clock-unaligned');
  if (row.renderClaim === true && clock.domain !== 'render') return blocked(row, 'event-not-render');
  if (row.translation) {
    const tr = row.translation;
    if (tr.stringEqual === true) return blocked(row, 'string-equal-not-quality');
    if (!INPUTS.has(tr.input)) return blocked(row, 'translation-input');
    if (!(tr.blindCount >= 2) || tr.arbitration === 'pending') return blocked(row, 'review-pending');
  }
  const den = row.denominator || {};
  if (!(den.attempts > 0) || den.failures == null || den.timeouts == null) {
    return blocked(row, 'denominator');
  }
  if (row.lane === 'component') return blocked(row, 'component-not-e2e');
  if (row.lane !== 'user-visible-e2e') return blocked(row, 'not-e2e-lane');
  return {
    ok: true,
    code: row.synthetic ? 'synthetic-selftest' : 'evidence-shape',
    status: 'blocked',
    productMetric: null,
    e2eMetric: null,
    rates: null,
    synthetic: row.synthetic,
    published: false,
  };
}

function referenceEditAllowed(row) {
  if (!row || row.id !== 'cmn_hans_cn/1663') return false;
  return row.audioChecked === true && row.synthetic !== true && typeof row.humanTranscript === 'string' && row.humanTranscript.length > 0;
}

function checkCatalog() {
  const catalog = readJson(CATALOG);
  const smoke = readJson(catalog.smoke.path);
  const pub = catalog.publicCandidates ? readJson(catalog.publicCandidates.path) : null;
  const actualCount = Array.isArray(catalog.records) ? catalog.records.length : null;
  const base = {
    ok: false,
    status: 'blocked',
    productMetric: null,
    e2eMetric: null,
    rates: null,
    plannedTarget: catalog.plannedTarget,
    actualCount: actualCount,
    realFailures: catalog.realFailures,
    zh1663AudioChecked: catalog.zh1663AudioChecked === true,
    publicCandidateCount: pub ? pub.publicCandidateCount : 0,
    humanVerifiedCount: pub ? pub.humanVerifiedCount : 0,
    approvedPlannedSetCount: pub ? pub.approvedPlannedSetCount : 0,
    smoke: {
      role: catalog.smoke.role,
      itemCount: Array.isArray(smoke.items) ? smoke.items.length : 0,
      license: smoke.license && smoke.license.spdx,
      revision: smoke.attribution && smoke.attribution.revision,
      productMetric: smoke.productMetric === true,
    },
  };
  if (catalog.schema !== 'belliedmonkey.default-chain-catalog.v1') return Object.assign(base, { code: 'schema' });
  if (catalog.smoke.role !== 'sa-file-component-smoke') return Object.assign(base, { code: 'smoke-role' });
  if (!Array.isArray(smoke.items) || smoke.items.length !== 16) return Object.assign(base, { code: 'smoke-count' });
  if (smoke.productMetric !== false || smoke.notAnEndToEndBaseline !== true) {
    return Object.assign(base, { code: 'smoke-claim' });
  }
  if (catalog.plannedTarget !== 30) return Object.assign(base, { code: 'planned-target' });
  if (actualCount !== 0) return Object.assign(base, { code: 'actual-count' });
  if (catalog.realFailures !== 0) return Object.assign(base, { code: 'real-failures' });
  if (catalog.zh1663AudioChecked !== false) return Object.assign(base, { code: 'zh1663' });
  if (!pub || pub.humanVerifiedCount !== 0 || pub.approvedPlannedSetCount !== 0 || pub.realFailureCount !== 0 || pub.productMetric !== false) {
    return Object.assign(base, { code: 'public-candidate-claim' });
  }
  if (pub.publicCandidateCount !== pub.items.length) return Object.assign(base, { code: 'public-candidate-count' });
  return Object.assign(base, { code: 'empty-set' });
}

function selftest() {
  const cases = [
    ['synthetic-complete', validateRow({
      schema: 'belliedmonkey.default-chain-row.v1',
      synthetic: true,
      published: false,
      lane: 'user-visible-e2e',
      sample: { version: 'fixture', license: 'fixture', revision: 'fixture', hash: 'abc', consent: 'public-license' },
      arm: { configured: 'e1_b1', actual: 'e1_b1', fallback: null },
      output: 'final',
      clock: { domain: 'event', monoAligned: true },
      translation: { input: 'oracle-transcript', blindCount: 2, arbitration: 'agreed', stringEqual: false },
      denominator: { attempts: 5, failures: 0, timeouts: 0 },
    }), 'synthetic-selftest'],
    ['published', validateRow({ synthetic: true, published: true, schema: 'belliedmonkey.default-chain-row.v1' }), 'synthetic-published'],
    ['partial', validateRow({
      schema: 'belliedmonkey.default-chain-row.v1', synthetic: true, published: false, lane: 'user-visible-e2e',
      sample: { version: 'v', license: 'l', revision: 'r', hash: 'h', consent: 'public-license' },
      arm: { configured: 'sa', actual: 'sa', fallback: null }, output: 'partial', e2eClaim: true,
      clock: { domain: 'event', monoAligned: true },
      denominator: { attempts: 1, failures: 0, timeouts: 0 },
    }), 'partial-mixed'],
  ];
  const failures = [];
  for (const [name, got, code] of cases) {
    if (got.code !== code || got.productMetric !== null || got.published !== false) failures.push(name);
  }
  return {
    ok: failures.length === 0,
    synthetic: true,
    published: false,
    productMetric: null,
    e2eMetric: null,
    rates: null,
    selftest: true,
    failures: failures,
  };
}

function main(argv) {
  const self = argv.indexOf('--selftest') >= 0;
  const report = self ? selftest() : checkCatalog();
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 2);
}

if (require.main === module) main(process.argv);

module.exports = { checkCatalog, validateRow, referenceEditAllowed, selftest };
