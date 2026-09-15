// chrome.js — locate + launch a throwaway-profile Chrome for the layout suite.
// The profile dir is a mkdtemp and is removed on cleanup; nothing touches the
// user's real browser. --remote-debugging-port=0 lets Chrome pick a free port,
// which we read back from the profile's DevToolsActivePort file.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

// 收尾不能只靠调用方记得 cleanup()（全回归 09-14 F14：本机积了 441 个测试 Chrome、最老挂了 5 天，
// 负载高时 test:layout 从 42/42 掉到 34/42）。Chrome 是普通子进程，node 死了它不跟着死。三层兜底：
//   ① 正常退出 / 抛异常 / process.exit → process 'exit' 里关掉还开着的；
//   ② SIGINT / SIGTERM / SIGHUP（超时、任务被停）→ 收尾后按信号码退出；
//   ③ SIGKILL（低内存强杀）谁的 handler 都跑不到 → 每个 Chrome 配一个脱离进程组的 sh 看守，
//      父 node 一没就杀掉带这个 profile 的进程并删目录。
// 回归门禁：npm run test:chrome-cleanup。
const live = new Set();
let hooked = false;
function hookProcessExit() {
  if (hooked) return;
  hooked = true;
  const all = () => { for (const c of [...live]) c.cleanup(); };
  process.on('exit', all);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.once(sig, () => { all(); process.exit(code); });
  }
}
function spawnReaper(chromePid, profileDir) {
  // 参数走环境变量：看守自己的命令行里不出现 profile 路径，pkill -f 不会连它自己一起杀。
  // 父进程成了僵尸（还没被收）时 kill -0 仍成功，所以另看 stat。
  const script = 'while kill -0 "$W" 2>/dev/null && [ "$(ps -o stat= -p "$W" 2>/dev/null | cut -c1)" != Z ]; do sleep 1; done;'
    + ' kill -9 "$C" 2>/dev/null; pkill -9 -f "user-data-dir=$P" 2>/dev/null; rm -rf "$P"';
  try {
    const r = spawn('/bin/sh', ['-c', script], {
      detached: true, stdio: 'ignore',
      env: { PATH: process.env.PATH || '/usr/bin:/bin', W: String(process.pid), C: String(chromePid), P: profileDir },
    });
    r.on('error', () => { /* 没有 /bin/sh 的平台：只剩 ①② */ });
    r.unref();
  } catch (_) { /* 同上 */ }
}

function findChrome() {
  for (const c of CANDIDATES) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (_) { /* next */ }
  }
  return null;
}

// extraArgs: 额外的 Chrome 启动参数。目前唯一的用途是 --host-resolver-rules ——
// 官网交接那道门禁必须让页面**真的**跑在 belliedmonkey.cc 这个主机名上，因为内容
// 脚本的判据是 location.hostname（那是安全边界，不是配置，见 content-main.js）。
// 在 127.0.0.1 上测等于测了另一条分支。
async function launchChrome(extraArgs) {
  const bin = findChrome();
  if (!bin) {
    // Hard fail, never a silent skip — a gate that silently goes green rots.
    throw new Error(
      'No Chrome/Edge binary found. Install Google Chrome or set CHROME_BIN=/path/to/chrome. ' +
      '(The layout gate needs a real layout engine; see docs/verification-spec.md §3.2.)');
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-layout-'));
  const proc = spawn(bin, [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging', // newer Chrome gates CDP Extensions.loadUnpacked behind this; older builds ignore it
    '--window-size=1300,900',
    ...(Array.isArray(extraArgs) ? extraArgs : []),
    // Headless by default (no focus-stealing window; works on displayless boxes).
    // MT_LAYOUT_HEADED=1 opts into a visible window for --keep debugging.
    ...(process.env.MT_LAYOUT_HEADED ? [] : ['--headless=new']),
    'about:blank',
  ], { stdio: 'ignore' });

  // 一起就登记：等端口的 20 s 里被停掉也要收得干净。看守不在 cleanup 里杀 ——
  // 父 node 退出后它再扫一遍（Chrome 的子进程在主进程被杀后还会写一会儿 profile）。
  let done = false;
  const handle = {
    bin, proc, port: 0, profileDir,
    cleanup() {
      if (done) return;
      done = true;
      live.delete(handle);
      try { proc.kill('SIGKILL'); } catch (_) { /* already dead */ }
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    },
  };
  live.add(handle);
  hookProcessExit();
  spawnReaper(proc.pid, profileDir);

  // Chrome writes "<port>\n<path>" to DevToolsActivePort once the endpoint is up.
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  let port = 0;
  while (Date.now() < deadline) {
    try {
      const txt = fs.readFileSync(portFile, 'utf8');
      port = parseInt(txt.split('\n')[0], 10);
      if (port > 0) break;
    } catch (_) { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!port) {
    handle.cleanup();
    throw new Error(`Chrome did not expose DevToolsActivePort within 20s (${bin})`);
  }
  handle.port = port;
  return handle;
}

module.exports = { launchChrome };
