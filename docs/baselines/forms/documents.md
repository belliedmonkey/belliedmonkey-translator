# 文档与其他形态端到端协议

每条分开。全部 **待测**。没有授权的 PDF、Word 或图片样本。

## document

适用范围：扩展文档页与 App 文档页共用 `DocCore` / `doc-view.js`。版本见清点。

能进的种类：`pdf`、`docx`、`txt` / `md`、`png` / `jpeg` / `webp`。`pptx`、`xlsx`、`epub` 和 OLE `.doc` 是 `unsupported`。不支持不是待测，是源码已写明的结果。

用户可见维度：

- 提取完整性：文字层里的字是否进了段落
- 阅读顺序：`paragraphsFromTextItems` 按 y 再按 x。双栏没有专门处理
- 表格/版式：源码写明双栏和表格不做特判。这一维在有样本之前不能报通过
- OCR：仅当图片，或 PDF 某一页没有文字层，并且引擎支持 vision、又不是免费额度拦截时才调用。有文字层的 PDF 不走 OCR

输入：用户选择的文件。输出：按页的双语段落。翻译提示与网页文字相同。没有整句矫正，没有 ASR。

扫描页 OCR 的质量 **待测**。空文字层会触发识图，这只说明调用存在。

## adjacent-mac-offline-file

Mac App 上 `offlineVideoAsr` 默认关。桥不导入听译，也不导入翻译引擎。python 模块不在本仓库，所以 VAD、LID、切句都是 `pending`。

它不是 `webpage-youtube`、`webpage-podcast-timed` 或 `webpage-ai-transcript`。即使以后测了转写字错率，也不写入那三张表。

## adjacent-quick

Mac 选中文字走 `TranslationAPI.translate`。框选屏幕走 `TranslationAPI.ocr` 再翻译。维度是选中文本是否被翻完，以及截图识字是否漏行。 **待测**。不是网页文字基线，也不是文档基线。

## adjacent-system-translate

iOS/iPadOS 系统「翻译」拉起 `TranslationUIProviderExtension`。源语言不由系统传入，译成用本机设置。源码注释里的 1.2–1.4 秒是当时的真机观察，不是本协议记录的基线，不转抄为达标数字。 **待测**。

## adjacent-agent-host

`translate_page` 与 `translate_video_captions` 在 `agent/contract.js`。它们是宿主动作。与扩展 `DomSegmenter` 或 YouTube timedtext 是否同路，清点标为 `pending`。在对齐调用链之前，不把宿主试跑写进网页基线。

## 没有另列的形态

学习/复习只消费已经产生的句对。它不是第十三种翻译业务。本批没有发现需要再开一张端到端表的其他用户可见翻译形态。

## 门槛

无。表格「保留」若要定一个比例，先有授权文档样本和阅读顺序的人工对照。本批不设。
