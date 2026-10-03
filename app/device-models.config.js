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
// 2026-10-03：**换成 Kokoro（int8 多语）**。zh 与 en 两条共用同一个包与同一个目录 ——
// 原生按 `dir` 里的安装戳判「装过没有」，所以只会下一次。为什么是一份多语模型：
// sherpa-onnx 的 kokoro 词表按**字符区间**自己分流中英（kokoro-multi-lang-lexicon.cc 的
// expr_chinese / expr_not_chinese），一个引擎就够，而 `lang` 只是给 espeak 的语言提示
// （cmn / en-us）⇒ 两条清单各带一个提示、共用一份权重。
// 装机实测（本机 Mac + Python sherpa-onnx，见 docs/learning-design.md §9.6.1）：
// int8 一个引擎峰值 RSS ≈460 MB、24 kHz、RTF 0.5–1.1；**所以原生侧只留当前语言那一个引擎**
// （切语言重装 1–2 s），两个语言同时驻留会被 iOS jetsam 杀。
// 尺寸：老 Piper 两条 67 MB×2=134 MB，新包 140 MB 一条覆盖中英 —— 下载量与原来同量级。
var MT_MODELSCOPE_BASE = 'https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/';
var MT_KOKORO_PACK = {
  path: 'kokoro-zh-en.zip', size: 146767700,
  sha256: '5bab4f620353a5d80f98f8bd0a5e68cbeedccfb1c68c53baa83b834a0e926326',
  url: {
    // 两个 flavor 同址（见文件头）；备选托管 hf-mirror.com/belliedmonkey/belliedmonkey-device-models。
    global: MT_MODELSCOPE_BASE + 'kokoro-zh-en.zip',
    china: MT_MODELSCOPE_BASE + 'kokoro-zh-en.zip',
  },
};
var MT_DEVICE_TTS_MODELS = [
  {
    lang: 'zh', dir: 'kokoro-zh-en', type: 'kokoro', kokoroLang: 'cmn',
    model: 'model.int8.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data',
    voices: 'voices.bin', dictDir: 'dict', lexicon: 'lexicon-us-en.txt,lexicon-zh.txt',
    files: [MT_KOKORO_PACK],
  },
  {
    lang: 'en', dir: 'kokoro-zh-en', type: 'kokoro', kokoroLang: 'en-us',
    model: 'model.int8.onnx', tokens: 'tokens.txt', dataDir: 'espeak-ng-data',
    voices: 'voices.bin', dictDir: 'dict', lexicon: 'lexicon-us-en.txt,lexicon-zh.txt',
    files: [MT_KOKORO_PACK],
  },
  {
    // 泰语朗读（2026-10-04，用户裁定「朗读包用我们自己打的、由服务器预制下发」）。
    // 形状：**MMS-TTS**（Meta 的 VITS，facebook/mms-tts-tha）—— 只有 model.onnx + tokens.txt，
    // 没有 espeak-ng-data ⇒ `dataDir` 是空串（`installed()` 与打包脚本都为此放行）。
    //
    // ⚠️ **许可证 CC-BY-NC 4.0（禁商用）** —— 这是目前唯一能直接打进手机的泰语 TTS：
    // sherpa-onnx 没有泰语 Piper；社区那个泰语 Piper 也是从 MMS 转的、同样 NC。
    // **商业分发是否可接受由用户拍板，不由代码替它定**；在用户明确许可之前，
    // 不要把这一条当成「可上架的默认朗读包」写进任何对外说明。
    // 要上商店发行需要先解决这件事（换许可干净的模型 / 自训 / 或只作端侧可选来源）。
    lang: 'th', dir: 'vits-mms-tha', type: 'vits', dataDir: '',
    model: 'model.onnx', tokens: 'tokens.txt',
    files: [{
      path: 'vits-mms-tha.zip', size: 105167496,
      sha256: '26ee310a040d3444a9240ba3591b0bee7b316ba9cbd6da9de6e582db97089250',
      url: {
        global: MT_MODELSCOPE_BASE + 'vits-mms-tha.zip',
        china: MT_MODELSCOPE_BASE + 'vits-mms-tha.zip',
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
