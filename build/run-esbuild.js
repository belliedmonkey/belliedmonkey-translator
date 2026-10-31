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
  for (const { entry, out, format, globalName } of entries) {
    es.buildSync(buildOptions({
      entryPoints: [path.join(ROOT, entry)],
      outfile: path.join(dist, out),
      // per-entry 覆盖（PR8a：content 懒加载 bundle 要 ESM；IIFE 回退经 globalName
      // 挂 window.MTSubMenuBundle）。缺省仍 iife —— 既有页面产物形态不变。
      ...(format ? { format } : {}),
      ...(globalName ? { globalName } : {}),
    }));
    if (log) log(`UI bundle: ${entry} → ${out}`);
  }
  return entries.length;
}

// ── §9.4 对账门：「同一份源模块、同一次编译、零分叉」的可执行形式 ─────────────
// 把 App 单入口与扩展全部 UI bundle 各用 write:false 现场编一遍、取 metafile，
// 收集每个 bundle 输入里 src/shared/** 的文件集合：App 的集合必须与扩展并集相等。
// 它咬住一切分叉形态：某宿主漏 import 一份共用组件；有人绕开 src/shared 复制旧
// IIFE 回来（新副本不出现在集合里，另一侧有 ⇒ 集合立即不等）；PR7b/7c 随共享面
// 扩充时一侧多挂或少挂。入口文件不特判 —— 集合语义就是「这个 bundle 的图里出现
// 过的 src/shared 文件」，两宿主该一致的就是这个集合。
function sharedInputs(metafile) {
  const out = new Set();
  for (const f of Object.keys(metafile.inputs)) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel.startsWith('src/shared/')) out.add(rel);
  }
  return out;
}

function checkSharedParity({ appEntry, entries }) {
  const es = esbuild();
  const appShared = sharedInputs(es.buildSync(buildOptions({
    entryPoints: [path.join(ROOT, appEntry)],
    outdir: 'metafile-check/app',
    write: false,
    metafile: true,
  })).metafile);
  const extShared = new Set();
  for (const { entry } of (entries || [])) {
    for (const f of sharedInputs(es.buildSync(buildOptions({
      entryPoints: [path.join(ROOT, entry)],
      outdir: 'metafile-check/ui',
      write: false,
      metafile: true,
    })).metafile)) extShared.add(f);
  }
  const missApp = [...extShared].filter((f) => !appShared.has(f));
  const missExt = [...appShared].filter((f) => !extShared.has(f));
  if (missApp.length || missExt.length) {
    const lines = ['§9.4 对账门：两宿主的 src/shared 集合不一致'];
    if (missApp.length) lines.push('  扩展挂了、App 没挂：' + missApp.join(', '));
    if (missExt.length) lines.push('  App 挂了、扩展没挂：' + missExt.join(', '));
    throw new Error(lines.join('\n'));
  }
  return { app: [...appShared].sort(), ext: [...extShared].sort() };
}

module.exports = { TARGET, buildOptions, bundleUiEntries, checkSharedParity };
