// The product ASR command must fail closed off Apple. It must not write hypotheses.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { describe, test, eq, ok } = require('./harness');
const { planRun, macMajor, assetPlan, classifyAssetError, reportFailure, pcmReadAction, readThrownAction, converterOutputAction, childFailure, diagnosticPlan, coverageReport, diagnosticProcesses, pathTimeoutRecord, diagnosticAggregate, diagnosticInvocation, interpretSupervisedExit, stageKillDecision, superviseChild, lastSampleTime, aggregateFinalSegments, fileReaderFinish, diagnosticSnapshot, baselineRunPlan, acceptHypotheses } = require('../eval/baselines/asr/run-product-asr.js');
const { scoreFrozen } = require('../eval/baselines/asr/score.js');

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

  test('the default plan stays the full set and the one-clip mode is not a score', () => {
    const full = diagnosticPlan({ diagnosticFirst: false });
    eq(full.itemLimit, null);
    eq(full.completeSet, true);
    eq(full.nodeTimeoutMs, 15 * 60 * 1000);
    const one = diagnosticPlan({ diagnosticFirst: true, diagnosticPath: 'apple-file' });
    eq(one.itemLimit, 1);
    eq(one.completeSet, false);
    eq(one.notAFullSetScore, true);
    eq(one.hypotheses, null);
    eq(one.rates, null);
    eq(one.productMetric, false);
    eq(one.sameProductProcess, false);
    eq(one.feeds.join(','), 'apple-analyzeSequence-file');
    eq(one.runCapMs, 45 * 1000);
    eq(one.compileCapMs <= 90 * 1000, true);
    eq(one.compileCapMs + one.runCapMs <= 3 * 60 * 1000, true);
  });

  test('the 16-clip baseline stays inside 180s because the audio is shorter', () => {
    const set = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/fleurs-public-v1.json'), 'utf8'));
    const audioSeconds = set.items.reduce((sum, item) => sum + item.durationSeconds, 0);
    eq(set.items.length, 16);
    eq(audioSeconds, 165.26);
    const plan = baselineRunPlan({ count: 16, audioSeconds: audioSeconds });
    eq(plan.ok, true);
    eq(plan.launcher, 'swiftc');
    eq(plan.compileCapMs, 90 * 1000);
    eq(plan.perItemCapMs, 45 * 1000);
    eq(plan.processCapMs, 180 * 1000);
    eq(plan.assetAttempts, 1);
    eq(plan.manualReserve, false);
    eq(plan.releaseLocales, false);
    eq(plan.productMetric, false);
    eq(plan.sameProductProcess, false);
    eq(plan.endToEnd, false);
    eq(plan.rates, null);
    eq(plan.success, null);
    const tooLong = baselineRunPlan({ count: 16, audioSeconds: 180 });
    eq(tooLong.ok, false);
    eq(tooLong.code, 'audio-longer-than-cap');
    eq(tooLong.processCapMs, 180 * 1000);
    const swift = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    ok(swift.includes('try await ensureOnce'));
    ok(swift.includes('let text = try await transcribe'));
    const once = swift.slice(swift.indexOf('static func ensureOnce'), swift.indexOf('static func prepareAssets'));
    ok(once.includes('attempts"] = 1'));
    ok(once.includes('while attempts') === false);
    ok(once.includes('AssetInventory.reserve') === false);
    ok(once.includes('AssetInventory.release') === false);
    const transcribe = swift.slice(swift.indexOf('static func transcribe'), swift.indexOf('static func writeFirstClipDiagnostic'));
    ok(transcribe.includes('analyzer.finalizeAndFinish(through: through)'));
    ok(transcribe.includes('origin + fed - 1'));
    ok(transcribe.includes('file.framePosition >= file.length'));
  });

  test('a 16-clip file is accepted only when every hypothesis is a string', () => {
    const rows = [];
    for (let i = 0; i < 16; i++) rows.push({ id: 'id-' + i, hypothesis: 'text ' + i });
    const okRows = acceptHypotheses(rows, 16);
    eq(okRows.ok, true);
    eq(okRows.processExit, 0);
    eq(okRows.count, 16);
    eq(okRows.rates, null);
    eq(okRows.productMetric, false);
    eq(okRows.completeSet, true);
    eq(okRows.success, null);
    const short = acceptHypotheses(rows.slice(0, 15), 16);
    eq(short.ok, false);
    eq(short.processExit, 2);
    eq(short.rates, null);
    eq(short.hypotheses, null);
    const hole = rows.map((row) => Object.assign({}, row));
    hole[3].hypothesis = null;
    const broken = acceptHypotheses(hole, 16);
    eq(broken.ok, false);
    eq(broken.processExit, 2);
    eq(broken.rates, null);
  });

  test('an incomplete hypothesis list has null rates and is not a product score', () => {
    const set = {
      kind: 'public-comparison',
      items: [
        { id: 'en', lang: 'en', reference: 'Fichte' },
        { id: 'zh', lang: 'zh', reference: '甲乙' },
      ],
    };
    const partial = scoreFrozen(set, [{ id: 'en', hypothesis: 'Fished' }]);
    eq(partial.ok, false);
    eq(partial.rates, null);
    eq(partial.productMetric, false);
    const full = scoreFrozen(set, [
      { id: 'en', hypothesis: 'Fished' },
      { id: 'zh', hypothesis: '甲乙' },
    ]);
    eq(full.ok, true);
    eq(full.productMetric, false);
    eq(full.byLang.en.metric, 'wer');
    eq(full.byLang.zh.metric, 'cer');
    eq(full.combined, undefined);
    eq(full.sameProductProcess, undefined);
  });

  test('prepare-assets is legal for one en-US sentence on the official or manual path', () => {
    const bad = diagnosticInvocation({
      prepareAssets: true, diagnosticFirst: false, diagnosticPath: '',
    });
    eq(bad.ok, false);
    eq(bad.processExit, 2);
    eq(bad.hypotheses, null);
    const manualBare = diagnosticInvocation({
      prepareAssets: true, diagnosticFirst: false, diagnosticPath: 'manual',
    });
    eq(manualBare.ok, false);
    const both = diagnosticInvocation({
      prepareAssets: true, diagnosticFirst: true, diagnosticPath: 'both',
    });
    eq(both.ok, false);
    eq(both.hypotheses, null);
    const manual = diagnosticInvocation({
      prepareAssets: true, diagnosticFirst: true, diagnosticPath: 'manual',
    });
    eq(manual.ok, true);
    eq(manual.prepare, true);
    eq(manual.sameProcess, true);
    eq(manual.path, 'manual');
    eq(manual.productMetric, false);
    eq(manual.hypotheses, null);
    const okCall = diagnosticInvocation({
      prepareAssets: true, diagnosticFirst: true, diagnosticPath: 'apple-file',
    });
    eq(okCall.ok, true);
    eq(okCall.prepare, true);
    eq(okCall.sameProcess, true);
    const installOnly = diagnosticInvocation({
      prepareAssets: false, installAssets: true, diagnosticFirst: false, diagnosticPath: '',
    });
    eq(installOnly.ok, true);
    eq(installOnly.prepare, false);
  });

  test('the manual through-time is the last sample, not the exclusive buffer end', () => {
    const official = lastSampleTime({ startFrame: 0, frameCount: 170880, sampleRate: 16000 });
    eq(official.ok, true);
    eq(official.value, 170879);
    eq(official.timescale, 16000);
    eq(official.seconds, 170879 / 16000);
    eq(official.exclusiveEndSeconds, 170880 / 16000);
    eq(official.hypotheses, null);
    eq(official.rates, null);
    eq(official.productMetric, false);
    const one = lastSampleTime({ startFrame: 100, frameCount: 1, sampleRate: 16000 });
    eq(one.ok, true);
    eq(one.value, 100);
    const none = lastSampleTime({ startFrame: 0, frameCount: 0, sampleRate: 16000 });
    eq(none.ok, false);
    eq(none.code, 'zero-input');
    eq(none.value, undefined);
    const badStart = lastSampleTime({ startFrame: -1, frameCount: 4, sampleRate: 16000 });
    eq(badStart.ok, false);
    eq(badStart.code, 'bad-start');
  });

  test('final segments are joined in order and volatile revisions are not concatenated', () => {
    const joined = aggregateFinalSegments([
      { isFinal: true, text: 'Hello', rangeStart: 0, rangeEnd: 1, reference: 'unused reference' },
      { isFinal: false, text: ' Schleg', rangeStart: 8, rangeEnd: 9 },
      { isFinal: false, text: ' Schlege', rangeStart: 8, rangeEnd: 9 },
      { isFinal: true, text: ' world', rangeStart: 1, rangeEnd: 2 },
      { isFinal: true, text: ' Schlegel.', rangeStart: 8, rangeEnd: 9 },
    ]);
    eq(joined.text, 'Hello world Schlegel.');
    eq(joined.finalCount, 3);
    eq(joined.hypotheses, null);
    eq(joined.rates, null);
    eq(joined.productMetric, false);
    const replaced = aggregateFinalSegments([
      { isFinal: true, text: 'Helo', rangeStart: 0, rangeEnd: 1 },
      { isFinal: true, text: 'Hello', rangeStart: 0, rangeEnd: 1 },
    ]);
    eq(replaced.text, 'Hello');
    eq(replaced.finalCount, 1);
    const volatileOnly = aggregateFinalSegments([
      { isFinal: false, text: ' Schlegel.', rangeStart: 8, rangeEnd: 9 },
    ]);
    eq(volatileOnly.text, '');
    eq(volatileOnly.finalCount, 0);
  });

  test('a finite file finishes the result stream and a live mic does not', () => {
    const manual = fileReaderFinish('manual-pcm-file');
    eq(manual.awaitsReader, true);
    eq(manual.sessionFinish, 'finalizeAndFinish(through:)');
    eq(manual.through, 'last-sample');
    eq(manual.cancelsReader, false);
    eq(manual.volatileIsFinal, false);
    eq(manual.productCode, false);
    const apple = fileReaderFinish('apple-file');
    eq(apple.sessionFinish, 'finalizeAndFinish(through:)');
    eq(apple.awaitsReader, true);
    const live = fileReaderFinish('live-mic');
    eq(live.awaitsReader, false);
    eq(live.sessionFinish, null);
    eq(live.productCode, true);
    eq(live.hypotheses, null);
    eq(live.rates, null);
  });

  test('a mid-run diagnostic snapshot keeps frames and omits text until the reader ends', () => {
    const mid = diagnosticSnapshot({
      stage: 'result-consume',
      fed: 170880,
      finishRequestedFrame: 170879,
      exclusiveEndFrame: 170880,
      inputLastEndFrame: 170880,
      finalizeReturned: true,
      resultEventsReceived: 37,
      finalSegments: [{ isFinal: true, text: ' Schlegel.', rangeStart: 8, rangeEnd: 9 }],
      completed: false,
      diagnosticText: 'should-not-appear',
    });
    eq(mid.stage, 'result-consume');
    eq(mid.fed, 170880);
    eq(mid.finishRequestedFrame, 170879);
    eq(mid.exclusiveEndFrame, 170880);
    eq(mid.inputLastEndFrame, 170880);
    eq(mid.finalizeReturned, true);
    eq(mid.resultEventsReceived, 37);
    eq(mid.finalSegments.length, 1);
    eq(Object.prototype.hasOwnProperty.call(mid, 'diagnosticText'), false);
    eq(mid.hypotheses, null);
    eq(mid.rates, null);
    eq(mid.success, false);
    const done = diagnosticSnapshot({
      stage: 'done',
      fed: 170880,
      finishRequestedFrame: 170879,
      exclusiveEndFrame: 170880,
      inputLastEndFrame: 170880,
      finalizeReturned: true,
      resultEventsReceived: 37,
      finalSegments: [{ isFinal: true, text: ' Schlegel.', rangeStart: 8, rangeEnd: 9 }],
      completed: true,
      diagnosticText: 'Hello Schlegel.',
    });
    eq(done.diagnosticText, 'Hello Schlegel.');
  });

  test('manual file code finishes the session and the product mic still only finalizes', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    const body = src.slice(src.indexOf('static func transcribe'), src.indexOf('static func writeFirstClipDiagnostic'));
    ok(body.includes('analyzer.finalizeAndFinish(through: through)'));
    ok(body.includes('analyzer.finalize(through:') === false);
    ok(body.includes('reader.cancel') === false);
    ok(body.includes('origin + fed - 1'));
    const product = fs.readFileSync(path.join(ROOT, 'app/native/speech-bridge.swift'), 'utf8');
    ok(product.includes('an.finalize(through: through)'));
    ok(product.includes('finalizeAndFinish') === false);
    const manual = src.slice(src.indexOf('static func prepareAndRecognizeManual'), src.indexOf('static func writeDiagnostic'));
    ok(manual.includes('inputLastEndFrame'));
    ok(manual.includes('finalSegments'));
    ok(manual.includes('trace.flush'));
  });

  test('a fake child exit 2 is not wrapped as success, and exit 0 is not a product score', () => {
    let failed = null;
    try {
      execFileSync(process.execPath, ['-e', 'process.exit(2)'], { stdio: 'pipe' });
    } catch (err) {
      failed = err;
    }
    eq(failed.status, 2);
    const prepareFail = interpretSupervisedExit({
      code: failed.status, signal: failed.signal, cap: null, phase: 'prepare',
    });
    eq(prepareFail.processExit, 2);
    eq(prepareFail.swiftExit, 2);
    eq(prepareFail.success, false);
    eq(prepareFail.hypotheses, null);
    eq(prepareFail.rates, null);
    const agg = diagnosticAggregate([prepareFail]);
    eq(agg.processExit, 2);
    eq(agg.swiftExit, null);
    eq(agg.paths[0].swiftExit, 2);
    const clean = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
    eq(clean.status, 0);
    const done = interpretSupervisedExit({ code: clean.status, signal: clean.signal, cap: null, phase: 'done' });
    eq(done.processExit, 0);
    eq(done.hypotheses, null);
    eq(done.rates, null);
    eq(done.notAProductScore, true);
    eq(done.notAFullSetScore, true);
    eq(done.success, false);
    eq(diagnosticAggregate([done]).swiftExit, null);
  });

  test('a child that ignores SIGTERM is killed and is not a swift exit or a score', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-asr-cap-'));
    const phaseFile = path.join(dir, 'diagnostic-phase.json');
    fs.writeFileSync(phaseFile, '{"phase":"prepare-before"}\n');
    const watched = await superviseChild(process.execPath, [
      '-e', 'process.on("SIGTERM", function () {}); setInterval(function () {}, 1000);',
    ], {
      phaseFile: phaseFile,
      processCapMs: 5000,
      prepareCapMs: 100,
      recognizeCapMs: 45000,
      killGraceMs: 300,
    });
    eq(watched.signal, 'SIGKILL');
    eq(watched.cap, 'prepare-cap');
    const view = interpretSupervisedExit(watched);
    eq(view.swiftExit, null);
    eq(view.timedOut, true);
    eq(view.processExit, 2);
    eq(view.hypotheses, null);
    eq(view.rates, null);
    eq(view.success, false);
    eq(diagnosticAggregate([view]).processExit, 2);
    eq(diagnosticAggregate([view]).swiftExit, null);
  });

  test('stage caps are poll decisions inside one process, not a task-group timeout', () => {
    const started = 0;
    eq(stageKillDecision({
      started: started, phase: 'prepare-before', phaseAt: started,
      now: 120000, processCapMs: 180000, prepareCapMs: 120000, recognizeCapMs: 45000,
    }), 'prepare-cap');
    eq(stageKillDecision({
      started: started, phase: 'recognize-before', phaseAt: 1000,
      now: 46000, processCapMs: 180000, prepareCapMs: 120000, recognizeCapMs: 45000,
    }), 'recognize-cap');
    eq(stageKillDecision({
      started: started, phase: 'prepare-before', phaseAt: started,
      now: 180000, processCapMs: 180000, prepareCapMs: 120000, recognizeCapMs: 45000,
    }), 'process-cap');
    eq(stageKillDecision({
      started: started, phase: 'prepare-before', phaseAt: started,
      now: 1000, processCapMs: 180000, prepareCapMs: 120000, recognizeCapMs: 45000,
    }), null);
  });

  test('a child that exits 2 makes the wrapper non-zero without a fake swiftExit 0', () => {
    let caught = null;
    try {
      execFileSync(process.execPath, ['-e', 'process.exit(2)'], { stdio: 'pipe' });
    } catch (err) {
      caught = err;
    }
    eq(caught.status, 2);
    const record = pathTimeoutRecord(caught, {
      feed: 'apple-analyzeSequence-file',
      resultEventsReceived: 0,
    });
    const agg = diagnosticAggregate([record]);
    eq(agg.processExit, 2);
    eq(agg.swiftExit, null);
    eq(agg.paths.length, 1);
    eq(agg.paths[0].swiftExit, 2);
    eq(agg.paths[0].success, false);
    eq(agg.hypotheses, null);
    eq(agg.rates, null);
    const unknown = diagnosticAggregate([{ path: 'apple-analyzeSequence-file', swiftExit: null, timedOut: false, success: false }]);
    eq(unknown.processExit, 2);
    eq(unknown.swiftExit, null);
  });

  test('apple-file is its own process and a kill is not success', () => {
    const plan = diagnosticProcesses({ diagnosticPath: 'apple-file' });
    eq(plan.ok, true);
    eq(plan.processes.length, 1);
    eq(plan.processes[0].feed, 'apple-analyzeSequence-file');
    eq(plan.processes[0].separateProcess, true);
    eq(plan.processes[0].runCapMs, 45 * 1000);
    eq(plan.totalCapMs <= 3 * 60 * 1000, true);
    const both = diagnosticProcesses({ diagnosticPath: 'both' });
    eq(both.processes.length, 2);
    eq(both.processes[0].separateProcess, true);
    eq(both.processes[1].separateProcess, true);
    const killed = pathTimeoutRecord({
      code: 'ETIMEDOUT', signal: 'SIGTERM', status: null,
    }, { feed: 'apple-analyzeSequence-file', resultEventsReceived: 0 });
    eq(killed.timedOut, true);
    eq(killed.signal, 'SIGTERM');
    eq(killed.swiftExit, null);
    eq(killed.success, false);
    eq(killed.hypotheses, null);
    eq(killed.path, 'apple-analyzeSequence-file');
  });

  test('timeline coverage says whether the finish time matches the fed audio', () => {
    const aligned = coverageReport([
      { startFrame: 0, endFrame: 4096 },
      { startFrame: 4096, endFrame: 8000 },
    ], 8000);
    eq(aligned.continuous, true);
    eq(aligned.finishMatchesCoveredEnd, true);
    eq(aligned.hypotheses, null);
    eq(aligned.rates, null);
    const gap = coverageReport([
      { startFrame: 0, endFrame: 100 },
      { startFrame: 200, endFrame: 300 },
    ], 300);
    eq(gap.continuous, false);
    const past = coverageReport([{ startFrame: 0, endFrame: 100 }], 101);
    eq(past.finishMatchesCoveredEnd, false);
  });

  test('diagnosticPath is a var; this text check is not a swiftc compile', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    const start = src.indexOf('static func run()');
    const end = src.indexOf('let setURL', start);
    const block = src.slice(start, end);
    ok(block.includes('var diagnosticPath'));
    ok(block.includes('let diagnosticPath') === false);
    const lets = [];
    for (const line of block.split('\n')) {
      const found = line.match(/\blet\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (found) lets.push(found[1]);
    }
    for (const name of lets) {
      const assigned = new RegExp('^\\s*' + name + '\\s*=', 'm');
      ok(assigned.test(block) === false);
    }
  });

  test('the one-clip helper records both feeds and does not write a set score', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    ok(src.includes('--diagnostic-first'));
    ok(src.includes('notAFullSetScore'));
    ok(src.includes('manual-pcm-analyzer-input'));
    ok(src.includes('apple-analyzeSequence-file'));
    ok(src.includes('resultEventsReceived'));
    ok(src.includes('analyzeSequence(from:'));
    ok(src.includes('--diagnostic-path'));
    const official = src.slice(src.indexOf('func officialFileProbe'), src.indexOf('func writeDiagnostic'));
    ok(official.includes('withThrowingTaskGroup') === false);
    ok(src.includes('does not write hypotheses.json'));
  });

  test('the file transcriber does not use an in-process 45s task group', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    const body = src.slice(src.indexOf('static func transcribe'), src.indexOf('static func writeFirstClipDiagnostic'));
    ok(body.includes('analyzer.finalizeAndFinish(through: through)'));
    ok(body.includes('withThrowingTaskGroup') === false);
    ok(body.includes('45_000_000_000') === false);
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

  test('same-process prepare stays on one module and has no task-group deadline', () => {
    const src = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/product-asr-mac.swift'), 'utf8');
    const start = src.indexOf('static func prepareAndRecognizeOfficial');
    const end = src.indexOf('static func officialFileProbe');
    ok(start > 0 && end > start);
    const body = src.slice(start, end);
    eq(body.split('speechModule(').length - 1, 1);
    ok(body.includes('downloadAndInstall()'));
    ok(body.includes('analyzeSequence(from:'));
    ok(body.includes('nil-request-not-installed'));
    ok(body.includes('"downloadBytes": "unknown"'));
    ok(src.includes('en_us/1660/12742373433258665797.wav'));
    ok(src.includes('origin + fed - 1'));
    ok(src.includes('CMTime(value: lastSampleFrame'));
    ok(src.includes('final class SegmentText'));
    ok(!src.includes('if result.isFinal { last = String(result.text.characters) }'));
    const manualAt = src.indexOf('static func prepareAndRecognizeManual');
    const manualEnd = src.indexOf('static func writeDiagnostic');
    ok(manualAt > 0 && manualEnd > manualAt);
    const manualBody = src.slice(manualAt, manualEnd);
    eq(manualBody.split('speechModule(').length - 1, 1);
    ok(manualBody.includes('speech: speech'));
    ok(!manualBody.includes('analyzeSequence'));
    ok(!body.includes('withThrowingTaskGroup'));
    ok(!body.includes('AssetInventory.release'));
    ok(!body.includes('AssetInventory.reserve'));
    const js = fs.readFileSync(path.join(ROOT, 'eval/baselines/asr/run-product-asr.js'), 'utf8');
    ok(js.includes('--diagnostic-prepare-assets'));
    ok(js.includes('function superviseChild'));
    ok(js.includes('child.kill(\'SIGTERM\')'));
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
