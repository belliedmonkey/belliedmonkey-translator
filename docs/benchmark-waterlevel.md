# Effect vs industry waterline · 效果与业界水位

Period / 期次：**2026-10** (first issue / 首期)  
Data cutoff / 数据截止：2026-10-23 (Asia/Shanghai)  
Quality endorsement / 质量背书：quality director approved the five bullets below for README (PASS ≠ merge to production code).  
Competitor policy / 竞品口径：public leaderboards only; each number labeled **self-measured / third-party / vendor-reported**.

Current pipeline (live interpret / captions) / 听译·字幕现状管线：

**On-device SpeechAnalyzer → VAD/LID/segmentation → cloud qwen plus (repair + translate) → local TTS**

| Dimension 维度 | Ours (measured) 我们（有数） | Public industry anchor 业界公开锚 | Gap in one line 差距一句话 |
|---|---|---|---|
| Translation 翻译 | plus · App-contract COMET **88.8** (1600 sentences) | Same-protocol DeepL/Google **no public number** | Self-measured high quality; cannot rank vs DeepL |
| ASR Chinese 中文识别 | Live SA; offline SenseVoice CER **~5–7%** (colloquial/meeting) | AA English board top ~1.7–2.3% WER (**different language — not convertible**) | On-device Chinese upgrade still under validation; not in near releases |
| ASR Thai 泰语识别 | Grok streaming archdemo CER **9.66%**, 0 dropped sentences | On-device gap filled by cloud | **Approved for 1.20.x** (direct xAI; production relay unchanged) |
| Interpret latency 听译延迟 | Doc targets exist; unified online telemetry **not yet published** | Meet 63-language UX bar (vendor-reported) | Instrument first, then compare |
| TTS 朗读 | Local / offline-capable | AA: e.g. Eleven v4 Turbo Elo 1335 | Cloud voice upgrade pending listen tests |

**Not shipping soon / 不进近版**

- Replacing qwen-plus with qwen-flash / DeepSeek Flash (quality gate failed)
- Driving captions primarily from Grok streaming partials
- Ming TTS on CPU path

**Next issue / 下期**

Monthly on the 1st, or sooner when effect changes materially. Numbers always labeled self-measured / third-party / vendor-reported.

## Notes

- COMET is from our FLORES / App-contract self-eval; it is **not** a public DeepL/Google head-to-head.
- Artificial Analysis ASR numbers cited elsewhere are **English**; Chinese CER is not comparable by arithmetic conversion.
- Thai Grok STT: archdemo hard gates CER ≤15% and 0 dropped sentences passed (9.66% / 0/40). Caption rule remains gray partials + `speech_final` finalization — streaming must not own the caption primary display.
- Lock latency for Thai is an **observation gate** for TestFlight / store submit, not a sole merge blocker for the 1.20 candidate.
