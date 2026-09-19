// 第 1 页 · iPhone 系统翻译弹层（扩展进程里的 SwiftUI 界面）。
import { board, head, cell, cap, grid, hint, mini, pend, btn, ic, ibtn, err, S } from './00-base.mjs';

const PG = 'p1';
const host = (sel, n = 5) => `<div class="host">${'<div class="ln" style="width:92%"></div><div class="ln" style="width:78%"></div>'}<span class="sel">${sel}</span>${Array.from({ length: n }, (_, i) => `<div class="ln" style="width:${[88, 95, 70, 84, 60, 90][i % 6]}%"></div>`).join('')}</div>`;
// 一台手机：上半是宿主 App 的示意（被选中的字），下半是我们的弹层
export const phone = (sheetHtml, { sel = S.en, h = 720, dim = true, dark = false, w = 350 } = {}) =>
  `<div class="ctx${dark ? ' dark' : ''}" style="width:${w}px; height:${h}px">${host(sel)}${dim ? '<div class="dim"></div>' : ''}${sheetHtml}</div>`;
const header = (engine, { close = true } = {}) => `<div class="grab"></div><div class="sheet-h"><span class="brand"><span class="mark"></span>大肚猴翻译</span><span class="split">${engine ? `<span class="eng">${engine}</span>` : ''}${close ? ibtn('x', '关闭') : ''}</span></div>`;
const langrow = (from, to, { auto = false, note = '' } = {}) => `<div class="langrow"><span>${from}</span>${ic('swap', 'sm')}<button class="lchip${auto ? ' auto' : ''}" type="button">${to}${ic('chev', 'sm')}</button>${note ? `<span>${note}</span>` : ''}</div>`;
export const sheet = ({ engine = 'DeepSeek', src = S.en, lang = ['英语', '简体中文'], langOpt = {}, body = '', foot = '', tail = '', full = false } = {}) =>
  `<div class="sheet${full ? ' full' : ''}">${header(engine)}${src ? `<div class="src">${src}</div>` : ''}${lang ? langrow(lang[0], lang[1], langOpt) : ''}${body}${foot ? `<div class="foot">${foot}</div>` : ''}${tail}</div>`;
const skeleton = `<div class="trbox"><div class="sk" style="width:94%"></div><div class="sk" style="width:81%"></div><div class="sk" style="width:46%"></div></div>`;
const trbox = (t, extra = '') => `<div class="trbox"><div class="tr">${t}</div>${extra}</div>`;
const copyRow = `<div class="split" style="justify-content:flex-end">${ibtn('copy', '复制译文')}</div>`;

// 1–3 · 入口 → 加载 → 译文
board('Main.dc.html', 1200, 900, '入口 · 加载 · 译文', `${head('入口 → 加载 → 译文', '用户在任何 App 里选中文字，点系统菜单里的「翻译」。弹层由系统呈现，里面是我们的界面。')}
${grid(3, `
${cell('① 入口（系统的，不是我们画的）', '前提：设置 › 翻译 › 默认翻译 App 选了大肚猴翻译。', `<div class="ctx" style="width:350px; height:720px">${host(S.en)}<div style="position:absolute; top:96px; left:60px; background:#2b2723; color:#fff; border-radius:12px; padding:9px 14px; font-size:.84rem; display:flex; gap:16px"><span>拷贝</span><span>查询</span><b>翻译</b><span>共享…</span></div></div>`)}
${cell('② 加载', '原文<b>立刻</b>显示，译文位先出骨架。右上角小字是将要用的引擎 —— 用户一眼知道字发给了谁。', phone(sheet({ body: skeleton, foot: btn('取消', 's') })))}
${cell('③ 译文', '语言对由我们自己判（系统不给源语言）；目标语言可点开改，只在这一次弹层内生效。', phone(sheet({ body: trbox(S.zh, copyRow), foot: btn('完成', 'p') })))}
`)}`, { page: PG });

// 4 · 可替换
board('SheetReplace.dc.html', 1200, 900, '可替换原文', `${head('原文可替换时（系统给 allowsReplacement = true）', '只在可编辑的地方出现：备忘录、邮件正文、输入框。')}
${grid(3, `
${cell('可替换', '多一个主按钮「替换原文」；「完成」降为次级。', phone(sheet({ body: trbox(S.zh, copyRow), foot: btn('完成', 's') + btn('替换原文', 'p') })))}
${cell('不可替换', '按钮<b>不存在</b>，不是灰掉 —— 灰按钮会让人以为是自己没弄对。', phone(sheet({ body: trbox(S.zh, copyRow), foot: btn('完成', 'p') })))}
${cell('点了「替换原文」之后', '弹层由系统关闭，宿主 App 里那段字换成译文。撤销靠宿主 App 自己的 ⌘Z / 摇一摇，我们不另做。', `<div class="ctx" style="width:350px; height:720px"><div class="host" style="opacity:1"><div class="ln" style="width:92%"></div><div class="ln" style="width:78%"></div><span class="sel" style="background:#d9e6c4; color:#272e1b">${S.zh}</span><div class="ln" style="width:88%"></div><div class="ln" style="width:95%"></div><div class="ln" style="width:70%"></div></div></div>`)}
`)}`, { page: PG });

// 5 · 长文本
const para = (en, zh, state = 'ok') => `<div style="display:flex; flex-direction:column; gap:6px"><div class="src q" style="font-size:.84rem">${en}</div>${state === 'ok' ? `<div class="tr" style="font-size:.94rem">${zh}</div>` : '<div class="sk" style="width:88%"></div><div class="sk" style="width:52%"></div>'}</div>`;
board('SheetLong.dc.html', 1200, 920, '长文本', `${head('长文本', '选了一整段或一整页。')}
${grid(3, `
${cell('半屏 · 第一段先出', '按段翻、按段出；出第一段就请求系统把弹层展开。', phone(sheet({ src: '', lang: ['英语', '简体中文'], body: `<div class="trbox" style="gap:14px">${para('The committee postponed the vote until the new figures were published.', '委员会把表决推迟到新数据公布之后。')}${para('Members said the delay would give them time to study the revised forecast.', '', 'wait')}</div>`, foot: btn('取消', 's') })))}
${cell('展开后', '整屏可滚；每段原文在上（灰）、译文在下（鼠尾草绿），与网页双语同一套视觉。', phone(sheet({ full: true, src: '', body: `<div class="trbox" style="gap:14px">${para('The committee postponed the vote until the new figures were published.', '委员会把表决推迟到新数据公布之后。')}${para('Members said the delay would give them time to study the revised forecast.', '委员们说，推迟能让他们有时间研究修订后的预测。')}${para('A final decision is now expected in early November.', '', 'wait')}</div>`, foot: btn('复制全部译文', 's') + btn('完成', 'p') }), { h: 760 }))}
${cell('超过 2000 字', '照常翻译，但<b>不进复习库</b> —— 那是一篇文章，不是一张卡。底部一行说明，不弹框。', `<div class="ctx" style="width:350px; height:300px"><div class="sheet" style="margin-top:0; flex:1">${'<div class="grab"></div>'}<div class="disc" style="border-top:0; padding-top:0">这段很长（2,340 字），只翻译、不存入复习库。</div></div></div>${hint('某一段失败：那一段原地出「这段没翻出来 · 重试」，其余段落不受影响；不整页报错。')}`)}
`)}`, { page: PG });

// 6 · 同语言守卫 + 目标语言切换
const langMenu = `<div class="menu" style="position:absolute; right:22px; top:250px; width:210px">${['简体中文', '繁體中文', 'English', '日本語', '한국어', 'Français'].map((l, i) => `<div class="mi${i === 0 ? ' hot' : ''}"><span>${l}</span>${i === 0 ? ic('check', 'sm') : ''}</div>`).join('')}<div class="msep"></div><div class="mi off"><span>默认在 App 的设置里改</span></div></div>`;
board('SheetLang.dc.html', 1200, 900, '语言判定与切换', `${head('语言：我们自己判、用户可以改', '系统只给文字，不给源语言也不给目标语言。目标语言来自 App 设置里的「译成」。')}
${grid(3, `
${cell('原文已经是目标语言', '中文用户选了一段中文 ⇒ 自动反向译成英文，语言 chip 变绿并写明原因；不出「无需翻译」这种死路。', phone(sheet({ src: S.zhSrc, lang: ['简体中文', 'English'], langOpt: { auto: true, note: '原文已是中文' }, body: trbox(S.enFromZh, copyRow), foot: btn('完成', 'p') }), { sel: S.zhSrc }))}
${cell('点开目标语言', '只影响这一次弹层 —— 扩展回写不了 App 的设置。菜单最后一行指路。', `<div style="position:relative">${phone(sheet({ body: trbox(S.zh), foot: btn('完成', 'p') }))}${langMenu}</div>`)}
${cell('改了之后', '立刻按新语言重翻；译文位回到骨架。', phone(sheet({ lang: ['英语', '日本語'], body: skeleton, foot: btn('取消', 's') })))}
`)}${mini('判不出语种（太短、全是数字或专名）：按「不是目标语言」处理，正常翻译。不为了判语种多发一次请求。')}`, { page: PG });

// 7 · 慢速与超时
board('SheetSlow.dc.html', 1200, 900, '慢速与超时', `${head('慢的时候要诚实', '免费额度中位 5 秒、慢的时候 20 秒；放在系统弹层后面尤其显眼。')}
${grid(3, `
${cell('0–5 秒', '只有骨架。', phone(sheet({ engine: '免费额度', body: skeleton, foot: btn('取消', 's') })))}
${cell('5 秒后', '骨架下多一行：在等谁、为什么慢、怎么更快。不转圈、不假进度条。', phone(sheet({ engine: '免费额度', body: skeleton + `<div class="disc" style="border-top:0; padding-top:0">还在翻 —— 免费额度走我们的中转，比自己的 key 慢。</div>`, foot: btn('取消', 's') })))}
${cell('到了超时上限', '用 App 里设的「单次超时」；文案与网页翻译同一句。', phone(sheet({ engine: '免费额度', body: err('端点没有在超时前回应。', 'timeout'), foot: btn('完成', 's') + btn('重试', 'p') })))}
`)}${mini('取消 = 真的中断请求（不是只关界面）；已经花掉的额度照实计。')}`, { page: PG });

// 8 · 失败分态
const E = [
  ['断网', '现在没有网络。连上之后再试。', 'network', ['完成', '重试']],
  ['超时', '端点没有在超时前回应。', 'timeout', ['完成', '重试']],
  ['key 被拒', '服务商拒绝了这把 key（HTTP 401/403）。检查 key 是否填对、有没有这个模型的权限。', 'auth', ['完成', '打开大肚猴翻译']],
  ['额度用完（你的）', '免费额度已经用完了。你可以填一把自己的 key 继续用。', 'credit_exhausted', ['完成', '打开大肚猴翻译']],
  ['额度池空了（我们的）', '不是你用完了 —— 是我们这边的免费额度池空了，正在补。先用自己的 key，或者稍后再来。', 'grant_unavailable', ['完成', '重试']],
  ['模型被改过', '免费额度只能用它指定的那个模型。你在「详细」里改过模型 —— 改回去，或者填一把自己的 key。', 'model_not_allowed', ['完成', '打开大肚猴翻译']],
  ['其它 HTTP', 'HTTP 503 —— 服务端拒绝了这次请求。', 'http · 503', ['完成', '重试']],
  ['引擎不认识', '这个版本不认识当前存着的引擎，请在 App 里重新选一个。', 'unknown_provider', ['完成', '打开大肚猴翻译']],
  ['思考耗尽', '模型把整个输出预算用在了思考上，没有产出译文。到设置的「高级参数」里调高「单次最大输出长度」，或换一个非推理模型。', 'reasoning_starved', ['完成', '打开大肚猴翻译']],
];
const mini_sheet = (t, c, b) => `<div class="sheet" style="margin-top:0; border-radius:22px; box-shadow:0 2px 8px rgba(0,0,0,.08)"><div class="sheet-h"><span class="brand"><span class="mark"></span>大肚猴翻译</span></div><div class="src q" style="font-size:.84rem">${S.en}</div>${err(t, c)}<div class="foot">${btn(b[0], 's', 'sm')}${btn(b[1], 'p', 'sm')}</div></div>`;
board('SheetErrors.dc.html', 1200, 1180, '失败分态', `${head('失败：每个错误码一句具名的话 + 一个出口', '文案逐字复用产品里已有的那几句（不另写一份）。原文始终留着 —— 失败不该连用户选的字也一起吞掉。')}
${grid(3, E.map(([n, t, c, b]) => cell(n, '', mini_sheet(t, c, b))).join(''), 18)}
${mini('出口只有两种：「重试」（问题可能自己好）与「打开大肚猴翻译」（要去 App 里改配置）。能重试的不指去 App，要改配置的不给「重试」—— 给了也是再失败一次。')}`, { page: PG, gap: 16 });

// 9 · 未配置态
const unconf = (title, body, foot, tail = '') => `<div class="sheet" style="margin-top:auto">${header('', {})}<div class="src q" style="font-size:.84rem">${S.en}</div><div class="trbox"><b style="font-size:.95rem">${title}</b><div class="hint" style="font-size:.86rem">${body}</div></div><div class="foot" style="flex-direction:column; align-items:stretch">${foot}</div>${tail}</div>`;
board('SheetUnconfigured.dc.html', 1200, 900, '未配置的三种情形', `${head('还翻不了的时候', '弹层读不到可用的引擎配置。三种原因，三句不同的话。')}
${grid(3, `
${cell('① 从没配过引擎', '国际版：主行动是免费额度（登录即可用），次行动是自己的 key。', phone(unconf('还没有翻译引擎', '领一份免费额度，登录一下就能翻；也可以填自己的 API key。', btn('领免费额度', 'p') + btn('用自己的 key', 's'))))}
${cell('② App 里配了，但还没同步过来', '装了新版还没打开过 App，或刚在 App 里清过数据。', phone(unconf('打开一次 App 就好', 'App 里的引擎配置要同步给系统翻译才用得上 —— 打开一次即可，之后不用再管。', btn('打开大肚猴翻译', 'p'))))}
${cell(`③ 弹层里拉不起 App ${pend('T1')}`, '如果系统不允许从弹层里打开 App：按钮整个不出现，只留文字指路。', phone(unconf('还没有翻译引擎', '到主屏幕打开「大肚猴翻译」，在设置里领免费额度或填自己的 key，再回来翻。', btn('知道了', 's'))))}
`)}${mini('中国版：①里没有「领免费额度」，只有「配置引擎」一个主按钮。见第 6 页「中国版总览」。')}`, { page: PG });

// 10–11 · 空输入、首次披露、采集提示
board('SheetEdge.dc.html', 1200, 900, '空输入 · 首次披露 · 采集提示', `${head('边角', '')}
${grid(3, `
${cell('选中的只有空白或符号', '不发请求，不报错。', phone(sheet({ engine: '', src: '', lang: null, body: `<div class="trbox"><div class="hint" style="font-size:.9rem">没有可翻译的文字。</div></div>`, foot: btn('完成', 'p') }), { sel: '· · · — — 2026' }))}
${cell('第一次使用：一行披露', '只出现一次，读过即止。说清三件事：字发给谁、我们不经手、在哪关采集。', phone(sheet({ body: trbox(S.zh, copyRow), foot: btn('完成', 'p'), tail: `<div class="disc">选中的文字会直接发给你配置的引擎（DeepSeek），不经过我们的服务器。<a href="#p">了解更多</a></div>` })))}
${cell('采集开着时', '译文下方一行小字；关采集在 App 里，弹层不放开关（弹层是一次性的，开关该在一个找得回来的地方）。', phone(sheet({ body: trbox(S.zh, copyRow), foot: btn('完成', 'p'), tail: `<div class="disc">这句会存入复习库 · 在 App 的设置里可关</div>` })))}
`)}${mini('用免费额度时披露那句换成：「选中的文字会经我们的中转发给 OpenRouter，我们不保存内容。」—— 与免费额度在别处的披露同一句。')}`, { page: PG });

// 12 · 形态变体
board('SheetVariants.dc.html', 1560, 900, 'iPad · 深色 · 从右到左 · 大字号', `${head('形态变体', '同一个界面，四种要单独看一眼的情形。')}
<div style="display:flex; gap:26px; align-items:flex-start">
${cell(`iPad ${pend('T1')}`, 'iPad 上系统可能给气泡而不是底部弹层；宽度固定在 420 上下，不铺满。', `<div class="ctx" style="width:520px; height:720px">${host(S.en, 8)}<div class="dim"></div><div class="sheet" style="margin:auto auto 40px; width:400px; border-radius:24px">${header('DeepSeek')}<div class="src">${S.en}</div>${langrow('英语', '简体中文')}${trbox(S.zh)}<div class="foot">${btn('完成', 'p')}</div></div></div>`)}
${cell('深色', '跟随系统；译文用深色的鼠尾草绿 #aebf92，对比度 ≥ 4.5:1。', `<div class="dark">${phone(sheet({ body: trbox(S.zh, copyRow), foot: btn('完成', 'p') }), { dark: true })}</div>`)}
${cell('阿拉伯语界面（从右到左）', '整个弹层镜像；原文保持自己的书写方向。', `<div dir="rtl">${phone(`<div class="sheet"><div class="grab"></div><div class="sheet-h"><span class="brand"><span class="mark"></span>BelliedMonkey</span><span class="eng">DeepSeek</span></div><div class="src" dir="ltr" style="text-align:left">${S.en}</div><div class="trbox"><div class="tr" style="font-size:1.05rem">${S.ar}</div></div><div class="foot">${btn('تم', 'p')}</div></div>`)}</div>`)}
${cell('最大动态字号', '按钮纵向堆叠，译文区可滚；不截断、不缩字。', phone(`<div class="sheet"><div class="grab"></div><div class="sheet-h"><span class="brand" style="font-size:1.2rem"><span class="mark"></span>大肚猴翻译</span></div><div class="src" style="font-size:1.25rem">The committee postponed the vote…</div><div class="trbox"><div class="tr" style="font-size:1.45rem">委员会把表决推迟到新数据公布之后。</div></div><div class="foot" style="flex-direction:column; align-items:stretch"><button class="btn p" type="button" style="font-size:1.2rem; min-height:56px">完成</button></div></div>`))}
</div>`, { page: PG });
