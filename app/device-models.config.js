// app/device-models.config.js — 设备内置朗读（learning-design §9.6.1）的**离线模型清单**。
//
// 与 backend.config.js 同一个纪律：地址与校验和只写这一处。模型不进仓库、不进 App 包 ——
// 首次使用时由原生（speech-bridge.swift）按这张表下载、逐文件 sha256 校验、解包到
// Application Support/mt-speech/<dir>/。换模型 = 用 scripts/pack-device-models.js 重打包、改这里的
// sha256/size/url；旧包因安装戳名含 sha256 会被视为未安装、自动重下。
//
// url 分 flavor：全球走 GitHub Release 附件；中国版走 belliedmonkey.com（EdgeOne，境内可达）——
// 在中国版托管就绪之前两边先指同一处（release-state 与 .local/TODO.md 里有这条欠账）。
// 运行时按 window.MT_FLAVOR（providers.gen.js）取对应地址。
//
// 只覆盖 zh / en（Piper，sherpa-onnx 的 vits 形状）；不在表里的语言由 tts.js 回落到系统语音并在行上具名。
var MT_DEVICE_TTS_MODELS = [
  {
    lang: 'zh', dir: 'piper-zh', model: 'zh_CN-huayan-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data',
    files: [{
      path: 'piper-zh.zip', size: 67411393,
      sha256: '071b226531f829851c0df15ac5f5050d8c56e9a24e479c9f3b531cd377e84c92',
      url: {
        global: 'https://github.com/belliedmonkey/belliedmonkey-translator/releases/download/device-models-1/piper-zh.zip',
        china: 'https://github.com/belliedmonkey/belliedmonkey-translator/releases/download/device-models-1/piper-zh.zip',
      },
    }],
  },
  {
    lang: 'en', dir: 'piper-en', model: 'en_US-lessac-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data',
    files: [{
      path: 'piper-en.zip', size: 67388973,
      sha256: '1c69a1f2332238e52594c22beeac204430740bff549bf0e58701e730d2c34c1c',
      url: {
        global: 'https://github.com/belliedmonkey/belliedmonkey-translator/releases/download/device-models-1/piper-en.zip',
        china: 'https://github.com/belliedmonkey/belliedmonkey-translator/releases/download/device-models-1/piper-en.zip',
      },
    }],
  },
];

// 给原生的形状：url 按 flavor 解开成一个字符串（原生不认 flavor）。
function mtDeviceTtsModelsFor(flavor) {
  const f = flavor === 'china' ? 'china' : 'global';
  return MT_DEVICE_TTS_MODELS.map((m) => Object.assign({}, m, {
    files: m.files.map((x) => Object.assign({}, x, { url: typeof x.url === 'string' ? x.url : x.url[f] })),
  }));
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MT_DEVICE_TTS_MODELS, mtDeviceTtsModelsFor };
