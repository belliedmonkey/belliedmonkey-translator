'use strict';

const INPUT_SCHEMA = 'belliedmonkey.llm-judge.input.v1';
const CONFIG_SCHEMA = 'belliedmonkey.llm-judge.config.v1';
const VERDICT_SCHEMA = 'belliedmonkey.llm-judge.verdict.v1';
const FINDING_KINDS = ['format-only', 'entity', 'number', 'negation', 'semantic', 'omission', 'addition'];
const KEY_RE = /^[a-z][a-z0-9-]{2,31}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,80}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{2,40}$/;

function fail(code, detail) {
  return { ok: false, code: code, detail: detail || null, results: null };
}

function extraKey(obj, allow) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'type';
  const bad = Object.keys(obj).filter((key) => allow.indexOf(key) === -1);
  return bad.length ? bad[0] : null;
}

function validateInput(doc) {
  const root = extraKey(doc, ['schema', 'task', 'items']);
  if (root === 'type') return fail('input-type');
  if (root) return fail('unknown-field', root);
  if (doc.schema !== INPUT_SCHEMA) return fail('schema');
  if (doc.task === 'translation') return fail('translation-not-open');
  if (doc.task !== 'asr') return fail('task');
  if (!Array.isArray(doc.items) || !doc.items.length) return fail('items');
  const seen = new Set();
  const items = [];
  for (const item of doc.items) {
    const bad = extraKey(item, ['id', 'reference', 'candidates']);
    if (bad === 'type') return fail('item-type');
    if (bad) return fail('unknown-field', bad);
    if (typeof item.id !== 'string' || !ID_RE.test(item.id)) return fail('item-id', item && item.id);
    if (seen.has(item.id)) return fail('duplicate-item', item.id);
    seen.add(item.id);
    if (typeof item.reference !== 'string' || !item.reference.length) return fail('reference', item.id);
    if (!Array.isArray(item.candidates) || item.candidates.length !== 2) return fail('candidates', item.id);
    const keys = [];
    const candidates = [];
    for (const cand of item.candidates) {
      const candBad = extraKey(cand, ['key', 'text']);
      if (candBad === 'type') return fail('candidate-type', item.id);
      if (candBad) return fail('unknown-field', candBad);
      if (typeof cand.key !== 'string' || !KEY_RE.test(cand.key)) return fail('candidate-key', cand && cand.key);
      if (typeof cand.text !== 'string' || !cand.text.length) return fail('candidate-text', item.id);
      if (keys.indexOf(cand.key) !== -1) return fail('duplicate-key', cand.key);
      if (item.id.indexOf(cand.key) !== -1) return fail('identity-in-id', item.id);
      keys.push(cand.key);
      candidates.push({ key: cand.key, text: cand.text });
    }
    items.push({ id: item.id, reference: item.reference, candidates: candidates });
  }
  return { ok: true, items: items };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateConfig(doc) {
  const root = extraKey(doc, [
    'schema', 'seed', 'temperature', 'sampleCount', 'maxItems', 'timeoutMs', 'maxRetries', 'budgetUsd', 'judges', 'prices',
  ]);
  if (root === 'type') return fail('config-type');
  if (root) return fail('unknown-field', root);
  if (doc.schema !== CONFIG_SCHEMA) return fail('schema');
  if (!Number.isInteger(doc.seed)) return fail('seed');
  if (!finiteNumber(doc.temperature) || doc.temperature < 0 || doc.temperature > 2) return fail('temperature');
  if (!Number.isInteger(doc.sampleCount) || doc.sampleCount < 0 || doc.sampleCount > 36) return fail('sampleCount');
  if (!Number.isInteger(doc.maxItems) || doc.maxItems < 1 || doc.maxItems > 200) return fail('maxItems');
  if (!Number.isInteger(doc.timeoutMs) || doc.timeoutMs < 1 || doc.timeoutMs > 120000) return fail('timeoutMs');
  if (!Number.isInteger(doc.maxRetries) || doc.maxRetries < 0 || doc.maxRetries > 2) return fail('maxRetries');
  if (!finiteNumber(doc.budgetUsd) || doc.budgetUsd < 0) return fail('budget-required');
  if (!Array.isArray(doc.judges) || doc.judges.length !== 2) return fail('judge-count');
  const judges = [];
  const models = [];
  for (const judge of doc.judges) {
    const bad = extraKey(judge, ['id', 'model', 'endpointEnv', 'keyEnv']);
    if (bad === 'type') return fail('judge-type');
    if (bad) return fail('unknown-field', bad);
    if (typeof judge.id !== 'string' || !KEY_RE.test(judge.id)) return fail('judge-id');
    if (typeof judge.model !== 'string' || !judge.model.trim() || judge.model !== judge.model.trim()) return fail('model');
    if (!ENV_RE.test(judge.endpointEnv) || !ENV_RE.test(judge.keyEnv)) return fail('env-name');
    if (judge.endpointEnv === judge.keyEnv) return fail('env-name');
    if (models.indexOf(judge.model) !== -1) return fail('same-model');
    models.push(judge.model);
    judges.push({
      id: judge.id,
      model: judge.model,
      endpointEnv: judge.endpointEnv,
      keyEnv: judge.keyEnv,
    });
  }
  if (judges[0].id === judges[1].id) return fail('judge-id');
  const priced = validatePrices(doc.prices, models);
  if (!priced.ok) return priced;
  return {
    ok: true,
    seed: doc.seed,
    temperature: doc.temperature,
    sampleCount: doc.sampleCount,
    maxItems: doc.maxItems,
    timeoutMs: doc.timeoutMs,
    maxRetries: doc.maxRetries,
    budgetUsd: doc.budgetUsd,
    judges: judges,
    prices: priced.prices,
  };
}

function validatePrices(doc, models) {
  const root = extraKey(doc, [
    'schema', 'source', 'sourceVersion', 'maxInputTokens', 'maxOutputTokens', 'maxTotalTokens', 'maxRequests', 'models',
  ]);
  if (root === 'type') return fail('price-missing');
  if (root) return fail('unknown-field', root);
  if (!doc || doc.schema !== 'belliedmonkey.llm-judge.prices.v1') return fail('price-schema');
  if (typeof doc.source !== 'string' || !doc.source || typeof doc.sourceVersion !== 'string' || !doc.sourceVersion) {
    return fail('price-source');
  }
  if (!Number.isInteger(doc.maxInputTokens) || doc.maxInputTokens < 1) return fail('maxInputTokens');
  if (!Number.isInteger(doc.maxOutputTokens) || doc.maxOutputTokens < 1) return fail('maxOutputTokens');
  if (!Number.isInteger(doc.maxTotalTokens) || doc.maxTotalTokens < doc.maxInputTokens + doc.maxOutputTokens) {
    return fail('maxTotalTokens');
  }
  if (!Number.isInteger(doc.maxRequests) || doc.maxRequests < 1) return fail('maxRequests');
  const table = {};
  for (const model of models) {
    const row = doc.models && doc.models[model];
    if (!row) return fail('price-missing', model);
    const bad = extraKey(row, ['inputUsdPerToken', 'outputUsdPerToken', 'pricedZero']);
    if (bad) return fail('unknown-field', bad === 'type' ? 'price' : bad);
    if (!finiteNumber(row.inputUsdPerToken) || row.inputUsdPerToken < 0) return fail('price-rate');
    if (!finiteNumber(row.outputUsdPerToken) || row.outputUsdPerToken < 0) return fail('price-rate');
    if (row.pricedZero !== true && row.pricedZero !== false) return fail('price-zero-unmarked');
    if (row.pricedZero === true && (row.inputUsdPerToken !== 0 || row.outputUsdPerToken !== 0)) return fail('price-zero-unmarked');
    if (row.pricedZero === false && row.inputUsdPerToken === 0 && row.outputUsdPerToken === 0) return fail('price-zero-unmarked');
    const reserveUsd = doc.maxInputTokens * row.inputUsdPerToken + doc.maxOutputTokens * row.outputUsdPerToken;
    table[model] = {
      inputUsdPerToken: row.inputUsdPerToken,
      outputUsdPerToken: row.outputUsdPerToken,
      pricedZero: row.pricedZero,
      reserveUsd: reserveUsd,
    };
  }
  return {
    ok: true,
    prices: {
      schema: doc.schema,
      source: doc.source,
      sourceVersion: doc.sourceVersion,
      maxInputTokens: doc.maxInputTokens,
      maxOutputTokens: doc.maxOutputTokens,
      maxTotalTokens: doc.maxTotalTokens,
      maxRequests: doc.maxRequests,
      models: table,
    },
  };
}

function reserveFor(prices, model) {
  const row = prices.models[model];
  return row ? row.reserveUsd : null;
}

module.exports = {
  INPUT_SCHEMA,
  CONFIG_SCHEMA,
  VERDICT_SCHEMA,
  FINDING_KINDS,
  validateInput,
  validateConfig,
  reserveFor,
};
