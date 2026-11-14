#!/usr/bin/env node
'use strict';

/**
 * Independent offline minimal re-verify of pack 01M7BYBRDRFCHNC7FXJJV8A3GE / 75266d0a.
 * No network, no secrets, no paid calls, no repo or official-evidence writes.
 */

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, mkdtempSync, cpSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = resolve(HERE, '..');
const JUDGE_PREP = resolve(VERIFY, '..');
const PACK = join(VERIFY, 'pack-unpacked');
const EVIDENCE = join(JUDGE_PREP, 'v2-real-run-20261114-0015/evidence/llm-judge-v2-real-20261114-0015');
const ALLOWLIST = join(JUDGE_PREP, 'v2-backfill-prep-20261114/out/allowlist-15.json');
const FROZEN_INPUT = join(JUDGE_PREP, 'input-asr-36.json');
const V2_PACK = join(JUDGE_PREP, 'v2-offline-diag-20261114/pack-unpacked');
const COUNT_PY = join(EVIDENCE, 'scripts/count-tokens.py');
const QWEN_TOK = join(EVIDENCE, 'tokenizers/qwen');
const OFFICIAL_CFG = join(EVIDENCE, 'config/config.formal-run-budget-remaining.json');

const BAKED = {
  packGz: '89a6a263dfff22fb0415f30de43e5e26dfc51f92a6e1be4896aa799678179ee4',
  packBytes: 21194,
  promptV2: 'a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923',
  input: '1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1',
  assignment: '3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470',
  summary: '4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f',
  result: '580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc',
  consumed: '0.10094232',
  plan: '0.28',
  remaining: '0.17905768',
  reserve15: '0.03251712',
  unitGpt: 0.00411136,
  unitQwen: 0.0018688,
};

const SAME_AS_V2 = [
  'assign.js', 'input-bound.js', 'parse.js', 'prompt.js', 'rubric.js',
  'schema.js', 'slots-object-adapter.js', 'verdict-contract.js', 'README.md',
];

function sha256File(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }
function sha256Text(s) { return createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex'); }
function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function writeJson(p, obj) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
function safeName(id) { return String(id).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json'; }
function nowAsiaShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '') + ' Asia/Shanghai (CST)';
}
function money(n) { return Math.round(n * 1e9) / 1e9; }

function stubCounter() {
  return function countTokens() { return 800; };
}

function officialDeclaredLookup() {
  const officialPlan = readJson(join(EVIDENCE, 'judge-run/plan.json'));
  const map = new Map();
  for (const row of officialPlan.inputChecks) {
    map.set(row.judgeId + '\n' + row.id, row.declaredTokens);
  }
  return function countTokens(body) {
    const req = JSON.parse(body);
    let itemId = null;
    try { itemId = JSON.parse(req.messages[1].content).itemId; } catch (_) {}
    const judgeId = req.model === 'openai/gpt-4.1-mini' ? 'judge-a'
      : req.model === 'qwen/qwen3-235b-a22b-2507' ? 'judge-b' : null;
    const n = map.get(judgeId + '\n' + itemId);
    if (!Number.isInteger(n) || n < 0) return -1;
    return n;
  };
}

function fakeEnv() {
  return {
    JUDGE_OPENROUTER_URL: 'http://127.0.0.1:9/v1/chat/completions',
    JUDGE_OPENROUTER_KEY: 'test-not-a-real-key',
  };
}

function loadOfficialContent(judgeId, itemId) {
  const p = join(EVIDENCE, 'judge-run/responses', judgeId, safeName(itemId));
  return readJson(p).content;
}

async function main() {
  const createdAt = nowAsiaShanghai();
  const requirePack = createRequire(pathToFileURL(join(PACK, 'run-judge.js')));
  const { runJudge } = requirePack(join(PACK, 'run-judge.js'));
  const { rubricText } = requirePack(join(PACK, 'verdict-contract.js'));
  const { promptTemplateSha256, ASR_VERSION } = requirePack(join(PACK, 'rubric.js'));
  const { reserveFor, validateConfig } = requirePack(join(PACK, 'schema.js'));
  const checks = [];
  function rec(id, ok, detail, severity) {
    checks.push({ id, ok: !!ok, severity: severity || (ok ? 'info' : 'fail'), detail });
  }

  // --- pack identity ---
  const gz = join(VERIFY, 'pack-src/01M7BYBRDRFCHNC7FXJJV8A3GE.gz');
  rec('pack-sha-size', sha256File(gz) === BAKED.packGz && readFileSync(gz).length === BAKED.packBytes,
    { sha256: sha256File(gz), bytes: readFileSync(gz).length });
  rec('prompt-sha', promptTemplateSha256() === BAKED.promptV2 && sha256Text(rubricText()) === BAKED.promptV2,
    { promptTemplateSha256: promptTemplateSha256(), rubricText: sha256Text(rubricText()), asr: ASR_VERSION });
  const same = {};
  let allSame = true;
  for (const name of SAME_AS_V2) {
    const a = sha256File(join(PACK, name));
    const b = sha256File(join(V2_PACK, name));
    same[name] = { sha256: a, same: a === b };
    if (a !== b) allSame = false;
  }
  rec('v2-同源-prompt-contract-parser-scoring-assign-schema', allSame, same, allSame ? 'info' : 'critical');
  rec('run-judge-changed-only-plus-docs',
    sha256File(join(PACK, 'run-judge.js')) !== sha256File(join(V2_PACK, 'run-judge.js'))
    && sha256File(join(PACK, 'llm-judge.md')) !== sha256File(join(V2_PACK, 'llm-judge.md')),
    { runJudge: sha256File(join(PACK, 'run-judge.js')), llm: sha256File(join(PACK, 'llm-judge.md')) });

  // --- adapt allowlist to selection.v1 only ---
  const allow = readJson(ALLOWLIST);
  const pairs = allow.pairs.map((p) => ({ itemId: p.itemId, judgeId: p.judgeId }));
  rec('allowlist-15-counts', pairs.length === 15
    && pairs.filter((p) => p.judgeId === 'judge-a').length === 2
    && pairs.filter((p) => p.judgeId === 'judge-b').length === 13,
    { n: pairs.length, gpt: pairs.filter((p) => p.judgeId === 'judge-a').length, qwen: pairs.filter((p) => p.judgeId === 'judge-b').length });
  const selection = { schema: 'belliedmonkey.llm-judge.selection.v1', pairs };
  const selectionPath = join(VERIFY, 'selection/selection-15.json');
  writeJson(selectionPath, selection);
  const canonical = JSON.stringify({ schema: selection.schema, pairs });
  const selectionSha = sha256Text(canonical);
  rec('selection-schema-only', Object.keys(selection).join(',') === 'schema,pairs' && selection.schema === 'belliedmonkey.llm-judge.selection.v1',
    { selectionSha256Canonical: selectionSha, path: selectionPath });

  // --- config: same prices/models/tokens except budget and caps for 15 ---
  const officialCfg = readJson(OFFICIAL_CFG);
  const config = JSON.parse(JSON.stringify(officialCfg));
  config.budgetUsd = 0.17905768;
  config.prices.maxRequests = 15;
  config.prices.maxTotalTokens = 48000;
  const priced = validateConfig(config);
  rec('config-validates', priced.ok === true, priced.ok ? { seed: priced.seed, budgetUsd: priced.budgetUsd, maxRequests: priced.prices.maxRequests, maxTotalTokens: priced.prices.maxTotalTokens } : priced);
  const packGpt = reserveFor(priced.prices, 'openai/gpt-4.1-mini');
  const packQwen = reserveFor(priced.prices, 'qwen/qwen3-235b-a22b-2507');
  const reserve15 = money(2 * packGpt + 13 * packQwen);
  rec('reserve-15-full-cap', reserve15.toFixed(8) === BAKED.reserve15 && packGpt === BAKED.unitGpt || Number(packGpt.toFixed(8)) === BAKED.unitGpt,
    { packGpt, packQwen, reserve15, expected: BAKED.reserve15, asFixed: reserve15.toFixed(8) });
  rec('reserve-15-exact-8dp', reserve15.toFixed(8) === BAKED.reserve15, { reserve15: reserve15.toFixed(8) });
  rec('reserve-fits-remaining', reserve15 <= 0.17905768, { remaining: BAKED.remaining, reserve15: reserve15.toFixed(8), headroom: (0.17905768 - reserve15).toFixed(8) });
  rec('config-caps-not-72', config.prices.maxRequests === 15 && config.prices.maxTotalTokens === 48000 && officialCfg.prices.maxRequests === 72,
    { maxRequests: config.prices.maxRequests, maxTotalTokens: config.prices.maxTotalTokens, officialMaxRequests: officialCfg.prices.maxRequests });
  rec('config-prices-models-seed-unchanged',
    config.seed === 20261113
    && config.prices.maxInputTokens === 1152
    && config.prices.maxOutputTokens === 2048
    && config.prices.models['openai/gpt-4.1-mini'].inputUsdPerToken === officialCfg.prices.models['openai/gpt-4.1-mini'].inputUsdPerToken
    && config.prices.models['openai/gpt-4.1-mini'].outputUsdPerToken === officialCfg.prices.models['openai/gpt-4.1-mini'].outputUsdPerToken
    && config.prices.models['qwen/qwen3-235b-a22b-2507'].inputUsdPerToken === officialCfg.prices.models['qwen/qwen3-235b-a22b-2507'].inputUsdPerToken
    && config.prices.models['qwen/qwen3-235b-a22b-2507'].outputUsdPerToken === officialCfg.prices.models['qwen/qwen3-235b-a22b-2507'].outputUsdPerToken
    && config.judges[0].model === officialCfg.judges[0].model
    && config.judges[1].model === officialCfg.judges[1].model
    && config.maxRetries === 0,
    { seed: config.seed, models: config.judges.map((j) => j.model) });
  writeJson(join(VERIFY, 'config/config.supplement-budget-remaining.json'), config);

  const input = readJson(join(EVIDENCE, 'input/input-asr-36.json'));
  rec('input-sha', sha256File(join(EVIDENCE, 'input/input-asr-36.json')) === BAKED.input
    && sha256File(FROZEN_INPUT) === BAKED.input, { sha: BAKED.input });

  const officialAssignment = readJson(join(EVIDENCE, 'judge-run/assignment.json'));
  rec('assignment-sha', sha256File(join(EVIDENCE, 'judge-run/assignment.json')) === BAKED.assignment, { sha: BAKED.assignment });

  // --- pack-built prompts must match official v2 stored requests (input-bound.js unchanged) ---
  const { buildPrompt } = requirePack(join(PACK, 'prompt.js'));
  const { requestBody } = requirePack(join(PACK, 'input-bound.js'));
  const { assignItems } = requirePack(join(PACK, 'assign.js'));
  const { validateInput } = requirePack(join(PACK, 'schema.js'));
  const inputCheckItems = validateInput(input);
  const replayAssign = assignItems(inputCheckItems.items, 20261113);
  const byAssign = new Map(replayAssign.map((r) => [r.id, r]));
  const officialByItem = new Map(inputCheckItems.items.map((it) => [it.id, it]));
  let promptMismatch = [];
  for (const judge of config.judges) {
    for (const item of inputCheckItems.items) {
      const row = byAssign.get(item.id);
      const prompt = buildPrompt(item, row);
      const officialReq = readJson(join(EVIDENCE, 'judge-run/requests', judge.id, safeName(item.id)));
      const sameMessages = JSON.stringify(prompt.messages) === JSON.stringify(officialReq.messages);
      const sameCore = officialReq.model === judge.model
        && officialReq.temperature === config.temperature
        && officialReq.seed === config.seed
        && officialReq.maxTokens === config.prices.maxOutputTokens;
      if (!sameMessages || !sameCore) promptMismatch.push({ itemId: item.id, judgeId: judge.id, sameMessages, sameCore });
    }
  }
  rec('pack-prompts-match-official-v2-requests', promptMismatch.length === 0,
    { mismatches: promptMismatch.slice(0, 5), compared: inputCheckItems.items.length * config.judges.length });
  rec('official-declared-tokens-still-under-1152',
    readJson(join(EVIDENCE, 'judge-run/plan.json')).inputChecks.every((c) => c.ok && c.declaredTokens <= 1152)
    && Math.max(...readJson(join(EVIDENCE, 'judge-run/plan.json')).inputChecks.map((c) => c.declaredTokens)) <= 889,
    { note: 'this box has no tiktoken/tokenizers this turn; lookup uses official v2 plan counts only after prompt bytes match' });

  // --- real 36 dry-run with official declared-token lookup (prompt-identical) ---
  const dryDir = join(VERIFY, 'dryrun-real36');
  rmSync(dryDir, { recursive: true, force: true });
  mkdirSync(dryDir, { recursive: true });
  const dry = await runJudge({
    input, config, selection, origin: join(EVIDENCE, 'judge-run'),
    out: dryDir, run: false, synthetic: false,
    countTokens: officialDeclaredLookup(),
  });
  const dryAssign = readJson(join(dryDir, 'assignment.json'));
  const assignEqual = JSON.stringify(dryAssign.items.map((r) => ({ id: r.id, slots: r.slots })))
    === JSON.stringify(officialAssignment.items.map((r) => ({ id: r.id, slots: r.slots })));
  rec('dry-run-code', dry.ok === true && dry.code === 'dry-run' && dry.called === false, { code: dry.code, called: dry.called, ok: dry.ok });
  rec('dry-run-assignment-frozen', assignEqual && dry.plan.seed === 20261113 && dryAssign.items.length === 36,
    { seed: dry.plan.seed, items: dryAssign.items.length, equalOfficial: assignEqual });
  rec('dry-run-selected-15', Array.isArray(dry.plan.selectedPairs) && dry.plan.selectedPairs.length === 15
    && dry.plan.selectionSha256 === selectionSha,
    { selected: dry.plan.selectedPairs && dry.plan.selectedPairs.length, selectionSha256: dry.plan.selectionSha256, expected: selectionSha });
  rec('dry-run-inputChecks-all-ok', Array.isArray(dry.plan.inputChecks) && dry.plan.inputChecks.every((c) => c.ok),
    { n: dry.plan.inputChecks && dry.plan.inputChecks.length, failed: (dry.plan.inputChecks || []).filter((c) => !c.ok).slice(0, 3) });
  const selectedChecks = (dry.plan.inputChecks || []).filter((c) =>
    pairs.some((p) => p.itemId === c.id && p.judgeId === c.judgeId));
  rec('dry-run-15-selected-input-checks-ok', selectedChecks.length === 15 && selectedChecks.every((c) => c.ok),
    { selectedChecks: selectedChecks.length, allInputChecks: dry.plan.inputChecks.length, note: 'pack still input-bound-checks all 72; the 15 selected are all ok' });
  rec('dry-run-prompt-still-v2', dry.plan.promptTemplateSha256 === BAKED.promptV2, { sha: dry.plan.promptTemplateSha256 });
  rec('dry-run-does-not-precompute-held-reserve', dry.usage == null || dry.usage.calls == null,
    { note: 'dry-run returns before reserve loop; reserve 0.03251712 is computed from unit prices × selected 15, not from a pack dry-run field' });

  // helper: unique calls recorder
  function makeTransport(handler) {
    const calls = [];
    const fn = async function transport(req) {
      let itemId = null;
      try { itemId = JSON.parse(req.messages[1].content).itemId; } catch (_) {}
      calls.push({ judgeId: req.judgeId, itemId, model: req.model });
      return handler(req, itemId);
    };
    fn.calls = calls;
    return fn;
  }
  const usageOk = (inp, out, usd) => ({ prompt_tokens: inp, completion_tokens: out, usd });

  // --- only 15 sent; 57 valid not sent ---
  const sentDir = join(VERIFY, 'out/synthetic-15');
  rmSync(sentDir, { recursive: true, force: true });
  const validItem = 'fleurs-public-candidates/en_us/1668'; // official both ok, must NOT be called
  const t15 = makeTransport(async (req, itemId) => ({
    content: loadOfficialContent(req.judgeId, itemId) || '{"not":"used"}',
    responseModel: req.model,
    usage: usageOk(700, 120, 0.001),
    finishReason: 'stop',
    providerError: null,
  }));
  const originRun = join(EVIDENCE, 'judge-run');
  const sum15 = await runJudge({
    input, config, selection, origin: originRun, out: sentDir,
    run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(), transport: t15,
  });
  const sentKeys = t15.calls.map((c) => c.judgeId + '|' + c.itemId).sort();
  const expectKeys = pairs.map((p) => p.judgeId + '|' + p.itemId).sort();
  rec('synthetic-run-sends-only-15', sentKeys.length === 15 && JSON.stringify(sentKeys) === JSON.stringify(expectKeys),
    { sent: sentKeys.length, unexpected: sentKeys.filter((k) => !expectKeys.includes(k)), missing: expectKeys.filter((k) => !sentKeys.includes(k)) });
  rec('synthetic-run-does-not-send-successful-57', !t15.calls.some((c) => c.itemId === validItem),
    { probedSuccessItem: validItem, sent: t15.calls.some((c) => c.itemId === validItem) });
  rec('supplement-code-not-singleRunComplete',
    sum15.singleRunComplete === false && sum15.doubleBlindComplete === false
    && typeof sum15.supplementComplete === 'boolean'
    && (sum15.code === 'supplement-complete' || sum15.code === 'supplement-partial'),
    { code: sum15.code, ok: sum15.ok, singleRunComplete: sum15.singleRunComplete, doubleBlindComplete: sum15.doubleBlindComplete, supplementComplete: sum15.supplementComplete });
  const supp = readJson(join(sentDir, 'supplement.json'));
  rec('supplement-provenance', supp.schema === 'belliedmonkey.llm-judge.supplement.v1'
    && supp.official === false && supp.singleRunComplete === false
    && supp.originSummarySha256 === BAKED.summary
    && supp.selectionSha256 === selectionSha
    && supp.pairs.length === 15,
    { originSummarySha256: supp.originSummarySha256, selectionSha256: supp.selectionSha256, official: supp.official });
  rec('derived-merge-present-and-not-official', existsSync(join(sentDir, 'derived-merge.json'))
    && readJson(join(sentDir, 'derived-merge.json')).official === false
    && readJson(join(sentDir, 'derived-merge.json')).singleRunComplete === false
    && !readJson(join(sentDir, 'derived-merge.json')).results,
    { note: 'derived-merge is a provenance stub, not a merged official results table' });
  rec('origin-summary-untouched-when-out-differs', sha256File(join(EVIDENCE, 'judge-run/summary.json')) === BAKED.summary,
    { sha: BAKED.summary });

  // --- classification fixtures: run one pair at a time ---
  async function runOnePair(itemId, judgeId, bodyBuilder, extraCfg) {
    const sel = { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId, judgeId }] };
    const calls = [];
    const dir = mkdtempSync(join(tmpdir(), 'judge-fix-'));
    const cfg = extraCfg || config;
    const transport = async function (req) {
      calls.push(req);
      return bodyBuilder(req);
    };
    const summary = await runJudge({
      input, config: cfg, selection: sel, origin: originRun, out: dir,
      run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(), transport,
    });
    const call = summary.usage && summary.usage.calls && summary.usage.calls[0];
    const parsed = existsSync(join(dir, 'parsed', judgeId, safeName(itemId)))
      ? readJson(join(dir, 'parsed', judgeId, safeName(itemId)))
      : null;
    return { summary, call, parsed, calls, dir };
  }

  // Use official failure contents
  const caseStopJson = await runOnePair(
    'fleurs-public-candidates/en_us/1673', 'judge-a',
    () => ({ content: loadOfficialContent('judge-a', 'fleurs-public-candidates/en_us/1673'), usage: usageOk(743, 328, 0.0008), finishReason: 'stop', providerError: null }),
  );
  rec('fixture-stop-illegal-json-modelFormatFault',
    caseStopJson.call && caseStopJson.call.finishReason === 'stop'
    && caseStopJson.call.modelFormatFault === true
    && caseStopJson.call.parseCode === 'bad-json'
    && caseStopJson.parsed && caseStopJson.parsed.ok === false
    && caseStopJson.summary.supplementComplete === false,
    { parseCode: caseStopJson.call && caseStopJson.call.parseCode, modelFormatFault: caseStopJson.call && caseStopJson.call.modelFormatFault, generationOk: caseStopJson.call && caseStopJson.call.generationOk });

  const caseError = await runOnePair(
    'fleurs-public-candidates/cmn_hans_cn/1673', 'judge-b',
    () => ({ content: loadOfficialContent('judge-b', 'fleurs-public-candidates/cmn_hans_cn/1673'), usage: usageOk(744, 137, 0), finishReason: 'error', providerError: { message: 'provider error' } }),
  );
  rec('fixture-error-incomplete-not-modelFormatFault',
    caseError.call && caseError.call.finishReason === 'error'
    && caseError.call.modelFormatFault === false
    && caseError.call.generationOk === false
    && caseError.parsed && caseError.parsed.ok === false
    && caseError.call.parseCode === 'bad-json',
    { parseCode: caseError.call && caseError.call.parseCode, modelFormatFault: caseError.call && caseError.call.modelFormatFault, generationOk: caseError.call && caseError.call.generationOk, providerError: caseError.call && caseError.call.providerError });

  const caseLength = await runOnePair(
    'fleurs-public-candidates/cmn_hans_cn/1673', 'judge-b',
    () => ({ content: loadOfficialContent('judge-b', 'fleurs-public-candidates/cmn_hans_cn/1673'), usage: usageOk(744, 137, 0.0002), finishReason: 'length', providerError: null }),
  );
  rec('fixture-length-not-modelFormatFault',
    caseLength.call && caseLength.call.finishReason === 'length'
    && caseLength.call.modelFormatFault === false
    && caseLength.call.generationOk === true
    && caseLength.parsed && caseLength.parsed.ok === false
    && caseLength.call.parseCode === 'bad-json',
    { parseCode: caseLength.call && caseLength.call.parseCode, modelFormatFault: caseLength.call && caseLength.call.modelFormatFault, generationOk: caseLength.call && caseLength.call.generationOk });

  const caseNote = await runOnePair(
    'fleurs-public-candidates/cmn_hans_cn/1674', 'judge-b',
    () => ({ content: loadOfficialContent('judge-b', 'fleurs-public-candidates/cmn_hans_cn/1674'), usage: usageOk(723, 178, 0.00015), finishReason: 'stop', providerError: null }),
  );
  rec('fixture-missing-note-parseCode-not-formatFault',
    caseNote.call && caseNote.call.parseCode === 'note'
    && caseNote.call.modelFormatFault === false
    && caseNote.parsed && caseNote.parsed.ok === false
    && caseNote.call.finishReason === 'stop',
    { parseCode: caseNote.call && caseNote.call.parseCode, modelFormatFault: caseNote.call && caseNote.call.modelFormatFault });

  const caseQuote = await runOnePair(
    'ascend/00055', 'judge-b',
    () => ({ content: loadOfficialContent('judge-b', 'ascend/00055'), usage: usageOk(688, 309, 0.0002), finishReason: 'stop', providerError: null }),
  );
  rec('fixture-quote-parseCode-not-formatFault',
    caseQuote.call && caseQuote.call.parseCode === 'quote'
    && caseQuote.call.modelFormatFault === false
    && caseQuote.parsed && caseQuote.parsed.ok === false,
    { parseCode: caseQuote.call && caseQuote.call.parseCode, modelFormatFault: caseQuote.call && caseQuote.call.modelFormatFault });

  // missing usage: two pairs in selection, first missing usage should stop and not send the second
  const missingSel = {
    schema: 'belliedmonkey.llm-judge.selection.v1',
    pairs: [
      { itemId: 'fleurs-public-candidates/cmn_hans_cn/1671', judgeId: 'judge-a' },
      { itemId: 'fleurs-public-candidates/en_us/1673', judgeId: 'judge-a' },
    ],
  };
  // iteration is by planned item order then judges; 1671 appears before 1673 in input? check order
  // We'll record all calls; if stop works, only first of the two in iteration order is sent after missing usage.
  const missDir = mkdtempSync(join(tmpdir(), 'judge-miss-'));
  const missCalls = [];
  const missSum = await runJudge({
    input, config, selection: missingSel, origin: originRun, out: missDir,
    run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function (req) {
      let itemId = JSON.parse(req.messages[1].content).itemId;
      missCalls.push({ judgeId: req.judgeId, itemId });
      return {
        content: loadOfficialContent(req.judgeId, itemId),
        usage: null,
        finishReason: 'stop',
        providerError: null,
      };
    },
  });
  rec('fixture-missing-usage-keeps-reserve-and-stops',
    missSum.code === 'budget-unknown'
    && missSum.usage.costUnknown === true
    && missCalls.length === 1
    && missSum.usage.settledUsd === null
    && missSum.usage.calls[0].settledUsd === null
    && missSum.usage.calls[0].reserveUsd > 0
    && Number(missSum.usage.spentUsd.toFixed(8)) === Number(missSum.usage.calls[0].reserveUsd.toFixed(8)),
    { code: missSum.code, calls: missCalls, spentUsd: missSum.usage && missSum.usage.spentUsd, costUnknown: missSum.usage && missSum.usage.costUnknown, reserve: missSum.usage && missSum.usage.calls[0] && missSum.usage.calls[0].reserveUsd });

  // 0usd must not be treated as free: tokens billed at envelope
  const zeroUsd = await runOnePair(
    'fleurs-public-candidates/en_us/1668', 'judge-a',
    () => ({
      content: loadOfficialContent('judge-a', 'fleurs-public-candidates/en_us/1668'),
      usage: usageOk(700, 100, 0),
      finishReason: 'stop',
      providerError: null,
    }),
  );
  const expectedSettle = money(700 * 4.4e-7 + 100 * 1.76e-6);
  rec('fixture-0usd-not-free-envelope-settle',
    zeroUsd.call && zeroUsd.call.providerUsd === 0
    && zeroUsd.call.settledUsd !== 0
    && zeroUsd.call.settledUsd === expectedSettle
    && zeroUsd.summary.usage.providerUsdIgnored === true,
    { providerUsd: zeroUsd.call && zeroUsd.call.providerUsd, settledUsd: zeroUsd.call && zeroUsd.call.settledUsd, expectedSettle, parseOk: zeroUsd.parsed && zeroUsd.parsed.ok });

  // --- fail-closed selection errors: must not call transport ---
  async function expectBlock(label, sel, expectCode, origin) {
    let called = 0;
    const dir = mkdtempSync(join(tmpdir(), 'judge-blk-'));
    const summary = await runJudge({
      input, config, selection: sel, origin: origin === undefined ? originRun : origin, out: dir,
      run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
      transport: async function () { called += 1; throw new Error('should-not-call'); },
    });
    rec(label, summary.called === false && called === 0 && summary.code === expectCode,
      { code: summary.code, called: summary.called, transportCalls: called, expected: expectCode },
      summary.called || called ? 'critical' : 'info');
    return summary;
  }
  await expectBlock('reject-missing-item', { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: 'no-such-item', judgeId: 'judge-a' }] }, 'selection');
  await expectBlock('reject-invalid-judge', { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: 'ascend/00009', judgeId: 'judge-z' }] }, 'selection');
  await expectBlock('reject-duplicate-pair', { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [
    { itemId: 'ascend/00009', judgeId: 'judge-b' },
    { itemId: 'ascend/00009', judgeId: 'judge-b' },
  ] }, 'selection');
  await expectBlock('reject-wrong-schema', { schema: 'belliedmonkey.llm-judge.selection.v0', pairs: [{ itemId: 'ascend/00009', judgeId: 'judge-b' }] }, 'selection');
  await expectBlock('reject-empty-pairs', { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [] }, 'selection');
  await expectBlock('reject-origin-missing', { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: 'ascend/00009', judgeId: 'judge-b' }] }, 'origin-missing', join(tmpdir(), 'no-such-origin-' + Date.now()));

  // successful pair is NOT rejected by the pack (defect)
  const successSel = { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: validItem, judgeId: 'judge-a' }] };
  let successCalls = 0;
  const successDir = mkdtempSync(join(tmpdir(), 'judge-suc-'));
  const successSum = await runJudge({
    input, config, selection: successSel, origin: originRun, out: successDir,
    run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function (req) {
      successCalls += 1;
      return {
        content: loadOfficialContent('judge-a', validItem),
        usage: usageOk(700, 100, 0.001),
        finishReason: 'stop',
        providerError: null,
      };
    },
  });
  rec('reject-successful-origin-pair',
    successCalls === 0 && successSum.called === false && successSum.code === 'selection',
    { transportCalls: successCalls, code: successSum.code, called: successSum.called, note: 'pack does not inspect origin verdicts; a successful pair is sent' },
    'critical');

  // select without origin is allowed on --run (gap)
  let noOriginCalls = 0;
  const noOriginDir = mkdtempSync(join(tmpdir(), 'judge-noorig-'));
  const noOriginSum = await runJudge({
    input, config, selection, origin: null, out: noOriginDir,
    run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function (req) {
      noOriginCalls += 1;
      const itemId = JSON.parse(req.messages[1].content).itemId;
      return { content: loadOfficialContent(req.judgeId, itemId), usage: usageOk(700, 80, 0.001), finishReason: 'stop', providerError: null };
    },
  });
  rec('reject-select-run-without-origin',
    noOriginCalls === 0 && noOriginSum.called === false && (noOriginSum.code === 'origin-missing' || noOriginSum.code === 'selection'),
    { transportCalls: noOriginCalls, code: noOriginSum.code, called: noOriginSum.called, hasDerived: existsSync(join(noOriginDir, 'derived-merge.json')) },
    'critical');

  // wrong origin with some other summary.json is accepted (gap)
  const wrongOrigin = mkdtempSync(join(tmpdir(), 'judge-wrongorig-'));
  writeJson(join(wrongOrigin, 'summary.json'), { ok: true, code: 'not-the-official-v2-summary', note: 'decoy' });
  const decoyHash = sha256File(join(wrongOrigin, 'summary.json'));
  let wrongCalls = 0;
  const wrongOut = mkdtempSync(join(tmpdir(), 'judge-wrongout-'));
  const wrongSum = await runJudge({
    input, config, selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: 'ascend/00009', judgeId: 'judge-b' }] },
    origin: wrongOrigin, out: wrongOut,
    run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function () {
      wrongCalls += 1;
      return { content: loadOfficialContent('judge-b', 'ascend/00009'), usage: usageOk(697, 80, 0.001), finishReason: 'stop', providerError: null };
    },
  });
  rec('reject-wrong-origin-hash',
    wrongCalls === 0 && wrongSum.called === false && wrongSum.code !== 'supplement-partial' && wrongSum.code !== 'supplement-complete',
    { transportCalls: wrongCalls, code: wrongSum.code, decoyHash, originRecorded: wrongSum.provenance && wrongSum.provenance.originSummarySha256 },
    'critical');

  // seed/assignment not checked against origin (blinding gap)
  const badSeedCfg = JSON.parse(JSON.stringify(config));
  badSeedCfg.seed = 1;
  let seedCalls = 0;
  const seedOut = mkdtempSync(join(tmpdir(), 'judge-seed-'));
  const seedSum = await runJudge({
    input, config: badSeedCfg, selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: 'ascend/00009', judgeId: 'judge-b' }] },
    origin: originRun, out: seedOut,
    run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function () {
      seedCalls += 1;
      return { content: '{"schema":"x"}', usage: usageOk(700, 80, 0.001), finishReason: 'stop', providerError: null };
    },
  });
  const seedAssign = readJson(join(seedOut, 'assignment.json'));
  const officialSlots = officialAssignment.items.find((r) => r.id === 'ascend/00009').slots;
  const newSlots = seedAssign.items.find((r) => r.id === 'ascend/00009').slots;
  const slotsChanged = JSON.stringify(officialSlots) !== JSON.stringify(newSlots);
  rec('reject-seed-change-vs-frozen-assignment',
    seedCalls === 0 && seedSum.called === false,
    { transportCalls: seedCalls, code: seedSum.code, officialSlots, newSlots, slotsChanged },
    'critical');

  // overwrite: out === origin
  const originCopy = mkdtempSync(join(tmpdir(), 'judge-origcopy-'));
  writeJson(join(originCopy, 'summary.json'), { ok: false, code: 'partial', marker: 'ORIGIN-MUST-STAY', promptTemplateSha256: 'keep' });
  const originBefore = readJson(join(originCopy, 'summary.json'));
  const overSum = await runJudge({
    input, config, selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: 'ascend/00009', judgeId: 'judge-b' }] },
    origin: originCopy, out: originCopy,
    run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function () {
      return { content: loadOfficialContent('judge-b', 'ascend/00009'), usage: usageOk(697, 80, 0.001), finishReason: 'stop', providerError: null };
    },
  });
  const originAfter = readJson(join(originCopy, 'summary.json'));
  const overwritten = originAfter.marker !== 'ORIGIN-MUST-STAY';
  rec('reject-out-equals-origin-overwrite',
    overwritten === false && overSum.code !== 'supplement-complete' && overSum.code !== 'supplement-partial' && overSum.called === false,
    { overwritten, afterCode: originAfter.code, afterMarker: originAfter.marker, runCode: overSum.code, called: overSum.called },
    'critical');

  // existing non-empty out dir overwrite (not origin)
  const existingOut = mkdtempSync(join(tmpdir(), 'judge-existout-'));
  writeJson(join(existingOut, 'summary.json'), { marker: 'PREEXISTING' });
  const existSum = await runJudge({
    input, config, selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: 'ascend/00009', judgeId: 'judge-b' }] },
    origin: originRun, out: existingOut,
    run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function () {
      return { content: loadOfficialContent('judge-b', 'ascend/00009'), usage: usageOk(697, 80, 0.001), finishReason: 'stop', providerError: null };
    },
  });
  const existAfter = readJson(join(existingOut, 'summary.json'));
  rec('reject-existing-out-overwrite',
    existAfter.marker === 'PREEXISTING' && existSum.called === false,
    { markerAfter: existAfter.marker, code: existSum.code, called: existSum.called },
    'critical');

  // official evidence still pinned
  rec('official-evidence-unchanged',
    sha256File(join(EVIDENCE, 'judge-run/summary.json')) === BAKED.summary
    && sha256File(join(EVIDENCE, 'ledger/RESULT.json')) === BAKED.result
    && sha256File(join(EVIDENCE, 'judge-run/assignment.json')) === BAKED.assignment,
    { summary: BAKED.summary });

  const criticalFails = checks.filter((c) => c.severity === 'critical' && !c.ok);
  const otherFails = checks.filter((c) => c.severity !== 'critical' && !c.ok);
  const passed = criticalFails.length === 0 && otherFails.length === 0;
  const result = {
    ok: passed,
    passed,
    createdAt,
    pack: { sha256: BAKED.packGz, bytes: BAKED.packBytes, id: '01M7BYBRDRFCHNC7FXJJV8A3GE' },
    promptTemplateSha256: BAKED.promptV2,
    selectionSha256Canonical: selectionSha,
    reserve15: reserve15.toFixed(8),
    budgetUsd: 0.17905768,
    criticalFails: criticalFails.map((c) => c.id),
    otherFails: otherFails.map((c) => c.id),
    checks,
  };
  writeJson(join(VERIFY, 'out/verify-results.json'), result);
  return result;
}

main().then((result) => {
  process.stdout.write(JSON.stringify({
    ok: result.ok,
    passed: result.passed,
    criticalFails: result.criticalFails,
    otherFails: result.otherFails,
    reserve15: result.reserve15,
    selectionSha256Canonical: result.selectionSha256Canonical,
    checkCount: result.checks.length,
    passedCount: result.checks.filter((c) => c.ok).length,
  }, null, 2) + '\n');
  process.exit(result.ok ? 0 : 2);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
