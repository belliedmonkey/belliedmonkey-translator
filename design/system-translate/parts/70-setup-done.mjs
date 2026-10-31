// 第 7 页 ·「配好了没有」与「怎么被引导过去」（2026-09-20）。
//
// 起因：1.14.0 的 TestFlight 包在真机上跑通之后，用户亲手走了一遍，报了两件事 ——
//   ② 领完免费额度 / 填完 key 之后没有任何一处告诉他配好了，也没说接下来回去做什么；
//      而且「之前的新手引导也有这个问题」。
//   ③ 新用户装完、老用户升级，都没有流程告诉他还要去系统设置里设成默认翻译 App。
//
// 这两条**不是新设计**。仓库里已经有两个对的形状，只是 App 侧没有：
//   形状 A（配完就地自检）  extension/learn/quick-setup.js:483-560 —— 按下那一刻就摆出三行
//     占位「测试中…」，再逐行落成「✓ 通了 · 512ms」。原注释：「四行在按下那一刻就存在，
//     不是成功后才冒出来的绿框 —— 那种形状让失败看起来像什么都没发生」。
//   形状 B（去配置→配完自动回来）extension/onboard/onboard.js:416-431 —— 监听 grantTail
//     从空变非空，paint() 之后停 1.5 秒再前进，「让人看见『到账』再走」。全仓唯一的闭环。
//
// 所以这一页画的是「把这两个形状搬到 App，并补上『从哪来』这一维」。
import { board, head, cell, grid, hint, mini, card, btn } from './00-base.mjs';

const PG = 'p7';

// 自检三行（形状 A）。state: run | ok | bad
const res = (state) => {
  const row = (name, val, cls = '') => `<div class="qs-row"><span class="k">${name}</span><span class="res${cls}">${val}</span></div>`;
  if (state === 'run') return `${row('翻译', '测试中…')}${row('解析', '测试中…')}${row('朗读', '测试中…')}`;
  if (state === 'bad') return `${row('翻译', '✗ 服务商拒绝了这把 key（401）', ' no')}${row('解析', '跟随翻译')}${row('朗读', '未配置')}`;
  return `${row('翻译', '✓ 通了 · 512 ms')}${row('解析', '✓ 通了 · 486 ms')}${row('朗读', '✓ 通了 · 试听一句')}`;
};

// ① 配好了的那一刻 —— 全 App 通用的一种回执，下一步按钮随「从哪来」变
const done = (from) => {
  const next = {
    onboard: btn('去读一篇 →', 'p', 'blk'),
    settings: btn('回到首页', 's', 'blk'),
    systrans: btn('知道了', 's', 'blk'),
    quick: btn('回到刚才那句', 'p', 'blk'),
  }[from];
  const line = {
    onboard: '引擎配好了，浏览器那半边照常用。',
    settings: '引擎配好了。文档翻译、对话听译、实时字幕现在都能用了。',
    systrans: '引擎配好了。<b>回到刚才那个 App，再点一次「翻译」即可</b> —— 这里不用再做什么。',
    quick: '引擎配好了。刚才那句已经重新翻好，在面板里。',
  }[from];
  return card('可以用了 <span class="tag g">DeepSeek</span>', `${res('ok')}<div class="note">${line}</div>${next}`);
};

board('SetupDone.dc.html', 1760, 700, '配好了的那一刻（全 App 通用）', `${head('「怎样才算配置完成」的正面回答',
  '一种回执，四个落点。回执本身永远一样：三行自检 + 一句「可以用了」+ 一个下一步；变的只有下一步那个按钮。')}
${grid(4, `
${cell('从新手引导进来', '引导现有四屏里就能配 —— 2026-09-01 那句「App 做不到配引擎」已被 1.12.0 的设置重设计推翻。', done('onboard'))}
${cell('从设置页自己进来', 'App 设置页现在 showTry:false，注释写「配完就没有下一步了」。Mac 快译与 iPhone 系统翻译出现之后，这句话不成立了。', done('settings'))}
${cell('从系统翻译的弹层过来', '<b>我们送不回去</b>（iOS 不给这个能力），所以话要说满：回哪、做什么。', done('systrans'))}
${cell('从 Mac 快译面板过来', '面板还在，那句待翻的文字也还在 —— 这一条是唯一能真的「回到原处」的。', done('quick'))}
`, 20)}
${mini('三行自检不是装饰：<b>领免费额度这条路现在一次自检都不跑</b>（app/settings.js:846-887 里 plan.tests 只用来数槽位），却直接说「免费额度已配好」。那句话没有证据 —— 与本仓「只信回读」的家规冲突。')}`,
  { page: PG, phone: true });

// ② 从系统翻译过来的那一支：顶上一行 → 配好之后就地变成成功态
board('SetupFrom.dc.html', 1320, 700, '从系统翻译过来的那一支', `${head('弹层把人送到设置之后',
  '交互稿 :980 早写了「顶上一行：从系统翻译过来的…」，代码里没落地 —— 深链的 ?from=system-translate 被整个丢弃（app/app.js:1118-1129 只取 uid）。')}
${grid(2, `
${cell('刚落地（还没配）', '落在「引擎与密钥」一节，不是设置页顶部：人是带着「那边不能用」这个问题来的。', card('引擎与密钥',
  `<div class="note">从系统翻译过来的：配好之后，回到刚才的 App 再点一次「翻译」。</div>${btn('领免费额度', 'p', 'blk')}${btn('用自己的 key', 's', 'blk')}`))}
${cell('配好之后（同一行就地变）', '不跳页、不弹框 —— 人还在设置页上，把那一行从「你为什么来」改写成「你可以回去了」。', card('引擎与密钥',
  `${res('ok')}<div class="note">配好了。<b>回到刚才的 App，再点一次「翻译」。</b></div><p class="mini" style="margin:0">iOS 不允许我们把你送回去，所以这里只能说清楚怎么回。</p>`))}
`, 20)}
${mini('中国版差别只有一处：左边那张卡没有「领免费额度」，只有「配置引擎」一个主按钮。')}`,
  { page: PG, phone: true });

// ③ 「我到底配好了没有」—— 四种半配好
const unsure = (k) => ({
  unsaved: card('还差一下（扩展设置页 / App 详细档）', `${hint('key 填在框里，但还没保存 —— 这个框是「改完自动存」，你点一下别处就好。')}<div class="old"><div class="c">API Key<span class="tag a">未保存</span></div></div>${btn('保存并测试', 'p', 'blk')}`),
  bad: card('保存了，但用不了', `${res('bad')}<div class="note w">这把 key 服务商不认。检查有没有多复制一个空格，或换一把。</div>${btn('重新填', 'p', 'blk')}`),
  nologin: card('额度还没到', `${hint('免费额度要先登录才领得到 —— 登录只用来认人，不同步任何内容。')}<div class="old"><div class="c">免费额度<span class="tag a">未登录</span></div></div>${btn('登录并领取', 'p', 'blk')}`),
  chosen: card('选了免费引擎，却说没配', `${hint('选了不需要 key 的引擎之后，界面仍显示「还没配过翻译引擎」。')}<div class="old"><div class="c bad">engineChosen 在 App 里一处都没写</div></div><p class="mini" style="margin:0">这是现存的 bug，不是交互问题：判据 EngineState.needsSetup 要读这个键，而它只在扩展的两处被写过。<b>落地时已修</b>：一键配置与领额度两条路各补了一次 markEngineChosen。</p>`),
}[k]);

board('SetupUnsure.dc.html', 1760, 720, '「我到底配好了没有」', `${head('半配好的四种样子',
  '用户原话：「用户甚至不知道怎么样才算配置完成」。凡是「看起来配了、其实没成」的状态，都要说出差在哪、给一个出口。')}
${grid(4, `
${cell('填了没保存', '最常见。输入框是 change 触发，没失焦就没保存 —— 而界面此刻什么都不说。<b>落地时查清楚了：这一态在 App 的「引擎与密钥」里不存在</b> —— App 没有翻译引擎的逐项控件（index.html:498 的原注释），只有一张带「配置」按钮的一键卡。它成立的地方是<b>扩展设置页</b>，以及 App 详细档那三张槽卡（解析 / 转写 / 朗读）。', unsure('unsaved'))}
${cell('保存了但 key 是错的', '自检红着。文案逐字复用既有的 auth_err_key，不另写。', unsure('bad'))}
${cell('领额度但没登录成功', '额度要登录才领得到；登录页在另一处，回来之后这里要自己变。', unsure('nologin'))}
${cell('选了免费引擎却仍显示未配置', '现存 bug，板上标红。', unsure('chosen'))}
`, 20)}
${mini('共同的判据：<b>任何一处说「配好了」之前，必须有一次真的成功</b>。没跑过自检就不说这句话 —— 这与「只信回读，不信没报错」是同一条。<br>落地状态：②由回执的自检覆盖（红着就说红），③早就有（LearnGrant.status 按 signedIn 给「登录并领取」），④已修；①在 App 的主引擎上<b>不成立</b>。')}`,
  { page: PG, phone: true });

// ④ 去配置 → 配完回来：三条路各自能做到什么
const ret = (k) => ({
  fork: card('扩展引导（已有，唯一的闭环）', `${hint('领取在另一个标签页发生，人不必自己走回来。')}<div class="steps"><div>去设置页领额度</div><div>监听 grantTail「从空变非空」</div><div>先 paint 再停 1.5 秒，让人看见「到账」</div><div>自动前进到下一屏</div></div>`),
  systrans: card('系统翻译弹层（做不到自动回）', `${hint('弹层是系统拉起的一次性进程；我们跳去 App 之后，回不去那段文字。')}<div class="old"><div class="c">能做：把话说满 —— 回哪个 App、做什么</div><div class="c bad">做不到：自动回到那段文字</div></div>`),
  // 这一格原来写的是「能真的回 —— 面板与设置在同一个进程里」。**落地时查出来是错的**：
  // 面板是**第二个 WKWebView**（app/quick-host.js:143 的原注释），chrome-shim 的
  // storage.onChanged 是每页各一个监听器集合（app/chrome-shim.js:57），跨不过去；
  // 而且按下「打开设置」的那一刻面板已经 orderOut 了（quick-panel.swift:317）。
  // 要真的自动重翻，得走一条新的原生消息（主窗口 → 原生 → 重新 present 面板），
  // 那是另一个 PR、且要 Mac 出包才验得了。所以这一版说的是**能兑现的那句**。
  quick: card('Mac 快译面板（回得去，但要你自己点一下）', `${hint('面板还留着那句原文，但它是第二个 WKWebView —— 主窗口配好了，它收不到通知。')}<div class="steps"><div>面板上「打开设置」（面板收起）</div><div>配好，自检通过</div><div>回执说「回到面板，刚才那句可以重新翻一次」</div></div><div class="old"><div class="c bad">做不到（这一版）：面板自己重翻</div></div>`),
}[k]);

board('SetupReturn.dc.html', 1320, 720, '去配置 → 配完回来', `${head('三条路，能力不一样，话就要不一样',
  '形状 B 已经在扩展引导里跑了很久（onboard.js:416-431）。把它搬到 App，但不许承诺 iOS 给不了的事。')}
${grid(3, `
${cell('已有的那一个', '搬形状的来源。', ret('fork'))}
${cell('系统翻译', '<b>不许画「自动跳回」</b>。', ret('systrans'))}
${cell('Mac 快译', '<b>原稿说它能自动回，落地时查出来是错的</b>：面板是第二个 WKWebView，收不到主窗口的设置总线。', ret('quick'))}
`, 20)}
${mini('共同：监听的是<b>「从无到有」</b>，不是「有变化」—— storage.onChanged 会因为别的写入触发（onboard.js:421 的原注释）。<b>三条路里只有第一条真的闭环</b>：另外两条都只能把话说满，而话必须与能力逐字对得上。')}`,
  { page: PG, phone: true });

// ⑤ 首页发现卡（落地化：改成 #ext-banner 的既有形状）
const disc = (k) => ({
  none: `<section class="card"><h3>让 iPhone 自带的「翻译」用上大肚猴</h3>${hint('在任何 App 里选中文字 › 翻译，弹出来的就是你配的引擎。设一次就好。')}<div class="steps"><div>打开「设置」App</div><div>进入「App」→「翻译」</div><div>点「默认翻译App」，选「大肚猴翻译」</div></div><div class="split"><a href="#done">我已设好</a></div><p class="mini" style="margin:0">系统不提供直达那一页的链接，我们也带不了你过去 —— 所以这里只有三步文字。</p></section>`,
  said: `<div class="old"><div class="c"><span>（首页不再有这张卡）</span></div></div>`,
  used: `<section class="card"><h3>系统翻译 <span class="tag g">已在用</span></h3>${hint('本月从系统翻译收进 12 句。')}<div class="split"><a href="#src">在复习库里看 →</a></div></section>`,
}[k]);

board('Discover.dc.html', 1760, 700, '首页发现卡（落地化）', `${head('把画过的那张卡，落成首页已有的形状',
  '首页唯一的横幅位是 #ext-banner（app/app.js:289-380）。它已经有这套形状，也已经立过「iOS 上 App 判不了，诚实的做法是由用户告诉我们」这条先例（键 extBannerDoneAt）。')}
${grid(4, `
${cell('没设过', '三步直接摊开，不藏在「怎么设」后面。<b>没有「打开设置」按钮</b> —— 落地时查清楚了：openSettingsURLString 打开的是我们自己 App 的设置页，而能直达「设置 › App › 翻译」的 prefs:root= 是私有接口。', disc('none'))}
${cell('点了「我已设好」', '卡片消失，不再出现；入口常驻在设置块里。键照 extBannerDoneAt 的先例。', disc('said'))}
${cell('已在用', '判据：第一次从收件箱收进句子。没开采集的人永远看不到这一态 —— 可以接受，卡本来就能关。', disc('used'))}
${cell('与 Safari 扩展横幅撞车', '<b>首页不能同时挂两张「还差一步」。</b>扩展那张先 —— 它是整个产品的前提，系统翻译只是其中一条入口。', `<div class="old"><div class="c">① Safari 扩展还没打开</div><div class="c">② 系统翻译还没设</div></div><p class="mini" style="margin:0">①收起之后②才出现。</p>`)}
`, 20)}
${mini('「我已设好」是用户自己说的，不是我们判的 —— 系统不提供「我是不是默认翻译 App」这个接口（T1 尖刺逐条翻过 SDK）。')}`,
  { page: PG, phone: true });

// ⑥ 什么时候出现、什么时候消失
board('DiscoverWhen.dc.html', 1320, 640, '发现卡的出现与消失', `${head('每一条都写明判据',
  '照 #ext-banner 的既有机制：横幅在场时首页主行动自动让位（app/app.js:294 syncReview）。')}
<table class="tbl">
<tr><th>情形</th><th>出不出现</th><th>判据（代码里问得出来的那个）</th></tr>
<tr><td>刚装 App 的新用户</td><td>出现</td><td>引导走完（onboardSeen=1）之后的第一次首页</td></tr>
<tr><td>老用户升级上来</td><td>出现</td><td>没有 systransBannerDoneAt，且没收到过系统翻译的句子</td></tr>
<tr><td>点了「我已设好」</td><td>永不再出现</td><td>systransBannerDoneAt 有值（UI 状态键，不进 settings.js KEYS）</td></tr>
<tr><td>已经在用</td><td>换成「已在用」</td><td>收件箱收进过至少一句 via='system'</td></tr>
<tr><td>系统低于 18.4</td><td>不出现</td><td>问不出来系统版本 ⇒ 用 mtVault 通道在不在代替；两者都不在就整块不出现</td></tr>
<tr><td>引擎还没配</td><td>不出现</td><td>先配引擎再谈入口；此时首页该说的是别的</td></tr>
<tr><td>Safari 扩展横幅在场</td><td>让位</td><td>#ext-banner 未收起时不出现</td></tr>
</table>
${mini('「系统低于 18.4」这一条是妥协：App 问不出系统版本（问得出来也只能多一条要维护的协议）。用「有没有 mtVault 通道」代替 —— 它答的是「这台设备上有没有这个扩展」，与我们真正关心的那件事足够接近。')}`,
  { page: PG });

// ⑦ 设置块补两样
board('SysBlockV2.dc.html', 1320, 620, '设置块 · 补上画过但没落地的两样', `${head('app/sys-settings.js 与画布的差',
  '三态落地了（还没同步 / 还没配引擎 / 已同步 / 同步失败）。画布里另外两样没落地。')}
${grid(2, `
${cell('<s>补：「打开『设置』」按钮</s> —— 落地时作废', '<b>这一条不做了。</b>openSettingsURLString 打开的是我们自己 App 的设置页；能直达「设置 › App › 翻译」的 prefs:root= 是私有接口。一个点了会把人带到别处的按钮，比没有按钮更糟。', card('系统翻译',
  `<div class="dep"><b>引擎</b> · DeepSeek <span class="ok">✓</span> 已同步 · 译成 简体中文</div><div class="steps"><div>打开「设置」App</div><div>进入「App」→「翻译」</div><div>点「默认翻译App」，选「大肚猴翻译」</div></div><span class="mini">系统不提供直达那一页的链接，我们也带不了你过去 —— 只有这三步文字。</span>`))}
${cell('补：从发现卡滚过来的高亮', '发现卡上「打开『设置』」旁边还有一条「在 App 里看设置」——滚到这一块并闪一下（复用既有 anchor-flash）。', card('系统翻译 <span class="tag a">刚滚过来</span>',
  `<div class="dep"><b>引擎</b> · DeepSeek <span class="ok">✓</span> 已同步</div>${hint('这一块会闪一下（2.4 秒），与 openSettings(anchorId) 的既有行为一致。')}`))}
`, 20)}
${mini('画布里还有一态「系统太旧 ⇒ 整块变淡」，代码里落成了一句常驻说明 —— 因为 App 问不出系统版本。两者的差要在这一页记一笔，不是悄悄改掉。')}`,
  { page: PG, phone: true });

// ⑧ 新增文案总表
const rows = [
  ['setup_done_title', '可以用了', '配好之后的卡标题（四个落点共用）', '新增'],
  ['setup_done_onboard', '引擎配好了，浏览器那半边照常用。', '从引导来', '新增'],
  ['setup_done_settings', '引擎配好了。文档翻译、对话听译、实时字幕现在都能用了。', '从设置页来', '新增'],
  ['setup_done_systrans', '引擎配好了。回到刚才那个 App，再点一次「翻译」即可。', '从系统翻译来', '新增'],
  ['setup_done_quick', '引擎配好了。回到快速翻译面板，刚才那句可以重新翻一次。', '从 Mac 面板来', '新增'],
  ['setup_from_systrans', '从系统翻译过来的：配好之后，回到刚才的 App 再点一次「翻译」。', '设置页顶部那一行', '新增'],
  ['setup_unsaved', 'key 填在框里，但还没保存 —— 这个框是「改完自动存」，你点一下别处就好。', '半配好 ①', '新增'],
  ['setup_need_signin', '免费额度要先登录才领得到 —— 登录只用来认人，不同步任何内容。', '半配好 ③', '新增'],
  ['auth_err_key', '服务商拒绝了这把 key（HTTP 401/403）…', '半配好 ②', '复用既有'],
  ['systrans_discover_title', '让 iPhone 自带的「翻译」用上大肚猴', '首页发现卡标题', '新增'],
  ['systrans_discover_body', '在任何 App 里选中文字 › 翻译，弹出来的就是你配的引擎。设一次就好。', '发现卡正文', '新增'],
  ['systrans_discover_done', '我已设好', '发现卡次级动作（用户自己说）', '新增'],
  ['systrans_discover_used', '本月从系统翻译收进 {n} 句。', '发现卡「已在用」', '新增'],
  ['systrans_open_settings', '打开「设置」', '发现卡与设置块共用', '新增'],
  ['systrans_no_direct_link', '只能带你到「设置」首页，系统不提供直达那一页的链接。', '两处共用的灰字', '新增'],
  ['systrans_step1/2/3', '打开「设置」App / 进入「App」→「翻译」/ 点「默认翻译App」…', '三步指引', '复用既有'],
];
board('CopyDelta.dc.html', 1500, 820, '新增文案总表', `${head('这一稿新增的句子', '12 语种在落地那一步补。复用既有键的不重写 —— 同一件事在两处说得不一样是本仓踩过的坑。')}
<table class="tbl">
<tr><th>key</th><th>中文</th><th>出现位置</th><th>来源</th></tr>
${rows.map(([k, zh, where, src]) => `<tr><td><code style="font-size:.78rem">${k}</code></td><td>${zh}</td><td>${where}</td><td>${src === '新增' ? src : `<b>${src}</b>`}</td></tr>`).join('')}
</table>
${mini('自检那三行的文案（「测试中…」「✓ 通了 · {ms}ms」）全部复用 quick-setup 与 engine-test 已有的键，一个新的都不加。')}`,
  { page: PG });
