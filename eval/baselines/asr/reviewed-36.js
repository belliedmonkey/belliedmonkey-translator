'use strict';

// The 36-clip research set: FLEURS candidates 1668–1682 in both languages,
// plus the six ear-checked ASCEND clips. The frozen 16 and cmn_hans_cn/1663
// stay out of this denominator. This is not the approved plan of 30.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FLEURS_EAR = [
  'eval/baselines/asr/fleurs-candidate-ear-2026-11-13.json',
  'eval/baselines/asr/fleurs-candidate-ear-2026-11-13-1103.json',
  'eval/baselines/asr/fleurs-candidate-ear-2026-11-13-1109.json',
  'eval/baselines/asr/fleurs-candidate-ear-2026-11-13-1240.json',
  'eval/baselines/asr/fleurs-candidate-ear-2026-11-13-1319.json',
  'eval/baselines/asr/fleurs-candidate-ear-2026-11-13-1520.json',
];

const SA_LOCALE = {
  en_us: 'en-US',
  cmn_hans_cn: 'zh-CN',
  ascend: 'zh-CN',
  selection: 'explicit',
  searched: false,
  note: 'ASCEND uses zh-CN once. A second locale is not run, and the better of two locales is not chosen.',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function senseVoicePin(root) {
  const manifest = path.join(root, 'MANIFEST.json');
  const repo = path.join(root, 'app/device-models.config.js');
  if (!fs.existsSync(repo) && fs.existsSync(manifest)) {
    const doc = readJson(manifest);
    if (!doc.sensevoice || doc.sensevoice.sha256 == null) {
      const err = new Error('sensevoice-pin');
      throw err;
    }
    return doc.sensevoice;
  }
  const models = require(repo);
  const spec = models.MT_DEVICE_SENSEVOICE;
  const file = spec.files[0];
  return {
    kind: 'sensevoice',
    source: 'app/device-models.config.js',
    dir: spec.dir,
    model: spec.model,
    tokens: spec.tokens,
    quantization: 'int8',
    runtime: 'sherpa-onnx',
    device: 'cpu',
    threads: 2,
    language: 'zh',
    useInverseTextNormalization: true,
    modelType: 'sense_voice',
    vadArm: spec.vadArm,
    fileName: file.path,
    bytes: file.size,
    sha256: file.sha256,
    obtained: false,
    relayInvoked: false,
  };
}

function saPin() {
  return {
    kind: 'speech-analyzer',
    source: 'eval/baselines/asr/product-asr-mac.swift',
    module: 'SpeechTranscriber',
    reportingOptions: ['volatileResults', 'fastResults', 'alternativeTranscriptions'],
    attributeOptions: ['audioTimeRange', 'transcriptionConfidence'],
    dictationFallback: false,
    locale: SA_LOCALE,
    platform: 'darwin',
    obtainedHere: false,
  };
}

function fail(code, extra) {
  return Object.assign({
    ok: false,
    code: code,
    items: [],
    approvedPlannedSetCount: 0,
    denominator: 36,
    excluded: ['fleurs-frozen-16', 'cmn_hans_cn/1663'],
    productMetric: false,
    rates: null,
  }, extra || {});
}

function loadManifest(file) {
  const doc = readJson(file);
  if (!doc || !Array.isArray(doc.items) || doc.items.length !== 36) return fail('need-36');
  if (doc.audioIncluded !== false || doc.approvedPlannedSetCount !== 0) return fail('manifest-claim');
  const ids = new Set();
  for (const item of doc.items) {
    if (!item || !item.id || ids.has(item.id)) return fail('duplicate-id', { id: item && item.id });
    ids.add(item.id);
    if (String(item.id).indexOf('/1663') !== -1 || String(item.id).indexOf('/1660') !== -1) {
      return fail('excluded-id', { id: item.id });
    }
  }
  return {
    ok: true,
    code: 'ok',
    items: doc.items,
    approvedPlannedSetCount: 0,
    denominator: 36,
    excluded: ['fleurs-frozen-16', 'cmn_hans_cn/1663'],
    productMetric: false,
    rates: null,
    accent: 'unknown',
    noise: 'unknown',
    continuousDialogue: 'unknown',
    saLocale: doc.sa && doc.sa.locale ? doc.sa.locale : SA_LOCALE,
    fromManifest: true,
  };
}

function loadSet(root) {
  const manifest = path.join(root, 'MANIFEST.json');
  const repoSet = path.join(root, 'eval/baselines/asr/public-candidates-v1.json');
  if (fs.existsSync(manifest) && !fs.existsSync(repoSet)) return loadManifest(manifest);
  const fleursText = readJson(path.join(root, 'eval/baselines/asr/public-candidates-v1.json'));
  const fleursAudio = readJson(path.join(root, 'eval/baselines/asr/public-candidates-audio-v1.json'));
  const ascend = readJson(path.join(root, 'eval/baselines/ascend/ascend-test-v1.json'));
  const ascendEar = readJson(path.join(root, 'eval/baselines/ascend/ascend-ear-2026-11-13.json'));
  const ears = new Map();
  for (const rel of FLEURS_EAR) {
    const doc = readJson(path.join(root, rel));
    for (const item of doc.items || []) {
      const key = item.config + '/' + String(item.sentenceId);
      if (ears.has(key)) return fail('duplicate-id', { id: key });
      ears.set(key, item);
    }
  }
  const audioBy = new Map();
  for (const row of fleursAudio.items || []) {
    audioBy.set(row.config + '/' + String(row.sentenceId), row);
  }
  const textBy = new Map();
  for (const row of fleursText.items || []) {
    textBy.set(row.config + '/' + String(row.sentenceId), row);
  }
  const items = [];
  for (let n = 1668; n <= 1682; n++) {
    for (const config of ['en_us', 'cmn_hans_cn']) {
      const key = config + '/' + n;
      const ear = ears.get(key);
      const text = textBy.get(key);
      const audio = audioBy.get(key);
      if (!ear || !text || !audio) return fail('missing-ear', { id: key });
      if (String(n) === '1663' || n < 1668 || n > 1682) return fail('excluded-id', { id: key });
      if (ear.raw !== text.raw) return fail('text-drift', { id: key });
      if (ear.audioSha256 !== audio.sha256) return fail('checksum-mismatch', { id: key });
      items.push({
        id: 'fleurs-public-candidates/' + key,
        stratum: 'read-speech',
        lang: config === 'en_us' ? 'en' : 'zh',
        config: config,
        sentenceId: String(n),
        reference: text.raw,
        audioSha256: audio.sha256,
        audioName: audio.audioName,
        audioRel: config + '/' + audio.audioName,
        saLocale: SA_LOCALE[config],
        bitsPerSample: audio.bitsPerSample,
      });
    }
  }
  if (ears.size !== 30) return fail('ear-count', { count: ears.size });
  const earById = new Map();
  for (const row of ascendEar.items || []) {
    if (earById.has(row.id)) return fail('duplicate-id', { id: 'ascend/' + row.id });
    earById.set(row.id, row);
  }
  for (const row of ascend.items || []) {
    const ear = earById.get(row.id);
    if (!ear) return fail('missing-ear', { id: 'ascend/' + row.id });
    if (ear.audioSha256 !== row.audioSha256) return fail('checksum-mismatch', { id: 'ascend/' + row.id });
    if (ear.transcription !== row.transcription) return fail('text-drift', { id: 'ascend/' + row.id });
    items.push({
      id: 'ascend/' + row.id,
      stratum: 'code-switch',
      lang: 'mixed',
      config: 'ascend',
      sentenceId: row.id,
      reference: row.transcription,
      audioSha256: row.audioSha256,
      audioName: row.audioName,
      audioRel: row.audioName,
      saLocale: SA_LOCALE.ascend,
      bitsPerSample: row.bitsPerSample,
    });
  }
  if (items.length !== 36) return fail('need-36', { count: items.length });
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== 36) return fail('duplicate-id');
  return {
    ok: true,
    code: 'ok',
    items: items,
    approvedPlannedSetCount: 0,
    denominator: 36,
    excluded: ['fleurs-frozen-16', 'cmn_hans_cn/1663'],
    productMetric: false,
    rates: null,
    accent: 'unknown',
    noise: 'unknown',
    continuousDialogue: 'unknown',
    saLocale: SA_LOCALE,
  };
}

function cacheFile(root, rel) {
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return null;
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function checkCaches(set, fleursRoot, ascendRoot) {
  if (!set.ok) return set;
  for (const item of set.items) {
    const root = item.config === 'ascend' ? ascendRoot : fleursRoot;
    const full = cacheFile(root, item.audioRel);
    if (!full) return fail('audio-path', { id: item.id });
    if (!fs.existsSync(full)) return fail('missing-audio', { id: item.id });
    const got = sha256File(full);
    if (got !== item.audioSha256) return fail('checksum-mismatch', { id: item.id });
    item.audioChecked = true;
    item.converted = false;
    item.convertedSha256 = null;
  }
  return set;
}

function safeAudioRel(item) {
  const name = item && item.audioName;
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.wav$/.test(name)) return null;
  if (item.config === 'ascend') return 'ascend/' + name;
  if (item.config === 'en_us' || item.config === 'cmn_hans_cn') return item.config + '/' + name;
  return null;
}

function stageReviewedAudio(items, stageRoot, sourceOf) {
  if (!Array.isArray(items) || items.length !== 36) return fail('need-36');
  const seen = new Set();
  const staged = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) return fail('duplicate-id', { id: item && item.id });
    seen.add(item.id);
    if (String(item.id).indexOf('/1663') !== -1 || String(item.id).indexOf('/1660') !== -1) {
      return fail('excluded-id', { id: item.id });
    }
    const rel = safeAudioRel(item);
    if (!rel) return fail('audio-path', { id: item.id });
    const src = sourceOf(item);
    if (!src || !fs.existsSync(src)) return fail('missing-audio', { id: item.id });
    const dest = path.join(stageRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    const got = sha256File(dest);
    if (got !== item.audioSha256) {
      try { fs.unlinkSync(dest); } catch (_) {}
      return fail('checksum-mismatch', { id: item.id });
    }
    const swiftConfig = item.lang === 'en' ? 'en_us' : 'cmn_hans_cn';
    staged.push(Object.assign({}, item, {
      stagedRel: rel,
      stagedSha256: got,
      converted: false,
      convertedSha256: null,
      swiftConfig: swiftConfig,
    }));
  }
  return {
    ok: true,
    code: 'ok',
    items: staged,
    approvedPlannedSetCount: 0,
    saLocale: SA_LOCALE,
    note: 'ASCEND rows use swift config cmn_hans_cn so the research Swift locale is zh-CN. No second locale is run.',
  };
}

function conversionRecord(originalSha, converted) {
  if (converted == null) return { converted: false, originalSha256: originalSha, sha256: null };
  const sha = crypto.createHash('sha256').update(converted).digest('hex');
  return { converted: true, originalSha256: originalSha, sha256: sha };
}

function inspectSenseVoiceDir(dir) {
  const spec = {
    model: 'model.int8.onnx',
    tokens: 'tokens.txt',
    threads: 2,
    language: 'zh',
    useInverseTextNormalization: true,
    device: 'cpu',
  };
  if (!dir || !fs.existsSync(dir)) return Object.assign({ ok: false, code: 'model-missing' }, spec);
  const model = path.join(dir, spec.model);
  const tokens = path.join(dir, spec.tokens);
  if (!fs.existsSync(model) || !fs.existsSync(tokens)) return Object.assign({ ok: false, code: 'model-missing' }, spec);
  return Object.assign({
    ok: true,
    code: 'ok',
    modelSha256: sha256File(model),
    tokensSha256: sha256File(tokens),
  }, spec);
}

function perfSchedule(repeats) {
  const n = repeats == null ? 0 : repeats;
  const sequence = [];
  for (let i = 0; i < n; i++) sequence.push(i % 2 === 0 ? 'sa' : 'sensevoice');
  return {
    sequence: sequence,
    repeats: n,
    ranking: n >= 5,
    exploratory: n < 5,
  };
}

function summarizeLatencies(values) {
  const ok = [];
  let failures = 0;
  for (const value of values || []) {
    if (typeof value === 'number' && Number.isFinite(value)) ok.push(value);
    else failures += 1;
  }
  if (!ok.length) return { median: null, min: null, max: null, failures: failures, ranking: false };
  const sorted = ok.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const enough = (values || []).length >= 5 && failures === 0;
  return {
    median: median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    failures: failures,
    ranking: enough,
  };
}

module.exports = {
  loadSet, checkCaches, stageReviewedAudio, safeAudioRel, conversionRecord, senseVoicePin, saPin, inspectSenseVoiceDir, SA_LOCALE,
  perfSchedule, summarizeLatencies, sha256File,
};
