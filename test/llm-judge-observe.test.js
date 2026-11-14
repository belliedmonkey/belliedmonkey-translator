'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { describe, test, eq } = require('./harness');
const { runJudge, assignmentDigest } = require('../eval/baselines/judge/run-judge.js');
const { promptTemplateSha256, FROZEN_V1_SHA256 } = require('../eval/baselines/judge/rubric.js');

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

function config() {
  return {
    schema: 'belliedmonkey.llm-judge.config.v1',
    seed: 11,
    temperature: 0,
    sampleCount: 0,
    maxItems: 4,
    timeoutMs: 1000,
    maxRetries: 0,
    budgetUsd: 5,
    inputBound: { kind: 'utf8-bytes-plus-overhead', overheadTokens: 0 },
    judges: [
      { id: 'judge-a', model: 'model-alpha', endpointEnv: 'JUDGE_A_URL', keyEnv: 'JUDGE_A_KEY' },
      { id: 'judge-b', model: 'model-beta', endpointEnv: 'JUDGE_B_URL', keyEnv: 'JUDGE_B_KEY' },
    ],
    prices: {
      schema: 'belliedmonkey.llm-judge.prices.v1',
      source: 'fixture-price-table',
      sourceVersion: 'test-1',
      maxInputTokens: 4000,
      maxOutputTokens: 800,
      maxTotalTokens: 20000,
      maxRequests: 8,
      models: {
        'model-alpha': { inputUsdPerToken: 0.00001, outputUsdPerToken: 0.00002, pricedZero: false },
        'model-beta': { inputUsdPerToken: 0.00001, outputUsdPerToken: 0.00002, pricedZero: false },
      },
    },
  };
}

function env() {
  return {
    JUDGE_A_URL: 'https://example.test/a',
    JUDGE_A_KEY: 'secret-a',
    JUDGE_B_URL: 'https://example.test/b',
    JUDGE_B_KEY: 'secret-b',
  };
}

function input() {
  return {
    schema: 'belliedmonkey.llm-judge.input.v1',
    task: 'asr',
    items: [
      item('en_us/1668', 'the cat sat', 'the cat sat', 'the dog sat'),
      item('cmn_hans_cn/1673', '一只鸟', '一只鸟', '一架飞机'),
    ],
  };
}

function reply(finishReason, content, usage) {
  return {
    content: content,
    finishReason: finishReason,
    providerUsd: 0,
    usage: usage || { prompt_tokens: 10, completion_tokens: 5, usd: 0 },
  };
}

function legal(id) {
  return JSON.stringify({
    schema: 'belliedmonkey.llm-judge.verdict.v2',
    itemId: id,
    slots: [
      { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'why', findings: [] },
      { slot: 'slot-2', abstain: true, confidence: 0.2, note: 'why', findings: [] },
    ],
  });
}

describe('llm judge error observation and supplement selection', () => {
  test('finish reason, usage, and parse failure stay separate', async () => {
    eq(promptTemplateSha256(), 'a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923');
    eq(FROZEN_V1_SHA256, 'a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6');
    const seen = [];
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: input(),
      config: config(),
      env: env(),
      transport: async (req) => {
        seen.push(req.judgeId + ':' + req.messages[1].content);
        const id = req.messages[1].content.indexOf('1673') !== -1 ? 'cmn_hans_cn/1673' : 'en_us/1668';
        if (req.judgeId === 'judge-a' && id === 'en_us/1668') return reply('stop', '{');
        if (req.judgeId === 'judge-b' && id === 'en_us/1668') return reply('length', '{');
        if (req.judgeId === 'judge-a' && id === 'cmn_hans_cn/1673') {
          return reply('stop', JSON.stringify({
            schema: 'belliedmonkey.llm-judge.verdict.v2',
            itemId: id,
            slots: [
              { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'why', findings: [] },
              { slot: 'slot-2', abstain: true, confidence: 0.2, findings: [] },
            ],
          }));
        }
        return reply('stop', JSON.stringify({
          schema: 'belliedmonkey.llm-judge.verdict.v2',
          itemId: id,
          slots: [
            { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'why', findings: [] },
            {
              slot: 'slot-2',
              abstain: false,
              confidence: 0.4,
              note: '',
              findings: [{ kind: 'semantic', refQuote: '不在原文', hypQuote: '不在候选', reason: 'miss' }],
            },
          ],
        }));
      },
    });
    const stop = summary.usage.calls.filter((row) => row.finishReason === 'stop' && row.parseCode === 'bad-json')[0];
    eq(stop.usageComplete, true);
    eq(stop.generationOk, true);
    eq(stop.modelFormatFault, true);
    eq(stop.ok, false);
    const length = summary.usage.calls.filter((row) => row.finishReason === 'length')[0];
    eq(length.modelFormatFault, false);
    eq(length.generationOk, true);
    const missing = summary.usage.calls.filter((row) => row.parseCode === 'note')[0];
    eq(missing.modelFormatFault, false);
    eq(missing.usageComplete, true);
    const quote = summary.usage.calls.filter((row) => row.parseCode === 'quote')[0];
    eq(quote.modelFormatFault, false);
    eq(quote.ok, false);
    eq(seen.length, 4);
  });

  test('a provider error with no token usage stops and is not a format fault', async () => {
    const seen = [];
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: input(),
      config: config(),
      env: env(),
      transport: async () => {
        seen.push(1);
        return { content: '{"slots":', finishReason: 'error', providerUsd: 0, providerError: { message: 'incomplete' }, usage: {} };
      },
    });
    eq(seen.length, 1);
    eq(summary.code, 'budget-unknown');
    eq(summary.usage.calls[0].modelFormatFault, false);
    eq(summary.usage.calls[0].providerError, true);
    eq(summary.usage.calls[0].usageComplete, false);
    eq(summary.usage.calls[0].generationOk, false);
    eq(summary.usage.calls[0].parseCode, 'bad-json');
    eq(summary.usage.costUnknown, true);
    eq(summary.usage.spentUsd > 0, true);
  });

  test('an allowlist calls only those pairs and keeps the full assignment', async () => {
    const full = await runJudge({
      synthetic: true,
      input: input(),
      config: config(),
    });
    const selection = {
      schema: 'belliedmonkey.llm-judge.selection.v1',
      pairs: [{ itemId: 'cmn_hans_cn/1673', judgeId: 'judge-b' }],
    };
    const originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-origin-'));
    fs.writeFileSync(path.join(originDir, 'summary.json'), JSON.stringify({ code: 'partial', official: true }) + '\n');
    const originBefore = crypto.createHash('sha256').update(fs.readFileSync(path.join(originDir, 'summary.json'))).digest('hex');
    const inputSha = crypto.createHash('sha256').update(JSON.stringify(input()), 'utf8').digest('hex');
    const originLock = {
      schema: 'belliedmonkey.llm-judge.origin-lock.v1',
      summarySha256: originBefore,
      assignmentSha256: assignmentDigest(11, full.assignment.items),
      inputSha256: inputSha,
      promptTemplateSha256: promptTemplateSha256(),
      seed: 11,
      models: { 'judge-a': 'model-alpha', 'judge-b': 'model-beta' },
      failedPairs: [{ itemId: 'cmn_hans_cn/1673', judgeId: 'judge-b' }],
      succeededPairs: [
        { itemId: 'en_us/1668', judgeId: 'judge-a' },
        { itemId: 'en_us/1668', judgeId: 'judge-b' },
        { itemId: 'cmn_hans_cn/1673', judgeId: 'judge-a' },
      ],
    };
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-supp-'));
    let calls = 0;
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: input(),
      config: config(),
      selection: selection,
      origin: originDir,
      originLock: originLock,
      inputSha256: inputSha,
      out: out,
      env: env(),
      transport: async (req) => {
        calls += 1;
        eq(req.judgeId, 'judge-b');
        return reply('stop', legal('cmn_hans_cn/1673'));
      },
    });
    eq(calls, 1);
    eq(JSON.stringify(summary.assignment.items), JSON.stringify(full.assignment.items));
    eq(summary.code, 'supplement-complete');
    eq(summary.singleRunComplete, false);
    eq(summary.doubleBlindComplete, false);
    eq(summary.supplementComplete, true);
    eq(summary.provenance.selectionSha256.length, 64);
    eq(summary.provenance.originSummarySha256, originBefore);
    eq(summary.provenance.promptTemplateSha256, promptTemplateSha256());
    const after = crypto.createHash('sha256').update(fs.readFileSync(path.join(originDir, 'summary.json'))).digest('hex');
    eq(after, originBefore);
    const supplement = JSON.parse(fs.readFileSync(path.join(out, 'supplement.json'), 'utf8'));
    eq(supplement.official, false);
    eq(supplement.pairs.length, 1);
    const derived = JSON.parse(fs.readFileSync(path.join(out, 'derived-merge.json'), 'utf8'));
    eq(derived.singleRunComplete, false);
    eq(derived.originSingleRunComplete, false);
    eq(derived.supplementComplete, true);
    eq(derived.doubleBlindComplete, false);
    eq(derived.pairs.length, 4);
    eq(derived.pairs.filter((row) => row.source === 'origin').length, 3);
    eq(derived.pairs.filter((row) => row.source === 'supplement' && row.verdict).length, 1);
    eq(derived.coverage.cherryPick, false);
  });
});
