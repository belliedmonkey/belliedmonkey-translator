// The product ASR command must fail closed off Apple. It must not write hypotheses.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, test, eq, ok } = require('./harness');
const { planRun, macMajor, assetPlan, classifyAssetError, reportFailure, pcmReadAction, readThrownAction, converterOutputAction, childFailure } = require('../eval/baselines/asr/run-product-asr.js');

const ROOT = path.join(__dirname, '..');

describe('product ASR gate — no hypothesis off the Apple recognizer', () => {
  test('Linux is not the product SpeechAnalyzer path', () => {
    const plan = planRun({
      platform: 'linux',
      release: '6.12',
      items: [{ id: 'a', present: true, shaMatch: true, wavOk: true, samples: 10, numSamples: 10 }],
    });
    eq(plan.ok, false);
    eq(plan.code, 'need-apple-speechanalyzer');
    eq(plan.hypotheses, null);
    eq(plan.productMetric, false);
    eq(plan.sameProductProcess, false);
  });

  test('macOS 27 is eligible to attempt the sa file helper and is not e1_b1', () => {
    const plan = planRun({
      platform: 'darwin',
      macProductVersion: '27.0',
      items: [{ id: 'a', present: true, shaMatch: true, wavOk: true, samples: 10, numSamples: 10 }],
    });
    eq(plan.ok, true);
    eq(plan.code, 'run-sa-file');
    eq(plan.arm, 'sa');
    eq(plan.sameProductProcess, false);
    eq(plan.matchesIntlMacChineseDefaultArm, false);
    eq(plan.intlMacChineseDefaultArm, 'e1_b1');
    eq(plan.endToEnd, false);
    eq(plan.swiftCompiledByPackager, false);
    eq(plan.eligibleToAttemptCompileAndRun, true);
    eq(plan.productMetric, false);
  });

  test('macOS before 26 does not run', () => {
    const plan = planRun({
      platform: 'darwin',
      macProductVersion: '15.6',
      items: [{ id: 'a', present: true, shaMatch: true, wavOk: true, samples: 10, numSamples: 10 }],
    });
    eq(plan.ok, false);
    eq(plan.code, 'need-macos-26');
    eq(macMajor('26.0.1'), 26);
  });

  test('a hash or sample mismatch stops before any recognizer', () => {
    const plan = planRun({
      platform: 'darwin',
      macProductVersion: '26.0',
      items: [{ id: 'a', present: true, shaMatch: false, wavOk: true, samples: 10, numSamples: 10 }],
    });
    eq(plan.code, 'sample-check');
    eq(plan.hypotheses, null);
  });

  test('the Mac helper names the product transcriber options and not a baked hypothesis', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    ok(src.includes('reportingOptions: [.volatileResults, .fastResults, .alternativeTranscriptions]'));
    ok(src.includes('attributeOptions: [.audioTimeRange, .transcriptionConfidence]'));
    ok(src.includes('progressiveLongDictation'));
    ok(!src.includes('romanticism had a large element'));
    ok(src.includes('e1_b1') === false || src.includes('does not run e1_b1') || src.includes('Does not run intl-Mac e1_b1') || src.includes('it does not run e1_b1'));
    ok(src.includes('guard let converter = AVAudioConverter(from: file.processingFormat, to: fmt)'));
    ok(src.includes('audio converter unavailable'));
    ok(!src.includes('AVAudioConverter(from: file.processingFormat, to: fmt)!' ));
    ok(!src.includes('frameCapacity: 4096)!'));
    ok(!src.includes(')!'));
  });

  test('supported is not installed and the default plan does not request a download', () => {
    const plan = assetPlan({
      install: false,
      configs: ['en_us', 'cmn_hans_cn'],
      statuses: { 'en-US': 'supported', 'zh-CN': 'supported' },
    });
    eq(plan.ok, false);
    eq(plan.code, 'speech-assets-not-installed');
    eq(plan.installRequested, false);
    eq(plan.hypotheses, null);
    eq(plan.productMetric, false);
    eq(plan.assets[0].installed, false);
    eq(plan.manualReserve, false);
    eq(plan.releaseLocales, false);
    eq(plan.maxAttempts, 2);
    eq(plan.timeoutMs, 15 * 60 * 1000);
  });

  test('an explicit install flag requests only en-US and zh-CN', () => {
    const plan = assetPlan({
      install: true,
      configs: ['en_us', 'cmn_hans_cn', 'en_us'],
      statuses: { 'en-US': 'supported', 'zh-CN': 'downloading' },
    });
    eq(plan.ok, true);
    eq(plan.code, 'request-install');
    eq(plan.installRequested, true);
    eq(plan.locales.join(','), 'en-US,zh-CN');
    eq(plan.hypotheses, null);
  });

  test('an unsupported locale is not an install request', () => {
    const plan = assetPlan({
      install: true,
      configs: ['en_us'],
      statuses: { 'en-US': 'unsupported' },
    });
    eq(plan.ok, false);
    eq(plan.code, 'unsupported-locale');
    eq(plan.installRequested, false);
    eq(plan.hypotheses, null);
  });

  test('a config outside en-US and zh-CN is rejected before install', () => {
    const plan = assetPlan({
      install: true,
      configs: ['ja_jp'],
      statuses: {},
    });
    eq(plan.code, 'unsupported-locale');
    eq(plan.installRequested, false);
  });

  test('an install failure keeps hypotheses null', () => {
    const err = classifyAssetError({ domain: 'NSURLErrorDomain', code: -1009, attempts: 2 });
    eq(err.ok, false);
    eq(err.code, 'asset-download-failed');
    eq(err.hypotheses, null);
    eq(err.attempts, 2);
    eq(classifyAssetError({ domain: 'SFSpeechErrorDomain', code: 11 }).code, 'reservation-unavailable');
    eq(classifyAssetError({ timeout: true, attempts: 2 }).code, 'asset-download-timeout');
    eq(classifyAssetError({ domain: 'SFSpeechErrorDomain', code: 4 }).code, 'unsupported-locale');
    eq(classifyAssetError({ domain: 'Other', code: 1 }).code, 'asset-install-failed');
  });

  test('a recognition error is not relabeled as an asset install failure', () => {
    const report = reportFailure({
      phase: 'recognition',
      installFlag: false,
      stage: 'analyzer-finish',
      locale: 'en-US',
      sampleId: 'en_us/1/clip.wav',
      chain: [{
        swiftType: 'CancellationError',
        domain: 'Foundation._GenericObjCError',
        code: 0,
        description: "The operation couldn’t be completed. (Foundation._GenericObjCError error 0.) file:///Users/someone/qa/clip.wav",
        userInfo: { NSLocalizedDescription: 'see /Users/someone/qa/clip.wav' },
      }],
    });
    eq(report.ok, false);
    eq(report.code, 'recognition-failed');
    eq(report.code === 'asset-install-failed', false);
    eq(report.stage, 'analyzer-finish');
    eq(report.locale, 'en-US');
    eq(report.sampleId, 'en_us/1/clip.wav');
    eq(report.hypotheses, null);
    eq(report.rates, null);
    eq(report.productMetric, false);
    eq(report.permissionPrompt, 'unknown');
    eq(report.chain[0].domain, 'Foundation._GenericObjCError');
    eq(report.chain[0].code, 0);
    eq(report.chain[0].swiftType, 'CancellationError');
    ok(report.chain[0].description.indexOf('/Users/someone') === -1);
    ok(report.chain[0].userInfo.NSLocalizedDescription.indexOf('/Users/someone') === -1);
  });

  test('an asset-status miss during recognition keeps its own code and stage', () => {
    const report = reportFailure({
      phase: 'recognition',
      stage: 'asset-status',
      locale: 'zh-CN',
      sampleId: 'cmn_hans_cn/1/clip.wav',
      underlyingCode: 'speech-assets-not-installed',
      chain: [],
    });
    eq(report.code, 'speech-assets-not-installed');
    eq(report.stage, 'asset-status');
    eq(report.hypotheses, null);
    eq(report.rates, null);
  });

  test('a file read at the end does not throw nilError, and a mid-file nilError still throws', () => {
    eq(pcmReadAction(170880, 170880).callRead, false);
    eq(pcmReadAction(0, 170880).callRead, true);
    eq(readThrownAction({
      domain: 'Foundation._GenericObjCError',
      code: 0,
      description: 'nilError',
    }, 170880, 170880).action, 'end');
    eq(readThrownAction({
      domain: 'Foundation._GenericObjCError',
      code: 0,
      description: 'nilError',
    }, 4096, 170880).action, 'throw');
    eq(readThrownAction({ domain: 'NSOSStatusErrorDomain', code: -50, description: 'param' }, 0, 170880).action, 'throw');
  });

  test('converter end statuses are not errors and a real convert error does not yield', () => {
    eq(converterOutputAction('endOfStream', false).throw, false);
    eq(converterOutputAction('inputRanDry', false).throw, false);
    eq(converterOutputAction('haveData', false).action, 'yield');
    const failed = converterOutputAction('error', true);
    eq(failed.throw, true);
    eq(failed.action, 'throw');
    eq(failed.hypotheses, null);
    eq(converterOutputAction('error', false).useNsError, false);
  });

  test('a node kill is a timeout, not a swift exit code', () => {
    const report = childFailure({
      killed: true,
      signal: 'SIGTERM',
      status: null,
      stderr: '',
    }, {
      stage: 'analyzer-finish',
      sampleId: 'en_us/1660/12742373433258665797.wav',
      locale: 'en-US',
    });
    eq(report.timedOut, true);
    eq(report.signal, 'SIGTERM');
    eq(report.swiftExit, null);
    eq(report.code, 'recognition-timeout');
    eq(report.stage, 'analyzer-finish');
    eq(report.sampleId, 'en_us/1660/12742373433258665797.wav');
    eq(report.hypotheses, null);
    eq(report.rates, null);
    eq(report.productMetric, false);
  });

  test('a real swift status is kept and is not a timeout', () => {
    const report = childFailure({ killed: false, signal: null, status: 2 }, null);
    eq(report.timedOut, false);
    eq(report.swiftExit, 2);
    eq(report.code, 'recognition-failed');
  });

  test('the Mac helper bounds analyzer-finish and names that timeout', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    ok(src.includes('recognition-timeout'));
    ok(src.includes('45_000_000_000'));
    ok(src.includes('finalizeAndFinishThroughEndOfInput') === false);
  });

  test('the Mac helper stops reading at the file end and checks converter status', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    ok(src.includes('file.framePosition >= file.length'));
    ok(src.includes('Foundation._GenericObjCError'));
    ok(src.includes('.endOfStream'));
    ok(src.includes('.inputRanDry'));
    ok(src.includes('.error'));
  });

  test('the Mac helper records the recognition stage and does not relabel it as an install', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    ok(src.includes('recognition-failed'));
    ok(src.includes('audio-open'));
    ok(src.includes('audio-format'));
    ok(src.includes('analyzer-prepare'));
    ok(src.includes('analyzer-finish'));
    ok(src.includes('result-consume'));
    ok(src.includes('swiftType'));
    ok(!src.includes('classify(error, locale: "", attempts: 0)'));
  });

  test('the Mac helper installs only through AssetInventory and only when asked', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    ok(src.includes('AssetInventory.assetInstallationRequest(supporting:'));
    ok(src.includes('downloadAndInstall()'));
    ok(src.includes('--install-assets'));
    ok(src.includes('case .supported'));
    ok(!src.includes('AssetInventory.release'));
    ok(!src.includes('AssetInventory.reserve'));
    ok(src.includes('speech-assets-not-installed'));
    ok(src.includes('asset-download-failed'));
  });

  test('the command on a checked wav still emits no hypothesis file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-asr-'));
    const wav = path.join(dir, 'clip.wav');
    fs.writeFileSync(wav, Buffer.from('RIFFnot-a-real-wave'));
    const set = {
      items: [{
        id: 'en_us/1/clip.wav',
        config: 'en_us',
        audioCache: wav,
        audioSha256: 'nope',
        numSamples: 1,
      }],
    };
    const setPath = path.join(dir, 'set.json');
    fs.writeFileSync(setPath, JSON.stringify(set));
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [
        path.join(ROOT, 'eval/baselines/asr/run-product-asr.js'),
        '--set', setPath,
      ], { encoding: 'utf8' });
    } catch (err) {
      code = err.status;
      out = err.stdout || '';
    }
    eq(code, 2);
    const plan = JSON.parse(out);
    eq(plan.hypotheses, null);
    eq(plan.code, 'sample-check');
    ok(!fs.existsSync(path.join(dir, 'hypotheses.json')));
  });
});
