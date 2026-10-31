// src/app/quick-view.jsx — 快速翻译面板的画布（PR6d）：只渲染 quick-model.js 的 vs，
// 事件原样调回模型。三个图标 svg 必须是 JSX 子元素（verify-quick 量它们的
// getBoundingClientRect/getComputedStyle）。#qk-src / #qk-lang 是命令式孤岛：JSX 不挂
// value/hidden/className，模型直写的那部分 DOM 永不被 React 回写（见模型头注释）。
// #qk-state 的 children 用 `{x || null}`：React 渲染空字符串会插入一个空文本节点，
// 让 `.qk-foot:has(.qk-state:empty)` 的 H 门失配。
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import PageText from '../lib/i18n.js';
import quickModel from './quick-model.js';

// 画布接线（listen-view.jsx 同构）：模型的每个 bump 在这里被钉成同步提交 —— bump 返回时
// DOM 已是新的，模型紧跟着的 fit()（rAF 量高度）量到的是本次渲染的结果。
let viewVersion = 0;
const viewSubs = new Set();
quickModel.canvas.view = () => {
  viewVersion += 1;
  flushSync(() => { viewSubs.forEach((f) => f()); });
};
const subView = (f) => { viewSubs.add(f); return () => viewSubs.delete(f); };

export default function QuickView() {
  useSyncExternalStore(subView, () => viewVersion);
  const t = PageText.useT();
  const vs = quickModel.vs;
  return (
    <>
      <div className="qk-head">
        <span id="qk-tag" className="qk-tag">{vs.tag}</span>
        <span className="qk-sp"></span>
        <span id="qk-from" className="qk-from">{vs.from}</span>
        <select id="qk-lang" aria-label={t('target_lang_label', '译成')} onChange={() => quickModel.onLangChange()}>
          {vs.langOptions.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
        </select>
        <button id="qk-pin" type="button" className="qk-ibtn" aria-label={t('quick_pin', '钉住')} aria-pressed={quickModel.pinned} onClick={() => quickModel.onPin()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z" /></svg>
        </button>
        <button id="qk-close" type="button" className="qk-ibtn" aria-label={t('quick_close', '关闭')} onClick={() => quickModel.onClose()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <textarea id="qk-src" rows={2} spellCheck={false}
        aria-label={t('quick_src_label', '原文')}
        placeholder={t('quick_src_placeholder', '输入或粘贴要翻译的文字')}
        onKeyDown={(e) => quickModel.onSrcKey(e)} onInput={() => quickModel.onSrcInput()}></textarea>
      <p id="qk-note" className="qk-note" hidden={vs.noteHidden}>{vs.noteText}</p>
      <div id="qk-out" className="qk-out" aria-live="polite">
        {vs.out.map((row, i) => row.k === 'sk'
          ? <div key={i} className="qk-sk"></div>
          : <div key={i} className={'qk-' + row.k}>{row.text}</div>)}
      </div>
      <div id="qk-actions" className="qk-actions" hidden={vs.actionsHidden}>
        {vs.actions.map((a, i) => <button key={i} type="button" className={a.primary ? 'p' : undefined} onClick={a.run}>{a.text}</button>)}
      </div>
      <div className="qk-foot">
        <span id="qk-state" className={vs.stateCls}>{vs.stateText || null}</span>
        <button id="qk-copy" type="button" className="qk-ibtn" hidden={vs.copyHidden} aria-label={t('quick_copy', '复制译文')} onClick={() => quickModel.onCopy()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" /></svg>
        </button>
      </div>
    </>
  );
}
