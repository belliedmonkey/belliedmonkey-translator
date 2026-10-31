// test/readme-facts.test.js — README ×2 里那些**写死的仓库事实**必须与仓库一致。
//
// 为什么需要这道门禁：这类数字**坏掉的时候没有任何东西会红**。加一个 fixture、往
// background.js 里补几行、多一份 locale —— 每一次都合理、每一次都不碰 README，
// 于是 README 安静地变成假话，而唯一会发现它的人是读 README 的陌生人。
//
// 2026-09-21 的审计一次抓到四处，最久的一处不知道错了多久：
//
//   · 「30 fixtures today」与同一份文档里的「29 layout fixtures」—— 两个数互相矛盾，
//     而实际是 42。两处都写着 "today"/「目前」，是显式的时间锚，却没人给它上发条。
//   · 「background.js is 64 lines」—— 实际 179 行。这句还被用来论证
//     「service worker 从不在关键路径上」，数字塌了，论证也就跟着虚了。
//   · 「_locales/ 11 languages」—— 实际 12 份。
//   · 代码结构树里 content/ 只列了 9 个文件，实际 37 个，且整棵树漏掉了 learn/、
//     onboard/、styles/、icons/、vendor/ 与整个 app/。
//
// 这道门只管**可以机器核对的数字**。树里各文件的描述、功能清单那些句子机器判不了，
// 仍然靠人 —— 但至少数字不会再烂。
//
// 判据是「README 里写的数 === 现在数出来的数」，**不是**「README 里有个数字」。
// 所以改了 background.js 又没改 README，npm test 当场红，而不是三个月后被读者发现。
const { describe, test, eq, ok } = require('./harness');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EN = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const ZH = fs.readFileSync(path.join(ROOT, 'README.zh-CN.md'), 'utf8');
const CI = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');

const countFiles = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).length;
const countDirs = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .filter((d) => d.isDirectory()).length;
// 与 `wc -l` 同口径（数换行符，不把末尾那个空串算成一行）—— README 里的数字就是这么来的。
const lines = (f) => {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
};

// 现在数出来的真实值。每一项都注明它在 README 里被拿来说什么事 ——
// 数字本身不重要，重要的是它支撑的那句话。
const ACTUAL = {
  // 「增量适配契约」：新站点修复必带一个修复前是红的 fixture，老 fixture 不许改。
  fixtures: countFiles('test/layout/fixtures', /\.html$/),
  // 「service worker 从不在关键路径上」—— Safari 上它会永久 undefined，见 README 同一段。
  backgroundLines: lines('extension/background.js'),
  // 界面语言。注意这是三张互不相同的注册表之一（另两张是「译成」目标语言与可学习语言）。
  locales: countDirs('extension/_locales'),
  contentJs: countFiles('extension/content', /\.js$/),
  learnJs: countFiles('extension/learn', /\.js$/),
};

// 从文档里把数字抠出来。正则只锚在**它论证的那句话**上，不锚行号 ——
// 行号会随任何一次编辑漂走，而这几句话的措辞是稳定的。
function pick(src, label, re) {
  const m = src.match(re);
  ok(m, `README 里找不到「${label}」那句话（正则：${re}）—— 是不是措辞被改了？`
    + '改措辞可以，但请连这里的正则一起改，别把门禁绕过去。');
  return Number(m[1]);
}

describe('README ×2 里写死的仓库事实', () => {
  test('排版 fixture 数：两份 README + CI 注释，三处都对得上', () => {
    eq(pick(EN, 'N fixtures today', /(\d+) fixtures today/), ACTUAL.fixtures);
    eq(pick(EN, 'N layout fixtures', /# (\d+) layout fixtures/), ACTUAL.fixtures);
    eq(pick(ZH, '目前 N 个', /目前 (\d+) 个，跑在真实的无头 Chrome/), ACTUAL.fixtures);
    eq(pick(ZH, 'N 个排版 fixture', /# (\d+) 个排版 fixture/), ACTUAL.fixtures);
    // CI 的注释也写死过同一个数，2026-09-21 之前它和 README 一起错着。
    eq(pick(CI, 'the N-fixture layout corpus', /the (\d+)-fixture layout corpus/), ACTUAL.fixtures);
  });

  test('background.js 行数 —— 它支撑「从不在关键路径上」那句', () => {
    eq(pick(EN, 'is N lines', /is (\d+) lines that handle defaults/), ACTUAL.backgroundLines);
    eq(pick(ZH, '只有 N 行', /只有 (\d+) 行，负责默认值/), ACTUAL.backgroundLines);
  });

  test('_locales 语言数', () => {
    eq(pick(EN, '_locales N languages', /_locales\/\s+(\d+) languages/), ACTUAL.locales);
    eq(pick(ZH, '_locales N 种语言', /_locales\/\s+(\d+) 种语言/), ACTUAL.locales);
  });

  test('代码结构树里的文件数：content/ 与 learn/', () => {
    eq(pick(EN, 'content/ N files', /content\/\s+(\d+) files/), ACTUAL.contentJs);
    eq(pick(ZH, 'content/ N 个文件', /content\/\s+(\d+) 个文件/), ACTUAL.contentJs);
    eq(pick(EN, 'learn/ N files', /learn\/\s+(\d+) files/), ACTUAL.learnJs);
    eq(pick(ZH, 'learn/ N 个文件', /learn\/\s+(\d+) 个文件/), ACTUAL.learnJs);
  });

  // 商店素材的帧数同样是「坏了没人红」的一类 —— 2026-09-21 一次抓到三处：
  //   · store-assets/README.md 写「1..6」，实际 en-web 是 1..9、en-iphone 是 1..10
  //   · screenshots-cn/README.md 写「四帧、两个尺寸」，实际 7 帧 4 个尺寸
  //   · store-release 技能的 assets.md 素材矩阵整张表都停在 1..5 / 1..4
  // 每加一帧都要改三处文档，靠人记着必然漏。
  // 2026-09-23：四档不再等长，而且**两次变长的方向相反**——
  //   · 帧 10（系统翻译）只有手机档原料 ⇒ iPhone 集 10 张；这天又给官网补了 web 档。
  //   · 帧 11（快速翻译）只有桌面档原料 ⇒ Mac 集 10 张；同样给官网补了 web 档。
  // 于是「共有帧数」既不能拿 web 档代表（它两帧都有），也不能拿 mac 档代表（它有帧 11）——
  // 现在用 **iPad 档**：系统翻译拍不到（没有 iPad 硬件），快速翻译在 iPad 上不存在，
  // 所以它是唯一天然停在共有帧的一档。iPhone / Mac / web 各自单独核对。
  // ⚠️ assets.md 里「CWS / AMO 取 web-1..N」那一行说的是**两店取哪几帧**，不是磁盘上有几张 ——
  // 它必须停在共有帧：10 / 11 都是 App 独有功能，扩展商店不放（asc-media.js 的「按构造排除」）。
  test('商店素材的帧数：三份文档与磁盘上的张数一致', () => {
    const count = (dir, prefix) => fs.readdirSync(path.join(ROOT, dir))
      .filter((f) => f.startsWith(prefix + '-') && f.endsWith('.png')).length;
    // ⚠️ **帧号 ≠ 张数**，这是 2026-09-23 加帧 11 时当场踩到的：Mac 档的文件是 1..9 外加 11，
    // 共 10 张而最大帧号是 11。所以「共有那一段」比张数，「某种设备独有的帧」比帧号，两者分开。
    const nums = (dir, prefix) => fs.readdirSync(path.join(ROOT, dir))
      .filter((f) => f.startsWith(prefix + '-') && f.endsWith('.png'))
      .map((f) => Number(f.slice(prefix.length + 1, -4)))
      .filter(Number.isInteger).sort((a, b) => a - b);
    const enShared = count('store-assets', 'en-ipad');
    const cnShared = count('screenshots-cn', 'cn-ipad');

    const SA = fs.readFileSync(path.join(ROOT, 'store-assets', 'README.md'), 'utf8');
    const CN = fs.readFileSync(path.join(ROOT, 'screenshots-cn', 'README.md'), 'utf8');
    const AS = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'store-release', 'assets.md'), 'utf8');

    eq(pick(SA, 'store-assets/README 的 1..N', /\{iphone,ipad,mac,web\}-1\.\.(\d+)\.png/), enShared);
    eq(pick(CN, 'screenshots-cn/README 的 1..N', /cn-\{iphone,ipad,mac,web\}-1\.\.(\d+)\.png/), cnShared);
    eq(pick(AS, 'assets.md 的 {zh,en}-web-1..N（两店取哪几帧）', /\{zh,en\}-web-1\.\.(\d+)/), enShared);

    // 「某种设备独有」的帧（号 > 共有段）：磁盘上有的，README 必须逐个点名；
    // README 点到的，磁盘上必须真有。两个方向都堵住，漏渲和写错帧号都会红。
    const onDisk = [];
    for (const tier of ['iphone', 'ipad', 'mac', 'web']) {
      for (const n of nums('store-assets', `en-${tier}`)) if (n > enShared) onDisk.push(`${tier}-${n}.png`);
    }
    for (const e of onDisk) ok(SA.includes(e), `store-assets/README 没提到独有帧 ${e}`);
    for (const m of SA.matchAll(/\b(iphone|ipad|mac|web)-(\d+)\.png/g)) {
      if (Number(m[2]) <= enShared) continue;
      ok(onDisk.includes(m[0]), `store-assets/README 写了 ${m[0]}，但 store-assets/ 里没有这张`);
    }

    // 中国版同一套（2026-09-23 补了帧 8 系统翻译：只有 iPhone 与 web 两档）
    const cnDisk = [];
    for (const tier of ['iphone', 'ipad', 'mac', 'web']) {
      for (const n of nums('screenshots-cn', `cn-${tier}`)) if (n > cnShared) cnDisk.push(`cn-${tier}-${n}.png`);
    }
    for (const e of cnDisk) ok(CN.includes(e), `screenshots-cn/README 没提到独有帧 ${e}`);
    for (const m of CN.matchAll(/\bcn-(iphone|ipad|mac|web)-(\d+)\.png/g)) {
      if (Number(m[2]) <= cnShared) continue;
      ok(cnDisk.includes(m[0]), `screenshots-cn/README 写了 ${m[0]}，但 screenshots-cn/ 里没有这张`);
    }
    // assets.md 的 iPhone 那一行写的是**帧号**（`en-iphone-1..10`：1..9 再加系统翻译那帧），
    // 而 iPhone 档恰好 1..10 连号，所以张数与最大帧号相等；Mac 那行不连号，不能这么比。
    eq(pick(AS, 'assets.md 的 en-iphone-1..N', /en-iphone-1\.\.(\d+)/), nums('store-assets', 'en-iphone').at(-1));
    eq(pick(AS, 'assets.md 的 cn-iphone-1..N', /cn-iphone-1\.\.(\d+)/), nums('screenshots-cn', 'cn-iphone').at(-1));
  });

  // 结构树漏掉整整几个目录，是 2026-09-21 那次审计里最严重的一条 —— 数字对了、
  // 树本身却把半个代码库藏起来了。这条只查「提到没提到」，不查描述写得对不对。
  test('结构树提到了每一个真实存在的顶层目录', () => {
    const dirs = fs.readdirSync(path.join(ROOT, 'extension'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    for (const d of dirs) {
      ok(EN.includes(d + '/'), `README.md 的结构树没提到 extension/${d}/`);
      ok(ZH.includes(d + '/'), `README.zh-CN.md 的结构树没提到 extension/${d}/`);
    }
    // 宿主 App 整棵树曾经完全不在 README 里，而一半主打功能住在那儿。
    ok(/\bapp\/\s/.test(EN), 'README.md 没有提到宿主 App 的 app/ 目录');
    ok(/\bapp\/\s/.test(ZH), 'README.zh-CN.md 没有提到宿主 App 的 app/ 目录');
  });
});
