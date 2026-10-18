#!/usr/bin/env node
// scripts/test-mac.js — 分层验证矩阵的「音频层」驱动（npm run test:mac）。
// docs/verification-spec.md §0.4（2026-10-05 用户拍板）。
//
// 流程：重建带 __mtTest 的 App 包 → app:sync → xcodebuild macOS Debug → 起 App →
// 等 127.0.0.1:8790–8799 里的活口 → 能力探针（step 0）→ M1–M7。
//
// 用法：
//   npm run test:mac                 # 全流程（构建 + 起 App + 探针 + case）
//   npm run test:mac -- --skip-build # App 已在跑（Debug 包），只连端点
//   npm run test:mac -- --probe      # 只出能力探针报告（step 0）
//   npm run test:mac -- --eval '<js>' # 对在跑的 App 一次性求值（调试用）
//
// 两个环境事实（写在这儿免得下次重新发现）：
//   · Debug 包与正版同 bundle id + 同 team ⇒ **Keychain 共享，登录态被继承** —— 包屏/
//     听译这些要 session 的流程因此可达；听译捕获默认关、翻译走免费引擎，不碰真账号数据。
//   · 首次跑会把模型下进 Debug 容器（kokoro-zh-en 一份、vits-tha 一份），此后常驻 ——
//     第一次慢是特性不是 bug（这正是「四处首播同一入口」的第五处）。
//
// 注意：本脚本会 quit 掉正在跑的同 bundle id App（包括你装的正版）再开 Debug 包 ——
// 验证完重开一下就是。听译组会把系统输出静音（测完还原）—— 不静音的话 Mac 麦克风
// 会真的听到朗读，行的条数就不确定 了（那本身是 M3 的物理版，另案观察）。中国版
// flavor 尚未接（genRoot/后端切换在 build.js 里，未导出）。

'use strict';

const { spawnSync, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PROJ = path.join(ROOT, 'safari-project', 'BelliedMonkey Translator', 'BelliedMonkey Translator.xcodeproj');
const SCHEME = 'BelliedMonkey Translator (macOS)';
const DD = path.join(ROOT, '.local', 'mac-debug-dd');
const PORTS = [];
for (let p = 8790; p <= 8799; p++) PORTS.push(p);
let BASE = null;   // 找到活口后钉住（8790–8799 扫第一个 —— 开发机上固定口会被占）
let mockChatPort = 0;
let mockChatSrv = null;
let mockChatHits = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 听译组翻译走本机假端点（同 verify-listen.js）—— 不碰 Google 公网、不碰额度中继。
function startMockChatServer() {
  if (mockChatSrv) return Promise.resolve();
  return new Promise((resolve) => {
    mockChatSrv = http.createServer((req, res) => {
      const u = req.url.split('?')[0];
      if (u !== '/v1/chat/completions' || req.method !== 'POST') { res.writeHead(404); return res.end(); }
      mockChatHits++;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let user = '', sys = '';
        try {
          const j = JSON.parse(body);
          user = (j.messages.find((x) => x.role === 'user') || {}).content || '';
          sys = (j.messages.find((x) => x.role === 'system') || {}).content || '';
        } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const segStage = /"segments"/.test(sys);
        if (segStage) {
          const blocks = String(user).split('\n\n');
          const buf = (blocks.length >= 2 ? blocks[blocks.length - 2].trim().split('\n').slice(1).join('\n') : String(user)).trim();
          const fixed = buf.replace('几搂', '几楼');
          const tr = /[\u0E00-\u0E7F]/.test(fixed) ? '泰语：' + fixed : '译：' + fixed;
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
            segments: fixed ? [{ source: fixed, translation: tr }] : [], remainder: '',
          }) } }] }));
          return;
        }
        if (/correction stage/.test(sys)) {
          const sent = (String(user).split('Transcript sentence:\n')[1] || String(user)).trim();
          const fixed = sent.replace('几搂', '几楼');
          const tr = /[\u0E00-\u0E7F]/.test(fixed) ? '泰语：' + fixed : '译：' + fixed;
          res.end(JSON.stringify({ choices: [{ message: { content: 'T: ' + fixed + '\nX: ' + tr } }] }));
          return;
        }
        const tr = /[\u0E00-\u0E7F]/.test(user) ? '泰语：' + user.slice(0, 80) : '译：' + String(user).slice(0, 80);
        res.end(JSON.stringify({ choices: [{ message: { content: tr } }] }));
      });
    });
    mockChatSrv.listen(0, '127.0.0.1', () => {
      mockChatPort = mockChatSrv.address().port;
      resolve();
    });
  });
}

function cleanEnv() {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy'])
    delete env[k];
  return env;
}

function log(...a) { console.log(...a); }
function die(msg) { console.error('✗ ' + msg); process.exit(1); }
function okc(cond, msg) { if (!cond) throw new Error(msg); }

// ── 端点客户端 ────────────────────────────────────────────────────────────────
async function pingAt(base) {
  try {
    const r = await fetch(`${base}/ping`);
    const j = await r.json();
    return !!(j && j.ok && j.bridge === 'mt-test');
  } catch (_) { return false; }
}

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
// 注意包装必须 `return (${js})` —— 少了 return，值静默变 undefined（第一版就这样，
// 探针全打 ok=undefined 还以为桥坏了）。起跑那次 POST 会因为返回 Promise 序列化
// 失败而报 WKErrorDomain Code=5 —— 求值本身已经执行，那个错可以忽略。
async function runAsync(js, timeoutMs) {
  await evalJs(`__mtTest.runAsync(async () => { return (${js}) })`).catch(() => {});
  const t0 = Date.now();
  for (;;) {
    const r = await evalJs('__mtTest.last()');
    if (r && r.result) {
      if (!r.result.ok) throw new Error('runAsync 页内异常: ' + (r.result.error || '?'));
      return r.result.value;
    }
    if (Date.now() - t0 > (timeoutMs || 30000)) throw new Error('runAsync 超时 ← ' + js.slice(0, 120));
    await sleep(150);
  }
}

async function waitPing(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    BASE = await findBase();
    if (BASE) return true;
    await sleep(300);
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
  // app:sync 有一条过期守卫：**两个 flavor 的 dist 都必须比源码新**（缺一边就拒绝整次同步）。
  // 本脚本只重建 global 的 dist-app，所以这里先把 china 那份也刷出来 —— 否则整轮 M1–M9 会停在
  // 「✗ dist-app-china/ 比源码旧」，看起来像功能回归，其实一行都没跑。
  log('▶ 刷 dist-china（app:sync 要求两个 flavor 都新）');
  const b = spawnSync('node', [path.join(ROOT, 'build.js'), '--flavor', 'china'], { stdio: 'ignore', env: cleanEnv() });
  if (b.status !== 0) die('node build.js --flavor china 失败');
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
  // 真退出要等进程真的走掉：`open` 的 -600（procNotFound）多半就是与「正在退出」抢。
  try { execSync('pkill -f "BelliedMonkey Translator.app/Contents/MacOS" || true', { env: cleanEnv(), stdio: 'ignore' }); } catch (_) {}
  sleep(1800);
  log('▶ 起 Debug 包：' + app);
  let last = null;
  for (let i = 0; i < 3; i++) {
    try { execSync(`open "${app}"`, { env: cleanEnv(), stdio: 'ignore' }); return; } catch (e) { last = e; sleep(2000); }
  }
  // 兜底：`open` 走 LaunchServices，它偶尔连着三次不认刚注册的包。直接起可执行文件绕开它 ——
  // 后续全部走 /ping（不依赖 LaunchServices），所以这条路对测试是等价的。
  try {
    const macos = path.join(app, 'Contents', 'MacOS');
    const bin = path.join(macos, fs.readdirSync(macos).find((f) => !f.startsWith('.')) || '');
    log('  （open 三次都失败：直接起可执行文件 —— ' + bin + '）');
    spawn(bin, [], { detached: true, stdio: 'ignore' }).unref();
    return;
  } catch (e) { log('  （兜底也没起来：' + e.message + '）'); }
  throw last;
}

function shot(tag) {
  const p = path.join(ROOT, '.local', `test-mac-${tag}-${Date.now()}.png`);
  try { execSync(`screencapture -x "${p}"`, { env: cleanEnv(), stdio: 'ignore' }); log('📸 ' + p); } catch (_) {}
  return p;
}

// 重启 Debug 包。听译组**必须**在新鲜 App 上跑：经历过几次 start/stop 的进程里会积累
// 陈旧的 stt-stop 回执与重试风暴（2026-10-05 实测：ready→ended→granted→ended 循环到
// 「转写连接中断」），换新进程即消 —— 风暴本身的根因另立 issue 追。
async function relaunchApp() {
  try { execSync(`osascript -e 'quit app id "com.belliedmonkeytranslator"'`, { env: cleanEnv(), stdio: 'ignore' }); } catch (_) {}
  sleep(1500);
  const app = findProduct();
  // open 偶发 -600（LaunchServices 与退出竞态）—— 重试三记，间隔 2s。
  for (let i = 0; i < 3; i++) {
    try { execSync(`open "${app}"`, { env: cleanEnv(), stdio: 'ignore' }); break; } catch (_) { sleep(2000); }
  }
  if (!(await waitPing(60000))) { shot('relaunch-no-ping'); throw new Error('重启后 /ping 不通'); }
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try { if (await evalOk('!!(window.__mtTest && window.NativeSpeech)')) return; } catch (_) {}
    await sleep(400);
  }
  throw new Error('重启后页面没起来');
}

// ── 页面驱动（fixture 级：设值、点按、读写存储 —— 不替 App 做逻辑决定）──────────
const click = (id) => evalOk(`(()=>{const e=document.getElementById('${id}'); if(!e) return false; e.click(); return true})()`);
const visible = (id) => evalOk(`(()=>{const e=document.getElementById('${id}'); return !!e && !e.hidden && getComputedStyle(e).display!=='none'})()`);
const textOf = (id) => evalOk(`(document.getElementById('${id}')||{textContent:''}).textContent || ''`);
const valueOf = (id) => evalOk(`(document.getElementById('${id}')||{value:null}).value`);
const setValue = (id, v) => evalOk(`(()=>{const e=document.getElementById('${id}'); if(!e) return false; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
const state = () => evalOk('__mtTest.state()');
const say = (text, loc) => evalOk(`__mtTest.say(${JSON.stringify(text)}, '${loc}')`);
const rec = (cmd) => evalOk(`__mtTest.rec(${cmd === undefined ? '' : cmd})`);
const storageSet = (obj) => runAsync(`new Promise(res=>{ try{ chrome.storage.local.set(${JSON.stringify(obj)}, ()=>res('ok')); }catch(e){ res('throw:'+e) } })`);
// 借用设置要存/还（0-3）：这个脚本会把语言对钉成 zh/th 或 zh/en、自动朗读钉 true，
// 而 Debug 包与正版共用容器 ⇒ 跑完必须原样还回去。
const { stashInit: stashS, stashRestore: stashR } = require('./stash-settings.js');
let volBefore = null;   // 系统输出音量/静音的原值（跑完还原）
const storageGet = (keys) => runAsync(`new Promise(res=>{ try{ chrome.storage.local.get(${JSON.stringify(keys)}, v=>res(JSON.stringify(v||{}))); }catch(e){ res('{}') } })`).then(JSON.parse);

// 听译组**不得依赖线上额度**：Debug 与正版共用 Keychain ⇒ 登录态继承 ⇒ 开机 autoClaim
// 把三槽写成 grant；中继额度用尽后 listen-model quotaHalt 整场停（#590 K），M2–M7 全红。
// 在每次 relaunch/reload 后等 autoClaim 落地，再把翻译/朗读/转写钉回本机+Google（占位 key 过
// readCfg 的 apiKey 守卫；Google 免费路不走我们的中继）。
async function pinListenOfflineEngines() {
  okc(mockChatPort > 0, '假翻译端点没起来');
  const chatUrl = `http://127.0.0.1:${mockChatPort}/v1/chat/completions`;
  // 与 verify-listen 同形：custom_chat + 本机假端点。不得走 grant/DeepSeek 真网（#90 / 额度用尽 ⇒ quotaHalt）。
  await runAsync(`new Promise(res=>{ try{
    chrome.storage.local.remove(['grant','grantTail','grantBalance'], ()=>{
      chrome.storage.local.set({
        provider: 'custom_chat', apiKey: 'fixture-offline', apiModel: 'm', apiBaseUrl: ${JSON.stringify(chatUrl)},
        notesProvider: '', notesApiKey: '', notesModel: '', notesBaseUrl: '',
        ttsEngine: 'device', ttsApiKey: '', ttsBaseUrl: '', ttsModel: '', ttsVoice: '',
        sttEngine: 'local', sttApiKey: '', sttBaseUrl: '', sttModel: '',
      }, ()=>res('ok'));
    });
  }catch(e){ res('throw:'+e) }})`);
  try { await evalOk('(typeof AppListen !== "undefined" && AppListen.refreshEntry && AppListen.refreshEntry(), true)'); } catch (_) {}
  await waitListenTrLive(chatUrl);
}

// storage 钉 offline 后，listen-model 通过 onChanged→readCfg 异步刷新会话内 cfg.tr；grant 键也可能被
// autoClaim 写回。读 storage +（有会话时）用 retranslate 打本机假端点，确认 passRow 不再走 grant。
async function listenTrStorageOk(chatUrl) {
  const got = await storageGet(['provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'grant', 'grantTail', 'grantBalance']);
  const base = String(got.apiBaseUrl || '');
  const grantOn = !!(got.grant || got.grantTail || got.grantBalance);
  return got.provider === 'custom_chat' && got.apiKey === 'fixture-offline' && base === chatUrl && !grantOn;
}

async function waitListenTrLive(chatUrl, ms) {
  const lim = ms || 20000;
  const snap = async () => {
    const got = await storageGet(['provider', 'apiKey', 'grant', 'grantTail', 'grantBalance']);
    const st = await state().catch(() => ({}));
    const ph = await evalOk('(window.AppListen&&AppListen._debug()||{}).phase||""').catch(() => '');
    const grantOn = !!(got.grant || got.grantTail || got.grantBalance);
    return `provider=${got.provider || ''} grant=${grantOn} phase=${ph} history=${st.historyCount || 0}`;
  };
  await waitFor(async () => listenTrStorageOk(chatUrl), lim, snap);
  const sid = await evalOk('(window.AppListen && AppListen._debug() || {}).id || ""').catch(() => '');
  if (!sid) return;
  let hits0 = mockChatHits;
  for (let i = 0; i < 10; i++) {
    if (mockChatHits > hits0) return;
    hits0 = mockChatHits;
    await runAsync(`(async()=>{
      const d = AppListen._debug();
      const rows = d.rows || [];
      const row = rows.slice().reverse().find((r) => r && r.raw != null) || rows[rows.length - 1];
      if (row) await AppListen.retranslate(row, true);
      return 'ok';
    })()`, 25000);
    await sleep(350);
  }
  throw new Error(`等不到：会话 cfg.tr 已走假端点（mock=${mockChatHits}；${await snap()}）`);
}
async function afterBootPinListen() {
  await sleep(3500);
  await pinListenOfflineEngines();
  await sleep(400);
  await pinListenOfflineEngines();
  await sleep(400);
  await pinListenOfflineEngines();
}

async function reload() {
  await evalOk('location.reload(), true');
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try { if (await evalOk('!!(window.__mtTest && window.NativeSpeech)')) return; } catch (_) {}
    await sleep(400);
  }
  throw new Error('reload 后 30s 内页面没起来（__mtTest / NativeSpeech 不在）');
}

// 回到包屏（清 onboardSeen、钉语言对）。session 由 Keychain 继承（见文件头）——
// 没继承到的话包屏不可达，这里会红，红得有理（说明连登录态都没了，先手动开一次正版）。
// 「落定」不只是屏出来：下拉填上 + 探测行有字 —— 页面自己的 probePacks 还在跑时，
// 我们的 deviceStatus 会跟它撞桥（2026-10-05 实测：撞上就挂 30s），必须等它画完。
async function setupPacks(my, other) {
  await storageSet({ onboardSeen: false, listenMyLang: my, listenOtherLang: other });
  await reload();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (await visible('firstrun-packs')) break;
    await sleep(400);
  }
  okc(await visible('firstrun-packs'), `30s 内包屏没出来（pair=${my}/${other}）— 检查登录态是否被 Keychain 继承`);
  await waitFor(async () => {
    const my = await valueOf('packs-my-lang'), other = await valueOf('packs-other-lang');
    return !!my && !!other && !!(await textOf('pack-tts-state'));
  }, 20000, '包屏落定（下拉 + 探测行）');
}

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(250);
  }
  const detail = typeof what === 'function' ? what() : what;
  throw new Error(`等不到：${detail}（${ms}ms）`);
}

// 左录音键是否仍灰 —— 必须读 __mtTest.state().ptt.disabled（DOM）。
// __mtTest.ptt.state() 只有 on/side，没有 disabled；误用它会让「等就绪」立刻通过（M8/M9 假等、开麦 30s 超时）。
async function pttMineDisabled() {
  return !!(await evalOk('(__mtTest.state().ptt||{}).disabled'));
}
async function waitPttReady(ms, label) {
  await waitFor(async () => !(await pttMineDisabled()), ms || 120000, label || '听译页录音键就绪');
}

// ── 能力探针（step 0）─────────────────────────────────────────────────────────
async function probe() {
  log('\n═══ 能力探针（§0.4 step 0 — 先知道这台 Mac 能测什么）═══');
  try {
    const voices = execSync("say -v '?'", { env: cleanEnv(), encoding: 'utf8' });
    const pick = (re) => voices.split('\n').filter((l) => re.test(l)).map((l) => l.trim().replace(/\s+/g, ' '));
    const zh = pick(/\bzh[-_]/), en = pick(/\ben[-_]/), th = pick(/\bth[-_]/);
    log(`  say 语音：zh ${zh.length} · en ${en.length} · th ${th.length}${th.length ? '（' + th.map((l) => l.split(/\s{2,}/)[0]).join(', ') + '）' : ' —— 泰语音源走 afplay 或 App 自身 vits'}`);
  } catch (e) { log('  say 语音清单读不到：' + e.message); }
  for (const loc of ['zh', 'en', 'th']) {
    try {
      const v = await runAsync(`JSON.stringify(await NativeSpeech.probe('${loc}'))`);
      const j = JSON.parse(v || '{}');
      log(`  stt ${loc}: ok=${j.ok} assets=${j.assets} locales=${(j.locales || []).length}`);
    } catch (e) { log(`  stt ${loc}: 探测失败 ${e.message}`); }
  }
  try { log('  页面：' + JSON.stringify(await state())); } catch (e) { log('  页面状态读不到：' + e.message); }
}

// ── 输出静音（M 组确定性：不让 Mac 麦克风听到朗读 —— 那是 M3 物理版的事）─────────
let mutedRestore = null;
let inputVol = 0;   // muteOn 前的输入音量（跑完还原）
async function muteOn() {
  try {
    mutedRestore = execSync(`osascript -e 'output muted of (get volume settings)'`, { env: cleanEnv(), encoding: 'utf8' }).trim() === 'true';
    if (!mutedRestore) execSync(`osascript -e 'set volume output muted true'`, { env: cleanEnv(), stdio: 'ignore' });
    // **输入也要静音**（2026-10-09 round H 实测）：只听输出还不够 —— App 的朗读会从扬声器
    // 漏进 Mac 自己的麦克风（或房间里的声音），识别器把**真音频**一路送进串句器，注入的句子
    // 被并进一条永不收口的尾巴 ⇒ M2/M3/P-03 假红（现场里全是真 stt-final）。注入的用例本来
    // 就不需要真麦克风，所以把输入拉到 0，跑完还原。
    inputVol = Number(execSync(`osascript -e 'input volume of (get volume settings)'`, { env: cleanEnv(), encoding: 'utf8' }).trim());
    execSync(`osascript -e 'set volume input volume 0'`, { env: cleanEnv(), stdio: 'ignore' });
  } catch (_) { mutedRestore = null; }
}
async function muteOff() {
  if (mutedRestore === false) {
    try { execSync("osascript -e 'set volume output muted false'", { env: cleanEnv(), stdio: 'ignore' }); } catch (_) {}
  }
  mutedRestore = null;
}

// ── M 系列 case（§0.4 的表）───────────────────────────────────────────────────
// M1 包屏只下所选语言对的模型 — 没选泰语就不下 105 MB（a1e9a232）
// 模型全就绪后 step 直接跳引导屏、包屏不再出来 —— 所以**直接判据恒跑**（deviceStatus
// 按对过滤），UI 下载流程只在包屏出现时验（模型未装的容器 / CI 新装环境）。
async function m1() {
  await storageSet({ onboardSeen: false, listenMyLang: 'zh', listenOtherLang: 'en', listenPackLangs: ['zh', 'en'], listenPackThaiTts: false });
  await reload();
  await sleep(1200);
  // 直接判据（快而脆的不依赖下载）：deviceStatus 按对过滤后的 models 只含 zh/en。probePacks 同款 configure。
  const v = await runAsync(`(async()=>{
    LearnTTS.configure(Object.assign({}, LearnTTS.config, { engineId:'device', apiKey:'', baseUrl:'', model:'', voice:'' }));
    const st = await LearnTTS.deviceStatus('device', ['zh','en']);
    return JSON.stringify({ ready: st.ready, langs: (st.models||[]).map(m=>m.lang) });
  })()`);
  const j = JSON.parse(v || '{}');
  okc(j.langs.every((l) => ['zh', 'en'].indexOf(String(l).split('-')[0]) >= 0),
    'deviceStatus(["zh","en"]) 的模型表里有 zh/en 之外的语言：' + JSON.stringify(j.langs));
  if (!(await visible('firstrun-packs'))) return;   // 就绪态：包屏已被 step 跳过，UI 流程无从验
  await click('packs-go');
  const seen = [];
  await waitFor(async () => {
    const txt = (await textOf('pack-tts-state')) || '';
    if (txt && seen[seen.length - 1] !== txt) seen.push(txt);
    okc(!/(^|[^a-z])th([^a-z]|$)/.test(txt), '进度行出现了泰语：' + JSON.stringify(txt) + '（语言对是 zh/en）');
    const phase = await evalOk(`(document.getElementById('firstrun-packs')||{}).getAttribute('data-phase')`);
    // 改稿 F：下完停在包屏，要再点一次「进入实时听译」才离开。引导屏已撤。
    return phase === 'done' || (await visible('app-listen'));
  }, 600000, '包屏下完（含首次模型下载）');
  if (!(await visible('app-listen'))) await click('packs-go');
  await waitFor(() => visible('app-listen'), 30000, '进入实时听译');
  okc(seen.length === 0 || seen.every((t) => !/(^|[^a-z])th([^a-z]|$)/.test(t)),
    '进度行历史里出现过泰语：' + JSON.stringify(seen.slice(0, 5)));
}

// M6 语言对下载后不跳（#564：firstRunLocales 是集合没槽位，重画时对调）
// 两种形态：模型没就绪 ⇒ 包屏在 ⇒ 原样验「点下载→重画→对不跳」；模型已就绪 ⇒ step 直接
// 跳引导屏、包屏不再出来 —— 那就验 #564 的用户可见不变量：钉下的对 reload 后原样不动
// （显示、存储、使用三者锁死）。重画对调的机检在 npm test（app-firstrun R3 系列）。
async function m6() {
  await storageSet({ onboardSeen: false, listenPackLangs: ['zh', 'en'], listenPackThaiTts: false, listenMyLang: 'zh', listenOtherLang: 'en' });
  await reload();
  await sleep(1200);   // 命令式先画、React 后挂 —— 立刻点会点空（2026-10-05 实测三轮全空）
  if (await visible('firstrun-packs')) {
    await waitFor(async () => {
      const my = await valueOf('packs-my-lang'), other = await valueOf('packs-other-lang');
      return !!my && !!other && !!(await textOf('pack-tts-state'));
    }, 20000, '包屏落定');
    const beforeMy = await valueOf('packs-my-lang'), beforeOther = await valueOf('packs-other-lang');
    okc(!!beforeMy && !!beforeOther && beforeMy !== beforeOther, `多选没有算出一对：my=${beforeMy} other=${beforeOther}`);
    await click('packs-go');
    await sleep(3000);   // 下载那一下的重画（#564 的触发条件）就发生在头一两秒
    const afterMy = await valueOf('packs-my-lang'), afterOther = await valueOf('packs-other-lang');
    okc(afterMy === beforeMy && afterOther === beforeOther, `下载后语言对跳了：${beforeMy}/${beforeOther} → ${afterMy}/${afterOther}（#564）`);
  }
  const st = await storageGet(['listenMyLang', 'listenOtherLang', 'listenPackLangs']);
  okc(Array.isArray(st.listenPackLangs) && st.listenPackLangs.indexOf('zh') >= 0 && st.listenPackLangs.indexOf('en') >= 0,
    '勾选没有落盘：' + JSON.stringify(st));
  okc(st.listenMyLang && st.listenOtherLang && st.listenMyLang !== st.listenOtherLang,
    '落盘的一对不对：' + JSON.stringify(st) + '（显示、存储、下载三者要锁死）');
}

// ── 听译组（一个会话跑完 M7→M2→M3→M4→M5；顺序即依赖：M3 吃 M2 的朗读，M5 关自动朗读放最后）──
// 改稿 D：对话页启停＝底部那两个录音键（`__mtTest.ptt.toggle`，真点击）。
async function recOn(side) {
  await waitPttReady(120000, '开麦前录音键仍禁用（语言包/管道未就绪）');
  if ((await evalOk('__mtTest.ptt.state()')).on) return true;
  await evalOk(`__mtTest.ptt.toggle('${side || 'mine'}'), true`);
  await waitFor(async () => (await evalOk('__mtTest.ptt.state()')).on, 60000, '点录音键开麦');
  // 等**管道就绪**：ptt 是同步置位的，phase 要等 beginPipeline。注入/断言都得等它。
  await waitFor(async () => (await evalOk('AppListen._debug().phase')) === 'listening', 90000, '收音管道就绪');
  return true;
}
async function recOff() {
  if (!(await evalOk('__mtTest.ptt.state()')).on) return true;
  await evalOk(`__mtTest.ptt.toggle('mine'), true`);
  await waitFor(async () => !(await evalOk('__mtTest.ptt.state()')).on, 15000, '点录音键停止');
  return true;
}
async function setupListen() {  // 模型先行，且在 reload **之前**的安静页面上做 —— reload 后头几秒页面自己的探测
  // （probePacks / liveCapable）会跟我们的 ttsProbe 撞桥，撞上就挂（15 分钟那次的教训）。
  // zh/th 首次要下 vits 105MB。不先下，speak() 的 ensureDeviceReady 会被 speakPump
  // 30s 掐掉（#565 六轮的反静默规则，那是对的）—— 所以这里用同一入口把模型备齐。
  const v = await runAsync(`(async()=>{
    LearnTTS.configure(Object.assign({}, LearnTTS.config, { engineId:'device', apiKey:'', baseUrl:'', model:'', voice:'' }));
    const r = await LearnTTS.ensureDeviceReady(null, 'device', ['zh','th']);
    return JSON.stringify({ ok: r.ok, reason: r.reason || '' });
  })()`, 900000);
  log('    模型：' + v);
  // listenAutoSpeak 钉 true、ttsEngine 钉 'device'：容器与正版共享 —— 用户可能关过自动朗读，
  // 登录领过额度的话 ttsEngine 会被写成 grant_speech（云端中继，本机网络连不上后端 ⇒ 永无
  // tts-start）。M 组要验的是**本机**管线，两个都钉死。ttsEngine 必须在 reload **之后**写：
  // 开机的「登录即领额度」每回都会把它写回 grant_speech，先写必被覆盖（2026-10-05 实测）。
  await storageSet({ onboardSeen: true, listenMyLang: 'zh', listenOtherLang: 'th', listenAutoSpeak: true });
  await reload();
  await afterBootPinListen();
  await waitFor(() => visible('app-listen-entry'), 20000, '首页听译卡');
  await sleep(1500);   // 命令式先画、React 后挂 —— 立刻点会点空（三轮全空那次的教训）
  // 预热本机 TTS：首次 speak 要加载 sherpa 模型（几十秒量级）。**等 done、不硬 stop** ——
  // stop() 会打断加载中的引擎，把「预热」变成一次 reason:load 的真失败（第一版 th:false
  // 就是自伤的）。zh（kokoro）尤其必须热：M4/M5 的中文译文走它，冷加载 >30s 会把整场
  // 自动朗读关掉。
  try {
    const warm = await runAsync(`(async()=>{
      LearnTTS.configure(Object.assign({}, LearnTTS.config, { engineId:'device', apiKey:'', baseUrl:'', model:'', voice:'' }));
      const a = await LearnTTS.speak('อุ่นเครื่องแล้ว', 'th'); if (a.ok && a.done) { try { await a.done; } catch (_) {} }
      const b = await LearnTTS.speak('预热完成', 'zh'); if (b.ok && b.done) { try { await b.done; } catch (_) {} }
      return JSON.stringify({ th: a.ok, zh: b.ok });
    })()`, 150000);
    log('    TTS 预热：' + warm);
  } catch (e) { log('    TTS 预热失败（继续跑，M2/M5 可能慢）：' + e.message); }
  // 改稿 D：对话页进页**不再自动开麦** —— 启停靠底部那两个录音键（点一下开、再点一下停）。
  let live = false, lastErr = '';
  for (let attempt = 1; attempt <= 3 && !live; attempt++) {
    try {
      await click('app-listen-entry');
      await waitFor(() => visible('app-listen'), 8000, `听译页（第 ${attempt} 轮）`);
      await pinListenOfflineEngines();
      await muteOn();   // 输出静音：TTS 事件照流，Mac 麦克风听不到 —— 行数才确定
      await recOn();    // 点左录音键 = 开始收音（起会话 / 开麦）
      live = true;
    } catch (e) {
      lastErr = e.message;
      await muteOff();
      await reload();
      await waitFor(() => visible('app-listen-entry'), 20000, `重试第 ${attempt} 轮后首页`);
      await sleep(1500);
    }
  }
  okc(live, '三轮都没听起来：' + lastErr);
  await evalOk('__mtTest.ka(1), true');   // M5 长等待别被 30s 静音暂停误收
  await rec(1);
}
async function teardownListen() {
  try { await evalOk('__mtTest.ka(0), true'); } catch (_) {}
  try { await recOff(); } catch (_) {}
  try { await click('app-listen-back'); } catch (_) {}
  await sleep(400);   // leave() 的确认框是异步画的
  try {
    await evalOk(`(()=>{const bs=[...document.querySelectorAll('button')]; const b=bs.find(x=>/结束并离开/.test(x.textContent||'')); if(b){b.click(); return 'confirmed'} return 'no-dialog'})()`);
  } catch (_) {}
  await muteOff();
}
const THAI = /[\u0E00-\u0E7F]/;
const thaiOf = (rowText) => (String(rowText).match(/[\u0E00-\u0E7F][\u0E00-\u0E7F\s，。！？!]*/g) || []).join(' ').trim();
const seenTtsIds = new Set();   // 跨 case 记已见的 tts 任务 id（M5 判「新开口」用）

// 历史断言一律按**内容**不按条数：0 行时的占位文案会被第一条真行替换（1→1），
// 条数算术永远对不上（2026-10-05 实测栽在这上面）。history 是行文本数组。
async function waitRow(substr, ms) {
  await waitFor(async () => {
    const s = await state();
    return (s.history || []).some((r) => r.includes(substr));
  }, ms || 20000, `行落下来：包含「${substr}」`);
}
async function noRow(substr, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state();
    if ((s.history || []).some((r) => r.includes(substr))) return false;
    await sleep(300);
  }
  return true;
}

// 等朗读队列**念完**（最后一个 tts 事件是 end 且 1.2s 无新 start）。M3/M5 共用：
// 队列串行，不等排空的话「下一个 tts-start」可能属于上一句，计数全乱。
async function drained() {
  const ev = (await rec()).filter((e) => e && (e.type === 'tts-start' || e.type === 'tts-end'));
  if (!ev.length || ev[ev.length - 1].type !== 'tts-end') return false;
  await sleep(1200);
  const ev2 = (await rec()).filter((e) => e && (e.type === 'tts-start' || e.type === 'tts-end'));
  return ev2.length === ev.length;
}

// 等**真的安静**（朗读队列排空）：轮询到最后一条 tts 事件是 end 且再等 1.2s 没有新的。
// 与 `drained()` 的区别：`drained()` 在「正在念」时立刻返回 false（不等待）—— 注入类用例需要的是
// 「等到安静」，不是「现在安静吗」。为什么必须等：`echo.playingLangs()` 会整门挡住**正在朗读的
// 那个语言**，注入同语言文本会被回声闸正当丢掉（M7/P-03 各红过一次，2026-10-08）。
async function quiet(ms) {
  const tail = async () => (await rec()).filter((e) => e && (e.type === 'tts-start' || e.type === 'tts-end'));
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const a = await tail();
    if (a.length && a[a.length - 1].type === 'tts-end') {
      await sleep(ms || 1200);
      const b = await tail();
      if (b.length === a.length) return true;
    }
    await sleep(300);
  }
  return false;
}

// 改稿 D：**收音侧决定「这一句按谁的语言识别」**。M 组各条注入的语言不同 ⇒ 各自把收音侧摆对；
// 不摆的话，注入语言与收音侧不符时会被归属闸**整句丢掉**（round J 的 M3/M4/M5/M7 就是这么红的：
// 它们在 setup 的「我说中文」侧注入泰语，而「点谁就按谁识别、不跑判定」正是改稿 D 的规则）。
async function recSide(side) {
  // **侧名归一**：模型的侧只有 'me' / 'other'（`__mtTest.ptt.state().side` 报的就是这两个），
  // 而按钮/视图那边叫 'mine'。第一版助手直接拿 'mine' 去比 ⇒ 永远判成「异侧」⇒ 去点左键 ⇒
  // 而左键正是当前侧 ⇒ 点成了**停车**（round K：M7/M2 现场 `phase=paused`）。
  const want = side === 'other' ? 'other' : 'me';
  const st = await evalOk('__mtTest.ptt.state()');
  if (st.on && st.side === want) return;
  if (st.on) { await evalOk(`__mtTest.ptt.toggle('${want}'), true`); await sleep(600); return; }
  await startRec(want);
}
async function m7(ctx) {
  await recSide('me');                       // 第一句是中文 ⇒ 收音侧摆到「我说中文」
  await say('今天我们测试翻译。', 'zh-CN');
  await waitRow('今天我们测试翻译');
  // 第二句要**词汇远离**任何可能被朗读的译文：先前用「การทดสอบ」跟 zh 句的泰语译文
  // 撞了 bigram，被回声闸**正当**吞掉（那是它在干活，不是 case 的失败）。
  // 但光远离词还不够 —— 第一句的**译文是泰语**，朗读期间 `echo.playingLangs()` 会整门挡住泰语，
  // 第二句（也是泰语）照样被丢 ⇒ 这条用例偶发红。等朗读排空再注入（2026-10-08 三次里红两次）。
  await quiet();
  await recSide('other');                    // 第二句是对方（泰语）⇒ 换到泰语侧
  await say('ที่นี่ขายกาแฟหรือเปล่า', 'th');
  await waitRow('กาแฟ');   // 第二句成行（累积不覆盖）
  const s = await state();
  okc((s.history || []).some((r) => r.includes('今天我们测试翻译')), '第一句被第二句覆盖了 —— 历史没有累积');
}

async function m2(ctx) {
  await pinListenOfflineEngines();        // autoClaim 可能在中途又把 provider 写回 grant
  await recSide('me');                    // 这一条注入中文 ⇒ 收音侧摆回「我说中文」
  // 注入前等朗读排空：上一轮 M7 之后可能还有译文在念，同语言注入会被回声闸正当丢掉。
  await quiet();
  okc(mockChatPort > 0, '假翻译端点没起来');
  await waitListenTrLive(`http://127.0.0.1:${mockChatPort}/v1/chat/completions`, 25000);
  await say('请问去火车站怎么走？', 'zh-CN');
  await waitFor(async () => {
    const s = await state();
    return (s.history || []).some((r) => r.includes('请问去火车站') && THAI.test(r));
  }, 90000, 'zh 句成行且带泰语译文');
  await waitFor(async () => (await rec()).some((e) => e && e.type === 'tts-start'), 60000, 'tts-start（朗读真走了管线）');
  await waitFor(async () => (await rec()).some((e) => e && e.type === 'tts-end'), 60000, 'tts-end');
  const s = await state();
  const row = (s.history || []).filter((r) => r.includes('请问去火车站')).pop() || '';
  ctx.spokenThai = thaiOf(row);
  okc(!!ctx.spokenThai, '从行里提不出泰语文本：' + JSON.stringify(row.slice(0, 80)));
}

// M3 自己念的被认回来 ⇒ 拦住。注入版：tts-end 后 3s 窗内把念过的泰语喂回麦克风。
// （物理版 —— 扬声器出声被麦克风采回 —— 是 §0.4 音频层的真回环，静音状态下另案观察。）
async function m3(ctx) {
  if (!ctx.spokenThai) throw new Error('M2 没跑成（没有可回声的泰语）—— 先看 M2 的失败');
  await recSide('other');                    // 这一条注入的是泰语 ⇒ 收音侧摆到泰语侧
  // 等「M2 那句泰语真的被念」：拿 AppListen._debug().lastSpoken 对上 —— 事件静默不可信
  // （kokoro 念完逐出 vits、泰语要重装引擎，几秒无声会被误判成排空，2026-10-05 实测）。
  const norm = (x) => String(x || '').replace(/\s+/g, '');
  const probe = norm(ctx.spokenThai).slice(2, 14);
  let lastSeen = '';
  await waitFor(async () => {
    const d = await evalOk('(window.AppListen && AppListen._debug() || {}).lastSpoken || ""');
    lastSeen = d;
    return norm(d).includes(probe);
  }, 90000, () => `M2 的泰语真的被念了（lastSpoken 对上；现在=${lastSeen.slice(0, 40)}）`);
  // 它念完（最后一个 tts 事件是 end）⇒ 立即注入 —— 竗窗 3s，poll 延迟 ~150ms 绰绰有余。
  await waitFor(async () => {
    const ev = (await rec()).filter((e) => e && (e.type === 'tts-start' || e.type === 'tts-end'));
    return ev.length > 0 && ev[ev.length - 1].type === 'tts-end';
  }, 30000, '最后一句念完');
  // 断言按**新增行**算，不能全表搜：念过的泰语本来就在 M2 那一行的译文里（第一版就这么
  // 假红过 —— 闸可能拦得好好的，断言瞎了）。
  // 行**按前缀做键**：M2 那一行的译文会异步从「临时」变成「修正」，整行文本因此会变 ——
  // 按整串做差集会把「同一行」当成新行（2026-10-08 实测到的假红）。原文那一段不变，取前 12 字。
  const keyOf = (r) => String(r).slice(0, 12);
  const beforeKeys = new Set((await state()).history.map(keyOf));
  // 注入「**真的念出去的那一句**」（`lastSpoken`，speak 那一刻记下的），而不是 ctx 里那份译文：
  // M2 的译文会先临时、后修正，两份文本不同 ⇒ token 重合度掉到门限以下 ⇒ 闸没拦就假红
  // （2026-10-08 实测到过一次）。用例的语义本来就是「麦克风听到了我们刚放出去的那一声」。
  const spoken = await evalOk('(window.AppListen && AppListen._debug() || {}).lastSpoken || ""');
  const echoed = spoken || ctx.spokenThai;
  okc(!!echoed, 'M3 拿不到念出去的文本（lastSpoken 空）');
  await say(echoed, 'th');
  await sleep(4000);   // ECHO_TAIL_MS=3000 + 定稿余量
  const after = (await state()).history;
  const newRows = after.filter((r) => !beforeKeys.has(keyOf(r)));
  okc(!newRows.some((r) => r.includes(echoed.slice(0, 12))),
    `回声没拦住：念过的泰语「${echoed.slice(0, 20)}…」又成了一行（新增 ${newRows.length} 行）`);
  // 之前落的行还在（拦的是这一句，不是整个历史）
  okc(after.some((r) => r.includes('请问去火车站')), '回声拦截把别人的行也吞了');
}

async function m4(ctx) {
  // 朗读**念完之后**对方回话 —— 这才是现实里的插话时机（不是在我们出声期间抢话）。
  // 「播放进行中 + 同语言」那道闸（回声修）只覆盖我们自己出声期间；念完后仍走文字闸，不同的话照收。
  await waitFor(drained, 60000, 'M4 起算前：朗读队列排空');
  await recSide('other');                    // 对方的话是泰语 ⇒ 收音侧摆到泰语侧
  await say('ฉันหิวข้าวมาก', 'th');
  await waitRow('หิวข้าว', 15000);   // 对方的新句成行（不误杀）
}

// M5 TTS 失败不得**静默堵死**队列（#565 六轮，88 号包）。事件注入版：连杀三句在途朗读，
// 每杀一句后断言**下一句照样成行、照样开口** —— 泵不死、队列不堵，这就是六轮规则的本义。
// 「assets/timeout 即报」的半边：注入够不着（speakOut 启动后返回 ok:true，在途失败只打死
// done，泵看不见 —— 这本身是 #565 的后续发现，已立项），由 npm test 的 speakPump/即报门钉着。
async function m5() {
  await waitFor(drained, 60000, '朗读队列排空（M5 要干净起算）');
  await recSide('other');                    // 三句都是泰语 ⇒ 收音侧摆到泰语侧
  const S = ['วันนี้อากาศดีมากเลย', 'เท่าไหร่สำหรับสองคน', 'ทางไหนไปสนามบิน'];
  for (let i = 0; i < S.length; i++) {
    await say(S[i], 'th');
    await waitRow(S[i].slice(0, 8), 30000);
    let id = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && id === null) {
      const st = (await rec()).filter((e) => e && e.type === 'tts-start' && !seenTtsIds.has(e.id)).pop();
      if (st) id = st.id;
      else await sleep(120);
    }
    okc(id != null, `第 ${i + 1} 句 60s 内没有 tts-start —— 朗读管线没起来`);
    seenTtsIds.add(id);
    await evalOk(`NativeSpeech._fromNative(${JSON.stringify({ type: 'tts-failed', id, reason: 'network' })})`);
    await sleep(600);
  }
  // 三杀之后：队列必须还活着 —— 再来一句，成行且开口。
  await say('พอกันทีสำหรับวันนี้', 'th');
  await waitRow('พอกันที', 30000);
  let id = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && id === null) {
    const st = (await rec()).filter((e) => e && e.type === 'tts-start' && !seenTtsIds.has(e.id)).pop();
    if (st) id = st.id;
    else await sleep(120);
  }
  okc(id != null, '连杀三句后第四句没有开口 —— 队列被 TTS 失败堵死了（#565 六轮要防的正是这个）');
  okc((await evalOk(`(document.getElementById('app-listen-pill')||{className:''}).className.indexOf('live')>=0`)),
    '三杀之后听译会话掉了');
}

// M8 听译进场只下当前语言对 — zh/en 对话不得拉泰语（2026-10-06，90 号包真机：中英对话顶栏
// 「正在下载ไทย离线模型 · 46%」、堵在「准备中…」）。复现 90 的真实状态：**删掉泰语模型**
// （全新装 + 包屏按 zh/en 正确省下 105MB），起一场 zh/en 听译 —— 修复后应零泰语事件、直接开听。
// Mac 层此前的盲区：M 组预装了全部模型，把 beginPipeline 这条路遮住了。
async function m8() {
  const MS = path.join(process.env.HOME, 'Library/Containers/com.belliedmonkeytranslator/Data/Library/Application Support/mt-speech');
  const VITS = path.join(MS, 'vits-mms-tha');
  const ZIPOK = '/private/var/folders/hl/tn2f_lxj3ys9xy4990rrcdb40000gn/T/opencode/vits-mms-tha.zip';
  const STAMP = '.installed-26ee310a040d3444a9240ba3591b0bee7b316ba9cbd6da9de6e582db97089250';
  const hadVits = fs.existsSync(path.join(VITS, 'model.onnx'));
  fs.rmSync(VITS, { recursive: true, force: true });
  const restore = () => {
    try {
      if (hadVits && fs.existsSync(ZIPOK)) {
        execSync(`unzip -q -o "${ZIPOK}" -d "${VITS}"`, { env: cleanEnv(), stdio: 'ignore' });
        execSync(`touch "${VITS}/${STAMP}"`, { env: cleanEnv(), stdio: 'ignore' });
        log('    （泰语模型已还原）');
      }
    } catch (_) {}
  };
  try {
    await storageSet({ onboardSeen: true, listenMyLang: 'zh', listenOtherLang: 'en', listenAutoSpeak: true });
    await relaunchApp();
    await afterBootPinListen();
    await waitFor(() => visible('app-listen-entry'), 20000, 'M8 首页听译卡');
    await sleep(1500);
    await click('app-listen-entry');
    await waitFor(() => visible('app-listen'), 8000, 'M8 听译页');
    await pinListenOfflineEngines();
    await waitPttReady(120000, 'M8 开听前录音键一直禁用（语言包/管道没就绪）');
    await recOn();
    // 修复后：模型全就绪（kokoro 在），这里应该几秒内就 live —— 不下任何东西
    await waitFor(() => evalOk(`(document.getElementById('app-listen-pill')||{className:''}).className.indexOf('live')>=0`), 20000,
      'zh/en 开听没在 20s 内起来（被什么东西堵住了 —— 是不是又在下泰语？）');
    // 全程零泰语事件（探测的 missing/installed、下载的 progress 都不许出现）
    const thHit = await evalOk(`__mtTest.rec().some(e => String((e && e.locale) || '').split('-')[0].toLowerCase() === 'th')`);
    okc(!thHit, '进场探测/下载了泰语 —— beginPipeline 还是全量（90 真机那条）');
    // H12 / R-03：已经装好的包，进听译时**一条 downloading 都不该有**（重下 = 白花用户的流量）。
    const redl = await evalOk(`__mtTest.rec().filter(e => (e.type||'') === 'assets-progress' && e.state === 'downloading').length`);
    okc(redl === 0, '已装好的包又下了一遍（assets-progress downloading × ' + redl + '）');
  } finally {
    await evalOk('__mtTest.ka(0), true').catch(() => {});
    try { await recOff(); } catch (_) {}
    restore();
  }
}

// M9 听译内切语言要按新对补包 — zh/en 起听后切泰语，泰语包当场下载并就绪（92 号包真机：
// 此前必须退出重进才会下）。fixture 与 M8 同款：删掉 vits 模拟「首启 zh/en 只下英语包」。
// 切完后 App 自己下载并安装（就绪后无需还原 —— 下载即还原）。
async function m9() {
  const MS = path.join(process.env.HOME, 'Library/Containers/com.belliedmonkeytranslator/Data/Library/Application Support/mt-speech');
  fs.rmSync(path.join(MS, 'vits-mms-tha'), { recursive: true, force: true });
  await storageSet({ onboardSeen: true, listenMyLang: 'zh', listenOtherLang: 'en', listenAutoSpeak: true });
  await relaunchApp();
  await afterBootPinListen();
  await waitFor(() => visible('app-listen-entry'), 20000, 'M9 首页听译卡');
  await sleep(1500);
  await click('app-listen-entry');
    await waitFor(() => visible('app-listen'), 8000, 'M9 听译页');
    await pinListenOfflineEngines();
    await waitPttReady(120000, 'M9 开听前录音键一直禁用');
    await recOn();
    await waitFor(() => evalOk(`(document.getElementById('app-listen-pill')||{className:''}).className.indexOf('live')>=0`), 20000, 'M9 zh/en 开听');
  await evalOk('__mtTest.rec(1), true');
  // 切「对方的语言」到泰语 —— 应当场触发泰语包下载（复用「准备中/下载」态）
  await setValue('app-listen-other', 'th');
  const sawTh = await waitFor(async () => evalOk(`__mtTest.rec().some(e => String((e && e.locale) || '').split('-')[0].toLowerCase() === 'th')`), 60000,
    () => '切泰语后 60s 内没有泰语包动作（探测/下载）—— 没按新对补包');
  // 下载完成：th 模型就绪 + 会话回到 live（真实下载 ~105MB，给足时间）
  await waitFor(async () => evalOk(`(document.getElementById('app-listen-pill')||{className:''}).className.indexOf('live')>=0`), 480000, '切泰语后会话没有恢复 live（下载卡住或没自动继续）');
  // 完成判据 = 进度在推进（3 分钟内 fraction 上涨或已装）：App 下载器经这条网络实测
  // 40s–30min 方差巨大，墙钟等不完整个 105MB。完成与就绪由紧随的 M2 证明 —— 它的
  // setupListen ensure 会阻塞等同一个下载器收尾再念泰语。
  const lastTh = async () => JSON.parse(await evalOk(`(()=>{const ev=__mtTest.rec().filter(e=>(e.type||"")==="assets-progress"&&String(e.locale||"").split("-")[0]==="th"); return JSON.stringify(ev[ev.length-1]||null)})()`) || 'null');
  let baseline = await lastTh();
  await waitFor(async () => {
    const cur = await lastTh();
    const adv = cur && (cur.state === 'installed' || (Number(cur.fraction) || 0) > (Number(baseline && baseline.fraction) || 0));
    if (cur && cur.state === 'downloading') baseline = cur;
    return !!adv;
  }, 180000, '泰语包进度没有推进（没在真下载）');
  // 只下新对：全程没有 en 的下载事件（en 已装，不该有任何 en 动作）
  okc(!(await evalOk(`__mtTest.rec().some(e => String((e && e.locale) || '').split('-')[0].toLowerCase() === 'en' && (e.state === 'downloading' || e.fraction > 0 && e.fraction < 1))`)),
    '切泰语时连带动了英语包 —— 只该下新对需要的');
}

const CASES = [
  { id: 'M1', what: '包屏只下所选语言对的模型', impl: m1 },
  { id: 'M6', what: '语言对下载后不跳', impl: m6 },
  { id: 'M8', what: '听译进场只下当前对（zh/en 不拉泰语 — 90 真机）', impl: m8 },
  { id: 'M9', what: '听译内切语言按新对补包（zh/en 切泰语当场下 — 92 真机）', impl: m9 },
];

// ── P 组：录音两键（改稿 D，2026-10-09：点一下开 / 停）──────────────────────────────
// 驱动的是**真按钮上的真点击**（`__mtTest.ptt`，H3）。每一条都先 ensureIdle() —— toggle 是
// **有状态**的（同侧＝停、异侧＝换边），起点不干净会撞成「停」而不是「开」。
async function ensureIdle() {
  const st = await evalOk('__mtTest.ptt.state()');
  if (st.on) {
    await evalOk(`__mtTest.ptt.toggle('${st.side || 'mine'}'), true`);
    await waitFor(async () => !(await evalOk('__mtTest.ptt.state()')).on, 12000, '先停掉上一幕的收音');
  }
  await sleep(300);
}
async function startRec(side, ms) {
  await ensureIdle();
  await evalOk(`__mtTest.ptt.toggle('${side || 'mine'}'), true`);
  await waitFor(async () => (await evalOk('__mtTest.ptt.state()')).on, ms || 25000, '点一下开始收音');
  // 等管道就绪（ptt 同步置位，phase 要等 beginPipeline）—— 否则断言/注入会跑在 preparing 上。
  await waitFor(async () => (await evalOk('AppListen._debug().phase')) === 'listening', 90000, '收音管道就绪');
}
async function stopRec(ms) {
  const st = await evalOk('__mtTest.ptt.state()');
  if (!st.on) return;
  await evalOk(`__mtTest.ptt.toggle('${st.side}'), true`);
  await waitFor(async () => !(await evalOk('__mtTest.ptt.state()')).on, ms || 12000, '点同一侧停止收音');
}
// 关掉自动朗读再注入：免得 App 正念着这门语言，注入的同语言句子被回声闸整门挡掉（旧用例的坑）。
async function autospeakOff() {
  const on = await evalOk(`!!(document.getElementById('app-listen-autospeak')||{}).checked`);
  if (on) await click('app-listen-autospeak');
  return on;
}
async function autospeakRestore(on) { if (on) { try { await click('app-listen-autospeak'); } catch (_) {} } }

async function p01() {
  await ensureIdle();                                   // 未收音：小字应是「点一下开始」
  const s = await state();
  const p = s.ptt || {};
  okc(p.shown, '听译页没有那条按钮条');
  okc(p.mine === '说中文', '左键不是「说中文」：' + p.mine);
  okc(p.mineHint === '点一下开始', '未收音时左键小字不是「点一下开始」：' + p.mineHint);
  okc(p.otherName === 'ไทย', '右键不是本名「ไทย」：' + p.otherName);
  okc(p.otherHint === '点一下开始', '右键小字也该跟界面语言（改稿 D 取消「那门语言的小字」）：' + p.otherHint);
  okc(!p.disabled, '会话可用，按钮条却是灰的');

  const geo = JSON.parse(await evalOk(`(()=>{
    const one=(id)=>{const e=document.getElementById(id); if(!e) return null;
      const cs=getComputedStyle(e), r=e.getBoundingClientRect();
      const m=/rgba?\\(([^)]+)\\)/.exec(cs.backgroundColor);
      const parts=m?m[1].split(',').map(x=>parseFloat(x)):[];
      const alpha=parts.length===4?parts[3]:(parts.length===3?1:0);
      return {bg:cs.backgroundColor, alpha, radius:parseFloat(cs.borderTopLeftRadius)||0,
              h:Math.round(r.height), w:Math.round(r.width)};};
    return JSON.stringify({mine:one('app-listen-ptt-mine'), other:one('app-listen-ptt-other')});})()`));
  okc(!!geo.mine && !!geo.other, '按钮条的两半没找到：' + JSON.stringify(geo));
  for (const [side, g] of [['左键', geo.mine], ['右键', geo.other]]) {
    if (!g) continue;
    okc(g.alpha === 1, side + '底色不是不透明：' + g.bg);
    okc(g.radius > 0, side + '没有圆角：' + g.radius);
    okc(g.h >= 60, side + '高度不足 60：' + g.h);
  }
  if (geo.mine && geo.other) {
    okc(Math.abs(geo.mine.w - geo.other.w) < 2, '两半不等宽：' + geo.mine.w + ' vs ' + geo.other.w);
  }
}

async function p02() {
  const auto = await autospeakOff();
  try {
    await evalOk('__mtTest.lidMute(1), true');
    await evalOk('__mtTest.rec(1), true');
    await startRec('other');
    const st0 = await evalOk('__mtTest.ptt.state()');
    okc(st0.lidPaused === true, '开始收音没有暂停语种判定');
    okc((await evalOk('AppListen._debug().phase')) === 'listening', '收音中 phase 不是 listening');
    await quiet();
    await evalOk(`__mtTest.partial('ผมอยากไปเชียงใหม่', 'th'), true`);
    await evalOk(`__mtTest.say('ผมอยากไปเชียงใหม่ปีหน้า', 'th'), true`);
    await sleep(1200);
    await stopRec();
    await waitRow('เชียงใหม่', 25000);
    const s = await state();
    const row = (s.history || []).filter((r) => r.includes('เชียงใหม่')).pop() || '';
    okc(row.includes('ไทย'), '录音键说的那行标签不是本名 ไทย：' + row);
    const after = await evalOk('__mtTest.ptt.state()');
    okc(!after.on && after.lidPaused === false, '再点一下没有停止收音 / 没恢复自动识别：' + JSON.stringify(after));
    okc((await evalOk('AppListen._debug().phase')) === 'paused', '停止收音后 phase 不是 paused（麦克风该关）');
    const paused = (await rec()).filter((e) => e && e.type === 'lid-paused');
    okc(paused.some((e) => e.on === 1) && paused.some((e) => e.on === 0),
      '原生没收到「暂停判定 / 恢复判定」两条：' + JSON.stringify(paused.slice(0, 4)));
  } finally { await autospeakRestore(auto); }
}

async function p03() {
  const auto = await autospeakOff();
  try {
    await evalOk('__mtTest.lidMute(1), true');
    await startRec('mine');
    await quiet();
    await evalOk(`__mtTest.partial('明天早上八点出发', 'zh-CN'), true`);
    await evalOk(`__mtTest.say('明天早上八点出发。', 'zh-CN'), true`);
    await sleep(1400);
    // 点另一个键 = 先收口这一句、换到那一侧**继续收音**（麦不重开）。
    await evalOk(`__mtTest.ptt.toggle('other'), true`);
    const mid = await evalOk('__mtTest.ptt.state()');
    okc(mid.on && mid.side === 'other', '点另一个键没有换边继续收音：' + JSON.stringify(mid));
    await waitRow('明天早上八点出发', 20000);
    const row = ((await state()).history || []).filter((r) => r.includes('明天早上八点出发')).pop() || '';
    okc(row.includes('中文'), '换边前那行标签不是「中文」：' + row);
    await evalOk(`__mtTest.say('ขอบคุณมากครับ', 'th'), true`);
    await sleep(1200);
    await stopRec();
    await waitRow('ขอบคุณ', 20000);
  } finally { await autospeakRestore(auto); }
}

async function p05() {
  // 改稿 D：对话页**撤掉了静音自动停**（「一直录到你点停」）。开始收音后静 4 秒，必须仍在收音。
  await startRec('mine');
  const t0 = Date.now();
  await sleep(4000);
  const st = await evalOk('__mtTest.ptt.state()');
  okc(st.on, '收音 4 秒没声音就自己停了 —— 对话页不该有静音自动停');
  okc(Date.now() - t0 >= 3800, '等待时长不对（' + (Date.now() - t0) + 'ms）');
  okc((await evalOk('AppListen._debug().pauseReason')) !== 'silence', '静音门又咬上了');
  await stopRec();
}

async function p06() {
  const n0 = await evalOk('__mtTest.translateCalls()');
  const rows0 = ((await state()).history || []).length;
  await startRec('other');
  await sleep(1400);
  await stopRec();
  await sleep(1200);
  okc(((await state()).history || []).length === rows0, '没出声却落了一行');
  okc((await evalOk('__mtTest.translateCalls()')) === n0, '没出声却发了翻译请求');
}

async function p07() {
  await ensureIdle();
  const actionsHidden = await evalOk(`(()=>{const e=document.getElementById('app-listen-actions'); return !!(e && e.hidden)})()`);
  okc(actionsHidden, '对话页还显示着「正在听·暂停」大按钮');
  await startRec('mine');       // 停止之后**还能再点开**（停止 ≠ 结束整场）
  await stopRec();
  const s = await state();
  okc(!s.ptt.disabled, '停止收音后按钮不该变灰（随时能再点）');
}

async function p12() {
  const r = await evalOk(`(()=>{const rows=[...document.querySelectorAll('#app-listen-history > *')];
    const row=rows.find(x=>/เชียงใหม่/.test(x.textContent||'')); if(!row) return JSON.stringify({row:false});
    return JSON.stringify({row:true, swap:!!row.querySelector('.listen-swap'),
      acts:((row.querySelector('.listen-row-acts')||{}).textContent||''), who:((row.querySelector('.listen-who')||{}).textContent||'')})})()`);
  const o = JSON.parse(r);
  okc(o.row, 'P-02 那行已经不在历史里了（后面的 case 把它挤掉了？）');
  okc(!o.swap, '录音键说的行还画着 ↔（语言是人指定的，没有「判错」这回事）');
  okc(/朗读|给对方看/.test(o.acts), '录音键说的行少了朗读 / 给对方看：' + o.acts);
  okc(o.who.trim() === 'ไทย', '录音键说的行标签不是 ไทย：' + o.who);
  await evalOk('__mtTest.lidMute(0), true');
}

// P-08（**A 案**，2026-10-09 用户裁定）：收音期间**不冻**朗读队列 —— 判据就是「录着的时候译文照样念」。
// （旧的 vbD0C「按下停朗读 + 冻队列」已撤：收音＝常开，冻住就等于自动朗读永不发声。）
async function p08() {
  const on = await evalOk(`!!(document.getElementById('app-listen-autospeak')||{}).checked`);
  if (!on) await click('app-listen-autospeak');
  try {
    await quiet();
    await evalOk('__mtTest.rec(1), true');
    await startRec('mine');
    await evalOk(`__mtTest.lid('zh'), true`);   // 显式判词（say 的判词按语言去重）：让这句落行并念出来
    await sleep(700);
    await evalOk(`__mtTest.say('收音的时候译文照样念。', 'zh-CN'), true`);
    await waitRow('收音的时候译文照样念', 20000);
    await waitFor(async () => (await rec()).some((e) => e && e.type === 'tts-start'), 40000,
      '收音期间译文没有念出来（队列被冻住了 —— A 案要求不冻）');
  } finally { await stopRec(); }
}

const LISTEN_CASES = [
  // **顺序有讲究（2026-10-09 round L）**：M2 必须在 M7 前面。
  // M2 注入中文，而**前一条的收尾朗读**如果是中文就会撞回声窗口（`playingLangs`/`isEcho` 的尾巴）
  // —— M7 收尾读的是「泰语→中文」的译文（中文）⇒ 紧随其后的 M2 屡次被正当丢掉。
  // 排成 M2 → M7 之后：M2 前面没有朗读；M7 注入的是中文，而 M2 收尾读的是泰语译文 ⇒ 语言不同不撞。
  // （M3 依赖 M2 的 ctx.spokenThai，所以 M3 仍在 M2 之后。）
  { id: 'M2', what: 'zh 输入 → th 译文 → 朗读出声', impl: m2 },
  // **M3 必须紧贴 M2**：M3 的判据是「M2 那句泰语**还在** `lastSpoken` 里」（它要拿那句去喂回麦克风）。
  // 中间插任何会朗读的用例都会把 lastSpoken 顶掉（round M：M7 插在中间 ⇒ M3 红）。
  { id: 'M3', what: '自己念的被认回来 → 拦住（注入版回声）', impl: m3 },
  { id: 'M7', what: '多轮对话历史逐行累积', impl: m7 },
  { id: 'M4', what: '对方说不同的话 → 放行（不误杀）', impl: m4 },
  { id: 'M5', what: 'TTS 失败不静默堵死（连杀三句，队列仍活）', impl: m5 },
  // P 组（改稿 D，2026-10-09）：在同一个 zh↔th 会话里跑。
  { id: 'P-01', what: '按钮条：文案（本名）+ 两键小字（界面语言）+ 可视样式', impl: p01 },
  { id: 'P-02', what: '点一下 ⇒ 开始收音（开麦 / 暂停判定）；再点 ⇒ 停止并落行', impl: p02 },
  { id: 'P-03', what: '点另一个键 ⇒ 先收口、换边继续收音（两行标签各对）', impl: p03 },
  { id: 'P-05', what: '静音不自动停（对话页撤了静音门）', impl: p05 },
  { id: 'P-06', what: '点开、没出声、再点停 ⇒ 不落行、0 次翻译', impl: p06 },
  { id: 'P-07', what: '对话页没有「正在听·暂停」大按钮；停止后还能再点开', impl: p07 },
  { id: 'P-08', what: '收音期间朗读照常（A 案：队列不冻）', impl: p08 },
  { id: 'P-12', what: '录音键说的行 = 普通行，但没有 ↔', impl: p12 },
];

async function runCases() {
  log('\n═══ M 系列 case ═══');
  let fail = 0;
  for (const c of CASES) {
    try { await c.impl({}); log(`  ✓ ${c.id} ${c.what}`); }
    catch (e) { fail++; log(`  ✗ ${c.id} ${c.what} —— ${e.message}`); shot(c.id); }
  }
  // 听译组：一个会话（zh↔th），case 之间有依赖，逐个失败逐个报。
  // 起点必须是**新鲜 App**（见 relaunchApp 注释）—— 旧进程里的会话风暴会吃掉一切注入。
  const ctx = {};
  let session = false;
  try {
    log('  ▶ 重启 Debug 包（听译组要干净进程）');
    await relaunchApp();
    log('  ▶ 听译组 setup（zh↔th，模型备齐，输出静音）');
    await setupListen();
    session = true;
  } catch (e) {
    log(`  ✗ 听译组 setup —— ${e.message}`); shot('listen-setup');
  }
  if (session) {
    for (const c of LISTEN_CASES) {
      try { await c.impl(ctx); log(`  ✓ ${c.id} ${c.what}`); }
      catch (e) {
        fail++;
        log(`  ✗ ${c.id} ${c.what} —— ${e.message}`);
        try {
          const dump = await evalOk(`JSON.stringify({t:(document.getElementById("app-listen-toggle")||{textContent:""}).textContent.trim(), n:(document.getElementById("app-listen-note")||{textContent:""}).textContent.trim().slice(0,60), st:__mtTest.state().historyCount, dbg:(()=>{try{const d=window.AppListen&&AppListen._debug(); return d?{echoDropped:d.echoDropped, lastSpoken:(d.lastSpoken||"").slice(0,40), autoSpeakOff:d.autoSpeakOff, speakQueue:d.speakQueue, phase:d.phase}:null}catch(e){return "err"}})(), ev:__mtTest.rec().slice(-8)})`);
          log('    现场：' + dump);
        } catch (_) {}
        shot(c.id);
      }
    }
    await teardownListen().catch(() => muteOff());
  }
  return fail;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  try { await stashS(evalOk); } catch (_) {}   // 先存原值（拿不到就继续，不挡测试）
  // 系统输出音量/静音也要还（2026-10-08 用户拍板）：这个脚本为了量音频会把输出静音，
  // 而它**不在 chrome.storage 里** —— 忘了还，用户下次放声音就是静音的（当天实测踩到过）。
  try {
    volBefore = {
      muted: execSync(`osascript -e 'output muted of (get volume settings)'`).toString().trim(),
      volume: execSync(`osascript -e 'output volume of (get volume settings)'`).toString().trim(),
    };
  } catch (_) { volBefore = null; }
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
  log('  ✓ 端点通了（' + BASE + '）');

  await startMockChatServer();
  log('  ✓ 假翻译端点 127.0.0.1:' + mockChatPort);

  await probe();
  if (probeOnly) return 0;

  const fail = await runCases();
  log(fail ? `\n✗ ${fail} 个 case 红` : '\n✓ M 系列全绿');
  return fail ? 1 : 0;
}

let volRestored = false;
const restoreVolume = () => {
  if (!volBefore || volRestored) return;
  volRestored = true;
  try {
    execSync(`osascript -e 'set volume output muted ${volBefore.muted === 'true' ? 'true' : 'false'}' -e 'set volume output volume ${Number(volBefore.volume) || 50}'`
      + (inputVol ? ` -e 'set volume input volume ${inputVol}'` : ''));
    const now = {
      muted: execSync(`osascript -e 'output muted of (get volume settings)'`).toString().trim(),
      volume: execSync(`osascript -e 'output volume of (get volume settings)'`).toString().trim(),
    };
    // 回读：不还回去就等于把用户的机器改了（B12 的同类）
    if (now.muted !== volBefore.muted || now.volume !== volBefore.volume) {
      console.error(`✗ 系统输出没还原：期望 muted=${volBefore.muted} volume=${volBefore.volume}，实际 muted=${now.muted} volume=${now.volume}`);
    } else {
      console.log(`  ✓ 系统输出已还原（muted=${now.muted} volume=${now.volume}）`);
    }
  } catch (e) { console.error('✗ 还原系统输出失败：' + (e && e.message)); }
};
// H7 / R-02：**报错和 Ctrl-C 也要还原**。只挂在 main() 的两个分支上是不够的 —— 人在
// 跑到一半按 Ctrl-C 时，main() 永远不会 settle，用户的音量就留在脚本改过的值上。
let bailing = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (bailing) return;
    bailing = true;
    console.log(`\n收到 ${sig} —— 还原设置与系统输出`);
    // 音量是同步的，先还掉（这一步不能等）；设置还原给它 3 秒，超时也走。
    restoreVolume();
    const bye = () => process.exit(130);
    const timer = setTimeout(bye, 3000);
    Promise.resolve().then(() => stashR(evalOk)).catch(() => {}).then(() => { clearTimeout(timer); bye(); });
  });
}
process.on('exit', () => { try { if (mockChatSrv) mockChatSrv.close(); } catch (_) {} });
main().then(async (c) => { try { await stashR(evalOk); } catch (_) {} restoreVolume(); process.exit(c || 0); },
            async (e) => { try { await stashR(evalOk); } catch (_) {} restoreVolume(); die(e.stack || e.message); });
