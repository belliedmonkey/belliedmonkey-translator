// src/app/driving-view.jsx — 播客模式的画布（PR6d，接替 app/driving.js 的 paintStatic 会话页半边）。
//
// 播客模式（learning-design §9.5 / interaction-spec 「播客模式」）：App 专属免提听读
// 会话。文本全程可见（音频优先，从不藏字）；超大按钮；语音问答环仅在 STT + 解析引擎 +
// uiLang 音色三门全开时存在。视图切换归 shell-model（同 #review-view 的分工），内部
// 全归 src/app/driving-model.js（本文件纯渲染：原 paint() 的输出由模型的 view() 快照
// 现算，原 paintStatic 的骨架标签进 useT，原 wire() 的六个按钮监听变 JSX onClick）。
//
// section 本体（#app-drive）的 hidden 由模型 start/stop 之后的 shell 级直写（shell-model
// 拥有视图切换，原 :1388/:1400 同一条路）：React 对「vdom 没变的属性」不写 DOM，两套
// 写入互不打架。#app-drive-back 的 onClick 与 disabled 同样归 shell-model（它的 handler
// 里 await paintCounts 还会翻按钮），本文件连 children 都照常渲染（t() 驱动）。
//
// 可空的 p（progress/status/cost/note/卡片三行）一律 `{x || null}`：React 渲染空字符串
// 会插入空文本节点，`.note:empty` 一类的选择器与测试判据会失配。

import { flushSync } from 'react-dom';
import { useSyncExternalStore } from 'react';
import PageText from '../lib/i18n.js';
import drivingModel from './driving-model.js';

// ── canvas 接线（模块级，quick-view/listen-view 同构）──────────────────────────
// flushSync 是模型契约：原代码每个 paint() 调用点之后 DOM 已是新的（verify-learn-flow
// 的同步读靠它），React 默认异步调度会把提交推迟到下一个宏任务 —— 同步断言全部扑空。
// bump 的来源（模型动作、TTS 链、探针回调）都不在 React 渲染期内，flushSync 合法。
let viewVersion = 0;
const viewSubs = new Set();
drivingModel.canvas.view = () => {
  viewVersion += 1;
  flushSync(() => { viewSubs.forEach((f) => f()); });
};
const subView = (f) => { viewSubs.add(f); return () => viewSubs.delete(f); };

export default function DrivingView() {
  useSyncExternalStore(subView, () => viewVersion);
  const t = PageText.useT();
  const v = drivingModel.view();
  return (
    <section id="app-drive" hidden>
      <button id="app-drive-back" type="button" className="link">{t('app_review_back', '← 返回')}</button>
      <h2 id="app-drive-title">{t('drive_entry', '播客模式')}</h2>
      <p className="note" id="app-drive-progress">{v.progress || null}</p>
      <div className="drive-card">
        <p id="app-drive-text">{v.cardText || null}</p>
        <p id="app-drive-tr">{v.cardTr || null}</p>
        {/* 解析文本：耳朵优先，但从不藏起来 —— 停车时看得见刚才播的是什么。 */}
        <p className="note" id="app-drive-notes">{v.cardNotes || null}</p>
      </div>
      <p className="note" id="app-drive-status" role="status" aria-live="polite">{v.status || null}</p>
      <p className="note err" id="app-drive-note">{v.note || null}</p>
      <div className="drive-grid">
        <button id="app-drive-pause" type="button" hidden={v.controlsHidden}
          onClick={() => drivingModel.togglePlayPause()}>{v.pauseLabel}</button>
        <button id="app-drive-next" type="button" hidden={v.controlsHidden}
          onClick={() => drivingModel.onNextClick()}>{t('drive_next', '⏭ 下一张')}</button>
        <button id="app-drive-repeat" type="button" hidden={v.controlsHidden}
          onClick={() => drivingModel.onRepeatClick()}>{t('drive_repeat', '🔁 再听一遍')}</button>
        {/* 播放顺序：随机 / 顺序 / 循环 / 单曲循环，点一下轮换。它只改变**这张卡
             结束之后**发生什么，永不打断正在播的音频 —— 所以开车时按它是安全的。 */}
        <button id="app-drive-mode" type="button" hidden={v.controlsHidden}
          onClick={() => drivingModel.onModeClick()}>{v.modeLabel}</button>
        {/* 「解析这句」：只在暂停时出现。解析 + 显示 + 朗读，读完回到暂停 ——
             暂停的语义是「我在控制」，读完一段解析不该顺势把整场恢复。 */}
        <button id="app-drive-explain" type="button" hidden={v.explainHidden}
          disabled={v.explainDisabled}
          onClick={() => drivingModel.onExplainClick()}>{t('drive_explain', '🔍 解析这句')}</button>
      </div>
      <button id="app-drive-more" type="button" className="secondary" hidden={v.moreHidden}
        onClick={() => drivingModel.onMoreClick()}>{t('drive_restart', '再来一轮')}</button>
      <p className="note" id="app-drive-cost">{v.cost || null}</p>
    </section>
  );
}
