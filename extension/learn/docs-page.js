// learn/docs-page.js — 扩展页宿主：把 DocView 接到扩展的设置、翻译传输、语料库与存储上。
// App 那一侧是 app/docs.js（同一套 deps，只有文件选择与设置读法不同）。
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = PageI18n.t;
  const KEYS = ['provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'targetLang', 'uiLang', 'learnRules', 'learnEnabled',
    'docCapture', 'docPrefetch', 'grantTail', 'grant'];

  async function readSettings() {
    const r = await PageSettings.read(KEYS);
    return (r && r.data) || {};
  }
  function pickFile() {
    return new Promise((resolve) => {
      const input = $('docs-file');
      const done = () => { input.removeEventListener('change', done); const f = input.files && input.files[0]; input.value = ''; resolve(f || null); };
      input.addEventListener('change', done);
      input.click();
    });
  }
  function blobToDataUrl(file, maxPx) {
    return DocReader.openImage(file, maxPx).then((r) => r.imageOf(1));
  }
  const triple = (s) => [EngineState.resolve(s.provider), s.apiBaseUrl || '', s.apiModel || ''].join('|');

  async function boot() {
    PageI18n.applyI18n('doc_title');
    // 语料落在当前账号的库（§7.2）：与复习页同一条路。
    try { const session = await LearnAuth.current().catch(() => null); await LearnAuth.bindCorpus(session); } catch (_) {}
    const view = DocView.mount($('docs-root'), {
      t, pickFile, readSettings, blobToDataUrl,
      langs: window.MT_LANGS || [],
      store: DocStore,
      pdfjs: () => PdfJsLoader.load(),
      translate: (text, s) => TranslationAPI.translate(text, s.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
        TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
      ocr: (dataUri, s) => TranslationAPI.ocr(dataUri, TranslationAPI.resolveProvider(s.provider), s.apiKey || '', s.apiBaseUrl || '', s.apiModel || ''),
      visionOf: (s) => EngineState.visionOf(s.provider),
      // 免费额度在用 = 翻译槽装的是额度令牌（identically to grant.js：尾号命中）。
      grantActive: (s) => (typeof LearnGrant !== 'undefined' ? LearnGrant.activeIn(s, 'chat') : false),
      engineTriple: triple,
      gates: { langAllowed: LearnRules.langAllowed, shouldCapture: (d) => LearnModel.shouldCapture(d) },
      write: (draft, source) => LearnStore.mergeBatch([LearnModel.makeItem(draft, Date.now())], [source]),
      onDelete: async (docId) => {
        // 删「这份文档的卡」连文档本体一起删（§9.7 删除语义）。
        try {
          const items = await LearnStore.allItems();
          const ids = items.filter((it) => it.sourceId === 'doc:' + docId).map((it) => it.id);
          if (ids.length) await LearnStore.deleteItems(ids, Date.now());
          try { await LearnStore.deleteSourcesIfOrphan(['doc:' + docId]); } catch (_) {}
        } catch (_) {}
        await DocStore.remove(docId);
      },
      confirm: (msg) => LearnDialog.confirm(msg, { danger: true }),
      openSettings: (hash) => { try { window.open(chrome.runtime.getURL('options/options.html') + (hash || ''), '_blank'); } catch (_) {} },
      track: (name, props) => { try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.track(name, props); } catch (_) {} },
    });
    // #doc=<id>&page=<n>：复习卡的 ⓘ 行跳回那一页。
    const m = /doc=([^&]+)(?:&page=(\d+))?/.exec(location.hash);
    if (m) view.openDoc(decodeURIComponent(m[1]), Number(m[2] || 1));
    try { if (typeof MTTelemetry !== 'undefined') MTTelemetry.init(); } catch (_) {}
  }
  boot();
})();
