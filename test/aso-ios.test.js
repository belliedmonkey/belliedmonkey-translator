// test/aso-ios.test.js — iOS 两线的商店文案（store-assets/aso-ios.md）是从底稿 aso.md **生成**的，只多一节「系统翻译」。
//
// 2026-09-25：「系统翻译」是 1.14.0 的主角（Gate J-2），却在 iOS 商店文案里一次都没出现过 —— 因为当时只有
// Mac 那一份专属段，iOS 直接传共用的 aso.md。这里守四件会静默出错的事：
//   ① 改了 aso.md 却没重新生成，iOS 商店页从此落后一版；
//   ② 有人把系统翻译写进了共用的 aso.md，Mac 的商店页开始描述一个它没有的功能（反过来的快速翻译由 aso-mac.test.js 守）；
//   ③ 专属段里说了口径红线上的话（国际版有免费额度中转，不能说「不经过我们的服务器」）；
//   ④ 上传时平台与文件没对上 —— asc.js 必须拦，传错了商店页只会悄悄少一节。
const fs = require('fs');
const path = require('path');
const { describe, test, eq, ok } = require('./harness');
const ROOT = path.join(__dirname, '..');
const RED = require('./lib/copy-redlines');
const P = require(path.join(ROOT, 'scripts', 'gen-aso-platforms.js'));
const base = fs.readFileSync(path.join(ROOT, 'store-assets', 'aso.md'), 'utf8');
const ios = fs.readFileSync(path.join(ROOT, 'store-assets', 'aso-ios.md'), 'utf8');
const mac = fs.readFileSync(path.join(ROOT, 'store-assets', 'aso-mac.md'), 'utf8');
const SECTION = JSON.parse(fs.readFileSync(path.join(ROOT, 'store-assets', 'aso-ios-section.json'), 'utf8'));
const descs = (md) => [...md.matchAll(/^##\s+(国际版|中国版)\s*·\s*([A-Za-z-]+)\s*·\s*description\s*\n\n```\n([\s\S]*?)\n```/gm)].map((m) => ({ flavor: m[1], loc: m[2], text: m[3] }));
const SYSTRANS = /System translation|SYSTEM TRANSLATION|系统翻译|系統翻譯|システム翻訳|시스템 번역|Default Translate App/i;

describe('aso-ios.md —— 由 aso.md 生成，只多一节「系统翻译」', () => {
  test('与生成器此刻的输出逐字相同（改了 aso.md 没重新生成 ⇒ 红；修法：node scripts/gen-aso-platforms.js）', () => {
    eq(P.build(base, 'ios').text, ios);
  });
  test('每段描述恰好多一节，且那一节就是表里的那一节；其余逐字相同；不超商店的 4000 字', () => {
    const a = descs(base), b = descs(ios);
    eq(a.length, b.length); ok(a.length >= 16, '描述段数不对：' + a.length);
    for (let i = 0; i < a.length; i++) {
      const pa = a[i].text.split(/\n\n/), pb = b[i].text.split(/\n\n/);
      eq(pb.length, pa.length + 1, b[i].loc);
      const extra = pb.filter((x) => pa.indexOf(x) < 0);
      eq(extra.length, 1, b[i].loc); ok(extra[0].includes(SECTION[b[i].loc].body), b[i].loc + ' 多出来的不是那一节');
      eq(pb.filter((x) => x !== extra[0]).join('\n\n'), a[i].text, b[i].loc + ' 其余部分被动过');
      ok(b[i].text.length <= P.LIMIT, `${b[i].loc} ${b[i].text.length} 字`);
    }
  });
  test('★ 底稿与 Mac 那份都一个字不提系统翻译（Mac 没有这个扩展点）', () => {
    ok(!SYSTRANS.test(base), 'aso.md 里出现了系统翻译');
    ok(!SYSTRANS.test(mac), 'aso-mac.md 里出现了系统翻译 —— Mac 的商店页不该描述一个它没有的功能');
  });
  test('★ iOS 那份一个字不提快速翻译（Mac 独有）', () => {
    ok(!/Quick Translate|快速翻译|快速翻譯|⌃⌥T/i.test(ios), 'aso-ios.md 里出现了快速翻译');
  });
  test('专属段过口径红线：不点名服务商、不说没有追踪、不说不加限定的完全免费、不说「不经过我们的服务器」', () => {
    for (const [loc, s] of Object.entries(SECTION)) {
      const t = s.heading + '\n' + s.body;
      for (const list of [RED.NO_TRACKING, RED.FULLY_FREE, RED.NO_SERVER_OF_OURS]) eq(RED.firstHit(list, t), null, loc);
      eq(t.match(RED.PROVIDER_BRANDS), null, loc + ' 点名了服务商');
      ok(/18\.4/.test(s.body), loc + ' 没写系统要求（iOS 18.4）—— 描述里提功能要紧跟要求');
    }
  });
  test('表里的语种 = aso.md 里有描述的语种，一个不多一个不少', () => {
    eq(Object.keys(SECTION).sort().join(), [...new Set(descs(base).map((d) => d.loc))].sort().join());
  });
  test('asc.js aso 拦「平台与文件对不上」：iOS 只收 aso-ios.md，macOS 只收 aso-mac.md', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'asc.js'), 'utf8');
    ok(/IOS:\s*'aso-ios\.md'/.test(src) && /MAC_OS:\s*'aso-mac\.md'/.test(src), 'asc.js 里找不到平台 → 文件的对照表');
  });
});
