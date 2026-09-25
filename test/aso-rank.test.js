// test/aso-rank.test.js — 关键词名次追踪（scripts/aso-rank.js）的词表与两条读法约束。
//
// 这个脚本只读、不改商店，所以要守的不是「它会不会误伤」，而是「它会不会悄悄量错」：
//   · 词表里的目标名写错 → 那一组词永远不会被量到，快照里就少一块，而没人会发现。
//   · 国际版的 bundleId 是中国版 bundleId 的前缀（com.belliedmonkeytranslator[.cn]）——
//     用 startsWith 匹配会把中国版的名次算成国际版的。必须精确匹配。
//   · Mac 版在 entity=software 里根本搜不到，必须 macSoftware；写错的话 Mac 永远是 200+。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts/aso-rank.js'), 'utf8');
const LIST = JSON.parse(fs.readFileSync(path.join(ROOT, 'store-assets/aso-keywords.json'), 'utf8'));

describe('aso-rank —— 词表合法、匹配精确', () => {
  const targets = Object.keys(LIST).filter((k) => !k.startsWith('_'));

  test('词表只用脚本认识的四个目标', () => {
    for (const t of targets) ok(['ios', 'mac', 'ios-cn', 'mac-cn'].includes(t), '不认识的目标: ' + t);
  });

  test('店面是两位小写国家码，每个店面至少一个词、没有重复词、没有空词', () => {
    for (const t of targets) {
      for (const [c, terms] of Object.entries(LIST[t])) {
        ok(/^[a-z]{2}$/.test(c), `${t} 的店面「${c}」不是两位小写国家码`);
        ok(Array.isArray(terms) && terms.length > 0, `${t}·${c} 没有词`);
        eq(new Set(terms).size, terms.length, `${t}·${c} 有重复词`);
        for (const w of terms) ok(typeof w === 'string' && w.trim() === w && w.length > 0, `${t}·${c} 有空词或首尾空格: 「${w}」`);
      }
    }
  });

  test('中国版目标只量 cn 店面（中国版只在那一个店面上架）', () => {
    for (const t of ['ios-cn', 'mac-cn']) if (LIST[t]) eq(Object.keys(LIST[t]).join(','), 'cn');
  });

  test('按 bundleId 精确匹配，不用前缀 —— 国际版 id 是中国版 id 的前缀', () => {
    ok(/x\.bundleId === bundleId/.test(SRC), '找不到精确匹配');
    ok(!/bundleId\)?\.startsWith\(|startsWith\(bundleId/.test(SRC), '出现了前缀匹配');
  });

  test('Mac 目标走 macSoftware —— software 里搜不到 Mac 版', () => {
    ok(/'mac':\s*\{[^}]*entity:\s*'macSoftware'/.test(SRC), "mac 目标不是 macSoftware");
    ok(/'mac-cn':\s*\{[^}]*entity:\s*'macSoftware'/.test(SRC), "mac-cn 目标不是 macSoftware");
  });
});
