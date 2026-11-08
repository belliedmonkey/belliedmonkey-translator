// test/app-settings-720.test.js — BEL-198 · Mac ≥720 桌面布局的源码契约。
//
// 认关四窗：登录 / 一键 / 分项网关 / 功能（OpenBot/Shared/bel198-preview/）。
// `npm test` 没有 jsdom（docs/domain-design.md §10），所以这里钉**结构 + 媒体查询边界**：
//   · 登录 ≥720 左文右 320 卡，三 id 不动；
//   · 设置 220 侧栏五顶，一次只揭一节（hidden，不 remove），nav 无 hidden 属性；
//   · 语言包升 #sec-langpacks，内部 id 不动、不双挂载；
//   · 宽窗 segmented 28、字段行布局只在媒体查询里、开关 40×24；
//   · 缩过断点由 matchMedia 清掉各 .sec 的 hidden。
// 真实视口下的行为由 test:app / 真机截图验收（本文件不假装跑了浏览器）。

const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const VIEW = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SHELL = fs.readFileSync(path.join(ROOT, 'src/app/AppShell.jsx'), 'utf8');
const MODEL = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');
const WIDE_Q = '(min-width: 720px)';

// 取出每一个 @media (min-width: 720px) { … } 的 body（大括号配平，嵌套媒体也能算）。
function mediaBlocks(css, query) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = css.indexOf('@media ' + query, from);
    if (i < 0) break;
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    for (let j = open; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) { out.push(css.slice(open + 1, j)); from = j + 1; break; }
      }
    }
  }
  return out;
}
function stripMedia(css, query) {
  let s = css;
  for (;;) {
    const i = s.indexOf('@media ' + query);
    if (i < 0) return s;
    const open = s.indexOf('{', i);
    let depth = 0;
    let end = s.length;
    for (let j = open; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    s = s.slice(0, i) + s.slice(end);
  }
}
const wide = mediaBlocks(CSS, WIDE_Q).join('\n');
const narrow = stripMedia(CSS, WIDE_Q);
const rule = (text, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(text);
  return m ? m[1] : '';
};

describe('BEL-198 · Mac ≥720 桌面布局（认关四窗）', () => {
  test('登录：≥720 左品牌+lede（~380），右 320 卡；三个 id 不动', () => {
    ok(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+320px/.test(wide),
      '≥720 登录没有「左 1fr / 右 320」两栏');
    const card = rule(wide, '#signed-out > #signin-prompt');
    ok(/width\s*:\s*320px/.test(card), '#signin-prompt 在宽窗不是 320 卡：' + card);
    const lede = rule(wide, '#signed-out > #lede');
    ok(/max-width\s*:\s*380px/.test(lede), '#lede 在宽窗没有约 380 的定宽：' + lede);
    ok(!/\.lede\s*\{[^}]*width\s*:\s*100vw/.test(wide), '宽窗 lede 被拉满整个窗口');
    for (const id of ['app-brand', 'lede', 'signin-prompt']) {
      ok(new RegExp(`id="${id}"`).test(SHELL), `AppShell 里丢了 #${id} —— 登录 id 不许动`);
    }
    ok(!/MacSignedOut\.dc\.html/.test(SHELL), '落了居中 400 卡的 MacSignedOut.dc.html —— 那不是认关稿');
  });

  test('设置：220 侧栏五顶，宽窗一次只揭一节；侧栏脚完成可见，无 engine-keys-entry', () => {
    ok(/grid-template-columns\s*:\s*220px\s+minmax\(0,\s*1fr\)/.test(wide),
      '≥720 设置不是「220 侧栏 + 右栏」');
    const nav = rule(wide, '#settings-nav');
    ok(/display\s*:\s*flex/.test(nav), '≥720 #settings-nav 没有显示：' + nav);
    const title = rule(wide, '#settings-title');
    ok(/display\s*:\s*none/.test(title), '宽窗 #settings-title 必须仍 none：' + title);
    const backWide = rule(wide, '#settings-back');
    ok(backWide && !/display\s*:\s*none/.test(backWide),
      '≥720 #settings-back 必须可见（侧栏脚「完成」）：' + backWide);
    ok(/min-height\s*:\s*44px/.test(backWide),
      '≥720 #settings-back 命中区不是 44：' + backWide);
    ok(!/#settings-back[^{]*\{[^}]*min-height\s*:\s*30px/.test(wide),
      '≥720 #settings-back 被收到 30');
    ok(/#engine-keys-entry[^{]*\{[^}]*display\s*:\s*none/.test(wide),
      '宽窗还露着 #engine-keys-entry');
    ok(/#app-settings \.sec\s*\{[^}]*grid-column\s*:\s*2[^}]*grid-row\s*:\s*1/.test(wide),
      '各 .sec 没有落在右栏同一格（单 pane）');
  });

  test('BEL-212：#settings-rail 包 nav+back；back 不是 nav 子节点；<720 仍 ← 返回', () => {
    const rail = (VIEW.match(/<div[^>]*id="settings-rail"[^>]*>/) || [])[0] || '';
    ok(rail, 'settings-view.jsx 里没有 #settings-rail');
    ok(!/\shidden(\s|=|>)/.test(rail), '#settings-rail 带了 hidden 属性：' + rail);
    ok(/#settings-rail\s*\{\s*display\s*:\s*contents/.test(narrow),
      '窄窗 #settings-rail 不是 display:contents');
    const iRail = VIEW.indexOf('id="settings-rail"');
    const iNav = VIEW.indexOf('id="settings-nav"');
    const iBack = VIEW.indexOf('id="settings-back"');
    const iNavClose = VIEW.indexOf('</nav>', iNav);
    ok(iRail >= 0 && iNav > iRail && iBack > iNavClose,
      '#settings-back 必须在 #settings-nav 之后、rail 脚上，不得进 nav');
    ok(!VIEW.slice(iNav, iNavClose).includes('id="settings-back"'),
      '#settings-back 进了 #settings-nav —— 窄窗 nav display:none 会把返回藏掉');
    ok(/wide \? t\('app_set_done', '完成'\) : t\('app_review_back', '← 返回'\)/.test(VIEW),
      '宽窗文案不是完成 / 窄窗不是 ← 返回');
    ok(VIEW.indexOf('id="settings-title"') > iBack,
      '窄窗 contents 下流里 title 必须在 back 之后，才保持页顶「← 返回」');
    ok(/#settings-back\s*\{\s*align-self:\s*flex-start/.test(narrow),
      '窄窗 #settings-back 不再是页顶链');
  });

  test('BEL-212：Esc 冒泡先守卫 #agent-confirm / .ld-mask，再 closeSettings', () => {
    ok(/getElementById\('agent-confirm'\)/.test(MODEL),
      'shell-model.js Esc 分支没有 #agent-confirm 守卫');
    ok(/\.ld-mask/.test(MODEL), 'shell-model.js Esc 分支没有 .ld-mask 守卫');
    const esc = MODEL.slice(MODEL.indexOf("e.key !== 'Escape'"), MODEL.indexOf("e.key !== 'Escape'") + 700);
    ok(/closeAcctMenu\(\)/.test(esc) && /closeSettings\(\)/.test(esc),
      'Esc 不是 closeAcctMenu → 守卫 → closeSettings：' + esc.slice(0, 240));
    const iConfirm = esc.indexOf('agent-confirm');
    const iClose = esc.indexOf('closeSettings');
    ok(iConfirm >= 0 && iConfirm < iClose, '#agent-confirm 守卫必须在 closeSettings 之前');
  });

  test('侧栏是 CSS 显隐：nav 没有 hidden 属性，窄窗默认 display:none', () => {
    const tag = (VIEW.match(/<nav[^>]*id="settings-nav"[^>]*>/) || [])[0] || '';
    ok(tag, 'settings-view.jsx 里没有 #settings-nav');
    ok(!/\shidden(\s|=|>)/.test(tag), '#settings-nav 带了 hidden 属性 —— 显隐只能走 CSS：' + tag);
    ok(/#settings-nav\s*\{\s*display\s*:\s*none/.test(CSS),
      '窄窗默认没有把 #settings-nav 藏掉');
  });

  test('五顶顺序与 id：引擎与密钥 / 功能 / 语言包与朗读 / 账号与数据 / 关于', () => {
    const ids = [...VIEW.matchAll(/^\s*\{ sec: '([^']+)'/gm)].map((m) => m[1]);
    const want = ['sec-engines', 'sec-features', 'sec-langpacks', 'sec-account', 'sec-about'];
    ok(JSON.stringify(ids) === JSON.stringify(want), '侧栏五顶不对：' + JSON.stringify(ids));
    for (const id of want) {
      ok(new RegExp(`<div className="sec" id="${id}"`).test(VIEW), `缺少 .sec#${id}`);
    }
  });

  test('语言包升 #sec-langpacks；g-langpacks / langpacks-state / set-pack-manage 不动且不双挂载', () => {
    ok(/id="sec-langpacks"/.test(VIEW), '没有 #sec-langpacks');
    const g = [...VIEW.matchAll(/id="g-langpacks"/g)].length;
    ok(g === 1, `#g-langpacks 应恰好一份（不做双挂载），实际 ${g}`);
    const iSec = VIEW.indexOf('id="sec-langpacks"');
    const iG = VIEW.indexOf('id="g-langpacks"');
    const iAcct = VIEW.indexOf('id="sec-account"');
    ok(iSec >= 0 && iG > iSec && iG < iAcct, '#g-langpacks 不在 #sec-langpacks 里');
    const iFeat = VIEW.indexOf('id="sec-features"');
    ok(iFeat < iSec, '#sec-langpacks 没排在功能节之后');
    ok(!VIEW.slice(iFeat, iSec).includes('id="g-langpacks"'), '#g-langpacks 还嵌在功能节里');
    for (const id of ['langpacks-state', 'set-pack-manage']) {
      ok(new RegExp(`id="${id}"`).test(VIEW), `语言包内部 id #${id} 丢了`);
    }
  });

  test('缩过 720：matchMedia 清掉各 .sec 的 hidden；宽窗用 hidden 切节、不 remove', () => {
    ok(/matchMedia\('\(min-width: 720px\)'\)/.test(VIEW), '没有 matchMedia(\'(min-width: 720px)\')');
    ok(/querySelectorAll\('#app-settings \.sec'\)/.test(VIEW), '没有遍历各 .sec');
    ok(/\.hidden\s*=\s*false/.test(VIEW), '缩过断点时没有清掉 .sec 的 hidden');
    for (const id of ['sec-engines', 'sec-features', 'sec-langpacks', 'sec-account', 'sec-about']) {
      ok(new RegExp(`id="${id}" hidden=\\{wide && activeSec !== '${id}'\\}`).test(VIEW),
        `#${id} 的 hidden 不是由 wide + activeSec 派生（宽窗才能一次只揭一节）`);
    }
    ok(!/\$\(['"]sec-[^'"]*['"]\)\.remove\(\)/.test(VIEW), '出现了 remove() —— 设置节只许切 hidden');
  });

  test('一键|分项：宽窗 segmented 28 高，✓ 与覆盖 hint 只在窄窗渲染', () => {
    ok(/#app-settings \.mode-tabs\s*\{[^}]*height\s*:\s*28px/.test(wide), '宽窗 segmented 不是 28 高');
    ok(/\{!wide && !detail \? '✓ '\s*:\s*''\}/.test(VIEW), '宽窗 tab 上还渲染 ✓');
    ok(/\{!wide && detail \? <small className="mode-tab-hint">/.test(VIEW), '宽窗还渲染「选用将覆盖…」hint');
    ok(/opt_mode_switch_to_quick/.test(VIEW) && /opt_mode_switch_to_detail/.test(VIEW),
      '一键↔分项的确认 dialog 不再走 opt_mode_switch_to_*');
  });

  test('宽窗字段：标签左控件右，select/input ≤240；纵向规则保留给窄窗', () => {
    const f = rule(wide, '#app-settings .field');
    ok(/flex-direction\s*:\s*row/.test(f), '宽窗 .field 不是行布局：' + f);
    ok(/max-width\s*:\s*240px/.test(wide), '宽窗 select/input 没有 240 上限');
    ok(!/\.field\s*\{[^}]*flex-direction\s*:\s*row/.test(narrow),
      '.field 的行布局跑到了无媒体查询的规则里 —— 320px 契约会破');
  });

  test('宽窗开关：现 checkbox 画成 40×24；窄窗仍 22×22 / 44 命中', () => {
    ok(/width\s*:\s*40px;\s*height\s*:\s*24px/.test(wide), '宽窗开关不是 40×24');
    ok(/#app-settings \.check \{[^}]*min-height\s*:\s*44px/.test(wide),
      '宽窗开关行没有 44 命中区');
    ok(/\.check input\s*\{\s*width\s*:\s*22px;\s*height\s*:\s*22px/.test(narrow),
      '窄窗 checkbox 不再是 22×22');
    ok(/\.check \{[^}]*min-height\s*:\s*44px/.test(narrow), '窄窗开关行没有 44 命中区');
  });

  test('分项：#notes-base-url 在分项主行、不在高级参数 details 里', () => {
    const iBase = VIEW.indexOf('id="notes-base-field"');
    const iDetails = VIEW.indexOf('id="notes-adv-params"');
    ok(iBase >= 0 && iDetails > iBase, '#notes-base-field 还折在 #notes-adv-params 里');
    ok(VIEW.slice(iBase, iDetails).includes('id="notes-base-url"'), '#notes-base-url 不在主行字段里');
  });
});

describe('BEL-217 · 宽窗设置内容顶栏「← 返回」', () => {
  test('DOM：全局 #settings-page-back 在 #app-settings 下、#settings-rail 前，始终渲染、恒 ← 返回', () => {
    const iSettings = VIEW.indexOf('id="app-settings"');
    const iPage = VIEW.indexOf('id="settings-page-back"');
    const iRail = VIEW.indexOf('id="settings-rail"');
    ok(iSettings >= 0 && iPage > iSettings, '#settings-page-back 不在 #app-settings 下');
    ok(iPage < iRail, '#settings-page-back 不在 #settings-rail 之前');

    const open = VIEW.lastIndexOf('<', iPage);
    const tag = VIEW.slice(open, VIEW.indexOf('>', iPage) + 1);
    ok(!/\shidden(\s|=|>)/.test(tag), '#settings-page-back 带了 hidden —— 必须始终渲染：' + tag);
    ok(!/onClick=/.test(tag), '#settings-page-back 挂了 React onClick —— 会和 shell-model 的绑定重复');
    const body = VIEW.slice(VIEW.indexOf('>', iPage) + 1, VIEW.indexOf('</button>', iPage));
    ok(/t\('app_review_back',\s*'← 返回'\)/.test(body), '文案不是 t(app_review_back, ← 返回)：' + body);
    ok(!/\bwide\s*\?/.test(body), '文案跟着 wide 变了 —— 宽窗必须仍是 ← 返回：' + body);

    // 不进 .sec-head（五个同 id），也不进 #settings-nav。
    const head = VIEW.indexOf('className="sec-head"');
    const nav = VIEW.indexOf('id="settings-nav"');
    const navEnd = VIEW.indexOf('</nav>', nav);
    ok(!(iPage > head && iPage < VIEW.indexOf('</div>', head)), '#settings-page-back 进了 .sec-head');
    ok(!(iPage > nav && iPage < navEnd), '#settings-page-back 进了 #settings-nav');
  });

  test('CSS：<720 display:none；≥720 grid-column:2 / grid-row:1；.sec-head 左让位', () => {
    const base = rule(narrow, '#settings-page-back');
    ok(/display\s*:\s*none/.test(base), '<720 #settings-page-back 不是 display:none：' + base);
    const wideBack = rule(wide, '#settings-page-back');
    ok(/display\s*:\s*inline-flex/.test(wideBack), '≥720 #settings-page-back 没有显示：' + wideBack);
    ok(/grid-column\s*:\s*2/.test(wideBack), '≥720 不在内容栏（grid-column:2）：' + wideBack);
    ok(/grid-row\s*:\s*1/.test(wideBack), '≥720 不在内容区第一行（grid-row:1）：' + wideBack);
    const head = rule(wide, '#app-settings .sec-head');
    ok(/padding-left\s*:\s*88px/.test(head), '≥720 .sec-head 没有给返回键左让位：' + head);
  });

  test('绑定：宽窗双出口都走 closeSettings；新按钮只绑一次；#settings-back 仍是「完成」', () => {
    const back = "$('settings-back').addEventListener('click', closeSettings)";
    const page = "$('settings-page-back').addEventListener('click', closeSettings)";
    const iBack = MODEL.indexOf(back);
    const iPage = MODEL.indexOf(page);
    ok(iBack >= 0, 'shell-model.js 丢了 #settings-back → closeSettings');
    ok(iPage > iBack, '#settings-page-back 的绑定不在 #settings-back 之后');
    ok((MODEL.match(/settings-page-back/g) || []).length === 1,
      '#settings-page-back 在 shell-model.js 里绑了不止一次');
    ok(/wide \? t\('app_set_done', '完成'\) : t\('app_review_back', '← 返回'\)/.test(VIEW),
      '#settings-back 的宽窗「完成」/窄窗「← 返回」文案被改');
    ok(/getElementById\('agent-confirm'\)/.test(MODEL) && /\.ld-mask/.test(MODEL),
      'Esc 守卫（#agent-confirm / .ld-mask）被动了');
  });
});
