// test/app-test-bridge.test.js — §0.4 分层验证矩阵的三件套门（docs/verification-spec.md §0.4，
// 2026-10-05 用户拍板「要修改也同步更新文档」—— 这份门就是那条规则的机检版：代码与文档
// 任何一边漂了，这里红）。
//
// 三件套：
//   1. app/test-harness.js —— 只在 opts.testHarness 时进包，自己不发起网络
//   2. app/native/test-bridge.swift —— 整份 #if DEBUG（Release 编译器裁掉，不是运行时关）
//   3. scripts/sync-app-assets.js —— BLOCKS + install 行（#if DEBUG 块，锚在 vault 整块后）
// 加一条文档同步门：§0.4 必须点名这三个文件与 test:mac。

'use strict';

const fs = require('fs');
const path = require('path');
const { test, ok } = require('./harness');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('★ test-bridge.swift 整份 #if DEBUG —— Release 包里符号必须不存在', () => {
  const swift = read('app/native/test-bridge.swift').trim();
  ok(swift.startsWith('#if DEBUG'), '文件没有以 #if DEBUG 开头 —— 端点会编进 Release 包。这是能对页面执行任意 JS 的洞，只能靠编译器裁掉');
  ok(swift.endsWith('#endif'), '文件没有以 #endif 结尾 —— #if 块没闭合，Debug 构建也编不过');
  const opens = (swift.match(/^#if/gm) || []).length;
  const closes = (swift.match(/^#endif/gm) || []).length;
  ok(opens === closes, `#if/#endif 不配对（${opens}/${closes}）`);
  ok(/只绑回环|requiredLocalEndpoint/.test(swift.replace(/\n/g, ' ')), 'listener 没有钉在 127.0.0.1 —— DEBUG 包也不许监听局域网');
});

test('★ sync-app-assets：test bridge 的 BLOCKS 与 install 行都在，且 install 裹在 #if DEBUG 里', () => {
  const sync = read('scripts/sync-app-assets.js');
  ok(/name:\s*'mt-test-bridge',\s*src:\s*'test-bridge\.swift'/.test(sync), 'BLOCKS 里没有 mt-test-bridge —— 桥永远不会被 patch 进 ViewController');
  ok(/'        #if DEBUG\\n        MTTestBridge\.attach\(self\.webView\)\\n        #endif'/.test(sync),
    'install 行没有裹在 #if DEBUG 里 —— Release 构建时 MTTestBridge 符号不存在，这行会让编译直接红（这层双保险是编译器给的）');
  // 锚点必须是 vault 那一整块（含 #endif），不是 MTVault.shared.install 那一行 ——
  // 锚在那一行上会落进 #if os(iOS) 里，Mac 上就永远没有端点，而 Mac 恰是这一层的验证台。
  ok(/replace\(VAULT_LINES,\s*VAULT_LINES \+ '\\n' \+ TESTB_LINES\)/.test(sync.replace(/\n/g, ' ')),
    'test bridge 的 install 没有锚在 VAULT_LINES 整块后面 —— 会插进 #if os(iOS) 里，macOS 拿不到端点');
});

test('★ test-harness.js 不发起任何网络 —— 没有端点的包里它是死代码', () => {
  const js = read('app/test-harness.js');
  ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(js), 'harness 里出现了网络调用 —— 它的纪律是「只注入事件、只读状态」，网络只属于原生端点');
  ok(/_fromNative/.test(js), 'harness 没有走 NativeSpeech._fromNative 注入 —— 绕开真管线就不是同一份 case 了');
});

test('★ harness 只在 opts.testHarness 时进包（双向，真构建）', () => {
  const { buildAppBundle } = require('../build/app-bundle.js');
  const os = require('os');
  const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mt-harness-gate-'));
  const quiet = () => {};

  const plain = mk();
  buildAppBundle(plain, quiet, {});
  const plainJs = fs.readFileSync(path.join(plain, 'Script.js'), 'utf8');
  ok(!plainJs.includes('__mtTest'), '不带 testHarness 构建出的 Script.js 里有 __mtTest —— 出货包不带它，这是 §0.4 的进包纪律');

  const withH = mk();
  buildAppBundle(withH, quiet, { testHarness: true });
  const withJs = fs.readFileSync(path.join(withH, 'Script.js'), 'utf8');
  ok(withJs.includes('window.__mtTest'), '带 testHarness 构建出的 Script.js 里没有 __mtTest —— 驱动端点起来了也没接口可调');
});

test('★ §0.4 文档点名三件套 + test:mac —— 代码与文档不得单边漂', () => {
  const doc = read('docs/verification-spec.md');
  const sec = doc.slice(doc.indexOf('### 0.4 分层验证矩阵'), doc.indexOf('### 1.0 Provider matrix'));
  ok(sec.length > 200, 'verification-spec.md 里找不到 §0.4（或它空得可疑）');
  for (const needle of ['app/test-harness.js', 'app/native/test-bridge.swift', 'scripts/test-mac.js', 'test:mac', '127.0.0.1:8790']) {
    ok(sec.includes(needle), `§0.4 没有提到 ${needle} —— 改了机制必须同一 commit 更新文档（用户 2026-10-05 原话）`);
  }
  ok(/Mac 替代不了/.test(sec), '§0.4 丢了「Mac 替代不了」清单 —— Mac 绿了不等于全绿');
});
