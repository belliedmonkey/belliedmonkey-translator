// src/content/sub-menu.jsx — 字幕控制菜单的行渲染（React root，PR8a 岛式收口）。
//
// 分工（行为像素不变）：
//   - 判据全在旧侧 extension/content/subtitle-adapter.js —— 菜单开不开、行序、
//     文案（TranslationCore.t）、勾选态、定位与外观 cssText、点外关闭。
//   - 本文件是纯展示层：open() 造容器（id / translate / cssText 由旧侧传参，
//     与旧实现逐字同一份公式），React 只渲染容器内的行；行结构与旧 row()/sep()/
//     head() 逐字同构（hover 也是同样的 mouseenter/mouseleave 语义）。
//   - 菜单挂一次、开着的生命周期里不重渲染 —— 旧行为就是开菜单那一刻把勾选态
//     定格（setMode 后 ✓ 不实时挪位，重开才刷新），保真优先；实时化是迁移之后
//     的独立改进，不属于这个 PR。
//   - 零 MT_ 全局、零 i18n、零 adapter 逻辑（src-boundaries 门禁扫本文件）。
//     注入层的颜色经 `lib/registry.js` 的 `palette()` getter 读（2026-09-30，审计
//     OVL-01：颜色原先写死在本文件里，整片漏过 palette 门禁）。
//
// 加载方式：不在 manifest content_scripts 列表里 —— subtitle-adapter.js 在用户
// 第一次点开菜单时才 import(chrome.runtime.getURL('content/sub-menu.bundle.js'))，
// 同步注入面零新增字节。format:'esm'（动态 import 的产物形态）；Firefox/Safari
// 实测不过时的回退开关见 build/ui-entries.config.js 这一条的注释。
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom'; // flushSync 不在 /client 子入口（19 只导 createRoot/hydrateRoot）
import Registry from '../lib/registry.js';

const PAL = Registry.palette();   // 注入层颜色经注册表桥读（src-boundaries 门禁：本文件零 MT_ 全局，2026-09-30 OVL-01）

// 旧 row() 的行 cssText 拆成 style 对象，值逐字相同 —— 拆分即文档。
const ROW_CSS = {
  display: 'flex', alignItems: 'center', gap: '10px',
  padding: '9px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
};
const TICK_CSS = { width: '12px', display: 'inline-block', color: PAL.overlayTick };
const SEP_CSS = { height: '1px', background: PAL.overlayMenuSep, margin: '5px 0' };
const HEAD_CSS = { padding: '6px 16px 2px', fontSize: '11px', color: PAL.overlayMenuDim };

function MenuRow({ row }) {
  return (
    <div
      style={ROW_CSS}
      onMouseEnter={(e) => { e.currentTarget.style.background = PAL.overlayMenuHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
      onClick={(e) => { e.stopPropagation(); row.onClick(); }}
    >
      <span style={TICK_CSS}>{row.checked ? '✓' : ''}</span>
      <span style={{ flex: '1' }}>{row.label}</span>
    </div>
  );
}

function MenuList({ rows }) {
  return (
    <>
      {rows.map((row, i) => {
        if (row.kind === 'sep') return <div key={i} style={SEP_CSS} />;
        if (row.kind === 'head') return <div key={i} style={HEAD_CSS}>{row.label}</div>;
        return <MenuRow key={i} row={row} />;
      })}
    </>
  );
}

// 当前开着的菜单（open/close 由旧侧命令式驱动，一次只有一个 —— 旧实现同样靠
// getElementById 单例判定）。
let live = null;

export function open({ id, btn, rows, closeMenu }) {
  close(); // 防御：旧侧挡了「开着再开」，这里兜住双击竞态
  const r = btn.getBoundingClientRect();
  const right = Math.max(10, Math.round(window.innerWidth - r.right));
  // 按钮在视口上半部（如 Twitter 译按钮嵌在视频右上）时向下弹，菜单顶端不会
  // 被视口/页头剪掉；否则向上弹（YouTube / podcast 的按钮悬在下方）。
  const openDown = r.top < window.innerHeight / 2;
  const vpos = openDown
    ? `top:${Math.max(10, Math.round(r.bottom + 8))}px`
    : `bottom:${Math.max(10, Math.round(window.innerHeight - r.top + 8))}px`;
  const container = document.createElement('div');
  container.id = id;
  container.setAttribute('translate', 'no');
  container.style.cssText = `position:fixed;right:${right}px;${vpos};max-height:calc(100vh - 72px);overflow-y:auto;` +
    `z-index:2147483000;min-width:210px;background:${PAL.overlayMenuBg};border-radius:${PAL.overlayPanelRadius};` +
    `padding:6px 0;font-size:14px;color:${PAL.overlayMenuText};box-shadow:0 2px 12px rgba(0,0,0,.5);`;
  document.body.appendChild(container);
  const root = createRoot(container);
  // flushSync 契约：旧实现在点击处理器里同步追加行，host.open() 返回时行必须在
  // 文档里（React 的并发调度会把首帧推迟一个调度片，行为就变了）。本文件处于任何
  // React 生命周期之外，flushSync 不会触发警告。
  flushSync(() => root.render(<MenuList rows={rows} />));
  live = { container, root };
  // 点外关闭：与旧实现同一时序（setTimeout 0 后挂 document 级监听，命中即关并
  // 自摘）。关走旧侧的 closeMenu —— 它还带宿主未就位时的 DOM 兜底。
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
  const { container, root } = live;
  live = null;
  // 容器可能已被页面脚本整个摘走（SPA sweep，#30 同族）——unmount 对已断连容器
  // 是安全的，remove 兜底。React 19 unmount 是异步清理、同步摘除不抛。
  try { root.unmount(); } catch (_) { /* 容器已不在文档树时的防御 */ }
  container.remove();
}

const host = { open, close };
export default host;
