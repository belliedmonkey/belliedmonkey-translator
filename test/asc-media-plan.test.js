// test/asc-media-plan.test.js — 商店素材的上传清单（scripts/asc-media.js 的 PLAN）与另外两处对得上。
//
// 它挡的两个缺陷，都是「上传成功、没报错、商店页不对」：
//
//   ① 帧渲染出来了却从没上过商店。清单原来写死「前 5 张 / 前 4 张」，于是 1.7 的一键配置帧、
//      1.10 的文档帧在磁盘上躺了几个版本（2026-09-15 准备 1.11.0 时才发现）。
//   ② 新增语种有文案、没截图。2026-09-03 九份本地化一张图都没有，提审被 409 挡下，而 Apple
//      的报错不指出是哪个 locale。aso.md 里加了语种而这里没加，就是同一件事再来一次。
//
// 读源码而不 require：asc-media.js 一加载就去连 ASC ——
// **除了 `expectedCounts()`**，2026-09-24 起它被 `require.main === module` 守卫着，可以安全 require。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('scripts/asc-media.js');
const ASO = read('store-assets/aso.md');

function order(name) {
  const m = SRC.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  ok(m, `asc-media.js 里没有 ${name}`);
  return m[1].split(',').map((s) => Number(s.trim()));
}
function rendered(file) {
  const m = read(file).match(/for f in ([\d ]+); do/);
  ok(m, `${file} 里找不到帧循环`);
  return m[1].trim().split(/\s+/).map(Number);
}
const LINES = [...SRC.matchAll(/id: '([\w-]+)', bundleId: '([\w.]+)', platform: '(\w+)', locale: '([\w-]+)'/g)]
  .map((m) => ({ id: m[1], bundle: m[2], platform: m[3], locale: m[4] }));
function asoLocales(group) {
  const re = /^##\s+(国际版|中国版)\s*·\s*([A-Za-z-]+)\s*·\s*\w+\s*$/gm;
  return [...new Set([...ASO.matchAll(re)].filter((m) => m[1] === group).map((m) => m[2]))].sort();
}
const num = (a) => [...a].sort((x, y) => x - y).join(',');

describe('asc-media 上传清单 — 与渲染脚本、aso.md 对得上', () => {
  test('显示顺序恰好是渲染出来的全部帧：不漏、不重复、不超过 ASC 的 10 张', () => {
    for (const [name, file] of [['ORDER_GLOBAL', 'store-assets/src/render.sh'], ['ORDER_CN', 'screenshots-cn/src/render.sh']]) {
      const o = order(name);
      eq(num(o), num(rendered(file)), `${name} 与 ${file} 渲染的帧不一致 —— 多出的帧会缺文件，少的帧永远上不了商店`);
      eq(new Set(o).size, o.length, `${name} 有重复帧`);
      ok(o.length <= 10, `${name} 有 ${o.length} 张，ASC 每组最多 10 张`);
    }
  });

  test('每组截图都按 ORDER 取文件，不再写死张数', () => {
    ok(!/\b(five|four)\(/.test(SRC), '还有 five( / four( —— 写死张数正是帧渲染了却没上架的原因');
    const sets = [...SRC.matchAll(/APP_(?:IPHONE_65|IPAD_PRO_3GEN_129|DESKTOP):\s*([^\n]+)/g)];
    ok(sets.length > 0, '一组截图都没解析到');
    // ORDER_IPHONE 是 2026-09-21 加的第三张表：iPhone 那一集比别的集多一帧（10 系统翻译），
    // 因为只有它有原料 —— iPad 没有硬件可拍、Mac 根本没有这个功能。
    // ORDER_MAC 是 2026-09-23 加的第四张，镜像对称：Mac 那一集多一帧（11 快速翻译），
    // 因为这个功能只有 Mac 有，而原料也只有 desk 档。
    for (const s of sets) ok(/frames\(ORDER_(GLOBAL|CN|CN_IPHONE|IPHONE|MAC),/.test(s[1]), `这组没走 ORDER：${s[0].slice(0, 80)}`);
  });

  test('aso.md 里的每个语种，在 iOS 与 macOS 各有一条截图线', () => {
    for (const [group, bundle] of [['国际版', 'com.belliedmonkeytranslator'], ['中国版', 'com.belliedmonkeytranslator.cn']]) {
      const want = asoLocales(group);
      ok(want.length > 0, `aso.md 里没有 ${group} 的段落`);
      for (const platform of ['IOS', 'MAC_OS']) {
        const have = LINES.filter((x) => x.bundle === bundle && x.platform === platform).map((x) => x.locale).sort();
        eq(have.join(','), want.join(','), `${group} ${platform} 的截图语种与 aso.md 不一致 —— 缺的那个语种提审会被 409 挡下`);
      }
    }
  });

  test('AMO 预览图（amo-listing.js --previews 按 ORDER_GLOBAL 取 en-web-N.png）每一张都在', () => {
    ok(/ORDER_GLOBAL/.test(read('scripts/amo-listing.js')), 'amo-listing.js 没有读 ORDER_GLOBAL —— 预览图顺序又抄了一份');
    const missing = order('ORDER_GLOBAL').map((n) => `store-assets/en-web-${n}.png`)
      .filter((f) => !fs.existsSync(path.join(ROOT, f)));
    eq(missing.length, 0, `缺 ${missing.join(', ')} —— 发版当天传 AMO 时才会发现`);
  });

  test('扩展商店的预览图不放 App 独有功能的帧（amo-listing.js 按 APP_ONLY_GLOBAL 剔除）', () => {
    const appOnly = order('APP_ONLY_GLOBAL');
    ok(appOnly.length > 0, 'APP_ONLY_GLOBAL 是空的');
    const all = new Set(order('ORDER_GLOBAL'));
    for (const n of appOnly) ok(all.has(n), `APP_ONLY_GLOBAL 里的 ${n} 不在 ORDER_GLOBAL 里 —— 帧号写错了`);
    ok(/APP_ONLY_GLOBAL/.test(read('scripts/amo-listing.js')),
      'amo-listing.js 没有读 APP_ONLY_GLOBAL —— Firefox 附加组件页会宣传装扩展得不到的实时字幕 / 对话听译');
  });

  test('每条线的 id 唯一（--only 靠它点名）', () => {
    const ids = LINES.map((x) => x.id);
    eq(new Set(ids).size, ids.length, `有重复的 id：${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
  });
});

// ── expectedCounts()：asc-submit 提审门禁依赖的那条边界（2026-09-24） ──────────
//
// `asc-submit.js` 提审前会回读 ASC 的实际张数，和这里导出的期望比对，对不上就拒绝提交。
// 那道门挡的是一件已经发生过两次的事：帧渲染出来了、写进了 PLAN，**却从来没传上去过**
// （国际 Mac 配 10 张而商店 9、中国 iPhone 配 8 而商店 7 —— 每次发版都撞上在审状态被跳过）。
//
// 这条测试守的是**依赖边界本身**：如果有人删掉 export，或者去掉 `require.main` 守卫
// （那样 require 它就会去连 ASC、在 npm test 里挂住），发版当天才会发现。
describe('asc-media 导出 expectedCounts —— asc-submit 的提审门禁靠它', () => {
  const { expectedCounts } = require('../scripts/asc-media.js');

  test('导得出来，且每条都带齐四个定位字段 + 张数', () => {
    const rows = expectedCounts();
    ok(rows.length > 0, '一条都没有');
    for (const r of rows) {
      ok(r.bundleId && r.platform && r.locale && r.displayType, '缺定位字段: ' + JSON.stringify(r));
      ok(Number.isInteger(r.count) && r.count > 0, '张数不是正整数: ' + JSON.stringify(r));
    }
  });

  // ⚠️ **期望是按 locale 分的，不是按档分的**：帧 10（系统翻译）只进 en-US 与 zh-Hans
  // 两份 iPhone 集，另外九种语言的 iPhone 走 ORDER_GLOBAL（9 张，用英文那套图）。
  // Mac 相反 —— 所有 locale 都走 ORDER_MAC（10 张）。
  // 我第一版测试断言「同一档各 locale 张数一致」，当场被这里证伪。
  test('张数与 ORDER_* 一致（按 locale 取，因为各 locale 并不相同）', () => {
    const rows = expectedCounts();
    const at = (bundleId, platform, locale, displayType) => {
      const hit = rows.filter((r) => r.bundleId === bundleId && r.platform === platform
        && r.locale === locale && r.displayType === displayType);
      eq(hit.length, 1, `${bundleId} ${platform} ${locale} ${displayType} 命中 ${hit.length} 条`);
      return hit[0].count;
    };
    const GL = 'com.belliedmonkeytranslator', CN = 'com.belliedmonkeytranslator.cn';
    eq(at(GL, 'IOS', 'en-US', 'APP_IPHONE_65'), 10);           // ORDER_IPHONE（含帧 10 系统翻译）
    eq(at(GL, 'IOS', 'zh-Hans', 'APP_IPHONE_65'), 10);         // 同上
    eq(at(GL, 'IOS', 'ru', 'APP_IPHONE_65'), 9);               // ORDER_GLOBAL —— 其余语种没有帧 10
    eq(at(GL, 'IOS', 'en-US', 'APP_IPAD_PRO_3GEN_129'), 9);    // ORDER_GLOBAL（iPad 没原料）
    eq(at(GL, 'MAC_OS', 'en-US', 'APP_DESKTOP'), 10);          // ORDER_MAC（含帧 11 快速翻译）
    eq(at(GL, 'MAC_OS', 'ru', 'APP_DESKTOP'), 10);             // Mac 所有 locale 都是 10
    eq(at(CN, 'IOS', 'zh-Hans', 'APP_IPHONE_65'), 8);          // ORDER_CN_IPHONE（含帧 8 系统翻译）
    eq(at(CN, 'IOS', 'zh-Hans', 'APP_IPAD_PRO_3GEN_129'), 7);  // ORDER_CN
    eq(at(CN, 'MAC_OS', 'zh-Hans', 'APP_DESKTOP'), 7);         // ORDER_CN
  });
});
