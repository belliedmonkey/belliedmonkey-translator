'use strict';

// Independent offline v2 pack verification + 36x2 dry-run token/cost recount.
// No --run, no network, no keys, no Mac, no repo or old-evidence writes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const packDir = path.join(__dirname, 'pack-unpacked');
const { parseVerdict } = require(path.join(packDir, 'parse.js'));
const {
  ASR_RUBRIC, ASR_VERSION, FROZEN_V1_RUBRIC, FROZEN_V1_SHA256,
  promptTemplateSha256, sha256,
} = require(path.join(packDir, 'rubric.js'));
const contract = require(path.join(packDir, 'verdict-contract.js'));
const { buildPrompt } = require(path.join(packDir, 'prompt.js'));
const { assignItems } = require(path.join(packDir, 'assign.js'));
const { adaptSlotsObject, PROTOCOL: ADAPTER_PROTOCOL } = require(path.join(packDir, 'slots-object-adapter.js'));
const { runJudge } = require(path.join(packDir, 'run-judge.js'));
const { VERDICT_SCHEMA, FINDING_KINDS } = require(path.join(packDir, 'schema.js'));

const ROOT = __dirname;
const EVIDENCE = path.resolve(ROOT, '..', 'real-run-20261113-2253');
const PYTHON = process.env.JUDGE_TOKEN_PYTHON || '/tmp/judge-tok-venv/bin/python';
const EXPECTED = {
  packGz: 'a81afb949cc3e7ebc807e7ac90e88b6cd520220bd519641ec3051876d3ee3f92',
  packBytes: 19308,
  promptSha: 'a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923',
  promptUtf8: 2507,
  input: '1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1',
  oldPack: '74258e362de80cf39986717b32b65ef6ec9d3719bd60d21b91af54c1d441a9fe',
  countTokensPy: '8be0c606efcbfc9c36998f186600db6119a8b56648f4e75e8999a8c7c23d5af1',
  qwenTok: 'aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4',
  qwenCfg: 'a62ff0a2472a0fa1b8eaabcb57c59b58afa42a22831dc141400b6e0cf2b65ce3',
  frozenV1Prompt: 'a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6',
};
const OLD_PINS = {
  'package/01M7AJ65AKYJT2H26187ZDN7TW.gz': EXPECTED.oldPack,
  'input/input-asr-36.json': EXPECTED.input,
  'judge-run/summary.json': '44d9be2d34f633815622754e4e6ee3535bf67bb6f059e5f67d9d237236eb1e7b',
  'judge-run/human-review.json': '6dc6b18b2a95f158bff1e29e12df8514eaf5de497f4be3adf3d581b62cbc855a',
  'ledger/RESULT.json': 'e1496fd413d4057b09ee75346c96d7da7cd85402c2f1a270d2fc40bf6ba5e0b6',
};
const PRICE = {
  source: 'https://openrouter.ai/api/v1/models and https://openrouter.ai/api/v1/models/{id}/endpoints',
  sourceVersion: '2026-11-13T22:42:19+08:00;catalog_sha256=fab1f1c39a93322b8180e41770c12403986460d9e052874c37cd95b971e0ff1c;gpt-4.1-mini_record_sha256=ef472b851fa2d50167e6d0f9add0f7f9404f4e55d8e7cca75e70b66e86718c93;qwen3-235b-a22b-2507_record_sha256=fa13fb0cd1b89157a5fd9b7d2432e184a97526ed3fc494b7e06e9823e9cd2723;endpoints_gpt_sha256=c55d140b0532c149e47af5263e1aa44e2c708a1866e1b0dc01fef7397ae532d8;endpoints_qwen_sha256=a1437fd63b5fb0182977abad83b74312eea19c9654cf616e3260263fb8599234;rate_basis=conservative_max_listed_provider_envelope',
  gptIn: 4.4e-7,
  gptOut: 1.76e-6,
  qwenIn: 2e-7,
  qwenOut: 8e-7,
  maxOutput: 2048,
};
const REMAINING = 0.19429628;
const GPT = 'openai/gpt-4.1-mini';
const QWEN = 'qwen/qwen3-235b-a22b-2507';

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function money(n) {
  return Math.round(n * 1e9) / 1e9;
}
function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
}
function shanghaiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')} Asia/Shanghai (UTC+8)`;
}
function assert(name, cond, detail) {
  return { name, ok: !!cond, detail: detail == null ? null : detail };
}
function withSchema(text, schema) {
  return text.replace('belliedmonkey.llm-judge.verdict.v1', schema);
}

async function main() {
  const results = [];
  const packPath = path.join(ROOT, 'package/01M7ASY5H5YT8XV1NH4Y291ZFP.gz');
  const oldPackPath = path.join(EVIDENCE, 'package/01M7AJ65AKYJT2H26187ZDN7TW.gz');
  results.push(assert('pack-sha256', hashFile(packPath) === EXPECTED.packGz, hashFile(packPath)));
  results.push(assert('pack-bytes', fs.statSync(packPath).size === EXPECTED.packBytes, fs.statSync(packPath).size));
  results.push(assert('old-pack-untouched', hashFile(oldPackPath) === EXPECTED.oldPack, hashFile(oldPackPath)));
  results.push(assert('input-sha256', hashFile(path.join(ROOT, 'input-asr-36.json')) === EXPECTED.input));
  results.push(assert('count-tokens-py', hashFile(path.join(ROOT, 'scripts/count-tokens.py')) === EXPECTED.countTokensPy));
  results.push(assert('qwen-tokenizer.json', hashFile(path.join(ROOT, 'tokenizers/qwen/tokenizer.json')) === EXPECTED.qwenTok));
  results.push(assert('qwen-tokenizer_config.json', hashFile(path.join(ROOT, 'tokenizers/qwen/tokenizer_config.json')) === EXPECTED.qwenCfg));

  const v2sha = promptTemplateSha256();
  const v2utf8 = Buffer.byteLength(ASR_RUBRIC, 'utf8');
  results.push(assert('prompt-sha256', v2sha === EXPECTED.promptSha, v2sha));
  results.push(assert('prompt-utf8-bytes', v2utf8 === EXPECTED.promptUtf8, v2utf8));
  results.push(assert('prompt-is-rubricText', ASR_RUBRIC === contract.rubricText()));
  results.push(assert('sent-prompt-not-v1', v2sha !== FROZEN_V1_SHA256 && ASR_RUBRIC !== FROZEN_V1_RUBRIC));
  results.push(assert('frozen-v1-text-preserved', sha256(FROZEN_V1_RUBRIC) === FROZEN_V1_SHA256 && FROZEN_V1_SHA256 === EXPECTED.frozenV1Prompt));
  results.push(assert('versions-v2', contract.VERDICT_SCHEMA === 'belliedmonkey.llm-judge.verdict.v2' && contract.ASR_VERSION === 'belliedmonkey.llm-judge.asr.v2' && ASR_VERSION === contract.ASR_VERSION && VERDICT_SCHEMA === contract.VERDICT_SCHEMA));
  results.push(assert('schema-kinds-from-contract', JSON.stringify(FINDING_KINDS) === JSON.stringify(contract.FINDING_KINDS)));

  const parseSrc = fs.readFileSync(path.join(packDir, 'parse.js'), 'utf8');
  const runSrc = fs.readFileSync(path.join(packDir, 'run-judge.js'), 'utf8');
  const promptSrc = fs.readFileSync(path.join(packDir, 'prompt.js'), 'utf8');
  results.push(assert('parser-requires-contract', parseSrc.indexOf("require('./verdict-contract.js')") !== -1));
  results.push(assert('rubric-requires-contract', fs.readFileSync(path.join(packDir, 'rubric.js'), 'utf8').indexOf("require('./verdict-contract.js')") !== -1));
  results.push(assert('prompt-sends-ASR_RUBRIC', promptSrc.indexOf('ASR_RUBRIC') !== -1 && promptSrc.indexOf("role: 'system'") !== -1));
  results.push(assert('runner-does-not-import-adapter', runSrc.indexOf('slots-object-adapter') === -1 && parseSrc.indexOf('slots-object-adapter') === -1));
  results.push(assert('adapter-marked-diagnostic', ADAPTER_PROTOCOL.indexOf('diagnostic') !== -1 || ADAPTER_PROTOCOL.indexOf('diag') !== -1));

  const requiredInPrompt = [
    'slots is a JSON array of length 2, not an object and not a dictionary.',
    'The object keys are exactly schema, itemId, and slots.',
    'The two array elements are objects. Their slot fields are slot-1 and slot-2, each once. Order may be either.',
    'Each slot object keys are exactly slot, abstain, confidence, note, and findings.',
    'slot is the string slot-1 or slot-2. abstain is a boolean. confidence is a number from 0 to 1 inclusive.',
    'note is a string of length 1 to ' + contract.NOTE_MAX + ' when abstain is true, and a string of length 0 to ' + contract.NOTE_MAX + ' otherwise. Do not exceed ' + contract.NOTE_MAX + '.',
    'reason is a string of length 1 to ' + contract.REASON_MAX + '.',
    'kind is one of ' + contract.FINDING_KINDS.join(', ') + '. No other kind is valid.',
    'refQuote must occur in the reference. hypQuote must occur in that same slot candidate, not the other slot.',
    'Copy the slice. Do not add or remove punctuation.',
    'schema is ' + contract.VERDICT_SCHEMA + '.',
    JSON.stringify(contract.EXAMPLE),
  ];
  const missingPrompt = requiredInPrompt.filter((s) => ASR_RUBRIC.indexOf(s) === -1);
  results.push(assert('sent-prompt-contains-all-parser-contract-limits', missingPrompt.length === 0, missingPrompt));
  results.push(assert('example-is-array-length-2', Array.isArray(contract.EXAMPLE.slots) && contract.EXAMPLE.slots.length === 2 && contract.EXAMPLE.schema === contract.VERDICT_SCHEMA));
  results.push(assert('parse-key-lists-match-contract',
    parseSrc.indexOf("['schema', 'itemId', 'slots']") !== -1
    && parseSrc.indexOf("['slot', 'abstain', 'confidence', 'note', 'findings']") !== -1
    && parseSrc.indexOf("['kind', 'refQuote', 'hypQuote', 'reason']") !== -1
    && JSON.stringify(contract.ROOT_KEYS) === JSON.stringify(['schema', 'itemId', 'slots'])
    && JSON.stringify(contract.SLOT_KEYS) === JSON.stringify(['slot', 'abstain', 'confidence', 'note', 'findings'])
    && JSON.stringify(contract.FINDING_KEYS) === JSON.stringify(['kind', 'refQuote', 'hypQuote', 'reason'])
  ));

  const input = readJson(path.join(ROOT, 'input-asr-36.json'));
  results.push(assert('input-36-real', input.items && input.items.length === 36 && input.schema === 'belliedmonkey.llm-judge.input.v1'));
  const assignment = assignItems(input.items, 20261113);
  const itemsById = new Map(input.items.map((it) => [it.id, it]));
  const assignById = new Map(assignment.map((row) => [row.id, row]));

  // Confirm first built system message is the v2 rubric.
  const samplePrompt = buildPrompt(input.items[0], assignById.get(input.items[0].id));
  results.push(assert('buildPrompt-system-is-v2-rubric', samplePrompt.messages[0].content === ASR_RUBRIC));

  const fixtureRows = runFixtures(input, itemsById, assignById);
  const fixtureFail = fixtureRows.filter((r) => !r.ok);
  results.push(assert('real-failure-fixture-regression', fixtureFail.length === 0, fixtureFail));
  writeJson(path.join(ROOT, 'fixtures/results.json'), fixtureRows);

  const counts = countAll(input, assignment);
  writeJson(path.join(ROOT, 'counts/token-counts.json'), counts);
  const allN = counts.results.map((r) => r.tokens);
  const gptN = counts.results.filter((r) => r.model === GPT).map((r) => r.tokens);
  const qwenN = counts.results.filter((r) => r.model === QWEN).map((r) => r.tokens);
  const maxTok = Math.max.apply(null, allN);
  const minTok = Math.min.apply(null, allN);
  const margin = Math.max(256, Math.ceil(maxTok * 0.15));
  const maxInputTokens = Math.ceil((maxTok + margin) / 64) * 64;
  results.push(assert('did-not-use-2507-bytes-as-token-cap', maxInputTokens !== 2507 && maxInputTokens > maxTok));

  const reserveGpt = money(maxInputTokens * PRICE.gptIn + PRICE.maxOutput * PRICE.gptOut);
  const reserveQwen = money(maxInputTokens * PRICE.qwenIn + PRICE.maxOutput * PRICE.qwenOut);
  const full72 = money(36 * reserveGpt + 36 * reserveQwen);
  const enough = REMAINING >= full72;
  const extra = enough ? 0 : money(full72 - REMAINING);
  const budget = {
    remainingUsd: REMAINING,
    maxInputTokens,
    maxOutputTokens: PRICE.maxOutput,
    maxRequests: 72,
    maxTotalTokens: 72 * (maxInputTokens + PRICE.maxOutput),
    reservePerRequestUsd: { [GPT]: reserveGpt, [QWEN]: reserveQwen },
    full72ReserveUsd: full72,
    remainingCoversFull72Reserve: enough,
    extraUsdNeeded: extra,
    reapprovalRequired: !enough,
    noRequestMade: true,
    note: 'Full reserve is maxInput+maxOutput at official envelope rates for all 72 requests. Not a settled-cost forecast. Do not spend from this verification.',
  };
  writeJson(path.join(ROOT, 'counts/budget.json'), budget);

  const config = {
    schema: 'belliedmonkey.llm-judge.config.v1',
    seed: 20261113,
    temperature: 0,
    sampleCount: 6,
    maxItems: 36,
    timeoutMs: 120000,
    maxRetries: 0,
    budgetUsd: full72,
    judges: [
      { id: 'judge-a', model: GPT, endpointEnv: 'JUDGE_OPENROUTER_URL', keyEnv: 'JUDGE_OPENROUTER_KEY' },
      { id: 'judge-b', model: QWEN, endpointEnv: 'JUDGE_OPENROUTER_URL', keyEnv: 'JUDGE_OPENROUTER_KEY' },
    ],
    prices: {
      schema: 'belliedmonkey.llm-judge.prices.v1',
      source: PRICE.source,
      sourceVersion: PRICE.sourceVersion,
      maxInputTokens,
      maxOutputTokens: PRICE.maxOutput,
      maxTotalTokens: 72 * (maxInputTokens + PRICE.maxOutput),
      maxRequests: 72,
      models: {
        [GPT]: { inputUsdPerToken: PRICE.gptIn, outputUsdPerToken: PRICE.gptOut, pricedZero: false },
        [QWEN]: { inputUsdPerToken: PRICE.qwenIn, outputUsdPerToken: PRICE.qwenOut, pricedZero: false },
      },
    },
    inputBound: { kind: 'counter' },
  };
  const configPath = path.join(ROOT, 'config/config.draft-v2-openrouter-e998c2c0.json');
  writeJson(configPath, config);
  writeText(path.join(ROOT, 'config/NOT-AUTHORIZATION-TO-SPEND.txt'),
    'This draft config is for dry-run sizing only. It is not approval to call a model or to spend. budgetUsd equals the computed 72-request full reserve and exceeds the unused official-run remainder; a later real run needs a new budget approval.\n');

  const tokenCache = new Map();
  for (const row of counts.results) tokenCache.set(row.judgeId + ':' + row.id, row.tokens);
  function countTokens(body) {
    const req = JSON.parse(body);
    // Recover item from user payload for cache hit; fall back to helper.
    let itemId = null;
    try { itemId = JSON.parse(req.messages[1].content).itemId; } catch (_) {}
    const judgeId = req.model === GPT ? 'judge-a' : (req.model === QWEN ? 'judge-b' : null);
    if (itemId && judgeId && tokenCache.has(judgeId + ':' + itemId)) return tokenCache.get(judgeId + ':' + itemId);
    const child = spawnSync(PYTHON, [path.join(ROOT, 'scripts/count-tokens.py')], {
      input: JSON.stringify({ model: req.model, messages: req.messages }),
      encoding: 'utf8',
      timeout: 60000,
      env: Object.assign({}, process.env, { JUDGE_QWEN_TOKENIZER_DIR: path.join(ROOT, 'tokenizers/qwen') }),
    });
    if (child.status !== 0) return -1;
    const n = Number(String(child.stdout).trim());
    return Number.isInteger(n) ? n : -1;
  }

  const dryOut = path.join(ROOT, 'dryrun-real36');
  fs.mkdirSync(dryOut, { recursive: true });
  const summary = await runJudge({
    input,
    config,
    out: dryOut,
    run: false,
    synthetic: false,
    countTokens,
  });
  writeJson(path.join(ROOT, 'dryrun-real36-public.json'), {
    ok: summary.ok,
    code: summary.code,
    called: summary.called,
    synthetic: summary.synthetic,
    doubleBlindComplete: summary.doubleBlindComplete,
    asrRubric: summary.asrRubric || (summary.plan && summary.plan.asrRubric),
    promptTemplateSha256: summary.promptTemplateSha256 || (summary.plan && summary.plan.promptTemplateSha256),
    itemCount: summary.plan && summary.plan.itemIds ? summary.plan.itemIds.length : null,
    omittedIds: summary.omittedIds || [],
    minDeclaredTokens: summary.plan && summary.plan.inputChecks ? Math.min.apply(null, summary.plan.inputChecks.map((r) => r.declaredTokens)) : null,
    maxDeclaredTokens: summary.plan && summary.plan.inputChecks ? Math.max.apply(null, summary.plan.inputChecks.map((r) => r.declaredTokens)) : null,
    allBoundOk: summary.plan && summary.plan.inputChecks ? summary.plan.inputChecks.every((r) => r.ok) : null,
    nChecks: summary.plan && summary.plan.inputChecks ? summary.plan.inputChecks.length : null,
  });
  results.push(assert('dry-run-36x2-no-synthetic-no-run', summary.ok === true && summary.code === 'dry-run' && summary.called === false && summary.synthetic === false && summary.doubleBlindComplete === false));
  results.push(assert('dry-run-uses-asr-v2', summary.plan && summary.plan.asrRubric === 'belliedmonkey.llm-judge.asr.v2' && summary.plan.promptTemplateSha256 === EXPECTED.promptSha));
  results.push(assert('dry-run-72-checks-fit', summary.plan && summary.plan.inputChecks && summary.plan.inputChecks.length === 72 && summary.plan.inputChecks.every((r) => r.ok && r.method === 'counter' && r.declaredTokens <= maxInputTokens)));
  results.push(assert('dry-run-not-complete', summary.doubleBlindComplete === false));
  results.push(assert('human-review-not-done', summary.humanReview && summary.humanReview.semanticHumanReviewCount === 0 && Array.isArray(summary.humanReview.notAssessed) && summary.humanReview.notAssessed.length === 36));

  const oldAtEnd = Object.entries(OLD_PINS).map(([rel, exp]) => {
    const got = hashFile(path.join(EVIDENCE, rel));
    return { rel, ok: got === exp, got };
  });
  results.push(assert('old-evidence-unchanged', oldAtEnd.every((r) => r.ok), oldAtEnd.filter((r) => !r.ok)));

  const failed = results.filter((r) => !r.ok);
  const packPassed = failed.length === 0;
  // Budget shortfall is not a pack defect; recorded separately.
  const report = {
    generatedAt: shanghaiNow(),
    headStatedByCaller: 'e998c2c03f13af0229229405bb1f7b06a3be967b',
    npmCiStatedByCaller: { npmTests: 3399, ci: 'green', independentlyRechecked: false, reason: 'no network, no repo' },
    packPassed,
    packIssues: failed,
    checks: results,
    prompt: { sha256: v2sha, utf8Bytes: v2utf8, version: ASR_VERSION, verdictSchema: contract.VERDICT_SCHEMA },
    tokens: {
      n: allN.length,
      min: minTok,
      max: maxTok,
      gptMin: Math.min.apply(null, gptN),
      gptMax: Math.max.apply(null, gptN),
      qwenMin: Math.min.apply(null, qwenN),
      qwenMax: Math.max.apply(null, qwenN),
      systemUtf8Bytes: v2utf8,
      systemNotUsedAsCap: true,
      marginRule: 'max(256, ceil(15% of max observed)), then round up to 64',
      margin,
      maxInputTokens,
    },
    budget,
    dryRun: { ok: summary.ok, code: summary.code, called: summary.called, doubleBlindComplete: summary.doubleBlindComplete },
    humanReview: {
      semanticHumanReviewed: false,
      semanticHumanReviewCount: 0,
      officialV2RunNotYet: true,
      neededAfterOfficialV2Complete: true,
    },
    stillNeeded: {
      realModelTest: true,
      reason: 'Offline pack+fixture+dry-run passed; models were not called. That is not a pack failure. An authorized new 36x2 v2 run is still required. Old GPT/Qwen v1 outputs cannot be mixed into a v2 complete.',
      humanReview: true,
      reapprovalForBudget: budget.reapprovalRequired,
    },
    isolation: {
      oldPackFrozen: EXPECTED.oldPack,
      officialPartialUntouched: true,
      objectAdapterDiagnosticOnly: true,
      v1VerdictsRejectedAsVerdictSchema: true,
    },
  };

  writeJson(path.join(ROOT, 'MANIFEST.json'), report);
  writeText(path.join(ROOT, 'REPORT.md'), buildReport(report, fixtureRows, configPath));
  writeJson(path.join(ROOT, 'FROZEN-V2.json'), {
    frozen: packPassed,
    pack: '01M7ASY5H5YT8XV1NH4Y291ZFP.gz',
    sha256: EXPECTED.packGz,
    bytes: EXPECTED.packBytes,
    headStatedByCaller: 'e998c2c03f13af0229229405bb1f7b06a3be967b',
    promptSha256: EXPECTED.promptSha,
    asrVersion: 'belliedmonkey.llm-judge.asr.v2',
    verdictSchema: 'belliedmonkey.llm-judge.verdict.v2',
    officialV1PackUntouched: EXPECTED.oldPack,
    status: packPassed ? 'passed' : 'failed',
    note: packPassed
      ? 'Frozen as the v2 pack for a future authorized run. Not a completed 36 double-blind. Adapter is not a formal pass. Old partial is unchanged.'
      : 'Not frozen; see REPORT.md pack issues.',
  });

  const sums = [];
  for (const rel of listFiles(ROOT)) {
    if (rel === 'SHA256SUMS' || rel.startsWith('tokenizers/qwen/')) continue; // large tokenizer pinned separately
    const p = path.join(ROOT, rel);
    if (fs.statSync(p).isFile()) sums.push(hashFile(p) + '  ' + rel);
  }
  sums.push(EXPECTED.qwenTok + '  tokenizers/qwen/tokenizer.json');
  sums.push(EXPECTED.qwenCfg + '  tokenizers/qwen/tokenizer_config.json');
  sums.sort();
  writeText(path.join(ROOT, 'SHA256SUMS'), sums.join('\n') + '\n');

  process.stdout.write(JSON.stringify({
    packPassed,
    failed: failed.map((f) => f.name),
    tokenRange: { min: minTok, max: maxTok, gpt: [Math.min.apply(null, gptN), Math.max.apply(null, gptN)], qwen: [Math.min.apply(null, qwenN), Math.max.apply(null, qwenN)] },
    maxInputTokens,
    full72ReserveUsd: full72,
    remainingUsd: REMAINING,
    extraUsdNeeded: extra,
    reapprovalRequired: !enough,
    dryRun: summary.code,
    realTestStillNeeded: true,
    humanReviewStillNeeded: true,
  }, null, 2) + '\n');
}

function runFixtures(input, itemsById, assignById) {
  const evResp = path.join(EVIDENCE, 'judge-run/responses');
  const rows = [];
  function add(name, got, expected, extra) {
    const ok = got && got.code === expected && (expected === 'parsed' ? got.ok === true : got.ok === false);
    rows.push(Object.assign({ name, expected, got: got && { ok: got.ok, code: got.code }, ok }, extra || {}));
  }
  function itemOf(id) { return itemsById.get(id); }
  function asgOf(id) { return assignById.get(id); }
  function raw(judge, id) {
    return readJson(path.join(evResp, judge, safeName(id))).content;
  }

  // Example in the sent prompt must parse under the contract.
  const exampleItem = {
    id: 'example-id',
    reference: 'why',
    candidates: [{ key: 'hx9q2w', text: 'why' }, { key: 'jt4m8c', text: 'why' }],
  };
  const exampleAsg = { id: 'example-id', slots: { 'slot-1': 'hx9q2w', 'slot-2': 'jt4m8c' } };
  add('array-example-parses', parseVerdict(JSON.stringify(contract.EXAMPLE), exampleItem, exampleAsg), 'parsed');

  // Version isolation: raw official v1 outputs cannot parse as v2.
  const qwenOkId = 'fleurs-public-candidates/en_us/1668';
  add('raw-official-qwen-v1-rejected', parseVerdict(raw('judge-b', qwenOkId), itemOf(qwenOkId), asgOf(qwenOkId)), 'verdict-schema');
  const gptObjId = 'fleurs-public-candidates/en_us/1668';
  add('raw-official-gpt-v1-object-rejected', parseVerdict(raw('judge-a', gptObjId), itemOf(gptObjId), asgOf(gptObjId)), 'verdict-schema');
  add('raw-official-gpt-00066-still-bad-json', parseVerdict(raw('judge-a', 'ascend/00066'), itemOf('ascend/00066'), asgOf('ascend/00066')), 'bad-json');

  // After only renaming schema v1→v2 (test fixture, not official): original failure modes still fire.
  add('v2-schema-copy-gpt-object-still-slots', parseVerdict(withSchema(raw('judge-a', gptObjId), contract.VERDICT_SCHEMA), itemOf(gptObjId), asgOf(gptObjId)), 'slots');
  add('v2-schema-copy-qwen-00028-still-note', parseVerdict(withSchema(raw('judge-b', 'ascend/00028'), contract.VERDICT_SCHEMA), itemOf('ascend/00028'), asgOf('ascend/00028')), 'note');
  add('v2-schema-copy-qwen-00055-added-punct-still-quote', parseVerdict(withSchema(raw('judge-b', 'ascend/00055'), contract.VERDICT_SCHEMA), itemOf('ascend/00055'), asgOf('ascend/00055')), 'quote');
  add('v2-schema-copy-qwen-1680-cross-slot-still-quote', parseVerdict(withSchema(raw('judge-b', 'fleurs-public-candidates/cmn_hans_cn/1680'), contract.VERDICT_SCHEMA), itemOf('fleurs-public-candidates/cmn_hans_cn/1680'), asgOf('fleurs-public-candidates/cmn_hans_cn/1680')), 'quote');
  add('v2-schema-copy-qwen-1675-invalid-kind-still-finding-kind', parseVerdict(withSchema(raw('judge-b', 'fleurs-public-candidates/en_us/1675'), contract.VERDICT_SCHEMA), itemOf('fleurs-public-candidates/en_us/1675'), asgOf('fleurs-public-candidates/en_us/1675')), 'finding-kind');
  add('v2-schema-copy-gpt-1681-added-punct-still-quote-after-diag-adapt-only', (() => {
    const adapted = adaptSlotsObject(withSchema(raw('judge-a', 'fleurs-public-candidates/cmn_hans_cn/1681'), contract.VERDICT_SCHEMA));
    if (!adapted.ok || adapted.official !== false || !adapted.diagnostic) {
      return { ok: false, code: 'adapter-unexpected', verdict: null };
    }
    return parseVerdict(adapted.adaptedText, itemOf('fleurs-public-candidates/cmn_hans_cn/1681'), asgOf('fleurs-public-candidates/cmn_hans_cn/1681'));
  })(), 'quote', { note: 'adapter diagnostic only; official parse of adapted text still quote; not a formal pass' });

  // Dictionary still rejected on a clean v2 object (no official parse path).
  const dictId = 'fleurs-public-candidates/en_us/1671';
  const dictDoc = {
    schema: contract.VERDICT_SCHEMA,
    itemId: dictId,
    slots: {
      'slot-1': { slot: 'slot-1', abstain: true, confidence: 0, note: 'why', findings: [] },
      'slot-2': { slot: 'slot-2', abstain: true, confidence: 0, note: 'why', findings: [] },
    },
  };
  add('clean-v2-dictionary-rejected-slots', parseVerdict(JSON.stringify(dictDoc), itemOf(dictId), asgOf(dictId)), 'slots');
  const adaptedDict = adaptSlotsObject(JSON.stringify(dictDoc));
  rows.push({
    name: 'adapter-on-dict-is-diagnostic-not-official',
    ok: adaptedDict.ok === true && adaptedDict.official === false && adaptedDict.diagnostic === true,
    expected: 'adapted-diagnostic-only',
    got: { ok: adaptedDict.ok, code: adaptedDict.code, official: adaptedDict.official, diagnostic: adaptedDict.diagnostic },
  });
  const officialAfterAdapt = parseVerdict(adaptedDict.adaptedText, itemOf(dictId), asgOf(dictId));
  add('parse-of-adapted-dict-text-may-succeed-but-is-not-runner-complete', officialAfterAdapt, 'parsed', {
    note: 'This only shows the lossless shape rewrite can feed parseVerdict. run-judge never calls the adapter; this is not a formal v2 pass and must not be mixed into complete.',
  });

  // note / reason 400 boundary (constructed, exact official limits).
  const boundId = 'fleurs-public-candidates/en_us/1672';
  function abstainVerdict(note) {
    return JSON.stringify({
      schema: contract.VERDICT_SCHEMA,
      itemId: boundId,
      slots: [
        { slot: 'slot-1', abstain: true, confidence: 0, note, findings: [] },
        { slot: 'slot-2', abstain: true, confidence: 0, note: 'why', findings: [] },
      ],
    });
  }
  add('note-400-accepted', parseVerdict(abstainVerdict('n'.repeat(400)), itemOf(boundId), asgOf(boundId)), 'parsed');
  add('note-401-rejected', parseVerdict(abstainVerdict('n'.repeat(401)), itemOf(boundId), asgOf(boundId)), 'note');

  const ref = itemOf(boundId).reference;
  const hyp1 = itemOf(boundId).candidates.find((c) => c.key === asgOf(boundId).slots['slot-1']).text;
  const sliceRef = ref.slice(0, Math.min(8, ref.length));
  const sliceHyp = hyp1.slice(0, Math.min(8, hyp1.length));
  function reasonVerdict(reason, kind) {
    return JSON.stringify({
      schema: contract.VERDICT_SCHEMA,
      itemId: boundId,
      slots: [
        {
          slot: 'slot-1', abstain: false, confidence: 0.5, note: '',
          findings: [{ kind: kind || 'format-only', refQuote: sliceRef, hypQuote: sliceHyp, reason }],
        },
        { slot: 'slot-2', abstain: true, confidence: 0, note: 'why', findings: [] },
      ],
    });
  }
  add('reason-400-accepted', parseVerdict(reasonVerdict('r'.repeat(400)), itemOf(boundId), asgOf(boundId)), 'parsed');
  add('reason-401-rejected', parseVerdict(reasonVerdict('r'.repeat(401)), itemOf(boundId), asgOf(boundId)), 'reason');
  add('invalid-kind-punctuation-rejected', parseVerdict(reasonVerdict('because', 'punctuation'), itemOf(boundId), asgOf(boundId)), 'finding-kind');

  // Cross-slot hypQuote constructed from the other slot's text when possible.
  const crossId = 'fleurs-public-candidates/cmn_hans_cn/1680';
  const crossItem = itemOf(crossId);
  const crossAsg = asgOf(crossId);
  const t1 = crossItem.candidates.find((c) => c.key === crossAsg.slots['slot-1']).text;
  const t2 = crossItem.candidates.find((c) => c.key === crossAsg.slots['slot-2']).text;
  const only1 = '5倍';
  const only2ok = t2.indexOf(only1) === -1 && t1.indexOf(only1) !== -1 && crossItem.reference.indexOf('五倍') !== -1;
  rows.push({ name: 'cross-slot-real-strings-available', ok: only2ok, expected: true, got: only2ok });
  const crossDoc = JSON.stringify({
    schema: contract.VERDICT_SCHEMA,
    itemId: crossId,
    slots: [
      { slot: 'slot-1', abstain: true, confidence: 0, note: 'why', findings: [] },
      {
        slot: 'slot-2', abstain: false, confidence: 0.5, note: '',
        findings: [{ kind: 'format-only', refQuote: '五倍', hypQuote: '5倍', reason: 'digit versus word' }],
      },
    ],
  });
  add('constructed-cross-slot-quote-rejected', parseVerdict(crossDoc, crossItem, crossAsg), 'quote');

  // Added punctuation on reference quote (real 00055 pattern).
  const punctId = 'ascend/00055';
  const punctDoc = JSON.stringify({
    schema: contract.VERDICT_SCHEMA,
    itemId: punctId,
    slots: [
      { slot: 'slot-1', abstain: true, confidence: 0, note: 'why', findings: [] },
      {
        slot: 'slot-2', abstain: false, confidence: 0.5, note: '',
        findings: [{ kind: 'format-only', refQuote: '运动。', hypQuote: '运动。', reason: 'added stop' }],
      },
    ],
  });
  add('constructed-added-punctuation-quote-rejected', parseVerdict(punctDoc, itemOf(punctId), asgOf(punctId)), 'quote');

  // Illegal JSON still rejected.
  add('illegal-json-rejected', parseVerdict('{"schema":', itemOf(boundId), asgOf(boundId)), 'bad-json');
  add('real-00066-illegal-json-rejected', parseVerdict(raw('judge-a', 'ascend/00066'), itemOf('ascend/00066'), asgOf('ascend/00066')), 'bad-json');

  return rows;
}

function countAll(input, assignment) {
  const assignById = new Map(assignment.map((row) => [row.id, row]));
  const jobs = [];
  for (const item of input.items) {
    const prompt = buildPrompt(item, assignById.get(item.id));
    jobs.push({ id: item.id, judgeId: 'judge-a', model: GPT, messages: prompt.messages });
    jobs.push({ id: item.id, judgeId: 'judge-b', model: QWEN, messages: prompt.messages });
  }
  const child = spawnSync(PYTHON, [path.join(ROOT, 'scripts/count-batch.py')], {
    input: JSON.stringify({ jobs }),
    encoding: 'utf8',
    timeout: 180000,
    env: Object.assign({}, process.env, { JUDGE_QWEN_TOKENIZER_DIR: path.join(ROOT, 'tokenizers/qwen') }),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error('count-batch failed: ' + (child.stderr || child.stdout));
  }
  const out = JSON.parse(child.stdout);
  if (!out.results || out.results.length !== 72) throw new Error('expected 72 counts');
  // Also count system-only, for documentation, not as a cap.
  const sysJobs = [
    { id: 'system-only', judgeId: 'judge-a', model: GPT, messages: [{ role: 'system', content: ASR_RUBRIC }] },
    { id: 'system-only', judgeId: 'judge-b', model: QWEN, messages: [{ role: 'system', content: ASR_RUBRIC }] },
  ];
  const child2 = spawnSync(PYTHON, [path.join(ROOT, 'scripts/count-batch.py')], {
    input: JSON.stringify({ jobs: sysJobs }),
    encoding: 'utf8',
    timeout: 60000,
    env: Object.assign({}, process.env, { JUDGE_QWEN_TOKENIZER_DIR: path.join(ROOT, 'tokenizers/qwen') }),
  });
  if (child2.status !== 0) throw new Error('system count failed: ' + (child2.stderr || child2.stdout));
  const sys = JSON.parse(child2.stdout);
  return { results: out.results, systemOnly: sys.results, assumptions: 'see TOKENIZER-ASSUMPTIONS.md; exact=false; 2507 UTF-8 bytes is not a token count' };
}

function listFiles(dir, prefix) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'pack-unpacked' || name === 'node_modules' || name === '__pycache__' || name.endsWith('.pyc')) continue;
    const rel = prefix ? prefix + '/' + name : name;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push.apply(out, listFiles(p, rel));
    else out.push(rel);
  }
  return out;
}

function buildReport(report, fixtures, configPath) {
  const t = report.tokens;
  const b = report.budget;
  const L = [];
  L.push('# v2 pack e998c2c0 独立离线复验');
  L.push('');
  L.push('生成时间：' + report.generatedAt);
  L.push('范围：只读新包与冻结 36 条真实 input；无 --run、无付费、无网络、无 Mac、无 secret、不改仓库与旧证据。对象 adapter 仅诊断，不能正式通过。原包 `74258e36…` 与官方 partial 未动。npm 3399 / CI green / head `e998c2c03f13af0229229405bb1f7b06a3be967b` 由调用方陈述，本步未联网复核。实模型未调用不记为包失败。');
  L.push('');
  L.push('## 结论');
  L.push('');
  L.push(report.packPassed
    ? '- 包复验 **passed**，已在本目录记下冻结（`FROZEN-V2.json`）。这不是 36 双盲完成。'
    : '- 包复验 **failed**：' + report.packIssues.map((x) => x.name).join(', '));
  L.push('- 发送 system 由 `verdict-contract.js` `rubricText()` 生成，sha256 `' + report.prompt.sha256 + '`，UTF-8 **' + report.prompt.utf8Bytes + '** 字节，版本 `asr.v2` / `verdict.v2`。冻结 v1 提示词仍为 `' + EXPECTED.frozenV1Prompt + '`，不会被当成 v2 发送。');
  L.push('- 解析器与提示同源使用 contract 的 schema、7 kind、NOTE/REASON 400，以及同一 JSON 数组示例。`slots` 明确是长度 2 的数组而非对象。quote 必须落在 reference 与**同一槽**候选。');
  L.push('- 真实失败夹具全部按预期拒绝：字典 `slots`、跨槽 quote、添标点 quote、超长 note、非法 kind `punctuation`、非法 JSON。数组示例 parse 通过。仅改 schema 字段的官方失败原文，在 v2 下仍给出原来的失败码。官方 v1 原文直接解析均为 `verdict-schema` 或 `bad-json`，不能混入 v2 complete。');
  L.push('- `slots-object-adapter.js` 未被 `parse.js` / `run-judge.js` 引用；适配结果带 `official:false`。');
  L.push('');
  L.push('## Token 范围与 maxInputTokens');
  L.push('');
  L.push('- 计数器：官方 `count-tokens.py`（sha `8be0c606…`）。GPT = tiktoken `gpt-4.1-mini` / **o200k_base** + cookbook 每条 +3、结尾 +3（假设，`exact=false`）。Qwen = 已钉 tokenizer.json / chat_template（sha `aeb13307…` / `a62ff0a2…`）。详见 `TOKENIZER-ASSUMPTIONS.md`。');
  L.push('- 未把 2507 字节当作 token 或 cap。system-only 计数另存于 `counts/token-counts.json`，只作说明。');
  L.push('- 36 条真实 input × 2 模型，共 72 次完整请求（system+user）token：全体 **' + t.min + '–' + t.max + '**；GPT **' + t.gptMin + '–' + t.gptMax + '**；Qwen **' + t.qwenMin + '–' + t.qwenMax + '**。');
  L.push('- 边际规则：`max(256, ceil(15% × max))` 再上取整到 64。本批 margin=' + t.margin + '。选定 **maxInputTokens=' + t.maxInputTokens + '**，maxOutputTokens=2048。v1 官方 72 次中该计数器与账单 input 全为差 0，仍不把 v2 计作 exact。');
  L.push('');
  L.push('## 72 次全额预留 vs 旧池剩余');
  L.push('');
  L.push('- 价目沿用已取官方包络：GPT `4.4e-7` / `1.76e-6`，Qwen `2e-7` / `8e-7`，sourceVersion 仍是 2026-11-13T22:42:19+08:00 那份目录钉选。');
  L.push('- 单次预留：GPT `' + b.reservePerRequestUsd[GPT] + '`，Qwen `' + b.reservePerRequestUsd[QWEN] + '`。');
  L.push('- **72 次全额预留合计 `' + b.full72ReserveUsd + '`。** 旧池 remaining `' + b.remainingUsd + '` **不够**。额外需要 `' + b.extraUsdNeeded + '`。**须重新批准**，本步未花、未请求。');
  L.push('- 不够的原因：按要求保持 output 2048 时，72 次输出包络预留已占 0.18874368；剩下不够覆盖 v2 实际输入上限下的输入预留。不能靠压低 maxInput 到无法装下真实提示来迁就余额。`budgetUsd` 在草稿配置里写成全额预留，只用于 sizing，不是授权。');
  L.push('');
  L.push('## Dry-run');
  L.push('');
  L.push('- `run=false`，`synthetic=false`，冻结 input 36 条，code=`' + report.dryRun.code + '`，`called=false`，`doubleBlindComplete=false`，72 条 inputBound 均 ok。');
  L.push('- 草稿配置：`' + configPath + '`。');
  L.push('- 仍需一次授权后的真实 36×2 v2 调用才能正式完成；完成后仍需人工审（`semanticHumanReviewed=false`）。不得把旧 GPT/Qwen 结果拼进 v2 complete。');
  L.push('');
  L.push('## 夹具摘要');
  L.push('');
  for (const f of fixtures) {
    L.push('- ' + (f.ok ? 'PASS' : 'FAIL') + ' `' + f.name + '` expected=' + f.expected + (f.got && f.got.code ? ' got=' + f.got.code : ''));
  }
  L.push('');
  L.push('可复现：`node /workspace/baseline-sa-sv-36-20261113/judge-prep/verify-e998c2c0-v2/verify-v2.js`');
  L.push('');
  return L.join('\n');
}

main().catch((err) => {
  process.stderr.write((err && err.stack) || String(err));
  process.exit(1);
});
