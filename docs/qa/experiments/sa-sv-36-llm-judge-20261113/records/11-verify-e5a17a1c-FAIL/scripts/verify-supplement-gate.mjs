#!/usr/bin/env node
'use strict';

/**
 * Independent offline minimal re-verify of pack 01M7BZMPXBWB0C6952HYQ3SNY3 / e5a17a1c.
 * No network, no secrets, no paid calls, no repo or official-evidence writes.
 * The 75266d0a pack remains permanently failed and is not used as a runner.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync,
  mkdtempSync, symlinkSync, realpathSync,
} from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = resolve(HERE, '..');
const JUDGE_PREP = resolve(VERIFY, '..');
const PACK = join(VERIFY, 'pack-unpacked');
const EVIDENCE = join(JUDGE_PREP, 'v2-real-run-20261114-0015/evidence/llm-judge-v2-real-20261114-0015');
const ORIGIN = join(EVIDENCE, 'judge-run');
const FROZEN_INPUT = join(JUDGE_PREP, 'input-asr-36.json');
const V2_PACK = join(JUDGE_PREP, 'v2-offline-diag-20261114/pack-unpacked');
const OLD_SEL = join(JUDGE_PREP, 'verify-75266d0a-observe/selection/selection-15.json');
const OFFICIAL_CFG = join(EVIDENCE, 'config/config.formal-run-budget-remaining.json');

const BAKED = {
  packGz: 'a44cf59f13febe3232519c08314166d9570b753151d85860058cd8031121a4fb',
  packBytes: 23824,
  promptV2: 'a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923',
  input: '1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1',
  assignmentFile: '3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470',
  assignmentCanonical: '3cffd11608d4cf4f721ca410cbd93a2a183d1cc7f2f6659e581524e79fb5f52e',
  summary: '4744aef13ff5ce3a30680be4fb42604db044073a3e317202c09339d24934365f',
  result: '580da9aaa0107c3ec54939f2e4782334de3da6ca96b0600441235a57896169bc',
  selectionCanonical: 'c151018bfda2953d2375f8cfce25580787745f162824b66f2d7eccec641979a4',
  remaining: 0.17905768,
  reserve15: '0.03251712',
  seed: 20261113,
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
function money(n) { return Math.round(n * 1e9) / 1e9; }
function emptyDir() {
  const d = mkdtempSync(join(tmpdir(), 'gate-out-'));
  return d;
}
function stubCounter() { return function countTokens() { return 800; }; }
function fakeEnv() {
  return {
    JUDGE_OPENROUTER_URL: 'http://127.0.0.1:9/v1/chat/completions',
    JUDGE_OPENROUTER_KEY: 'test-not-a-real-key',
  };
}
function loadOfficialContent(judgeId, itemId) {
  return readJson(join(EVIDENCE, 'judge-run/responses', judgeId, safeName(itemId))).content;
}
function officialDeclaredLookup() {
  const officialPlan = readJson(join(EVIDENCE, 'judge-run/plan.json'));
  const map = new Map();
  for (const row of officialPlan.inputChecks) map.set(row.judgeId + '\n' + row.id, row.declaredTokens);
  return function countTokens(body) {
    const req = JSON.parse(body);
    let itemId = null;
    try { itemId = JSON.parse(req.messages[1].content).itemId; } catch (_) {}
    const judgeId = req.model === 'openai/gpt-4.1-mini' ? 'judge-a'
      : req.model === 'qwen/qwen3-235b-a22b-2507' ? 'judge-b' : null;
    const n = map.get(judgeId + '\n' + itemId);
    return Number.isInteger(n) && n >= 0 ? n : -1;
  };
}

async function main() {
  const requirePack = createRequire(pathToFileURL(join(PACK, 'run-judge.js')));
  const { runJudge, assignmentDigest } = requirePack(join(PACK, 'run-judge.js'));
  const { rubricText } = requirePack(join(PACK, 'verdict-contract.js'));
  const { promptTemplateSha256 } = requirePack(join(PACK, 'rubric.js'));
  const { reserveFor, validateConfig, validateInput } = requirePack(join(PACK, 'schema.js'));
  const { assignItems } = requirePack(join(PACK, 'assign.js'));
  const { buildPrompt } = requirePack(join(PACK, 'prompt.js'));
  const checks = [];
  function rec(id, ok, detail, severity) {
    checks.push({ id, ok: !!ok, severity: severity || (ok ? 'info' : 'fail'), detail });
  }

  const gz = join(VERIFY, 'pack-src/01M7BZMPXBWB0C6952HYQ3SNY3.gz');
  rec('pack-sha-size', sha256File(gz) === BAKED.packGz && readFileSync(gz).length === BAKED.packBytes,
    { sha256: sha256File(gz), bytes: readFileSync(gz).length });
  rec('prompt-sha', promptTemplateSha256() === BAKED.promptV2 && sha256Text(rubricText()) === BAKED.promptV2,
    { promptTemplateSha256: promptTemplateSha256() });
  let allSame = true;
  const same = {};
  for (const name of SAME_AS_V2) {
    const a = sha256File(join(PACK, name));
    const b = sha256File(join(V2_PACK, name));
    same[name] = a === b;
    if (a !== b) allSame = false;
  }
  rec('v2-同源-contract-parser-scoring', allSame, same, allSame ? 'info' : 'critical');
  rec('run-judge-new-not-75266d0a',
    sha256File(join(PACK, 'run-judge.js')) === '9d884e732cdcfd0cbbbf57141e23e2e678fd70da904e8636f5eec4b7fca6f750'
    && sha256File(join(PACK, 'run-judge.js')) !== 'd58e7e26dd8012b13c8ae6f02b4878d5855cb7f68c32945e30f45bb3937e9c6e',
    { runJudge: sha256File(join(PACK, 'run-judge.js')) });

  const inputPath = join(EVIDENCE, 'input/input-asr-36.json');
  rec('input-sha', sha256File(inputPath) === BAKED.input && sha256File(FROZEN_INPUT) === BAKED.input, { sha: BAKED.input });
  rec('assignment-file-sha', sha256File(join(EVIDENCE, 'judge-run/assignment.json')) === BAKED.assignmentFile, { sha: BAKED.assignmentFile });
  rec('origin-summary-sha', sha256File(join(ORIGIN, 'summary.json')) === BAKED.summary, { sha: BAKED.summary });

  const input = readJson(inputPath);
  const inputSha256 = sha256File(inputPath);
  const officialAssignment = readJson(join(EVIDENCE, 'judge-run/assignment.json'));
  const inputCheck = validateInput(input);
  const replayed = assignItems(inputCheck.items, BAKED.seed);
  const canon = assignmentDigest(BAKED.seed, replayed);
  rec('assignment-canonical-sha', canon === BAKED.assignmentCanonical && canon === assignmentDigest(officialAssignment.seed, officialAssignment.items) && canon !== BAKED.assignmentFile,
    { canonical: canon, fileSha: BAKED.assignmentFile });

  // selection frozen
  const selection = readJson(OLD_SEL);
  const selectionCanonical = sha256Text(JSON.stringify({ schema: selection.schema, pairs: selection.pairs }));
  rec('selection-frozen-canonical', selectionCanonical === BAKED.selectionCanonical && selection.pairs.length === 15
    && selection.pairs.filter((p) => p.judgeId === 'judge-a').length === 2
    && selection.pairs.filter((p) => p.judgeId === 'judge-b').length === 13,
    { selectionCanonical, n: selection.pairs.length });
  writeJson(join(VERIFY, 'selection/selection-15.json'), selection);

  // official 57/15 from parsed, must match summary and frozen selection
  const failedPairs = [];
  const succeededPairs = [];
  for (const judgeId of ['judge-a', 'judge-b']) {
    for (const item of inputCheck.items) {
      const parsed = readJson(join(EVIDENCE, 'judge-run/parsed', judgeId, safeName(item.id)));
      const pair = { itemId: item.id, judgeId };
      if (parsed.ok) succeededPairs.push(pair);
      else failedPairs.push(pair);
    }
  }
  const selKeys = new Set(selection.pairs.map((p) => p.judgeId + '\n' + p.itemId));
  const failKeys = new Set(failedPairs.map((p) => p.judgeId + '\n' + p.itemId));
  const summary = readJson(join(ORIGIN, 'summary.json'));
  let summaryOk = 0;
  let summaryFail = 0;
  let summaryMismatch = 0;
  for (const row of summary.results) {
    for (const judgeId of ['judge-a', 'judge-b']) {
      const ok = !!(row.judges[judgeId] && row.judges[judgeId].schema === 'belliedmonkey.llm-judge.verdict.v2');
      if (ok) summaryOk += 1; else summaryFail += 1;
      const inFail = failKeys.has(judgeId + '\n' + row.id);
      if (ok === inFail) summaryMismatch += 1;
    }
  }
  rec('origin-parsed-57-15-matches-summary-and-selection',
    succeededPairs.length === 57 && failedPairs.length === 15
    && [...selKeys].every((k) => failKeys.has(k)) && failKeys.size === selKeys.size
    && summaryOk === 57 && summaryFail === 15 && summaryMismatch === 0,
    { succeeded: succeededPairs.length, failed: failedPairs.length, summaryOk, summaryFail, summaryMismatch });

  const lock = {
    schema: 'belliedmonkey.llm-judge.origin-lock.v1',
    summarySha256: BAKED.summary,
    inputSha256: BAKED.input,
    promptTemplateSha256: BAKED.promptV2,
    seed: BAKED.seed,
    models: {
      'judge-a': 'openai/gpt-4.1-mini',
      'judge-b': 'qwen/qwen3-235b-a22b-2507',
    },
    assignmentSha256: BAKED.assignmentCanonical,
    failedPairs,
    succeededPairs,
  };
  writeJson(join(VERIFY, 'lock/origin-lock.json'), lock);

  const officialCfg = readJson(OFFICIAL_CFG);
  const config = JSON.parse(JSON.stringify(officialCfg));
  config.budgetUsd = BAKED.remaining;
  config.prices.maxRequests = 15;
  config.prices.maxTotalTokens = 48000;
  const priced = validateConfig(config);
  const packGpt = reserveFor(priced.prices, 'openai/gpt-4.1-mini');
  const packQwen = reserveFor(priced.prices, 'qwen/qwen3-235b-a22b-2507');
  const reserve15 = money(2 * packGpt + 13 * packQwen);
  rec('config-and-reserve', priced.ok && config.prices.maxRequests === 15 && config.prices.maxTotalTokens === 48000
    && config.maxRetries === 0 && config.seed === BAKED.seed
    && reserve15.toFixed(8) === BAKED.reserve15 && reserve15 <= BAKED.remaining,
    { reserve15: reserve15.toFixed(8), budgetUsd: config.budgetUsd, packGpt, packQwen });
  writeJson(join(VERIFY, 'config/config.supplement-budget-remaining.json'), config);

  // prompt identity vs official requests
  let promptMismatch = [];
  for (const judge of config.judges) {
    for (const item of inputCheck.items) {
      const row = replayed.find((r) => r.id === item.id);
      const prompt = buildPrompt(item, row);
      const officialReq = readJson(join(EVIDENCE, 'judge-run/requests', judge.id, safeName(item.id)));
      if (JSON.stringify(prompt.messages) !== JSON.stringify(officialReq.messages)
        || officialReq.model !== judge.model || officialReq.seed !== config.seed
        || officialReq.maxTokens !== config.prices.maxOutputTokens) {
        promptMismatch.push({ itemId: item.id, judgeId: judge.id });
      }
    }
  }
  rec('pack-prompts-match-official-v2-requests', promptMismatch.length === 0, { n: promptMismatch.length });

  const baseOpts = {
    input, config, selection, origin: ORIGIN, originLock: lock, inputSha256,
    countTokens: officialDeclaredLookup(),
  };

  // dry-run
  const dryDir = join(VERIFY, 'dryrun-real36');
  rmSync(dryDir, { recursive: true, force: true });
  mkdirSync(dryDir, { recursive: true });
  const dry = await runJudge(Object.assign({}, baseOpts, { out: dryDir, run: false, synthetic: false }));
  const dryAssign = readJson(join(dryDir, 'assignment.json'));
  rec('dry-run-code-and-15-selected', dry.ok === true && dry.code === 'dry-run' && dry.called === false
    && Array.isArray(dry.plan.selectedPairs) && dry.plan.selectedPairs.length === 15
    && dry.plan.selectionSha256 === BAKED.selectionCanonical
    && dry.plan.promptTemplateSha256 === BAKED.promptV2,
    { code: dry.code, called: dry.called, selected: dry.plan && dry.plan.selectedPairs && dry.plan.selectedPairs.length, selSha: dry.plan && dry.plan.selectionSha256 });
  rec('dry-run-assignment-frozen', sha256File(join(dryDir, 'assignment.json')) === BAKED.assignmentFile
    || JSON.stringify(dryAssign.items) === JSON.stringify(officialAssignment.items),
    { itemsEqual: JSON.stringify(dryAssign.items) === JSON.stringify(officialAssignment.items), fileSha: sha256File(join(dryDir, 'assignment.json')) });
  const selectedChecks = (dry.plan.inputChecks || []).filter((c) => selKeys.has(c.judgeId + '\n' + c.id));
  rec('dry-run-inputBounds', Array.isArray(dry.plan.inputChecks) && dry.plan.inputChecks.every((c) => c.ok)
    && selectedChecks.length === 15 && selectedChecks.every((c) => c.ok)
    && Math.max(...dry.plan.inputChecks.map((c) => c.declaredTokens)) <= 889,
    { all: dry.plan.inputChecks && dry.plan.inputChecks.length, selected: selectedChecks.length, min: Math.min(...(dry.plan.inputChecks || []).map((c) => c.declaredTokens)), max: Math.max(...(dry.plan.inputChecks || []).map((c) => c.declaredTokens)) });

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

  // synthetic 15 only
  const sentDir = emptyDir();
  const t15 = makeTransport(async (req, itemId) => ({
    content: loadOfficialContent(req.judgeId, itemId),
    responseModel: req.model,
    usage: usageOk(700, 120, 0.001),
    finishReason: 'stop',
    providerError: null,
  }));
  const sum15 = await runJudge(Object.assign({}, baseOpts, {
    out: sentDir, run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(), transport: t15,
  }));
  const sentKeys = t15.calls.map((c) => c.judgeId + '|' + c.itemId).sort();
  const expectKeys = selection.pairs.map((p) => p.judgeId + '|' + p.itemId).sort();
  rec('synthetic-sends-only-15-not-57', sentKeys.length === 15 && JSON.stringify(sentKeys) === JSON.stringify(expectKeys)
    && !t15.calls.some((c) => c.itemId === 'fleurs-public-candidates/en_us/1668'),
    { sent: sentKeys.length, unexpected: sentKeys.filter((k) => !expectKeys.includes(k)) });
  rec('supplement-complete-does-not-set-original-complete',
    sum15.singleRunComplete === false && sum15.doubleBlindComplete === false
    && (sum15.code === 'supplement-complete' || sum15.code === 'supplement-partial')
    && sum15.supplementComplete === (sum15.code === 'supplement-complete'),
    { code: sum15.code, ok: sum15.ok, singleRunComplete: sum15.singleRunComplete, doubleBlindComplete: sum15.doubleBlindComplete, supplementComplete: sum15.supplementComplete });

  // derived sources: may be partial because official failure contents often still don't parse
  const derived = readJson(join(sentDir, 'derived-merge.json'));
  const originRows = (derived.pairs || []).filter((r) => r.source === 'origin');
  const suppRows = (derived.pairs || []).filter((r) => r.source === 'supplement');
  const originKeys = new Set(originRows.map((r) => r.judgeId + '\n' + r.itemId));
  const succKeys = new Set(succeededPairs.map((p) => p.judgeId + '\n' + p.itemId));
  rec('derived-cites-origin-57-no-cherrypick',
    derived.official === false && derived.singleRunComplete === false && derived.originSingleRunComplete === false
    && derived.coverage && derived.coverage.cherryPick === false
    && derived.coverage.originKept === 57 && originRows.length === 57
    && [...succKeys].every((k) => originKeys.has(k))
    && originRows.every((r) => r.originKept === true && r.verdict === null)
    && suppRows.length === 15 && suppRows.every((r) => r.originKept === false)
    && suppRows.filter((r) => r.verdict == null).length === derived.coverage.supplementNull,
    { originKept: derived.coverage && derived.coverage.originKept, originRows: originRows.length, suppRows: suppRows.length, suppNull: derived.coverage && derived.coverage.supplementNull, cherryPick: derived.coverage && derived.coverage.cherryPick });

  rec('origin-untouched-when-out-differs', sha256File(join(ORIGIN, 'summary.json')) === BAKED.summary, { sha: BAKED.summary });

  // missing usage fail-closed
  const missSel = { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [
    { itemId: 'fleurs-public-candidates/cmn_hans_cn/1671', judgeId: 'judge-a' },
    { itemId: 'fleurs-public-candidates/en_us/1673', judgeId: 'judge-a' },
  ] };
  const missLock = Object.assign({}, lock, { failedPairs: missSel.pairs.concat(lock.failedPairs.filter((p) => !(p.itemId === 'fleurs-public-candidates/en_us/1673' && p.judgeId === 'judge-a') && !(p.itemId === 'fleurs-public-candidates/cmn_hans_cn/1671' && p.judgeId === 'judge-a'))), succeededPairs: lock.succeededPairs });
  // wait - those two are already in failedPairs. Just use full honest lock + subset selection of two official failures.
  const missCalls = [];
  const missSum = await runJudge(Object.assign({}, baseOpts, {
    selection: missSel, out: emptyDir(), run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function (req) {
      const itemId = JSON.parse(req.messages[1].content).itemId;
      missCalls.push({ judgeId: req.judgeId, itemId });
      return { content: loadOfficialContent(req.judgeId, itemId), usage: null, finishReason: 'stop', providerError: null };
    },
  }));
  rec('missing-usage-keeps-reserve-and-stops',
    missSum.code === 'budget-unknown' && missSum.usage.costUnknown === true && missCalls.length === 1
    && missSum.usage.settledUsd === null && Number(missSum.usage.spentUsd.toFixed(8)) === Number(missSum.usage.calls[0].reserveUsd.toFixed(8)),
    { code: missSum.code, calls: missCalls.length, spentUsd: missSum.usage && missSum.usage.spentUsd });

  // --- gate rejections: no transport, no origin/out writes ---
  async function expectBlock(label, override, expectCode, inspect) {
    let called = 0;
    const out = override.out !== undefined ? override.out : emptyDir();
    const originMarkerPath = inspect && inspect.originMarker;
    const outMarkerPath = inspect && inspect.outMarker;
    const originBefore = originMarkerPath && existsSync(originMarkerPath) ? readFileSync(originMarkerPath) : null;
    const outBefore = outMarkerPath && existsSync(outMarkerPath) ? readFileSync(outMarkerPath) : null;
    const officialBefore = sha256File(join(ORIGIN, 'summary.json'));
    const summary = await runJudge(Object.assign({}, baseOpts, {
      out, run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
      transport: async function () { called += 1; throw new Error('should-not-call'); },
    }, override));
    const officialAfter = sha256File(join(ORIGIN, 'summary.json'));
    const originUnchanged = !originMarkerPath || (existsSync(originMarkerPath) && Buffer.compare(originBefore, readFileSync(originMarkerPath)) === 0);
    const outUnchanged = !outMarkerPath || (existsSync(outMarkerPath) && Buffer.compare(outBefore, readFileSync(outMarkerPath)) === 0);
    const noOfficialWrite = officialAfter === officialBefore && officialAfter === BAKED.summary;
    const ok = summary.called === false && called === 0 && summary.code === expectCode && originUnchanged && outUnchanged && noOfficialWrite;
    rec(label, ok, {
      code: summary.code, expected: expectCode, called: summary.called, transportCalls: called,
      originUnchanged, outUnchanged, officialUnchanged: noOfficialWrite,
    }, ok ? 'info' : 'critical');
    return summary;
  }

  await expectBlock('reject-successful-pair', {
    selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [{ itemId: 'fleurs-public-candidates/en_us/1668', judgeId: 'judge-a' }] },
  }, 'selection-not-failed');

  await expectBlock('reject-missing-origin', { origin: null }, 'origin-required');
  await expectBlock('reject-missing-origin-lock', { originLock: null }, 'origin-lock-required');
  await expectBlock('reject-origin-path-missing', { origin: join(tmpdir(), 'no-such-origin-' + Date.now()) }, 'origin-missing');

  const decoy = emptyDir();
  writeJson(join(decoy, 'summary.json'), { ok: true, code: 'not-the-official-v2-summary' });
  await expectBlock('reject-arbitrary-summary', { origin: decoy }, 'origin-hash');

  const badSeed = JSON.parse(JSON.stringify(config));
  badSeed.seed = 1;
  await expectBlock('reject-seed-slot-change', { config: badSeed }, 'seed-mismatch');

  // out == origin (copy, never official tree)
  const originCopy = emptyDir();
  writeJson(join(originCopy, 'summary.json'), { ok: false, code: 'partial', marker: 'ORIGIN-MUST-STAY', singleRunComplete: false, doubleBlindComplete: false });
  // need hash to match lock? If we use official lock summary sha, this copy will fail origin-hash first.
  // For overwrite test, use a lock that matches this copy's summary hash, OR use official origin as out.
  // Must NOT use official origin as out. Build a temp origin with official summary bytes? That could be a copy of official summary.
  // Better: copy official summary into temp origin so lock hash matches, then set out=that temp origin.
  const originTwin = emptyDir();
  writeFileSync(join(originTwin, 'summary.json'), readFileSync(join(ORIGIN, 'summary.json')));
  await expectBlock('reject-out-equals-origin', { origin: originTwin, out: originTwin }, 'out-is-origin', {
    originMarker: join(originTwin, 'summary.json'),
  });

  const preexisting = emptyDir();
  writeJson(join(preexisting, 'summary.json'), { marker: 'PREEXISTING' });
  await expectBlock('reject-nonempty-out', { out: preexisting }, 'out-not-empty', {
    outMarker: join(preexisting, 'summary.json'),
  });

  // symlink out -> originTwin
  const originTwin2 = emptyDir();
  writeFileSync(join(originTwin2, 'summary.json'), readFileSync(join(ORIGIN, 'summary.json')));
  const linkOut = join(mkdtempSync(join(tmpdir(), 'gate-link-')), 'out-link');
  symlinkSync(originTwin2, linkOut);
  await expectBlock('reject-out-symlink-to-origin', { origin: originTwin2, out: linkOut }, 'out-is-origin', {
    originMarker: join(originTwin2, 'summary.json'),
  });

  // .. alias: out = originTwin/../basename
  const parent = mkdtempSync(join(tmpdir(), 'gate-dotdot-'));
  const originNested = join(parent, 'origin');
  mkdirSync(originNested);
  writeFileSync(join(originNested, 'summary.json'), readFileSync(join(ORIGIN, 'summary.json')));
  const dotdotOut = join(originNested, '..', 'origin');
  await expectBlock('reject-out-dotdot-alias-of-origin', { origin: originNested, out: dotdotOut }, 'out-is-origin', {
    originMarker: join(originNested, 'summary.json'),
  });

  // origin parent of out
  const parentOrigin = emptyDir();
  writeFileSync(join(parentOrigin, 'summary.json'), readFileSync(join(ORIGIN, 'summary.json')));
  const childOut = join(parentOrigin, 'child-out');
  await expectBlock('reject-out-nested-in-origin', { origin: parentOrigin, out: childOut }, 'out-is-origin', {
    originMarker: join(parentOrigin, 'summary.json'),
  });
  rec('nested-out-not-created-inside-origin', !existsSync(childOut), { childOut }, existsSync(childOut) ? 'critical' : 'info');

  // out parent of origin
  const tree = mkdtempSync(join(tmpdir(), 'gate-parentout-'));
  const origInside = join(tree, 'origin');
  mkdirSync(origInside);
  writeFileSync(join(origInside, 'summary.json'), readFileSync(join(ORIGIN, 'summary.json')));
  const treeBefore = readdirSync(tree).sort();
  await expectBlock('reject-out-is-parent-of-origin', { origin: origInside, out: tree }, 'out-is-origin', {
    originMarker: join(origInside, 'summary.json'),
  });
  rec('parent-out-listing-unchanged', JSON.stringify(readdirSync(tree).sort()) === JSON.stringify(treeBefore),
    { before: treeBefore, after: readdirSync(tree).sort() }, 'critical');

  // dishonest lock: claim a successful official pair is failed, hashes otherwise official
  const lieLock = JSON.parse(JSON.stringify(lock));
  const stolen = { itemId: 'fleurs-public-candidates/en_us/1668', judgeId: 'judge-a' };
  lieLock.succeededPairs = lieLock.succeededPairs.filter((p) => !(p.itemId === stolen.itemId && p.judgeId === stolen.judgeId));
  lieLock.failedPairs = lieLock.failedPairs.concat([stolen]);
  let lieCalls = 0;
  const lieSum = await runJudge(Object.assign({}, baseOpts, {
    originLock: lieLock,
    selection: { schema: 'belliedmonkey.llm-judge.selection.v1', pairs: [stolen] },
    out: emptyDir(), run: true, synthetic: true, env: fakeEnv(), countTokens: stubCounter(),
    transport: async function () {
      lieCalls += 1;
      return { content: loadOfficialContent('judge-a', stolen.itemId), usage: usageOk(700, 80, 0.001), finishReason: 'stop', providerError: null };
    },
  }));
  rec('reject-lock-claiming-success-as-failure-without-origin-parse',
    lieCalls === 0 && lieSum.called === false && lieSum.code !== 'supplement-complete' && lieSum.code !== 'supplement-partial',
    { transportCalls: lieCalls, code: lieSum.code, called: lieSum.called, note: 'lock lists must not be free to relabel official successes; pack must read origin parsed/summary or equivalently bind the lists' },
    'critical');

  rec('official-evidence-unchanged',
    sha256File(join(ORIGIN, 'summary.json')) === BAKED.summary
    && sha256File(join(EVIDENCE, 'ledger/RESULT.json')) === BAKED.result
    && sha256File(join(EVIDENCE, 'judge-run/assignment.json')) === BAKED.assignmentFile
    && sha256File(inputPath) === BAKED.input,
    { summary: BAKED.summary });

  const criticalFails = checks.filter((c) => c.severity === 'critical' && !c.ok);
  const otherFails = checks.filter((c) => c.severity !== 'critical' && !c.ok);
  const result = {
    ok: criticalFails.length === 0 && otherFails.length === 0,
    passed: criticalFails.length === 0 && otherFails.length === 0,
    pack: { sha256: BAKED.packGz, bytes: BAKED.packBytes, id: '01M7BZMPXBWB0C6952HYQ3SNY3' },
    promptTemplateSha256: BAKED.promptV2,
    selectionSha256Canonical: BAKED.selectionCanonical,
    assignmentCanonicalSha256: BAKED.assignmentCanonical,
    reserve15: reserve15.toFixed(8),
    budgetUsd: BAKED.remaining,
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
    checkCount: result.checks.length,
    passedCount: result.checks.filter((c) => c.ok).length,
  }, null, 2) + '\n');
  process.exit(result.ok ? 0 : 2);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
