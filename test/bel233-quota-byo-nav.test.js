// test/bel233-quota-byo-nav.test.js — BEL-233 · 额度卡「用自己的 key」必须页内导航。
//
// 缺陷一：`grantAction('byo')` 取注册表第一个带 keyUrl 的提供商（OpenAI），点一下就
// `openExternal(platform.openai.com)`，把用户踢出 App。产品令：App only 改成页内导航。
//
// 缺陷二（本卡）：byo 只是「此刻要填自己的 key」的视图意图，一个字节配置都不写。
// 旧实现只在内存 detailRef=true 时才 `setDetailFn(false)`，于是「已存 optDetailMode=true
// 但本次以额度态打开设置页」时 detailRef 仍是 false，跳过切档，随后 keyMode effect 又把
// 存储里的 true 贴回来 —— 用户落在分项。现在 byo **无条件** `setDetailFn(false)`，不再
// 弹「改用一键会覆盖当前分项配置」确认；「一键」tab 的 switchMode 确认原样保留。
// quickAvail=false 的兜底：不置 keyMode、留额度卡，送用户到 #notes-api-key 并 focus/select。
//
// 这里不用 jsdom：把真实的 `grantAction` 函数体从 settings-view.jsx 里按大括号配平
// 截出来，塞进 `new Function`，只注入它执行 byo 分支要用的闭包（settingsModel /
// LearnDialog / t / detailRef / setDetailFn / setPage / requestAnimationFrame / $ /
// quickAvail）。截的是真源码，所以断言的是点击后**真的调了什么**，不是源码里有没有某行字。

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
  'setDetailFn', 'setPage', 'requestAnimationFrame', '$', 'quickAvail',
  GRANT_ACTION + '\nreturn grantAction;'
);

function makeHarness({ detail = false, quickAvail = true } = {}) {
  const calls = {
    openExternal: [], setPage: [], scroll: [], notesScroll: [], setDetailFn: [],
    confirm: [], t: [], raf: 0, order: [], focus: 0, select: 0,
  };
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
      return true;
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
  const notesInput = {
    scrollIntoView: (opts) => {
      calls.notesScroll.push(opts);
      calls.order.push('notes-scroll:' + (opts && opts.block));
    },
    focus: () => { calls.focus += 1; calls.order.push('focus'); },
    select: () => { calls.select += 1; calls.order.push('select'); },
  };
  const $ = (id) => (id === 'quick-setup-card' ? quickCard
    : id === 'notes-api-key' ? notesInput : null);
  const requestAnimationFrame = (fn) => { calls.raf += 1; fn(); };
  const grantAction = makeGrantAction(
    settingsModel, Registry, LearnDialog, t, detailRef,
    setDetailFn, setPage, requestAnimationFrame, $, quickAvail
  );
  return { calls, grantAction };
}

describe('BEL-233 · 额度卡「用自己的 key」页内导航（App only）', () => {
  test('★ byo 点击：openExternal 0 次；无条件 setDetailFn(false)；setPage(sec-engines)；一键卡滚一次', async () => {
    const h = makeHarness({ detail: false, quickAvail: true });
    await h.grantAction('byo', null);
    eq(h.calls.openExternal.length, 0, 'byo 还在外跳 ' + h.calls.openExternal.join(', '));
    deepEq(h.calls.setPage, ['sec-engines'], '没有进引擎子页');
    eq(h.calls.scroll.length, 1, '一键卡应恰好滚动一次');
    deepEq(h.calls.scroll[0], { block: 'start' }, '滚动位置不是 quick-setup-card 的顶端');
    eq(h.calls.raf, 1, '滚动没有挂在 requestAnimationFrame 里');
    // byo 不写配置，也不该再问「改用一键会覆盖当前分项配置」。
    eq(h.calls.confirm.length, 0, 'byo 不该弹分项覆盖确认');
    deepEq(h.calls.setDetailFn, [false], 'byo 必须无条件切到一键档一次');
    deepEq(h.calls.order, ['detail:false', 'page:sec-engines', 'scroll:start'],
      '切档/导航/滚动的顺序不对');
  });

  test('★ 分项档（内存 detail=true）：不弹确认、setDetailFn(false) 一次，然后导航 + 滚动', async () => {
    const h = makeHarness({ detail: true, quickAvail: true });
    await h.grantAction('byo', null);
    eq(h.calls.confirm.length, 0, '删掉的正是 byo 路径这次确认');
    deepEq(h.calls.setDetailFn, [false], '没有且仅切到一键档一次');
    deepEq(h.calls.setPage, ['sec-engines'], '没进引擎子页');
    eq(h.calls.scroll.length, 1, '没滚到一键卡');
    deepEq(h.calls.scroll[0], { block: 'start' }, '滚动位置不对');
    eq(h.calls.openExternal.length, 0, '仍外跳了');
    deepEq(h.calls.order, ['detail:false', 'page:sec-engines', 'scroll:start'],
      '切档/导航/滚动的顺序不对（确认已删除）');
  });

  test('★ 一键档：同样无条件切档 + 导航 + 滚动（无确认）', async () => {
    const h = makeHarness({ detail: false, quickAvail: true });
    await h.grantAction('byo', null);
    deepEq(h.calls.order, ['detail:false', 'page:sec-engines', 'scroll:start'],
      '一键档也应无确认、切档一次、立即导航并滚动');
    deepEq(h.calls.setDetailFn, [false], '一键档没有走无条件 setDetailFn(false)');
    eq(h.calls.confirm.length, 0, '一键档弹了确认');
    eq(h.calls.openExternal.length, 0, '一键档外跳了');
  });

  test('★ quickAvail=false 兜底：返回 false、不切档、不滚一键卡，滚 #notes-api-key 并 focus/select', async () => {
    const h = makeHarness({ detail: true, quickAvail: false });
    const moved = await h.grantAction('byo', null);
    eq(moved, false, '兜底必须返回 false，调用方才会撤回 keyMode、留下额度卡');
    deepEq(h.calls.setPage, ['sec-engines'], '兜底应进引擎子页（分项档）');
    eq(h.calls.setDetailFn.length, 0, '兜底不该再切档');
    eq(h.calls.scroll.length, 0, '兜底不该滚一键卡');
    deepEq(h.calls.notesScroll, [{ block: 'start' }], '兜底没有把 #notes-api-key 滚进视野');
    eq(h.calls.focus, 1, '兜底没有聚焦 #notes-api-key');
    eq(h.calls.select, 1, '兜底没有全选 grant 圆点，粘 key 会接在后面');
    eq(h.calls.confirm.length, 0, '兜底不该弹任何确认');
    eq(h.calls.openExternal.length, 0, '兜底外跳了');
    deepEq(h.calls.order, ['page:sec-engines', 'notes-scroll:start', 'focus', 'select'],
      '兜底的导航/滚动/聚焦顺序不对');
  });

  test('旧外跳实现已从 byo 分支删除（keyUrl 只留在一键配置页）', () => {
    const code = stripComments(GRANT_ACTION);
    const byo = code.slice(code.indexOf("id === 'byo'"), code.indexOf("id === 'community'"));
    ok(!/openExternal/.test(byo), 'byo 分支里还留着 openExternal');
    ok(!/keyUrl/.test(byo), 'byo 分支里还在读 keyUrl');
    ok(!/Registry\.providers/.test(byo), 'byo 分支里还在挑注册表提供商');
    ok(!/LearnDialog\.confirm/.test(byo), 'byo 分支里还留着覆盖确认');
    ok(!/settingsModel\.set\b/.test(byo), 'byo 分支在写配置（byo 不该写一个字节）');
    ok(/if \(!quickAvail\)/.test(byo), 'byo 分支没有 quickAvail=false 的兜底');
    ok(/await setDetailFn\(false\)/.test(byo), 'byo 分支没有无条件切到一键档');
    ok(/setPage\('sec-engines'\)/.test(byo), 'byo 分支没有页内导航');
    ok(/\$\('quick-setup-card'\)\.scrollIntoView\(\{ block: 'start' \}\)/.test(byo),
      'byo 分支没有滚到一键卡');
    ok(/\$\('notes-api-key'\)/.test(byo) && /\.focus\(\)/.test(byo) && /\.select\(\)/.test(byo),
      'byo 兜底没有把用户送到 #notes-api-key 并 focus/select');
  });
});
