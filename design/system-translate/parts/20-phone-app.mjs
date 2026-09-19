// 第 2 页 · iPhone App 侧：设置块、「译成」、首页发现卡、复习库、收件箱、两处确认框。
import { board, head, cell, grid, hint, mini, card, sel, sw, btn, ic, S } from './00-base.mjs';

const PG = 'p2';
const guide = `<div class="steps"><div>打开 iPhone 的「设置」</div><div>往下找到「翻译」（在「App」分组里）</div><div>点「默认翻译 App」，选「大肚猴翻译」</div></div>`;
const dep = (inner) => `<div class="dep">${inner}</div>`;
const blk = (state) => {
  const rows = {
    old: `${dep('<b>系统翻译</b> · 需要 iOS 18.4 或更新的系统')}${hint('这台设备是 iOS 17.6。升级系统后这里会亮起来；App 的其它功能不受影响。')}`,
    none: `${dep('<b>引擎</b> · <span class="no">还没同步</span> <a href="#go">去配置引擎 →</a>')}${guide}${sw('存入复习库', '系统翻译过的句子进复习，来源「系统翻译」', true)}`,
    ok: `${dep('<b>引擎</b> · DeepSeek <span class="ok">✓</span> 已同步给系统翻译 · 译成 简体中文')}${guide}${sw('存入复习库', '系统翻译过的句子进复习，来源「系统翻译」', true)}<div class="split">${btn('打开「设置」', 's', 'sm')}<span class="mini">只能带你到「设置」首页，系统不提供直达那一页的链接。</span></div>`,
    fail: `<div class="note w">引擎配置没能同步给系统翻译（钥匙串写入失败 · -34018）。系统翻译暂时用不了；App 里的翻译不受影响。</div><div class="split">${btn('再同步一次', 'p', 'sm')}<a href="#fb">发送反馈</a></div>`,
  };
  return `<section class="card" ${state === 'old' ? 'style="opacity:.62"' : ''}><h3>系统翻译<span class="use">在任何 App 里选字 › 翻译</span></h3>${rows[state]}</section>`;
};
board('AppSysBlock.dc.html', 1700, 760, 'App 设置 ·「系统翻译」块四态', `${head('App 设置里的「系统翻译」块', '放在「功能」一节，与「文档翻译」「对话与字幕」并列。只在 iPhone / iPad 上出现。')}
${grid(4, `
${cell('系统太旧', '整块变淡 + 一句具名原因。不跳转、不弹框。', blk('old'))}
${cell('引擎还没配', '依赖行指到「引擎与密钥」；指引与开关照常可见 —— 先去系统里设好也没关系。', blk('none'))}
${cell('已同步（常态）', '依赖行写明同步过去的是哪个引擎、译成什么语言。', blk('ok'))}
${cell('同步失败', '少见，但不能沉默：一句原因 + 再试 + 反馈出口。', blk('fail'))}
`, 20)}
${mini('同步 = App 把「用哪个引擎、哪把 key、译成什么」单向抄一份给系统翻译用。key 放进钥匙串，不落明文文件。改了引擎、退出登录、清除数据时自动跟着变。')}`, { page: PG, phone: true });

// 「译成」下拉
board('TargetLang.dc.html', 1320, 700, '「译成」下拉（两宿主同一个组件）', `${head('新控件：「译成」', 'App 一直没有目标语言设置，默默跟着界面语言走。系统翻译与快速翻译都需要一个明说的值。')}
<div style="display:grid; grid-template-columns:390px 390px minmax(0,1fr); gap:24px; align-items:start">
${cell('App 设置 · 收起', '默认「跟随界面语言」—— 就是今天的实际行为，老用户升级后什么都不变。', card('语言', `${sel('界面语言', '跟随系统')}${sel('译成', '跟随界面语言（简体中文）')}`))}
${cell('App 设置 · 展开', '选项来自同一张语言注册表，不另列清单。', `<div class="menu" style="width:100%; box-sizing:border-box">${['跟随界面语言（简体中文）', '简体中文', '繁體中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español'].map((l, i) => `<div class="mi${i === 0 ? ' hot' : ''}"><span>${l}</span>${i === 0 ? ic('check', 'sm') : ''}</div>`).join('')}</div>`)}
${cell('它管哪些地方', '一个值，处处同义。', `<table class="tbl"><tr><th>表面</th><th>以前</th><th>以后</th></tr><tr><td>文档翻译</td><td>界面语言</td><td>译成</td></tr><tr><td>播客补译文</td><td>界面语言</td><td>译成</td></tr><tr><td>系统翻译（iPhone）</td><td>—</td><td>译成</td></tr><tr><td>快速翻译（Mac）</td><td>—</td><td>译成（面板里改会写回）</td></tr><tr><td>对话 · 实时字幕</td><td>我的语言 / 对方的语言</td><td>不变（它有自己的一对）</td></tr><tr><td>扩展的网页翻译</td><td>扩展自己的「目标语言」</td><td>不变（两边存储不通）</td></tr></table>`)}
</div>`, { page: PG });

// 首页发现卡
const disc = (state) => ({
  new: `<section class="card"><h3>让 iPhone 自带的「翻译」用上大肚猴</h3>${hint('在任何 App 里选中文字 › 翻译，弹出来的就是你配的引擎。设一次就好。')}<div class="split">${btn('怎么设', 'p', 'sm')}${btn('以后再说', 's', 'sm')}</div></section>`,
  used: `<section class="card"><h3>系统翻译 <span class="tag g">已在用</span></h3>${hint('本月从系统翻译收进 12 句。')}<div class="split"><a href="#src">在复习库里看 →</a></div></section>`,
}[state]);
board('AppDiscover.dc.html', 1320, 620, 'App 首页 · 发现卡', `${head('App 首页的发现卡', '不进新手引导（引导已经四屏）；放首页，可关。')}
${grid(3, `
${cell('没设过', '「怎么设」展开成设置块里的那三步，并滚到设置块。', disc('new'))}
${cell('点了「以后再说」', '卡片消失，不再出现；入口留在设置里。', `<div class="old"><div class="c"><span>（首页不再有这张卡）</span></div></div>`)}
${cell('已在用', '系统不告诉我们「是不是默认」。判据：第一次从系统翻译收进句子。没开采集的人永远看不到这一态 —— 可以接受，卡片本来就能关。', disc('used'))}
`)}`, { page: PG, phone: true });

// 复习库与收件箱
const srcRow = (t, n, extra = '') => `<div class="qs-row"><span>${t}</span><span class="split"><span class="stat">${n}</span>${extra}</span></div>`;
board('AppCorpus.dc.html', 1320, 760, '复习库 · 来源与收件箱', `${head('进复习库', '系统翻译在另一个进程里，够不着复习库：句子先落进一个有上限的收件箱，App 下次打开时过正常的采集门再收进来。')}
${grid(3, `
${cell('来源管理', '按月一组，不是每天一条。删除整组 = 删这一组的卡。', card('来源', `${srcRow('系统翻译 · 2026-09', '12 句', btn('删除', 'd', 'sm'))}${srcRow('文档 · Annual Report.pdf', '31 句')}${srcRow('对话 · 9 月 14 日 下午', '18 句')}${srcRow('网页 · nytimes.com', '46 句')}`))}
${cell('复习卡上的来源行', '纯文字，不可点 —— 没有网页可回、没有页码可翻。', `<section class="card" style="gap:8px"><div class="src">${S.en}</div><div class="tr">${S.zh}</div><div class="stat">来自 系统翻译 · 9 月 19 日</div></section>`)}
${cell('收件箱的两支', '', `<div class="flow" style="grid-template-columns:1fr"><div class="node s">App 打开 / 回到前台</div><div class="arr">↓</div><div class="node">采集开着 ⇒ 逐句过门（学习语言、长度、去重）⇒ 写进复习库 ⇒ 删收件箱里的这一条</div><div class="node w">采集关着 ⇒ 整个收件箱<b>丢弃并清空</b>，不留暗箱</div></div>${hint('静默，不弹「收进 N 句」的提示；数字在来源管理里看得到。收件箱上限 200 句 / 30 天，超了挤掉最旧的 —— 长期不开 App 也不会越积越多。')}`)}
`)}`, { page: PG, phone: true });

// 两处确认框
const dlg = (title, body, ok) => `<section class="card" style="gap:14px"><h3>${title}</h3><div class="hint" style="font-size:.9rem; color:var(--text)">${body}</div><div class="foot" style="display:flex; gap:10px">${btn('取消', 's')}${btn(ok, 'd')}</div></section>`;
board('AppConfirms.dc.html', 1000, 560, '两处确认框的新增文案', `${head('两处既有的确认框，各多一句', '同步出去的那一份也要跟着清 —— 否则 App 里看着清干净了，系统翻译还能接着用旧 key。')}
${grid(2, `
${cell('清除本机全部数据', '', dlg('清除本机全部数据？', '学习库、设置、API key、翻译缓存都会删掉。<b>同步给系统翻译的引擎配置，和还没收进来的句子，也一起清。</b>这一步撤不回。', '全部清除'))}
${cell('退出登录（免费额度在用）', '', dlg('退出登录？', '退出登录后免费额度会停用（余额保留，再登录就回来）。<b>系统翻译也会跟着停用，直到你重新登录或填自己的 key。</b>', '退出登录'))}
`)}`, { page: PG, phone: true });
