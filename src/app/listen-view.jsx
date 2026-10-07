// src/app/listen-view.jsx — 对话 · 实时听译 / 实时字幕（PR6c，接替 app/listen.js 的 wire()）。
//
// 分工（与 settings-view 同一条契约）：listen-model.js 管全部状态与副作用，本文件纯渲染；
// 原 wire() 的事件挂载变成 JSX 的 onClick/onChange，静态文案直接进 JSX（useT 驱动），
// 命令式叶子照旧只留骨架（id 全保留，hidden 纪律：派生布尔传给始终挂载的元素）。
//
// 两个 store：
//   · viewVersion —— canvas.view(area) 都 bump 它，ListenView 整体重渲染。area 只是语义
//     标注（'mode'|'clock'|'state'|…），与原 paint/renderXxx 手动分区等价：渲染期全部
//     getter 现算，算出来的就是当下该画的样子。
//   · entryVersion —— canvas.entry() 只 bump 它。首页入口卡独立订阅：refreshEntry 在
//     boot 早期就会 bump，不能连坐整个 ListenView，更不能丢。
//
// canvas 是模块级接线的（不是 useEffect）：模型 wire() 在 bootShell 里跑，而 refreshEntry
// 的 probe 回调可能早于 React 提交完成 —— no-op 默认值会吃掉那几次 bump，入口卡就停在
// 初始 hidden。import 时接管，任何时点的调用都落进订阅集合。
//
// section 本体（#app-listen）的 hidden 由模型 open()/leave() shell 级直写（原 :712/:887
// 同一条路）：React 对「vdom 没变的属性」不写 DOM，两套写入互不打架。

import { flushSync } from 'react-dom';
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import PageText from '../lib/i18n.js';
import listenModel from './listen-model.js';

const $ = (id) => document.getElementById(id);

// ── canvas 接线（模块级，见头注释）────────────────────────────────────────────
// flushSync 是模型头注释点名的契约：原代码每个 canvas 调用点之后 DOM 就已经是新的
// （verify-listen 的同步读全靠它），React 默认的异步调度会把提交推迟到下一个宏任务
// —— 同步断言全部扑空。bump 的三个来源（模型动作、探针回调、onTick）都不在 React
// 渲染期内，flushSync 合法。
let viewVersion = 0;
let entryVersion = 0;
const viewSubs = new Set();
const entrySubs = new Set();
listenModel.canvas.view = () => {
  viewVersion += 1;
  flushSync(() => { viewSubs.forEach((f) => f()); });
};
listenModel.canvas.entry = () => {
  entryVersion += 1;
  flushSync(() => { entrySubs.forEach((f) => f()); });
};
const subView = (f) => { viewSubs.add(f); return () => viewSubs.delete(f); };
const subEntry = (f) => { entrySubs.add(f); return () => entrySubs.delete(f); };

// ── pip 预览矩形的几何半边（原 :479-497 逐字；去重与发桥在模型 pipRectUpdate）──────
let pipTeardown = null;
function pipSendRect() {
  const el = $('app-subs-pip');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const on = !el.hidden && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  listenModel.pipRectUpdate(on
    ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    : null);
}
listenModel.canvas.pipRectOn = () => {
  if (pipTeardown) return;                        // 重入安全（原 :485）：✕ 暂停后点「继续」别叠第二份监听
  let timer = 0;
  const later = () => { if (timer) return; timer = setTimeout(() => { timer = 0; pipSendRect(); }, 120); };
  const el = $('app-subs-pip');
  const ro = (typeof ResizeObserver !== 'undefined' && el) ? new ResizeObserver(later) : null;
  if (ro) ro.observe(el);
  window.addEventListener('scroll', later, true);
  window.addEventListener('resize', later);
  pipTeardown = () => {
    if (ro) ro.disconnect();
    window.removeEventListener('scroll', later, true);
    window.removeEventListener('resize', later);
    clearTimeout(timer);
  };
  pipSendRect();                                  // 首发一次（lastRect 已由模型先清）
};
listenModel.canvas.pipRectOff = () => {
  if (pipTeardown) { pipTeardown(); pipTeardown = null; }
};

// ── 首页入口卡（登录前后两个首页同构，sfx = '' | '2'）──────────────────────────
// 初始态（refreshEntry 未返回）：按钮 hidden、need 行 hidden —— 与原静态 JSX 相同；
// entryState 到位后由 entryVersion 驱动揭开。节点恒挂载（hidden 纪律）。
function ListenEntryButtons({ sfx = '' }) {
  useSyncExternalStore(subEntry, () => entryVersion);
  const t = PageText.useT();
  const ev = listenModel.entryView(sfx);
  const listen = ev.listen;
  const subs = ev.subs;
  return (
    <>
      <button id={`app-listen-entry${sfx}`} type="button" className="mode"
        hidden={listen ? listen.hidden : true} disabled={listen ? listen.disabled : false}
        onClick={listenModel.open}>
        <span className="mode-icon mode-icon-terra"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /><path d="M9 21h6" /></svg></span>
        <span className="mode-text"><span className="mode-title">{t('listen_entry', '对话 · 实时听译')}</span><span className="mode-desc" id={`app-listen-entry-hint${sfx}`}>{listen ? listen.hint : ''}</span></span>
        <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        {/* 实心 CTA 带（J17，2026-10-02 真机修订）：带本身是卡内一个真实节点，
            不是 ::after 装饰层 —— 空橙块的根因就是「带是装饰层、文字在带外」。
            卡本身已是 button，这里绝不嵌套 button，所以它只能是 span（整卡仍可点）。
            两行：第 1 行 = 界面语言的动作（走 i18n），第 2 行 = 固定英文（与译名对齐），
            两个子节点都必须非空、颜色各自显式声明 —— J17 的判据。 */}
        <span className="cta">
          <span className="cn">{t('home_cta_listen', '开始听译')}</span>
          <span className="en">Start Conversation</span>
        </span>
      </button>
      {/* 实时字幕（learning-design §9.8）：原生不回 audio-caps（老壳）时整行不存在；门没过时灰掉 + 一句原因。 */}
      <button id={`app-subs-entry${sfx}`} type="button" className="mode"
        hidden={subs ? subs.hidden : true} disabled={subs ? subs.disabled : false}
        onClick={() => listenModel.open('subtitle')}>
        <span className="mode-icon mode-icon-terra"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M7 13h4" /><path d="M13 13h4" /><path d="M8 21h8" /></svg></span>
        <span className="mode-text"><span className="mode-title">{t('subtitle_entry', '实时字幕')}</span><span className="mode-desc" id={`app-subs-entry-hint${sfx}`}>{subs ? subs.hint : ''}</span></span>
        <svg className="mode-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        <span className="cta">
          <span className="cn">{t('home_cta_subs', '开始实时字幕')}</span>
          <span className="en">Start Live Subtitles</span>
        </span>
      </button>
    </>
  );
}

// 设备隐私句（modes-privacy{sfx}）：refreshEntry 写 hidden=!ok（原 :171-173）。mode-list 外面那行。
function ListenEntryPrivacy({ sfx = '' }) {
  useSyncExternalStore(subEntry, () => entryVersion);
  const ev = listenModel.entryView(sfx);
  const listen = ev.listen;
  return (
    <p className="note" id={`modes-privacy${sfx}`} hidden={listen ? !listen.ok : false}>
      {listen ? listen.privacy : ''}
    </p>
  );
}

// 两条灰态原因行：对话（need-live）+ 字幕（subs-need）。go 按钮恒藏 —— 原因都不是「去设置」
// 能解决的（系统版本 / 语言），不给一个点了也没用的按钮（原 :1372/:203）。
function ListenEntryNeeds({ sfx = '' }) {
  useSyncExternalStore(subEntry, () => entryVersion);
  const ev = listenModel.entryView(sfx);
  const listen = ev.listen;
  const subs = ev.subs;
  return (
    <>
      <p className="note" id={`app-listen-need-live${sfx}`} hidden={listen ? !listen.needShown : true}>
        <span id={`app-listen-need-live-why${sfx}`}>{listen ? listen.why : ''}</span>
        <button id={`app-listen-need-live-go${sfx}`} type="button" className="link" hidden></button>
      </p>
      <p className="note" id={`app-subs-need${sfx}`} hidden={subs ? !subs.needShown : true}>
        <span id={`app-subs-need-why${sfx}`}>{subs ? subs.needWhy : ''}</span>
        <button id={`app-subs-need-go${sfx}`} type="button" className="link" hidden></button>
      </p>
    </>
  );
}

// ── 历史列表行（原 renderHistory :1245-1341 的 JSX 版；列表内容原就是每次重建的动态节点）──
function HistoryRows({ hv }) {
  return (
    <>
      {!hv.rows.length && <div className="listen-empty">{hv.emptyText}</div>}
      {hv.rows.map((r) => (
        <div key={r.row.rid} className={'listen-row' + (r.who === 'me' ? ' me' : '')}>
          {!hv.sub && (
            <span className={'listen-who' + (r.guessed ? ' guessed' : '')} title={r.guessed ? r.whoTitle : undefined}>
              {r.who === 'me' ? hv.whoMe : hv.whoThem}
            </span>
          )}
          <div className="listen-body" role="button" onClick={hv.sub ? undefined : () => listenModel.openShow(r.row)}>
            <div className="listen-orig">{r.text}</div>
            {/* 本机路：修正后与识别原文不同时，行尾小字可点展开原文（不静默改字） */}
            {r.hasRaw && (
              <button type="button" className="listen-raw-toggle" aria-expanded={r.showRaw ? 'true' : 'false'}
                onClick={(e) => { e.stopPropagation(); listenModel.toggleShowRaw(r.row); }}>{hv.rawLabel}</button>
            )}
            {r.hasRaw && r.showRaw && <div className="listen-raw">{r.raw}</div>}
            {r.trErr ? (
              // 翻译失败要留下出口，不是永远的 ⏳
              <button type="button" className="listen-tr-retry"
                onClick={(e) => { e.stopPropagation(); listenModel.retranslate(r.row, true); }}>{hv.trFailed}</button>
            ) : (
              <div className={'listen-tr' + (r.tr ? (r.trTemp ? ' temp' : '') : ' pending')}>{r.tr || hv.pending}</div>
            )}
            {r.tr && !hv.sub && (
              // 两边的行都给「朗读」与「给对方看」（§9.8 字幕单向：都不给）
              <div className="listen-row-acts">
                {r.canSpeak && (
                  <button type="button" className={'listen-act' + (r.speaking ? ' on' : '')}
                    onClick={(e) => { e.stopPropagation(); listenModel.speakNow(r.row); }}>
                    {r.speaking ? hv.reading : hv.readAloud}
                  </button>
                )}
                <button type="button" className="listen-act"
                  onClick={(e) => { e.stopPropagation(); listenModel.openShow(r.row); }}>{hv.showOther}</button>
                {r.ttsFallback ? <span className="listen-tts-fallback">{hv.ttsFallbackText(r.ttsFallback)}</span> : null}
              </div>
            )}
          </div>
          {!hv.sub && (
            // ↔ 改边。无障碍名说的是**结果**（改成谁说的），不是符号本身。
            <button type="button" className="listen-swap" aria-label={r.who === 'me' ? hv.swapToThem : hv.swapToMe}
              onClick={(e) => { e.stopPropagation(); listenModel.flipRow(r.row); }}>↔</button>
          )}
          {r.starable && (
            // 「这次不留记录」时星整个不出现：星的唯一语义是「绕过一切门确保进复习」
            <button type="button" className={'listen-star' + (r.starred ? ' on' : '')} aria-label={hv.starLabel}
              onClick={(e) => { e.stopPropagation(); listenModel.toggleStar(r.row); }}>{r.starred ? '★' : '☆'}</button>
          )}
        </div>
      ))}
    </>
  );
}

// ── 主视图（#app-listen section 整体）─────────────────────────────────────────
export function ListenView() {
  useSyncExternalStore(subView, () => viewVersion);
  const t = PageText.useT();

  const mv = listenModel.modeView();
  const pill = listenModel.pillView();
  const fv2 = listenModel.footView();
  const nv = listenModel.nowView();
  const ev = listenModel.ephemeralView();
  const tv = listenModel.toggleView();
  const fv = listenModel.formView();
  const hv = listenModel.historyView();
  const sv = listenModel.summaryView();
  const shv = listenModel.showView();
  const note = listenModel.noteView();

  // 贴底判定读的是 commit 前的旧 DOM —— 与原 renderHistory :1247 的同一时刻语义；
  // 渲染后 useLayoutEffect 恢复（原 :1340 if (atBottom) scrollTop = scrollHeight）。
  const atBottomRef = useRef(true);
  const listEl = $('app-listen-history');
  if (listEl) atBottomRef.current = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 12;
  useLayoutEffect(() => {
    const el = $('app-listen-history');
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  });

  // 复制闪字（原 wire :1470-1481 的 dataset.flash 时序）：copyAll 落定才置文案，1500ms 清。
  // 闪字期间渲染不覆盖它 —— 按钮文案由 flash 优先（原 renderHistory :1339 的 dataset 判据）。
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(0);
  const onCopy = () => {
    listenModel.copyAll().then((ok) => {
      setFlash(ok ? t('listen_copied', '已复制') : t('listen_copy_failed', '复制失败'));
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 1500);
    });
  };

  return (
    <section id="app-listen" hidden>
      <div className="listen-head">
        <button id="app-listen-back" className="link" type="button" onClick={listenModel.leave}>{t('app_listen_back', '‹ 返回')}</button>
        <h2 id="app-listen-title">{mv.title}</h2>
        <span id="app-listen-pill" className={'listen-pill' + (pill && pill.live ? ' live' : '')}>{pill ? pill.text : ''}</span>
      </div>
      <p className="note listen-langline">
        <span id="app-listen-lang">{listenModel.langLineText()}</span>{' '}
        <span id="app-listen-ephemeral-pill" className="listen-eph-pill" hidden={!ev.pillShown}>{t('listen_ephemeral_pill', '这次不留记录')}</span>
      </p>
      <p className="note listen-mac-note" id="app-listen-mac-note" hidden={!mv.macNoteShown}>
        {t('listen_mac_use', '线上会议、视频通话也能用：让对方的声音从扬声器放出来即可。')}
      </p>
      <div className="drive-card listen-now" id="app-listen-now" hidden={tv.ended}>
        <div className="listen-now-head">
          <span id="app-listen-now-label">{listenModel.nowLabel()}</span>
          <span id="app-listen-live" className="listen-live" hidden={!(pill && pill.live)}>{t('listen_live_badge', '● 实时')}</span>
        </div>
        <p id="app-listen-partial" className="listen-partial" hidden={mv.partialsHidden}>{nv.partial}</p>
        <p id="app-listen-partial-tr" className="listen-partial-tr" hidden={mv.partialsHidden}>{nv.partialTr}</p>
        {/* iPhone 实时字幕：画中画小窗预览的占位块（原生在同一矩形上叠预览，§9.8 协议补充决定（三）17） */}
        <div id="app-subs-pip" className="listen-subs-pip" hidden={!mv.pipShown}>
          <p id="app-subs-pip-note" className="listen-subs-pip-note">{listenModel.pipNoteText()}</p>
        </div>
        <button id="app-subs-float" type="button" className="link" hidden={!listenModel.pipFloatShown()} onClick={listenModel.floatBtn}>{mv.pipFloatLabel}</button>
      </div>
      <div id="app-listen-history-wrap" className="drive-card listen-history-wrap">
        <div className="listen-now-head">
          <span id="app-listen-history-title">{hv.title}</span>
          <span className="listen-head-acts">
            <button id="app-listen-copy" type="button" className="link" hidden={!hv.copyShown} onClick={onCopy}>
              {flash != null ? flash : listenModel.copyText()}
            </button>
            <button id="app-listen-end" type="button" className="link" hidden={tv.endHidden} onClick={listenModel.end}>{t('listen_end', '结束')}</button>
          </span>
        </div>
        <div id="app-listen-history" className="listen-history"><HistoryRows hv={hv} /></div>
      </div>
      {/* 排队时说清还剩几句 —— 不说就成了「怎么读的不是刚才那句」 */}
      <p className="note" id="app-listen-queue" hidden={!hv.queueShown}>{hv.queueText}</p>
      <p className={note.err ? 'note err' : 'note'} id="app-listen-note">{note.text}</p>
      {/* 只剩一个主按钮：不再有「按住 · 我说」，双方自由说话（2026-09-08）。 */}
      <div id="app-listen-actions" hidden={tv.ended}>
        <button id="app-listen-toggle" type="button" disabled={tv.disabled} onClick={listenModel.toggle}>{tv.text}</button>
      </div>
      {/* 实时字幕的隐私段（§10 Gate I）：说在「开始」按钮下面，只在字幕模式出现。 */}
      <p className="note" id="app-subs-privacy" hidden={!mv.subsPrivacyShown}>{mv.subsPrivacyText}</p>
      {/* 语言：**不再常驻**（§9.6.1.5，2026-10-07 用户拍）。默认只有一行被动状态；
          LID 判出**稳住**的语言后「对方」那一格自动跟着走 —— 平时一个字都不用选。
          认错了才点「语言不对？」，开半屏 sheet 手动指定（Pencil 稿通过的样子）。 */}
      <div className="listen-lang-wrap" id="app-listen-lang-wrap">
        <div className="listen-lang" id="app-listen-lang">
          <span className="note" id="app-listen-lang-state">{mv.langStateText}</span>
          <button type="button" className="linkish" id="app-listen-lang-edit"
            aria-expanded={mv.langEdit ? 'true' : 'false'}
            onClick={listenModel.toggleLangEdit}>{mv.langEditLabel}</button>
        </div>
      </div>
      {mv.langEdit ? (
        <div className="listen-sheet-mask" id="app-listen-lang-sheet-mask"
          onClick={(e) => { if (e.target === e.currentTarget) listenModel.toggleLangEdit(); }}>
          <div className="listen-sheet" id="app-listen-lang-sheet" role="dialog" aria-modal="true"
            aria-label={mv.langSheetTitle}>
            <h3 id="app-listen-lang-sheet-title">{mv.langSheetTitle}</h3>
            <p className="note" id="app-listen-lang-sheet-note">{mv.langSheetNote}</p>
            <button type="button" className="listen-sheet-auto" id="app-listen-lang-auto"
              aria-pressed={mv.langManual ? 'false' : 'true'}
              onClick={listenModel.setLangAuto}>
              <span>{mv.langAutoLabel}</span>
              <span className="listen-sheet-dot">{mv.langManual ? '○' : '●'}</span>
            </button>
            <p className="note listen-sheet-sub" id="app-listen-lang-manual-label">{mv.langManualLabel}</p>
            <div className="listen-pair" id="app-listen-pair">
              <label className="note"><span id="app-listen-my-label">{mv.myLabel}</span>{' '}
                <select id="app-listen-my" value={fv.my} onChange={(e) => listenModel.langChangeManual('my', e.target.value)}>
                  {listenModel.langOptions(fv.my).map((o) => <option key={o.code} value={o.code} disabled={o.disabled}>{o.label}</option>)}
                </select>
              </label>
              <span className="listen-pair-arrow" aria-hidden="true">{mv.arrow}</span>
              <label className="note"><span id="app-listen-other-label">{mv.otherLabel}</span>{' '}
                <select id="app-listen-other" value={fv.other} onChange={(e) => listenModel.langChangeManual('other', e.target.value)}>
                  {listenModel.langOptions(fv.other).map((o) => <option key={o.code} value={o.code} disabled={o.disabled}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <div className="listen-engine-hint" id="app-listen-engine-hint" hidden={!listenModel.anyLangUnsupported()}>
              <button type="button" id="app-listen-change-engine" className="linkish"
                onClick={() => listenModel.changeEngine()}>{t('listen_lang_change_engine', '换引擎')}</button>
            </div>
            <button type="button" className="listen-sheet-close" id="app-listen-lang-close"
              onClick={listenModel.toggleLangEdit}>{t('listen_close', '关闭')}</button>
          </div>
        </div>
      ) : null}
      {/* 「换引擎」（2026-10-04 用户裁定）：语言列表**始终列全**，被引擎挡住的那些灰显并带一句
          「当前引擎不支持」—— 出路**就地**给，不是一句「去设置里选」。只在真有被挡住的语言时出现。 */}
      <div className="listen-engine-hint" id="app-listen-engine-hint" hidden={!listenModel.anyLangUnsupported()}>
        <button type="button" id="app-listen-change-engine" className="linkish"
          onClick={() => listenModel.changeEngine()}>{t('listen_lang_change_engine', '换引擎')}</button>
      </div>
      <label className="check listen-autospeak" id="app-listen-autospeak-row" hidden={mv.autospeakRowHidden}>
        <input id="app-listen-autospeak" type="checkbox" checked={fv.autoSpeak} onChange={(e) => listenModel.setAutoSpeak(e.target.checked)} />
        <span id="app-listen-autospeak-label">{t('listen_autospeak_label', '自动朗读译文')}</span>
      </label>
      {/* 「这次不留记录」（裁定 6）：一场为单位，开始前决定、中途不可改，**不记进存储**。 */}
      <label className={'check listen-autospeak' + (ev.live ? ' off' : '')} id="app-listen-ephemeral-row">
        <input id="app-listen-ephemeral" type="checkbox" checked={fv.ephemeral} disabled={ev.live} onChange={(e) => listenModel.setEphemeral(e.target.checked)} />
        <span id="app-listen-ephemeral-label">{t('listen_ephemeral_label', '这次不留记录')}</span>
      </label>
      {/* 灰掉时屏上一定有原因（表 1 的家规）：会话进行中且没勾上，说清为什么改不了。 */}
      <p className="note" id="app-listen-ephemeral-why" hidden={!ev.whyShown}>{ev.whyText}</p>
      {/* 实时字幕（§9.8）：「字幕进复习」开关（与设置页同一份设置）+ 一句按平台的提示。 */}
      <div id="app-subs-prep" hidden={mv.prepHidden}>
        <label className="check listen-autospeak">
          <input id="app-subs-capture" type="checkbox" checked={fv.subsCapture} onChange={(e) => listenModel.setSubsCapture(e.target.checked)} />
          <span id="app-subs-capture-label">{t('subtitle_capture_label', '字幕进复习（来源「实时字幕」）')}</span>
        </label>
        <p className="note" id="app-subs-tip">{mv.subsTipText}</p>
      </div>
      <p className="note" id="app-listen-cost">{fv2.cost}</p>
      {/* Gate H（§10）：本机路在对话页底部把那一段披露原样给出 —— 不是只在首页那一行。 */}
      <p className="note" id="app-listen-device-privacy" hidden={!fv2.privacyShown}>{fv2.privacyText}</p>

      <div id="app-listen-summary" className="drive-card" hidden={!sv.shown}>
        <h3 id="app-listen-summary-title">{mv.summaryTitle}</h3>
        <p id="app-listen-summary-body">{sv.body || ''}</p>
        <p className="note" id="app-listen-summary-note">{mv.summaryNote}</p>
        <div className="drive-grid">
          <button id="app-listen-summary-home" type="button" onClick={listenModel.leave}>{t('listen_summary_home', '回到首页')}</button>
          <button id="app-listen-summary-again" type="button" className="secondary" onClick={listenModel.summaryAgain}>{t('listen_summary_again', '再来一段')}</button>
        </div>
      </div>

      {/* 放大展示卡（给对方看）：点任一历史行打开，底下照常在听；点任意处关闭 —— 不是按钮才关。 */}
      <div id="app-listen-flip" className="listen-flip" hidden={!shv.shown}
        onClick={(e) => { if (e.target && e.target.closest && e.target.closest('button')) return; listenModel.closeShow(); }}>
        <p className="listen-flip-hint" id="app-listen-flip-hint">{t('listen_flip_hint', '给对方看 · 点任意处返回')}</p>
        <p className="listen-flip-text" id="app-listen-flip-text">{shv.shown ? shv.big : ''}</p>
        <p className="listen-flip-sub" id="app-listen-flip-sub">{shv.shown ? shv.sub : ''}</p>
        <p className="listen-flip-speaking" id="app-listen-flip-speaking" hidden={!(shv.shown && shv.speakingShown)}>{t('listen_flip_speaking', '朗读中')}</p>
        <div className="drive-grid">
          <button id="app-listen-flip-again" type="button" className="secondary" hidden={!(shv.shown && shv.againShown)} onClick={listenModel.speakShownRow}>{t('listen_read_aloud', '朗读')}</button>
          <button id="app-listen-flip-back" type="button" onClick={listenModel.closeShow}>{t('listen_close', '关闭')}</button>
        </div>
      </div>
    </section>
  );
}

export { ListenEntryButtons, ListenEntryPrivacy, ListenEntryNeeds };
