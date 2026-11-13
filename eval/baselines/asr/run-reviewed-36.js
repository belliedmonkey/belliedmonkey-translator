'use strict';

// One command for the reviewed 36. Offline unless --prefetch-sensevoice is passed.
// Linux cannot produce a SpeechAnalyzer hypothesis. A missing model is unavailable,
// not a zero error rate. This file does not change the app.

const fs = require('fs');
const path = require('path');
const {
  loadSet, checkCaches, senseVoicePin, saPin, perfSchedule, summarizeLatencies, sha256File,
} = require('./reviewed-36.js');
const { scoreReviewed } = require('./codeswitch-score.js');
const { signalProcessGroup, writeEvidenceArchive, packExisting } = require('./run-sa-file.js');

function defaultRoot() {
  const flat = path.join(__dirname, 'MANIFEST.json');
  const repoSet = path.join(__dirname, 'public-candidates-v1.json');
  if (fs.existsSync(flat) && !fs.existsSync(repoSet)) return __dirname;
  return path.join(__dirname, '../../..');
}

const ROOT = defaultRoot();

function monoMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
}

function baseSummary(extra) {
  return Object.assign({
    ok: false,
    productMetric: false,
    endToEnd: false,
    leaderboard: false,
    exploratory: true,
    ranking: false,
    approvedPlannedSetCount: 0,
    denominator: 36,
    excluded: ['fleurs-frozen-16', 'cmn_hans_cn/1663'],
    rates: null,
    hypotheses: null,
    recognizeMs: null,
    recognizeStarted: false,
    appleResult: false,
    senseVoiceResult: false,
  }, extra || {});
}

function seal(runDir, summary, names) {
  writeJson(runDir, 'run-summary.json', summary);
  const packed = names || ['run-summary.json'];
  try {
    writeEvidenceArchive(runDir, packed);
  } catch (err) {
    summary.archiveCode = err && err.code ? err.code : 'evidence-pack-failed';
    writeJson(runDir, 'run-summary.json', summary);
  }
  return summary;
}

function runReviewed36(opts) {
  const started = process.hrtime.bigint();
  const root = opts.root || ROOT;
  const selected = loadSet(root);
  const fleursCache = opts.fleursCache || path.join(root, 'eval/baselines/asr/.cache/public-candidates');
  const ascendCache = opts.ascendCache || path.join(root, 'eval/baselines/ascend/.cache/audio');
  const checked = selected.ok && !opts.skipAudio ? checkCaches(selected, fleursCache, ascendCache) : selected;
  const preflightMs = monoMs(started);
  if (opts.command === 'check') {
    return Object.assign(baseSummary({
      ok: checked.ok === true,
      code: checked.code,
      processExit: checked.ok ? 0 : 2,
      phases: { preflightMs: preflightMs, recognizeMs: null },
      itemCount: checked.ok ? checked.items.length : 0,
    }), { rates: null });
  }
  if (opts.command === 'pack-existing') {
    const packed = packExisting(opts.packDir);
    packed.recognizeStarted = false;
    return packed;
  }
  if (!checked.ok) {
    return baseSummary({
      code: checked.code,
      id: checked.id || null,
      processExit: 2,
      phases: { preflightMs: preflightMs, recognizeMs: null },
    });
  }
  const runDir = opts.outDir;
  if (!runDir) return baseSummary({ code: 'missing-out', processExit: 2 });
  if (fs.existsSync(runDir)) return baseSummary({ code: 'output-exists', processExit: 2 });
  fs.mkdirSync(runDir, { recursive: true });
  const backend = opts.backend;
  const pin = backend === 'sensevoice' ? senseVoicePin(root) : saPin();
  writeJson(runDir, 'backend-pin.json', pin);
  const platform = opts.platform || process.platform;
  let code = 'ok';
  if (backend === 'sa' && platform !== 'darwin') code = 'unavailable';
  if (backend === 'sa' && platform === 'darwin' && !opts.swiftc) code = 'missing-swiftc';
  if (backend === 'sa' && platform === 'darwin' && opts.swiftc) code = 'sa-not-executed';
  if (backend === 'sensevoice' && !opts.modelReady) code = 'unavailable';
  if (backend !== 'sa' && backend !== 'sensevoice') code = 'missing-backend';
  if (opts.skipAudio && code === 'ok') {
    const summary = baseSummary({ code: 'skip-audio-refused', processExit: 2 });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json']);
    summary.runDir = runDir;
    return summary;
  }
  if (code !== 'ok') {
    const summary = baseSummary({
      code: code,
      backend: backend || null,
      processExit: 2,
      phases: {
        preflightMs: preflightMs,
        compileMs: null,
        assetInstallMs: null,
        modelLoadMs: null,
        recognizeMs: null,
        scoreMs: null,
        packMs: null,
      },
      perf: perfSchedule(opts.repeats || 0),
      coldStart: true,
    });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json']);
    summary.runDir = runDir;
    return summary;
  }
  if (typeof opts.recognize !== 'function') {
    const summary = baseSummary({ code: 'unavailable', backend: backend, processExit: 2 });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json']);
    summary.runDir = runDir;
    return summary;
  }
  const recStart = process.hrtime.bigint();
  const recognized = opts.recognize(checked.items);
  const recognizeMs = monoMs(recStart);
  if (!recognized || recognized.ok !== true || !Array.isArray(recognized.hypotheses)) {
    const summary = baseSummary({
      code: recognized && recognized.code ? recognized.code : 'empty-hypothesis',
      backend: backend,
      processExit: 2,
      recognizeStarted: true,
      phases: { preflightMs: preflightMs, recognizeMs: recognizeMs },
    });
    if (recognized && recognized.hypotheses) writeJson(runDir, 'hypotheses.json', recognized.hypotheses);
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json'].concat(
      fs.existsSync(path.join(runDir, 'hypotheses.json')) ? ['hypotheses.json'] : []
    ));
    summary.runDir = runDir;
    return summary;
  }
  const rows = checked.items.map((item, i) => Object.assign({}, item, {
    hypothesis: recognized.hypotheses[i] && recognized.hypotheses[i].hypothesis,
  }));
  const scoreStart = process.hrtime.bigint();
  const scored = scoreReviewed(rows);
  const scoreMs = monoMs(scoreStart);
  writeJson(runDir, 'hypotheses.json', rows.map((row) => ({
    id: row.id, hypothesis: row.hypothesis, reference: row.reference, stratum: row.stratum,
  })));
  if (!scored.ok) {
    const summary = baseSummary({
      code: scored.reason,
      backend: backend,
      processExit: 2,
      recognizeStarted: true,
      phases: { preflightMs: preflightMs, recognizeMs: recognizeMs, scoreMs: scoreMs },
    });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'hypotheses.json']);
    summary.runDir = runDir;
    return summary;
  }
  writeJson(runDir, 'score.json', scored);
  const summary = baseSummary({
    ok: true,
    code: 'ok',
    backend: backend,
    processExit: 0,
    recognizeStarted: true,
    exploratory: true,
    ranking: false,
    rates: scored.rates,
    appleResult: backend === 'sa',
    senseVoiceResult: backend === 'sensevoice',
    phases: { preflightMs: preflightMs, recognizeMs: recognizeMs, scoreMs: scoreMs, packMs: null },
    perf: summarizeLatencies(opts.latencySamples || [recognizeMs]),
  });
  const packStart = process.hrtime.bigint();
  seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'hypotheses.json', 'score.json']);
  summary.phases.packMs = monoMs(packStart);
  writeJson(runDir, 'run-summary.json', summary);
  summary.runDir = runDir;
  return summary;
}

async function prefetchSenseVoice(opts) {
  const pin = senseVoicePin(opts.root || ROOT);
  if (!opts.url) return { ok: false, code: 'prefetch-url-required', attempts: 0, relayInvoked: false, pin: pin };
  if (String(opts.url).indexOf('api.belliedmonkey.com') !== -1) {
    return { ok: false, code: 'relay-refused', attempts: 0, relayInvoked: false, pin: pin };
  }
  try {
    const res = await opts.fetch(opts.url);
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
    if (sha !== pin.sha256 || buf.length !== pin.bytes) {
      return { ok: false, code: 'checksum-mismatch', attempts: 1, relayInvoked: false, pin: pin };
    }
    if (opts.dest) fs.writeFileSync(opts.dest, buf);
    return { ok: true, code: 'ok', attempts: 1, sha256: sha, relayInvoked: false, pin: pin };
  } catch (_) {
    return { ok: false, code: 'network-failed', attempts: 1, relayInvoked: false, pin: pin };
  }
}

function main(argv) {
  const args = argv.slice(2);
  let command = 'check';
  let backend = '';
  let outDir = '';
  let packDir = '';
  let repeats = 0;
  let prefetchUrl = '';
  let fleursCache = '';
  let ascendCache = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') command = 'check';
    else if (args[i] === '--run') command = 'run';
    else if (args[i] === '--pack-existing') {
      command = 'pack-existing';
      packDir = args[++i] || '';
    } else if (args[i] === '--backend') backend = args[++i] || '';
    else if (args[i] === '--out') outDir = args[++i] || '';
    else if (args[i] === '--repeats') repeats = Number(args[++i] || '0');
    else if (args[i] === '--fleurs-cache') fleursCache = args[++i] || '';
    else if (args[i] === '--ascend-cache') ascendCache = args[++i] || '';
    else if (args[i] === '--prefetch-sensevoice') {
      command = 'prefetch';
      prefetchUrl = args[++i] || '';
    } else {
      console.error('unknown arg ' + args[i]);
      process.exit(2);
    }
  }
  if (command === 'prefetch') {
    prefetchSenseVoice({ url: prefetchUrl, fetch: global.fetch }).then((result) => {
      console.log(JSON.stringify({ ok: result.ok === true, code: result.code, attempts: result.attempts, rates: null }));
      process.exit(result.ok ? 0 : 2);
    });
    return;
  }
  const result = runReviewed36({
    command: command,
    backend: backend,
    outDir: outDir,
    packDir: packDir,
    repeats: repeats,
    platform: process.platform,
    fleursCache: fleursCache || undefined,
    ascendCache: ascendCache || undefined,
  });
  console.log(JSON.stringify({
    ok: result.ok === true,
    code: result.code,
    processExit: result.processExit,
    rates: result.ok ? result.rates : null,
    approvedPlannedSetCount: 0,
    runDir: result.runDir || null,
  }));
  process.exit(result.processExit == null ? 2 : result.processExit);
}

if (require.main === module) main(process.argv);

module.exports = { runReviewed36, prefetchSenseVoice, signalProcessGroup, monoMs, sha256File };
