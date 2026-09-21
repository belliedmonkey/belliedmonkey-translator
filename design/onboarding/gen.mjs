// 新手引导 · 屏序重排（登录前置）· 画布生成器（2026-09-22）。
// 改画布 = 改这个文件再 `node gen.mjs`。形状同 design/system-translate/gen.mjs。
// 发布：Artifact publish url=<画布> root=design/onboarding file_path=project/canvas.json files=project/*
//
// 这一稿由 2026-09-21/22 的线上读数驱动（口径：只从 2026-09-05 起收 · 中国版一条不发 ·
// 我们自己的机器也在里面 · install_id 按宿主分）：
//   · 247 台 App 装机里 **176 台（71%）整个生命周期不到 5 分钟**，223 台首末同一天
//     ⇒ 没有第二次会话，这几屏是唯一的机会
//   · 清洁样本（1.13.1/1.14.0 两个埋点都在的版本，45 台）：登录过 29% · **有引擎只有 13%**
//     · 在 App 里开始过听译 24%（其中一多半手里没引擎）· 撞「设备不支持」20%
//   · 全量：54 台登录并同步过，**其中 47 台既没配引擎也没领额度**
//   · 免费额度是**账号级**的（服务端以 user_id 为主键，一人一枚，退登清掉再登自动领回）
// 用户 2026-09-22 两条裁定：① 登录从第 5 屏提到第 2 屏 ② 登录之后**自动**领额度、不再问。
//
// ⚠️ 旧的五块手写板（Main/Home/EnableMac/SiteIcon/ApiSetup，2026-08）画的是更早的一版
// 引导（选语言 → 选站点 → 启用扩展），与今天的 5 屏对不上。它们**原样保留在第 3 页**
// 当历史备查，这个生成器一个字节都不改它们，只在索引里给它们排位置。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'project');
const W = {}, META = {};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const css = () => fs.readFileSync(path.join(HERE, '..', 'settings-ia', 'project', 'ui.css'), 'utf8') + `
/* ── 本画布追加 ─────────────────────────────────────────────── */
.cap{display:flex;flex-direction:column;gap:2px}
.cap b{font-size:.95rem}.cap span{font-size:.8rem;color:var(--muted);line-height:1.45}
.cell{display:flex;flex-direction:column;gap:10px;min-width:0}
.ico{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.tl{display:flex;align-items:flex-start;gap:10px}
.tl .arr{align-self:center;color:var(--muted);font-size:1.3rem}
.scr{width:252px;flex:none;display:flex;flex-direction:column;gap:6px}
.scr .no{font-size:.72rem;font-weight:700;letter-spacing:.04em;color:var(--muted)}
.ph{width:252px;min-height:300px;background:var(--bg);border:1px solid var(--border);border-radius:22px;
    padding:14px;box-sizing:border-box;display:flex;flex-direction:column;gap:9px}
.ph h4{margin:0;font-size:.92rem;line-height:1.35}
.ph p{margin:0;font-size:.78rem;line-height:1.5;color:var(--muted)}
.ph .btn{font-size:.78rem;min-height:34px}
.ph .steps{margin:0;padding-left:16px;font-size:.74rem;line-height:1.55;color:var(--muted)}
.tag{display:inline-block;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:999px}
.tag.keep{background:var(--tint);color:var(--sage)}
.tag.move{background:#e4ecf7;color:#1f4a7a}
.tag.new{background:var(--tip-bg);color:var(--tip-tx)}
.tag.down{background:var(--warn-bg);color:var(--warn-tx)}
.tag.cut{background:#f3dede;color:#8c2f2f}
.why{font-size:.75rem;line-height:1.5;color:var(--muted)}
.why b{color:var(--text)}
.num{display:flex;gap:12px;flex-wrap:wrap}
.stat{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:9px 11px;min-width:112px}
.stat b{display:block;font-size:1.35rem;line-height:1.2}
.stat span{font-size:.73rem;color:var(--muted);line-height:1.4;display:block}
.stat.bad b{color:var(--danger)}.stat.good b{color:var(--sage)}
.ask{background:var(--tip-bg);border:1px solid var(--tip-bd);color:var(--tip-tx);border-radius:13px;padding:10px 12px;font-size:.82rem;line-height:1.55}
.ask b{display:block;margin-bottom:3px}
.qs{display:flex;flex-direction:column;gap:5px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:9px 10px}
.qs .row{display:flex;justify-content:space-between;font-size:.76rem}
.qs .row .ok{color:var(--sage);font-weight:600}
.qs .row .run{color:var(--muted)}
.cn{border:2px dashed var(--accent);border-radius:20px;padding:5px}
`;

const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  ear: '<path d="M8 20a3 3 0 0 0 3-3v-2a5 5 0 1 1 5-5"/><path d="M12 10a2 2 0 1 1 4 0c0 2-2 2-2 4"/>',
};
const ic = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const head = (t, sub = '') => `<div class="frame-h"><div class="cap"><h1 style="margin:0;font-size:1.25rem">${t}</h1>${sub ? `<span>${sub}</span>` : ''}</div></div>`;
const cap = (b, s = '') => `<div class="cap"><b>${b}</b>${s ? `<span>${s}</span>` : ''}</div>`;
const cell = (b, s, inner) => `<div class="cell">${cap(b, s)}${inner}</div>`;
const btn = (t, kind = 'p') => `<button class="btn ${kind}" type="button">${t}</button>`;
const hint = (t) => `<p class="hint">${t}</p>`;
const grid = (n, inner, gap = 20) => `<div style="display:grid;grid-template-columns:repeat(${n},minmax(0,1fr));gap:${gap}px;align-items:start">${inner}</div>`;
const stat = (n, l, c = '') => `<div class="stat${c ? ' ' + c : ''}"><b>${n}</b><span>${l}</span></div>`;
const ask = (q, b) => `<div class="ask"><b>${q}</b>${b}</div>`;
const ph = (inner) => `<div class="ph">${inner}</div>`;
const scr = (no, tag, inner, why = '') =>
  `<div class="scr"><span class="no">${no}</span>${tag}${ph(inner)}${why ? `<p class="why">${why}</p>` : ''}</div>`;

function board(file, w, h, title, inner, { pad = 24, page = 'p1', gap = 18 } = {}) {
  W[file] = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <script src="./support.js"></script>
  <link rel="stylesheet" href="./ui.css">
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin:0; background:#f5ead8; }
    a { color:#8c491a; } a:hover { color:#643312; }
  </style>
</helmet>
<div class="page" style="width:${w}px; height:${h}px; padding:${pad}px; display:flex; flex-direction:column; gap:${gap}px">
${inner}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;
  META[file] = { w, h, page, title };
}

const STEPS = `<ol class="steps"><li>打开「设置」App</li><li>Safari › 扩展</li><li>打开「大肚猴翻译」，并允许它访问网页</li></ol>`;
const selfTest = (state) => {
  const row = (k, v, cls) => `<div class="row"><span>${k}</span><span class="${cls}">${v}</span></div>`;
  return `<div class="qs">${state === 'run'
    ? row('翻译', '测试中…', 'run') + row('解析', '测试中…', 'run') + row('朗读', '测试中…', 'run')
    : row('翻译', '✓ 通了 · 512 ms', 'ok') + row('解析', '✓ 跟随翻译', 'ok') + row('朗读', '✓ 通了', 'ok')}</div>`;
};

// ── 第 1 页 · 屏序对照 ────────────────────────────────────────────────────
board('Order.dc.html', 2560, 1020, '屏序：现在 5 屏 vs 提议 4 屏（逐屏对齐）', `
${head('把登录提到第 2 屏，删掉「填 Key」那屏，扩展降级到最后', '因为没有第二次会话：176/247 台整个生命周期不到 5 分钟')}

<div><span class="tag down">现在</span>
<div class="tl" style="margin-top:8px">
  ${scr('第 1 屏', '', `<h4>读你真正在读的东西</h4><p>翻译在浏览器里，复习在这个 App 里。</p>${btn('开始', 'p')}`)}
  <span class="arr">→</span>
  ${scr('第 2 屏', '', `<h4>先把浏览器那半边打通</h4>${STEPS}${btn('在 Safari 里打开扩展 →', 'p')}`,
    '把人送出 App。而送出去就不回来 —— 18 台点过「我已打开」的里 16 台点完再没有任何事件。')}
  <span class="arr">→</span>
  ${scr('第 3 屏', '', `<h4>还有两件事在浏览器里做</h4><p>① 填翻译 Key<br>② 打开采集</p>${btn('去浏览器 →', 'p')}`,
    '<b>这正是 83% 卡住的那一步</b>，而它的零摩擦替代（登录领额度）被排在第 5 屏。')}
  <span class="arr">→</span>
  ${scr('第 4 屏', '', `<h4>去读一篇</h4><p>随便打开一个网页，点「译」。</p>${btn('好', 'p')}`)}
  <span class="arr">→</span>
  ${scr('第 5 屏', '', `<h4>最后一步：登录</h4><p>登录同一个账号，卡片会同步到这台设备。</p>${btn('用 Apple 登录', 'p')}`,
    '<b>转化最高的一步被放在最后。</b>登录 29% vs 配引擎 13%；而登录 = 账号级额度 = 引擎就绪。')}
</div></div>

<div style="margin-top:6px"><span class="tag new">提议</span>
<div class="tl" style="margin-top:8px">
  ${scr('第 1 屏', '<span class="tag keep">改写</span>',
    `<h4>读你真正在读的东西</h4><p>划词翻译、听一段、看实时字幕 —— 这些<b>在这个 App 里就能用</b>；网页翻译在浏览器那半边。</p>${btn('开始', 'p')}`,
    '不再一上来就讲分工，先说<b>这个 App 自己能做什么</b> —— 24% 的人本来就会自己去找听译。')}
  <span class="arr">→</span>
  ${scr('第 2 屏', '<span class="tag move">从第 5 屏提上来</span>',
    `<h4>登录，顺手领一份免费额度</h4><p>额度由我们出，够先用一阵；也可以用你自己的 key。</p>${btn('用 Apple 登录', 'p')}${btn('先不登录，我自己填 key', 's')}`,
    '登录 = 额度 = 引擎就绪，<b>顺带把扩展那边也备好</b>（额度是账号级的）。')}
  <span class="arr">→</span>
  ${scr('第 3 屏', '<span class="tag new">新增</span>',
    `<h4>现在就试一句</h4>${selfTest('ok')}<p>引擎好了。挑一段字翻翻看，或者听一句。</p>${btn('试翻一段', 'p')}${btn('听一句', 's')}`,
    '让第一次会话<b>有产出</b>。现在这 5 屏里没有任何一屏让人在 App 里用上一件事。')}
  <span class="arr">→</span>
  ${scr('第 4 屏', '<span class="tag down">降级</span>',
    `<h4>想翻网页的时候</h4><p>浏览器那半边要单独打开一次。不急，随时可以回来。</p>${btn('打开检测页看一眼 →', 's')}${btn('以后再说', 's')}`,
    '从「必经的第 2 屏」降成「最后一屏的次要按钮」—— 它是唯一会把人送出 App 的动作。')}
  <span class="arr">→</span>
  ${scr('～～', '<span class="tag cut">删</span>',
    `<h4 style="opacity:.45;text-decoration:line-through">还有两件事在浏览器里做</h4><p style="opacity:.55">填翻译 Key —— 登录之后不需要了；只在「先不登录」那一支出现。</p>`,
    '采集默认就是开的，不必占一屏说。')}
</div></div>
`);

// ── 第 2 页 · 新屏的样子 ──────────────────────────────────────────────────
board('Signin.dc.html', 1560, 880, '新的第 2 屏：登录 + 自动领额度', `
${head('登录之后不再问「要不要领取」—— 直接到位，并就地自检', '现状：54 台登录并同步过，其中 47 台手里什么都没有')}
${grid(3, `
  ${cell('① 登录屏', '两个出口都给足',
    ph(`<h4>登录，顺手领一份免费额度</h4><p>额度由我们出，够先用一阵；也可以用你自己的 key。<br>登录还能把卡片同步到你的其它设备。</p>${btn('用 Apple 登录', 'p')}${btn('用邮箱验证码', 's')}${btn('先不登录，我自己填 key', 's')}`))}
  ${cell('② 登录成功的那一刻', '自动领 + 三行自检，不再多一步',
    ph(`<h4>正在准备…</h4>${selfTest('run')}<p>正在把免费额度装上。</p>`) +
    hint('三行在按下那一刻就存在，不是成功后才冒出来的绿框 —— 沿用一键卡那个形状。'))}
  ${cell('③ 好了', '这一屏就是「配好了」的回执',
    ph(`<h4>${ic('check')} 可以用了</h4>${selfTest('ok')}<p>翻译、朗读、听译现在都能用了。</p>${btn('现在就试一句 →', 'p')}`))}
`)}
${grid(2, `
  ${cell('失败态：领不到额度', '不能停在「正在准备…」',
    ph(`<h4>${ic('alert')} 额度暂时领不到</h4><p>可能是网络，也可能是今天的名额用完了。你仍然可以填自己的 key，或者稍后再来。</p>${btn('填我自己的 key', 'p')}${btn('稍后再说', 's')}`))}
  ${cell('中国版变体', '那边没有免费额度，这一屏说的是另一件事',
    `<div class="cn">${ph(`<h4>登录（可选）</h4><p>登录只用来把卡片同步到你的其它设备。翻译引擎需要你自己填一把 key。</p>${btn('填 key', 'p')}${btn('用 Apple 登录', 's')}${btn('跳过', 's')}`)}</div>` +
    hint('中国版构建里免费额度<b>不存在</b>（不是关着）。所以这一支的主按钮是「填 key」，登录降为次要 —— 屏序仍然是提前的，只是载荷不同。'))}
`)}
`, { page: 'p2' });

board('FirstUse.dc.html', 1560, 820, '新的第 3 屏：就地用上一件 · 与第 4 屏的降级', `
${head('第一次会话必须有产出，而扩展那件事排到最后', '24% 的人自己会去找听译，其中一多半手里没引擎')}
${grid(3, `
  ${cell('第 3 屏 · 两个入口', '选一个就行，不选也能走',
    ph(`<h4>现在就试一句</h4><p>挑一段字翻翻看，或者听一句 —— 都在这个 App 里，不用去别处。</p>${btn('试翻一段', 'p')}${btn('${ear}听一句'.replace('${ear}', ic('ear')), 's')}${btn('先跳过', 's')}`))}
  ${cell('降级：这台设备不支持听译', 'iOS 26 / macOS 26 以下',
    ph(`<h4>现在就试一句</h4><p>挑一段字翻翻看。<br><span style="opacity:.6">听译与实时字幕需要 iOS 26 / macOS 26，这台设备用不了。</span></p>${btn('试翻一段', 'p')}${btn('先跳过', 's')}`)) +
    hint('清洁样本里 <b>20% 撞在这道门上</b>。不该因为设备老就把整屏堵死 —— 划词翻译、文档、Mac 快译仍然能用。')}
  ${cell('第 4 屏 · 扩展降级', '不再教三步，也不再是必经',
    ph(`<h4>想翻网页的时候</h4><p>浏览器那半边要单独打开一次。不急 —— 随时可以从首页回到这里。</p>${btn('打开检测页看一眼 →', 's')}${btn('以后再说', 's')}`)) +
    hint('三步教程搬到检测页上，那一页自己能验（绿灯是机器判的，不是人自称的）。')}
`)}
${ask('这一页还开着三个小问题', '① 第 3 屏「试翻一段」用什么素材 —— 内置一小段示例文字，还是让用户自己粘？（我倾向内置，粘贴又是一道摩擦）<br>② 「先跳过」要不要在第 3 屏出现 —— 给了它，多数人会点；不给，又成了强制。我倾向给，但排在最下面。<br>③ 引导现在<b>跳过也算看过、永不再来</b>；屏序改完之后，「跳过」是不是该只记「这一屏跳过」而不是整条引导？')}
`, { page: 'p2' });

board('ExtHandoff.dc.html', 1800, 860, '扩展那边怎么接上：不是「把登录态带过去」，是扩展自己登', `
${head('用户问：跳转扩展时能不能顺便把登录态和额度带过去', '答案：登录态不能带（规约红线），额度不用带（账号级自己就有）')}
${grid(2, `
  ${cell('❌ 直觉里的做法：App 把东西推过去', '这条走不通',
    `<div class="flow" style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="node now" style="flex:1;min-width:150px;background:var(--card);border:1px solid var(--danger);border-radius:13px;padding:9px 11px;font-size:.8rem;line-height:1.5"><b>App</b>把会话 / 额度令牌塞进跳转地址</div>
      <div class="node now" style="flex:1;min-width:150px;background:var(--card);border:1px solid var(--danger);border-radius:13px;padding:9px 11px;font-size:.8rem;line-height:1.5"><b>扩展</b>取走、直接用</div>
    </div>
    ${hint('<b>被 §8.4.1.1 明文挡住</b>（2026-09-02 裁定）：那条通道「只能传身份，<b>不能传任何语料、任何凭证</b>」。会话与额度令牌都是凭证，而且<b>单独就能兑换</b>（拿到就能花钱）。')}
    ${hint('就算改成「一次性票」也不行：票之所以被放宽，是因为<b>它单独不可兑换</b> —— 兑换要 code_verifier，而 verifier 只在扩展侧。<b>App 生成的票没有扩展侧的 verifier</b>，性质当场破掉。')}`)}
  ${cell('✅ 能走的做法：扩展自己发起一次登录', '这条路已经上线，不是新设计',
    `<div style="display:flex;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;background:var(--card);border:1px solid var(--sage);border-radius:13px;padding:9px 11px;font-size:.8rem;line-height:1.5"><b>扩展</b>生成 verifier，开登录页</div>
      <div style="flex:1;min-width:140px;background:var(--card);border:1px solid var(--sage);border-radius:13px;padding:9px 11px;font-size:.8rem;line-height:1.5"><b>网页回调</b>带一次性 code</div>
      <div style="flex:1;min-width:140px;background:var(--card);border:1px solid var(--sage);border-radius:13px;padding:9px 11px;font-size:.8rem;line-height:1.5"><b>扩展</b>用自己的 verifier 兑换</div>
    </div>
    ${hint('体感上接近「带过去」：App 的 Apple 登录走 <code>ASWebAuthenticationSession</code>，<b>与 Safari 共享 cookie</b> —— 在 App 里登过之后，扩展这次「用 Apple 登录」在 Safari 里基本是<b>一键，不用再输任何东西</b>。')}
    ${hint('<b>额度不用管</b>：登上同一个账号，<code>claim()</code> 自己把三个槽配好。扩展那边现在就是这个形状（34 台登录 / 30 台配好）。')}`)}
`)}
${ask('时序：这件事不可能发生在「跳转的那一刻」', '引导最后一屏跳转时，<b>扩展通常还没启用</b> —— 没有进程能接收任何东西。真实时序只能是：<br><b>启用扩展 → 扩展第一次打开设置页 / 检测页 → 那时一键登录 → 额度自动到位。</b><br>所以那个「把这台浏览器也登上」的按钮该放在<b>检测页</b>上，而不是 App 的跳转里。检测页本来就是扩展有内容脚本在跑的自家域名。')}
`, { page: 'p2' });

board('Why.dc.html', 1560, 760, '为什么这么改：这一轮的读数', `
${head('口径三条先说', '只从 2026-09-05 起收 · 中国版一条不发 · 我们自己的机器也在里面 · install_id 按宿主分')}
${grid(2, `
  ${cell('没有第二次会话', 'App 全量 247 台',
    `<div class="num">${stat('176 / 247', '整个生命周期不到 5 分钟', 'bad')}${stat('223', '首末事件在同一天', 'bad')}${stat('14', '跨过一天的装机', 'bad')}</div>
     ${hint('所以这几屏是<b>唯一</b>的机会。任何「下次打开再说」的设计都到不了人 —— 这一点在横幅那条线上已经被证伪过一次。')}`)}
  ${cell('登录比配引擎容易一倍多', '清洁样本 45 台（两个埋点都在的版本）',
    `<div class="num">${stat('29%', '登录过', 'good')}${stat('13%', '有引擎', 'bad')}${stat('24%', '开始过听译')}${stat('20%', '撞设备不支持')}</div>
     ${hint('全量更刺眼：<b>54 台登录并同步过，其中 47 台既没配引擎也没领额度</b> —— 我们让他们登了，却没顺手把额度给他们。')}`)}
`)}
${hint('<b>额度是账号级的</b>：服务端以 user_id 为主键、一人一枚，退出登录清掉、再登录自动领回。所以「登录」这一步不只解锁 App 自己那几个面，<b>顺带把扩展那边的引擎也备好了</b> —— 扩展里登录同一个账号，三个槽自己长出来（那边登录 34 台、配好 30 台，本来就是这个形状）。')}
${ask('两条已裁定（2026-09-22）', '① 登录从第 5 屏<b>提到第 2 屏</b>　② 登录之后<b>自动</b>领额度、不再问<br><br>②动的是额度发放规则 ⇒ 按 AGENTS.md 属领域设计改动，<b>要先出 docs PR 过评审</b>，代码不先走。')}
`, { page: 'p2' });

// ─── 输出 ────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.dc.html') && !W[f]) fs.unlinkSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'ui.css'), css());
for (const [name, html] of Object.entries(W)) fs.writeFileSync(path.join(OUT, name), html);

// 旧的五块手写板留在第 3 页（文件在 design/onboarding/ 根上，不在 project/）。
const OLD = [
  ['Main.dc.html', 390, 844, '旧稿 · 引导流程（可点）'],
  ['Home.dc.html', 390, 844, '旧稿 · 首页 · 未登录'],
  ['EnableMac.dc.html', 560, 360, '旧稿 · macOS 变体'],
  ['SiteIcon.dc.html', 140, 120, '旧稿 · 站点图标'],
  ['ApiSetup.dc.html', 900, 900, '旧稿 · 配置引擎 · 完整案例'],
];
for (const [f, w, h, t] of OLD) {
  const src = path.join(HERE, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
  META[f] = { w, h, page: 'p3', title: t };
}

const PAGES = [['p1', '① 屏序：现在 vs 提议'], ['p2', '② 新屏的样子'], ['p3', '③ 旧稿（2026-08，已过时）']];
const ROW_W = 3800, GAP_X = 80, GAP_Y = 160;
const boards = {}, order = [];
for (const [pid] of PAGES) {
  let x = 0, y = 0, rowH = 0;
  for (const [file, m] of Object.entries(META)) {
    if (m.page !== pid) continue;
    if (x > 0 && x + m.w > ROW_W) { x = 0; y += rowH + GAP_Y; rowH = 0; }
    boards[file] = { x, y, w: m.w, h: m.h, page: pid, title: m.title };
    order.push(file); x += m.w + GAP_X; rowH = Math.max(rowH, m.h);
  }
}
const idx = {
  v: 3, createdOnFiles: { v: 1, at: '2026-09-22T02:00:00Z' },
  title: '新手引导 · 屏序重排（登录前置）',
  launch: { view: 'canvas', page: 'p1' },
  pages: PAGES.map(([id, name]) => ({ id, name })),
  boards, order, notes: {}, designSystems: [],
};
idx.notes.t1 = { x: 0, y: -320, w: 240, text: '屏序：登录提到第 2 屏，「填 Key」那屏删掉', kind: 'title1', maxW: 3600, page: 'p1' };
idx.notes.t2 = { x: 0, y: -320, w: 240, text: '新屏的样子 —— 文案是准文案，可以直接挑字', kind: 'title1', maxW: 3600, page: 'p2' };
idx.notes.t3 = { x: 0, y: -320, w: 240, text: '旧稿（2026-08）· 画的是更早那一版引导，与今天对不上，仅备查', kind: 'title1', maxW: 3600, page: 'p3' };
const NX = ROW_W + 160;
idx.notes.ruling = { x: NX, y: 0, w: 540, maxH: 420, page: 'p1', color: 'green',
  text: '已裁定（2026-09-22）：\n① 登录从第 5 屏提到第 2 屏\n② 登录之后自动领额度、不再问\n\n②动的是额度发放规则 ⇒ 按 AGENTS.md 属领域设计改动，要先出 docs PR 过评审，代码不先走。' };
idx.notes.open = { x: NX, y: 520, w: 540, maxH: 460, page: 'p1', color: 'blue',
  text: '还开着的，要你回：\n\n① 第 3 屏「试翻一段」用什么素材 —— 内置一小段示例，还是让用户粘？（我倾向内置）\n② 第 3 屏要不要「先跳过」（我倾向给，但排最下面）\n③ 引导现在跳过也算看过、永不再来 —— 改完之后「跳过」是不是该只记这一屏？\n④ 中国版那一支（没有额度，主按钮变「填 key」）认不认？' };

fs.writeFileSync(path.join(OUT, 'canvas.json'), JSON.stringify(idx, null, 2) + '\n');
console.log('✓ design/onboarding/project：' + order.length + ' 块板（新 ' + Object.keys(W).length + ' · 旧 ' + OLD.length + '）');
