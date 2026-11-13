'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, eq } = require('./harness');
const { signalProcessGroup } = require('../eval/baselines/asr/run-sa-file.js');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  loadSet, checkCaches, stageReviewedAudio, senseVoicePin, perfSchedule, summarizeLatencies, conversionRecord,
} = require('../eval/baselines/asr/reviewed-36.js');
const { mixedTokens, scoreReviewed } = require('../eval/baselines/asr/codeswitch-score.js');
const { runReviewed36, prefetchSenseVoice, signalProcessGroup: reusedSignal, SENSEVOICE_ZIP_URL, senseVoiceChildArgs } = require('../eval/baselines/asr/run-reviewed-36.js');

const ROOT = path.join(__dirname, '..');

function readSpeech(id, lang, reference, hypothesis) {
  return { id: id, stratum: 'read-speech', lang: lang, reference: reference, hypothesis: hypothesis };
}

describe('reviewed 36 — selection, score, and unavailable runs', () => {
  test('the set is the ear-checked 30 plus 6 and not the approved plan', () => {
    const set = loadSet(ROOT);
    eq(set.ok, true);
    eq(set.items.length, 36);
    eq(set.approvedPlannedSetCount, 0);
    eq(set.rates, null);
    const ids = set.items.map((item) => item.id);
    eq(ids.indexOf('fleurs-frozen-16/cmn_hans_cn/1663'), -1);
    eq(ids.some((id) => id.indexOf('/1663') !== -1), false);
    eq(ids.some((id) => id.indexOf('/1660') !== -1), false);
    eq(set.items.filter((item) => item.stratum === 'read-speech').length, 30);
    eq(set.items.filter((item) => item.stratum === 'code-switch').length, 6);
    eq(set.saLocale.ascend, 'zh-CN');
    eq(set.saLocale.searched, false);
    eq(set.accent, 'unknown');
  });

  test('a bad hash and a missing file fail before any score', () => {
    const set = loadSet(ROOT);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r36-'));
    const item = set.items[0];
    const relDir = path.join(dir, path.dirname(item.audioRel));
    fs.mkdirSync(relDir, { recursive: true });
    eq(checkCaches(set, dir, dir).code, 'missing-audio');
    fs.writeFileSync(path.join(dir, item.audioRel), Buffer.from('not-the-wav'));
    eq(checkCaches(set, dir, dir).code, 'checksum-mismatch');
  });

  test('code-switch tokens keep Latin words and do not rank', () => {
    const tokens = mixedTokens("呃what's the呃");
    eq(tokens[0], '呃');
    eq(tokens.indexOf('what') > 0, true);
    eq(tokens[tokens.length - 1], '呃');
    eq(tokens.indexOf('w'), -1);
    const items = [];
    for (let i = 0; i < 15; i++) {
      items.push(readSpeech('en/' + i, 'en', 'one two', 'one two'));
      items.push(readSpeech('zh/' + i, 'zh', '甲乙', '甲乙'));
    }
    items.length = 30;
    for (let i = 0; i < 6; i++) {
      items.push({
        id: 'ascend/' + i,
        stratum: 'code-switch',
        lang: 'mixed',
        reference: '呃what',
        hypothesis: '呃what',
      });
    }
    const scored = scoreReviewed(items);
    eq(scored.ok, true);
    eq(scored.rates.en.errors, 0);
    eq(scored.rates.codeswitch.ranking, false);
    eq(scored.ranking, false);
    eq(scored.approvedPlannedSetCount, 0);
    items[0].hypothesis = '';
    const empty = scoreReviewed(items);
    eq(empty.ok, false);
    eq(empty.reason, 'empty-hypothesis');
    eq(empty.rates, null);
  });

  test('fewer than five timed runs stay exploratory', () => {
    eq(perfSchedule(4).ranking, false);
    eq(perfSchedule(4).exploratory, true);
    eq(summarizeLatencies([1, 2, 3]).ranking, false);
    eq(summarizeLatencies([1, null, 3, 4, 5]).failures, 1);
    eq(summarizeLatencies([1, null, 3, 4, 5]).ranking, false);
  });

  test('SenseVoice pin matches the production table and prefetch does not call the relay', async () => {
    const pin = senseVoicePin(ROOT);
    eq(pin.model, 'model.int8.onnx');
    eq(pin.language, 'zh');
    eq(pin.useInverseTextNormalization, true);
    eq(pin.device, 'cpu');
    eq(pin.quantization, 'int8');
    eq(pin.sha256, '286a4b89c62be15c78f195b908bf746c80a655f07588346ee0383a8f20f21e04');
    eq(pin.bytes, 160304482);
    eq(pin.obtained, false);
    const refused = await prefetchSenseVoice({ url: '', root: ROOT, fetch: () => { throw new Error('called'); } });
    eq(refused.code, 'prefetch-url-required');
    eq(refused.attempts, 0);
    const relay = await prefetchSenseVoice({
      url: 'https://api.belliedmonkey.com/models/x.zip',
      root: ROOT,
      fetch: () => { throw new Error('called'); },
    });
    eq(relay.code, 'relay-refused');
    eq(relay.attempts, 0);
    let calls = 0;
    const mismatch = await prefetchSenseVoice({
      url: 'https://example.invalid/model.zip',
      root: ROOT,
      fetch: () => {
        calls += 1;
        return { arrayBuffer: async () => Buffer.from('nope') };
      },
    });
    eq(calls, 2);
    eq(mismatch.attempts, 2);
    eq(mismatch.code, 'checksum-mismatch');
    eq(SENSEVOICE_ZIP_URL.endsWith('.zip'), true);
    const tar = await prefetchSenseVoice({ url: SENSEVOICE_ZIP_URL.replace(/\.zip$/, '.tar.bz2'), root: ROOT, fetch: () => { throw new Error('called'); } });
    eq(tar.code, 'tar-bz2-refused');
    eq(tar.attempts, 0);
    const { inspectSenseVoiceDir } = require('../eval/baselines/asr/reviewed-36.js');
    eq(inspectSenseVoiceDir('').code, 'model-missing');
  });

  test('Linux SA is unavailable and pack-existing does not recognize again', async () => {
    eq(reusedSignal, signalProcessGroup);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'r36-run-'));
    const runDir = path.join(out, 'run');
    let calls = 0;
    const result = await runReviewed36({
      command: 'run',
      backend: 'sa',
      platform: 'linux',
      outDir: runDir,
      root: ROOT,
      skipAudio: true,
      recognize: () => { calls += 1; return { ok: true, hypotheses: [] }; },
    });
    eq(calls, 0);
    eq(result.code, 'unavailable');
    eq(result.processExit, 2);
    eq(result.rates, null);
    eq(result.phases.recognizeMs, null);
    eq(fs.existsSync(path.join(runDir, 'evidence.tar.gz')), true);
    const again = await runReviewed36({ command: 'pack-existing', packDir: runDir, recognize: () => { calls += 1; } });
    eq(calls, 0);
    eq(again.recognizeStarted, false);
    eq(again.processExit, 0);
    const conv = conversionRecord('abc', Buffer.from('pcm'));
    eq(conv.converted, true);
    eq(conv.sha256 === 'abc', false);
    eq(conversionRecord('abc', null).converted, false);
  });

  function fixtureItems(dir) {
    const items = [];
    function add(id, config, lang, stratum, reference) {
      const audioName = id.replace(/[^A-Za-z0-9._-]/g, '_') + '.wav';
      const body = Buffer.from('wav-bytes-' + id);
      const sourcePath = path.join(dir, audioName);
      fs.writeFileSync(sourcePath, body);
      items.push({
        id: id,
        config: config,
        lang: lang,
        stratum: stratum,
        reference: reference,
        audioName: audioName,
        audioSha256: crypto.createHash('sha256').update(body).digest('hex'),
        sourcePath: sourcePath,
      });
    }
    for (let i = 0; i < 15; i++) add('read/en/' + i, 'en_us', 'en', 'read-speech', 'one two');
    for (let i = 0; i < 15; i++) add('read/zh/' + i, 'cmn_hans_cn', 'zh', 'read-speech', '甲乙');
    for (let i = 0; i < 6; i++) add('ascend/' + i, 'ascend', 'mixed', 'code-switch', '呃what');
    return items;
  }

  function scriptBin(kind) {
    return (bin) => {
      const body = [
        '#!/usr/bin/env node',
        'const fs = require("fs");',
        'const args = process.argv;',
        'if (args.includes("--install-assets")) process.exit(0);',
        kind === 'fail' ? 'process.exit(2);' : '',
        kind === 'sleep' ? 'setInterval(function () {}, 1000);' : '',
        'const set = JSON.parse(fs.readFileSync(args[args.indexOf("--set") + 1], "utf8"));',
        'const rows = set.items.map(function (item) { return { id: item.id, hypothesis: "one two" }; });',
        'fs.writeFileSync(args[args.indexOf("--out") + 1], JSON.stringify(rows));',
      ].filter(Boolean).join('\n');
      fs.writeFileSync(bin, body);
      fs.chmodSync(bin, 0o755);
      return { code: 0 };
    };
  }

  test('a mock SA child can succeed, fail, and time out without a real Apple result', async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'r36-src-'));
    const items = fixtureItems(src);
    const staged = stageReviewedAudio(items, path.join(src, 'stage'), (item) => item.sourcePath);
    eq(staged.ok, true);
    eq(staged.items[30].swiftConfig, 'cmn_hans_cn');
    eq(staged.items[30].stagedSha256, items[30].audioSha256);
    const successDir = path.join(src, 'ok');
    const success = await runReviewed36({
      command: 'run', backend: 'sa', platform: 'linux', execute: true, synthetic: true,
      fixtureItems: items, outDir: successDir, root: ROOT,
      compile: scriptBin('ok'),
      processCapMs: 5000, itemCapMs: 5000, killGraceMs: 50, pollMs: 20,
    });
    eq(success.code, 'ok');
    eq(success.synthetic, true);
    eq(success.rates, null);
    eq(success.appleResult, false);
    eq(success.recognizeStarted, true);
    eq(typeof success.phases.recognizeMs, 'number');
    eq(typeof success.phases.compileMs, 'number');
    eq(success.saLocaleApplied.searched, false);
    const set = JSON.parse(fs.readFileSync(path.join(successDir, 'set-for-run.json'), 'utf8'));
    eq(set.items.length, 36);
    eq(set.items.some((item) => String(item.id).indexOf('1660') !== -1), false);
    const failDir = path.join(src, 'fail');
    const failed = await runReviewed36({
      command: 'run', backend: 'sa', platform: 'linux', execute: true, synthetic: true,
      fixtureItems: items, outDir: failDir, root: ROOT,
      compile: scriptBin('fail'),
      processCapMs: 5000, itemCapMs: 5000, killGraceMs: 50, pollMs: 20,
    });
    eq(failed.code, 'recognition-failed');
    eq(failed.rates, null);
    eq(failed.recognizeStarted, true);
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(function(){}, 1000)'], { detached: true, stdio: 'ignore' });
    const timeoutDir = path.join(src, 'timeout');
    try {
      const timed = await runReviewed36({
        command: 'run', backend: 'sa', platform: 'linux', execute: true, synthetic: true,
        fixtureItems: items, outDir: timeoutDir, root: ROOT,
        compile: scriptBin('sleep'),
        processCapMs: 300, itemCapMs: 300, killGraceMs: 80, pollMs: 20,
      });
      eq(timed.timedOut, true);
      eq(timed.rates, null);
      eq(timed.recognizeStarted, true);
      const model = path.join(src, 'sv-model');
      fs.mkdirSync(model);
      fs.writeFileSync(path.join(model, 'model.int8.onnx'), Buffer.from('onnx-bytes'));
      fs.writeFileSync(path.join(model, 'tokens.txt'), Buffer.from('tok\n'));
      const absent = await runReviewed36({
        command: 'run', backend: 'sensevoice', outDir: path.join(src, 'sv-absent'), root: ROOT, skipAudio: true,
      });
      eq(absent.code, 'model-missing');
      eq(absent.rates, null);
      const hashed = await runReviewed36({
        command: 'run', backend: 'sensevoice', sensevoiceDir: model,
        outDir: path.join(src, 'sv-nobin'), root: ROOT, skipAudio: true,
      });
      eq(hashed.code, 'backend-missing');
      eq(hashed.rates, null);
      eq(typeof hashed.modelSha256, 'string');
      eq(hashed.modelSha256, crypto.createHash('sha256').update(Buffer.from('onnx-bytes')).digest('hex'));
      const mock = path.join(src, 'sherpa-mock');
      fs.writeFileSync(mock, [
        '#!/usr/bin/env node',
        'const fs = require("fs");',
        'const path = require("path");',
        'fs.writeFileSync(path.join(path.dirname(process.argv[1]), "last-argv.json"), JSON.stringify(process.argv.slice(2)));',
        'if (process.argv.includes("--fail")) process.exit(2);',
        'process.stderr.write("recognizer created in 0.010 s\\n");',
        'const wavs = process.argv.slice(2).filter(function (arg) { return arg.indexOf("--") !== 0; });',
        'for (let i = 0; i < wavs.length; i++) process.stdout.write(JSON.stringify({ text: "one two" }) + "\\n");',
      ].join('\n'));
      fs.chmodSync(mock, 0o755);
      const svOk = await runReviewed36({
        command: 'run', backend: 'sensevoice', platform: 'linux', synthetic: true,
        fixtureItems: items, sensevoiceDir: model, sensevoiceBin: mock,
        outDir: path.join(src, 'sv-ok'), root: ROOT,
        processCapMs: 5000, itemCapMs: 5000, killGraceMs: 50, pollMs: 20,
      });
      eq(svOk.code, 'ok');
      eq(svOk.rates, null);
      eq(svOk.appleResult, false);
      eq(svOk.senseVoiceResult, false);
      eq(svOk.phases.modelLoadMs, 10);
      const argv = JSON.parse(fs.readFileSync(path.join(src, 'last-argv.json'), 'utf8'));
      eq(argv.indexOf('--sense-voice-language=zh') !== -1, true);
      eq(argv.indexOf('--sense-voice-use-itn=1') !== -1, true);
      eq(argv.indexOf('--num-threads=2') !== -1, true);
      eq(argv.indexOf('--provider=cpu') !== -1, true);
      eq(argv.filter((arg) => arg.indexOf('--') !== 0).length, 36);
      const svFail = await runReviewed36({
        command: 'run', backend: 'sensevoice', platform: 'linux', synthetic: true,
        fixtureItems: items, sensevoiceDir: model, sensevoiceBin: mock,
        outDir: path.join(src, 'sv-fail'), root: ROOT,
        spawn: (bin, args, opts) => spawn(bin, args.concat(['--fail']), opts),
        processCapMs: 5000, itemCapMs: 5000, killGraceMs: 50, pollMs: 20,
      });
      eq(svFail.code, 'recognition-failed');
      eq(svFail.rates, null);
      eq(svFail.recognizeStarted, true);
      eq(senseVoiceChildArgs(model, []).indexOf('--num-threads=2') !== -1, true);
      let alive = true;
      try { process.kill(sentinel.pid, 0); } catch (_) { alive = false; }
      eq(alive, true);
    } finally {
      try { process.kill(sentinel.pid, 'SIGKILL'); } catch (_) {}
    }
  });
});
