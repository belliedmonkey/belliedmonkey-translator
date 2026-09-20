// 第 6 页 · 全局：两张状态机、权限与披露时序、文案总表、中国版与深色总览。
import { board, head, cell, grid, hint, mini, btn, keys, pend, S } from './00-base.mjs';
import { phone, sheet } from './10-phone-sheet.mjs';
import { panel } from './30-mac-panel.mjs';

const PG = 'p6';
const n = (t, k = '') => `<div class="node${k ? ' ' + k : ''}">${t}</div>`;
const a = (t = '→') => `<div class="arr">${t}</div>`;
const lane = (label, nodes) => `<div style="display:grid; grid-template-columns:150px minmax(0,1fr); gap:14px; align-items:center"><div class="lbl">${label}</div><div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">${nodes}</div></div>`;

// 37a · iPhone 弹层状态机
board('FlowPhone.dc.html', 1500, 760, '状态机 · iPhone 系统翻译弹层', `${head('状态机 · iPhone 弹层', '每个状态都有出口；没有任何一态只能靠下拉关掉。')}
<div style="display:flex; flex-direction:column; gap:16px">
${lane('进来', n('系统交来文字', 's') + a() + n('空白 / 只有符号？') + a('是 →') + n('「没有可翻译的文字」', 'x'))}
${lane('能不能翻', n('读同步过来的引擎配置') + a() + n('没有 ⇒ 未配置三态之一 · 打开 App / 知道了', 'w') + a('有 →') + n('判语种 ⇒ 定目标语言（同语言则反向）'))}
${lane('翻', n('加载（原文 + 骨架）', 's') + a() + n('5 秒未回 ⇒ 多一行「还在翻」') + a() + n('到超时上限 ⇒ 超时', 'w') + a('或 →') + n('取消 ⇒ 关', 'x'))}
${lane('翻成了', n('译文', 's') + a() + n('可替换？⇒ 多「替换原文」') + a() + n('改目标语言 ⇒ 回到加载') + a() + n('替换 ⇒ 系统关掉；否则走右上角 ✕', 'x'))}
${lane('翻成了 · 副作用', n('采集开着 且 ≤ 2000 字 且 译文 ≠ 原文') + a() + n('写一条进收件箱') + a('否则 →') + n('什么都不写', 'x'))}
${lane('没翻成', n('具名错误（9 种）', 'w') + a() + n('能自己好的 ⇒ 重试 ⇒ 回到加载') + a('要改配置的 →') + n('打开大肚猴翻译', 'x'))}
</div>${mini('弹层是一次性的：关掉即销毁，不留状态。目标语言的临时改动不带到下一次。')}`, { page: PG });

// 37b · Mac 面板状态机
board('FlowMac.dc.html', 1500, 860, '状态机 · Mac 快速翻译', `${head('状态机 · Mac', '五个入口，汇到同一个面板。')}
<div style="display:flex; flex-direction:column; gap:16px">
${lane('快捷键 ⌃⌥T', n('增强取词开着且有权限？') + a('是 →') + n('替按 ⌘C ⇒ 0.3 秒内剪贴板变了？') + a('变了 →') + n('取到文字 ⇒ 还原剪贴板', 's') + a('没变 →') + n('「没有取到选中的文字」· 改用截图', 'w'))}
${lane('', n('否（默认）⇒ 读剪贴板') + a() + n('带隐藏标记 ⇒ 不读不发', 'w') + a() + n('空 / 不是文字 ⇒ 教两条路', 'w') + a() + n('与上次相同 ⇒ 显示上次结果 + 提醒') + a() + n('拿到文字', 's'))}
${lane('右键 › 服务', n('宿主 App 交来文字', 's') + a() + n('拿到文字', 's'))}
${lane('截图 ⌃⌥S', n('有屏幕录制权限？') + a('没有 →') + n('系统弹窗 ⇒ 允许 ⇒ 提示重开 App', 'w') + a('有 →') + n('框选（Esc 取消 / 太小忽略）') + a() + n('本机识别') + a('空 →') + n('重新框选 / 用识图引擎再试', 'w') + a('有字 →') + n('拿到文字', 's'))}
${lane('输入', n('面板带焦点打开', 's') + a() + n('回车') + a() + n('拿到文字', 's'))}
${lane('拿到文字之后', n('没配引擎 ⇒ 打开设置', 'w') + a() + n('加载') + a() + n('译文（可改原文回车重翻、改目标语言）', 's') + a() + n('失败 ⇒ 重试 / 打开设置', 'w'))}
${lane('副作用', n('采集开着 且 不太长 且 译文 ≠ 原文') + a() + n('交给主窗口那一页写进复习库（面板自己不写）') + a() + n('面板底栏显示「已存入」', 's'))}
${lane('消失', n('Esc · ✕') + a() + n('点外面 / 切 App（没钉住时）') + a() + n('再次触发 ⇒ 同一面板换内容', 'x'))}
</div>`, { page: PG });

// 38 · 权限与披露时序
const tl = (when, ours, system, after) => `<tr><td><b>${when}</b></td><td>${ours}</td><td>${system}</td><td>${after}</td></tr>`;
board('PermTimeline.dc.html', 1500, 640, '权限与披露 · 时序', `${head('什么时候第一次问什么', '原则：系统弹窗之前，我们自己的一句话先到；不用的功能永远不问。')}
<table class="tbl" style="font-size:.88rem"><tr><th style="width:18%">时刻</th><th style="width:34%">我们先说的</th><th style="width:22%">系统问的</th><th>被拒之后</th></tr>
${tl('iPhone · 第一次用系统翻译', '弹层底部一行：选中的文字会直接发给你配置的引擎，不经过我们的服务器。不可点、不拦路。', '系统先弹一页：「所选内容将发送给大肚猴翻译进行翻译处理 · 继续 / 更改默认翻译App」', '用户点「更改默认翻译App」⇒ 回到系统设置，与我们无关')}
${tl('Mac · 装上 / 升级后', '首页介绍卡：三种用法。不要任何权限。', '（无）', '—')}
${tl('Mac · 第一次关主窗口', '「大肚猴还在菜单栏」一次性提示。', '（无）', '—')}
${tl('Mac · 打开「增强取词」', '说明卡：会做什么 / 不会做什么。授权后一句「重新打开后生效」+ 重开按钮。', '「想要控制这台电脑」', '开关弹回，零权限路径照常')}
${tl('Mac · 第一次截图翻译', '一句：只在你框选的那一刻截你框的那一块，识别完即丢弃。', '「想要录制屏幕」→ 之后提示重开 App', '面板里一句 + 打开系统设置；入口不消失')}
${tl('Mac · 点「用我的识图引擎再试」', '按钮旁：会把这张截图发给你配置的引擎（引擎名）。', '（无）', '—')}
${tl('Mac · 系统收紧剪贴板之后', '面板里一句：系统没有让我们读到剪贴板 + 去哪里允许 + 改用截图翻译。', '（目前默认不问；开启后后台读取会卡住）', '读取 1 秒超时 ⇒ 当作没取到，面板不卡')}
${tl('Mac · 打开「登录时启动」', '开关的小字：开机后自动待在菜单栏。默认关。', '系统在「登录项」里列出我们', '—')}
</table>${mini('麦克风、语音识别、音频采集这些已有的权限，和这两个新功能无关，不会因为它们被问到。')}`, { page: PG });

// 39 · 文案总表
const row = (k, t, where, neu = true) => `<tr><td class="code">${k}</td><td>${t}</td><td>${where}</td><td>${neu ? '新' : '复用'}</td></tr>`;
board('CopyTable.dc.html', 1500, 1500, '文案总表', `${head('文案总表', '新文案每句 12 个语种；标「复用」的逐字用产品里已有的那一句，不另写。隐私披露的几句单列在最前 —— 商店、官网、README 的隐私说明要与它们同口径。')}
<table class="tbl" style="font-size:.84rem"><tr><th style="width:20%">key</th><th>中文</th><th style="width:22%">出现在</th><th style="width:6%"></th></tr>
<tr><td colspan="4" class="lbl" style="padding-top:12px">隐私披露（发布门禁原样引用）</td></tr>
${row('sys_disclose_direct', '选中的文字会直接发给你配置的引擎（{engine}），不经过我们的服务器。', 'iPhone 弹层 · 首次')}
${row('sys_disclose_grant', '选中的文字会经我们的中转发给 {vendor}，我们不保存内容。', 'iPhone 弹层 · 首次（用免费额度时）')}
${row('sys_capture_line', '这句会存入复习库 · 在 App 的设置里可关', 'iPhone 弹层')}
${row('quick_enh_does', '你按快捷键时，替你按一次 ⌘C；读到选中的文字后，把剪贴板恢复成原来的样子。', 'Mac · 增强取词说明卡')}
${row('quick_enh_doesnt', '不监听键盘，不在你没按快捷键时读任何东西。', 'Mac · 增强取词说明卡')}
${row('quick_shot_pre', '截图翻译要用到「屏幕录制」权限。只在你框选的那一刻截你框的那一块，识别完即丢弃。', 'Mac · 首次截图')}
${row('quick_shot_cloud', '会把这张截图发给你配置的引擎（{engine}）。', 'Mac · 识图再试按钮旁')}
${row('quick_clip_concealed', '剪贴板里的内容被标记为隐藏（多半是密码），没有读取，也没有发出去。', 'Mac 面板')}
<tr><td colspan="4" class="lbl" style="padding-top:12px">iPhone 系统翻译</td></tr>
${row('sys_empty', '没有可翻译的文字。', '弹层')}
${row('sys_slow', '还在翻 —— 免费额度走我们的中转，比自己的 key 慢。', '弹层 / 面板 · 5 秒后')}
${row('sys_long', '这段很长（{n} 字），只翻译、不存入复习库。', '弹层')}
${row('sys_same_lang', '原文已是{lang}', '语言 chip 旁')}
${row('sys_replace', '替换原文', '弹层按钮')}
${row('sys_none_title / _body', '还没有翻译引擎 / 领一份免费额度，登录一下就能翻；也可以填自己的 API key。', '弹层 · 未配置①')}
${row('sys_sync_title / _body', '打开一次 App 就好 / App 里的引擎配置要同步给系统翻译才用得上 —— 打开一次即可，之后不用再管。', '弹层 · 未配置②')}
${row('sys_open_app', '打开大肚猴翻译', '弹层按钮')}
${row('sys_from_system', '从系统翻译过来的：配好引擎后，回到刚才的 App 再点一次「翻译」。', 'App 设置页顶部（从弹层跳来时）')}
${row('sys_block_title / _use', '系统翻译 / 在任何 App 里选字 › 翻译', 'App 设置块')}
${row('sys_block_old', '需要 iOS 18.4 或更新的系统', 'App 设置块')}
${row('sys_block_synced', '{engine} ✓ 已同步给系统翻译 · 译成 {lang}', 'App 设置块')}
${row('sys_guide_1..3', '打开 iPhone 的「设置」/ 往下找到「翻译」/ 点「默认翻译 App」，选「大肚猴翻译」', 'App 设置块 · 首页发现卡')}
${row('sys_discover_title / _body', '让 iPhone 自带的「翻译」用上大肚猴 / 在任何 App 里选中文字 › 翻译，弹出来的就是你配的引擎。设一次就好。', 'App 首页')}
${row('handoff_capture', '存入复习库', '两个设置块的开关')}
${row('src_handoff_system / _select / _shot / _input', '系统翻译 · {month} / 划词翻译 · {month} / 截图翻译 · {month} / 输入翻译 · {month}', '来源管理')}
${row('target_lang / _follow', '译成 / 跟随界面语言（{lang}）', 'App 设置 · 语言卡')}
<tr><td colspan="4" class="lbl" style="padding-top:12px">Mac 快速翻译</td></tr>
${row('quick_menu_translate / _shot / _input', '翻译选中的文字或剪贴板 / 截图翻译 / 输入翻译', '菜单栏菜单')}
${row('quick_service', '用大肚猴翻译', '系统的「服务」菜单')}
${row('quick_tag_*', '选中文字 / 剪贴板 / 截图 / 输入 / 服务', '面板来源标签')}
${row('quick_clip_empty', '剪贴板里没有文字。先选中并按 ⌘C，再按 {hotkey}。', '面板')}
${row('quick_clip_same', '和上次翻的是同一段 —— 是不是忘了按 ⌘C？', '面板')}
${row('quick_no_selection', '没有取到选中的文字 —— 可能没有选中，或这个 App 不允许复制。', '面板（增强取词）')}
${row('quick_enh_revoked', '增强取词的权限被关掉了 · 重新打开', '面板')}
${row('quick_enh_relaunch', '已允许 · 重新打开后生效', '设置块 · 增强取词授权后')}
${row('quick_clip_blocked', '系统没有让我们读到剪贴板。到 系统设置 › 隐私与安全性 › 粘贴 里允许大肚猴翻译，或改用截图翻译。', '面板')}
${row('quick_shot_first', '这台 Mac 上第一次用：要准备一下，大约 20 秒，之后每次不到半秒', '面板 · 首次识别')}
${row('quick_enh_denied', '系统没有给权限，增强取词没打开。先 ⌘C 再按快捷键照常能用。', '设置块')}
${row('quick_shot_relaunch', '权限已经给了，但要重新打开大肚猴翻译才生效。', '截图 · 首次授权后')}
${row('quick_shot_nothing', '这一块里没有认出文字。', '面板')}
${row('quick_shot_old', '需要 macOS 14 或更新的系统', '设置块')}
${row('quick_saved / _off / _long', '已存入复习库 / 未存入 · 采集已关 / 太长，不存入复习库', '面板底栏')}
${row('quick_resident_title / _body', '大肚猴还在菜单栏 / 快捷键照常可用。要完全退出，用菜单栏图标里的「退出」，或按 ⌘Q。', '第一次关主窗口')}
${row('quick_hotkey_clash / _deny', '被系统占用 / 换一个带 ⌃ 或 ⌘ 的', '快捷键录制')}
<tr><td colspan="4" class="lbl" style="padding-top:12px">复用（不另写）</td></tr>
${row('auth_err_key', '服务商拒绝了这把 key（HTTP 401/403）…', '弹层 / 面板', false)}
${row('grant_err_exhausted / _unavailable / _model', '免费额度已经用完了… / 不是你用完了… / 免费额度只能用它指定的那个模型…', '弹层 / 面板', false)}
${row('err_reasoning_starved', '模型把整个输出预算用在了思考上…', '弹层 / 面板', false)}
${row('engine_test_timeout / _unknown_provider', '端点没有在超时前回应 / 这个版本不认识当前存着的引擎…', '弹层 / 面板', false)}
</table>`, { page: PG, gap: 14 });

// 40 · 中国版与深色总览
const chinaSheet = `<div class="sheet" style="margin-top:auto"><div class="grab"></div><div class="sheet-h"><span class="brand"><span class="mark"></span>大肚猴翻译</span></div><div class="src q" style="font-size:.84rem">${S.en}</div><div class="trbox"><b style="font-size:.95rem">还没有翻译引擎</b><div class="hint" style="font-size:.86rem">在 App 里填一把 API key 就能翻。</div></div><div class="foot">${btn('配置引擎', 'p')}</div></div>`;
board('ChinaDark.dc.html', 1500, 900, '中国版 · 深色 总览', `${head('中国版与深色', '中国版与国际版同功能（不做残缺版），差别只在下面这几处。')}
<div style="display:grid; grid-template-columns:350px 350px minmax(0,1fr); gap:26px; align-items:start">
${cell('中国版 · 未配置', '没有「领免费额度」（中国版没有这项服务）；一个主按钮。', phone(chinaSheet))}
${cell('中国版 · 首次披露', '同一句，引擎名换成用户配的那家。不发任何用量数据。', phone(sheet({ engine: '通义千问', body: `<div class="trbox"><div class="tr">${S.zh}</div></div>`, foot: '', tail: `<div class="disc">选中的文字会直接发给你配置的引擎（通义千问），不经过我们的服务器。</div>` })))}
<div style="display:flex; flex-direction:column; gap:18px">
${cell('国行 iPhone 上「默认翻译 App」这一行', '', `<div class="note">T1 真机读数：国行 iPhone 上这一行<b>存在且可选</b>，选中后弹的就是我们的弹层 ⇒ 中国版照常带这个部件。中国区商店的审核口径仍是未知数，提审时才知道。</div>`)}
${cell('深色 · Mac 面板', '', `<div class="dark"><div class="desk dark" style="height:300px; display:flex; align-items:center; justify-content:center">${panel({ body: `<div class="tr" style="padding:0 2px">${S.zh}</div>`, foot: '' })}</div></div>`)}
</div></div>`, { page: PG });
