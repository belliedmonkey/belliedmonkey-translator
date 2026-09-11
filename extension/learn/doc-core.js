// learn/doc-core.js — 文档翻译的**纯逻辑**（domain-design §2.5 / learning-design §9.7）。
//
// 两个宿主（扩展页 learn/docs.html、App 的 #app-docs）共用；无 DOM、无存储、无网络，
// 跑得进 test/harness 的 vm。这里放的是「怎么把一份文件变成一页页的单元」与「读过的
// 句对要不要进语料」这两件最容易说错的事 —— 界面那一半（doc-view.js）只做渲染。
//
//   sniffKind          文件是什么（魔数优先，后缀其次）
//   docId              内容地址（大小 + 头尾采样），同一文件在两端得到同一个 id
//   paragraphsFromTextItems   pdf.js 文本项 → 行 → 段
//   paginate           docx / 文本的段落 → 页（maxChars / maxParas，尊重分页提示）
//   unitsFor           一页的段落 → 引擎单元（超长段按句切；每页上限）
//   sourceFor / draftFor / shouldWrite   进语料的形状与七条门（§9.7）
'use strict';

var DocCore = (() => {
  // 用户裁定（2026-09-11）：每页最多 10 句、每份最多 100 句进语料。不做设置键。
  const CAPS = {
    PER_PAGE: 10, PER_DOC: 100,
    PAGE_MAX_CHARS: 1800, PAGE_MAX_PARAS: 60,   // docx / 文本分页
    PAGE_MAX_UNITS: 80, UNIT_SPLIT_CHARS: 1200,  // 每页单元上限；超长段按句切
    MAX_FILE_BYTES: 30 * 1024 * 1024, MAX_DOCS: 50,
    // 句长硬闸：BAND 是 taper 不是硬切（800 字段 salience≈0.577 仍过门），这里显式硬切。
    HARD_MAX_DENSE: 90, HARD_MAX_SPARSE: 330,
  };
  const has = (v) => !!String(v == null ? '' : v).trim();
  const DENSE = /[぀-ヿ㐀-䶿一-鿿가-힯฀-๿]/;

  // ─── 文件是什么 ─────────────────────────────────────────────────────
  function sniffKind(name, bytes) {
    const n = String(name || '').toLowerCase();
    const b = bytes && bytes.length ? bytes : null;
    const at = (i) => (b && b.length > i ? b[i] : -1);
    if (b && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return 'pdf';      // %PDF
    if (b && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image';    // PNG
    if (b && at(0) === 0xff && at(1) === 0xd8) return 'image';                                          // JPEG
    if (b && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image'; // WEBP
    if (b && at(0) === 0x50 && at(1) === 0x4b && at(2) === 0x03 && at(3) === 0x04) {                   // zip
      if (/\.docx$/.test(n)) return 'docx';
      if (/\.(pptx|xlsx|epub)$/.test(n)) return 'unsupported';
      return 'docx';   // 无后缀的 zip：当 docx 试，读不到 document.xml 再具名失败
    }
    if (b && at(0) === 0xd0 && at(1) === 0xcf && at(2) === 0x11 && at(3) === 0xe0) return 'unsupported'; // OLE (.doc/.xls/.ppt)
    if (/\.(pdf)$/.test(n)) return 'pdf';
    if (/\.(docx)$/.test(n)) return 'docx';
    if (/\.(png|jpe?g|webp)$/.test(n)) return 'image';
    if (/\.(txt|md|markdown|text)$/.test(n) || !/\.[a-z0-9]+$/.test(n)) return 'txt';
    return 'unsupported';
  }

  // ─── 内容地址 ───────────────────────────────────────────────────────
  // 大小 + 前后各 4 KB 采样。整份哈希对 30 MB 的文件是浪费，而这三样足以让同一文件在两端
  // 得到同一个 id（来源管理按它分组、语料按它挂 anchor）。hash16 复用 LearnModel 的。
  function fnv16(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let h2 = 0x811c9dc5 ^ s.length;
    for (let i = s.length - 1; i >= 0; i--) { h2 ^= s.charCodeAt(i); h2 = Math.imul(h2, 0x01000193) >>> 0; }
    return (h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  }
  function docId(bytes, name) {
    const b = bytes || new Uint8Array(0);
    const head = Array.from(b.subarray(0, 4096)).join(',');
    const tail = Array.from(b.subarray(Math.max(0, b.length - 4096))).join(',');
    const s = b.length + '\0' + head + '\0' + tail;
    const h = (typeof LearnModel !== 'undefined' && LearnModel.hash16) ? LearnModel.hash16(s) : fnv16(s);
    return h;
  }
  function stripExt(name) { return String(name || '').replace(/\.[a-z0-9]+$/i, ''); }

  // ─── pdf.js 文本项 → 段落 ───────────────────────────────────────────
  // items: [{ str, transform: [a,b,c,d,x,y], width, height, hasEOL }]（getTextContent().items）。
  // 行 = y 相近（|dy| < 0.5 行高）的项按 x 排序拼起来；段 = 行距明显大于行高（> 1.45×）或
  // 空行处断开。页码行（纯数字、短）丢掉。双栏 / 表格不做特判 —— 那是 v2 的 fixture。
  function paragraphsFromTextItems(items) {
    const list = (items || []).filter((it) => it && typeof it.str === 'string' && it.str.trim() && Array.isArray(it.transform));
    if (!list.length) return [];
    const rows = list.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || Math.abs(it.height) || 10, w: it.width || 0 }));
    rows.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines = [];
    for (const r of rows) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - r.y) < 0.5 * Math.max(last.h, r.h)) { last.items.push(r); last.h = Math.max(last.h, r.h); }
      else lines.push({ y: r.y, h: r.h, items: [r] });
    }
    for (const ln of lines) {
      ln.items.sort((a, b) => a.x - b.x);
      let s = '';
      for (const it of ln.items) {
        if (!s) { s = it.str; continue; }
        const dense = DENSE.test(s.slice(-1)) && DENSE.test(it.str[0]);
        s += (dense || /\s$/.test(s) || /^\s/.test(it.str) ? '' : ' ') + it.str;
      }
      ln.text = s.replace(/\s+/g, ' ').trim();
      ln.x = ln.items[0].x;
    }
    const paras = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.text || /^\d{1,4}$/.test(ln.text)) continue;   // 页码行
      const prev = i > 0 ? lines[i - 1] : null;
      const gap = prev ? (prev.y - ln.y) : 0;
      const newPara = !cur || !prev || gap > 1.45 * Math.max(prev.h, ln.h) || (ln.x - (cur.x || ln.x)) > 1.5 * ln.h;
      if (newPara) { cur = { text: ln.text, x: ln.x }; paras.push(cur); }
      else {
        const dense = DENSE.test(cur.text.slice(-1)) && DENSE.test(ln.text[0]);
        cur.text += (dense ? '' : ' ') + ln.text;
      }
    }
    return paras.map((p) => ({ text: p.text }));
  }

  // ─── docx / 文本的段落 → 页 ─────────────────────────────────────────
  function paginate(paras, opts) {
    const o = Object.assign({ maxChars: CAPS.PAGE_MAX_CHARS, maxParas: CAPS.PAGE_MAX_PARAS }, opts || {});
    const pages = [];
    let cur = [], chars = 0;
    for (const p of paras || []) {
      const text = p && p.text ? String(p.text).trim() : '';
      if (!text) continue;
      const wants = (p.pageBreak && cur.length) || (cur.length && (chars + text.length > o.maxChars || cur.length >= o.maxParas));
      if (wants) { pages.push(cur); cur = []; chars = 0; }
      cur.push({ text, heading: !!p.heading }); chars += text.length;
    }
    if (cur.length) pages.push(cur);
    return pages;
  }

  // ─── 一页的段落 → 引擎单元 ─────────────────────────────────────────
  function splitLong(text, max) {
    const sents = (typeof LearnModel !== 'undefined' && LearnModel.splitSentences) ? LearnModel.splitSentences(text) : text.split(/(?<=[.!?。！？])\s*/);
    const out = []; let buf = '';
    for (const s of sents) {
      if (!s) continue;
      if (buf && (buf.length + s.length) > max) { out.push(buf.trim()); buf = ''; }
      buf += (buf && !DENSE.test(s[0]) ? ' ' : '') + s;
    }
    if (buf.trim()) out.push(buf.trim());
    return out.length ? out : [text];
  }
  function unitsFor(page, paras) {
    const units = [];
    (paras || []).forEach((p, i) => {
      const text = p && p.text ? String(p.text).trim() : '';
      if (!text) return;
      const parts = text.length > CAPS.UNIT_SPLIT_CHARS ? splitLong(text, CAPS.UNIT_SPLIT_CHARS) : [text];
      parts.forEach((t, j) => units.push({ page, idx: i, sub: j, text: t, heading: !!p.heading }));
    });
    // 每页上限：超出的合并进最后一个单元（不丢内容，只是少发几次请求）
    while (units.length > CAPS.PAGE_MAX_UNITS) {
      const last = units.pop(); units[units.length - 1].text += '\n' + last.text;
    }
    return units;
  }
  function pageStats(units) {
    return { units: (units || []).length, chars: (units || []).reduce((n, u) => n + (u.text ? u.text.length : 0), 0) };
  }

  // ─── 进语料（§9.7）───────────────────────────────────────────────────
  function sourceFor(doc) {
    return { id: 'doc:' + doc.id, url: 'doc://' + doc.id, title: stripExt(doc.title || doc.name || '') };
  }
  function draftFor(unit, pair, doc, cfg) {
    const c = cfg || {};
    const text = String((pair && pair.text) || '');
    return {
      text, tr: String((pair && pair.tr) || ''),
      lang: c.lang || 'und', targetLang: c.targetLang || '',
      kind: (pair && pair.kind) || 'sentence',
      sourceId: 'doc:' + doc.id,
      anchor: { k: 'doc', docId: doc.id, title: stripExt(doc.title || doc.name || ''), page: unit.page, quote: text.slice(0, 120) },
      playedThrough: true, dwellMs: 0,
      starred: !!(unit && unit.starred),
    };
  }
  // 七条门（顺序即优先级）。deps 注入 langAllowed / shouldCapture（纯函数，测试里可以假）。
  // counters: { page: {[n]: 已采数}, total } —— 由宿主维护并回写 DocStore。
  function shouldWrite(unit, pair, doc, cfg, deps, counters) {
    if (!unit || !pair || pair.written) return false;
    if (!has(pair.text) || !has(pair.tr)) return false;
    if (unit.starred) return true;                          // ★ 绕过一切门，含配额
    const c = cfg || {};
    if (c.captureOn === false) return false;
    const d = draftFor(unit, pair, doc, c);
    if (deps && deps.langAllowed && !deps.langAllowed(d.lang, d.text, c.langs, c.registry)) return false;
    const dense = DENSE.test(d.text);
    if (d.text.length > (dense ? CAPS.HARD_MAX_DENSE : CAPS.HARD_MAX_SPARSE)) return false;
    const k = counters || { page: {}, total: 0 };
    if (((k.page || {})[unit.page] || 0) >= CAPS.PER_PAGE) return false;
    if ((k.total || 0) >= CAPS.PER_DOC) return false;
    if (deps && deps.shouldCapture && !deps.shouldCapture(d)) return false;
    return true;
  }

  return { CAPS, sniffKind, docId, stripExt, paragraphsFromTextItems, paginate, unitsFor, pageStats, sourceFor, draftFor, shouldWrite, _fnv16: fnv16 };
})();

if (typeof window !== 'undefined') window.DocCore = DocCore;
if (typeof module !== 'undefined' && module.exports) module.exports = DocCore;
