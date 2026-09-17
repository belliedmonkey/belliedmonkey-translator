// learn/dep-line.js — 功能块首行那条只读的「依赖」行（interaction-spec「设置页信息架构」②，2026-09-17）。
//
// 设置页按用途分节之后，引擎在①、功能在②：一个功能能不能用取决于①里配了什么，而人在②里
// 看不见①。这一行把「这块功能依赖哪几个引擎、现在配好了没有」说在功能块的第一行，并给一条
// 直达①对应槽卡的路 ——「去配置 →」。它**只读**：不改任何设置，不重复引擎控件（永不同屏）。
//
// 两个宿主共用（扩展设置页 + App 设置页），所以：
//   · 标签来自注册表（EngineFields.labelOf），这里不复述引擎名（domain-design §7）
//   · 判据来自既有的判据：翻译看 EngineState.needsSetup；朗读 / 整段转写看引擎 id 在不在；
//     解析 '' = 跟随翻译引擎（LearnNotes.resolveConfig 的规则）；实时转写由宿主传入
//     NativeSpeech.probe 的结论（它不是引擎，没有 id）
//   · 快速档且一键卡表示得了这份配置（QuickSetup.represents）⇒ 只写一句「由一键配置提供 ✓」，
//     不逐个列 —— 那一档里用户看到的就是一张卡，逐个列会像在说另一套配置
//
// t(key, fallback) 由宿主给（两个宿主 i18n 取法不同，文案内容必须一样）。

var DepLine = (() => {
  'use strict';

  const reg = (name) => (typeof window !== 'undefined' && window[name]) || [];
  const byId = (list, id) => list.find((e) => e && e.id === id) || null;
  const label = (e, t) => (typeof EngineFields !== 'undefined' && EngineFields.labelOf ? EngineFields.labelOf(e, t)
    : ((e && e.labelKey && t) ? t(e.labelKey, e.label) : ((e && (typeof e.label === 'string' ? e.label : (e.label && e.label.global))) || (e && e.id) || '')));

  // 槽位名（与一键卡结果区同一组键：qs_slot_*）
  function slotName(slot, t) {
    switch (slot) {
      case 'chat': return t('qs_slot_chat', '翻译');
      case 'tts': return t('qs_slot_tts', '朗读');
      case 'stt': return t('qs_slot_stt', '整段转写');
      case 'notes': return t('qs_slot_notes', '解析');
      case 'live': return t('dep_live', '实时转写');
      default: return slot;
    }
  }

  // items(settings, o) → [{ slot, name, label, state, text }]
  //   state ∈ 'ok' | 'unset' | 'follow' | 'quick' | 'na'
  //   o.slots: 要列的槽；o.live: { ok, reason }（宿主传 NativeSpeech 的结论）；o.quick: 一键卡表示得了这份配置
  function items(settings, o) {
    const s = settings || {}; const t = o.t || ((k, d) => d);
    if (o.quick) return [{ slot: 'quick', name: '', label: '', state: 'quick', text: t('dep_quick', '由一键配置提供 ✓') }];
    const out = [];
    for (const slot of (o.slots || [])) {
      const name = slotName(slot, t);
      if (slot === 'chat') {
        const need = typeof EngineState !== 'undefined' ? EngineState.needsSetup(s) : !String(s.apiKey || '').trim();
        const e = typeof EngineState !== 'undefined' ? EngineState.entry(s) : byId(reg('MT_PROVIDERS'), s.provider);
        out.push(need ? { slot, name, label: '', state: 'unset', text: t('dep_unset', '未配置') } : { slot, name, label: label(e, t), state: 'ok', text: '' });
      } else if (slot === 'tts') {
        const e = byId(reg('MT_TTS_ENGINES'), s.ttsEngine);
        out.push(e ? { slot, name, label: label(e, t), state: 'ok', text: '' } : { slot, name, label: '', state: 'unset', text: t('dep_unset', '未配置') });
      } else if (slot === 'stt') {
        const e = byId(reg('MT_STT_ENGINES'), s.sttEngine);
        out.push(e ? { slot, name, label: label(e, t), state: 'ok', text: '' } : { slot, name, label: '', state: 'unset', text: t('dep_unset', '未配置') });
      } else if (slot === 'notes') {
        if (!s.notesProvider) out.push({ slot, name, label: '', state: 'follow', text: t('dep_follow', '跟随翻译引擎') });
        else { const e = byId(reg('MT_PROVIDERS'), s.notesProvider); out.push({ slot, name, label: label(e, t), state: e ? 'ok' : 'unset', text: e ? '' : t('dep_unset', '未配置') }); }
      } else if (slot === 'live') {
        const l = o.live || { ok: false, reason: 'no-bridge' };
        out.push(l.ok ? { slot, name, label: t('dep_live_device', '设备内置（本机 · iOS 26 / macOS 26）'), state: 'ok', text: '' }
          : { slot, name, label: '', state: 'na', text: l.reason === 'locale' ? t('listen_need_locale', '本机识别器不支持这门语言 —— 换一种语言试试') : t('listen_need_os', '对话 · 实时字幕需要 iOS 26 / macOS 26') });
      }
    }
    return out;
  }

  // render(el, settings, o)：把 items 画进 el（覆盖式）。「去配置 →」只给 unset 的槽，点了调 o.onGo(slot)。
  // 实时转写不可用（na）没有「去配置」—— 那不是配置问题。
  function render(el, settings, o) {
    if (!el) return [];
    const t = (o && o.t) || ((k, d) => d);
    const doc = el.ownerDocument || document;
    const list = items(settings, o || {});
    el.textContent = '';
    el.classList.add('dep');
    const k = doc.createElement('span'); k.className = 'dep-k'; k.textContent = t('dep_label', '依赖'); el.appendChild(k);
    for (const it of list) {
      const span = doc.createElement('span'); span.className = 'dep-item dep-' + it.state;
      if (it.state === 'quick') span.textContent = ' · ' + it.text;
      else {
        span.textContent = ' · ' + it.name + '：' + (it.label || it.text) + (it.state === 'ok' || it.state === 'follow' ? ' ✓' : '');
        if (it.state === 'unset' && o && o.onGo) {
          const b = doc.createElement('button'); b.type = 'button'; b.className = 'dep-go'; b.dataset.slot = it.slot;
          b.textContent = ' ' + t('dep_go', '去配置 →');
          b.addEventListener('click', () => o.onGo(it.slot));
          span.appendChild(b);
        }
      }
      el.appendChild(span);
    }
    return list;
  }

  return { items, render, slotName };
})();

if (typeof window !== 'undefined') window.DepLine = DepLine;
if (typeof module !== 'undefined' && module.exports) module.exports = DepLine;
