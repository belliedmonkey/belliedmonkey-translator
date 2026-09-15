#!/usr/bin/env node
// 门禁起的无头 Chrome 在脚本怎么结束都要被关掉（全回归 09-14 F14）。
//
// 读数：本机积了 441 个带调试端口的测试 Chrome（mt-layout-* 临时 profile，最老挂了 5 天），
// 负载高时 test:layout 从 42/42 掉到 34/42。launchChrome() 只在脚本自己调 cleanup() 时才关 ——
// 超时被 SIGTERM、抛异常、process.exit、被系统 SIGKILL 都会把 Chrome 留下（它是普通子进程，
// node 死了不跟着死）。
//
// 这里对每种结束方式起一个子 node，经 test/layout/chrome.js 开一个 Chrome，按方式结束子进程，
// 然后回读：Chrome 主进程没了、带这个 profile 的进程一个不剩、profile 目录删掉了。
// 用法：npm run test:chrome-cleanup（真 Chrome）
'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LAUNCHER = path.join(__dirname, '..', 'test', 'layout', 'chrome.js');
const WAIT_MS = 15000;   // 看守进程按秒轮询，给足余量
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 子进程里跑的代码：开 Chrome，把 pid / profile 报给父进程，然后按 mode 结束
function childSource(mode) {
  return `
    const { launchChrome } = require(${JSON.stringify(LAUNCHER)});
    launchChrome().then((c) => {
      process.stdout.write(JSON.stringify({ pid: c.proc.pid, profileDir: c.profileDir }) + '\\n');
      if (${JSON.stringify(mode)} === 'normal') { c.cleanup(); process.exit(0); }
      if (${JSON.stringify(mode)} === 'exit') { setTimeout(() => process.exit(3), 200); return; }
      if (${JSON.stringify(mode)} === 'uncaught') { setTimeout(() => { throw new Error('门禁中途抛异常'); }, 200); return; }
      setInterval(() => {}, 1000);   // sigterm / sigkill：挂着等父进程来杀
    }).catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(9); });
  `;
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch (_) { return false; } }
function procsWith(needle) {
  try {
    return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n').filter((l) => l.includes(needle) && !l.includes('verify-chrome-cleanup')).length;
  } catch (_) { return -1; }
}

async function runCase(mode) {
  const child = spawn(process.execPath, ['-e', childSource(mode)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((r) => child.on('exit', r));
  const t0 = Date.now();
  while (!out.includes('\n') && Date.now() - t0 < 30000) await sleep(100);
  if (!out.includes('\n')) { child.kill('SIGKILL'); return { mode, ok: false, why: 'Chrome 没起来：' + err.slice(0, 200) }; }
  const info = JSON.parse(out.split('\n')[0]);
  if (mode === 'sigterm') child.kill('SIGTERM');
  if (mode === 'sigkill') child.kill('SIGKILL');
  await exited;
  const t1 = Date.now(); let st;
  do {
    st = { chrome: alive(info.pid), procs: procsWith(info.profileDir), dir: fs.existsSync(info.profileDir) };
    if (!st.chrome && st.procs === 0 && !st.dir) break;
    await sleep(250);
  } while (Date.now() - t1 < WAIT_MS);
  const ok = !st.chrome && st.procs === 0 && !st.dir;
  if (!ok) {   // 自己收拾掉，别让测试本身变成泄漏源
    try { process.kill(info.pid, 'SIGKILL'); } catch (_) {}
    try { execFileSync('pkill', ['-9', '-f', 'user-data-dir=' + info.profileDir]); } catch (_) {}
    try { fs.rmSync(info.profileDir, { recursive: true, force: true }); } catch (_) {}
  }
  return { mode, ok, ms: Date.now() - t1, why: ok ? '' : `子进程结束 ${WAIT_MS / 1000} s 后：Chrome 主进程${st.chrome ? '还在' : '已退'}、带该 profile 的进程 ${st.procs} 个、profile 目录${st.dir ? '还在' : '已删'}` };
}

(async () => {
  const cases = [
    ['normal', '脚本自己调 cleanup()'],
    ['sigterm', '门禁超时 / 后台任务被停（SIGTERM）'],
    ['uncaught', '门禁中途抛异常'],
    ['exit', '门禁 process.exit 前没调 cleanup()'],
    ['sigkill', '被系统强杀（SIGKILL，低内存）'],
  ];
  const bad = [];
  for (const [mode, label] of cases) {
    const r = await runCase(mode);
    console.log(`  ${r.ok ? '✓' : '✗'} ${label}${r.ok ? `（${r.ms} ms 内收干净）` : '：' + r.why}`);
    if (!r.ok) bad.push(label);
  }
  if (bad.length) { console.log(`✗ 门禁 Chrome 收尾有 ${bad.length} 种结束方式会泄漏：${bad.join('、')}`); process.exit(1); }
  console.log('✓ 门禁 Chrome 收尾：五种结束方式都不留进程、不留 profile 目录');
})();
