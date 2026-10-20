// test/learn-enabled-read-fail.test.js — D11: schema 默认 false；读失败时 options / popup / content 一致 OFF。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');

function loadSchema() {
  return loadSrc('src/store/schema.js', 'SETTINGS_SCHEMA', {
    MT_PALETTE: { textColor: '#56633f', ytTextColor: '#ccdbb2' },
  }).SETTINGS_SCHEMA;
}

/** 与 store/hooks.js useSettings 对单键的有效值一致 */
function effectiveFromStoreValues(values, schema, key) {
  const v = values[key];
  return v === undefined ? schema.defaultFor(key) : v;
}

/** options.jsx / popup.jsx：checkbox / 门禁只看 === true */
function pageLearnUiOn(values, schema) {
  return effectiveFromStoreValues(values, schema, 'learnEnabled') === true;
}

/** content-main.js cfg：读存储后的布尔，不回落 schema */
function contentLearnOn(settings) {
  return settings.learnEnabled === true;
}

function bootStore({ readFail = null } = {}) {
  const store = {};
  const ps = {
    read: async (keys) => (readFail
      ? { ok: false, error: readFail }
      : { ok: true, data: Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])) }),
    write: async () => ({ ok: true }),
  };
  const ctx = loadSrc('src/store/settings-store.js', 'SettingsStore', {
    PageSettings: ps,
    chrome: { storage: { onChanged: { addListener: () => {} } } },
  });
  return { S: ctx.SettingsStore, schema: loadSchema() };
}

describe('D11 — learnEnabled schema 默认 false（补写只在 background onInstalled）', () => {
  test('SETTINGS_SCHEMA.defaultFor(learnEnabled) === false', () => {
    eq(loadSchema().defaultFor('learnEnabled'), false);
  });
});

describe('D11 — 设置读取失败时三端一致 OFF', () => {
  test('options / popup（SettingsStore + === true 门禁）', async () => {
    const { S, schema } = bootStore({ readFail: 'storage read failed' });
    await S.init(['learnEnabled']);
    const values = S.getSnapshot().values;
    eq(S.getSnapshot().status, 'error');
    eq(pageLearnUiOn(values, schema), false, 'options #learn-enabled 应为未勾选');
    eq(pageLearnUiOn(values, schema), false, 'popup 采集相关门禁应为关');
    eq(S.get('learnEnabled'), false, 'store.get 回落 schema false，不是 true');
  });

  test('content-main：超时/空读 ⇒ settings 无键 ⇒ cfg.learnEnabled 为 false', () => {
    const settings = {}; // RequestShape.storageGet 超时与读失败同形
    eq(contentLearnOn(settings), false);
    okContentMainUsesStrictTrue();
  });

  test('读失败 + 缺键：页面侧 false，content 侧 false（一致 OFF）', async () => {
    const { S, schema } = bootStore({ readFail: 'db locked' });
    await S.init(schema.keysFor('popup'));
    const values = S.getSnapshot().values;
    eq(pageLearnUiOn(values, schema), false);
    eq(contentLearnOn({}), false);
  });
});

function okContentMainUsesStrictTrue() {
  const src = fs.readFileSync(path.join(ROOT, 'extension/content/content-main.js'), 'utf8');
  if (!/learnEnabled:\s*settings\.learnEnabled\s*===\s*true/.test(src)) {
    throw new Error('content-main.js 应使用 settings.learnEnabled === true');
  }
}
