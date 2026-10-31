# 1.5.0 店铺文案草稿（四技能题型体系）

> 提交时机：等 1.4.2 四店落地 + 说题真机补测（learn-regression M9/M10 收尾，~08-18）
> 之后再提交。build 号提交时看 ASC 台账（iOS 已用至 27、macOS 至 15——以 gbrain
> 权威页复验为准）。本文件只是草稿，最终以提交当天为准；提交后把定稿沉淀回 gbrain。

## ASC What's New（简体中文）

```
1.5.0 —— 听说读写，每句都练到

学习模块升级为四技能训练体系：
• 新题型：译文选择题、盲听选词、朗读评测、AI 理解题
• 每次复习自动轮换「最久没验证」的能力——四项都保持新鲜，才算真正学会
• 朗读评测：录音只发送到你自己配置的转写服务，识别后立即丢弃，绝不经过我们的服务器；不配置就不出现朗读题
• AI 出题（可选）：用你自己的 API 为每张卡生成干扰项与理解题，每卡一次调用、永久缓存
• 所有新题型都有零成本的本地版本——不配置任何 API 也完整可用
```

## ASC What's New（English）

```
1.5.0 — Listen, speak, read, write: every sentence, every skill

The learning module now trains all four skills:
• New exercises: translation multiple-choice, blind-listen word picking, read-aloud scoring, AI comprehension questions
• Each review automatically rotates to your least-recently-verified skill — a sentence counts as learned only while all four stay fresh
• Read-aloud scoring: your recording goes only to the transcription endpoint you configure, and is discarded once the transcript returns — it never touches a server of ours. No endpoint configured, no speaking exercise.
• Optional AI-generated questions use your own API key — one call per card, cached forever
• Every new exercise has a zero-cost local variant — fully usable with no API configured at all
```

## CWS 更新说明（What's new，双语一段）

```
1.5.0: The learning module now trains listening, speaking, reading and writing — new exercise types (multiple-choice, blind-listen word picking, read-aloud scoring, AI comprehension questions) rotate to whichever skill you verified longest ago. Read-aloud recordings go only to the transcription endpoint YOU configure and are discarded after transcription. All new exercises have zero-cost local variants.

1.5.0：学习模块升级为听说读写四技能训练——新题型（译文选择、盲听选词、朗读评测、AI 理解题）自动轮换到你最久没验证的能力。朗读录音只发往你自己配置的转写端点、识别后即弃。所有新题型都有零成本本地版本。
```

## AMO Release notes（双语）

```
Four-skill training for the learning module: translation multiple-choice, blind-listen word picking, read-aloud scoring and AI comprehension questions, rotated to your least-recently-verified skill. Read-aloud recordings go only to the transcription endpoint you configure (discarded after transcription; the exercise simply doesn't appear without one). Every exercise has a zero-cost local variant.

学习模块四技能训练：译文选择、盲听选词、朗读评测、AI 理解题，按「最久未验证」的能力自动轮换。朗读录音只发往你自己配置的转写端点（识别后即弃；不配置则不出现朗读题）。所有题型都有零成本本地版本。
```

## 提交前检查（照 release-checklist + gbrain 权威页走）

- [ ] 1.4.2 四店全部落地（ASC iOS/macOS、CWS；AMO 已上线）
- [ ] M9/M10 真机收尾（说题录音回路 + 扩展页门控表现）
- [ ] 隐私相关：本版 README Gate C 段已随 #125 在包内；`belliedmonkey.cc/privacy.html`
      是否需要加朗读披露段——查 gbrain 后决定（站点在另一仓库）
- [ ] Firefox `data_collection_permissions` 不变（录音不经过我们，声明无需增长——
      learning-design §10 Gate C 的判断，提交时按 AMO 当日定义复核一遍）
- [ ] 截图是否补一张说题卡（可选，主打图已是学习闭环连环画）
