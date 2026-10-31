// M10 真机验证用：把 /v1/audio/transcriptions 转发给本机 openai-whisper CLI。
// 顺带做容器体检：记录上传文件名扩展名与真实容器魔数（m4a = 'ftyp' @ offset 4），
// 这正是 M10 点名的常见断点（文件名与容器不匹配被 whisper 端点拒收）。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = require('os').tmpdir();
const LOG = path.join(DIR, 'whisper-server.log');
const log = (...a) => { const line = new Date().toISOString() + ' ' + a.join(' '); console.log(line); fs.appendFileSync(LOG, line + '\n'); };

function parseMultipart(buf, boundary) {
  const b = Buffer.from('--' + boundary);
  const parts = [];
  let i = buf.indexOf(b);
  while (i >= 0) {
    const next = buf.indexOf(b, i + b.length);
    if (next < 0) break;
    const seg = buf.slice(i + b.length + 2, next - 2); // skip \r\n after boundary, trim \r\n before next
    const hEnd = seg.indexOf('\r\n\r\n');
    if (hEnd > 0) {
      const head = seg.slice(0, hEnd).toString('utf8');
      const body = seg.slice(hEnd + 4);
      const name = (head.match(/name="([^"]+)"/) || [])[1] || '';
      const filename = (head.match(/filename="([^"]+)"/) || [])[1] || null;
      const ctype = (head.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || '';
      parts.push({ name, filename, ctype, body });
    }
    i = next;
  }
  return parts;
}

// CORS：浏览器/WebView 里的页面调自建端点是跨域请求，响应没有这组头，
// fetch 会在读响应前就失败（Safari 报 TypeError "Load failed"，看不出是 CORS）。
// 真实的自建 whisper 服务器同样需要开——2026-08-13 模拟器实测踩到。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST' || !req.url.includes('/v1/audio/transcriptions')) {
    res.writeHead(404, CORS); return res.end();
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const boundary = (String(req.headers['content-type']).match(/boundary=([^;]+)/) || [])[1];
      const parts = parseMultipart(Buffer.concat(chunks), boundary);
      const file = parts.find((p) => p.name === 'file');
      const lang = (parts.find((p) => p.name === 'language') || {}).body?.toString('utf8').trim();
      const model = (parts.find((p) => p.name === 'model') || {}).body?.toString('utf8').trim();
      if (!file) { res.writeHead(400, CORS); return res.end('{"error":"no file"}'); }
      const magic = file.body.slice(4, 8).toString('ascii');
      const ext = (file.filename || '').split('.').pop();
      log(`upload: filename=${file.filename} ctype=${file.ctype} bytes=${file.body.length} magic@4=${JSON.stringify(magic)} lang=${lang || '(none)'} model=${model || '(none)'}`);
      const tmp = path.join(DIR, 'upload.' + (ext || 'bin'));
      fs.writeFileSync(tmp, file.body);
      // 真 whisper：small 模型，CPU fp32。解码失败会抛 —— 那正是 M10 要暴露的。
      const args = [tmp, '--model', 'small', '--output_format', 'txt', '--output_dir', DIR,
        '--fp16', 'False', '--verbose', 'False'];
      if (lang) args.push('--language', lang);
      execFileSync('/opt/homebrew/bin/whisper', args, { timeout: 120000 });
      const txtFile = path.join(DIR, path.basename(tmp, path.extname(tmp)) + '.txt');
      const text = fs.existsSync(txtFile) ? fs.readFileSync(txtFile, 'utf8').trim() : '';
      log('transcript: ' + JSON.stringify(text.slice(0, 200)));
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, CORS));
      res.end(JSON.stringify({ text }));
    } catch (e) {
      log('ERROR: ' + (e && e.message));
      res.writeHead(500, Object.assign({ 'Content-Type': 'application/json' }, CORS));
      res.end(JSON.stringify({ error: String(e && e.message) }));
    }
  });
});
server.listen(18790, '127.0.0.1', () => log('listening on http://127.0.0.1:18790'));
