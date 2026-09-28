// src/app/docs-model.js — 宿主 App 的「文档翻译」（learning-design §9.7 / domain-design §2.5）。
// （原 app/docs.js，PR6d 起 ESM 化收进 React bundle。）
//
// 渲染器是 src/shared/doc-view.js（与扩展页同一份源，PR7c 起 ESM 单源）；这里只做扩展页 docs-page.js
// 在 App 里的对应物：视图进出、首页两份入口、文件选择、读设置、接翻译/语料/存储。
// 与 listen.js 同一套纪律：视图切换归 shell-model 的分工（这里只动 #app-docs 与来处两个
// section），设置只读不播种，语料写本机库（LearnAuth.bindCorpus 已在 shell-model 里先做）。
// 页骨架（back / title / #app-docs-root / file input）PR6d 起由 docs-view.jsx 渲染 ——
// back/title 的文案进 useT，#app-docs-root 保持为 DocView 命令式孤岛的挂载点容器，
// #app-docs-file 仍是原生 input（pickFile 一次性 change 监听照旧）。
//
// pdf.js 在 App 里走 blob 路（build/app-bundle.js 把 vendor 文本编进 Script.js 的
// window.__MT_PDFJS），PdfJsLoader 按宿主自己分派 —— 这里不关心。
import Registry from '../lib/registry.js';
import PageText from '../lib/i18n.js';
import SETTINGS_SCHEMA from '../store/schema.js';
import DocView from '../shared/doc-view.js'; // PR7c：渲染器收编 src/shared/doc-view.js（哑视图，
                                             // deps 注入同前）—— 裸全局 DocView 换组合根 import。

const $ = (id) => document.getElementById(id);
// PR9：t 翻 PageText（src/ 已离开共享字节的 PageI18n；白名单见 test/src-boundaries.test.js）。
const t = (k, fb) => PageText.t(k, fb);

// PR9：READ_KEYS 手抄清单已删，键表 = schema 的 docs 面。notes×4 与 listen.js 同理：
// 从不写，只为 LearnNotes.resolveConfig 解出同一个引擎（surfaces 是收编时补登记的）。
const READ_KEYS = SETTINGS_SCHEMA.keysFor('docs');

let view = null;
let cameFrom = 'signed-in';
let opts = {};

function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(READ_KEYS, (s) => {
      s = s || {};
      const tr = LearnNotes.resolveConfig(s);
      // 「译成」（2026-09-19 补上的设置）；没选过就跟随界面语言，即此前的行为。唯一出口 AppTargetLang。
      resolve({
        provider: tr.provider || '', apiKey: tr.apiKey || '', apiBaseUrl: tr.baseUrl || '', apiModel: tr.model || '',
        targetLang: AppTargetLang.resolve(s, navigator.language, TranslationCore.DEFAULT_TARGET_LANG),
        uiLang: s.uiLang, learnRules: s.learnRules, learnEnabled: s.learnEnabled,
        docCapture: s.docCapture, docPrefetch: s.docPrefetch, grantTail: s.grantTail,
      });
    });
  });
}
function pickFile() {
  return new Promise((resolve) => {
    const input = $('app-docs-file');
    const done = () => { input.removeEventListener('change', done); const f = input.files && input.files[0]; input.value = ''; resolve(f || null); };
    input.addEventListener('change', done);
    input.click();
  });
}
const triple = (s) => [EngineState.resolve(s.provider), s.apiBaseUrl || '', s.apiModel || ''].join('|');

function ensureView() {
  if (view) return view;
  view = DocView.mount($('app-docs-root'), {
    t, pickFile, readSettings,
    blobToDataUrl: (file, maxPx) => DocReader.openImage(file, maxPx).then((r) => r.imageOf(1)),
    langs: Registry.langs(),
    store: DocStore,
    pdfjs: () => PdfJsLoader.load(),
    translate: (text, s) => TranslationAPI.translate(text, s.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
      TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
    ocr: (dataUri, s) => TranslationAPI.ocr(dataUri, TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
    detectLang: (text, s) => TranslationAPI.detectLanguage(text, TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
    visionOf: (s) => EngineState.visionOf(s.provider),
    grantActive: (s) => (typeof LearnGrant !== 'undefined' ? LearnGrant.activeIn(s, 'chat') : false),
    engineTriple: triple,
    gates: { langAllowed: LearnRules.langAllowed, shouldCapture: (d) => LearnModel.shouldCapture(d) },
    // 采集是 sink，只在**写成功之后**记一次（Collector law 2：绝不在失败路径）。
    // 这条 seam 在 App 里必须自己接：capture_first 的另一个发送点是内容脚本
    // learn-collector.js，而内容脚本不进 App 包 —— 漏了这里，App 侧的
    // capture_first 永远是 0，且看上去像「没人用」而不是「没接线」（2026-09-16）。
    write: async (draft, source) => {
      const r = await LearnStore.mergeBatch([LearnModel.makeItem(draft, Date.now())], [source]);
      try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.once('capture_first'); } catch (_) {}
      return r;
    },
    onDelete: async (docId) => {
      try {
        const items = await LearnStore.allItems();
        const ids = items.filter((it) => it.sourceId === 'doc:' + docId).map((it) => it.id);
        if (ids.length) await LearnStore.deleteItems(ids, Date.now());
        try { await LearnStore.deleteSourcesIfOrphan(['doc:' + docId]); } catch (_) {}
      } catch (_) {}
      await DocStore.remove(docId);
    },
    confirm: (msg) => LearnDialog.confirm(msg, { danger: true }),
    // 「去设置」：先离开文档页（openSettings 只收首页），再落到 App 设置页对应的控件。
    openSettings: (hash) => { leave(); if (opts.openSettings) opts.openSettings(hash === '#quick' ? 'quick-setup-card' : 'notes-provider'); },
    track: (name, props) => { try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.track(name, props); } catch (_) {} },
  });
  return view;
}

// ── 视图进出（同 listen.js：只动 #app-docs 与来处）──────────────────────────
function enter() {
  cameFrom = $('signed-in').hidden ? 'signed-out' : 'signed-in';
  $(cameFrom).hidden = true;
  $('app-docs').hidden = false;
}
function leave() {
  if ($('app-docs').hidden) return;
  if (view) view.showList();     // 停掉页级引擎，回到列表；下次进来从列表开始
  $('app-docs').hidden = true;
  $(cameFrom).hidden = false;
}
function open(docId, page) {
  enter();
  const v = ensureView();
  if (docId) v.openDoc(docId, page || 1); else v.showList();
}

// ── 首页入口：登录前后两个首页都有；不设门（没配引擎时页内那一行会说去哪配）────
// （入口两卡的文案与点击监听保留命令式 —— 卡片在 AppShell 静态 JSX 里，uiLang 变化
// 经 shell-model 的 populateStatic 重涂，React 对没变的 vdom 不回写 DOM，互不打架。）
const ENTRY_SUFFIXES = ['', '2'];
function wire(o) {
  opts = o || {};
  for (const sfx of ENTRY_SUFFIXES) {
    const entry = $('app-docs-entry' + sfx);
    if (!entry) continue;
    const title = entry.querySelector('.mode-title'); (title || entry).textContent = t('doc_open_page', '翻译文档（PDF / Word / 图片）');
    const hint = $('app-docs-entry-hint' + sfx); if (hint) hint.textContent = t('doc_app_entry_hint', '打开一页翻一页；译文可收进复习');
    entry.hidden = false;
    entry.addEventListener('click', () => open(null));
  }
}

const api = { wire, open, leave, READ_KEYS };
export default api;
