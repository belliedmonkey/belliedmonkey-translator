// test/upload-gate.test.js — BEL-692 上传硬闸。
//
// 两件事必须同时成立，缺一不可：
//   1. `scripts/check-shippable.js` 见到任何 dist*/.not-shippable 就非零退出，
//      并打印标记文件与内容；干净树才放行。
//   2. 归档/上传脚本把这道闸排在 `xcrun altool --upload-app` 之前 —— 标记存在时
//      宁可整行失败，也绝不调用 altool。
//
// 完整的 archive-upload.sh 不能在这组测试里直接跑：它 source 固定路径的 common.sh，
// 还要 preflight、验收结论、ASC 构建号、两次构建、xcodebuild 归档与导出。这里用
// 「同一形状的两行 shell」验证非零/不调用，再用源码顺序断言锁住真实脚本的接线；
// 这正是不引入发布依赖的可行上限。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(ROOT, 'scripts', 'check-shippable.js');
const UPLOAD = path.join(ROOT, 'docs', 'status', 'r5', 'hostexec5', 'archive-upload.sh');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-692-upload-'));
}

function runCheck(args, env = {}) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: Object.assign({}, process.env, env),
  });
}

function writeFakeTool(bin, name, sentinel) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, `#!/bin/bash\necho "${name} $*" >> "$SENTINEL"\nexit 0\n`);
  fs.chmodSync(file, 0o755);
}

// 与 archive-upload.sh 里「闸 → altool」同形的两行：闸非零就 exit，后面的
// xcrun 在 shell 语义上根本不会执行。fake xcrun 只写 sentinel，不联网。
function shellGate(root) {
  // 假工具放 root 里，跑完随 root 一起清掉；check-shippable 只看固定 dist* 名。
  const bin = path.join(root, '.fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const sentinel = path.join(bin, 'sentinel');
  writeFakeTool(bin, 'xcrun', sentinel);
  writeFakeTool(bin, 'altool', sentinel);
  const script = [
    'set -e',
    '"$NODE" "$CHECK" --root "$TMPROOT" || exit 1',
    'xcrun altool --upload-app -f /tmp/fake.ipa -t ios',
  ].join('\n');
  const r = spawnSync('/bin/bash', ['-c', script], {
    encoding: 'utf8',
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      NODE: process.execPath,
      CHECK,
      TMPROOT: root,
      SENTINEL: sentinel,
      PATH: `${bin}:${process.env.PATH || ''}`,
    }),
  });
  return { r, sentinel };
}

function makeDirs(root) {
  for (const d of ['dist', 'dist-app', 'dist-china', 'dist-app-china', 'dist-firefox']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
}

describe('BEL-692 上传硬闸：marker 必败、干净放行、altool 永不被越过', () => {
  test('dist/.not-shippable → exit 1，报文件与内容', () => {
    const root = tmpdir();
    try {
      makeDirs(root);
      fs.writeFileSync(path.join(root, 'dist', '.not-shippable'), 'E2E build: MT_SYNC_E2E=1\n');
      const r = runCheck(['--root', root]);
      eq(r.status, 1, `干净树外的 marker 没被拦：stdout=${r.stdout}\nstderr=${r.stderr}`);
      ok(/NOT SHIPPABLE/.test(r.stderr), r.stderr);
      ok(r.stderr.includes(path.join('dist', '.not-shippable')), r.stderr);
      ok(r.stderr.includes('E2E build: MT_SYNC_E2E=1'), r.stderr);
      ok(!/no \.not-shippable marker in/.test(r.stdout), '失败路径不应打印放行');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('dist-app* / dist-china / dist-firefox 的 marker 同样必败', () => {
    for (const dir of ['dist-app', 'dist-china', 'dist-app-china', 'dist-firefox']) {
      const root = tmpdir();
      try {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
        fs.writeFileSync(path.join(root, dir, '.not-shippable'), `blocked: ${dir}\n`);
        const r = runCheck(['--root', root]);
        eq(r.status, 1, `${dir}/.not-shippable 没被拦：${r.stderr}`);
        ok(r.stderr.includes(dir), r.stderr);
        ok(r.stderr.includes(`blocked: ${dir}`), r.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('★ 标记存在时 shell 闸非零，fake altool 未被调用（sentinel 不存在）', () => {
    const root = tmpdir();
    try {
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'dist', '.not-shippable'), 'placeholder backend allowed\n');
      const { r, sentinel } = shellGate(root);
      ok(r.status !== 0, `闸后仍走到了 altool（status=${r.status}）`);
      ok(!fs.existsSync(sentinel), `altool 被调用了：${fs.existsSync(sentinel) ? fs.readFileSync(sentinel, 'utf8') : ''}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('干净 root → exit 0；同一 shell harness 确实能走到 altool（对照组）', () => {
    const root = tmpdir();
    try {
      makeDirs(root);
      const direct = runCheck(['--root', root]);
      eq(direct.status, 0, direct.stderr);
      ok(/no \.not-shippable marker in/.test(direct.stdout), direct.stdout);

      const { r, sentinel } = shellGate(root);
      eq(r.status, 0, `干净树被误拦：${r.stderr}`);
      ok(fs.existsSync(sentinel), '对照组没走到 fake altool —— harness 本身失效');
      ok(/altool --upload-app/.test(fs.readFileSync(sentinel, 'utf8')), fs.readFileSync(sentinel, 'utf8'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('执行 gate 不写任何文件（只读闸）', () => {
    const root = tmpdir();
    try {
      makeDirs(root);
      fs.writeFileSync(path.join(root, 'dist', 'asset.txt'), 'keep me\n');
      const before = fs.readdirSync(root, { recursive: true }).sort();
      const r = runCheck(['--root', root]);
      eq(r.status, 0, r.stderr);
      const after = fs.readdirSync(root, { recursive: true }).sort();
      eq(JSON.stringify(after), JSON.stringify(before), 'gate 改了产物目录');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('--verify-ios 的非零退出被原样传回', () => {
    const root = tmpdir();
    const dd = path.join(tmpdir(), 'dd-empty');
    try {
      makeDirs(root);
      fs.mkdirSync(dd, { recursive: true });
      const r = runCheck(['--root', root, '--verify-ios', dd]);
      ok(r.status !== 0, `verify:ios 失败没有传导：status=${r.status}`);
      ok(/verify-ios/.test(r.stdout + r.stderr), `${r.stdout}\n${r.stderr}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dd, { recursive: true, force: true });
    }
  });

  test('用法错误 exit 2，不折叠成成功', () => {
    const r = runCheck(['--nope']);
    eq(r.status, 2, r.stderr);
    ok(/unknown argument/.test(r.stderr), r.stderr);
  });

  test('★ archive-upload.sh：archive 前一次 gate，且每次 altool 前再 gate', () => {
    const sh = fs.readFileSync(UPLOAD, 'utf8');
    const sync = sh.indexOf('run app-sync npm run app:sync');
    const firstGate = sh.indexOf('node scripts/check-shippable.js');
    const archive = sh.indexOf('xcodebuild -project "$proj"');
    const verifyGate = sh.indexOf('node scripts/check-shippable.js --verify-ios "$dd" --flavor "$fl"');
    const altool = sh.indexOf('xcrun altool --upload-app');
    const occurrences = (sh.match(/node scripts\/check-shippable\.js/g) || []).length;

    ok(sync >= 0, 'app-sync 锚点没了');
    ok(occurrences === 2, `应有 2 次 gate（archive 前 + altool 前），实际 ${occurrences}`);
    ok(firstGate > sync, '归档前的 gate 没有排在 app-sync 之后');
    ok(firstGate < archive, '归档前的 gate 没有排在 xcodebuild archive 之前');
    ok(verifyGate >= 0, 'altool 前缺 marker+verify 的 gate');
    ok(verifyGate < altool, 'gate 没有排在 altool --upload-app 之前');
    ok(/-derivedDataPath "\$dd"/.test(sh), '没有给 verify:ios 准备 DerivedData 路径');
    ok(/fl=(global|china)/.test(sh), 'loop 没有为 flavor 选择 verify 目标');
  });
});
