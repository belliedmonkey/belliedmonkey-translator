'use strict';

// One command for the reviewed 36. Offline unless --prefetch-sensevoice is passed.
// Linux cannot produce a SpeechAnalyzer hypothesis. A missing SenseVoice model is
// model-missing, not a zero error rate. This file does not change the app.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  loadSet, checkCaches, stageReviewedAudio, senseVoicePin, saPin, inspectSenseVoiceDir, perfSchedule, summarizeLatencies, sha256File,
} = require('./reviewed-36.js');
const { scoreReviewed } = require('./codeswitch-score.js');
const { signalProcessGroup, writeEvidenceArchive, packExisting, watchChild } = require('./run-sa-file.js');

const SENSEVOICE_ZIP_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.zip';

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

function senseVoiceChildArgs(modelDir, wavs) {
  return [
    '--tokens=' + path.join(modelDir, 'tokens.txt'),
    '--sense-voice-model=' + path.join(modelDir, 'model.int8.onnx'),
    '--sense-voice-language=zh',
    '--sense-voice-use-itn=1',
    '--num-threads=2',
    '--provider=cpu',
    '--debug=0',
  ].concat(wavs);
}

function modelLoadFromStderr(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  const match = text.match(/recognizer created in ([0-9.]+) s/);
  if (!match) return null;
  const ms = Number(match[1]) * 1000;
  return Number.isFinite(ms) ? Math.round(ms) : null;
}

function sourceOf(item, fleursCache, ascendCache) {
  if (item.sourcePath) return item.sourcePath;
  const root = item.config === 'ascend' ? ascendCache : fleursCache;
  return path.resolve(root, item.audioRel);
}

async function runSaChild(opts, checked, runDir, preflightMs) {
  const stageRoot = path.join(runDir, 'audio-root');
  fs.mkdirSync(stageRoot, { recursive: true });
  const stageStarted = process.hrtime.bigint();
  const staged = stageReviewedAudio(checked.items, stageRoot, (item) => sourceOf(item, opts.fleursCache, opts.ascendCache));
  const stageMs = monoMs(stageStarted);
  if (!staged.ok) {
    return baseSummary({
      code: staged.code,
      id: staged.id || null,
      processExit: 2,
      phases: { preflightMs: preflightMs, stageMs: stageMs, recognizeMs: null },
      runDir: runDir,
    });
  }
  const setPath = path.join(runDir, 'set-for-run.json');
  writeJson(runDir, 'set-for-run.json', {
    items: staged.items.map((item) => ({
      id: item.id,
      config: item.swiftConfig,
      audioCache: item.stagedRel,
    })),
  });
  writeJson(runDir, 'stage-manifest.json', staged.items.map((item) => ({
    id: item.id,
    stagedRel: item.stagedRel,
    stagedSha256: item.stagedSha256,
    converted: false,
    swiftConfig: item.swiftConfig,
    saLocale: item.lang === 'en' ? 'en-US' : 'zh-CN',
  })));
  const bin = path.join(runDir, 'sa-file-bin');
  const compileStarted = process.hrtime.bigint();
  const compile = opts.compile || ((outBin) => watchChild(opts.spawn || spawn, opts.swiftc, [
    '-framework', 'Speech', '-framework', 'AVFoundation', '-framework', 'CoreMedia',
    path.join(__dirname, 'product-asr-mac.swift'), '-o', outBin,
  ], {
    cwd: __dirname,
    stdoutPath: path.join(runDir, 'compile-stdout.txt'),
    stderrPath: path.join(runDir, 'compile-stderr.txt'),
    progressFile: '',
    processCapMs: opts.compileCapMs || 90000,
    itemCapMs: (opts.compileCapMs || 90000) + 1,
    killGraceMs: opts.killGraceMs,
    pollMs: opts.pollMs,
    platform: opts.platform || process.platform,
  }));
  const compiled = await Promise.resolve(compile(bin));
  const compileMs = monoMs(compileStarted);
  if (!compiled || compiled.code !== 0 || compiled.cap) {
    const summary = baseSummary({
      code: compiled && compiled.cap ? 'compile-timeout' : 'compile-failed',
      processExit: 2,
      recognizeStarted: false,
      phases: { preflightMs: preflightMs, stageMs: stageMs, compileMs: compileMs, recognizeMs: null },
    });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'set-for-run.json', 'stage-manifest.json']);
    summary.runDir = runDir;
    return summary;
  }
  const watchOpts = (stdoutName, stderrName) => ({
    cwd: stageRoot,
    stdoutPath: path.join(runDir, stdoutName),
    stderrPath: path.join(runDir, stderrName),
    progressFile: path.join(runDir, 'item-progress.json'),
    processCapMs: opts.processCapMs || 180000,
    itemCapMs: opts.itemCapMs || 45000,
    killGraceMs: opts.killGraceMs,
    pollMs: opts.pollMs,
    platform: opts.platform || process.platform,
  });
  const installStarted = process.hrtime.bigint();
  const installed = await watchChild(opts.spawn || spawn, bin, [
    '--set', setPath, '--out', path.join(runDir, 'install-out.json'),
    '--status-out', path.join(runDir, 'asset-status.json'),
    '--audio-root', stageRoot, '--install-assets',
  ], watchOpts('install-stdout.txt', 'install-stderr.txt'));
  const assetInstallMs = monoMs(installStarted);
  if (installed.cap || installed.code !== 0) {
    const summary = baseSummary({
      code: installed.cap ? installed.cap : 'asset-install-failed',
      processExit: 2,
      recognizeStarted: false,
      phases: { preflightMs: preflightMs, stageMs: stageMs, compileMs: compileMs, assetInstallMs: assetInstallMs, recognizeMs: null },
    });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'set-for-run.json', 'stage-manifest.json']);
    summary.runDir = runDir;
    return summary;
  }
  const hypPath = path.join(runDir, 'hypotheses.json');
  const recStarted = process.hrtime.bigint();
  const watched = await watchChild(opts.spawn || spawn, bin, [
    '--set', setPath, '--out', hypPath,
    '--status-out', path.join(runDir, 'asset-status.json'),
    '--audio-root', stageRoot,
  ], watchOpts('child-stdout.txt', 'child-stderr.txt'));
  const recognizeMs = monoMs(recStarted);
  const phases = {
    preflightMs: preflightMs,
    stageMs: stageMs,
    compileMs: compileMs,
    assetInstallMs: assetInstallMs,
    modelLoadMs: null,
    recognizeMs: recognizeMs,
    scoreMs: null,
    packMs: null,
  };
  if (watched.cap || watched.code !== 0) {
    const summary = baseSummary({
      code: watched.cap ? watched.cap : 'recognition-failed',
      processExit: 2,
      recognizeStarted: true,
      timedOut: !!watched.cap,
      phases: phases,
      synthetic: checked.synthetic === true,
    });
    const names = ['run-summary.json', 'backend-pin.json', 'set-for-run.json', 'stage-manifest.json'];
    if (fs.existsSync(hypPath)) names.push('hypotheses.json');
    seal(runDir, summary, names);
    summary.runDir = runDir;
    return summary;
  }
  let rows = null;
  try { rows = JSON.parse(fs.readFileSync(hypPath, 'utf8')); } catch (_) { rows = null; }
  const byId = new Map();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row && byId.has(row.id)) {
        const summary = baseSummary({ code: 'duplicate-id', processExit: 2, recognizeStarted: true, phases: phases, rates: null });
        seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'set-for-run.json', 'stage-manifest.json', 'hypotheses.json']);
        summary.runDir = runDir;
        return summary;
      }
      if (row) byId.set(row.id, row);
    }
  }
  const joined = [];
  for (const item of staged.items) {
    const row = byId.get(item.id);
    if (!row || typeof row.hypothesis !== 'string' || row.hypothesis === '') {
      const summary = baseSummary({
        code: 'empty-hypothesis',
        id: item.id,
        processExit: 2,
        recognizeStarted: true,
        phases: phases,
        synthetic: checked.synthetic === true,
      });
      seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'set-for-run.json', 'stage-manifest.json', 'hypotheses.json']);
      summary.runDir = runDir;
      return summary;
    }
    joined.push(Object.assign({}, item, { hypothesis: row.hypothesis }));
  }
  const scoreStarted = process.hrtime.bigint();
  const scored = scoreReviewed(joined);
  phases.scoreMs = monoMs(scoreStarted);
  writeJson(runDir, 'score.json', Object.assign({ synthetic: checked.synthetic === true }, scored));
  if (!scored.ok) {
    const summary = baseSummary({
      code: scored.reason,
      processExit: 2,
      recognizeStarted: true,
      phases: phases,
      synthetic: checked.synthetic === true,
    });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'set-for-run.json', 'stage-manifest.json', 'hypotheses.json', 'score.json']);
    summary.runDir = runDir;
    return summary;
  }
  const summary = baseSummary({
    ok: true,
    code: 'ok',
    processExit: 0,
    recognizeStarted: true,
    exploratory: true,
    ranking: false,
    synthetic: checked.synthetic === true,
    rates: checked.synthetic === true ? null : scored.rates,
    fixtureRates: checked.synthetic === true ? scored.rates : null,
    appleResult: checked.synthetic === true ? false : opts.compiler === 'swiftc',
    phases: phases,
    perf: summarizeLatencies(opts.latencySamples || [recognizeMs]),
    repeats: opts.repeats || 1,
    saLocaleApplied: { ascend: 'zh-CN', swiftConfig: 'cmn_hans_cn', searched: false },
  });
  if (checked.synthetic === true) summary.rates = null;
  const packStarted = process.hrtime.bigint();
  seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'set-for-run.json', 'stage-manifest.json', 'hypotheses.json', 'score.json']);
  summary.phases.packMs = monoMs(packStarted);
  writeJson(runDir, 'run-summary.json', summary);
  summary.runDir = runDir;
  return summary;
}

async function runSenseVoiceChild(opts, checked, runDir, preflightMs, looked) {
  const stageRoot = path.join(runDir, 'audio-root');
  fs.mkdirSync(stageRoot, { recursive: true });
  const stageStarted = process.hrtime.bigint();
  const staged = stageReviewedAudio(checked.items, stageRoot, (item) => sourceOf(item, opts.fleursCache, opts.ascendCache));
  const stageMs = monoMs(stageStarted);
  if (!staged.ok) {
    return baseSummary({
      code: staged.code,
      id: staged.id || null,
      processExit: 2,
      phases: { preflightMs: preflightMs, stageMs: stageMs, recognizeMs: null },
      runDir: runDir,
    });
  }
  writeJson(runDir, 'stage-manifest.json', staged.items.map((item) => ({
    id: item.id,
    stagedRel: item.stagedRel,
    stagedSha256: item.stagedSha256,
    converted: false,
  })));
  const wavs = staged.items.map((item) => path.join(stageRoot, item.stagedRel));
  const stderrPath = path.join(runDir, 'child-stderr.txt');
  const stdoutPath = path.join(runDir, 'child-stdout.txt');
  const recStarted = process.hrtime.bigint();
  const watched = await watchChild(opts.spawn || spawn, opts.sensevoiceBin, senseVoiceChildArgs(opts.sensevoiceDir, wavs), {
    cwd: stageRoot,
    stdoutPath: stdoutPath,
    stderrPath: stderrPath,
    progressFile: '',
    processCapMs: opts.processCapMs || 180000,
    itemCapMs: opts.itemCapMs || 180000,
    killGraceMs: opts.killGraceMs,
    pollMs: opts.pollMs,
    platform: opts.platform || process.platform,
  });
  const childWallMs = monoMs(recStarted);
  const modelLoadMs = modelLoadFromStderr(stderrPath);
  const phases = {
    preflightMs: preflightMs,
    stageMs: stageMs,
    compileMs: null,
    assetInstallMs: null,
    modelLoadMs: modelLoadMs,
    recognizeMs: childWallMs,
    scoreMs: null,
    packMs: null,
  };
  if (watched.cap || watched.code !== 0) {
    const summary = baseSummary({
      code: watched.cap ? watched.cap : 'recognition-failed',
      backend: 'sensevoice',
      processExit: 2,
      recognizeStarted: true,
      timedOut: !!watched.cap,
      phases: phases,
      synthetic: checked.synthetic === true,
      modelSha256: looked.modelSha256,
      tokensSha256: looked.tokensSha256,
    });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'sensevoice-inspect.json', 'stage-manifest.json', 'child-stdout.txt', 'child-stderr.txt']);
    summary.runDir = runDir;
    return summary;
  }
  const lines = fs.readFileSync(stdoutPath, 'utf8').split(/\n/).filter((line) => line.trim() !== '');
  const hyps = [];
  for (let i = 0; i < staged.items.length; i++) {
    let row = null;
    try { row = JSON.parse(lines[i]); } catch (_) { row = null; }
    const text = row && typeof row.text === 'string' ? row.text : '';
    if (!text) {
      const summary = baseSummary({
        code: 'empty-hypothesis',
        id: staged.items[i].id,
        backend: 'sensevoice',
        processExit: 2,
        recognizeStarted: true,
        phases: phases,
        synthetic: checked.synthetic === true,
      });
      seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'sensevoice-inspect.json', 'stage-manifest.json', 'child-stdout.txt', 'child-stderr.txt']);
      summary.runDir = runDir;
      return summary;
    }
    hyps.push(Object.assign({}, staged.items[i], { hypothesis: text }));
  }
  const scoreStarted = process.hrtime.bigint();
  const scored = scoreReviewed(hyps);
  phases.scoreMs = monoMs(scoreStarted);
  writeJson(runDir, 'hypotheses.json', hyps.map((row) => ({ id: row.id, hypothesis: row.hypothesis })));
  writeJson(runDir, 'score.json', Object.assign({ synthetic: checked.synthetic === true }, scored));
  if (!scored.ok) {
    const summary = baseSummary({
      code: scored.reason,
      backend: 'sensevoice',
      processExit: 2,
      recognizeStarted: true,
      phases: phases,
      synthetic: checked.synthetic === true,
    });
    seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'sensevoice-inspect.json', 'stage-manifest.json', 'hypotheses.json', 'score.json', 'child-stdout.txt', 'child-stderr.txt']);
    summary.runDir = runDir;
    return summary;
  }
  const summary = baseSummary({
    ok: true,
    code: 'ok',
    backend: 'sensevoice',
    processExit: 0,
    recognizeStarted: true,
    exploratory: true,
    ranking: false,
    synthetic: checked.synthetic === true,
    rates: checked.synthetic === true ? null : scored.rates,
    fixtureRates: checked.synthetic === true ? scored.rates : null,
    appleResult: false,
    senseVoiceResult: checked.synthetic !== true,
    phases: phases,
    perf: summarizeLatencies(opts.latencySamples || [childWallMs]),
    repeats: opts.repeats || 1,
    modelSha256: looked.modelSha256,
    tokensSha256: looked.tokensSha256,
  });
  const packStarted = process.hrtime.bigint();
  seal(runDir, summary, ['run-summary.json', 'backend-pin.json', 'sensevoice-inspect.json', 'stage-manifest.json', 'hypotheses.json', 'score.json', 'child-stdout.txt', 'child-stderr.txt']);
  summary.phases.packMs = monoMs(packStarted);
  writeJson(runDir, 'run-summary.json', summary);
  summary.runDir = runDir;
  return summary;
}

async function runReviewed36(opts) {
  const started = process.hrtime.bigint();
  const root = opts.root || ROOT;
  const fleursCache = opts.fleursCache || path.join(root, 'eval/baselines/asr/.cache/public-candidates');
  const ascendCache = opts.ascendCache || path.join(root, 'eval/baselines/ascend/.cache/audio');
  let selected;
  let checked;
  if (opts.fixtureItems) {
    if (opts.synthetic !== true) {
      return baseSummary({ code: 'fixture-unmarked', processExit: 2, rates: null });
    }
    selected = { ok: true, items: opts.fixtureItems, synthetic: true, code: 'ok' };
    checked = selected;
  } else {
    selected = loadSet(root);
    checked = selected.ok && !opts.skipAudio ? checkCaches(selected, fleursCache, ascendCache) : selected;
  }
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
  const executeSa = backend === 'sa' && (opts.execute === true || (platform === 'darwin' && !!opts.swiftc));
  let code = 'ok';
  if (backend === 'sa' && !executeSa) code = platform === 'darwin' ? 'missing-swiftc' : 'unavailable';
  let looked = null;
  if (backend === 'sensevoice') {
    looked = inspectSenseVoiceDir(opts.sensevoiceDir);
    writeJson(runDir, 'sensevoice-inspect.json', looked);
    if (!looked.ok) code = looked.code;
    else if (!opts.sensevoiceBin) code = 'backend-missing';
  }
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
      modelSha256: looked && looked.modelSha256 || null,
      tokensSha256: looked && looked.tokensSha256 || null,
    });
    const names = ['run-summary.json', 'backend-pin.json'];
    if (looked) names.push('sensevoice-inspect.json');
    seal(runDir, summary, names);
    summary.runDir = runDir;
    return summary;
  }
  if (backend === 'sensevoice') {
    opts.fleursCache = fleursCache;
    opts.ascendCache = ascendCache;
    return runSenseVoiceChild(opts, checked, runDir, preflightMs, looked);
  }
  if (executeSa) {
    opts.fleursCache = fleursCache;
    opts.ascendCache = ascendCache;
    return runSaChild(opts, checked, runDir, preflightMs);
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
  const url = opts.url || '';
  if (!url) return { ok: false, code: 'prefetch-url-required', attempts: 0, relayInvoked: false, pin: pin, url: '' };
  if (url.indexOf('.tar.bz2') !== -1) {
    return { ok: false, code: 'tar-bz2-refused', attempts: 0, relayInvoked: false, pin: pin, url: url };
  }
  if (url.indexOf('api.belliedmonkey.com') !== -1) {
    return { ok: false, code: 'relay-refused', attempts: 0, relayInvoked: false, pin: pin, url: url };
  }
  let last = { ok: false, code: 'network-failed', attempts: 0, relayInvoked: false, pin: pin, url: url };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await opts.fetch(url);
      const status = res && res.status;
      if (status && status !== 200) {
        last = { ok: false, code: 'http-' + status, attempts: attempt, status: status, relayInvoked: false, pin: pin, url: url };
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
      if (sha !== pin.sha256 || buf.length !== pin.bytes) {
        last = { ok: false, code: 'checksum-mismatch', attempts: attempt, bytes: buf.length, relayInvoked: false, pin: pin, url: url };
        continue;
      }
      if (opts.dest) fs.writeFileSync(opts.dest, buf);
      return { ok: true, code: 'ok', attempts: attempt, sha256: sha, relayInvoked: false, pin: pin, url: url };
    } catch (err) {
      last = { ok: false, code: 'network-failed', attempts: attempt, relayInvoked: false, pin: pin, url: url, error: err && err.message };
    }
  }
  return last;
}

async function main(argv) {
  const args = argv.slice(2);
  let command = 'check';
  let backend = '';
  let outDir = '';
  let packDir = '';
  let repeats = 0;
  let prefetchUrl = '';
  let fleursCache = '';
  let ascendCache = '';
  let sensevoiceDir = '';
  let sensevoiceBin = '';
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
    else if (args[i] === '--sensevoice-dir') sensevoiceDir = args[++i] || '';
    else if (args[i] === '--sensevoice-bin') sensevoiceBin = args[++i] || '';
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
  if (command === 'run' && backend === 'sensevoice' && sensevoiceDir && !sensevoiceBin) {
    try {
      sensevoiceBin = require('child_process').execFileSync('which', ['sherpa-onnx-offline'], { encoding: 'utf8' }).trim();
    } catch (_) { sensevoiceBin = ''; }
  }
  let swiftc = '';
  if (process.platform === 'darwin') {
    try {
      swiftc = require('child_process').execFileSync('which', ['swiftc'], { encoding: 'utf8' }).trim();
    } catch (_) { swiftc = ''; }
  }
  const result = await runReviewed36({
    command: command,
    backend: backend,
    outDir: outDir,
    packDir: packDir,
    repeats: repeats,
    platform: process.platform,
    swiftc: swiftc,
    compiler: swiftc ? 'swiftc' : '',
    fleursCache: fleursCache || undefined,
    ascendCache: ascendCache || undefined,
    sensevoiceDir: sensevoiceDir || undefined,
    sensevoiceBin: sensevoiceBin || undefined,
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

module.exports = {
  runReviewed36, prefetchSenseVoice, signalProcessGroup, monoMs, sha256File, senseVoiceChildArgs, SENSEVOICE_ZIP_URL,
};
