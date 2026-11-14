'use strict';

// Focused offline re-check of the chars/4 residual fix. No CLI --run, no secrets, no network.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const PREP = '/workspace/baseline-sa-sv-36-20261113/judge-prep';
const VER = path.join(PREP, 'verify-8ddf6e8e');
const PKG = path.join(VER, 'pkg-unpacked');
const { runJudge } = require(path.join(PKG, 'run-judge.js'));
const { validateConfig } = require(path.join(PKG, 'schema.js'));
const { buildPrompt } = require(path.join(PKG, 'prompt.js'));
const { assignItems } = require(path.join(PKG, 'assign.js'));
const { requestBody, checkRequest } = require(path.join(PKG, 'input-bound.js'));

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function money(n) { return Math.round(n * 1e9) / 1e9; }

const results = [];
function rec(row) { results.push(row); }

const frozenInput = path.join(PREP, 'input-asr-36.json');
const FROZEN = {
  input: '1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1',
  pair: '2e5d95d1b61e16f9e0b3506f3e949b94c9717d577e1cc8c41fe72e3b6e221bb7',
  map: '0267f1078c98a2a0cdfde35b9cefeb7699db281a9f2870123c453c72c97e841a',
  parentSums: '3bea1b09fd43f9b0899b9c2d3bbd9339fa734aa20b9497c75f8f8e2047e8df30',
};

const fixtureItem = {
  id: 'fixture-1',
  reference: 'the cat sat',
  candidates: [
    { key: 'arm-a', text: 'the cat sat' },
    { key: 'arm-b', text: 'the dog sat' },
  ],
};
const twoItems = {
  schema: 'belliedmonkey.llm-judge.input.v1',
  task: 'asr',
  items: [
    fixtureItem,
    { id: 'fixture-2', reference: 'there were 3 apples', candidates: [ { key: 'arm-a', text: 'there were three apples' }, { key: 'arm-b', text: 'there were 5 apples' } ] },
  ],
};
writeJson(path.join(VER, 'fixtures/synthetic-two-items.json'), twoItems);

function prices(maxInput, maxOutput) {
  return {
    schema: 'belliedmonkey.llm-judge.prices.v1',
    source: 'SYNTHETIC_STRUCTURAL_NOT_A_QUOTE',
    sourceVersion: 'fixture-only-not-a-real-price',
    maxInputTokens: maxInput,
    maxOutputTokens: maxOutput,
    maxTotalTokens: Math.max(200000, (maxInput + maxOutput) * 72),
    maxRequests: 72,
    models: {
      MODEL_X: { inputUsdPerToken: 0.000001, outputUsdPerToken: 0.000002, pricedZero: false },
      MODEL_Y: { inputUsdPerToken: 0.000001, outputUsdPerToken: 0.000002, pricedZero: false },
    },
  };
}

function configOf(extra) {
  const cfg = {
    schema: 'belliedmonkey.llm-judge.config.v1',
    seed: 7,
    temperature: 0,
    sampleCount: 1,
    maxItems: 36,
    timeoutMs: 50,
    maxRetries: 0,
    budgetUsd: 1,
    judges: [
      { id: 'judge-a', model: 'MODEL_X', endpointEnv: 'JUDGE_A_URL', keyEnv: 'JUDGE_A_KEY' },
      { id: 'judge-b', model: 'MODEL_Y', endpointEnv: 'JUDGE_B_URL', keyEnv: 'JUDGE_B_KEY' },
    ],
    prices: prices(438, 800),
    inputBound: { kind: 'counter' },
  };
  return Object.assign(cfg, extra || {});
}

const fakeEnv = {
  JUDGE_A_URL: 'http://127.0.0.1:9/unused',
  JUDGE_A_KEY: 'fake-not-a-secret',
  JUDGE_B_URL: 'http://127.0.0.1:9/unused',
  JUDGE_B_KEY: 'fake-not-a-secret',
};

function verdict(item) {
  return JSON.stringify({
    schema: 'belliedmonkey.llm-judge.verdict.v1',
    itemId: item.id,
    slots: [
      { slot: 'slot-1', abstain: true, confidence: 0.2, note: 'fixture abstain', findings: [] },
      { slot: 'slot-2', abstain: true, confidence: 0.2, note: 'fixture abstain', findings: [] },
    ],
  });
}

function itemFromReq(req, items) {
  return items.find((it) => req.messages[1].content.indexOf(it.id) !== -1) || items[0];
}

async function libRun(label, input, config, transport, countTokens) {
  const out = path.join(VER, 'lib-runs', label);
  fs.rmSync(out, { recursive: true, force: true });
  const summary = await runJudge({
    input: input,
    config: config,
    out: out,
    run: true,
    synthetic: true,
    env: fakeEnv,
    transport: transport,
    countTokens: countTokens,
  });
  return { out: out, summary: summary };
}

function cli(args) {
  return spawnSync('node', [path.join(PKG, 'run-judge.js'), ...args], {
    cwd: VER,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TERM: 'dumb' },
    timeout: 20000,
  });
}

function expectedReserve(maxIn, maxOut, inRate, outRate) {
  return money(maxIn * inRate + maxOut * outRate);
}

async function main() {
  rec({
    id: 'frozen-pins-before',
    pass: sha256File(frozenInput) === FROZEN.input
      && sha256File(path.join(PREP, 'pair-manifest.json')) === FROZEN.pair
      && sha256File(path.join(PREP, 'arm-mapping.json')) === FROZEN.map
      && sha256File(path.join(PREP, 'SHA256SUMS')) === FROZEN.parentSums,
  });

  const prompt = buildPrompt(fixtureItem, assignItems([fixtureItem], 7)[0]);
  const contentChars = prompt.messages.map((m) => m.content).join('').length;
  const probe = {
    model: 'MODEL_X',
    temperature: 0,
    seed: 7,
    maxTokens: 800,
    messages: prompt.messages,
  };
  const body = requestBody(probe);
  const parsedBody = JSON.parse(body);
  const utf8Bytes = Buffer.byteLength(body, 'utf8');
  const charsDiv4 = Math.ceil(contentChars / 4);
  writeJson(path.join(VER, 'fixtures/original-prompt-measure.json'), {
    contentJoinChars: contentChars,
    expectedOriginalChars: 1751,
    charsDiv4: charsDiv4,
    requestBodyUtf8Bytes: utf8Bytes,
    requestBodyKeys: Object.keys(parsedBody),
    hasSystem: parsedBody.messages[0] && parsedBody.messages[0].role === 'system',
    hasUser: parsedBody.messages[1] && parsedBody.messages[1].role === 'user',
    userIsJson: (() => { try { JSON.parse(parsedBody.messages[1].content); return true; } catch (e) { return false; } })(),
    includesMaxTokens: parsedBody.max_tokens === 800,
    bodyLongerThanContentJoin: utf8Bytes > contentChars,
    note: 'STRUCTURAL MEASUREMENT ONLY. utf8 bytes are not a model tokenizer count.',
  });
  rec({
    id: 'reproduced-original-1751-content-chars',
    pass: contentChars === 1751 && charsDiv4 === 438 && utf8Bytes > 1751
      && parsedBody.messages.length === 2
      && parsedBody.messages[0].role === 'system'
      && parsedBody.messages[1].role === 'user'
      && typeof parsedBody.messages[1].content === 'string'
      && parsedBody.max_tokens === 800,
    observed: { contentChars: contentChars, charsDiv4: charsDiv4, utf8Bytes: utf8Bytes },
  });

  // Missing inputBound: no send, plan left
  const noBound = validateConfig(configOf({ inputBound: undefined }));
  // validateConfig with missing field: we need to actually omit the key
  const cfgNoBound = configOf();
  delete cfgNoBound.inputBound;
  const noBoundCheck = validateConfig(cfgNoBound);
  writeJson(path.join(VER, 'fixtures/missing-inputBound-validate.json'), noBoundCheck);
  const noBoundRun = await libRun('missing-inputBound', twoItems, cfgNoBound, async () => { throw new Error('should-not-send'); });
  rec({
    id: 'missing-inputBound-does-not-send',
    pass: noBoundCheck.ok === false && noBoundCheck.code === 'tokenizer-unspecified'
      && noBoundRun.summary.called === false
      && noBoundRun.summary.code === 'tokenizer-unspecified'
      && noBoundRun.summary.results === null,
    observed: { validate: noBoundCheck.code, run: noBoundRun.summary.code, called: noBoundRun.summary.called, planWritten: fs.existsSync(path.join(noBoundRun.out, 'plan.json')) },
    note: 'Invalid config exits before plan persist. That does not send. Budget/bound failures after a valid config do write plan.json.',
  });

  // counter kind without a function: tokenizer-unspecified, no send, plan left
  let nNoFn = 0;
  const noFn = await libRun('counter-without-function', twoItems, configOf(), async () => {
    nNoFn += 1;
    throw new Error('should-not-send');
  });
  writeJson(path.join(VER, 'fixtures/counter-without-function-result.json'), {
    nCalls: nNoFn, code: noFn.summary.code, called: noFn.summary.called,
    planExists: fs.existsSync(path.join(noFn.out, 'plan.json')),
    inputChecks: noFn.summary.plan && noFn.summary.plan.inputChecks,
  });
  rec({
    id: 'counter-without-function-does-not-send',
    pass: nNoFn === 0 && noFn.summary.called === false && noFn.summary.code === 'tokenizer-unspecified'
      && fs.existsSync(path.join(noFn.out, 'plan.json')),
    observed: { nCalls: nNoFn, code: noFn.summary.code, called: noFn.summary.called },
  });

  // Original fixture: maxInput=438, counter reports 488 (the old leaked usage). Must not send. Reserve in plan is full 438+800.
  const reserve438 = expectedReserve(438, 800, 0.000001, 0.000002);
  let nOld = 0;
  const oldFix = await libRun('original-488-over-438-bound', twoItems, configOf({ budgetUsd: 1, prices: prices(438, 800), inputBound: { kind: 'counter' } }), async () => {
    nOld += 1;
    throw new Error('should-not-send');
  }, function countTokens() { return 488; });
  const oldPlan = oldFix.summary.plan;
  writeJson(path.join(VER, 'fixtures/original-488-over-438-bound-result.json'), {
    nCalls: nOld,
    code: oldFix.summary.code,
    called: oldFix.summary.called,
    results: oldFix.summary.results,
    reserveTokens: oldPlan && oldPlan.reserveTokens,
    reserveUsd: oldPlan && oldPlan.prices && oldPlan.prices.reserveUsd,
    expectedReserveUsd: reserve438,
    inputChecks: oldPlan && oldPlan.inputChecks,
    planExists: fs.existsSync(path.join(oldFix.out, 'plan.json')),
    requestDirExists: fs.existsSync(path.join(oldFix.out, 'requests')),
    note: 'SYNTHETIC counter returning 488. Not a real tokenizer. Previously chars/4=438 allowed this send.',
  });
  rec({
    id: 'original-1751-488-no-longer-underestimates-or-sends',
    pass: contentChars === 1751 && nOld === 0 && oldFix.summary.called === false
      && oldFix.summary.code === 'input-over-bound'
      && oldPlan.reserveTokens === 438 + 800
      && oldPlan.prices.reserveUsd[0].usd === reserve438
      && fs.existsSync(path.join(oldFix.out, 'plan.json'))
      && !fs.existsSync(path.join(oldFix.out, 'requests'))
      && oldPlan.inputChecks && oldPlan.inputChecks[0].declaredTokens === 488
      && oldPlan.inputChecks[0].ok === false,
    observed: {
      nCalls: nOld,
      code: oldFix.summary.code,
      reserveTokens: oldPlan && oldPlan.reserveTokens,
      reserveUsd: oldPlan && oldPlan.prices && oldPlan.prices.reserveUsd,
      declaredTokens: oldPlan && oldPlan.inputChecks && oldPlan.inputChecks[0] && oldPlan.inputChecks[0].declaredTokens,
    },
  });

  // Same cap with utf8-bytes-plus-overhead 0: bound is full request body, should also refuse 438.
  const utf8Check = checkRequest(probe, { maxInputTokens: 438 }, { kind: 'utf8-bytes-plus-overhead', overheadTokens: 0 }, null);
  writeJson(path.join(VER, 'fixtures/utf8-bound-vs-438.json'), {
    utf8Bytes: utf8Check.utf8Bytes,
    declaredTokens: utf8Check.declaredTokens,
    code: utf8Check.code,
    ok: utf8Check.ok,
    exact: utf8Check.exact,
    maxInputTokens: 438,
    note: 'SYNTHETIC utf8-bytes-plus-overhead with overhead 0. Not a real model tokenizer.',
  });
  let nUtf = 0;
  const utfRun = await libRun('utf8-bound-vs-438', twoItems, configOf({
    prices: prices(438, 800),
    inputBound: { kind: 'utf8-bytes-plus-overhead', overheadTokens: 0 },
  }), async () => { nUtf += 1; throw new Error('should-not-send'); });
  rec({
    id: 'utf8-full-body-bound-blocks-old-438-cap',
    pass: utf8Check.ok === false && utf8Check.exact === false && utf8Check.declaredTokens === utf8Bytes
      && utf8Bytes > 438 && nUtf === 0 && utfRun.summary.called === false
      && utfRun.summary.code === 'input-over-bound'
      && fs.existsSync(path.join(utfRun.out, 'plan.json')),
    observed: { utf8Bytes: utf8Check.utf8Bytes, declaredTokens: utf8Check.declaredTokens, nCalls: nUtf, code: utfRun.summary.code },
  });

  // If a loose counter lets the request through, over-cap usage keeps reserve and stops.
  const looseCfg = configOf({
    prices: prices(438, 800),
    inputBound: { kind: 'counter' },
    budgetUsd: 1,
  });
  let nLoose = 0;
  const loose = await libRun('provider-exceeded-declared-cap', twoItems, looseCfg, async (req) => {
    nLoose += 1;
    return {
      content: verdict(itemFromReq(req, twoItems.items)),
      responseModel: req.model,
      usage: { prompt_tokens: 488, completion_tokens: 800 },
    };
  }, function countTokens() { return 400; });
  const looseCall = loose.summary.usage && loose.summary.usage.calls && loose.summary.usage.calls[0];
  writeJson(path.join(VER, 'fixtures/provider-exceeded-declared-cap-result.json'), {
    nCalls: nLoose,
    code: loose.summary.code,
    costUnknown: loose.summary.usage && loose.summary.usage.costUnknown,
    spentUsd: loose.summary.usage && loose.summary.usage.spentUsd,
    expectedReserve: reserve438,
    call: looseCall,
    note: 'SYNTHETIC loose counter (400) used only to reach the post-response guard. Not a real tokenizer.',
  });
  rec({
    id: 'provider-exceeded-declared-cap-keeps-reserve-and-stops',
    pass: nLoose === 1 && loose.summary.code === 'budget-unknown'
      && loose.summary.usage.costUnknown === true
      && loose.summary.usage.spentUsd === reserve438
      && looseCall && looseCall.providerExceededDeclaredCap === true
      && looseCall.settledUsd === null,
    observed: {
      nCalls: nLoose,
      code: loose.summary.code,
      spentUsd: loose.summary.usage && loose.summary.usage.spentUsd,
      reserve: reserve438,
      providerExceededDeclaredCap: looseCall && looseCall.providerExceededDeclaredCap,
    },
  });

  // Unknown usage fail-closed, plan kept
  let nMiss = 0;
  const miss = await libRun('missing-tokens-failclosed', twoItems, configOf({
    prices: prices(4000, 800),
    inputBound: { kind: 'counter' },
  }), async (req) => {
    nMiss += 1;
    return { content: verdict(itemFromReq(req, twoItems.items)), responseModel: req.model, usage: { usd: 0.5 } };
  }, function countTokens() { return 100; });
  writeJson(path.join(VER, 'fixtures/missing-tokens-failclosed-result.json'), {
    nCalls: nMiss, code: miss.summary.code, costUnknown: miss.summary.usage && miss.summary.usage.costUnknown,
    planExists: fs.existsSync(path.join(miss.out, 'plan.json')),
  });
  rec({
    id: 'unknown-usage-failclosed-plan-kept',
    pass: nMiss === 1 && miss.summary.code === 'budget-unknown' && miss.summary.usage.costUnknown === true
      && fs.existsSync(path.join(miss.out, 'plan.json')),
    observed: { nCalls: nMiss, code: miss.summary.code },
  });

  // Budget insufficient: no send, plan still left
  const tightReserve = expectedReserve(4000, 800, 0.000001, 0.000002);
  let nTight = 0;
  const tight = await libRun('budget-blocked-plan-kept', twoItems, configOf({
    budgetUsd: 0.0001,
    prices: prices(4000, 800),
    inputBound: { kind: 'counter' },
  }), async () => { nTight += 1; throw new Error('should-not-send'); }, function countTokens() { return 100; });
  writeJson(path.join(VER, 'fixtures/budget-blocked-plan-kept-result.json'), {
    nCalls: nTight, code: tight.summary.code, called: tight.summary.called,
    reserve: tightReserve, budgetUsd: 0.0001,
    planExists: fs.existsSync(path.join(tight.out, 'plan.json')),
    planReserveUsd: tight.summary.plan && tight.summary.plan.prices && tight.summary.plan.prices.reserveUsd,
  });
  rec({
    id: 'budget-blocked-still-writes-plan',
    pass: nTight === 0 && tight.summary.code === 'budget-blocked' && tight.summary.called === false
      && tightReserve > 0.0001 && fs.existsSync(path.join(tight.out, 'plan.json')),
    observed: { nCalls: nTight, code: tight.summary.code, reserve: tightReserve, plan: true },
  });

  // maxRetries must be 0
  const retryBad = validateConfig(configOf({ maxRetries: 2, inputBound: { kind: 'counter' } }));
  const retryOk = validateConfig(configOf({ maxRetries: 0, inputBound: { kind: 'counter' } }));
  writeJson(path.join(VER, 'fixtures/maxRetries-forced-zero.json'), { retry2: retryBad, retry0: { ok: retryOk.ok, maxRetries: retryOk.maxRetries } });
  rec({
    id: 'maxRetries-forced-zero',
    pass: retryBad.ok === false && retryBad.code === 'retries-disabled' && retryOk.ok === true && retryOk.maxRetries === 0,
    observed: { retry2: retryBad.code, retry0: retryOk.ok },
  });

  // 36 dry-run with structural (not real) bound/price; do not modify frozen input
  const realInput = readJson(frozenInput);
  const realStats = realInput.items.map((item) => {
    const row = assignItems([item], 20261113)[0];
    const p = buildPrompt(item, row);
    const req = { model: 'REPLACE_MODEL_A', temperature: 0, seed: 20261113, maxTokens: 800, messages: p.messages };
    const b = requestBody(req);
    return { id: item.id, contentJoinChars: p.messages.map((m) => m.content).join('').length, utf8Bytes: Buffer.byteLength(b, 'utf8') };
  });
  const maxUtf8 = Math.max.apply(null, realStats.map((r) => r.utf8Bytes));
  const maxJoin = Math.max.apply(null, realStats.map((r) => r.contentJoinChars));
  writeJson(path.join(VER, 'fixtures/real36-structural-body-sizes.json'), {
    itemCount: realStats.length,
    maxContentJoinChars: maxJoin,
    maxRequestBodyUtf8Bytes: maxUtf8,
    items: realStats,
    note: 'STRUCTURAL utf8 byte sizes of the packaged request body. Not tokenizer counts and not a real config.',
  });

  const dryCfg = {
    schema: 'belliedmonkey.llm-judge.config.v1',
    seed: 20261113,
    temperature: 0,
    sampleCount: 6,
    maxItems: 36,
    timeoutMs: 20000,
    maxRetries: 0,
    budgetUsd: 1,
    judges: [
      { id: 'judge-a', model: 'REPLACE_MODEL_A', endpointEnv: 'JUDGE_A_URL', keyEnv: 'JUDGE_A_KEY' },
      { id: 'judge-b', model: 'REPLACE_MODEL_B', endpointEnv: 'JUDGE_B_URL', keyEnv: 'JUDGE_B_KEY' },
    ],
    prices: {
      schema: 'belliedmonkey.llm-judge.prices.v1',
      source: 'SYNTHETIC_STRUCTURAL_NOT_A_QUOTE',
      sourceVersion: 'dryrun-structure-only',
      maxInputTokens: Math.max(4000, maxUtf8),
      maxOutputTokens: 800,
      maxTotalTokens: Math.max(200000, (Math.max(4000, maxUtf8) + 800) * 72),
      maxRequests: 72,
      models: {
        REPLACE_MODEL_A: { inputUsdPerToken: 0.000001, outputUsdPerToken: 0.000002, pricedZero: false },
        REPLACE_MODEL_B: { inputUsdPerToken: 0.000001, outputUsdPerToken: 0.000002, pricedZero: false },
      },
    },
    inputBound: { kind: 'utf8-bytes-plus-overhead', overheadTokens: 0 },
  };
  writeJson(path.join(VER, 'config.dryrun-structural-not-a-quote.json'), Object.assign({}, dryCfg, {
    _comment_not_in_schema_skip: undefined,
  }));
  // The config file must not include unknown fields
  const dryCfgFile = {
    schema: dryCfg.schema,
    seed: dryCfg.seed,
    temperature: dryCfg.temperature,
    sampleCount: dryCfg.sampleCount,
    maxItems: dryCfg.maxItems,
    timeoutMs: dryCfg.timeoutMs,
    maxRetries: 0,
    budgetUsd: dryCfg.budgetUsd,
    judges: dryCfg.judges,
    prices: dryCfg.prices,
    inputBound: dryCfg.inputBound,
  };
  writeJson(path.join(VER, 'config.dryrun-structural-not-a-quote.json'), dryCfgFile);
  writeJson(path.join(VER, 'config.NOT-A-REAL-CONFIG.txt'), [
    'config.dryrun-structural-not-a-quote.json is a structural dry-run fixture only.',
    'REPLACE_* names, SYNTHETIC_STRUCTURAL_NOT_A_QUOTE prices, and utf8-bytes-plus-overhead with overhead 0 are not a selected gateway, model, tokenizer, or price list.',
    'Do not treat this file as official run configuration.',
  ].join('\n') + '\n');

  const realOut = path.join(VER, 'dryrun-real36');
  fs.rmSync(realOut, { recursive: true, force: true });
  const realCli = cli([
    '--input', frozenInput,
    '--config', path.join(VER, 'config.dryrun-structural-not-a-quote.json'),
    '--out', realOut,
  ]);
  const realSum = realCli.stdout ? JSON.parse(realCli.stdout) : null;
  writeJson(path.join(VER, 'fixtures/cli-dryrun-real36.meta.json'), {
    status: realCli.status,
    stderr: realCli.stderr,
    code: realSum && realSum.code,
    called: realSum && realSum.called,
    synthetic: realSum && realSum.synthetic,
    results: realSum && realSum.results,
    itemCount: realSum && realSum.plan && realSum.plan.itemIds && realSum.plan.itemIds.length,
    inputBound: realSum && realSum.plan && realSum.plan.inputBound,
    reserveTokens: realSum && realSum.plan && realSum.plan.reserveTokens,
    invokedRunFlag: false,
    realLlmCalled: false,
    configIsStructuralOnly: true,
  });
  rec({
    id: 'dryrun-real36',
    pass: realCli.status === 0 && realSum && realSum.code === 'dry-run' && realSum.called === false
      && realSum.synthetic === false && realSum.results === null
      && realSum.plan.itemIds.length === 36
      && !fs.existsSync(path.join(realOut, 'requests')),
    observed: {
      status: realCli.status,
      code: realSum && realSum.code,
      called: realSum && realSum.called,
      synthetic: realSum && realSum.synthetic,
      nIds: realSum && realSum.plan && realSum.plan.itemIds && realSum.plan.itemIds.length,
    },
  });

  rec({
    id: 'frozen-pins-after',
    pass: sha256File(frozenInput) === FROZEN.input
      && sha256File(path.join(PREP, 'pair-manifest.json')) === FROZEN.pair
      && sha256File(path.join(PREP, 'arm-mapping.json')) === FROZEN.map
      && sha256File(path.join(PREP, 'SHA256SUMS')) === FROZEN.parentSums,
  });

  const out = {
    builtAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) + ' +0800 (Asia/Shanghai)',
    packageHead: '8ddf6e8e4d823018c2e6c5b56067b7238a8bdc22',
    realLlmCalled: false,
    cliRunFlagUsed: false,
    processEnvSecretsRead: false,
    network: false,
    results: results,
    passed: results.filter((r) => r.pass === true).map((r) => r.id),
    failed: results.filter((r) => r.pass === false).map((r) => r.id),
  };
  writeJson(path.join(VER, 'reverify-results.json'), out);
  console.log(JSON.stringify({ passed: out.passed, failed: out.failed, n: results.length, contentChars: contentChars, utf8Bytes: utf8Bytes }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
