// test/firstrun-exit-592-66.test.js — #592 指令 #66：首启包屏完成按钮进首页、不自动开听译。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sm = stripComments(read('src/app/shell-model.js'));

describe('#66 · 包屏 done 点「开始使用」→ 首页，不开听译，写 OB_SEEN', () => {
  test('onPacksGo：done 阶段走 enterListen', () => {
    const fn = sm.slice(sm.indexOf('async function onPacksGo'), sm.indexOf('async function onCellWait'));
    ok(/packPhase === 'done'[\s\S]{0,80}enterListen\(\)/.test(fn), 'done 时没调 enterListen');
  });

  test('enterListen：藏包屏、signed-in、firstRunScreen=home、写 OB_SEEN、不调 AppListen.open', () => {
    const fn = sm.slice(sm.indexOf('async function enterListen'), sm.indexOf('async function show'));
    ok(fn.length > 100, '切不出 enterListen');
    ok(/firstrun-packs[\s\S]{0,120}\.hidden = true/.test(fn), '包屏没藏');
    ok(/\$\('signed-out'\)\.hidden = true/.test(fn) && /\$\('signed-in'\)\.hidden = false/.test(fn),
      'signed-in 没露出来');
    ok(/firstRunScreen = 'home'/.test(fn), 'firstRunScreen 不是 home');
    ok(/chrome\.storage\.local\.set\(\{ \[OB_SEEN\]: 1 \}/.test(fn), '没写 OB_SEEN');
    ok(!/AppListen\.open/.test(fn), 'enterListen 还在自动打开听译页');
  });

  test('完成按钮文案走 firstrun_packs_enter，中文兜底是「开始使用」', () => {
    ok(/t\('firstrun_packs_enter',\s*'开始使用'\)/.test(sm), 'paintPackChrome 兜底文案不对');
    const zh = JSON.parse(read('extension/_locales/zh_CN/messages.json'));
    eq(zh.firstrun_packs_enter.message, '开始使用', 'zh_CN firstrun_packs_enter');
    const localesDir = path.join(ROOT, 'extension/_locales');
    const miss = [];
    for (const loc of fs.readdirSync(localesDir)) {
      const f = path.join(localesDir, loc, 'messages.json');
      if (!fs.existsSync(f)) continue;
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!j.firstrun_packs_enter || !String(j.firstrun_packs_enter.message || '').trim()) {
        miss.push(loc);
      }
    }
    ok(!miss.length, '这些 locale 缺 firstrun_packs_enter：' + miss.join(', '));
  });
});

describe('#66 · 冷启动 packsDone 不回包屏', () => {
  const { loadSrc } = require('./harness');
  const FR = loadSrc('src/app/firstrun.js', 'FirstRun').FirstRun;
  const all = { loggedIn: true, engine: true, asrPack: true, ttsPack: true, basePack: true };

  test('packsDone 且探针一时缺包 ⇒ step 仍是 home', () => {
    eq(FR.step({ ...all, asrPack: false, packsDone: true }), 'home');
    eq(FR.step({ ...all, asrPack: false, ttsPack: false, basePack: false, packsDone: true }), 'home');
  });

  test('paintFirstRun 读 packsDone 标记', () => {
    const paint = sm.slice(sm.indexOf('async function paintFirstRun'), sm.indexOf('async function loadPackSelection'));
    ok(/readPacksDone\(\)/.test(paint), 'paintFirstRun 没读 packsDone');
    ok(/packsDone: done/.test(paint), 'step 输入没带 packsDone');
  });
});
