'use strict';

// Offline by default. --run is the only path that reads endpoint and key env names.
// Those values are not printed and are not written into the evidence directory.
// This file does not score WER, CER, or MER and does not read audio.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ASR_VERSION, TRANSLATION_NOTE, promptTemplateSha256 } = require('./rubric.js');
const { validateInput, validateConfig, reserveFor } = require('./schema.js');
const { assignItems, sampleIds } = require('./assign.js');
const { buildPrompt, promptContainsKey } = require('./prompt.js');
const { checkRequest } = require('./input-bound.js');
const { parseVerdict } = require('./parse.js');

function base(extra) {
  return Object.assign({
    ok: false,
    code: null,
    called: false,
    synthetic: false,
    productMetric: false,
    endToEnd: false,
    leaderboard: false,
    ranking: false,
    editRates: null,
    results: null,
    doubleBlindComplete: false,
    semanticHumanReviewCount: 0,
    earReviewUsedAsSemanticReview: false,
    translationGold: false,
    promptTemplateSha256: promptTemplateSha256(),
    asrRubric: ASR_VERSION,
  }, extra || {});
}

function kindsFor(verdict, slotName) {
  if (!verdict) return null;
  const slot = verdict.slots.filter((row) => row.slot === slotName)[0];
  if (!slot) return null;
  if (slot.abstain) return ['abstain'];
  return slot.findings.map((finding) => finding.kind).sort();
}

function reviewList(items, byId, judges, seed, sampleCount) {
  const disagreements = [];
  const unparsed = [];
  const agreed = [];
  for (const item of items) {
    const left = byId.get(judges[0].id + ':' + item.id);
    const right = byId.get(judges[1].id + ':' + item.id);
    if (!left || !left.ok || !right || !right.ok) {
      unparsed.push(item.id);
      continue;
    }
    const mismatch = ['slot-1', 'slot-2'].some((slot) => {
      const a = kindsFor(left.verdict, slot);
      const b = kindsFor(right.verdict, slot);
      return JSON.stringify(a) !== JSON.stringify(b);
    });
    if (mismatch) disagreements.push(item.id);
    else agreed.push(item.id);
  }
  const sampled = sampleIds(agreed, seed, sampleCount);
  return {
    schema: 'belliedmonkey.llm-judge.human-review.v1',
    semanticHumanReviewCount: 0,
    earReviewUsedAsSemanticReview: false,
    disagreement: disagreements,
    sample: sampled,
    notAssessed: unparsed,
  };
}

function usageOf(body) {
  const usage = body && body.usage;
  const providerUsd = body && Number.isFinite(body.providerUsd) ? body.providerUsd
    : (usage && Number.isFinite(usage.usd) ? usage.usd : null);
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null, providerUsd: providerUsd, complete: false };
  }
  const inputTokens = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
  const outputTokens = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
  return {
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    providerUsd: providerUsd,
    complete: inputTokens !== null && outputTokens !== null,
  };
}

function settle(prices, model, usage) {
  const row = prices.models[model];
  if (!row || !usage || !usage.complete) return { settledUsd: null, costUnknown: true };
  if (usage.inputTokens > prices.maxInputTokens || usage.outputTokens > prices.maxOutputTokens) {
    return {
      settledUsd: null,
      costUnknown: true,
      code: 'usage-over-cap',
      providerExceededDeclaredCap: true,
    };
  }
  if (row.pricedZero === true) return { settledUsd: 0, costUnknown: false };
  const settled = money(usage.inputTokens * row.inputUsdPerToken + usage.outputTokens * row.outputUsdPerToken);
  return { settledUsd: settled, costUnknown: false };
}

async function once(transport, req, timeoutMs) {
  const ac = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      const err = new Error('timeout');
      err.code = 'timeout';
      reject(err);
    }, timeoutMs);
  });
  req.signal = ac.signal;
  const pending = Promise.resolve(transport(req));
  pending.catch(() => {});
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function httpTransport(req) {
  if (typeof fetch !== 'function') {
    const err = new Error('fetch-missing');
    err.code = 'transport';
    throw err;
  }
  const res = await fetch(req.url, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + req.key,
    },
      body: JSON.stringify({
      model: req.model,
      temperature: req.temperature,
      seed: req.seed,
      max_tokens: req.maxTokens,
      messages: req.messages,
    }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  if (!res.ok) {
    const err = new Error('http');
    err.code = 'http';
    err.status = res.status;
    throw err;
  }
  const choice = json && json.choices && json.choices[0];
  const content = choice && choice.message && choice.message.content;
  const finishReason = choice && (choice.finish_reason || choice.finishReason) || null;
  const providerError = json && json.error ? json.error : null;
  if (typeof content !== 'string' && !providerError && finishReason !== 'error') {
    const err = new Error('output-unparsed');
    err.code = 'output-unparsed';
    throw err;
  }
  const usage = json && json.usage ? Object.assign({}, json.usage) : null;
  if (usage && Number.isFinite(json.usd)) usage.usd = json.usd;
  return {
    content: typeof content === 'string' ? content : null,
    responseModel: json.model || null,
    usage: usage,
    finishReason: finishReason,
    providerError: providerError,
  };
}

function classifyCall(result, usage, parsed) {
  const body = result && result.body;
  const finishReason = body && (body.finishReason || body.finish_reason) || null;
  const providerError = body && body.providerError || null;
  const transportOk = !!(result && result.ok);
  const generationOk = transportOk && !providerError && (finishReason === 'stop' || finishReason === 'length');
  const usageComplete = !!(usage && usage.complete);
  const parseOk = !!(parsed && parsed.ok);
  const parseCode = parsed && parsed.code || null;
  const modelFormatFault = finishReason === 'stop' && !providerError && !parseOk && (
    parseCode === 'bad-json' || parseCode === 'slots' || parseCode === 'verdict-schema'
  );
  return {
    transportOk: transportOk,
    generationOk: generationOk,
    finishReason: finishReason,
    providerError: providerError ? true : false,
    usageComplete: usageComplete,
    parseOk: parseOk,
    parseCode: parseCode,
    modelFormatFault: modelFormatFault,
  };
}

async function callJudge(transport, req, timeoutMs) {
  const started = Date.now();
  try {
    const body = await once(transport, req, timeoutMs);
    return {
      ok: true,
      body: body,
      elapsedMs: Date.now() - started,
      aborted: !!(req.signal && req.signal.aborted),
      code: null,
    };
  } catch (err) {
    return {
      ok: false,
      body: null,
      elapsedMs: Date.now() - started,
      aborted: !!(req.signal && req.signal.aborted) || (err && err.code === 'timeout'),
      code: err && err.code ? err.code : 'transport',
      status: err && err.status ? err.status : null,
    };
  }
}

function selectionKey(judgeId, itemId) {
  return judgeId + '\n' + itemId;
}

function validateSelection(doc, items, judges) {
  if (doc == null) return { ok: true, pairs: null, list: null, hash: null };
  if (!doc || doc.schema !== 'belliedmonkey.llm-judge.selection.v1' || !Array.isArray(doc.pairs) || !doc.pairs.length) {
    return { ok: false, code: 'selection' };
  }
  const itemIds = {};
  for (let i = 0; i < items.length; i++) itemIds[items[i].id] = true;
  const judgeIds = {};
  for (let i = 0; i < judges.length; i++) judgeIds[judges[i].id] = true;
  const seen = {};
  const list = [];
  for (let i = 0; i < doc.pairs.length; i++) {
    const pair = doc.pairs[i];
    if (!pair || typeof pair.itemId !== 'string' || typeof pair.judgeId !== 'string') return { ok: false, code: 'selection' };
    if (!itemIds[pair.itemId] || !judgeIds[pair.judgeId]) return { ok: false, code: 'selection' };
    const key = selectionKey(pair.judgeId, pair.itemId);
    if (seen[key]) return { ok: false, code: 'selection' };
    seen[key] = true;
    list.push({ itemId: pair.itemId, judgeId: pair.judgeId });
  }
  const canonical = JSON.stringify({ schema: doc.schema, pairs: list });
  return {
    ok: true,
    pairs: seen,
    list: list,
    hash: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}

function assignmentCanonical(seed, items) {
  return JSON.stringify({ schema: 'belliedmonkey.llm-judge.assignment.v1', seed: seed, items: items });
}

function assignmentDigest(seed, items) {
  return crypto.createHash('sha256').update(assignmentCanonical(seed, items), 'utf8').digest('hex');
}

function pairKey(pair) {
  return pair.judgeId + '\n' + pair.itemId;
}

function resolvedDir(dirPath) {
  const abs = path.resolve(dirPath);
  if (fs.existsSync(abs)) return fs.realpathSync(abs);
  const parent = path.dirname(abs);
  if (!fs.existsSync(parent)) return null;
  return path.join(fs.realpathSync(parent), path.basename(abs));
}

function nested(parent, child) {
  return child === parent || child.startsWith(parent + path.sep);
}

function gateSupplement(opts, config, selected, assignmentItems) {
  if (!selected.list) return { ok: true };
  if (!opts.origin) return { ok: false, code: 'origin-required' };
  if (!opts.originLock) return { ok: false, code: 'origin-lock-required' };
  if (opts.run && !opts.out) return { ok: false, code: 'out-required' };
  const lock = opts.originLock;
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return { ok: false, code: 'origin-lock' };
  const allow = ['schema', 'summarySha256', 'assignmentSha256', 'inputSha256', 'promptTemplateSha256', 'seed', 'models', 'failedPairs', 'succeededPairs'];
  const extra = Object.keys(lock).filter((key) => allow.indexOf(key) === -1);
  if (extra.length || lock.schema !== 'belliedmonkey.llm-judge.origin-lock.v1') return { ok: false, code: 'origin-lock' };
  if (typeof lock.summarySha256 !== 'string' || typeof lock.assignmentSha256 !== 'string') return { ok: false, code: 'origin-lock' };
  if (typeof lock.inputSha256 !== 'string' || typeof lock.promptTemplateSha256 !== 'string') return { ok: false, code: 'origin-lock' };
  if (lock.seed !== config.seed) return { ok: false, code: 'seed-mismatch' };
  if (lock.promptTemplateSha256 !== promptTemplateSha256()) return { ok: false, code: 'prompt-mismatch' };
  if (opts.inputSha256 !== lock.inputSha256) return { ok: false, code: 'input-mismatch' };
  if (assignmentDigest(config.seed, assignmentItems) !== lock.assignmentSha256) return { ok: false, code: 'assignment-mismatch' };
  if (!lock.models || typeof lock.models !== 'object' || Array.isArray(lock.models)) return { ok: false, code: 'origin-lock' };
  if (Object.keys(lock.models).length !== config.judges.length) return { ok: false, code: 'model-mismatch' };
  for (let i = 0; i < config.judges.length; i++) {
    const judge = config.judges[i];
    if (lock.models[judge.id] !== judge.model) return { ok: false, code: 'model-mismatch' };
  }
  if (!Array.isArray(lock.failedPairs) || !Array.isArray(lock.succeededPairs)) return { ok: false, code: 'origin-lock' };
  const failed = {};
  const succeeded = {};
  for (let i = 0; i < lock.failedPairs.length; i++) {
    const pair = lock.failedPairs[i];
    if (!pair || typeof pair.itemId !== 'string' || typeof pair.judgeId !== 'string') return { ok: false, code: 'origin-lock' };
    failed[pairKey(pair)] = true;
  }
  for (let i = 0; i < lock.succeededPairs.length; i++) {
    const pair = lock.succeededPairs[i];
    if (!pair || typeof pair.itemId !== 'string' || typeof pair.judgeId !== 'string') return { ok: false, code: 'origin-lock' };
    const key = pairKey(pair);
    if (failed[key]) return { ok: false, code: 'origin-lock' };
    succeeded[key] = true;
  }
  for (let i = 0; i < selected.list.length; i++) {
    const key = pairKey(selected.list[i]);
    if (!failed[key] || succeeded[key]) return { ok: false, code: 'selection-not-failed' };
  }
  const originAbs = path.resolve(opts.origin);
  if (!fs.existsSync(originAbs)) return { ok: false, code: 'origin-missing' };
  const originReal = fs.realpathSync(originAbs);
  const originFile = path.join(originReal, 'summary.json');
  if (!fs.existsSync(originFile)) return { ok: false, code: 'origin-missing' };
  const summaryBytes = fs.readFileSync(originFile);
  const summaryHash = crypto.createHash('sha256').update(summaryBytes).digest('hex');
  if (summaryHash !== lock.summarySha256) return { ok: false, code: 'origin-hash' };
  let summary = null;
  try { summary = JSON.parse(summaryBytes.toString('utf8')); } catch (_) { summary = null; }
  if (!summary || summary.code === 'complete' || summary.code === 'supplement-complete' || summary.doubleBlindComplete === true || summary.singleRunComplete === true) {
    return { ok: false, code: 'origin-not-partial' };
  }
  if (opts.out) {
    const outReal = resolvedDir(opts.out);
    if (!outReal) return { ok: false, code: 'out-parent' };
    if (nested(originReal, outReal) || nested(outReal, originReal)) return { ok: false, code: 'out-is-origin' };
    if (fs.existsSync(path.resolve(opts.out))) {
      let names = null;
      try { names = fs.readdirSync(outReal); } catch (_) { names = null; }
      if (!names || names.length) return { ok: false, code: 'out-not-empty' };
    }
  }
  const tokenReserve = selected.list.length * (config.prices.maxInputTokens + config.prices.maxOutputTokens);
  if (tokenReserve > config.prices.maxTotalTokens || selected.list.length > config.prices.maxRequests) {
    return { ok: false, code: 'request-cap' };
  }
  let reserveSum = 0;
  for (let i = 0; i < selected.list.length; i++) {
    const judge = config.judges.filter((row) => row.id === selected.list[i].judgeId)[0];
    reserveSum += reserveFor(config.prices, judge.model);
  }
  if (money(reserveSum) > config.budgetUsd) return { ok: false, code: 'budget-blocked' };
  return {
    ok: true,
    summaryHash: summaryHash,
    succeededPairs: lock.succeededPairs,
    failedPairs: lock.failedPairs,
  };
}

function money(n) {
  return Math.round(n * 1e9) / 1e9;
}

function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
}

function writeJson(dir, name, value) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
}

async function runJudge(opts) {
  const synthetic = !!(opts && opts.synthetic);
  const inputCheck = validateInput(opts && opts.input);
  if (!inputCheck.ok) {
    return base({
      code: inputCheck.code,
      detail: inputCheck.detail,
      synthetic: synthetic,
      translationNote: inputCheck.code === 'translation-not-open' ? TRANSLATION_NOTE : null,
    });
  }
  const config = validateConfig(opts.config);
  if (!config.ok) return base({ code: config.code, detail: config.detail, synthetic: synthetic });
  const selected = validateSelection(opts.selection, inputCheck.items, config.judges);
  if (!selected.ok) return base({ code: selected.code, synthetic: synthetic });
  const assignment = assignItems(inputCheck.items, config.seed);
  const byAssignment = new Map(assignment.map((row) => [row.id, row]));
  const planned = inputCheck.items.map((item) => {
    const row = byAssignment.get(item.id);
    const prompt = buildPrompt(item, row);
    for (const cand of item.candidates) {
      if (promptContainsKey(prompt, cand.key)) {
        return { id: item.id, leak: cand.key };
      }
    }
    return { id: item.id, prompt: prompt, assignment: row, item: item };
  });
  const leaked = planned.filter((row) => row.leak);
  if (leaked.length) return base({ code: 'prompt-identity', detail: leaked[0].leak, synthetic: synthetic });
  const plan = {
    schema: 'belliedmonkey.llm-judge.plan.v1',
    called: false,
    synthetic: synthetic,
    asrRubric: ASR_VERSION,
    promptTemplateSha256: promptTemplateSha256(),
    seed: config.seed,
    temperature: config.temperature,
    maxItems: config.maxItems,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    budgetUsd: config.budgetUsd,
    prices: {
      source: config.prices.source,
      sourceVersion: config.prices.sourceVersion,
      maxInputTokens: config.prices.maxInputTokens,
      maxOutputTokens: config.prices.maxOutputTokens,
      maxTotalTokens: config.prices.maxTotalTokens,
      maxRequests: config.prices.maxRequests,
      reserveUsd: config.judges.map((judge) => ({
        model: judge.model,
        usd: reserveFor(config.prices, judge.model),
        pricedZero: config.prices.models[judge.model].pricedZero,
      })),
    },
    judges: config.judges.map((judge) => ({ id: judge.id, model: judge.model, called: false })),
    itemIds: inputCheck.items.map((item) => item.id),
    omittedIds: inputCheck.items.slice(config.maxItems).map((item) => item.id),
    maxTokensFieldProviderVerified: false,
    inputBound: config.inputBound,
    reserveTokens: config.prices.maxInputTokens + config.prices.maxOutputTokens,
    selectionSha256: selected.hash,
    selectedPairs: selected.list,
  };
  const evidenceAssignment = {
    schema: 'belliedmonkey.llm-judge.assignment.v1',
    seed: config.seed,
    items: assignment,
    note: 'This mapping stays in the evidence directory. It is not part of the judge request.',
  };
  const notYet = {
    schema: 'belliedmonkey.llm-judge.human-review.v1',
    semanticHumanReviewCount: 0,
    earReviewUsedAsSemanticReview: false,
    disagreement: [],
    sample: [],
    notAssessed: inputCheck.items.map((item) => item.id),
  };
  function persist(summary) {
    if (!opts.out) return summary;
    writeJson(opts.out, 'plan.json', plan);
    writeJson(opts.out, 'assignment.json', evidenceAssignment);
    writeJson(opts.out, 'human-review.json', summary.humanReview || notYet);
    writeJson(opts.out, 'summary.json', summary);
    return summary;
  }
  const inputChecks = [];
  let boundStop = null;
  for (const row of planned) {
    for (const judge of config.judges) {
      const probe = {
        model: judge.model,
        temperature: config.temperature,
        seed: config.seed,
        maxTokens: config.prices.maxOutputTokens,
        messages: row.prompt.messages,
      };
      const checked = checkRequest(probe, config.prices, config.inputBound, opts.countTokens);
      inputChecks.push({
        id: row.id,
        judgeId: judge.id,
        ok: checked.ok,
        code: checked.code,
        declaredTokens: checked.declaredTokens == null ? null : checked.declaredTokens,
        utf8Bytes: checked.utf8Bytes == null ? null : checked.utf8Bytes,
        method: checked.method || null,
        exact: false,
      });
      if (!checked.ok && !boundStop) boundStop = checked.code;
    }
  }
  plan.inputChecks = inputChecks;
  const supplement = gateSupplement(opts, config, selected, assignment);
  if (!supplement.ok) {
    return base({
      code: supplement.code,
      called: false,
      synthetic: synthetic,
      plan: plan,
      assignment: evidenceAssignment,
      humanReview: notYet,
      singleRunComplete: false,
      doubleBlindComplete: false,
      supplementComplete: false,
    });
  }
  if (plan.omittedIds.length && !selected.list) {
    return persist(base({
      code: 'item-cap',
      called: false,
      synthetic: synthetic,
      plan: plan,
      assignment: evidenceAssignment,
      omittedIds: plan.omittedIds,
      humanReview: notYet,
    }));
  }
  if (boundStop) {
    return persist(base({
      code: boundStop,
      called: false,
      synthetic: synthetic,
      plan: plan,
      assignment: evidenceAssignment,
      omittedIds: [],
      humanReview: notYet,
    }));
  }
  if (!opts.run) {
    return persist(base({
      ok: true,
      code: 'dry-run',
      called: false,
      synthetic: synthetic,
      plan: plan,
      assignment: evidenceAssignment,
      omittedIds: [],
      humanReview: notYet,
    }));
  }
  const env = opts.env || {};
  for (const judge of config.judges) {
    if (!env[judge.endpointEnv] || !env[judge.keyEnv]) {
      return persist(base({
        code: 'blocked',
        called: false,
        synthetic: synthetic,
        plan: plan,
        assignment: evidenceAssignment,
        detail: judge.id,
        humanReview: notYet,
      }));
    }
  }
  let originSummarySha256 = selected.list ? supplement.summaryHash : null;
  if (opts.origin && !selected.list) {
    const originFile = path.join(opts.origin, 'summary.json');
    if (!fs.existsSync(originFile)) {
      return persist(base({
        code: 'origin-missing',
        called: false,
        synthetic: synthetic,
        plan: plan,
        assignment: evidenceAssignment,
        humanReview: notYet,
      }));
    }
    originSummarySha256 = crypto.createHash('sha256').update(fs.readFileSync(originFile)).digest('hex');
  }
  const transport = opts.transport;
  if (typeof transport !== 'function') return base({ code: 'transport-missing', synthetic: synthetic, plan: plan });
  const calls = [];
  const parsed = new Map();
  let held = 0;
  let settled = 0;
  let requests = 0;
  let tokensHeld = 0;
  let costUnknown = false;
  let stop = null;
  for (const row of planned) {
    if (stop) break;
    for (const judge of config.judges) {
      if (stop) break;
      if (selected.pairs && !selected.pairs[selectionKey(judge.id, row.id)]) continue;
      const reserve = reserveFor(config.prices, judge.model);
      const tokenReserve = config.prices.maxInputTokens + config.prices.maxOutputTokens;
      if (requests + 1 > config.prices.maxRequests) {
        stop = 'request-cap';
        break;
      }
      if (tokensHeld + tokenReserve > config.prices.maxTotalTokens) {
        stop = 'token-cap';
        break;
      }
      if (money(held + reserve) > config.budgetUsd) {
        stop = 'budget-blocked';
        break;
      }
      held = money(held + reserve);
      tokensHeld += tokenReserve;
      requests += 1;
      const req = {
        judgeId: judge.id,
        model: judge.model,
        temperature: config.temperature,
        seed: config.seed,
        maxTokens: config.prices.maxOutputTokens,
        timeoutMs: config.timeoutMs,
        messages: row.prompt.messages,
        url: env[judge.endpointEnv],
        key: env[judge.keyEnv],
        signal: null,
      };
      if (opts.out) {
        writeJson(path.join(opts.out, 'requests', judge.id), safeName(row.id), {
          stage: 'reserved',
          judgeId: judge.id,
          model: judge.model,
          temperature: config.temperature,
          seed: config.seed,
          maxTokens: req.maxTokens,
          reserveUsd: reserve,
          messages: row.prompt.messages,
          authorization: 'redacted',
          urlStored: false,
        });
      }
      const result = await callJudge(transport, req, config.timeoutMs);
      const usage = usageOf(result.body);
      let one = { ok: false, code: result.code || 'transport', verdict: null };
      let settledUsd = null;
      const text = result.body && typeof result.body.content === 'string' ? result.body.content : '';
      if (text) {
        const parsedNow = parseVerdict(text, row.item, row.assignment);
        one = parsedNow.ok ? parsedNow : { ok: false, code: parsedNow.code, verdict: null };
      }
      if (!result.ok || !usage.complete) {
        costUnknown = true;
        stop = 'budget-unknown';
        if (!text) one = { ok: false, code: result.code || 'transport', verdict: null };
      } else {
        const bill = settle(config.prices, judge.model, usage);
        if (bill.costUnknown) {
          costUnknown = true;
          stop = 'budget-unknown';
          one = {
            ok: false,
            code: one.code && one.code !== 'parsed' ? one.code : (bill.code || 'budget-unknown'),
            verdict: null,
            providerExceededDeclaredCap: bill.providerExceededDeclaredCap === true,
          };
        } else {
          held = money(held - reserve + bill.settledUsd);
          settled = money(settled + bill.settledUsd);
          tokensHeld = tokensHeld - tokenReserve + usage.inputTokens + usage.outputTokens;
          settledUsd = bill.settledUsd;
          if (!one.ok) one = { ok: false, code: one.code, verdict: null };
        }
      }
      const status = classifyCall(result, usage, one);
      if (!status.generationOk) one = Object.assign({}, one, { ok: false, verdict: null });
      one.observation = status;
      parsed.set(judge.id + ':' + row.id, one);
      calls.push({
        judgeId: judge.id,
        itemId: row.id,
        ok: one.ok === true && settledUsd !== null,
        transportOk: status.transportOk,
        generationOk: status.generationOk,
        finishReason: status.finishReason,
        providerError: status.providerError,
        usageComplete: status.usageComplete,
        parseCode: status.parseCode,
        modelFormatFault: status.modelFormatFault,
        code: result.code,
        reserveUsd: reserve,
        settledUsd: settledUsd,
        providerUsd: usage.providerUsd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        elapsedMs: result.elapsedMs,
        aborted: result.aborted === true,
        costUnknown: settledUsd === null,
        providerExceededDeclaredCap: one.providerExceededDeclaredCap === true,
        maxTokensFieldProviderVerified: false,
      });
      if (opts.out) {
        writeJson(path.join(opts.out, 'responses', judge.id), safeName(row.id), {
          stage: 'finished',
          transportOk: status.transportOk,
          generationOk: status.generationOk,
          finishReason: status.finishReason,
          providerError: status.providerError,
          usageComplete: status.usageComplete,
          parseCode: status.parseCode,
          modelFormatFault: status.modelFormatFault,
          code: result.code,
          status: result.status || null,
          elapsedMs: result.elapsedMs,
          aborted: result.aborted === true,
          content: result.ok ? result.body.content : null,
          providerUsd: usage.providerUsd,
          usage: usage,
          settledUsd: settledUsd,
        });
        writeJson(path.join(opts.out, 'parsed', judge.id), safeName(row.id), one);
      }
    }
  }
  const itemResults = inputCheck.items.map((item) => {
    const slots = {};
    let complete = true;
    for (const judge of config.judges) {
      const one = parsed.get(judge.id + ':' + item.id);
      if (!one || !one.ok) {
        slots[judge.id] = null;
        complete = false;
      } else {
        slots[judge.id] = one.verdict;
      }
    }
    return { id: item.id, judges: slots, complete: complete };
  });
  const both = itemResults.every((row) => row.complete);
  const anyParsed = itemResults.some((row) => Object.keys(row.judges).some((id) => row.judges[id]));
  const selectedOk = !selected.list || selected.list.every((pair) => {
    const one = parsed.get(pair.judgeId + ':' + pair.itemId);
    return one && one.ok === true;
  });
  let code = 'complete';
  if (selected.list) {
    if (stop) code = stop;
    else code = selectedOk ? 'supplement-complete' : 'supplement-partial';
  } else if (stop && !both) code = stop;
  else if (!both && anyParsed) code = 'partial';
  else if (!both) code = stop || 'no-verdict';
  const human = reviewList(planned, parsed, config.judges, config.seed, config.sampleCount);
  const summary = base({
    ok: code === 'complete' || code === 'supplement-complete',
    code: code,
    called: calls.length > 0,
    synthetic: synthetic,
    singleRunComplete: code === 'complete',
    doubleBlindComplete: code === 'complete',
    supplementComplete: code === 'supplement-complete',
    results: itemResults,
    plan: plan,
    assignment: evidenceAssignment,
    omittedIds: [],
    usage: {
      calls: calls,
      spentUsd: held,
      settledUsd: costUnknown ? null : settled,
      costUnknown: costUnknown,
      providerUsdIgnored: true,
    },
    humanReview: human,
    provenance: selected.list ? {
      schema: 'belliedmonkey.llm-judge.provenance.v1',
      official: false,
      singleRunComplete: false,
      originSummarySha256: originSummarySha256,
      originLockSchema: 'belliedmonkey.llm-judge.origin-lock.v1',
      assignmentSha256: assignmentDigest(config.seed, assignment),
      inputSha256: opts.inputSha256,
      selectionSha256: selected.hash,
      promptTemplateSha256: promptTemplateSha256(),
      seed: config.seed,
    } : null,
  });
  if (opts.out && selected.list) {
    const derived = derivedTable(supplement.succeededPairs, supplement.failedPairs, selected.list, parsed, code === 'supplement-complete');
    writeJson(opts.out, 'supplement.json', {
      schema: 'belliedmonkey.llm-judge.supplement.v1',
      official: false,
      singleRunComplete: false,
      supplementComplete: code === 'supplement-complete',
      doubleBlindComplete: false,
      originSummarySha256: originSummarySha256,
      selectionSha256: selected.hash,
      pairs: selected.list,
      note: 'One authorized request per selected failure. This file does not change the origin partial.',
    });
    writeJson(opts.out, 'derived-merge.json', Object.assign({
      schema: 'belliedmonkey.llm-judge.derived-merge.v1',
      official: false,
      singleRunComplete: false,
      originSingleRunComplete: false,
      supplementComplete: code === 'supplement-complete',
      doubleBlindComplete: false,
      originSummarySha256: originSummarySha256,
      selectionSha256: selected.hash,
      note: 'Origin-valid pairs stay a reference to the origin file. Selected failures use only this request. An invalid parse stays null.',
    }, derived));
  }
  if (opts.out) {
    writeJson(opts.out, 'plan.json', plan);
    writeJson(opts.out, 'assignment.json', evidenceAssignment);
    writeJson(opts.out, 'usage.json', summary.usage);
    writeJson(opts.out, 'human-review.json', human);
    writeJson(opts.out, 'summary.json', summary);
  }
  return summary;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main(argv, env, transport) {
  const args = { run: false, synthetic: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--run') args.run = true;
    else if (token === '--synthetic') args.synthetic = true;
    else if (token === '--input') args.input = argv[++i];
    else if (token === '--config') args.config = argv[++i];
    else if (token === '--out') args.out = argv[++i];
    else if (token === '--select') args.select = argv[++i];
    else if (token === '--origin') args.origin = argv[++i];
    else if (token === '--origin-lock') args.originLock = argv[++i];
    else return base({ code: 'usage' });
  }
  if (!args.input || !args.config || !args.out) return base({ code: 'usage' });
  let input;
  let config;
  let selection = null;
  let originLock = null;
  let inputSha256 = null;
  try {
    const inputBytes = fs.readFileSync(args.input);
    inputSha256 = crypto.createHash('sha256').update(inputBytes).digest('hex');
    input = JSON.parse(inputBytes.toString('utf8'));
    config = readJson(args.config);
    if (args.select) selection = readJson(args.select);
    if (args.originLock) originLock = readJson(args.originLock);
  } catch (_) {
    return base({ code: 'unreadable', synthetic: args.synthetic });
  }
  return runJudge({
    input: input,
    config: config,
    selection: selection,
    origin: args.origin,
    originLock: originLock,
    inputSha256: inputSha256,
    out: args.out,
    run: args.run,
    synthetic: args.synthetic,
    env: env,
    transport: args.run ? (transport || httpTransport) : null,
  });
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, null).then((summary) => {
    const publicSummary = Object.assign({}, summary);
    process.stdout.write(JSON.stringify(publicSummary) + '\n');
    process.exit(summary.ok ? 0 : 2);
  }).catch((err) => {
    process.stderr.write((err && err.code ? err.code : 'judge-failed') + '\n');
    process.exit(1);
  });
}

function derivedTable(succeededPairs, failedPairs, selectedPairs, parsed, supplementComplete) {
  const selectedKeys = {};
  for (let i = 0; i < selectedPairs.length; i++) selectedKeys[pairKey(selectedPairs[i])] = true;
  let unselectedFailed = 0;
  for (let i = 0; i < failedPairs.length; i++) {
    if (!selectedKeys[pairKey(failedPairs[i])]) unselectedFailed += 1;
  }
  const rows = [];
  for (let i = 0; i < succeededPairs.length; i++) {
    const pair = succeededPairs[i];
    rows.push({
      itemId: pair.itemId,
      judgeId: pair.judgeId,
      source: 'origin',
      originKept: true,
      verdict: null,
    });
  }
  let supplementParsed = 0;
  for (let i = 0; i < selectedPairs.length; i++) {
    const pair = selectedPairs[i];
    const one = parsed.get(pair.judgeId + ':' + pair.itemId);
    const ok = !!(one && one.ok === true && one.verdict);
    if (ok) supplementParsed += 1;
    rows.push({
      itemId: pair.itemId,
      judgeId: pair.judgeId,
      source: 'supplement',
      originKept: false,
      verdict: ok ? one.verdict : null,
      parseCode: one && one.code ? one.code : null,
    });
  }
  rows.sort((a, b) => {
    if (a.judgeId < b.judgeId) return -1;
    if (a.judgeId > b.judgeId) return 1;
    if (a.itemId < b.itemId) return -1;
    if (a.itemId > b.itemId) return 1;
    return 0;
  });
  const supplementNull = selectedPairs.length - supplementParsed;
  return {
    pairs: rows,
    coverage: {
      originKept: succeededPairs.length,
      supplementRequested: selectedPairs.length,
      supplementParsed: supplementParsed,
      supplementNull: supplementNull,
      unselectedFailed: unselectedFailed,
      cherryPick: false,
      derivedCoverageComplete: supplementComplete === true && supplementNull === 0 && unselectedFailed === 0,
    },
  };
}

module.exports = { runJudge, main, usageOf, assignmentDigest };
