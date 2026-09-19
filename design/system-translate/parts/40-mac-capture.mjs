// 第 4 页 · Mac：增强取词（可选权限）与截图翻译。
import { board, head, cell, grid, hint, mini, btn, ic, keys, pend, sw, card, S } from './00-base.mjs';
import { panel } from './30-mac-panel.mjs';

const PG = 'p4';
const tr = (t) => `<div class="tr" style="padding:0 2px">${t}</div>`;
const sys = (title, body, a, b) => `<div class="sys"><b>${title}</b><span>${body}</span><div class="sb"><span>${a}</span><span class="p">${b}</span></div></div>`;
const swRow = (on, small) => `<section class="card">${sw('增强取词', small, on)}</section>`;

// 28 · 增强取词全流程
board('EnhancedFlow.dc.html', 1700, 760, '增强取词 · 开关全流程', `${head('增强取词：默认关，打开才问权限', '开了之后：选中文字直接按快捷键，不用先 ⌘C。')}
${grid(5, `
${cell('① 默认（关）', '', swRow(false, '选中文字后直接按快捷键，不用先 ⌘C'))}
${cell('② 点开关 ⇒ 我们先说清楚', '系统弹窗之前，自己的话先到。「做什么 / 不做什么」各两条。', `<section class="card" style="gap:10px"><h3>打开增强取词</h3><div class="hint" style="font-size:.86rem; color:var(--text)"><b>会做：</b>你按快捷键时，替你按一次 ⌘C；读到选中的文字后，把剪贴板恢复成原来的样子。<br><b>不会做：</b>不监听键盘，不在你没按快捷键时读任何东西。</div><div class="split">${btn('继续', 'p', 'sm')}${btn('先不开', 's', 'sm')}</div></section>`)}
${cell('③ 系统权限弹窗', '由系统呈现。我们用系统的请求接口，App 会自己出现在列表里 —— <b>任何地方都不出现「请手动把 App 拖进列表」的教程</b>。', sys('「大肚猴翻译」想要控制这台电脑', '允许后，它可以代你发送按键。', '拒绝', '打开系统设置'))}
${cell('④ 允许了 ⇒ 要重开一次', 'T2 读数：授权后<b>正在运行的 App 读不到新权限</b>，重开后立刻读到。所以这一态不是「已生效」，而是一句话 + 重开按钮（与截图权限同一形状）。重开后开关变绿。', `<section class="card">${sw('增强取词', '已允许 · 重新打开后生效', true)}<div class="split">${btn('现在重开', 'p', 'sm')}${btn('稍后', 's', 'sm')}</div></section>`)}
${cell('⑤ 拒绝了', '开关弹回「关」，一句话 + 出口。零权限那条路照常能用。', `<section class="card">${sw('增强取词', '', false)}<div class="note w">系统没有给权限，增强取词没打开。先 ⌘C 再按快捷键照常能用。</div><div class="split">${btn('打开系统设置', 's', 'sm')}</div></section>`)}
`, 18)}
${mini('事后被撤销（用户在系统设置里关掉了）：下一次按快捷键时自动退回「翻译剪贴板」，面板顶上一行「增强取词的权限被关掉了 · 重新打开」；设置里的开关同步弹回「关」。不报错、不卡住。')}`, { page: PG });

// 29 · 增强取词的失败支
board('EnhancedFail.dc.html', 1320, 680, '增强取词 · 失败支', `${head('开了增强取词之后，仍然取不到字的时候', '')}
${grid(3, `
${cell('没有选中，或这个 App 不让复制', '判据：发出 ⌘C 后 0.3 秒内剪贴板没变。<b>此时什么都不翻</b> —— 绝不退回去翻旧剪贴板。', panel({ tag: '选中文字', lang: null, src: null, body: `<div class="hint" style="font-size:.9rem">没有取到选中的文字 —— 可能没有选中，或这个 App 不允许复制。</div><div class="split">${btn('改用截图翻译', 's', 'sm')}</div>`, foot: null }))}
${cell('剪贴板原样奉还', '用户此前复制的东西（文字、图片、文件）在取词后完好如初。这是不变量，不是「尽量」。', `<div class="flow" style="grid-template-columns:1fr"><div class="node">记下剪贴板现在的全部内容</div><div class="arr">↓</div><div class="node">替你按 ⌘C ⇒ 读到选中的文字</div><div class="arr">↓</div><div class="node s">把第一步记下的内容原样写回</div></div>${hint('取到的文字若带「隐藏」标记，同样不读、不发（同「三个陷阱」③）。')}`)}
${cell('系统收紧「剪贴板隐私」之后', 'T2 读数（打开系统的预览开关后）：后台读剪贴板那一步<b>直接卡住 90 秒以上不返回</b>，屏幕上也看不到提示。目前系统默认不开。实现上读剪贴板放到后台并设 1 秒上限；超时就当「没取到」，面板说一句并指向截图翻译 —— 绝不让面板跟着卡死。', panel({ tag: '选中文字', lang: null, src: null, body: `<div class="hint" style="font-size:.9rem">系统没有让我们读到剪贴板。到 系统设置 › 隐私与安全性 › 粘贴 里允许大肚猴翻译，或改用截图翻译。</div><div class="split">${btn('改用截图翻译', 's', 'sm')}</div>`, foot: null }))}
`)}`, { page: PG });

// 30 · 截图翻译全流程
const shotDesk = (inner) => `<div class="desk" style="height:330px">${inner}</div>`;
const fakeDoc = `<div class="hostwin" style="left:20px; top:24px; width:300px; height:270px"><div style="font-size:.8rem; line-height:1.6; color:var(--text)">Quarterly revenue rose 8%, driven by stronger demand in Asia.</div>${[92, 80, 88, 60].map((p) => `<div style="height:8px; border-radius:999px; background:var(--track); width:${p}%"></div>`).join('')}</div>`;
board('ShotFlow.dc.html', 1700, 800, '截图翻译 · 全流程', `${head('截图翻译', '给不能选、不能复制的字用：图片、视频画面、扫描件、游戏。文字识别在本机完成，截图不离开设备。')}
${grid(5, `
${cell('① 第一次：系统要屏幕录制权限', '系统弹窗。我们在它之前先说一句「只在你框选的那一刻截那一块」。', `<div style="display:flex; flex-direction:column; gap:10px; align-items:flex-start"><div class="note" style="font-size:.82rem">截图翻译要用到「屏幕录制」权限。只在你框选的那一刻截你框的那一块，识别完即丢弃。</div>${sys('「大肚猴翻译」想要录制这台电脑的屏幕', '', '不允许', '允许')}</div>`)}
${cell('② 授权后要重开 App', '系统的规矩：这项权限重开 App 才生效。一句话 + 一个按钮，别让用户以为坏了。', `<section class="card"><h3>还差一步</h3>${hint('权限已经给了，但要重新打开大肚猴翻译才生效。')}<div class="split">${btn('现在重开', 'p', 'sm')}</div></section>`)}
${cell('③ 框选', '全屏变暗，十字光标，拖出矩形；右下角标尺寸；' + keys('Esc') + ' 取消。多屏时每块屏各一层。', shotDesk(`${fakeDoc}<div class="selbox" style="left:34px; top:50px; width:272px; height:58px"></div><div class="dimtag" style="left:238px; top:114px">272 × 58</div>`))}
${cell('④ 识别中', '面板立刻出现在选区旁，来源标签「截图」。T2 读数：平时截图 60 毫秒 + 识别 0.1–0.4 秒；但一台机器上的<b>第一次</b>识别要 20 秒量级（系统在准备模型）⇒ 第一次多一行说明，并在 App 空闲时提前预热。', panel({ tag: '截图', lang: null, src: null, body: `<div style="display:flex; flex-direction:column; gap:8px; padding:4px 2px"><div class="sk" style="width:90%"></div><div class="sk" style="width:58%"></div></div><div class="mini">正在本机识别文字…</div><div class="mini">（这台 Mac 上第一次用：要准备一下，大约 20 秒，之后每次不到半秒）</div>`, foot: null, width: 300 }))}
${cell('⑤ 结果', '识别出的原文<b>可编辑</b>（认错一个字就地改、回车重翻）。', panel({ tag: '截图', src: 'Quarterly revenue rose 8%, driven by stronger demand in Asia.', body: tr('季度营收增长 8%，得益于亚洲需求走强。'), foot: '', width: 300 }))}
`, 18)}
${mini('权限被拒：面板里一句「没有屏幕录制权限，截图翻译用不了」+「打开系统设置」。菜单栏与设置里的入口照常在 —— 入口不因为权限被拒而消失，否则用户找不到地方重新打开。')}`, { page: PG });

// 31 · 截图失败支
board('ShotFail.dc.html', 1320, 680, '截图翻译 · 失败支', `${head('截图之后没翻出来的时候', '')}
${grid(4, `
${cell('没认出文字', '引擎<b>不</b>支持识图时：只有「换个区域」。', panel({ tag: '截图', lang: null, src: null, body: `<div class="hint" style="font-size:.9rem">这一块里没有认出文字。</div><div class="split">${btn('重新框选', 'p', 'sm')}</div>`, foot: null, width: 290 }))}
${cell('没认出文字 · 引擎支持识图', '多一个次级按钮。<b>点了之后，截图才会离开设备</b>，按钮旁写明发给谁。', panel({ tag: '截图', lang: null, src: null, body: `<div class="hint" style="font-size:.9rem">这一块里没有认出文字。</div><div class="split">${btn('重新框选', 'p', 'sm')}${btn('用我的识图引擎再试', 's', 'sm')}</div><div class="mini">会把这张截图发给你配置的引擎（OpenAI）。</div>`, foot: null, width: 290 }))}
${cell('选区太小', '小于 12 × 12：当作误触，直接取消，不出面板。', `<div class="old"><div class="c"><span>（什么都不出现）</span></div></div>`)}
${cell('macOS 低于 14', '入口整个不出现：菜单栏没有这一项，设置块里这一行写明原因。', `<section class="card"><div class="row"><div class="l"><span style="opacity:.55">截图翻译</span><small>需要 macOS 14 或更新的系统</small></div></div></section>`)}
`, 20)}${mini('认出的字里夹着目标语言（一张中英混排的图）：整段照翻，不逐行挑 —— 挑错比多翻一行更糟。')}`, { page: PG });
