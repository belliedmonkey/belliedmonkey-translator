// test/cn-relay-gate.test.js — CN 中继地址与构建闸。
//
// 2026-11-04（BEL-188）：旧的腾讯云 Web 函数被删掉后，旧主机名仍然能编译、能签名、
// 能出包 —— 只有用户点翻译时才会失败。这个文件守三件事：
//   1. CN 的 relay 常量是现网新入口（intl 分支走 BEL-172 注入，常量是惰性占位）；
//   2. 全仓（工作树）不再出现旧主机名；
//   3. 构建闸在非 200 / 网络错误时必须抛错，200 时打出「CN relay spec 200」。
//
// 旧主机名在这里**故意拆开写**，否则这个测试自己就会成为全仓 grep 的那一条命中。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, match } = require('./harness');
const { assertCnRelaySpec, specUrl } = require('../build/cn-relay-gate.js');

const ROOT = path.join(__dirname, '..');
const CFG = require('../extension/learn/backend.config.js');
const PROD_RELAY = 'https://1320551096-573eoa6wc4.ap-beijing.tencentscf.com';
const OLD_TOKEN = '0kh88' + 'p4r7e'; // 不写成连续串：见文件头

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    // .local 是本机草稿，按任务口径不算；out/ 是本次出包目录，不参与源码门禁。
    if (['.git', 'node_modules', '.local', 'out', 'out-reg', '.reasonix', 'test/layout/artifacts'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(p, out); continue; }
    out.push(p);
  }
  return out;
}

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.txt', '.sh', '.plist',
  '.swift', '.yml', '.yaml', '.xml', '.pbxproj', '.cff', '.strings', '.xcscheme',
]);

describe('CN relay — 现网入口常量', () => {
  test('CN 分支写死新 SCF 入口；intl 分支保留 BEL-172 惰性占位 + 注入', () => {
    const relay = String(CFG.grant.china.relayUrl || '').replace(/\/+$/, '');
    if (relay === 'https://relay.invalid') {
      // intl：BEL-172 把真实主机从 OSS 树里拿掉了，构建时由 MT_CHINA_RELAY_URL 注入。
      ok(fs.existsSync(path.join(ROOT, 'build/backend-inject.js')),
        'intl 的 relay 占位却没有 build/backend-inject.js —— 真实地址将没有来源');
      const inject = fs.readFileSync(path.join(ROOT, 'build/backend-inject.js'), 'utf8');
      match(inject, /chinaRelay:\s*'MT_CHINA_RELAY_URL'/, '注入模块不再认 MT_CHINA_RELAY_URL');
    } else {
      eq(relay, PROD_RELAY,
        `CN relay 不是 2026-11-04 的新入口：${relay}`);
    }
  });

  test('新旧主机名不会同时出现 —— 旧域名在配置文件里 0 命中', () => {
    const src = fs.readFileSync(path.join(ROOT, 'extension', 'learn', 'backend.config.js'), 'utf8');
    ok(!src.includes(OLD_TOKEN), 'backend.config.js 又出现了旧中继主机名');
  });

  test('工作树全文不再出现旧主机名（.local/out 除外）', () => {
    const hits = [];
    for (const p of walk(ROOT)) {
      if (!TEXT_EXT.has(path.extname(p))) continue;
      let st;
      try { st = fs.statSync(p); } catch (_) { continue; }
      if (st.size > 5 * 1024 * 1024) continue;
      let text;
      try { text = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
      if (text.includes(OLD_TOKEN)) hits.push(path.relative(ROOT, p));
    }
    eq(hits.length, 0, '旧中继主机名仍有命中：\n  ' + hits.join('\n  '));
  });
});

describe('CN relay — /spec 构建闸', () => {
  test('specUrl 拼在 relay 根上，并容忍尾部斜杠', () => {
    eq(specUrl(PROD_RELAY), PROD_RELAY + '/spec');
    eq(specUrl(PROD_RELAY + '///'), PROD_RELAY + '/spec');
  });

  test('200 → 通过，并打出固定日志「CN relay spec 200」', () => {
    const logs = [];
    const r = assertCnRelaySpec(PROD_RELAY, {
      getStatus: (u) => { eq(u, PROD_RELAY + '/spec'); return '200'; },
      log: (m) => logs.push(m),
    });
    eq(r.status, 200);
    eq(r.url, PROD_RELAY + '/spec');
    eq(logs.length, 1, `成功时只应打一行，实际 ${logs.length} 行`);
    ok(logs[0].includes('CN relay spec 200'), `日志缺少固定串：${logs[0]}`);
  });

  test('非 200 → 抛错，且不打印成功日志', () => {
    const logs = [];
    let error = null;
    try {
      assertCnRelaySpec(PROD_RELAY, { getStatus: () => '503', log: (m) => logs.push(m) });
    } catch (e) { error = e; }
    ok(error, '503 竟然没有让构建闸抛错');
    match(error.message, /HTTP 503/);
    match(error.message, /要求 200/);
    eq(logs.length, 0, '探活失败时不许打印「CN relay spec 200」');
  });

  test('网络错误 → 抛错（不把「连不上」当成 200）', () => {
    let error = null;
    try {
      assertCnRelaySpec(PROD_RELAY, {
        getStatus: () => { throw new Error('Could not resolve host'); },
        log: () => {},
      });
    } catch (e) { error = e; }
    ok(error, '网络错误竟然没有让构建闸抛错');
    match(error.message, /探活失败/);
    match(error.message, /Could not resolve host/);
  });

  test('build.js 在 CN flavor 写产物之前调用这道闸', () => {
    const build = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const i = build.indexOf('assertCnRelaySpec');
    ok(i >= 0, 'build.js 没有调用 assertCnRelaySpec —— 构建闸没接上');
    ok(/FLAVOR === 'china'/.test(build.slice(Math.max(0, i - 500), i)),
      '构建闸不在 CN flavor 分支里');
    ok(i < build.indexOf('copyDir(SRC, DIST)'),
      '构建闸排在产物写入之后 —— 失败时已经留下半成品');
  });
});
