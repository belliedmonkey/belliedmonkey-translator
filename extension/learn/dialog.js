// extension/learn/dialog.js — 页内确认框（LearnDialog.confirm）。
//
// 为什么不用 window.confirm：宿主 App 的 WKWebView 没有实现 WKUIDelegate 的确认回调，
// `window.confirm` 在 App 里**恒返回 false**、且什么都不显示（2026-09-07 真机：听译页的
// 「返回」点了没反应；顺藤摸下去，设置页的删除来源 / 清空学习库 / 删除账号三个确认在 App 里
// 从来没生效过）。原生实现要写按钮文案，而 Swift 侧零文案是铁律；页内实现文案走 i18n，
// 两个宿主（扩展页、App）一份代码、一种样子。
//
// 用法：`if (!(await LearnDialog.confirm(msg))) return;` —— 和 window.confirm 同一语义，
// 只是异步。Esc / 点遮罩 = 取消；Enter = 确定；焦点落在「取消」上（破坏性操作默认安全）。
'use strict';

var LearnDialog = (() => {
  const t = (k, fb) => (typeof PageI18n !== 'undefined' && PageI18n.t) ? PageI18n.t(k, fb) : fb;
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

  // opts: { ok, cancel, danger } — 文案可覆盖；danger 让确定键用危险色（删除类）。
  // 类名一律带 ld- 前缀、选择器带 .ld-row：宿主页有自己的 `button.danger`（红字透明底），
  // 2026-09-07 TestFlight 87 里删除账号的确定键就被它盖成红字红底、看着是空的。
  function confirm(message, opts) {
    const o = opts || {};
    const doc = document;
    ensureStyle(doc);
    return new Promise((resolve) => {
      const mask = doc.createElement('div'); mask.className = 'ld-mask';
      const box = doc.createElement('div'); box.className = 'ld-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      const msg = doc.createElement('p'); msg.className = 'ld-msg'; msg.textContent = String(message || '');
      const row = doc.createElement('div'); row.className = 'ld-row';
      const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'ld-cancel'; cancel.textContent = o.cancel || t('dialog_cancel', '取消');
      const ok = doc.createElement('button'); ok.type = 'button'; ok.className = 'ld-ok' + (o.danger ? ' ld-danger' : ''); ok.textContent = o.ok || t('dialog_ok', '确定');
      row.appendChild(cancel); row.appendChild(ok);
      box.appendChild(msg); box.appendChild(row); mask.appendChild(box);
      const prev = doc.activeElement;
      const done = (v) => {
        doc.removeEventListener('keydown', onKey, true);
        try { mask.remove(); } catch (_) {}
        try { if (prev && prev.focus) prev.focus(); } catch (_) {}
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      };
      cancel.addEventListener('click', () => done(false));
      ok.addEventListener('click', () => done(true));
      mask.addEventListener('click', (e) => { if (e.target === mask) done(false); });
      doc.addEventListener('keydown', onKey, true);
      doc.body.appendChild(mask);
      try { cancel.focus(); } catch (_) {}
    });
  }

  const api = { confirm };
  try { window.LearnDialog = api; } catch (_) {}
  return api;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LearnDialog;
