// scripts/lib/dist-sandbox.js — 给真浏览器门禁一份「指向本机」的 dist/ 副本。
//
// 两件事，缺一不可（2026-09-10 评审）：
//   1. 每次跑都用副本：unpacked 扩展是活读加载路径的，并行的 `node build.js` 会在 Chrome
//      跑到一半时把文件换掉（run-layout.js 原来就这么做）。
//   2. 遥测端点改指本机、或干脆置空：`learn/telemetry.js` 进 <all_urls> 之后每个页面都会
//      入队并自己 flush；`navigator.webdriver` 只在 --headless=new 下为真，MT_LAYOUT_HEADED=1
//      的 headed 跑法会把 installed / heartbeat / translate_ok 打进**线上** bt_events。
//      产物里的地址是字面替换的（同 verify-grant.js 的做法）—— 门禁要验的是出货的那份产物，
//      自己拼一份等于验了一个不存在的东西。
//
// telemetry: { url } —— 指到本机桩并注入 allowAutomation（smoke 要断言事件真的到达）；
// telemetry: false   —— 把 url 置空，自动化里一个字节都不发（layout / grant 用）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function sandboxDist(dist, opts) {
  if (!fs.existsSync(dist)) throw new Error('先跑 node build.js —— ' + dist + ' 不在');
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-dist-'));
  fs.cpSync(dist, run, { recursive: true });
  const gen = path.join(run, 'content', 'providers.gen.js');
  let t = fs.readFileSync(gen, 'utf8');
  const m = t.match(/^window\.MT_TELEMETRY = (\{.*\});$/m);
  if (!m) throw new Error('providers.gen.js 里没有 MT_TELEMETRY —— 发射形状变了？');
  const spec = JSON.parse(m[1]);
  const tel = opts && opts.telemetry;
  if (tel && tel.url) { spec.url = tel.url; spec.allowAutomation = true; }
  else spec.url = '';
  t = t.replace(m[0], 'window.MT_TELEMETRY = ' + JSON.stringify(spec) + ';');
  if (opts && opts.backendUrl) {
    for (const f of ['providers.gen.js', 'tts.gen.js', 'stt.gen.js']) {
      const p = path.join(run, 'content', f);
      if (!fs.existsSync(p)) continue;
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, opts.backendUrl));
    }
    t = fs.readFileSync(gen, 'utf8');
  }
  fs.writeFileSync(gen, t);
  return run;
}

module.exports = { sandboxDist };
