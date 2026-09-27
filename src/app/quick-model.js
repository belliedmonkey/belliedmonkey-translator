// src/app/quick-model.js — macOS 快速翻译的面板页（docs/learning-design.md §9.9；domain-design §2.6）。
//
// 它是**同一份** Main.html 以 `#quick` 加载出来的第二个 WKWebView：同源 ⇒ localStorage 里的引擎配置、
// 界面语言、「译成」直接共享，不镜像任何东西。这一页只做一件事：显示交来的文字并翻译它。
// 原生在 document-start 注入 `location.hash = '#quick'`（WKWebView.loadFileURL 不收带 # 的地址，T2 读数），早于本包执行。
// 它**不**启动同步、不初始化遥测、不打开 LearnStore —— 学习库按账号分库，第二个打开者会握着过期的库名；
// 「这句进复习库」与「翻成了 / 失败了」都经原生中继交给主页面（quick-capture / quick-result）。
//
// 原生 → 页面：quick-show {via, origin, text?, concealed?, own?, blocked?, fresh?, perm?, second?, busy?, first?, appName?}   origin: selection | clipboard | service | screen | typed
//             quick-ocr {lines}                                截图识别出的行框（拼段在 HandoffCore）
// 页面 → 原生：quick-ready · quick-resize {h} · quick-close · quick-pin {on} · quick-copy {text}
//             quick-capture {v,text,tr,lang,trLang,ts,via} · quick-result {ok, code, provider, ms, status, route}（每个面板会话至多一条成功）
//             quick-open-settings · quick-reselect（重新框选）
//
// PR6d 起不在 MODULES：本文件（状态）+ quick-view.jsx（画布）随 main.jsx 进 esbuild bundle，
// 拼 Script.js 尾部。所有对它的引用都是 call-time（main.jsx 的 #quick 分叉、原生中继的
// window.AppQuick._fromNative、verify-quick 的 ABI），求值时机后移无影响。
// 状态化改造：原 textContent/hidden/className 直写全部改写进 vs + bump()（quick-view.jsx 接管
// canvas.view，listen-view 同构）。两处例外**保留命令式 DOM**：
//   · #qk-src —— 非受控 textarea：value/hidden/高度/focus 全由模型直写（JSX 不挂 value/hidden，
//     React 永不回写它们）；
//   · #qk-lang —— 非受控 select：value/hidden/auto class 模型直写。verify-quick 用原生
//     `s.value = …; s.dispatchEvent(new Event('change'))` 驱动它，React 受控组件的 value
//     tracker 会把这一拍判成「没变」丢弃 —— 非受控正是旧代码逐字等价的形态。
// 事件四件（✕/图钉/原文键盘/语种 change）挪进画布 onClick/onKeyDown/onInput/onChange 直调模型；
// document 级 Esc 留在 boot()（不经 React）。按钮 aria-label 与 placeholder 随画布的 useT
// （原 paintStatic 的涂写职责）；语种选项改为 boot() 读 #target-lang 存 vs.langOptions ——
// 同一份文档、同一个选择器，仍不另抄一份清单。

import PageText from '../lib/i18n.js';

const t = (k, fb) => PageText.t(k, fb);
const CHANNEL = 'mtQuick';
const PROTOCOL = {
  toNative: ['quick-ready', 'quick-resize', 'quick-close', 'quick-pin', 'quick-copy', 'quick-capture', 'quick-result', 'quick-open-settings', 'quick-reselect',
    'quick-request-perm', 'quick-open-privacy', 'quick-relaunch', 'quick-ocr-cloud'],
  fromNative: ['quick-show', 'quick-ocr', 'quick-image'],
};
const SLOW_MS = 5000;
const SRC_MAX_PX = 168;      // 与 style.css 的 #qk-src max-height 同值。固定像素，不按窗口高度算：窗口高度是内容决定的
const SHOT_ASKED = 'quickShotAsked';   // 录屏权限：我们自己那句话说过没有（说过之后直接是「等重开」那一态）
const READ_KEYS = ['provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
  'uiLang', 'targetLang', 'learnEnabled', 'quickCapture', 'grantTail'];
const $ = (id) => document.getElementById(id);
const C = () => window.HandoffCore;

// ── 画布接线（listen-model 同构）：canvas.view 由 quick-view.jsx 模块级接管， ──
// ── 每个 bump 在那里被钉成同步提交；视图未挂载时是 no-op。                   ──
const canvas = { view: () => {} };
const bump = () => canvas.view();

// QuickView 的渲染输入。改完任意一组就 bump()；数组条目就地突变（rows[i].k = 'tr'）是
// 故意的 —— 快照是 viewVersion，不是 vs 的引用。
const vs = {
  tag: '',                    // #qk-tag：来源标签（剪贴板 / 选中文字 / …）
  from: '',                   // #qk-from：反向时的「原文已是{lang}」
  langOptions: [],            // boot() 从 #target-lang 读（one-registry：不另抄清单）
  out: [],                    // #qk-out 的行：{ k: 'sk'|'tr'|'err'|'note', text }
  actions: [], actionsHidden: true,   // { text, primary?, run }
  noteText: '', noteHidden: true,     // #qk-note
  stateCls: 'qk-state', stateText: '',   // #qk-state（底部存库状态）
  copyHidden: true,           // #qk-copy
};

let gen = 0;                 // 每次交来新文字 +1：上一句迟到的结果一律丢弃（「上一句还在翻时再触发 = 取消上一句」）
let cur = null;              // { via, origin, text }
let lastText = '';           // 上一次交来的文字（陷阱②）
let lastShown = null;        // 上一次的结果（陷阱②：显示它，不重发请求）
let pinned = false;
let lostNote = false;        // 这一次面板要不要带那句「增强取词的权限被关掉了」
let sess = { ok: false, failed: {} };   // 一个面板会话（原生说 fresh 起算）：成功至多报一次、每个错误码至多一次

// 钉住：页面与原生各有一份，必须同进同退。原生在收起面板时清掉它那一份 ⇒ 新会话开始时这里也清（不回报）。
// aria-pressed 由画布按 pinned 渲染（setPinned 在新会话开始时也会被调，bump 让它跟上）。
function setPinned(on, tell) { pinned = !!on; bump(); if (tell) post({ type: 'quick-pin', on: pinned }); }
function post(payload) { try { window.webkit.messageHandlers[CHANNEL].postMessage(payload); return true; } catch (_) { return false; } }
const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, (v) => res(v || {})));
function fit() { requestAnimationFrame(() => post({ type: 'quick-resize', h: Math.ceil($('quick-root').getBoundingClientRect().height) })); }

function originLabel(origin) {
  switch (origin) {
    case 'clipboard': return t('quick_tag_clipboard', '剪贴板');
    case 'service': return t('quick_tag_service', '服务');
    case 'screen': return t('quick_tag_shot', '截图');
    case 'typed': return t('quick_tag_input', '输入');
    default: return t('quick_tag_selection', '选中文字');
  }
}

// 失败文案：逐字复用产品里已有的那几句（interaction-spec「系统翻译与快速翻译」），不另写。
function failText(e) {
  const code = (e && e.code) || '';
  switch (code) {
    case 'auth': return t('auth_err_key', '服务商拒绝了这把 key（HTTP 401/403）。检查 key 是否填对、有没有这个模型的权限。');
    case 'credit_exhausted': return t('grant_err_exhausted', '免费额度已经用完了。你可以填一把自己的 key 继续用（一把通吃翻译、朗读、转写），或者到社群里问问。');
    case 'grant_unavailable': return t('grant_err_unavailable', '不是你用完了 —— 是我们这边的免费额度池空了，正在补。先用自己的 key，或者稍后再来。');
    case 'grant_misconfigured': return t('grant_err_misconfigured', '免费额度这条路我们这边配错了，已经记下。这不是你的问题；先用自己的 key。');
    case 'grant_revoked': return t('grant_err_revoked', '这份免费额度已经停用了（退出登录或删除账号会停用它）。重新登录同一个账号就会回来，余额不变。');
    case 'grant_invalid': return t('grant_err_invalid', '这份免费额度认不出来了。到设置里重新领一次。');
    case 'model_not_allowed': return t('grant_err_model', '免费额度只能用它指定的那个模型。你在「详细」里改过模型 —— 改回去，或者填一把自己的 key。');
    case 'busy': return t('grant_err_busy', '这会儿请求太密了，等几秒再试。');
    default: return typeof EngineTest !== 'undefined' ? EngineTest.reason(e, t) : String((e && e.message) || code);
  }
}
// 能自己好的给「重试」；要改配置的给「打开设置」。两者不同时出现 —— 要改配置时给「重试」= 再失败一次。
const RETRYABLE = { network: 1, timeout: 1, http: 1, busy: 1, grant_unavailable: 1, '': 1 };

function clearOut() { vs.out = []; vs.actions = []; vs.actionsHidden = true; vs.noteText = ''; vs.noteHidden = true; vs.stateText = ''; vs.stateCls = 'qk-state'; vs.copyHidden = true; bump(); }
function note(text) { vs.noteText = text; vs.noteHidden = !text; bump(); }
function actions(list) { vs.actions = list; vs.actionsHidden = !list.length; bump(); }
function message(text) { vs.out.push({ k: 'note', text }); bump(); }

// ── 交来文字 ──────────────────────────────────────────────────────────────
function report(ok, e, provider, ms) {
  const code = ok ? '' : ((e && e.code) || 'network');
  if (ok ? sess.ok : sess.failed[code]) return;
  if (ok) sess.ok = true; else sess.failed[code] = true;
  post({ type: 'quick-result', ok, code, provider, ms, status: e && Number.isInteger(e.status) ? e.status : 0, route: (e && e.route) || '' });
}

async function show(msg) {
  gen += 1;
  if (msg.fresh) { sess = { ok: false, failed: {} }; setPinned(false, false); }
  const origin = msg.origin || 'selection'; const via = C().VIAS.indexOf(msg.via) >= 0 ? msg.via : 'select';
  $('quick-root').hidden = false;
  vs.tag = originLabel(origin);
  clearOut();
  // ── 截图翻译（M-6）──
  // perm：没有录屏权限。系统弹窗之前我们自己的话先到；系统不回调允许 / 拒绝、授权后要重开才生效（同增强取词）
  // ⇒ 说过一次之后就只有一态「允许之后要重开」+ 两个出口。入口不因为被拒而消失，所以每次触发都会到这里。
  if (msg.perm === 'screen') { setSrc('', false); hideLang(); await shotPermission(msg); return fit(); }
  // busy：截好了，正在本机识别。一台 Mac 上第一次要准备模型（二十秒量级）⇒ 多一行，别让人以为卡死了。
  if (msg.busy) {
    setSrc('', false); hideLang();
    message(t('quick_shot_busy', '正在本机识别文字…'));
    if (msg.first) message(t('quick_shot_first', '这台 Mac 上第一次用：要准备一下，大约 20 秒，之后每次不到半秒。'));
    return fit();
  }

  // 这两条对**凡是经过通用剪贴板的来源**都成立 —— 「翻译剪贴板」与「增强取词」（它替你按 ⌘C，读的也是通用剪贴板）：
  // blocked：系统没让读（剪贴板隐私开着时后台读取会卡住，原生 1 秒超时后这样报）；concealed：带隐藏 / 临时标记，原生根本不带文字。
  if (msg.blocked) { setSrc('', false); message(t('quick_clip_blocked', '系统没有让我们读取剪贴板。到「系统设置 › 隐私与安全性 › 粘贴自其他 App」里允许，或改用右键「服务」。')); hideLang(); return fit(); }
  if (msg.concealed && origin !== 'clipboard') { setSrc('', false); message(t('quick_clip_concealed', '剪贴板里的内容被标记为隐藏（多半是密码），没有读取，也没有发出去。')); hideLang(); return fit(); }
  // 零权限路径的另外两个陷阱（空 / 和上次一样）只对「剪贴板」成立；别的来源直接是交来的文字。
  if (origin === 'clipboard') {
    // 增强取词的权限没了（用户在系统设置里关掉了）：热键已自动退回这条路，说一句，只说一次。
    const mine = gen;
    try { const f = await get(['quickEnhancedLost']); if (f.quickEnhancedLost) { lostNote = true; chrome.storage.local.remove(['quickEnhancedLost']); } } catch (_) {}
    if (mine !== gen) return;      // 等存储的这一拍里又来了新的一次
    // own：剪贴板里是我们自己刚复制出去的译文 —— 再翻一遍它没有意义，当作「和上次一样」
    const c = C().classifyClipboard({ text: msg.text, concealed: !!msg.concealed, own: !!msg.own }, lastText);
    if (c.kind === 'concealed') { setSrc('', false); message(t('quick_clip_concealed', '剪贴板里的内容被标记为隐藏（多半是密码），没有读取，也没有发出去。')); hideLang(); return fit(); }
    if (c.kind === 'empty') { setSrc('', false); message(t('quick_clip_empty', '剪贴板里没有文字。先选中并按 ⌘C，再按快捷键；或者在设置里打开「增强取词」，省掉 ⌘C。')); hideLang(); return fit(); }
    if (c.kind === 'same' && lastShown) { setSrc(lastShown.text, true); note(t('quick_clip_same', '和上次翻的是同一段 —— 是不是忘了按 ⌘C？')); renderDone(lastShown); return fit(); }
  }
  if (origin === 'typed') { cur = { via: 'input', origin, text: '' }; setSrc('', true); showLang(null); $('qk-src').focus(); return fit(); }
  const text = String(msg.text || '').trim();
  if (origin === 'selection' && !text) { setSrc('', false); hideLang(); message(t('quick_no_selection', '没有取到选中的文字 —— 可能没有选中，或这个 App 不允许复制。')); actions([{ text: t('quick_use_shot', '改用截图翻译'), run: () => post({ type: 'quick-reselect' }) }]); return fit(); }
  cur = { via, origin, text };
  setSrc(text, true);
  await run();
}
function setSrc(text, visible) { $('qk-src').value = text; $('qk-src').hidden = !visible; autosize(); }
function autosize() { const el = $('qk-src'); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, SRC_MAX_PX) + 'px'; }
function hideLang() { $('qk-lang').hidden = true; vs.from = ''; bump(); }
function showLang(choice) {
  $('qk-lang').hidden = false;
  if (choice) { $('qk-lang').value = choice.lang; $('qk-lang').classList.toggle('auto', !!choice.reversed); }
  // 反向了就写明原因（「原文已是中文」）；语种判不出时这一格留空，不猜。
  const name = choice && choice.reversed ? ([...$('qk-lang').options].find((o) => o.value === choice.from) || {}).textContent : '';
  vs.from = name ? t('quick_same_lang', '原文已是{lang}').replace('{lang}', name) : '';
  bump();
}

async function run(forceLang) {
  const my = gen; const text = cur.text;
  clearOut();
  if (!C().hasLetters(text)) { hideLang(); message(t('sys_empty', '没有可翻译的文字。')); return fit(); }
  const s = await get(READ_KEYS);
  if (my !== gen) return;
  const tr = typeof LearnNotes !== 'undefined' ? LearnNotes.resolveConfig(s) : { provider: s.provider, apiKey: s.apiKey, baseUrl: s.apiBaseUrl, model: s.apiModel };
  if (typeof EngineState !== 'undefined' && EngineState.needsSetup({ provider: tr.provider, apiKey: tr.apiKey, apiBaseUrl: tr.baseUrl })) {
    hideLang(); message(t('quick_unconfigured', '还没有翻译引擎。领一份免费额度，或填自己的 API key。'));
    actions([{ text: t('quick_open_settings', '打开设置'), primary: true, run: () => post({ type: 'quick-open-settings' }) }]);
    return fit();
  }
  const base = AppTargetLang.resolve(s, navigator.language, TranslationCore.DEFAULT_TARGET_LANG);
  const choice = forceLang ? { lang: forceLang, reversed: false, from: '' } : C().chooseTarget(text, base, TranslationCore.isAlreadyTargetLanguage);
  showLang(choice);
  const units = C().splitUnits(text);
  // 骨架行就地占位：行对象留在 vs.out 里，第一段译文到了原位换成 'tr'（同旧 .qk-sk → .qk-tr）。
  const rows = units.map(() => { const row = { k: 'sk', text: '' }; vs.out.push(row); return row; });
  bump();
  const onGrant = typeof LearnGrant !== 'undefined' && LearnGrant.active && LearnGrant.active(s);
  const slow = setTimeout(() => { if (my === gen) { note(onGrant ? t('sys_slow', '还在翻 —— 免费额度走我们的中转，比自己的 key 慢。') : t('quick_slow', '还在翻…')); fit(); } }, SLOW_MS);
  fit();
  const t0 = Date.now(); const out = [];
  try {
    for (let i = 0; i < units.length; i++) {
      // 逐段出：第一段到了就先显示，不等整篇
      const r = await TranslationAPI.translate(units[i], choice.lang, TranslationAPI.resolveProvider(tr.provider), tr.apiKey, tr.baseUrl || '', tr.model || '');
      if (my !== gen) { clearTimeout(slow); return; }
      out.push(r); rows[i].k = 'tr'; rows[i].text = r; bump(); fit();
    }
  } catch (e) {
    clearTimeout(slow); if (my !== gen) return;
    note('');
    for (const row of rows) { const i = vs.out.indexOf(row); if (i >= 0 && row.k === 'sk') vs.out.splice(i, 1); }
    vs.out.push({ k: 'err', text: failText(e) }); bump();
    const code = (e && e.code) || '';
    actions(RETRYABLE[code] ? [{ text: t('quick_retry', '重试'), primary: true, run: () => run(forceLang) }]
      : [{ text: t('quick_open_settings', '打开设置'), primary: true, run: () => post({ type: 'quick-open-settings' }) }]);
    report(false, e, String(tr.provider || ''), Date.now() - t0);
    return fit();
  }
  clearTimeout(slow); note(lostNote ? t('quick_enh_lost', '增强取词的权限被关掉了，这次翻的是剪贴板。要恢复，到设置里重新打开它。') : ''); lostNote = false;
  const done = { text, tr: out.join('\n\n'), lang: choice.lang, captureOn: s.learnEnabled !== false && s.quickCapture !== false };
  lastText = text; lastShown = done;
  renderDone(done, true);
  report(true, null, String(tr.provider || ''), Date.now() - t0);
  fit();
}

function renderDone(done, fresh) {
  if (!fresh) { vs.out = [{ k: 'tr', text: done.tr }]; bump(); }
  vs.copyHidden = false; bump();
  const st = C().captureState(done.text, done.tr, done.captureOn);
  vs.stateCls = 'qk-state' + (st === 'saved' ? ' saved' : '');
  vs.stateText = st === 'saved' ? t('quick_saved', '已存入复习库') : st === 'off' ? t('quick_saved_off', '未存入 · 采集已关') : st === 'long' ? t('quick_saved_long', '太长，不存入复习库') : '';
  bump();
  // 进不进库由主页面那个唯一写入者按同一套门裁定；这里只在「看上去会进」时交过去，别的情形一条都不发。
  if (fresh && st === 'saved' && cur) post({ type: 'quick-capture', v: 1, text: done.text, tr: done.tr, lang: 'und', trLang: done.lang, ts: Date.now(), via: cur.via });
}

async function shotPermission(msg) {
  const mine = gen;
  const s = await get([SHOT_ASKED]);
  if (mine !== gen) return;
  const pending = () => {
    clearOut();
    message(t('quick_shot_perm_pending', '还差一步：在系统设置的列表里打开「{app}」的开关。打开之后要重新打开 App 才生效。').replace('{app}', String(msg.appName || 'BelliedMonkey Translator')));
    // 预告第二道系统框（macOS 15 起才有，由原生告诉我们）：它措辞很重、出现在第一次真的框选时，不预告的话用户会以为出了事。
    if (msg.second) message(t('quick_shot_perm_second', '第一次框选时，系统还会再弹一次确认，允许即可。之后每隔一段时间系统会再问一次 —— 这是系统对所有截屏类 App 的做法。'));
    actions([{ text: t('quick_enh_relaunch', '现在重开'), primary: true, run: () => post({ type: 'quick-relaunch' }) },
      { text: t('quick_enh_open_privacy', '打开系统设置'), run: () => post({ type: 'quick-open-privacy', which: 'screen' }) }]);
    fit();
  };
  if (s[SHOT_ASKED]) return pending();
  message(t('quick_shot_perm_explain', '截图翻译要用到「屏幕录制」权限。只在你框选的那一刻截你框的那一块，在本机识别，识别完即丢弃。'));
  actions([{ text: t('quick_enh_continue', '继续'), primary: true, run: () => {
    chrome.storage.local.set({ [SHOT_ASKED]: true }, () => { post({ type: 'quick-request-perm', which: 'screen' }); pending(); });
  } }]);
}

// 本机没认出文字。引擎支持识图、且不是免费额度（额度不发图，同文档翻译的裁定）⇒ 多一个次级按钮，
// **旁边写明截图会发给谁** —— 点了之后截图才离开设备（D8）。
async function shotNothing() {
  gen += 1; const mine = gen;
  $('quick-root').hidden = false; vs.tag = originLabel('screen'); clearOut(); setSrc('', false); hideLang();
  message(t('quick_shot_nothing', '这一块里没有认出文字。'));
  const acts = [{ text: t('quick_shot_again', '重新框选'), primary: true, run: () => post({ type: 'quick-reselect' }) }];
  const s = await get(READ_KEYS);
  if (mine !== gen) return;
  const tr = typeof LearnNotes !== 'undefined' ? LearnNotes.resolveConfig(s) : { provider: s.provider, apiKey: s.apiKey, baseUrl: s.apiBaseUrl };
  const configured = !(typeof EngineState !== 'undefined' && EngineState.needsSetup({ provider: tr.provider, apiKey: tr.apiKey, apiBaseUrl: tr.baseUrl }));
  const onGrant = typeof LearnGrant !== 'undefined' && LearnGrant.active && LearnGrant.active(s);
  const vision = typeof EngineState !== 'undefined' && EngineState.visionOf ? EngineState.visionOf(tr.provider) : false;
  if (configured && !onGrant && vision !== false) {
    const entry = (typeof EngineState !== 'undefined' && EngineState.entry) ? (EngineState.entry({ provider: tr.provider }) || {}) : {};
    acts.push({ text: t('quick_shot_cloud', '用我的识图引擎再试'), run: () => { clearOut(); message(t('quick_shot_cloud_busy', '正在用你的引擎识别…')); fit(); post({ type: 'quick-ocr-cloud' }); } });
    note(t('quick_shot_cloud_note', '「用我的识图引擎再试」会把这张截图发给你配置的引擎（{engine}）。').replace('{engine}', String(entry.label || tr.provider || '')));
  }
  actions(acts);
  fit();
}

// 用户点了「用我的识图引擎再试」之后，原生才把截图交过来。识图只要原文；译文照常走 translate()。
async function cloudOcr(dataUri) {
  gen += 1; const mine = gen;
  if (!dataUri) { clearOut(); message(t('quick_shot_cloud_gone', '这张截图已经丢弃了。重新框选一次。')); actions([{ text: t('quick_shot_again', '重新框选'), primary: true, run: () => post({ type: 'quick-reselect' }) }]); return fit(); }
  const s = await get(READ_KEYS);
  const tr = typeof LearnNotes !== 'undefined' ? LearnNotes.resolveConfig(s) : { provider: s.provider, apiKey: s.apiKey, baseUrl: s.apiBaseUrl, model: s.apiModel };
  try {
    const text = await TranslationAPI.ocr(dataUri, TranslationAPI.resolveProvider(tr.provider), tr.apiKey, tr.baseUrl || '', tr.model || '');
    if (mine !== gen) return;
    if (!C().hasLetters(text)) { clearOut(); message(t('quick_shot_nothing', '这一块里没有认出文字。')); actions([{ text: t('quick_shot_again', '重新框选'), primary: true, run: () => post({ type: 'quick-reselect' }) }]); return fit(); }
    show({ via: 'shot', origin: 'screen', text: String(text) });
  } catch (e) {
    if (mine !== gen) return;
    clearOut(); vs.out.push({ k: 'err', text: failText(e) }); bump();
    actions([{ text: t('quick_shot_again', '重新框选'), primary: true, run: () => post({ type: 'quick-reselect' }) }]); fit();
  }
}

function _fromNative(msg) {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'quick-show') { show(msg); return; }
  if (msg.type === 'quick-ocr') {
    const text = C().assembleLines(msg.lines);
    if (!text) { shotNothing(); return; }
    show({ via: 'shot', origin: 'screen', text });
    return;
  }
  if (msg.type === 'quick-image') cloudOcr(String(msg.dataUri || ''));
}

function boot() {
  document.documentElement.classList.add('quick-mode');
  // 目标语言的选项从设置页那个选择器克隆（同一份文档里），不另抄一份清单；去掉「跟随界面语言」。
  // （原 paintStatic 的 cloneNode：现在读的是 AppShell 静态 JSX 渲染出的同一批 option。）
  const src = $('target-lang');
  if (src && !vs.langOptions.length) for (const o of src.options) if (o.value) vs.langOptions.push({ value: o.value, text: o.textContent });
  bump();
  // 面板是**独立的一次页面加载**，有它自己的 i18n —— 主壳或设置页调过
  // setUiLang 不算数。不补这一句，英文用户看到的面板标题、「复制译文」和那句
  // 隐私说明全是中文（2026-09-25 真机实测，也因此毁掉过一条商店预览片）。
  // 原 applyStoredUiLang(paintStatic) 的重涂职责已归画布的 useT（组合根把 PageI18n.setUiLang
  // 喂给 PageText），这里只需触发它读存储。
  if (typeof PageI18n !== 'undefined') PageI18n.applyStoredUiLang(() => {});
  $('quick-root').hidden = false;
  // 钉住 ⇒ Esc 也不关（只有 ✕ 关）：点图钉会让面板成为键盘窗口，随后的 Esc 进的是这一页，不经原生那道闸。
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); if (!pinned) post({ type: 'quick-close' }); } });
  post({ type: 'quick-ready' });
  fit();
}

// 画布事件直调的入口（✕ / 图钉 / 原文键盘与输入 / 语种 change / 复制）。
function onClose() { post({ type: 'quick-close' }); }
function onPin() { setPinned(!pinned, true); }
// 原文可编辑：回车重翻、⇧回车换行。输入法组字中的回车不算。
function onSrcKey(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  const v = $('qk-src').value.trim(); if (!v) return;
  gen += 1; cur = { via: (cur && cur.via) || 'input', origin: (cur && cur.origin) || 'typed', text: v }; run();
}
function onSrcInput() { autosize(); }
// 面板里改目标语言**会写回**「译成」（与 iPhone 弹层不同：面板就在 App 进程里），并立刻按新语言重翻。
function onLangChange() {
  const v = $('qk-lang').value; if (!v) return;
  chrome.storage.local.set({ targetLang: v }, () => { if (cur && cur.text) { gen += 1; run(v); } });
}
// 复制发送最后一次的结果 —— 与旧代码「每次 renderDone 重绑当次 done」等价（lastShown 在
// 每个 renderDone 调用点已是同一个值；结果没出来时按钮是 hidden，点不到）。
function onCopy() { if (lastShown) post({ type: 'quick-copy', text: lastShown.tr }); }

const api = {
  CHANNEL, PROTOCOL, canvas, vs,
  boot, _fromNative,
  onClose, onPin, onSrcKey, onSrcInput, onLangChange, onCopy,
  get pinned() { return pinned; },
  isQuickMode: () => /^#quick\b/.test(String(window.location && window.location.hash || '')),
};
export default api;
