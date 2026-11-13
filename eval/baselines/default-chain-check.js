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

const ZH1663_RAW = '智利首选登山目的地科茶莫山谷 (Cochamó Valley) 被称为南美洲的优胜美地 (Yosemite)，这里有各式各样的花岗岩大石壁和峭壁。';
const ZH1663_AUDIO_SHA = '0b242eb4c06512556915e53463bb712beaffc56bcee751865c7461d79e93e95c';
const ZH1663_REFERENCE_SHA = 'd726ed1cc7579ab6956c65da8d9b8baba44cc53353264af38cc3198200dabb1a';

function referenceEditAllowed(row) {
  if (!row || row.id !== 'cmn_hans_cn/1663') return false;
  return false;
}

function checkZh1663(review, frozenItem) {
  const blocked = { ok: false, audioChecked: false, humanVerifiedCount: 0, approvedPlannedSetCount: 0 };
  if (!review) return Object.assign(blocked, { code: 'zh1663-missing' });
  if (!frozenItem) return Object.assign(blocked, { code: 'zh1663-missing' });
  const audio = review.audio || {};
  if (audio.sha256 !== ZH1663_AUDIO_SHA || audio.sha256 !== frozenItem.audioSha256 || audio.bytes !== frozenItem.audioBytes) {
    return Object.assign(blocked, { code: 'zh1663-hash' });
  }
  if (review.playbackCopy && review.playbackCopy.sha256 === audio.sha256) {
    return Object.assign(blocked, { code: 'zh1663-hash' });
  }
  if (review.raw !== ZH1663_RAW || review.raw !== frozenItem.raw || frozenItem.referenceSha256 !== ZH1663_REFERENCE_SHA) {
    return Object.assign(blocked, { code: 'zh1663-reference' });
  }
  const questions = review.questions || {};
  if (review.reviewer !== 'ZHAO ZHANG' || review.reviewedAt !== '2026-11-13T09:23+08:00' || review.timezone !== 'Asia/Shanghai') {
    return Object.assign(blocked, { code: 'zh1663-conclusion' });
  }
  if (questions.latinParentheticalSpoken !== '两处都读出' || questions.transcriptMismatchOrUncertain !== false) {
    return Object.assign(blocked, { code: 'zh1663-conclusion' });
  }
  return { ok: true, code: 'zh1663-checked', audioChecked: true, humanVerifiedCount: 1, approvedPlannedSetCount: 0 };
}

const ASCEND_EAR = [
  ['00004', 'b1d784c7c355c79febc73733f61a9faa2564c9f07cdf12caa3dd470f381c0149', "呃what's the呃"],
  ['00009', '7317a4752e95039e6f6c345ef5b15fdd18fc7f48353cc893e6f99218a682c9a3', 'no我专业是那个i s m information systems management'],
  ['00028', 'f790b945050ccc625702f214dc7182c0c0e781a6fd5a82c7d1863c4683414842', 'ok福建'],
  ['00055', '866d07fc22025c9450e6e8811cb6b374ab863370182922c054dfa1c1ea46a535', 'um运动啊男生一般不都喜欢运动'],
  ['00066', 'a554fbe3692c170b6aed5a34f34095312fe4b822c1c205eaddf894ee90f21faf', '哦这么technical'],
  ['00068', 'ddf1d1241915e223a8f46e6e00e9f5c0b6574add6d6c984fab26ee5508897958', 'computer languages是'],
];

function checkAscendEar(review, frozenItems) {
  const blocked = {
    ok: false,
    humanVerifiedCount: 0,
    approvedPlannedSetCount: 0,
    continuousDialogue: { count: 0, status: 'unknown' },
  };
  if (!review) return Object.assign(blocked, { code: 'ascend-missing' });
  if (review.reviewer !== 'ZHAO ZHANG' || review.reviewedAt !== '2026-11-13T09:44+08:00' || review.timezone !== 'Asia/Shanghai') {
    return Object.assign(blocked, { code: 'ascend-conclusion' });
  }
  for (const name of ['accent', 'noise', 'continuousDialogue']) {
    const bucket = review[name] || {};
    if (bucket.count !== 0 || bucket.status !== 'unknown') return Object.assign(blocked, { code: 'ascend-claim' });
  }
  if (!Array.isArray(review.items) || review.items.length !== ASCEND_EAR.length) {
    return Object.assign(blocked, { code: 'ascend-missing' });
  }
  const frozenById = new Map((frozenItems || []).map((item) => [item.id, item]));
  for (let i = 0; i < ASCEND_EAR.length; i++) {
    const id = ASCEND_EAR[i][0];
    const hash = ASCEND_EAR[i][1];
    const text = ASCEND_EAR[i][2];
    const row = review.items[i];
    const frozen = frozenById.get(id);
    if (!row || row.id !== id || !frozen) return Object.assign(blocked, { code: 'ascend-missing' });
    if (row.audioSha256 !== hash || frozen.audioSha256 !== hash) return Object.assign(blocked, { code: 'ascend-hash' });
    if (row.transcription !== text || frozen.transcription !== text) return Object.assign(blocked, { code: 'ascend-transcription' });
    if (row.codeSwitchHeard !== true || row.transcriptMismatchOrUncertain !== false) {
      return Object.assign(blocked, { code: 'ascend-conclusion' });
    }
  }
  return {
    ok: true,
    code: 'ascend-checked',
    humanVerifiedCount: ASCEND_EAR.length,
    approvedPlannedSetCount: 0,
    continuousDialogue: { count: 0, status: 'unknown' },
    keys: ASCEND_EAR.map((row) => 'ascend/' + row[0]),
  };
}

const FLEURS_CANDIDATE_EAR = [
  ['en_us', '1668', 'd6ab97bb7e3232b60b61910d3ac7e1cf37acbcbfd062773b453c76217682f49e', 'It may also be beneficial for one to buy a Wild Card, which provides entry to either selections of parks in South Africa or all of the South African National Parks.', 'a79c8854109fff73c5a857a9824acaf8a337e1740a276a13e167eebb24dda56b'],
  ['cmn_hans_cn', '1668', '7b95a45446dc31d99d50232a7a6dbda26cc9c87eb26aec1263f73e7f9dd6405f', '买一张万能卡（Wild Card）也有不少好处。带着这张卡，你可以进入南非的一些公园或全部的国家公园。', 'e1e696cdab62f2c8492f1af404c71c8afa9919976d903f97145fdffa76241184'],
  ['en_us', '1669', '40d7e92df0355f4836e2b8fa2a88d7c7e047d0472f0845ca08f0c21257785390', 'Police superintendent Chandra Shekhar Solanki said the accused appeared in court with covered faces.', '4094b32e805260f1fddf3e3b4a210648f11388ca8d725c610407770eec108f74'],
];

function checkFleursSlice(review, frozenItems, pins, verbatim, reviewedAt, parentheticalOn1670) {
  const blocked = { ok: false, humanVerifiedCount: 0, approvedPlannedSetCount: 0, keys: [] };
  if (!review) return Object.assign(blocked, { code: 'fleurs-candidate-missing' });
  if (review.reviewer !== 'ZHAO ZHANG' || review.reviewedAt !== reviewedAt || review.timezone !== 'Asia/Shanghai' || review.verbatim !== verbatim) {
    return Object.assign(blocked, { code: 'fleurs-candidate-conclusion' });
  }
  if (!Array.isArray(review.items) || review.items.length !== pins.length) {
    return Object.assign(blocked, { code: 'fleurs-candidate-scope' });
  }
  const frozenByKey = new Map((frozenItems || []).map((item) => [item.config + '/' + item.sentenceId, item]));
  const seen = new Set();
  const keys = [];
  for (let i = 0; i < pins.length; i++) {
    const config = pins[i][0];
    const sentenceId = pins[i][1];
    const hash = pins[i][2];
    const raw = pins[i][3];
    const playback = pins[i][4];
    const row = review.items[i];
    const key = 'fleurs-public-candidates/' + config + '/' + sentenceId;
    if (!row || row.config !== config || String(row.sentenceId) !== sentenceId || row.source !== 'fleurs-public-candidates') {
      return Object.assign(blocked, { code: 'fleurs-candidate-scope' });
    }
    if (seen.has(key)) return Object.assign(blocked, { code: 'fleurs-candidate-duplicate' });
    seen.add(key);
    const frozen = frozenByKey.get(config + '/' + sentenceId);
    if (!frozen) return Object.assign(blocked, { code: 'fleurs-candidate-scope' });
    if (row.audioSha256 !== hash || frozen.audioSha256 !== hash || (row.playbackSha256 && row.playbackSha256 === hash) || playback === hash) {
      return Object.assign(blocked, { code: 'fleurs-candidate-hash' });
    }
    if (row.raw !== raw || frozen.raw !== raw) return Object.assign(blocked, { code: 'fleurs-candidate-text' });
    if (parentheticalOn1670 && sentenceId === '1670' && row.userParenthetical !== 'usgc也读出了') {
      return Object.assign(blocked, { code: 'fleurs-candidate-conclusion' });
    }
    keys.push(key);
  }
  return {
    ok: true,
    code: 'fleurs-candidate-checked',
    humanVerifiedCount: keys.length,
    approvedPlannedSetCount: 0,
    keys: keys,
    verbatim: verbatim,
  };
}

function checkFleursCandidateEar(review, frozenItems) {
  return checkFleursSlice(review, frozenItems, FLEURS_CANDIDATE_EAR, '前面的都通过。', '2026-11-13T10:59+08:00', false);
}

const FLEURS_CANDIDATE_EAR_1103 = [
  ['cmn_hans_cn', '1669', 'de149c29bdb3dd88f3befb247a99b2866aaa9c196f08818d8f2bba06c1ce0c53', '警察局长钱德拉·谢卡尔·索兰基说，被告人出庭时都蒙住了脸。', '5d7c585f846b1be6e1b9c29e781c8bc23ead79335fa9b0faaf383e56f9297a20'],
  ['en_us', '1670', '6dc676eae80109d088233f838226d4164f76befd8aafc772e1a6cb9eaa0d31df', 'Their thermal behavior is not as steady as large caves on Earth that often maintain a fairly constant temperature, but it is consistent with these being deep holes in the ground," said Glen Cushing of the United States Geological Survey (USGS) Astrogeology Team and of Northern Arizona University located in Flagstaff, Arizona.', 'fe34fc8a160c54bc2cde3e014cdcb4087fe90d8e9c98efac457408988a7d810e'],
  ['cmn_hans_cn', '1670', 'ba4d6b659f00765bd39fe3952b1da421733923ee0c9774c4a18d871f4fc4f73c', '“它们的热行为不像地球上的大型洞穴那么稳定，这些大型洞穴通常会保持相当恒定的温度，但它们与地下深穴的情况很相似，”亚利桑那州旗杆镇美国地质调查局 (USGS) 太空地质团队和北亚利桑那大学的格伦·库欣说道。', '7cb6d39639e832c05d3f9ba9bcae979dea8dcda08a6d2cecb23f35e4f14e8b98'],
];

function checkFleursCandidateEar1103(review, frozenItems) {
  return checkFleursSlice(review, frozenItems, FLEURS_CANDIDATE_EAR_1103, '确认。都是对的。usgc也读出了', '2026-11-13T11:03+08:00', true);
}

function uniqueEarCount(groups) {
  const seen = new Set();
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g] || [];
    for (let i = 0; i < group.length; i++) seen.add(group[i]);
  }
  return seen.size;
}

function checkCatalog() {
  const catalog = readJson(CATALOG);
  const smoke = readJson(catalog.smoke.path);
  const pub = catalog.publicCandidates ? readJson(catalog.publicCandidates.path) : null;
  const pubAudio = catalog.publicCandidateAudio ? readJson(catalog.publicCandidateAudio.path) : null;
  const ascend = catalog.ascendCandidates ? readJson(catalog.ascendCandidates.path) : null;
  const review = catalog.zh1663Review ? readJson(catalog.zh1663Review.path) : null;
  const ascendReview = catalog.ascendReview ? readJson(catalog.ascendReview.path) : null;
  const ascendEar = checkAscendEar(ascendReview, ascend ? ascend.items : []);
  const fleursReview = catalog.fleursCandidateReview ? readJson(catalog.fleursCandidateReview.path) : null;
  const fleursFrozen = pub ? pub.items.map((item) => {
    const audio = pubAudio && Array.isArray(pubAudio.items)
      ? pubAudio.items.find((row) => row.config === item.config && String(row.sentenceId) === String(item.sentenceId))
      : null;
    return { config: item.config, sentenceId: String(item.sentenceId), raw: item.raw, audioSha256: audio ? audio.sha256 : '' };
  }) : [];
  const fleursEar = checkFleursCandidateEar(fleursReview, fleursFrozen);
  const fleursReview1103 = catalog.fleursCandidateReview1103 ? readJson(catalog.fleursCandidateReview1103.path) : null;
  const fleursEar1103 = checkFleursCandidateEar1103(fleursReview1103, fleursFrozen);
  const focus = smoke && Array.isArray(smoke.items)
    ? smoke.items.find((item) => item.id === 'cmn_hans_cn/1663/17125746560393607835.wav')
    : null;
  const ear = checkZh1663(review, focus);
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
    zh1663AudioChecked: ear.audioChecked === true,
    publicCandidateCount: pub ? pub.publicCandidateCount : 0,
    humanVerifiedCount: uniqueEarCount([
      ear.ok ? ['fleurs-frozen-16/cmn_hans_cn/1663'] : [],
      ascendEar.keys || [],
      fleursEar.keys || [],
      fleursEar1103.keys || [],
    ]),
    publicCandidateHumanVerifiedCount: pub ? pub.humanVerifiedCount : 0,
    fleursCandidateHumanVerifiedCount: uniqueEarCount([fleursEar.keys || [], fleursEar1103.keys || []]),
    unreviewedPublicCandidateCount: pub ? pub.publicCandidateCount - uniqueEarCount([fleursEar.keys || [], fleursEar1103.keys || []]) : 0,
    ascendHumanVerifiedCount: ascendEar.humanVerifiedCount,
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
  if (!ear.ok) return Object.assign(base, { code: ear.code });
  if (catalog.zh1663AudioChecked !== true) return Object.assign(base, { code: 'zh1663' });
  if (ascend && ascend.humanVerifiedCount !== 0) return Object.assign(base, { code: 'ascend-claim' });
  if (!ascendEar.ok) return Object.assign(base, { code: ascendEar.code });
  if (!fleursEar.ok) return Object.assign(base, { code: fleursEar.code });
  if (!fleursEar1103.ok) return Object.assign(base, { code: fleursEar1103.code });
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

module.exports = {
  checkCatalog, validateRow, referenceEditAllowed, checkZh1663, checkAscendEar,
  checkFleursCandidateEar, checkFleursCandidateEar1103, selftest,
};
