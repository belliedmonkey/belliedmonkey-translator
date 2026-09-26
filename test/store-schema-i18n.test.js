// test/store-schema-i18n.test.js — schema / registry / i18n 的单元回归（PR2）。
//
// schema 的核心门：六份手抄键清单（popup/options/review/docs/listen/quick，外加
// handoff 的内联读取）逐键 ⊆ schema.keysFor(面)。清单源文件里解析 —— 哪个 PR 删掉
// 清单（popup 是 PR3），哪个 PR 就必须同步改这里；解析不到 = 清单改名或被删，照样红。
// 这就是「八份手抄清单被 schema 收编」的证伪点：页面读的键 schema 不认账，立刻红。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');

// 从源文件解析一个 `const NAME = [ 'k1', 'k2', ... ]` 字面量（含行内注释）。
function parseKeyList(relFile, varName) {
  const src = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
  const m = src.match(new RegExp(varName + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
  ok(m, `${relFile} 里解析不到 ${varName} —— 清单被改名或删除：同 PR 更新本测试`);
  return [...m[1].matchAll(/'([a-zA-Z0-9:]+)'/g)].map((x) => x[1]);
}

describe('registry', () => {
  test('getter 读 window 全局；缺席时空回落不炸', () => {
    const ctx = loadSrc('src/lib/registry.js', 'Registry', {
      MT_PROVIDERS: [{ id: 'x' }],
      MT_PALETTE: { textColor: '#56633f', ytTextColor: '#ccdbb2' },
      MT_VERSION: '9.9.9',
    });
    deepEq(ctx.Registry.providers(), [{ id: 'x' }]);
    eq(ctx.Registry.palette().textColor, '#56633f');
    eq(ctx.Registry.version(), '9.9.9');
    const bare = loadSrc('src/lib/registry.js', 'Registry', {});
    deepEq(bare.Registry.providers(), [], '注册表缺席 → []，调用方回落');
    deepEq(bare.Registry.messages(), {});
    eq(bare.Registry.version(), '');
  });
});

describe('SETTINGS_SCHEMA', () => {
  function bootSchema(palette) {
    const ctx = loadSrc('src/store/schema.js', 'SETTINGS_SCHEMA', { MT_PALETTE: palette || {} });
    return ctx.SETTINGS_SCHEMA;
  }

  test('规模下限：55 键一个不少（防整组被误删）', () => {
    const S = bootSchema({});
    ok(S.KEYS.length >= 55, `键数 ${S.KEYS.length} 低于 55 —— schema 被动过了？`);
  });

  test('每键 surfaces+default 齐备（构造时断言，加载即验证）', () => {
    const S = bootSchema({});
    for (const k of S.KEYS) {
      ok(Array.isArray(S.spec[k].surfaces) && S.spec[k].surfaces.length > 0, k + '.surfaces');
      ok('default' in S.spec[k], k + '.default');
    }
  });

  test('品牌色默认走 palette 注册表（one-registry），不直写 hex', () => {
    const S = bootSchema({ textColor: '#56633f', ytTextColor: '#ccdbb2' });
    eq(S.defaultFor('textColor'), '#56633f');
    eq(S.defaultFor('ytTextColor'), '#ccdbb2');
    // 注册表缺席时 getter 给 undefined —— 消费方的 || 回落照旧工作
    const bare = bootSchema(undefined);
    eq(bare.defaultFor('textColor'), undefined);
  });

  test('defaultFor 未知键 undefined；keysFor 未知面空表', () => {
    const S = bootSchema({});
    eq(S.defaultFor('noSuchKey'), undefined);
    deepEq(S.keysFor('no-such-surface'), []);
  });

  // ── 手抄清单 ⊆ schema 的对账门（本文件存在的理由）───────────────────────
  const HAND_LISTS = [
    ['extension/popup/popup.js', 'POPUP_KEYS', 'popup'],
    ['extension/options/options.js', 'SETTINGS_KEYS', 'options'],
    ['extension/learn/review.js', 'READ_KEYS', 'review'],
    ['extension/learn/docs-page.js', 'KEYS', 'docs'],
    ['app/listen.js', 'READ_KEYS', 'listen'],
    ['app/quick.js', 'READ_KEYS', 'quick'],
  ];
  for (const [file, varName, surface] of HAND_LISTS) {
    test(`${file} ${varName} ⊆ keysFor('${surface}')`, () => {
      const S = bootSchema({});
      const keys = parseKeyList(file, varName);
      const allowed = new Set(S.keysFor(surface));
      const missing = keys.filter((k) => !allowed.has(k));
      deepEq(missing, [], `${surface} 面的 schema surfaces 漏了这些键 —— 补 schema，别抄清单`);
    });
  }

  test('handoff.js 的内联读取 ⊆ keysFor(\'handoff\')', () => {
    const S = bootSchema({});
    const src = fs.readFileSync(path.join(ROOT, 'app/handoff.js'), 'utf8');
    const m = src.match(/storage\.local\.get\(\[([^\]]*)\]/);
    ok(m, 'handoff.js 里解析不到 storage.local.get([...])');
    const keys = [...m[1].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1]);
    const allowed = new Set(S.keysFor('handoff'));
    deepEq(keys.filter((k) => !allowed.has(k)), []);
  });

  test('quick-settings.js 的多次读取 ⊆ keysFor(\'quick\')', () => {
    const S = bootSchema({});
    const src = fs.readFileSync(path.join(ROOT, 'app/quick-settings.js'), 'utf8');
    const keys = new Set();
    for (const m of src.matchAll(/\bget\(\[([^\]]*)\]\)/g)) {
      for (const k of m[1].matchAll(/'([a-zA-Z]+)'/g)) keys.add(k[1]);
    }
    ok(keys.size > 0, 'quick-settings.js 里一个键都没解析到 —— 模式变了？');
    const allowed = new Set(S.keysFor('quick'));
    deepEq([...keys].filter((k) => !allowed.has(k)), []);
  });
});

describe('i18n (PageText)', () => {
  const TABLE = {
    zh_CN: { hello: '你好', popup_need_setup: '还没配好翻译引擎' },
    zh_TW: { hello: '你好' },
    en: { hello: 'hello' },
    pt: { hello: 'olá' },
  };

  function bootPageText({ chrome } = {}) {
    const sandbox = { MT_I18N_MESSAGES: TABLE };
    if (chrome) sandbox.chrome = chrome;
    const ctx = loadSrc('src/lib/i18n.js', 'PageText', sandbox);
    return ctx.PageText;
  }

  test('normalizeLocale：全码、base、zh 归并、未知空串', () => {
    const P = bootPageText();
    eq(P.normalizeLocale('zh-TW'), 'zh_TW', '表里有 zh_TW → 全码直取');
    eq(P.normalizeLocale('zh-Hans'), 'zh_CN', 'zh 基码归并到表里的第一个 zh 变体');
    eq(P.normalizeLocale('en-US'), 'en');
    eq(P.normalizeLocale('pt-BR'), 'pt');
    eq(P.normalizeLocale('xx-XX'), '');
    eq(P.normalizeLocale(''), '');
    eq(P.normalizeLocale(null), '');
    // 没有任何 zh 变体的表：zh 系归并无处落 → 空串，交给上层兜底
    const noZh = loadSrc('src/lib/i18n.js', 'PageText', { MT_I18N_MESSAGES: { en: {} } });
    eq(noZh.PageText.normalizeLocale('zh-TW'), '');
  });

  test('无 chrome 时有效语言回落 zh_CN，t() 走表', () => {
    const P = bootPageText();
    eq(P.effectiveLocale(), 'zh_CN');
    eq(P.t('hello'), '你好');
    eq(P.t('missing_key', '兜底文案'), '兜底文案', '缺键不空 UI —— 一律带中文兜底');
  });

  test('有 chrome 时 effectiveLocale 跟浏览器语言；表缺键落到 chrome.i18n', () => {
    const P = bootPageText({
      chrome: { i18n: { getUILanguage: () => 'en-US', getMessage: (k) => (k === 'chrome_only' ? 'from chrome' : '') } },
    });
    eq(P.effectiveLocale(), 'en');
    eq(P.t('hello'), 'hello');
    eq(P.t('chrome_only', 'fb'), 'from chrome', '表里没有的键回落 chrome.i18n');
    eq(P.t('nope_nowhere', 'fb'), 'fb');
  });

  test('setUiLang 即时换语言；同值 no-op；订阅可退', () => {
    const P = bootPageText();
    const seen = [];
    const off = P.subscribe((v) => seen.push(v));
    P.setUiLang('pt-BR');
    eq(P.getUiLang(), 'pt-BR');
    eq(P.effectiveLocale(), 'pt');
    eq(P.t('hello'), 'olá');
    deepEq(seen, ['pt-BR']);
    P.setUiLang('pt-BR');
    eq(seen.length, 1, '同值 no-op');
    off();
    P.setUiLang('ja');
    eq(seen.length, 1, '退订后不再通知');
  });
});

describe('hooks（冒烟：导出面齐全；渲染走真浏览器门）', () => {
  test('useSetting/useSettings/useView/useUiLang 都是函数', () => {
    const ctx = loadSrc('src/store/hooks.js', 'MTHooks', {
      chrome: { storage: { onChanged: { addListener: () => {} } } },
    });
    for (const k of ['useSetting', 'useSettings', 'useView', 'useUiLang']) {
      eq(typeof ctx.MTHooks[k], 'function', k);
    }
  });
});
