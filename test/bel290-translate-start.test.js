// test/bel290-translate-start.test.js — BEL-290：translate_start 的两个发送点。
//
// 页面：content-webpage.enable() 每会话一条 {kind:'page'}；engine 只在合法 id 时带；
// 重复 enable（active 已真）不再发；updateSettings 的 disable+enable 是新会话。
// App：listen-model.noteTranslateStart() 补 kind:'subtitle' + surface（见 listen-funnel
// 里对真实听译会话的断言）。
const path = require('path');
const { describe, test, ok, eq, deepEq, loadModule } = require('./harness');

const ROOT = path.join(__dirname, '..');
const cfg = require('../build/telemetry.config.js');

function loadTranslator(provider) {
  const tracked = [];
  const noop = () => {};
  const document = {
    body: {}, documentElement: {},
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener: noop, removeEventListener: noop, getSelection: () => null,
  };
  const window = { addEventListener: noop, removeEventListener: noop, innerWidth: 800, innerHeight: 600 };
  const WebpageTranslator = loadModule('content-webpage.js', {
    DOMProcessor: {
      TRANSLATION_CLASS: 'mt-tr', TRANSLATABLE_ATTR: 'data-mt-tr', PROCESSED_ATTR: 'data-mt',
      collectUnits: () => [],
    },
    TranslationCore: {
      DEFAULT_TARGET_LANG: 'zh-CN',
      createEngine: () => ({
        units: [], items: [], stateOf: () => ({}), setUnits() {}, setItems() {}, pump() {},
        activeAt: () => null, retry() {}, reset() {},
      }),
    },
    TranslationAPI: { translate: async () => '' },
    document, window,
    location: { hostname: 'example.com', href: 'https://example.com/', pathname: '/', search: '' },
    MutationObserver: class { observe() {} disconnect() {} },
    MTTelemetry: { track: (name, props) => tracked.push({ name, props: props || {} }) },
    setInterval: () => 0, clearInterval: noop,
  }).WebpageTranslator;
  return { WebpageTranslator, tracked, provider };
}

const starts = (tracked) => tracked.filter((e) => e.name === 'translate_start');

describe('BEL-290 · content-webpage translate_start{kind:page}', () => {
  test('enable() 发一次 kind:page + 合法 engine', () => {
    const { WebpageTranslator, tracked } = loadTranslator('deepseek');
    WebpageTranslator.enable({ provider: 'deepseek', apiKey: 'k', targetLang: 'zh-CN' });
    eq(starts(tracked).length, 1, '一次会话应当只有一条');
    deepEq(starts(tracked)[0].props, { kind: 'page', engine: 'deepseek' });
  });

  test('engine 为空 / 非法时省略该键（不能带一个会被整条丢弃的值）', () => {
    for (const provider of ['', 'Not An Engine!', undefined, null, 'x'.repeat(33)]) {
      const { WebpageTranslator, tracked } = loadTranslator(provider);
      WebpageTranslator.enable({ provider, apiKey: 'k', targetLang: 'zh-CN' });
      eq(starts(tracked).length, 1, String(provider));
      deepEq(starts(tracked)[0].props, { kind: 'page' }, '非法 provider 不该进 props：' + String(provider));
      ok(!('engine' in starts(tracked)[0].props), 'engine 键必须省略');
    }
  });

  test('重复 enable 不重复发（content script 可能被注入两次）', () => {
    const { WebpageTranslator, tracked } = loadTranslator('deepseek');
    WebpageTranslator.enable({ provider: 'deepseek', apiKey: 'k' });
    WebpageTranslator.enable({ provider: 'openai', apiKey: 'k2' });
    WebpageTranslator.enable({ provider: 'openai', apiKey: 'k2' });
    eq(starts(tracked).length, 1, 'active 守卫之后不该再有 start');
  });

  test('updateSettings 的 disable+enable 是一次新会话 ⇒ 再发一条', () => {
    const { WebpageTranslator, tracked } = loadTranslator('deepseek');
    WebpageTranslator.enable({ provider: 'deepseek', apiKey: 'k' });
    WebpageTranslator.updateSettings({ provider: 'openai', apiKey: 'k2', enabled: true });
    eq(starts(tracked).length, 2, '换引擎重开会话，应当再记一条');
    eq(starts(tracked)[1].props.engine, 'openai');
  });

  test('kind 枚举在注册表里 —— 页面这一条不会因为值非法被丢', () => {
    ok(cfg.EVENTS.translate_start.kind.indexOf('page') >= 0);
    ok(cfg.EVENTS.translate_start.engine === 'id');
  });
});
