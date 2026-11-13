'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, eq } = require('./harness');
const { signalProcessGroup } = require('../eval/baselines/asr/run-sa-file.js');
const {
  loadSet, checkCaches, senseVoicePin, perfSchedule, summarizeLatencies, conversionRecord,
} = require('../eval/baselines/asr/reviewed-36.js');
const { mixedTokens, scoreReviewed } = require('../eval/baselines/asr/codeswitch-score.js');
const { runReviewed36, prefetchSenseVoice, signalProcessGroup: reusedSignal } = require('../eval/baselines/asr/run-reviewed-36.js');

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
    eq(calls, 1);
    eq(mismatch.code, 'checksum-mismatch');
  });

  test('Linux SA is unavailable and pack-existing does not recognize again', () => {
    eq(reusedSignal, signalProcessGroup);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'r36-run-'));
    const runDir = path.join(out, 'run');
    let calls = 0;
    const result = runReviewed36({
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
    const again = runReviewed36({ command: 'pack-existing', packDir: runDir, recognize: () => { calls += 1; } });
    eq(calls, 0);
    eq(again.recognizeStarted, false);
    eq(again.processExit, 0);
    const conv = conversionRecord('abc', Buffer.from('pcm'));
    eq(conv.converted, true);
    eq(conv.sha256 === 'abc', false);
    eq(conversionRecord('abc', null).converted, false);
    const mac = fs.mkdtempSync(path.join(os.tmpdir(), 'r36-mac-'));
    const macRun = runReviewed36({
      command: 'run', backend: 'sa', platform: 'darwin', swiftc: '/usr/bin/false',
      outDir: path.join(mac, 'run'), root: ROOT, skipAudio: true,
      recognize: () => { calls += 1; },
    });
    eq(calls, 0);
    eq(macRun.code, 'sa-not-executed');
    eq(macRun.rates, null);
    eq(macRun.phases.recognizeMs, null);
  });
});
