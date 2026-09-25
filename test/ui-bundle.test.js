// test/ui-bundle.test.js — React 工具链的提前红门（domain-design §10，工具链 PR 起）。
//
// 三件事，全部在 `npm test` 就红，而不是等到 build / 中国出包 / 线上白屏：
// ① esbuild 产物过 OS-floor 解析期语法门：target 单一来源取 os-floor.config，
//    react 升级带进新语法 ⇒ 这里先红；
// ② 将被 bundle 进包的 react / react-dom production 源文本过中国合规 grep ——
//    china build 扫的是 dist-china 产物，这里把同一张禁令表直接喂给依赖源码，
//    升级 react 的那个 PR 自己就能看见红，不用跑到 china flavor 那一步；
// ③ 同一产物过 legacyBrandGate 的禁用 hex 表（palette.config.forbiddenLegacy）。
//
// 需要 node_modules（`npm ci`）：这不是缺陷，是 §10.1 新约定的一部分 —— 构建期
// devDependencies 落地后，没装依赖的树本来就不该绿。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const { TARGET, buildOptions } = require('../build/run-esbuild.js');
const { FLOOR, syntaxViolations } = require('../build/os-floor.config.js');
const chinaGate = require('../build/china-gate.js');
const palette = require('../build/palette.config.js');

function buildSmokeBundle() {
  let es;
  try { es = require('esbuild'); }
  catch { throw new Error('esbuild 不在 node_modules —— 先 `npm ci`'); }
  // 最小但真实：走 jsx automatic + react-dom/client，bundle 进完整 react 运行时。
  const r = es.buildSync(buildOptions({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { useState } from 'react';
        function Smoke() { const [n] = useState(1); return <p hidden={!n}>ok</p>; }
        export function mount(el) { createRoot(el).render(<Smoke />); }
        globalThis.__uiSmoke = mount;
      `,
      resolveDir: ROOT,
      loader: 'jsx',
      sourcefile: 'ui-smoke.jsx',
    },
    write: false,
    sourcemap: false,
  }));
  return r.outputFiles[0].text;
}

// 将被 bundle 的依赖源文件（production 变体 —— buildOptions 钉了 NODE_ENV=production）
function bundledDepFiles() {
  const out = [];
  for (const pkg of ['react', 'react-dom']) {
    const dir = path.join(ROOT, 'node_modules', pkg, 'cjs');
    if (!fs.existsSync(dir)) throw new Error(`node_modules/${pkg} 不在 —— 先 \`npm ci\``);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.production.js')) continue;
      out.push({ name: `${pkg}/cjs/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf8') });
    }
  }
  return out;
}

describe('ui-bundle — React 工具链冒烟（§10）', () => {
  test('target 单一来源：esbuild target 就是 os-floor 的 FLOOR.safari', () => {
    eq(TARGET, 'safari' + FLOOR.safari);
    eq(buildOptions().target[0], TARGET);
  });

  test('esbuild 冒烟产物过 OS-floor 解析期语法门', () => {
    const text = buildSmokeBundle();
    ok(text.length > 50000, `产物应含完整 react 运行时（实际 ${text.length} 字节 —— bundle 没生效？）`);
    const hits = syntaxViolations(text);
    eq(hits.length, 0, 'bundle 里出现比下限新的解析期语法：\n' +
      hits.map((h) => `  ${h.id} @${h.line}: ${h.text}`).join('\n'));
  });

  test('react/react-dom production 源文本过中国合规 grep（升级 react 先在这红）', () => {
    const files = bundledDepFiles();
    ok(files.length >= 4, `production 源文件只找到 ${files.length} 个 —— 文件名约定变了？扫空即假绿`);
    const hits = chinaGate.scan(files, { grantHost: '' });
    eq(hits.length, 0, '依赖源码命中禁令表：\n  ' + hits.slice(0, 10).join('\n  '));
  });

  test('冒烟产物不含 legacyBrandGate 禁用 hex', () => {
    const text = buildSmokeBundle().toLowerCase();
    for (const hex of palette.forbiddenLegacy) {
      ok(!text.includes(hex.toLowerCase()), `bundle 含禁用旧品牌色 ${hex}`);
    }
  });

  test('清单为空时 build 不需要 esbuild：ui-entries 与 bundleUiEntries 的 no-op 契约', () => {
    const { ENTRIES } = require('../build/ui-entries.config.js');
    const { bundleUiEntries } = require('../build/run-esbuild.js');
    // 清单可以为空（工具链 PR 阶段就是空）；为空时 bundleUiEntries 必须 0 产物、不炸。
    ok(Array.isArray(ENTRIES));
    eq(bundleUiEntries({ entries: [], dist: '/nonexistent', log: null }), 0);
  });
});
