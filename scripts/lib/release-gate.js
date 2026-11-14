// scripts/lib/release-gate.js —— 版本完整性门禁：一个版本号只能对应一份内容。
//
// 这段逻辑原来在 cws-publish.js 与 amo-publish.js 里各抄了一份。第三条路
// （GitHub Release / 官网直装 ZIP）**没有抄**，代价当天就付了：
//
//   v1.6.4 tag        2026-08-21 13:45   ← GitHub Release 从这里出
//   星号修复 437fe02  2026-08-21 19:05   ← 5 小时后才合进来
//   商店 build 43     2026-08-21 19:13   ← 从修复之后出
//
// 于是官网上那个「与提交商店的源码完全一致」的直装 ZIP，带着一个商店版本里
// 已经没有的 bug。**没有任何人做错一步**，只是那条路上没有闸门。
//
// 所以现在只有这一份，三条路都调它。抄第四份的那天，就是它再次失效的那天。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { SENTINEL, jwtPayload, sha8, hostOf } = require('../../build/backend-inject.js');

const gitIn = (cwd) => (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd }).trim(); }
  catch (_) { return ''; }
};

// 出货相关目录：改了这些就等于改了包的内容。
// 文档、测试、商店素材不在内 —— 它们不进包，为它们卡住一次发布是噪声。
const SHIPPING_PATHS = 'extension build build.js';

/**
 * 断言「这个版本号只对应一份内容」。不满足就打印原因并 exit 1。
 *
 * @param {object}  o
 * @param {string}  o.version    包内读出来的版本号（不是 package.json —— 要验的是**包**）
 * @param {string}  o.what       出错信息里怎么称呼这个产物，例：'这个包' / '这次 Release'
 * @param {boolean} o.allowDirty 显式放行（调用方从 --allow-dirty 传进来）
 * @param {string}  o.tag        要对照的 tag，默认 `v<version>`
 * @param {string}  o.cwd        在哪棵工作树里查 HEAD，默认当前目录
 * @returns {boolean} 通过为 true；allowDirty 放行时为 false（调用方可据此打印警告）
 *
 * `tag` + `cwd` 一起，让「从某个历史 tag 重出正确产物」成为**被验证过的**操作，
 * 而不是靠 --allow-dirty 绕过去。2026-08-22 的实例：v1.6.4 那个 tag 描述的不是
 * 真正出货的内容（星号修复在打完 tag 之后才合进来），于是给真正出货的提交补了
 * 一个 v1.6.4-store，在一棵干净 worktree 里从它重新构建，再用
 * `--tag v1.6.4-store` 把这个事实说出来。**说出来的溯源，比跳过检查强得多。**
 */
function assertVersionIntegrity({ version, what = '这个包', allowDirty = false, tag: tagOpt, cwd }) {
  if (!version) return false;
  const git = gitIn(cwd);
  if (allowDirty) {
    console.log(`\x1b[33m⚠ --allow-dirty：跳过版本完整性检查。${what}与 tag 的对应关系不再有保证。\x1b[0m`);
    return false;
  }

  const tag = tagOpt || `v${version}`;
  const tagSha = git(`git rev-list -n1 ${tag}`);
  const head = git('git rev-parse HEAD');
  const dirty = git(`git status --porcelain -- ${SHIPPING_PATHS}`);

  if (!tagSha) {
    console.error(`✗ 找不到 tag ${tag} —— ${what}（版本 ${version}）不对应任何一次发布。`);
    process.exit(1);
  }
  if (tagSha !== head) {
    console.error(`✗ ${what}是版本 ${version}，但 HEAD 不在 ${tag} 上。${tag} 之后还有：`);
    for (const l of git(`git log --oneline ${tag}..HEAD`).split('\n').filter(Boolean)) {
      console.error('    ' + l);
    }
    console.error(`  出去的话，${what}与已发布的 ${version} 会是两份不同的内容，`);
    console.error('  而两边都自称同一个版本号，事后无法分辨用户拿到的是哪一份。');
    console.error(`  要么发一个新版本，要么 git checkout ${tag} 后重新 build。`);
    console.error('  确实要出：加 --allow-dirty。');
    process.exit(1);
  }
  if (dirty) {
    console.error('✗ 出货相关目录有未提交改动：');
    for (const l of dirty.split('\n').filter(Boolean)) console.error('    ' + l);
    console.error('  确实要出：加 --allow-dirty。');
    process.exit(1);
  }
  console.log(`✓ 版本 ${version} 与 tag ${tag} 一致，工作树干净`
    + (cwd ? `（工作树 ${cwd}）` : ''));
  return true;
}

// 从一个 zip 里读 manifest.json 的版本号。读**包**而不是 package.json：
// 要验的是「这份产物里装的是什么」，不是「仓库现在是什么」。
function versionInZip(zipPath) {
  try {
    return JSON.parse(execSync(`unzip -p ${JSON.stringify(zipPath)} manifest.json`,
      { encoding: 'utf8' })).version;
  } catch (_) { return null; }
}

// ─── BEL-259: backend-injected artifact gate ───────────────────────────────
//
// The build gate stops a placeholder build from being written; this gate stops a
// stale/wrong artifact from being uploaded. It is deliberately independent of
// MT_ALLOW_PLACEHOLDER_BACKEND: a preview artifact that was produced with the
// escape hatch must still fail here.
//
// Input is the exported artifact (ipa / pkg / zip / xpi) or a dist directory.
// It reads the `MT_BACKEND` block from `learn/backend.config.js` (extension) and
// from the host app's `Script.js`. Only the ACTIVE `url` / `anonKey` are checked:
// `previousUrl` is the BEL-260 sentinel (`.invalid`), compared but never requested,
// and is printed as a host for diagnosis only. It is never a pass/fail criterion.

function normalizeBackendFlavor(flavor) {
  const f = String(flavor || 'intl').toLowerCase();
  if (f === 'intl' || f === 'global') return 'intl';
  if (f === 'china' || f === 'cn') return 'china';
  throw new Error(`unknown flavor ${JSON.stringify(flavor)} (want intl|global|china|cn)`);
}

function walkArtifactFiles(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walkArtifactFiles(p, out);
    else out.push(p);
  }
  return out;
}

function parseBackendBlock(text) {
  // The source and the bundled Script.js both carry `var MT_BACKEND = { ... };`.
  // Slice that block so a nested object or a later string cannot be mistaken for
  // the top-level url/anonKey.
  const m = /(?:var|const|let)\s+MT_BACKEND\s*=\s*\{/.exec(text);
  let block = text;
  if (m) {
    const end = text.indexOf('\n};', m.index);
    if (end > m.index) block = text.slice(m.index, end + 3);
  }
  const url = (/^ {2}url: '([^']*)',/m.exec(block) || [])[1];
  const anonKey = (/^ {2}anonKey: '([^']*)',/m.exec(block) || [])[1];
  const previousUrl = (/^ {2}previousUrl: '([^']*)',/m.exec(block) || [])[1];
  if (url === undefined && anonKey === undefined) return null;
  return { url: url || '', anonKey: anonKey || '', previousUrl: previousUrl || '' };
}

function collectBackendTargets(dir) {
  const targets = [];
  for (const file of walkArtifactFiles(dir)) {
    const base = path.basename(file);
    const rel = path.relative(dir, file);
    const isLearnConfig = base === 'backend.config.js' && /(^|[/\\])learn[/\\]/.test(rel);
    if (!isLearnConfig && base !== 'Script.js') continue;
    const parsed = parseBackendBlock(fs.readFileSync(file, 'utf8'));
    if (parsed) targets.push(Object.assign({ file: rel }, parsed));
  }
  return targets;
}

function extractArtifact(artifact) {
  const ext = path.extname(artifact).toLowerCase();
  // `pkgutil --expand-full` refuses an existing destination, so always expand into
  // a fresh child. The returned `root` is what the caller removes.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-backend-injected-'));
  const out = path.join(root, 'expanded');
  try {
    if (ext === '.pkg') {
      try {
        execFileSync('pkgutil', ['--expand-full', artifact, out], { stdio: 'pipe' });
      } catch (_) {
        fs.mkdirSync(out, { recursive: true });
        execFileSync('xar', ['-xf', artifact, '-C', out], { stdio: 'pipe' });
      }
    } else if (ext === '.zip' || ext === '.xpi' || ext === '.ipa') {
      execFileSync('unzip', ['-qq', '-o', artifact, '-d', out], { stdio: 'pipe' });
    } else {
      throw new Error(`unsupported artifact type ${ext || '(none)'} — want .ipa / .pkg / .zip / .xpi or --dist`);
    }
    return { root, dir: out };
  } catch (e) {
    fs.rmSync(root, { recursive: true, force: true });
    throw e;
  }
}

function checkBackendTarget(t, flavor, expectHost) {
  const violations = [];
  const url = String(t.url || '').trim();
  const key = String(t.anonKey || '').trim();
  let host = '';

  if (!url) violations.push('url is empty');
  else {
    try { host = new URL(url).hostname.toLowerCase(); } catch (_) { violations.push('url is not a valid URL'); }
  }
  if (host && /\.invalid$/i.test(host)) violations.push(`url still points at .invalid (${host})`);
  if (host && flavor === 'china' && /(^|\.)supabase\.co$/i.test(host)) {
    violations.push(`china url is a *.supabase.co host (${host})`);
  }
  if (host && flavor === 'intl' && !/(^|\.)supabase\.co$/i.test(host) && !expectHost) {
    violations.push(`intl url is not a *.supabase.co host (${host})`);
  }
  if (expectHost && host && host !== String(expectHost).toLowerCase()) {
    violations.push(`url host ${host} != expected ${String(expectHost).toLowerCase()}`);
  }
  if (!key) violations.push('anonKey is empty');
  else if (Object.values(SENTINEL).includes(key)) violations.push('anonKey equals a build placeholder constant');

  // Same origin rule as the build gate. `previousUrl` is never inspected here.
  if (host && key && !Object.values(SENTINEL).includes(key)) {
    const payload = jwtPayload(key);
    if (flavor === 'intl' && /(^|\.)supabase\.co$/i.test(host)) {
      const ref = host.split('.')[0];
      if (!payload) violations.push(`anonKey is not a JWT — cannot prove it belongs to ${ref}`);
      else if (!payload.ref) violations.push(`anonKey has no JWT ref — expected ${ref}`);
      else if (payload.ref !== ref) violations.push(`anonKey JWT ref ${payload.ref} != supabase project ${ref}`);
    } else if (flavor === 'china' && payload && payload.ref) {
      violations.push(`china anonKey carries a supabase JWT ref (${payload.ref})`);
    }
  }

  return {
    file: t.file,
    host,
    anonKeySha8: key ? sha8(key) : 'none',
    previousHost: t.previousUrl ? hostOf(t.previousUrl) : '',
    violations,
  };
}

function checkBackendInjected({ artifact, dist, flavor = 'intl', expectHost, cwd } = {}) {
  const fl = normalizeBackendFlavor(flavor);
  const base = cwd || process.cwd();
  let dir = null;
  let extracted = null;

  if (dist) {
    dir = path.resolve(base, dist);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--dist is not a directory: ${dir}`);
  } else {
    if (!artifact) throw new Error('checkBackendInjected: need an artifact or --dist');
    const abs = path.resolve(base, artifact);
    if (!fs.existsSync(abs)) throw new Error(`artifact not found: ${abs}`);
    if (fs.statSync(abs).isDirectory()) dir = abs;
    else { extracted = extractArtifact(abs); dir = extracted.dir; }
  }

  try {
    const targets = collectBackendTargets(dir).map((t) => checkBackendTarget(t, fl, expectHost));
    const violations = [];
    if (!targets.length) violations.push('no MT_BACKEND found (learn/backend.config.js or Script.js)');
    for (const t of targets) for (const v of t.violations) violations.push(`${t.file}: ${v}`);
    return { ok: violations.length === 0, flavor: fl, targets, violations };
  } finally {
    if (extracted) fs.rmSync(extracted.root, { recursive: true, force: true });
  }
}

// CLI/publish-path wrapper. Always refuses placeholders: this gate is the last
// line before an upload, so it never reads MT_ALLOW_PLACEHOLDER_BACKEND.
function assertBackendInjected(opts = {}) {
  const result = checkBackendInjected(opts);
  for (const t of result.targets) {
    console.log(`  ${t.file}: host=${t.host || '(none)'} anonKey=sha256:${t.anonKeySha8}`
      + (t.previousHost ? ` previousUrl=${t.previousHost}` : ''));
  }
  if (!result.ok) {
    console.error(`✗ backend-injected gate: ${result.violations.length} violation(s) (flavor=${result.flavor})`);
    for (const v of result.violations.slice(0, 30)) console.error('  ' + v);
    process.exit(1);
  }
  console.log(`✓ backend-injected gate: ${result.targets.length} target(s) look shippable (flavor=${result.flavor})`);
  return result;
}

module.exports = {
  assertVersionIntegrity,
  versionInZip,
  checkBackendInjected,
  assertBackendInjected,
  SHIPPING_PATHS,
};
