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
// 模型下载地址（2026-10-05 起对客户端不可见）：编译进包的兜底值一律走 api.belliedmonkey.com/models/
// 中继 —— 反编译只看到自家域名，不知道实际从哪拉的。真实地址存在两处：
//   1. bt_model_sources 表（优先路，model-sources.js 运行时查询替换）
//   2. Caddyfile 的 /models/* 重定向（deploy/china/Caddyfile，部署侧）
// 这里的 URL 是「服务器连不上时的最后兜底」—— 而服务器连不上时这个地址也连不上，
// 所以它唯一的作用就是不暴露真实托管。
var MT_MODEL_RELAY = 'https://api.belliedmonkey.com/models/';
var MT_KOKORO_PACK = {
  path: 'kokoro-zh-en.zip', size: 146767700,
  sha256: '5bab4f620353a5d80f98f8bd0a5e68cbeedccfb1c68c53baa83b834a0e926326',
  url: {
    // 两个 flavor 同址（见文件头）；备选托管 hf-mirror.com/belliedmonkey/belliedmonkey-device-models。
    global: MT_MODEL_RELAY + 'kokoro-zh-en.zip',
    china: MT_MODEL_RELAY + 'kokoro-zh-en.zip',
  },
};
var MT_DEVICE_TTS_MODELS = [
  {
    lang: 'th', dir: 'vits-mms-tha', type: 'vits', dataDir: '',
    model: 'model.onnx', tokens: 'tokens.txt',
    files: [{
      path: 'vits-mms-tha.zip', size: 105167496,
      sha256: '26ee310a040d3444a9240ba3591b0bee7b316ba9cbd6da9de6e582db97089250',
      url: {
        // 两 flavor 都走中继（2026-10-05）：客户端不暴露真实托管。
        global: MT_MODEL_RELAY + 'vits-mms-tha.zip',
        china: MT_MODEL_RELAY + 'vits-mms-tha.zip',
      },
    }],
  },
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
  // ── 泰语朗读：**暂时没有默认离线包**（2026-10-04 用户裁定按保守处理）────────────
  // 我们打过、也托管过 `vits-mms-tha`（Meta MMS-TTS），但它权重是 **CC-BY-NC 4.0（禁商用）**
  // ⇒ 不能当成可上架的默认分发包，也不进构建。**已从两处托管与这张清单里摘掉**（附件在
  // `.local/device-models/` 留着，将来换到许可干净的模型时可直接用）。
  // 泰语朗读因此回落到**系统语音**（`tts_device_lang_fallback` 那行会在界面上具名说明）——
  // 这条路径许可干净、且本来就有。
  // 商用候选（2026-10-04 查证）：**没有** —— MMS / F5-Thonburian 都是 NC；MeloTTS 是 MIT 但不含泰语；
  // Piper 官方没有泰语声；sherpa-onnx 的 #3028 也仍把泰语列为缺失。找到许可干净、体积可接受的
  // 泰语模型后再按 Kokoro 那套（打包 → 双托管 → sha256/尺寸 → 中国版地址表 → verify:model-urls）替换。
  //
  // ── 泰语朗读（2026-10-04 用户拍板：**不再把 CC-BY-NC 的 vits-mms-tha 当正式默认包**）──────
  // 目标换成 ModelScope 达摩院 `iic/speech_sambert-hifigan_tts_waan_Thai_16k`
  // （SAMBERT + HiFi-GAN、发音人 waan、16 kHz、**Apache 2.0**、resource.zip 248 MB）。
  //
  // **但它今天进不了这条流程 —— 卡在三点（都实测过，不是推测）**：
  //   ① 仓库里**一个 `.onnx` 都没有**（199 个文件：`.pth` 权重 sambert 162.8 MB + hifigan 865.6 MB、
  //      `.scm` 词典、yaml/conf、festival 资源，外加 resource.zip 248 MB）⇒ 这是 PyTorch 的
  //      **DAMO pipeline** 模型，而设备端朗读走的是 sherpa-onnx（只吃 ONNX）。
  //   ② sherpa-onnx 的 TTS 家族只有 vits / matcha / kokoro / kitten / supertonic / pocket / zipvoice，
  //      **没有 SAMBERT+HiFi-GAN**；它是「声学 + 声码器」**两段式**，不是端到端单图 ⇒ 即使导出了 ONNX，
  //      也得先在原生侧写一套两段式推理（或把它推给 sherpa-onnx 上游）—— 那是工程，不是配置。
  //   ③ 它的 pipeline 包装是 Linux/Python（同族中文模型写明 pipeline 只支持 Linux），本机跑不了。
  // ⇒ 泰语朗读此刻回落**系统语音**（`tts_device_lang_fallback` 会在行上具名说明）。
  //    真要换上：先做 ONNX 导出 + 两段式运行时，再按 Kokoro 那套接（打包 → 双托管 → sha256/尺寸 →
  //    中国版地址表 → verify:model-urls）。许可证届时按 **Apache 2.0** 记。
];

// 给原生的形状：url 按 flavor 解开成一个字符串（原生不认 flavor）。
function mtDeviceTtsModelsFor(flavor) {
  const f = flavor === 'china' ? 'china' : 'global';
  return MT_DEVICE_TTS_MODELS.map((m) => Object.assign({}, m, {
    files: m.files.map((x) => Object.assign({}, x, { url: typeof x.url === 'string' ? x.url : x.url[f] })),
  }));
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MT_DEVICE_TTS_MODELS, mtDeviceTtsModelsFor };
