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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  sleep(1000);
  log('▶ 起 Debug 包：' + app);
  execSync(`open "${app}"`, { env: cleanEnv() });
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
const storageGet = (keys) => runAsync(`new Promise(res=>{ try{ chrome.storage.local.get(${JSON.stringify(keys)}, v=>res(JSON.stringify(v||{}))); }catch(e){ res('{}') } })`).then(JSON.parse);

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
async function muteOn() {
  try {
    mutedRestore = execSync(`osascript -e 'output muted of (get volume settings)'`, { env: cleanEnv(), encoding: 'utf8' }).trim() === 'true';
    if (!mutedRestore) execSync(`osascript -e 'set volume output muted true'`, { env: cleanEnv(), stdio: 'ignore' });
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
  await storageSet({ onboardSeen: false, listenMyLang: 'zh', listenOtherLang: 'en' });
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
  await setValue('packs-my-lang', 'zh');
  await setValue('packs-other-lang', 'en');
  await click('packs-go');
  const seen = [];
  await waitFor(async () => {
    const txt = (await textOf('pack-tts-state')) || '';
    if (txt && seen[seen.length - 1] !== txt) seen.push(txt);
    okc(!/(^|[^a-z])th([^a-z]|$)/.test(txt), '进度行出现了泰语：' + JSON.stringify(txt) + '（语言对是 zh/en）');
    // 前进的判据必须是「下一屏出来了」—— 只看「包屏隐藏」会被登录屏假冒（session 掉了
    // 也会把 firstrun-packs 藏掉，2026-10-05 实测这么误判过一次绿灯）。
    return (await visible('onboard')) || ((await visible('app-listen-entry')) && !(await visible('signed-out')));
  }, 600000, '包屏前进到引导屏（含首次模型下载）');
  okc(seen.length === 0 || seen.every((t) => !/(^|[^a-z])th([^a-z]|$)/.test(t)),
    '进度行历史里出现过泰语：' + JSON.stringify(seen.slice(0, 5)));
}

// M6 语言对下载后不跳（#564：firstRunLocales 是集合没槽位，重画时对调）
// 两种形态：模型没就绪 ⇒ 包屏在 ⇒ 原样验「点下载→重画→对不跳」；模型已就绪 ⇒ step 直接
// 跳引导屏、包屏不再出来 —— 那就验 #564 的用户可见不变量：钉下的对 reload 后原样不动
// （显示、存储、使用三者锁死）。重画对调的机检在 npm test（app-firstrun R3 系列）。
async function m6() {
  await storageSet({ onboardSeen: false, listenMyLang: 'zh', listenOtherLang: 'en' });
  await reload();
  await sleep(1200);   // 命令式先画、React 后挂 —— 立刻点会点空（2026-10-05 实测三轮全空）
  if (await visible('firstrun-packs')) {
    await waitFor(async () => {
      const my = await valueOf('packs-my-lang'), other = await valueOf('packs-other-lang');
      return !!my && !!other && !!(await textOf('pack-tts-state'));
    }, 20000, '包屏落定');
    const beforeMy = await valueOf('packs-my-lang'), beforeOther = await valueOf('packs-other-lang');
    okc(beforeMy === 'zh' && beforeOther === 'en', `设进去的一对没生效：my=${beforeMy} other=${beforeOther}`);
    await click('packs-go');
    await sleep(3000);   // 下载那一下的重画（#564 的触发条件）就发生在头一两秒
    const afterMy = await valueOf('packs-my-lang'), afterOther = await valueOf('packs-other-lang');
    okc(afterMy === 'zh' && afterOther === 'en', `下载后语言对跳了：my=${afterMy} other=${afterOther}（#564）`);
  }
  const st = await storageGet(['listenMyLang', 'listenOtherLang']);
  okc(st.listenMyLang === 'zh' && st.listenOtherLang === 'en',
    '落盘的一对不对：' + JSON.stringify(st) + '（显示、存储、下载三者要锁死）');
}

// ── 听译组（一个会话跑完 M7→M2→M3→M4→M5；顺序即依赖：M3 吃 M2 的朗读，M5 关自动朗读放最后）──
async function setupListen() {
  // 模型先行，且在 reload **之前**的安静页面上做 —— reload 后头几秒页面自己的探测
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
  await waitFor(() => visible('app-listen-entry'), 20000, '首页听译卡');
  await sleep(1500);   // 命令式先画、React 后挂 —— 立刻点会点空（三轮全空那次的教训）
  await storageSet({ ttsEngine: 'device' });
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
  // 对话档进页即自动开听（open() → start()）；没起来再补一记 toggle，仍不行整轮重来（最多三轮）。
  let live = false, lastErr = '';
  for (let attempt = 1; attempt <= 3 && !live; attempt++) {
    try {
      await click('app-listen-entry');
      await waitFor(() => visible('app-listen'), 8000, `听译页（第 ${attempt} 轮）`);
      await muteOn();   // 输出静音：TTS 事件照流，Mac 麦克风听不到 —— 行数才确定
      try {
        await waitFor(() => evalOk(`(document.getElementById('app-listen-pill')||{className:''}).className.indexOf('live')>=0`), 8000, '进页自动开听');
      } catch (e) {
        await click('app-listen-toggle');
        await waitFor(() => evalOk(`(document.getElementById('app-listen-pill')||{className:''}).className.indexOf('live')>=0`), 8000, '补一记 toggle 后开听');
      }
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
  try { await click('app-listen-toggle'); } catch (_) {}
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

async function m7(ctx) {
  await say('今天我们测试翻译。', 'zh-CN');
  await waitRow('今天我们测试翻译');
  // 第二句要**词汇远离**任何可能被朗读的译文：先前用「การทดสอบ」跟 zh 句的泰语译文
  // 撞了 bigram，被回声闸**正当**吞掉（那是它在干活，不是 case 的失败）。
  await say('ที่นี่ขายกาแฟหรือเปล่า', 'th');
  await waitRow('กาแฟ');   // 第二句成行（累积不覆盖）
  const s = await state();
  okc((s.history || []).some((r) => r.includes('今天我们测试翻译')), '第一句被第二句覆盖了 —— 历史没有累积');
}

async function m2(ctx) {
  await say('请问去火车站怎么走？', 'zh-CN');
  await waitFor(async () => {
    const s = await state();
    return (s.history || []).some((r) => r.includes('请问去火车站') && THAI.test(r));
  }, 30000, 'zh 句成行且带泰语译文');
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
  const before = (await state()).history.slice();
  const echoed = ctx.spokenThai;
  await say(echoed, 'th');
  await sleep(4000);   // ECHO_TAIL_MS=3000 + 定稿余量
  const after = (await state()).history;
  const newRows = after.filter((r) => before.indexOf(r) < 0);
  okc(!newRows.some((r) => r.includes(echoed.slice(0, 12))),
    `回声没拦住：念过的泰语「${echoed.slice(0, 20)}…」又成了一行（新增 ${newRows.length} 行）`);
  // 之前落的行还在（拦的是这一句，不是整个历史）
  okc(after.some((r) => r.includes('请问去火车站')), '回声拦截把别人的行也吞了');
}

async function m4(ctx) {
  await say('ฉันหิวข้าวมาก', 'th');
  await waitRow('หิวข้าว', 15000);   // 对方的新句成行（不误杀）
}

// M5 TTS 失败不得**静默堵死**队列（#565 六轮，88 号包）。事件注入版：连杀三句在途朗读，
// 每杀一句后断言**下一句照样成行、照样开口** —— 泵不死、队列不堵，这就是六轮规则的本义。
// 「assets/timeout 即报」的半边：注入够不着（speakOut 启动后返回 ok:true，在途失败只打死
// done，泵看不见 —— 这本身是 #565 的后续发现，已立项），由 npm test 的 speakPump/即报门钉着。
async function m5() {
  await waitFor(drained, 60000, '朗读队列排空（M5 要干净起算）');
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
    await storageSet({ ttsEngine: 'device' });
    await waitFor(() => visible('app-listen-entry'), 20000, 'M8 首页听译卡');
    await sleep(1500);
    await click('app-listen-entry');
    await waitFor(() => visible('app-listen'), 8000, 'M8 听译页');
    await click('app-listen-toggle');
    // 修复后：模型全就绪（kokoro 在），这里应该几秒内就 live —— 不下任何东西
    await waitFor(() => evalOk(`(document.getElementById('app-listen-pill')||{className:''}).className.indexOf('live')>=0`), 20000,
      'zh/en 开听没在 20s 内起来（被什么东西堵住了 —— 是不是又在下泰语？）');
    // 全程零泰语事件（探测的 missing/installed、下载的 progress 都不许出现）
    const thHit = await evalOk(`__mtTest.rec().some(e => String((e && e.locale) || '').split('-')[0].toLowerCase() === 'th')`);
    okc(!thHit, '进场探测/下载了泰语 —— beginPipeline 还是全量（90 真机那条）');
  } finally {
    await evalOk('__mtTest.ka(0), true').catch(() => {});
    try { await click('app-listen-toggle'); } catch (_) {}
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
  await storageSet({ ttsEngine: 'device' });
  await waitFor(() => visible('app-listen-entry'), 20000, 'M9 首页听译卡');
  await sleep(1500);
  await click('app-listen-entry');
  await waitFor(() => visible('app-listen'), 8000, 'M9 听译页');
  await click('app-listen-toggle');
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

const LISTEN_CASES = [
  { id: 'M7', what: '多轮对话历史逐行累积', impl: m7 },
  { id: 'M2', what: 'zh 输入 → th 译文 → 朗读出声', impl: m2 },
  { id: 'M3', what: '自己念的被认回来 → 拦住（注入版回声）', impl: m3 },
  { id: 'M4', what: '对方说不同的话 → 放行（不误杀）', impl: m4 },
  { id: 'M5', what: 'TTS 失败不静默堵死（连杀三句，队列仍活）', impl: m5 },
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

  await probe();
  if (probeOnly) return 0;

  const fail = await runCases();
  log(fail ? `\n✗ ${fail} 个 case 红` : '\n✓ M 系列全绿');
  return fail ? 1 : 0;
}

main().then((c) => process.exit(c || 0), (e) => die(e.stack || e.message));
