// app/quick.js — macOS 快速翻译的面板页（docs/learning-design.md §9.9；domain-design §2.6）。
//
// 它是**同一份** Main.html 以 `#quick` 加载出来的第二个 WKWebView：同源 ⇒ localStorage 里的引擎配置、
// 界面语言、「译成」直接共享，不镜像任何东西。这一页只做一件事：显示交来的文字并翻译它。
// 原生在 document-start 注入 `location.hash = '#quick'`（WKWebView.loadFileURL 不收带 # 的地址，T2 读数），早于本包执行。
// 它**不**启动同步、不初始化遥测、不打开 LearnStore —— 学习库按账号分库，第二个打开者会握着过期的库名；
// 「这句进复习库」与「翻成了 / 失败了」都经原生中继交给主页面（quick-capture / quick-result）。
//
// 原生 → 页面：quick-show {via, origin, text?, concealed?, own?, blocked?, fresh?}   origin: selection | clipboard | service | screen | typed
//             quick-ocr {lines}                                截图识别出的行框（拼段在 HandoffCore）
// 页面 → 原生：quick-ready · quick-resize {h} · quick-close · quick-pin {on} · quick-copy {text}
//             quick-capture {v,text,tr,lang,trLang,ts,via} · quick-result {ok, code, provider, ms, status, route}（每个面板会话至多一条成功）
//             quick-open-settings · quick-reselect（重新框选）
(function (root) {
  'use strict';
  const CHANNEL = 'mtQuick';
  const PROTOCOL = {
    toNative: ['quick-ready', 'quick-resize', 'quick-close', 'quick-pin', 'quick-copy', 'quick-capture', 'quick-result', 'quick-open-settings', 'quick-reselect'],
    fromNative: ['quick-show', 'quick-ocr'],
  };
  const SLOW_MS = 5000;
  const SRC_MAX_PX = 168;      // 与 style.css 的 #qk-src max-height 同值。固定像素，不按窗口高度算：窗口高度是内容决定的
  const READ_KEYS = ['provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
    'uiLang', 'targetLang', 'learnEnabled', 'quickCapture', 'grantTail'];
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => (typeof PageI18n !== 'undefined' ? PageI18n.t(k, fb) : fb);
  const C = () => root.HandoffCore;

  let gen = 0;                 // 每次交来新文字 +1：上一句迟到的结果一律丢弃（「上一句还在翻时再触发 = 取消上一句」）
  let cur = null;              // { via, origin, text }
  let lastText = '';           // 上一次交来的文字（陷阱②）
  let lastShown = null;        // 上一次的结果（陷阱②：显示它，不重发请求）
  let pinned = false;
  let sess = { ok: false, failed: {} };   // 一个面板会话（原生说 fresh 起算）：成功至多报一次、每个错误码至多一次

  // 钉住：页面与原生各有一份，必须同进同退。原生在收起面板时清掉它那一份 ⇒ 新会话开始时这里也清（不回报）。
  function setPinned(on, tell) { pinned = !!on; const b = $('qk-pin'); if (b) b.setAttribute('aria-pressed', String(pinned)); if (tell) post({ type: 'quick-pin', on: pinned }); }
  function post(payload) { try { root.webkit.messageHandlers[CHANNEL].postMessage(payload); return true; } catch (_) { return false; } }
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

  function paintStatic() {
    $('qk-pin').setAttribute('aria-label', t('quick_pin', '钉住'));
    $('qk-close').setAttribute('aria-label', t('quick_close', '关闭'));
    $('qk-copy').setAttribute('aria-label', t('quick_copy', '复制译文'));
    $('qk-src').setAttribute('aria-label', t('quick_src_label', '原文'));
    $('qk-src').placeholder = t('quick_src_placeholder', '输入或粘贴要翻译的文字');
    $('qk-lang').setAttribute('aria-label', t('target_lang_label', '译成'));
    // 目标语言的选项从设置页那个选择器克隆（同一份文档里），不另抄一份清单；去掉「跟随界面语言」。
    const src = $('target-lang');
    if (src && !$('qk-lang').options.length) for (const o of src.options) if (o.value) $('qk-lang').appendChild(o.cloneNode(true));
  }

  function clearOut() { $('qk-out').textContent = ''; $('qk-actions').hidden = true; $('qk-actions').textContent = ''; $('qk-note').hidden = true; $('qk-state').textContent = ''; $('qk-state').className = 'qk-state'; $('qk-copy').hidden = true; }
  function note(text) { $('qk-note').textContent = text; $('qk-note').hidden = !text; }
  function actions(list) {
    const box = $('qk-actions'); box.textContent = '';
    for (const a of list) { const b = document.createElement('button'); b.type = 'button'; b.textContent = a.text; if (a.primary) b.className = 'p'; b.addEventListener('click', a.run); box.appendChild(b); }
    box.hidden = !list.length;
  }
  function message(text) { const d = document.createElement('div'); d.className = 'qk-note'; d.textContent = text; $('qk-out').appendChild(d); }

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
    $('qk-tag').textContent = originLabel(origin);
    clearOut();
    // 零权限路径的三个陷阱只对「剪贴板」成立；别的来源直接是交来的文字。
    if (origin === 'clipboard') {
      // blocked：系统没让读（剪贴板隐私开着时后台读取会卡住，原生 1 秒超时后这样报）
      if (msg.blocked) { setSrc('', false); message(t('quick_clip_blocked', '系统没有让我们读取剪贴板。到「系统设置 › 隐私与安全性 › 粘贴自其他 App」里允许，或改用右键「服务」。')); hideLang(); return fit(); }
      // own：剪贴板里是我们自己刚复制出去的译文 —— 再翻一遍它没有意义，当作「和上次一样」
      const c = C().classifyClipboard({ text: msg.text, concealed: !!msg.concealed, own: !!msg.own }, lastText);
      if (c.kind === 'concealed') { setSrc('', false); message(t('quick_clip_concealed', '剪贴板里的内容被标记为隐藏（多半是密码），没有读取，也没有发出去。')); hideLang(); return fit(); }
      if (c.kind === 'empty') { setSrc('', false); message(t('quick_clip_empty', '剪贴板里没有文字。先选中并按 ⌘C，再按快捷键。')); hideLang(); return fit(); }
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
  function hideLang() { $('qk-lang').hidden = true; $('qk-from').textContent = ''; }
  function showLang(choice) {
    $('qk-lang').hidden = false;
    if (choice) { $('qk-lang').value = choice.lang; $('qk-lang').classList.toggle('auto', !!choice.reversed); }
    // 反向了就写明原因（「原文已是中文」）；语种判不出时这一格留空，不猜。
    const name = choice && choice.reversed ? ([...$('qk-lang').options].find((o) => o.value === choice.from) || {}).textContent : '';
    $('qk-from').textContent = name ? t('quick_same_lang', '原文已是{lang}').replace('{lang}', name) : '';
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
    const rows = units.map(() => { const d = document.createElement('div'); d.className = 'qk-sk'; $('qk-out').appendChild(d); return d; });
    const onGrant = typeof LearnGrant !== 'undefined' && LearnGrant.active && LearnGrant.active(s);
    const slow = setTimeout(() => { if (my === gen) { note(onGrant ? t('sys_slow', '还在翻 —— 免费额度走我们的中转，比自己的 key 慢。') : t('quick_slow', '还在翻…')); fit(); } }, SLOW_MS);
    fit();
    const t0 = Date.now(); const out = [];
    try {
      for (let i = 0; i < units.length; i++) {
        // 逐段出：第一段到了就先显示，不等整篇
        const r = await TranslationAPI.translate(units[i], choice.lang, TranslationAPI.resolveProvider(tr.provider), tr.apiKey, tr.baseUrl || '', tr.model || '');
        if (my !== gen) { clearTimeout(slow); return; }
        out.push(r); rows[i].className = 'qk-tr'; rows[i].textContent = r; fit();
      }
    } catch (e) {
      clearTimeout(slow); if (my !== gen) return;
      note('');
      for (const r of rows) if (r.className === 'qk-sk') r.remove();
      const d = document.createElement('div'); d.className = 'qk-err'; d.textContent = failText(e); $('qk-out').appendChild(d);
      const code = (e && e.code) || '';
      actions(RETRYABLE[code] ? [{ text: t('quick_retry', '重试'), primary: true, run: () => run(forceLang) }]
        : [{ text: t('quick_open_settings', '打开设置'), primary: true, run: () => post({ type: 'quick-open-settings' }) }]);
      report(false, e, String(tr.provider || ''), Date.now() - t0);
      return fit();
    }
    clearTimeout(slow); note('');
    const done = { text, tr: out.join('\n\n'), lang: choice.lang, captureOn: s.learnEnabled !== false && s.quickCapture !== false };
    lastText = text; lastShown = done;
    renderDone(done, true);
    report(true, null, String(tr.provider || ''), Date.now() - t0);
    fit();
  }

  function renderDone(done, fresh) {
    if (!fresh) { $('qk-out').textContent = ''; const d = document.createElement('div'); d.className = 'qk-tr'; d.textContent = done.tr; $('qk-out').appendChild(d); }
    $('qk-copy').hidden = false; $('qk-copy').onclick = () => post({ type: 'quick-copy', text: done.tr });
    const st = C().captureState(done.text, done.tr, done.captureOn);
    $('qk-state').className = 'qk-state' + (st === 'saved' ? ' saved' : '');
    $('qk-state').textContent = st === 'saved' ? t('quick_saved', '已存入复习库') : st === 'off' ? t('quick_saved_off', '未存入 · 采集已关') : st === 'long' ? t('quick_saved_long', '太长，不存入复习库') : '';
    // 进不进库由主页面那个唯一写入者按同一套门裁定；这里只在「看上去会进」时交过去，别的情形一条都不发。
    if (fresh && st === 'saved' && cur) post({ type: 'quick-capture', v: 1, text: done.text, tr: done.tr, lang: 'und', trLang: done.lang, ts: Date.now(), via: cur.via });
  }

  function _fromNative(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'quick-show') { show(msg); return; }
    if (msg.type === 'quick-ocr') {
      const text = C().assembleLines(msg.lines);
      if (!text) {
        gen += 1; $('quick-root').hidden = false; $('qk-tag').textContent = originLabel('screen'); clearOut(); setSrc('', false); hideLang();
        message(t('quick_shot_nothing', '这一块里没有认出文字。'));
        actions([{ text: t('quick_shot_again', '重新框选'), primary: true, run: () => post({ type: 'quick-reselect' }) }]);
        return fit();
      }
      show({ via: 'shot', origin: 'screen', text });
    }
  }

  function boot() {
    document.documentElement.classList.add('quick-mode');
    paintStatic();
    $('quick-root').hidden = false;
    $('qk-close').addEventListener('click', () => post({ type: 'quick-close' }));
    $('qk-pin').addEventListener('click', () => setPinned(!pinned, true));
    // 钉住 ⇒ Esc 也不关（只有 ✕ 关）：点图钉会让面板成为键盘窗口，随后的 Esc 进的是这一页，不经原生那道闸。
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); if (!pinned) post({ type: 'quick-close' }); } });
    // 原文可编辑：回车重翻、⇧回车换行。输入法组字中的回车不算。
    $('qk-src').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      const v = $('qk-src').value.trim(); if (!v) return;
      gen += 1; cur = { via: (cur && cur.via) || 'input', origin: (cur && cur.origin) || 'typed', text: v }; run();
    });
    $('qk-src').addEventListener('input', autosize);
    // 面板里改目标语言**会写回**「译成」（与 iPhone 弹层不同：面板就在 App 进程里），并立刻按新语言重翻。
    $('qk-lang').addEventListener('change', () => {
      const v = $('qk-lang').value; if (!v) return;
      chrome.storage.local.set({ targetLang: v }, () => { if (cur && cur.text) { gen += 1; run(v); } });
    });
    post({ type: 'quick-ready' });
    fit();
  }

  const api = { CHANNEL, PROTOCOL, boot, _fromNative, isQuickMode: () => /^#quick\b/.test(String(root.location && root.location.hash || '')) };
  root.AppQuick = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
