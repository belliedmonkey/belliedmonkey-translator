// test/app-home-order.test.js — 登录后首页的出场顺序与主角地位（2026-10-01 裁定 + OpenDesign 设计稿）。
//
// 设计稿：`design/home-reorder-2026-10-01/od/`（画布 / iPhone·Mac 原型 / 一页规格）。
// 规格里那 14 条判据（J01–J14）里，能在**静态源码**上判的先落在这里；需要真实渲染的
// （等高、命中区、对比度、状态行切换不跳动）留在 `test/layout/`（真 headless Chrome）。
//
// 这一屏的裁定原文：① 系统翻译的设置引导只放设置页（不进首页、不进引导）；
// ② 登录完三引擎就位、实时字幕与听译直接可用；③ 它们是主角；④ 单词卡降为次要。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('App 首页出场顺序（2026-10-01 设计稿 · J01/J03/J05/J07）', () => {
  const shell = read('src/app/AppShell.jsx');
  const home = (() => {
    const i = shell.indexOf('id="signed-in"');
    const j = shell.indexOf('id="firstrun-packs"');
    return shell.slice(i, j > i ? j : i + 12000);
  })();
  const at = (needle) => home.indexOf(needle);

  test('J01 · 顺序固定：引擎状态行 → 实时字幕/听译 → 复习条 → 文档', () => {
    const status = at('id="engine-status"');
    const heroes = at('className="heroes"');
    const listen = at('<ListenEntryButtons />');
    const today = at('className="today"');
    const docs = at('className="docs"');
    ok(status > -1 && heroes > -1 && listen > -1 && today > -1 && docs > -1,
      '首页少了一块：状态行 / 主角区 / 听译字幕入口 / 复习条 / 文档分区');
    ok(status < heroes && heroes < today && today < docs,
      '出场顺序错了 —— 裁定是「引擎状态行 → 两位主角 → 复习条 → 文档」');
    ok(listen > heroes && listen < today, '两位主角（ListenEntryButtons）不在主角区里');
  });

  test('J05 · 首页不得出现系统翻译横幅（引导只在设置页）', () => {
    ok(at('systrans-banner') === -1, '首页又出现了系统翻译横幅 —— 裁定说它只放设置页');
    const banner = read('app/sys-banner.js').replace(/\/\/.*$/gm, '');
    const body = banner.slice(banner.indexOf('async function decide(opts)'));
    ok(/return 'none'/.test(body.slice(0, 600)), 'decide() 不再无条件返回 none');
    ok(/id="g-systrans"/.test(read('src/app/settings-view.jsx')), '设置页那块不见了 —— 引导就没地方放');
  });

  test('J07 · 缺失项挂在状态行上、且自身可点（不许纯文本告警）', () => {
    ok(/<button[^>]*id="engine-status-fix"/.test(home),
      '状态行的缺失项不是 button —— 裁定要求它自身可点（例：朗读未配置 → 去设置）');
    const model = read('src/app/shell-model.js').replace(/\/\/.*$/gm, '');
    ok(/chip\.setAttribute\('aria-label'/.test(model), '缺失 chip 没有 aria-label 指明目标页');
  });

  test('J03 · 实心 CTA 恰好是两位主角；复习键走淡色档', () => {
    const css = read('app/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(/#app-listen-entry::after[\s\S]{0,200}background: var\(--accent/.test(css),
      '实时听译卡没有实心启动带 —— 主角没有可点的实心 CTA');
    ok(/#app-subs-entry::after[\s\S]{0,200}background: var\(--accent/.test(css),
      '实时字幕卡没有实心启动带');
    ok(/\.today \.row #review[\s\S]{0,160}color-mix/.test(css),
      '复习键仍是实心 —— 判据 J03 要求折叠线以内实心 CTA 只有两位主角');
  });

  test('J01 · 主角卡的 sfx 必须默认成登录后那一份（否则两张卡永远 hidden）', () => {
    // 2026-10-02 真机实测：AppShell 不传 sfx ⇒ entryView(undefined) ⇒ entryState[undefined] 是空的
    // ⇒ hidden={listen ? … : true} 恒为 true ⇒ 首页上两位主角根本不出现（设计稿 J01 要求它们在）。
    const lv = read('src/app/listen-view.jsx');
    for (const c of ['ListenEntryButtons', 'ListenEntryPrivacy', 'ListenEntryNeeds']) {
      ok(new RegExp("function " + c + "\\(\\{ sfx = '' \\}\\)").test(lv),
        c + " 的 sfx 没默认成 '' —— AppShell 不传它，会取到 undefined，卡永远 hidden");
    }
    ok(/<ListenEntryButtons \/>/.test(shell), '前提：AppShell 确实不传 sfx（所以默认值就是登录后那一份）');
    ok(/const btn = \['app-subs-entry', 'app-subs-entry2'\]/.test(read('src/app/shell-model.js')),
      '无后缀 id 是登录后那一份 —— 命令式写入的锚点，必须与默认 sfx 对齐');
  });
});
