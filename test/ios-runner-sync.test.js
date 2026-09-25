// test/ios-runner-sync.test.js —— 仓库里的 runner 源码与构建工作区里那份必须一致。
//
// 背景（2026-09-25）：遥控真机的 XCUITest runner 源码此前**只存在于 `.local/spike/S6/runner/`**，
// 而 `.gitignore` 忽略了整个 `.local/`。一天里加的 `testDrive` / `testFillKey` / `MT_NO_CLOSE` /
// 按标签找下拉 / 按住拖选，全都只在那一块盘上 —— 清一次 `.local` 就没了，而且没有任何东西会红。
// 于是把源码搬进 `tools/ios-runner/`，工作区退化成「构建用的副本」。
//
// 这道门只管一件事：**两份没有漂移**。漂移的典型形状是「改了工作区那份、跑通了、忘了同步回仓库」——
// 下一次从仓库重建工作区时那些改动就凭空消失，而现象是「昨天还好好的用例今天找不到了」。
//
// ⚠️ **工作区不存在时跳过，不红。** CI 上没有 `.local/`（它是 gitignored 的本地目录），
// 在那里要求两份一致是要求一件不可能的事 —— 那种门禁只会教人忽略红色。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, 'tools', 'ios-runner');
const WORK = path.join(ROOT, '.local', 'spike', 'S6', 'runner');

// 两份都该有的源码。工程文件（S56Runner.xcodeproj）是 XcodeGen 的生成物，不比。
const FILES = [
  ['UITests/S56UITests.swift', 'UITests/S56UITests.swift'],
  ['Host/HostApp.swift', 'Host/HostApp.swift'],
  ['project.yml', 'project.yml'],
];

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

describe('iOS runner：仓库里的源码就是权威的那一份', () => {
  test('tools/ios-runner 里三份源码都在', () => {
    for (const [rel] of FILES) {
      ok(fs.existsSync(path.join(REPO, rel)), `仓库里缺 tools/ios-runner/${rel}`);
    }
  });

  test('README 把「每次重建要人点图标」写清楚了 —— 这条今天卡住过两次', () => {
    const md = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
    ok(md.includes('Developer App Certificate is not trusted'), 'README 没写那条报错原文');
    ok(md.includes('S56UITests-Runner'), 'README 没说要点哪个图标');
    ok(/没有.*开发者App/.test(md), 'README 没写「VPN与设备管理里没有开发者App那一节」——去那里找是死路');
  });

  test('testDrive 的步骤表与实现里的 op 对得上 —— README 少写一个 op，用它的人就不知道有', () => {
    const swift = fs.readFileSync(path.join(REPO, 'UITests/S56UITests.swift'), 'utf8');
    const drive = swift.slice(swift.indexOf('func testDrive()'));
    const impl = new Set([...drive.matchAll(/^\s*case "([a-z]+)"/gm)].map((m) => m[1]));
    ok(impl.size >= 10, `testDrive 里只解析出 ${impl.size} 个 op，实现可能被改坏了`);
    const md = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
    const missing = [...impl].filter((op) => !md.includes(`\`${op}\``));
    eq(missing.join(','), '', `README 的步骤表漏了这些 op：${missing.join(', ')}`);
  });

  test('与构建工作区没有漂移（工作区不存在就跳过）', () => {
    if (!fs.existsSync(WORK)) {
      console.log('    – 没有 .local/spike/S6/runner，跳过（CI 上本来就没有）');
      return;
    }
    const drift = [];
    for (const [rel, wrel] of FILES) {
      const a = path.join(REPO, rel);
      const b = path.join(WORK, wrel);
      if (!fs.existsSync(b)) { drift.push(`${wrel}（工作区缺）`); continue; }
      if (sha(a) !== sha(b)) drift.push(wrel);
    }
    eq(drift.join(', '), '',
      `仓库与工作区不一致：${drift.join(', ')}\n` +
      '    改完哪一份都要同步另一份（见 tools/ios-runner/README.md）');
  });
});
