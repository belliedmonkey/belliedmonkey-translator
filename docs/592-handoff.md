# #592 交接文档（QwenCloud 国际免费额度中继）

## 目标
下一版 iOS 带 #592：Supabase 边缘函数 `bt-relay` 在 `UPSTREAM=qwencloud` 且令牌哈希在 `QWENCLOUD_ALLOW_TOKEN_HASHES` 时，聊天、朗读、转写走 QwenCloud 国际 API。

## 当前状态
- 工作树 `~/mobiletranslator-592`，分支 `cursor/feat-592-unified-subs`，提交均为本地，未推送：`93e02a69`、`5050867c`、`ea8bb067`（朗读改 SSE）、`6c33f770`（流式日志）。
- `bt-relay` 已部署；`UPSTREAM` 当前未设置（线上走原路径）。白名单只含令牌前 8 位 `afeada82`（belliedmonkey.en@gmail.com）。
- 聊天（`qwen3.7-plus`）、朗读（`qwen3-tts-flash`，SSE 流式，读 Base64，不下载音频地址）已验证。
- 转写（`qwen3-asr-flash`）未验证：QwenCloud 文档未写明支持 m4a/webm，示例为 WAV、MP3，限制 10 MB、5 分钟。
- 已知 bug（#38 修复中）：`src/app/settings-view.jsx` 约 126-128 行填充转写下拉没传 `selected`，`populate`（`src/shared/engine-fields.js`）会隐藏 `grant_stt`，下拉读回为空；点「测试连接」或改转写字段会把 `sttEngine` 清空。

## 必须遵守的规矩
- 禁止推送、合并 `release/1.19.0`、提审。
- 每一步线上操作（部署 `bt-relay`、设置或取消 `UPSTREAM`、改白名单、发真实请求）都要用户单独同意；部署用 `supabase functions deploy bt-relay --no-verify-jwt`，不带 `--prune`、`--use-api`，失败不重试；回滚是 `supabase secrets unset UPSTREAM`。
- 不读 `keys.md`，不碰令牌明文；日志和记账表不记原文、音频。
- 不要在仓库里留临时文件；`git status` 只允许有 `app/native/vendor` 和 `node_modules` 两个未跟踪项。
- 做完一项后在 #592 贴评论（改了什么、测试数、提交哈希、「未找到」清单）然后停止，等用户下一步。
- 代码改动先写方案、再改，同类问题反复出现时先停手、写根因提案。

## 待办
1. 完成 #38（设置页 `selected` 修复 + 单测，本地提交）。
2. 读 `sttEngine` 的 id（只读 id，不读 `sttApiKey` 或令牌），确认测试包状态。
3. 转写 WAV 复测：临时设 `UPSTREAM=qwencloud`，用测试包点一次「测试连接」，立刻取消变量（每步需用户同意）。
4. 决定 m4a：客户端对额度路径录 WAV，或这一版转写不走 QwenCloud。
5. 之后：逐个加白名单令牌、发带 #592 的客户端、7 天观察。
