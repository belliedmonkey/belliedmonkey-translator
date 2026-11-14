'use strict';
// Official Mac QA runner for asr.v2 / verdict.v2. Does not modify the frozen
// pack, product repo, or .local. Keys are loaded in process memory only and
// are never written or printed. No new paid probes. No retries. No recharge.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'package', 'unpacked');
const { runJudge } = require(path.join(PACK_DIR, 'run-judge.js'));
const { promptTemplateSha256, ASR_VERSION } = require(path.join(PACK_DIR, 'rubric.js'));
const { VERDICT_SCHEMA } = require(path.join(PACK_DIR, 'schema.js'));

const KEYS_PATH = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';
const CUMULATIVE_PLAN_USD = 0.28;
const HISTORICAL_CONSUMED_USD = 0.05570372;
const THIS_ROUND_POOL_USD = 0.22429628;
const JUDGE_RESERVE_TOTAL = 0.21528576;
const TIMEOUT_MS = 120000;
const EXPECTED_PROMPT_SHA = 'a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923';
const EXPECTED_ASSIGNMENT_SHA = '3c54b9c2571ce63b6203d004f3ab2e109da7e7ba39feeda438c88fc8a4e79470';
const FORMAL_CONFIG_SHA = 'e101ef5e9055f14c397505046d5033c2d62242f7cf5d1a6068632e0c24683180';
const MODELS = {
  'openai/gpt-4.1-mini': { inputUsdPerToken: 0.00000044, outputUsdPerToken: 0.00000176 },
  'qwen/qwen3-235b-a22b-2507': { inputUsdPerToken: 0.0000002, outputUsdPerToken: 0.0000008 },
};
const MAX_INPUT = 1152;
const MAX_OUTPUT = 2048;

function money(n) {
  return Math.round(n * 1e9) / 1e9;
}

function sha256File(file) {
  return require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function log(msg) {
  const line = new Date().toISOString() + ' ' + msg + '\n';
  fs.mkdirSync(path.join(ROOT, 'ledger'), { recursive: true });
  fs.appendFileSync(path.join(ROOT, 'ledger', 'progress.log'), line);
  process.stdout.write(line);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function scrub(text, key) {
  if (text == null) return text;
  let s = String(text);
  if (key && key.length) s = s.split(key).join('[REDACTED]');
  const bearer = 'Bearer';
  s = s.replace(new RegExp(bearer + '\\s+\\S+', 'gi'), bearer + ' [REDACTED]');
  const orPref = 'sk-or-';
  s = s.replace(new RegExp(orPref + '[A-Za-z0-9_-]+', 'g'), '[REDACTED]');
  s = s.replace(new RegExp('\\bsk-[A-Za-z0-9_-]{16,}', 'g'), '[REDACTED]');
  return s;
}

function redactUrl(raw) {
  try {
    const u = new URL(raw);
    return {
      scheme: u.protocol.replace(':', ''),
      host: u.hostname || '',
      path: u.pathname || '',
      queryPresent: !!u.search,
      userinfoPresent: !!(u.username || u.password),
    };
  } catch (_) {
    return { scheme: '', host: '', path: '', queryPresent: false, userinfoPresent: false, parseError: true };
  }
}

function loadLocalOpenRouter() {
  const text = fs.readFileSync(KEYS_PATH, 'utf8');
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_.-]{1,80})\s*[=:]\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'key_chat_custom_chat' || m[1] === 'base_chat_custom_chat') {
      let v = m[2].trim();
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      fields[m[1]] = v;
    }
  }
  const url = fields.base_chat_custom_chat || '';
  const key = fields.key_chat_custom_chat || '';
  const redacted = redactUrl(url);
  const okHost = redacted.host === 'openrouter.ai'
    && /^\/api\/v1\/chat\/completions\/?$/.test(redacted.path)
    && redacted.scheme === 'https'
    && !redacted.userinfoPresent;
  return {
    url,
    key,
    present: { base_chat_custom_chat: !!url, key_chat_custom_chat: !!key },
    endpointRedacted: redacted,
    endpointOk: okHost,
  };
}

function filesContainSecret(root, key) {
  const hits = [];
  const skipDir = new Set(['.venv', 'node_modules', '.git', 'tokenizers']);
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('._')) continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (!skipDir.has(name)) walk(p);
        continue;
      }
      if (st.size > 2 * 1024 * 1024) continue;
      let text;
      try { text = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
      if (key && key.length && text.indexOf(key) !== -1) {
        hits.push({ file: path.relative(root, p), kind: 'exact-key' });
        continue;
      }
      const rel = path.relative(root, p);
      if (rel.startsWith('scripts' + path.sep)) continue;
      const orPref = 'sk-or-';
      const pat = new RegExp(orPref + '[A-Za-z0-9_-]{16,}');
      if (new RegExp('Bearer\\s+sk-', 'i').test(text) || pat.test(text)) {
        hits.push({ file: rel, kind: 'key-pattern' });
      }
    }
  }
  walk(root);
  return hits;
}

function countTokensFactory(python, helper) {
  return function countTokens(body) {
    const req = JSON.parse(body);
    const child = spawnSync(python, [helper], {
      input: JSON.stringify({ model: req.model, messages: req.messages }),
      encoding: 'utf8',
      timeout: 30000,
      env: Object.assign({}, process.env, {
        JUDGE_QWEN_TOKENIZER_DIR: path.join(ROOT, 'tokenizers', 'qwen'),
      }),
    });
    if (child.status !== 0) return -1;
    const n = Number(String(child.stdout).trim());
    if (!Number.isInteger(n) || n < 0) return -1;
    return n;
  };
}

function itemIdFromReq(req) {
  if (req.itemId) return String(req.itemId);
  try {
    const user = req.messages && req.messages[1] && req.messages[1].content;
    const doc = typeof user === 'string' ? JSON.parse(user) : user;
    if (doc && doc.itemId) return String(doc.itemId);
  } catch (_) {}
  return null;
}

function makeTransport(key, sidecarDir) {
  return async function transport(req) {
    const started = Date.now();
    const itemId = itemIdFromReq(req);
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
    const rawText = await res.text();
    const safeText = scrub(rawText, key);
    let json = null;
    try { json = JSON.parse(rawText); } catch (_) { json = null; }
    const providerHeader = res.headers.get('x-provider-name') || res.headers.get('X-Provider-Name') || null;
    const provider = (json && (json.provider || json.provider_name)) || providerHeader || null;
    const finishReason = json && json.choices && json.choices[0] && json.choices[0].finish_reason || null;
    const responseModel = json && json.model || null;
    const usageRaw = json && json.usage ? json.usage : null;
    const usage = usageRaw ? Object.assign({}, usageRaw) : null;
    if (usage) {
      if (Number.isFinite(json.usd)) usage.usd = json.usd;
      else if (Number.isFinite(usage.cost)) usage.usd = usage.cost;
      else if (usage.cost && Number.isFinite(Number(usage.cost))) usage.usd = Number(usage.cost);
    }
    const sidecar = {
      httpStatus: res.status,
      ok: res.ok,
      elapsedMs: Date.now() - started,
      itemId: itemId,
      judgeId: req.judgeId || null,
      responseModel: responseModel,
      modelSent: req.model,
      modelMatchesConfig: responseModel == null || String(responseModel) === String(req.model) || String(responseModel).indexOf(String(req.model)) === 0,
      provider: provider,
      providerHeader: providerHeader,
      finishReason: finishReason,
      usage: usage,
      maxTokensSent: req.maxTokens,
      inputTokens: usage && (usage.prompt_tokens || usage.input_tokens) || null,
      outputTokens: usage && (usage.completion_tokens || usage.output_tokens) || null,
      providerUsd: usage && Number.isFinite(usage.usd) ? usage.usd : null,
    };
    if (sidecarDir) {
      const stamp = String(req.judgeId || 'call') + '_' + String(itemId || req.model || 'x').replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
      writeJson(path.join(sidecarDir, stamp), sidecar);
    }
    if (!res.ok) {
      const err = new Error('http');
      err.code = 'http';
      err.status = res.status;
      err.safeBody = safeText.slice(0, 400);
      throw err;
    }
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (typeof content !== 'string') {
      const err = new Error('output-unparsed');
      err.code = 'output-unparsed';
      throw err;
    }
    return {
      content: content,
      responseModel: responseModel,
      usage: usage,
      provider: provider,
      finishReason: finishReason,
    };
  };
}

function deriveArmStats(summary, assignment, mapping) {
  const keyToArm = mapping.candidateKeys || {};
  const stats = {
    note: 'Derived from parsed findings only, and only for items where that judge officially parsed. The rubric forbids the model from emitting a winner; this is not a model-declared winner, not a product metric, and not a replacement for official edit rates. Invalid or unparsed judges are not scored as zero.',
    rule: 'For each officially parsed judge verdict, map slots back to arms. contentFindings = findings whose kind is not format-only. A judge prefers the arm with fewer contentFindings; equal counts are a tie; abstain on either slot makes that judge not-comparable. Item-level both-prefer labels require both judges parsed and comparable. Disagreement also uses official reviewList kind-list comparison.',
    items: [],
    overall: {
      bothJudgesParsed: 0,
      saPreferredBoth: 0,
      svPreferredBoth: 0,
      bothTie: 0,
      splitPreference: 0,
      notComparable: 0,
    },
  };
  const items = (summary.plan && summary.plan.itemIds) || [];
  const results = summary.results || [];
  const assignById = new Map((assignment.items || []).map((row) => [row.id, row]));
  const resultById = new Map(results.map((row) => [row.id, row]));
  for (const id of items) {
    const asg = assignById.get(id);
    const row = resultById.get(id) || {};
    const itemRec = { id: id, judges: {}, preference: null, bothParsed: false };
    const prefs = [];
    for (const judgeId of ['judge-a', 'judge-b']) {
      const v = (row.judges && row.judges[judgeId]) || null;
      const jr = { parsed: false, prefer: null, contentFindings: { sa: null, sv: null }, abstain: false };
      if (v && v.schema === VERDICT_SCHEMA && v.slots && asg && asg.slots) {
        jr.parsed = true;
        for (const slot of v.slots) {
          const candKey = asg.slots[slot.slot];
          const arm = keyToArm[candKey];
          if (!arm) continue;
          if (slot.abstain) jr.abstain = true;
          const content = (slot.findings || []).filter((f) => f.kind && f.kind !== 'format-only');
          jr.contentFindings[arm] = slot.abstain ? null : content.length;
        }
        if (jr.contentFindings.sa == null || jr.contentFindings.sv == null) jr.prefer = 'not-comparable';
        else if (jr.contentFindings.sa < jr.contentFindings.sv) jr.prefer = 'sa';
        else if (jr.contentFindings.sv < jr.contentFindings.sa) jr.prefer = 'sv';
        else jr.prefer = 'tie';
        prefs.push(jr.prefer);
      }
      itemRec.judges[judgeId] = jr;
    }
    itemRec.bothParsed = !!(itemRec.judges['judge-a'].parsed && itemRec.judges['judge-b'].parsed);
    if (itemRec.bothParsed) stats.overall.bothJudgesParsed += 1;
    const comparable = prefs.filter((p) => p && p !== 'not-comparable');
    if (!itemRec.bothParsed || comparable.length < 2) {
      itemRec.preference = 'not-comparable';
      stats.overall.notComparable += 1;
    } else if (comparable[0] === 'sa' && comparable[1] === 'sa') {
      itemRec.preference = 'both-prefer-sa';
      stats.overall.saPreferredBoth += 1;
    } else if (comparable[0] === 'sv' && comparable[1] === 'sv') {
      itemRec.preference = 'both-prefer-sv';
      stats.overall.svPreferredBoth += 1;
    } else if (comparable[0] === 'tie' && comparable[1] === 'tie') {
      itemRec.preference = 'both-tie';
      stats.overall.bothTie += 1;
    } else {
      itemRec.preference = 'split-or-mixed';
      stats.overall.splitPreference += 1;
    }
    stats.items.push(itemRec);
  }
  return stats;
}

function countParsed(summary) {
  const out = { 'judge-a': { ok: 0, fail: 0, codes: {} }, 'judge-b': { ok: 0, fail: 0, codes: {} }, bothOk: 0, idsBothOk: [], idsFailA: [], idsFailB: [] };
  const results = (summary && summary.results) || [];
  for (const row of results) {
    const a = row.judges && row.judges['judge-a'];
    const b = row.judges && row.judges['judge-b'];
    if (a) { out['judge-a'].ok += 1; out.idsBothOk; }
    else { out['judge-a'].fail += 1; out.idsFailA.push(row.id); }
    if (b) { out['judge-b'].ok += 1; }
    else { out['judge-b'].fail += 1; out.idsFailB.push(row.id); }
    if (a && b) out.idsBothOk.push(row.id);
  }
  out.bothOk = out.idsBothOk.length;
  return out;
}

function parsedCodesFromDir(dir) {
  const codes = {};
  if (!fs.existsSync(dir)) return codes;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name.startsWith('._')) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const code = doc.ok ? 'parsed' : (doc.code || 'unknown');
    codes[code] = (codes[code] || 0) + 1;
  }
  return codes;
}

async function main() {
  const startedAll = Date.now();
  fs.mkdirSync(path.join(ROOT, 'ledger'), { recursive: true });
  log('start official v2 run in new QA dir; no new probes; no --run until preflight passes');

  if (ASR_VERSION !== 'belliedmonkey.llm-judge.asr.v2' || VERDICT_SCHEMA !== 'belliedmonkey.llm-judge.verdict.v2') {
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'protocol-mismatch', asr: ASR_VERSION, verdict: VERDICT_SCHEMA });
    log('blocked: pack is not asr.v2/verdict.v2');
    process.exit(2);
  }
  const promptSha = promptTemplateSha256();
  if (promptSha !== EXPECTED_PROMPT_SHA) {
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'prompt-sha-mismatch', got: promptSha });
    log('blocked: v2 prompt sha mismatch');
    process.exit(2);
  }

  const formalPath = path.join(ROOT, 'config', 'config.formal-run-budget-remaining.json');
  if (sha256File(formalPath) !== FORMAL_CONFIG_SHA) {
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'formal-config-sha-mismatch' });
    log('blocked: formal config hash mismatch');
    process.exit(2);
  }
  const config = JSON.parse(fs.readFileSync(formalPath, 'utf8'));
  if (config.budgetUsd !== THIS_ROUND_POOL_USD || config.maxRetries !== 0
      || config.prices.maxInputTokens !== MAX_INPUT || config.prices.maxOutputTokens !== MAX_OUTPUT
      || config.prices.maxRequests !== 72 || config.seed !== 20261113) {
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'formal-config-field-mismatch' });
    log('blocked: formal config fields unexpected');
    process.exit(2);
  }

  if (THIS_ROUND_POOL_USD + 1e-12 < JUDGE_RESERVE_TOTAL) {
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), {
      ok: false,
      code: 'blocked-insufficient-remaining-for-72',
      thisRoundPoolUsd: THIS_ROUND_POOL_USD,
      needUsd: JUDGE_RESERVE_TOTAL,
    });
    log('blocked: remaining pool below 72-reserve');
    process.exit(2);
  }

  const reused = JSON.parse(fs.readFileSync(path.join(ROOT, 'probe', 'REUSED-HISTORICAL.json'), 'utf8'));
  writeJson(path.join(ROOT, 'probe', 'DECISION.json'), {
    newProbeThisRound: false,
    reusedHistorical: true,
    thisRoundProbeReserveUsd: 0,
    poolAfterSkippingProbeUsd: THIS_ROUND_POOL_USD,
    judge72ReserveUsd: JUDGE_RESERVE_TOTAL,
    stillEnoughFor72: true,
    risks: reused.risksNotAHardGuarantee,
    note: 'Historical max_tokens=32 / old provider path is not a hard guarantee for this 2048-token unpinned-provider run.',
  });

  let creds;
  try {
    creds = loadLocalOpenRouter();
  } catch (err) {
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'keys-unreadable' });
    log('blocked: cannot read .local keys in memory');
    process.exit(2);
  }
  if (!creds.present.base_chat_custom_chat || !creds.present.key_chat_custom_chat || !creds.endpointOk) {
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), {
      ok: false,
      code: 'blocked-endpoint-or-key-missing',
      present: creds.present,
      endpointRedacted: creds.endpointRedacted,
      endpointOk: creds.endpointOk,
    });
    log('blocked: missing or unexpected OpenRouter fields in .local');
    process.exit(2);
  }

  const ledger = {
    schema: 'belliedmonkey.llm-judge.v2-run-ledger.v1',
    cumulativePlanUsd: CUMULATIVE_PLAN_USD,
    historicalConsumedUsd: HISTORICAL_CONSUMED_USD,
    thisRoundPoolUsd: THIS_ROUND_POOL_USD,
    thisRound72ReserveUsd: JUDGE_RESERVE_TOTAL,
    thisRoundProbeReserveUsd: 0,
    reservedUsd: 0,
    judgeHeldUsd: 0,
    costUnknown: false,
    entries: [{ kind: 'probe-reused-historical', reserveUsd: 0, note: 'no new probe billed this round' }],
  };

  const python = process.env.JUDGE_TOKEN_PYTHON || path.join(ROOT, '.venv', 'bin', 'python');
  const helper = path.join(ROOT, 'scripts', 'count-tokens.py');
  const out = path.join(ROOT, 'judge-run');
  fs.mkdirSync(path.join(out, 'sidecars'), { recursive: true });
  log('starting formal 72-call v2 blind run with budgetUsd=' + config.budgetUsd + ' (this-round remaining pool, not a new 0.28 pool)');
  const input = JSON.parse(fs.readFileSync(path.join(ROOT, 'input', 'input-asr-36.json'), 'utf8'));
  const transport = makeTransport(creds.key, path.join(out, 'sidecars'));
  const summary = await runJudge({
    input: input,
    config: config,
    out: out,
    run: true,
    synthetic: false,
    countTokens: countTokensFactory(python, helper),
    env: {
      JUDGE_OPENROUTER_URL: creds.url,
      JUDGE_OPENROUTER_KEY: creds.key,
    },
    transport: transport,
  });

  writeJson(path.join(ROOT, 'ledger', 'judge-summary-public.json'), {
    ok: summary.ok,
    code: summary.code,
    called: summary.called,
    synthetic: summary.synthetic,
    doubleBlindComplete: summary.doubleBlindComplete,
    asrRubric: summary.asrRubric || (summary.plan && summary.plan.asrRubric),
    promptTemplateSha256: summary.promptTemplateSha256 || (summary.plan && summary.plan.promptTemplateSha256),
    resultsIsNull: summary.results == null,
    itemCount: summary.plan && summary.plan.itemIds ? summary.plan.itemIds.length : null,
    omittedIds: summary.omittedIds || [],
    usage: summary.usage || null,
    semanticHumanReviewCount: summary.semanticHumanReviewCount,
    earReviewUsedAsSemanticReview: summary.earReviewUsedAsSemanticReview,
    editRates: summary.editRates,
    productMetric: summary.productMetric,
    maxTokensFieldProviderVerified: summary.plan && summary.plan.maxTokensFieldProviderVerified,
  });

  if (summary.usage && Array.isArray(summary.usage.calls)) {
    for (const c of summary.usage.calls) {
      ledger.entries.push({
        kind: 'judge-call',
        judgeId: c.judgeId,
        itemId: c.itemId,
        ok: c.ok,
        code: c.code,
        reserveUsd: c.reserveUsd,
        settledUsd: c.settledUsd,
        providerUsd: c.providerUsd,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        elapsedMs: c.elapsedMs,
        costUnknown: c.costUnknown,
        providerExceededDeclaredCap: c.providerExceededDeclaredCap,
      });
      if (c.costUnknown) ledger.costUnknown = true;
    }
  }

  const judgeHeld = (summary.usage && Number.isFinite(summary.usage.spentUsd)) ? summary.usage.spentUsd : (summary.called ? JUDGE_RESERVE_TOTAL : 0);
  const judgeSettled = (summary.usage && Number.isFinite(summary.usage.settledUsd)) ? summary.usage.settledUsd : null;
  const providerSum = (summary.usage && Array.isArray(summary.usage.calls))
    ? money(summary.usage.calls.reduce((s, c) => s + (Number.isFinite(c.providerUsd) ? c.providerUsd : 0), 0))
    : null;
  ledger.judgeHeldUsd = judgeHeld;
  ledger.judgeSettledUsd = judgeSettled;
  ledger.thisRoundProviderUsd = providerSum;
  ledger.thisRoundConsumedUsd = money(judgeHeld);
  ledger.thisRoundRemainingUsd = money(THIS_ROUND_POOL_USD - ledger.thisRoundConsumedUsd);
  ledger.cumulativeConsumedUsd = money(HISTORICAL_CONSUMED_USD + ledger.thisRoundConsumedUsd);
  ledger.cumulativeRemainingUsd = money(CUMULATIVE_PLAN_USD - ledger.cumulativeConsumedUsd);
  writeJson(path.join(ROOT, 'ledger', 'ledger.json'), ledger);

  let assignmentOk = false;
  try {
    const asgSha = sha256File(path.join(out, 'assignment.json'));
    assignmentOk = asgSha === EXPECTED_ASSIGNMENT_SHA;
    writeJson(path.join(ROOT, 'ledger', 'assignment-check.json'), {
      sha256: asgSha,
      expected: EXPECTED_ASSIGNMENT_SHA,
      matchesOfficialV1AnonymousAssignment: assignmentOk,
      note: 'Same seed and unchanged assign.js must reproduce the frozen v1 assignment. Requests still used the new v2 prompt; no v1 verdicts were mixed in.',
    });
    if (!assignmentOk) log('WARNING: assignment sha differs from official v1 mapping');
  } catch (err) {
    writeJson(path.join(ROOT, 'ledger', 'assignment-check.json'), { ok: false, code: 'assignment-missing' });
  }

  let armStats = null;
  try {
    const assignment = JSON.parse(fs.readFileSync(path.join(out, 'assignment.json'), 'utf8'));
    const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'input', 'arm-mapping.json'), 'utf8'));
    armStats = deriveArmStats({ plan: summary.plan, results: summary.results || [] }, assignment, mapping);
    writeJson(path.join(ROOT, 'ledger', 'derived-arm-stats.json'), armStats);
  } catch (err) {
    writeJson(path.join(ROOT, 'ledger', 'derived-arm-stats.json'), { ok: false, code: 'stats-failed' });
  }

  const parseA = parsedCodesFromDir(path.join(out, 'parsed', 'judge-a'));
  const parseB = parsedCodesFromDir(path.join(out, 'parsed', 'judge-b'));
  const counts = countParsed(summary);
  counts['judge-a'].codes = parseA;
  counts['judge-b'].codes = parseB;

  const humanPath = path.join(out, 'human-review.json');
  let human = null;
  if (fs.existsSync(humanPath)) human = JSON.parse(fs.readFileSync(humanPath, 'utf8'));
  writeJson(path.join(ROOT, 'ledger', 'human-review-status.json'), {
    semanticHumanReviewed: false,
    semanticHumanReviewCount: human && human.semanticHumanReviewCount || 0,
    earReviewUsedAsSemanticReview: false,
    disagreementCount: human && Array.isArray(human.disagreement) ? human.disagreement.length : null,
    sampleCount: human && Array.isArray(human.sample) ? human.sample.length : null,
    notAssessedCount: human && Array.isArray(human.notAssessed) ? human.notAssessed.length : null,
    disagreement: human && human.disagreement || [],
    sample: human && human.sample || [],
    notAssessed: human && human.notAssessed || [],
    note: 'Human semantic review was not performed. EAR listen notes are not used as semantic review. Official ASR scores and Latin rules were not changed.',
  });

  const leaks = filesContainSecret(ROOT, creds.key);
  writeJson(path.join(ROOT, 'ledger', 'secret-scan.json'), {
    clean: leaks.length === 0,
    hits: leaks.length,
    files: leaks.map((h) => h.file + ':' + h.kind),
  });
  if (leaks.length) log('SECRET SCAN FAILED: ' + leaks.length + ' hit(s) — will not copy evidence');

  const protocolOk = (summary.plan && summary.plan.asrRubric === 'belliedmonkey.llm-judge.asr.v2'
    && summary.plan.promptTemplateSha256 === EXPECTED_PROMPT_SHA);

  writeJson(path.join(ROOT, 'ledger', 'parse-counts.json'), counts);
  writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), {
    ok: summary.ok === true && summary.code === 'complete' && leaks.length === 0 && protocolOk,
    code: summary.code,
    called: summary.called,
    doubleBlindComplete: summary.doubleBlindComplete === true,
    protocol: {
      asrRubric: summary.plan && summary.plan.asrRubric,
      verdictSchema: VERDICT_SCHEMA,
      promptTemplateSha256: summary.plan && summary.plan.promptTemplateSha256,
      protocolOk: protocolOk,
    },
    probeThisRound: 'reused-historical-32token-old-provider-not-a-hard-guarantee',
    thisRoundProbeReserveUsd: 0,
    judgeRunStarted: true,
    judgeHeldUsd: judgeHeld,
    judgeSettledUsd: judgeSettled,
    thisRoundProviderUsd: providerSum,
    thisRoundConsumedUsd: ledger.thisRoundConsumedUsd,
    thisRoundRemainingUsd: ledger.thisRoundRemainingUsd,
    historicalConsumedUsd: HISTORICAL_CONSUMED_USD,
    cumulativePlanUsd: CUMULATIVE_PLAN_USD,
    cumulativeConsumedUsd: ledger.cumulativeConsumedUsd,
    cumulativeRemainingUsd: ledger.cumulativeRemainingUsd,
    costUnknown: ledger.costUnknown || !!(summary.usage && summary.usage.costUnknown),
    secretScanClean: leaks.length === 0,
    assignmentMatchesV1: assignmentOk,
    elapsedMs: Date.now() - startedAll,
    parseCounts: {
      judgeAOk: counts['judge-a'].ok,
      judgeAFail: counts['judge-a'].fail,
      judgeBOk: counts['judge-b'].ok,
      judgeBFail: counts['judge-b'].fail,
      bothOk: counts.bothOk,
    },
  });
  log('formal v2 run finished code=' + summary.code + ' called=' + summary.called + ' complete=' + summary.doubleBlindComplete + ' thisRoundConsumed=' + ledger.thisRoundConsumedUsd + ' cumulativeRemaining=' + ledger.cumulativeRemainingUsd);
  process.exit(summary.ok && summary.code === 'complete' && leaks.length === 0 && protocolOk ? 0 : 2);
}

main().catch((err) => {
  const msg = (err && err.code) ? String(err.code) : 'runner-failed';
  try { fs.appendFileSync(path.join(ROOT, 'ledger', 'progress.log'), new Date().toISOString() + ' fatal ' + msg + '\n'); } catch (_) {}
  process.stderr.write(msg + '\n');
  process.exit(1);
});
