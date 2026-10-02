// app/device-models.config.js — 设备内置朗读（learning-design §9.6.1）的**离线模型清单**。
//
// 与 backend.config.js 同一个纪律：地址与校验和只写这一处。模型不进仓库、不进 App 包 ——
// 首次使用时由原生（speech-bridge.swift）按这张表下载、逐文件 sha256 校验、解包到
// Application Support/mt-speech/<dir>/。换模型 = 用 scripts/pack-device-models.js 重打包、改这里的
// sha256/size/url；旧包因安装戳名含 sha256 会被视为未安装、自动重下。
//
// url 分 flavor（运行时按 window.MT_FLAVOR / providers.gen.js 取）：**两个 flavor 现在都走魔搭 ModelScope**
// （2026-10-01 改；同一份 zip、同一个 sha256，只换托管）。原先 global 走 GitHub Releases ——
// 美国出口实测 13–14 MB/s，但国内直连只有 20–40 KB/s（2026-10-01 在 ZHAO的iPhone 上实测 ≈1%/分钟，
// 67 MB 要下约 1 小时）。魔搭实测：国内 6.4 MB/s、美国出口 6.4–6.9 MB/s（67 MB ≈ 10 s），
// 首字节比 GitHub 多约 1 s ⇒ 用「国外慢约一倍」换掉最坏的那一格（国际版包 + 国内网络）。
// 字节来自 cdn-lfs-cn-1.modelscope.cn（中国 CDN，没有国际节点；modelscope.com 只是 .cn 的英文入口）。
//
// 只覆盖 zh / en（Piper，sherpa-onnx 的 vits 形状）；不在表里的语言由 tts.js 回落到系统语音并在行上具名。
var MT_MODELSCOPE_BASE = 'https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/';
var MT_DEVICE_TTS_MODELS = [
  {
    lang: 'zh', dir: 'piper-zh', model: 'zh_CN-huayan-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data',
    files: [{
      path: 'piper-zh.zip', size: 67411393,
      sha256: '071b226531f829851c0df15ac5f5050d8c56e9a24e479c9f3b531cd377e84c92',
      url: {
        // 两个 flavor 同址（见文件头）；备选托管 hf-mirror.com/belliedmonkey/belliedmonkey-device-models。
        global: MT_MODELSCOPE_BASE + 'piper-zh.zip',
        china: MT_MODELSCOPE_BASE + 'piper-zh.zip',
      },
    }],
  },
  {
    lang: 'en', dir: 'piper-en', model: 'en_US-lessac-medium.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data',
    files: [{
      path: 'piper-en.zip', size: 67388973,
      sha256: '1c69a1f2332238e52594c22beeac204430740bff549bf0e58701e730d2c34c1c',
      url: {
        global: MT_MODELSCOPE_BASE + 'piper-en.zip',
        china: MT_MODELSCOPE_BASE + 'piper-en.zip',
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
