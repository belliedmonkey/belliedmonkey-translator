#!/usr/bin/env node
// scripts/verify-speech-live.js — 三条云端语音链路，在**真 Chrome 的扩展页里**跑一遍。
//
//   node scripts/verify-speech-live.js global    # openrouter 的朗读×2 + 转写
//   node scripts/verify-speech-live.js china     # 千问的朗读 + 转写
//
// 为什么 npm test 与端到端脚本都不够：它们跑在 Node 里，而 Node **没有浏览器的那几条
// 策略**。本轮已经有一个 bug 差点因此漏网 —— DashScope 回的音频地址是 `http://`，
// 扩展页是安全上下文，取它会被混合内容策略静默挡掉；我的 Node 端到端脚本全绿。
//
// 所以这里的判据不是「拿到了字节」，而是**「浏览器能不能把这段字节解码成声音」**：
// 把 {buf, type} 拼成 data: URI 交给 <audio>，等 loadedmetadata，读 duration。
// 那一条正是 `Content-Type: audio/pcm` 那个 bug 会栽的地方（请求成功、缓存成功、
// 播放静默失败，一路上没有任何地方会报错）。
'use strict';

const fs = require('fs');
const path = require('path');
const { launchChrome } = require('../test/layout/chrome.js');
const { CDP } = require('../test/layout/cdp.js');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const slot = (n) => {
  const m = new RegExp('^' + n + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
};

// 一段真话，用系统语音合成 —— 转写结果才可逐字核对（轻音只能证明「可达」）。
function probeWav() {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const aiff = path.join(os.tmpdir(), 'mt-live.aiff');
  const wav = path.join(os.tmpdir(), 'mt-live.wav');
  execFileSync('say', ['-o', aiff, PHRASE], { stdio: 'ignore' });
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav], { stdio: 'ignore' });
  const m4a = path.join(os.tmpdir(), 'mt-live.m4a');
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, m4a], { stdio: 'ignore' });
  return { wav: fs.readFileSync(wav), m4a: fs.readFileSync(m4a) };
}
const PHRASE = 'The quick brown fox jumps over the lazy dog.';

const PLANS = {
  global: {
    dist: 'dist', keySlot: 'key_chat_custom_chat',
    tts: [{ id: 'openrouter_speech', voice: 'aura-2-thalia-en' }, { id: 'openrouter_audio', voice: 'alloy' }],
    stt: [{ id: 'openrouter_transcribe' }],
  },
  china: {
    dist: 'dist-china', keySlot: 'key_chat_qwen_china',
    tts: [{ id: 'qwen_tts', voice: 'Cherry' }],
    stt: [{ id: 'qwen_asr' }],
  },
};

const bad = [];
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { bad.push(msg); console.log('  ✗ ' + msg); } };

async function main() {
  const flavor = process.argv[2] || 'global';
  const plan = PLANS[flavor];
  if (!plan) { console.error('用法: node scripts/verify-speech-live.js [global|china]'); process.exit(1); }
  const key = slot(plan.keySlot);
  if (!key) { console.error(`✗ .local/keys.md 里 ${plan.keySlot} 是空的`); process.exit(1); }
  const dist = path.join(ROOT, plan.dist);
  if (!fs.existsSync(dist)) { console.error(`✗ ${plan.dist} 不存在，先跑 node build.js`); process.exit(1); }

  const audio = probeWav();
  const wav = audio.wav;
  console.log(`\n■ ${flavor}   ${plan.dist}   探针音频 wav ${audio.wav.length} / m4a ${audio.m4a.length} 字节「${PHRASE}」\n`);

  process.stderr.write('· 启动 Chrome…\n');
  const chrome = await launchChrome();
  process.stderr.write('· CDP 连上 port ' + chrome.port + '\n');
  const cdp = await CDP.connect(chrome.port);
  try {
    process.stderr.write('· loadUnpacked…\n');
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: dist });
    if (!extId) throw new Error('loadUnpacked 没有回 id');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    process.stderr.write('· ext ' + extId + '，打开 review.html…\n');
    await cdp.send('Page.navigate', { url: `chrome-extension://${extId}/learn/review.html` }, sessionId);
    await new Promise((r) => setTimeout(r, 2500));

    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate',
        { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
      return r.result.value;
    };

    process.stderr.write('· 页面就绪，开始判据\n');
    ok(await ev('typeof LearnTTS === "object" && typeof LearnSpeech === "object"'),
      '扩展页里 LearnTTS / LearnSpeech 都在');

    // ── 朗读 ────────────────────────────────────────────────────────────
    for (const t of plan.tts) {
      const e = await ev(`JSON.stringify((window.MT_TTS_ENGINES||[]).find(x=>x.id===${JSON.stringify(t.id)})||null)`);
      if (!e || e === 'null') { ok(false, `${t.id}: 这个 flavor 的产物里没有这个引擎`); continue; }
      const eng = JSON.parse(e);
      console.log(`\n── 朗读 ${t.id}  ${eng.defaultModel}`);
      const got = await ev(`(async () => {
        LearnTTS.configure({ engineId: ${JSON.stringify(t.id)}, apiKey: ${JSON.stringify(key)},
          baseUrl: '', model: '', voice: ${JSON.stringify(t.voice)} });
        const t0 = performance.now();
        let r;
        try { r = await LearnTTS.getAudio('Hello, this is a live host check.', 'en'); }
        catch (err) { return JSON.stringify({ err: err.code || err.message }); }
        const ms = Math.round(performance.now() - t0);
        // **决定性判据**：浏览器能不能把这段字节解码成声音。
        const b64 = (() => { let s=''; const u=new Uint8Array(r.buf);
          for (let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); })();
        const url = 'data:' + r.type + ';base64,' + b64;
        const dur = await new Promise((res) => {
          const a = new Audio(url);
          const done = (v) => res(v);
          a.addEventListener('loadedmetadata', () => done(a.duration), { once: true });
          a.addEventListener('error', () => done(-1), { once: true });
          setTimeout(() => done(-2), 8000);
        });
        return JSON.stringify({ ms, bytes: r.buf.byteLength, type: r.type, dur });
      })()`);
      const g = JSON.parse(got);
      if (g.err) { ok(false, `${t.id}: 取音频失败 —— ${g.err}`); continue; }
      console.log(`     ${g.ms}ms  ${g.bytes} 字节  type=${g.type}  解码时长=${g.dur}s`);
      ok(g.bytes > 5000, `${t.id}: 拿到了像样的音频（${g.bytes} 字节）`);
      ok(/^audio\/(wav|mpeg|ogg|flac|mp4)$/.test(g.type),
        `${t.id}: 类型是浏览器认得的容器（${g.type}）—— audio/pcm 会让播放静默失败`);
      ok(g.dur > 0.2, `${t.id}: **浏览器真的解码出了声音**（${g.dur}s）${g.dur === -1 ? ' —— <audio> 报了 error' : g.dur === -2 ? ' —— 8 秒内没有 loadedmetadata' : ''}`);
    }

    // ── 转写 ────────────────────────────────────────────────────────────
    // **两种容器都要测。** iOS Safari 的 MediaRecorder 首选 `audio/mp4`，于是
    // speech-input.js 会把 ext 定成 `m4a`，而 DashScope 那条传输把 ext 原样当
    // `parameters.format` 透传给服务端。只测 WAV 的话，桌面全绿而真机可能全挂 ——
    // 这正是「一个宿主上能用不等于另一个宿主上能用」最典型的形状。
    const CONTAINERS = [
      { ext: 'wav', mime: 'audio/wav', b64: audio.wav.toString('base64'), note: '桌面录音' },
      { ext: 'm4a', mime: 'audio/mp4', b64: audio.m4a.toString('base64'), note: 'iOS Safari 实际产出' },
    ];
    for (const s of plan.stt) {
      const e = await ev(`JSON.stringify((window.MT_STT_ENGINES||[]).find(x=>x.id===${JSON.stringify(s.id)})||null)`);
      if (!e || e === 'null') { ok(false, `${s.id}: 这个 flavor 的产物里没有这个引擎`); continue; }
      const eng = JSON.parse(e);
      console.log(`\n── 转写 ${s.id}  ${eng.defaultModel}`);
      for (const c of CONTAINERS) {
        const got = await ev(`(async () => {
          LearnSpeech.configure({ engineId: ${JSON.stringify(s.id)}, apiKey: ${JSON.stringify(key)},
            baseUrl: '', model: '' });
          const bin = atob(${JSON.stringify(c.b64)});
          const u = new Uint8Array(bin.length);
          for (let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
          const blob = new Blob([u], { type: ${JSON.stringify(c.mime)} });
          const t0 = performance.now();
          try {
            const text = await LearnSpeech.transcribe(blob, ${JSON.stringify(c.ext)}, 'en');
            return JSON.stringify({ ms: Math.round(performance.now()-t0), text });
          } catch (err) { return JSON.stringify({ err: err.code || err.message, url: err.url || '' }); }
        })()`);
        const g = JSON.parse(got);
        if (g.err) { ok(false, `${s.id} · ${c.ext}（${c.note}）: 转写失败 —— ${g.err} ${g.url || ''}`); continue; }
        const norm = (x) => String(x).toLowerCase().replace(/[^a-z]/g, '');
        console.log(`     ${c.ext.padEnd(4)} ${String(g.ms).padStart(5)}ms  转写=${JSON.stringify(g.text)}`);
        ok(norm(g.text).length > 6 && (norm(PHRASE).startsWith(norm(g.text).slice(0, 12)) || norm(g.text).includes('quickbrown')),
          `${s.id} · ${c.ext}（${c.note}）: 转写与原句对得上`);
      }
    }

    console.log('');
  } finally {
    try { await cdp.close(); } catch (_) {}
    try { chrome.kill(); } catch (_) {}
  }
  if (bad.length) { console.log(`\n✗ ${bad.length} 条判据没过\n`); process.exit(1); }
  console.log('\n✓ 真宿主验证通过\n');
}
main().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
