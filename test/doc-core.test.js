// test/doc-core.test.js — 文档翻译的纯逻辑（learning-design §9.7 / domain-design §2.5）。
const { describe, test, ok, eq, deepEq, loadModule } = require('./harness');

function load() {
  const ctx = loadModule(['content/learn-model.js', 'learn/doc-core.js'], { window: {} });
  return ctx.DocCore;
}
const D = load();
const bytesOf = (s) => new TextEncoder().encode(s);

describe('DocCore.sniffKind — 魔数优先，后缀其次', () => {
  test('魔数', () => {
    eq(D.sniffKind('x.bin', bytesOf('%PDF-1.4 ...')), 'pdf');
    eq(D.sniffKind('a.docx', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), 'docx');
    eq(D.sniffKind('a.pptx', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), 'unsupported');
    eq(D.sniffKind('a.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), 'unsupported', '.doc 是 OLE，明说不支持');
    eq(D.sniffKind('p.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'image');
    eq(D.sniffKind('p.jpg', new Uint8Array([0xff, 0xd8, 0xff])), 'image');
  });
  test('后缀', () => {
    eq(D.sniffKind('notes.md', bytesOf('# hi')), 'txt');
    eq(D.sniffKind('README', bytesOf('hi')), 'txt');
    eq(D.sniffKind('a.epub', bytesOf('zz')), 'unsupported');
  });
});

describe('DocCore.docId — 内容地址，两端一致', () => {
  test('同内容同 id；大小或首尾不同则不同；与文件名无关', () => {
    const a = bytesOf('hello world '.repeat(1000));
    eq(D.docId(a, 'a.txt'), D.docId(a, 'b.txt'));
    ok(D.docId(a, 'a') !== D.docId(bytesOf('hello world '.repeat(1001)), 'a'));
    eq(D.docId(a, 'a').length, 16);
  });
});

describe('DocCore.paragraphsFromTextItems — pdf.js 文本项 → 段', () => {
  const it = (str, x, y, h) => ({ str, transform: [h || 12, 0, 0, h || 12, x, y], width: str.length * 6, height: h || 12 });
  test('同一行的项按 x 拼接；行距大的地方断段；页码行丢掉', () => {
    // 行距 14（1.17 × 12 号字）算同一段；段间 46 断开；页码单独在页脚。
    const items = [
      it('Second line of', 40, 686), it('paragraph one.', 130, 686),
      it('First line of', 40, 700), it('paragraph one', 120, 700),
      it('Paragraph two starts here.', 40, 640),
      it('12', 300, 40),
    ];
    const paras = D.paragraphsFromTextItems(items).map((p) => p.text);
    deepEq(paras, ['First line of paragraph one Second line of paragraph one.', 'Paragraph two starts here.']);
  });
  test('CJK 行之间不加空格', () => {
    const items = [it('第一行中文', 40, 700), it('第二行中文', 40, 686)];
    eq(D.paragraphsFromTextItems(items)[0].text, '第一行中文第二行中文');
  });
  test('空输入 ⇒ []（扫描页的形状）', () => { deepEq(D.paragraphsFromTextItems([]), []); deepEq(D.paragraphsFromTextItems(null), []); });
});

describe('DocCore.paginate / unitsFor / pageStats', () => {
  test('按 maxChars / maxParas 分页；分页提示处必断；空段跳过', () => {
    const paras = [{ text: 'a'.repeat(1000) }, { text: 'b'.repeat(900) }, { text: '' }, { text: 'c', pageBreak: true }, { text: 'd' }];
    const pages = D.paginate(paras, { maxChars: 1800, maxParas: 60 });
    eq(pages.length, 3);
    eq(pages[0].length, 1); eq(pages[1].length, 1); deepEq(pages[2].map((p) => p.text), ['c', 'd']);
    eq(D.paginate([{ text: 'x' }, { text: 'y' }, { text: 'z' }], { maxParas: 2 }).length, 2);
  });
  test('超过 UNIT_SPLIT_CHARS 的段按句切成多单元；每页单元数封顶', () => {
    const long = 'This is a sentence. '.repeat(120);   // 2400 字
    const u = D.unitsFor(3, [{ text: long }, { text: 'short' }]);
    ok(u.length >= 3, '长段应切成 ≥ 2 个单元 + 1 个短段');
    ok(u.every((x) => x.text.length <= D.CAPS.UNIT_SPLIT_CHARS + 30), '每个单元不超过上限');
    ok(u.every((x) => x.page === 3));
    const many = D.unitsFor(1, Array.from({ length: 200 }, (_, i) => ({ text: 'p' + i })));
    eq(many.length, D.CAPS.PAGE_MAX_UNITS);
    ok(/p199$/.test(many[many.length - 1].text), '超出的合并进最后一个单元，不丢内容');
    const st = D.pageStats(u); eq(st.units, u.length); ok(st.chars > 2400);
  });
});

describe('DocCore.draftFor / shouldWrite — §9.7 七条门', () => {
  const doc = { id: 'abc', title: '合同草案.pdf' };
  const unit = { page: 4, idx: 0, text: 'x' };
  const cfg = { lang: 'en', targetLang: 'zh-CN', captureOn: true };
  const pair = { text: 'A sentence that is long enough to pass the lower band.', tr: '一句够长的话。' };
  const yes = { langAllowed: () => true, shouldCapture: () => true };
  test('draftFor 的形状：anchor.k=doc、sourceId=doc:<id>、playedThrough', () => {
    const d = D.draftFor(unit, pair, doc, cfg);
    eq(d.sourceId, 'doc:abc'); eq(d.anchor.k, 'doc'); eq(d.anchor.docId, 'abc'); eq(d.anchor.page, 4); eq(d.anchor.title, '合同草案');
    eq(d.playedThrough, true); eq(d.kind, 'sentence'); eq(d.lang, 'en');
    deepEq(D.sourceFor(doc), { id: 'doc:abc', url: 'doc://abc', title: '合同草案' });
  });
  test('1 已写过 / 无 tr ⇒ 否', () => {
    ok(!D.shouldWrite(unit, Object.assign({}, pair, { written: true }), doc, cfg, yes));
    ok(!D.shouldWrite(unit, { text: 'x', tr: '' }, doc, cfg, yes));
  });
  test('2 ★ 绕过一切（含配额与开关）', () => {
    ok(D.shouldWrite({ page: 1, starred: true }, pair, doc, { captureOn: false }, { langAllowed: () => false, shouldCapture: () => false }, { page: { 1: 99 }, total: 999 }));
  });
  test('3 docCapture 关 ⇒ 否', () => ok(!D.shouldWrite(unit, pair, doc, Object.assign({}, cfg, { captureOn: false }), yes)));
  test('4 语言白名单', () => ok(!D.shouldWrite(unit, pair, doc, cfg, { langAllowed: () => false, shouldCapture: () => true })));
  test('5 句长硬闸：330 字符 / 90 字', () => {
    ok(!D.shouldWrite(unit, { text: 'w'.repeat(331), tr: 't' }, doc, cfg, yes));
    ok(!D.shouldWrite(unit, { text: '字'.repeat(91), tr: 't' }, doc, cfg, yes));
    ok(D.shouldWrite(unit, { text: 'w'.repeat(330), tr: 't' }, doc, cfg, yes));
  });
  test('6 配额：每页 10、每份 100', () => {
    ok(!D.shouldWrite(unit, pair, doc, cfg, yes, { page: { 4: 10 }, total: 5 }));
    ok(D.shouldWrite(unit, pair, doc, cfg, yes, { page: { 4: 9 }, total: 5 }));
    ok(!D.shouldWrite(unit, pair, doc, cfg, yes, { page: { 4: 0 }, total: 100 }));
  });
  test('7 LearnModel.shouldCapture 最后把关', () => ok(!D.shouldWrite(unit, pair, doc, cfg, { langAllowed: () => true, shouldCapture: () => false })));
});
