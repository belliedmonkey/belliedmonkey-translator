// test/app-firstrun.test.js — App 首屏三段式（2026-10-01，#532）。
//
// 六条红线的**可机检版**；判据原文在 `design/firstrun-3step/firstrun-spec.html`。
// 这份门**故意写在实现之前**：它现在就该红，代码再追上来（仓库规矩：能变成门禁的
// 就别留在清单里）。为什么不用 DOM：`npm test` 没有 jsdom（domain-design §10），
// 所以 R1/R2/R6 打的是**结构**，R3 打的是**纯函数真值表**，R4/R5 打的是**源码与文案**。
//
// 六条红线：
//   R1 未登录首屏只有登录（无设置、无功能入口、无复习入口）
//   R2 屏序可达，且屏 2（资源包）无跳过、屏 3（引导）有跳过
//   R3 就绪判据 = 引擎 + 识别语言包 + 朗读包（不含扩展），16 组布尔组合逐一断言
//   R4 两个 flavor 逐条同构（首屏模块不读 flavor）
//   R5 旧承诺防复活（App 侧文案不得再出现「不登录也能…」一类）
//   R6 每屏至多一个填色按钮
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');
const SHELL = 'src/app/AppShell.jsx';
const FIRST = 'src/app/firstrun.js';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 把 JSX 里 `id="x"` 所在的那个顶层 <section> … </section> 整段切出来
// （AppShell 的每屏就是一个顶层 section，内部没有嵌套 section）。
function section(src, id) {
  const i = src.indexOf(`id="${id}"`);
  if (i < 0) return null;
  const start = src.lastIndexOf('<section', i);
  if (start < 0) return null;
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src.startsWith('<section', j)) { depth++; j += 7; continue; }
    if (src.startsWith('</section>', j)) { depth--; j += 9; if (depth === 0) return src.slice(start, j); }
  }
  return null;
}
const buttonIds = (seg) => [...seg.matchAll(/<button[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
function classOf(seg, id) {
  const m = seg.match(new RegExp(`<button[^>]*\\sid="${id}"[^>]*className="([^"]*)"`));
  return m ? m[1] : '';
}
// 「填色按钮」= 没有 secondary / link / icon / provider 这些次要或系统样式类的按钮。
// 表内的提交按钮（邮箱/验证码那两步）不算 —— 那两步是登录流程内部，展开时才可见。
const filled = (seg) => {
  const outsideForms = seg.replace(/<form[\s\S]*?<\/form>/g, '');
  return buttonIds(outsideForms).filter((id) => !/(secondary|link|icon|provider)/.test(classOf(outsideForms, id)));
};

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

// 去掉注释再扫源码：注释里写着「不看 flavor」这类说明，把说明当成违规会误伤
// （src-boundaries.test.js 同样先 stripComments 再判）。
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('App 首屏三段式 —— 六条红线（#532）', () => {
  const shell = read(SHELL);
  const signedOut = section(shell, 'signed-out');
  const packs = section(shell, 'firstrun-packs');

  test('R1 · 未登录首屏只有登录', () => {
    ok(signedOut, '找不到 #signed-out 段 —— 屏 1 的容器没了？');
    eq([...signedOut.matchAll(/className="mode"/g)].length, 0,
      '未登录首屏出现了功能入口（.mode）—— 这一屏只许有登录');
    ok(!/id="gear2"/.test(signedOut), '未登录首屏出现了「设置」入口（gear2）');
    ok(!/id="signed-out-review"/.test(signedOut), '未登录首屏出现了复习入口');
    // 允许的只有**登录这一件事**的元素：Apple / Google / 邮箱那一步，以及邮箱表单
    // 展开后的两步（验证码、密码），它们都是登录流程内部。
    const allowed = new Set(['btn-apple', 'btn-google', 'btn-signin', 'xb-check',
      'send', 'verify', 'resend', 'back', 'app-pw-login', 'app-pw-back', 'app-use-pw']);
    const extra = buttonIds(signedOut).filter((x) => !allowed.has(x));
    deepEq(extra, [], '未登录首屏出现了登录以外的可点元素');
  });

  test('R2 · 屏序可达，且屏 2 无跳过、屏 3 有跳过', () => {
    ok(packs, '找不到 #firstrun-packs 段 —— 屏 2（资源包）还没实现');
    ok(!/(先跳过|稍后再说|先用着|稍后再下|skip)/i.test(packs), '屏 2 出现跳过/稍后一类出口 —— 它是硬门');
    ok(!/id="[^"]*skip/i.test(packs), '屏 2 出现带 skip 的控件 id');
    ok(/id="ob-skip"/.test(shell), '屏 3（引导）没有跳过出口 —— 它是软门，必须能跳');
  });

  test('R3 · 就绪判据 = 引擎 + 识别包 + 朗读包（不含扩展）', () => {
    ok(fs.existsSync(path.join(ROOT, FIRST)), `${FIRST} 还不存在 —— 这一步就是它要红的理由`);
    const src = read(FIRST);
    ok(/export function readyInputs/.test(src), 'firstrun.js 缺 readyInputs()');
    ok(/export function isReady/.test(src), 'firstrun.js 缺 isReady()');
    ok(/export function step/.test(src), 'firstrun.js 缺 step()');
    ok(!/extBanner|EXT_DONE|browserSideOk|extState|extObSeen/.test(stripComments(src)),
      'firstrun.js 读了扩展状态 —— 就绪判据不含扩展（#485 口径）');
    const FR = loadSrc(FIRST, 'FirstRun').FirstRun;
    deepEq(FR.readyInputs().slice().sort(), ['asrPack', 'engine', 'loggedIn', 'ttsPack'].sort(),
      '就绪判据的可观测输入不是那四个');
    let n = 0;
    for (const a of [false, true]) for (const b of [false, true]) for (const c of [false, true]) for (const d of [false, true]) {
      const s = { loggedIn: a, engine: b, asrPack: c, ttsPack: d };
      eq(FR.isReady(s), a && b && c && d, `组合判错：${JSON.stringify(s)}`);
      n++;
    }
    eq(n, 16, '断言的组合数不是 16');
  });

  test('R3b · step() 的判定顺序', () => {
    const FR = loadSrc(FIRST, 'FirstRun').FirstRun;
    const base = { loggedIn: true, engine: true, asrPack: true, ttsPack: true, onboardingSeen: true };
    eq(FR.step({ ...base, loggedIn: false }), 'login', '未登录 ⇒ 屏 1');
    eq(FR.step({ ...base, engine: false }), 'login', '引擎不可解析 ⇒ 回屏 1（不新造一屏）');
    eq(FR.step({ ...base, asrPack: false }), 'packs', '缺识别包 ⇒ 屏 2');
    eq(FR.step({ ...base, ttsPack: false }), 'packs', '缺朗读包 ⇒ 屏 2');
    eq(FR.step({ ...base, onboardingSeen: false }), 'onboarding', '就绪且没看过引导 ⇒ 屏 3');
    eq(FR.step(base), 'home', '全就绪 ⇒ 直进首页');
  });

  test('R3c · 降级只开一个口（该语种不支持识别 ⇒ 只下朗读包）', () => {
    const FR = loadSrc(FIRST, 'FirstRun').FirstRun;
    ok(typeof FR.degradeAllowed === 'function', 'firstrun.js 缺 degradeAllowed(reason)');
    eq(FR.degradeAllowed('asrUnsupported'), true, '该语种不支持识别时应当允许降级');
    for (const r of ['offline', 'cellular', 'noSpace', 'unknown', '']) {
      eq(FR.degradeAllowed(r), false, `「${r}」不该被允许绕过屏 2`);
    }
  });

  test('R4 · 两 flavor 逐条同构（首屏模块不读 flavor）', () => {
    const src = stripComments(read(FIRST));
    ok(!/\bflavor\b/i.test(src), 'firstrun.js 里出现 flavor 分支 —— 两版必须逐条同构');
    ok(!/Registry/.test(src), 'firstrun.js 引了 Registry —— 首屏判定应当是纯函数');
  });

  test('R5 · 旧承诺防复活（App 侧文案）', () => {
    // 两条一起用：
    //  ① 语言无关的那条 —— `app_local_note` 这个键存在的唯一理由就是那句「不登录也能完整
    //     使用」，所以它必须整条消失（12 语种一起）。按**键**判，不看语言，漏不掉。
    //  ② 中/英措辞扫描 —— 防的是「换个键把同一句话写回来」。局限如实写在这里：另 10 个
    //     语种的措辞它认不出来，所以 ① 才是主判据。
    const FORBIDDEN = [/不登[录入]也能完整/, /不登[录入]也能一直用/, /不登[录入]也(?:能|可)用/,
      /without signing in/i, /no account (?:is )?required/i];
    const keys = new Set();
    for (const f of listFiles(path.join(ROOT, 'src', 'app'))) {
      if (!/\.(js|jsx)$/.test(f)) continue;
      for (const m of read(path.relative(ROOT, f)).matchAll(/\b[tT]\('([a-z0-9_]+)'/g)) keys.add(m[1]);
    }
    ok(keys.size > 10, `只从 src/app 收集到 ${keys.size} 个文案键 —— 解析写错了？`);
    const offenders = [];
    const stillHasKey = [];
    for (const loc of fs.readdirSync(path.join(ROOT, 'extension', '_locales'))) {
      const m = JSON.parse(read(`extension/_locales/${loc}/messages.json`));
      if (m.app_local_note) stillHasKey.push(loc);
      for (const k of keys) {
        const v = (m[k] || {}).message || '';
        for (const re of FORBIDDEN) if (re.test(v)) offenders.push(`${loc}/${k}: ${v.slice(0, 50)}`);
      }
    }
    deepEq(stillHasKey, [], 'app_local_note 还在 —— 那个键存在的唯一理由就是「不登录也能完整使用」这句旧承诺');
    deepEq(offenders, [], 'App 侧文案里仍有「不登录也能…」一类旧承诺（该改的是这些键，不是删这句门）');
  });

  test('R1b · 首屏不许被别的 section 占满（Safari 横幅在屏 1/屏 2 让位）', () => {
    // 2026-10-01 模拟器实测抓到：全新安装的第一屏是「Safari 扩展还没打开」那张横幅
    // （三步教程 + 插图占满一屏），登录卡被挤到屏幕外。R1 当时只查了 #signed-out
    // **里面**，所以没拦住 —— 这一条把判据扩到「屏幕上」。
    ok(/const firstRunActive = !currentSession \|\| firstRunScreen === 'packs'/.test(read('src/app/shell-model.js')),
      'paintExtBanner 没有在首屏让位（未登录 / 屏 2 期间）—— 首屏会被那张横幅占满');
  });

  test('R6 · 每屏至多一个填色按钮', () => {
    for (const [id, seg] of [['signed-out', signedOut], ['firstrun-packs', packs]]) {
      if (!seg) continue;
      const f = filled(seg);
      ok(f.length <= 1, `#${id} 有 ${f.length} 个填色按钮（${f.join(', ')}）`);
    }
  });
});
