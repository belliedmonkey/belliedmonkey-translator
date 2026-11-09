// test/app-bel231-login-labels.test.js — BEL-231 · 登录按钮 13 语 + 切语言后重画。
//
// 215 验收：英文界面下 Apple / Google 两个按钮仍是「用 Apple 登录」。实际 key 是
// shell-model.js 的 sync_with_apple / sync_with_google（不是 app_apple_login —— 后者
// 在代码里不存在）。两个 key 早已在 13 个 _locales 里，但标签是命令式写的：
// 启动时按系统语言画一次，存储里的 uiLang 在 applyStoredUiLang → paintStatic 之后才
// 生效，于是英文界面停在中文。这里同时钉译文与那次重画。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt_BR', 'ru', 'th', 'zh_CN', 'zh_TW'];
const KEYS = ['sync_with_apple', 'sync_with_google'];
const FALLBACK = { sync_with_apple: '用 Apple 登录', sync_with_google: '用 Google 登录' };
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/_locales/en/messages.json'), 'utf8'));
const SHELL = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const VIEW = fs.readFileSync(path.join(ROOT, 'src/app/AppShell.jsx'), 'utf8');
const GENERATED = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'extension/content/i18n-messages.js'), 'utf8');
  const m = /window\.MT_I18N_MESSAGES = (\{[\s\S]*\});/.exec(src);
  ok(m, 'i18n-messages.js 里找不到 MT_I18N_MESSAGES');
  return JSON.parse(m[1]);
})();

function message(loc, key) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, `extension/_locales/${loc}/messages.json`), 'utf8'));
  return d[key] && d[key].message;
}

describe('BEL-231 · 登录按钮 13 语', () => {
  test('en 表：sync_with_apple / sync_with_google 存在且是英文（非中文兜底）', () => {
    eq(EN.sync_with_apple && EN.sync_with_apple.message, 'Sign in with Apple');
    eq(EN.sync_with_google && EN.sync_with_google.message, 'Sign in with Google');
    for (const k of KEYS) {
      ok(EN[k] && EN[k].message, 'en 缺 ' + k);
      ok(!/[\u4e00-\u9fff]/.test(EN[k].message), 'en 的 ' + k + ' 还是中文：' + EN[k].message);
      ok(EN[k].message !== FALLBACK[k], 'en 的 ' + k + ' 落回了代码里的中文兜底');
    }
  });

  test('13 个 locale 都有两个 key，且非中文界面不落回中文兜底', () => {
    for (const loc of LOCALES) {
      for (const k of KEYS) {
        const v = message(loc, k);
        ok(v && v.trim(), `${loc} 缺 ${k}`);
        ok(GENERATED[loc] && GENERATED[loc][k] === v,
          `${loc} 的 ${k} 与生成的 i18n-messages.js 不一致（忘了重生成？）`);
        if (loc !== 'zh_CN' && loc !== 'zh_TW') {
          ok(v !== FALLBACK[k], `${loc} 的 ${k} 还是中文兜底：${v}`);
        }
      }
    }
    eq(Object.keys(GENERATED).length, 13, '生成的表不是 13 个 locale');
  });

  test('切界面语言后重画登录按钮：paintStatic 调 paintProviderLabels，读的是实际 key', () => {
    const fn = /function paintProviderLabels\(\) \{([\s\S]*?)\n  \}/.exec(SHELL);
    ok(fn, 'shell-model.js 没有 paintProviderLabels()');
    for (const k of KEYS) ok(fn[1].includes(`t('${k}'`), 'paintProviderLabels 没读 ' + k);
    const paintStatic = /function paintStatic\(\) \{([\s\S]*?)\n  \}/.exec(SHELL);
    ok(paintStatic, '没有 paintStatic()');
    ok(/paintProviderLabels\(\);/.test(paintStatic[1]),
      'paintStatic 没重画 provider 标签 —— 存储里的 uiLang 生效后按钮会停在启动语言');
    ok(/id="btn-apple-label"/.test(VIEW) && /id="btn-google-label"/.test(VIEW),
      'AppShell 里没有两个 label 宿主');
  });
});
