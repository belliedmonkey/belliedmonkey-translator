// test/backend-config.test.js — 后端地址这件事，谁都不许说谎。
//
// 这个文件守的是 §C（中国版境内后端）的三条不变量。它们全都是**结构性**的：
// 不需要网络、不需要机器，改坏了当场变红。
//
// 为什么值得一道单独的门禁：中国版切后端是一次**看不出来的**改动。产物里
// `url` 是一个字符串，写错了、没替换成功、或者替换了一半，包照样构建成功、
// 照样能装、照样能翻译 —— 只有登录和同步会坏，而那要真的有一个中国用户
// 去点才发现。这正是这个仓库反复付过钱的那类失败：**静默、且要别人替你发现。**

const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

const ROOT = path.join(__dirname, '..');
const CFG_PATH = path.join(ROOT, 'extension', 'learn', 'backend.config.js');
const CFG_SRC = fs.readFileSync(CFG_PATH, 'utf8');
const CFG = require('../extension/learn/backend.config.js');

// 注释里出现的字面量不算数（`codeOf` 那条教训：一条解释自己的注释把断言绊倒过两次）。
const code = CFG_SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('backend.config.js — 构建期文本替换的契约', () => {
  // build.js 的 flipSyncFlag / limitProviders / switchBackend 全都要求「恰好一处」，
  // 命中数不对就 exit(1)。那个失败发生在构建时，而这里让它发生在**改代码时** ——
  // 早一步，且不需要记得去跑 china flavor 才看得见。
  test('`enabled: true,` 恰好一处 —— flipSyncFlag 的前提', () => {
    const hits = code.match(/^\s*enabled: true,/gm) || [];
    eq(hits.length, 1, `实际 ${hits.length} 处；多一处或少一处都会让 build.js 的 flipSyncFlag 直接 exit(1)`);
  });

  test("`providers: ['apple', 'google'],` 恰好一处 —— limitProviders 的前提", () => {
    const hits = code.match(/providers: \['apple', 'google'\],/g) || [];
    eq(hits.length, 1, `实际 ${hits.length} 处`);
  });

  test('顶层 url / anonKey 各恰好一处 —— switchBackend 的前提', () => {
    for (const key of ['url', 'anonKey']) {
      const hits = code.match(new RegExp(`^  ${key}: '[^']*',`, 'gm')) || [];
      eq(hits.length, 1, `顶层 ${key} 实际 ${hits.length} 处 —— `
        + 'switchBackend 靠行首两个空格区分顶层与 china 块，缩进变了它会静默替换 0 处');
    }
  });

  test('china 块的键缩进是四个空格 —— 否则会被当成顶层键替换掉', () => {
    ok(/\n  china: \{\n(?:    \w+: [^\n]*\n)+  \},/.test(code),
      'china 块的形状变了：switchBackend 的顶层正则与「删掉 china 块」的正则都依赖它');
  });
});

describe('backend.config.js — 境内后端（§C）', () => {
  test('china 块存在，且三个键齐全', () => {
    ok(CFG.china && typeof CFG.china === 'object', 'MT_BACKEND.china 不见了');
    eq(typeof CFG.china.ready, 'boolean', 'china.ready 必须是布尔 —— 它是「切没切」的唯一判据');
    eq(typeof CFG.china.url, 'string', '');
    eq(typeof CFG.china.anonKey, 'string', '');
  });

  // 这一条是整个文件的核心：**说自己切了，就必须真的切到境内。**
  //
  // ready 为假时不检查地址（那是今天的状态：代码就位、机器还没有），
  // 但 ready 一旦为真，下面每一条都必须成立 —— 否则中国版会带着一个
  // 连不上的、或者根本还在境外的地址发出去。
  test('china.ready 为真时：地址必须是境内的、且与国际版不同', () => {
    if (!CFG.china.ready) return;   // 未就绪：不检查地址，这是正当状态
    const u = CFG.china.url;
    ok(!!u, 'china.ready=true 但 url 是空的');
    ok(!/\.supabase\.co/i.test(u),
      `china.url 仍然是 Supabase 托管域名（${u}）—— 那不是境内后端，说切了就是假话`);
    ok(/^https:\/\//.test(u), `china.url 必须是 https（${u}）`);
    ok(u !== CFG.url, '两个 flavor 的 url 相同 —— 那意味着中国版根本没换后端');
    ok(!!CFG.china.anonKey, 'china.ready=true 但 anonKey 是空的');
    ok(CFG.china.anonKey !== CFG.anonKey,
      'china 的 anonKey 与国际版相同 —— 一个后端签的 token 到另一个后端上是废纸，'
      + '这几乎必然是复制粘贴时漏改的那一半');
  });

  test('china.ready 为假时：url 与 anonKey 必须都是空的', () => {
    if (CFG.china.ready) return;
    // 半填的状态最危险：它看起来像「配好了」，而 build.js 仍然走关同步那条路。
    // 要么两个都填并把 ready 翻真，要么两个都空 —— 没有中间态。
    eq(CFG.china.url, '', 'ready=false 却填了 url —— 半填状态会让人以为已经切了');
    eq(CFG.china.anonKey, '', 'ready=false 却填了 anonKey');
  });
});

describe('build.js — 两条路都要在', () => {
  const BUILD = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  test('china override 按 china.ready 分叉，而不是无条件关同步', () => {
    ok(/chinaBackendReady\(\)/.test(BUILD),
      'build.js 不再按 china.ready 分叉 —— 那等于把境内后端这条路焊死在「关同步」上');
    ok(/switchBackend\(/.test(BUILD), 'switchBackend 不见了');
  });

  test('switchBackend 仍然坚持「恰好一处」，不许静默替换 0 处', () => {
    const fn = BUILD.slice(BUILD.indexOf('function switchBackend'));
    ok(/hits\.length !== 1/.test(fn) && /process\.exit\(1\)/.test(fn),
      'switchBackend 丢掉了命中数检查 —— 静默替换 0 处会产出一个「说自己是中国版、'
      + '其实还在打东京」的包，而那在产物里完全看不出来');
  });
});
