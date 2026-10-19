// test/settings-model-defaults.test.js — ensureDefaults 对 learnEnabled 的缺键/显式值纪律（#125）。
'use strict';
const { describe, test, eq, loadSrc } = require('./harness');

function loadModel(initial) {
  const store = Object.assign({}, initial || {});
  const dual = (fn) => (arg, cb) => {
    const v = fn(arg);
    if (cb) { cb(v); return undefined; }
    return Promise.resolve(v);
  };
  const chrome = {
    storage: {
      local: {
        get: dual((keys) => {
          const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
          const out = {};
          for (const k of list) {
            if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
          }
          return out;
        }),
        set: dual((obj) => { Object.assign(store, obj || {}); }),
      },
    },
  };
  const ctx = loadSrc('src/app/settings-model.js', 'SettingsModel', {
    chrome,
    MT_PALETTE: {},
    MT_PROVIDERS: [{ id: 'google', needsKey: false }],
    MT_I18N_MESSAGES: { en: {}, 'zh-CN': {} },
  });
  return { M: ctx.SettingsModel, store };
}

describe('settings-model ensureDefaults — learnEnabled（#125）', () => {
  test('缺键 → 写入 true', async () => {
    const { M, store } = loadModel({});
    await M.ensureDefaults();
    eq(store.learnEnabled, true);
  });

  test('显式 false → 保持 false', async () => {
    const { M, store } = loadModel({ learnEnabled: false });
    await M.ensureDefaults();
    eq(store.learnEnabled, false);
  });

  test('显式 true → 保持 true', async () => {
    const { M, store } = loadModel({ learnEnabled: true });
    await M.ensureDefaults();
    eq(store.learnEnabled, true);
  });

  test('模拟重启：重新 load + ensureDefaults，false 仍 false', async () => {
    const first = loadModel({ learnEnabled: false });
    await first.M.ensureDefaults();
    eq(first.store.learnEnabled, false);
    const second = loadModel(first.store);
    await second.M.ensureDefaults();
    eq(second.store.learnEnabled, false);
  });

  test('模拟重启：缺键首启仍为 true', async () => {
    const first = loadModel({});
    await first.M.ensureDefaults();
    eq(first.store.learnEnabled, true);
    const second = loadModel(first.store);
    await second.M.ensureDefaults();
    eq(second.store.learnEnabled, true);
  });
});
