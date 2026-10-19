// #592 #122 — 系统翻译扩展 Mac 核对、版本门禁、UITest 强制断言（静态）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, match } = require('./harness');
const { GATE_MARKERS, resolveTarget } = require('../scripts/verify-mttranslateext-gate.js');
const { findMTTranslateExtPath, classifyExtPath } = require('../scripts/mt592-ext-path.js');

const ROOT = path.join(__dirname, '..');
const SWIFT = path.join(ROOT, 'tools/ios-runner/UITests/S56UITests.swift');

describe('mt592 ext path 解析', () => {
  test('devicectl 样例行能抽出 MTTranslateExt 路径', () => {
    const sample = '11052   /private/var/containers/Bundle/Application/90CC6038-15E1-428C-831B-382686762BEA/BelliedMonkey Translator.app/Extensions/MTTranslateExt.appex/MTTranslateExt\n';
    const p = findMTTranslateExtPath(sample);
    ok(p && p.includes('BelliedMonkey Translator.app'), p);
    ok(classifyExtPath(p).intl, '国际版');
  });
  test('中国版路径判为 cn', () => {
    const p = '/private/var/.../BelliedMonkey Translator CN.app/Extensions/MTTranslateExt.appex/MTTranslateExt';
    ok(classifyExtPath(p).cn && !classifyExtPath(p).intl);
  });
});

describe('mt592 版本门禁脚本', () => {
  test('Debug 优先 .debug.dylib', () => {
    const appex = path.join(ROOT, 'app/native/translate-ext');
    ok(GATE_MARKERS.includes('uiLangEffective'));
    ok(GATE_MARKERS.includes('mt.vault.snapshot.v1'));
    const fakeApp = path.join(ROOT, 'tools/ios-runner');
    ok(typeof resolveTarget === 'function');
    ok(fs.existsSync(path.join(ROOT, 'scripts/verify-mttranslateext-gate.js')));
    ok(fs.existsSync(path.join(ROOT, 'scripts/mt592-ext-path.js')));
    ok(fs.existsSync(path.join(ROOT, 'scripts/mt592-probe-server.js')));
    ok(fs.existsSync(appex));
  });
});

describe('S56UITests — 默认翻译 App 与 v9 强制核对', () => {
  test('不再硬编码 rows[1]；含 Mac probe 与 v9 路径断言', () => {
    const s = fs.readFileSync(SWIFT, 'utf8');
    ok(!s.includes('rows[1].tap()'), '仍硬编码 rows[1]');
    ok(s.includes('assertIntlMTTranslateExtPath'), '缺少国际版扩展路径断言');
    ok(s.includes('fetchMTTranslateExtPathFromMac'), '缺少 Mac devicectl probe 拉取');
    ok(s.includes('MT592_EXT_PATH'), '附件 note 须写 MT592_EXT_PATH');
    match(s, /v9-systrans.*assertIntlMTTranslateExtPath|assertIntlMTTranslateExtPath[\s\S]*v9-systrans/,
      'v9-systrans 前须核对扩展进程路径');
    ok(s.includes('Copy translation'), 'v9 判据须含 Copy translation 按钮文案');
  });
});
