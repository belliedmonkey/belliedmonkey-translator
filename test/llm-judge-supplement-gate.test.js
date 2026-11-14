'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { describe, test, eq } = require('./harness');
const { runJudge, main, assignmentDigest } = require('../eval/baselines/judge/run-judge.js');
const { assignItems } = require('../eval/baselines/judge/assign.js');
const { promptTemplateSha256, FROZEN_V1_SHA256 } = require('../eval/baselines/judge/rubric.js');

const PARENT_SELECTION = 'c151018bfda2953d2375f8cfce25580787745f162824b66f2d7eccec641979a4';

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function item(id) {
  return {
    id: id,
    reference: 'the cat sat',
    candidates: [
      { key: 'arm-a', text: 'the cat sat' },
      { key: 'arm-b', text: 'the dog sat' },
    ],
  };
}

function config(extra) {
  return Object.assign({
    schema: 'belliedmonkey.llm-judge.config.v1',
    seed: 11,
    temperature: 0,
    sampleCount: 0,
    maxItems: 36,
    timeoutMs: 1000,
    maxRetries: 0,
    budgetUsd: 20,
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
      maxTotalTokens: 200000,
      maxRequests: 72,
      models: {
        'model-alpha': { inputUsdPerToken: 0.00001, outputUsdPerToken: 0.00002, pricedZero: false },
        'model-beta': { inputUsdPerToken: 0.00001, outputUsdPerToken: 0.00002, pricedZero: false },
      },
    },
  }, extra || {});
}

function env() {
  return {
    JUDGE_A_URL: 'https://example.test/a',
    JUDGE_A_KEY: 'secret-a',
    JUDGE_B_URL: 'https://example.test/b',
    JUDGE_B_KEY: 'secret-b',
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

function reply(content) {
  return { content: content, finishReason: 'stop', providerUsd: 0, usage: { prompt_tokens: 10, completion_tokens: 5, usd: 9 } };
}

function world(n) {
  const input = {
    schema: 'belliedmonkey.llm-judge.input.v1',
    task: 'asr',
    items: [],
  };
  for (let i = 0; i < n; i++) input.items.push(item('fixture-' + String(i + 1).padStart(2, '0')));
  const cfg = config();
  const assigned = assignItems(input.items, cfg.seed);
  const inputSha = sha(JSON.stringify(input));
  const originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-origin-'));
  const summaryBody = JSON.stringify({ code: 'partial', official: true, singleRunComplete: false, doubleBlindComplete: false }) + '\n';
  fs.writeFileSync(path.join(originDir, 'summary.json'), summaryBody);
  const summarySha = sha(fs.readFileSync(path.join(originDir, 'summary.json')));
  const failed = input.items.map((row) => ({ itemId: row.id, judgeId: 'judge-a' }));
  const succeeded = input.items.map((row) => ({ itemId: row.id, judgeId: 'judge-b' }));
  const lock = {
    schema: 'belliedmonkey.llm-judge.origin-lock.v1',
    summarySha256: summarySha,
    assignmentSha256: assignmentDigest(cfg.seed, assigned),
    inputSha256: inputSha,
    promptTemplateSha256: promptTemplateSha256(),
    seed: cfg.seed,
    models: { 'judge-a': 'model-alpha', 'judge-b': 'model-beta' },
    failedPairs: failed,
    succeededPairs: succeeded,
  };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-out-'));
  fs.writeFileSync(path.join(out, 'keep.txt'), 'stay');
  return { input: input, cfg: cfg, assigned: assigned, inputSha: inputSha, originDir: originDir, summarySha: summarySha, lock: lock, out: out, failed: failed, succeeded: succeeded };
}

function untouched(dir, originSha) {
  eq(sha(fs.readFileSync(path.join(dir.originDir, 'summary.json'))), originSha);
  eq(fs.readFileSync(path.join(dir.out, 'keep.txt'), 'utf8'), 'stay');
}

describe('llm judge supplement refuses before any request', () => {
  test('the runner does not hardcode the parent selection digest', () => {
    eq(promptTemplateSha256(), 'a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923');
    eq(FROZEN_V1_SHA256, 'a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6');
    const src = fs.readFileSync(path.join(__dirname, '../eval/baselines/judge/run-judge.js'), 'utf8');
    eq(src.indexOf(PARENT_SELECTION), -1);
  });

  test('a selection that includes an origin success is not sent', async () => {
    const box = world(2);
    let calls = 0;
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.succeeded[0]] },
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: box.out,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(summary.code, 'selection-not-failed');
    eq(summary.called, false);
    eq(calls, 0);
    untouched(box, box.summarySha);
  });

  test('run with a selection and no origin is not sent', async () => {
    const box = world(1);
    const out = path.join(os.tmpdir(), 'judge-missing-out-' + process.pid);
    let calls = 0;
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.failed[0]] },
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: out,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(summary.code, 'origin-required');
    eq(calls, 0);
    eq(fs.existsSync(out), false);
    eq(sha(fs.readFileSync(path.join(box.originDir, 'summary.json'))), box.summarySha);
  });

  test('a summary that is not the pinned origin is not sent', async () => {
    const box = world(1);
    box.lock.summarySha256 = sha('other-summary');
    let calls = 0;
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.failed[0]] },
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: box.out,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(summary.code, 'origin-hash');
    eq(calls, 0);
    untouched(box, box.summarySha);
  });

  test('a changed seed or a swapped assignment is not sent', async () => {
    const box = world(2);
    const changed = config({ seed: 99 });
    let calls = 0;
    const seeded = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: changed,
      selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.failed[0]] },
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: box.out,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(seeded.code, 'seed-mismatch');
    eq(calls, 0);
    const swapped = box.assigned.map((row, index) => {
      if (index !== 0) return row;
      return { id: row.id, slots: { 'slot-1': row.slots['slot-2'], 'slot-2': row.slots['slot-1'] } };
    });
    box.lock.assignmentSha256 = assignmentDigest(box.cfg.seed, swapped);
    const slots = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.failed[0]] },
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: box.out,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(slots.code, 'assignment-mismatch');
    eq(calls, 0);
    untouched(box, box.summarySha);
  });

  test('out that is the origin, a symlink, or a nested alias is not written', async () => {
    const box = world(1);
    const selection = { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.failed[0]] };
    let calls = 0;
    const same = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: selection,
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: box.originDir,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(same.code, 'out-is-origin');
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-alias-'));
    const link = path.join(linkDir, 'alias');
    fs.symlinkSync(box.originDir, link);
    const aliased = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: selection,
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: link,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(aliased.code, 'out-is-origin');
    const nested = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: selection,
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: path.join(box.originDir, 'nested'),
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(nested.code, 'out-is-origin');
    eq(fs.existsSync(path.join(box.originDir, 'nested')), false);
    const viaParent = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: selection,
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: path.join(box.originDir, '..', path.basename(box.originDir)),
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(viaParent.code, 'out-is-origin');
    eq(calls, 0);
    eq(sha(fs.readFileSync(path.join(box.originDir, 'summary.json'))), box.summarySha);
    eq(fs.readdirSync(box.originDir).length, 1);
    const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-holder-'));
    const inner = path.join(holder, 'origin');
    fs.mkdirSync(inner);
    fs.copyFileSync(path.join(box.originDir, 'summary.json'), path.join(inner, 'summary.json'));
    const parentOut = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: selection,
      origin: inner,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: holder,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(parentOut.code, 'out-is-origin');
    eq(fs.readdirSync(holder).join(','), 'origin');
    eq(calls, 0);
  });

  test('a non-empty out is not overwritten', async () => {
    const box = world(1);
    let calls = 0;
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.failed[0]] },
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: box.out,
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(summary.code, 'out-not-empty');
    eq(calls, 0);
    eq(fs.readdirSync(box.out).join(','), 'keep.txt');
    untouched(box, box.summarySha);
  });

  test('a summary that claims a complete double blind is not an origin', async () => {
    const box = world(1);
    const forged = JSON.stringify({ code: 'complete', singleRunComplete: true, doubleBlindComplete: true }) + '\n';
    fs.writeFileSync(path.join(box.originDir, 'summary.json'), forged);
    box.lock.summarySha256 = sha(forged);
    let calls = 0;
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.failed[0]] },
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: path.join(os.tmpdir(), 'judge-forged-out-' + process.pid),
      env: env(),
      transport: async () => { calls += 1; return reply(legal('fixture-01')); },
    });
    eq(summary.code, 'origin-not-partial');
    eq(calls, 0);
    eq(fs.readFileSync(path.join(box.originDir, 'summary.json'), 'utf8'), forged);
  });

  test('an invalid supplement stays null and does not replace the origin pair', async () => {
    const box = world(1);
    fs.rmSync(path.join(box.out, 'keep.txt'));
    let calls = 0;
    const summary = await runJudge({
      synthetic: true,
      run: true,
      input: box.input,
      config: box.cfg,
      selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [box.failed[0]] },
      origin: box.originDir,
      originLock: box.lock,
      inputSha256: box.inputSha,
      out: box.out,
      env: env(),
      transport: async () => {
        calls += 1;
        return reply('{');
      },
    });
    eq(calls, 1);
    eq(summary.code, 'supplement-partial');
    eq(summary.singleRunComplete, false);
    eq(summary.doubleBlindComplete, false);
    const derived = JSON.parse(fs.readFileSync(path.join(box.out, 'derived-merge.json'), 'utf8'));
    const supplement = derived.pairs.filter((row) => row.source === 'supplement')[0];
    const origin = derived.pairs.filter((row) => row.source === 'origin')[0];
    eq(supplement.verdict, null);
    eq(origin.originKept, true);
    eq(origin.verdict, null);
    eq(derived.singleRunComplete, false);
    eq(derived.coverage.cherryPick, false);
    eq(derived.coverage.derivedCoverageComplete, false);
    eq(sha(fs.readFileSync(path.join(box.originDir, 'summary.json'))), box.summarySha);
  });

  test('a synthetic selection of fifteen failed pairs sends exactly those fifteen', async () => {
    const box = world(15);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-fifteen-'));
    const inputPath = path.join(dir, 'input.json');
    const configPath = path.join(dir, 'config.json');
    const selectPath = path.join(dir, 'selection.json');
    const lockPath = path.join(dir, 'origin-lock.json');
    const out = path.join(dir, 'out');
    fs.mkdirSync(out);
    const inputBody = JSON.stringify(box.input);
    fs.writeFileSync(inputPath, inputBody);
    fs.writeFileSync(configPath, JSON.stringify(box.cfg));
    fs.writeFileSync(selectPath, JSON.stringify({
      schema: 'belliedmonkey.llm-judge.selection.v1',
      pairs: box.failed,
    }));
    box.lock.inputSha256 = sha(inputBody);
    fs.writeFileSync(lockPath, JSON.stringify(box.lock));
    let calls = 0;
    const summary = await main([
      '--run', '--synthetic',
      '--input', inputPath,
      '--config', configPath,
      '--select', selectPath,
      '--origin', box.originDir,
      '--origin-lock', lockPath,
      '--out', out,
    ], env(), async (req) => {
      calls += 1;
      eq(req.judgeId, 'judge-a');
      const id = box.input.items.filter((row) => req.messages[1].content.indexOf(row.id) !== -1)[0].id;
      return reply(legal(id));
    });
    eq(calls, 15);
    eq(summary.code, 'supplement-complete');
    eq(summary.called, true);
    eq(summary.singleRunComplete, false);
    eq(summary.doubleBlindComplete, false);
    eq(summary.supplementComplete, true);
    eq(summary.provenance.promptTemplateSha256, promptTemplateSha256());
    eq(summary.provenance.selectionSha256 === PARENT_SELECTION, false);
    eq(summary.provenance.originSummarySha256, box.summarySha);
    const derived = JSON.parse(fs.readFileSync(path.join(out, 'derived-merge.json'), 'utf8'));
    eq(derived.pairs.length, 30);
    eq(derived.coverage.originKept, 15);
    eq(derived.coverage.supplementRequested, 15);
    eq(derived.coverage.supplementParsed, 15);
    eq(derived.coverage.supplementNull, 0);
    eq(derived.coverage.cherryPick, false);
    eq(derived.coverage.derivedCoverageComplete, true);
    eq(derived.singleRunComplete, false);
    eq(derived.originSingleRunComplete, false);
    eq(derived.doubleBlindComplete, false);
    eq(derived.pairs.filter((row) => row.source === 'origin' && row.verdict === null).length, 15);
    eq(derived.pairs.filter((row) => row.source === 'supplement' && row.verdict).length, 15);
    eq(sha(fs.readFileSync(path.join(box.originDir, 'summary.json'))), box.summarySha);
  });
});
