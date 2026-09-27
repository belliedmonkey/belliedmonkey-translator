// src/app/settings-view.jsx — App 设置页的视图层（PR6b）。前身 app/settings.js。
//
// 分工：与 DOM 无关的决策逻辑在 settings-model.js（KEYS、价格/账单文案、规则写入、
// 领额度共用段、宿主通路 bind/notifySettingsShown/requestDetail）；这一半管涂写与接线。
//
// 渲染契约（继承 PR5/PR6a 的两条既定规则）：
//   · 静态标签是 JSX（useT 驱动，界面语言一换整树重渲染）；命令式写的叶子（计数、
//     依赖行、来源治理、额度卡、一键卡、动态下拉）保持空 JSX，由 addEventListener
//     时代的同一批函数涂写 —— React 对「vdom 值没变的属性」不写 DOM，所以常量
//     hidden（telemetry-block、app-settings 本身…）与命令式揭开共存，命令式孤岛
//     （renderQuickSetup 塞进 #quick-setup 的子树）不会被重渲染清掉。
//   · 派生 hidden 用布尔公式挂在始终挂载的元素上；「快速 | 详细」两档的 DOM 终态
//     必须与旧 applyDetailMode 一致（见 setDetailFn 与 applyFields/paintTtsPack 里
//     那条两套机制写同一个 hidden 的时序注释）。
//   · 零受控输入：全部输入框保持非受控，写入仍是 change/blur 时 set()，行为逐字。
//
// 旧 set() 尾上的 depsOnWrite() 正则重画退役：写入走 raw chrome.storage（理由在
// settings-model.js 头注释），依赖行的重画由下面订阅 SettingsStore 总线承担 ——
// 写进存储、总线送回快照、useLayoutEffect 重画依赖行。本页不再维护第二份快照。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import PageText from '../lib/i18n.js';
import Registry from '../lib/registry.js';
import SettingsStore from '../store/settings-store.js';
import settingsModel from './settings-model.js';
import LearnDialog from '../shared/dialog.jsx';
import DepLineView from '../shared/dep-line-view.jsx';

// PR7b：共享模块从「HTML script 标签挂 window + typeof 守卫」改成 ESM import
// （§9.4：两宿主 import 同一份源、同一次编译）。四个渲染宿主在本页仍是命令式孤岛
// （见头注释）——变了的只有全局查找这一层：render 经各 view 文件的 named export 进来
// （它们保留旧 render 的 `box.hidden` 写入与返回句柄语义，孤岛读回判据不变），
// 纯逻辑经各自的源文件进来。
import EngineFields from '../shared/engine-fields.js';
import QuickSetup from '../shared/quick-setup.js';
import { render as renderQuickSetup } from '../shared/quick-setup-view.jsx';
import * as LearnGrant from '../shared/grant.js';
import { render as renderGrant } from '../shared/grant-view.jsx';
import * as SourcesView from '../shared/sources-view-view.jsx';

const $ = (id) => document.getElementById(id);

export default function SettingsView() {
  const t = PageText.useT();

  // React state 只管派生 hidden / 文案；其余命令式状态进 ref（E1 的闭包读它们）。
  const [, setGen] = useState(0);
  const [busGen, setBusGen] = useState(0);
  const [detail, setDetailState] = useState(false);
  const [quickAvail, setQuickAvail] = useState(true);
  const [grantVisible, setGrantVisible] = useState(false);
  const [followLabel, setFollowLabel] = useState('');

  const uiLangNow = useRef('auto');
  const lastLangs = useRef({ my: '', other: '' });
  // 出发前预载（§9.5）：两态按钮。`pending` 持有算好的账单，点第二下才开跑；
  // `running` 时按钮是「停止」。这不是 UI 花样，是 §9.2 修订后那条例外的构成要件之一。
  const preloadState = useRef('idle');     // idle | pending | running
  const preloadPlanned = useRef(null);
  const preloadStop = useRef(false);
  const ttsPackBusy = useRef(false);
  const detailWriteRef = useRef(Promise.resolve());
  const listenPackBusy = useRef(false);
  const grantBusy = useRef(false);
  const grantUnavailable = useRef(false);
  const [depsSettings, setDepsSettings] = useState(null);   // 依赖行的设置快照（旧 depsRef）
  const detailRef = useRef(false);

  // ─── 对话模式语言下拉（§9.6）──────────────────────────────────────────────
  // 从语言注册表填（settings-model.sttSupportedBases 说为什么按本机识别器过滤）。
  function fillLangs(sel) {
    if (!sel) return;
    const keep = sel.value;
    const allowed = settingsModel.sttSupportedBases();
    sel.textContent = '';
    for (const l of (Registry.langs() || [])) {
      if (allowed && !allowed.has(String(l.code).toLowerCase()) && l.code !== keep) continue;
      const o = document.createElement('option');
      o.value = l.code;
      o.textContent = l.labelKey ? t(l.labelKey, l.label) : l.label;
      sel.appendChild(o);
    }
    if (keep) sel.value = keep;
  }

  // 「译成」的跟随选项文案。「跟随界面语言（简体中文）」里的括号要随界面语言当场重算，
  // 所以界面语言一变也要重算（旧的 paintStatic 会走到这里）。
  function updateFollowLabel() {
    if (!$('target-lang')) return;
    const follow = AppTargetLang.resolve({ uiLang: uiLangNow.current }, navigator.language);
    const opt = [...$('target-lang').options].find((o) => o.value === follow);
    setFollowLabel(t('target_lang_follow', '跟随界面语言（{lang}）').replace('{lang}', opt ? opt.textContent : follow));
  }

  // 引擎三下拉 + 语言三下拉 + 跟随文案。旧 paintStatic 的动态部分（静态标签已进 JSX）。
  // 界面语言一换要整批重跑：哨兵项与语言名都是 t() 出来的。
  function populateStatic() {
    // 用注册表填下拉：EngineFields.populate 一处实现。它比手抄多做两件事 ——
    // 存着的 id 注册表不认识时**落到一个能用的选项**（换 flavor / 降级安装 / 厂商下架
    // 都会让一个合法保存过的 id 消失，留一个空 select 更糟），以及哨兵项的语义。
    // 哨兵 '' = 未配置（不朗读）。与转写同一套语义 —— 语音不再默认走系统自带。
    EngineFields.populate($('tts-engine'), Registry.ttsEngines() || [], {
      deviceOk: typeof NativeSpeech !== 'undefined' && NativeSpeech.available(),
      t, sentinel: { value: '', text: t('tts_engine_none', '未配置（不朗读）') },
    });
    // The picker lists chat-capable engines ONLY, and asks LearnNotes which those
    // are — the gate and the picker share one definition, so they cannot drift.
    // ⚠️ 哨兵的**语义在两个宿主上不同，这是有意的**：扩展那边 '' = 「跟随翻译引擎」
    // （它有一个翻译引擎可跟随）；App 里没有网页翻译，没有可跟随的对象，所以 '' =
    // 「不使用」。所以这里显式传 sentinel，而不是用 SLOTS.notes 的默认哨兵。
    EngineFields.populate($('notes-provider'), LearnNotes.chatEngines(), {
      t, sentinel: { value: '', text: t('app_set_notes_none', '不使用') },
    });
    // 2026-09-17 起转写注册表里没有本机条目（实时转写固定为设备内置，不是可选引擎），
    // 不再注入 deviceOk —— 这一档只列云端 / 自建，只管说题。
    EngineFields.populate($('stt-engine'), Registry.sttEngines() || [], {
      t, sentinel: { value: '', text: t('stt_engine_none', '未配置（不出「说」题）') },
    });
    fillLangs($('subtitle-video-lang'));
    fillLangs($('listen-my-lang'));
    fillLangs($('listen-other-lang'));
    updateFollowLabel();
  }

  // ─── 出发前预载（§9.5）────────────────────────────────────────────────────
  function resetPreload() {
    preloadState.current = 'idle';
    preloadPlanned.current = null;
    preloadStop.current = false;
    $('btn-drive-preload').disabled = false;
    $('btn-drive-preload').textContent = t('drive_preload', '预载离线资源');
    $('drive-preload-note').textContent = '';
  }

  async function refreshAudioCache() {
    const el = $('drive-audio-cache');
    if (!el) return;
    try {
      const e = settingsModel.engineById($('tts-engine').value);
      if (!e) { el.textContent = ''; $('btn-drive-clear-audio').hidden = true; return; }
      if (!e.returnsAudio) {
        el.textContent = t('tts_cache_na', '设备内置语音不产生缓存');
        $('btn-drive-clear-audio').hidden = true;
        return;
      }
      $('btn-drive-clear-audio').hidden = false;
      const st = await LearnStore.audioStats();
      el.textContent = st.count
        ? t('tts_cache', '语音缓存 {n} 条 · 约 {mb} MB（上限 {cap} MB）')
            .replace('{n}', String(st.count))
            .replace('{mb}', String(Math.max(1, Math.round(st.bytes / 1048576))))
            .replace('{cap}', String(Math.round(LearnStore.MAX_AUDIO_BYTES / 1048576)))
        : t('tts_cache_empty', '语音缓存为空');
    } catch (_) { el.textContent = ''; }
  }

  // 显隐与示例地址一律走 EngineFields —— **不在这里复述规则**。
  //
  // 这三个 paint* 曾经是手抄的（engine-fields.js 的文件头点名了它们），代价是四处
  // 静默漂移。2026-09-04 用户报「App 设置页与扩展不一致」就是这么来的。规则只能有一份。
  // `slot` 是 EngineFields.SLOTS 的槽名 —— **输入框的 id 从那张表取，不在这里抄**。
  // `prefix` 只用于 App 自己的行容器（`<prefix>-key-field` 等），那是 App 的 markup，
  // SLOTS 不管它们。
  //
  // ⚠️ 行 hidden 里并着 `!detailRef.current`：旧 applyDetailMode 会把 .adv-only 全量
  // 盖写一遍、再让逐引擎的判断重新说话（见 setDetailFn 头注释）；React 接管档位后
  // 全量盖写没有了，档位布尔就地并进每一次逐引擎写，DOM 终态与旧一致。
  function applyFields(vis, slot, prefix) {
    const ids = EngineFields.SLOTS[slot].ids;
    const off = !detailRef.current;
    $(prefix + '-key-field').hidden = off || !vis.key;
    $(prefix + '-base-field').hidden = off || !vis.baseUrl;
    $(prefix + '-model-field').hidden = off || !vis.model;
    $(ids.baseUrl).placeholder = vis.basePlaceholder;
    $(ids.model).placeholder = vis.modelPlaceholder;
  }

  function paintTtsFields(engineId) {
    applyFields(EngineFields.visibility(settingsModel.engineById(engineId)), 'tts', 'tts');
    paintTtsPack(engineId);
  }

  // ── 离线模型行（learning-design §9.1.1，2026-09-17）────────────────────────
  // 只在选了「设备内置朗读」时出现。状态来自 LearnTTS.deviceStatus()（探原生桥），下载走
  // LearnTTS.ensureDeviceReady —— 与复习 ▶、播客首播、对话开始是**同一个**入口。
  const fmtMB = (n) => Math.round((Number(n) || 0) / 1048576) + ' MB';
  function paintTtsTestLabel(st) {
    $('btn-tts-test').textContent = st && st.device && st.bridge && !st.ready
      ? t('tts_test_dl', '下载并试听（{size}）').replace('{size}', fmtMB(st.size))
      : t('tts_test', '试听一句');
  }
  async function paintTtsPack(engineId) {
    const row = $('tts-offline-row'); if (!row) return;
    const e = settingsModel.engineById(engineId);
    const dev = !!(e && e.type === 'device-speech');
    row.hidden = !detailRef.current || !dev;
    if (!dev) { paintTtsTestLabel(null); return; }
    if (ttsPackBusy.current) return;   // 下载中由 downloadTtsPack 自己画进度
    const st = await LearnTTS.deviceStatus(engineId);   // 下拉刚换、还没保存时 LearnTTS 的 cfg 还是旧的 ⇒ 指定引擎
    if ($('tts-engine').value !== engineId || ttsPackBusy.current) return;
    const state = $('tts-offline-state'), dl = $('tts-offline-dl'), prog = $('tts-offline-progress');
    prog.hidden = true;
    const langs = (st.models || []).map((m) => m.lang).join(' · ');
    if (!st.bridge) {
      state.textContent = t('tts_pack_no_bridge', '设备内置朗读只在 App 里可用');
      dl.hidden = true;
    } else if (st.ready) {
      state.textContent = t('tts_pack_installed', '离线模型已安装 · {langs}').replace('{langs}', (st.langs.length ? st.langs : (st.models || []).map((m) => m.lang)).join(' · '));
      dl.hidden = true;
    } else if (st.reason === 'assets') {
      state.textContent = t('tts_pack_missing', '离线模型未下载 · {langs} · {size}').replace('{langs}', langs).replace('{size}', fmtMB(st.size))
        + '\n' + t('tts_pack_note', '首次朗读也会自动下载；只下模型文件，不上传任何内容。');
      dl.hidden = false; dl.textContent = t('tts_pack_dl', '下载');
    } else {
      state.textContent = '✗ ' + LearnTTS.reason('unsupported', t);
      dl.hidden = true;
    }
    paintTtsTestLabel(st);
  }
  async function downloadTtsPack() {
    if (ttsPackBusy.current) return;
    ttsPackBusy.current = true;
    const state = $('tts-offline-state'), dl = $('tts-offline-dl'), prog = $('tts-offline-progress');
    dl.disabled = true; prog.hidden = false; prog.value = 0;
    try {
      const r = await LearnTTS.ensureDeviceReady((m) => {
        // §9.6.1.1：换地址重试时进度归零、说一句；三处都失败才是下面的「下载失败」
        if (m.state === 'switching') { prog.value = 0; state.textContent = t('tts_pack_fallback', '地址不可用，换一个重试…'); return; }
        const pct = Math.round((Number(m.fraction) || 0) * 100);
        prog.value = pct;
        state.textContent = t('tts_pack_downloading', '正在下载离线模型 · {lang} · {pct}%').replace('{lang}', m.locale || '').replace('{pct}', String(pct));
      }, $('tts-engine').value);
      ttsPackBusy.current = false;
      if (!r.ok) {
        prog.hidden = true;
        state.textContent = t('tts_pack_failed', '离线模型下载失败：{why} —— 多半是网络问题，稍后重试').replace('{why}', r.why || r.reason || '');
        dl.hidden = false; dl.textContent = t('tts_pack_retry', '重试');
        return;
      }
      await paintTtsPack($('tts-engine').value);
    } finally { ttsPackBusy.current = false; dl.disabled = false; }
  }

  // ── 识别语言包行（对话 · 实时字幕；§9.1.1 镜像 §9.6 的 downloading 态）──────
  // 语言包由**系统**下载（不是我们的文件服务器），换语言时系统也会自动下 —— 这一行只是
  // 让「在不在」在开始听之前就看得见，并给一个手动的「下载」。
  function listenLocales() {
    const L = ListenCore.toLocale;
    const a = L($('listen-my-lang').value), b = L($('listen-other-lang').value);
    return a === b ? [a] : [a, b];
  }
  async function paintListenPack() {
    const row = $('listen-pack-row'); if (!row) return;
    const bridge = typeof NativeSpeech !== 'undefined' && NativeSpeech.available();
    row.hidden = !bridge;
    if (!bridge || listenPackBusy.current) return;
    const locales = listenLocales();
    const r = await NativeSpeech.probe(locales);
    if (listenPackBusy.current) return;
    const state = $('listen-pack-state'), dl = $('listen-pack-dl'), prog = $('listen-pack-progress');
    prog.hidden = true;
    // 旧系统态整块换成一句（interaction-spec「设置页信息架构」②）：本机识别器不可用时，
    // 这块里的开关与语言下拉都没有意义，只留标题 + 这一句；依赖行也收起，免得同一句写两遍。
    $('g-listen').classList.toggle('na', !r.ok);
    if (!r.ok) {
      state.textContent = r.reason === 'locale' ? t('listen_need_locale', '本机识别器不支持这门语言 —— 换一种语言试试') : t('listen_need_os', '对话 · 实时字幕需要 iOS 26 / macOS 26');
      dl.hidden = true; return;
    }
    if (r.assets === 'installed') {
      state.textContent = t('listen_pack_ready', '识别语言包已就绪 · {langs}').replace('{langs}', locales.join(' · '));
      dl.hidden = true;
    } else {
      state.textContent = t('listen_pack_missing', '识别语言包未下载 · {langs} · 由系统下载；开始听时也会自动下').replace('{langs}', locales.join(' · '));
      dl.hidden = false; dl.textContent = t('listen_pack_dl', '下载');
    }
  }
  async function downloadListenPack() {
    if (listenPackBusy.current) return;
    listenPackBusy.current = true;
    const state = $('listen-pack-state'), dl = $('listen-pack-dl'), prog = $('listen-pack-progress');
    dl.disabled = true; prog.hidden = false; prog.value = 0;
    try {
      await NativeSpeech.ensureAssets('stt', listenLocales(), (m) => {
        const pct = Math.round((Number(m.fraction) || 0) * 100);
        prog.value = pct;
        state.textContent = t('listen_pack_downloading', '正在下载识别语言包 · {lang} · {pct}%').replace('{lang}', m.locale || '').replace('{pct}', String(pct));
      });
      listenPackBusy.current = false;
      await paintListenPack();
    } catch (e) {
      listenPackBusy.current = false;
      prog.hidden = true;
      state.textContent = t('listen_pack_failed', '识别语言包下载失败：{why} —— 多半是网络问题，稍后重试').replace('{why}', (e && e.reason) || '');
      dl.hidden = false; dl.textContent = t('tts_pack_retry', '重试');
    } finally { listenPackBusy.current = false; dl.disabled = false; }
  }

  // Voice list is engine-aware, same three cases as the extension options page:
  // browser ⇒ the system's voices (async — the classic getVoices trap
  // LearnTTS.loadVoices exists for); a registry voice list ⇒ those; neither
  // (self-hosted, free-form voices) ⇒ just the automatic option. The '' option
  // means "match by the card's language" — which for an 'und' card (every card
  // captured on Safari, where no detector exists) means NO voice, so the note
  // below tells the user this picker is how those cards get a voice at all.
  async function paintVoices(selected) {
    const sel = $('tts-voice');
    const e = settingsModel.engineById($('tts-engine').value);
    sel.textContent = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = t('app_set_tts_voice_auto', '自动（按卡片语言）');
    sel.append(auto);
    if (e && e.type === 'browser') {
      for (const v of await LearnTTS.loadVoices(1500)) {
        const o = document.createElement('option');
        o.value = v.voiceURI;
        o.textContent = v.name + ' (' + v.lang + ')';
        sel.append(o);
      }
    } else if (e && e.voices) {
      for (const v of e.voices) {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.append(o);
      }
    }
    sel.value = [...sel.options].some((o) => o.value === selected) ? selected : '';
  }

  // ─── 来源治理 (§4.1/§7.4/§8.9) ─────────────────────────────────────────
  // 规则写入在 settings-model.writeRules（写完按后端开关强制同步一次）；
  // 这里只管把 SourcesView 摆出来，动作回调写完重画自己。
  async function paintGovernance(say) {
    const cur = await settingsModel.get(['learnRules']);
    const rules = cur.learnRules || null;
    const langsBox = $('app-langs');
    const srcBox = $('app-sources');
    if (!langsBox || !srcBox) return;

    SourcesView.renderLangChips(langsBox, {
      registry: Registry.langs() || [],
      langs: rules && rules.langs,
      t,
      onChange: async (langs) => {
        await settingsModel.writeRules(() => ({ langs }));
        paintGovernance(say);
      },
    });

    const [items, sources] = await Promise.all([LearnStore.allItems(), LearnStore.allSources()]);
    SourcesView.render(srcBox, {
      items, sources, rules, t,
      onDelete: async ({ host, itemIds, sourceIds }) => {
        if (!itemIds.length) { say(t('learn_delete_none', '这个来源已没有可删的卡')); return; }
        if (!(await LearnDialog.confirm(t('learn_delete_confirm', '删除 {host} 的 {n} 张卡？会同步到所有设备，不可恢复。')
          .replace('{host}', host).replace('{n}', String(itemIds.length)), { danger: true }))) return;
        const n = await LearnStore.deleteItems(itemIds, Date.now()).catch(() => 0);
        await LearnStore.deleteSourcesIfOrphan(sourceIds).catch(() => {});
        say(t('learn_delete_done', '已删除 {n} 张卡').replace('{n}', String(n)));
        if (Registry.backend() && Registry.backend().enabled) {
          LearnSync.autoSync(Date.now(), { force: true }).catch(() => {});
        }
        paintGovernance(say);
      },
      onBlock: async (p) => {
        await settingsModel.writeRules((r) => ({
          block: (r.block || []).indexOf(p) >= 0 ? r.block : (r.block || []).concat([p]),
        }));
        paintGovernance(say);
      },
      onUnblock: async (p) => {
        await settingsModel.writeRules((r) => ({ block: (r.block || []).filter((x) => x !== p) }));
        paintGovernance(say);
      },
      onAddRule: async (p) => {
        await settingsModel.writeRules((r) => ({
          block: (r.block || []).indexOf(p) >= 0 ? r.block : (r.block || []).concat([p]),
        }));
        paintGovernance(say);
      },
      onInvalidRule: () => say(t('learn_block_invalid', '规则格式不对'), true),
    });
  }

  // §9.4 — 同一条规则，同一个组件。
  function paintSttFields(engineId) {
    const e = (Registry.sttEngines() || []).find((x) => x.id === engineId) || null;
    applyFields(EngineFields.visibility(e), 'stt', 'stt');
  }

  // 同一条规则，同一个组件。⚠️ 这一处此前是 `hidden = !p` —— **只要选了引擎就露出
  // Key 框，完全不看引擎要不要 Key**，而扩展那边看。不需要 Key 的引擎在 App 上多一个
  // 空 Key 框，是这次报障里最直观的那一处。
  function paintNotesFields(providerId) {
    const p = LearnNotes.chatEngines().find((e) => e.id === providerId) || null;
    applyFields(EngineFields.visibility(p), 'notes', 'notes');
  }

  // ── 「快速 | 详细」两档 ────────────────────────────────────────────────────
  //
  // 与扩展设置页同一套类名契约，不发明第二套。三条照抄的实现约束：
  //   · **只切 hidden，永不 remove()** —— 这一页按字面量读控件、零 null 保护。
  //   · 模式**单独存**一个 key，不进键表 —— 它是 UI 状态不是配置，混进去等于让
  //     整体式的读写去管一个跟配置无关的东西。
  //   · 这个 flavor 没有可一键的平台时不留空壳（quickAvail）——「只藏不给路
  //     是退化，不是简化」。
  // 让三档引擎的显隐重新说一次话。只读 DOM 当前选中的引擎，不碰存储。
  function repaintEngineFields() {
    try { paintTtsFields($('tts-engine').value); } catch (_) {}
    try { paintSttFields($('stt-engine').value); } catch (_) {}
    try { paintNotesFields($('notes-provider').value); } catch (_) {}
  }

  // 增强取词那一行的三种说明：pending（问过系统了，允许后要重开才生效）/ denied（重开后仍没有权限，开关已弹回）/ 无。
  async function paintEnhanced() {
    if (!$('quick-enhanced-row') || typeof AppQuickHost === 'undefined') return;
    $('quick-enhanced-row').hidden = !AppQuickHost.supportsEnhanced();
    if ($('quick-enhanced-row').hidden) return;
    const s = await settingsModel.get(['quickEnhanced', 'quickEnhancedNote']);
    const live = s.quickEnhanced === true && AppQuickHost.hasPostEvent();
    $('quick-enhanced').checked = live;
    const note = live ? '' : (s.quickEnhancedNote || '');
    // {app}：系统那张列表里显示的是**包名**，不是界面上的「大肚猴翻译」，两个 flavor 还不一样（真机 2026-09-19：中文用户
    // 照着「允许大肚猴翻译」去找，列表里只有一行英文名）。名字由原生报（quick-caps.appName），文案里不写死。
    const appName = String(((AppQuickHost.caps() || {}).appName) || 'BelliedMonkey Translator');
    const text = note === 'pending' ? t('quick_enh_pending', '请在系统弹出的窗口里点「打开系统设置」，在列表里找到「{app}」并打开它的开关。打开之后要重新打开 App 才生效。').replace('{app}', appName)
      : note === 'denied' ? t('quick_enh_denied', '系统没有给权限，增强取词没有打开。先按 ⌘C 再按快捷键照常能用。') : '';
    $('quick-enhanced-state').textContent = text;
    $('quick-enhanced-state').hidden = !text;
    $('quick-enhanced-actions').hidden = !text;
    $('quick-enhanced-relaunch').hidden = note !== 'pending';
  }

  // ⚠️ **两套机制在写同一个 `hidden`，必须有明确的先后。**
  //
  // `.adv-only` 管的是「这一档要不要露」，`applyFields` 管的是「这个引擎需不需要
  // 这个框」。三个引擎字段行**同时属于两者**。2026-09-04 在 iPhone 模拟器上实测到
  // 后果：详细档下语音引擎明明是「未配置（不朗读）」，Key 与端点地址却照样显示 ——
  // 因为档位切换跑在 paintTtsFields 之后，把逐引擎的判断整个冲掉了。
  //
  // 所以放开 .adv-only 之后**必须再让逐引擎的判断说一次话**。顺序反过来会同样错。
  // 这是设备矩阵抓到的 —— 三道自动化门禁都看不见它（它们只在详细档下逐个切引擎，
  // 而那时档位切换早已跑完，两者恰好一致）。
  // React 之后的分工：外层 sgroup 的 hidden 是派生布尔（JSX 里 !detail）；内层的
  // 逐引擎行由这里写（档位布尔并进 applyFields / paintTtsPack，见那边注释）。
  // 无论开还是关都要 repaint：关掉详细档时，逐引擎行必须被写回 hidden，
  // 不能留着上一档的旧值。
  async function setDetailFn(on, persist) {
    detailRef.current = !!on;
    setDetailState(!!on);
    repaintEngineFields();
    // 快速档只说「由一键配置提供」，详细档逐个列 —— 档位一换要重画：setDetailState
    // 已经触发重渲染，DepLineView 的 quick 派生自 detail，不需要第二笔。
    if (persist !== false) {
      // 挂到 ref 上：paintNow 尾部的 setupQuickCard 要先等在途的这次写入落地再读盘，
      // 否则读到旧值会把用户刚点的档位静默盖回去（verify-listen S3 偶发红的就是它：
      // gear 后立即点 mode-detail，paintNow 还在异步途中，尾部读到快速档）。
      detailWriteRef.current = settingsModel.writeStoredDetail(!!on);
      await detailWriteRef.current;
    }
  }

  // ── 功能块首行的「依赖」行（interaction-spec「设置页信息架构」②）──────────
  // 判据与标签都来自既有的地方（src/shared/dep-line.js 只是把它们摆到功能块首行）；
  // 实时转写不是引擎，它的结论来自 NativeSpeech.probe。「去配置 →」切到详细档并落到那个槽的下拉上；
  // 翻译在 App 里没有逐项控件，落到快速档的一键卡。
  //
  // PR7a 起这一行是 DepLineView 组件（JSX 里挂在四个功能块首），不再命令式重画：
  // 快照是 depsSettings state（paintNow 与总线 effect 各自送新），档位/引擎一换
  // setDetailState 或 store 订阅触发重渲染，组件自己重算 quick / live。
  function goDeps(slot) {
    const id = slot === 'notes' ? 'notes-provider' : slot === 'stt' ? 'stt-engine' : slot === 'tts' ? 'tts-engine' : 'quick-setup-card';
    setDetailFn(slot !== 'chat');
    const el = $(id); if (!el) return;
    try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
    if (slot !== 'chat') { try { el.focus({ preventScroll: true }); } catch (_) {} }
  }
  // 四个功能块共用的组件入参（JSX 里 <DepLineView {...depProps} slots={…} />）。
  const depProps = {
    settings: depsSettings,
    quick: !!depsSettings && !detail && !!QuickSetup.represents(depsSettings),
    live: (typeof NativeSpeech !== 'undefined' && NativeSpeech.available()) ? NativeSpeech.probeResult() : { ok: false, reason: 'os' },
    onGo: goDeps,
    t,
  };

  // 组件只返回 patch，写盘归本页 —— 与扩展设置页同一条分工。写完重画：一键配好的
  // 三组必须在「详细」里立刻看得见，否则用户下一次改任何一个字段都会用旧 DOM 覆盖回去。
  async function applyQuickSetup(plan, session, say) {
    if (plan && plan.writes && Object.keys(plan.writes).length) await settingsModel.set(plan.writes);
    await settingsModel.markEngineChosen(plan);
    await paintNow();
    try { await paintGrant(session); } catch (_) {}   // 同扩展设置页：一键卡写完后重画额度卡（F07）
    await settingsModel.trackEngineSet();
    // 回执**不在这里显示**。这一刻自检还没跑（onApply 在自检之前调用），此时说任何
    // 结论都是猜的 —— 2026-09-20 真机实测：标题「可以用了」与一个 ✗ 并排挂了几十秒。
    // 回执改由 onResults 触发（见 renderQuickSetup 的 onResults）。
  }

  // ── 免费额度（§8.10）─────────────────────────────────────────────────
  //
  // 与扩展设置页同一套：卡面来自 LearnGrant.cardFor，动作由这一页接。
  // App 里开外链必须走原生桥（WKWebView 的 window.open 是哑的），所以 openExternal
  // 由 shell-model 经 bind() 传进来 —— 这一页自己 postMessage 的话，宿主判断会散成两份。
  async function paintGrant(session) {
    const box = $('grant-box');
    const card = $('grant-card');
    if (!box) return;
    let cur = {};
    try { cur = await settingsModel.get(settingsModel.KEYS.concat(['grant', 'grantTail', 'grantBalance'])); } catch (_) {}
    renderGrant(box, {
      t,
      status: LearnGrant.status(cur, { signedIn: !!session, unavailable: grantUnavailable.current }),
      flavor: Registry.flavor(),       // 中国版：官方免费额度那张卡（G5）
      keyUrl: ((Registry.providers() || []).find((x) => x.keyUrl) || {}).keyUrl || '',
      balance: cur.grantBalance || null,
      busy: grantBusy.current,
      onAction: (id) => grantAction(id, session),
    });
    // grant-card 的 hidden 是 React 派生的（grantVisible）；renderGrant 刚在 box 上
    // 写完 box.hidden —— flushSync 让卡片同一帧跟上，不等下一次渲染。
    // 安全性：paintGrant 只从 paintNow / grantAction 的 async 链调用，从不在 React
    // 渲染生命周期里跑（渲染中不能 flushSync）。
    flushSync(() => { setGrantVisible(!box.hidden); });
  }

  async function grantAction(id, session) {
    const hooks = settingsModel.hooks();
    if (id === 'signin') { if (hooks.onSignIn) hooks.onSignIn(); return; }
    if (id === 'byo') {
      const p = (Registry.providers() || []).find((x) => x.keyUrl);
      if (p && p.keyUrl && hooks.openExternal) hooks.openExternal(p.keyUrl);
      return;
    }
    if (id === 'community') {
      if (hooks.openExternal && typeof MTFeedback !== 'undefined') hooks.openExternal(MTFeedback.discussUrl());
      return;
    }
    if (id !== 'claim' && id !== 'restore') return;
    // 页内确认框，不用 window.confirm —— App 的宿主没实现确认回调，它恒为 false。
    // （import 进来的实现不会缺席，旧 typeof 守卫的静默跳过路径随之退役。）
    if (id === 'restore') {
      const ok = await LearnDialog.confirm(t('grant_restore_confirm',
        '改回免费额度会替换掉你现在填的 key。要继续吗？'));
      if (!ok) return;
    }
    grantBusy.current = true; await paintGrant(session);
    try {
      await settingsModel.claimAndApply({ overwrite: id === 'restore', say: hooks.say });
    } catch (e) {
      if (e && e.code === 'grant_unavailable') grantUnavailable.current = true;
      if (hooks.say) hooks.say(String((e && e.message) || e));
    } finally {
      grantBusy.current = false;
      await paintGrant(session);
      await paintNow();
    }
  }

  async function setupQuickCard(session, say) {
    if (!$('quick-setup')) return;
    // **已经挂上的卡不重画。** paintNow 在每次写盘之后都会跑一遍（一键配好 → 写盘 → 重画
    // 详细档的三组字段），而 renderQuickSetup 是清空重建 —— 于是用户刚粘进去的 key、
    // 正在跑的「测试中…」三行，在按下按钮的那一瞬间一起消失，看起来像密码被吃掉了
    // （2026-09-06 用户报，1.7.14 起带入，1.7.16 已上架）。读设置本来就是现读的
    // （readSettings），卡不需要靠重建来保持新鲜。
    if ($('quick-setup').children.length) {
      let on = false;
      try { await detailWriteRef.current; } catch (_) {}   // 先等在途的档位写入，别拿旧值盖掉用户刚点的档
      try { on = await settingsModel.readStoredDetail(); } catch (_) {}
      // 只切档、不落盘（persist:false）：这里读出来的就是盘上的值，写回是多余的一笔。
      await setDetailFn(on, false);
      return;
    }
    // 回显：已经配过的 key 要在卡上看得见（QuickSetup.prefill：翻译那一路优先，退到朗读/转写）。
    // 2026-09-07 用户报「详细里有、快速里空」—— App 这里原来根本没传 prefill。
    let pre = null;
    try { pre = QuickSetup.prefill(await settingsModel.get(settingsModel.KEYS)); } catch (_) { pre = null; }
    renderQuickSetup($('quick-setup'), {
      t,
      prefill: pre,
      // 现读而不是快照：拿旧快照判「配没配过」会覆盖用户刚在「详细」里输入的 key。
      readSettings: () => settingsModel.get(settingsModel.KEYS),
      replaceKeyTail: () => new Promise((res) => chrome.storage.local.get(['grantTail'], (v) => res((v && v.grantTail) || ''))),
      targetLang: '',
      onApply: (plan) => applyQuickSetup(plan, session, say),
      // 自检跑完之后才给回执，并且**用卡自己的结果**，不再测第二遍。
      onResults: (plan, results) => {
        try { if (typeof AppSetupDone !== 'undefined') AppSetupDone.show(plan && plan.tests, { results }); } catch (_) {}
      },
      // App 配完就没有下一步了，也没有网页可翻 —— 「现在翻一页看看」属于浏览器那一侧。
      showTry: false,
    });
    if (!$('quick-setup').children.length) {
      // 没有可一键的平台。不留空壳，也不给一个其中一边可证为空的二选一。
      // 旧 applyDetailMode(true) 的等价写法 —— 只切 UI，不落盘。
      setQuickAvail(false);
      detailRef.current = true;
      setDetailState(true);
      repaintEngineFields();
      return;
    }
    let on = false;
    try { await detailWriteRef.current; } catch (_) {}   // 同上：先等在途的档位写入
    try { on = await settingsModel.readStoredDetail(); } catch (_) {}
    await setDetailFn(on, false);
  }

  // §9.2 in the app: write the SAME keys review.js reads, and reconfigure
  // LearnNotes immediately — review.js only reads settings once at bundle load,
  // so without this the 解析 entry would stay closed until the next launch and
  // a freshly pasted key would look like a broken feature. The gate itself is
  // re-asked per card (`capable()`), so the next card picks this up live.
  async function saveNotesCfg() {
    const cfgNow = {
      provider: $('notes-provider').value,
      apiKey: $('notes-api-key').value.trim(),
      apiBaseUrl: $('notes-base-url').value.trim(),
      apiModel: $('notes-model').value.trim(),
    };
    await settingsModel.set(cfgNow);
    LearnNotes.configure({
      provider: cfgNow.provider, apiKey: cfgNow.apiKey,
      baseUrl: cfgNow.apiBaseUrl, model: cfgNow.apiModel,
    });
  }
  // 换引擎时清空非空的接口地址，并说出来（interaction-spec 「接口地址字段」）。
  // 地址不能跨端点携带 —— 与下面 tts-engine 重置 voice 是同一条理由。对有默认端点的
  // 条目，清空恰好回到一个能工作的配置。返回是否真的清了，好让调用方给出提示：
  // 静默丢掉用户敲过的东西，正是这条规则要避免的那种失败。
  function clearEndpointOnEngineSwitch(inputId) {
    const el = $(inputId);
    if (!el || !el.value.trim()) return false;
    el.value = '';
    return true;
  }

  // §9.4 in the app: write the SAME keys review.js reads and reconfigure
  // LearnSpeech immediately — capable() is re-asked per card, so the next card
  // picks a freshly configured engine up live (same reasoning as the notes key).
  async function saveSttCfg() {
    const c = {
      sttEngine: $('stt-engine').value,
      sttApiKey: $('stt-api-key').value.trim(),
      sttBaseUrl: $('stt-base-url').value.trim(),
      sttModel: $('stt-model').value.trim(),
    };
    await settingsModel.set(c);
    if (typeof LearnSpeech !== 'undefined') {
      LearnSpeech.configure({
        engineId: c.sttEngine, apiKey: c.sttApiKey,
        baseUrl: c.sttBaseUrl, model: c.sttModel,
      });
    }
  }

  // 地址失焦即判（2026-09-21，#385）：与扩展的 EngineFields 同一份判据、同一份文案
  // （都问 EngineTest.shapeHint）。提示写进该槽的**自检结果行** —— 那正是用户看
  // 「这一项通没通」的地方。用 dataset 记一笔是谁写的，免得把上一次真正的自检结果擦掉。
  function wireShapeHint(inputId, noteId) {
    const inp = $(inputId), note = $(noteId);
    if (!inp || !note) return;
    const paint = () => {
      const hint = (typeof EngineTest !== 'undefined' && typeof EngineTest.shapeHint === 'function')
        ? EngineTest.shapeHint(inp.value, t) : '';
      if (hint) { note.textContent = '✗ ' + hint; note.dataset.shapeHint = '1'; }
      else if (note.dataset.shapeHint) { note.textContent = ''; delete note.dataset.shapeHint; }
    };
    inp.addEventListener('blur', paint);
    // 已经在说话时才跟着输入重判（同 engine-fields.js 的那条理由）。
    inp.addEventListener('input', () => { if (note.dataset.shapeHint) paint(); });
    paint();
  }

  // ── 引擎自检 ×3（与扩展 options 同一套语义：走功能真正用的传输、
  // 在途禁用、失败具名）。App 端的 key 是设备本地凭证（§7.2），
  // 能当场自检尤其重要——这里配错了，用户在复习页只会看到功能「不出现」。
  // 失败原因只有一份表：learn/engine-test.js 的 EngineTest.reason / format（四个页面共用）。
  // 2026-09-17 之前这里自留了一份旧表，缺 device_no_file 等新码，于是 App 把原始代码
  // 「✗ device_no_file」直接显示给用户 —— 正是 engine-test.js 文件头说的那种「同一个错误
  // 在两个页面说两种话」。删掉它，不再维护第二份。
  // 请求地址那一行（错误最常见的是地址填错，404 与 CORS 拒绝不带地址时读起来一样）
  // 也由 EngineTest.format 一并给出 —— 同一份，不在这里再拼一次。
  const runTest = (btnId, noteId, fn) => async () => {
    const btn = $(btnId), note = $(noteId);
    btn.disabled = true;
    note.textContent = t('engine_test_running', '测试中…');
    try {
      const r = await fn();
      note.textContent = EngineTest.format(r, null, t);
    } catch (e) {
      console.error('[engine-test]', (e && e.url) || '', e);
      note.textContent = EngineTest.format(null, e, t);
    } finally { btn.disabled = false; }
  };

  // 整页重画（旧 paint(session, say)）。session 现读 settingsModel.currentSession()
  // （设置页开着时登录态变了要用新的，见 model 那边注释）；say 动态取宿主钩子。
  async function paintNow() {
    const session = settingsModel.currentSession();
    const hooks = settingsModel.hooks();
    const say = hooks.say || (() => {});
    const cur = await settingsModel.get(settingsModel.KEYS);
    $('ui-lang').value = cur.uiLang || 'auto';
    uiLangNow.current = cur.uiLang || 'auto';
    $('target-lang').value = cur.targetLang || '';
    updateFollowLabel();
    $('daily').value = cur.learnDailyNew != null ? cur.learnDailyNew : 15;
    $('tts-mode').value = cur.ttsMode || 'off';
    // 不认识的 id（换 flavor / 降级安装 / 厂商下架）落到**哨兵**，不是第一个引擎 ——
    // 落到第一个引擎等于替用户做了一个他没做过的选择。
    $('tts-engine').value = (settingsModel.engineById(cur.ttsEngine) || {}).id || '';
    $('tts-api-key').value = cur.ttsApiKey || '';
    $('tts-base-url').value = cur.ttsBaseUrl || '';
    $('tts-model').value = cur.ttsModel || '';
    paintTtsFields($('tts-engine').value);
    await paintVoices(cur.ttsVoice || '');
    $('tts-auto').checked = !!cur.ttsAutoPlay;
    $('tts-rate').value = cur.ttsRate != null ? cur.ttsRate : 1;
    $('tts-rate-out').textContent = Number($('tts-rate').value).toFixed(1) + '×';
    $('notes-provider').value = cur.provider || '';
    $('notes-api-key').value = cur.apiKey || '';
    $('notes-base-url').value = cur.apiBaseUrl || '';
    $('notes-model').value = cur.apiModel || '';
    paintNotesFields(cur.provider || '');
    // `!== false`：默认开，且不需要往存储里播种默认值（见 src/app/driving-model.js 同款读法）。
    $('drive-play-notes').checked = cur.drivePlayNotes !== false;
    $('listen-capture').checked = cur.listenCapture !== false;
    if ($('subtitle-capture')) $('subtitle-capture').checked = cur.subtitleCapture !== false;
    // 「我的语言」没选过就跟着界面语言走 —— 只在读取时回落，不往存储播种默认值，
    // 这样用户改界面语言时它会跟着变，直到他自己选过一次。
    // 语言下拉在每次进设置页时重填：本机识别器支持的语种清单是探过桥才有的
    fillLangs($('listen-my-lang'));
    fillLangs($('listen-other-lang'));
    fillLangs($('subtitle-video-lang'));
    $('listen-my-lang').value = settingsModel.myLangOf(cur);
    $('listen-other-lang').value = ListenCore.baseCode(cur.listenOtherLang) || 'en';
    $('subtitle-video-lang').value = ListenCore.baseCode(cur.subtitleVideoLang) || 'en';
    paintListenPack();
    setDepsSettings(Object.assign({}, cur));
    $('listen-autospeak').checked = cur.listenAutoSpeak !== false;
    $('doc-capture').checked = cur.docCapture !== false;
    if ($('quick-enabled')) $('quick-enabled').checked = cur.quickEnabled !== false;
    $('doc-prefetch').checked = !!cur.docPrefetch;
    $('drive-preload-days').value = String(Number(cur.drivePreloadDays) > 0 ? Math.floor(Number(cur.drivePreloadDays)) : 0);
    resetPreload();
    refreshAudioCache();
    $('stt-engine').value = (Registry.sttEngines() || []).some((e) => e.id === cur.sttEngine)
      ? cur.sttEngine : '';
    $('stt-api-key').value = cur.sttApiKey || '';
    $('stt-base-url').value = cur.sttBaseUrl || '';
    $('stt-model').value = cur.sttModel || '';
    paintSttFields($('stt-engine').value);
    $('account-who').textContent = LearnAuth.displayName(session);

    const [stats, reviews] = await Promise.all([LearnStore.stats(), LearnStore.allReviews()]);
    $('settings-counts').textContent =
      stats.total + ' ' + t('app_unit_cards', '张卡') + ' · '
      + reviews.length + ' ' + t('app_unit_reviews', '条复习记录')
      + ' · ' + (stats.by.known || 0) + ' ' + t('app_unit_known', '已掌握');

    await paintGovernance(say);
    await paintGrant(session);          // 额度卡排在一键卡之前（界面上也在它上面）
    await setupQuickCard(session, say);
  }

  // ── 接线（旧 wire() 的全部 addEventListener，一次性）──────────────────────
  useEffect(() => {
    // 先把三张引擎下拉、语言下拉与「跟随」文案填上 —— paintNow 之前下拉必须已有
    // 选项，语言下拉的语种清单也要在探桥结果到来之前先按注册表铺一遍。
    populateStatic();

    const say = (...a) => { const h = settingsModel.hooks(); if (h.say) h.say(...a); };

    $('mode-quick').addEventListener('click', () => setDetailFn(false));
    $('mode-detail').addEventListener('click', () => setDetailFn(true));
    $('app-adv-hint-go').addEventListener('click', () => { setDetailFn(false); try { $('quick-setup-card').scrollIntoView({ block: 'start' }); } catch (_) {} });
    $('subtitle-video-lang').addEventListener('change', () => { settingsModel.set({ subtitleVideoLang: $('subtitle-video-lang').value }); });

    // Persist on change, not behind a Save button. There is no multi-field state to
    // keep consistent here, and a Save button is one more thing to forget to press.
    $('daily').addEventListener('change', async () => {
      const n = Math.max(1, Math.min(200, parseInt($('daily').value, 10) || 15));
      $('daily').value = n;
      await settingsModel.set({ learnDailyNew: n });
    });
    // 界面语言：**改完立刻生效，不等下次启动**（interaction-spec「Switching applies live」）。
    // 三件事要一起做，漏一件都是「改了没反应」：
    //   1. PageText.setUiLang —— 之后每一次 t() 才走新 locale；静态标签由 useT 的
    //      重渲染换（旧版这里是手涂 paintStatic 的活）
    //   2. 重填下拉与「跟随」文案 —— 选项文字是 t() 出来的，不会自己变
    //   3. AppDriving.refreshEntry —— 播客模式入口按 uiLang 有没有语音做门控（§9.5），
    //      换了语言而不重算，入口会停在上一个语言的结论上
    $('ui-lang').addEventListener('change', async () => {
      const v = $('ui-lang').value || 'auto';
      await settingsModel.set({ uiLang: v });
      uiLangNow.current = v;
      try { PageText.setUiLang(v); } catch (_) {}
      populateStatic();
      try { document.documentElement.lang = PageText.effectiveLocale().replace('_', '-'); } catch (_) {}
      try { AppDriving.refreshEntry(); } catch (_) {}
    });
    // 空值 = 跟随界面语言：**删键**而不是存空串，存储里只有用户明说过的选择。
    $('target-lang').addEventListener('change', async () => {
      const v = $('target-lang').value;
      if (v) await settingsModel.set({ targetLang: v }); else await new Promise((r) => chrome.storage.local.remove(['targetLang'], r));
    });
    $('tts-mode').addEventListener('change', () => settingsModel.set({ ttsMode: $('tts-mode').value }));
    // Every speech knob reconfigures LearnTTS LIVE, not just at next launch —
    // same reasoning as the notes key (review.js reads settings once at bundle
    // load, and "pick an engine, tap ▶, silence" would read as broken).
    $('tts-engine').addEventListener('change', async () => {
      // interaction-spec 全局原则: paintVoices can stall up to 1.5s on voice
      // discovery — the select locks so a second change can't interleave.
      const sel = $('tts-engine');
      sel.disabled = true;
      try {
        const id = sel.value;
        // Voice names don't carry across engines (a voiceURI means nothing to a
        // speech endpoint, 'alloy' means nothing to the system) — reset it.
        await settingsModel.set({ ttsEngine: id, ttsVoice: '' });
        // 选了引擎而朗读模式还是「关」= 配好了却永远不出声的语音。一键配置早就是这条
        // 规则（quick-setup.js：ttsMode off → assist）；手动路径不做，配完 key ▶ 照样不出现。
        if (id && $('tts-mode').value === 'off') {
          $('tts-mode').value = 'assist';
          await settingsModel.set({ ttsMode: 'assist' });
        }
        paintTtsFields(id);
        await paintVoices('');
        settingsModel.liveTtsConfigure({
          engineId: $('tts-engine').value,
          apiKey: $('tts-api-key').value.trim(),
          baseUrl: $('tts-base-url').value.trim(),
          model: $('tts-model').value.trim(),
          voice: $('tts-voice').value,
        });
        // 换引擎会换掉整个音频缓存键（cacheKey 含 engineId/model/voice），所以已经
        // 算好的账单和缓存读数都过期了。
        resetPreload();
        await refreshAudioCache();
      } finally { sel.disabled = false; }
    });
    for (const id of ['tts-api-key', 'tts-base-url', 'tts-model']) {
      $(id).addEventListener('change', async () => {
        await settingsModel.set({
          ttsApiKey: $('tts-api-key').value.trim(),
          ttsBaseUrl: $('tts-base-url').value.trim(),
          ttsModel: $('tts-model').value.trim(),
        });
        settingsModel.liveTtsConfigure({
          engineId: $('tts-engine').value,
          apiKey: $('tts-api-key').value.trim(),
          baseUrl: $('tts-base-url').value.trim(),
          model: $('tts-model').value.trim(),
          voice: $('tts-voice').value,
        });
      });
    }
    wireShapeHint('tts-base-url', 'test-tts-note');
    $('tts-voice').addEventListener('change', async () => {
      await settingsModel.set({ ttsVoice: $('tts-voice').value });
      settingsModel.liveTtsConfigure({
        engineId: $('tts-engine').value,
        apiKey: $('tts-api-key').value.trim(),
        baseUrl: $('tts-base-url').value.trim(),
        model: $('tts-model').value.trim(),
        voice: $('tts-voice').value,
      });
    });
    $('tts-auto').addEventListener('change', () => settingsModel.set({ ttsAutoPlay: $('tts-auto').checked }));
    $('tts-rate').addEventListener('input', () => {
      $('tts-rate-out').textContent = Number($('tts-rate').value).toFixed(1) + '×';
    });
    $('tts-rate').addEventListener('change', async () => {
      const r = Number($('tts-rate').value);
      await settingsModel.set({ ttsRate: r });
      LearnTTS.configure(Object.assign({}, LearnTTS.config, { rate: r }));
    });
    // Voices can land AFTER the settings page painted (loadVoices' timeout path);
    // re-populate so the picker never sits empty on a machine full of voices.
    // Only meaningful for the browser engine — registry voice lists are static.
    LearnTTS.onVoicesChanged(() => {
      const e = settingsModel.engineById($('tts-engine').value);
      if (e && e.type === 'browser') settingsModel.get(['ttsVoice']).then((c) => paintVoices(c.ttsVoice || ''));
    });

    $('notes-provider').addEventListener('change', async () => {
      const cleared = clearEndpointOnEngineSwitch('notes-base-url');
      paintNotesFields($('notes-provider').value);
      await saveNotesCfg();
      if (cleared) say(t('toast_endpoint_cleared', '换引擎了，接口地址已清空'));
    });
    for (const id of ['notes-api-key', 'notes-base-url', 'notes-model']) {
      $(id).addEventListener('change', saveNotesCfg);
    }
    wireShapeHint('notes-base-url', 'test-notes-note');

    $('listen-capture').addEventListener('change', () => { settingsModel.set({ listenCapture: $('listen-capture').checked }); });
    if ($('subtitle-capture')) $('subtitle-capture').addEventListener('change', () => { settingsModel.set({ subtitleCapture: $('subtitle-capture').checked }); });
    $('listen-autospeak').addEventListener('change', () => { settingsModel.set({ listenAutoSpeak: $('listen-autospeak').checked }); });
    $('doc-capture').addEventListener('change', () => { settingsModel.set({ docCapture: $('doc-capture').checked }); });
    // 快速翻译：这一块只在原生回了 quick-caps 时显示（macOS）；AppQuickHost 订阅设置总线，开关一变菜单栏就跟着变。
    if ($('quick-enabled')) {
      $('quick-enabled').addEventListener('change', () => { settingsModel.set({ quickEnabled: $('quick-enabled').checked }); });
      if (typeof AppQuickHost !== 'undefined') AppQuickHost.onCaps((c) => { $('g-quick').hidden = !(c && c.resident); paintEnhanced(); });
      // 增强取词：开关显示为「开」当且仅当 用户想开 **且** 系统权限真的在。其余情形旁边那一行说明为什么。
      $('quick-enhanced').addEventListener('change', async () => {
        const want = $('quick-enhanced').checked;
        $('quick-enhanced').checked = await AppQuickHost.setEnhanced(want);
        paintEnhanced();
      });
      $('quick-enhanced-relaunch').addEventListener('click', () => AppQuickHost.relaunch());
      $('quick-enhanced-privacy').addEventListener('click', () => AppQuickHost.openPrivacy());
      try { chrome.storage.onChanged.addListener((ch) => { if (ch && (ch.quickEnhanced || ch.quickEnhancedNote)) paintEnhanced(); }); } catch (_) {}
      // M-7 的那几行（快捷键录制、存入复习库、登录时启动、屏幕录制状态、服务菜单直达）在 app/quick-settings.js。
      if (typeof AppQuickSettings !== 'undefined') AppQuickSettings.wire();
      if (typeof AppSysSettings !== 'undefined') AppSysSettings.wire();
    }
    $('doc-prefetch').addEventListener('change', () => { settingsModel.set({ docPrefetch: $('doc-prefetch').checked }); });
    for (const which of ['my', 'other']) {
      const el = $('listen-' + which + '-lang');
      el.addEventListener('change', () => {
        const cur = { myLang: $('listen-my-lang').value, otherLang: $('listen-other-lang').value };
        // 取变更**之前**的那一对：change 已经把 el 改了，所以把它换回旧值再算。
        const prev = which === 'my'
          ? { myLang: lastLangs.current.my, otherLang: cur.otherLang }
          : { myLang: cur.myLang, otherLang: lastLangs.current.other };
        const p = ListenCore.langPatch(which, el.value, prev);
        const swapped = p.swapped; delete p.swapped;
        settingsModel.set(p);
        if (p.listenMyLang !== undefined) $('listen-my-lang').value = ListenCore.baseCode(p.listenMyLang);
        if (p.listenOtherLang !== undefined) $('listen-other-lang').value = ListenCore.baseCode(p.listenOtherLang);
        lastLangs.current = { my: $('listen-my-lang').value, other: $('listen-other-lang').value };
        if (swapped) say(t('listen_lang_swapped', '两边不能是同一种语言 — 已对调'));
        paintListenPack();   // 换了语言，语言包在不在要重新说
      });
    }
    $('listen-pack-dl').addEventListener('click', downloadListenPack);
    $('tts-offline-dl').addEventListener('click', downloadTtsPack);
    lastLangs.current = { my: $('listen-my-lang').value, other: $('listen-other-lang').value };
    $('drive-play-notes').addEventListener('change', () => {
      settingsModel.set({ drivePlayNotes: $('drive-play-notes').checked });
      resetPreload();     // 开关变了，账单就过期了 —— 不能让它继续代表旧的计划
    });
    $('drive-preload-days').addEventListener('change', () => {
      settingsModel.set({ drivePreloadDays: Number($('drive-preload-days').value) || 0 });
      resetPreload();
    });

    // 第一下算账、第二下开跑、跑起来之后是停止键（§9.5 / §9.2 修订后的四个构成要件）。
    $('btn-drive-preload').addEventListener('click', async () => {
      const btn = $('btn-drive-preload');
      const note = $('drive-preload-note');

      if (preloadState.current === 'running') { preloadStop.current = true; btn.disabled = true; return; }

      if (preloadState.current === 'idle') {
        btn.disabled = true;
        note.textContent = t('drive_preload_pricing', '正在核对本机已有的内容…');
        let p;
        try {
          p = await AppDriving.preloadPlan(Number($('drive-preload-days').value) || 0);
        } catch (_) { p = null; }
        btn.disabled = false;
        if (!p || !p.ok) {
          note.textContent = t('settings_read_failed_short', '读不到已保存的设置，请稍后再试');
          return;
        }
        note.textContent = settingsModel.priceText(p);
        if (!p.cards.length) return;
        // 全都已经在本机了就不必再点第二下 —— 一个「确认花 0 次调用」的按钮是噪音。
        if (!p.audioMissing && !p.notesMissing && !p.trMissing) {
          note.textContent = settingsModel.priceText(p) + '\n' + t('drive_preload_ready', '这些内容已经全在本机，路上不需要联网。');
          return;
        }
        preloadPlanned.current = p;
        preloadState.current = 'pending';
        btn.textContent = t('drive_preload_confirm', '确认预载（约 {n} 次付费调用）')
          .replace('{n}', String(p.notesMissing + p.trMissing + (p.audioCacheable ? p.audioMissing : 0)));
        return;
      }

      // pending → running
      const p0 = preloadPlanned.current;
      if (!p0) { resetPreload(); return; }
      preloadState.current = 'running';
      preloadStop.current = false;
      btn.textContent = t('drive_preload_stop', '停止');
      // 状态是在 await 之前就翻的，所以同一下点击派发两次事件时，第二次落在 running
      // 分支上会把刚开跑的这一轮立刻停掉。上面的 markup 注释记着那个坑；这里再挡一道，
      // 因为「点两下」在真机上还有别的来路（双击、辅助功能的重复激活）。
      preloadPlanned.current = null;
      const planned = p0;
      const r = await AppDriving.preloadRun(planned, {
        shouldStop: () => preloadStop.current,
        onProgress: ({ done, total }) => {
          note.textContent = t('drive_preload_progress', '预载中 {done}/{total}…')
            .replace('{done}', String(done)).replace('{total}', String(total));
        },
      });
      resetPreload();
      note.textContent = settingsModel.tallyText(r);
      await refreshAudioCache();
    });

    $('btn-drive-clear-audio').addEventListener('click', async () => {
      const btn = $('btn-drive-clear-audio');
      btn.disabled = true;
      try { await LearnStore.clearAudio(); } catch (_) {}
      btn.disabled = false;
      resetPreload();
      await refreshAudioCache();
      say(t('toast_cache_cleared', '缓存已清除'));
    });
    $('stt-engine').addEventListener('change', async () => {
      const cleared = clearEndpointOnEngineSwitch('stt-base-url');
      paintSttFields($('stt-engine').value);
      await saveSttCfg();
      if (cleared) say(t('toast_endpoint_cleared', '换引擎了，接口地址已清空'));
    });
    for (const id of ['stt-api-key', 'stt-base-url', 'stt-model']) {
      $(id).addEventListener('change', saveSttCfg);
    }
    wireShapeHint('stt-base-url', 'test-stt-note');

    // 走 EngineTest 而不是直接调底层（2026-09-21，#385）。此前这两支各自 `LearnNotes.test()`
    // / `LearnSpeech.test()`，绕开了两样东西：① 发请求前的地址形状检查 ② 那一层遥测包装。
    // 后果在线上量到了 —— `engine_test` 至今**没有一条 host='app' 的行**，而 App 是装机
    // 最多的面。注意 SEAMS 门禁在这件事上是绿的：它只验「这个文件里有发送点」，验不了
    // 「用户真走的那条路会不会经过它」（telemetry-design §3.4 那条教训的下一种形状）。
    //
    // 传进去的键名是**存储键**：App 的 notes 输入框写的是翻译引擎那组键
    // （provider/apiKey/apiBaseUrl/apiModel，见 saveNotesCfg），不带 notes 那组独立键 ⇒
    // LearnNotes.resolveConfig 解析出来与 saveNotesCfg 配的是同一份 cfg。
    $('btn-test-notes').addEventListener('click', runTest('btn-test-notes', 'test-notes-note', async () => {
      await saveNotesCfg();
      return EngineTest.notes({
        provider: $('notes-provider').value,
        apiKey: $('notes-api-key').value.trim(),
        apiBaseUrl: $('notes-base-url').value.trim(),
        apiModel: $('notes-model').value.trim(),
      });
    }));
    $('btn-test-stt').addEventListener('click', runTest('btn-test-stt', 'test-stt-note', async () => {
      await saveSttCfg();
      // 2026-09-17 之前这里对「设备内置转写」分流到 EngineTest.device；那条注册表条目已删
      // （实时转写固定为设备内置，不是可选引擎），这一档只剩说 HTTP 的端点。
      // `LearnSpeech` 没加载时 EngineTest.stt 自己抛 no_engine，不必在这里再判一次。
      return EngineTest.stt({
        engineId: $('stt-engine').value,
        apiKey: $('stt-api-key').value.trim(),
        baseUrl: $('stt-base-url').value.trim(),
        model: $('stt-model').value.trim(),
      });
    }));
    // 语音是「听得见才算通」，所以试听而不是探活——与扩展 options 的试听同义。
    $('btn-tts-test').addEventListener('click', async () => {
      const btn = $('btn-tts-test'), note = $('test-tts-note');
      btn.disabled = true;
      // 试听是**播放**不是探活，所以不走 EngineTest 的四条传输；但地址写错离线就能判，
      // 补这一句，语义不变（2026-09-21，#385 —— 与扩展 options 的试听同一处改动）。
      const hint = EngineTest.shapeHint($('tts-base-url').value, t);
      if (hint) { note.textContent = '✗ ' + hint; btn.disabled = false; return; }
      note.textContent = t('tts_testing', '正在合成…');
      try {
        settingsModel.liveTtsConfigure({
          engineId: $('tts-engine').value,
          apiKey: $('tts-api-key').value.trim(),
          baseUrl: $('tts-base-url').value.trim(),
          model: $('tts-model').value.trim(),
          voice: $('tts-voice').value,
        });
        // 设备内置朗读首次要下载模型：进度画在结果行上（四处首播同一个入口，§9.1.1），完了重画离线模型行
        const r = await LearnTTS.speak(t('tts_test_sample', 'This is what your review cards will sound like.'), 'en', {
          onProgress: (m) => { note.textContent = t('tts_pack_downloading', '正在下载离线模型 · {lang} · {pct}%').replace('{lang}', m.locale || '').replace('{pct}', String(Math.round((Number(m.fraction) || 0) * 100))); },
        });
        note.textContent = r.ok ? (r.fallback === 'lang' ? t('tts_test_ok_fallback', '播放中 · 离线模型不含这门语言，用系统语音') : t('tts_test_ok', '播放中')) : ('✗ ' + LearnTTS.reason(r.reason, t));
        paintTtsPack($('tts-engine').value);
        if (r.ok) await Promise.race([(r.done || Promise.resolve()).catch(() => {}),
          new Promise((res) => setTimeout(res, 15000))]);
      } finally { btn.disabled = false; }
    });

    $('split-long').addEventListener('click', async () => {
      // §4.2 存量长段卡治愈。批量写 + 全量重画在途,按钮可见地禁用。
      // 结构性拆分之后,配了解析引擎的话再跑 §4.2c LLM 裁决(走用户自己的
      // key,输出受机械验证,失败只会保整)。
      const btn = $('split-long');
      btn.disabled = true;
      try {
        const r = await LearnStore.splitLongItems().catch(() => null);
        let llm = null;
        if (r && r.skipped && LearnNotes.capable()) {
          try { llm = await LearnAlign.healUnalignable(); } catch (_) { llm = null; }
        }
        await paintNow();
        const parents = r ? r.parents + (llm ? llm.split : 0) : 0;
        const children = r ? r.children + (llm ? llm.children : 0) : 0;
        const skipped = r ? Math.max(0, r.skipped - (llm ? llm.split : 0)) : 0;
        if (!r || (!parents && !skipped)) say(t('learn_split_none', '没有可拆分的长段卡'));
        else {
          let msg = t('learn_split_done', '已把 {p} 张长段卡拆成 {c} 张句子卡')
            .replace('{p}', String(parents)).replace('{c}', String(children));
          if (skipped) msg += t('learn_split_skipped', '（{k} 张译文对不齐，保持原样）')
            .replace('{k}', String(skipped));
          say(msg);
        }
      } finally { btn.disabled = false; }
    });

    $('clean-known').addEventListener('click', async () => {
      // §7.1's targeted cleanup: drop what the scheduler itself concluded you no
      // longer need. Never a starred card, never one being actively learned.
      // interaction-spec 全局原则: bulk delete + full repaint are in flight.
      const btn = $('clean-known');
      btn.disabled = true;
      try {
        const n = await LearnStore.clearKnown().catch(() => 0);
        await paintNow();
        say(n
          ? t('app_set_cleaned', '已清理 {n} 张').replace('{n}', String(n))
          : t('app_set_clean_none', '没有可清理的卡'));
      } finally { btn.disabled = false; }
    });

    $('clear-learn').addEventListener('click', async () => {
      // Destructive and irreversible, so it names what goes rather than asking a
      // generic 「确定吗」 that gets answered without reading. Same string the
      // extension's settings page uses — one sentence, one meaning, eleven locales
      // already written.
      if (!(await LearnDialog.confirm(t('learn_clear_confirm',
        '清空学习库？所有已采集的句子与复习进度都会被删除，且无法恢复。'), { danger: true }))) return;
      const btn = $('clear-learn');
      btn.disabled = true;
      try {
        await LearnStore.clearAll();
        // §7.5's emptying guard: without this the local backup restores the corpus
        // on the next entry — and restored material carries no `syncedAt`, so it
        // would upload itself back as well. The typeof guard is mandatory: the app
        // bundle deliberately ships without LearnBackup.
        if (typeof LearnBackup !== 'undefined') { try { await LearnBackup.clear(); } catch (_) {} }
        // 系统翻译的收件箱（§9.9）：不清的话，下一次打开 App 又从收件箱里长出几十张卡 ——
        // 用户看着清干净了，第二天卡又回来了，而界面上没有任何地方会说这件事。
        try { if (typeof AppVault !== 'undefined') AppVault.clearInbox(); } catch (_) {}
        await paintNow();   // read back: the counts must be 0 now
        say(t('toast_learn_cleared', '学习库已清空'));
      } catch (_) {
        say(t('toast_learn_clear_failed', '清空失败'), true);
      } finally { btn.disabled = false; }
    });

    // 反馈 / 评分。MTFeedback.open 在宿主 App 里走原生桥（window.open 在 WKWebView 里
    // 是哑的），且**同步**发生在点击里 —— 别在它前面 await。
    $('feedback-mail').addEventListener('click', () => { MTFeedback.open(MTFeedback.mailtoUrl('app')); });
    $('feedback-rate').addEventListener('click', () => { MTFeedback.open(MTFeedback.rateUrl()); });
    // 匿名用量事件的开关：独立键（tm:on），不进任何 saveAll。
    // 遥测脚本的在位与否经注册表读（中国版没有脚本，整块藏掉）。
    try {
      if (Registry.telemetryEnabled() && typeof MTTelemetry !== 'undefined') {
        $('telemetry-block').hidden = false;
        MTTelemetry.enabled().then((on) => { $('telemetry-on').checked = !!on; });
        $('telemetry-on').addEventListener('change', () => { MTTelemetry.setEnabled($('telemetry-on').checked); });
      }
    } catch (_) {}

    $('settings-signout').addEventListener('click', async () => {
      const btn = $('settings-signout');
      btn.disabled = true;
      try { await settingsModel.hooks().onSignOut(); } finally { btn.disabled = false; }
    });

    $('delete-account').addEventListener('click', async () => {
      // Destructive and irreversible, so it asks — and the question names what goes,
      // rather than a generic 「确定吗」 that the user answers without reading.
      if (!(await LearnDialog.confirm(t('app_set_confirm_delete', '确定要删除账号吗？服务器上的所有内容会被永久移除，无法恢复。'), { danger: true }))) return;
      $('delete-account').disabled = true;
      say(t('app_set_deleting', '正在删除…'));
      try {
        await LearnAuth.deleteAccount();
        say(t('app_set_deleted', '账号已删除。'));
        await settingsModel.hooks().onSignOut();
      } catch (e) {
        say(String((e && e.message) || e), true);
      } finally {
        $('delete-account').disabled = false;
      }
    });
  }, []);

  // shell 打开设置页 → 整页重画（旧 paint() 的时序位）。旧 paint 是 async、shell 的
  // 「paint 之后再滚」要等它跑完；换通知制后时序由 notifySettingsShown 的返回值保住。
  // setGen 只是给重渲染一个由头（静态标签的 t 在下一次渲染里换新 locale）。
  useEffect(() => settingsModel.onSettingsShown(() => { setGen((g) => g + 1); return paintNow(); }), []);

  // shell 要切「快速 / 详细」档（旧 setDetail 的时序位）。
  useEffect(() => settingsModel.onDetailRequest((on) => setDetailFn(on)), []);

  // 依赖行：任何一次设置写入（raw chrome.storage → shim onChanged → store 总线）
  // 都会送来新快照 —— 旧 depsOnWrite 正则退役后的替代通路。
  useEffect(() => SettingsStore.subscribe(() => setBusGen((g) => g + 1)), []);

  // busGen 变化（或档位变化）→ 现读设置、重画依赖行。
  // uiLang 变了还要补一次 populateStatic：哨兵文案与语言名都是 t() 出来的，界面
  // 语言一换必须整批重填；引擎下拉的本机条目又只在「桥在」时进列表（populateStatic
  // 传 deviceOk: NativeSpeech.available()），桥晚到也要靠这次重填才出现。旧架构这
  // 一半由 shell 的 onChanged 监听代跑（uiLang 键守卫 → AppSettings.paintStatic），
  // PR6b 把 populate 收进本组件后那半条断了 —— verify-listen 的假桥在页面起来后
  // 才装、又靠带 uiLang 的 storage.set 触发重填，S3 就红在「device 进不了下拉」。
  // 与旧守卫逐字对齐：只有 uiLang 变化才重填，其他写入不动下拉。populate 不传
  // selected，重填会把下拉落回哨兵、等下一次 paintNow 恢复 —— 旧
  // AppSettings.paintStatic 同款行为，不是本 PR 新引入。
  useLayoutEffect(() => {
    let alive = true;
    settingsModel.get(settingsModel.KEYS).then((cur) => {
      if (!alive) return;
      setDepsSettings(Object.assign({}, cur));
      const stored = cur.uiLang || 'auto';
      if (stored !== uiLangNow.current) {
        uiLangNow.current = stored;
        populateStatic();
      }
    });
    return () => { alive = false; };
  }, [detail, busGen]);

  return (
    <section id="app-settings" hidden>
      <button id="settings-back" type="button" className="link">{t('app_review_back', '← 返回')}</button>
      <h2 id="settings-title">{t('app_set_title', '设置')}</h2>

      {/* 2026-09-17 设置页信息架构（interaction-spec「设置页信息架构」，画布 design/settings-ia）：四节按用途 ——
           ① 引擎与密钥 ② 功能 ③ 账号与数据 ④ 关于。控件只搬不改 id；「快速 / 详细」只管第一节。
           与扩展设置页同一套类名契约（.adv-only / .quick-only）和同一条不变量：一键配置卡与逐引擎控件**永不同屏**。
           切换只切 hidden，**永不 remove()**：这一页按字面量读控件、零 null 保护。 */}
      <div className="sec" id="sec-engines">
        <div className="sec-head">
          <div className="sec-title"><span className="sec-n">1</span><h3 id="sec-engines-title">{t('opt_sec_engines', '引擎与密钥')}</h3></div>
          <div className="mode-tabs" id="mode-tabs" role="tablist" hidden={!quickAvail}>
            <button id="mode-quick" type="button" role="tab" aria-selected={!detail}>{t('opt_mode_quick', '快速')}</button>
            <button id="mode-detail" type="button" role="tab" aria-selected={detail}>{t('opt_mode_detail', '详细')}</button>
          </div>
        </div>

        {/* 一把 key 配好全部（QuickSetup）：与扩展设置页、扩展引导第 2 屏是**同一个组件**；它算出 patch 交给 host 写盘。 */}
        {/* 免费额度（§8.10）。与一键卡并排在同一个 tab 里（裁定 D2：登录不是墙）。注册表没有额度时整块不出。 */}
        <section className="quick-only" id="grant-card" hidden={detail || !quickAvail || !grantVisible}>
          <div id="grant-box"></div>
        </section>

        <section className="quick-only" id="quick-setup-card" hidden={detail || !quickAvail}>
          <h3 id="quick-setup-title">{t('qs_title', '用一把 key 配好全部')}</h3>
          <div id="quick-setup"></div>
        </section>

        {/* 「从哪来」的那一行（画布第 7 页 SetupFrom）。系统翻译的弹层 / Mac 快译面板把人
             推过来配引擎时，先说清楚他为什么在这儿；配好之后同一行就地变成「你可以回去了」。 */}
        <p className="note" id="setup-from" hidden></p>

        {/* 「配好了」的回执（画布第 7 页 SetupDone）。四个落点一种回执：先摆出自检行，
             再逐行落成 ✓/✗，最后一句话 + 一个随「从哪来」变的下一步。
             **没通过就不说「可以用了」** —— 见 app/setup-done.js 的文件头。 */}
        <section id="setup-done" hidden>
          <h3 id="setup-done-title"></h3>
          <div id="setup-done-rows"></div>
          <p id="setup-done-note"></p>
          <div className="row" id="setup-done-act" hidden></div>
        </section>

        {/* 永不同屏，但路必须有：详细档顶上一行指回快速档 */}
        <p className="note adv-only" id="app-adv-hint" hidden={!detail}><button type="button" className="link" id="app-adv-hint-go">{t('opt_adv_hint', '一键配置在「快速」里 →')}</button></p>

        {/* 详细档是三张槽卡：翻译与句子解析 / 整段转写 / 朗读。第一张**就是主翻译引擎**
             —— #421 方案 A 之前它自称「仅用于生成句子解析」，于是没人知道翻译该在哪儿配。 */}
        <div className="sgroup adv-only" id="g-notes" hidden={!detail}>
          <h3 id="notes-title">{t('app_set_notes_title', '翻译与句子解析')}</h3>
          <label className="field adv-only" hidden={!detail}>
            <span id="notes-provider-label">{t('app_set_notes_provider', '引擎')}</span>
            <select id="notes-provider"></select>
          </label>
          <label className="field adv-only" id="notes-key-field">
            <span id="notes-key-label">{t('app_set_notes_key', 'API Key')}</span>
            <input id="notes-api-key" type="password" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field adv-only" id="notes-base-field">
            <span id="notes-base-label">{t('app_set_notes_base', '自定义接口地址')}</span>
            <input id="notes-base-url" type="url" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field adv-only" id="notes-model-field">
            <span id="notes-model-label">{t('app_set_notes_model', '模型')}</span>
            <input id="notes-model" type="text" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field adv-only" hidden={!detail}>
            <button id="btn-test-notes" type="button">{t('engine_test', '测试连接')}</button>
          </label>
          <p className="note" id="test-notes-note"></p>
          <p className="note" id="notes-note">{t('app_set_notes_note', '这个引擎负责 App 里的每一处翻译：系统翻译、快速翻译、文档翻译、对话与实时字幕的译文，以及句子解析（生词 / 短语 / 语法）。调用你自己的 API；密钥只存在这台设备上，不随账号同步；与浏览器扩展里配置的密钥互不相通，安全性也相同 —— 都是本机明文保存。')}</p>
        </div>

        {/* 整段转写（learning-design §9.4）：「说」题的录音只发到这里配置的端点，识别后即弃；设备本地凭证（§7.2）。
             实时转写不在这里 —— 它固定为设备内置，不是引擎（2026-09-17）。 */}
        <div className="sgroup adv-only" id="g-stt" hidden={!detail}>
          <h3 id="stt-title">{t('stt_engine', '转写引擎')}</h3>
          <label className="field adv-only" hidden={!detail}>
            <span id="stt-engine-label">{t('stt_engine', '转写引擎')}</span>
            <select id="stt-engine"></select>
          </label>
          <label className="field adv-only" id="stt-key-field">
            <span id="stt-key-label">{t('stt_api_key', '转写 API Key')}</span>
            <input id="stt-api-key" type="password" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field adv-only" id="stt-base-field">
            <span id="stt-base-label">{t('stt_base_url', '转写端点地址')}</span>
            <input id="stt-base-url" type="url" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field adv-only" id="stt-model-field">
            <span id="stt-model-label">{t('stt_model', '转写模型')}</span>
            <input id="stt-model" type="text" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field adv-only" hidden={!detail}>
            <button id="btn-test-stt" type="button">{t('engine_test', '测试连接')}</button>
          </label>
          <p className="note" id="test-stt-note"></p>
          <p className="note" id="stt-note">{t('stt_hint', '「说」题的录音会发到这里配置的端点转写，识别完立即丢弃、不存储不同步；不配置则不出「说」题。密钥只存本机。')}</p>
        </div>

        <div className="sgroup adv-only" id="g-tts" hidden={!detail}>
          <h3 id="tts-title">{t('tts_section', '朗读')}</h3>
          <label className="field adv-only" hidden={!detail}>
            <span id="tts-engine-label">{t('tts_engine', '语音引擎')}</span>
            <select id="tts-engine"></select>
          </label>
          <label className="field adv-only" id="tts-key-field">
            <span id="tts-key-label">{t('tts_api_key', '语音 API Key')}</span>
            <input id="tts-api-key" type="password" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field adv-only" id="tts-base-field">
            <span id="tts-base-label">{t('tts_base_url', '语音端点地址')}</span>
            <input id="tts-base-url" type="url" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field adv-only" id="tts-model-field">
            <span id="tts-model-label">{t('tts_model', '语音模型')}</span>
            <input id="tts-model" type="text" autoComplete="off" autoCapitalize="none"
              autoCorrect="off" spellCheck="false" />
          </label>
          <label className="field">
            <span id="tts-voice-label">{t('app_set_tts_voice', '朗读语音')}</span>
            <select id="tts-voice"></select>
          </label>
          {/* 离线模型行（learning-design §9.1.1，2026-09-17）：只在选了「设备内置朗读」时出现。此前模型只在
               对话开始那一步下载，设置里选了、试听了都静默回落系统语音 —— 用户「没感受到下载」。
               五态：未下载 · 大小 · [下载] / 下载中 pct% / 已安装 / 下载失败 · [重试] / 试听回落具名（在试听结果行）。
               行 hidden 由 paintTtsPack 写（档位布尔并在里面），React 不碰。 */}
          <div className="field adv-only" id="tts-offline-row" hidden>
            <span id="tts-offline-label">{t('tts_pack_label', '离线模型')}</span>
            <p className="note" id="tts-offline-state" role="status" aria-live="polite"></p>
            <progress id="tts-offline-progress" max="100" value="0" hidden></progress>
            <button id="tts-offline-dl" type="button" className="secondary"></button>
          </div>
          <label className="field adv-only" hidden={!detail}>
            <button id="btn-tts-test" type="button"></button>
          </label>
          <p className="note" id="test-tts-note"></p>
          <p className="note" id="tts-note">{t('app_set_tts_note', '语言未知的卡（例如在 Safari 里采集的 —— 那里没有语言检测）只用上面选定的朗读语音；不选则这类卡无法朗读。语音 API Key 与句子解析的密钥一样：只存这台设备、不随账号同步，本机明文保存。')}</p>
        </div>
      </div>

      <div className="sec" id="sec-features">
        <div className="sec-head">
          <div className="sec-title"><span className="sec-n">2</span><h3 id="sec-features-title">{t('opt_sec_features', '功能')}</h3></div>
        </div>

        {/* 界面语言。与扩展设置页是同一个键（uiLang）、同一份选项；在 App 里它还是 driving.js 眼里用户的母语。 */}
        <label className="field">
          <span id="ui-lang-label">{t('ui_lang_label', '界面语言')}</span>
          <select id="ui-lang">
            <option value="auto" id="ui-lang-auto">{t('ui_lang_auto', '跟随系统')}</option>
            <option value="zh_CN">简体中文</option>
            <option value="zh_TW">繁體中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="es">Español</option>
            <option value="hi">हिन्दी</option>
            <option value="ar">العربية</option>
            <option value="pt_BR">Português</option>
            <option value="ru">Русский</option>
          </select>
        </label>

        {/* 译成（2026-09-19）。存储键 targetLang；空 = 跟随界面语言（此前的实际行为）。选项对着
             build/target-langs.config.js 核（test/engine-fields.test.js）。它管文档翻译、播客补译文、
             系统翻译与快速翻译；不管对话 · 实时字幕（那里有自己的一对语言）。 */}
        <label className="field">
          <span id="target-lang-label">{t('target_lang_label', '译成')}</span>
          <select id="target-lang">
            <option value="" id="target-lang-follow">{followLabel}</option>
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="es">Español</option>
            <option value="ar">العربية</option>
            <option value="pt">Português</option>
            <option value="ru">Русский</option>
            <option value="it">Italiano</option>
          </select>
          <small id="target-lang-hint">{t('target_lang_hint', '文档翻译、系统翻译与快速翻译用它。对话 · 实时字幕有自己的语言设置。')}</small>
        </label>

        {/* 复习：怎么听、每天多少张。语音模式 / 自动朗读 / 语速此前混在「语音」组里，与引擎字段同屏。 */}
        <div className="sgroup" id="g-review">
          <h3 id="app-review-title">{t('review_section', '复习')}</h3>
          <DepLineView id="dep-review" {...depProps} slots={['tts', 'notes']} />
          <label className="field" id="app-tts-section">
            <span id="tts-mode-label">{t('tts_mode', '语音模式')}</span>
            <select id="tts-mode">
              <option value="off" id="tts-mode-off">{t('tts_mode_off', '关闭')}</option>
              <option value="assist" id="tts-mode-assist">{t('tts_mode_assist', '显示原文，可点播放')}</option>
              <option value="audio-first" id="tts-mode-audio-first">{t('tts_mode_audio_first', '先听后看（原文先隐藏）')}</option>
            </select>
          </label>
          <label className="check">
            <input id="tts-auto" type="checkbox" />
            <span id="tts-auto-label">{t('app_set_tts_auto', '显示译文时自动朗读')}</span>
          </label>
          <label className="field">
            <span id="tts-rate-label">{t('app_set_tts_rate', '朗读速度')}</span>
            <input id="tts-rate" type="range" min="0.5" max="1.5" step="0.1" />
            <output id="tts-rate-out"></output>
          </label>
          <label className="field">
            <span id="daily-label">{t('app_set_daily', '每天最多学几张新卡')}</span>
            <input id="daily" type="number" min="1" max="200" step="1" inputMode="numeric" />
          </label>
        </div>

        <div className="sgroup" id="g-capture">
          {/* 来源治理（interaction-spec）：规则随账号同步（§8.9），在手机上改是
               自然场景。App 自身不采集 —— 这里改的是浏览器扩展那头的采集行为。 */}
          <h3 id="app-langs-title">{t('learn_langs_label', '学习语言')}</h3>
          <div id="app-langs"></div>
          <p className="note" id="app-langs-note">{t('learn_langs_hint', '只收录选中语言的句子。Safari 无法精确识别语言时按文字系统判断；长按收藏不受限制。')}</p>

          <h3 id="app-sources-title">{t('learn_sources_manage', '来源管理')}</h3>
          <div id="app-sources"></div>
        </div>

        {/* 播客模式（learning-design §9.5）。这里只放**要花钱**的那个开关与出发前预载。 */}
        <div className="sgroup" id="g-drive">
          <h3 id="drive-title">{t('drive_entry', '播客模式')}</h3>
          <DepLineView id="dep-drive" {...depProps} slots={['tts', 'notes']} />
          <label className="check">
            <input id="drive-play-notes" type="checkbox" />
            <span id="drive-play-notes-label">{t('drive_play_notes', '播放时朗读句子解析')}</span>
          </label>
          <p className="note" id="drive-play-notes-note">{t('drive_play_notes_note', '开启后每张卡在原文和译文之后再读一遍解析（生词 / 短语 / 语法）。**没解析过的卡会自动调用你配置的解析引擎**——每张卡只收一次费，之后一直用缓存。不开则只读原文和译文。')}</p>
          {/* 出发前预载（learning-design §9.5）。第一下只算账、不发请求；第二下才花钱。
               这是 §9.2 修订后「允许的批量」的唯一实例，四个构成要件（先算账 / 第二下才跑 /
               可停 / 具名报账）都长在这几个元素上，别把它简化成一个直接开跑的按钮。 */}
          <label className="field">
            <span id="drive-preload-days-label">{t('drive_preload_days', '预载范围')}</span>
            <select id="drive-preload-days">
              <option value="0" id="drive-preload-days-0">{t('drive_preload_days_0', '今天要听的牌库')}</option>
              <option value="3" id="drive-preload-days-3">{t('drive_preload_days_3', '今天 + 未来 3 天')}</option>
              <option value="7" id="drive-preload-days-7">{t('drive_preload_days_7', '今天 + 未来 7 天')}</option>
            </select>
          </label>
          {/* 裸 button，**不要**包进 <label class="field">：label 会把激活转发给它内部的
               那个控件，于是一次点击派发两个 click 事件。旁边 btn-test-notes 之类包在 label
               里没出事，只是因为 runTest 在同步阶段就 disabled 了按钮（禁用的按钮不再派发）。
               这个按钮是两态的（算账 → 开跑），第二个事件会在开跑的瞬间把自己停掉。 */}
          <button id="btn-drive-preload" type="button" className="secondary"></button>
          <p className="note" id="drive-preload-note" role="status" aria-live="polite"></p>
          <p className="note" id="drive-preload-hint">{t('drive_preload_hint', '出发前点一下，把要听的语音、解析、译文全部下载到本机，路上没网也能整轮播完。第一下只算账、不花钱，看清楚要调用多少次再点第二下。')}</p>
          <p className="note" id="drive-audio-cache"></p>
          <button id="btn-drive-clear-audio" type="button" className="danger">{t('tts_clear_cache', '清空语音缓存')}</button>
          {/* 亮屏（§9.5）。App 在前台时屏幕不自动锁，这是 app:sync 的 idle-timer 补丁。
               但**锁屏之后保持亮屏第三方 App 做不到** —— 唯一能让锁屏卡片持续可见的是
               系统的「息屏常显」。所以这里写的是「去哪儿开」，不是「我们做不到」。 */}
          <p className="note" id="drive-awake-note">{t('drive_awake_note',
            '播客模式在前台时屏幕不会自动锁。锁屏之后想一直看到卡片，请打开系统的「息屏常显」：设置 → 显示与亮度 → 始终显示。')}</p>
        </div>

        {/* 对话 · 实时听译 与 实时字幕（§9.6 / §9.8）：实时转写固定为设备内置 —— 依赖行说它在不在，语言包行说包在不在。 */}
        <div className="sgroup" id="g-listen">
          <h3 id="listen-title">{t('listen_settings_title', '对话 · 实时听译')}</h3>
          <DepLineView id="dep-listen" {...depProps} slots={['live', 'chat', 'tts']} />
          <label className="check">
            <input id="listen-capture" type="checkbox" />
            <span id="listen-capture-label">{t('listen_capture_label', '对话进复习（来源「对话」）')}</span>
          </label>
          <p className="note" id="listen-capture-note">{t('listen_capture_note', '「对话 · 实时听译」把麦克风的声音实时发送到你自己配置的转写端点，只在你按下「开始听」之后、只发那一个端点；我们的服务器不接触音频；不保存任何录音，只保留文字（且只在这个开关开着时保留）。')}</p>
          <label className="check">
            <input id="subtitle-capture" type="checkbox" />
            <span id="subtitle-capture-label">{t('subtitle_capture_label', '字幕进复习（来源「实时字幕」）')}</span>
          </label>
          {/* 语言对（§9.6，2026-09-08）。两个下拉与对话页底部那两个是**同一份设置**：
               洽谈现场发现语言选错要能立刻改，跳设置页等于中断会话，所以两处都有。
               两边选成同一种语言时不是拒绝而是对调 —— 见 ListenCore.langPatch 的注释。 */}
          <label className="field">
            <span id="listen-my-lang-label">{t('listen_my_lang_label', '我的语言')}</span>
            <select id="listen-my-lang"></select>
          </label>
          <label className="field">
            <span id="listen-other-lang-label">{t('listen_other_lang_label', '对方的语言')}</span>
            <select id="listen-other-lang"></select>
          </label>
          <p className="note" id="listen-lang-note">{t('listen_lang_note',
            '两边不能是同一种语言。对话页底部也能改，两处是同一份设置。')}</p>
          {/* 识别语言包（§9.1.1，镜像 §9.6 的 downloading 态）：本机识别器的语言包由系统按需下载；
               换了语言先在这里说清在不在，而不是等到点「开始听」才发现要等。 */}
          <div className="field" id="listen-pack-row" hidden>
            <p className="note" id="listen-pack-state" role="status" aria-live="polite"></p>
            <progress id="listen-pack-progress" max="100" value="0" hidden></progress>
            <button id="listen-pack-dl" type="button" className="secondary"></button>
          </div>
          {/* 实时字幕「视频的语言」（§9.8 协议补充决定 6）进设置页（2026-09-17）：与准备页那处是「两处一份设置」。 */}
          <label className="field">
            <span id="subtitle-video-lang-label">{t('subtitle_video_lang_label', '视频的语言')}</span>
            <select id="subtitle-video-lang"></select>
          </label>
          <label className="check">
            <input id="listen-autospeak" type="checkbox" />
            <span id="listen-autospeak-label">{t('listen_autospeak_label', '自动朗读译文')}</span>
          </label>
          <p className="note" id="listen-autospeak-note">{t('listen_autospeak_note',
            '整句翻译完之后自动读出来。对方说的读给你听，你说的读给对方听。')}</p>
        </div>

        {/* 文档翻译（§9.7） */}
        {/* 快速翻译（learning-design §9.9）。只在 macOS 出现：原生回了 quick-caps 才显示（AppQuickHost.onCaps），
             iOS 与老原生壳整块不出现。M-1 只有「在菜单栏常驻」这一个开关，快捷键 / 增强取词 / 截图随各自的 PR 进来。 */}
        <div className="sgroup" id="g-quick" hidden>
          <h3 id="quick-title">{t('quick_title', '快速翻译')}</h3>
          <label className="check">
            <input id="quick-enabled" type="checkbox" />
            <span id="quick-enabled-label">{t('quick_enabled_label', '在菜单栏常驻')}</span>
          </label>
          <p className="note" id="quick-enabled-note">{t('quick_enabled_note', '关掉后菜单栏图标消失，关闭窗口即退出 App。')}</p>
          {/* 三个全局快捷键（M-7）。行由 app/quick-settings.js 画：录制控件五态；「输入翻译」那一行在下面的「更多选项」里。 */}
          <div className="hk-head"><h4 id="quick-hotkeys-title"></h4><button id="quick-hotkeys-reset" type="button" className="link"></button></div>
          <div id="quick-hotkeys"></div>
          {/* 增强取词（M-5）：默认关，打开才问系统权限。原生没回 postEvent 能力时整行不出现。 */}
          <div id="quick-enhanced-row" hidden>
            <label className="check">
              <input id="quick-enhanced" type="checkbox" />
              <span id="quick-enhanced-label">{t('quick_enh_label', '增强取词')}</span>
            </label>
            <p className="note" id="quick-enhanced-hint">{t('quick_enh_hint', '选中文字后直接按快捷键，不用先按 ⌘C。需要一项系统权限，默认关闭。')}</p>
            <p className="note" id="quick-enhanced-state" role="status" hidden></p>
            <div className="row" id="quick-enhanced-actions" hidden>
              <button id="quick-enhanced-relaunch" type="button">{t('quick_enh_relaunch', '现在重开')}</button>
              <button id="quick-enhanced-privacy" type="button" className="secondary">{t('quick_enh_open_privacy', '打开系统设置')}</button>
            </div>
          </div>
          {/* 存入复习库（quickCapture，默认开；受学习总闸控制）。 */}
          <label className="check">
            <input id="quick-capture" type="checkbox" />
            <span id="quick-capture-label"></span>
          </label>
          <p className="note" id="quick-capture-hint"></p>
          {/* 「更多选项」：输入翻译的快捷键、屏幕录制状态、登录时启动（默认关）、给右键「服务」绑快捷键。
               画布写的是「详细档多露几行」，但「快速 / 详细」两档只许管「引擎与密钥」一节（test:app 的不变量）⇒
               这一块不跟全局档位，用块内自己的折叠区，默认收起。 */}
          <details className="quick-more" id="quick-more">
            <summary id="quick-more-title"></summary>
            <div id="quick-hotkeys-more"></div>
            <p className="note" id="quick-screen-state" role="status"></p>
            <div className="row"><button id="quick-screen-privacy" type="button" className="secondary" hidden></button></div>
            <div id="quick-login-row" hidden>
              <label className="check">
                <input id="quick-login" type="checkbox" />
                <span id="quick-login-label"></span>
              </label>
              <p className="note" id="quick-login-hint"></p>
              <p className="note" id="quick-login-approval" role="status" hidden></p>
              <div className="row"><button id="quick-login-go" type="button" className="secondary" hidden></button></div>
            </div>
            <p className="note"><button id="quick-services-go" type="button" className="link"></button></p>
          </details>
        </div>

        {/* 系统翻译（learning-design §9.9 / iOS 线 I-7）。只在 iPhone / iPad 上出现：
             原生装了 mtVault 通道才显示（AppVault.available()），macOS 与老原生壳整块不出现。
             系统不提供「我是不是默认翻译 App」的接口 —— 所以这里说的是**我们答得上来的那件事**：
             引擎配置有没有同步过去。选没选成默认，让用户自己在那三步里看。 */}
        <div className="sgroup" id="g-systrans" hidden>
          <h3 id="systrans-title"></h3>
          <p className="note" id="systrans-state" role="status" aria-live="polite"></p>
          <p className="note" id="systrans-intro"></p>
          <ol className="steps" id="systrans-steps">
            <li id="systrans-step1"></li>
            <li id="systrans-step2"></li>
            <li id="systrans-step3"></li>
          </ol>
          <p className="note" id="systrans-need"></p>
          <label className="check">
            <input id="systrans-capture" type="checkbox" />
            <span id="systrans-capture-label"></span>
          </label>
          <p className="note" id="systrans-capture-hint"></p>
        </div>

        {/* 误点了「我已打开」能把首页横幅找回来（2026-09-22，画布 YEDD4VmT9Pv2htUpoWZ9ZB 第 2 页板 ⑤，用户点头）。
             只在横幅被「我已打开」收起过时出现；点了就地说「已恢复」，这一组随即收起。显隐由 shell-model 的 paintExtRestore()。 */}
        <div className="sgroup" id="g-extbanner" hidden>
          <h3 id="extb-title"></h3>
          <p className="note" id="extb-note"></p>
          <button id="extb-restore" type="button" className="secondary"></button>
          <p className="note" id="extb-done" role="status" aria-live="polite" hidden></p>
        </div>

        <div className="sgroup" id="g-docs">
          <h3 id="docs-title">{t('doc_title', '文档翻译')}</h3>
          <DepLineView id="dep-docs" {...depProps} slots={['chat']} />
          <label className="check">
            <input id="doc-capture" type="checkbox" />
            <span id="doc-capture-label">{t('doc_capture_label', '文档译文进复习（来源「文档」）')}</span>
          </label>
          <p className="note" id="doc-capture-note">{t('doc_privacy', '文档只保存在本机，不同步、不导出。翻译时，文档的文字按你点开的页发往你配置的翻译端点 —— 不是整份，也不是打开就发；图片与扫描页以图片形式发往同一端点识别，只在你的引擎支持识别图片时。')}</p>
          <label className="check">
            <input id="doc-prefetch" type="checkbox" />
            <span id="doc-prefetch-label">{t('doc_prefetch_label', '提前解析下一页（不翻译）')}</span>
          </label>
        </div>
      </div>

      <div className="sec" id="sec-account">
        <div className="sec-head">
          <div className="sec-title"><span className="sec-n">3</span><h3 id="sec-account-title">{t('opt_sec_account', '账号与数据')}</h3></div>
        </div>
        <div className="sgroup" id="g-account">
          <h3 id="account-title">{t('app_set_account', '账号')}</h3>
          <p className="note" id="account-who"></p>
          <button id="settings-signout" type="button" className="secondary">{t('app_set_signout', '退出登录')}</button>
          {/* Apple requires in-app account deletion wherever accounts exist
               (learning-design §10 Gate B). Not a nice-to-have: without it the app cannot
               ship. Destructive, so it confirms and says exactly what goes. */}
          <button id="delete-account" type="button" className="danger">{t('app_set_delete', '删除账号与云端数据')}</button>
          <p className="note" id="delete-note">{t('app_set_delete_note', '删除后，服务器上的语料与复习记录会被永久移除，账号也会注销。这台设备上已经下载的内容不受影响 —— 想一并清掉，删除 App 即可。')}</p>
        </div>
        <div className="sgroup" id="g-corpus">
          <h3 id="corpus-title">{t('app_set_corpus', '学习库')}</h3>
          <div className="counts" id="settings-counts"></div>
          <button id="split-long" type="button" className="secondary">{t('learn_split_long', '拆分长段卡')}</button>
          <button id="clean-known" type="button" className="secondary">{t('app_set_clean_known', '清理已掌握的卡')}</button>
          {/* 本机卫生，不是同步功能：一台设备换过账号之后，唯一的出路不该是删应用
               重装。刻意**不受**后端开关门控 —— 先例是扩展设置页的同一个
               按钮就在同步块之外，所以中国版扩展照样有它。 */}
          <button id="clear-learn" type="button" className="secondary danger">{t('learn_clear', '清空学习库')}</button>
        </div>
      </div>

      <div className="sec" id="sec-about">
        <div className="sec-head">
          <div className="sec-title"><span className="sec-n">4</span><h3 id="sec-about-title">{t('options_about_section', '关于')}</h3></div>
        </div>
        <div className="sgroup" id="g-feedback">
          {/* 反馈 / 评分：宿主 App 里 window.open 是哑的，两个按钮经原生桥在系统里
               打开（邮件 App / App Store 评分页），地址由 learn/feedback.js 统一给。 */}
          <h3 id="feedback-title">{t('feedback_section', '反馈')}</h3>
          <button id="feedback-mail" type="button" className="secondary">{t('feedback_row', '发送反馈')}</button>
          <button id="feedback-rate" type="button" className="secondary">{t('feedback_rate', '去商店评分')}</button>
          <p className="note" id="feedback-note">{t('feedback_hint', '会打开你的邮件 App。主题里带着版本号和平台，除此之外什么都不发送。')}</p>
        </div>
        {/* 匿名用量事件的开关（docs/telemetry-design.md §5）。中国版没有遥测脚本，整块藏掉。 */}
        <div id="telemetry-block" hidden>
          <h3 id="telemetry-title">{t('telemetry_section', '匿名用量数据')}</h3>
          <label className="row-toggle"><span id="telemetry-label">{t('telemetry_toggle', '分享匿名用量数据')}</span><input type="checkbox" id="telemetry-on" /></label>
          <p className="note" id="telemetry-note">{t('telemetry_hint', '只发送用了哪些功能、在哪个浏览器、翻译成功还是失败 —— 不含你读的网页、文字、地址、密钥或账号。关掉即删除这台设备发过的数据。')}</p>
        </div>
      </div>
    </section>
  );
}
