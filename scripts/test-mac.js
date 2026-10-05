#!/usr/bin/env node
// scripts/test-mac.js — 分层验证矩阵的「音频层」驱动（npm run test:mac）。
// docs/verification-spec.md §0.4（2026-10-05 用户拍板）。
//
// 流程：重建带 __mtTest 的 App 包 → app:sync → xcodebuild macOS Debug → 起 App →
// 等 127.0.0.1:8790/ping → 能力探针（step 0）→ M 系列 case（逐个实现，报告里显示
// 未实现的不算失败、算欠条）。失败时 screencapture 留证。
//
// 用法：
//   npm run test:mac                 # 全流程（构建 + 起 App + 探针 + case）
//   npm run test:mac -- --skip-build # App 已在跑（Debug 包），只连端点
//   npm run test:mac -- --probe      # 只出能力探针报告（step 0）
//   npm run test:mac -- --eval '<js>' # 对在跑的 App 一次性求值（调试用）
//
// 注意：本脚本会 quit 掉正在跑的同 bundle id App（包括你装的正版）再开 Debug 包 ——
// 验证完重开一下就是。中国版 flavor 尚未接（genRoot/后端切换在 build.js 里，未导出）。

'use strict';

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJ = path.join(ROOT, 'safari-project', 'BelliedMonkey Translator', 'BelliedMonkey Translator.xcodeproj');
const SCHEME = 'BelliedMonkey Translator (macOS)';
const DD = path.join(ROOT, '.local', 'mac-debug-dd');
const PORTS = [];
for (let p = 8790; p <= 8799; p++) PORTS.push(p);
let BASE = null;   // 找到活口后钉住（8790–8799 扫第一个 —— 开发机上固定口会被占）

// 与仓库其它网络命令同一条纪律：本地代理死了不该连累 localhost（也避免 env 泄漏给 xcodebuild）。
function cleanEnv() {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy'])
    delete env[k];
  return env;
}

function log(...a) { console.log(...a); }
function die(msg) { console.error('✗ ' + msg); process.exit(1); }

// ── 端点客户端 ────────────────────────────────────────────────────────────────
async function pingAt(base) {
  try {
    const r = await fetch(`${base}/ping`);
    const j = await r.json();
    return !!(j && j.ok && j.bridge === 'mt-test');
  } catch (_) { return false; }
}

// 8790–8799 逐个探，钉住第一个活口（桥那边扫同一段范围绑第一个空口 —— 两边各扫各的，
// 谁也不用知道谁绑到了哪）。
async function findBase() {
  for (const p of PORTS) {
    const base = `http://127.0.0.1:${p}`;
    if (await pingAt(base)) return base;
  }
  return null;
}

async function evalJs(js) {
  const r = await fetch(`${BASE}/eval`, { method: 'POST', body: js });
  if (!r.ok) throw new Error(`/eval HTTP ${r.status}`);
  return r.json();          // { ok, result?, error? }
}

async function evalOk(js) {
  const j = await evalJs(js);
  if (!j.ok) throw new Error('eval 失败: ' + (j.error || '?') + ' ← ' + js.slice(0, 120));
  return j.result;
}

// 异步 JS：端点不等 Promise，__mtTest.runAsync 把结果落到 last()，这里轮询取。
async function runAsync(js, timeoutMs) {
  await evalJs(`__mtTest.runAsync(async () => { ${js} })`);
  const t0 = Date.now();
  for (;;) {
    const r = await evalJs('__mtTest.last()');
    if (r && r.result) return r.result;   // { ok, value?, error? }
    if (Date.now() - t0 > (timeoutMs || 30000)) throw new Error('runAsync 超时 ← ' + js.slice(0, 120));
    await new Promise((res) => setTimeout(res, 150));
  }
}

async function waitPing(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    BASE = await findBase();
    if (BASE) return true;
    await new Promise((res) => setTimeout(res, 300));
  }
  return false;
}

// ── 构建 ─────────────────────────────────────────────────────────────────────
function buildBundleWithHarness() {
  log('▶ 重建 App 包（带 __mtTest）→ dist-app/');
  const { buildAppBundle } = require(path.join(ROOT, 'build', 'app-bundle.js'));
  const { buildExtBundle } = require(path.join(ROOT, 'build', 'ext-bundle.js'));
  // 两个都要写：app:sync 的过期守卫比对 FILES 五件（Main/Script/Style/ExtEngine/ExtCopy），
  // 只刷前三件会被拦 —— 这不是守卫刁难，是「灌进工程的必须是完整一套」的纪律。
  buildAppBundle(path.join(ROOT, 'dist-app'), log, { testHarness: true });
  buildExtBundle(path.join(ROOT, 'dist-app'), log, {});
  log('  （正常 node build.js 会把 harness 冲掉 —— 出货包不带它，这是设计不是事故）');
}

function runAppSync() {
  log('▶ app:sync（补丁 ViewController + 把 dist-app 灌进工程树）');
  const r = spawnSync('node', [path.join(ROOT, 'scripts', 'sync-app-assets.js')], { stdio: 'inherit', env: cleanEnv() });
  if (r.status !== 0) die('app:sync 失败');
}

function buildMacDebug() {
  if (!fs.existsSync(PROJ)) die(`工程不存在：${PROJ} —— 先跑 bash build-safari.sh`);
  log('▶ xcodebuild macOS Debug（第一次要几分钟）');
  // ENABLE_INCOMING_NETWORK_CONNECTIONS：沙盒 App 监听端口的权利（§0.4 的端点）。只在
  // 这条 Debug 命令行上给 —— Release 归档不带它，App Store 的 entitlement 一个字节不变。
  // 判据不是「构建没报错」而是端点真的 /ping 得通（macos-app.entitlements 头上写的规矩）。
  const r = spawnSync('xcodebuild', ['-project', PROJ, '-scheme', SCHEME, '-configuration', 'Debug',
    '-derivedDataPath', DD, 'DEVELOPMENT_TEAM=X2Q85MABWK', 'ENABLE_INCOMING_NETWORK_CONNECTIONS=YES',
    '-allowProvisioningUpdates', 'build'], { stdio: 'inherit', env: cleanEnv() });
  if (r.status !== 0) die('xcodebuild 失败');
}

function findProduct() {
  const dir = path.join(DD, 'Build', 'Products', 'Debug');
  if (!fs.existsSync(dir)) die(`产物目录不存在：${dir}`);
  const apps = fs.readdirSync(dir).filter((f) => f.endsWith('.app'));
  if (!apps.length) die('Debug 目录里没有 .app');
  return path.join(dir, apps[0]);
}

function launch() {
  const app = findProduct();
  // 同 bundle id：先温和退出在跑的那份（可能是正版 —— 验证完重开即可），再开 Debug 包。
  try { execSync(`osascript -e 'quit app id "com.belliedmonkeytranslator"'`, { env: cleanEnv(), stdio: 'ignore' }); } catch (_) {}
  setTimeout(() => { /* 给退出一点时间 */ }, 800);
  log('▶ 起 Debug 包：' + app);
  execSync(`open "${app}"`, { env: cleanEnv() });
}

function shot(tag) {
  const p = path.join(ROOT, '.local', `test-mac-${tag}-${Date.now()}.png`);
  try { execSync(`screencapture -x "${p}"`, { env: cleanEnv(), stdio: 'ignore' }); log('📸 ' + p); } catch (_) {}
  return p;
}

// ── 能力探针（step 0）─────────────────────────────────────────────────────────
async function probe() {
  log('\n═══ 能力探针（§0.4 step 0 — 先知道这台 Mac 能测什么）═══');
  // 1) 系统 TTS 语音清单（音源三板斧的前两斧靠它）
  try {
    const voices = execSync("say -v '?'", { env: cleanEnv(), encoding: 'utf8' });
    const pick = (re) => voices.split('\n').filter((l) => re.test(l)).map((l) => l.trim().replace(/\s+/g, ' '));
    const zh = pick(/\bzh[-_]/), en = pick(/\ben[-_]/), th = pick(/\bth[-_]/);
    log(`  say 语音：zh ${zh.length} 个（${zh[0] ? zh[0].split(/\s{2,}/)[0] : '—'}） · en ${en.length} 个 · th ${th.length} 个${th.length ? '（' + th.map((l) => l.split(/\s{2,}/)[0]).join(', ') + '）' : ' —— 泰语音源走 afplay 或 App 自身 vits'}`);
  } catch (e) { log('  say 语音清单读不到：' + e.message); }

  // 2) 原生识别器（macOS 上 SpeechTranscriber 可用性是未知数 —— 探了才知道）
  for (const loc of ['zh', 'en', 'th']) {
    try {
      const r = await runAsync(`JSON.stringify(await NativeSpeech.probe('${loc}'))`);
      const v = JSON.parse(r.value || r.error || 'null');
      log(`  stt ${loc}: ${v ? `ok=${v.ok} assets=${v.assets} locales=${(v.locales || []).length}` : JSON.stringify(r)}`);
    } catch (e) { log(`  stt ${loc}: 探测失败 ${e.message}`); }
  }

  // 3) 页面状态
  try { log('  页面：' + JSON.stringify(await evalOk('__mtTest.state()'))); } catch (e) { log('  页面状态读不到：' + e.message); }
}

// ── M 系列 case（§0.4 的表；逐个实现，未实现 = 欠条不是失败）──────────────────
const CASES = [
  { id: 'M1', what: '包屏只下所选语言对的模型', impl: null },
  { id: 'M2', what: 'zh 输入 → th 译文 → 朗读出声', impl: null },
  { id: 'M3', what: '自己念的被认回来 → 拦住（真回声）', impl: null },
  { id: 'M4', what: '对方说不同的话 → 放行（不误杀）', impl: null },
  { id: 'M5', what: 'TTS 失败 3 秒内报、不静默阻塞', impl: null },
  { id: 'M6', what: '语言对下载后不跳', impl: null },
  { id: 'M7', what: '多轮对话历史逐行累积', impl: null },
];

async function runCases() {
  log('\n═══ M 系列 case ═══');
  let fail = 0;
  for (const c of CASES) {
    if (!c.impl) { log(`  ⏳ ${c.id} ${c.what} —— 未实现（欠条，见 §0.4 表）`); continue; }
    try { await c.impl({ evalOk, runAsync, shot }); log(`  ✓ ${c.id} ${c.what}`); }
    catch (e) { fail++; log(`  ✗ ${c.id} ${c.what} —— ${e.message}`); shot(c.id); }
  }
  return fail;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const oneOff = args.indexOf('--eval') >= 0 ? args[args.indexOf('--eval') + 1] : null;
  const skipBuild = args.includes('--skip-build');
  const probeOnly = args.includes('--probe');

  if (oneOff) {
    BASE = await findBase();
    if (!BASE) die('端点不在 —— Debug 包没在跑？先 npm run test:mac');
    try { log(JSON.stringify(await evalOk(oneOff), null, 2)); } catch (e) { die(e.message); }
    return 0;
  }

  if (!skipBuild) {
    buildBundleWithHarness();
    runAppSync();
    buildMacDebug();
    launch();
  }

  log('▶ 等 /ping …');
  if (!(await waitPing(90000))) { shot('no-ping'); die('90s 内 /ping 不通 —— 端点没起来（DEBUG 条件没编进？端口被占？）'); }
  log('  ✓ 端点通了');

  await probe();
  if (probeOnly) return 0;

  const fail = await runCases();
  return fail ? 1 : 0;
}

main().then((c) => process.exit(c || 0), (e) => die(e.stack || e.message));
