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
const SETTINGS = 'src/app/settings-view.jsx';
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
    eq(FR.step({ ...base, engine: false }), 'home', '引擎可解析**不参与屏序** —— 包齐 ⇒ 首页（引擎在那里用「设置」修）');
    eq(FR.step({ ...base, engine: false, asrPack: false }), 'packs',
      '引擎不可解析也不许跳过屏 2 的硬门（2026-10-01 模拟器实测的死角：判到屏 1 时实际露出首页，两个包一个没下）');
    eq(FR.step({ ...base, asrPack: false }), 'packs', '缺识别包 ⇒ 屏 2');
    eq(FR.step({ ...base, ttsPack: false }), 'packs', '缺朗读包 ⇒ 屏 2');
    eq(FR.step({ ...base, onboardingSeen: false }), 'home',
      '2026-10-03 裁定：引导屏撤了 —— 就绪就落首页（那不是「跳过」，是这一档没了）');
    eq(FR.step(base), 'home', '全就绪 ⇒ 直进首页');
  });

  test('R2c · 领取额度与首屏判定**并行**：判定前启动、状态行前 await（2026-10-02 改序）', () => {
    // 2026-10-01 原判据：`await autoClaimGrant()` 排在 `await paintFirstRun(session)` 之前 ——
    // 理由是「额度令牌晚一步落地 ⇒ 引擎那格 false」。2026-10-02 真机反馈推翻了那个形状：
    // 那次网络往返把**揭屏**拖住了 1–2 秒，首页当了替身（现象见 R2d）。
    // 而理由本身已经被接走：`step()` 不看引擎（R3b），`isReady()` 全仓没有生产调用方，
    // 首页状态由 `paintEngineStatus()` 在领取落地后重画（test/home-engine.test.js）。
    // 改序后要守的是**两件事**，缺一不可：
    //   ① 领取在判定之前**启动**（不能挪到判定之后 —— 冷启动那一帧里它得跑得到）；
    //   ② 引擎状态行在领取**落地之后**画（否则「登录后仍显示翻译引擎未配置」从另一边回来）。
    const model = stripComments(read('src/app/shell-model.js'));
    const show = model.slice(model.indexOf('async function show('));
    const claim = show.indexOf('autoClaimGrant()');
    const paint = show.indexOf('await paintFirstRun(session)');
    const status = show.indexOf('await paintEngineStatus()');
    ok(claim > -1, 'show() 里找不到 autoClaimGrant() —— 领取不在登录汇合点上了');
    ok(paint > -1 && status > -1, 'show() 里找不到首屏判定或引擎状态行');
    ok(claim < paint, '领取没有排在首屏判定**之前启动** —— 它会挡揭屏，或被冷启动那一帧漏掉');
    ok(paint < status, '引擎状态行排在首屏判定之前 —— 顺序乱了');
    ok(/await claimP\b/.test(show.slice(paint, status)),
      '引擎状态行之前没有 await 领取的落地 —— 令牌晚一步落地，状态会读成「引擎不通」');
  });

  test('R2d · 判定期间不许先露出首页（2026-10-02 真机：登录后先闪一下首页，1–2 秒后才跳屏 2）', () => {
    // 真机现象：登录后第一个画面不是屏 2（资源包），而是**首页**停了 1–2 秒，然后才跳过去。
    // 根因是揭屏顺序 —— 旧代码在判定之前就 `$('signed-in').hidden = !session`（露首页），
    // 判定要等两个设备包探完 + 那次额度领取的网络往返。这一条钉住「判定之前两个内容面都不露」。
    const model = stripComments(read('src/app/shell-model.js'));
    const show = model.slice(model.indexOf('async function show('));
    const paint = show.indexOf('await paintFirstRun(session)');
    ok(paint > -1, 'show() 里找不到 `await paintFirstRun(session)`');
    const before = show.slice(0, paint);
    ok(/\$\('signed-in'\)\.hidden = true/.test(before),
      '首屏判定之前没有把 #signed-in 藏起来 —— 登录后先看到首页，1–2 秒后才跳屏 2');
    ok(!/\$\('signed-in'\)\.hidden = false/.test(before),
      '首屏判定之前就把首页露出来了 —— 那 1–2 秒的替身就是它');
    const after = show.slice(paint);
    ok(/\$\('signed-in'\)\.hidden = false/.test(after),
      '判定完成后没有把首页露出来（非 packs 时）—— 判定完就没人露首页了');
    ok(/firstRunScreen !== 'packs'/.test(after),
      '露首页没有以「判定结果不是 packs」为条件 —— 会把屏 2 盖掉');
  });

  test('R2e · 每次判定都从「还没定」开始（firstRunScreen 先清空）', () => {
    // show() 靠 `firstRunScreen !== 'packs'` 决定判完之后露不露首页。留上一次的 'packs'
    // 会在这次判定失败（元素不在 / 提前 return）时把首页一直藏着 —— 那是「空白一屏」的病。
    const model = stripComments(read('src/app/shell-model.js'));
    const fn = model.slice(model.indexOf('async function paintFirstRun'));
    ok(/firstRunScreen = ''/.test(fn.slice(0, 500)),
      'paintFirstRun 没把 firstRunScreen 清空 —— 上一次的 packs 会让首页一直藏着');
  });

  test('R2g · 包屏语言对必须真的画出来（build 78 回归：两个下拉只剩空框）', () => {
    // 2026-10-04 build 78 实测：`paintFirstRun` 里引用了只在**别的函数**里存在的 `s`
    // （`firstRunLocales(s)`），严格模式下抛 ReferenceError，被外层 `catch (_) {}` 吞掉 ——
    // 控件在、标签与选项全空（用户截图里就剩两个空小方框）。这条把那个形状静态钉住：
    //   ① 默认语言对从 `await readObSettings()` 读（同 R2c 的读法），不许裸传 `s`；
    //   ② 下拉的标签与选项来自 `AppListen.langOptions`（注册表全量、含泰语 —— 用户
    //      2026-10-04「两个下拉框都应该是我们支持的所有语言的列表」），按**当前值**求（keep）；
    //   ③ 两个下拉都拿定好的 `myLang` / `otherLang` 画 —— 空值会让原生 select 显示成空白；
    //   ④ 第二个下拉仍叫「对方的语言」（2026-10-04 用户拍板，不改「目标语言」）；
    //   ⑤ 布局是设计稿里的两个全宽选择器块（`packs-langs` / `packs-lang` / `packs-lang-label`）。
    const model = stripComments(read('src/app/shell-model.js'));
    const fn = model.slice(model.indexOf('async function paintFirstRun'),
                           model.indexOf('async function runFirstRunPacks'));
    ok(fn.length > 200, '切不出 paintFirstRun 的函数体 —— 函数名变了？');
    ok(!/firstRunLocales\(\s*s\s*\)/.test(fn),
      'paintFirstRun 里 firstRunLocales 又传了未声明的 s —— ReferenceError 会被静默吞掉，两个下拉变空框（build 78）');
    // 2026-10-04 晚（#564）：默认语言对**不再**取自 firstRunLocales —— 它是去重集合、没有槽位
    // 之分，用户只设过「对方的=ไทย」时集合是 ['th']，「我的」会被填成泰语（对调）。
    // 改按槽位各算：我的 = getUILanguage；对方的 = targetLang（readObSettings）∥ 一门不同的。
    // （状态行「识别语言包未下载 · {langs}」仍可用 firstRunLocales —— 那是集合语义的正确用法。）
    ok(!/defaults\[0\]/.test(fn) && !/defaults\[1\]/.test(fn),
      'paintFirstRun 又把 firstRunLocales() 的返回当 [我的,对方的] 槽位默认 —— 集合没有槽位之分，会把「对方的」错填进「我的」（#564 对调回归）');
    ok(/getUILanguage\(\)/.test(fn),
      '「我的语言」的默认不是界面语言（getUILanguage）—— 槽位默认各算各的（#564）');
    ok(/targetLang/.test(fn) && /readObSettings\(\)/.test(fn),
      '「对方的语言」的默认没有读 targetLang —— 用户没选过时没有回落');
    ok(/AppListen\.langOptions\(/.test(fn),
      '首启包屏的两个下拉没有用 AppListen.langOptions —— 选项不会含泰语/注册表全量');
    ok(/wire\('packs-my-lang'[^;]*?\bmyLang\)/.test(fn) && /wire\('packs-other-lang'[^;]*?\botherLang\)/.test(fn),
      '两个下拉不是用定好的 myLang/otherLang 画的 —— 空值会让原生 select 显示成空白');
    const shellSrc = read(SHELL);
    for (const id of ['packs-my-lang', 'packs-my-lang-label', 'packs-other-lang', 'packs-other-lang-label']) {
      ok(new RegExp(`id="${id}"`).test(shellSrc), `AppShell 里缺 #${id} —— 下拉/标签被删了`);
    }
    for (const cls of ['packs-langs', 'packs-lang', 'packs-lang-label']) {
      ok(new RegExp(`className="${cls}"`).test(shellSrc),
        `AppShell 里缺 class="${cls}" —— 包屏语言对的全宽堆叠布局（设计稿 h1KZdJ）被改回行内了`);
    }
    ok(/listen_other_lang_label',\s*'对方的语言'/.test(fn),
      '第二个下拉的文案不是「对方的语言」—— 2026-10-04 用户拍板保持该命名');
  });

  test('R2h · 语言对不再对调：默认按槽位算 + 「下载并继续」把当前一对落盘（#564）', () => {
    // 2026-10-04 晚真机（15 Pro / 82）：用户选「我=中文、对方=ไทย」，点下载后跳成「我=ไทย、
    // 对方=English」。两个成因：① 选「默认值」不触发 change ⇒ listenMyLang 一直空；
    // ② 重画把集合 firstRunLocales() 的 ['th'] 当 defaults[0] 填进「我的」。
    // R2g 已钉住 ① 之后的槽位默认；这条钉 ② 之外的另一半 —— 下载时必须把显示的一对落盘，
    // 显示/存储/下载三者锁死，重画不可能再跳。
    const model = stripComments(read('src/app/shell-model.js'));
    const i = model.indexOf('async function runFirstRunPacks');
    ok(i > 0, '找不到 runFirstRunPacks');
    const fn = model.slice(i, model.indexOf('\n  }', i));
    const persist = fn.slice(0, fn.indexOf('paintFirstRun'));   // 必须在重画**之前**落盘
    ok(/listenMyLang:\s*langPair\[0\]/.test(persist) && /listenOtherLang:\s*langPair\[1\]/.test(persist),
      '「下载并继续」没有先把 langPair 落到 listenMyLang/listenOtherLang —— 重画会按「未设置」重算，语言对会跳（#564）');
  });

  test('R2f · 首屏不再给选项；默认「听」；网页翻译入口只在设置页（#547，2026-10-02 用户裁定）', () => {
    const shell = read(SHELL);
    for (const id of ['ob-webonly', 'ob-webonly-text', 'ob-intent-listen', 'ob-intent-both', 'ob-engines']) {
      ok(!new RegExp(`id="${id}"`).test(shell), `AppShell 里还有 #${id} —— 首屏不该再给选项/模型清单`);
    }
    const model = stripComments(read('src/app/shell-model.js'));
    for (const id of ['ob-webonly', 'ob-intent-listen', 'ob-intent-both', 'ob-engines']) {
      ok(!new RegExp(`\\$\\('${id}'\\)`).test(model), `shell-model 还在引 #${id}`);
    }
    ok(/obIntentRecorded[\s\S]{0,80}trackIntent\('listen'\)/.test(model),
      '落首页时没有记默认意图 listen —— 首页的扩展横幅就不会让路');
    ok(!/\.concat\(\['firstuse', 'ext'\]\)/.test(model),
      "OB 里还有 'ext' —— 网页翻译配置引导应只在设置页");
    ok(!/obEngineChips/.test(model), 'obEngineChips 还留着 —— 首屏不再有模型清单');
    ok(/id="webext-setup"/.test(read(SETTINGS)), '设置页没有 #webext-setup —— 网页翻译配置入口不见了');
    ok(/webext-setup'\)\.addEventListener\('click', \(\) => openExternal\(setupPageUrl\(\)\)\)/.test(model),
      '设置页那个入口没接到 setupPageUrl —— 点了不会打开设置页');
  });

  test('R1c · 系统翻译横幅在首页永不出现（2026-10-01 裁定：引导只放设置页）', () => {
    // 原来这条钉的是「屏 1 / 屏 2 在场上时横幅让位」；裁定之后更强：**首页根本不出现**。
    // 设置页那一块（settings-view.jsx 的 #g-systrans）不受影响 —— 判据只针对首页横幅。
    const banner = stripComments(read('app/sys-banner.js'));
    ok(/async function decide\(opts\)/.test(banner), 'sys-banner.js 里找不到 decide()');
    const body = banner.slice(banner.indexOf('async function decide(opts)'));
    ok(/return 'none'/.test(body.slice(0, 600)), "decide() 不再无条件返回 'none' —— 首页横幅会回来");
  });

  test('R3d · 屏 2 的下载：引擎要显式传、系统包要有上限', () => {
    // 2026-10-01 实测两个坑（P2 卡住 15 分钟、无错误、容器里没有 mt-speech）：
    //  ① 只靠 configure() 不把引擎传进 ensureDeviceReady ⇒ deviceStatus 判 device=false ⇒
    //     它以 `{ok:true, skipped:true}` **立刻返回**，看着像成功、其实一个字节都没下；
    //  ② 系统语音包 NativeSpeech.ensureAssets('stt') 只等原生事件、**没有上限** ⇒ 系统那边
    //     不回来就永远挂住（模拟器下不完系统识别包）。
    const model = stripComments(read('src/app/shell-model.js'));
    ok(/ensureDeviceReady\(\s*onProg\s*,\s*DEVICE_TTS_ENGINE\b/.test(model),
      'ensureDeviceReady 没显式传引擎 —— 设置页与听译都传，只靠 configure() 会让它 skipped 返回');
    const i = model.indexOf("ensureAssets('stt'");
    ok(i > -1, "shell-model.js 里找不到 NativeSpeech.ensureAssets('stt'");
    ok(/Promise\.race/.test(model.slice(Math.max(0, i - 700), i + 300)),
      '系统语音包下载没有 Promise.race 上限 —— 原生不回来就永远挂住');
    // ③ 返回值必须看：设置页那条链一直有 `if (!r.ok) … '离线模型下载失败'`，把返回值丢掉就变成
    //    静默失败（容器里没 mt-speech、屏上一句话也没有，然后还接着走下一条）。
    ok(/const r = await LearnTTS\.ensureDeviceReady\(/.test(model),
      'ensureDeviceReady 的返回值没接住 —— 失败会静默');
    ok(/mtTtsFailed/.test(model) && /tts_pack_failed/.test(model),
      'ensureDeviceReady 返回 ok:false 时没有具名失败（该用设置页同一条 tts_pack_failed）');
    // ④ 两个设备包按**设备引擎**探与下（2026-10-01 裁定：实时字幕/听译要用它 ⇒ 必选），
    //    不看当前默认选的是哪个引擎 —— 否则「登录即领额度」把 TTS 引擎写成 grant_speech 之后，
    //    deviceStatus 判 not_device、下载 skipped，而硬门仍要求设备包 ⇒ 屏 2 永远过不去。
    ok(/deviceStatus\(\s*DEVICE_TTS_ENGINE\b/.test(model),
      'probePacks 没把探测钉在设备引擎上 —— 额度到账后设备包会被判「不适用」，硬门永远过不去');
    // ⑤ 进度要画在那一行上（硬门 + 国内先失败再换备用 ⇒ 那几分钟不能静默）
    ok(/tts_pack_downloading/.test(model) && /tts_pack_fallback/.test(model),
      '朗读包下载没把进度/换地址画到行上 —— 硬门下用户只能看着「正在下载…」等');
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

  test('R2b · 出场顺序：冷启动先进屏 1（登录）；引导屏已撤（2026-10-03）', () => {
    // 2026-10-01 Release 实测抓到：全新安装出来的是**引导欢迎屏**，不是屏 1 ——
    // 启动路径里有一段「首次运行且未登录 ⇒ 直接显示 #onboard 并 return」的老捷径。
    // R2 只查了「段存在 / 屏 2 无跳过 / 屏 3 有跳过」，**没查顺序**，所以它漏了。
    //
    // 2026-10-03（用户裁定）：那一屏**整个撤了** —— 它只剩「开始设置 / 以后再设置」两个键、
    // 下面没有任何可设的东西（引擎随登录到账、两个包刚下完），登录屏那一版还会再问一次
    // 「登录，顺手领一份免费额度」+「扩展里也要登录一次」（用户已经登录过了）。
    // 所以这条现在的判据是：**谁都不许把 firstRunScreen 置成 onboarding、也不许开 #onboard**。
    const model = read('src/app/shell-model.js');
    ok(!/if \(!session && !seen && !obResume\)/.test(model),
      '启动路径里还有「首次运行未登录 ⇒ 直接显示引导」的老捷径 —— 屏 3 会抢在屏 1 前面');
    ok(!/firstRunScreen = 'onboarding'/.test(model),
      '还有一处把 firstRunScreen 置成 onboarding —— 引导屏应当已经撤了');
    ok(!/\$\('onboard'\)\.hidden = false/.test(model),
      '还有一处在开 #onboard —— 引导屏应当已经撤了');
  });

  test('R6 · 每屏至多一个填色按钮', () => {
    for (const [id, seg] of [['signed-out', signedOut], ['firstrun-packs', packs]]) {
      if (!seg) continue;
      const f = filled(seg);
      ok(f.length <= 1, `#${id} 有 ${f.length} 个填色按钮（${f.join(', ')}）`);
    }
  });

  // R7（2026-10-03 实测加）：降级的判据词表**必须与它真正读到的那一层一致**。
  //
  // 背景：`firstrun.js` 只允许一种绕过屏 2 的情形 —— 「这台设备的识别器不支持这个语种」
  // （「只下朗读包，继续」）。这条判据跨**三层**、词表各不同：
  //   桥 `app/native/speech-bridge.swift` 发 `stt-state {state:'unsupported', reason:'locale'|'os'}`
  //   → 包装器 `app/native-speech.js` 吃掉 state，规范化成 `{ok:false, reason, assets, locales}`
  //   → `shell-model.js` 只能读 `{ok, reason}`。
  // 当时的实现读 `r.reason === 'unsupported'`：桥不发、包装器也不给 ⇒ 恒 false，
  // 这条降级**一次都没触发过**（模拟器与「语种不支持」的设备永远卡在屏 2）。
  // 判据盯**三层各自的词表**，任何一层换词、或实现读错层，都会红。
  test('R7 · 降级判据读的是它真正拿到的那一层（不支持这个语种必须能触发）', () => {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const model = strip(fs.readFileSync(path.join(ROOT, 'src/app/shell-model.js'), 'utf8'));
    const wrap = strip(fs.readFileSync(path.join(ROOT, 'app/native-speech.js'), 'utf8'));
    const bridge = strip(fs.readFileSync(path.join(ROOT, 'app/native/speech-bridge.swift'), 'utf8'));
    // 第一层：桥发 state + reason
    ok(/state": "unsupported"/.test(bridge) && /reason": "locale"/.test(bridge),
      '桥的词表变了（不再发 state:"unsupported" / reason:"locale"）—— 下面两层要跟着改');
    // 第二层：包装器把它规范化成 {ok:false, reason}
    ok(/ok: false, reason: msg\.reason/.test(wrap),
      '包装器不再把 state:"unsupported" 规范化成 {ok:false, reason} —— 判据要跟着改');
    // 第三层：实现只能读 {ok, reason}，且必须认 'locale'
    ok(/r\.ok === false && r\.reason === 'locale'/.test(model),
      "probePacks 没有按 {ok:false, reason:'locale'} 判降级 —— 这条路径会永远不触发（2026-10-03 真踩）");
    ok(!/reason === 'unsupported'/.test(model),
      "probePacks 在读 reason === 'unsupported' —— 桥与包装器都不发这个值");
    ok(!/r\.state === 'unsupported'/.test(model),
      'probePacks 在读 r.state —— 包装器把 state 吃掉了，这里读不到');
  });
});
