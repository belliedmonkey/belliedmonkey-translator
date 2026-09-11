// learn/doc-reader.js — 文档翻译的文件 IO（domain-design §2.5 规则 2）。
//
//   openPdf(bytes, pdfjs)   pdf.js（由 pdfjs-loader 注入，绝不在这里 import）：按页取文本 / 渲成图
//   openDocx(bytes)          自写 zip 目录解析 + DecompressionStream('deflate-raw') + word/document.xml 段落抽取
//   openText(bytes)          纯文本 / Markdown：空行分段
//   openImage(file, maxPx)   浏览器：缩到长边 maxPx 的 JPEG data URL（发多模态引擎识别用）
//
// 解析全在本机；这里不发任何网络请求。docx 只支持 method 0（stored）与 8（deflate）——
// 别的压缩法在 Word 产物里不存在。`.doc`（OLE）不做：零依赖下不值得写，界面明说另存为 .docx。
'use strict';

var DocReader = (() => {
  function named(code, detail) { const e = new Error(detail || code); e.code = code; return e; }

  // ─── zip ────────────────────────────────────────────────────────────
  function u16(b, i) { return b[i] | (b[i + 1] << 8); }
  function u32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + (b[i + 3] * 0x1000000); }
  function zipEntries(b) {
    // EOCD 从尾部找（注释最长 64 KB）
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65536); i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw named('bad_zip', 'no EOCD');
    const count = u16(b, eocd + 10), cdOff = u32(b, eocd + 16);
    const entries = new Map();
    let p = cdOff;
    const dec = new TextDecoder('utf-8');
    for (let n = 0; n < count; n++) {
      if (!(b[p] === 0x50 && b[p + 1] === 0x4b && b[p + 2] === 0x01 && b[p + 3] === 0x02)) throw named('bad_zip', 'central directory');
      const method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24);
      const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), lho = u32(b, p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { method, csize, usize, lho });
      p += 46 + nlen + xlen + clen;
    }
    return entries;
  }
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function zipRead(b, entries, name) {
    const e = entries.get(name);
    if (!e) return null;
    const p = e.lho;
    if (!(b[p] === 0x50 && b[p + 1] === 0x4b && b[p + 2] === 0x03 && b[p + 3] === 0x04)) throw named('bad_zip', 'local header');
    const nlen = u16(b, p + 26), xlen = u16(b, p + 28);
    const start = p + 30 + nlen + xlen;
    const raw = b.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateRaw(raw);
    throw named('unsupported_zip', 'method ' + e.method);
  }

  // ─── docx：word/document.xml → 段落 ─────────────────────────────────
  // 正则扫描而不是 DOMParser：两个宿主与 Node 测试都跑得动，且 w:p 不会嵌套。
  function unescapeXml(s) {
    return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, k) => {
      if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
      return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    });
  }
  function paragraphsFromDocumentXml(xml) {
    const paras = [];
    const re = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
    let m;
    while ((m = re.exec(xml))) {
      const body = m[1];
      let text = '';
      const tok = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\s*\/>/g;
      let t;
      while ((t = tok.exec(body))) {
        const s = t[0];
        if (s.startsWith('<w:tab')) text += ' ';
        else if (s.startsWith('<w:br') || s.startsWith('<w:cr')) text += '\n';
        else if (t[1] != null) text += unescapeXml(t[1]);
      }
      text = text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
      const style = /<w:pStyle\s+w:val="([^"]*)"/.exec(body);
      const heading = !!(style && /^(heading|title|Heading|Title)/.test(style[1]));
      const pageBreak = /<w:lastRenderedPageBreak\s*\/>/.test(body) || /<w:br\s+w:type="page"\s*\/>/.test(body);
      if (!text && !pageBreak) continue;
      if (!text) { if (paras.length) paras[paras.length - 1].breakAfter = true; continue; }
      paras.push({ text, heading, pageBreak: pageBreak || !!(paras.length && paras[paras.length - 1].breakAfter) });
    }
    return paras.map((p) => ({ text: p.text, heading: p.heading, pageBreak: p.pageBreak }));
  }
  async function openDocx(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const entries = zipEntries(b);
    const xmlBytes = await zipRead(b, entries, 'word/document.xml');
    if (!xmlBytes) throw named('not_docx', 'word/document.xml missing');
    const xml = new TextDecoder('utf-8').decode(xmlBytes);
    const paras = paragraphsFromDocumentXml(xml);
    const pages = DocCore.paginate(paras);
    return { kind: 'docx', pages: pages.length, textOf: async (n) => pages[n - 1] || [], imageOf: null, close() {} };
  }

  // ─── 纯文本 ─────────────────────────────────────────────────────────
  function openText(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let text = new TextDecoder('utf-8').decode(b);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const paras = text.split(/\r?\n\s*\r?\n/).map((s) => s.replace(/\s*\r?\n\s*/g, ' ').trim()).filter(Boolean).map((t) => ({ text: t }));
    const pages = DocCore.paginate(paras);
    return { kind: 'txt', pages: pages.length, textOf: async (n) => pages[n - 1] || [], imageOf: null, close() {} };
  }

  // ─── PDF（pdf.js 由调用方注入）─────────────────────────────────────
  async function openPdf(bytes, pdfjs) {
    if (!pdfjs || !pdfjs.getDocument) throw named('no_pdfjs', 'pdf.js not loaded');
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
    const doc = await task.promise;
    return {
      kind: 'pdf', pages: doc.numPages,
      // 文本层：pdf.js 文本项 → 段落；空（扫描件）⇒ []，调用方按 vision 决定要不要发图。
      textOf: async (n) => {
        const p = await doc.getPage(n);
        const tc = await p.getTextContent();
        return DocCore.paragraphsFromTextItems(tc.items);
      },
      // 渲成长边 maxPx 的 JPEG（识图用）。只在浏览器里有 canvas。
      imageOf: async (n, maxPx) => {
        const p = await doc.getPage(n);
        const long = Math.max(p.view[2] - p.view[0], p.view[3] - p.view[1]) || 1;
        const vp = p.getViewport({ scale: (maxPx || 1600) / long });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        return c.toDataURL('image/jpeg', 0.8);
      },
      close() { try { doc.destroy(); } catch (_) {} },
    };
  }

  // ─── 图片：缩放成 JPEG data URL ─────────────────────────────────────
  function openImage(file, maxPx) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const long = Math.max(img.naturalWidth, img.naturalHeight) || 1;
          const scale = Math.min(1, (maxPx || 1600) / long);
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          const dataUrl = c.toDataURL('image/jpeg', 0.85);
          resolve({ kind: 'image', pages: 1, textOf: async () => [], imageOf: async () => dataUrl, close() {} });
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(named('bad_image', 'decode failed')); };
      img.src = url;
    });
  }

  // 统一入口：按 DocCore.sniffKind 分派。pdfjs 由宿主给（可能是 null ⇒ PDF 报 no_pdfjs）。
  async function open(name, bytes, opts) {
    const o = opts || {};
    const kind = DocCore.sniffKind(name, bytes);
    if (kind === 'pdf') return openPdf(bytes, o.pdfjs);
    if (kind === 'docx') return openDocx(bytes);
    if (kind === 'txt') return openText(bytes);
    if (kind === 'image') { if (!o.file) throw named('bad_image', 'need a File'); return openImage(o.file, o.maxPx); }
    throw named('unsupported', name);
  }

  return { open, openPdf, openDocx, openText, openImage, zipEntries, zipRead, paragraphsFromDocumentXml, unescapeXml };
})();

if (typeof window !== 'undefined') window.DocReader = DocReader;
if (typeof module !== 'undefined' && module.exports) module.exports = DocReader;
