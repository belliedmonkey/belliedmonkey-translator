// test/doc-zip.test.js — 自写 docx 读取（zip 目录 + deflate-raw + word/document.xml）。
// docx 字节在测试里**现造**（zlib.deflateRawSync），不提交二进制。
const zlib = require('zlib');
const { describe, test, ok, eq, deepEq, loadModule } = require('./harness');

function load() {
  const ctx = loadModule(['content/learn-model.js', 'learn/doc-core.js', 'learn/doc-reader.js'],
    { window: {}, DecompressionStream, Response, TextDecoder, TextEncoder, Blob, Uint8Array, Image: undefined, document: undefined });
  return ctx.DocReader;
}
const R = load();

// 最小 zip 写入器：stored (0) 或 deflate (8)。
function makeZip(files, method) {
  const enc = (s) => Buffer.from(s, 'utf8');
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc(text); const data = method === 8 ? zlib.deflateRawSync(raw) : raw; const n = enc(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    parts.push(lh, n, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, n);
    off += lh.length + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length / 2, 8); eocd.writeUInt16LE(central.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}
const DOC_XML = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title here</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">First </w:t></w:r><w:r><w:t>paragraph &amp; more.</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>tabbed</w:t></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>Second one with field.</w:t></w:r></w:p>
<w:p/>
<w:p><w:r><w:lastRenderedPageBreak/><w:t>Third on a new page.</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;

describe('DocReader.openDocx', () => {
  test('deflate (method 8)：段落、标题、tab、实体、域代码不混入、分页提示、表格内段落', async () => {
    const d = await R.openDocx(makeZip({ 'word/document.xml': DOC_XML, '[Content_Types].xml': '<x/>' }, 8));
    eq(d.kind, 'docx');
    const all = []; for (let n = 1; n <= d.pages; n++) all.push(...await d.textOf(n));
    deepEq(all.map((p) => p.text), ['Title here', 'First paragraph & more. tabbed', 'Second one with field.', 'Third on a new page.', 'Cell text']);
    ok(all[0].heading, 'Heading1 标为 heading');
    eq(d.pages, 2, 'lastRenderedPageBreak 处分页');
    eq((await d.textOf(2))[0].text, 'Third on a new page.');
  });
  test('stored (method 0) 也能读', async () => {
    const d = await R.openDocx(makeZip({ 'word/document.xml': DOC_XML }, 0));
    eq((await d.textOf(1))[0].text, 'Title here');
  });
  test('没有 word/document.xml ⇒ 具名 not_docx；不是 zip ⇒ bad_zip', async () => {
    let code = null; try { await R.openDocx(makeZip({ 'a.txt': 'x' }, 0)); } catch (e) { code = e.code; }
    eq(code, 'not_docx');
    code = null; try { await R.openDocx(new Uint8Array([1, 2, 3, 4, 5])); } catch (e) { code = e.code; }
    eq(code, 'bad_zip');
  });
  test('openText：空行分段、BOM、软换行并入一段', async () => {
    const d = R.openText(new TextEncoder().encode('﻿Para one line a\nline b\n\nPara two.\n'));
    const ps = await d.textOf(1);
    deepEq(ps.map((p) => p.text), ['Para one line a line b', 'Para two.']);
  });
  test('unescapeXml', () => { eq(R.unescapeXml('a &lt; b &amp; &#x4e2d; &#25991;'), 'a < b & 中 文'); });
});
