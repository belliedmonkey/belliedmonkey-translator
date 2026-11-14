// test/bel233-byo-landing.test.js — BEL-233 落点回归（ARCH-RESULT §5 / §9.1）。
//
// 最小复现：存储里 optDetailMode=true（用户以前用过分项），本次以额度态打开设置页
// （paintGrant 先卸载一键卡，setupQuickCard 在 `if (!$('quick-setup')) return;` 早退，
// 所以内存 detail=false）。点「用自己的 key」：
//   - grantAction('byo') 必须无条件 setDetailFn(false)；
//   - keyMode effect 重画一键卡时必须带 forceQuick，忽略存储里的 true。
// 两处只改一处，存储的 true 都会把 detail 贴回来 —— 终态 quota=false / quick=hidden /
// detail=true，屏幕只剩分项，就是票面。
//
// 与 bel233-quota-byo-nav.test.js 同构：截 settings-view.jsx 里的真函数体到 new Function，
// 断言状态机真的调了什么、终态显示哪张卡；不是 grep 源码。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8');

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
const SETUP_QUICK = functionSource(VIEW, 'async function setupQuickCard(session, say');

function makeEnv({ storedDetail = true, quickAvail = true } = {}) {
  const state = {
    detail: false, keyMode: false, quickAvail, page: 'home', grantActive: true,
    scroll: [], notesScroll: [], focus: 0, select: 0, detailCalls: [], writes: [], confirm: 0,
  };
  const detailRef = { current: false };
  const box = { hidden: false, children: [] };
  const quickCard = { scrollIntoView: (o) => state.scroll.push(o) };
  const notesInput = {
    scrollIntoView: (o) => state.notesScroll.push(o),
    focus: () => { state.focus += 1; },
    select: () => { state.select += 1; },
  };
  const $ = (id) => (id === 'quick-setup' ? box
    : id === 'quick-setup-card' ? quickCard
      : id === 'notes-api-key' ? notesInput : null);
  const setDetailFn = async (on) => {
    state.detailCalls.push(on);
    detailRef.current = !!on;
    state.detail = !!on;
  };
  const settingsModel = {
    get: async () => ({}),
    KEYS: [],
    set: async (v) => { state.writes.push(v); },
    readStoredDetail: async () => storedDetail,          // 关键：持久化的分项
    currentSession: () => ({}),
    hooks: () => ({ say: () => {} }),
  };
  const LearnDialog = { confirm: async () => { state.confirm += 1; return true; } };
  const renderQuickSetup = (b) => { if (quickAvail) b.children.push({}); else b.hidden = true; };
  const repaintEngineFields = () => {};

  const grantAction = new Function(
    'settingsModel', 'LearnDialog', 't', 'detailRef', 'setDetailFn', 'setPage',
    'requestAnimationFrame', '$', 'quickAvail',
    GRANT_ACTION + '\nreturn grantAction;'
  )(settingsModel, LearnDialog, (k, f) => f, detailRef, setDetailFn,
    (p) => { state.page = p; }, (fn) => fn(), $, quickAvail);

  const setupQuickCard = new Function(
    'settingsModel', 'QuickSetup', 'renderQuickSetup', 'detailWriteRef', 'setDetailFn', 't',
    'setQuickAvail', 'setDetailState', 'repaintEngineFields', '$', 'detailRef',
    SETUP_QUICK + '\nreturn setupQuickCard;'
  )(settingsModel, { prefill: () => null }, renderQuickSetup,
    { current: Promise.resolve() }, setDetailFn, (k, f) => f,
    (v) => { state.quickAvail = v; }, (v) => { state.detail = v; }, repaintEngineFields, $, detailRef);

  return { state, detailRef, grantAction, setupQuickCard };
}

// 与 settings-view.jsx :2126 / :2350-2352 同一组条件：
// 额度卡 = grantActive && !keyMode；一键卡 = (!grantActive || keyMode) && !detail && quickAvail。
const shown = (s) => ({
  quota: s.grantActive && !s.keyMode,
  quick: (!s.grantActive || s.keyMode) && !s.detail && s.quickAvail,
  detail: s.detail,
});

describe('BEL-233 · byo 落一键（storedDetail=true + quickAvail=true）', () => {
  test('★ intl iOS + 已存 optDetailMode=true + byo ⇒ 一键卡可见，不进分项', async () => {
    const h = makeEnv({ storedDetail: true, quickAvail: true });
    h.state.keyMode = true;                       // 额度卡按钮先置位
    const moved = await h.grantAction('byo', {});
    await h.setupQuickCard({}, () => {}, { forceQuick: true }); // keyMode effect
    eq(moved, true, 'byo 应落到一键档');
    eq(h.state.page, 'sec-engines', '没有进引擎子页');
    eq(h.detailRef.current, false, 'byo 被持久化的 optDetailMode=true 翻回分项');
    eq(h.state.detail, false, '分项档没有关掉');
    deepEq(shown(h.state), { quota: false, quick: true, detail: false },
      '终态应是「额度卡让位、一键卡可见」，不是只剩分项');
    deepEq(h.state.scroll, [{ block: 'start' }], '没有滚到 #quick-setup-card');
    eq(h.state.confirm, 0, 'byo 不该再弹覆盖确认');
    ok(h.state.detailCalls.length >= 1 && h.state.detailCalls.every((v) => v === false),
      'byo 与 keyMode effect 都必须写 false，不能有一次把 true 贴回来：' + JSON.stringify(h.state.detailCalls));
    eq(h.state.writes.length, 0, 'byo 不写任何配置（更不该清 apiKey）');
  });

  test('★ 只改 grantAction 不改 keyMode effect ⇒ 存储的 true 仍会翻回分项（证明两处都要改）', async () => {
    const h = makeEnv({ storedDetail: true, quickAvail: true });
    h.state.keyMode = true;
    await h.grantAction('byo', {});
    await h.setupQuickCard({}, () => {}, {});     // 模拟漏掉 forceQuick 的 effect
    eq(h.state.detail, true, '没有 forceQuick 时 setupQuickCard 应把存储的 true 贴回');
    eq(shown(h.state).quick, false, '这正是修复前「只剩分项」的终态');
  });

  test('★ keyMode effect 带 forceQuick；setupQuickCard 两处贴档点都忽略存储值', () => {
    ok(/setupQuickCard\(settingsModel\.currentSession\(\), h\.say, \{ forceQuick: true \}\)/.test(VIEW),
      'keyMode effect 没有传 forceQuick:true');
    const hits = VIEW.match(/setDetailFn\(forceQuick \? false : on, false\)/g) || [];
    eq(hits.length, 2, 'setupQuickCard 的「已挂载」与「刚渲染」两处都要用 forceQuick 覆盖存储值');
  });

  test('★ quickAvail=false 兜底：不置 keyMode、不滚一键卡，滚 #notes-api-key 并 focus/select，返回 false', async () => {
    const h = makeEnv({ storedDetail: true, quickAvail: false });
    h.state.detail = true; h.detailRef.current = true; // 无平台时 setupQuickCard 已落到分项
    const moved = await h.grantAction('byo', {});
    eq(moved, false, '兜底必须返回 false，按钮才会 setKeyMode(false)、留下额度卡');
    eq(h.state.keyMode, false, 'grantAction 不置 keyMode');
    eq(h.state.page, 'sec-engines');
    eq(h.state.detail, true, '兜底不该动已落好的分项档');
    eq(h.detailRef.current, true, '兜底不该切档');
    deepEq(h.state.scroll, [], '兜底不该滚一键卡');
    deepEq(h.state.notesScroll, [{ block: 'start' }], '兜底没有滚到 #notes-api-key');
    eq(h.state.focus, 1, '兜底没有 focus #notes-api-key');
    eq(h.state.select, 1, '兜底没有 select 现有 key，粘 key 会接在后面');
    eq(h.state.writes.length, 0, '兜底不自动清 apiKey');
    eq(h.state.confirm, 0, '兜底不新增文案/确认');
  });

  test('byo 分支不写配置、不外跳、不弹确认（只改视图意图）', () => {
    const code = stripComments(GRANT_ACTION);
    const byo = code.slice(code.indexOf("id === 'byo'"), code.indexOf("id === 'community'"));
    ok(!/openExternal/.test(byo), 'byo 还在外跳');
    ok(!/keyUrl/.test(byo), 'byo 还在读 keyUrl');
    ok(!/Registry\.providers/.test(byo), 'byo 还在挑注册表提供商');
    ok(!/LearnDialog\.confirm/.test(byo), 'byo 还留着覆盖确认');
    ok(!/settingsModel\.set\b/.test(byo), 'byo 在写配置');
    ok(/await setDetailFn\(false\)/.test(byo), 'byo 没有无条件 setDetailFn(false)');
  });
});
