// 第 3 页 · Mac 快速翻译面板：菜单栏、面板解剖与各态、位置与层级、关闭规则、零权限三陷阱、输入翻译、服务菜单。
import { board, head, cell, grid, hint, mini, btn, ic, ibtn, err, keys, pend, S } from './00-base.mjs';

const PG = 'p3';
export const panel = ({ tag = '选中文字', lang = ['英语', '简体中文'], auto = false, src = S.en, focus = false, caret = false, body = '', foot = null, pin = false, saved = 'on', width = 400 } = {}) => {
  const savedHtml = saved === 'on' ? `<span class="saved">${ic('star', 'sm')}已存入复习库</span>` : saved === 'off' ? `<span>未存入 · 采集已关</span>` : saved === 'long' ? `<span>太长，不存入复习库</span>` : '';
  return `<div class="panel" style="width:${width}px"><div class="panel-h"><span class="ptag">${tag}</span><span style="flex:1"></span>${lang ? `<span class="langrow" style="gap:5px"><span>${lang[0]}</span>${ic('swap', 'sm')}<button class="lchip${auto ? ' auto' : ''}" type="button">${lang[1]}${ic('chev', 'sm')}</button></span>` : ''}${ibtn('pin', pin ? '取消钉住' : '钉住', pin)}${ibtn('x', '关闭')}</div>
${src !== null ? `<div class="srcbox${focus ? ' focus' : ''}">${src}${caret ? '<span class="caret"></span>' : ''}</div>` : ''}${body}${foot !== null ? `<div class="pfoot">${foot === '' ? savedHtml : foot}<span class="split" style="gap:2px">${ibtn('copy', '复制译文')}</span></div>` : ''}</div>`;
};
const tr = (t) => `<div class="tr" style="padding:0 2px">${t}</div>`;
const sk = `<div style="display:flex; flex-direction:column; gap:8px; padding:4px 2px"><div class="sk" style="width:92%"></div><div class="sk" style="width:64%"></div></div>`;

// 20 · 菜单栏
const menu = ({ warn = false, shot = true } = {}) => `<div class="menu">${warn ? '<div class="mwarn">还没有翻译引擎 · 打开设置配置</div>' : ''}
<div class="mi hot"><span>翻译选中的文字或剪贴板</span><span class="kb">⌃⌥T</span></div>
${shot ? '<div class="mi"><span>截图翻译</span><span class="kb">⌃⌥S</span></div>' : ''}
<div class="mi"><span>输入翻译</span><span class="kb">未设置</span></div>
<div class="msep"></div><div class="mi"><span>打开大肚猴翻译</span></div><div class="mi"><span>快速翻译设置…</span></div>
<div class="msep"></div><div class="mi"><span>退出</span><span class="kb">⌘Q</span></div></div>`;
const bar = `<div class="mbar"><span>Wi-Fi</span><span>100%</span><span class="mark" style="width:16px; height:16px; border-radius:5px"></span><span>9月19日 周六 14:02</span></div>`;
board('MacMenu.dc.html', 1240, 620, '菜单栏图标与菜单', `${head('菜单栏', '图标常驻（总开关开着时）。菜单是所有入口的目录，每项右侧显示当前快捷键 —— 用户忘了快捷键时，这里就是答案。')}
${grid(3, `
${cell('常态', '', `<div class="desk" style="height:400px">${bar}<div style="position:absolute; top:30px; right:120px">${menu()}</div></div>`)}
${cell('还没配引擎', '顶部一行警示，点它进设置。入口照常可点（点了面板里也会说同一件事）。', `<div class="desk" style="height:400px">${bar}<div style="position:absolute; top:30px; right:120px">${menu({ warn: true })}</div></div>`)}
${cell('macOS 低于 14', '「截图翻译」整项不出现（不是灰掉）。', `<div class="desk" style="height:400px">${bar}<div style="position:absolute; top:30px; right:120px">${menu({ shot: false })}</div></div>`)}
`)}`, { page: PG });

// 21 · 解剖
const call = (n, t) => `<div style="display:flex; gap:10px; align-items:flex-start; font-size:.88rem; line-height:1.5"><span class="sec-h"><span class="n" style="margin:0">${n}</span></span><span>${t}</span></div>`;
board('PanelAnatomy.dc.html', 1240, 640, '面板解剖', `${head('面板解剖', '一个面板，五个来源共用。')}
<div style="display:grid; grid-template-columns:440px minmax(0,1fr); gap:32px; align-items:start">
<div class="desk" style="height:440px; display:flex; align-items:center; justify-content:center">${panel({ body: tr(S.zh), foot: '' })}</div>
<div style="display:flex; flex-direction:column; gap:12px">
${call(1, '<b>来源标签</b>：选中文字 / 剪贴板 / 截图 / 输入 / 服务。用户永远知道这段字是从哪来的 —— 零权限路径下这一点尤其要紧（见「三个陷阱」）。')}
${call(2, '<b>语言对</b>：源语言我们自己判；目标语言点开可改，<b>会写回</b>「译成」设置（与 iPhone 弹层不同，Mac 面板就在 App 进程里）。')}
${call(3, '<b>钉住</b>：钉住后不自动关、可拖动；再次触发在同一个面板里换内容。')}
${call(4, '<b>原文可编辑</b>：改完回车重翻。截图识别错一个字、或只想翻其中一句时用。')}
${call(5, '<b>译文</b>：鼠尾草绿，与网页双语同色。')}
${call(6, '<b>底栏</b>：左边是这句有没有进复习库（存了 / 采集关着 / 太长不存），右边复制。没有朗读、没有历史 —— 见便签。')}
</div></div>`, { page: PG });

// 22 · 各态
board('PanelStates.dc.html', 1320, 900, '面板各态', `${head('面板状态', '与 iPhone 弹层同一张状态表，换了容器。')}
${grid(3, `
${cell('加载', '原文立刻出现，译文位骨架。', panel({ body: sk, foot: `<span>DeepSeek</span>` }))}
${cell('译文', '', panel({ body: tr(S.zh), foot: '' }))}
${cell('长文', '面板最高到屏幕高度的 60%，超出滚动；逐段出。太长不进复习库。', panel({ src: 'The committee postponed the vote until the new figures were published. Members said the delay would give them time to study the revised forecast…', body: `<div style="max-height:120px; overflow:hidden">${tr('委员会把表决推迟到新数据公布之后。委员们说，推迟能让他们有时间研究修订后的预测……')}</div>`, saved: 'long', foot: '' }))}
${cell('原文已是目标语言', '自动反向，语言 chip 变绿。', panel({ src: S.zhSrc, lang: ['简体中文', 'English'], auto: true, body: tr(S.enFromZh), foot: '' }))}
${cell('慢（5 秒后）', '', panel({ body: sk + `<div class="mini">还在翻 —— 免费额度走我们的中转，比自己的 key 慢。</div>`, foot: `<span>免费额度</span>` }))}
${cell('还没配引擎', '「打开设置」把主窗口带到前面并落在「引擎与密钥」。', panel({ lang: null, body: `<div class="hint" style="font-size:.9rem">还没有翻译引擎。领一份免费额度，或填自己的 API key。</div><div class="split">${btn('打开设置', 'p', 'sm')}</div>`, foot: null }))}
`)}
${mini('失败各态：错误码、文案、出口与 iPhone 弹层那张「失败分态」一一对应，只把「打开大肚猴翻译」换成「打开设置」。不另画一遍。')}
<div style="display:flex; gap:22px">${panel({ body: err('服务商拒绝了这把 key（HTTP 401/403）。检查 key 是否填对、有没有这个模型的权限。', 'auth') + `<div class="split">${btn('打开设置', 'p', 'sm')}</div>`, foot: null })}${panel({ body: err('现在没有网络。连上之后再试。', 'network') + `<div class="split">${btn('重试', 'p', 'sm')}</div>`, foot: null })}</div>`, { page: PG, gap: 16 });

// 23 · 位置与层级
const hostwin = (x, y, w, h, selAt) => `<div class="hostwin" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px">${[90, 76, 84].map((p) => `<div class="ln" style="height:8px; border-radius:999px; background:var(--track); width:${p}%"></div>`).join('')}<span class="sel" style="font-size:.8rem; line-height:1.5; background:#b9d2f5; color:#1b2a3d; border-radius:3px; padding:1px 3px; align-self:flex-start">${selAt}</span>${[88, 60].map((p) => `<div class="ln" style="height:8px; border-radius:999px; background:var(--track); width:${p}%"></div>`).join('')}</div>`;
board('PanelPlacement.dc.html', 1320, 760, '位置与层级', `${head('出现在哪、压在谁上面', '')}
${grid(3, `
${cell('鼠标右下方', '左上角离鼠标 12 px；不盖住选中的那一行。', `<div class="desk" style="height:460px">${hostwin(24, 30, 330, 200, 'postponed the vote')}<div class="cursor" style="left:150px; top:150px"></div><div style="position:absolute; left:166px; top:176px; transform:scale(.62); transform-origin:top left">${panel({ body: tr(S.zh), foot: '' })}</div></div>`)}
${cell('贴边时翻转', '右边或下边放不下 ⇒ 翻到鼠标左边 / 上边；多屏时留在鼠标所在的那块屏。', `<div class="desk" style="height:460px">${hostwin(120, 210, 270, 200, 'new figures')}<div class="cursor" style="left:350px; top:330px"></div><div style="position:absolute; left:96px; top:36px; transform:scale(.62); transform-origin:top left">${panel({ src: 'new figures', body: tr('新数据'), foot: '' })}</div></div>`)}
${cell('全屏 App 与字幕条', '盖在别的 App 的全屏窗口之上（和实时字幕条同一种窗口）。两者同时在时：面板在上，字幕条不动、不被遮住的部分照常出字。', `<div class="desk" style="height:460px; background:#15130f"><div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#6a6255; font-size:.84rem">别的 App · 全屏视频</div><div style="position:absolute; left:40px; right:40px; bottom:26px; background:rgba(22,20,18,.74); border-radius:14px; padding:10px 14px; color:#fff; font-size:.8rem; line-height:1.5">We’ll come back to that in a moment.<div style="color:#aebf92">我们一会儿再回到这一点。</div></div><div style="position:absolute; left:60px; top:60px; transform:scale(.62); transform-origin:top left">${panel({ body: tr(S.zh), foot: '' })}</div></div>`)}
`)}${mini('面板默认<b>不抢焦点</b>：出现时别的 App 里的光标、选区、全屏状态都不变。只有「输入翻译」和用户主动点进原文框时才拿键盘焦点。T2 读数：从右键「服务」进来时，系统会先把大肚猴翻译拉到前台 —— 我们在收到文字的同一刻把焦点还给刚才那个 App（已验：1 秒后前台仍是原来的 App）。主窗口若开着会闪一下，真机上要再看一眼观感。')}`, { page: PG });

// 24 · 关闭与重复触发
board('PanelDismiss.dc.html', 1240, 640, '关闭 · 钉住 · 重复触发', `${head('什么时候消失', '')}
<div style="display:grid; grid-template-columns:minmax(0,1fr) 440px; gap:32px; align-items:start">
<table class="tbl" style="font-size:.9rem"><tr><th>动作</th><th>没钉住</th><th>钉住了</th></tr>
<tr><td>按 ${keys('Esc')}</td><td>关</td><td>关（钉住不拦 Esc）</td></tr>
<tr><td>点面板以外任何地方</td><td>关</td><td>留着</td></tr>
<tr><td>切到别的 App / 别的桌面</td><td>关</td><td>跟着过去（所有桌面可见）</td></tr>
<tr><td>再按一次翻译快捷键</td><td colspan="2">同一个面板换内容，位置不动；不会叠出第二个</td></tr>
<tr><td>上一句还在翻，又触发一次</td><td colspan="2">取消上一句的请求，直接翻新的</td></tr>
<tr><td>点 ${keys('✕')}</td><td colspan="2">关</td></tr>
<tr><td>拖动</td><td>自动变成钉住（拖了说明想留着）</td><td>移动</td></tr>
<tr><td>退出 App</td><td colspan="2">关</td></tr></table>
<div class="desk" style="height:360px; display:flex; align-items:center; justify-content:center">${panel({ pin: true, body: tr(S.zh), foot: '' })}</div>
</div>${mini('钉住的状态不跨重启记忆：每次启动都从「没钉住」开始，免得用户找不到一个上次钉在屏幕外的面板。')}`, { page: PG });

// 25 · 零权限路径的三个陷阱
board('PanelTraps.dc.html', 1320, 680, '零权限路径 · 三个陷阱', `${head('没开「增强取词」时：快捷键翻的是剪贴板', '装上就能用、不要任何权限 —— 代价是下面三个坑，每个都要有话说。')}
${grid(3, `
${cell('① 剪贴板是空的，或不是文字', '不发请求。一句话同时教两条路。', panel({ tag: '剪贴板', lang: null, src: null, body: `<div class="hint" style="font-size:.9rem">剪贴板里没有文字。先选中并按 ${keys('⌘', 'C')}，再按 ${keys('⌃', '⌥', 'T')}。</div><div class="split"><a href="#enh">想省掉 ⌘C？打开「增强取词」→</a></div>`, foot: null }))}
${cell('② 和上一次翻的一模一样', '多半是忘了 ⌘C。照样显示上次的结果（不重发请求），顶上一行提醒。', panel({ tag: '剪贴板', body: `<div class="note" style="font-size:.8rem">和上次翻的是同一段 —— 是不是忘了按 ⌘C？</div>${tr(S.zh)}`, foot: '' }))}
${cell('③ 剪贴板带「隐藏 / 临时」标记', '密码管理器复制密码时会打这个标记。<b>不读内容、不发请求、不进复习库</b>，只说一句原因。', panel({ tag: '剪贴板', lang: null, src: null, body: `<div class="hint" style="font-size:.9rem; display:flex; gap:8px">${ic('lock')}<span>剪贴板里的内容被标记为隐藏（多半是密码），没有读取，也没有发出去。</span></div>`, foot: null }))}
`)}${mini('③ 是硬规则，不是设置项。代价：少数没打标记的密码管理器我们认不出 —— 所以来源标签「剪贴板」和可见的原文框同样是防线：用户一眼看得到发出去的是什么。')}`, { page: PG });

// 26 · 输入翻译
board('PanelInput.dc.html', 1240, 560, '输入翻译', `${head('输入翻译', '快捷键默认留空；从菜单栏也能进。这是面板唯一主动拿键盘焦点的时候。')}
${grid(3, `
${cell('刚打开', '光标在原文框里。' + keys('↩') + ' 翻译，' + keys('⇧', '↩') + ' 换行，' + keys('Esc') + ' 关。', panel({ tag: '输入', lang: ['自动', '简体中文'], src: '', focus: true, caret: true, body: `<div class="mini">输入或粘贴要翻译的文字</div>`, foot: null }))}
${cell('输入中', '不边打边翻（每个字一次请求既费钱又闪）。', panel({ tag: '输入', lang: ['自动', '简体中文'], src: 'Could you send me the revised forecast', focus: true, caret: true, body: `<div class="mini">${keys('↩')} 翻译</div>`, foot: null }))}
${cell('翻完', '焦点留在原文框，接着改、接着回车。', panel({ tag: '输入', src: 'Could you send me the revised forecast?', focus: true, body: tr('能把修订后的预测发给我吗？'), foot: '' }))}
`)}`, { page: PG });

// 27 · 服务菜单
const ctxMenu = `<div class="menu" style="width:230px">${['查询「postponed the vote」', '翻译「postponed the vote」', '搜索网页'].map((t) => `<div class="mi"><span>${t}</span></div>`).join('')}<div class="msep"></div><div class="mi"><span>拷贝</span></div><div class="mi"><span>共享…</span></div><div class="msep"></div><div class="mi hot"><span>服务</span><span>›</span></div></div>`;
const svcMenu = `<div class="menu" style="width:230px"><div class="mi hot"><span>用大肚猴翻译</span></div><div class="mi"><span>添加到音乐…</span></div><div class="mi"><span>新建便笺</span></div></div>`;
board('MacServices.dc.html', 1320, 700, '右键「服务」入口', `${head('右键 › 服务 › 用大肚猴翻译', '零权限、不碰剪贴板：宿主 App 主动把选中的字交过来。')}
${grid(3, `
${cell('入口（系统的菜单）', '菜单标题 12 个语种各一份。', `<div class="desk" style="height:380px"><div style="position:absolute; left:24px; top:30px">${ctxMenu}</div><div style="position:absolute; left:246px; top:204px">${svcMenu}</div></div>`)}
${cell('给它绑一个快捷键', '设置块里放一张指引卡（系统的设置，我们改不了，只能指路）。', `<section class="card"><h3>给「服务」绑快捷键</h3><div class="steps"><div>系统设置 › 键盘 › 键盘快捷键…</div><div>左侧选「服务」› 展开「文本」</div><div>找到「用大肚猴翻译」，双击右侧设置按键</div></div><div class="split">${btn('打开键盘设置', 's', 'sm')}</div></section>`)}
${cell(`有些 App 没有服务菜单 ${pend('人工补验')}`, 'T2 读数：文本编辑、Safari、Chrome、Firefox、预览、Pages 六个都有、文字一字不差；一个代码编辑器里没出现，但当时没能确认编辑区里真有选区 —— 这一类 App 要人工再验一次。设置块里照实说，并指向另外两条路。', `<div class="note">在少数 App 里右键菜单没有「服务」。那里可以：先 ${keys('⌘', 'C')} 再按 ${keys('⌃', '⌥', 'T')}；或打开「增强取词」；或用截图翻译。</div>${hint('六个常用 App 都通 ⇒ 设置块里「右键 › 服务」与快捷键并列写，不必把哪一条藏到后面。')}`)}
`)}`, { page: PG });
