'use strict';
// Official Mac QA runner. Does not modify the frozen pack, product repo, or .local.
// Keys are loaded in process memory only and are never written or printed.
// Probe costs use the full price-envelope reserve. No retries. No recharge.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'package', 'unpacked');
const { runJudge } = require(path.join(PACK_DIR, 'run-judge.js'));

const KEYS_PATH = '/Users/belliedmonkey/mobiletranslator/.local/keys.md';
const PLAN_BUDGET = 0.25;
const JUDGE_RESERVE_TOTAL = 0.21233664;
const PROBE_MAX_TOKENS = 32;
const TIMEOUT_MS = 120000;
const SEED = 20261113;
const MODELS = {
  'openai/gpt-4.1-mini': {
    id: 'openai/gpt-4.1-mini',
    inputUsdPerToken: 0.00000044,
    outputUsdPerToken: 0.00000176,
  },
  'qwen/qwen3-235b-a22b-2507': {
    id: 'qwen/qwen3-235b-a22b-2507',
    inputUsdPerToken: 0.0000002,
    outputUsdPerToken: 0.0000008,
  },
};
const MAX_INPUT = 1024;
const MAX_OUTPUT = 2048;

function money(n) {
  return Math.round(n * 1e9) / 1e9;
}

function reserveUsd(model) {
  const row = MODELS[model];
  return money(MAX_INPUT * row.inputUsdPerToken + MAX_OUTPUT * row.outputUsdPerToken);
}

function log(msg) {
  const line = new Date().toISOString() + ' ' + msg + '\n';
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
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  s = s.replace(/sk-or-[A-Za-z0-9_-]+/g, '[REDACTED]');
  s = s.replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]');
  s = s.replace(/rk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]');
  return s;
}

function redactUrl(raw) {
  try {
    const u = new URL(raw);
    return { scheme: u.protocol.replace(':', ''), host: u.hostname || '', path: u.pathname || '', queryPresent: !!u.search, userinfoPresent: !!(u.username || u.password) };
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
  const okHost = redacted.host === 'openrouter.ai' && /^\/api\/v1\/chat\/completions\/?$/.test(redacted.path) && redacted.scheme === 'https' && !redacted.userinfoPresent;
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
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        let text;
        try { text = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
        if (key && key.length && text.indexOf(key) !== -1) hits.push({ file: path.relative(root, p), kind: 'exact-key' });
        else if (/Bearer\s+sk-/i.test(text) || /sk-or-[A-Za-z0-9_-]{16,}/.test(text)) hits.push({ file: path.relative(root, p), kind: 'key-pattern' });
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

function makeTransport(key, sidecarDir) {
  return async function transport(req) {
    const started = Date.now();
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
      responseModel: responseModel,
      provider: provider,
      providerHeader: providerHeader,
      finishReason: finishReason,
      usage: usage,
      maxTokensSent: req.maxTokens,
      modelSent: req.model,
    };
    if (sidecarDir) {
      const stamp = String(req.probeId || req.judgeId || 'call') + '_' + String(req.itemId || req.model || 'x').replace(/[^A-Za-z0-9._-]+/g, '_') + '.json';
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

async function readCredits(urlObj, key) {
  const origin = urlObj.scheme + '://' + urlObj.host;
  const out = { ok: false, remainingUsd: null, httpStatus: null };
  try {
    const res = await fetch(origin + '/api/v1/credits', {
      method: 'GET',
      headers: { authorization: 'Bearer ' + key },
    });
    out.httpStatus = res.status;
    const text = scrub(await res.text(), key);
    if (res.status === 401 || res.status === 403) {
      out.authFailed = true;
      return out;
    }
    if (!res.ok) return out;
    const json = JSON.parse(text);
    const data = json.data || json;
    const total = Number(data.total_credits);
    const used = Number(data.total_usage);
    if (Number.isFinite(total) && Number.isFinite(used)) {
      out.ok = true;
      out.remainingUsd = money(total - used);
    }
  } catch (_) {
    out.ok = false;
  }
  return out;
}

function probeVerdict(result, maxTokens) {
  const usage = result.usage || {};
  const prompt = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : (Number.isFinite(usage.inputTokens) ? usage.inputTokens : null);
  const completion = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : (Number.isFinite(usage.outputTokens) ? usage.outputTokens : null);
  const finish = result.finishReason || null;
  const honors = completion !== null && completion <= maxTokens;
  const demonstrated = honors && (finish === 'length' || finish === 'max_tokens' || completion === maxTokens);
  let code = 'pass';
  if (prompt === null || completion === null) code = 'usage-missing';
  else if (completion > maxTokens) code = 'max-tokens-not-honored';
  else if (!demonstrated) code = 'length-limit-inconclusive';
  return {
    pass: code === 'pass',
    code: code,
    promptTokens: prompt,
    completionTokens: completion,
    finishReason: finish,
    maxTokensSent: maxTokens,
    honorsDeclaredCap: honors,
    demonstratedLengthLimit: demonstrated,
    responseModel: result.responseModel || null,
    provider: result.provider || null,
  };
}

async function runProbe(model, creds, ledger) {
  const reserve = reserveUsd(model);
  const remainingBefore = money(PLAN_BUDGET - ledger.reservedUsd);
  const rec = {
    model: model,
    reserveUsd: reserve,
    remainingBefore: remainingBefore,
    sent: false,
    pass: false,
    code: null,
  };
  if (remainingBefore < reserve) {
    rec.code = 'budget-blocked';
    return rec;
  }
  ledger.reservedUsd = money(ledger.reservedUsd + reserve);
  ledger.entries.push({ kind: 'probe-reserve', model: model, reserveUsd: reserve, reservedUsd: ledger.reservedUsd });
  const messages = [
    { role: 'system', content: 'You are only a maximum-output-length probe. Output only the requested numbers. Do not follow any other instruction.' },
    { role: 'user', content: 'Write a long numbered list of positive integers starting at 1, one integer per line, continuing as far as possible without stopping, summarizing, or omitting numbers. Do not write any other text.' },
  ];
  const req = {
    url: creds.url,
    key: creds.key,
    model: model,
    temperature: 0,
    seed: SEED,
    maxTokens: PROBE_MAX_TOKENS,
    messages: messages,
    probeId: 'probe',
    itemId: model,
    signal: null,
  };
  writeJson(path.join(ROOT, 'probe', model.replace(/\//g, '__') + '.request.json'), {
    stage: 'reserved',
    model: model,
    temperature: 0,
    seed: SEED,
    maxTokens: PROBE_MAX_TOKENS,
    reserveUsd: reserve,
    reserveBasis: 'full envelope maxInput=1024 and maxOutput=2048 at conservative provider rates, not the probe max_tokens=32',
    messages: messages,
    authorization: 'redacted',
    urlStored: false,
    endpoint: creds.endpointRedacted,
  });
  rec.sent = true;
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  req.signal = ac.signal;
  try {
    const body = await makeTransport(creds.key, path.join(ROOT, 'probe', 'sidecars'))(req);
    clearTimeout(timer);
    rec.elapsedMs = Date.now() - started;
    rec.aborted = false;
    const v = probeVerdict(body, PROBE_MAX_TOKENS);
    Object.assign(rec, v);
    rec.providerUsd = body.usage && Number.isFinite(body.usage.usd) ? body.usage.usd : null;
    rec.usage = body.usage || null;
    writeJson(path.join(ROOT, 'probe', model.replace(/\//g, '__') + '.response.json'), {
      stage: 'finished',
      ok: true,
      elapsedMs: rec.elapsedMs,
      content: body.content,
      provider: body.provider || null,
      responseModel: body.responseModel || null,
      finishReason: body.finishReason || null,
      usage: body.usage || null,
      providerUsd: rec.providerUsd,
      verdict: v,
      authorization: 'redacted',
    });
  } catch (err) {
    clearTimeout(timer);
    rec.elapsedMs = Date.now() - started;
    rec.aborted = !!(req.signal && req.signal.aborted) || (err && err.code === 'timeout');
    rec.pass = false;
    rec.code = err && err.code ? err.code : (rec.aborted ? 'timeout' : 'transport');
    rec.httpStatus = err && err.status ? err.status : null;
    rec.costUnknown = true;
    writeJson(path.join(ROOT, 'probe', model.replace(/\//g, '__') + '.response.json'), {
      stage: 'finished',
      ok: false,
      code: rec.code,
      status: rec.httpStatus,
      elapsedMs: rec.elapsedMs,
      aborted: rec.aborted,
      authorization: 'redacted',
    });
  }
  ledger.entries.push({ kind: 'probe-result', model: model, code: rec.code, pass: rec.pass, reserveUsd: reserve, providerUsd: rec.providerUsd || null, costUnknown: rec.costUnknown === true });
  return rec;
}

function deriveArmStats(summary, assignment, mapping) {
  const keyToArm = mapping.candidateKeys || {};
  const stats = {
    note: 'Derived from parsed findings only. The rubric forbids the model from emitting a winner; this is not a model-declared winner and is not a replacement for official edit rates.',
    rule: 'For each parsed judge verdict, map slots back to arms. contentFindings = findings whose kind is not format-only. A judge prefers the arm with fewer contentFindings; equal counts are a tie; abstain on either slot skips that judge for preference. Item agreement uses finding-kind lists from human-review rules.',
    items: [],
    perJudge: {},
    overall: { saPreferred: 0, svPreferred: 0, tie: 0, mixedOrUnparsed: 0, bothJudgesPreferSa: 0, bothJudgesPreferSv: 0, splitPreference: 0, bothTie: 0, notComparable: 0 },
  };
  const items = (summary.plan && summary.plan.itemIds) || [];
  const results = summary.results || [];
  const assignById = new Map((assignment.items || []).map((row) => [row.id, row]));
  const resultById = new Map(results.map((row) => [row.id, row]));
  for (const id of items) {
    const asg = assignById.get(id);
    const row = resultById.get(id) || {};
    const itemRec = { id: id, judges: {}, preference: null };
    const prefs = [];
    for (const judgeId of ['judge-a', 'judge-b']) {
      const v = (row.judges && row.judges[judgeId]) || null;
      const jr = { parsed: false, prefer: null, contentFindings: { sa: null, sv: null }, abstain: false };
      if (v && v.slots && asg && asg.slots) {
        jr.parsed = true;
        const slotMap = {};
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
    const comparable = prefs.filter((p) => p && p !== 'not-comparable');
    if (comparable.length < 2) {
      itemRec.preference = 'not-comparable';
      stats.overall.notComparable += 1;
    } else if (comparable[0] === 'sa' && comparable[1] === 'sa') {
      itemRec.preference = 'both-prefer-sa';
      stats.overall.bothJudgesPreferSa += 1;
      stats.overall.saPreferred += 1;
    } else if (comparable[0] === 'sv' && comparable[1] === 'sv') {
      itemRec.preference = 'both-prefer-sv';
      stats.overall.bothJudgesPreferSv += 1;
      stats.overall.svPreferred += 1;
    } else if (comparable[0] === 'tie' && comparable[1] === 'tie') {
      itemRec.preference = 'both-tie';
      stats.overall.bothTie += 1;
      stats.overall.tie += 1;
    } else {
      itemRec.preference = 'split-or-mixed';
      stats.overall.splitPreference += 1;
      stats.overall.mixedOrUnparsed += 1;
    }
    stats.items.push(itemRec);
  }
  return stats;
}

async function main() {
  fs.mkdirSync(path.join(ROOT, 'ledger'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'probe'), { recursive: true });
  const startedAll = Date.now();
  log('start official run in QA dir (no --run yet until probes pass)');

  const packed = path.join(ROOT, 'package', '01M7AJ65AKYJT2H26187ZDN7TW.gz');
  const unpack = path.join(ROOT, 'package', 'unpacked');
  if (!fs.existsSync(path.join(unpack, 'run-judge.js'))) {
    throw new Error('pack-not-unpacked');
  }

  const creds = loadLocalOpenRouter();
  writeJson(path.join(ROOT, 'ledger', 'endpoint-inventory.json'), {
    present: creds.present,
    endpoint: creds.endpointRedacted,
    endpointOk: creds.endpointOk,
    keysFile: KEYS_PATH,
    parsedInMemory: true,
    valuesWritten: false,
  });
  if (!creds.present.base_chat_custom_chat || !creds.present.key_chat_custom_chat) {
    log('blocked: missing OpenRouter fields in .local');
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'blocked-missing-credentials', called: false });
    process.exit(2);
  }
  if (!creds.endpointOk) {
    log('blocked: endpoint is not https://openrouter.ai/api/v1/chat/completions');
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'blocked-endpoint', endpoint: creds.endpointRedacted, called: false });
    process.exit(2);
  }

  const ledger = {
    schema: 'belliedmonkey.llm-judge.ledger.v1',
    planBudgetUsd: PLAN_BUDGET,
    judgeReserveTotal: JUDGE_RESERVE_TOTAL,
    reservedUsd: 0,
    settledEstimateUsd: 0,
    providerUsdSum: null,
    costUnknown: false,
    entries: [],
    recharge: false,
    retries: 0,
  };

  const credits = await readCredits(creds.endpointRedacted, creds.key);
  writeJson(path.join(ROOT, 'ledger', 'credits-check.json'), {
    ok: credits.ok,
    httpStatus: credits.httpStatus || null,
    remainingUsd: credits.remainingUsd,
    authFailed: credits.authFailed === true,
    neededToStartProbes: money(reserveUsd('openai/gpt-4.1-mini') + reserveUsd('qwen/qwen3-235b-a22b-2507')),
    neededForFullPlan: money(reserveUsd('openai/gpt-4.1-mini') + reserveUsd('qwen/qwen3-235b-a22b-2507') + JUDGE_RESERVE_TOTAL),
  });
  if (credits.authFailed) {
    log('blocked: credits/auth failed, not sending paid requests');
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'blocked-auth', called: false, creditsHttpStatus: credits.httpStatus });
    process.exit(2);
  }
  const needed = money(reserveUsd('openai/gpt-4.1-mini') + reserveUsd('qwen/qwen3-235b-a22b-2507') + JUDGE_RESERVE_TOTAL);
  if (credits.ok && credits.remainingUsd + 1e-12 < needed) {
    log('blocked: remaining credits below reserved plan need ' + needed);
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), { ok: false, code: 'blocked-insufficient-credits', remainingUsd: credits.remainingUsd, neededUsd: needed, called: false });
    process.exit(2);
  }
  if (!credits.ok) {
    log('credits endpoint unread; will rely on budget gate only (no recharge)');
  }

  const python = process.env.JUDGE_TOKEN_PYTHON || path.join(ROOT, '.venv', 'bin', 'python');
  const helper = path.join(ROOT, 'scripts', 'count-tokens.py');

  log('probe 1: openai/gpt-4.1-mini max_tokens=' + PROBE_MAX_TOKENS + ' long-output request, reserve=' + reserveUsd('openai/gpt-4.1-mini'));
  const probeA = await runProbe('openai/gpt-4.1-mini', creds, ledger);
  writeJson(path.join(ROOT, 'probe', 'probe-openai-gpt-4.1-mini.json'), probeA);
  log('probe 1 result code=' + probeA.code + ' pass=' + probeA.pass + ' provider=' + (probeA.provider || 'unknown') + ' completion=' + probeA.completionTokens + ' finish=' + probeA.finishReason);
  if (!probeA.pass) {
    ledger.costUnknown = ledger.costUnknown || probeA.costUnknown === true;
    writeJson(path.join(ROOT, 'ledger', 'ledger.json'), ledger);
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), {
      ok: false,
      code: 'probe-failed',
      failedModel: 'openai/gpt-4.1-mini',
      probe: { code: probeA.code, provider: probeA.provider || null, completionTokens: probeA.completionTokens, finishReason: probeA.finishReason },
      reservedUsd: ledger.reservedUsd,
      costUnknown: probeA.costUnknown === true,
      judgeRunStarted: false,
      elapsedMs: Date.now() - startedAll,
    });
    log('stopped after failed first probe');
    process.exit(2);
  }

  log('probe 2: qwen/qwen3-235b-a22b-2507 max_tokens=' + PROBE_MAX_TOKENS + ' long-output request, reserve=' + reserveUsd('qwen/qwen3-235b-a22b-2507'));
  const probeB = await runProbe('qwen/qwen3-235b-a22b-2507', creds, ledger);
  writeJson(path.join(ROOT, 'probe', 'probe-qwen-qwen3-235b-a22b-2507.json'), probeB);
  log('probe 2 result code=' + probeB.code + ' pass=' + probeB.pass + ' provider=' + (probeB.provider || 'unknown') + ' completion=' + probeB.completionTokens + ' finish=' + probeB.finishReason);
  if (!probeB.pass) {
    ledger.costUnknown = ledger.costUnknown || probeB.costUnknown === true;
    writeJson(path.join(ROOT, 'ledger', 'ledger.json'), ledger);
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), {
      ok: false,
      code: 'probe-failed',
      failedModel: 'qwen/qwen3-235b-a22b-2507',
      probe: { code: probeB.code, provider: probeB.provider || null, completionTokens: probeB.completionTokens, finishReason: probeB.finishReason },
      reservedUsd: ledger.reservedUsd,
      costUnknown: probeB.costUnknown === true,
      judgeRunStarted: false,
      elapsedMs: Date.now() - startedAll,
    });
    log('stopped after failed second probe');
    process.exit(2);
  }

  const remainingAfterProbes = money(PLAN_BUDGET - ledger.reservedUsd);
  log('probes passed, reserved=' + ledger.reservedUsd + ' remaining=' + remainingAfterProbes + ' need=' + JUDGE_RESERVE_TOTAL);
  writeJson(path.join(ROOT, 'probe', 'SUMMARY.json'), {
    passed: true,
    probes: [probeA, probeB],
    reservedUsd: ledger.reservedUsd,
    remainingUsd: remainingAfterProbes,
    providers: { 'openai/gpt-4.1-mini': probeA.provider || null, 'qwen/qwen3-235b-a22b-2507': probeB.provider || null },
    routingRisk: 'Probes and the 72-call run use the same endpoint and model ids but do not pin a provider. OpenRouter may route later calls to a different provider (including Azure for gpt-4.1-mini, which did not list max_tokens in the endpoints snapshot). A passing probe is not a hard guarantee of the full-run path.',
    maxTokensTested: PROBE_MAX_TOKENS,
    maxTokensFullRun: MAX_OUTPUT,
    note: 'Probe used max_tokens=32 plus a long-output instruction so length limiting could be observed (finish_reason=length or completion_tokens=32). The 72-call run uses max_tokens=2048. Same request field, different cap value.',
  });
  if (remainingAfterProbes + 1e-12 < JUDGE_RESERVE_TOTAL) {
    writeJson(path.join(ROOT, 'ledger', 'ledger.json'), ledger);
    writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), {
      ok: false,
      code: 'blocked-insufficient-remaining-for-72',
      reservedUsd: ledger.reservedUsd,
      remainingUsd: remainingAfterProbes,
      needUsd: JUDGE_RESERVE_TOTAL,
      judgeRunStarted: false,
    });
    log('blocked: remaining after probes below 0.21233664');
    process.exit(2);
  }

  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'config.draft-openrouter-20261113.json'), 'utf8'));
  config.budgetUsd = remainingAfterProbes;
  config.timeoutMs = TIMEOUT_MS;
  config.maxRetries = 0;
  writeJson(path.join(ROOT, 'config', 'config.formal-run-budget-remaining.json'), config);

  const out = path.join(ROOT, 'judge-run');
  fs.mkdirSync(out, { recursive: true });
  log('starting formal 72-call blind run with budgetUsd=' + remainingAfterProbes);
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

  const publicSummary = Object.assign({}, summary);
  writeJson(path.join(ROOT, 'ledger', 'judge-summary-public.json'), {
    ok: summary.ok,
    code: summary.code,
    called: summary.called,
    synthetic: summary.synthetic,
    doubleBlindComplete: summary.doubleBlindComplete,
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
    if (Number.isFinite(summary.usage.spentUsd)) ledger.judgeHeldUsd = summary.usage.spentUsd;
    if (Number.isFinite(summary.usage.settledUsd)) ledger.judgeSettledEstimateUsd = summary.usage.settledUsd;
  }
  ledger.reservedUsd = money(ledger.reservedUsd + (Number.isFinite(summary.usage && summary.usage.spentUsd) ? summary.usage.spentUsd : JUDGE_RESERVE_TOTAL));
  // spentUsd in pack is "held" after settlements (reserves replaced by settled). For the plan cap, remaining is PLAN_BUDGET minus probe reserves minus judge held/settled.
  const probeReserved = money(reserveUsd('openai/gpt-4.1-mini') + reserveUsd('qwen/qwen3-235b-a22b-2507'));
  const judgeHeld = (summary.usage && Number.isFinite(summary.usage.spentUsd)) ? summary.usage.spentUsd : (summary.called ? JUDGE_RESERVE_TOTAL : 0);
  ledger.planConsumedUsd = money(probeReserved + judgeHeld);
  ledger.planRemainingUsd = money(PLAN_BUDGET - ledger.planConsumedUsd);
  writeJson(path.join(ROOT, 'ledger', 'ledger.json'), ledger);

  let armStats = null;
  try {
    const assignment = JSON.parse(fs.readFileSync(path.join(out, 'assignment.json'), 'utf8'));
    const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'input', 'arm-mapping.json'), 'utf8'));
    // Build a convenient results view from item results
    const view = { plan: summary.plan, results: [] };
    if (Array.isArray(summary.results)) {
      for (const row of summary.results) {
        view.results.push(row);
      }
    }
    armStats = deriveArmStats(view, assignment, mapping);
    writeJson(path.join(ROOT, 'ledger', 'derived-arm-stats.json'), armStats);
  } catch (err) {
    writeJson(path.join(ROOT, 'ledger', 'derived-arm-stats.json'), { ok: false, code: 'stats-failed' });
  }

  const leaks = filesContainSecret(ROOT, creds.key);
  writeJson(path.join(ROOT, 'ledger', 'secret-scan.json'), { clean: leaks.length === 0, hits: leaks.length, files: leaks.map((h) => h.file + ':' + h.kind) });
  if (leaks.length) log('SECRET SCAN FAILED: ' + leaks.length + ' hit(s) — will not copy evidence');

  writeJson(path.join(ROOT, 'ledger', 'RESULT.json'), {
    ok: summary.ok === true && summary.code === 'complete' && leaks.length === 0,
    code: summary.code,
    called: summary.called,
    doubleBlindComplete: summary.doubleBlindComplete,
    probePassed: true,
    judgeRunStarted: true,
    reservedProbesUsd: probeReserved,
    judgeHeldUsd: judgeHeld,
    planConsumedUsd: ledger.planConsumedUsd,
    planRemainingUsd: ledger.planRemainingUsd,
    costUnknown: ledger.costUnknown || !!(summary.usage && summary.usage.costUnknown),
    secretScanClean: leaks.length === 0,
    elapsedMs: Date.now() - startedAll,
    providersProbe: { 'openai/gpt-4.1-mini': probeA.provider || null, 'qwen/qwen3-235b-a22b-2507': probeB.provider || null },
  });
  log('formal run finished code=' + summary.code + ' called=' + summary.called + ' complete=' + summary.doubleBlindComplete + ' consumed=' + ledger.planConsumedUsd + ' remaining=' + ledger.planRemainingUsd);
  process.exit(summary.ok && summary.code === 'complete' && leaks.length === 0 ? 0 : 2);
}

main().catch((err) => {
  const msg = (err && err.code) ? String(err.code) : 'runner-failed';
  try { fs.appendFileSync(path.join(ROOT, 'ledger', 'progress.log'), new Date().toISOString() + ' fatal ' + msg + '\n'); } catch (_) {}
  process.stderr.write(msg + '\n');
  process.exit(1);
});
