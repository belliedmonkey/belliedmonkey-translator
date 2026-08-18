// build/legacy-endpoints.config.js — 2026-08 之前那套「base + path」的冻结快照 (#147).
//
// 这是**历史**，不是配置。零拼接改动之前，每个存着的 base URL 都被当作 `base + path`
// 消费，path 来自注册表。所以「老代码会请求哪个 URL」是可以精确算出来的——运行时的
// legacy 分支和一次性迁移都靠它，两者都不需要对存值的含义做任何猜测。
//
// 三条规矩：
//   1. **永远不要从注册表读。** 注册表现在存的是完整端点，这里记的是改之前的样子。
//   2. **已有条目的值永不可修改。**
//   3. **之后新增的注册表条目永不可加进来**——新条目没有「改之前」。
//
// 为什么是 build/ 而不是手写进出货文件：这里的键名是引擎 id，其中四个（openai /
// claude / openai_speech / openai_transcribe）本身就是品牌词，而它们是 global-only。
// 直接写进出货的 .js 会被 build.js 的中国合规门逐行扫到并 fail build——那道门是对的，
// 中国包不该出现这些词。所以它和三张注册表走同一条路：build 时按 flavor 过滤后 emit。

module.exports = {
  // 每个能力一张表，键是引擎 id，值是当年注册表里的 `path`。
  paths: {
    chat: {
      openai: '/v1/chat/completions',
      claude: '/v1/messages',
      deepseek: '/v1/chat/completions',
      glm: '/api/paas/v4/chat/completions',
      qwen: '/v1/chat/completions',
      kimi: '/v1/chat/completions',
      custom_chat: '/v1/chat/completions',
      custom_msg: '/v1/messages',
    },
    tts: { local: '/v1/audio/speech', openai_speech: '/v1/audio/speech' },
    stt: { local: '/v1/audio/transcriptions', openai_transcribe: '/v1/audio/transcriptions' },
  },

  // 当年各条传输对尾斜杠的处理，逐条复刻。translation-api.js 与 notes.js 直接相加，
  // tts.js 与 speech-input.js 先裁掉尾斜杠——四处当年就不一致，legacy 分支的职责是
  // 复刻这份不一致而不是统一它：那个 `//` 正是这批用户今天在跑的东西，在没有任何证据
  // 的情况下「顺手修正」就是擅自改变行为。
  stripsSlash: { chat: false, tts: true, stt: true },

  // 哪个存储键配哪个引擎 id 键、算哪个能力。两个宿主完全一致：App 的「解析引擎」写的
  // 就是扩展翻译组用的那对 `provider` + `apiBaseUrl`（app/settings.js），两者含义不同
  // 但键相同，所以迁移逻辑永远不需要知道自己跑在哪个宿主里。
  keyPairs: [
    ['apiBaseUrl', 'provider', 'chat'],
    ['notesBaseUrl', 'notesProvider', 'chat'],
    ['ttsBaseUrl', 'ttsEngine', 'tts'],
    ['sttBaseUrl', 'sttEngine', 'stt'],
  ],
};
