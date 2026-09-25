// 「评分为什么是 0」· 评分触发点交互稿 · 画布生成器（2026-09-25，ASO/评分长期方案 P1b+P2）。
// 改画布 = 改这个文件再 `node gen.mjs`。形状同 design/ext-banner/gen.mjs（辅助函数原样搬来）。
// 发布：Artifact publish url=https://claude.ai/artifact/RmJMXH1TF59zKm66xgs54y root=design/rating-moments file_path=project/canvas.json files=project/*
//
// 这张稿由**线上读数**驱动。2026-09-25 回读：
//   · 星级评分两条线 12 个店面全是 0（iTunes lookup userRatingCount），文字评论 0
//   · 评分行（网页译文末尾）：Safari 37 台见过 / 389 次，Chrome 12 台 / 90 次；点 1 次、关 3 次
//   · 那 1 次点击发生在被展示 98 次、跨 4 天之后
//   · 成功过（translate_ok）的设备：Safari 58 · Chrome 21 · App 9 · Firefox 2；
//     其中「≥3 次且跨 ≥2 天」：Safari 17 · Chrome 7 · App 1
// 口径：遥测从 2026-09-05 起收 · 中国版一条不发 · 我们自己的机器也在里面 ·
// install_id 按宿主分（App 与扩展是两条独立记录，不能当同一个人）。
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

// ── 本画布用的小件 ─────────────────────────────────────────────────────────
const bar = (label, n, max, cls = '') => `<div style="display:flex;align-items:center;gap:10px;font-size:.82rem">
  <span style="width:92px;color:var(--muted)">${label}</span>
  <span style="height:14px;border-radius:7px;background:var(${cls === 'bad' ? '--danger' : '--sage'});opacity:.75;width:${Math.max(4, Math.round(420 * n / max))}px"></span>
  <b>${n}</b></div>`;
// 译文末尾的那一行评分提示（interaction-spec §评分提示 的现状形状）
const rateRow = (txt = '觉得好用？去商店给个评分 →') => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--sage);font-size:.84rem;border-top:1px dashed var(--rule);padding-top:7px">
  <span>${txt}</span><span style="color:var(--muted)">×</span></div>`;
const para = (w1 = 'w3', w2 = 'w2') => `<div class="homeline ${w1}"></div><div class="homeline ${w2}"></div>`;
const tr = () => `<div style="color:var(--sage);font-size:.78rem;line-height:1.5">译文译文译文译文译文译文译文译文</div>`;
const pageWithRow = (row = rateRow()) => `<div class="ph-sm" style="min-height:170px">${para()}${tr()}${para('w2', 'w3')}${tr()}${row}</div>`;
const pageNoRow = () => `<div class="ph-sm" style="min-height:170px">${para()}${tr()}${para('w2', 'w3')}${tr()}</div>`;
const step = (day, body, why = '') => `<div class="step"><span class="day">${day}</span>${body}${why ? `<p class="why">${why}</p>` : ''}</div>`;

// ══════ 第 1 页 · 数据说了什么 · 要你裁定的 ═══════════════════════════════════

board('A-Where.dc.html', 1320, 760, '评分的机会在哪：成功发生在 Safari 扩展，不在 App', `
${head('评分是 0，而问题不在「问得不够」—— 在「问的地方没有人」', '成功 = translate_ok；「真在用」= 成功 ≥3 次且跨 ≥2 天')}
<div class="num">
  ${stat('0', '星级评分 · 两条线 12 个店面', 'bad')}
  ${stat('0', '文字评论', 'bad')}
  ${stat('~100/天', '下载（30 天 1690）')}
  ${stat('~99%', '曝光来自 App Store 搜索')}
</div>
<table class="tbl">
  <tr><th>宿主</th><th>成功过</th><th>≥3 次</th><th>真在用（≥3 次且跨 ≥2 天）</th><th>现在谁会问他要评分</th></tr>
  <tr><td><b>Safari 扩展</b></td><td>58</td><td>43</td><td class="yes"><b>17</b></td><td>网页译文末尾那一行（37 台见过）</td></tr>
  <tr><td>Chrome 扩展</td><td>21</td><td>16</td><td>7</td><td>同上（12 台见过）· 去的是 Chrome 商店，不影响 App Store 排名</td></tr>
  <tr><td><b>App</b></td><td>9</td><td>2</td><td class="no"><b>1</b></td><td class="no">系统评分弹窗 —— 只在「一轮复习 ≥3 张」后，几乎从不触发</td></tr>
  <tr><td>Firefox 扩展</td><td>2</td><td>0</td><td>0</td><td>同网页那一行</td></tr>
</table>
${hint('App 装机 343 台，在 App 里真正「有过收获」的只有 9 台（全是听译 / 实时字幕）。<b>系统翻译没有埋点</b>（§3.5 裁定不加），所以 App 这边是下限 —— 但就算翻几倍，也比不过 Safari 那 17 台。')}
${ask('所以第一句结论', '<b>把 App 的系统评分挪到收获时刻是对的，但按现在的数据只能触达约 1 个人。</b>真正的机会在 Safari 扩展那一行 —— 它见到了真在用的人，却只换来 1 次点击。这张稿的主角是那一行。')}
`, { page: 'p1' });

board('B-Row.dc.html', 1320, 760, '评分行：被看了 479 次，点了 1 次', `
${head('一台设备平均被这行字追了 10 次', 'Safari：37 台 / 389 次；Chrome：12 台 / 90 次。按规约，点或 × 才进 90 天冷却 —— 不理它，就每一页都出')}
${grid(2, `
  ${cell('Safari · 每台设备被展示几次', '37 台',
    `<div style="display:flex;flex-direction:column;gap:6px">${bar('1 次', 8, 10)}${bar('2–3 次', 9, 10)}${bar('4–5 次', 2, 10)}${bar('6–10 次', 10, 10)}${bar('10 次以上', 8, 10, 'bad')}</div>
    ${hint('中位 5 次，最多一台 <b>98 次</b>。')}`)}
  ${cell('有人理它的那 4 次', '',
    `<table class="tbl">
      <tr><th>宿主</th><th>动作</th><th>之前被展示</th><th>跨几天</th></tr>
      <tr><td>Safari</td><td>×</td><td>1 次</td><td>1</td></tr>
      <tr><td>Chrome</td><td>×</td><td>5 次</td><td>3</td></tr>
      <tr><td>Safari</td><td>×</td><td>7 次</td><td>1</td></tr>
      <tr><td>Safari</td><td class="yes"><b>点了</b></td><td class="no"><b>98 次</b></td><td>4</td></tr>
    </table>`)}
`)}
${ask('唯一那次点击是个反例，也是个疑点', '它发生在第 <b>98</b> 次展示、第 <b>4</b> 天 —— 如果一刀切成「最多 5 次」，这一次就不会有。<br>但它是 iPhone · 中文界面 · 1.14→1.15 · 4 天里 101 次成功翻译，<b>不能排除是我们自己的测试机</b>。你 09-25 在手机上点过这一行吗？是的话，真实点击数就是 0。<br><b>用户 09-25 答：「不太记得了，但很可能是我点的」⇒ 真实点击按 0 算。</b>')}
`, { page: 'p1' });

board('C-Ask.dc.html', 1320, 900, '第二轮要你裁定的（09-25 下午）', `
${head('上午那四件已按建议裁定；推到「看到了没点 / 根本没看到」两个分支之后，Safari 那一行要改方向', '改动用绿色标出。每件带建议')}
${ask('①′ Safari 那一行不再要评分，改成「回 App」（板 J）', '<b>改</b>：「觉得好用？去商店给个评分 →」→「今天读过的句子，去 App 里复习 →」。只给已登录的人（句子要同步过去，否则把人送进一个必然空着的屏）。点了走现成的 <code class="code">AppLink.open(uid, …, \'review\')</code>。<br>理由见板 I：苹果 5.6.1 不许自定义评分提示；且 iOS 上唯一低门槛的评分路是 App 里的系统弹层。')}
${ask('①″ Chrome / Firefox 那一行照旧要评分，按上午的冷却口径', '每天至多一次、最多 5 个不同日子（板 D，范围收窄到这两个浏览器）。苹果的规则管不到它们，去的也不是 App Store。')}
${ask('② 只问真在用的人 —— 不变', '成功 ≥3 次且跨 ≥2 天。新的「回 App」行同一门槛、同一冷却（每天至多一次、最多 5 个日子）。')}
${ask('③ App 系统评分 —— 地位升高：它成了 iOS 上唯一的评分路', '时刻照上午：听译结束 / 快速翻译 / 系统翻译收件箱 / 复习。<b>新增一个</b>：从 Safari 那一行进来、在复习里评完 ≥5 张。仍然只在事件回调里调，<b>不在那一次点击里调</b> —— 点「回 App」是按钮，评完卡片才是收获。')}
${ask('⑤ 新行用新事件，别复用 rate_prompt', '建议新事件 <code class="code">app_nudge {action: shown | seen | tap | dismiss | no_app}</code>。复用 <code class="code">rate_prompt</code> 会让 Safari 的 tap 不再等于「去评分」，把第六问的数据搅浑。另给所有行加 <code class="code">seen</code>（至少一半进入视线且停留 ≥1 秒）——上午那 479 次只是「插进了页面」，谁真看见过一个数都没有。')}
${hint('④ 冷却不打通 —— 不变。')}
`, { page: 'p1' });

board('I-Rule.dc.html', 1320, 900, '两个分支推下去，汇到同一处', `
${head('假设「没看到」和假设「看到了没点」，修法最后都不是「把这一行做得更好」', 'Safari 是唯一影响 App Store 排名、又真有人在用的地方')}
<table class="tbl">
  <tr><th>分支</th><th>自然的修法</th><th>在 Safari 上撞到什么</th></tr>
  <tr><td><b>没看到</b>（行挂在已译内容的最前沿，通常在屏幕下方，还跟着往下跑；颜色和译文一样）</td><td>挪到读者停下的地方、做得可辨认</td><td class="no">= 把一个可能违规的提示做得更显眼</td></tr>
  <tr><td><b>看到了没点</b>（离开 Safari → App Store → 找写评价入口，门槛太高）</td><td>换成一次点击就能打星</td><td class="no">浏览器里做不到；唯一的一键打星是 App 里的 <code class="code">requestReview</code></td></tr>
  <tr><td><b>点了走不通</b></td><td>修路径</td><td>这条路从没端到端验过 —— 但就算通，也还是撞上面两条</td></tr>
</table>
${ask('苹果 App Store 审核指南 5.6.1（原文）', '<i>Use the provided API to prompt users to review your app; this functionality allows customers to provide an App Store rating and review without the inconvenience of leaving your app, and <b>we will disallow custom review prompts.</b></i><br>Safari 扩展是 App 的一部分；主动出现在网页里的「去商店给个评分」就是自定义评分提示。之前没被拒，多半是审核员没刷到第 3 个网页。设置里常驻的「给我们评分」链接不是主动提示，风险小得多。')}
${grid(3, `
  ${cell('所以 Safari 那一行', '', hint('不再要评分，改成把真在用的人<b>带回 App</b>。'))}
  ${cell('App 里', '', hint('在收获时刻用系统弹层要评分 —— 合规、一键、不离开。'))}
  ${cell('顺带', '', hint('App 里真正用出效果的只有 9 台、复习闭环几乎为 0 —— 这正是激活的缺口，同一步一起补。'))}
`)}
${hint('规模要说实话：Safari 真在用的是 17 台（其中 11 台已登录）。就算一半给了评分，也是个位数 —— <b>评分的量最终跟着「真在用」的人数走</b>，也就是激活漏斗。')}
`, { page: 'p1' });

// ══════ 第 2 页 · 提议 ══════════════════════════════════════════════════════

board('D-Cooldown.dc.html', 2040, 960, 'Chrome / Firefox 评分行的冷却：三种口径（Safari 那一行改走板 J）', `
${head('差别只在「不理它的人，接下来几天看见几次」', '点或 × 在三种口径下都一样：立刻进 90 天冷却')}
<div>
  <span class="tag-now">现在</span>
  <div class="tl" style="margin-top:8px">
    ${step('第 1 天 · 第 1 页', pageWithRow(), '')}<span class="arr">→</span>
    ${step('第 1 天 · 第 2 页', pageWithRow(), '')}<span class="arr">→</span>
    ${step('第 1 天 · 第 N 页', pageWithRow(), '每一页都再出一次。')}<span class="arr">→</span>
    ${step('第 2、3、4… 天', pageWithRow(), '直到点或 ×。最多的一台 98 次。')}
  </div>
</div>
<div>
  <span class="tag-new">提议 · 每天至多一次、最多 5 个不同的日子</span>
  <div class="tl diff" style="margin-top:8px">
    ${step('第 1 天 · 第 1 页', pageWithRow(), '')}<span class="arr">→</span>
    ${step('第 1 天 · 第 2 页起', pageNoRow(), '当天不再出。')}<span class="arr">→</span>
    ${step('第 2–5 个日子', pageWithRow(), '每个日子第一页出一次。')}<span class="arr">→</span>
    ${step('第 6 个日子起', pageNoRow(), '自动进 90 天冷却，不用点 ×。')}
  </div>
</div>
<table class="tbl">
  <tr><th>口径</th><th>Safari 曝光</th><th>Chrome 曝光</th><th>那台点了的设备还看得到吗</th></tr>
  <tr><td>现在（每页）</td><td>389</td><td>90</td><td>✓（第 98 次）</td></tr>
  <tr><td>挂上即冷却（telemetry-design 第 98 行的写法）</td><td>37</td><td>12</td><td class="no">✗ 只看到 1 次</td></tr>
  <tr><td>每页至多一次、最多 5 次</td><td>129</td><td>43</td><td class="no">✗ 第 5 次后就没了</td></tr>
  <tr><td class="yes"><b>每天至多一次、最多 5 个日子</b></td><td class="yes"><b>60</b></td><td class="yes"><b>23</b></td><td class="yes"><b>✓ 第 4 天</b></td></tr>
</table>
${hint('估算方法：用每台设备已发生的展示次数与跨越天数重放 —— 是「如果当时就是这个口径」的下限，不是预测。')}
`, { page: 'p2' });

board('E-Qualify.dc.html', 1320, 760, '只问真在用的人', `
${head('从「第 3 个成功的网页会话」改成「成功 ≥3 次、且跨 ≥2 天」', '一个人第一天连刷三页就被问，那不是「喜欢」，是「还在试」')}
${grid(2, `
  ${cell('现在', 'mtOkSessions ≥ 3（同一天也算）',
    `<div class="num">${stat('58', 'Safari 成功过')}${stat('43', '≥3 次 → 现在就会被问')}</div>`)}
  ${cell('提议', '成功 ≥3 次 且 出现在 ≥2 个不同日子',
    `<div class="num">${stat('17', '会被问', 'good')}${stat('26', '暂时不问（多半还在试）')}</div>`)}
`)}
${hint('实现只需要多记一个「成功出现在哪几天」的去重集合（按本地日期），与现在的 <code class="code">mtOkSessions</code> 放在同一处（<code class="code">extension/learn/feedback.js</code>）。')}
${ask('为什么要跨天', 'App Store 的评分弹窗和网页这一行，问的都是「你觉得它好不好」。第一天的人还没资格回答这个问题 —— 问早了，最好的结果是被 ×，最坏的是一颗星。')}
`, { page: 'p2' });

board('F-App.dc.html', 1320, 860, 'App 系统评分：挪到真实的收获时刻', `
${head('现在只在「一轮复习 ≥3 张」后 —— review_session 在 1.16.0 之前全历史 0 行', '系统弹窗：Apple 每 365 天最多弹 3 次、不告诉我们弹没弹')}
<table class="tbl">
  <tr><th>候选时刻</th><th>位置</th><th>至今发生过的 App 设备</th><th>建议</th></tr>
  <tr><td>听译 / 实时字幕结束，小结里有句子</td><td class="code">app/listen.js 结束小结</td><td>9</td><td class="yes">用</td></tr>
  <tr><td>Mac 快速翻译成功</td><td class="code">app/handoff.js translate_ok{quick}</td><td>1</td><td class="yes">用（第 3 次起）</td></tr>
  <tr><td>系统翻译：收件箱进了卡</td><td class="code">app/vault-mirror.js</td><td>量不到（没有埋点）</td><td class="yes">用 —— 唯一能证明「真的在用」的事实</td></tr>
  <tr><td><b>从 Safari 那一行进来，复习评完 ≥5 张</b>（第二轮新增）</td><td class="code">extension/learn/review.js</td><td>—（新入口）</td><td class="yes">用 —— iOS 上最主要的一条</td></tr>
  <tr><td>复习：今天打开过（§3.10 opened）</td><td class="code">extension/learn/review.js</td><td>2</td><td>用，替换现在的「一轮 ≥3 张」</td></tr>
  <tr><td>配置回执全通过</td><td class="code">app/setup-done.js</td><td>—</td><td class="no">不用：那时还没真正用过</td></tr>
</table>
${hint('门槛与板 E 同一条：这些时刻累计 ≥3 次、跨 ≥2 天，才调一次 <code class="code">maybeRequestRating</code>。调用都发生在事件回调里，<b>不在任何按钮的点击里</b>。')}
${ask('坦白说它能带来多少', '按今天的数据：约 1 台设备够门槛。挪它是因为方向对、成本低（四处各加一行），不是因为它能解决评分为 0。')}
`, { page: 'p2' });

board('J-BackToApp.dc.html', 2040, 960, 'Safari 那一行：从「去商店评分」改成「回 App 复习」', `
${head('同一个位置、同一个节奏，换一个目的地', '只给已登录的人（17 台真在用的里 11 台）· 每天至多一次、最多 5 个不同日子 · 点或 × 立刻 90 天冷却')}
<div>
  <span class="tag-now">现在</span>
  <div class="tl" style="margin-top:8px">
    ${step('Safari 网页', pageWithRow(), '')}<span class="arr">→</span>
    ${step('点了之后', `<div class="ph-sm" style="min-height:170px"><div class="empty"><div class="homeline w3"></div><div class="homeline w2"></div></div><p class="hint" style="margin:0">跳出 Safari → App Store 商品页的「写评价」→ 还要自己点星、再找提交</p></div>`, '三四步，离开当前阅读。')}
  </div>
</div>
<div>
  <span class="tag-new">提议</span>
  <div class="tl diff" style="margin-top:8px">
    ${step('Safari 网页', pageWithRow(rateRow('今天读过的句子，去 App 里复习 →')), '只在已登录、句子已同步的前提下出现。')}<span class="arr">→</span>
    ${step('点了之后', `<div class="ph-sm" style="min-height:170px"><p class="hint" style="margin:0">系统询问「在大肚猴翻译中打开？」→ 落在 App 的复习屏</p>${para()}${tr()}</div>`, '走现成的 AppLink.open(uid, …, \'review\')；没接住就说出口（下载 / 本平台没有 App）。')}<span class="arr">→</span>
    ${step('在 App 里评完 ≥5 张', `<div class="ph-sm" style="min-height:170px"><div class="ban" style="background:var(--card)"><h4>喜欢大肚猴翻译吗？</h4><p>★ ★ ★ ★ ★</p><p class="hint" style="margin:0">（系统弹层，样子由 Apple 决定）</p></div></div>`, '这才是收获时刻 —— 事件回调里调 requestReview，不是那一次点击。')}
  </div>
</div>
<table class="tbl">
  <tr><th></th><th>现在</th><th>提议</th></tr>
  <tr><td>合规</td><td class="no">自定义评分提示（5.6.1）</td><td class="yes">应用内入口 + 系统评分 API</td></tr>
  <tr><td>评分那一步的门槛</td><td class="no">离开 Safari、跳商店、自己找写评价</td><td class="yes">一次点星，不离开 App</td></tr>
  <tr><td>顺带</td><td>—</td><td class="yes">把扩展用户带回 App（复习闭环今天几乎为 0）</td></tr>
</table>
${hint('文案里不带具体句数：内容脚本拿不到扩展学习库里「今天几句」，为它另开通道不值。以后能便宜拿到再加。')}
`, { page: 'p2' });

// ══════ 第 3 页 · 现状与规约矛盾（备查）══════════════════════════════════════

board('G-Now.dc.html', 1320, 700, '现在的三处评分入口', `
${head('一个会打扰人、一个几乎不出现、一个没人找得到', '')}
<table class="tbl">
  <tr><th>入口</th><th>在哪</th><th>什么时候</th><th>点了去哪</th></tr>
  <tr><td><b>网页译文末尾一行</b></td><td>Safari / Chrome / Firefox 扩展</td><td>第 3 个成功的网页会话起，每页都出，直到点或 ×</td><td>Safari → App Store 写评论页；Chrome → CWS；Firefox → AMO（中国版 Chrome / Firefox 不出）</td></tr>
  <tr><td><b>App 系统评分弹窗</b></td><td>iOS / macOS App</td><td>一轮复习 ≥3 张后，90 天一次</td><td>系统原生的打星弹层（不离开 App）</td></tr>
  <tr><td>常驻「给我们评分」</td><td>App 设置 · 扩展弹窗 · 选项页</td><td>一直在</td><td>同第一行</td></tr>
</table>
${hint('网页那一行点下去要<b>离开 Safari、跳进 App Store、找到写评论的地方</b> —— 路径长。App 里的系统弹层只要点一颗星，但 App 里几乎没有真在用的人。两者正好错开。')}
`);

board('H-Spec.dc.html', 1320, 880, '规约自相矛盾的三处，和要补的埋点', `
${head('定稿时一起改掉 —— 否则下一个读规约的人会照着错的那份实现', '')}
<table class="tbl">
  <tr><th>哪里</th><th>写的</th><th>实际</th></tr>
  <tr><td class="code">interaction-spec.md §评分提示</td><td>点或 × 才写冷却</td><td class="yes">与代码一致</td></tr>
  <tr><td class="code">telemetry-design.md 第 98 行</td><td>「挂上即等于 mtRatingAskedAt 落盘，90 天至多一组」</td><td class="no">与代码、与交互规约都不一致</td></tr>
  <tr><td class="code">interaction-spec.md</td><td>扩展与 App「共用同一个键与同一个冷却」</td><td class="no">同名键、两个存储，从不互通</td></tr>
</table>
<table class="tbl">
  <tr><th>要补的埋点（随 docs PR 过评审）</th><th>为什么</th></tr>
  <tr><td><code class="code">rate_prompt</code> 在 App 的送出点：<code class="code">none</code> → 实际位置</td><td>现在 App 端一个数都没有，挪了也不知道有没有触发</td></tr>
  <tr><td>所有行加 <code class="code">seen</code>（至少一半进入视线、停留 ≥1 秒）</td><td><code class="code">shown</code> 在行被插进页面时就记了 —— 479 次里真看见几次，一个数都没有</td></tr>
  <tr><td>Safari「回 App」行用新事件 <code class="code">app_nudge</code></td><td>它不再是评分提示；复用 <code class="code">rate_prompt</code> 会搅浑第六问</td></tr>
  <tr><td><code class="code">action</code> 加 <code class="code">requested</code></td><td>App 拿不到系统到底弹没弹，<b>不能记成 shown</b>，看板上也不能当曝光</td></tr>
</table>
`);

// ─── 输出 ────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.dc.html') && !W[f]) fs.unlinkSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'ui.css'), css());
for (const [name, html] of Object.entries(W)) fs.writeFileSync(path.join(OUT, name), html);

const PAGES = [['p1', '① 数据说了什么 · 要你裁定的'], ['p2', '② 提议'], ['p3', '③ 现状与规约矛盾']];
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
  v: 3, createdOnFiles: { v: 1, at: '2026-09-25T13:00:00Z' },
  title: '评分为什么是 0 · 评分触发点交互稿',
  launch: { view: 'canvas', page: 'p1' },
  pages: PAGES.map(([id, name]) => ({ id, name })),
  boards, order, notes: {}, designSystems: [],
};
idx.notes.t1 = { x: 0, y: -320, text: '数据说了什么 —— 评分的机会在 Safari 扩展，不在 App', kind: 'title1', maxW: 3600, page: 'p1' };
idx.notes.t2 = { x: 0, y: -320, text: '提议 —— 数字都是用已发生的数据重放的', kind: 'title1', maxW: 3600, page: 'p2' };
idx.notes.t3 = { x: 0, y: -320, text: '现状与规约矛盾 —— 备查', kind: 'title1', maxW: 3600, page: 'p3' };
const NX = ROW_W + 160;
idx.notes.why = { x: NX, y: 0, w: 540, maxH: 520, page: 'p1', color: 'orange',
  text: '这张稿是 ASO / 评分长期方案的 P1b + P2（2026-09-25 用户批准）。\n\n用户已裁定：评分行的冷却口径「先出画布再定」。\n\n口径：遥测从 2026-09-05 起收 · 中国版一条不发 · 我们自己的机器也在里面 · install_id 按宿主分，App 与扩展不能当同一个人。星级评分数来自 iTunes lookup（按店面），文字评论来自 customerReviews。' };
idx.notes.rule = { x: NX, y: 600, w: 540, maxH: 360, page: 'p1', color: 'purple',
  text: '流程：画布 → 你逐条点头 → 改 docs/interaction-spec.md §评分提示 → 遥测 docs PR（修第 98 行 + App 送出点 + requested）过评审 → 先部署 bt-ingest → 代码 PR（标题写「画布落地」）。\n\n代码门禁：test/feedback.test.js 判定表 · test:layout（新 fixture：挂满后下一页不出，先红后绿）· test:smoke 第七幕 · test:app · test:listen · test:quick。' };

idx.notes.round2 = { x: NX, y: 1560, w: 540, maxH: 480, page: 'p1', color: 'green',
  text: '第二轮（09-25 下午）：用户问「为什么这么多人看到却没人评分？没有这个答案做什么都意义不大」→ 推两个分支（板 I）→ 发现苹果 5.6.1 禁止自定义评分提示 ⇒ Safari 那一行改「回 App」（板 J），Chrome / Firefox 照旧。\n\n✓ 09-25 用户：「451 我点头」—— 第二轮五件全部通过。规约 §3.12 已按第二轮重写并合入（#451）；落地 PR 进行中。' };
idx.notes.ruled = { x: NX, y: 1040, w: 540, maxH: 460, page: 'p1', color: 'green',
  text: '✓ 2026-09-25 用户裁定：板 C 四件**全部按建议**。\n\n① 评分行：每天至多一次、最多 5 个不同日子，点或 × 立刻进 90 天冷却\n② 只问成功 ≥3 次且跨 ≥2 天的人\n③ App 系统评分挪到听译结束 / 快速翻译 / 系统翻译收件箱 / 复习 opened，同一门槛\n④ 扩展与 App 冷却不打通，规约改成实话\n\n补记：板 B 那次唯一的点击，用户答「很可能是我点的」⇒ 真实点击按 0 算。① 选「按日」而不是「按次」的理由里，「保住第 4 天那次点击」这条不再成立；剩下的理由仍够：同样的曝光预算分散到回访的日子，比堆在同一天的连续页面合理，且最多一台从 98 次降到 5 次。不需要重新裁定。\n\n下一步：遥测 docs PR（§3.12）过评审 → 部署 bt-ingest → 代码 PR（interaction-spec 同提交改）。' };
fs.writeFileSync(path.join(OUT, 'canvas.json'), JSON.stringify(idx, null, 2) + '\n');
console.log('✓ design/rating-moments/project：' + order.length + ' 块板');
