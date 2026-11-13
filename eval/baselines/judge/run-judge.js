'use strict';

// Offline by default. --run is the only path that reads endpoint and key env names.
// Those values are not printed and are not written into the evidence directory.
// This file does not score WER, CER, or MER and does not read audio.

const fs = require('fs');
const path = require('path');
const { ASR_VERSION, TRANSLATION_NOTE, promptTemplateSha256 } = require('./rubric.js');
const { validateInput, validateConfig } = require('./schema.js');
const { assignItems, sampleIds } = require('./assign.js');
const { buildPrompt, promptContainsKey } = require('./prompt.js');
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
      if (left || right) unparsed.push(item.id);
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
  const rows = disagreements.map((id) => ({
    id: id,
    reason: 'disagreement',
    semanticHumanReviewed: false,
  })).concat(unparsed.map((id) => ({
    id: id,
    reason: 'unparsed',
    semanticHumanReviewed: false,
  }))).concat(sampled.map((id) => ({
    id: id,
    reason: 'sample',
    semanticHumanReviewed: false,
  })));
  return {
    schema: 'belliedmonkey.llm-judge.human-review.v1',
    semanticHumanReviewCount: 0,
    earReviewUsedAsSemanticReview: false,
    rows: rows,
  };
}

function usageOf(body) {
  const usage = body && body.usage;
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null, usd: null, costUnknown: true };
  }
  const inputTokens = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
  const outputTokens = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
  const usd = Number.isFinite(usage.usd) ? usage.usd : null;
  return { inputTokens: inputTokens, outputTokens: outputTokens, usd: usd, costUnknown: usd === null };
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
  const pending = Promise.resolve(transport(Object.assign({}, req, { signal: ac.signal })));
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
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (typeof content !== 'string') {
    const err = new Error('output-unparsed');
    err.code = 'output-unparsed';
    throw err;
  }
  const usage = json && json.usage ? Object.assign({}, json.usage) : null;
  if (usage && Number.isFinite(json.usd)) usage.usd = json.usd;
  return { content: content, responseModel: json.model || null, usage: usage };
}

function retryable(err) {
  if (!err) return false;
  if (err.code === 'timeout' || err.code === 'network') return true;
  if (err.code === 'http' && (err.status === 429 || err.status >= 500)) return true;
  return false;
}

async function callJudge(transport, req, timeoutMs, maxRetries) {
  const attempts = [];
  let last = null;
  const total = maxRetries + 1;
  for (let n = 1; n <= total; n++) {
    try {
      const body = await once(transport, req, timeoutMs);
      const usage = usageOf(body);
      attempts.push(Object.assign({ attempt: n, ok: true }, usage));
      return { ok: true, body: body, attempts: attempts };
    } catch (err) {
      last = err;
      attempts.push({
        attempt: n,
        ok: false,
        code: err && err.code ? err.code : 'transport',
        status: err && err.status ? err.status : null,
        inputTokens: null,
        outputTokens: null,
        usd: null,
        costUnknown: true,
      });
      if (!retryable(err) || n === total) break;
    }
  }
  return { ok: false, code: last && last.code ? last.code : 'transport', attempts: attempts };
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
    judges: config.judges.map((judge) => ({ id: judge.id, model: judge.model, called: false })),
    itemIds: inputCheck.items.map((item) => item.id),
  };
  const evidenceAssignment = {
    schema: 'belliedmonkey.llm-judge.assignment.v1',
    seed: config.seed,
    items: assignment,
    note: 'This mapping stays in the evidence directory. It is not part of the judge request.',
  };
  if (!opts.run) {
    const summary = base({
      ok: true,
      code: 'dry-run',
      called: false,
      synthetic: synthetic,
      plan: plan,
      assignment: evidenceAssignment,
    });
    if (opts.out) {
      writeJson(opts.out, 'plan.json', plan);
      writeJson(opts.out, 'assignment.json', evidenceAssignment);
      writeJson(opts.out, 'summary.json', summary);
    }
    return summary;
  }
  const env = opts.env || {};
  for (const judge of config.judges) {
    if (!env[judge.endpointEnv] || !env[judge.keyEnv]) {
      return base({
        code: 'blocked',
        called: false,
        synthetic: synthetic,
        plan: plan,
        assignment: evidenceAssignment,
        detail: judge.id,
      });
    }
  }
  const transport = opts.transport;
  if (typeof transport !== 'function') return base({ code: 'transport-missing', synthetic: synthetic, plan: plan });
  const limited = planned.slice(0, config.maxItems);
  const skipped = planned.slice(config.maxItems);
  const calls = [];
  const parsed = new Map();
  let spent = 0;
  let sawUsd = false;
  let costUnknown = false;
  let stop = null;
  for (const row of limited) {
    if (stop) break;
    for (const judge of config.judges) {
      if (stop) break;
      if (sawUsd && config.budgetUsd !== null && spent >= config.budgetUsd) {
        stop = 'budget-truncated';
        break;
      }
      const req = {
        judgeId: judge.id,
        model: judge.model,
        temperature: config.temperature,
        seed: config.seed,
        timeoutMs: config.timeoutMs,
        messages: row.prompt.messages,
        url: env[judge.endpointEnv],
        key: env[judge.keyEnv],
      };
      const result = await callJudge(transport, req, config.timeoutMs, config.maxRetries);
      let usdThis = null;
      if (result.ok) {
        const usage = usageOf(result.body);
        usdThis = usage.usd;
        if (usage.costUnknown) costUnknown = true;
        else {
          sawUsd = true;
          spent += usage.usd;
        }
        const text = result.body && typeof result.body.content === 'string' ? result.body.content : '';
        const one = parseVerdict(text, row.item, row.assignment);
        parsed.set(judge.id + ':' + row.id, one);
        if (opts.out) {
          writeJson(path.join(opts.out, 'requests', judge.id), safeName(row.id), {
            judgeId: judge.id,
            model: judge.model,
            temperature: config.temperature,
            seed: config.seed,
            messages: row.prompt.messages,
            authorization: 'redacted',
            urlStored: false,
          });
          writeJson(path.join(opts.out, 'responses', judge.id), safeName(row.id), {
            content: text,
            responseModel: result.body.responseModel || null,
            usage: usage,
          });
          writeJson(path.join(opts.out, 'parsed', judge.id), safeName(row.id), one);
        }
      } else {
        parsed.set(judge.id + ':' + row.id, { ok: false, code: result.code, verdict: null });
        costUnknown = true;
      }
      for (const attempt of result.attempts) {
        calls.push(Object.assign({ judgeId: judge.id, itemId: row.id }, attempt));
      }
      if (config.budgetUsd !== null && sawUsd && spent >= config.budgetUsd) stop = 'budget-truncated';
      if (config.budgetUsd !== null && result.ok && usdThis === null) stop = 'budget-unknown';
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
  let code = 'complete';
  if (stop && !both) code = stop;
  else if (skipped.length) code = 'item-cap';
  else if (!both && anyParsed) code = 'partial';
  else if (!both) code = 'no-verdict';
  const human = both || anyParsed
    ? reviewList(planned, parsed, config.judges, config.seed, config.sampleCount)
    : { schema: 'belliedmonkey.llm-judge.human-review.v1', semanticHumanReviewCount: 0, earReviewUsedAsSemanticReview: false, rows: [] };
  const summary = base({
    ok: code === 'complete',
    code: code,
    called: calls.length > 0,
    synthetic: synthetic,
    doubleBlindComplete: code === 'complete',
    results: itemResults,
    plan: plan,
    assignment: evidenceAssignment,
    usage: {
      calls: calls,
      spentUsd: sawUsd ? spent : null,
      costUnknown: costUnknown || !sawUsd,
    },
    humanReview: human,
  });
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
    else return base({ code: 'usage' });
  }
  if (!args.input || !args.config || !args.out) return base({ code: 'usage' });
  let input;
  let config;
  try {
    input = readJson(args.input);
    config = readJson(args.config);
  } catch (_) {
    return base({ code: 'unreadable', synthetic: args.synthetic });
  }
  return runJudge({
    input: input,
    config: config,
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

module.exports = { runJudge, main, usageOf };
