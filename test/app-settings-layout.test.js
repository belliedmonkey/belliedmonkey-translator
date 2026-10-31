// test/app-settings-layout.test.js — 设置页文字不许出界（2026-10-03）。
//
// 真机截图：「听译 · 实时字幕」段里「自动朗读译文」那一行越过了卡片右边界。
// 设计稿 `app-settings-layout-2026-10-03`（**用户已签署**）给了三条排版规则，
// 这一层把它们钉成源码判据；「12 语种 × 最窄视口真的不溢出」由 test:app 的行为探针守。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(css);
  return m ? m[1] : '';
};

describe('设置页排版：文字不许出界（2026-10-03 设计稿已签）', () => {
  test('★ 文字侧可收缩：.check > span 与 .field > span 都要 flex/min-width:0 + overflow-wrap', () => {
    const c = rule('.check > span');
    ok(/flex\s*:\s*1/.test(c) && /min-width\s*:\s*0/.test(c) && /overflow-wrap\s*:\s*anywhere/.test(c),
      '.check > span 不肯收缩 —— flex item 默认 min-width:auto，长文案会顶出卡片：' + c);
    const f = rule('.field > span');
    ok(/min-width\s*:\s*0/.test(f) && /overflow-wrap\s*:\s*anywhere/.test(f),
      '.field > span 不肯收缩：' + f);
  });

  test('★ 控件不收缩：.check > input 与 .field > button 明确 flex:none', () => {
    ok(/flex\s*:\s*none/.test(rule('.check > input')), '.check > input 会被长文案压扁');
    ok(/flex\s*:\s*none/.test(rule('.field > button')), '.field > button 会被压扁');
  });

  test('★ 说明整宽换行：.note 允许长串断行', () => {
    ok(/overflow-wrap\s*:\s*anywhere/.test(rule('.note')),
      '.note 不能断长串 —— 「整句翻译完之后自动读出来…」会顶出卡片');
  });

  test('★ 卡片自身与直接子元素都要 min-width:0（内容撑不破圆角边界）', () => {
    ok(/min-width\s*:\s*0/.test(rule('#app-settings .sgroup')), '.sgroup 没有 min-width:0');
    ok(/min-width\s*:\s*0/.test(rule('#app-settings .sgroup > *')), '.sgroup 的直接子元素没有 min-width:0');
  });
});
