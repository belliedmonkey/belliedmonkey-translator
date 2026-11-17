// test/bel290-settings-open.test.js — BEL-290：settings_open 的两个宿主。
//
// options：boot 一条 {surface:'ext_settings'}（源码接线 + 一次语义）。
// App：shell-model 的 openSettings 是唯一漏斗；surface 按 anchor 推导，且只在
// #app-settings hidden → visible 那一刻发。纯函数直接测三个 anchor 家族；once 语义
// 用真实 bootShell + 一个只记录 track 的 MTTelemetry 走 #gear 的点击。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');
const { bootApp } = require('./lib/app-boot');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('BEL-290 · App settingsSurfaceFor：三个 anchor 家族', () => {
  // 纯函数从真实 shell-model 导出，不另抄一份映射。
  const { shell } = bootApp();
  const f = shell.settingsSurfaceFor;
  test('无 anchor → app_home', () => {
    for (const a of [undefined, null, '']) eq(f(a), 'app_home', String(a));
  });
  test('首启三个深链落点 → app_onboard', () => {
    for (const a of ['sec-engines', 'set-pack-manage', 'sec-account']) eq(f(a), 'app_onboard', a);
  });
  test('功能面锚点 → app_feature（g-quick 这类未来锚点也不落首页）', () => {
    for (const a of ['engine', 'tts-engine', 'notes-provider', 'quick-setup-card', 'g-quick', 'stt-engine']) {
      eq(f(a), 'app_feature', a);
    }
  });
});

describe('BEL-290 · App openSettings：hidden→visible 只发一次', () => {
  test('#gear 第一次打开发一条 app_home，重复调用不再发', async () => {
    const tracked = [];
    const app = bootApp({ MTTelemetry: { track: (name, props) => tracked.push({ name, props: props || {} }) } });
    app.shell.bootShell();
    // 真 AppShell 的 #app-settings 带 hidden；假 DOM 默认可见，这里按真实初值设。
    app.el('app-settings').hidden = true;
    await app.el('gear').click();
    await new Promise((r) => setTimeout(r, 0));
    const opens = tracked.filter((e) => e.name === 'settings_open');
    eq(opens.length, 1, '第一次 hidden→visible 应发一条，实际 ' + opens.length);
    deepEq(opens[0].props, { surface: 'app_home' });
    // 人已经在设置页里，再点一次不是一次「打开设置」。
    await app.el('gear').click();
    await new Promise((r) => setTimeout(r, 0));
    eq(tracked.filter((e) => e.name === 'settings_open').length, 1, 'visible→visible 不许重复计数');
    // 关掉再打开 = 新的一次；锚点决定面。
    app.el('app-settings').hidden = true;
    await app.el('app-drive-need-tts-go').click();
    await new Promise((r) => setTimeout(r, 0));
    const all = tracked.filter((e) => e.name === 'settings_open');
    eq(all.length, 2, '关掉再打开应再发一条');
    deepEq(all[1].props, { surface: 'app_feature' }, 'tts-engine 是功能面');
  });
});

describe('BEL-290 · 扩展 options：boot 一条 ext_settings', () => {
  const src = stripComments(read('src/pages/options.jsx'));
  test('boot effect 里有 track(settings_open, ext_settings)，且只发一次', () => {
    ok(/MTTelemetry\.track\('settings_open',\s*\{\s*surface:\s*'ext_settings'\s*\}\)/.test(src),
      'options boot 没有 settings_open{ext_settings}');
    ok(/settingsOpenSentRef\.current/.test(src), '没有一次性守卫 —— effect 重跑会重复发');
    ok(/\[\]\);/.test(src.slice(src.indexOf("MTTelemetry.track('settings_open'"), src.indexOf("MTTelemetry.track('settings_open'") + 220)),
      'settings_open 的 effect 必须只跑一次（空依赖）');
  });
});
