'use strict';

// One entry for the 16-clip Apple file component.
// It is not a product score, not e1_b1, and not an end-to-end run.
// Linux can exercise the fixtures. A fixture result is not an Apple result.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { scoreFrozen } = require('./score.js');

const COMPILE_MS = 90 * 1000;
const PROCESS_MS = 180 * 1000;
const ITEM_MS = 45 * 1000;
const KILL_GRACE_MS = 5000;
const SWIFT = path.join(__dirname, 'product-asr-mac.swift');

function runDirName(now, nonce) {
  const iso = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return 'sa-file-' + iso + '-' + nonce;
}

function redactText(value) {
  return String(value == null ? '' : value).replace(/(?:\/Users\/|\/home\/|file:\/\/)\S+/g, '<path>');
}

// Frozen audioCache is the repo-relative string written by fetch:
// eval/baselines/asr/.cache/audio/<config>/<audioName>
// --audio-cache is the directory that already contains <config>/.
function cacheRelative(stored) {
  if (typeof stored !== 'string' || stored.length === 0) return null;
  if (path.isAbsolute(stored) || stored.includes('\\')) return null;
  const norm = stored.replace(/\/+/g, '/');
  if (norm.split('/').includes('..')) return null;
  const mark = '.cache/audio/';
  const at = norm.lastIndexOf(mark);
  const rel = at >= 0 ? norm.slice(at + mark.length) : norm;
  if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return null;
  const parts = rel.split('/');
  if (parts.length !== 2) return null;
  if (parts[0] !== 'en_us' && parts[0] !== 'cmn_hans_cn') return null;
  if (!/^[A-Za-z0-9._-]+\.wav$/.test(parts[1])) return null;
  const rootProbe = path.resolve('/cache-root');
  const full = path.resolve(rootProbe, rel);
  if (full !== rootProbe && !full.startsWith(rootProbe + path.sep)) return null;
  return parts[0] + '/' + parts[1];
}

function cacheFile(cacheRoot, stored) {
  const rel = cacheRelative(stored);
  if (!rel) return null;
  const root = path.resolve(cacheRoot);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function itemWatchDecision(state) {
  if (state.now - state.started >= state.processCapMs) return 'process-cap';
  if (state.itemId && state.now - state.itemSince >= state.itemCapMs) return 'item-cap';
  return null;
}

function archiveAllowed(names) {
  for (const name of names || []) {
    if (typeof name !== 'string' || name.includes('..') || path.isAbsolute(name)) {
      return { ok: false, code: 'archive-path' };
    }
    const base = path.basename(name);
    if (/\.wav$/i.test(base) || base === '.env' || base.includes('.env') || base === 'sa-file-bin') {
      return { ok: false, code: 'archive-forbidden' };
    }
  }
  return { ok: true };
}

function exactHypotheses(items, rows) {
  const reject = (code) => ({
    ok: false, code: code, rates: null, hypotheses: null, processExit: 2,
  });
  if (!Array.isArray(items) || items.length !== 16) return reject('need-16');
  if (!Array.isArray(rows) || rows.length !== items.length) return reject('missing-id');
  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    const row = rows[i];
    const id = row && row.id;
    if (seen.has(id)) return reject('duplicate-id');
    if (id) seen.add(id);
    if (!row || id !== items[i].id) {
      const known = items.some((item) => item.id === id);
      return reject(known ? 'missing-id' : 'unknown-id');
    }
    if (typeof row.hypothesis !== 'string' || row.hypothesis === '') return reject('hypothesis-type');
  }
  return { ok: true, code: 'ok', count: rows.length, rates: null, hypotheses: null, processExit: 0 };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function preflight(input) {
  const blank = {
    ok: false,
    rates: null,
    hypotheses: null,
    productMetric: false,
    sameProductProcess: false,
    endToEnd: false,
    appleResult: false,
    leaderboard: false,
  };
  const set = input.set;
  if (!set || !Array.isArray(set.items) || set.items.length !== 16) {
    return Object.assign(blank, { code: 'need-16' });
  }
  for (const item of set.items) {
    const full = cacheFile(input.audioCache, item.audioCache);
    if (!full) return Object.assign(blank, { code: 'audio-path', id: item.id });
    if (!fs.existsSync(full)) {
      return Object.assign(blank, { code: 'missing-audio', id: item.id });
    }
    const got = sha256File(full);
    if (got !== item.audioSha256) {
      return Object.assign(blank, { code: 'checksum-mismatch', id: item.id });
    }
  }
  if (input.platform !== 'darwin') {
    return Object.assign(blank, { code: 'need-apple-speechanalyzer' });
  }
  if (!input.swiftc || !fs.existsSync(input.swiftc)) {
    return Object.assign(blank, { code: 'missing-swiftc', appleResult: false });
  }
  return Object.assign(blank, { ok: true, code: 'ok', appleResult: false });
}

function readProgress(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.id ? String(parsed.id) : '';
  } catch (_) {
    return '';
  }
}

function watchChild(spawnFn, bin, args, opts) {
  return new Promise((resolve) => {
    const child = spawnFn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const outChunks = [];
    const errChunks = [];
    if (child.stdout) child.stdout.on('data', (chunk) => outChunks.push(chunk));
    if (child.stderr) child.stderr.on('data', (chunk) => errChunks.push(chunk));
    const started = Date.now();
    let itemId = '';
    let itemSince = started;
    let cap = null;
    let settled = false;
    let killTimer = null;
    function finish(payload) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (killTimer) clearTimeout(killTimer);
      fs.writeFileSync(opts.stdoutPath, Buffer.concat(outChunks));
      fs.writeFileSync(opts.stderrPath, Buffer.concat(errChunks));
      resolve(payload);
    }
    const timer = setInterval(() => {
      const seen = opts.progressFile ? readProgress(opts.progressFile) : '';
      if (seen !== itemId) {
        itemId = seen;
        itemSince = Date.now();
      }
      const reason = itemWatchDecision({
        started: started,
        now: Date.now(),
        itemId: itemId,
        itemSince: itemSince,
        processCapMs: opts.processCapMs,
        itemCapMs: opts.itemCapMs || ITEM_MS,
      });
      if (reason && !cap) {
        cap = reason;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, opts.killGraceMs == null ? KILL_GRACE_MS : opts.killGraceMs);
      }
    }, opts.pollMs || 200);
    child.on('error', () => finish({ code: null, signal: null, cap: cap }));
    child.on('exit', (code, signal) => finish({ code: code, signal: signal, cap: cap }));
  });
}

function gitSha() {
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.join(__dirname, '..', '..', '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function writeSummary(runDir, summary) {
  const body = JSON.stringify(summary, null, 2) + '\n';
  fs.writeFileSync(path.join(runDir, 'run-summary.json'), body);
}

function baseSummary(extra) {
  return Object.assign({
    ok: false,
    productMetric: false,
    sameProductProcess: false,
    endToEnd: false,
    matchesIntlMacChineseDefaultArm: false,
    intlMacChineseDefaultArm: 'e1_b1',
    leaderboard: false,
    exploratory: true,
    appleResult: false,
    rates: null,
    hypotheses: null,
    hypothesisCount: 0,
    compileCapMs: COMPILE_MS,
    processCapMs: PROCESS_MS,
    itemCapMs: ITEM_MS,
    audioSeconds: 165.26,
  }, extra);
}

function defaultArchive(runDir, names) {
  const { spawnSync } = require('child_process');
  const tarPath = path.join(runDir, 'evidence.tar.gz');
  const result = spawnSync('tar', ['-czf', tarPath, '-C', runDir].concat(names), { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(redactText(result.stderr || 'tar failed'));
}

async function runSaFile(opts) {
  const now = opts.now == null ? Date.now() : opts.now;
  const nonce = opts.nonce || crypto.randomBytes(4).toString('hex');
  const runId = runDirName(now, nonce);
  const runDir = path.join(opts.outRoot, runId);
  if (fs.existsSync(runDir)) {
    return {
      ok: false, code: 'output-exists', processExit: 2, rates: null, hypotheses: null, runDir: null,
    };
  }
  fs.mkdirSync(runDir);
  const platformEligible = opts.platform === 'darwin' && !!(opts.swiftc && fs.existsSync(opts.swiftc));
  let appleExecutionStarted = false;
  let recognitionCompleted = false;
  let archiveTries = 0;
  function publishArchive(summary) {
    const present = ['run-summary.json', 'score.json', 'hypotheses.json', 'child-stdout.txt', 'child-stderr.txt']
      .filter((name) => fs.existsSync(path.join(runDir, name)) && archiveAllowed([name]).ok);
    if (summary.ok !== true) {
      const drop = present.indexOf('score.json');
      if (drop >= 0) present.splice(drop, 1);
      try { fs.unlinkSync(path.join(runDir, 'score.json')); } catch (_) {}
    }
    const lines = present.map((name) => sha256File(path.join(runDir, name)) + '  ' + name);
    fs.writeFileSync(path.join(runDir, 'MANIFEST.sha256'), lines.join('\n') + '\n');
    const names = present.concat(['MANIFEST.sha256']);
    if (!archiveAllowed(names).ok) throw new Error('archive-forbidden');
    if (opts.writeArchive) opts.writeArchive(runDir, names);
    else defaultArchive(runDir, names);
  }
  function seal(summary) {
    summary.platformEligible = platformEligible;
    summary.appleExecutionStarted = appleExecutionStarted;
    summary.recognitionCompleted = recognitionCompleted;
    summary.appleResult = !!(platformEligible && appleExecutionStarted && recognitionCompleted && opts.compiler === 'swiftc');
    if (summary.ok !== true) {
      summary.rates = null;
      summary.hypotheses = null;
    }
    writeSummary(runDir, summary);
    if (archiveTries >= 2) return Object.assign(summary, { processExit: summary.ok ? 0 : 2, runDir: runDir });
    archiveTries += 1;
    try {
      publishArchive(summary);
    } catch (_) {
      summary.ok = false;
      summary.rates = null;
      summary.hypotheses = null;
      if (summary.code === 'ok') summary.code = 'evidence-pack-failed';
      try { fs.unlinkSync(path.join(runDir, 'score.json')); } catch (__) {}
      writeSummary(runDir, summary);
      if (archiveTries < 2) {
        archiveTries += 1;
        try { publishArchive(summary); } catch (___) {}
      }
    }
    return Object.assign(summary, { processExit: summary.ok ? 0 : 2, runDir: runDir });
  }
  function fail(code, extra) {
    return seal(baseSummary(Object.assign({
      ok: false, code: code, runId: runId, rates: null, hypotheses: null,
    }, extra)));
  }
  let set;
  try {
    set = JSON.parse(fs.readFileSync(opts.setPath, 'utf8'));
  } catch (_) {
    return fail('missing-set');
  }
  const checked = preflight({
    platform: opts.platform,
    set: set,
    audioCache: opts.audioCache,
    swiftc: opts.swiftc,
  });
  if (!checked.ok) return fail(checked.code, { id: checked.id || '' });
  const bin = path.join(runDir, 'sa-file-bin');
  if (opts.compiler === 'swiftc') appleExecutionStarted = true;
  const compiled = await Promise.resolve(opts.compile(bin));
  if (!compiled || compiled.code !== 0 || compiled.cap) {
    const killed = compiled && (compiled.cap || compiled.signal === 'SIGTERM' || compiled.signal === 'SIGKILL');
    return fail(killed ? 'compile-timeout' : 'compile-failed', {
      swiftExit: killed ? null : (compiled && compiled.code != null ? compiled.code : null),
      signal: compiled && compiled.signal ? compiled.signal : null,
      timedOut: !!killed,
    });
  }
  const setForRun = path.join(runDir, 'set-for-run.json');
  const runSet = Object.assign({}, set, {
    items: set.items.map((item) => Object.assign({}, item, { audioCache: cacheRelative(item.audioCache) })),
  });
  fs.writeFileSync(setForRun, JSON.stringify(runSet));
  const hypPath = path.join(runDir, 'hypotheses.json');
  const watched = await watchChild(opts.spawn || spawn, bin, [
    '--set', setForRun,
    '--out', hypPath,
    '--status-out', path.join(runDir, 'asset-status.json'),
    '--audio-root', opts.audioCache,
  ], {
    cwd: opts.audioCache,
    stdoutPath: path.join(runDir, 'child-stdout.txt'),
    stderrPath: path.join(runDir, 'child-stderr.txt'),
    progressFile: path.join(runDir, 'item-progress.json'),
    processCapMs: opts.processCapMs || PROCESS_MS,
    itemCapMs: opts.itemCapMs || ITEM_MS,
    killGraceMs: opts.killGraceMs,
    pollMs: opts.pollMs,
  });
  for (const logName of ['child-stdout.txt', 'child-stderr.txt']) {
    const logPath = path.join(runDir, logName);
    try {
      fs.writeFileSync(logPath, redactText(fs.readFileSync(logPath, 'utf8')));
    } catch (_) {}
  }
  const killed = watched.cap != null || watched.signal === 'SIGTERM' || watched.signal === 'SIGKILL';
  if (killed || watched.code !== 0) {
    try { fs.unlinkSync(hypPath); } catch (_) {}
    return fail(killed ? (watched.cap || 'killed') : 'recognition-failed', {
      swiftExit: killed ? null : watched.code,
      signal: watched.signal || null,
      timedOut: killed,
      stage: watched.cap || 'exited',
    });
  }
  let rows = null;
  try { rows = JSON.parse(fs.readFileSync(hypPath, 'utf8')); } catch (_) { rows = null; }
  const accepted = exactHypotheses(set.items, rows);
  if (!accepted.ok) {
    try { fs.unlinkSync(hypPath); } catch (_) {}
    return fail(accepted.code === 'missing-id' && rows == null ? 'incomplete-hypotheses' : accepted.code, {
      swiftExit: 0, timedOut: false, signal: null,
    });
  }
  const scored = scoreFrozen(set, rows);
  if (!scored.ok) {
    try { fs.unlinkSync(hypPath); } catch (_) {}
    return fail('score-failed', { swiftExit: 0, timedOut: false, signal: null });
  }
  recognitionCompleted = true;
  fs.writeFileSync(path.join(runDir, 'score.json'), JSON.stringify({
    ok: true,
    productMetric: false,
    sameProductProcess: false,
    endToEnd: false,
    leaderboard: false,
    exploratory: true,
    rates: scored.byLang,
    missing: scored.missing,
    unknown: scored.unknown,
    rejected: scored.rejected,
  }, null, 2) + '\n');
  return seal(baseSummary({
    ok: true,
    code: 'ok',
    runId: runId,
    hypothesisCount: accepted.count,
    rates: scored.byLang,
    hypotheses: null,
    swiftExit: 0,
    timedOut: false,
    signal: null,
    setSha256: sha256File(opts.setPath),
    sourceGit: gitSha(),
    sourceFiles: {
      'run-sa-file.js': sha256File(__filename),
      'product-asr-mac.swift': sha256File(SWIFT),
      'score.js': sha256File(path.join(__dirname, 'score.js')),
    },
    fleursRevision: set.attribution && set.attribution.revision ? set.attribution.revision : null,
  }));
}

function main(argv) {
  const args = argv.slice(2);
  let setPath = path.join(__dirname, 'fleurs-public-v1.json');
  let audioCache = '';
  let outRoot = '';
  let fetchAudio = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') setPath = args[++i];
    else if (args[i] === '--audio-cache') audioCache = args[++i];
    else if (args[i] === '--out-root') outRoot = args[++i];
    else if (args[i] === '--fetch-audio') fetchAudio = true;
    else {
      console.error('unknown arg ' + args[i]);
      process.exit(2);
    }
  }
  if (!audioCache || !outRoot) {
    console.error('usage: node run-sa-file.js --audio-cache <cache> --out-root <new-runs> [--fetch-audio]');
    process.exit(2);
  }
  if (fetchAudio) {
    const cache = path.join(__dirname, '.cache', 'audio');
    if (path.resolve(audioCache) !== path.resolve(cache)) {
      console.error('{"ok":false,"code":"fetch-cache-mismatch","rates":null,"productMetric":false}');
      process.exit(2);
    }
    try {
      const { execFileSync } = require('child_process');
      execFileSync(process.execPath, [path.join(__dirname, 'fetch-fleurs.js'), '--audio'], { stdio: 'inherit' });
    } catch (_) {
      console.error('{"ok":false,"code":"fetch-audio-failed","rates":null,"productMetric":false}');
      process.exit(2);
    }
  }
  const which = (() => {
    try {
      const { execFileSync } = require('child_process');
      return execFileSync('which', ['swiftc'], { encoding: 'utf8' }).trim();
    } catch (_) { return ''; }
  })();
  return runSaFile({
    setPath: setPath,
    audioCache: audioCache,
    outRoot: outRoot,
    platform: process.platform,
    swiftc: which,
    compiler: 'swiftc',
    compile: async (outBin) => watchChild(spawn, which, [
      '-framework', 'Speech', '-framework', 'AVFoundation', '-framework', 'CoreMedia',
      SWIFT, '-o', outBin,
    ], {
      cwd: __dirname,
      stdoutPath: path.join(path.dirname(outBin), 'compile-stdout.txt'),
      stderrPath: path.join(path.dirname(outBin), 'compile-stderr.txt'),
      progressFile: '',
      processCapMs: COMPILE_MS,
      itemCapMs: COMPILE_MS + 1,
    }),
  }).then((result) => {
    console.log(JSON.stringify({
      ok: result.ok, code: result.code, processExit: result.processExit,
      runId: result.runId || null, rates: result.ok ? result.rates : null,
      appleResult: result.appleResult === true, productMetric: false,
    }));
    process.exit(result.processExit);
  });
}

if (require.main === module) {
  main(process.argv).catch((err) => {
    console.error(redactText(err && err.stack ? err.stack : err));
    process.exit(2);
  });
}

module.exports = {
  runDirName, itemWatchDecision, archiveAllowed, exactHypotheses, redactText, cacheRelative,
  preflight, runSaFile,
  COMPILE_MS, PROCESS_MS, ITEM_MS,
};
