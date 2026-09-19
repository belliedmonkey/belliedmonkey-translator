// app/quick-settings.js — App 设置里「快速翻译」块的 M-7 那几行（docs/learning-design.md §9.9）：
// 三个快捷键的录制控件、存入复习库、登录时启动、屏幕录制状态、给右键「服务」绑快捷键的直达。
// 「在菜单栏常驻」与「增强取词」两行是 M-1 / M-5 的，仍在 app/settings.js。
//
// 录制控件五态（画布「快捷键录制 · 五态」）：空 / 录制中 / 已设 / 冲突 / 被拒绝的组合。
//   · 录制中按 Esc = 取消，不是把 Esc 设成快捷键；录制期间全局快捷键全部放开（AppQuickHost.setRecording）。
//   · 被拒绝的组合**不保存**，留着上一个值，并说怎么改；和另一个功能撞了同理。
//   · 冲突有两种来源：HotkeyCore 认得的系统组合（当场拒绝），与原生注册失败（别的 App 占了 —— 已经存了，
//     所以显示为「已设 + 一句冲突」，由用户决定改不改）。
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => (typeof PageI18n !== 'undefined' ? PageI18n.t(k, fb) : fb);
  const get = (keys) => new Promise((res) => chrome.storage.local.get(keys, (v) => res(v || {})));
  const H = () => root.HotkeyCore;
  const Q = () => root.AppQuickHost;

  let live = '';                 // 正在录制的那个 id
  const hint = {};               // id → 上一次被拒的原因（一句话），下一次成功或取消时清掉

  const labelOf = (id) => ({ translate: t('quick_hk_translate', '翻译选中的文字或剪贴板'), shot: t('quick_hk_shot', '截图翻译'), input: t('quick_hk_input', '输入翻译') })[id];
  function whyNot(code, other) {
    switch (code) {
      case 'deny': return t('quick_hk_deny', '只有 ⌥ 的组合不稳定，换一个带 ⌃ 或 ⌘ 的。');
      case 'system': return t('quick_hk_system', '这个组合被系统或各个 App 自己占着，换一个。');
      case 'nomod': return t('quick_hk_nomod', '要带上 ⌃ 或 ⌘ 这样的修饰键。');
      case 'dup': return t('quick_hk_dup', '和「{name}」用的是同一个组合。').replace('{name}', labelOf(other));
      default: return '';
    }
  }

  function button(text, cls, run) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; if (cls) b.className = cls; b.addEventListener('click', run); return b; }

  async function paint() {
    const box = $('quick-hotkeys'); if (!box || !H() || !Q()) return;
    const caps = Q().caps() || {};
    const hk = H().normalize((await get(['quickHotkeys'])).quickHotkeys);
    const clashes = Q().clashes();
    const more = $('quick-hotkeys-more');
    box.textContent = ''; if (more) more.textContent = '';
    for (const id of H().IDS) {
      if (id === 'shot' && caps.sck === false) continue;                   // macOS 低于 14：入口整个不出现（原因在下面那一行）
      const row = document.createElement('div'); row.className = 'hk-row'; row.dataset.hk = id;
      const name = document.createElement('span'); name.className = 'hk-name'; name.textContent = labelOf(id); row.appendChild(name);
      const ctl = document.createElement('span'); ctl.className = 'hk-ctl';
      if (live === id) {
        const s = document.createElement('span'); s.className = 'hk-live'; s.textContent = t('quick_hk_press', '按下想用的组合…'); s.setAttribute('role', 'status'); ctl.appendChild(s);
        ctl.appendChild(button(t('quick_hk_cancel', '取消'), 'secondary', () => stop(id)));
      } else if (hk[id]) {
        const keys = document.createElement('span'); keys.className = 'hk-keys'; keys.setAttribute('aria-label', H().label(hk[id]));
        for (const p of H().parts(hk[id])) { const k = document.createElement('kbd'); k.textContent = p; keys.appendChild(k); }
        ctl.appendChild(keys);
        ctl.appendChild(button(t('quick_hk_change', '改'), 'secondary', () => start(id)));
        ctl.appendChild(button(t('quick_hk_clear', '清除'), 'secondary', async () => { delete hint[id]; await Q().setHotkey(id, null); }));
      } else {
        const s = document.createElement('span'); s.className = 'hk-empty'; s.textContent = t('quick_hk_unset', '未设置'); ctl.appendChild(s);
        ctl.appendChild(button(t('quick_hk_record', '录制'), 'secondary', () => start(id)));
      }
      row.appendChild(ctl);
      const why = hint[id] || (clashes.indexOf(id) >= 0 && live !== id ? t('quick_hk_clash', '别的 App 已经占了这个组合，按了不会到我们这里。换一个。') : '');
      if (why) { const n = document.createElement('p'); n.className = 'note hk-why'; n.setAttribute('role', 'status'); n.textContent = why; row.appendChild(n); }
      (id === 'input' && more ? more : box).appendChild(row);      // 输入翻译的快捷键默认留空，放在「更多选项」里
    }
    paintRest(caps);
  }

  async function paintRest(caps) {
    const s = await get(['quickCapture', 'learnEnabled']);
    if ($('quick-capture')) { $('quick-capture').checked = s.quickCapture !== false; $('quick-capture').disabled = s.learnEnabled === false; }
    // 屏幕录制：状态 + 出口。macOS 低于 14 ⇒ 一句原因，别的都不出现。
    const scr = $('quick-screen-state'); const go = $('quick-screen-privacy');
    if (scr) {
      scr.textContent = caps.sck === false ? t('quick_shot_needs14', '截图翻译需要 macOS 14 或更新的系统。')
        : caps.screen ? t('quick_screen_ok', '屏幕录制 · 已允许 ✓（截图翻译用）') : t('quick_screen_off', '屏幕录制 · 还没有允许。第一次用截图翻译时会问你。');
      if (go) go.hidden = caps.sck === false || !!caps.screen;
    }
    const row = $('quick-login-row');
    if (row) {
      row.hidden = !caps.loginItem || caps.loginItem === 'unsupported';
      $('quick-login').checked = caps.loginItem === 'on' || caps.loginItem === 'approval';
      const ap = $('quick-login-approval'); ap.hidden = caps.loginItem !== 'approval';
      $('quick-login-go').hidden = caps.loginItem !== 'approval';
    }
  }

  function onKey(e) {
    if (!live) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return stop(live);                              // Esc = 取消，不是把 Esc 设成快捷键
    const c = H().fromEvent(e); if (!c) return;                             // 只按了修饰键：继续等
    finish(live, c);
  }
  async function finish(id, c) {
    const hk = H().normalize((await get(['quickHotkeys'])).quickHotkeys);
    const bad = H().validate(c); const dup = bad ? '' : H().duplicateOf(id, c, hk);
    if (bad || dup) { hint[id] = whyNot(bad || 'dup', dup); return stop(id); }   // 不保存，留着上一个值
    delete hint[id];
    await Q().setHotkey(id, c);
    stop(id);
  }
  function start(id) { if (live) stop(live); live = id; delete hint[id]; document.addEventListener('keydown', onKey, true); Q().setRecording(true); paint(); }
  function stop() { live = ''; document.removeEventListener('keydown', onKey, true); Q().setRecording(false); paint(); }

  function paintStatic() {
    const put = (id, text) => { if ($(id)) $(id).textContent = text; };
    put('quick-hotkeys-title', t('quick_hk_title', '快捷键'));
    put('quick-hotkeys-reset', t('quick_hk_reset', '恢复默认'));
    put('quick-more-title', t('quick_more', '更多选项'));
    put('quick-capture-label', t('quick_capture_label', '存入复习库'));
    put('quick-capture-hint', t('quick_capture_hint', '翻过的句子进复习，来源「划词翻译 / 截图翻译 / 输入翻译」。关掉后照常翻译，只是不存。'));
    put('quick-login-label', t('quick_login_label', '登录时启动'));
    put('quick-login-hint', t('quick_login_hint', '开机后自动待在菜单栏。默认关闭。'));
    put('quick-login-approval', t('quick_login_approval', '还要在系统设置的「登录项」里允许一次。'));
    put('quick-login-go', t('quick_enh_open_privacy', '打开系统设置'));
    put('quick-screen-privacy', t('quick_enh_open_privacy', '打开系统设置'));
    put('quick-services-go', t('quick_services_link', '给右键「服务」绑快捷键 →'));
  }

  function wire() {
    if (!$('quick-hotkeys') || !Q() || !H()) return;
    paintStatic();
    $('quick-hotkeys-reset').addEventListener('click', async () => { for (const k of Object.keys(hint)) delete hint[k]; await Q().resetHotkeys(); });
    $('quick-capture').addEventListener('change', () => chrome.storage.local.set({ quickCapture: $('quick-capture').checked }));
    // 登录时启动：界面显示的是系统的实际状态。拨完由原生重发能力回执，界面跟着回执走 —— 登记失败时开关自己会弹回去。
    $('quick-login').addEventListener('change', () => Q().setLoginItem($('quick-login').checked));
    $('quick-login-go').addEventListener('click', () => Q().openPane('loginItems'));
    $('quick-screen-privacy').addEventListener('click', () => Q().openPane('screen'));
    $('quick-services-go').addEventListener('click', () => Q().openPane('services'));
    Q().onCaps(() => paint()); Q().onClashes(() => paint());
    try { chrome.storage.onChanged.addListener((ch) => { if (ch && (ch.quickHotkeys || ch.quickCapture || ch.learnEnabled || ch.uiLang)) { if (ch.uiLang) paintStatic(); paint(); } }); } catch (_) {}
    paint();
  }

  const api = { wire, paint, _state: () => ({ live, hint: Object.assign({}, hint) }) };
  root.AppQuickSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
