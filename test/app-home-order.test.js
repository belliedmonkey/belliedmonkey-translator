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
const { describe, test, ok, eq } = require('./harness');

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

  test('J03/J17 · 实心 CTA 恰好是两位主角；带内有中英两行（不是空装饰层）', () => {
    const css = read('app/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    // J17（2026-10-02 真机修订）：`::after` 装饰带就是「空橙块」的根因 —— 必须彻底消失。
    ok(!/#app-(?:listen|subs)-entry::after/.test(css),
      '主角卡还留着 ::after 装饰带 —— 那正是空橙块的根因（J17）');
    ok(/#app-listen-entry \.cta[\s\S]{0,220}background: var\(--accent/.test(css),
      '实时听译卡没有实心启动带 —— 主角没有可点的实心 CTA');
    ok(/#app-subs-entry \.cta[\s\S]{0,220}background: var\(--accent/.test(css),
      '实时字幕卡没有实心启动带');
    ok(/\.today \.row #review[\s\S]{0,160}color-mix/.test(css),
      '复习键仍是实心 —— 判据 J03 要求折叠线以内实心 CTA 只有两位主角');
    // J17：每条带内 `.cn` / `.en` 两个子节点都必须存在，且颜色各自显式声明（不靠继承）。
    const lv = read('src/app/listen-view.jsx');
    for (const k of ['home_cta_listen', 'home_cta_subs']) {
      ok(new RegExp("t\\('" + k + "'").test(lv), k + ' 没走 i18n（J17 的中英两行要能翻译）');
    }
    eq([...lv.matchAll(/className="cta"/g)].length, 2, '两张主角卡应各有一条 .cta 带');
    eq([...lv.matchAll(/className="cn"/g)].length, 2, '每条 .cta 带应有 .cn 子节点');
    eq([...lv.matchAll(/className="en"/g)].length, 2, '每条 .cta 带应有 .en 子节点');
    for (const cls of ['cn', 'en']) {
      ok(new RegExp('#app-listen-entry \\.cta \\.' + cls + '[\\s\\S]{0,160}color:').test(css),
        `.cta .${cls} 的颜色没有显式声明 —— 空橙块正是继承/透明造成的（J17）`);
    }
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

  test('J04 · 顶栏账号收进 44×44 圆键，设置/退出在它的菜单里', () => {
    const css = read('app/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(/id="acct"/.test(shell) && /id="acct-menu"/.test(shell),
      '顶栏没有账号圆键 / 它的菜单 —— 账号仍占着一整行（J04）');
    ok(/id="acct-menu"[\s\S]{0,400}id="who"[\s\S]{0,300}id="gear"[\s\S]{0,200}id="signout"/.test(shell),
      '账号菜单里没有 邮箱 + 设置 + 退出');
    ok(/header \{[\s\S]{0,220}min-height: 52px/.test(css), '顶栏高度不是 52（设计稿 H2）');
    ok(/#acct \{[\s\S]{0,200}width: 44px;[\s\S]{0,80}height: 44px/.test(css),
      '账号键不是 44×44 —— J04 要求命中区 ≥ 44×44');
    ok(/#acct-menu\[hidden\] \{ display: none/.test(css),
      '账号菜单隐藏时没被 display:none 挡住 —— display:flex 会盖过 [hidden] 的 UA 样式');
  });

  test('J18/J19 · 扩展引导是折叠线以下的一行（可展开），不再占首屏', () => {
    const si = shell.indexOf('id="signed-in"');
    const signedIn = shell.slice(si, si + 20000);   // #firstrun-packs 在 #signed-in 之前，不能拿它当边界
    ok(signedIn.includes('id="ext-banner"'),
      '扩展引导不在 #signed-in 里 —— 它必须落在首屏各块之后（折叠线以下）');
    ok(signedIn.indexOf('className="modes"') < signedIn.indexOf('id="ext-banner"'),
      '扩展引导排在主角/复习/文档之前 —— J18/J19 要它在 #signed-in 的最后（y ≥ 800）');
    ok(/id="ext-banner-row"[\s\S]{0,400}aria-expanded/.test(signedIn),
      '扩展引导行不是一个可展开的行（缺 aria-expanded）');
    ok(/id="ext-banner-panel"\s+hidden/.test(signedIn),
      '扩展引导的二级面板没有默认藏起来 —— 步骤又会回到首屏');
    ok(/id="ext-banner-panel"[\s\S]{0,600}id="ext-banner-steps"/.test(signedIn),
      '二级面板里没有三步说明 —— 引导就没地方放了');
  });
});
