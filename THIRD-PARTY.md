# 第三方组件与许可（THIRD-PARTY）

本文件登记**随产品分发**的第三方组件及其许可。产品本体是 MIT（见根 [`LICENSE`](LICENSE)）。第三方组件不随产品本体换牌。

三处纪律：

1. **模型不打进 App 包**，运行期从我们的中继下载并按 sha256 校验（`app/device-models.config.js` 是唯一清单；
   真实托管地址只在服务端与 `deploy/` 里）。所以这里的"分发"指的是**我们托管它们**。
2. **换一个模型/库的版本或来源，必须同时更新本文件** —— 与 `build/perf-ledger.config.js` 一样，
   它是"这东西哪来的"的唯一答案。
3. 许可不明的组件不许用（例如 CC-BY-NC 的 `vits-mms-tha` 已于 2026-10-04 撤下，见下）。

## 端上模型（App，运行期下载）

| 组件 | 用途 | 许可 | 来源 |
|---|---|---|---|
| **SpeechBrain ECAPA VoxLingua107**（`speechbrain-ecapa-voxlingua107.zip`） | 语种识别（LID，§9.6.1.3 默认引擎） | **Apache-2.0** | 模型 `speechbrain/lang-id-voxlingua107-ecapa`；CoreML 版 `aufklarer/SpeechBrain-ECAPA-VoxLingua107-21M-CoreML`。**训练集 VoxLingua107 是 CC-BY-4.0**（数据集仅用于训练，不再随本产品分发） |
| **OpenAI Whisper tiny**（`sherpa-onnx-whisper-tiny.zip`） | 语种识别（LID，开发开关 `lidEngine='whisper'` 时才下载） | **MIT** | 模型 `openai/whisper`；ONNX 版 `csukuangfj/sherpa-onnx-whisper-tiny` |
| **Silero VAD**（`silero_vad.onnx`） | 判"这段是不是人在说话"，只把话音喂给 LID | **MIT** | `snakers4/silero-vad` |
| **Kokoro-82M**（`kokoro-zh-en.zip`） | 设备内置朗读（中英，`type: 'kokoro'`） | **Apache-2.0** | `hexgrad/Kokoro-82M`；sherpa-onnx 转换/词表见 `k2-fsa/sherpa-onnx` |
| ~~**VITS MMS-tha**（`vits-mms-tha.zip`）~~ | ~~泰语朗读~~ | ~~**CC-BY-NC-4.0**~~ | **2026-10-04 已撤下**：非商用许可不适合作为正式默认包，行已在 `bt_model_sources` 置 `active=false`、中国版回落到系统语音。要换上需先做 ONNX 导出 + 两段式运行时（见 `app/device-models.config.js` 那段说明） |

## 端上运行时（App）

| 组件 | 用途 | 许可 | 来源 |
|---|---|---|---|
| **sherpa-onnx** | 离线 TTS / VAD / 语种识别的推理封装 | **Apache-2.0** | `k2-fsa/sherpa-onnx`（本地 SwiftPM 包，`scripts/fetch-native-deps.js` 钉版本 + sha256） |
| **ONNX Runtime** | 上面那个的推理后端 | **MIT** | `microsoft/onnxruntime`（同上） |
| **Apple Core ML / SpeechAnalyzer** | 系统框架（不是第三方） | Apple SDK 条款 | 随 Xcode 提供，不重新分发 |

## 浏览器扩展（打包进分发物）

| 组件 | 用途 | 许可 | 位置 |
|---|---|---|---|
| **PDF.js** | 文档翻译里读 PDF | **Apache-2.0** | `extension/vendor/pdfjs/`（含 `LICENSE`） |
| **Figtree**（可变字重） | 界面字体 | **SIL OFL 1.1** | `extension/fonts/figtree-latin-var.woff2` + `OFL-Figtree.txt` |
| **Caprasimo** | 品牌字体 | **SIL OFL 1.1** | `extension/fonts/caprasimo-latin.woff2` + `OFL-Caprasimo.txt` |

## 服务端

服务端只跑我们自己的代码（Postgres / GoTrue / PostgREST / Caddy / Deno 都是**我们自己部署的运维组件**，
不随产品分发）。托管模型与许可登记在上表；`bt_model_sources` 表里只有**中继地址**，
真实托管地址在 `deploy/` 与 `bt-models` 服务里。

---

*最后更新：2026-10-08（新增 SpeechBrain ECAPA VoxLingua107，语种识别默认引擎）。*
