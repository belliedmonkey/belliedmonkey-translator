// 系统翻译（iPhone）与快速翻译（Mac）· 交互稿生成器 —— 共用骨架、样式与片段。
// 约定同 design/settings-ia/gen.mjs：改画布 = 改 parts/*.mjs 再 `node gen.mjs`。
// 别的产品名不进任何一块板（AGENTS.md 规约）。图标一律内联描线 SVG，不用 emoji。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const OUT = path.join(HERE, 'project');
export const W = {};          // 文件名 → html
export const META = {};       // 文件名 → { w, h, page, title }
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 基础样式沿用设置重设计那张画布的令牌（build/palette.config.js 解析后的 hex），只在后面追加本画布的件。
export function css() {
  const base = fs.readFileSync(path.join(HERE, '..', 'settings-ia', 'project', 'ui.css'), 'utf8');
  return base + `
/* ── 本画布追加 ─────────────────────────────────────────────── */
.cap{display:flex;flex-direction:column;gap:2px}
.cap b{font-size:.95rem}.cap span{font-size:.8rem;color:var(--muted);line-height:1.45}
.cell{display:flex;flex-direction:column;gap:10px;min-width:0}
.pend{display:inline-flex;align-items:center;font-size:.72rem;font-weight:700;padding:2px 9px;border-radius:999px;background:#e4ecf7;color:#1f4a7a}
.dark .pend{background:#22364d;color:#bcd6f2}
.ico{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.ico.sm{width:15px;height:15px}
.ibtn{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:999px;border:0;background:transparent;color:var(--muted);cursor:pointer;flex:none}
.ibtn.on{color:var(--accent-deep);background:var(--warn-bg)}
.panel .ibtn{width:32px;height:32px}
/* 宿主 App 的示意底：几行灰条 + 一段被选中的字 */
.ctx{position:relative;background:#e9e4da;border-radius:28px;overflow:hidden;display:flex;flex-direction:column}
.dark .ctx{background:#121110}
.ctx .host{padding:22px 20px 0;display:flex;flex-direction:column;gap:9px;opacity:.55}
.ctx .ln{height:9px;border-radius:999px;background:#c9c1b3}.dark .ctx .ln{background:#3a352f}
.ctx .sel{font-size:.86rem;line-height:1.5;background:#b9d2f5;color:#1b2a3d;border-radius:4px;padding:1px 3px;align-self:flex-start;opacity:1}
.ctx .dim{position:absolute;inset:0;background:rgba(20,18,16,.28)}
/* iPhone 系统翻译弹层 */
.sheet{position:relative;margin-top:auto;background:var(--bg);border-radius:26px 26px 0 0;padding:8px 18px 18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 -6px 24px rgba(0,0,0,.18)}
.sheet.full{margin-top:34px;flex:1}
.grab{width:38px;height:5px;border-radius:999px;background:var(--track);align-self:center}
.sheet-h{display:flex;align-items:center;justify-content:space-between;gap:8px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:.95rem}
.mark{width:22px;height:22px;border-radius:7px;background:#c67139;display:inline-block;flex:none}
.eng{font-size:.76rem;color:var(--muted)}
.src{font-size:.92rem;line-height:1.5;color:var(--text)}
.src.q{color:var(--muted)}
.trbox{background:var(--card);border-radius:18px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.tr{font-size:1rem;line-height:1.6;color:var(--sage);font-weight:500}
.sk{height:11px;border-radius:999px;background:var(--rule)}
.langrow{display:flex;align-items:center;gap:8px;font-size:.8rem;color:var(--muted)}
.lchip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);border-radius:999px;padding:3px 10px;background:var(--card);color:var(--text);font-size:.8rem;font-weight:600}
.lchip.auto{background:var(--tip-bg);border-color:var(--tip-bd);color:var(--tip-tx)}
.foot{display:flex;gap:10px;align-items:center}
.foot .btn{flex:1}
.disc{font-size:.76rem;color:var(--muted);line-height:1.45;border-top:1px solid var(--rule);padding-top:8px}
.err{background:var(--warn-bg);border:1px solid var(--warn-bd);color:var(--warn-tx);border-radius:16px;padding:10px 12px;font-size:.86rem;line-height:1.5;display:flex;gap:8px;align-items:flex-start}
.code{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;color:var(--muted)}
/* Mac 快译面板 */
.desk{position:relative;border-radius:18px;background:linear-gradient(#d9d2c6,#cfc7b9);overflow:hidden}
.dark .desk{background:linear-gradient(#262320,#1b1917)}
.panel{width:400px;background:var(--bg);border:1px solid var(--border);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box}
.panel-h{display:flex;align-items:center;gap:6px}
.ptag{font-size:.74rem;font-weight:700;color:var(--muted);background:var(--tint);border-radius:999px;padding:3px 10px}
.panel .srcbox{border:1px solid var(--border);border-radius:12px;padding:8px 10px;font-size:.9rem;line-height:1.5;background:var(--card);min-height:40px}
.panel .srcbox.focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(172,98,49,.18)}
.caret{display:inline-block;width:2px;height:1.05em;background:var(--accent);vertical-align:-2px}
.pfoot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.78rem;color:var(--muted)}
.saved{display:inline-flex;align-items:center;gap:5px;color:var(--sage);font-weight:600}
.cursor{position:absolute;width:0;height:0;border-left:9px solid #201e1d;border-top:6px solid transparent;border-bottom:6px solid transparent;transform:rotate(45deg)}
.hostwin{position:absolute;background:#fbf8f2;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:34px 20px 16px;display:flex;flex-direction:column;gap:9px}
.dark .hostwin{background:#2b2723}
.hostwin::before{content:"";position:absolute;top:12px;left:14px;width:42px;height:10px;border-radius:999px;background:var(--track)}
/* 菜单栏菜单 */
.menu{width:300px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.25);padding:6px;display:flex;flex-direction:column;font-size:.9rem}
.mi{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px;border-radius:7px}
.mi.hot{background:var(--accent);color:#fff}.mi.off{color:var(--muted)}
.mi .kb{font-family:ui-monospace,Menlo,monospace;font-size:.8rem;opacity:.75}
.msep{height:1px;background:var(--rule);margin:5px 8px}
.mwarn{font-size:.8rem;color:var(--warn-tx);background:var(--warn-bg);border-radius:7px;padding:6px 10px;margin-bottom:4px}
.mbar{height:26px;background:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:flex-end;gap:14px;padding:0 14px;font-size:.78rem;color:#3a342c}
.dark .mbar{background:rgba(0,0,0,.35);color:#d8cfc0}
/* 快捷键录制 */
.rec{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--border);border-radius:999px;padding:6px 8px 6px 16px;min-height:40px;box-sizing:border-box;background:var(--card);font-size:.9rem}
.rec.live{border-color:var(--accent);box-shadow:0 0 0 3px rgba(172,98,49,.18)}
.rec.bad{border-color:var(--warn-bd);background:var(--warn-bg);color:var(--warn-tx)}
.keys{display:inline-flex;gap:4px}.keys i{font-style:normal;font-family:ui-monospace,Menlo,monospace;font-size:.82rem;background:var(--tint);border-radius:6px;padding:2px 7px;color:var(--text)}
/* 系统弹窗示意（不仿真，只占位） */
.sys{width:270px;background:#f4f4f4;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px;font-size:.82rem;color:#1d1d1f;box-shadow:0 12px 36px rgba(0,0,0,.3);text-align:center}
.sys b{font-size:.9rem}.sys .sb{display:flex;gap:8px}.sys .sb span{flex:1;background:#e2e2e4;border-radius:8px;padding:6px 0;font-weight:600}
.sys .sb span.p{background:#2f7bf6;color:#fff}
/* 流程图 */
.flow{display:grid;gap:14px 18px;align-items:center}
.node{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:8px 12px;font-size:.84rem;line-height:1.4;text-align:center}
.node.s{background:var(--tip-bg);border-color:var(--tip-bd);color:var(--tip-tx);font-weight:700}
.node.w{background:var(--warn-bg);border-color:var(--warn-bd);color:var(--warn-tx)}
.node.x{background:var(--tint);color:var(--muted);border-style:dashed}
.arr{color:var(--muted);font-size:1.1rem;text-align:center}
.steps{display:flex;flex-direction:column;gap:8px;counter-reset:st}
.steps>div{display:flex;gap:10px;align-items:flex-start;font-size:.88rem;line-height:1.5}
.steps>div::before{counter-increment:st;content:counter(st);display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:var(--tint);color:var(--text);font-size:.74rem;font-weight:700;flex:none;margin-top:2px}
.selbox{position:absolute;border:2px solid #fff;box-shadow:0 0 0 2000px rgba(0,0,0,.42);border-radius:2px}
.dimtag{position:absolute;background:#201e1d;color:#fff;font:600 .72rem ui-monospace,Menlo,monospace;border-radius:6px;padding:2px 6px}
`;
}

// ─── 骨架 ────────────────────────────────────────────────────────────────
export function board(file, w, h, title, inner, { dark = false, phone = false, pad = 24, page = 'p1', lang = 'zh-CN', gap = 18 } = {}) {
  W[file] = `<!doctype html>
<html lang="${lang}">
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
    body { margin:0; background:${dark ? '#1f1c19' : '#f5ead8'}; }
    a { color:${dark ? '#e9a978' : '#8c491a'}; } a:hover { color:${dark ? '#f6c9ac' : '#643312'}; }
  </style>
</helmet>
<div class="page${dark ? ' dark' : ''}${phone ? ' phone' : ''}" style="width:${w}px; height:${h}px; padding:${pad}px; display:flex; flex-direction:column; gap:${gap}px">
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

// ─── 图标（描线，不用 emoji）──────────────────────────────────────────────
const P = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  clip: '<rect x="6" y="5" width="12" height="16" rx="2.5"/><path d="M9 5a3 3 0 0 1 6 0"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4h4"/>',
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  expand: '<path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  type: '<path d="M5 6h14M12 6v13M9 19h6"/>',
};
export const ic = (n, cls = '') => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
export const ibtn = (n, label, on = false) => `<button class="ibtn${on ? ' on' : ''}" type="button" aria-label="${label}">${ic(n)}</button>`;

// ─── 通用片段 ────────────────────────────────────────────────────────────
export const head = (t, sub = '', right = '') => `<div class="frame-h"><div class="cap"><h1 style="margin:0;font-size:1.25rem">${t}</h1>${sub ? `<span>${sub}</span>` : ''}</div>${right}</div>`;
export const cap = (b, s = '') => `<div class="cap"><b>${b}</b>${s ? `<span>${s}</span>` : ''}</div>`;
export const cell = (b, s, inner) => `<div class="cell">${cap(b, s)}${inner}</div>`;
export const pend = (t) => `<span class="pend">待 ${t} 读数</span>`;
export const hint = (t) => `<p class="hint">${t}</p>`;
export const mini = (t) => `<p class="mini" style="margin:0">${t}</p>`;
export const card = (title, body, use = '') => `<section class="card"><h3>${title}${use ? `<span class="use">${use}</span>` : ''}</h3>${body}</section>`;
export const sel = (label, value) => `<div class="field"><label>${label}</label><div class="select"><span>${value}</span></div></div>`;
export const sw = (label, small = '', on = true) => `<div class="row"><div class="l"><span>${label}</span>${small ? `<small>${small}</small>` : ''}</div><span class="sw${on ? ' on' : ''}"></span></div>`;
export const btn = (t, kind = 'p', cls = '') => `<button class="btn ${kind}${cls ? ' ' + cls : ''}" type="button">${t}</button>`;
export const keys = (...k) => `<span class="keys">${k.map((x) => `<i>${x}</i>`).join('')}</span>`;
export const grid = (n, inner, gap = 22) => `<div style="display:grid; grid-template-columns:repeat(${n}, minmax(0, 1fr)); gap:${gap}px; align-items:start">${inner}</div>`;
export const err = (text, code) => `<div class="err">${ic('alert')}<div>${text}${code ? `<div class="code">${code}</div>` : ''}</div></div>`;

// 样例文字（真的翻译过的句子，不是占位）
export const S = {
  en: 'The committee postponed the vote until the new figures were published.',
  zh: '委员会把表决推迟到新数据公布之后。',
  enShort: 'postponed',
  zhShort: '推迟',
  zhSrc: '这份报告的结论与去年的完全相反。',
  enFromZh: 'The report’s conclusion is the exact opposite of last year’s.',
  ar: 'أجّلت اللجنة التصويت إلى حين نشر الأرقام الجديدة.',
};
