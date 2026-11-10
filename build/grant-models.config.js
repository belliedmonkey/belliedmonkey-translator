// build/grant-models.config.js — 免费额度三档的模型名，**只写这一处**。
//
// 这几行同时决定三件事，而它们必须逐字一致：
//   · 客户端注册表里 `grant` / `grant_speech` / `grant_stt` 的 defaultModel
//     （领取时会被显式写进配置，见 quick-setup.plan 的 pinModel）
//   · 新的 BYO `qwencloud*` 条目的默认模型（一键卡配出来的就是这一档）
//   · 中继 `/spec` 回读的三个值 —— `npm run grant:status` 逐字比，不一致就是
//     客户端说的和服务端做的不是一回事（客户端先钉模型而中继没切 ⇒ 403）。
//
// 2026-11-10（BEL-236）：中继上游切到 QwenCloud 国际站之后，三档就是这三个名字。
// 旧客户端仍送 deepseek/…、deepgram/…、openai/whisper-1，中继的 QC_LEGACY 接受并
// 换成钉死的这一组 —— 所以换名字不会打断 1.23.3。
//
// 构建期文件，不进任何出货包。
'use strict';

module.exports = {
  chat: 'qwen3.7-plus',
  tts: 'qwen3-tts-flash',
  stt: 'qwen3-asr-flash',
};
