// test/asc-media-plan.test.js — 商店素材的上传清单（scripts/asc-media.js 的 PLAN）与另外两处对得上。
//
// 它挡的两个缺陷，都是「上传成功、没报错、商店页不对」：
//
//   ① 帧渲染出来了却从没上过商店。清单原来写死「前 5 张 / 前 4 张」，于是 1.7 的一键配置帧、
//      1.10 的文档帧在磁盘上躺了几个版本（2026-09-15 准备 1.11.0 时才发现）。
//   ② 新增语种有文案、没截图。2026-09-03 九份本地化一张图都没有，提审被 409 挡下，而 Apple
//      的报错不指出是哪个 locale。aso.md 里加了语种而这里没加，就是同一件事再来一次。
//
// 读源码而不 require：asc-media.js 一加载就去连 ASC。

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
    for (const s of sets) ok(/frames\(ORDER_(GLOBAL|CN),/.test(s[1]), `这组没走 ORDER：${s[0].slice(0, 80)}`);
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

  test('每条线的 id 唯一（--only 靠它点名）', () => {
    const ids = LINES.map((x) => x.id);
    eq(new Set(ids).size, ids.length, `有重复的 id：${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
  });
});
