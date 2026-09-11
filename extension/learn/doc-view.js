// learn/doc-view.js — 文档翻译的阅读器（domain-design §2.5；interaction-spec「文档翻译」）。
//
// 一个渲染器，两个宿主（扩展页 learn/docs.html、App 的 #app-docs），形状照 sources-view.js：
// **哑视图** —— 文件怎么选、翻译怎么发、卡怎么写、存储在哪，全由宿主经 deps 注入；这里只有
// 列表、翻页、每段原文 + 译文、★、错误行，以及那台**页级**引擎（createEngine + selectActive
// = 当前页）。id 全部 docv- 前缀（App 构建对 id 冲突是硬失败）。
//
// deps（mount 时注入）：
//   t(key, fb)                    i18n
//   pickFile() → Promise<File|null>
//   readSettings() → Promise<settings>   现读（provider/apiKey/…/targetLang/docCapture/docPrefetch）
//   translate(text, settings) → Promise<string>
//   ocr(dataUri, settings) → Promise<string>
//   visionOf(settings) → true|false|null
//   grantActive(settings) → bool         免费额度在用 ⇒ 图片上传即拦（用户裁定 2026-09-11）
//   pdfjs() → Promise<pdfjsLib>
//   store                          DocStore
//   write(draft, source) → Promise  宿主写语料（LearnStore.mergeBatch）
//   gates: { langAllowed, shouldCapture }
//   openSettings(hash)             「去设置 →」
//   track(name, props)             遥测（可缺省）
//   engineTriple(settings) → 'provider|base|model'
//   confirm(msg) → Promise<bool>
'use strict';

var DocView = (() => {
  const TICK_MS = 350;
  const STYLE = `
    .docv-wrap { display:flex; flex-direction:column; gap:12px; }
    .docv-top { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .docv-top .spacer { flex:1; }
    .docv-privacy { font-size:.85em; color:var(--text-secondary, inherit); margin:0; }
    .docv-msg { font-size:.9em; color:var(--text-secondary, inherit); margin:0; }
    .docv-msg.bad { color:var(--danger, #c0392b); }
    .docv-list { display:flex; flex-direction:column; gap:6px; }
    .docv-row { display:flex; gap:10px; align-items:center; padding:10px 12px; border:1px solid var(--border, #ddd); border-radius:10px; }
    .docv-row .title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
    .docv-row .meta { font-size:.85em; color:var(--text-secondary, inherit); white-space:nowrap; }
    .docv-row button { width:auto; padding:4px 10px; font-size:.85em; }
    .docv-pager { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .docv-pager button { width:auto; padding:6px 12px; }
    .docv-pager .stat { font-size:.85em; color:var(--text-secondary, inherit); }
    .docv-page { display:flex; flex-direction:column; gap:10px; }
    .docv-unit { display:flex; gap:8px; align-items:flex-start; }
    .docv-unit .body { flex:1; min-width:0; }
    .docv-unit .orig { margin:0 0 4px; white-space:pre-wrap; }
    .docv-unit .orig.heading { font-weight:700; }
    .docv-unit .tr { margin:0; white-space:pre-wrap; color:var(--sage-text, #56633f); border-top:1px solid var(--border, #ddd); padding-top:4px; }
    .docv-unit .tr.pending { color:var(--text-secondary, inherit); font-style:italic; }
    .docv-unit .tr.error { color:var(--danger, #c0392b); cursor:pointer; text-decoration:underline; }
    .docv-unit .star { width:auto; padding:2px 8px; font-size:1em; background:none; border:1px solid var(--border, #ddd); color:var(--text-secondary, inherit); }
    .docv-unit .star.on { color:var(--accent, #c67139); border-color:var(--accent, #c67139); }
    .docv-lang { display:flex; gap:6px; align-items:center; font-size:.85em; color:var(--text-secondary, inherit); }
    .docv-lang select { width:auto; }
    .docv-back { width:auto; padding:4px 10px; font-size:.9em; }
  `;
  let styled = false;
  function injectStyle(doc) { if (styled || !doc) return; const s = doc.createElement('style'); s.textContent = STYLE; doc.head.appendChild(s); styled = true; }

  function mount(container, deps) {
    const doc = container.ownerDocument;
    injectStyle(doc);
    const t = deps.t || ((k, fb) => fb);
    const track = deps.track || (() => {});
    const el = (tag, cls, txt) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
    const state = { view: 'list', doc: null, reader: null, cur: 1, units: [], engine: null, timer: null, epoch: 0, counters: null, settings: null, okSent: false, pageMsg: '' };
    let settingsCache = null;
    async function settings() { settingsCache = await deps.readSettings(); return settingsCache; }

    container.textContent = '';
    const wrap = el('div', 'docv-wrap'); wrap.id = 'docv-root';
    container.appendChild(wrap);

    // ── 列表 ────────────────────────────────────────────────────────────
    async function showList(msg, bad) {
      stopEngine();
      state.view = 'list'; state.doc = null;
      wrap.textContent = '';
      const top = el('div', 'docv-top');
      const up = el('button', 'docv-upload', t('doc_upload', '上传文档（PDF / Word / 图片）')); up.id = 'docv-upload'; up.type = 'button';
      top.append(up);
      wrap.append(top);
      const s = await settings();
      const priv = el('p', 'docv-privacy', deps.grantActive(s) ? t('doc_privacy_grant', '文档只保存在本机。翻译时按你点开的页发往我们的中继再到模型提供方（不保存、不记录）；免费额度不识别图片 —— 图片和扫描页要用你自己的 API key。') : t('doc_privacy', '文档只保存在本机，不同步、不导出。翻译时，文档的文字按你点开的页发往你配置的翻译端点 —— 不是整份，也不是打开就发；图片与扫描页以图片形式发往同一端点识别，只在你的引擎支持识别图片时。'));
      priv.id = 'docv-privacy';
      wrap.append(priv);
      const m = el('p', 'docv-msg' + (bad ? ' bad' : ''), msg || ''); m.id = 'docv-msg'; m.hidden = !msg; wrap.append(m);
      const list = el('div', 'docv-list'); list.id = 'docv-list';
      let docs = [];
      try { docs = await deps.store.list(); } catch (_) { docs = []; }
      if (!docs.length) list.append(el('p', 'docv-msg', t('doc_list_empty', '还没有上传过文档。支持 PDF、Word（.docx）、纯文本、图片。')));
      for (const d of docs) {
        const row = el('div', 'docv-row'); row.dataset.docId = d.id;
        const title = el('span', 'title', d.title || d.id); title.addEventListener('click', () => openDoc(d.id, d.lastPage || 1));
        const meta = el('span', 'meta', t('doc_row_meta', '{pages} 页 · 读到第 {page} 页 · 已采 {n} 句').replace('{pages}', String(d.pages || 0)).replace('{page}', String(d.lastPage || 1)).replace('{n}', String((d.captured && d.captured.total) || 0)));
        const del = el('button', '', t('doc_delete', '删除')); del.type = 'button';
        del.addEventListener('click', async () => {
          if (!(await deps.confirm(t('doc_delete_confirm', '删除这份文档？它的卡也会一并删除（会同步到所有设备），不可恢复。')))) return;
          try { await deps.onDelete(d.id); } catch (_) {}
          showList();
        });
        row.append(title, meta, del); list.append(row);
      }
      wrap.append(list);
      up.addEventListener('click', () => upload());
    }

    // ── 上传 ────────────────────────────────────────────────────────────
    async function upload() {
      const file = await deps.pickFile();
      if (!file) return;
      const s = await settings();
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const kind = DocCore.sniffKind(file.name, head);
      if (kind === 'unsupported') { showList(t('doc_unsupported_kind', '不支持这种格式（支持 PDF、.docx、纯文本、图片）。.doc 请在 Word 里另存为 .docx。'), true); return; }
      if (file.size > DocCore.CAPS.MAX_FILE_BYTES) { showList(t('doc_too_large', '文件太大（上限 30 MB）。'), true); return; }
      // 免费额度在用 ⇒ 图片在选文件那一刻就拦：不读取、不入库、不发请求（用户裁定 2026-09-11）。
      if (kind === 'image' && deps.grantActive(s)) { track('doc_open', { kind: 'image', pages: 0 }); showList(t('doc_grant_no_image', '免费额度不能识别图片 —— 用自己的 API key。'), true); return; }
      if (kind === 'image' && deps.visionOf(s) === false) { showList(t('doc_no_vision', '当前引擎不支持识别图片 · 去设置换模型'), true); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = DocCore.docId(bytes, file.name);
      let existing = null; try { existing = await deps.store.get(id); } catch (_) {}
      const rec = existing || { id, title: file.name, kind, pages: 0, size: bytes.length, addedAt: Date.now(), lastPage: 1, captured: { total: 0, byPage: {} }, lang: '' };
      rec.openedAt = Date.now();
      if (kind === 'image') rec.image = await deps.blobToDataUrl(file, 1600);
      else rec.bytes = bytes;
      try { await deps.store.put(rec); await deps.store.evict(DocCore.CAPS.MAX_DOCS); } catch (e) { showList(t('doc_store_failed', '保存文档失败：') + ((e && e.message) || ''), true); return; }
      openDoc(id, rec.lastPage || 1);
    }

    // ── 打开一份文档 ────────────────────────────────────────────────────
    async function openDoc(id, page) {
      stopEngine();
      const rec = await deps.store.get(id);
      if (!rec) { showList(t('doc_missing', '这份文档已不在本机。'), true); return; }
      state.view = 'doc'; state.doc = rec; state.epoch++;
      const epoch = state.epoch;
      wrap.textContent = '';
      wrap.append(el('p', 'docv-msg', t('doc_opening', '正在读取…')));
      let reader;
      try {
        if (rec.kind === 'pdf') reader = await DocReader.openPdf(rec.bytes, await deps.pdfjs());
        else if (rec.kind === 'docx') reader = await DocReader.openDocx(rec.bytes);
        else if (rec.kind === 'txt') reader = DocReader.openText(rec.bytes);
        else if (rec.kind === 'image') reader = { kind: 'image', pages: 1, textOf: async () => [], imageOf: async () => rec.image, close() {} };
        else throw new Error('unsupported');
      } catch (e) {
        if (epoch !== state.epoch) return;
        showList(t('doc_open_failed', '读不了这份文档：') + ((e && (e.code || e.message)) || ''), true); return;
      }
      if (epoch !== state.epoch) { try { reader.close(); } catch (_) {} return; }
      state.reader = reader;
      if (rec.pages !== reader.pages) { rec.pages = reader.pages; try { await deps.store.put(rec); } catch (_) {} }
      track('doc_open', { kind: rec.kind, pages: reader.pages });
      state.okSent = false;
      state.counters = { page: Object.assign({}, (rec.captured && rec.captured.byPage) || {}), total: (rec.captured && rec.captured.total) || 0 };
      renderShell();
      await gotoPage(Math.min(Math.max(1, page || 1), reader.pages));
    }

    let shell = null;
    function renderShell() {
      wrap.textContent = '';
      const top = el('div', 'docv-top');
      const back = el('button', 'docv-back', '← ' + t('doc_back', '文档列表')); back.id = 'docv-back'; back.type = 'button';
      back.addEventListener('click', () => showList());
      const title = el('strong', '', state.doc.title || ''); title.id = 'docv-title';
      const langBox = el('label', 'docv-lang'); langBox.append(el('span', '', t('doc_lang', '文档语言')));
      const sel = el('select'); sel.id = 'docv-lang';
      const auto = el('option', '', t('doc_lang_auto', '自动')); auto.value = ''; sel.append(auto);
      for (const l of (deps.langs || [])) { const o = el('option', '', l.labelKey ? t(l.labelKey, l.label) : l.label); o.value = l.code; sel.append(o); }
      sel.value = state.doc.lang || '';
      sel.addEventListener('change', async () => { state.doc.lang = sel.value; try { await deps.store.put(state.doc); } catch (_) {} });
      langBox.append(sel);
      top.append(back, title, el('span', 'spacer'), langBox);
      const pager = el('div', 'docv-pager'); pager.id = 'docv-pager';
      const prev = el('button', '', '‹ ' + t('doc_prev', '上一页')); prev.id = 'docv-prev'; prev.type = 'button';
      const next = el('button', '', t('doc_next', '下一页') + ' ›'); next.id = 'docv-next'; next.type = 'button';
      const pos = el('span', 'stat'); pos.id = 'docv-pos';
      const stat = el('span', 'stat'); stat.id = 'docv-stat';
      prev.addEventListener('click', () => gotoPage(state.cur - 1));
      next.addEventListener('click', () => gotoPage(state.cur + 1));
      pager.append(prev, pos, next, stat);
      const msg = el('p', 'docv-msg'); msg.id = 'docv-page-msg'; msg.hidden = true;
      const page = el('div', 'docv-page'); page.id = 'docv-page';
      wrap.append(top, pager, msg, page);
      shell = { prev, next, pos, stat, msg, page };
    }

    // ── 翻页：只有当前页（+ 可选下一页）进 selectActive ───────────────────
    async function gotoPage(n) {
      const reader = state.reader; if (!reader) return;
      n = Math.min(Math.max(1, n), reader.pages);
      state.cur = n; state.epoch++;
      const epoch = state.epoch;
      shell.pos.textContent = n + ' / ' + reader.pages;
      shell.prev.disabled = n <= 1; shell.next.disabled = n >= reader.pages;
      shell.page.textContent = '';
      shell.msg.hidden = true; shell.msg.className = 'docv-msg';
      const s = await settings();
      let units;
      try { units = await unitsForPage(n, s, epoch); }
      catch (e) {
        // 解析这一页失败（例：Safari 上 pdf.js getTextContent 抛错）—— 必须说话，不能留一页空白
        if (epoch !== state.epoch) return;
        pageMessage(t('doc_open_failed', '读不了这份文档：') + ((e && (e.code || e.message)) || ''), true); return;
      }
      if (epoch !== state.epoch) return;
      state.doc.lastPage = n; try { await deps.store.touch(state.doc.id, { lastPage: n }); } catch (_) {}
      if (!units) return;   // 页级提示已经显示（扫描页被拦 / 引擎不支持）
      startEngine(units, s);
      // 预取下一页：只解析，不翻译（翻译由 selectActive 决定；默认关）
      if (s.docPrefetch && n < reader.pages) unitsForPage(n + 1, s, epoch).catch(() => {});
    }

    // 一页的单元：优先本机缓存；PDF 无文字层 ⇒ 识图（受额度 / vision 门控）。
    async function unitsForPage(n, s, epoch) {
      const id = state.doc.id;
      let cached = null; try { cached = await deps.store.getPage(id, n); } catch (_) {}
      let paras = cached && Array.isArray(cached.paras) ? cached.paras : null;
      let ocrUsed = !!(cached && cached.ocr);
      if (!paras) {
        paras = await state.reader.textOf(n);
        if (epoch !== state.epoch) return null;
        if (!paras.length && state.reader.imageOf) {
          // 扫描页 / 图片：额度在用 ⇒ 拦（用户裁定）；引擎不支持 ⇒ 说明并 0 次请求。
          if (deps.grantActive(s)) { pageMessage(t('doc_grant_no_image', '免费额度不能识别图片 —— 用自己的 API key。'), true, '#quick'); return null; }
          if (deps.visionOf(s) === false) { pageMessage(t('doc_no_vision', '当前引擎不支持识别图片 · 去设置换模型'), true, '#engine'); return null; }
          pageMessage(t('doc_ocr_running', '正在识别这一页…'), false);
          try {
            const dataUri = await state.reader.imageOf(n, 1600);
            const text = await deps.ocr(dataUri, s);
            if (epoch !== state.epoch) return null;
            paras = String(text || '').split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((x) => ({ text: x }));
            ocrUsed = true;
            shell.msg.hidden = true;
          } catch (e) {
            if (epoch !== state.epoch) return null;
            if (e && e.code === 'vision_unsupported') pageMessage(t('doc_no_vision', '当前引擎不支持识别图片 · 去设置换模型'), true, '#engine');
            else pageMessage(t('doc_ocr_failed', '识别失败：') + ((e && e.message) || ''), true);
            return null;
          }
          if (!paras.length) { pageMessage(t('doc_page_empty', '这一页没有可提取的文字。'), false); return []; }
        }
        try { await deps.store.putPage(id, n, { paras, ocr: ocrUsed }); } catch (_) {}
      }
      const units = DocCore.unitsFor(n, paras);
      // 译文缓存：同一引擎三元组才复用；不同则显示「用旧引擎译的 · 重译」
      if (cached && cached.tr && cached.triple === deps.engineTriple(s)) {
        units.forEach((u, i) => { if (cached.tr[i]) u.tr = cached.tr[i]; });
      } else if (cached && cached.tr && cached.triple && cached.triple !== deps.engineTriple(s)) {
        pageMessage(t('doc_old_engine', '这一页的译文是用旧引擎译的 —— 已按现在的引擎重译。'), false);
      }
      const st = DocCore.pageStats(units);
      shell.stat.textContent = t('doc_page_stat', '本页 {units} 段 · 约 {chars} 字').replace('{units}', String(st.units)).replace('{chars}', String(st.chars));
      return units;
    }
    function pageMessage(text, bad, hash) {
      shell.msg.textContent = text; shell.msg.className = 'docv-msg' + (bad ? ' bad' : ''); shell.msg.hidden = false;
      if (hash && deps.openSettings) { const a = el('a', '', ' ' + t('doc_go_settings', '去设置 →')); a.href = '#'; a.addEventListener('click', (e) => { e.preventDefault(); deps.openSettings(hash); }); shell.msg.append(a); }
    }

    // ── 页级引擎 ────────────────────────────────────────────────────────
    function stopEngine() { if (state.timer) { clearInterval(state.timer); state.timer = null; } state.engine = null; state.units = []; }
    function startEngine(units, s) {
      stopEngine();
      state.units = units;
      const cur = state.cur;
      const engine = TranslationCore.createEngine({
        translate: (text) => deps.translate(text, s),
        targetLang: () => (settingsCache && settingsCache.targetLang) || s.targetLang || TranslationCore.DEFAULT_TARGET_LANG,
        selectActive: (us) => us.filter((u) => u.page === cur),
        window: { AHEAD_MS: 0, GRACE_MS: 0, MAX_PER_TICK: 4, MAX_RETRIES: 3, RETRY_GAP_MS: 800 },
        onOk: () => { if (!state.okSent) { state.okSent = true; track('translate_ok', { provider: String(s.provider || ''), kind: 'doc', ms: 0 }); } },
        onFail: () => {},
      });
      engine.setUnits(units);
      state.engine = engine;
      renderPage(units, engine, s);
      state.timer = setInterval(() => tick(engine, s), TICK_MS);
      tick(engine, s);
    }
    let rows = new Map();
    function renderPage(units, engine, s) {
      shell.page.textContent = ''; rows = new Map();
      units.forEach((u, i) => {
        const row = el('div', 'docv-unit'); row.dataset.idx = String(i);
        const body = el('div', 'body');
        const orig = el('p', 'orig' + (u.heading ? ' heading' : ''), u.text);
        const tr = el('p', 'tr pending', t('doc_translating', '⏳ 翻译中…'));
        body.append(orig, tr);
        const star = el('button', 'star', '☆'); star.type = 'button'; star.title = t('doc_star', '收进复习');
        star.addEventListener('click', () => { u.starred = !u.starred; star.textContent = u.starred ? '★' : '☆'; star.classList.toggle('on', !!u.starred); if (u.starred) maybeWrite(u, s, true); });
        row.append(body, star); shell.page.append(row);
        rows.set(u, { tr, key: '' });
      });
    }
    function tick(engine, s) {
      if (state.engine !== engine) return;
      engine.pump();
      let changed = false;
      for (const u of state.units) {
        const r = rows.get(u); if (!r) continue;
        const st = engine.stateOf(u);
        const key = st.state + '|' + (st.translation ? 'T' : '');
        if (key === r.key) continue;
        r.key = key;
        if (st.translation) { r.tr.textContent = st.translation; r.tr.className = 'tr'; r.tr.onclick = null; maybeWrite(u, s, false); changed = true; }
        else if (st.state === 'error') { r.tr.textContent = t('doc_translate_failed', '翻译失败 · 点此重试'); r.tr.className = 'tr error'; r.tr.onclick = () => { engine.retry(u); r.key = ''; }; }
        else { r.tr.textContent = t('doc_translating', '⏳ 翻译中…'); r.tr.className = 'tr pending'; }
      }
      if (changed) persistTr(s);
    }
    let persistTimer = null;
    function persistTr(s) {
      if (persistTimer) return;
      persistTimer = setTimeout(async () => {
        persistTimer = null;
        if (!state.doc || !state.units.length) return;
        const tr = state.units.map((u) => u.tr || '');
        try { const cached = await deps.store.getPage(state.doc.id, state.cur); await deps.store.putPage(state.doc.id, state.cur, Object.assign({}, cached || {}, { paras: (cached && cached.paras) || null, tr, triple: deps.engineTriple(s) })); } catch (_) {}
      }, 600);
    }

    // ── 进语料（§9.7）：译文首次渲染即算「看过」；宿主写 ─────────────────
    async function maybeWrite(u, s, starred) {
      if (!u.tr || u._written) return;
      const pairs = (typeof LearnModel !== 'undefined' && LearnModel.splitPair) ? LearnModel.splitPair(u.text, u.tr, state.doc.lang || 'und', s.targetLang || '') : [{ text: u.text, tr: u.tr }];
      const cfg = { lang: state.doc.lang || 'und', targetLang: s.targetLang || '', captureOn: s.docCapture !== false, langs: s.learnRules && s.learnRules.langs, registry: deps.langs || [] };
      let wrote = 0;
      for (const p of pairs) {
        const unit = Object.assign({}, u, { starred: !!(starred || u.starred) });
        if (!DocCore.shouldWrite(unit, p, state.doc, cfg, deps.gates, state.counters)) continue;
        const draft = DocCore.draftFor(unit, p, state.doc, cfg);
        try { await deps.write(draft, DocCore.sourceFor(state.doc)); wrote++; } catch (_) { continue; }
        state.counters.page[state.cur] = (state.counters.page[state.cur] || 0) + 1; state.counters.total++;
      }
      u._written = true;
      if (wrote) { state.doc.captured = { total: state.counters.total, byPage: state.counters.page }; try { await deps.store.touch(state.doc.id, { captured: state.doc.captured }); } catch (_) {} }
    }

    showList();
    return { showList, openDoc, upload, state };
  }

  return { mount };
})();

if (typeof window !== 'undefined') window.DocView = DocView;
if (typeof module !== 'undefined' && module.exports) module.exports = DocView;
