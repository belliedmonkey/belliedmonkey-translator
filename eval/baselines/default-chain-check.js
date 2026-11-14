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

function checkFleursSlice(review, frozenItems, pins, verbatim, reviewedAt, parentheticalOn1670, forbidDedicatedParenthetical) {
  const blocked = { ok: false, humanVerifiedCount: 0, approvedPlannedSetCount: 0, keys: [] };
  if (!review) return Object.assign(blocked, { code: 'fleurs-candidate-missing' });
  if (review.reviewer !== 'ZHAO ZHANG' || review.reviewedAt !== reviewedAt || review.timezone !== 'Asia/Shanghai' || review.verbatim !== verbatim) {
    return Object.assign(blocked, { code: 'fleurs-candidate-conclusion' });
  }
  if (forbidDedicatedParenthetical && (
    Object.prototype.hasOwnProperty.call(review, 'fbiFinding')
    || Object.prototype.hasOwnProperty.call(review, 'sieFinding')
    || Object.prototype.hasOwnProperty.call(review, 'sieSpoken')
    || review.latinParentheticalSpoken
  )) {
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
    if (!row || row.source !== 'fleurs-public-candidates') {
      return Object.assign(blocked, { code: 'fleurs-candidate-scope' });
    }
    const rowKey = 'fleurs-public-candidates/' + row.config + '/' + String(row.sentenceId);
    if (seen.has(rowKey)) return Object.assign(blocked, { code: 'fleurs-candidate-duplicate' });
    seen.add(rowKey);
    if (row.config !== config || String(row.sentenceId) !== sentenceId) {
      return Object.assign(blocked, { code: 'fleurs-candidate-scope' });
    }
    const key = rowKey;
    const frozen = frozenByKey.get(config + '/' + sentenceId);
    if (!frozen) return Object.assign(blocked, { code: 'fleurs-candidate-scope' });
    if (row.audioSha256 !== hash || frozen.audioSha256 !== hash || (row.playbackSha256 && row.playbackSha256 === hash) || playback === hash) {
      return Object.assign(blocked, { code: 'fleurs-candidate-hash' });
    }
    if (row.raw !== raw || frozen.raw !== raw) return Object.assign(blocked, { code: 'fleurs-candidate-text' });
    if (parentheticalOn1670 && sentenceId === '1670' && row.userParenthetical !== 'usgc也读出了') {
      return Object.assign(blocked, { code: 'fleurs-candidate-conclusion' });
    }
    if (forbidDedicatedParenthetical && (
      Object.prototype.hasOwnProperty.call(row, 'userParenthetical')
      || Object.prototype.hasOwnProperty.call(row, 'fbiSpoken')
      || Object.prototype.hasOwnProperty.call(row, 'latinParentheticalSpoken')
      || Object.prototype.hasOwnProperty.call(row, 'sieSpoken')
    )) {
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

const FLEURS_CANDIDATE_EAR_1109 = [
  ['en_us', '1671', 'd60875a908926028d9f6f6821af974effbf091116400f6d52dc86e2cae96cd25', 'Congress began funding the obscenity initiative in fiscal 2005 and specified that the FBI must devote 10 agents to adult pornography.', '4bf19e41281880b51e215819d22a39cbd6006c7c98e68d54b2c40d5891d28641'],
  ['cmn_hans_cn', '1671', 'c7719ea621b9262f207178fe430a8625b220127fc19a9d3f5be8577cbfba8caf', '国会从 2005 财年开始资助该扫黄倡议，并规定联邦调查局 (FBI) 必须指派 10 名探员专门打击成人色情。', 'c3847710b4bf1efac4f92b7fb1d79229236ed81a3b4b462b4e524686ed08775e'],
  ['en_us', '1672', 'cd58bbf4d2aff767cdfb29bc175a4c7ece18c7769248af337f68e6cb645ddc93', 'Be careful not to allow fabric to become too hot (which can cause shrinkage, or in extreme cases, scorch).', '5d25e409da4c98fa065015ade796d00e502da931ef3f66fffa83fad34901bad6'],
  ['cmn_hans_cn', '1672', '420a62e5d34c0dde3a8e438bc4ee1249612b5119cbf7758280bf184405e01883', '小心不要让衣服变得太热（这可能会产生收缩现象，在极端情况下会把衣服烤焦）。', '9020920634b82a69b6567002267491cf1b77a5652c0a4e91f79f2dd487eb57c3'],
  ['en_us', '1673', '1518970aa8eb571854f94481fb8bc1056b112ed4724021402ed608e3794a4de3', 'During the Revolutionary War, the thirteen states first formed a weak central government—with the Congress being its only component—under the Articles of Confederation.', '09b80e3d54f225d6e501b083dec94e9ec3c876c7ef4b348f4bb92fa669f0a28f'],
  ['cmn_hans_cn', '1673', '0513421059b64bafbb0587fdfa72ac706e4f1e303a79b6d226b2dd9db43b2c41', '在独立战争期间，十三个州最初根据《联邦条例》组成了弱小的中央政府（国会是其唯一的组成部分）。', '8b680ce2552026b35453490c436f3ef11902dde9ab40c0c81a3e5aaa9d58e55b'],
];

function checkFleursCandidateEar1109(review, frozenItems) {
  return checkFleursSlice(review, frozenItems, FLEURS_CANDIDATE_EAR_1109, '全部人审通过', '2026-11-13T11:09+08:00', false, true);
}

const FLEURS_CANDIDATE_EAR_1240 = [
  ['en_us', '1674', 'ed78d88661c8f76d7b8951665a3c2e9adea23828fe3e70fd9df95465cb8f8ede', 'In some areas boiling water for a minute is enough, in others several minutes are needed.', 'e91598b12a2a904bc3f00576ad2849753dcf96e3ebbcdc3d8b878951cf3eb57e'],
  ['cmn_hans_cn', '1674', '75ab88f7bfc76e18bb8355139d72f02f4ba87ec3b08d1b14d581822c1576925e', '在某些地区，水煮一分钟就足够了，在其他地区则需要几分钟的时间。', 'b915460074da3f60ecc49813ca1386f919398f92fc7e9d56181413e4e19a5024'],
  ['en_us', '1675', '7603cae3294309ef70d234180cefccc3b13865ee525262228a636069b9b62841', 'All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence.', 'f289c1a52b5503e77d6fee25d793940817d5f0d64dc0ec24642b5c41840eeb7a'],
  ['cmn_hans_cn', '1675', 'b7caf9b78e8e09ec6732a061c3615c61634b6ffbf78a5dcea717510185cb1046', '除去表示您的“Sie”之外的所有名词都应以大写字母开头，即使在句子中间也应如此。', 'e58cc6a579a8bc73bf245b9ce83ec985154132c791e0627402ad3ec52846c683'],
  ['en_us', '1676', '82dffe62952ceca62fb92118b8c1226d3a45eaba7b95ccdb466b6656efec91f6', 'As with all South African National Parks, there are daily conservation and entry fees for the park.', '69dc7adbb2012b1b65bbaa8c19214c15eabe6072f393d042f769f37afbac840d'],
  ['cmn_hans_cn', '1676', 'b28ffcf7fbb8978db09ad0007aca48f93506084f379db7a1081f618a96494605', '与所有南非国家公园一样，该公园每天都收取养护费和门票费。', '9219de33a2cf9f37d28fc34282d06df352713101e6679099cd2c076231760399'],
];

function checkFleursCandidateEar1240(review, frozenItems) {
  const got = checkFleursSlice(review, frozenItems, FLEURS_CANDIDATE_EAR_1240, '全都通过', '2026-11-13T12:40+08:00', false, true);
  if (!got.ok) return got;
  const note = review.parallelReference;
  if (!note || note.sentenceId !== '1675' || note.status !== 'potential-mismatch' || note.enCue !== 'alongside' || note.zhCue !== '除去…之外' || note.audioReviewIsNotReferenceAcceptance !== true || note.textEdited !== false) {
    return { ok: false, humanVerifiedCount: 0, approvedPlannedSetCount: 0, keys: [], code: 'fleurs-candidate-conclusion' };
  }
  return got;
}

const FLEURS_CANDIDATE_EAR_1319 = [
  ['en_us', '1677', '5a5a12d06c0a6acaf0a0d737d7c980bce91ec3f652cfa537b3cbaf8e10845dbc', 'Today, the only insects that cannot fold back their wings are dragon flies and mayflies.', '504c6b7cbf356e5f63c51e42e122f4acdbc3ab834b66cc7196bd4568ae14cb2c'],
  ['cmn_hans_cn', '1677', '04940c7dca3b3189eb51f410f514673259dd9b35243a9a7e3d3472de1c5f0c81', '如今，唯一不能向后折叠翅膀的昆虫是蜻蜓和蜉蝣。', 'b863ea8830a0656e0975a17fdc05427d742e232c8075bf4f7e9cba811453a33e'],
  ['en_us', '1678', '2ec0ade3595e05c1e91a751fc73811f69606b9682a23b2eeb48c6840e959bee9', 'Oliver Sacks, in his paper The President\'s Speech, indicated how people who are unable to understand speech because of brain damage are nevertheless able to assess sincerity accurately.', '7b4ec4c54ce5dc3ceb6c419cfe26250916fd351a885d7cf8acbc93824f4016a7'],
  ['cmn_hans_cn', '1678', '07ffccbe5c1fa2e1ee942770abfdb23ad8e3d450b0a1a9eed5d9e039233082e4', '奥利弗·萨克斯 (Oliver Sacks) 在他的论文《总统的演讲》中指出，那些因为脑损伤而无法理解语言的人仍然能够准确地判断说话人是否有诚意。', '6ad773564470d982de3b7d9a2b30fec31079c2da57aa28c2aad00816f30257d0'],
  ['en_us', '1679', '0f72a68d17c6b3a08bba8591d71aef50d1e72ff6d1634269c095985868f7a09c', 'Aerosmith have cancelled their remaining concerts on their tour.', 'b1fe8038bf23cf8395c25aa399a7a27dfba7e2690ea9de765c202e3a3130626a'],
  ['cmn_hans_cn', '1679', '49d3217d97b9aca836c9d69cdffa68830f987d126669c0fe69bb22507b20cd51', '空中铁匠乐队已经取消了他们巡回演唱会的剩余场次。', '2f75f18d611fa13c5b9663b036b9f02f4dc26dd8d933026caf12b3f6cdda8de8'],
];

function checkFleursCandidateEar1319(review, frozenItems) {
  const blocked = { ok: false, humanVerifiedCount: 0, approvedPlannedSetCount: 0, keys: [], code: 'fleurs-candidate-conclusion' };
  const got = checkFleursSlice(review, frozenItems, FLEURS_CANDIDATE_EAR_1319, '全过', '2026-11-13T13:19+08:00', false, true);
  if (!got.ok) return got;
  if (review.scope !== 'audio-transcript-consistency' || review.translationQualityJudged !== false) return blocked;
  if (Object.prototype.hasOwnProperty.call(review, 'oliverSacksSpoken')) return blocked;
  for (let i = 0; i < review.items.length; i++) {
    if (Object.prototype.hasOwnProperty.call(review.items[i], 'oliverSacksSpoken')) return blocked;
  }
  return got;
}


const FLEURS_CANDIDATE_EAR_1520 = [
["en_us", "1680", "7df2a964d8ce3931be897abeac59dd02669c709163fe23e928d917d31cf27601", "A well rounded athlete, the tiger can climb (though not well), swim, leap great distances and pull with five times the force of a strong human.", "eedff692b614b30e356de75d846cff2100d75939a121cc6cff105c0875f7bdf0"],
  ["cmn_hans_cn", "1680", "79721ab0386d30676690498bacee2f0032f97028c0bd63ae86e33862c8ad8879", "老虎是全能运动员，它会攀爬（虽然攀爬能力不是很强）、游泳、跳远，拉力能达到人类大力士的五倍。", "658316a2e1bb4a5842f2b74780da38a14c8b765338835e265f60389b2322d807"],
  ["en_us", "1681", "8752cda5cc51f24c718320f30ee0e4dcd86df3bb794c3bd122e391cca9516048", "It isn’t alone though, experimentation, and an experiment is a test that is used to eliminate one or more of the possible hypotheses, asking questions, and making observations also guide scientific research.", "ae5db8cf34367d0a922758dadf0d682872afd705ba88f1907ff23dcd17fb73a4"],
  ["cmn_hans_cn", "1681", "6cd9c8019accd4b3fad799c8faf41770341085f5cb7b75b3bf8123b3abf3779b", "实验是一种用来消除一个或多个可能性假设的试验，不过，实验并不是唯一的方法。提出问题及进行观察也可以指导科学研究。", "4365e543ae2ff45dec8f420be02f4c335904979928c66ee5bb37af01ec18371f"],
  ["en_us", "1682", "7f8e2186df44065aba3331c5fc2f2af07402be60914d255747665be8075d0cb1", "While no one knows for certain who wrote it, it is known that early in its life, the large parchment document (it measures 29¾ inches by 24½ inches) was rolled up for storage.", "c1e545a58707d9c503a0acf1ffdc25f0a286cd2dc312a4425fd874f6b0afec8b"],
  ["cmn_hans_cn", "1682", "7cda7193eb573699c81b116c916c2ba869b8c1926a2db04fa0e8ae869854a080", "虽然没有人能确定作者是谁，但这个大型羊皮纸文档（尺寸为 29¾ 英寸乘以 24½ 英寸）据称在刚写成的时候是卷起来存放的。", "6f88adfbbd4670918ffc6060faf6b36cd369f9945ac4ef75b9f6483a309ae98d"],
];

function checkFleursCandidateEar1520(review, frozenItems) {
  const blocked = { ok: false, humanVerifiedCount: 0, approvedPlannedSetCount: 0, keys: [], code: 'fleurs-candidate-conclusion' };
  const got = checkFleursSlice(review, frozenItems, FLEURS_CANDIDATE_EAR_1520, '全部通过', '2026-11-13T15:20+08:00', false, true);
  if (!got.ok) return got;
  if (review.scope !== 'audio-transcript-consistency' || review.translationQualityJudged !== false) return blocked;
  const banned = ['parentheticalSpoken', 'fractionSpoken', 'numberSpoken'];
  for (let b = 0; b < banned.length; b++) {
    if (Object.prototype.hasOwnProperty.call(review, banned[b])) return blocked;
  }
  for (let i = 0; i < review.items.length; i++) {
    for (let b = 0; b < banned.length; b++) {
      if (Object.prototype.hasOwnProperty.call(review.items[i], banned[b])) return blocked;
    }
  }
  return got;
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
  const fleursReview1109 = catalog.fleursCandidateReview1109 ? readJson(catalog.fleursCandidateReview1109.path) : null;
  const fleursEar1109 = checkFleursCandidateEar1109(fleursReview1109, fleursFrozen);
  const fleursReview1240 = catalog.fleursCandidateReview1240 ? readJson(catalog.fleursCandidateReview1240.path) : null;
  const fleursEar1240 = checkFleursCandidateEar1240(fleursReview1240, fleursFrozen);
  const fleursReview1319 = catalog.fleursCandidateReview1319 ? readJson(catalog.fleursCandidateReview1319.path) : null;
  const fleursEar1319 = checkFleursCandidateEar1319(fleursReview1319, fleursFrozen);
  const fleursReview1520 = catalog.fleursCandidateReview1520 ? readJson(catalog.fleursCandidateReview1520.path) : null;
  const fleursEar1520 = checkFleursCandidateEar1520(fleursReview1520, fleursFrozen);
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
      fleursEar1109.keys || [],
      fleursEar1240.keys || [],
      fleursEar1319.keys || [],
      fleursEar1520.keys || [],
    ]),
    publicCandidateHumanVerifiedCount: pub ? pub.humanVerifiedCount : 0,
    fleursCandidateHumanVerifiedCount: uniqueEarCount([fleursEar.keys || [], fleursEar1103.keys || [], fleursEar1109.keys || [], fleursEar1240.keys || [], fleursEar1319.keys || [], fleursEar1520.keys || []]),
    unreviewedPublicCandidateCount: pub ? pub.publicCandidateCount - uniqueEarCount([fleursEar.keys || [], fleursEar1103.keys || [], fleursEar1109.keys || [], fleursEar1240.keys || [], fleursEar1319.keys || [], fleursEar1520.keys || []]) : 0,
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
  if (!fleursEar1109.ok) return Object.assign(base, { code: fleursEar1109.code });
  if (!fleursEar1240.ok) return Object.assign(base, { code: fleursEar1240.code });
  if (!fleursEar1319.ok) return Object.assign(base, { code: fleursEar1319.code });
  if (!fleursEar1520.ok) return Object.assign(base, { code: fleursEar1520.code });
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
  checkFleursCandidateEar, checkFleursCandidateEar1103, checkFleursCandidateEar1109, checkFleursCandidateEar1240, checkFleursCandidateEar1319, checkFleursCandidateEar1520, selftest,
};
