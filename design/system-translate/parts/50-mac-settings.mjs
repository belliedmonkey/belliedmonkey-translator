// 第 5 页 · Mac：设置块、快捷键录制、常驻行为、首次介绍与复习库分组。
import { board, head, cell, grid, hint, mini, btn, sw, card, keys, ic } from './00-base.mjs';

const PG = 'p5';
const rec = (state) => ({
  empty: `<div class="rec"><span style="color:var(--muted)">未设置</span>${btn('录制', 's', 'sm')}</div>`,
  live: `<div class="rec live"><span>按下想用的组合…</span>${btn('取消', 's', 'sm')}</div>`,
  set: `<div class="rec">${keys('⌃', '⌥', 'T')}<span class="split" style="gap:4px">${btn('改', 's', 'sm')}${btn('清除', 's', 'sm')}</span></div>`,
  clash: `<div class="rec bad">${keys('⌘', '⇧', '4')}<span style="font-size:.8rem">被系统占用（截屏）</span></div>`,
  deny: `<div class="rec bad">${keys('⌥', 'D')}<span style="font-size:.8rem">换一个带 ⌃ 或 ⌘ 的</span></div>`,
}[state]);
const field = (label, inner, small = '') => `<div class="field"><label>${label}</label>${inner}${small ? `<span class="mini">${small}</span>` : ''}</div>`;

// 32 · 设置块
const block = (detail) => card('快速翻译', `
${sw('在菜单栏常驻', '关掉后菜单栏图标消失，关闭窗口即退出 App', true)}
${field('翻译选中的文字或剪贴板', rec('set'))}
${field('截图翻译', `<div class="rec">${keys('⌃', '⌥', 'S')}<span class="split" style="gap:4px">${btn('改', 's', 'sm')}${btn('清除', 's', 'sm')}</span></div>`)}
${detail ? field('输入翻译', rec('empty')) : ''}
${sw('增强取词', '选中文字后直接按快捷键，不用先 ⌘C · 需要一项系统权限', false)}
${detail ? `<div class="dep"><b>屏幕录制</b> · 已允许 <span class="ok">✓</span>（截图翻译用）</div>` : ''}
${sw('存入复习库', '翻过的句子进复习，来源「快速翻译」', true)}
${detail ? sw('登录时启动', '开机后自动待在菜单栏', false) : ''}
${detail ? `<div class="split"><a href="#svc">给右键「服务」绑快捷键 →</a></div>` : ''}`, '选字 · 截图 · 输入');
board('MacSettings.dc.html', 1000, 900, 'App 设置 ·「快速翻译」块', `${head('App 设置里的「快速翻译」块', '只在 Mac 上出现，放在「功能」一节。「快速 / 详细」只管「引擎与密钥」一节 —— 这一块两档下都在，但详细档多露几行。')}
${grid(2, `
${cell('快速档', '够用的最少几行。', block(false))}
${cell('详细档', '多出：输入翻译的快捷键、屏幕录制权限状态、登录时启动（<b>默认关</b>）、服务菜单指引。', block(true))}
`)}${mini('「译成」不在这一块 —— 它在「语言」卡里，是全 App 共用的一个值。')}`, { page: PG });

// 33 · 快捷键录制五态
board('HotkeyRecorder.dc.html', 1320, 460, '快捷键录制 · 五态', `${head('快捷键录制控件', '新控件族，只此一份组件；三个快捷键共用。')}
${grid(5, `
${cell('空', '', rec('empty'))}
${cell('录制中', '此时按 ' + keys('Esc') + ' = 取消，不是把 Esc 设成快捷键。', rec('live'))}
${cell('已设', '', rec('set'))}
${cell('冲突', '系统或别的 App 已经占了：不保存，留着上一个值。', rec('clash'))}
${cell('被拒绝的组合', '只有 ⌥ 加字母 / 数字：这类组合在新系统上对沙盒 App 不稳，直接不让设，并说怎么改。', rec('deny'))}
`, 18)}${mini('默认值：翻译 ⌃⌥T · 截图 ⌃⌥S · 输入翻译留空。「恢复默认」在块的右上角，一键回到这三个值。')}`, { page: PG });

// 34 · 常驻行为
board('Resident.dc.html', 1240, 560, '常驻行为', `${head('关掉窗口之后', '为了让快捷键随时可用，App 要留在菜单栏里。这改变了一个老行为，所以第一次要说。')}
${grid(3, `
${cell('第一次关主窗口', '一次性提示，之后不再出现。', `<section class="card"><h3>大肚猴还在菜单栏</h3>${hint('快捷键照常可用。要完全退出，用菜单栏图标里的「退出」，或按 ⌘Q。')}<div class="split">${btn('知道了', 'p', 'sm')}<a href="#off">不想常驻 →</a></div></section>`)}
${cell('「不想常驻」', '带到设置块，那个开关就是答案。', `<section class="card">${sw('在菜单栏常驻', '关掉后菜单栏图标消失，关闭窗口即退出 App', false)}</section>`)}
${cell('关掉常驻之后', '回到今天的行为：关窗即退出；快捷键与服务菜单随之失效（App 没在跑）。实时字幕进行中仍照旧不退出 —— 那条规则不变。', `<div class="old"><div class="c"><span>菜单栏：没有图标</span></div><div class="c"><span>关闭主窗口 ⇒ App 退出</span></div><div class="c"><span>实时字幕进行中 ⇒ 不退出（原规则）</span></div></div>`)}
`)}`, { page: PG });

// 35–36 · 首次介绍卡、复习库分组
const way = (icon, t, s) => `<div style="display:flex; gap:10px; align-items:flex-start">${ic(icon)}<div class="cap"><b>${t}</b><span>${s}</span></div></div>`;
board('MacIntro.dc.html', 1240, 560, '首次介绍卡 · 复习库分组', `${head('让人知道有这回事', '')}
${grid(2, `
${cell('App 首页的介绍卡（Mac）', '升级到这一版后出现一次，可关。三种用法各一行。', `<section class="card" style="gap:14px"><h3>在任何 App 里翻译</h3>${way('type', '选中文字', '先 ⌘C，再按 ⌃⌥T；或右键 › 服务 › 用大肚猴翻译')}${way('crop', '截图', '按 ⌃⌥S 框一块，图片和视频里的字也能翻')}${way('clip', '输入', '从菜单栏图标里打开，打字或粘贴')}<div class="split">${btn('改快捷键', 's', 'sm')}${btn('知道了', 'p', 'sm')}</div></section>`)}
${cell('复习库 · 来源分组', '按入口 + 月份。来源行纯文字、不可点。', card('来源', ['划词翻译 · 2026-09|34 句', '截图翻译 · 2026-09|9 句', '输入翻译 · 2026-09|5 句', '系统翻译 · 2026-09（来自 iPhone，登录同步后可见）|12 句'].map((r) => { const [a, b] = r.split('|'); return `<div class="qs-row"><span>${a}</span><span class="stat">${b}</span></div>`; }).join('')))}
`)}`, { page: PG });
