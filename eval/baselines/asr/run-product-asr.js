'use strict';

// Eval-only gate for the product ASR path. It does not change the app.
// On this repository the live recognizer is Apple SpeechAnalyzer (macOS 26 /
// iOS 26) inside app/native/speech-bridge.swift. English never leaves that
// path. Chinese on international Mac defaults to arm e1_b1, which still runs
// inside that process (SpeechAnalyzer partials plus a SenseVoice final).
// This host cannot execute that process. The command fail-closes: it checks
// the frozen wavs, then refuses to write a hypothesis file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const { wavInfo } = require('./wav-info.js');

const DEFAULT_SET = path.join(__dirname, 'fleurs-public-v1.json');
const HELPER = path.join(__dirname, 'product-asr-mac.swift');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function macMajor(version) {
  const n = parseInt(String(version || '').split('.')[0], 10);
  return Number.isFinite(n) ? n : 0;
}

function planRun(input) {
  const items = input.items || [];
  const errors = [];
  for (const item of items) {
    if (!item.present) errors.push({ id: item.id, code: 'missing-audio' });
    else if (!item.shaMatch) errors.push({ id: item.id, code: 'hash-mismatch' });
    else if (!item.wavOk) errors.push({ id: item.id, code: 'unreadable-wav' });
    else if (item.samples !== item.numSamples) errors.push({ id: item.id, code: 'sample-count' });
  }
  const base = {
    productMetric: false,
    hypotheses: null,
    arm: 'sa',
    component: 'apple-speech-analyzer-file',
    sameProductProcess: false,
    matchesIntlMacChineseDefaultArm: false,
    intlMacChineseDefaultArm: 'e1_b1',
    endToEnd: false,
    swiftCompiledByPackager: false,
  };
  if (errors.length) {
    return Object.assign(base, { ok: false, code: 'sample-check', errors });
  }
  if (input.platform !== 'darwin') {
    return Object.assign(base, {
      ok: false,
      code: 'need-apple-speechanalyzer',
      host: { platform: input.platform, release: input.release || '' },
      evidence: [
        'app/native/speech-bridge.swift creates SpeechAnalyzer and feeds AnalyzerInput from device PCM',
        'RecognizerFactory.make in app/native/e1-sensevoice.swift returns MTDeviceTranscriber unless lane is zh and arm is e1_b1',
        'e1_b1 still runs inside the Apple process: SpeechAnalyzer partials plus MTE1SenseVoice.decode after the sil0.5_thr0.3_max8 VAD',
      ],
      requires: 'macOS 26 or iOS 26, with the system speech assets installed for en-US and zh-CN',
    });
  }
  if (macMajor(input.macProductVersion) < 26) {
    return Object.assign(base, {
      ok: false,
      code: 'need-macos-26',
      macProductVersion: input.macProductVersion || '',
    });
  }
  return Object.assign(base, {
    ok: true,
    code: 'run-sa-file',
    helper: 'eval/baselines/asr/product-asr-mac.swift',
    eligibleToAttemptCompileAndRun: true,
    macProductVersion: input.macProductVersion || '',
    note: 'Darwin macOS major >= 26, including 27, may attempt to compile and run the SA file helper. That detection is not a compile result. swiftCompiledByPackager stays false. The helper is the sa arm only. It is not the app process, not intl-Mac Chinese default e1_b1, and not an end-to-end listen or subtitle run.',
  });
}

function inspectItem(item, root) {
  const rel = item.audioCache;
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  const out = {
    id: item.id,
    present: fs.existsSync(abs),
    shaMatch: false,
    wavOk: false,
    samples: null,
    numSamples: item.numSamples,
  };
  if (!out.present) return out;
  const buf = fs.readFileSync(abs);
  out.shaMatch = sha256(buf) === item.audioSha256;
  const info = wavInfo(buf);
  if (!info) return out;
  out.wavOk = true;
  out.samples = info.samples;
  return out;
}

function macProductVersion() {
  try {
    const text = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
    return text.trim();
  } catch (_) {
    return '';
  }
}

function main(argv) {
  const args = argv.slice(2);
  let setPath = DEFAULT_SET;
  let outDir = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') setPath = args[++i];
    else if (args[i] === '--out-dir') outDir = args[++i];
    else {
      console.error('unknown arg ' + args[i]);
      process.exit(1);
    }
  }
  const set = JSON.parse(fs.readFileSync(setPath, 'utf8'));
  const root = path.join(__dirname, '..', '..', '..');
  const inspected = (set.items || []).map((item) => inspectItem(item, root));
  const plan = planRun({
    platform: process.platform,
    release: os.release(),
    macProductVersion: process.platform === 'darwin' ? macProductVersion() : '',
    items: inspected,
  });
  plan.checked = inspected.length;
  console.log(JSON.stringify(plan, null, 2));
  if (!plan.ok) process.exit(2);
  if (!outDir) {
    console.error('{"ok":false,"code":"need-out-dir","productMetric":false,"hypotheses":null,"arm":"sa"}');
    process.exit(2);
  }
  const dest = path.resolve(outDir);
  fs.mkdirSync(dest, { recursive: true });
  const metaPath = path.join(dest, 'run-metadata.json');
  const hypPath = path.join(dest, 'hypotheses.json');
  const meta = {
    arm: 'sa',
    component: 'apple-speech-analyzer-file',
    sameProductProcess: false,
    matchesIntlMacChineseDefaultArm: false,
    intlMacChineseDefaultArm: 'e1_b1',
    endToEnd: false,
    productMetric: false,
    swiftCompiledByPackager: false,
    note: 'sa arm file feed only. Not the intl-Mac Chinese default e1_b1 arm and not an end-to-end result.',
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  try {
    execFileSync('swift', [HELPER, '--set', setPath, '--out', hypPath], {
      stdio: 'inherit',
      timeout: 15 * 60 * 1000,
    });
  } catch (err) {
    meta.swiftExit = err.status == null ? 1 : err.status;
    meta.hypotheses = null;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    try { fs.unlinkSync(hypPath); } catch (_) {}
    process.exit(meta.swiftExit || 1);
  }
  meta.swiftExit = 0;
  meta.hypothesesFile = 'hypotheses.json';
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
}

if (require.main === module) main(process.argv);

module.exports = { planRun, macMajor, inspectItem };
