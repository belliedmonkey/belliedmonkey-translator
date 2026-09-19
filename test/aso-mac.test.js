// test/aso-mac.test.js — macOS 两线的商店文案（store-assets/aso-mac.md）是从 aso.md **生成**的，只多一节「快速翻译」。
//
// Gate J-1（docs/learning-design.md §10）：商店文案只在 Mac 两线提快速翻译。这里会静默出错的：有人改了 aso.md 却忘了
// 重新生成，macOS 商店页从此落后一版；或者反过来，有人把快速翻译写进了共用的 aso.md，iPhone 的商店页开始描述一个它没有的功能。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok } = require('./harness');
const ROOT = path.join(__dirname, '..');
const RED = require('./lib/copy-redlines');
const G = require(path.join(ROOT, 'scripts', 'gen-aso-mac.js'));
const ios = fs.readFileSync(path.join(ROOT, 'store-assets', 'aso.md'), 'utf8');
const mac = fs.readFileSync(path.join(ROOT, 'store-assets', 'aso-mac.md'), 'utf8');
const SECTION = JSON.parse(fs.readFileSync(path.join(ROOT, 'store-assets', 'aso-mac-section.json'), 'utf8'));
const descs = (md) => [...md.matchAll(/^##\s+(国际版|中国版)\s*·\s*([A-Za-z-]+)\s*·\s*description\s*\n\n```\n([\s\S]*?)\n```/gm)].map((m) => ({ flavor: m[1], loc: m[2], text: m[3] }));

describe('aso-mac.md —— 由 aso.md 生成，只多一节', () => {
  test('与生成器此刻的输出逐字相同（改了 aso.md 没重新生成 ⇒ 红；修法：node scripts/gen-aso-mac.js）', () => {
    eq(G.build(ios).text, mac);
  });
  test('每段描述恰好多一节，且那一节就是表里的那一节；其余逐字相同；不超商店的 4000 字', () => {
    const a = descs(ios), b = descs(mac);
    eq(a.length, b.length); ok(a.length >= 16, '描述段数不对：' + a.length);
    for (let i = 0; i < a.length; i++) {
      const pa = a[i].text.split(/\n\n/), pb = b[i].text.split(/\n\n/);
      eq(pb.length, pa.length + 1, b[i].loc);
      const extra = pb.filter((x) => pa.indexOf(x) < 0);
      eq(extra.length, 1, b[i].loc); ok(extra[0].includes(SECTION[b[i].loc].body), b[i].loc + ' 多出来的不是那一节');
      eq(pb.filter((x) => x !== extra[0]).join('\n\n'), a[i].text, b[i].loc + ' 其余部分被动过');
      ok(b[i].text.length <= G.LIMIT, `${b[i].loc} ${b[i].text.length} 字`);
    }
  });
  test('★ 共用的那份（iOS 两线）一个字都不提快速翻译', () => {
    ok(!/Quick Translate|快速翻译|快速翻譯|⌃⌥T/i.test(ios), 'aso.md 里出现了快速翻译 —— iPhone 的商店页不该描述一个它没有的功能');
  });
  test('多出来的那一节也过口径红线：不点名服务商、不说没有追踪、不说不加限定的完全免费', () => {
    for (const [loc, s] of Object.entries(SECTION)) {
      const t = s.heading + '\n' + s.body;
      for (const list of [RED.NO_TRACKING, RED.FULLY_FREE, RED.NO_SERVER_OF_OURS]) eq(RED.firstHit(list, t), null, loc);
      eq(t.match(RED.PROVIDER_BRANDS), null, loc + ' 点名了服务商');
    }
  });
  test('表里的语种 = aso.md 里有描述的语种，一个不多一个不少', () => {
    eq(Object.keys(SECTION).sort().join(), [...new Set(descs(ios).map((d) => d.loc))].sort().join());
  });
});
