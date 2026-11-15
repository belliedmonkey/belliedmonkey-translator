// src/content/sub-menu.jsx — 字幕控制菜单的静态 IIFE 宿主（BEL-277 修订）。
//
// 为什么不再用 React / 动态 import：
//   · 旧实现是 ESM 产物，subtitle-adapter 在第一次开菜单时 import(getURL(...))。
//     Safari/Firefox 的个别宿主内容脚本动态 import 不可用，而页面 CSP 也能把它拦掉；
//     菜单开不出没有降级路径。
//   · 新设计把它做成 **IIFE 静态 content_scripts 条目**（build/ui-entries.config.js
//     的 globalName 挂到 isolated-world 全局），不依赖 web_accessible_resources、
//     不需要 scripting 权限、同步注入面只多几 KB。
//   · 本文件因此是**纯 DOM**：行结构/文案/勾选态/定位公式仍由 subtitle-adapter 传入，
//     这里只负责画。React 依赖整块移除，静态注入的字节才付得起。
//
// 菜单挂一次、开着的生命周期里不重渲染 —— 旧行为就是开菜单那一刻定格勾选态。
import Registry from '../lib/registry.js';

const PAL = Registry.palette();   // 注入层颜色经注册表桥读（src-boundaries 门禁）

const ROW_CSS = 'display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;white-space:nowrap;';
const TICK_CSS = 'width:12px;display:inline-block;color:' + (PAL.overlayTick || 'currentColor') + ';';
const SEP_CSS = 'height:1px;background:' + (PAL.overlayMenuSep || 'rgba(255,255,255,.12)') + ';margin:5px 0;';
const HEAD_CSS = 'padding:6px 16px 2px;font-size:11px;color:' + (PAL.overlayMenuDim || '#9a9a9a') + ';';

function rowEl(row) {
  const rr = document.createElement('div');
  rr.style.cssText = ROW_CSS;
  rr.addEventListener('mouseenter', () => { rr.style.background = PAL.overlayMenuHover || 'rgba(255,255,255,.1)'; });
  rr.addEventListener('mouseleave', () => { rr.style.background = 'none'; });
  const tk = document.createElement('span');
  tk.textContent = row.checked ? '✓' : '';
  tk.style.cssText = TICK_CSS;
  const t = document.createElement('span');
  t.textContent = row.label == null ? '' : String(row.label);
  t.style.flex = '1';
  rr.appendChild(tk); rr.appendChild(t);
  rr.addEventListener('click', (e) => {
    e.stopPropagation();
    try { row.onClick(); } catch (_) { /* 调用方的失败不该炸掉菜单 */ }
  });
  return rr;
}

function sepEl() {
  const s = document.createElement('div');
  s.style.cssText = SEP_CSS;
  return s;
}

function headEl(label) {
  const h = document.createElement('div');
  h.textContent = label == null ? '' : String(label);
  h.style.cssText = HEAD_CSS;
  return h;
}

function draw(container, rows) {
  for (const row of rows || []) {
    if (row.kind === 'sep') container.appendChild(sepEl());
    else if (row.kind === 'head') container.appendChild(headEl(row.label));
    else container.appendChild(rowEl(row));
  }
}

// 当前开着的菜单（open/close 命令式驱动，一次只有一个 —— 与旧实现同一单例语义）。
let live = null;

export function open({ id, btn, rows, closeMenu }) {
  close(); // 防御双击竞态
  const r = btn.getBoundingClientRect();
  const right = Math.max(10, Math.round(window.innerWidth - r.right));
  // 按钮在视口上半部时向下弹；否则向上弹（YouTube / podcast 的按钮悬在下方）。
  const openDown = r.top < window.innerHeight / 2;
  const vpos = openDown
    ? `top:${Math.max(10, Math.round(r.bottom + 8))}px`
    : `bottom:${Math.max(10, Math.round(window.innerHeight - r.top + 8))}px`;
  const container = document.createElement('div');
  container.id = id;
  container.setAttribute('translate', 'no');
  container.style.cssText = `position:fixed;right:${right}px;${vpos};max-height:calc(100vh - 72px);overflow-y:auto;`
    + `z-index:2147483000;min-width:210px;background:${PAL.overlayMenuBg || 'rgba(28,28,28,.97)'};`
    + `border-radius:${PAL.overlayPanelRadius || '10px'};padding:6px 0;font-size:14px;`
    + `color:${PAL.overlayMenuText || '#eee'};box-shadow:0 2px 12px rgba(0,0,0,.5);`;
  draw(container, rows);
  document.body.appendChild(container);
  live = { container };
  // 点外关闭：与旧实现同一时序（setTimeout 0 后挂 document 级监听，命中即关并自摘）。
  setTimeout(() => {
    const off = (e) => {
      if (!container.contains(e.target) && e.target.id !== btn.id) {
        closeMenu();
        document.removeEventListener('click', off);
      }
    };
    document.addEventListener('click', off);
  }, 0);
}

export function close() {
  if (!live) return;
  const { container } = live;
  live = null;
  container.remove();
}

const host = { open, close };
export default host;
