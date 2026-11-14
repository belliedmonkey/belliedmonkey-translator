'use strict';

const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok } = require('./harness');
const { parseVerdict } = require('../eval/baselines/judge/parse.js');
const { adaptSlotsObject } = require('../eval/baselines/judge/slots-object-adapter.js');
const { ASR_RUBRIC, FROZEN_V1_RUBRIC, FROZEN_V1_SHA256, promptTemplateSha256, sha256 } = require('../eval/baselines/judge/rubric.js');
const { EXAMPLE, FINDING_KINDS, NOTE_MAX, VERDICT_SCHEMA } = require('../eval/baselines/judge/verdict-contract.js');
const { runJudge } = require('../eval/baselines/judge/run-judge.js');

function item(id, reference, aText, bText) {
  return {
    id: id,
    reference: reference,
    candidates: [
      { key: 'arm-a', text: aText },
      { key: 'arm-b', text: bText },
    ],
  };
}

function assignment() {
  return { slots: { 'slot-1': 'arm-a', 'slot-2': 'arm-b' } };
}

function pair(reference, slot1, slot2) {
  return {
    item: item('row-1', reference, slot1, slot2),
    assignment: assignment(),
  };
}

describe('llm judge protocol v2', () => {
  test('the sent rubric and the parser share one array contract', () => {
    eq(sha256(FROZEN_V1_RUBRIC), FROZEN_V1_SHA256);
    ok(FROZEN_V1_RUBRIC.indexOf('slots has one object for slot-1 and one for slot-2.') !== -1);
    eq(ASR_RUBRIC.indexOf('slots has one object for slot-1 and one for slot-2.') === -1, true);
    ok(ASR_RUBRIC.indexOf('slots is a JSON array of length 2, not an object and not a dictionary.') !== -1);
    ok(ASR_RUBRIC.indexOf(JSON.stringify(EXAMPLE)) !== -1);
    ok(ASR_RUBRIC.indexOf(String(NOTE_MAX)) !== -1);
    for (let i = 0; i < FINDING_KINDS.length; i++) ok(ASR_RUBRIC.indexOf(FINDING_KINDS[i]) !== -1);
    const kindLine = ASR_RUBRIC.split('\n').filter((line) => line.indexOf('kind is one of ') === 0)[0];
    eq(kindLine.indexOf('punctuation') === -1, true);
    eq(promptTemplateSha256() === FROZEN_V1_SHA256, false);
    const row = pair('the cat sat', 'the cat sat', 'the dog sat');
    const example = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: EXAMPLE.slots,
    });
    eq(parseVerdict(example, row.item, row.assignment).ok, true);
    const asObject = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: { 'slot-1': EXAMPLE.slots[0], 'slot-2': EXAMPLE.slots[1] },
    });
    eq(parseVerdict(asObject, row.item, row.assignment).code, 'slots');
  });

  test('official parse keeps the real failure shapes null', () => {
    const dict = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: {
        'slot-1': { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'why', findings: [] },
        'slot-2': { slot: 'slot-2', abstain: true, confidence: 0.2, note: 'why', findings: [] },
      },
    });
    const row = pair('the cat sat', 'the cat sat', 'the dog sat');
    eq(parseVerdict(dict, row.item, row.assignment).code, 'slots');
    const adapted = adaptSlotsObject(dict);
    eq(adapted.official, false);
    eq(adapted.diagnostic, true);
    eq(parseVerdict(adapted.adaptedText, row.item, row.assignment).ok, true);
    const conflict = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: {
        'slot-1': { slot: 'slot-2', abstain: true, confidence: 0, note: 'why', findings: [] },
        'slot-2': { slot: 'slot-2', abstain: true, confidence: 0, note: 'why', findings: [] },
      },
    });
    eq(adaptSlotsObject(conflict).ok, false);
    const extra = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: {
        'slot-1': { slot: 'slot-1', abstain: true, confidence: 0, note: 'why', findings: [] },
        'slot-2': { slot: 'slot-2', abstain: true, confidence: 0, note: 'why', findings: [] },
        'slot-3': { slot: 'slot-3', abstain: true, confidence: 0, note: 'why', findings: [] },
      },
    });
    eq(adaptSlotsObject(extra).code, 'slots');
    const broken = '{"schema":"' + VERDICT_SCHEMA + '","itemId":"row-1","slots":{"slot-1":{"slot":"slot-1","note":"tion differences"}]}],"slot-2":{"slot":"slot-2"}}}';
    eq(adaptSlotsObject(broken).code, 'bad-json');
    eq(parseVerdict(broken, row.item, row.assignment).code, 'bad-json');
    const longNote = 'n'.repeat(429);
    const noted = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: [
        { slot: 'slot-1', abstain: false, confidence: 0.4, note: longNote, findings: [] },
        { slot: 'slot-2', abstain: true, confidence: 0.2, note: 'why', findings: [] },
      ],
    });
    eq(parseVerdict(noted, row.item, row.assignment).code, 'note');
    const period = pair('um运动啊男生一般不都喜欢运动', '五倍', '运动。');
    const punctQuote = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: [
        { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'why', findings: [] },
        {
          slot: 'slot-2',
          abstain: false,
          confidence: 0.4,
          note: '',
          findings: [{ kind: 'format-only', refQuote: '运动。', hypQuote: '运动。', reason: 'mark' }],
        },
      ],
    });
    eq(parseVerdict(punctQuote, period.item, period.assignment).code, 'quote');
    const crossed = pair('五倍', '5倍', '五倍');
    const cross = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: [
        { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'why', findings: [] },
        {
          slot: 'slot-2',
          abstain: false,
          confidence: 0.4,
          note: '',
          findings: [{ kind: 'format-only', refQuote: '五倍', hypQuote: '5倍', reason: 'other slot' }],
        },
      ],
    });
    eq(parseVerdict(cross, crossed.item, crossed.assignment).code, 'quote');
    const kind = pair('a.', 'a.', 'a.');
    const badKind = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: [
        { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'why', findings: [] },
        {
          slot: 'slot-2',
          abstain: false,
          confidence: 0.4,
          note: '',
          findings: [{ kind: 'punctuation', refQuote: '.', hypQuote: '.', reason: 'dot' }],
        },
      ],
    });
    eq(parseVerdict(badKind, kind.item, kind.assignment).code, 'finding-kind');
    const commaRef = '提出问题及进行观察也可以指导科学研究。';
    const comma = pair(commaRef, '提出问题及进行观察，也可以指导科学研究。', commaRef);
    const invented = JSON.stringify({
      schema: VERDICT_SCHEMA,
      itemId: 'row-1',
      slots: {
        'slot-1': { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'why', findings: [] },
        'slot-2': {
          slot: 'slot-2',
          abstain: false,
          confidence: 0.4,
          note: '',
          findings: [{ kind: 'semantic', refQuote: '提出问题及进行观察，也可以指导科学研究。', hypQuote: commaRef, reason: 'comma' }],
        },
      },
    });
    const shaped = adaptSlotsObject(invented);
    eq(shaped.ok, true);
    eq(parseVerdict(shaped.adaptedText, comma.item, comma.assignment).code, 'quote');
  });

  test('a 36 by 2 dry-run plans 72 full reservations and does not call', async () => {
    const items = [];
    for (let i = 0; i < 36; i++) {
      items.push({
        id: 'id-' + i,
        reference: 'ref ' + i,
        candidates: [
          { key: 'arm-a', text: 'a ' + i },
          { key: 'arm-b', text: 'b ' + i },
        ],
      });
    }
    const summary = await runJudge({
      synthetic: true,
      input: { schema: 'belliedmonkey.llm-judge.input.v1', task: 'asr', items: items },
      config: {
        schema: 'belliedmonkey.llm-judge.config.v1',
        seed: 7,
        temperature: 0,
        sampleCount: 0,
        maxItems: 36,
        timeoutMs: 1000,
        maxRetries: 0,
        budgetUsd: 100,
        inputBound: { kind: 'utf8-bytes-plus-overhead', overheadTokens: 0 },
        judges: [
          { id: 'judge-a', model: 'model-alpha', endpointEnv: 'JUDGE_A_URL', keyEnv: 'JUDGE_A_KEY' },
          { id: 'judge-b', model: 'model-beta', endpointEnv: 'JUDGE_B_URL', keyEnv: 'JUDGE_B_KEY' },
        ],
        prices: {
          schema: 'belliedmonkey.llm-judge.prices.v1',
          source: 'fixture-price-table',
          sourceVersion: 'test-1',
          maxInputTokens: 8000,
          maxOutputTokens: 800,
          maxTotalTokens: 700000,
          maxRequests: 72,
          models: {
            'model-alpha': { inputUsdPerToken: 0.000001, outputUsdPerToken: 0.000002, pricedZero: false },
            'model-beta': { inputUsdPerToken: 0.000001, outputUsdPerToken: 0.000002, pricedZero: false },
          },
        },
      },
      transport: async () => { throw new Error('called'); },
    });
    eq(summary.code, 'dry-run');
    eq(summary.called, false);
    eq(summary.plan.itemIds.length * summary.plan.judges.length, 72);
    eq(summary.plan.reserveTokens, 8800);
    eq(summary.plan.inputChecks.length, 72);
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs/baselines/llm-judge.md'), 'utf8');
    ok(doc.indexOf('72') !== -1);
    ok(doc.indexOf(promptTemplateSha256()) !== -1);
  });
});
