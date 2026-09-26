// test/src-boundaries.test.js — src/ 的边界门禁（React 迁移 PR2 立）。
//
// 四条边界，违者 npm test 红：
// ① window.MT_* 只许 src/lib/registry.js 摸 —— 生成注册表（providers.gen.js、
//    i18n-messages.js…）是 bundle 外的独立 script 段，src/ 一律经 Registry 读。
//    哪里直接摸了 window.MT_，哪里就是第二个会随 flavor 漂移的消费点。
// ② src/ 不 import 任何 gen / i18n-messages / backend.config —— 它们不进 bundle
//    （domain-design §10.7），import 得动就会在 build 时才炸或静默 fork。
// ③ import react 只许两层：store/hooks.js 与 lib/i18n.js（store 其余文件保持纯 JS、
//    双宿主可单测 —— vm 里没有 renderer），以及 pages/、app/、content/ 的组件层
//    （React 页面，import react 是它们的本职）。src/ 根下与 shared/ 以后出现新目录
//    时要显式加进来，不许悄悄扩散。
// ④ 不许 dangerouslySetInnerHTML —— YouTube 的 Trusted Types 禁 innerHTML，
//    React 注入 UI 永远走 JSX 子元素，这条从第一天就钉死。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, deepEq } = require('./harness');

const SRC = path.join(__dirname, '..', 'src');

function listSrcFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSrcFiles(p));
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = listSrcFiles(SRC);
ok(FILES.length >= 7, `src/ 只找到 ${FILES.length} 个文件 —— 目录挪走了？`);

function rel(p) { return path.relative(SRC, p).replace(/\\/g, '/'); }

// 去掉行注释，避免「注释里提到注册表名」被误伤（i18n.js 的头注释就合法地提到
// MT_I18N_MESSAGES 在哪）。字符串里的 // 不处理 —— src/ 没有 URL 字面量，够用。
function stripLineComments(src) {
  return src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

describe('src/ 边界门禁', () => {
  test('window.MT_* / globalThis.MT_* 只出现在 lib/registry.js', () => {
    const offenders = [];
    for (const f of FILES) {
      if (rel(f) === 'lib/registry.js') continue;
      if (/\b(window|globalThis|self)\s*\.\s*MT_/.test(stripLineComments(fs.readFileSync(f, 'utf8')))) {
        offenders.push(rel(f));
      }
    }
    deepEq(offenders, [], '直接摸 window.MT_* 的文件 —— 改走 Registry（lib/registry.js）');
  });

  test('裸 MT_ 标识符同样只许 registry.js（防绕过 getter 直读全局）', () => {
    const offenders = [];
    for (const f of FILES) {
      if (rel(f) === 'lib/registry.js') continue;
      if (/\bMT_[A-Za-z]/.test(stripLineComments(fs.readFileSync(f, 'utf8')))) {
        offenders.push(rel(f));
      }
    }
    deepEq(offenders, [], '出现 MT_ 标识符 —— 经 lib/registry.js 的 getter 读');
  });

  test('不 import 任何 gen / i18n-messages / backend.config（它们不进 bundle）', () => {
    const banned = /(providers\.gen|langs\.gen|palette\.gen|model-params\.config|i18n-messages|backend\.config)/;
    const offenders = [];
    for (const f of FILES) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
        if (banned.test(m[1])) offenders.push(`${rel(f)} → ${m[1]}`);
      }
    }
    deepEq(offenders, [], '生成注册表是 bundle 外的 script 段 —— 经 Registry 在运行时读');
  });

  test('import react 只许 hooks/i18n 与组件层（pages/app/content）', () => {
    const allowed = new Set(['store/hooks.js', 'lib/i18n.js']);
    const componentLayer = /^(pages|app|content)\//;
    const offenders = [];
    for (const f of FILES) {
      const r = rel(f);
      if (allowed.has(r) || componentLayer.test(r)) continue;
      if (/\bfrom\s+['"]react(-dom)?(\/[^'"]*)?['"]/.test(stripLineComments(fs.readFileSync(f, 'utf8')))) {
        offenders.push(r);
      }
    }
    deepEq(offenders, [], 'store/lib 其余文件必须保持无 React —— vm 单测与双宿主复用的前提');
  });

  test('零 dangerouslySetInnerHTML（Trusted Types / MV3 CSP）', () => {
    const offenders = FILES.filter((f) => /dangerouslySetInnerHTML/.test(fs.readFileSync(f, 'utf8')));
    deepEq(offenders, [], '图标与富文本一律 JSX 子元素，不走 HTML 字符串');
  });
});
