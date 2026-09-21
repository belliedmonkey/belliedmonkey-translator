// 「装了 App 却没打开 Safari 扩展」· 交互稿 · 画布生成器（2026-09-21，issue #384）。
// 改画布 = 改这个文件再 `node gen.mjs`。形状同 design/system-translate/gen.mjs。
// 发布：Artifact publish url=<画布> root=design/ext-banner file_path=project/canvas.json files=project/*
//
// 这张稿由**线上读数**驱动，不是由「觉得文案不够有说服力」驱动。2026-09-21 回读 bt_events：
//   · App 装机 237 台，155 台看过横幅，36 台点「去打开」，31 台点「我已打开」（20%）
//   · **104 台只看过横幅 1 次** —— 多数人只启动过一次 App
//   · 旁证：safari 扩展装机 120 台 ≈ App 装机的一半
// 口径：遥测只从 2026-09-05 起收 · 中国版一条不发 · 我们自己的机器也在里面 ·
// install_id 按宿主分（App 与扩展是两条独立记录，不是同一个人的同一条）。
//
// 别的产品名不进任何一块板（AGENTS.md 规约）。图标一律内联描线 SVG，不用 emoji。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'project');
const W = {}, META = {};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 令牌沿用设置重设计那张画布（build/palette.config.js 解析后的 hex），只追加本画布的件。
const css = () => fs.readFileSync(path.join(HERE, '..', 'settings-ia', 'project', 'ui.css'), 'utf8') + `
/* ── 本画布追加 ─────────────────────────────────────────────── */
.cap{display:flex;flex-direction:column;gap:2px}
.cap b{font-size:.95rem}.cap span{font-size:.8rem;color:var(--muted);line-height:1.45}
.cell{display:flex;flex-direction:column;gap:10px;min-width:0}
.ico{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.phoneframe{width:330px;background:var(--bg);border:1px solid var(--border);border-radius:26px;padding:14px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}
.ban{background:var(--warn-bg);border:1px solid var(--warn-bd);border-radius:16px;padding:12px 13px;display:flex;flex-direction:column;gap:9px}
.ban h4{margin:0;font-size:.95rem}
.ban p{margin:0;font-size:.84rem;line-height:1.55;color:var(--muted)}
.steps{margin:0;padding-left:18px;font-size:.83rem;line-height:1.6;color:var(--muted)}
.steps li{margin:1px 0}
.num{display:flex;gap:14px;flex-wrap:wrap}
.stat{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:10px 12px;min-width:126px}
.stat b{display:block;font-size:1.5rem;line-height:1.2}
.stat span{font-size:.76rem;color:var(--muted);line-height:1.4;display:block}
.stat.bad b{color:var(--danger)}
.stat.good b{color:var(--sage)}
.flow{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}
.node{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:9px 11px;font-size:.83rem;line-height:1.5;min-width:132px;flex:1}
.node b{display:block;font-size:.86rem;margin-bottom:2px}
.node.now{border-color:var(--danger)}
.node.new{border-color:var(--sage)}
.arr{align-self:center;color:var(--muted);font-size:1.1rem}
.tbl{width:100%;border-collapse:collapse;font-size:.82rem}
.tbl th,.tbl td{border-bottom:1px solid var(--rule);padding:7px 8px;text-align:left;vertical-align:top;line-height:1.5}
.tbl th{font-size:.76rem;color:var(--muted);font-weight:700}
.tbl td.no{color:var(--danger)}.tbl td.yes{color:var(--sage)}
.code{font-family:ui-monospace,Menlo,monospace;font-size:.76rem;color:var(--muted)}
.ask{background:var(--tip-bg);border:1px solid var(--tip-bd);color:var(--tip-tx);border-radius:13px;padding:10px 12px;font-size:.83rem;line-height:1.55}
.ask b{display:block;margin-bottom:3px}
/* 时间线：一行若干个小手机 + 箭头，用来说「从什么样子变成什么样子」 */
.tl{display:flex;align-items:flex-start;gap:8px}
.tl .arr{align-self:center;color:var(--muted);font-size:1.3rem;padding:0 2px}
.step{display:flex;flex-direction:column;gap:6px;width:264px;flex:none}
.step .day{font-size:.74rem;font-weight:700;letter-spacing:.04em;color:var(--muted)}
.step .why{font-size:.78rem;line-height:1.45;color:var(--muted)}
.ph-sm{width:264px;background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:10px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;min-height:150px}
.ph-sm .ban{padding:9px 10px;gap:6px;border-radius:12px}
.ph-sm .ban h4{font-size:.84rem}
.ph-sm .ban p{font-size:.76rem}
.ph-sm .btn{font-size:.78rem;min-height:34px}
.homeline{height:8px;border-radius:999px;background:var(--rule)}
.homeline.w2{width:60%}.homeline.w3{width:80%}
.empty{display:flex;flex-direction:column;gap:7px;padding:6px 2px}
.tag-now{display:inline-block;font-size:.72rem;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--warn-bg);color:var(--warn-tx)}
.tag-new{display:inline-block;font-size:.72rem;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--tint);color:var(--sage)}
.diff{border:2px dashed var(--sage);border-radius:22px;padding:6px}
`;

const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
};
const ic = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const head = (t, sub = '') => `<div class="frame-h"><div class="cap"><h1 style="margin:0;font-size:1.25rem">${t}</h1>${sub ? `<span>${sub}</span>` : ''}</div></div>`;
const cap = (b, s = '') => `<div class="cap"><b>${b}</b>${s ? `<span>${s}</span>` : ''}</div>`;
const cell = (b, s, inner) => `<div class="cell">${cap(b, s)}${inner}</div>`;
const card = (title, body) => `<section class="card"><h3>${title}</h3>${body}</section>`;
const btn = (t, kind = 'p') => `<button class="btn ${kind}" type="button">${t}</button>`;
const hint = (t) => `<p class="hint">${t}</p>`;
const grid = (n, inner, gap = 22) => `<div style="display:grid;grid-template-columns:repeat(${n},minmax(0,1fr));gap:${gap}px;align-items:start">${inner}</div>`;
const stat = (n, label, cls = '') => `<div class="stat${cls ? ' ' + cls : ''}"><b>${n}</b><span>${label}</span></div>`;
const ask = (q, body) => `<div class="ask"><b>${q}</b>${body}</div>`;

// 缺省落在第 3 页（现状与为什么）；第 1 页是结论与顺序，第 2 页是提议的屏，各自显式传 page。
function board(file, w, h, title, inner, { pad = 24, page = 'p3', gap = 18 } = {}) {
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

// 现在这张横幅的三步文案（app/app.js 的 iosSteps()，与引导第 2 屏共用同一份）
const STEPS = `<ol class="steps"><li>打开「设置」App</li><li>Safari › 扩展</li><li>打开「大肚猴翻译」，并允许它访问网页</li></ol>`;

// 手机壳：首页的上半截（一张横幅 + 下面被压住的首页内容）
const phone = (inner, foot = '') => `<div class="phoneframe">${inner}${foot ? `<p class="hint" style="margin:0">${foot}</p>` : ''}</div>`;
// 提议里的新横幅：一句话 + 一个主按钮 + 一个次按钮，不再教三步
const newBan = ({ h4, p, main, sub, tone = '' }) => `<div class="ban${tone ? ' ' + tone : ''}">
  <h4>${h4}</h4><p>${p}</p>${main}${sub || ''}</div>`;

// ══════ 第 1 页 · 数据说了什么、先做什么 ══════════════════════════════════
// 2026-09-21 复盘：第一版画布把「教程 → 状态行」当成主改动，理由是「104 台只看过一次」。
// 把 155 台按「点了什么」分组算下来，那个理由**不成立** —— 点过主按钮的人并不比谁都没点
// 的人更可能收到卡。这一页按「能证明 / 证明不了 / 被否掉」重排，顺序就是该做的顺序。

board('E-NoEffect.dc.html', 1320, 780, '被数据否掉的：主按钮现在没有可见效果', `
${head('把 155 台按「点了什么」分组，看它们后来到底有没有收到卡', '有卡 = sync_on / capture_first / review_session / doc_open 任一')}
<table class="tbl">
  <tr><th>分组</th><th>装机</th><th>后来有卡</th><th>比例</th></tr>
  <tr><td>A 两个都没点</td><td>109</td><td>25</td><td><b>23%</b></td></tr>
  <tr><td>B 只点主按钮（去网页）</td><td>15</td><td>3</td><td class="no"><b>20%</b></td></tr>
  <tr><td>C 只点「我已打开」</td><td>11</td><td>9</td><td class="yes"><b>82%</b></td></tr>
  <tr><td>D 两个都点了</td><td>20</td><td>5</td><td><b>25%</b></td></tr>
</table>
${grid(2, `
  ${cell('读法一：B / D 与 A 在同一档', '',
    hint('点过主按钮的（20% / 25%）与什么都没点的（23%）没有差别。样本小（15 / 20 / 109），20 与 23 之间是噪声 —— 但<b>看不到任何抬升</b>。'))}
  ${cell('读法二：C 那个 82% 是选择效应', '',
    hint('只点「我已打开」、没去点主按钮的人，多半<b>本来就已经弄好了</b>，顺手关掉提示。不能读成「这个按钮有用」。'))}
`)}
${hint('<b>背景数，比横幅更大：</b>237 台 App 装机里 <b>212 台只活跃过 1 天（89.5%）</b>，回来第二天的只有 25 台。「第一次没说动就没有第二次」是整个 App 的形状，不只是这张横幅的。')}
${ask('所以设计问题变了', '不是「这句话怎么写更有说服力」，而是 —— <b>离开 App 之后那一截完全是黑的</b>。主按钮把人送到我们自己的网页上，而<b>那一页一个埋点都没有</b>：多少人到了、多少人看见了绿灯、多少人照着做完了，一个数都没有。<br>在补上之前，换任何文案都只是换一种我们判断不了的写法。')}
`, { page: 'p1' });

// 这一条改的不是「一张屏长什么样」，是**点完之后接下来会发生什么**。所以两行时间线，
// 上下对齐：前三格逐字一样，只有第 4 格是新的。用户第一版看不懂就是因为我只画了第 4 格。
const step = (day, body, why = '') => `<div class="step"><span class="day">${day}</span>${body}${why ? `<p class="why">${why}</p>` : ''}</div>`;
const homeOnly = () => `<div class="ph-sm"><div class="empty">
  <div class="homeline w3"></div><div class="homeline w2"></div><div class="homeline w3"></div><div class="homeline w2"></div></div></div>`;
const banTap = (sub) => `<div class="ph-sm">${newBan({ h4: `${ic('alert')} Safari 扩展还没打开`,
  p: '要先把浏览器那半边打开。', main: btn('在 Safari 里打开扩展 →', 'p'), sub })}</div>`;

board('E-Recheck.dc.html', 2040, 900, '有证据的：「我已打开」之后会发生什么', `
${head('这一条改的不是屏，是点完之后接下来会发生什么', '两行逐格对齐 —— 前三格一模一样，差别只有最后一格')}

<div>
  <span class="tag-now">现在</span>
  <div class="tl" style="margin-top:8px">
    ${step('第 0 天', banTap(btn('我已打开', 's')), '横幅在。用户点了「我已打开」。')}
    <span class="arr">→</span>
    ${step('点完当下', homeOnly(), '横幅收起。到这里为止是对的。')}
    <span class="arr">→</span>
    ${step('第 1 天 … 永远', homeOnly(), '<b style="color:var(--danger)">再也不出现。</b>不看有没有卡、不看有没有同步过、不看扩展到底开没开。一年后仍然 0 张卡，首页也什么都不说。')}
    <span class="arr">→</span>
    ${step('想让它回来', `<div class="ph-sm"><div class="err">${ic('alert')}<div>App 里<b>没有任何入口</b>能撤销。只能清数据。</div></div></div>`,
      '真机上发生过：1.14.0 验收时这个按钮被误点（UI 测试点空白处收键盘，正好压在它上面），那台机器上横幅再没出现过。')}
  </div>
</div>

<div style="margin-top:4px">
  <span class="tag-new">提议</span>
  <div class="tl" style="margin-top:8px">
    ${step('第 0 天', banTap(btn('我已经打开了', 's')), '一模一样。')}
    <span class="arr">→</span>
    ${step('点完当下', homeOnly(), '一模一样 —— 立刻收起，不啰嗦。')}
    <span class="arr">→</span>
    ${step('第 1–6 天', homeOnly(), '一模一样 —— 这六天什么都不说。')}
    <span class="arr">→</span>
    ${step('第 7 天 · <b style="color:var(--sage)">唯一的差别</b>',
      `<div class="diff"><div class="ph-sm">${newBan({ h4: `${ic('alert')} 还是没收到任何一张卡`,
        p: '你之前说已经打开了 —— 可能是漏了「允许访问网页」那一步。',
        main: btn('打开检测页 →', 'p'), sub: btn('确实打开了，别再提示', 's') })}</div></div>`,
      '<b>只在三个条件同时成立时才回来</b>：点过「我已打开」· 仍然 0 张卡 · 从未成功同步过。回来一次，换一句话，<b>只这一次</b>。')}
  </div>
</div>

${grid(2, `
  ${cell('两个出口', '第 7 天那一格点下去之后',
    `<div class="flow">
      <div class="node new"><b>打开检测页 →</b>去那一页看绿灯；真没打开就当场能发现</div>
      <div class="node new"><b>确实打开了，别再提示</b>这才是<b>真正的永久静音</b> —— 它是第二次确认，不是第一次</div>
    </div>`)}
  ${cell('为什么值得做', '这是这张画布上唯一有硬证据的一条',
    `<div class="num">${stat('31', '点过「我已打开」')}${stat('17', '其中从没有过卡', 'bad')}${stat('15/20', 'D 组：去过网页又说已打开，却没卡', 'bad')}</div>
     ${hint('也就是说：<b>「我已打开」这个信号，超过一半是不成立的</b>，而我们现在拿它当永久静音的依据。')}`)}
`)}
${ask('这一条我建议直接做，不等埋点', '它不依赖任何新的度量 —— 三个条件全在本机（点过没有、有没有卡、有没有同步过），判据也在本机（回读那三个键）。顺带修掉「误点了没法回来」那个真机踩过的坑。')}
`, { page: 'p1' });

board('E-Measure.dc.html', 1320, 700, '先补的：四条埋点，否则改完仍判断不了', `
${head('现在能看见的只有「点了没点」，看不见「到了没到、成了没成」', '这四条按 AGENTS.md 属于加属性值 ⇒ 随定稿后的 docs PR 一起过评审')}
<table class="tbl">
  <tr><th>缺口</th><th>现在</th><th>补上之后能回答</th></tr>
  <tr><td><b>检测页那一侧全黑</b></td><td class="no">我们自己的网页上一个埋点都没有</td><td class="yes">多少人真的到了那一页、多少人看见绿灯 —— <b>这一条最值钱</b></td></tr>
  <tr><td><b>macOS 曝光量不到</b></td><td class="no"><code class="code">shown</code> 只在 iOS 那一支发，Mac 54 台装机恒为 0</td><td class="yes">Mac 那条一键直达的路到底有没有人走</td></tr>
  <tr><td><b>直达按钮没埋点</b></td><td class="no">macOS「打开 Safari 扩展设置」点了不记</td><td class="yes">唯一一条能一键到位的路的转化</td></tr>
  <tr><td><b>两个来源混用</b></td><td class="no">主按钮与「不确定？看绿灯」共用一个 <code class="code">setup</code></td><td class="yes">检测页升成主路径之后，升了有没有用</td></tr>
</table>
${hint('为什么必须先补：上一块板的结论就是「主按钮没效果」—— 而我们连「他有没有到那一页」都不知道。<b>不补，这一轮改完还是只能得到同一张分不出因果的表。</b>这正是复习那条（#386）现在的处境。')}
${ask('判据（出货后回读 bt_events）', '① 检测页有自己的到达数与绿灯数；② macOS 形态有曝光数；③ 直达按钮有点击数；④「点过我已打开 / 看过横幅」比例从现在的 20% 起算，能分平台看。')}
`, { page: 'p1' });

board('J-Judgment.dc.html', 1320, 640, '证明不了的三条 —— 是判断，不是证据', `
${head('这三条我仍然建议做，但要说清它们没有数撑', '写在这里，免得下一个人把它们当成「读数得出的结论」')}
<table class="tbl">
  <tr><th>改动</th><th>我的建议</th><th>数据状况</th></tr>
  <tr><td><b>① 横幅从教程改成状态行</b><br><span class="code">见第 2 页「① 首页横幅」</span></td><td>做</td><td class="no">数据只证明<b>现在这个按钮没用</b>，证明不了换个说法就有用。而且提议里主按钮<b>落点没变</b>（还是同一个网页）。理由是「说我们真的知道的事实（还没收到任何一张卡）比说我们判不了的事（扩展没打开）诚实」—— 这是判断。</td></tr>
  <tr><td><b>③ macOS 保留一键直达</b><br><span class="code">见第 2 页「③ macOS 形态」</span></td><td>做</td><td class="no">macOS 连 <code class="code">shown</code> 都不发，这一格是空的。「把一键直达降级成去看网页是把好路径变差」是常识判断，不是读数。</td></tr>
  <tr><td><b>④ 三步教程只留在引导</b><br><span class="code">见第 2 页「④ 引导第 2 屏」</span></td><td>做</td><td class="no">没有任何数据说明教程放哪更有效。理由只是「同一件事不教两遍」。</td></tr>
</table>
${ask('要你拍板的是「拍不拍」这件事本身', '这三条可以现在拍板做（它们都不贵，也不会让现状更差），也可以等埋点补齐后再判断。<br><b>我建议现在就拍</b> —— 但把它们和复核那条<b>分开出货</b>，否则出货后数变了，分不清是哪一条带来的。')}
`, { page: 'p1' });

// ══════ 第 2 页 · 提议的屏 ══════════════════════════════════════════════
// 文案都是**准文案**（可以直接挑字）。左边现在、右边提议。

board('P-Banner.dc.html', 1240, 780, '① 首页横幅：教程 → 状态行', `
${head('改动一：横幅不再教三步，改成说「现在到底成没成」', '理由：104 台只看过它一次 —— 教程说第二遍不会更有效')}
${grid(2, `
  ${cell('现在', '一张教程，三步文字占满',
    phone(`<div class="ban"><h4>${ic('alert')} Safari 扩展还没打开</h4>
      <p>网页翻译在浏览器里，复习在这个 App 里。要先把浏览器那半边打开。</p>
      ${STEPS}${btn('在 Safari 里打开扩展 →', 'p')}${btn('我已打开', 's')}
      <p style="font-size:.8rem;margin:0">不确定？打开检测页看绿灯 →</p></div>`,
      '点主按钮 = 打开我们的网页。他照没照做，我们永远不知道。'))}
  ${cell('提议', '一句状态 + 一个按钮；三步搬进检测页',
    phone(newBan({
      h4: `${ic('alert')} 浏览器那半边还没打通`,
      p: '到现在还没收到任何一张卡。网页翻译在 Safari 里，要先把扩展打开。',
      main: btn('打开检测页，一眼看出通没通 →', 'p'),
      sub: btn('我已经打开了', 's'),
    }), '主按钮落到<b>检测页</b>：那一页自己知道扩展在不在（绿灯是机器判的），三步教程也在那一页上，照着做完当场能验。'))}
`)}
${ask('文案要你挑字（这几句会进 12 个语种）', '标题「浏览器那半边还没打通」/ 正文「到现在还没收到任何一张卡」/ 主按钮「打开检测页，一眼看出通没通 →」/ 次按钮「我已经打开了」。<br>其中<b>「还没收到任何一张卡」</b>是刻意的：它是我们真的知道的事实（本机 0 张卡且从未同步成功），比「扩展还没打开」诚实 —— 后者在 iOS 上我们其实判不了。')}
`, { page: 'p2' });

board('P-States.dc.html', 1560, 700, '② 横幅的三种状态（同一条，换一句话）', `
${head('改动二：同一张横幅带三种状态，不是「出现 / 消失」两态', '现在只有「出现」和「被永久静音」')}
${grid(3, `
  ${cell('A · 还没打通', '默认态',
    phone(newBan({ h4: `${ic('alert')} 浏览器那半边还没打通`, p: '到现在还没收到任何一张卡。',
      main: btn('打开检测页，一眼看出通没通 →', 'p'), sub: btn('我已经打开了', 's') })))}
  ${cell('B · 打通了', '检测页回来后 / 收到第一张卡后自动变',
    phone(`<div class="ban" style="background:var(--tint);border-color:var(--sage)">
      <h4>${ic('check')} 浏览器那半边通了</h4>
      <p>在 Safari 里读到的句子会自动进这里的复习库。</p>
      ${btn('去读一篇 →', 'p')}</div>`,
      '这一态<b>只出现一次</b>，下次进首页就不再有 —— 它是回执，不是常驻提示。'))}
  ${cell('C · 7 天后复核', '点过「我已经打开了」但仍然 0 张卡',
    phone(newBan({ h4: `${ic('alert')} 还是没收到任何一张卡`,
      p: '你之前说已经打开了 —— 要不要打开检测页看一眼？可能是漏了「允许访问网页」那一步。',
      main: btn('打开检测页 →', 'p'), sub: btn('确实打开了，别再提示', 's') })))}
`, 18)}
${ask('要你裁定：C 这一态出不出、出几次', '我建议<b>出，且只出一次（7 天后）</b>。<br>理由：现在点一次「我已打开」就永久静音、从不复核 —— 真机验收时它被误点过一次，那台机器上横幅再也没出现过，App 里也没有任何入口能让它回来。C 同时解决「点错了」和「以为打开了其实没弄完」。<br>「确实打开了，别再提示」= 真正的永久静音，但那是<b>第二次</b>确认，不是第一次。')}
`, { page: 'p2' });

board('P-Mac.dc.html', 1240, 620, '③ macOS 形态：保留一键直达', `
${head('改动三：Mac 不跟着改主按钮', 'Mac 能一键落到扩展开关上，把它降级成「去看检测页」是把好路径变差')}
${grid(2, `
  ${cell('macOS', '骨架与 iOS 一致，落点不同',
    phone(newBan({ h4: `${ic('alert')} 浏览器那半边还没打通`, p: '到现在还没收到任何一张卡。',
      main: btn('打开 Safari 扩展设置', 'p'), sub: btn('我已经打开了', 's') }),
      '点了直接落在开关上（系统给的能力，只有 Mac 有）。Mac 还能真的读到扩展开没开 ⇒ 打开之后横幅<b>自己就变成 B 态</b>，不用人来说。'))}
  ${cell('iOS', '同一副骨架',
    phone(newBan({ h4: `${ic('alert')} 浏览器那半边还没打通`, p: '到现在还没收到任何一张卡。',
      main: btn('打开检测页，一眼看出通没通 →', 'p'), sub: btn('我已经打开了', 's') }),
      '装机大头在这边：iPhone 181 台 / Mac 54 台 / iPad 2 台。'))}
`)}
${ask('要你裁定：两种形态收不收敛', '我建议<b>只收敛文案骨架</b>（一句话 + 一个主按钮 + 一个次按钮），主按钮的落点各按平台。收敛到一种会让 Mac 的一键直达变成绕路。')}
`, { page: 'p2' });

board('P-Onboard.dc.html', 1240, 700, '④ 引导第 2 屏：教程留在这里', `
${head('改动四：三步教程不删，但只留在引导里', '引导是唯一一次有人愿意读完的时刻；首页不该再教一遍')}
${grid(2, `
  ${cell('引导第 2 屏（保留，微调）', '5 屏里的第 2 屏',
    phone(`<div style="display:flex;flex-direction:column;gap:10px">
      <b style="font-size:1.05rem">先把浏览器那半边打通</b>
      ${STEPS}${btn('打开检测页，照着做 →', 'p')}
      <p class="hint" style="margin:0">这一屏没有「继续」按钮，上面那个兼作前进键。</p>
    </div>`, '只改一处：按钮从「在 Safari 里打开扩展 →」改成「打开检测页，照着做 →」—— 落到同一页，但说清楚了那一页能验。'))}
  ${cell('首页横幅（不再重复教程）', '',
    phone(newBan({ h4: `${ic('alert')} 浏览器那半边还没打通`, p: '到现在还没收到任何一张卡。',
      main: btn('打开检测页，一眼看出通没通 →', 'p'), sub: btn('我已经打开了', 's') }),
      '同一件事只教一次。首页这张负责<b>回答「成没成」</b>，不负责教。'))}
`)}
${ask('要你裁定：这样收敛行不行', '我建议<b>行</b>。反对的理由会是「跳过引导的人就再也看不到三步了」—— 但三步现在搬到了检测页上，主按钮每次都能到那一页，所以并没有丢。')}
`, { page: 'p2' });

// ── 板 1 · 现状与读数 ────────────────────────────────────────────────────
board('Now.dc.html', 1120, 720, '现状 · 横幅（iOS 形态）与它的读数', `
${head('现状：横幅说完三步，然后把人送出 App', '155 台看过它，31 台说打开了')}
${grid(2, `
  <div class="phoneframe">
    <div class="ban">
      <h4>${ic('alert')} Safari 扩展还没打开</h4>
      <p>网页翻译在浏览器里，复习在这个 App 里。要先把浏览器那半边打开。</p>
      ${STEPS}
      ${btn('在 Safari 里打开扩展 →', 'p')}
      ${btn('我已打开', 's')}
      <p style="font-size:.8rem">不确定？打开检测页看绿灯 →</p>
    </div>
    <p class="hint" style="margin:0">（macOS 上多一个「打开 Safari 扩展设置」的直达按钮；iOS 没有那条路。）</p>
  </div>
  ${cell('线上读数（2026-09-21）', '口径：只从 09-05 收 · 中国版不发 · 自己的机器也在里面',
    `<div class="num">${stat('237', 'App 装机')}${stat('155', '看过横幅')}${stat('36', '点「去打开」')}${stat('31', '点「我已打开」', 'bad')}</div>
     <div class="num" style="margin-top:12px">${stat('104', '只看过横幅 1 次', 'bad')}${stat('120', 'safari 扩展装机 ≈ App 的一半')}</div>
     ${hint('<b>关键的一条是 104。</b>不是有人把横幅无视了五遍 —— 是多数人只启动过一次 App。所以「第二次再说一遍」这条路不存在，第一次说不动就没有第二次。')}
     ${hint('这三个数只能当<b>下限</b>读：<code class="code">shown</code> 只在 iOS 形态发，macOS 的曝光一条都没量到；macOS 那个直达按钮完全没有埋点；<code class="code">setup</code> 里混着主按钮与「检测页」两个来源。见板 6。')}`)}
`)}
`);

// ── 板 2 · 同一份三步，说了两遍 ──────────────────────────────────────────
board('Twice.dc.html', 1120, 660, '同一份三步，引导里说过一遍，横幅又说一遍', `
${head('两处同一份文案，而且引导跳过也算看过', 'app/app.js 的 iosSteps() 被两处共用')}
${grid(2, `
  ${cell('引导第 2 屏（5 屏里的第 2 屏）', '只在「未登录且没看过」时出现',
    `<div class="phoneframe"><div style="display:flex;flex-direction:column;gap:10px">
      <b style="font-size:1.05rem">先把浏览器那半边打通</b>
      ${STEPS}${btn('在 Safari 里打开扩展 →', 'p')}
      <p class="hint" style="margin:0">这一屏没有「继续」按钮 —— 上面那个按钮兼作前进键。</p>
    </div></div>
    ${hint('<b>跳过也算看过、永不再来。</b>跳过与走完走的是同一个收尾。')}`)}
  ${cell('首页横幅', '引导进行中时不挂，两者不会同屏',
    `<div class="phoneframe"><div class="ban"><h4>${ic('alert')} Safari 扩展还没打开</h4>${STEPS}</div></div>
     ${hint('两处说的是同一件事、同一份字。区别只有：一处在引导里（只出现一次），一处在首页（每次回来都在，直到被静音）。')}`)}
`)}
${ask('要裁定的第一件：这两处该不该收敛成一处？', '我的建议是<b>收敛</b> —— 引导第 2 屏保留（它是唯一一次有人愿意读完的时刻），首页横幅改成<b>状态行</b>而不是再教一遍三步（见板 3）。理由是那 104 台：教程说第二遍不会更有效，能有效的是告诉他「现在到底成没成」。')}
`);

// ── 板 3 · iOS 判不了状态 ⇒ 把检测页升成主路径 ──────────────────────────
board('Detect.dc.html', 1240, 760, 'iOS 判不了扩展开没开 ⇒ 唯一可靠的回读是检测页', `
${head('结构性事实：iOS 上 App 拿不到扩展的开关状态', 'app/app.js 的 iOS 分支把状态写死成「不知道」')}
${grid(2, `
  ${cell('现在', '横幅只能「说」，说完就把人送出 App',
    `<div class="flow">
      <div class="node now"><b>横幅</b>教三步</div><span class="arr">→</span>
      <div class="node now"><b>系统 Safari</b>打开我们的网页</div><span class="arr">→</span>
      <div class="node now"><b>？</b>他照做了没有<br>我们永远不知道</div>
    </div>
    ${hint('那个网页<b>已经是检测页</b>（打开它就能看见绿灯），但它现在只是横幅角落里一行小字「不确定？打开检测页看绿灯 →」，而且它的点击与主按钮记成同一个来源。')}`)}
  ${cell('提议', '把检测页从附属链接升成主路径',
    `<div class="flow">
      <div class="node new"><b>横幅</b>一句话 + 一个按钮</div><span class="arr">→</span>
      <div class="node new"><b>检测页</b>绿灯 / 红灯<br>它<b>知道</b>扩展在不在</div><span class="arr">→</span>
      <div class="node new"><b>回到 App</b>状态行变成「已打开」</div>
    </div>
    ${hint('检测页是唯一一处<b>能证明</b>扩展开了的地方 —— 扩展注入到那个页面上，绿灯是机器判的，不是人自称的。')}
    ${ask('要裁定的第二件：绿灯怎么回到 App？', '两条路：<br><b>A.</b> 检测页给一个深链（回 App 并带上「我看见绿灯了」）—— 一次点击，但仍是人点的。<br><b>B.</b> 扩展在检测页上顺手写一次同步/账号侧的标记，App 下次启动读它 —— 真回读，但只对登录用户成立，而且要过领域设计（多一条跨面的状态）。<br>我倾向 <b>A 先做</b>：它把「自称」变成「在绿灯页上自称」，成本一行；B 留给 #386 那轮一起看。')}`)}
`)}
`);

// ── 板 4 ·「我已打开」不再是永久静音 ────────────────────────────────────
board('Mute.dc.html', 1240, 720, '「我已打开」：一次性永久静音 → 静音 + 到期复核', `
${head('现在点一次就永远不再出现，即使一年后仍然 0 张卡', 'extBannerDoneAt 写下就再不复核')}
${grid(2, `
  ${cell('现在', '一个不可逆的按钮',
    `<div class="flow" style="flex-direction:column;align-items:stretch">
      <div class="node now"><b>点「我已打开」</b>写下时间戳</div>
      <div class="node now"><b>此后永不出现</b>不看卡数、不看同步、不看扩展到底开没开</div>
      <div class="node now"><b>没有入口能让它回来</b>App 里没有任何地方能撤销</div>
    </div>
    ${hint('<b>这不是假想。</b>做真机验收时它被误点了一次（UI 测试里「点空白处收键盘」正好压在这个按钮上），于是那台机器上这张横幅再也不出现，只能靠清数据 —— 这条已经记在待办里了。')}`)}
  ${cell('提议', '静音是对的，永久不复核不对',
    `<div class="flow" style="flex-direction:column;align-items:stretch">
      <div class="node new"><b>点「我已打开」</b>立刻收起，不再啰嗦</div>
      <div class="node new"><b>N 天后复核一次</b>条件：仍然 0 张卡 <b>且</b> 从未成功同步过</div>
      <div class="node new"><b>回来时换一句话</b>不是再教一遍三步，而是「还没收到任何一张卡 —— 要不要打开检测页看一眼？」</div>
    </div>
    ${ask('要裁定的第三件：N 是多少、复核几次？', '我的建议：<b>N = 7 天，只复核一次</b>。一次足够把「点错了」和「真开了」分开；多于一次就变成催促。<br>另外要不要在 App 设置里给一个「重新显示这张提示」的入口？我倾向<b>不给</b> —— 设置页不该为一个横幅长出一行，而 7 天复核已经覆盖了误点。')}`)}
`)}
`);

// ── 板 5 · macOS 与 iOS 两种形态 ────────────────────────────────────────
board('Mac.dc.html', 1120, 600, 'macOS 与 iOS 是两种形态 —— 要不要收敛', `
${head('macOS 能直达、也能判状态；iOS 两样都不能', '同一张横幅，两条完全不同的路')}
${grid(2, `
  ${cell('macOS', '有直达按钮，且拿得到 enabled',
    `<div class="phoneframe" style="width:360px"><div class="ban">
      <h4>${ic('alert')} Safari 扩展还没打开</h4>
      <p>点一下就能到扩展设置。</p>
      ${btn('打开 Safari 扩展设置', 'p')}${btn('我已打开', 's')}
    </div></div>
    ${hint('这条路径是系统给的（只有 macOS 有），点了直接落在开关上。<b>而它现在一个埋点都没有</b> —— 见板 6。')}`)}
  ${cell('iOS', '只能说，说完送出 App',
    `<div class="phoneframe" style="width:360px"><div class="ban">
      <h4>${ic('alert')} Safari 扩展还没打开</h4>${STEPS}${btn('在 Safari 里打开扩展 →', 'p')}
    </div></div>
    ${hint('装机里 iPhone 181 台、Mac 54 台、iPad 2 台 —— <b>大头在判不了状态的那一边</b>，所以这张稿按 iOS 来定形，macOS 是它的简化版。')}`)}
`)}
${ask('要裁定的第四件：两种形态要不要收敛成一种？', '我的建议<b>不收敛</b>：macOS 能一键到位，把它降级成「去看检测页」是把好路径变差。收敛的只有<b>文案骨架</b>（一句话 + 一个主按钮 + 一个「我已打开」），按钮落点各按各的平台。')}
`);

// ── 板 6 · 埋点怎么补 ───────────────────────────────────────────────────
board('Telemetry.dc.html', 1120, 640, '埋点：三个洞，补了才能判断这一轮有没有用', `
${head('现在的数只能当下限读', '这一块随画布定稿后的 docs PR 过评审 —— 加属性值算领域设计改动')}
<table class="tbl">
  <tr><th>洞</th><th>现在</th><th>提议</th></tr>
  <tr><td><b>macOS 的曝光量不到</b></td><td class="no"><code class="code">shown</code> 只在 iOS 那一支发，Mac 54 台装机的横幅曝光恒为 0</td><td class="yes">两种形态都发；靠已有的每日去重挡重复</td></tr>
  <tr><td><b>直达按钮没有埋点</b></td><td class="no">macOS 那个「打开 Safari 扩展设置」点了不记 —— 最有效的一条路完全看不见</td><td class="yes">补一条，与「去网页」分开</td></tr>
  <tr><td><b>两个来源混在一起</b></td><td class="no">主按钮与「不确定？打开检测页」共用同一个 <code class="code">setup</code></td><td class="yes">把检测页那一路拆出来 —— 板 3 要把它升成主路径，不拆就看不出升了有没有用</td></tr>
</table>
${hint('为什么现在提：板 3、板 4 的效果<b>只能靠这三个数回读</b>。先改交互后补埋点，等于改完不知道有没有改对 —— 那正是复习那条（#386）现在的处境。')}
${ask('判据（出货后回读 bt_events）', '① 点过「我已打开」的装机 / 看过横幅的装机 <b>&gt; 20%</b>；② macOS 形态也有曝光数；③ 检测页那一路有自己的数；④ 中期：safari 装机 / app 装机的比值从现在的 ~0.5 上升。')}
`);

// ─── 输出 ────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.dc.html') && !W[f]) fs.unlinkSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'ui.css'), css());
for (const [name, html] of Object.entries(W)) fs.writeFileSync(path.join(OUT, name), html);

const PAGES = [['p1', '① 数据说了什么 · 先做什么'], ['p2', '② 提议的屏'], ['p3', '③ 现状与为什么']];
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
  v: 3, createdOnFiles: { v: 1, at: '2026-09-21T04:30:00Z' },
  title: '装了 App 却没打开扩展 · 交互稿',
  launch: { view: 'canvas', page: 'p1' },
  pages: PAGES.map(([id, name]) => ({ id, name })),
  boards, order, notes: {}, designSystems: [],
};
idx.notes.t1 = { x: 0, y: -320, text: '数据说了什么 —— 一条能证明、三条证明不了、一条被否掉', kind: 'title1', maxW: 3600, page: 'p1' };
idx.notes.t2 = { x: 0, y: -320, text: '提议的屏 —— 文案是准文案，可以直接挑字', kind: 'title1', maxW: 3600, page: 'p2' };
idx.notes.t3 = { x: 0, y: -320, text: '现状与为什么 —— 备查，不用先看', kind: 'title1', maxW: 3600, page: 'p3' };
const NX = ROW_W + 160;
idx.notes.why = { x: NX, y: 0, w: 520, maxH: 420, page: 'p3', color: 'orange',
  text: '这张稿由读数驱动（issue #384）。\n\n2026-09-21 回读 bt_events：App 装机 237，155 台看过横幅，36 台点「去打开」，31 台点「我已打开」（20%）。**104 台只看过横幅 1 次。**\n\n口径三条：只从 2026-09-05 起收 · 中国版一条不发 · 我们自己的机器也在里面。install_id 按宿主分 —— App 与扩展是两条独立记录，不能当同一个人。' };
idx.notes.ask = { x: NX, y: 0, w: 540, maxH: 560, page: 'p1', color: 'blue',
  text: '2026-09-21 复盘改过一版：第一版把「教程 → 状态行」当主改动，理由是「104 台只看过一次」。按「点了什么」分组算完，那个理由不成立 —— 点过主按钮的人并不比谁都没点的人更可能收到卡。\n\n这一页按证据强弱重排，顺序就是建议做的顺序：\n\n① 先补四条埋点（检测页那一侧最值钱）\n② 复核那条直接做 —— 唯一有硬证据的\n③ 另外三条是判断，可以现在拍板，但要分开出货，否则分不清是哪条带来的\n\n要你回的就是「③ 拍不拍」，以及第 2 页那几句准文案挑不挑字。' };
idx.notes.rule = { x: NX, y: 640, w: 540, maxH: 340, page: 'p1', color: 'purple',
  text: '流程：画布 → 你逐条点头 → 写 docs/interaction-spec.md → 代码 PR（标题写「画布第 N 页落地」）。埋点那三条（板 6）按 AGENTS.md 属于加属性值 ⇒ 随定稿后的 docs PR 一起过评审，不夹在别的 PR 里。\n\n顺带：「改交互先出画布稿」这条规矩本身在仓库里没有成文，只记在 docs/learning-design.md §0 的评审记录里 —— 已写进 #384，建议补进 AGENTS.md 的 Interaction 节。' };

fs.writeFileSync(path.join(OUT, 'canvas.json'), JSON.stringify(idx, null, 2) + '\n');
console.log('✓ design/ext-banner/project：' + order.length + ' 块板');
