// test/cli-doc.test.js — 文档 / 字幕 / 批量（learning-design §9.10）。
//
// 文档复用 learn/doc-core.js + learn/doc-reader.js（正则 docx、pdf.js 文本层），字幕是
// VTT/SRT 时间轴。这里用**桩 translate**测纯逻辑，再用本地 HTTP 端点跑启动器端到端。
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { test, describe, ok, eq } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const { translateDoc, parseRange } = require('../cli/doc.js');
const { parseTimedText, translateSubtitle, toVtt, toSrt } = require('../cli/subtitle.js');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bt-doc-'));

// 一个 xref 正确的最小 PDF（一页，文本 "Hello PDF world"）。
function makePdf(text) {
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const stream = `BT /F1 18 Tf 20 150 Td (${text}) Tj ET`;
  objs[5] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) { offsets[i] = pdf.length; pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const stubTranslate = async (t) => ({ ok: true, text: '[zh]' + t });

describe('cli-doc: 页码范围与文档翻译（§2.5）', () => {
  test('parseRange：默认第 1 页；支持逗号/区间；越界裁剪；没有 all', () => {
    eq(JSON.stringify(parseRange('', 5)), '[1]');
    eq(JSON.stringify(parseRange('2', 5)), '[2]');
    eq(JSON.stringify(parseRange('1-3', 5)), '[1,2,3]');
    eq(JSON.stringify(parseRange('3,1', 5)), '[1,3]');
    eq(JSON.stringify(parseRange('1-99', 3)), '[1,2,3]');
    eq(JSON.stringify(parseRange('all', 5)), '[]', '"all" 不是合法范围（§2.5 规则 4）');
  });

  test('★ txt：逐段翻译，译文与原文成对', async () => {
    const f = path.join(tmpdir(), 'a.txt');
    fs.writeFileSync(f, 'Hello world.\n\nSecond paragraph here.\n');
    const res = await translateDoc(f, '', stubTranslate, {});
    eq(res.kind, 'txt');
    eq(res.range.length, 1, '默认只翻第 1 页');
    const units = res.out[0].units;
    ok(units.length >= 1);
    ok(units.every((u) => u.ok && u.tr.startsWith('[zh]')), '每段都要有译文');
  });

  test('★ pdf：pdf.js 文本层在 Node 里读得出（spike 的回归）', async () => {
    const f = path.join(tmpdir(), 'a.pdf');
    fs.writeFileSync(f, makePdf('Hello PDF world'));
    const res = await translateDoc(f, '', stubTranslate, {});
    eq(res.kind, 'pdf');
    const text = res.out[0].units.map((u) => u.src).join(' ');
    ok(/Hello PDF world/.test(text), 'PDF 文本层要读出来，实际 ' + JSON.stringify(text));
  });

  test('图片文件 ⇒ image_unsupported（明说不支持）', async () => {
    const f = path.join(tmpdir(), 'a.png');
    fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]));
    let code = '';
    try { await translateDoc(f, '', stubTranslate, {}); } catch (e) { code = e.code; }
    eq(code, 'image_unsupported');
  });
});

describe('cli-doc: 字幕（VTT/SRT）', () => {
  const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello there.\n\n00:00:04.000 --> 00:00:06.000\nHow are you?\n';

  test('parseTimedText：时间轴与文本', () => {
    const cues = parseTimedText(VTT);
    eq(cues.length, 2);
    eq(cues[0].start, 1000); eq(cues[0].end, 3000);
    eq(cues[0].text, 'Hello there.');
  });

  test('SRT（逗号毫秒）也认', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nBonjour.\n';
    const cues = parseTimedText(srt);
    eq(cues.length, 1);
    eq(cues[0].start, 1000);
  });

  test('★ 翻译后写回 VTT/SRT，时间轴保持不变', async () => {
    const f = path.join(tmpdir(), 'a.vtt');
    fs.writeFileSync(f, VTT);
    const res = await translateSubtitle(f, stubTranslate, {});
    eq(res.cues.length, 2);
    ok(res.cues.every((c) => c.tr.startsWith('[zh]')));
    const vtt = toVtt(res.cues, false);
    ok(vtt.startsWith('WEBVTT'), '输出仍是 VTT');
    ok(/00:00:01\.000 --> 00:00:03\.000/.test(vtt), '时间轴原样');
    ok(/\[zh\]Hello there\./.test(vtt), '译文在');
    const srt = toSrt(res.cues, false);
    ok(/00:00:01,000 --> 00:00:03,000/.test(srt), 'SRT 用逗号毫秒');
  });
});

// ── 启动器端到端（本地 HTTP 端点）──────────────────────────────────────────
function server(body, reply) {
  return new Promise((resolve) => {
    const seen = [];
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => { seen.push(b); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply)); });
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port, seen }));
  });
}
function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'cli', 'bin', 'belliedmonkey.js')].concat(args),
      { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout, stderr }));
  });
}

describe('cli-bin: doc / subtitle / batch 端到端（§3.1.13）', () => {
  const CHAT = { choices: [{ message: { content: '你好。' } }] };
  async function withBackend(fn) {
    const { s, port } = await server(null, CHAT);
    try {
      const env = {
        BM_PROVIDER: 'custom_chat', BM_API_KEY: 'k',
        BM_BASE_URL: `http://127.0.0.1:${port}/v1/chat/completions`, BM_MODEL: 'm',
      };
      return await fn(env);
    } finally { s.close(); }
  }

  test('doc --only 打印译文', async () => {
    await withBackend(async (env) => {
      const f = path.join(tmpdir(), 'a.txt');
      fs.writeFileSync(f, 'Hello world.\n');
      const r = await runCli(['doc', f, '--only'], env);
      eq(r.code, 0, r.stderr);
      ok(/你好。/.test(r.stdout), '输出译文，实际 ' + r.stdout);
    });
  });

  test('subtitle 输出译文字幕（VTT）', async () => {
    await withBackend(async (env) => {
      const f = path.join(tmpdir(), 'a.vtt');
      fs.writeFileSync(f, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.\n');
      const r = await runCli(['subtitle', f, '--only'], env);
      eq(r.code, 0, r.stderr);
      ok(/^WEBVTT/.test(r.stdout), '仍是 VTT');
      ok(/你好。/.test(r.stdout), '有译文');
    });
  });

  test('batch -o 目录：逐个写文件', async () => {
    await withBackend(async (env) => {
      const dir = tmpdir();
      fs.writeFileSync(path.join(dir, 'one.txt'), 'Hello one.\n');
      fs.writeFileSync(path.join(dir, 'two.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello two.\n');
      const out = path.join(dir, 'out');
      const r = await runCli(['batch', dir, '-o', out], env);
      eq(r.code, 0, r.stderr);
      const files = fs.readdirSync(out);
      eq(files.length, 2, '两个文件都要产出：' + files.join(','));
      ok(files.some((f) => /^one\..*\.txt$/.test(f)), 'txt 产出');
      ok(files.some((f) => /^two\..*\.vtt$/.test(f)), 'vtt 产出');
    });
  });
});
