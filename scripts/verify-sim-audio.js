// scripts/verify-sim-audio.js — speech-compat 播放链路在真 WebKit（iOS 模拟器
// Safari）里的端到端回归。诞生记录：2026-08-09 真机连环案 —— WKWebView 拒播
// blob: URL（NotSupportedError）、IndexedDB 里的 Blob 是文件句柄、App 更新搬容器
// 后句柄悬空（元数据健在、字节读不出）。Chrome 套件（test:learn）对这三个坑
// 全部免疫，所以必须在 WebKit 里验：字节内联缓存 + data:URL 播放，鲜取与缓存
// 命中都要真的把 play() 跑起来。
//
// 跑法（需 macOS + Xcode 模拟器）：
//   node build.js && node scripts/verify-sim-audio.js
// 脚本会：起本地假语音端点（say+afconvert 生成真 AAC）→ 在已启动的模拟器
// Safari 里打开探针页 → 等两次「点击屏幕」手势（WebKit 自动播放策略要求真手势，
// 无法脚本内合成 —— 用 cua-driver 或手点模拟器各一次）→ 探针页自报结果 →
// 断言：鲜取播放成功、二次播放走缓存零请求、跨页面加载后缓存仍可播。
//
// PASS 退出码 0；断言失败或 120s 超时退出码 1。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8899;
// 每轮唯一：同一模拟器的 IndexedDB 跨运行留存，固定句子会让第一次播放
// 就命中上一轮的缓存，鲜取断言失真。
const SENTENCE = 'Simulator audio regression ' + Date.now() + '.';

// ─── 真音频（AAC/m4a）：say 生成、afconvert 转码，均为 macOS 自带 ───────────
const tmpDir = fs.mkdtempSync('/tmp/sim-audio-');
const aiff = path.join(tmpDir, 'probe.aiff');
const m4a = path.join(tmpDir, 'probe.m4a');
execSync(`say -o "${aiff}" "regression"`);
execSync(`afconvert -f m4af -d aac "${aiff}" "${m4a}"`);
const AUDIO = fs.readFileSync(m4a);
console.log(`✓ 假端点音频就绪：AAC ${AUDIO.length}B`);

let synthCount = 0;
const reports = [];
let done = false;

const PROBE = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0}button{width:100vw;height:100vh;font-size:28px;border:0;background:#0a7d43;color:#fff}</style>
<script src="/dist/content/learn-model.js"></script>
<script src="/dist/content/tts.gen.js"></script>
<script src="/dist/learn/store.js"></script>
<script src="/dist/learn/tts.js"></script>
<button id="go"></button>
<script>
  const phase = new URLSearchParams(location.search).get('phase') || '1';
  const btn = document.getElementById('go');
  btn.textContent = '点击开始 phase ' + phase;
  btn.addEventListener('click', async () => {
    btn.textContent = 'phase ' + phase + ' 运行中…';
    LearnTTS.configure({ engineId: 'local', baseUrl: location.origin });
    const out = { phase };
    try {
      out.r1 = await LearnTTS.speak(${JSON.stringify(SENTENCE)}, 'en');
      if (phase === '1') out.r2 = await LearnTTS.speak(${JSON.stringify(SENTENCE)}, 'en');
    } catch (e) { out.error = String(e && (e.message || e)); }
    await fetch('/report', { method: 'POST', body: JSON.stringify(out) });
    if (phase === '1') { location.href = '/probe.html?phase=2'; }
    else { btn.textContent = '完成'; }
  }, { once: true });
</script>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/probe.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PROBE);
  }
  if (url.startsWith('/dist/')) {
    const f = path.join(ROOT, url.slice(1));
    if (!f.startsWith(path.join(ROOT, 'dist')) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(fs.readFileSync(f));
  }
  if (url === '/v1/audio/speech') {
    synthCount++;
    res.writeHead(200, { 'Content-Type': 'audio/mp4' });
    return res.end(AUDIO);
  }
  if (url === '/report') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const rep = JSON.parse(body);
      reports.push(rep);
      console.log('· report:', JSON.stringify(rep));
      res.writeHead(200); res.end('ok');
      if (rep.phase === '2') finish();
    });
    return;
  }
  res.writeHead(404); res.end();
});

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

function finish() {
  if (done) return; done = true;
  const p1 = reports.find((r) => r.phase === '1');
  const p2 = reports.find((r) => r.phase === '2');
  if (!p1 || p1.error) fail('phase 1 未完成: ' + JSON.stringify(p1));
  if (!(p1.r1 && p1.r1.ok)) fail('鲜取播放没有真正开始: ' + JSON.stringify(p1.r1));
  if (p1.r1.cached !== false) fail('第一次播放不该命中缓存');
  if (!(p1.r2 && p1.r2.ok && p1.r2.cached === true)) fail('同页二次播放必须走缓存: ' + JSON.stringify(p1.r2));
  if (!p2 || p2.error) fail('phase 2 未完成: ' + JSON.stringify(p2));
  if (!(p2.r1 && p2.r1.ok && p2.r1.cached === true)) fail('跨页面加载后缓存必须仍可播（字节内联的意义所在）: ' + JSON.stringify(p2.r1));
  if (synthCount !== 1) fail(`合成端点应恰好被打 1 次，实际 ${synthCount} 次 —— 缓存在多扣用户的钱`);
  console.log('✓ 模拟器 WebKit 音频回归全部通过：鲜取播放 · 同页缓存 · 跨页缓存 · 合成恰一次');
  process.exit(0);
}

server.listen(PORT, () => {
  console.log(`✓ 假语音端点 http://127.0.0.1:${PORT}`);
  try {
    execSync(`xcrun simctl openurl booted http://127.0.0.1:${PORT}/probe.html`);
    console.log('✓ 探针页已在模拟器 Safari 打开 —— 等待两次屏幕点击（phase 1 与 phase 2 各一次）');
  } catch (e) {
    fail('模拟器未启动？先 `xcrun simctl boot <设备>` 并打开 Simulator.app。' + e.message);
  }
  setTimeout(() => fail('120s 超时 —— 探针未回报（没人点屏幕，或播放挂了）'), 120000);
});
