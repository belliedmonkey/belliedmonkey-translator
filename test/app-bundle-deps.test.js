// test/app-bundle-deps.test.js — App 包的模块清单是个**白名单**。
//
// build/app-bundle.js 的 MODULES 是手写的一串路径。扩展那边的某个文件新增一处
// 跨模块依赖时，**没有任何东西**会提醒你新依赖没跟着进包：包照样拼得出来、App 照样
// 起得来、页面照样渲染，只有真正走到那条路的时候才 ReferenceError，而那个错往往
// 被上层收成一句人畜无害的失败原因。
//
// 2026-09-01 实测：判据合并把 translation-api.js 的 providerById / defaultProvider /
// resolveProvider 改成转调 EngineState，而 engine-state.js 没进 MODULES。后果是
// App 里每一次补译文都抛 `EngineState is not defined`，driving.js 把它收成
// `translate_failed ×1` —— 一整条功能在 App 上是死的，扩展那边一切正常，
// 而唯一发现它的是学习套件里一条关于缓存的断言。
//
// 判据：包里每个源文件引用到的**模块全局**，都必须由包里另一个源文件定义。
// 「模块全局」不靠猜 —— 本仓库只有两种写法：顶层 `var Name = (() => …)()`（IIFE 模块，
// 靠顶层 var 变成全局；engine-state.js 就是这种），和显式的 `window.Name = Name`。
// `typeof X` 守卫过的引用放行：那是「有就用、没有就算」的可选依赖（LangDetect 那种）。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');
const { stripComments } = require('./lib/strip-comments');
const { MODULES, APP_JS } = require('../build/app-bundle.js');

const ROOT = path.join(__dirname, '..');

// 一个源文件定义了哪些模块全局。顶层（第 0 列）的 `var/const/let Name =` 就是一个模块
// 全局 —— 拼进一个文件之后它们都在同一个作用域里，这正是 App 包的工作方式。
function definedIn(src) {
  const out = new Set();
  const clean = stripComments(src);
  for (const m of clean.matchAll(/^(?:var|const|let)\s+([A-Z][A-Za-z0-9_]*)\s*=/gm)) out.add(m[1]);
  for (const m of clean.matchAll(/window\.([A-Z][A-Za-z0-9_]*)\s*=/g)) out.add(m[1]);
  return out;
}

// 全仓库的模块全局。
function allGlobals() {
  const out = new Map();   // 名字 → 定义它的相对路径
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '_locales') walk(p); }
      else if (e.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const n of definedIn(src)) out.set(n, path.relative(ROOT, p));
      }
    }
  })(path.join(ROOT, 'extension'));
  for (const f of fs.readdirSync(path.join(ROOT, 'app'))) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(ROOT, 'app', f);
    for (const n of definedIn(fs.readFileSync(p, 'utf8'))) out.set(n, path.relative(ROOT, p));
  }
  return out;
}

describe('App 包里引用到的模块全局，都得在包里', () => {
  const globals = allGlobals();
  const bundled = MODULES.concat([APP_JS]);
  const bundledSet = new Set(bundled);
  // 包里定义了哪些全局。
  const provided = new Set([...globals].filter(([, f]) => bundledSet.has(f)).map(([n]) => n));

  test('扫到了全局和模块 —— 扫不到东西的断言不是门禁', () => {
    ok(globals.size >= 20, `只扫到 ${globals.size} 个模块全局，扫法走歪了？`);
    ok(bundled.length >= 20, `MODULES 只有 ${bundled.length} 项，读法走歪了？`);
    ok(provided.has('TranslationAPI'), '包里应当定义 TranslationAPI —— 断言的基准错了');
  });

  test('★ 没有引用到包外的模块全局', () => {
    const bad = [];
    for (const rel of bundled) {
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) { bad.push(`${rel} 在 MODULES 里但文件不存在`); continue; }
      const src = stripComments(fs.readFileSync(abs, 'utf8'));
      const selfDefined = definedIn(src);
      for (const [name, home] of globals) {
        if (provided.has(name) || selfDefined.has(name)) continue;
        // 只认「当成对象用」的引用：`Name.` 或 `Name(`。裸名字太容易撞上局部变量。
        const use = new RegExp(`\\b${name}\\s*[.(]`, 'g');
        let m;
        while ((m = use.exec(src))) {
          // typeof 守卫 = 可选依赖，放行。
          const before = src.slice(Math.max(0, m.index - 40), m.index);
          if (/typeof\s+$/.test(before) || new RegExp(`typeof\\s+${name}\\b`).test(
            src.slice(Math.max(0, m.index - 200), m.index))) continue;
          const line = src.slice(0, m.index).split('\n').length;
          bad.push(`${rel}:${line} 用了 ${name}，但 ${home} 不在 App 包的 MODULES 里`
            + ' —— 包拼得出来、App 起得来，只有走到这条路时才 ReferenceError');
          break;   // 一个文件一个全局报一次就够
        }
      }
    }
    eq(bad.length, 0, '\n  ' + bad.join('\n  '));
  });
});
