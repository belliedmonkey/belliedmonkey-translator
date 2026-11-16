// test/test400-probe.test.js — BEL-280 TEST-BUILD-ONLY relay 400 probe.
//
// Two independent claims are pinned here:
//   1. build/test400.js only accepts the four relay reasons, and an unset build
//      removes BOTH sentinels from request-shape.js (so `x-mt-test-400` cannot be
//      grepped out of a shipped bundle).
//   2. scripts/check-shippable.js fails closed when the literal marker appears in
//      any dist* tree — even if the .not-shippable marker is missing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const test400 = require('../build/test400.js');
const CHECK = path.join(ROOT, 'scripts', 'check-shippable.js');
const SHAPE = path.join(ROOT, 'extension', 'content', 'request-shape.js');

describe('BEL-280 build/test400：枚举与构建期替换', () => {
  test('MT_TEST_400 只认四个 reason；未设返回空串；写错直接失败', () => {
    eq(test400.reasonFromEnv({}), '');
    eq(test400.reasonFromEnv({ MT_TEST_400: '  ' }), '');
    for (const reason of test400.REASONS) eq(test400.reasonFromEnv({ MT_TEST_400: reason }), reason);
    let threw = false;
    try { test400.reasonFromEnv({ MT_TEST_400: 'anything_else' }); } catch (_) { threw = true; }
    ok(threw, '非法 MT_TEST_400 必须让构建失败，不能静默生成一个不发送头的「测试包」');
  });

  test('未设：两个哨兵都被替换成空串，头名一个字都不剩', () => {
    const out = test400.apply(fs.readFileSync(SHAPE, 'utf8'), '');
    ok(out.indexOf(test400.SENTINEL_HEADER) < 0, 'header 哨兵残留');
    ok(out.indexOf(test400.SENTINEL_REASON) < 0, 'reason 哨兵残留');
    ok(out.indexOf('x-mt-test-400') < 0, '未设构建里出现了头名字面量');
    ok(out.indexOf('grantHeaders') >= 0, 'grantHeaders 汇合点不见了');
  });

  test('设了：头名与 reason 只写进 grant 请求的头，其他分支不受影响', () => {
    const out = test400.apply(fs.readFileSync(SHAPE, 'utf8'), 'messages_json');
    ok(out.indexOf("'x-mt-test-400'") >= 0, '头名没有注入');
    ok(out.indexOf("'messages_json'") >= 0, 'reason 没有注入');
    ok(out.indexOf(test400.SENTINEL_HEADER) < 0 && out.indexOf(test400.SENTINEL_REASON) < 0,
      '哨兵残留');
    // 汇合点仍然是「role === 'grant'」那一个 guard，不是每个形状各写一份。
    ok(/role !== 'grant' \|\| !TEST400_HEADER \|\| !TEST400_REASON/.test(out),
      'grantHeaders 的 guard 被改动了');
  });

  test('半套哨兵 / 非法 reason 直接抛错（拒绝生成半个探针）', () => {
    let threw = 0;
    try { test400.apply('const x = "__MT_TEST400_HEADER__";', ''); } catch (_) { threw += 1; }
    try { test400.apply('__MT_TEST400_HEADER__ __MT_TEST400_REASON__', 'nope'); } catch (_) { threw += 1; }
    eq(threw, 2, '损坏的哨兵对与非法 reason 都必须失败');
  });
});

describe('BEL-280 check-shippable：dist* 里出现测试头即非零', () => {
  function runCheck(root) {
    return spawnSync(process.execPath, [CHECK, '--root', root], { encoding: 'utf8', cwd: ROOT });
  }

  test('干净树放行；任意 dist* 文件含 x-mt-test-400 即 exit 1 并点名文件', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-bel280-'));
    try {
      for (const d of ['dist', 'dist-app', 'dist-china', 'dist-app-china', 'dist-firefox']) {
        fs.mkdirSync(path.join(root, d), { recursive: true });
      }
      let r = runCheck(root);
      eq(r.status, 0, '干净树被误拦：' + r.stderr);
      ok(/no x-mt-test-400 test-probe marker/.test(r.stdout), r.stdout);

      fs.mkdirSync(path.join(root, 'dist-app', 'nested'), { recursive: true });
      const hit = path.join(root, 'dist-app', 'nested', 'Script.js');
      fs.writeFileSync(hit, 'const h = {"x-mt-test-400":"messages_json"};\n');
      r = runCheck(root);
      eq(r.status, 1, '测试头没有被拦：' + r.stdout + r.stderr);
      ok(/NOT SHIPPABLE/.test(r.stderr), r.stderr);
      ok(r.stderr.includes(path.join('dist-app', 'nested', 'Script.js')), r.stderr);
      ok(/test build/i.test(r.stderr), r.stderr);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
