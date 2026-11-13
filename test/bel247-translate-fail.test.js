// test/bel247-translate-fail.test.js — BEL-247：translate_fail 的 kind / ms / stalled。
//
// 静态部分钉「五个发送点都带 kind、两处假 ms 消失、stalled 不再是 timeout」；
// VM 部分真的跑一次引擎，确认卡死分支发 code:'stalled'，preflight 不进 onFail。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadModule, tick } = require('./harness');
const { makeChrome } = require('./stubs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('BEL-247 — 注册表与生成物', () => {
  const cfg = require('../build/telemetry.config.js');

  test('translate_ok / translate_fail 共用 TRANSLATE_KINDS', () => {
    deepEq(cfg.TRANSLATE_KINDS, ['page', 'subtitle', 'doc', 'quick']);
    deepEq(cfg.EVENTS.translate_ok.kind, cfg.TRANSLATE_KINDS, 'ok 与 fail 必须同一份枚举');
    deepEq(cfg.EVENTS.translate_fail.kind, cfg.TRANSLATE_KINDS);
    ok(cfg.EVENTS.translate_fail.code.indexOf('stalled') >= 0, 'code 里没有 stalled');
  });

  test('events.gen.json 与注册表一致（生成物，不手改）', () => {
    const gen = require('../supabase/functions/bt-ingest/events.gen.json');
    deepEq(gen.events.translate_ok.kind, cfg.EVENTS.translate_ok.kind);
    deepEq(gen.events.translate_fail.kind, cfg.EVENTS.translate_fail.kind);
    ok(gen.events.translate_fail.code.indexOf('stalled') >= 0);
  });

  test('文档表同步：kind / stalled / ms 语义', () => {
    const d = read('docs/telemetry-design.md');
    ok(/translate_fail.*kind: page/.test(d), 'translate_fail 表里没有 kind');
    ok(/stalled/.test(d), '文档没有 stalled');
  });
});

describe('BEL-247 — 五个发送点都带 kind，假 ms 消失', () => {
  test('page / subtitle / doc / quick 四处失败都带 kind', () => {
    ok(/kind: 'page'/.test(read('extension/content/content-webpage.js')));
    ok(/kind: 'subtitle'/.test(read('extension/content/subtitle-adapter.js')));
    ok(/kind: 'doc'/.test(read('src/shared/doc-view.js')));
    ok(/kind: 'quick'/.test(read('app/handoff.js')));
    ok(/kind: 'subtitle'/.test(read('src/app/listen-model.js')));
  });

  test('listen 不再发会话时长；只在 e.ms 是整数时发', () => {
    const s = read('src/app/listen-model.js');
    ok(!/ms:\s*Math\.max\(0,\s*now\(\)\s*-\s*session\.startedAt\)/.test(s),
      'listen 还在把会话时长当请求耗时');
    ok(/if \(Number\.isInteger\(e\.ms\)\) fail\.ms = e\.ms/.test(s));
  });

  test('handoff 不再补假 0；非负整数才发', () => {
    const s = read('app/handoff.js');
    ok(!/Number\.isInteger\(m\.ms\) && m\.ms >= 0 \? m\.ms : 0/.test(s), '还在补 0');
    ok(/const ms = Number\.isInteger\(m\.ms\) && m\.ms >= 0 \? m\.ms : null/.test(s));
  });

  test('translation-core：FAIL_CODES 有 stalled，卡死分支发 stalled', () => {
    const s = read('extension/content/translation-core.js');
    ok(/'stalled'/.test(s));
    ok(/onFail\(\{ code: 'stalled' \}\)/.test(s), '卡死还写成 timeout');
    ok(!/onFail\(\{ code: 'timeout', stalled: true \}\)/.test(s));
    ok(/e\.preflight/.test(s), 'preflight 没有直接进 error 态');
  });
});

describe('BEL-247 — 引擎行为（VM）', () => {
  function core() {
    return loadModule('translation-core.js', { window: {} }).TranslationCore;
  }

  test('卡死 → onFail{code:stalled}，不触发连续超时熔断', async () => {
    const TC = core();
    const fails = [];
    const engine = TC.createEngine({
      translate: () => new Promise(() => {}),
      targetLang: 'fr',
      window: { STALL_MS: 20 },
      onFail: (e) => fails.push(e),
    });
    engine.setUnits([{ text: 'hello world', start: 0 }]);
    engine.pump();
    await tick(60);
    eq(fails.length, 1);
    eq(fails[0].code, 'stalled');
    eq(engine.halted, false, '单单元卡死不该把整台引擎停掉');
  });

  test('preflight 错误不进 onFail（它不是一次 provider 失败）', async () => {
    const TC = core();
    const fails = [];
    const err = new Error('no key');
    err.code = 'no_key_for_provider';
    err.preflight = true;
    err.retryable = false;
    const engine = TC.createEngine({
      translate: () => Promise.reject(err),
      targetLang: 'fr',
      onFail: (e) => fails.push(e),
    });
    engine.setUnits([{ text: 'hello world', start: 0 }]);
    engine.pump();
    await tick(20);
    eq(fails.length, 0, 'preflight 进了 translate_fail');
    eq(engine.stateOf(engine.units[0]).state, 'error', '用户仍要看到可重试的 error 态');
  });
});


describe('BEL-247 — ACCEPT-6：AbortError 跨 background 边界，回退策略不变', () => {
  function loadBg(fetchImpl) {
    const listeners = [];
    const chrome = makeChrome({});
    chrome.runtime.onInstalled = { addListener: () => {} };
    chrome.runtime.onMessage = { addListener: (fn) => listeners.push(fn) };
    chrome.action = { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, onClicked: { addListener: () => {} } };
    chrome.tabs = { onUpdated: { addListener: () => {} }, onActivated: { addListener: () => {} }, query: () => {}, sendMessage: () => {} };
    loadModule('./background.js', { chrome, fetch: fetchImpl, AbortController, URL, setTimeout, clearTimeout });
    return listeners[0];
  }

  test('background 回 name/code：AbortError 不被冲成 Error', async () => {
    const listener = loadBg(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      e.code = 'ABORT_ERR';
      throw e;
    });
    let answer = null;
    listener({ action: 'proxyFetch', url: 'https://relay.test/x', init: { headers: {} }, relayHosts: [] }, {}, (a) => { answer = a; });
    await tick(5);
    eq(answer.name, 'AbortError');
    eq(answer.code, 'ABORT_ERR');
  });

  test('transportError 保留 AbortError 名 + fromProxyTimeout；直连 timeout 不换路', () => {
    const src = read('extension/content/translation-api.js');
    ok(/err\.name = e\.name/.test(src), 'transportError 把 name 冲掉了');
    ok(/fromProxyTimeout/.test(src), 'ACCEPT-6 标志缺失');
    ok(/firstErr\.code !== 'network' && !firstErr\.fromProxyTimeout/.test(src),
      '回退条件没把 fromProxyTimeout 放行 —— 改了 BEL-114 的路由策略');
    ok(!/reqTimeoutSec\s*:\s*[0-9]/.test(src), '不许改超时数值');
  });
});
