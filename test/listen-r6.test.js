// test/listen-r6.test.js — 1.19.4 第 6 轮（fix/1194-r6）：真机 110 的三条问题。
//
//   1. 听译英文丢前 1–2 个词：句头闸里「不紧接」的低置信句头不再丢（只有跨语言重叠能丢）；
//      原生侧的预录缓冲由源码门守住（识别器挂上之前的帧不许丢）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq } = require('./harness');
const C = require('../app/listen-core.js');
const LearnRules = require('../extension/content/learn-rules.js');

const DEPS = { dominantScript: LearnRules.dominantScript };
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('r6 ① 句头闸：不紧接的句头接回，不丢', () => {
  test('句首单出成低置信短片，后半句隔 300 ms 才到 ⇒ 句首接回', () => {
    const diags = [];
    const g = C.makeFinalGate(Object.assign({}, DEPS, { onDiag: (k, t, w) => diags.push([k, t, w]) }));
    deepEq(g.push({ locale: 'en-US', text: 'Hello.', conf: 0.3, t0: 0, t1: 400 }), [], '低置信短片先扣住');
    deepEq(g.push({ locale: 'en-US', text: 'can you hear me?', conf: 0.95, t0: 700, t1: 1800 }), ['Hello.', 'can you hear me?']);
    eq(g.held('en-US'), '', '接回之后不再扣着');
    ok(diags.some(([k, t, w]) => k === 'gate:release' && t === 'Hello.' && w === 'gap'), '留痕为 gate:release/gap');
    ok(!diags.some(([k]) => k === 'gate:drop'), '不应再出现 gate:drop');
  });

  test('扣住的句头已被中文侧判为时间重叠（conflict）⇒ 照旧丢', () => {
    const diags = [];
    const g = C.makeFinalGate(Object.assign({}, DEPS, { onDiag: (k, t, w) => diags.push([k, t, w]) }));
    deepEq(g.push({ locale: 'en-US', text: 'Rugua,', conf: 0.2, t0: 0, t1: 500 }), []);
    g.noteOtherText('zh-CN', '如果定金周五之前到账', 0, 600);
    deepEq(g.push({ locale: 'en-US', text: 'We can ship the first batch.', conf: 0.95, t0: 900, t1: 2600 }), ['We can ship the first batch.']);
    ok(diags.some(([k, t, w]) => k === 'gate:drop' && t === 'Rugua,' && w === 'cjk-overlap'), '记 gate:drop/cjk-overlap');
  });
});

describe('r6 ① 原生预录：识别器挂上之前的麦克风帧不许丢', () => {
  const ab = read('app/native/audio-bridge.swift');
  test('micDeliver 经 deliverToSink 交付；没有 sink 时进预录缓冲', () => {
    ok(/deliverToSink\(buffer\)/.test(ab), 'micDeliver 必须走 deliverToSink');
    ok(!/\n\s*micSink\?\(buffer\)/.test(ab), '不能再直接 micSink?(buffer)（sink 为空时会丢帧）');
    ok(/preRoll\.append\(/.test(ab), '没有 sink 时要拷进 preRoll');
  });
  test('挂上 sink 的那一刻按顺序补喂预录，并清空', () => {
    const setter = ab.slice(ab.indexOf('var micSink'), ab.indexOf('private var sinkStore'));
    ok(/for b in pending \{ sink\(b\) \}/.test(setter), 'setter 里要补喂 pending');
    ok(/sinkLock\.lock\(\)/.test(setter), 'setter 与 deliverToSink 共用一把锁');
  });
  test('每次开麦 / 关麦都清空预录（缓冲里只能是还没被任何识别器看过的声音）', () => {
    const begin = ab.slice(ab.indexOf('private func micBegin'), ab.indexOf('private func micDeliver'));
    ok(/resetPreRoll\(\)/.test(begin), 'micBegin 要清空预录');
    const stop = ab.slice(ab.indexOf('private func micStop'), ab.indexOf('private var recordMode'));
    eq((stop.match(/resetPreRoll\(\)/g) || []).length, 2, 'micStop 的系统声音分支与麦克风分支都要清空');
  });
  test('预录有上限（秒）', () => {
    ok(/static let preRollMaxSec: Double = \d/.test(ab));
  });
});

describe('r6 ③ 名额：已用从全部预留起算；探针不占；让出在重开后有效', () => {
  test('占着 th 却没勾它：已用要算上 th，第 5 门就放不下', () => {
    const plan = C.quotaSelectPlan({ selected: ['zh', 'en', 'ja', 'ko', 'fr'], reserved: ['zh', 'en', 'th'], installed: {}, max: 5 });
    deepEq(plan.keep, ['zh', 'en', 'ja', 'ko']);
    eq(plan.later.length, 1); eq(plan.later[0].code, 'fr'); eq(plan.later[0].nth, 6);
  });
  test('一门都没占：照勾选顺序填满上限', () => {
    const plan = C.quotaSelectPlan({ selected: ['zh', 'en', 'ja', 'ko', 'fr', 'de'], reserved: [], installed: {}, max: 5 });
    deepEq(plan.keep, ['zh', 'en', 'ja', 'ko', 'fr']);
    eq(plan.later[0].code, 'de');
  });
  const sb = read('app/native/speech-bridge.swift');
  const probe = sb.slice(sb.indexOf('private func sttProbe'), sb.indexOf('private func sttAssets'));
  test('探针不再登记预留，且每条出口之前都先还掉这次多占的', () => {
    ok(!/noteReserved\(/.test(probe), '探针里不许 noteReserved（只有安装才占名额）');
    ok(/let before = Set\(await AssetInventory\.reservedLocales/.test(probe), '探针前要读一次系统预留');
    const emits = (probe.match(/self\.emit\(await self\.withQuota/g) || []).length;
    const releases = (probe.match(/releaseProbeLeftovers\(before: before, keys: probedKeys\)/g) || []).length;
    ok(emits >= 3 && releases >= emits, '每条带名额快照的出口之前都要先还（emit ' + emits + ' / release ' + releases + '）');
  });
  test('releaseExplicit 表里找不到时按短码去系统 reservedLocales 里找', () => {
    const fn = sb.slice(sb.indexOf('static func releaseExplicit'), sb.indexOf('static func keyOf'));
    ok(/for loc in await AssetInventory\.reservedLocales/.test(fn));
  });
  test('「装过」只记本 App 占着名额的（探针看到 .installed 不算）', () => {
    const sm = read('src/app/shell-model.js');
    ok(!/if \(packAsrByLang\[code\]\) ASRQuota\.markInstalled/.test(sm), '探针不许凭 .installed 直接记装过');
    ok(/held\.indexOf\(code\) >= 0/.test(sm), '要按 NativeSpeech.quota().reserved 过滤');
  });
  test('首启就绪与下载只看放得下的那些（firstRunAsrLangs = plan.keep）', () => {
    const sm = read('src/app/shell-model.js');
    ok(/function firstRunAsrLangs\(s\) \{\s*return asrPlan\(\)\.keep;/.test(sm));
    ok(/id="packs-quota-over"/.test(read('src/app/AppShell.jsx')), '改稿 H 第 1 张的超额提示块');
  });
});

describe('r6 ② 首启包屏完成过一次就不再回来', () => {
  const { loadSrc } = require('./harness');
  const FR = loadSrc('src/app/firstrun.js', 'FirstRun').FirstRun;
  const all = { loggedIn: true, engine: true, asrPack: true, ttsPack: true, basePack: true };
  test('step：packsDone 时冷启动探针报缺包也进首页；未登录仍是登录', () => {
    eq(FR.step({ ...all, asrPack: false, packsDone: true }), 'home', '探针一时报识别包未装 ⇒ 不回包屏');
    eq(FR.step({ ...all, asrPack: false, ttsPack: false, basePack: false, packsDone: true }), 'home');
    eq(FR.step({ ...all, loggedIn: false, packsDone: true }), 'login');
    eq(FR.step({ ...all, asrPack: false }), 'packs', '没完成过 ⇒ 仍是硬门');
  });
  const sm = read('src/app/shell-model.js');
  test('下载完成就记标记（不等「进入实时听译」）', () => {
    const run = sm.slice(sm.indexOf('async function runFirstRunPacks'), sm.indexOf('async function enterListen'));
    ok(run.indexOf("packPhase = 'done'") >= 0 && run.indexOf('writePacksDone()') > run.indexOf("packPhase = 'done'"), "packPhase='done' 之后要 writePacksDone()");
  });
  test('冷启动判定读标记；1.19.3 老用户探针全齐时补记', () => {
    const paint = sm.slice(sm.indexOf('async function paintFirstRun'), sm.indexOf('async function loadPackSelection'));
    ok(/readPacksDone\(\)/.test(paint), 'paintFirstRun 要读 packsDone');
    ok(/packsDone: done/.test(paint), 'step 的输入要带 packsDone');
    ok(/!done && FirstRun\.step\(probed\) === 'home'[\s\S]{0,40}writePacksDone/.test(paint), '探针全齐要补记');
  });
});
