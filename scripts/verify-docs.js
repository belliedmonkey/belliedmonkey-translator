#!/usr/bin/env node
// scripts/verify-docs.js — 「文档翻译」真 Chrome 端到端（Node ≥22）。npm run test:docs
//
// 门禁守的不是「页面画出来了」，而是**发了几次请求、发的是哪一页**：整份文档一次性翻掉、
// 翻页时把上一页再发一遍、并发没有上限、免费额度下把图片发出去 —— 这些都不会让任何一个
// 纯逻辑用例变红，界面上也看不出来。所以这里用一个本机假 chat 端点把每一次请求记下来，
// 断言的是它收到的东西。
//
// 场景：
//   ① 3 页 PDF（现造，标准字体）→ 第 1 页出译文，且假端点只收到第 1 页的段落
//   ② 点「下一页」→ 第 2 页的段落才被请求；第 1 页不重发
//   ③ 并发峰值 ≤ reqConcurrency（种 3）
//   ④ 现造 docx（lastRenderedPageBreak 分两页）→ 分页 + 第 1 页译文
//   ⑤ PNG（引擎不声明 vision）→ 恰好 1 次 image_url 请求 + 文本翻译
//   ⑥ 关闭重开同一份 PDF → 0 次新请求（本机缓存）
//   ⑦ 语料里出现 anchor.k==='doc'，每页 ≤ CAPS.PER_PAGE，sources 有 doc://
//   ⑧ vision:false 的引擎上传图片 → 「去设置换模型」且 0 次请求
//   ⑨ 免费额度在用 → 上传图片即拦，0 次请求（用户裁定 2026-09-11）
//   App 段（dist-app，出货布局）：首页入口可见 → 进视图 → 同一份 PDF 走 __MT_PDFJS 的 blob 路 →
//     只发第 1 页 → 返回后 [hidden] 真隐藏；设置页有「文档译文进复习」开关
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const { launchChrome } = require(path.join(ROOT, 'test/layout/chrome.js'));
const { CDP } = require(path.join(ROOT, 'test/layout/cdp.js'));
const { sandboxDist } = require(path.join(ROOT, 'scripts/lib/dist-sandbox.js'));
const DocCore = require(path.join(ROOT, 'extension/learn/doc-core.js'));

const CONC = 3;
let ok = true;
const fail = (m) => { ok = false; console.log('  ✗ ' + m); };
const pass = (m) => console.log('  ✓ ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('\n✗ 超时'); process.exit(2); }, 180000).unref();

// ── fixtures（现造，不提交二进制）──────────────────────────────────────
// 第 1 页故意排成 6 个独立段落（段间空一行 > 1.45 倍行高）：并发峰值要能被观察到才算数 ——
// 一段一请求的页测出来的「峰值 1 ≤ 3」什么也没证明。
const PAGE_LINES = [
  ['Chapter one begins on the first page.', '', 'The lead time is four weeks and the unit price is twelve dollars.', '', 'Nothing here belongs to page two.', '',
   'Payment is due within thirty days of the invoice date.', '', 'Late payments accrue interest at one percent per month.', '', 'This offer is valid until the end of the quarter.'],
  ['Page two starts a fresh section.', 'Shipping is included for orders above one hundred units.', 'A signature is required on delivery.'],
  ['The third page closes the document.', 'All prices are quoted in United States dollars.', 'Thank you for reading to the end.'],
];
function makePdf(pages) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  const kidsIdx = objs.length + 1 + pages.length * 2; // pages tree object comes last
  for (const lines of pages) {
    const content = 'BT /F1 12 Tf 72 720 Td 14 TL ' + lines.map((l) => l ? '(' + l.replace(/[()\\]/g, '\\$&') + ') Tj T*' : 'T*').join(' ') + ' ET';
    const c = add('<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream');
    const p = add('<< /Type /Page /Parent ' + kidsIdx + ' 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + font + ' 0 R >> >> /Contents ' + c + ' 0 R >>');
    pageIds.push(p);
  }
  const tree = add('<< /Type /Pages /Kids [' + pageIds.map((i) => i + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
  if (tree !== kidsIdx) throw new Error('pdf fixture: pages tree index mismatch');
  const cat = add('<< /Type /Catalog /Pages ' + tree + ' 0 R >>');
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out);
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + cat + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
function makeZip(files) {
  const enc = (s) => Buffer.from(s, 'utf8');
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc(text); const data = zlib.deflateRawSync(raw); const n = enc(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    parts.push(lh, n, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, n);
    off += lh.length + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length / 2, 8); eocd.writeUInt16LE(central.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
const DOCX_XML = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Terms of the agreement</w:t></w:r></w:p>
<w:p><w:r><w:t>The first paragraph of the contract sets the delivery window at four weeks.</w:t></w:r></w:p>
<w:p><w:r><w:t>The second paragraph fixes the unit price at twelve dollars.</w:t></w:r></w:p>
<w:p><w:r><w:lastRenderedPageBreak/><w:t>The second page describes the warranty terms in detail.</w:t></w:r></w:p>
</w:body></w:document>`;
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function makePng(w, h) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 30 + (x % 200); raw[o + 2] = 90; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-docs-fx-'));
  const PDF = path.join(tmp, 'contract.pdf'); fs.writeFileSync(PDF, makePdf(PAGE_LINES));
  const DOCX = path.join(tmp, 'agreement.docx'); fs.writeFileSync(DOCX, makeZip({ '[Content_Types].xml': '<x/>', 'word/document.xml': DOCX_XML }));
  const PNG = path.join(tmp, 'scan.png'); fs.writeFileSync(PNG, makePng(96, 64));

  // ── 假 chat 端点：记每次请求的文本、是否带图、在飞峰值 ──────────────────
  const calls = []; let inflight = 0, peak = 0;
  const srv = http.createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    let body = ''; q.on('data', (c) => { body += c; });
    q.on('end', async () => {
      inflight++; peak = Math.max(peak, inflight);
      let j = {}; try { j = JSON.parse(body); } catch (_) {}
      const user = (j.messages || []).find((m) => m.role === 'user') || {};
      const parts = Array.isArray(user.content) ? user.content : [{ type: 'text', text: String(user.content || '') }];
      const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      const image = parts.some((p) => p.type === 'image_url');
      calls.push({ text, image });
      await sleep(250);          // 让并发真的叠起来
      inflight--;
      r.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      const reply = image ? 'Recognised line one of the scan.\n\nRecognised line two of the scan.' : '【译】' + text.slice(0, 40);
      r.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port;
  const ENDPOINT = `http://127.0.0.1:${port}/v1/chat/completions`;
  const runDist = sandboxDist(path.join(ROOT, 'dist'), { telemetry: false });

  const chrome = await launchChrome();
  let cdp;
  try {
    cdp = await CDP.connect(chrome.port);
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: runDist });
    const extId = loaded && loaded.id;
    if (!extId) throw new Error('拿不到扩展 id');
    await sleep(800);
    const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/learn/docs.html` });
    const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('DOM.enable', {}, sid);
    const logs = [];
    cdp.on('Runtime.exceptionThrown', (p, s) => { if (s === sid) logs.push('EXC ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)); });
    cdp.on('Runtime.consoleAPICalled', (p, s) => { if (s === sid && (p.type === 'error' || p.type === 'warning')) logs.push(p.type + ' ' + p.args.map((a) => a.value || a.description || '').join(' ')); });
    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
      return r.result ? r.result.value : undefined;
    };
    const storageSet = (o) => ev(`new Promise(r => chrome.storage.local.set(${JSON.stringify(o)}, r))`);
    const storageRemove = (k) => ev(`new Promise(r => chrome.storage.local.remove(${JSON.stringify(k)}, r))`);
    const reload = async () => { await cdp.send('Page.reload', {}, sid); await sleep(1500); };
    // 上传：点真按钮（pickFile 由此挂上 change 监听并 input.click()）。无头下 input.click() 没有
    // 用户激活，系统选择器不弹 —— 于是直接往 #docs-file 塞文件，CDP 会派发 change，pickFile 照常 resolve。
    // 这条路验的仍是真按钮 → 真 <input> → 真 change 事件，只是跳过了系统对话框那一层。
    const upload = async (file) => {
      await ev(`document.getElementById('docv-upload').click(); 1`);
      await sleep(100);
      const { root } = await cdp.send('DOM.getDocument', { depth: 1 }, sid);
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#docs-file' }, sid);
      if (!nodeId) throw new Error('#docs-file 不在');
      await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId }, sid);
    };
    const waitFor = async (expr, ms, label) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(200); }
      fail(label + '（等了 ' + ms + ' ms）');
      try { console.log('    页面：' + (await ev(`document.getElementById('docs-root').innerText.slice(0, 300)`)).replace(/\n/g, ' ⏎ ')); } catch (_) {}
      if (logs.length) console.log('    控制台：' + logs.slice(-5).join('\n    ').slice(0, 800));
      return false;
    };
    const rowsDone = `(() => { const rs = [...document.querySelectorAll('#docv-page .docv-unit .tr')]; return rs.length > 0 && rs.every(x => !x.classList.contains('pending')); })()`;

    // 引擎：自定义 chat 端点指本机；并发 3；语料采集开
    await storageSet({ provider: 'custom_chat', apiKey: 'test-key', apiBaseUrl: ENDPOINT, apiModel: 'fake-model', targetLang: 'zh-CN',
      reqConcurrency: CONC, learnEnabled: true, docCapture: true, onboardSeen: true });
    await reload();
    if (!(await ev(`!!document.getElementById('docv-upload')`))) throw new Error('文档页没起来（#docv-upload 不在）');
    const privacy = await ev(`(document.getElementById('docv-privacy') || {}).textContent || ''`);
    if (privacy.length < 40) fail('页内没有隐私句（Gate G 构成要件）'); else pass('页内隐私句在');

    // ① 3 页 PDF → 只发第 1 页
    console.log('① PDF 第 1 页');
    await upload(PDF);
    await waitFor(`!!document.getElementById('docv-page')`, 8000, 'PDF 没打开成阅读器');
    const pos = await ev(`(document.getElementById('docv-pos')||{}).textContent`);
    if (pos !== '1 / 3') fail(`页码不是 1 / 3：${pos}`); else pass('3 页 PDF 读出 3 页');
    await waitFor(rowsDone, 15000, '第 1 页译文没到齐');
    const n1 = calls.length;
    const p1Texts = calls.map((c) => c.text);
    const leaked = p1Texts.filter((t) => [...PAGE_LINES[1], ...PAGE_LINES[2]].some((l) => t.includes(l.split(' ').slice(0, 3).join(' '))));
    if (!n1) fail('第 1 页一个请求都没发'); else if (leaked.length) fail(`打开时就发了别的页：${JSON.stringify(leaked).slice(0, 200)}`); else if (n1 < 4) fail(`第 1 页只发了 ${n1} 次 —— fixture 没切成 6 段，并发断言测不出东西`); else pass(`只发了第 1 页（${n1} 次请求）`);
    const tr1 = await ev(`[...document.querySelectorAll('#docv-page .tr')].map(x => x.textContent).join(' | ')`);
    if (!/【译】/.test(tr1)) fail('第 1 页译文没渲染出来：' + tr1.slice(0, 80)); else pass('第 1 页译文已渲染');

    // ② 下一页 → 第 2 页才发；第 1 页不重发
    console.log('② 下一页');
    await ev(`document.getElementById('docv-next').click(); 1`);
    await sleep(500);
    await waitFor(rowsDone, 15000, '第 2 页译文没到齐');
    const after = calls.slice(n1).map((c) => c.text);
    if (!after.length) fail('翻到第 2 页没发任何请求');
    else if (after.some((t) => PAGE_LINES[0].filter(Boolean).some((l) => t.includes(l.split(' ').slice(0, 3).join(' '))))) fail('翻页把第 1 页又发了一遍');
    else if (!after.some((t) => t.includes('Page two starts'))) fail('第 2 页的段落没被请求：' + JSON.stringify(after).slice(0, 200));
    else pass(`翻页只发了第 2 页（${after.length} 次）`);
    if (peak > CONC) fail(`③ 并发峰值 ${peak} > reqConcurrency ${CONC}`);
    else if (peak < 2) fail(`③ 并发峰值只有 ${peak} —— 要么并发闸没起作用的证据不足，要么请求根本没叠起来`);
    else pass(`③ 并发峰值 ${peak}（≤ ${CONC}，且真的叠起来了）`);

    // ⑦ 语料
    await sleep(1200);
    const corpus = JSON.parse(await ev(`LearnStore.allItems().then(items => JSON.stringify(items.filter(i => i.anchor && i.anchor.k === 'doc').map(i => ({ page: i.anchor.page, src: i.sourceId, title: i.anchor.title }))))`));
    if (!corpus.length) fail('⑦ 语料里没有 anchor.k=doc 的卡');
    else {
      const byPage = {}; corpus.forEach((c) => { byPage[c.page] = (byPage[c.page] || 0) + 1; });
      const over = Object.entries(byPage).filter(([, n]) => n > DocCore.CAPS.PER_PAGE);
      if (over.length) fail(`⑦ 某页超过每页上限：${JSON.stringify(byPage)}`);
      else if (!corpus.every((c) => /^doc:/.test(c.src) && c.title === 'contract')) fail('⑦ sourceId / 标题形状不对：' + JSON.stringify(corpus[0]));
      else pass(`⑦ 语料 ${corpus.length} 张，anchor.k=doc，每页 ≤ ${DocCore.CAPS.PER_PAGE}，按页 ${JSON.stringify(byPage)}`);
    }
    const srcs = JSON.parse(await ev(`LearnStore.allSources ? LearnStore.allSources().then(s => JSON.stringify(s.map(x => x.url))) : '[]'`));
    if (srcs.length && !srcs.some((u) => /^doc:\/\//.test(u))) fail('⑦ sources 里没有 doc:// 来源'); else if (srcs.length) pass('⑦ sources 有 doc:// 来源');

    // ⑥ 关闭重开 → 0 次新请求
    console.log('⑥ 重开');
    const before6 = calls.length;
    await ev(`document.getElementById('docv-back').click(); 1`);
    await sleep(400);
    // 列表行的页数必须是真页数（2026-09-11 全回归：pdf.js 把 data 缓冲区 transfer 给 Worker 后
    // rec.bytes 被掏空，第二次 put 抛 DataCloneError 被吞 ⇒ 永远「0 页」）
    const meta = await ev(`(document.querySelector('#docv-list .docv-row .meta') || {}).textContent || ''`);
    if (!/^3 页/.test(meta)) fail(`⑥ 列表行页数不对：「${meta}」（应以「3 页」开头）`); else pass('⑥ 列表行「3 页 · …」');
    await sleep(300);
    await ev(`document.querySelector('#docv-list .docv-row .title').click(); 1`);
    await waitFor(`!!document.getElementById('docv-page')`, 8000, '重开没进阅读器');
    await waitFor(rowsDone, 6000, '重开后译文没从缓存回来');
    await sleep(800);
    if (calls.length !== before6) fail(`⑥ 重开发了 ${calls.length - before6} 次新请求（应为 0，缓存在本机）`); else pass('⑥ 重开 0 次新请求');
    const pos6 = await ev(`(document.getElementById('docv-pos')||{}).textContent`);
    if (pos6 !== '2 / 3') fail(`⑥ 没回到上次读到的页：${pos6}`); else pass('⑥ 回到上次读的第 2 页');

    // ④ docx
    console.log('④ docx');
    await ev(`document.getElementById('docv-back').click(); 1`);
    await sleep(300);
    const before4 = calls.length;
    await upload(DOCX);
    await waitFor(`!!document.getElementById('docv-page')`, 8000, 'docx 没打开');
    const pos4 = await ev(`(document.getElementById('docv-pos')||{}).textContent`);
    if (pos4 !== '1 / 2') fail(`docx 页码不是 1 / 2：${pos4}`); else pass('docx 按 lastRenderedPageBreak 分成 2 页');
    await waitFor(rowsDone, 15000, 'docx 第 1 页译文没到齐');
    const d4 = calls.slice(before4).map((c) => c.text);
    if (d4.some((t) => /warranty terms/.test(t))) fail('docx 第 2 页在打开时就被发了'); else if (!d4.some((t) => /delivery window/.test(t))) fail('docx 第 1 页没被请求'); else pass(`docx 只发了第 1 页（${d4.length} 次）`);
    const heading = await ev(`!!document.querySelector('#docv-page .orig.heading')`);
    if (!heading) fail('docx 标题段没标 heading'); else pass('docx 标题段标了 heading');

    // ⑤ PNG（custom_chat 不声明 vision ⇒ 试发）→ 1 次 image_url + 文本翻译
    console.log('⑤ PNG');
    await ev(`document.getElementById('docv-back').click(); 1`);
    await sleep(300);
    const before5 = calls.length;
    await upload(PNG);
    await waitFor(`!!document.getElementById('docv-page')`, 8000, 'PNG 没打开');
    await waitFor(rowsDone, 15000, 'PNG 识别 + 译文没到齐');
    const c5 = calls.slice(before5);
    const imgs = c5.filter((c) => c.image).length;
    if (imgs !== 1) fail(`⑤ image_url 请求 ${imgs} 次（应恰好 1）`); else pass('⑤ 图片恰好识别 1 次');
    if (!c5.some((c) => !c.image && /Recognised line/.test(c.text))) fail('⑤ 识别出的文字没被拿去翻译'); else pass('⑤ 识别文字进了翻译');
    const tr5 = await ev(`[...document.querySelectorAll('#docv-page .tr')].map(x => x.textContent).join('|')`);
    if (!/【译】/.test(tr5)) fail('⑤ 图片页译文没渲染'); else pass('⑤ 图片页译文已渲染');

    // ⑧ vision:false 引擎（deepseek）→ 上传图片即说明 + 0 请求
    console.log('⑧ 引擎不识图');
    await storageSet({ provider: 'deepseek', apiKey: 'sk-x', apiBaseUrl: '', apiModel: '' });
    await reload();
    const before8 = calls.length;
    await upload(PNG);
    await sleep(1500);
    const msg8 = await ev(`(document.getElementById('docv-msg')||{}).textContent || ''`);
    if (!/识图|识别图片|images?/i.test(msg8)) fail('⑧ 没出现「引擎不支持识别图片」说明：' + msg8.slice(0, 80)); else pass('⑧ 说明在：' + msg8.slice(0, 40));
    if (calls.length !== before8) fail(`⑧ 发了 ${calls.length - before8} 次请求（应 0）`); else pass('⑧ 0 次请求');
    if (await ev(`!!document.getElementById('docv-page')`)) fail('⑧ 不该进阅读器');

    // ⑨ 免费额度在用 → 图片在选文件那一刻就拦
    console.log('⑨ 免费额度拦图片');
    const TOKEN = 'bmg_verifydocsverifydocsverifydocs00000001';
    await storageSet({ provider: 'grant', apiKey: TOKEN, grantTail: TOKEN.slice(-8), apiBaseUrl: '', apiModel: 'm' });
    await reload();
    const priv9 = await ev(`(document.getElementById('docv-privacy') || {}).textContent || ''`);
    if (!/免费额度|free credit|中继|relay/i.test(priv9)) fail('⑨ 额度在用时隐私句没换成中继版'); else pass('⑨ 额度版隐私句在');
    const before9 = calls.length;
    await upload(PNG);
    await sleep(1500);
    const msg9 = await ev(`(document.getElementById('docv-msg')||{}).textContent || ''`);
    if (!/免费额度|free credit/i.test(msg9)) fail('⑨ 没出现「免费额度不能识别图片」：' + msg9.slice(0, 80)); else pass('⑨ 拦截提示在');
    if (calls.length !== before9) fail(`⑨ 发了 ${calls.length - before9} 次请求（应 0）`); else pass('⑨ 0 次请求');
    const docs9 = JSON.parse(await ev(`DocStore.list().then(l => JSON.stringify(l.map(d => d.kind)))`));
    if (docs9.includes('image') && docs9.filter((k) => k === 'image').length > 1) fail('⑨ 被拦的图片仍入库了');
    else pass('⑨ 被拦的图片没入库（库里 ' + docs9.length + ' 份：' + docs9.join(',') + '）');

    await storageRemove(['provider', 'apiKey', 'apiBaseUrl', 'apiModel', 'grantTail', 'reqConcurrency']);

    // ── App 段：宿主 App 的同一份渲染器 + pdf.js 走 blob 路（D0 探针的那条）─────────
    console.log('App 段');
    {
      const APP = path.join(ROOT, 'dist-app');
      for (const f of ['Main.html', 'Script.js', 'Style.css']) if (!fs.existsSync(path.join(APP, f))) throw new Error('dist-app/' + f + ' 不在 —— 先跑 node build.js');
      const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
      const asrv = http.createServer((q, r) => {
        const rel = q.url === '/' ? '/Base.lproj/Main.html' : q.url.split('?')[0];
        const name = path.basename(rel);
        const okf = (name === 'Main.html' && rel.startsWith('/Base.lproj/')) || ((name === 'Script.js' || name === 'Style.css') && !rel.startsWith('/Base.lproj/'));
        if (!okf) { r.writeHead(404); return r.end(); }
        r.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'text/plain' });
        r.end(fs.readFileSync(path.join(APP, name)));
      }).listen(0);
      await new Promise((r) => asrv.on('listening', r));
      const aurl = 'http://127.0.0.1:' + asrv.address().port + '/Base.lproj/Main.html';
      try {
        const { targetId: at } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId: asid } = await cdp.send('Target.attachToTarget', { targetId: at, flatten: true });
        await cdp.send('Runtime.enable', {}, asid);
        await cdp.send('Page.enable', {}, asid);
        await cdp.send('DOM.enable', {}, asid);
        const alogs = [];
        cdp.on('Runtime.exceptionThrown', (p, s2) => { if (s2 === asid) alogs.push('EXC ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text)); });
        const aev = async (expr) => {
          const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, asid);
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || ''));
          return r.result ? r.result.value : undefined;
        };
        await cdp.send('Page.navigate', { url: aurl }, asid);
        await sleep(2000);
        // 设置经 chrome-shim 落 localStorage；种完重载，让 App 按「已看过引导 + 已配引擎」起
        await aev(`new Promise(r => chrome.storage.local.set(${JSON.stringify({ onboardSeen: true, provider: 'custom_chat', apiKey: 'test-key', apiBaseUrl: ENDPOINT, apiModel: 'fake-model', reqConcurrency: CONC, uiLang: 'zh-CN' })}, r))`);
        await cdp.send('Page.reload', {}, asid);
        await sleep(2500);
        const home = JSON.parse(await aev(`JSON.stringify({ out: !document.getElementById('signed-out').hidden,
          e2: (() => { const b = document.getElementById('app-docs-entry2'); return !!(b && !b.hidden && b.getClientRects().length); })(),
          title: (document.querySelector('#app-docs-entry2 .mode-title') || {}).textContent || '',
          docsHidden: getComputedStyle(document.getElementById('app-docs')).display === 'none' })`));
        if (!home.out) fail('App：未登录首页没显示（onboardSeen 已种）');
        if (!home.e2) fail('App：未登录首页看不到「翻译文档」入口'); else pass('App：首页入口可见 · ' + home.title);
        if (!home.docsHidden) fail('App：#app-docs 在进入前就没被 [hidden] 真隐藏');
        const aBefore = calls.length;
        await aev(`document.getElementById('app-docs-entry2').click(); 1`);
        await sleep(300);
        const entered = JSON.parse(await aev(`JSON.stringify({ shown: getComputedStyle(document.getElementById('app-docs')).display !== 'none', outHidden: document.getElementById('signed-out').hidden, up: !!document.getElementById('docv-upload') })`));
        if (!entered.shown || !entered.outHidden || !entered.up) fail('App：点入口没进文档视图：' + JSON.stringify(entered)); else pass('App：进入文档视图，来处收起');
        // 上传同一份 3 页 PDF：真按钮 → 真 <input> → CDP 塞文件
        await aev(`document.getElementById('docv-upload').click(); 1`);
        await sleep(100);
        const { root: aroot } = await cdp.send('DOM.getDocument', { depth: 1 }, asid);
        const { nodeId: anid } = await cdp.send('DOM.querySelector', { nodeId: aroot.nodeId, selector: '#app-docs-file' }, asid);
        await cdp.send('DOM.setFileInputFiles', { files: [PDF], nodeId: anid }, asid);
        const t0 = Date.now(); let apos = '';
        while (Date.now() - t0 < 12000) { apos = await aev(`(document.getElementById('docv-pos')||{}).textContent || ''`); if (apos === '1 / 3') break; await sleep(200); }
        if (apos !== '1 / 3') {
          fail('App：PDF 没读出 3 页（' + apos + '）—— __MT_PDFJS 的 blob 路在 App 包里没走通？');
          try { console.log('    页面：' + (await aev(`document.getElementById('app-docs-root').innerText.slice(0, 300)`)).replace(/\n/g, ' ⏎ ')); } catch (_) {}
          if (alogs.length) console.log('    控制台：' + alogs.slice(-5).join('\n    ').slice(0, 800));
        } else pass('App：pdf.js 经 __MT_PDFJS 读出 3 页');
        const t1 = Date.now(); let adone = false;
        while (Date.now() - t1 < 15000) { adone = await aev(rowsDone); if (adone) break; await sleep(200); }
        const ac = calls.slice(aBefore).map((c) => c.text);
        if (!adone) fail('App：第 1 页译文没到齐（' + ac.length + ' 次请求）');
        else if (ac.some((t) => [...PAGE_LINES[1], ...PAGE_LINES[2]].some((l) => t.includes(l.split(' ').slice(0, 3).join(' '))))) fail('App：打开时就发了别的页');
        else pass('App：只发了第 1 页（' + ac.length + ' 次），译文已渲染');
        const acorpus = await aev(`LearnStore.allItems().then(items => items.filter(i => i.anchor && i.anchor.k === 'doc').length)`);
        if (!acorpus) fail('App：语料里没有 doc 卡（App 是 §9.7 的第二写入点）'); else pass('App：语料写入 ' + acorpus + ' 张 doc 卡');
        await aev(`document.getElementById('app-docs-back').click(); 1`);
        await sleep(300);
        const left = JSON.parse(await aev(`JSON.stringify({ hidden: getComputedStyle(document.getElementById('app-docs')).display === 'none', out: !document.getElementById('signed-out').hidden })`));
        if (!left.hidden || !left.out) fail('App：返回后视图没收起 / 来处没回来：' + JSON.stringify(left)); else pass('App：返回后 [hidden] 真隐藏，来处回来');
        const ctl = JSON.parse(await aev(`JSON.stringify({ cap: !!document.getElementById('doc-capture'), pre: !!document.getElementById('doc-prefetch'), note: ((document.getElementById('doc-capture-note')||{}).textContent || '').length })`));
        if (!ctl.cap || !ctl.pre) fail('App：设置页缺文档开关'); else pass('App：设置页有「文档译文进复习」「提前解析下一页」两个开关');
        if (alogs.length) { fail('App：控制台有异常：' + alogs.slice(0, 3).join(' | ').slice(0, 400)); }
      } finally { asrv.close(); }
    }
  } finally {
    try { if (cdp) cdp.close(); } catch (_) {}
    try { chrome.kill(); } catch (_) {}
    srv.close();
    try { fs.rmSync(runDist, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(ok ? '\n✓ test:docs 通过' : '\n✗ test:docs 失败');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
