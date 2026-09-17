// 设置体验重设计 · 画布生成器（2026-09-17；同日第二轮裁定后修订）。
// 两宿主 × 快速/详细 的四节大量重复，手写十几份会互相走样；这里从共享片段拼出
// project/*.dc.html 与 project/canvas.json。改画布 = 改这个文件再 `node gen.mjs`。
// 发布：Artifact publish url=<画布> root=design/settings-ia file_path=project/canvas.json files=project/*。
//
// 第二轮裁定（09-17 下午）改变了形状：实时转写 = 设备内置（iOS 26 / macOS 26），**不再是设置项**；
// 云端实时引擎从产品里去掉；系统下限只管对话 · 实时字幕，App 与扩展仍是 iOS 16.4 / macOS 13.3。
// 于是没有「实时转写」槽卡、没有一键卡第四行、没有第二把 key。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'project');
fs.mkdirSync(OUT, { recursive: true });
for (const stale of ['Slots.dc.html', 'QuickCard.dc.html']) { try { fs.unlinkSync(path.join(OUT, stale)); } catch (_) {} }

// ─── 骨架 ────────────────────────────────────────────────────────────────
function board(w, h, inner, { dark = false, phone = false, pad = 24 } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
  <link rel="stylesheet" href="./ui.css">
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin:0; background:${dark ? '#1f1c19' : '#f5ead8'}; }
    a { color:${dark ? '#e9a978' : '#8c491a'}; } a:hover { color:${dark ? '#f6c9ac' : '#643312'}; }
  </style>
</helmet>
<div class="page${dark ? ' dark' : ''}${phone ? ' phone' : ''}" style="width:${w}px; height:${h}px; padding:${pad}px; display:flex; flex-direction:column; gap:22px">
${inner}
</div>
</x-dc>
<script data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;
}

// ─── 片段 ────────────────────────────────────────────────────────────────
const tabs = (mode) => `<div class="tabs" role="tablist"><span class="tab${mode === 'quick' ? ' on' : ''}">快速</span><span class="tab${mode === 'detail' ? ' on' : ''}">详细</span></div>`;
const secHead = (n, title, sub = '', right = '') =>
  `<div class="sec-h"><div class="t"><span class="n">${n}</span><h2>${title}</h2>${sub ? `<span class="sub">${sub}</span>` : ''}</div>${right}</div>`;
const card = (title, body, use = '', extra = '') =>
  `<section class="card"${extra}><h3>${title}${use ? `<span class="use">${use}</span>` : ''}</h3>${body}</section>`;
const sel = (label, value, ph = false) => `<div class="field"><label>${label}</label><div class="select"><span${ph ? ' class="ph"' : ''}>${value}</span></div></div>`;
const inp = (label, value, ph = false) => `<div class="field"><label>${label}</label><div class="input${ph ? ' ph' : ''}">${value}</div></div>`;
const key = (label = 'API Key', link = true) => `<div class="field"><label>${label}${link ? ' · <a href="#k">去拿 key ↗</a>' : ''}</label><div class="input">••••••••••••••••••••</div></div>`;
const sw = (label, small = '', on = true) => `<div class="row"><div class="l"><span>${label}</span>${small ? `<small>${small}</small>` : ''}</div><span class="sw${on ? ' on' : ''}"></span></div>`;
const test = (res, ok = true, label = '测试连接') => `<div class="split"><button class="btn s sm" type="button">${label}</button><span class="res${ok ? '' : ' no'}">${res}</span></div>`;
const dep = (items) => `<div class="dep"><b>依赖</b>${items.map((i) => ` · ${i}`).join('')}</div>`;
const ok = (slot, label) => `${slot}：${label} <span class="ok">✓</span>`;
const no = (slot, text = '未配置') => `${slot}：<span class="no">${text}</span> <a href="#go">去配置 →</a>`;
const qsRows = (rows) => `<div>${rows.map(([k, v, cls = '']) => `<div class="qs-row"><span class="k">${k}</span><span class="res${cls}">${v}</span></div>`).join('')}</div>`;
const hint = (t) => `<p class="hint">${t}</p>`;
const mini = (t) => `<p class="mini" style="margin:0 4px">${t}</p>`;
const box = (inner) => `<div style="background:var(--tint); border-radius:14px; padding:10px 12px; display:flex; flex-direction:column; gap:8px">${inner}</div>`;

const notesSub = box(`<span class="lbl">解析这句（可选）</span>
  <div class="rad on"><i></i>跟随翻译引擎</div>
  <div class="rad"><i></i>改用别的引擎 ▸</div>
  ${hint('例句与释义走这里的引擎；不另配就跟着翻译走。')}`);

const GATE_C = 'Gate C：说题与整段转写的录音只发到这里配置的端点，识别后即弃。';
const DEVICE_LINE = '实时转写：<b>设备内置</b>（本机 · iOS 26 / macOS 26）<span class="ok">✓</span>';
const LANGS_NOTE = '只列本机识别器支持的语言（由设备当场报出，不写死清单）：中 · 粤 · 英 · 日 · 韩 · 法 · 德 · 西 · 葡 · 意。';

// ─── 扩展端四节 ──────────────────────────────────────────────────────────
function extSec1(mode) {
  if (mode === 'detail') {
    return `<div class="sec">
${secHead(1, '引擎与密钥', '一键配置在「快速」里 →', tabs('detail'))}
${card('翻译', `${sel('引擎', 'DeepSeek')}${key()}<div class="grid2">${inp('接口地址', '注册表默认', true)}${inp('模型', '注册表默认', true)}</div>
  <div class="split"><a href="#adv">高级参数 ▸</a>${test('✓ 通了 · 412 ms')}</div>${notesSub}`)}
${card('整段转写', `${sel('引擎', 'OpenRouter · transcription')}${key()}<div class="grid2">${inp('接口地址', '注册表默认', true)}${inp('模型', '注册表默认', true)}</div>${test('✓ 通了 · 890 ms')}${hint(GATE_C)}`, '说题 · 转写整段音视频')}
${card('朗读', `${sel('引擎', '设备内置语音（免费 · 离线）')}${sel('声音', 'Tingting · 中文（普通话）')}${test('✓ 播放中', true, '试听一句')}${hint('默认用设备自带语音，不联网不花钱；也可指向自己搭的语音服务。语速与自动播放在下面「复习」里。')}`)}
${mini('对话 · 实时字幕（App）用设备内置识别，不是一个引擎项，也不需要 key。')}
</div>`;
  }
  return `<div class="sec">
${secHead(1, '引擎与密钥', '分别配每个引擎 → 详细', tabs('quick'))}
${card('免费额度 <span class="tag g">已领取</span>', `<div class="row"><span class="stat">剩 63% · 下月 1 日重置</span><a href="#g">怎么算 ↗</a></div><div class="prog"><div style="width:63%"></div></div>${hint('够读几百段网页和字幕，说题也在额度内。用完随时换成自己的 key —— 就在下面这张卡。')}`)}
${card('用一把 key 配好全部', `${sel('平台', 'OpenRouter')}${key()}<button class="btn p blk" type="button">配置并测试</button>
${qsRows([['翻译', '✓ 通了'], ['朗读', '✓ 通了'], ['整段转写', '✓ 通了']])}`)}
${mini('对话 · 实时字幕（App）用设备内置识别，不需要 key。')}
</div>`;
}

function extSec2() {
  return `<div class="sec">
${secHead(2, '功能')}
${card('网页翻译显示', `<div class="grid2">${sel('目标语言', '简体中文')}${sel('界面语言', '跟随浏览器')}</div><div class="grid3">${sel('字号', '默认')}${sel('译文颜色', '鼠尾草绿')}${sel('位置', '原文下方')}</div>${sw('页面上的悬浮按钮', '拖动可移；长按翻译当前段落')}`)}
${card('复习', `${dep([ok('朗读', '设备内置语音'), ok('解析', '跟随翻译引擎')])}<div class="grid2">${sel('语音模式', '显示原文，可点播放')}${sel('语速', '1.0×')}</div>${sw('进入卡片自动播放')}<div class="grid2">${inp('每日新卡', '20')}<div class="field"><label>&nbsp;</label><button class="btn s" type="button">打开复习页</button></div></div>`)}
${card('学习采集', `${sw('采集读到的句子', '翻译过的句子进复习，作为「网页」来源')}${sw('采集文档翻译', '译文进复习，作为「文档」来源')}<div class="field"><label>学习语言</label><div class="chips"><span class="chip on">English</span><span class="chip on">日本語</span><span class="chip">Français</span><span class="chip">＋</span></div></div><div class="row"><span>来源管理</span><a href="#src">3 条规则 →</a></div>`)}
${card('文档翻译', `${dep([ok('翻译', 'DeepSeek'), '识图：<span class="no">不支持</span> → 图片只显示不翻'])}<div><button class="btn s" type="button">打开文档翻译</button></div>`)}
</div>`;
}

function extSec3() {
  return `<div class="sec">
${secHead(3, '账号与数据')}
${card('登录 · 多设备同步', `<div class="row"><div class="l"><span>已登录 · Apple</span><small>句子与来源规则同步到 App 和你的其它设备</small></div><button class="btn s sm" type="button">退出</button></div><span class="stat">上次同步 2 分钟前 · 312 条</span>
<div class="row" style="border-top:1px solid var(--rule); padding-top:10px"><span class="stat">免费额度：已领取 · 剩 63%</span><a href="#grant">管理 →</a></div>`)}
${card('学习库', `<span class="stat">312 张卡 · 48 张待复习 · 27 条候选</span><div class="btns"><button class="btn s sm" type="button">导出</button><button class="btn s sm" type="button">导入</button><button class="btn s sm" type="button">拆分长段卡</button><button class="btn s sm" type="button">清理已掌握</button><button class="btn d sm" type="button">清空学习库</button></div>`)}
${card('缓存', `<div class="row"><span>翻译缓存 · 1.2 MB</span><button class="btn s sm" type="button">清空</button></div><div class="row"><span>语音缓存 · 3.4 MB</span><button class="btn s sm" type="button">清空</button></div>`)}
</div>`;
}

function extSec4() {
  return `<div class="sec">
${secHead(4, '关于')}
${card('大肚猴翻译 · v1.12.0', `<div class="split"><a href="#fb">发送反馈</a><span class="mini">·</span><a href="#gh">GitHub 讨论区</a><span class="mini">·</span><a href="#rate">去商店评分</a></div>${sw('分享匿名用量数据', '只有用了哪些功能、成功还是失败；不含网页、文字、密钥或账号 · 关掉即删')}<div class="btns"><button class="btn s sm" type="button">重看开始使用引导</button></div>${hint('删除 App 不会清除这里的数据。要彻底清干净，先在这里清除。')}<div><button class="btn d sm" type="button">清除本机全部数据</button></div>`)}
</div>`;
}

// ─── App 四节 ────────────────────────────────────────────────────────────
function appSec1(mode, { china = false } = {}) {
  if (mode === 'detail') {
    const file = china ? '通义千问 · 语音转写' : 'OpenRouter · transcription';
    return `<div class="sec">
${secHead(1, '引擎与密钥', '', tabs('detail'))}
${mini('一键配置在「快速」里 →')}
${card('翻译', `${sel('引擎', 'DeepSeek')}${key()}${inp('接口地址', '注册表默认', true)}${inp('模型', '注册表默认', true)}${test('✓ 通了 · 412 ms')}${notesSub}`)}
${card('整段转写', `${sel('引擎', file)}${key()}${inp('接口地址', '注册表默认', true)}${inp('模型', '注册表默认', true)}${test('✓ 通了 · 890 ms')}${hint(GATE_C)}`, '说题')}
${card('朗读', `${sel('引擎', '设备内置朗读（离线模型 · 仅 App）')}${sel('声音', '自动 · 按卡片语言')}
${box(`<div class="row"><div class="l"><span>离线模型 <span class="tag g">已安装</span></span><small>中文 + English · 129 MB</small></div><button class="btn s sm" type="button">重新下载</button></div>`)}
${test('✓ 播放中', true, '试听一句')}`)}
${mini('对话 · 实时字幕用设备内置识别（iOS 26 / macOS 26），不是一个引擎项 —— 状态在下面「对话与字幕」块里。')}
</div>`;
  }
  return `<div class="sec">
${secHead(1, '引擎与密钥', '', tabs('quick'))}
${mini('分别配每个引擎 → 详细')}
${card('免费额度 <span class="tag g">已领取</span>', `<div class="row"><span class="stat">剩 63% · 下月 1 日重置</span></div><div class="prog"><div style="width:63%"></div></div>${hint('翻译、朗读、说题都在额度内。对话 · 实时字幕用本机识别，不花额度。')}`)}
${card('用一把 key 配好全部', `${sel('平台', 'OpenRouter')}${key()}<button class="btn p blk" type="button">配置并测试</button>
${qsRows([['翻译', '✓ 通了'], ['朗读', '✓ 通了'], ['整段转写', '✓ 通了']])}`)}
${mini('对话 · 实时字幕用设备内置识别，不需要 key。')}
</div>`;
}

// 对话 · 实时字幕块 —— 三态：就绪 / 语言包下载中 / 旧系统不可用
function listenCard(state = 'ready', { quick = false } = {}) {
  const title = '对话 · 实时听译 与 实时字幕';
  if (state === 'oldos') {
    return `<section class="card"><h3>${title}</h3>
<div class="note w">需要 iOS 26 / macOS 26 —— 本机识别器在这台设备上不可用。网页翻译、复习、文档翻译不受影响。</div>
${hint('入口在首页是灰的，原因写在按钮上方；没有「去设置」可跳 —— 这不是配置问题。')}</section>`;
  }
  const pack = state === 'downloading'
    ? box(`<div class="row"><div class="l"><span>正在下载 日本語 识别语言包</span><small>62% · 由系统下载，只下模型文件</small></div><button class="btn s sm" type="button">停止</button></div><div class="prog"><div style="width:62%"></div></div>`)
    : box(`<div class="row"><div class="l"><span>识别语言包 <span class="tag g">已就绪</span></span><small>中文 ✓ · English ✓ · 换语言时由系统按需下载</small></div></div>`);
  const d = quick ? dep([DEVICE_LINE, '<span class="ok">其余由一键配置提供 ✓</span>']) : dep([DEVICE_LINE, ok('翻译', 'DeepSeek'), ok('朗读', '设备内置朗读')]);
  return `<section class="card"><h3>${title}</h3>${d}${pack}
<div class="grid2">${sel('我的语言', '中文')}${sel('对方的语言', state === 'downloading' ? '日本語' : 'English')}</div>${sel('视频的语言 <span class="tag n">新</span>', 'English')}${mini(LANGS_NOTE)}
${sw('自动朗读对方的话')}${sw('对话进复习', '定稿句对作为「对话」来源')}${sw('字幕进复习', '作为「字幕」来源')}
${hint('原文在本机识别，一个字节不离开设备；译文经你配置的翻译引擎。')}</section>`;
}

function appSec2({ quick = false, china = false } = {}) {
  const d = (items) => quick ? dep(['<span class="ok">由一键配置提供 ✓</span>']) : dep(items);
  return `<div class="sec">
${secHead(2, '功能')}
${sel('界面语言', '跟随系统')}
${card('复习', `${d([ok('朗读', '设备内置朗读'), ok('解析', '跟随翻译引擎')])}${sel('语音模式', '显示原文，可点播放')}${sel('语速', '1.0×')}${sw('进入卡片自动播放')}${inp('每日新卡', '20')}`)}
${card('学习采集', `${hint('这里改的是浏览器扩展那头的采集。')}<div class="field"><label>学习语言</label><div class="chips"><span class="chip on">English</span><span class="chip on">日本語</span><span class="chip">＋</span></div></div><div class="row"><span>来源管理</span><a href="#src">3 条规则 →</a></div>`)}
${card('播客模式', `${d([ok('朗读', '设备内置朗读'), ok('解析', '跟随翻译引擎')])}${sw('播放句子解析', '每张卡多一次付费调用', false)}${sel('出发前预载', '3 天')}<button class="btn s" type="button">先算账（约 12 次调用）</button><div class="row"><span class="stat">音频缓存 · 8.6 MB</span><button class="btn s sm" type="button">清空</button></div>`)}
${listenCard('ready', { quick })}
${card('文档翻译', `${d([ok('翻译', 'DeepSeek')])}${sw('译文进复习', '作为「文档」来源')}${sw('预取下一页', '只解析不翻译', false)}`)}
</div>`;
}

function appSec3() {
  return `<div class="sec">
${secHead(3, '账号与数据')}
${card('账号', `<div class="row"><div class="l"><span>已登录 · Apple</span><small>句子与来源规则同步到扩展和其它设备</small></div><button class="btn s sm" type="button">退出</button></div><div><button class="btn d sm" type="button">删除账号</button></div>`)}
${card('学习库', `<span class="stat">312 张卡 · 48 张待复习 · 27 条候选</span><div class="btns"><button class="btn s sm" type="button">拆分长段卡</button><button class="btn s sm" type="button">清理已掌握</button><button class="btn d sm" type="button">清空学习库</button></div>`)}
</div>`;
}

function appSec4({ china = false } = {}) {
  return `<div class="sec">
${secHead(4, '关于')}
${card('大肚猴翻译 · v1.12.0', `<div class="btns"><button class="btn s sm" type="button">发送反馈</button><button class="btn s sm" type="button">去评分</button></div>${china ? '' : sw('分享匿名用量数据', '不含文字、密钥或账号 · 关掉即删')}`)}
</div>`;
}

// ─── 页 1 · 落地稿 ──────────────────────────────────────────────────────
const W = {};
W['Main.dc.html'] = board(860, 2100, `<div class="frame-h"><h1>设置 · 扩展 · 详细</h1><span class="mini">Chrome / Safari / Firefox 设置页 · 浅色</span></div>${extSec1('detail')}${extSec2()}${extSec3()}${extSec4()}`);
W['ExtQuick.dc.html'] = board(860, 1700, `<div class="frame-h"><h1>设置 · 扩展 · 快速</h1><span class="mini">②③④ 与「详细」逐字相同 —— 档位只管第一节</span></div>${extSec1('quick')}${extSec2()}${extSec3()}${extSec4()}`);
W['AppDetail.dc.html'] = board(390, 2600, `<div class="frame-h"><h1 style="font-size:1.15rem">设置 · App · 详细</h1></div>${appSec1('detail')}${appSec2()}${appSec3()}${appSec4()}`, { phone: true, pad: 16 });
W['AppQuick.dc.html'] = board(390, 2150, `<div class="frame-h"><h1 style="font-size:1.15rem">设置 · App · 快速 · 深色</h1></div>${appSec1('quick')}${appSec2({ quick: true })}${appSec3()}${appSec4()}`, { phone: true, pad: 16, dark: true });
W['China.dc.html'] = board(390, 2300, `<div class="frame-h"><h1 style="font-size:1.15rem">设置 · App · 中国版 · 详细</h1></div>${mini('没有免费额度卡；整段转写默认千问；对话同样用设备内置识别；无遥测块。')}${appSec1('detail', { china: true })}${appSec2({ china: true })}${appSec3()}${appSec4({ china: true })}`, { phone: true, pad: 16 });

// 对话块三态特写
W['ListenBlock.dc.html'] = board(1180, 760, `<div class="frame-h"><h1>「对话与字幕」块 · 三种状态</h1><span class="mini">实时转写固定为设备内置，所以这块没有引擎下拉、没有 key；只有语言、语言包、采集开关</span></div>
<div class="grid3" style="align-items:start">
<div class="stack"><span class="lbl">① 就绪</span>${listenCard('ready')}</div>
<div class="stack"><span class="lbl">② 换了语言 · 语言包下载中</span>${listenCard('downloading')}</div>
<div class="stack"><span class="lbl">③ 旧系统（iOS &lt; 26 / macOS &lt; 26）</span>${listenCard('oldos')}${mini('App 与扩展的下限仍是 iOS 16.4 / macOS 13.3；只有这一块要 26。商店描述与官网把这句写在功能旁边。')}</div>
</div>`);

// 朗读卡 · 离线模型行五态
function modelRow(state) {
  switch (state) {
    case 1: return box(`<div class="row"><div class="l"><span>离线模型 <span class="tag a">未下载</span></span><small>中文 + English · 129 MB</small></div><button class="btn p sm" type="button">下载</button></div>${mini('首次朗读也会自动下载；只下模型文件，不上传任何内容。')}`);
    case 2: return box(`<div class="row"><div class="l"><span>正在下载 · 中文</span><small>43% · 55 / 129 MB</small></div><button class="btn s sm" type="button">停止</button></div><div class="prog"><div style="width:43%"></div></div>`);
    case 3: return box(`<div class="row"><div class="l"><span>离线模型 <span class="tag g">已安装</span></span><small>中文 · English · 129 MB</small></div><button class="btn s sm" type="button">重新下载</button></div>`);
    case 4: return box(`<div class="row"><div class="l"><span>下载失败 <span class="tag a">网络中断</span></span><small>已下 55 / 129 MB，重试会续传</small></div><button class="btn s sm" type="button">重试</button></div>${mini('或先 <a href="#sys">换成系统语音</a> —— 不下载也能朗读。')}`);
    default: return '';
  }
}
function ttsCard(state, testLabel, res, resOk = true) {
  return `<section class="card"><h3>朗读</h3>${sel('引擎', '设备内置朗读（离线模型 · 仅 App）')}${sel('声音', '自动 · 按卡片语言')}${modelRow(state)}${test(res, resOk, testLabel)}</section>`;
}
W['TtsModel.dc.html'] = board(1100, 620, `<div class="frame-h"><h1>朗读卡 · 离线模型行的五种状态</h1><span class="mini">回应「系统 TTS 下载触发没感受到」：今天只有对话开始那一步会下载，设置里选了、试听了都静默失败</span></div>
<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; align-items:start">
  <div class="stack"><span class="lbl">浅色 · ① 未下载 → ② 下载中 → ③ 已安装</span><div class="grid3" style="gap:12px">${ttsCard(1, '下载并试听（129 MB）', '', true)}${ttsCard(2, '试听一句', '等模型就位…', false)}${ttsCard(3, '试听一句', '✓ 播放中')}</div></div>
  <div class="dark" style="background:#1f1c19; border-radius:20px; padding:16px; display:flex; flex-direction:column; gap:10px"><span class="lbl">深色 · ④ 失败有出口 · ⑤ 回落具名</span><div class="grid2" style="gap:12px">${ttsCard(4, '试听一句', '✗ 模型未就位 · 先下载或换系统语音', false)}${ttsCard(3, '试听一句', '✓ 播放中 · 日本語 无离线模型，用系统语音', true)}</div>${mini('四处首播（设置试听 · 复习 · 播客 · 对话）统一走同一个下载入口，进度显示在各自的状态行，不弹框。对话块的「识别语言包」行同一形状。')}</div>
</div>`);

// 依赖行模式
W['DepLine.dc.html'] = board(900, 440, `<div class="frame-h"><h1>「依赖」行 · 每个功能块的第一行</h1><span class="mini">只读；标签来自注册表；点「去配置」按锚点表翻到对应槽卡（在「详细」里就先切档）</span></div>
<div class="stack">
${dep([DEVICE_LINE, ok('翻译', 'DeepSeek'), ok('朗读', '设备内置朗读')])}
${dep([no('朗读'), ok('翻译', 'DeepSeek')])}
${dep(['<span class="ok">由一键配置提供 ✓</span>', '<span class="mini">（快速档 · 一键卡已配好的槽不再逐个列）</span>'])}
${dep(['实时转写：设备内置 <span class="no">需要 iOS 26 / macOS 26</span>', '<span class="mini">（旧系统 · 没有「去配置」，因为不是配置问题）</span>'])}
${dep([ok('整段转写', 'OpenRouter · transcription'), '<span class="mini">说题 · 录音只发到这个端点</span>'])}
<div class="dark" style="background:#1f1c19; border-radius:16px; padding:12px">${dep([ok('朗读', '设备内置朗读'), no('解析')])}</div>
</div>`);

// 解剖
W['Anatomy.dc.html'] = board(1000, 1100, `<div class="frame-h"><h1>解剖 · 搬家表 / 删除清单 / 锚点 / 门禁</h1><span class="mini">「搬」= 移动 DOM 节点，id 一个不改；新 id 只有三组</span></div>
<div class="grid2" style="align-items:start">
<section class="card"><h3>搬家表（节选）</h3><table class="tbl"><tr><th>控件</th><th>宿主</th><th>旧 → 新</th><th>档位</th></tr>
<tr><td>mode-tabs</td><td>E A</td><td>页顶 → ① 节头</td><td>—</td></tr>
<tr><td>notes-core / btn-test-notes</td><td>E</td><td>learn-card → engine-card 子块</td><td>both → adv</td></tr>
<tr><td>stt-core / btn-test-stt</td><td>E</td><td>learn-card → 新 #stt-card</td><td>both → adv</td></tr>
<tr><td>stt-engine…stt-model</td><td>A</td><td>「转写引擎」→ ① #stt-card</td><td>adv</td></tr>
<tr><td>tts-voice</td><td>A</td><td>「语音」→ ① 朗读卡</td><td>both → adv</td></tr>
<tr><td><b>tts-model-row / -dl / -progress</b></td><td>A</td><td><b>新增</b> ① 朗读卡</td><td>adv</td></tr>
<tr><td>tts-mode / tts-autoplay / tts-rate</td><td>E A</td><td>tts-card → ② 复习</td><td>E: adv → both</td></tr>
<tr><td>tts-cache / btn-clear-tts</td><td>E</td><td>tts-card → ③ 缓存</td><td>adv → both</td></tr>
<tr><td>learn-daily-new / daily</td><td>E A</td><td>→ ② 复习</td><td>both</td></tr>
<tr><td>导入导出 / 统计 / 拆分 / 清理</td><td>E</td><td>learn-card → ③ 学习库</td><td>both</td></tr>
<tr><td>cache-card</td><td>E</td><td>→ ③</td><td>adv → both</td></tr>
<tr><td>listen-* / subtitle-capture / <b>subtitle-video-lang</b> / <b>listen-pack-row</b></td><td>A</td><td>→ ② 对话与字幕</td><td>both</td></tr>
<tr><td>drive-*</td><td>A</td><td>→ ② 播客</td><td>both</td></tr>
<tr><td><b>dep-*</b>（8 条）</td><td>E A</td><td><b>新增</b> 各功能块首行</td><td>both</td></tr>
</table></section>
<div class="stack">
<section class="card"><h3>删除清单（走 docs PR）</h3><table class="tbl">
<tr><td>注册表 <span class="kbd">liveEndpoint / liveType / liveModel / liveRate / liveKeyProtocol</span></td><td>两条云端实时条目降为纯文件档</td></tr>
<tr><td>stt 注册表的 <span class="kbd">device</span> 条目</td><td>本机识别不是可选引擎；整段下拉自然没有它</td></tr>
<tr><td><span class="kbd">ws-transcribe.js</span> 传输、<span class="kbd">wire-format</span> 的 ws 分支</td><td>留 <span class="kbd">splitSentences</span></td></tr>
<tr><td>一键卡实时格 <span class="kbd">#qs-live*</span>、锚点 <span class="kbd">#quick-live</span>、<span class="kbd">grant_no_live</span></td><td>所有宿主</td></tr>
<tr><td>门禁「每个 flavor 至少一个云端实时引擎」</td><td>改为「实时转写是本机能力」</td></tr></table></section>
<section class="card"><h3>存储与迁移</h3>${hint('不新增键。sttEngine 四元组只表示整段转写；App 启动时若 sttEngine === "device" ⇒ 清空（说题哨兵 —— 它在文件槽从未工作过）。subtitleVideoLang 进设置页。对话与字幕读 NativeSpeech，不再读 sttEngine。')}</section>
<section class="card"><h3>锚点 · 门禁</h3>${hint('E：#engine · #stt（改为切详细）· #grant · #learn · #sync · 新 #tts · 新 #review；删 #quick-live。A：stt · tts · notes · listen · account，目标带 .adv-only ⇒ 先切详细。首页灰态（旧系统）不再跳设置，原因写在按钮上方。')}${hint('SAVE_FIELDS 29 个 id 不动 · smoke ENGINE_CARDS += stt-card，新增「快速档 tts-mode / learn-daily-new / cache-card 可见」「#qs-live 不存在」· test:app 三个下拉 × 每引擎可见性，整段下拉无 device · test:listen 改假原生桥出 stt-partial / stt-final，加语言包行三态 · registry 门改写 · telemetry：asr_entry.no_live 保留，含义改为「本机不可用」')}</section>
</div></div>`);

// ─── 页 2 · 存档 ────────────────────────────────────────────────────────
const oldC = (name, mode, bad = '') => `<div class="c${bad ? ' bad' : ''}"><span>${name}</span><span class="split"><span class="tag n">${mode}</span>${bad ? `<span class="mini">${bad}</span>` : ''}</span></div>`;
W['CurrentExt.dc.html'] = board(860, 900, `<div class="frame-h"><h1>现状 · 扩展设置页（基线）</h1><span class="mini">10 张卡一条长页；档位切整页；转写与解析藏在「学习」卡里</span></div>
<div class="old">
${oldC('setup-note · 提示条', 'both')}${oldC('mode-tabs 快速 | 详细（切整页）', '—', '档位与「学习」「登录」无关却一起被切')}${oldC('grant-card 免费额度', 'quick')}${oldC('quick-setup-card 一键（含「实时转写（可选）」格）', 'quick', '填了会替换 sttEngine，说题录音改道')}${oldC('engine-card 翻译引擎', 'adv')}${oldC('lang-card 语言', 'both')}${oldC('style-card 显示样式', 'both')}${oldC('cache-card 缓存', 'adv')}${oldC('learn-card 学习（采集 + 每日新卡 + 语言 + 解析引擎 ×4 + 转写引擎 ×4 + 来源 + 导入导出 + 统计 + 清理）', 'both', '一张卡装了三种东西')}${oldC('sync-section 登录 · 同步', 'both')}${oldC('tts-card 语音（模式 + 引擎 ×4 + 声音 + 语速 + 自动播放 + 试听 + 缓存）', 'adv', '模式/语速是复习的事，却要开「详细」才看得到')}${oldC('about-card 关于（版本 · 反馈 · 遥测 · 重看引导 · 清除）', 'both')}
</div>`);
W['CurrentApp.dc.html'] = board(390, 1180, `<div class="frame-h"><h1 style="font-size:1.15rem">现状 · App 设置（基线）</h1></div>${mini('17 组一条长页；转写四行全是 adv-only，首页灰态按钮跳过来落在隐藏控件上')}
<div class="old">
${oldC('mode-tabs', '—')}${oldC('grant-card', 'quick')}${oldC('quick-setup-card（含实时格）', 'quick', '写的是同一把 sttEngine')}${oldC('ui-lang', 'both')}${oldC('daily', 'both')}${oldC('语音：模式 · 自动 · 引擎×4(adv) · 声音 · 语速 · 试听(adv)', '混')}${oldC('句子解析 ×4', 'adv')}${oldC('播客模式', 'both')}${oldC('对话 · 实时听译（采集 · 语言对 · 自动朗读）', 'both')}${oldC('文档翻译', 'both')}${oldC('亮屏说明 · 预载 · 音频缓存', 'both')}${oldC('转写引擎 ×4 + 测试（含设备内置 · 云端实时）', 'adv', 'openSettings 不切档 ⇒ 落到隐藏下拉')}${oldC('学习语言', 'both')}${oldC('来源管理', 'both')}${oldC('学习库', 'both')}${oldC('反馈', 'both')}${oldC('匿名用量', 'both')}${oldC('账号', 'both')}
</div>`, { phone: true, pad: 16 });
W['DirectionB.dc.html'] = board(860, 760, `<div class="frame-h"><h1>方案 B · 保留按引擎类型分组 + 加「用途」列（未选）</h1><span class="mini">改动最小，但复习/听译的旋钮仍与引擎混排；用户还得自己把「用途」拼成心智模型</span></div>
<div class="grid2">
<section class="card"><h3>转写引擎</h3><table class="tbl"><tr><th>引擎</th><th>用途</th></tr><tr><td>OpenRouter · transcription</td><td>说题 · 字幕</td></tr><tr><td>设备内置转写</td><td>对话 · 实时字幕</td></tr></table>${hint('用途成了一列文字，仍然是一个槽位 —— 选了设备内置，说题照旧消失；只是多了一句解释。')}</section>
<section class="card"><h3>语音</h3><table class="tbl"><tr><th>控件</th><th>用途</th></tr><tr><td>语音模式 · 语速 · 自动播放</td><td>复习</td></tr><tr><td>引擎 · 声音 · 试听</td><td>朗读</td></tr></table>${hint('复习的旋钮还是要开「详细」才看得到。')}</section>
</div>${mini('留档理由：下次有人问「为什么不只加一列」时不必重推。它只回应了投诉 ④ 的一半，① ② ③ ⑤ 都没解。')}
${mini('同日上午还有一版「两槽方案」（整段槽 + 实时槽 + 第二把 key），被下午「实时转写 = 设备内置、云端实时去掉」的裁定取代 —— 见 git 历史 design/settings-ia。')}`);

for (const [name, html] of Object.entries(W)) fs.writeFileSync(path.join(OUT, name), html);

// ─── 画布索引 ────────────────────────────────────────────────────────────
const idx = {
  v: 3,
  createdOnFiles: { v: 1, at: '2026-09-17T06:40:00Z' },
  title: '设置体验重设计',
  launch: { view: 'canvas', page: 'p1' },
  pages: [{ id: 'p1', name: '方案 A · 落地稿' }, { id: 'p2', name: '存档 · 现状与未选方向' }],
  boards: {
    'Main.dc.html':        { x: 0,    y: 0,    w: 860,  h: 2100, page: 'p1', title: 'Ext · 详细' },
    'ExtQuick.dc.html':    { x: 940,  y: 0,    w: 860,  h: 1700, page: 'p1', title: 'Ext · 快速' },
    'AppDetail.dc.html':   { x: 1880, y: 0,    w: 390,  h: 2600, page: 'p1', title: 'App · 详细' },
    'AppQuick.dc.html':    { x: 2350, y: 0,    w: 390,  h: 2150, page: 'p1', title: 'App · 快速 · 深色' },
    'China.dc.html':       { x: 2820, y: 0,    w: 390,  h: 2300, page: 'p1', title: '中国版 · App 详细' },
    'ListenBlock.dc.html': { x: 0,    y: 2900, w: 1180, h: 760,  page: 'p1', title: '对话与字幕块 · 三态' },
    'TtsModel.dc.html':    { x: 1260, y: 2900, w: 1100, h: 620,  page: 'p1', title: '朗读卡 · 离线模型行' },
    'DepLine.dc.html':     { x: 1260, y: 3640, w: 900,  h: 440,  page: 'p1', title: '依赖行模式' },
    'Anatomy.dc.html':     { x: 2440, y: 2900, w: 1000, h: 1100, page: 'p1', title: '解剖 · 搬家 / 删除 / 门禁' },
    'CurrentExt.dc.html':  { x: 0,    y: 0, w: 860, h: 900,  page: 'p2', title: '现状 · 扩展' },
    'CurrentApp.dc.html':  { x: 940,  y: 0, w: 390, h: 1180, page: 'p2', title: '现状 · App' },
    'DirectionB.dc.html':  { x: 1410, y: 0, w: 860, h: 760,  page: 'p2', title: '方案 B（未选）' },
  },
  order: ['Main.dc.html', 'ExtQuick.dc.html', 'AppDetail.dc.html', 'AppQuick.dc.html', 'China.dc.html', 'ListenBlock.dc.html', 'TtsModel.dc.html', 'DepLine.dc.html', 'Anatomy.dc.html', 'CurrentExt.dc.html', 'CurrentApp.dc.html', 'DirectionB.dc.html'],
  notes: {},
  designSystems: [],
};
const sticky = (id, x, y, text, { page = 'p1', w = 420, color, maxH = 320 } = {}) => { idx.notes[id] = { x, y, w, maxH, text, page, ...(color ? { color } : {}) }; };
idx.notes.t1 = { x: 0, y: -320, text: '方案 A · 落地稿 —— 设置页按用途分四节；实时转写 = 设备内置，不再是设置项', kind: 'title1', maxW: 3200, page: 'p1' };
idx.notes.t2 = { x: 0, y: 2580, text: '组件特写 · 三张 + 解剖', kind: 'title1', maxW: 2400, page: 'p1' };
idx.notes.t3 = { x: 0, y: -320, text: '存档 · 现状基线与未选方向', kind: 'title1', maxW: 2200, page: 'p2' };

sticky('why', 3300, 0, '为什么改：存储里只有一组转写凭证，却服务文件（说题 · 扩展整段字幕）与实时（App 对话 · 实时字幕）两种能力；一键卡「实时转写（可选）」格填了会整个换掉整段引擎，说题录音随之改道。\n\n下午的裁定把问题直接消掉了：实时转写就是设备内置（iOS 26 / macOS 26 的 SpeechAnalyzer），云端实时引擎去掉。于是转写只剩一个槽 —— 整段转写 —— 没有第二把 key、没有替换、没有混。', { color: 'orange', maxH: 380 });
sticky('done', 3300, 440, '已定（2026-09-17）：\n① 「快速 / 详细」只管「引擎与密钥」一节，其余三节永远可见。\n② 说题不接设备内置转写；整段转写下拉只列云端/自建。\n③ iOS 26 / macOS 26 只是对话 · 实时字幕的要求；App 与扩展下限仍是 iOS 16.4 / macOS 13.3。\n④ 云端实时转写引擎从产品里去掉；实时转写 = 设备内置，固定，不是设置项。', { color: 'green', maxH: 380 });
sticky('d1', 3300, 880, '待点头 1 · 文案：整段转写卡叫「整段转写（说题 · 字幕）」；对话块依赖行写「实时转写：设备内置（本机 · iOS 26 / macOS 26）」。', { color: 'blue' });
sticky('d2', 3300, 1100, '待点头 2 · 音色归「① 朗读槽」（App 里从两档可见变为详细才可见），不归「② 复习」。理由：音色是引擎属性，随引擎变。', { color: 'blue' });
sticky('d3', 3300, 1320, '待点头 3 · 离线模型下载：设置里手动「下载」+ 四处首播（设置试听 · 复习 · 播客 · 对话）自动下载并在状态行显示进度；不弹框。对话块的「识别语言包」行同一形状。系统语音仍是推荐路。', { color: 'blue' });
sticky('d4', 3300, 1560, '待点头 4 · 对话的语言下拉只列本机识别器支持的语言，由设备当场报出（不写死清单）。后果：阿拉伯语 / 俄语 / 印地语用户没有对话与实时字幕，其余功能不受影响。', { color: 'blue' });
sticky('d5', 3300, 1800, '待点头 5 · ③ 里的免费额度只读摘要行：要。卡本身留在 ①（规约：额度是一键配置的一部分，不是第二张卡）。', { color: 'blue' });
sticky('d6', 3300, 2020, '待点头 6 · 删除清单（见「解剖」板）走 docs PR：注册表 live* 五字段与 device STT 条目、ws 传输、一键卡实时格、#quick-live、grant_no_live、「每 flavor 一个云端实时引擎」门。商店描述与官网在对话 · 实时字幕旁写「需要 iOS 26 / macOS 26」。', { color: 'blue', maxH: 360 });
sticky('arch', 0, -180, '这一页留着是为了下次有人问「为什么不那样做」时不必重推。左：今天的两张长页与三处乱点；右：只加一列「用途」的方案 B。上午那版两槽方案见 git 历史。', { page: 'p2', w: 900, color: 'gray', maxH: 160 });

fs.writeFileSync(path.join(OUT, 'canvas.json'), JSON.stringify(idx, null, 2) + '\n');
console.log(Object.keys(W).length + ' boards → ' + OUT);
