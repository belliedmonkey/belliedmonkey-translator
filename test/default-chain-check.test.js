// Offline contract for the default-chain catalog. Synthetic rows are not measurements.
'use strict';

const { describe, test, eq } = require('./harness');
const {
  checkCatalog, validateRow, referenceEditAllowed, checkZh1663, checkAscendEar, checkFleursCandidateEar, checkFleursCandidateEar1103, checkFleursCandidateEar1109, checkFleursCandidateEar1240, checkFleursCandidateEar1319,
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
    eq(report.humanVerifiedCount, 31);
    eq(report.ascendHumanVerifiedCount, 6);
    eq(report.fleursCandidateHumanVerifiedCount, 24);
    eq(report.unreviewedPublicCandidateCount, 6);
    eq(report.publicCandidateHumanVerifiedCount, 0);
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

  test('the six ASCEND ear rows fail closed when the record, a hash, or a transcription changes', () => {
    const pins = [
      ['00004', 'b1d784c7c355c79febc73733f61a9faa2564c9f07cdf12caa3dd470f381c0149', "呃what's the呃"],
      ['00009', '7317a4752e95039e6f6c345ef5b15fdd18fc7f48353cc893e6f99218a682c9a3', 'no我专业是那个i s m information systems management'],
      ['00028', 'f790b945050ccc625702f214dc7182c0c0e781a6fd5a82c7d1863c4683414842', 'ok福建'],
      ['00055', '866d07fc22025c9450e6e8811cb6b374ab863370182922c054dfa1c1ea46a535', 'um运动啊男生一般不都喜欢运动'],
      ['00066', 'a554fbe3692c170b6aed5a34f34095312fe4b822c1c205eaddf894ee90f21faf', '哦这么technical'],
      ['00068', 'ddf1d1241915e223a8f46e6e00e9f5c0b6574add6d6c984fab26ee5508897958', 'computer languages是'],
    ];
    const frozen = pins.map((row) => ({ id: row[0], audioSha256: row[1], transcription: row[2] }));
    eq(checkAscendEar(null, frozen).code, 'ascend-missing');
    eq(checkAscendEar(null, frozen).humanVerifiedCount, 0);
    const review = {
      reviewer: 'ZHAO ZHANG',
      reviewedAt: '2026-11-13T09:44+08:00',
      timezone: 'Asia/Shanghai',
      accent: { count: 0, status: 'unknown' },
      noise: { count: 0, status: 'unknown' },
      continuousDialogue: { count: 0, status: 'unknown' },
      items: pins.map((row) => ({
        id: row[0],
        audioSha256: row[1],
        transcription: row[2],
        codeSwitchHeard: true,
        transcriptMismatchOrUncertain: false,
      })),
    };
    const badHash = JSON.parse(JSON.stringify(review));
    badHash.items[0].audioSha256 = 'a'.repeat(64);
    eq(checkAscendEar(badHash, frozen).code, 'ascend-hash');
    const badText = JSON.parse(JSON.stringify(review));
    badText.items[3].transcription = '运动啊男生一般不都喜欢运动';
    eq(checkAscendEar(badText, frozen).code, 'ascend-transcription');
    const heard = checkAscendEar(review, frozen);
    eq(heard.humanVerifiedCount, 6);
    eq(heard.approvedPlannedSetCount, 0);
    eq(heard.continuousDialogue.count, 0);
  });

  test('only the three delivered FLEURS candidate clips count, and a changed line does not', () => {
    const pins = [
      ['en_us', '1668', 'd6ab97bb7e3232b60b61910d3ac7e1cf37acbcbfd062773b453c76217682f49e', 'It may also be beneficial for one to buy a Wild Card, which provides entry to either selections of parks in South Africa or all of the South African National Parks.'],
      ['cmn_hans_cn', '1668', '7b95a45446dc31d99d50232a7a6dbda26cc9c87eb26aec1263f73e7f9dd6405f', '买一张万能卡（Wild Card）也有不少好处。带着这张卡，你可以进入南非的一些公园或全部的国家公园。'],
      ['en_us', '1669', '40d7e92df0355f4836e2b8fa2a88d7c7e047d0472f0845ca08f0c21257785390', 'Police superintendent Chandra Shekhar Solanki said the accused appeared in court with covered faces.'],
    ];
    const frozen = pins.map((row) => ({ config: row[0], sentenceId: row[1], audioSha256: row[2], raw: row[3] }));
    eq(checkFleursCandidateEar(null, frozen).code, 'fleurs-candidate-missing');
    eq(checkFleursCandidateEar(null, frozen).humanVerifiedCount, 0);
    const review = {
      reviewer: 'ZHAO ZHANG',
      reviewedAt: '2026-11-13T10:59+08:00',
      timezone: 'Asia/Shanghai',
      verbatim: '前面的都通过。',
      items: pins.map((row) => ({
        source: 'fleurs-public-candidates',
        config: row[0],
        sentenceId: row[1],
        audioSha256: row[2],
        raw: row[3],
      })),
    };
    const passed = checkFleursCandidateEar(review, frozen);
    eq(passed.humanVerifiedCount, 3);
    eq(passed.approvedPlannedSetCount, 0);
    const badHash = JSON.parse(JSON.stringify(review));
    badHash.items[2].audioSha256 = 'a'.repeat(64);
    eq(checkFleursCandidateEar(badHash, frozen).code, 'fleurs-candidate-hash');
    const badText = JSON.parse(JSON.stringify(review));
    badText.items[0].raw = 'Wild Card only';
    eq(checkFleursCandidateEar(badText, frozen).code, 'fleurs-candidate-text');
    const extra = JSON.parse(JSON.stringify(review));
    extra.items.push({
      source: 'fleurs-public-candidates',
      config: 'cmn_hans_cn',
      sentenceId: '1669',
      audioSha256: 'de149c29bdb3dd88f3befb247a99b2866aaa9c196f08818d8f2bba06c1ce0c53',
      raw: '未发音频',
    });
    eq(checkFleursCandidateEar(extra, frozen).code, 'fleurs-candidate-scope');
  });

  test('the 11:03 reply counts only the three newly delivered clips and keeps usgc', () => {
    const pins = [
      ['cmn_hans_cn', '1669', 'de149c29bdb3dd88f3befb247a99b2866aaa9c196f08818d8f2bba06c1ce0c53', '警察局长钱德拉·谢卡尔·索兰基说，被告人出庭时都蒙住了脸。'],
      ['en_us', '1670', '6dc676eae80109d088233f838226d4164f76befd8aafc772e1a6cb9eaa0d31df', 'Their thermal behavior is not as steady as large caves on Earth that often maintain a fairly constant temperature, but it is consistent with these being deep holes in the ground," said Glen Cushing of the United States Geological Survey (USGS) Astrogeology Team and of Northern Arizona University located in Flagstaff, Arizona.'],
      ['cmn_hans_cn', '1670', 'ba4d6b659f00765bd39fe3952b1da421733923ee0c9774c4a18d871f4fc4f73c', '“它们的热行为不像地球上的大型洞穴那么稳定，这些大型洞穴通常会保持相当恒定的温度，但它们与地下深穴的情况很相似，”亚利桑那州旗杆镇美国地质调查局 (USGS) 太空地质团队和北亚利桑那大学的格伦·库欣说道。'],
    ];
    const frozen = pins.map((row) => ({ config: row[0], sentenceId: row[1], audioSha256: row[2], raw: row[3] }));
    eq(checkFleursCandidateEar1103(null, frozen).code, 'fleurs-candidate-missing');
    const review = {
      reviewer: 'ZHAO ZHANG',
      reviewedAt: '2026-11-13T11:03+08:00',
      timezone: 'Asia/Shanghai',
      verbatim: '确认。都是对的。usgc也读出了',
      items: pins.map((row) => ({
        source: 'fleurs-public-candidates',
        config: row[0],
        sentenceId: row[1],
        audioSha256: row[2],
        raw: row[3],
        userParenthetical: row[1] === '1670' ? 'usgc也读出了' : '',
      })),
    };
    const passed = checkFleursCandidateEar1103(review, frozen);
    eq(passed.humanVerifiedCount, 3);
    eq(passed.verbatim, '确认。都是对的。usgc也读出了');
    const spelled = JSON.parse(JSON.stringify(review));
    spelled.verbatim = '确认。都是对的。USGS也读出了';
    eq(checkFleursCandidateEar1103(spelled, frozen).code, 'fleurs-candidate-conclusion');
    const badText = JSON.parse(JSON.stringify(review));
    badText.items[1].raw = badText.items[1].raw.replace('(USGS)', '(usgc)');
    eq(checkFleursCandidateEar1103(badText, frozen).code, 'fleurs-candidate-text');
  });

  test('the 11:09 reply is an overall pass and does not invent an FBI answer', () => {
    const pins = [
      ['en_us', '1671', 'd60875a908926028d9f6f6821af974effbf091116400f6d52dc86e2cae96cd25', 'Congress began funding the obscenity initiative in fiscal 2005 and specified that the FBI must devote 10 agents to adult pornography.'],
      ['cmn_hans_cn', '1671', 'c7719ea621b9262f207178fe430a8625b220127fc19a9d3f5be8577cbfba8caf', '国会从 2005 财年开始资助该扫黄倡议，并规定联邦调查局 (FBI) 必须指派 10 名探员专门打击成人色情。'],
      ['en_us', '1672', 'cd58bbf4d2aff767cdfb29bc175a4c7ece18c7769248af337f68e6cb645ddc93', 'Be careful not to allow fabric to become too hot (which can cause shrinkage, or in extreme cases, scorch).'],
      ['cmn_hans_cn', '1672', '420a62e5d34c0dde3a8e438bc4ee1249612b5119cbf7758280bf184405e01883', '小心不要让衣服变得太热（这可能会产生收缩现象，在极端情况下会把衣服烤焦）。'],
      ['en_us', '1673', '1518970aa8eb571854f94481fb8bc1056b112ed4724021402ed608e3794a4de3', 'During the Revolutionary War, the thirteen states first formed a weak central government—with the Congress being its only component—under the Articles of Confederation.'],
      ['cmn_hans_cn', '1673', '0513421059b64bafbb0587fdfa72ac706e4f1e303a79b6d226b2dd9db43b2c41', '在独立战争期间，十三个州最初根据《联邦条例》组成了弱小的中央政府（国会是其唯一的组成部分）。'],
    ];
    const frozen = pins.map((row) => ({ config: row[0], sentenceId: row[1], audioSha256: row[2], raw: row[3] }));
    eq(pins[1][3].includes('(FBI)'), true);
    eq(checkFleursCandidateEar1109(null, frozen).code, 'fleurs-candidate-missing');
    const review = {
      reviewer: 'ZHAO ZHANG',
      reviewedAt: '2026-11-13T11:09+08:00',
      timezone: 'Asia/Shanghai',
      verbatim: '全部人审通过',
      items: pins.map((row) => ({
        source: 'fleurs-public-candidates',
        config: row[0],
        sentenceId: row[1],
        audioSha256: row[2],
        raw: row[3],
      })),
    };
    const passed = checkFleursCandidateEar1109(review, frozen);
    eq(passed.humanVerifiedCount, 6);
    eq(passed.verbatim, '全部人审通过');
    const claimed = JSON.parse(JSON.stringify(review));
    claimed.items[1].userParenthetical = 'FBI也读出了';
    eq(checkFleursCandidateEar1109(claimed, frozen).code, 'fleurs-candidate-conclusion');
    const rewritten = JSON.parse(JSON.stringify(review));
    rewritten.items[1].raw = rewritten.items[1].raw.replace('(FBI)', 'FBI');
    eq(checkFleursCandidateEar1109(rewritten, frozen).code, 'fleurs-candidate-text');
    const overlap = JSON.parse(JSON.stringify(review));
    overlap.items[0].sentenceId = '1668';
    eq(checkFleursCandidateEar1109(overlap, frozen).code, 'fleurs-candidate-scope');
  });

  test('the 12:40 reply is an overall pass and does not accept the 1675 parallel text', () => {
    const pins = [
      ['en_us', '1674', 'ed78d88661c8f76d7b8951665a3c2e9adea23828fe3e70fd9df95465cb8f8ede', 'In some areas boiling water for a minute is enough, in others several minutes are needed.'],
      ['cmn_hans_cn', '1674', '75ab88f7bfc76e18bb8355139d72f02f4ba87ec3b08d1b14d581822c1576925e', '在某些地区，水煮一分钟就足够了，在其他地区则需要几分钟的时间。'],
      ['en_us', '1675', '7603cae3294309ef70d234180cefccc3b13865ee525262228a636069b9b62841', 'All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence.'],
      ['cmn_hans_cn', '1675', 'b7caf9b78e8e09ec6732a061c3615c61634b6ffbf78a5dcea717510185cb1046', '除去表示您的“Sie”之外的所有名词都应以大写字母开头，即使在句子中间也应如此。'],
      ['en_us', '1676', '82dffe62952ceca62fb92118b8c1226d3a45eaba7b95ccdb466b6656efec91f6', 'As with all South African National Parks, there are daily conservation and entry fees for the park.'],
      ['cmn_hans_cn', '1676', 'b28ffcf7fbb8978db09ad0007aca48f93506084f379db7a1081f618a96494605', '与所有南非国家公园一样，该公园每天都收取养护费和门票费。'],
    ];
    const frozen = pins.map((row) => ({ config: row[0], sentenceId: row[1], audioSha256: row[2], raw: row[3] }));
    eq(pins[2][3].includes('alongside'), true);
    eq(pins[3][3].includes('除去'), true);
    const review = {
      reviewer: 'ZHAO ZHANG',
      reviewedAt: '2026-11-13T12:40+08:00',
      timezone: 'Asia/Shanghai',
      verbatim: '全都通过',
      parallelReference: {
        sentenceId: '1675',
        status: 'potential-mismatch',
        enCue: 'alongside',
        zhCue: '除去…之外',
        audioReviewIsNotReferenceAcceptance: true,
        textEdited: false,
      },
      items: pins.map((row) => ({
        source: 'fleurs-public-candidates',
        config: row[0],
        sentenceId: row[1],
        audioSha256: row[2],
        raw: row[3],
      })),
    };
    const passed = checkFleursCandidateEar1240(review, frozen);
    eq(passed.humanVerifiedCount, 6);
    eq(passed.verbatim, '全都通过');
    const claimed = JSON.parse(JSON.stringify(review));
    claimed.items[2].sieSpoken = 'Sie也读出了';
    eq(checkFleursCandidateEar1240(claimed, frozen).code, 'fleurs-candidate-conclusion');
    const accepted = JSON.parse(JSON.stringify(review));
    accepted.parallelReference.status = 'accepted';
    eq(checkFleursCandidateEar1240(accepted, frozen).code, 'fleurs-candidate-conclusion');
    const rewritten = JSON.parse(JSON.stringify(review));
    rewritten.items[3].raw = rewritten.items[3].raw.replace('除去', '连同');
    eq(checkFleursCandidateEar1240(rewritten, frozen).code, 'fleurs-candidate-text');
  });

  test('the 13:19 reply is an audio-text pass and does not judge Oliver Sacks or translation quality', () => {
    const pins = [
      ['en_us', '1677', '5a5a12d06c0a6acaf0a0d737d7c980bce91ec3f652cfa537b3cbaf8e10845dbc', 'Today, the only insects that cannot fold back their wings are dragon flies and mayflies.'],
      ['cmn_hans_cn', '1677', '04940c7dca3b3189eb51f410f514673259dd9b35243a9a7e3d3472de1c5f0c81', '如今，唯一不能向后折叠翅膀的昆虫是蜻蜓和蜉蝣。'],
      ['en_us', '1678', '2ec0ade3595e05c1e91a751fc73811f69606b9682a23b2eeb48c6840e959bee9', "Oliver Sacks, in his paper The President's Speech, indicated how people who are unable to understand speech because of brain damage are nevertheless able to assess sincerity accurately."],
      ['cmn_hans_cn', '1678', '07ffccbe5c1fa2e1ee942770abfdb23ad8e3d450b0a1a9eed5d9e039233082e4', '奥利弗·萨克斯 (Oliver Sacks) 在他的论文《总统的演讲》中指出，那些因为脑损伤而无法理解语言的人仍然能够准确地判断说话人是否有诚意。'],
      ['en_us', '1679', '0f72a68d17c6b3a08bba8591d71aef50d1e72ff6d1634269c095985868f7a09c', 'Aerosmith have cancelled their remaining concerts on their tour.'],
      ['cmn_hans_cn', '1679', '49d3217d97b9aca836c9d69cdffa68830f987d126669c0fe69bb22507b20cd51', '空中铁匠乐队已经取消了他们巡回演唱会的剩余场次。'],
    ];
    const frozen = pins.map((row) => ({ config: row[0], sentenceId: row[1], audioSha256: row[2], raw: row[3] }));
    eq(pins[3][3].includes('(Oliver Sacks)'), true);
    const review = {
      reviewer: 'ZHAO ZHANG',
      reviewedAt: '2026-11-13T13:19+08:00',
      timezone: 'Asia/Shanghai',
      verbatim: '全过',
      scope: 'audio-transcript-consistency',
      translationQualityJudged: false,
      items: pins.map((row) => ({
        source: 'fleurs-public-candidates',
        config: row[0],
        sentenceId: row[1],
        audioSha256: row[2],
        raw: row[3],
      })),
    };
    const passed = checkFleursCandidateEar1319(review, frozen);
    eq(passed.humanVerifiedCount, 6);
    eq(passed.verbatim, '全过');
    const claimed = JSON.parse(JSON.stringify(review));
    claimed.items[3].oliverSacksSpoken = '括注也读出了';
    eq(checkFleursCandidateEar1319(claimed, frozen).code, 'fleurs-candidate-conclusion');
    const quality = JSON.parse(JSON.stringify(review));
    quality.translationQualityJudged = true;
    eq(checkFleursCandidateEar1319(quality, frozen).code, 'fleurs-candidate-conclusion');
    const rewritten = JSON.parse(JSON.stringify(review));
    rewritten.items[3].raw = rewritten.items[3].raw.replace(' (Oliver Sacks)', '');
    eq(checkFleursCandidateEar1319(rewritten, frozen).code, 'fleurs-candidate-text');
  });
});
