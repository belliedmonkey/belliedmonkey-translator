// test/asr-app-deeplink.test.js — #134：扩展「AI 转写字幕」只跳 App 实时字幕，不发云端整段转写。
const { describe, test, eq, ok } = require('./harness');
const fs = require('fs');
const path = require('path');

describe('asr-source #134 — no cloud file-tier from extension entry', () => {
  const src = fs.readFileSync(path.join(__dirname, '../extension/content/asr-source.js'), 'utf8');

  test('startFrom 不再调用 acquireVia / fileTier', () => {
    const startFrom = src.slice(src.indexOf('function startFrom'), src.indexOf('function start(el'));
    ok(!/acquireVia/.test(startFrom), 'startFrom must not wire acquireVia');
    ok(!/fileTier/.test(startFrom), 'startFrom must not call fileTier');
    ok(/openListenApp/.test(startFrom), 'startFrom opens listen deep link');
  });

  test('startSession 不再 fetch 音频或 POST 转写端点', () => {
    const startSession = src.slice(src.indexOf('function startSession'), src.indexOf('let lastFail'));
    ok(!/fileTier/.test(startSession), 'startSession must not invoke fileTier');
    ok(!/corsReadable/.test(startSession), 'startSession must not probe media URL for upload');
    ok(!/fetchWithTimeout\(endpoint/.test(startSession), 'startSession must not POST to STT endpoint');
  });

  test('offerFor 不再因 no_engine 打开设置页', () => {
    const offer = src.slice(src.indexOf('function offerFor'), src.indexOf('function startFrom'));
    ok(!/no_engine/.test(offer), 'offer must not branch on no_engine');
    ok(!/openOptions\('#stt'\)/.test(offer), 'offer must not send user to STT settings');
  });
});
