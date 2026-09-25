// build/run-esbuild.js — esbuild 的唯一薄封装（build.js 与 test/ 共用）。
//
// target 单一来源取 build/os-floor.config.js 的 FLOOR.safari —— 解析期语法门与
// 打包器永远说同一个数（esbuild 对降不动的语法直接报错，本身就是一道前置门）。
// esbuild / react 是构建期 devDependencies（domain-design §10.1）：运行时零依赖
// 不变，版本由 package-lock.json 钉死，先 `npm ci` 再构建。
'use strict';

const path = require('path');
const { FLOOR } = require('./os-floor.config.js');

const ROOT = path.join(__dirname, '..');
const TARGET = 'safari' + FLOOR.safari;

function esbuild() {
  try { return require('esbuild'); }
  catch {
    throw new Error('esbuild 不在 node_modules —— 先 `npm ci`（构建期 devDependencies，domain-design §10）');
  }
}

// 共用编译选项：IIFE / JSX automatic / production / 不 minify（§10.1 的裁定 ——
// AMO 可读、门禁可读、diff 可人审）。
function buildOptions(extra = {}) {
  return Object.assign({
    bundle: true,
    format: 'iife',
    target: [TARGET],
    jsx: 'automatic',
    charset: 'utf8',
    minify: false,
    sourcemap: 'linked',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  }, extra);
}

// 按登记处清单出全部 UI bundle，产物覆盖 dist 内同名文件。清单为空 ⇒ 严格 no-op。
function bundleUiEntries({ entries, dist, log }) {
  if (!entries || !entries.length) return 0;
  const es = esbuild();
  for (const { entry, out } of entries) {
    es.buildSync(buildOptions({
      entryPoints: [path.join(ROOT, entry)],
      outfile: path.join(dist, out),
    }));
    if (log) log(`UI bundle: ${entry} → ${out}`);
  }
  return entries.length;
}

module.exports = { TARGET, buildOptions, bundleUiEntries };
