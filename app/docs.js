// app/docs.js — 宿主 App 的「文档翻译」（learning-design §9.7 / domain-design §2.5）。
//
// 渲染器是 extension/learn/doc-view.js（与扩展页同一份字节）；这里只做扩展页 docs-page.js
// 在 App 里的对应物：视图进出、首页两份入口、文件选择、读设置、接翻译/语料/存储。
// 与 listen.js 同一套纪律：视图切换归 app.js 的分工（这里只动 #app-docs 与来处两个 section），
// 设置只读不播种，语料写本机库（LearnAuth.bindCorpus 已在 app.js 里先做）。
//
// pdf.js 在 App 里走 blob 路（build/app-bundle.js 把 vendor 文本编进 Script.js 的
// window.__MT_PDFJS），PdfJsLoader 按宿主自己分派 —— 这里不关心。
'use strict';

var AppDocs = (() => {
  const $ = (id) => document.getElementById(id);
  const t = (k, fb) => (typeof PageI18n !== 'undefined' ? PageI18n.t(k, fb) : fb);

  // 读得到的键（test/engine-fields.test.js 解析这份清单：读得到的，设置页必须管得到）。
  // notes* 四个与 listen.js 同理：从不写，只为 LearnNotes.resolveConfig 解出同一个引擎。
  const READ_KEYS = ['provider', 'apiKey', 'apiBaseUrl', 'apiModel',
    'notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel',
    'uiLang', 'learnRules', 'learnEnabled', 'docCapture', 'docPrefetch', 'grantTail'];

  let view = null;
  let cameFrom = 'signed-in';
  let opts = {};

  function readSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(READ_KEYS, (s) => {
        s = s || {};
        const tr = LearnNotes.resolveConfig(s);
        // App 没有 targetLang 控件：译成界面语言（§3.1.4 已知缺口，与听译/播客同一回落）。
        const ui = s.uiLang && s.uiLang !== 'auto' ? s.uiLang : '';
        resolve({
          provider: tr.provider || '', apiKey: tr.apiKey || '', apiBaseUrl: tr.baseUrl || '', apiModel: tr.model || '',
          targetLang: ui || navigator.language || TranslationCore.DEFAULT_TARGET_LANG,
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
      langs: window.MT_LANGS || [],
      store: DocStore,
      pdfjs: () => PdfJsLoader.load(),
      translate: (text, s) => TranslationAPI.translate(text, s.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
        TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
      ocr: (dataUri, s) => TranslationAPI.ocr(dataUri, TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
      visionOf: (s) => EngineState.visionOf(s.provider),
      grantActive: (s) => (typeof LearnGrant !== 'undefined' ? LearnGrant.activeIn(s, 'chat') : false),
      engineTriple: triple,
      gates: { langAllowed: LearnRules.langAllowed, shouldCapture: (d) => LearnModel.shouldCapture(d) },
      write: (draft, source) => LearnStore.mergeBatch([LearnModel.makeItem(draft, Date.now())], [source]),
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
    $('app-docs-back').textContent = t('doc_app_back', '‹ 返回');
    $('app-docs-title').textContent = t('doc_title', '文档翻译');
    $('app-docs-back').addEventListener('click', leave);
  }

  return { wire, open, leave, READ_KEYS };
})();
