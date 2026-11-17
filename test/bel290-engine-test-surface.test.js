// test/bel290-engine-test-surface.test.js — BEL-290：engine_test.surface。
//
// 四件事：
//   1. EngineTest 的 translation / tts / stt / notes 都接受可选 surface，并串到
//      track() 的 props；不传时 props 仍是旧形状 {slot,result}。
//   2. 表外 surface 不写（客户端白名单会整条丢弃）。
//   3. 客户端本地白名单与注册表 ENGINE_TEST_SURFACES 一致。
//   4. 三个调用点：quick-setup-view → setup_quick；options:1539 → setup_fields；
//      setup-done-model:76 → setup_onboard。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadModule } = require('./harness');
const cfg = require('../build/telemetry.config.js');
const WireFormat = require('../extension/content/wire-format.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function loadET(overrides) {
  const tracked = [];
  const sb = Object.assign({
    window: {},
    WireFormat,
    MTTelemetry: { track: (name, props) => tracked.push({ name, props: props || {} }) },
    TranslationAPI: { translate: async () => '你好' },
    LearnTTS: { configure() {}, test: async () => ({ ms: 1 }) },
    LearnSpeech: { configure() {}, test: async () => ({ ms: 1 }) },
    LearnNotes: {
      resolveConfig: () => ({ provider: 'acme', apiKey: 'k', baseUrl: 'https://api.acme.test/v1/chat/completions', model: 'm' }),
      configure() {}, test: async () => ({ ms: 1 }),
    },
  }, overrides || {});
  return { ET: loadModule('learn/engine-test.js', sb).EngineTest, tracked };
}

const CHAT = { provider: 'acme', apiKey: 'k', baseUrl: 'https://api.acme.test/v1/chat/completions', model: 'm', targetLang: 'zh-CN' };
const TTS = { engineId: 'acme_tts', apiKey: 'k', baseUrl: 'https://api.acme.test/v1/audio/speech', model: 'm' };
const STT = { engineId: 'acme_stt', apiKey: 'k', baseUrl: 'https://api.acme.test/v1/audio/transcriptions', model: 'm' };
const NOTES = { provider: 'acme', apiKey: 'k', baseUrl: 'https://api.acme.test/v1/chat/completions', model: 'm' };

describe('BEL-290 · EngineTest 四条传输都接受 surface', () => {
  const calls = [
    ['translation', (ET, surface) => ET.translation(Object.assign({}, CHAT, { surface })), 'chat'],
    ['tts', (ET, surface) => ET.tts(Object.assign({}, TTS, { surface })), 'tts'],
    ['stt', (ET, surface) => ET.stt(Object.assign({}, STT, { surface })), 'stt'],
    ['notes', (ET, surface) => ET.notes(NOTES, surface), 'notes'],
  ];
  for (const [name, run, slot] of calls) {
    test(`${name}() 传 setup_quick ⇒ track 带 surface`, async () => {
      const { ET, tracked } = loadET();
      await run(ET, 'setup_quick');
      eq(tracked.length, 1);
      eq(tracked[0].name, 'engine_test');
      eq(tracked[0].props.slot, slot);
      eq(tracked[0].props.result, 'ok');
      eq(tracked[0].props.surface, 'setup_quick');
    });
  }

  test('不传 surface ⇒ 旧形状不变（只有 slot + result）', async () => {
    const { ET, tracked } = loadET();
    await ET.translation(CHAT);
    deepEq(Object.keys(tracked[0].props).sort(), ['result', 'slot']);
  });

  test('表外 / 非字符串 surface 不写', async () => {
    for (const surface of ['setup_quick ', 'SETUP_FIELDS', 'nope', 1, null]) {
      const { ET, tracked } = loadET();
      await ET.translation(Object.assign({}, CHAT, { surface }));
      eq(tracked[0].props.surface, undefined, '非法 surface 被写进去了：' + String(surface));
    }
  });

  test('失败也带 surface（成功/失败同一口径）', async () => {
    const { ET, tracked } = loadET({
      TranslationAPI: { translate: async () => { const e = new Error('x'); e.code = 'network'; throw e; } },
    });
    await ET.translation(Object.assign({}, CHAT, { surface: 'setup_fields' })).catch(() => {});
    eq(tracked[0].props.result, 'fail');
    eq(tracked[0].props.surface, 'setup_fields');
  });
});

describe('BEL-290 · 客户端本地白名单与注册表同源', () => {
  const src = read('extension/learn/engine-test.js');
  const m = /const ENGINE_TEST_SURFACES = \[([\s\S]*?)\];/.exec(src);
  test('ENGINE_TEST_SURFACES 逐值等于注册表 engine_test.surface', () => {
    ok(m, '找不到 ENGINE_TEST_SURFACES');
    const local = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    deepEq(local, cfg.EVENTS.engine_test.surface, '客户端白名单漂了 —— 少一个值会让该面整条丢掉');
  });
});

describe('BEL-290 · 三个调用点的 surface', () => {
  test('quick-setup-view 的三条自检都带 setup_quick', () => {
    const src = read('src/shared/quick-setup-view.jsx');
    const body = src.slice(src.indexOf('async function runOne'));
    ok((body.match(/surface: 'setup_quick'/g) || []).length >= 3, '三条 EngineTest 调用没有全带 setup_quick');
  });

  test('options 的字段行自检（translate 那一条）带 setup_fields', () => {
    const src = read('src/pages/options.jsx');
    const i = src.indexOf('const btnTestProvider = async () => {');
    const body = src.slice(i, src.indexOf('const btnTestNotes = async () => {', i));
    ok(/EngineTest\.translation\(\{[\s\S]*surface: 'setup_fields'/.test(body), 'options 的字段行自检没带 setup_fields');
    ok(/surface: 'setup_fields'/.test(src), 'options.jsx 里找不到 setup_fields');
  });

  test('setup-done-model 的翻译自检带 setup_onboard', () => {
    const src = read('src/app/setup-done-model.js');
    const i = src.indexOf('async function runSlot');
    const body = src.slice(i, src.indexOf('if (slot === \'tts\')', i));
    ok(/EngineTest\.translation\(\{[\s\S]*surface: 'setup_onboard'/.test(body), '回执页自测没带 setup_onboard');
  });
});
