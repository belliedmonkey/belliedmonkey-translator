// 系统翻译（iPhone）与快速翻译（Mac）· 交互稿 · 画布生成器（2026-09-19）。
// 改画布 = 改 parts/*.mjs 再 `node gen.mjs`。形状同 design/settings-ia/gen.mjs。
// 发布：Artifact publish url=<画布> root=design/system-translate file_path=project/canvas.json files=project/*。
// 计划：~/.claude/plans/app-mac-moonlit-origami.md（第 0 步）。别的产品名不进任何一块板。
import fs from 'node:fs';
import path from 'node:path';
import { OUT, W, META, css } from './parts/00-base.mjs';
import './parts/10-phone-sheet.mjs';
import './parts/20-phone-app.mjs';
import './parts/30-mac-panel.mjs';
import './parts/40-mac-capture.mjs';
import './parts/50-mac-settings.mjs';
import './parts/60-global.mjs';

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.dc.html') && !W[f]) fs.unlinkSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'ui.css'), css());
for (const [name, html] of Object.entries(W)) fs.writeFileSync(path.join(OUT, name), html);

// ─── 画布索引：每页从左到右排一行，放不下换行 ───────────────────────────────
const PAGES = [
  ['p1', 'iPhone · 系统翻译弹层'], ['p2', 'iPhone · App 侧'], ['p3', 'Mac · 快译面板'],
  ['p4', 'Mac · 增强取词与截图'], ['p5', 'Mac · 设置与常驻'], ['p6', '全局 · 状态机 · 文案 · 待裁定'],
];
const ROW_W = 4200, GAP_X = 80, GAP_Y = 160;
const boards = {}; const order = []; const rowEnd = {};
for (const [pid] of PAGES) {
  let x = 0, y = 0, rowH = 0;
  for (const [file, m] of Object.entries(META)) {
    if (m.page !== pid) continue;
    if (x > 0 && x + m.w > ROW_W) { x = 0; y += rowH + GAP_Y; rowH = 0; }
    boards[file] = { x, y, w: m.w, h: m.h, page: pid, title: m.title };
    order.push(file); x += m.w + GAP_X; rowH = Math.max(rowH, m.h);
  }
  rowEnd[pid] = y + rowH;
}
const idx = {
  v: 3, createdOnFiles: { v: 1, at: '2026-09-19T09:30:00Z' },
  title: '系统翻译与快速翻译 · 交互稿',
  launch: { view: 'canvas', page: 'p1' },
  pages: PAGES.map(([id, name]) => ({ id, name })),
  boards, order, notes: {}, designSystems: [],
};
const title = (id, page, text) => { idx.notes[id] = { x: 0, y: -320, text, kind: 'title1', maxW: 4000, page }; };
const sticky = (id, page, x, y, text, { w = 460, color = 'blue', maxH = 300 } = {}) => { idx.notes[id] = { x, y, w, maxH, text, page, color }; };
title('t1', 'p1', 'iPhone · 在任何 App 里选字 › 翻译 ⇒ 我们的弹层');
title('t2', 'p2', 'iPhone · App 里要跟着变的地方');
title('t3', 'p3', 'Mac · 快速翻译面板');
title('t4', 'p4', 'Mac · 增强取词（可选权限）与截图翻译');
title('t5', 'p5', 'Mac · 设置、快捷键与常驻');
title('t6', 'p6', '全局 · 状态机 · 权限时序 · 文案总表 · 待裁定');

const NX = ROW_W + 160;
sticky('why', 'p1', NX, 0, '怎么读这张画布：每块板 = 一个状态或一个分支。板名旁的蓝色小标「待 T1 / T2 读数」= 这件事要等尖刺在真机上量过才知道，两支都画了，量完回来收敛成一支。\n\nT1 = iPhone 尖刺（系统翻译扩展）；T2 = Mac 尖刺（沙盒里的快捷键、取词、截图）。', { color: 'orange', maxH: 340 });
sticky('done', 'p1', NX, 380, '已定（2026-09-19）：\n① Mac 第一版 = 划词 + 输入 + 菜单栏 + 截图翻译。\n② Mac 取词分层：默认零权限，「增强取词」是默认关的开关。\n③ 两个面翻过的句子都进复习库。\n④ 先出这张交互稿 → 两个尖刺 → 再定先做哪个面。', { color: 'green', maxH: 340 });
const D = [
  ['d1', '待点头 1 · 弹层与面板第一版都不放「朗读」按钮。理由：系统弹层里再起一路朗读（引擎、离线模型、下载态）会把一个一秒钟的动作拖成一个小 App；要听就去复习库。'],
  ['d2', '待点头 2 · 不做独立的「翻译历史」面板。进了复习库的句子在来源管理里按月可查；没进的（采集关着、太长）就是不留 —— 这与「不留暗箱」是同一件事。'],
  ['d3', '待点头 3 · 不进新手引导（已经四屏）。iPhone 放首页发现卡、Mac 放首页介绍卡，都可关，入口常驻在设置里。'],
  ['d4', '待点头 4 · 收件箱收进复习库是静默的，不弹「收进 N 句」。数字在来源管理里看得到。'],
  ['d5', '待点头 5 · Mac 面板默认不抢焦点（输入翻译除外）；拖动即钉住；钉住不跨重启记忆。'],
  ['d6', '待点头 6 · 默认快捷键：翻译 ⌃⌥T、截图 ⌃⌥S、输入翻译留空。只有 ⌥ 加字母的组合直接不让设。'],
  ['d7', '待点头 7 · iPhone 弹层里不放加星、不放采集开关。弹层是一次性的；开关放在 App 设置里一个找得回来的地方。'],
  ['d8', '待点头 8 · 剪贴板带「隐藏 / 临时」标记时不读、不发、不存 —— 硬规则，不做成设置项。'],
  ['d9', '待点头 9 · 截图的文字识别默认在本机做；只有「没认出来」且用户点了「用我的识图引擎再试」，截图才离开设备。这改了此前「图片一律发给用户自己的多模态引擎」的做法，要在文档评审里单独论证。'],
  ['d10', '待点头 10 · 超过 2000 字：照常翻译，但不进复习库（那是文章，不是卡）。'],
  ['d11', '待点头 11 · iPhone 弹层里改目标语言只在这一次生效；Mac 面板里改会写回「译成」设置。两边不一样是因为弹层回写不了 App 的设置，不是设计偏好 —— 文案里要让人看得出来。'],
  ['d12', '待点头 12 · 新增的「译成」设置默认「跟随界面语言」，老用户升级后行为不变；它不管对话 · 实时字幕（那里有自己的一对语言），也不管扩展的网页翻译（两边存储不通）。'],
];
// 2026-09-19 用户回「按默认」⇒ 12 条全部按原文落定；便签由蓝（待点头）改绿（已定），文字里的「待点头」换成「已定」。
D.forEach(([id, text], i) => sticky(id, 'p6', NX + (i % 2) * 500, Math.floor(i / 2) * 330, text.replace('待点头', '已定'), { maxH: 300, color: 'green' }));
sticky('say', 'p6', NX, 6 * 330 + 40, '2026-09-19 用户裁定：「按默认」—— 上面 12 条全部按原文落定。下一步：T1（iPhone 扩展尖刺）与 T2（Mac 沙盒尖刺）；读数回来后把带「待 T1 / T2 读数」小标的板收敛成一支，再点一次头，然后才出文档 PR。', { color: 'orange', w: 960, maxH: 200 });
sticky('p3n', 'p3', NX, 0, '面板的窗口行为借用已经出货的实时字幕条：不抢焦点、盖在全屏 App 之上、跨桌面。所以「位置与层级」那块板里的行为不是新发明，是同一种窗口。', { color: 'gray' });
sticky('p4n', 'p4', NX, 0, '增强取词被审核卡住的退路：它本来就隔在一个开关后面。真被拒，下一版把这个开关藏掉即可，其余功能不受影响 —— 这也是为什么零权限那条路必须单独就够用。', { color: 'gray' });

fs.writeFileSync(path.join(OUT, 'canvas.json'), JSON.stringify(idx, null, 2) + '\n');
console.log(`${Object.keys(W).length} boards · ${PAGES.length} pages · ${Object.keys(idx.notes).length} notes → ${OUT}`);
for (const [pid, name] of PAGES) console.log(`  ${pid} ${name}: ${Object.values(boards).filter((b) => b.page === pid).length} boards`);
