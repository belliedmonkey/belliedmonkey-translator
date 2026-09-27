// src/shared/dialog.jsx — 页内确认框（LearnDialog.confirm）的 React 实现（PR7a 自
// extension/learn/dialog.js 翻转）。
//
// 为什么不用 window.confirm：宿主 App 的 WKWebView 没有实现 WKUIDelegate 的确认回调，
// `window.confirm` 在 App 里**恒返回 false**、且什么都不显示（2026-09-07 真机：听译页的
// 「返回」点了没反应；顺藤摸下去，设置页的删除来源 / 清空学习库 / 删除账号三个确认在 App 里
// 从来没生效过）。原生实现要写按钮文案，而 Swift 侧零文案是铁律；页内实现文案走 i18n，
// 两个宿主（扩展页、App）一份代码、一种样子。
//
// 用法：`if (!(await LearnDialog.confirm(msg))) return;` —— 命令式 API 语义保留，调用方零改
// （本文件 `export default { confirm }`，消费方 `import LearnDialog from …` 后调用点文本不变）。
//
// 与旧 createElement 版逐字保形的东西：类名全带 ld- 前缀（test/dialog.test.js 咬）；STYLE
// 串一字不改；DOM 嵌套 mask > box[role=dialog][aria-modal] > p.ld-msg + div.ld-row >
// button.ld-cancel + button.ld-ok[.ld-danger]；Esc / 点遮罩 = 取消，Enter = 确定（keydown
// capture，preventDefault + stopPropagation）；焦点落「取消」（破坏性操作默认安全），关闭后
// 还给打开前的元素。flushSync 落 DOM：confirm() 返回时弹层已在文档里、done() 后已摘掉 ——
// 「画布调用点后 DOM 已新」的既有契约（同 listen-view 的 bump）。
//
// 并发语义（申报）：旧版每次 confirm 各叠一层 mask；单槽状态机里后来者把前者按取消结算。
// 全部调用方都 await，实际到不了这里 —— 留这条缝只是为了不让前一个 promise 静默悬死。
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import PageText from '../lib/i18n.js';

const t = (k, fb) => PageText.t(k, fb);

// 类名一律带 ld- 前缀、选择器带 .ld-row：宿主页有自己的 `button.danger`（红字透明底），
// 2026-09-07 TestFlight 87 里删除账号的确定键就被它盖成红字红底、看着是空的。
const STYLE = `
.ld-mask { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ld-box { background: var(--card-bg, #fff); color: var(--fg, var(--text, #201e1d)); border: 1.5px solid var(--line, var(--border, #dcd3c4)); border-radius: 16px; padding: 18px; width: min(360px, 100%); display: flex; flex-direction: column; gap: 14px; font: inherit; box-shadow: 0 12px 40px rgba(0,0,0,.18); }
.ld-msg { margin: 0; font-size: 1rem; line-height: 1.5; white-space: pre-line; }
.ld-row { display: flex; gap: 10px; }
.ld-row .ld-cancel, .ld-row .ld-ok { flex: 1; font: inherit; font-weight: 700; min-height: 44px; border-radius: 999px; cursor: pointer; padding: 10px 14px; }
.ld-row .ld-cancel { background: none; color: var(--accent-deep, #8c491a); border: 1.5px solid var(--line, var(--border, #dcd3c4)); }
.ld-row .ld-ok { background: var(--accent, #ac6231); color: #fff; border: 0; }
.ld-row .ld-ok.ld-danger { background: var(--danger, #b3261e); }
`;
let styled = false;
function ensureStyle(doc) {
  if (styled) return;
  styled = true;
  const s = doc.createElement('style'); s.textContent = STYLE; doc.head.appendChild(s);
}

// ── 单槽状态机：open + resolve；gen/subs 供 useSyncExternalStore。每次状态变化都经
// flushSync(emit)：订阅者同步重渲染，DOM 与模块状态同帧。 ──
let open = null;        // { message, o } | null
let resolve = null;     // 当前这单的 Promise.resolve
let prevFocus = null;
const subs = new Set();
let gen = 0;
function emit() { gen += 1; for (const fn of subs) fn(); }
function subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; }
function getSnapshot() { return gen; }

function done(v) {
  const r = resolve; const prev = prevFocus;
  resolve = null; open = null; prevFocus = null;
  flushSync(emit);
  try { if (prev && prev.focus) prev.focus(); } catch (_) {}
  r(v);
}

// opts: { ok, cancel, danger } — 文案可覆盖；danger 让确定键用危险色（删除类）。
export function confirm(message, opts) {
  const doc = document;
  ensureStyle(doc);
  return new Promise((res) => {
    if (resolve) { const old = resolve; resolve = null; open = null; prevFocus = null; old(false); }
    prevFocus = doc.activeElement;
    open = { message: String(message || ''), o: opts || {} };
    resolve = res;
    flushSync(emit);
  });
}

export default { confirm };

export function DialogHost() {
  const isOpen = useSyncExternalStore(subscribe, () => !!open, () => !!open);
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen]);

  // 旧版 appendChild 后立刻 cancel.focus()；useLayoutEffect 是 React 里同一时序位
  // （DOM 已进文档、还没画到屏上）。
  useLayoutEffect(() => {
    if (isOpen && cancelRef.current) { try { cancelRef.current.focus(); } catch (_) {} }
  }, [isOpen]);

  if (!open) return null;
  const o = open.o;
  return (
    <div className="ld-mask" onClick={(e) => { if (e.target === e.currentTarget) done(false); }}>
      <div className="ld-box" role="dialog" aria-modal="true">
        <p className="ld-msg">{open.message}</p>
        <div className="ld-row">
          <button type="button" className="ld-cancel" ref={cancelRef} onClick={() => done(false)}>{o.cancel || t('dialog_cancel', '取消')}</button>
          <button type="button" className={'ld-ok' + (o.danger ? ' ld-danger' : '')} onClick={() => done(true)}>{o.ok || t('dialog_ok', '确定')}</button>
        </div>
      </div>
    </div>
  );
}

// 建（或复用）一个挂在 body 上的宿主 div，把 DialogHost 挂进去。body 未就绪（head 里
// 的脚本）就等 DOMContentLoaded —— 扩展产物 learn/dialog.js 不该挑加载位置。
export function mountDialogHost() {
  const doc = document;
  const mount = () => {
    let host = doc.getElementById('ld-host');
    if (!host) { host = doc.createElement('div'); host.id = 'ld-host'; doc.body.appendChild(host); }
    createRoot(host).render(<DialogHost />);
  };
  if (doc.body) mount();
  else doc.addEventListener('DOMContentLoaded', mount, { once: true });
}
