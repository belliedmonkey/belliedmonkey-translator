'use strict';

const fs = require('fs');
const path = require('path');
const { checkCatalog } = require('./default-chain-check.js');

const ROOT = path.join(__dirname, '..', '..');
const CELL_STATUS = new Set(['applies', 'not-applicable', 'pending', 'opt-in', 'route-dependent']);
const FORM_STATUS = new Set(['wired', 'adjacent']);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function loadInventory() {
  return readJson('eval/baselines/inventory.json');
}

function packageVersion() {
  return JSON.parse(read('package.json')).version;
}

function sampleEligible(record) {
  if (!record || typeof record !== 'object') return { ok: false, reason: 'missing-record' };
  const kind = record.authorization && record.authorization.kind;
  if (kind === 'tool-only') return { ok: false, reason: 'tool-only' };
  if (kind !== 'user-consented' && kind !== 'public-license' && kind !== 'internal-review') {
    return { ok: false, reason: 'authorization' };
  }
  const red = record.redaction;
  if (!red || red.identity !== true) return { ok: false, reason: 'redaction-identity' };
  if (record.form == null || record.stage == null) return { ok: false, reason: 'form-stage' };
  if (!record.setVersion) return { ok: false, reason: 'set-version' };
  return { ok: true, reason: '' };
}

function checkInventory(inv) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!inv || inv.schema !== 'belliedmonkey.baseline-inventory.v1') fail('schema');
  if (inv.measurement !== 'none') fail('measurement must stay none until a protocol run exists');
  if (inv.compositeScore !== null) fail('compositeScore must stay null');
  if (!Array.isArray(inv.thresholds) || inv.thresholds.length !== 0) fail('thresholds must stay empty');
  if (inv.sourceVersion !== packageVersion()) fail('sourceVersion ' + inv.sourceVersion + ' != package.json ' + packageVersion());

  const forms = inv.forms || [];
  const stages = inv.stages || [];
  const formIds = forms.map((f) => f.id);
  const stageIds = stages.map((s) => s.id);
  if (new Set(formIds).size !== formIds.length) fail('duplicate form id');
  if (new Set(stageIds).size !== stageIds.length) fail('duplicate stage id');
  for (const f of forms) {
    if (!FORM_STATUS.has(f.status)) fail('form status ' + f.id);
    if (f.measure !== 'pending') fail('form measure must be pending: ' + f.id);
    if (!Array.isArray(f.e2eDimensions) || f.e2eDimensions.length === 0) fail('e2e dimensions ' + f.id);
  }

  const pins = inv.pins || {};
  for (const [id, pin] of Object.entries(pins)) {
    if (!pin.path || !pin.excerpt) fail('pin shape ' + id);
    else {
      const abs = path.join(ROOT, pin.path);
      if (!fs.existsSync(abs)) fail('missing evidence file ' + pin.path);
      else if (!read(pin.path).includes(pin.excerpt)) fail('excerpt missing in ' + pin.path + ' for ' + id);
    }
  }
  for (const id of [].concat(inv.modelPins || [], inv.promptPins || [], inv.historical || [])) {
    if (!pins[id]) fail('unknown pin ' + id);
  }
  if (!(inv.historical || []).includes('P_WATER')) fail('historical waterline pin required');

  const seen = new Set();
  for (const cell of inv.cells || []) {
    if (!Array.isArray(cell) || cell.length !== 5) {
      fail('cell shape');
      continue;
    }
    const [form, stage, status, note, ev] = cell;
    const key = form + '×' + stage;
    if (seen.has(key)) fail('duplicate cell ' + key);
    seen.add(key);
    if (!formIds.includes(form)) fail('unknown form ' + form);
    if (!stageIds.includes(stage)) fail('unknown stage ' + stage);
    if (!CELL_STATUS.has(status)) fail('cell status ' + key);
    if (typeof note !== 'string' || note.length < 8) fail('cell note ' + key);
    if (!Array.isArray(ev) || ev.length === 0) fail('cell evidence ' + key);
    for (const id of ev) if (!pins[id]) fail('cell pin ' + key + ' ' + id);
  }
  for (const f of formIds) {
    for (const s of stageIds) {
      if (!seen.has(f + '×' + s)) fail('missing cell ' + f + '×' + s);
    }
  }
  return errors;
}

function checkCatalogs() {
  const errors = [];
  const samples = readJson('eval/baselines/samples.json');
  const frozen = readJson('eval/baselines/frozen-sets.json');
  const tool = readJson('eval/baselines/fixtures/tool-only-sample.json');
  const chain = checkCatalog();
  if (samples.schema !== 'belliedmonkey.baseline-samples.v1') errors.push('samples schema');
  if (!Array.isArray(samples.records) || samples.records.length !== 0) errors.push('samples catalog must stay empty');
  if (!samples.blocked) errors.push('samples blocked reason');
  if (frozen.schema !== 'belliedmonkey.baseline-frozen-sets.v1') errors.push('frozen schema');
  if (!Array.isArray(frozen.sets) || frozen.sets.length !== 0) errors.push('frozen sets must stay empty');
  const gate = sampleEligible(tool);
  if (gate.ok || gate.reason !== 'tool-only') errors.push('tool-only fixture must be rejected');
  const unlabeled = sampleEligible({
    form: 'webpage-text', stage: 'translation', text: 'x',
    authorization: { kind: 'tool-only' }, redaction: { identity: true }, setVersion: 'x',
  });
  if (unlabeled.ok) errors.push('tool-only must never become eligible');
  if (chain.status !== 'blocked' || chain.actualCount !== 0 || chain.realFailures !== 0 || chain.productMetric !== null || chain.e2eMetric !== null) {
    errors.push('default-chain catalog must stay blocked with no product score');
  }
  return errors;
}

function checkDocs() {
  const errors = [];
  const inv = loadInventory();
  const inventoryDoc = read('docs/baselines/inventory.md');
  const index = read('docs/baselines/README.md');
  for (const f of inv.forms) {
    if (!inventoryDoc.includes(f.id)) errors.push('inventory.md missing ' + f.id);
  }
  for (const s of inv.stages) {
    if (!inventoryDoc.includes(s.id)) errors.push('inventory.md missing stage ' + s.id);
  }
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const text = read(name);
    if (!text.includes('docs/baselines/README.md')) errors.push(name + ' missing baseline index link');
    if (!text.includes('docs/benchmark-waterlevel.md')) errors.push(name + ' dropped the historical waterline link');
  }
  const tree = [
    'docs/baselines/README.md',
    'docs/baselines/inventory.md',
    'docs/baselines/samples.md',
    'docs/baselines/protocol.md',
    'docs/baselines/forms/realtime.md',
    'docs/baselines/forms/web.md',
    'docs/baselines/forms/documents.md',
    'docs/baselines/asr-public.md',
  ];
  for (const rel of tree) {
    const text = read(rel);
    if (text.includes('基线已达标')) errors.push(rel + ' claims the baseline is met');
    if (!text.includes('待测')) errors.push(rel + ' missing 待测');
  }
  if (!index.includes('docs/benchmark-waterlevel.md')) errors.push('index missing waterline relationship');
  if (!read('docs/benchmark-waterlevel.md').includes('docs/baselines/README.md')) {
    errors.push('waterline snapshot missing pointer to the baseline index');
  }
  return errors;
}

function checkAll() {
  return checkInventory(loadInventory()).concat(checkCatalogs(), checkDocs());
}

function main() {
  const errors = checkAll();
  if (errors.length) {
    for (const e of errors) console.error(e);
    console.error(errors.length + ' baseline check error(s)');
    process.exit(1);
  }
  const inv = loadInventory();
  console.log('baseline protocol check ok');
  console.log('forms ' + inv.forms.length + ' · stages ' + inv.stages.length + ' · cells ' + inv.cells.length);
  console.log('measurement ' + inv.measurement + ' · samples 0 · frozen sets 0 · thresholds 0');
}

if (require.main === module) main();

module.exports = {
  ROOT,
  loadInventory,
  sampleEligible,
  checkInventory,
  checkCatalogs,
  checkDocs,
  checkAll,
};
