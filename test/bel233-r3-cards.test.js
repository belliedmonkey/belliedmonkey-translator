// test/bel233-r3-cards.test.js — BEL-233 r3 · 两张卡互斥 / 改用免费额度 / CTA 居中。
//
// 与 bel233-quota-byo-nav.test.js 同一套办法：把真实的 `grantAction` / `switchToFree`
// 函数体按大括号配平截出来，塞进 `new Function`，只注入它们真正用到的闭包。断言的是
// 点击后**真的调了什么**，不是源码里有没有某行字。浏览器里的 DOM 终态（额度态没有
// #quick-setup-card、key 态没有额度卡、390 下文字中心偏差）由
// test/bel233-centering-headless.js 负责量。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const VIEW_NO_COMMENTS = VIEW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function functionSource(src, signature) {
  const at = src.indexOf(signature);
  ok(at > -1, 'settings-view.jsx 里找不到 ' + signature);
  const open = src.indexOf('{', at + signature.length - 1);
  ok(open > -1, signature + ' 没有函数体');
  let depth = 0; let q = '';
  for (let j = open; j < src.length; j += 1) {
    const c = src[j];
    if (q) {
      if (c === '\\') { j += 1; continue; }
      if (c === q) q = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); continue; }
    if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j + 2) + 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(at, j + 1);
    }
  }
  throw new Error(signature + ' 的大括号配不平');
}

const GRANT_ACTION = functionSource(VIEW, 'async function grantAction(id, session)');
const SWITCH_TO_FREE = functionSource(VIEW, 'async function switchToFree(session)');

// grantAction 的 restore 分支：claimAndApply / paintGrant / paintNow / grantBusy 都从组件
// 闭包里来，这里用同形的桩；claimAndApply 由每个用例自己决定成功还是抛。
function makeRestoreHarness({ claimError = null } = {}) {
  const calls = { claim: [], paint: 0, paintNow: 0, say: [], confirm: [] };
  const hooks = { say: (m) => calls.say.push(String(m)) };
  const settingsModel = {
    hooks: () => hooks,
    claimAndApply: async (opts) => {
      calls.claim.push(opts);
      if (claimError) throw claimError;
      return { wroteAny: true, plan: {} };
    },
  };
  const LearnDialog = { confirm: async (msg, opts) => { calls.confirm.push({ msg, opts }); return true; } };
  const t = (key, fallback) => fallback;
  const grantBusy = { current: false };
  const grantUnavailable = { current: false };
  const paintGrant = async () => { calls.paint += 1; };
  const paintNow = async () => { calls.paintNow += 1; };
  const grantAction = new Function(
    'settingsModel', 'LearnDialog', 't', 'grantBusy', 'grantUnavailable', 'paintGrant', 'paintNow',
    GRANT_ACTION + '\nreturn grantAction;'
  )(settingsModel, LearnDialog, t, grantBusy, grantUnavailable, paintGrant, paintNow);
  return { calls, grantAction, grantBusy };
}

const makeSwitchToFree = (grantAction, settingsModel, LearnGrant, setKeyMode) => new Function(
  'grantAction', 'settingsModel', 'LearnGrant', 'setKeyMode',
  SWITCH_TO_FREE + '\nreturn switchToFree;'
)(grantAction, settingsModel, LearnGrant, setKeyMode);

describe('BEL-233 r3 · 两张卡互斥（chat 槽判据）', () => {
  test('★ 判据是 LearnGrant.activeIn(cur, \'chat\')，不是任一路 active(cur)', () => {
    ok(/LearnGrant\.activeIn\(cur,\s*'chat'\)/.test(VIEW_NO_COMMENTS),
      'grantActive 没有按 chat 槽判定');
    ok(!/LearnGrant\.active\(cur\)/.test(VIEW_NO_COMMENTS),
      'settings-view 还在用「任一路在用额度」的旧判据');
  });

  test('★ 额度卡 / 一键卡是条件渲染（不是 hidden）：额度态不出 quick，key 态不出 quota', () => {
    // 引擎子页顶：同一位置二选一。
    ok(/\{grantActive && !keyMode && page === 'sec-engines' \? renderQuotaCard\(false\) : null\}/.test(VIEW_NO_COMMENTS),
      '引擎子页的额度卡没有按 grantActive 条件渲染');
    const quick = /\{!grantActive \|\| keyMode \? \(\s*<section className="quick-only" id="quick-setup-card" hidden=\{detail \|\| !quickAvail\}>/.exec(VIEW_NO_COMMENTS);
    ok(quick, '一键卡没有按 grantActive / keyMode 条件渲染');
    ok(!/id="quick-setup-card"[^>]*hidden=\{detail \|\| !quickAvail \|\| grantActive\}/.test(VIEW_NO_COMMENTS),
      '一键卡还留着「额度在用只 hidden」的旧写法');
    // 主屏那颗额度卡同样条件渲染；key 态下整个 #settings-quota 不在 DOM。
    ok(/\{grantActive && !keyMode && page === 'home' \? renderQuotaCard\(true\) : null\}/.test(VIEW_NO_COMMENTS),
      '主屏额度卡没有按 grantActive 条件渲染');
    // 分项档三组与卡片无关，两态都在。
    ok(/renderGroup\('speech'\)/.test(VIEW_NO_COMMENTS)
      && /id="g-notes"/.test(VIEW_NO_COMMENTS)
      && /id="g-stt"/.test(VIEW_NO_COMMENTS)
      && /id="g-tts"/.test(VIEW_NO_COMMENTS),
    '分项档的三组（翻译 / 朗读 / 转写）被卡片状态带走了');
  });

  test('★ 额度卡「用自己的 key」切到 key 态：keyMode 先置位，取消再撤回', () => {
    const byo = VIEW_NO_COMMENTS.slice(VIEW_NO_COMMENTS.indexOf('data-quota-link="byo"'),
      VIEW_NO_COMMENTS.indexOf('data-quota-link="community"'));
    ok(/setKeyMode\(true\)/.test(byo), '点「用自己的 key」没有切到 key 态');
    ok(/const moved = await grantAction\('byo'/.test(byo), '没有走 grantAction(byo)');
    ok(/if \(!moved\) setKeyMode\(false\)/.test(byo), '分项档取消后没有撤回 key 态');
  });
});

describe('BEL-233 r3 · 一键卡底「改用免费额度」', () => {
  test('★ 按钮在一键卡内，文案走共享表，点击走 switchToFree', () => {
    const card = VIEW_NO_COMMENTS.slice(VIEW_NO_COMMENTS.indexOf('id="quick-setup-card"'),
      VIEW_NO_COMMENTS.indexOf('{/* 「从哪来」'));
    ok(/id="quick-switch-free"/.test(card), '一键卡底没有「改用免费额度」按钮');
    ok(/t\('grant_switch_free', '改用免费额度'\)/.test(card), '按钮文案没有走共享 i18n key');
    ok(/onClick=\{\(\) => switchToFree\(settingsModel\.currentSession\(\)\)\}/.test(card),
      '按钮没有接 switchToFree');
  });

  test('★ restore 走 claimAndApply({overwrite:true})，成功后重画；失败 say 明确错误', async () => {
    const okH = makeRestoreHarness();
    await okH.grantAction('restore', { user: { id: 'u' } });
    eq(okH.calls.claim.length, 1, 'claimAndApply 没有恰好调用一次');
    eq(okH.calls.claim[0].overwrite, true, 'restore 没有 overwrite:true');
    eq(typeof okH.calls.claim[0].say, 'function', '没有把 say 交给 claimAndApply');
    eq(okH.calls.paint, 2, 'restore 前后没有各重画一次额度卡');
    eq(okH.calls.paintNow, 1, 'restore 成功后没有重画整页');
    eq(okH.grantBusy.current, false, 'restore 结束后 grantBusy 没复位');
    deepEq(okH.calls.confirm.map((x) => x.msg), ['改回免费额度会替换掉你现在填的 key。要继续吗？'],
      'restore 的确认框文案不对');

    const bad = makeRestoreHarness({ claimError: new Error('network down') });
    await bad.grantAction('restore', { user: { id: 'u' } });
    deepEq(bad.calls.say, ['network down'], '失败没有交给 hooks.say 明确错误');
    eq(bad.calls.paintNow, 1, '失败后没有重画（卡会停在 busy）');
  });

  test('★ switchToFree：成功后 chat 槽回到额度 → 清 keyMode（一键卡消失、额度卡回来）', async () => {
    const calls = { grant: [], keyMode: [] };
    const grantAction = async (id, session) => { calls.grant.push(id); return true; };
    const settingsModel = {
      get: async () => ({ apiKey: 'bmg_test12345678', grantTail: '12345678' }), // gitleaks:allow — test fixture, no backend
    };
    const LearnGrant = { activeIn: (cur, slot) => slot === 'chat' && /12345678$/.test(cur.apiKey) };
    const switchToFree = makeSwitchToFree(grantAction, settingsModel, LearnGrant, (v) => calls.keyMode.push(v));
    await switchToFree({ user: { id: 'u' } });
    deepEq(calls.grant, ['restore'], 'switchToFree 没有走 restore');
    deepEq(calls.keyMode, [false], '成功后没有清掉 keyMode');
  });
});

describe('BEL-233 r3 · 「一键配好」文字居中（CSS + headless）', () => {
  test('★ #qs-apply 用 flex / text-align / 对称 padding 居中，不写死像素宽度', () => {
    const m = /#app-settings #qs-apply\s*\{([^}]*)\}/.exec(CSS);
    ok(m, '没有 #app-settings #qs-apply 规则');
    const r = m[1];
    ok(/display\s*:\s*flex/.test(r), '按钮不是 flex 容器：' + r);
    ok(/justify-content\s*:\s*center/.test(r), '按钮没有 justify-content:center：' + r);
    ok(/align-items\s*:\s*center/.test(r), '按钮没有 align-items:center：' + r);
    ok(/text-align\s*:\s*center/.test(r), '按钮没有 text-align:center：' + r);
    ok(/padding\s*:\s*12px\s+18px/.test(r), '左右 padding 不对称：' + r);
    ok(/width\s*:\s*100%/.test(r), '按钮没有吃满卡片内容宽：' + r);
    ok(!/width\s*:\s*\d+px/.test(r), '按钮写死了像素宽度：' + r);
  });
});

describe('BEL-233 r3 · 13 语共享表', () => {
  test('★ grant_switch_free 在 13 个 locale 与生成表里都存在', () => {
    const locales = fs.readdirSync(path.join(ROOT, 'extension/_locales'))
      .filter((d) => fs.existsSync(path.join(ROOT, 'extension/_locales', d, 'messages.json')));
    eq(locales.length, 13, 'locale 不是 13 个：' + locales.join(', '));
    for (const loc of locales) {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/_locales', loc, 'messages.json'), 'utf8'));
      ok(raw.grant_switch_free && typeof raw.grant_switch_free.message === 'string',
        loc + ' 缺 grant_switch_free');
    }
    const gen = fs.readFileSync(path.join(ROOT, 'extension/content/i18n-messages.js'), 'utf8');
    const table = JSON.parse(gen.slice(gen.indexOf('{'), gen.lastIndexOf('};') + 1));
    for (const loc of locales) {
      ok(table[loc] && table[loc].grant_switch_free, loc + ' 的生成表里缺 grant_switch_free');
    }
    eq(table.zh_CN.grant_switch_free, '改用免费额度', '中文文案不是「改用免费额度」');
  });
});
