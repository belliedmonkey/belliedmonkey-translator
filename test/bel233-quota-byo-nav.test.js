// test/bel233-quota-byo-nav.test.js — BEL-233 · 额度卡「用自己的 key」必须页内导航。
//
// 缺陷：`grantAction('byo')` 取注册表第一个带 keyUrl 的提供商（OpenAI），点一下就
// `openExternal(platform.openai.com)`，把用户踢出 App。产品令：App only 改成页内导航，
// 与 #app-adv-hint-go 一致（分项档先确认、取消原地不动），不再外跳。
//
// 这里不用 jsdom：把真实的 `grantAction` 函数体从 settings-view.jsx 里按大括号配平
// 截出来，塞进 `new Function`，只注入它执行 byo 分支要用的闭包（settingsModel /
// LearnDialog / detailRef / setDetailFn / setPage / requestAnimationFrame / $）。
// 截的是真源码，所以断言的是点击后**真的调了什么**，不是源码里有没有某行字。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8');

// 从 `async function grantAction(id, session) {` 起按大括号配平截出完整函数。
// 跳过字符串与注释里的括号 —— 截歪了下面的 `new Function` 会直接抛，不是假绿。
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

// 只注入 byo 分支需要的闭包；claim/restore 分支里的 paintGrant 等标识符不会被执行，
// JS 允许它们悬空（真源码里它们来自组件闭包）。
const makeGrantAction = new Function(
  'settingsModel', 'Registry', 'LearnDialog', 't', 'detailRef',
  'setDetailFn', 'setPage', 'requestAnimationFrame', '$',
  GRANT_ACTION + '\nreturn grantAction;'
);

function makeHarness({ detail = false, confirmResult = true } = {}) {
  const calls = { openExternal: [], setPage: [], scroll: [], setDetailFn: [], confirm: [], t: [], raf: 0, order: [] };
  const hooks = { openExternal: (url) => { calls.openExternal.push(url); calls.order.push('openExternal'); } };
  const settingsModel = { hooks: () => hooks };
  // 注册表里**确实**有带 keyUrl 的提供商 —— 旧实现会因此外跳；新实现必须视而不见。
  const Registry = { providers: () => ([
    { id: 'openai', keyUrl: 'https://platform.openai.com/api-keys' },
    { id: 'custom', keyUrl: 'https://example.com/keys' },
  ]) };
  const detailRef = { current: detail };
  const LearnDialog = {
    confirm: async (msg, opts) => {
      calls.confirm.push({ msg, opts });
      calls.order.push('confirm');
      return confirmResult;
    },
  };
  const t = (key, fallback) => { calls.t.push({ key, fallback }); return fallback; };
  const setDetailFn = async (on) => {
    calls.setDetailFn.push(on);
    calls.order.push('detail:' + on);
  };
  const setPage = (page) => {
    calls.setPage.push(page);
    calls.order.push('page:' + page);
  };
  const quickCard = {
    scrollIntoView: (opts) => {
      calls.scroll.push(opts);
      calls.order.push('scroll:' + (opts && opts.block));
    },
  };
  const $ = (id) => (id === 'quick-setup-card' ? quickCard : null);
  const requestAnimationFrame = (fn) => { calls.raf += 1; fn(); };
  const grantAction = makeGrantAction(
    settingsModel, Registry, LearnDialog, t, detailRef,
    setDetailFn, setPage, requestAnimationFrame, $
  );
  return { calls, grantAction };
}

describe('BEL-233 · 额度卡「用自己的 key」页内导航（App only）', () => {
  test('★ byo 点击：openExternal 0 次；setPage(sec-engines)；一键卡 scrollIntoView 一次', async () => {
    const h = makeHarness({ detail: false });
    await h.grantAction('byo', null);
    eq(h.calls.openExternal.length, 0, 'byo 还在外跳 ' + h.calls.openExternal.join(', '));
    deepEq(h.calls.setPage, ['sec-engines'], '没有进引擎子页');
    eq(h.calls.scroll.length, 1, '一键卡应恰好滚动一次');
    deepEq(h.calls.scroll[0], { block: 'start' }, '滚动位置不是 quick-setup-card 的顶端');
    eq(h.calls.raf, 1, '滚动没有挂在 requestAnimationFrame 里');
    // 一键档已经是目标档位：不该问确认，也不该再切档。
    eq(h.calls.confirm.length, 0, '一键档不该弹分项覆盖确认');
    eq(h.calls.setDetailFn.length, 0, '一键档不该再调 setDetailFn');
  });

  test('★ 分项档 + 取消：setDetailFn 未调、未导航、未滚动、无 openExternal', async () => {
    const h = makeHarness({ detail: true, confirmResult: false });
    await h.grantAction('byo', null);
    eq(h.calls.confirm.length, 1, '分项档切换前一键前必须确认一次');
    eq(h.calls.confirm[0].msg, '改用一键会覆盖当前分项配置', '确认框文案不是 wireModeTabs 那句');
    deepEq(h.calls.confirm[0].opts, { ok: '改用一键', cancel: '取消' }, '确认框按钮文案不对');
    deepEq(h.calls.t.map((x) => x.key), [
      'opt_mode_switch_to_quick', 'opt_mode_switch_to_quick_ok', 'opt_mode_switch_cancel',
    ], '没有复用 wireModeTabs 的 i18n key（文案会与档位切换漂移）');
    eq(h.calls.setDetailFn.length, 0, '取消后仍切了档');
    eq(h.calls.setPage.length, 0, '取消后仍导航了');
    eq(h.calls.scroll.length, 0, '取消后仍滚动了');
    eq(h.calls.raf, 0, '取消后仍排了滚动');
    eq(h.calls.openExternal.length, 0, '取消后仍外跳了');
    deepEq(h.calls.order, ['confirm'], '取消路径除确认外不该有任何副作用');
  });

  test('★ 分项档 + 确认：setDetailFn(false) 一次，然后导航 + 滚动', async () => {
    const h = makeHarness({ detail: true, confirmResult: true });
    await h.grantAction('byo', null);
    eq(h.calls.confirm.length, 1, '确认框没弹');
    deepEq(h.calls.setDetailFn, [false], '确认后没有且仅切到一键档一次');
    deepEq(h.calls.setPage, ['sec-engines'], '确认后没进引擎子页');
    eq(h.calls.scroll.length, 1, '确认后没滚到一键卡');
    deepEq(h.calls.scroll[0], { block: 'start' }, '滚动位置不对');
    eq(h.calls.openExternal.length, 0, '确认路径仍外跳了');
    // 顺序：先确认 → 落档 → 导航 → 滚动。反过来会让用户看到分项页闪一下再跳。
    deepEq(h.calls.order, ['confirm', 'detail:false', 'page:sec-engines', 'scroll:start'],
      '确认/切档/导航/滚动的顺序不对');
  });

  test('★ 一键档：直接导航 + 滚动（无确认、无切档）', async () => {
    const h = makeHarness({ detail: false });
    await h.grantAction('byo', null);
    deepEq(h.calls.order, ['page:sec-engines', 'scroll:start'],
      '一键档应立即导航并滚动，不应有确认或切档');
    eq(h.calls.setDetailFn.length, 0, '一键档切了档');
    eq(h.calls.openExternal.length, 0, '一键档外跳了');
  });

  test('旧外跳实现已从 byo 分支删除（keyUrl 只留在一键配置页）', () => {
    const code = stripComments(GRANT_ACTION);
    const byo = code.slice(code.indexOf("id === 'byo'"), code.indexOf("id === 'community'"));
    ok(!/openExternal/.test(byo), 'byo 分支里还留着 openExternal');
    ok(!/keyUrl/.test(byo), 'byo 分支里还在读 keyUrl');
    ok(!/Registry\.providers/.test(byo), 'byo 分支里还在挑注册表提供商');
    ok(/setPage\('sec-engines'\)/.test(byo), 'byo 分支没有页内导航');
    ok(/\$\('quick-setup-card'\)\.scrollIntoView\(\{ block: 'start' \}\)/.test(byo),
      'byo 分支没有滚到一键卡');
  });
});
