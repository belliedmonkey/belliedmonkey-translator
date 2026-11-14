'use strict';
// Offline dry-run only. Does not pass --run, does not read keys, does not call a network transport.
// Injects an official tokenizer countTokens function into the frozen pack without modifying pack files.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runJudge } = require('../verify-8ddf6e8e/pkg-unpacked/run-judge.js');

const root = path.resolve(__dirname);
const python = process.env.JUDGE_TOKEN_PYTHON || '/tmp/judge-tok-venv/bin/python';
const helper = path.join(root, 'count-tokens.py');

function countTokens(body) {
  const req = JSON.parse(body);
  const child = spawnSync(python, [helper], {
    input: JSON.stringify({ model: req.model, messages: req.messages }),
    encoding: 'utf8',
    timeout: 30000,
  });
  if (child.status !== 0) {
    process.stderr.write((child.stderr || child.stdout || 'count-failed') + '\n');
    return -1;
  }
  const n = Number(String(child.stdout).trim());
  if (!Number.isInteger(n) || n < 0) return -1;
  return n;
}

async function main() {
  const input = JSON.parse(fs.readFileSync(path.join(root, '..', 'input-asr-36.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.draft-openrouter-20261113.json'), 'utf8'));
  const out = path.join(root, 'dryrun-plan');
  fs.mkdirSync(out, { recursive: true });
  const summary = await runJudge({
    input,
    config,
    out,
    run: false,
    synthetic: false,
    countTokens,
  });
  const publicSummary = {
    ok: summary.ok,
    code: summary.code,
    called: summary.called,
    synthetic: summary.synthetic,
    results: summary.results,
    doubleBlindComplete: summary.doubleBlindComplete,
    itemCount: summary.plan && summary.plan.itemIds ? summary.plan.itemIds.length : null,
    omittedIds: summary.omittedIds || null,
    maxDeclaredTokens: summary.plan && summary.plan.inputChecks
      ? Math.max(...summary.plan.inputChecks.map((r) => r.declaredTokens || 0))
      : null,
    minDeclaredTokens: summary.plan && summary.plan.inputChecks
      ? Math.min(...summary.plan.inputChecks.map((r) => r.declaredTokens || Infinity))
      : null,
    allBoundOk: summary.plan && summary.plan.inputChecks
      ? summary.plan.inputChecks.every((r) => r.ok)
      : null,
    methods: summary.plan && summary.plan.inputChecks
      ? Array.from(new Set(summary.plan.inputChecks.map((r) => r.method)))
      : null,
    budgetUsd: summary.plan && summary.plan.budgetUsd,
    reserveUsd: summary.plan && summary.plan.prices && summary.plan.prices.reserveUsd,
    maxTokensFieldProviderVerified: summary.plan && summary.plan.maxTokensFieldProviderVerified,
  };
  process.stdout.write(JSON.stringify(publicSummary, null, 2) + '\n');
  process.exit(summary.ok ? 0 : 2);
}

main().catch((err) => {
  process.stderr.write((err && err.stack) || String(err));
  process.exit(1);
});
