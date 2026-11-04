# Effect vs industry waterline · 效果与业界水位

Period / 期次：**2026-11** (monthly routine / 例行月报)  
Data cutoff / 数据截止：2026-11-01 (Asia/Shanghai)  
Competitor policy / 竞品口径：public leaderboards only; each number labeled **self-measured / third-party / vendor-reported**.  
Quality note / 质量：QUALITY-BRIEF-2026-11 已交质量总监；本页数字与 README 精简表一致。PASS ≠ merge to production code.

Current pipeline (live interpret / captions) / 听译·字幕现状管线（仅认 App Store 上架路径）：

**On-device SpeechAnalyzer → VAD/LID/segmentation → cloud qwen plus (repair + translate) → local TTS**

| Dimension 维度 | Ours (measured) 我们（有数） | Public industry anchor 业界公开锚 | Gap in one line 差距一句话 |
|---|---|---|---|
| Translation 翻译 | plus · App-contract COMET **88.8** (1600 sentences); Prod sample COMET **85.0** | Same-protocol DeepL/Google **no public number**; Hy-SimulMT FLEURS **90.3** (vendor-reported · different shape) | Self-measured high quality; cannot rank vs DeepL |
| ASR | Same-set SA: zh CER **6.3** · en WER **6.8**; SV slightly better on zh/en, SA better on ja/ko/yue | AA English top ~**1.7–2.3%** WER (**not language-convertible**) | On-device upgrade under validation; **do not wholesale-swap to SenseVoice** |
| ASR Thai 泰语识别 | On-device locale gap; Grok streaming archdemo CER **9.66%**, 0 drops | Cloud fills on-device gap | **Merge still awaiting user approval** |
| Interpret latency 听译延迟 | Debug App mic zh first volatile p50 **1.32s** (near ≤2s) | Meet 63-language UX (vendor); Seed first-word 2.21s (paper) | Unified production telemetry still missing |
| TTS 朗读 | Local / offline-capable; MOS **unmeasured** | AA: e.g. Eleven v4 Elo ~**1334** | Cloud voices pending listen tests; Drama3/OmniVoice watchlist |

**Not shipping soon / 不进近版**

- Replacing qwen-plus with qwen-flash / DeepSeek Flash
- Driving captions primarily from Grok streaming partials
- Fish ASR while still Preview (hold to GA)
- Ming TTS on CPU path
- Hy-SimulMT on rented cloud GPU
- Wholesale SenseVoice swap as the sole ASR core

**Next issue / 下期**

Monthly on the 1st, or sooner when effect changes materially. Numbers always labeled self-measured / third-party / vendor-reported.

## Notes

- COMET is from our FLORES / App-contract self-eval; it is **not** a public DeepL/Google head-to-head. Prod sample and Hy-MT2 oracle COMET **88.64** are side notes, not the App-contract anchor.
- Same-set SA↔SV (FLEURS-40): zh/en SV slightly better; ja/ko/yue SA better → **not** a uniform SenseVoice cutover. Live SA Chinese no longer relies on the old 12–18% doc proxy.
- BEL-112 Debug App mic zh first-volatile p50 **1.32s** / p90 **2.19s** is a Debug tip measurement — **not** a store telemetry dashboard. Do **not** cite BEL-111 ~12s harness as live latency.
- Artificial Analysis ASR numbers are **English**; Chinese CER is not comparable by arithmetic conversion.
- Thai Grok STT merge remains **user-gated**; caption rule remains gray partials + `speech_final` finalization.
