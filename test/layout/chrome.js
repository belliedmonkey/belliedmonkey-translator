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

function findChrome() {
  for (const c of CANDIDATES) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (_) { /* next */ }
  }
  return null;
}

async function launchChrome() {
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
    // Headless by default (no focus-stealing window; works on displayless boxes).
    // MT_LAYOUT_HEADED=1 opts into a visible window for --keep debugging.
    ...(process.env.MT_LAYOUT_HEADED ? [] : ['--headless=new']),
    'about:blank',
  ], { stdio: 'ignore' });

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
    try { proc.kill('SIGKILL'); } catch (_) { /* already dead */ }
    fs.rmSync(profileDir, { recursive: true, force: true });
    throw new Error(`Chrome did not expose DevToolsActivePort within 20s (${bin})`);
  }

  return {
    bin, proc, port, profileDir,
    cleanup() {
      try { proc.kill('SIGKILL'); } catch (_) { /* already dead */ }
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    },
  };
}

module.exports = { launchChrome };
