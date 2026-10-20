// test/ext-learn-backfill.test.js — DEV-32 / EXT-LEARN-BACKFILL 矩阵与弹窗横幅门禁。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok } = require('./harness');
const { makeChrome } = require('./stubs');
const { loadModule } = require('./harness');

const ROOT = path.join(__dirname, '..');

function loadBackground(store = {}, opts = {}) {
  const chrome = makeChrome({ store });
  if (opts.readUndefined) {
    const orig = chrome.storage.local.get;
    chrome.storage.local.get = (keys, cb) => { if (cb) cb(undefined); return Promise.resolve(undefined); };
    chrome.storage.local.get._orig = orig;
  }
  const installed = [];
  chrome.runtime.onInstalled = { addListener: (fn) => installed.push(fn) };
  chrome.runtime.onMessage = { addListener: () => {} };
  chrome.action = { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} };
  loadModule('./background.js', { chrome });
  return { fire: (details) => installed[0](details), store: chrome._store };
}

const OLD_USER = {
  enabled: true, targetLang: 'zh-CN', uiLang: 'auto', provider: 'google',
  apiKey: '', apiBaseUrl: '', fontSize: '1.0', showFab: true, bilingualMode: 'below',
  textColor: '#56633f',
};

describe('EXT-LEARN-BACKFILL — onInstalled 矩阵', () => {
  test('install · 缺键 → learnEnabled true，无 learnAutoOnNotice', () => {
    const { fire, store } = loadBackground({});
    fire({ reason: 'install' });
    eq(store.learnEnabled, true);
    eq(store.learnAutoOnNotice, undefined);
  });

  test('install · 显式 false → 保持 false', () => {
    const { fire, store } = loadBackground({ learnEnabled: false });
    fire({ reason: 'install' });
    eq(store.learnEnabled, false);
  });

  test('install · 显式 true → 保持 true，无横幅标记', () => {
    const { fire, store } = loadBackground({ learnEnabled: true });
    fire({ reason: 'install' });
    eq(store.learnEnabled, true);
    eq(store.learnAutoOnNotice, undefined);
  });

  test('update · 缺键 → learnEnabled true + learnAutoOnNotice true', () => {
    const { fire, store } = loadBackground({ ...OLD_USER });
    fire({ reason: 'update' });
    eq(store.learnEnabled, true);
    eq(store.learnAutoOnNotice, true);
  });

  test('update · 显式 false → 保持关，无标记', () => {
    const { fire, store } = loadBackground({ ...OLD_USER, learnEnabled: false });
    fire({ reason: 'update' });
    eq(store.learnEnabled, false);
    eq(store.learnAutoOnNotice, undefined);
  });

  test('update · 显式 true → 不动，无横幅标记', () => {
    const { fire, store } = loadBackground({ ...OLD_USER, learnEnabled: true });
    fire({ reason: 'update' });
    eq(store.learnEnabled, true);
    eq(store.learnAutoOnNotice, undefined);
  });

  test('读取失败（Safari undefined）→ 不写 learnEnabled 也不写标记', () => {
    const { fire, store } = loadBackground({ ...OLD_USER }, { readUndefined: true });
    fire({ reason: 'update' });
    eq(store.learnEnabled, undefined);
    eq(store.learnAutoOnNotice, undefined);
  });
});

describe('EXT-LEARN-BACKFILL — ExtVault / 弹窗门禁', () => {
  test('补写后 ExtVault 同形解码为 true（与 ExtVault.swift / #125 一致）', () => {
    const { fire, store } = loadBackground({ ...OLD_USER });
    fire({ reason: 'update' });
    const parseLearnEnabled = (obj) => ((obj.learnEnabled != null && typeof obj.learnEnabled === 'boolean')
      ? obj.learnEnabled : true);
    eq(parseLearnEnabled(store), true);
  });

  test('popup 含升级横幅 DOM 与 #learn 设置入口', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/pages/popup.jsx'), 'utf8');
    ok(src.includes('id="learn-auto-notice"'));
    ok(src.includes("options/options.html') + '#learn'"));
    ok(src.includes('notice_learn_auto_on'));
    ok(src.includes('clearLearnAutoNotice'));
  });
});
