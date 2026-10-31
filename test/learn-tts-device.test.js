// test/learn-tts-device.test.js — 设备内置朗读的离线模型：四处首播同一个下载入口（learning-design §9.1.1，2026-09-17）。
//
// 用户报障「系统 tts 下载触发也没感受到」：模型下载此前只在对话开始那一步（app/listen.js）发生；
// 设置试听、复习 ▶、播客首播选了 device，模型缺失时 ttsLangs() 是空的，于是每种语言都「回落系统
// 语音」—— 静默。这里钉住：speak() 自己先走 ensureDeviceReady，缺模型就下载并回进度；失败具名 assets。
const { loadModule, describe, test, ok, eq } = require('./harness');

const LearnModel = loadModule('learn-model.js', { window: {} }).LearnModel;
const WireFormat = require('../extension/content/wire-format.js');
const MODELS = [
  { lang: 'zh', files: [{ size: 67411393, url: { global: 'https://g/zh.zip', china: 'https://c/zh.zip' } }] },
  { lang: 'en', files: [{ size: 67388973, url: { global: 'https://g/en.zip', china: 'https://c/en.zip' } }] },
];

function fakeNative(o) {
  const calls = { probe: 0, assets: 0, speak: [], progress: [] };
  let ready = !!o.ready;
  const native = {
    available: () => o.bridge !== false,
    ttsProbe: () => { calls.probe++; return Promise.resolve(ready ? { ok: true, langs: ['zh', 'en'] } : { ok: false, reason: o.reason || 'assets', langs: [] }); },
    ttsLangs: () => (ready ? ['zh', 'en'] : []),
    ensureAssets: (kind, models, onProgress) => {
      calls.assets++;
      if (o.fail) return Promise.reject({ reason: 'download' });
      onProgress && onProgress({ kind, locale: 'zh', fraction: 0.5, state: 'downloading' });
      ready = true;
      return Promise.resolve({ ok: true });
    },
    speak: (x) => { calls.speak.push(x); return { started: Promise.resolve(true), done: Promise.resolve() }; },
    stop() {}, systemVoice: () => Promise.resolve(false),
  };
  return { native, calls };
}

function setup(o) {
  const { native, calls } = fakeNative(o);
  const ctx = loadModule(['content/request-shape.js', 'learn/tts.js'], {
    window: { MT_TTS_ENGINES: [{ id: 'device', type: 'device-speech', needsKey: false, returnsAudio: false, defaultEndpoint: null }, { id: 'browser', type: 'browser', needsKey: false, returnsAudio: false, defaultEndpoint: null }], MT_FLAVOR: o.flavor || 'global' },
    LearnModel, LearnStore: { getAudio: () => Promise.resolve(null), putAudio: () => Promise.resolve() }, WireFormat,
    LearnRules: loadModule('learn-rules.js', { window: {} }).LearnRules,
    NativeSpeech: native,
    mtDeviceTtsModelsFor: o.noModels ? undefined : (flavor) => MODELS.map((m) => Object.assign({}, m, { files: m.files.map((f) => Object.assign({}, f, { url: f.url[flavor] })) })),
    speechSynthesis: undefined, SpeechSynthesisUtterance: undefined,
    AbortController, fetch: () => Promise.reject(new Error('no network')), Uint8Array, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  });
  ctx.LearnTTS.configure({ engineId: o.engine || 'device', rate: 1 });
  return { TTS: ctx.LearnTTS, calls };
}

describe('LearnTTS.deviceStatus / ensureDeviceReady', () => {
  test('缺模型 ⇒ status.ready=false、reason=assets、size 是清单文件大小之和（约 129 MB）', async () => {
    const { TTS } = setup({ ready: false });
    const st = await TTS.deviceStatus();
    ok(st.device && st.bridge && !st.ready && st.reason === 'assets', JSON.stringify(st));
    eq(st.size, 67411393 + 67388973);
    eq(Math.round(st.size / 1048576), 129);
  });
  test('ensureDeviceReady 缺模型 ⇒ 下载一次、进度回给调用方、返回 downloaded:true', async () => {
    const { TTS, calls } = setup({ ready: false });
    const seen = [];
    const r = await TTS.ensureDeviceReady((m) => seen.push(m));
    ok(r.ok && r.downloaded === true, JSON.stringify(r));
    eq(calls.assets, 1);
    ok(seen.length === 1 && seen[0].kind === 'tts' && seen[0].fraction === 0.5, '进度没回到调用方：' + JSON.stringify(seen));
  });
  test('模型已就位 ⇒ 不下载', async () => {
    const { TTS, calls } = setup({ ready: true });
    const r = await TTS.ensureDeviceReady();
    ok(r.ok && r.downloaded === false); eq(calls.assets, 0);
  });
  test('下载失败 ⇒ ok:false, reason:assets, why:download —— 不是崩、不是静默', async () => {
    const { TTS } = setup({ ready: false, fail: true });
    const r = await TTS.ensureDeviceReady();
    ok(!r.ok && r.reason === 'assets' && r.why === 'download', JSON.stringify(r));
  });
  test('不是 device 引擎 ⇒ 跳过（ok，不探桥）', async () => {
    const { TTS, calls } = setup({ engine: 'browser', ready: false });
    const r = await TTS.ensureDeviceReady();
    ok(r.ok && r.skipped, JSON.stringify(r)); eq(calls.probe, 0);
  });
  test('清单按 flavor 解成字符串地址', async () => {
    const { TTS } = setup({ ready: false, flavor: 'china' });
    const st = await TTS.deviceStatus();
    eq(st.models[0].files[0].url, 'https://c/zh.zip');
  });
});

describe('LearnTTS.speak 在 device 引擎上先走下载入口（四处首播同一条路）', () => {
  test('缺模型 ⇒ speak 先下载（进度经 opts.onProgress 回来）再原生朗读，不再静默回落系统语音', async () => {
    const { TTS, calls } = setup({ ready: false });
    const seen = [];
    const r = await TTS.speak('你好世界', 'zh', { onProgress: (m) => seen.push(m) });
    ok(r.ok && r.engine === 'device' && !r.fallback, '该用原生朗读且不是回落：' + JSON.stringify(r));
    eq(calls.assets, 1, '该下载一次');
    eq(seen.length, 1, '进度该回到调用方');
    eq(calls.speak.length, 1, '下载完该真的念');
  });
  test('下载失败 ⇒ speak 返回 reason:assets，reason() 说得出「去设置里下载」', async () => {
    const { TTS, calls } = setup({ ready: false, fail: true });
    const r = await TTS.speak('你好世界', 'zh');
    eq(r.reason, 'assets'); eq(calls.speak.length, 0, '没模型不该去念');
    const text = TTS.reason(r.reason, (k, d) => d);
    ok(/下载/.test(text) && /设置/.test(text), text);
  });
  test('模型已就位 ⇒ 不探下载，直接念（与 2026-09-17 前逐字相同的路）', async () => {
    const { TTS, calls } = setup({ ready: true });
    const r = await TTS.speak('hello world', 'en');
    ok(r.ok && r.engine === 'device'); eq(calls.assets, 0); eq(calls.speak.length, 1);
  });
});
