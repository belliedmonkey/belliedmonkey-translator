// test/app-bel231-settings.test.js — BEL-231 · iOS 设置页 r2 的结构契约。
//
// r2（design/pencil/BEL-231-settings.review.md，APPROVED）把一级入口收成
// 1 张额度卡 + 5 组；点行进入子页（← 返回 + 大标题）。只有「朗读与复习」按稿
// 重排（语音模式 / 音色 / 语速 / 每天新卡 / 自动朗读 / hint），其余子页只换壳。
//
// 这里钉的是**源码结构**（没有 jsdom）：哪些 id 还在、每行打开哪一页、返回键回主屏、
// 宽窗侧栏切组、额度卡三条链接、以及 r2 的排版数字。真实视口由 test:app / 真机验收。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const MODEL = fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8');

const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(CSS);
  return m ? m[1] : '';
};

describe('BEL-231 · 主屏：额度卡 + 五组', () => {
  test('主屏结构：额度卡（segmented / 进度条 / 大数字 / 三条链接） + 五组', () => {
    ok(/id="settings-home"/.test(VIEW), '没有主屏 #settings-home');
    ok(/id="settings-quota"/.test(VIEW), '主屏没有额度卡');
    ok(/id="grant-card"/.test(VIEW), '额度卡 id grant-card 丢了');
    ok(/id="quota-mode-quick"/.test(VIEW) && /id="quota-mode-detail"/.test(VIEW),
      '额度卡上没有一键 / 分项 segmented');
    ok(/id="mode-quick"/.test(VIEW) && /id="mode-detail"/.test(VIEW),
      '引擎子页没有一键 / 分项 segmented（宽窗 rail 进不去主屏）');
    ok(/settings-quota-bar/.test(VIEW) && /settings-quota-fill/.test(VIEW),
      '额度卡没有进度条');
    ok(/settings-quota-left/.test(VIEW) && /settings-quota-total/.test(VIEW),
      '额度卡没有 $剩余 / $总额');
    for (const k of ['reclaim', 'byo', 'community']) {
      ok(new RegExp(`data-quota-link="${k}"`).test(VIEW), `额度卡缺链接：${k}`);
    }
    for (const g of ['language', 'speech', 'features', 'account', 'about']) {
      ok(new RegExp(`renderGroup\\('${g}'\\)`).test(VIEW), `主屏缺组：${g}`);
    }
  });

  test('r2 排版数字：行高 44、卡外边距 16、内边距 16、分隔线左缩进 16、字号 17 / 13 / 30', () => {
    const row = rule('.settings-row');
    ok(/min-height\s*:\s*44px/.test(row), '行高不是 44：' + row);
    ok(/font-size\s*:\s*17px/.test(row), '行字号不是 17：' + row);
    ok(/text-align\s*:\s*left/.test(row), '行不是左对齐：' + row);
    const groupCard = rule('.settings-group-card');
    ok(/margin\s*:\s*0\s+16px/.test(groupCard), '组卡外边距不是 16：' + groupCard);
    ok(/border-radius\s*:\s*16px/.test(groupCard), '组卡圆角不是 16：' + groupCard);
    const title = rule('.settings-group-title');
    ok(/font-size\s*:\s*13px/.test(title), '分组标题不是 13：' + title);
    ok(/margin\s*:\s*0\s+16px\s+8px\s+32px/.test(title), '分组标题没有对齐到 x=32：' + title);
    ok(/\.settings-row \+ \.settings-row::before\s*\{[^}]*left\s*:\s*16px/.test(CSS),
      '分隔线没有左缩进 16（屏幕 x=32）');
    const quota = rule('.settings-quota-card');
    ok(/padding\s*:\s*16px/.test(quota), '额度卡内边距不是 16：' + quota);
    ok(/border-radius\s*:\s*16px/.test(quota), '额度卡圆角不是 16：' + quota);
    const amount = rule('.settings-quota-left');
    ok(/font-size\s*:\s*30px/.test(amount), '额度大数字不是 30：' + amount);
    const pageTitle = rule('#settings-subpage-title');
    ok(/font-size\s*:\s*30px/.test(pageTitle), '子页大标题不是 30：' + pageTitle);
    // 颜色只用共享 token（不出现 r2 表里的裸 hex）。
    for (const hex of ['#F5EAD8', '#FFFFFF', '#201E1D', '#6A6255', '#DCD3C4', '#AC6231', '#8C491A', '#FFE1D0', '#728157']) {
      ok(!new RegExp(hex, 'i').test(VIEW),
        'JSX 里出现裸 hex ' + hex + ' —— 必须走共享 CSS 变量');
    }
  });

  test('★ 窄屏横向边距：body 的 20 被抵掉，卡片 16 / 分隔线 32 / 分组标题 32', () => {
    const media = /@media \(max-width: 719\.98px\) \{([\s\S]*?)\n\}/.exec(CSS);
    ok(media, '没有窄屏（<720）的设置页边距覆盖');
    const narrow = media[1];

    // 从规则里读出数字，再算「屏幕左缘」；改任何一个值都会让下面的等式红。
    const bodyPad = Number((/body\s*\{[^}]*?padding:\s*max\((\d+)px/.exec(CSS) || [])[1]);
    eq(bodyPad, 20, 'body 左右内边距的基线变了，抵消值要一起改');
    const neg = Number((/#app-settings\s*\{[^}]*?margin:\s*0\s+(-?\d+)px/.exec(narrow) || [])[1]);
    eq(neg, -bodyPad, '窄屏没有把 body 的左右内边距抵掉');
    // 子页卡片没有横向 margin，唯一的 16 来自基础规则 .settings-pane 的左右内边距。
    // 窄窗覆盖不能把 pane 再置 0 —— 那正是 215 验收的整页全宽回归。
    const paneOverride = /#app-settings \.settings-pane\s*\{([^}]*)\}/.exec(narrow);
    ok(!paneOverride || !/padding:\s*0(?:\s*;|\s*\})/.test(paneOverride[1]),
      '窄屏 .settings-pane 被置 0，子页卡片会塌成整屏宽（215 回归）');
    const panePad = Number((/padding:\s*0\s+(\d+)px/.exec(rule('#app-settings .settings-pane')) || [])[1]);
    eq(panePad, 16, '子页 pane 的左右内边距必须还是 16');
    eq(Number((/margin:\s*0\s+(\d+)px/.exec(rule('#app-settings .sgroup')) || [])[1] || 0), 0,
      '子页 .sgroup 不应再有横向 margin（否则和 pane 的 16 叠成两份）');

    const cardMargin = Number((/margin:\s*0\s+(\d+)px/.exec(rule('.settings-group-card')) || [])[1]);
    eq(cardMargin, 16, '组卡外边距必须还是 16');
    eq(bodyPad + neg + cardMargin, 16, '窄屏主屏卡片左缘应为 16');
    eq(bodyPad + neg + panePad, 16, '窄屏子页卡片左缘应为 16（pane 16，卡片无横向 margin）');

    const rowPad = Number((/padding:\s*0\s+(\d+)px/.exec(rule('.settings-row')) || [])[1]);
    eq(bodyPad + neg + cardMargin + rowPad, 32, '分隔线左缘应为 32');

    // 基础 .settings-group-title 被 #app-settings h3 压掉，窄屏必须有一条 (1,1,0) 的覆盖。
    const titleRule = /#app-settings \.settings-group-title\s*\{([^}]*)\}/.exec(narrow);
    ok(titleRule, '窄屏没有接回分组标题的左缩进（#app-settings h3 会压过类选择器）');
    const titleLeft = Number((/margin:\s*0\s+16px\s+8px\s+(\d+)px/.exec(titleRule[1]) || [])[1]);
    eq(bodyPad + neg + titleLeft, 32, '分组标题左缘应为 32');
    ok(/font-size\s*:\s*13px/.test(titleRule[1]), '分组标题在窄屏仍是 13 号（不是被 h3 拉成 15.2）');
  });
});

describe('BEL-231 · 子页导航与返回', () => {
  test('主屏点行 → 子页；子页返回 → 主屏', () => {
    ok(/function goPage\(id\) \{[\s\S]{0,160}setPage\(id\)/.test(VIEW), '没有 goPage(id)');
    ok(/onClick=\{\(\) => goPage\('home'\)\}/.test(VIEW), '子页返回不是回主屏');
    ok(/id="settings-subpage-head"/.test(VIEW), '没有子页顶栏');
    ok(/id="settings-subpage-title">\{subpageTitle\(page, t\)\}/.test(VIEW),
      '子页大标题没有跟 page 走');
    // 组行统一走 goPage(target)（engine 行是同一件事的具名入口）。
    ok(/onClick=\{onClick \|\| \(\(\) => goPage\(target\)\)\}/.test(VIEW),
      '组行不是 goPage(target)');
    for (const target of ['sec-ui-lang', 'sec-target-lang', 'sec-learn-lang', 'sec-langpacks',
      'sec-listen', 'sec-subtitles', 'sec-quick', 'sec-docs', 'sec-drive', 'sec-sources',
      'sec-account-profile', 'sec-corpus', 'sec-telemetry', 'sec-diag', 'sec-feedback', 'sec-version']) {
      ok(new RegExp(`'${target}'`).test(VIEW), '组里没有指向 ' + target + ' 的行');
    }
  });

  test('窄窗「← 返回」回主屏；宽窗 #settings-back 是「完成」、侧栏切组', () => {
    ok(/id="settings-subpage-back"[\s\S]{0,80}\{t\('app_review_back', '← 返回'\)\}/.test(VIEW),
      '窄窗子页返回不是 ← 返回');
    ok(/hidden=\{!wide && page !== 'home'\}>\{wide \? t\('app_set_done', '完成'\) : t\('app_review_back', '← 返回'\)\}/.test(VIEW),
      '窄窗 ← 返回 / 宽窗 完成 的出口不对');
    ok(/function showPane\(secId\) \{[\s\S]{0,160}setPage\(secId\)/.test(VIEW),
      '宽窗侧栏没有切组（showPane 只 setPage）');
    ok(/onClick=\{\(\) => showPane\(p\.sec\)\}/.test(VIEW), '侧栏项没有接 showPane');
    ok(/aria-current=\{wide && railForPage\(page\) === p\.sec \? 'page' : undefined\}/.test(VIEW),
      '侧栏高亮不是由 page 派生');
  });

  test('深链：锚点落在子页/主屏都会先揭那一页，再滚', () => {
    ok(/const home = el\.closest\('#settings-home'\)/.test(VIEW), '锚点没有处理主屏落点');
    ok(/const sec = el\.closest\('#app-settings \.sec'\)/.test(VIEW), '锚点没有处理子页落点');
    ok(/if \(home\) \{[\s\S]{0,120}setPage\('home'\)/.test(VIEW), '主屏落点没有 setPage(home)');
    ok(/setPage\(sec\.id\)/.test(VIEW), '子页落点没有 setPage(sec.id)');
    ok(/\$\('settings-back'\)\.addEventListener\('click', closeSettings\)/.test(MODEL),
      'shell-model 丢了 #settings-back 关闭绑定');
  });
});

describe('BEL-231 · 朗读与复习（唯一按 r2 完整实现的子页）', () => {
  test('语音模式 select / 音色 / 语速 slider / 每天新卡 stepper / 自动朗读 / hint', () => {
    const page = VIEW.slice(VIEW.indexOf('id="sec-langpacks"'), VIEW.indexOf('id="sec-features"'));
    ok(/id="tts-mode"[\s\S]{0,400}id="tts-mode-off"[\s\S]{0,400}id="tts-mode-audio-first"/.test(page),
      '朗读子页没有语音模式 select（三档）');
    ok(/id="tts-voice"/.test(page), '朗读子页没有音色 select');
    ok(/id="tts-rate" type="range" min="0\.5" max="1\.5" step="0\.1"/.test(page),
      '语速不是 0.5–1.5 的 slider');
    ok(/id="tts-rate-out"/.test(page), '语速没有 1.0× 读数');
    ok(/id="daily" type="number" min="1" max="200"/.test(page), '每天新卡不是 1–200 的 number');
    ok(/id="daily-minus"/.test(page) && /id="daily-plus"/.test(page), '每天新卡没有 stepper 按钮');
    ok(/id="daily-hint"/.test(page), '每天新卡没有 hint');
    ok(/id="tts-auto" type="checkbox"/.test(page), '自动朗读开关不在朗读子页');
    ok(/id="speech-hint"/.test(page), '缺少「语速只影响朗读」的 hint');
    ok(/settings_row_tts_rate/.test(page) && /settings_row_tts_voice/.test(page)
      && /settings_row_daily/.test(page), 'r2 的行文案 key 没用上');
    ok(/settings-stepper button/.test(CSS), 'stepper 没有样式');
    ok(/\.settings-switch\s*\{[^}]*width\s*:\s*51px;\s*height\s*:\s*31px/.test(CSS),
      'r2 开关不是 51×31');
  });

  test('旧控件仍只有一份：tts-mode / tts-rate / tts-auto / daily / tts-voice', () => {
    for (const id of ['tts-mode', 'tts-rate', 'tts-auto', 'daily', 'tts-voice']) {
      const n = [...VIEW.matchAll(new RegExp(`id="${id}"`, 'g'))].length;
      ok(n === 1, `#${id} 应恰好一份，实际 ${n}`);
    }
    const bump = VIEW.slice(VIEW.indexOf('const bumpDaily'));
    ok(/dispatchEvent\(new Event\('change'\)\)/.test(bump),
      'stepper 没有派发同一个 change（会写第二套状态）');
  });
});

describe('BEL-231 · 旧控件都在（只搬壳，不丢功能）', () => {
  test('引擎 / 语言 / 功能 / 账号 / 关于的内部 id 一个不少', () => {
    const ids = [
      'grant-card', 'quick-setup-card', 'mode-quick', 'mode-detail',
      'ui-lang', 'target-lang', 'app-langs', 'app-sources',
      'notes-provider', 'notes-api-key', 'notes-base-url', 'notes-model',
      'stt-engine', 'stt-api-key', 'stt-base-url', 'stt-model',
      'tts-engine', 'tts-api-key', 'tts-base-url', 'tts-model', 'tts-voice',
      'listen-capture', 'subtitle-capture', 'listen-autospeak', 'thai-grok-block',
      'quick-enabled', 'doc-capture', 'doc-prefetch', 'drive-play-notes',
      'pair-device-btn', 'settings-signout', 'delete-account', 'settings-counts',
      'telemetry-on', 'diag-copy', 'diag-clear', 'feedback-mail', 'feedback-rate',
      'langpacks-state', 'set-pack-manage', 'langpacks-tts-state',
    ];
    const missing = ids.filter((id) => !new RegExp(`id="${id}"`).test(VIEW));
    ok(!missing.length, '这些 id 丢了：' + missing.join(', '));
  });

  test('所有 id 唯一（不双挂载）', () => {
    const seen = new Map();
    for (const m of VIEW.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) {
      seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    }
    const dup = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    ok(!dup.length, '重复 id：' + dup.join(', '));
  });

  test('BEL-230 / BEL-230 ACCEPT-1 的出口还在：一键卡按 grantActive 收起', () => {
    ok(/!grantActive[\s\S]{0,120}id="quick-setup-card"/.test(VIEW),
      '一键卡没有按 grantActive 条件渲染');
    ok(/setGrantActive\(/.test(VIEW) && /LearnGrant\.activeIn\(cur,\s*'chat'\)/.test(VIEW),
      "settings-view 没有从 LearnGrant.activeIn(cur, 'chat') 算出 grantActive");
  });
});
