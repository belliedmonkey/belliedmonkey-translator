# 网页形态端到端协议

下面五条各自成表。不合成一个分数。全部 **待测**。`adjacent-mac-offline-file` 不在本文件的结果表里。

## webpage-text

适用范围：扩展内容脚本 `content-webpage.js`，`DomSegmenter.collectUnits` 之后走翻译引擎。宿主 `translate_page` 另见文档形态页，不在这里记分。

用户可见维度：

- 覆盖：该翻的段有译文或明确失败，不静默消失
- 上下文：代词、标题与正文是否被切散后丢了所指
- 结构：列表、表格单元格、栏宽是否还在原来的位置

输入：页面 DOM。输出：段落下的译文行。提示词是 `buildSystemPrompt`。没有整句矫正。

没有授权页面样本。测试夹具只证明排版逻辑，不进质量基线。

## webpage-youtube

适用范围：`content-youtube.js` 取完整 timedtext，合并成句，按播放时钟显示。无字幕时的转写不在本条。

用户可见维度：时轴、切分、覆盖、长内容后段是否与前段一致。

输入：已有字幕轨。输出：原文字幕下的译文。不经过 ASR。

## webpage-x-video

适用范围：`content-twitter.js`。源码写明 VTT-only, no ASR。维度与 YouTube 相同，数据源不同，所以分列。 **待测**。

## webpage-podcast-timed

适用范围：`content-podcast.js`。只翻译页内 WebVTT/SRT、`podcast:transcript` 或 Spotify 同步 DOM。没有稿就显示不可用，并留给网页文字路径。维度同上。这条的 ASR 格是 `not-applicable`。 **待测**。

## webpage-ai-transcript

适用范围：用户在「字幕不可用」里点按之后，`asr-source.js` 把音频送到用户自己的转写端点，再进入字幕翻译。默认不跑。

维度仍是时轴、切分、覆盖、长内容一致性。阶段上多一个 opt-in ASR。VAD/LID 在清点里是 `pending`，端到端报告里要照实写「未核实」，不要补上听译那套 Silero/ECAPA。

不得用 Mac 本地文件桥的输出填充本条。

## 共同记录

质量失败方式、延迟、成本、用了哪条提示、provider/model，分条写。门槛不设。样本 0。
