# #592 交接文档（QwenCloud 国际免费额度中继）

## 目标
下一版 iOS 带 #592：Supabase 边缘函数 `bt-relay` 在 `UPSTREAM=qwencloud` 且令牌哈希在 `QWENCLOUD_ALLOW_TOKEN_HASHES` 时，聊天、朗读、转写走 QwenCloud 国际 API。

## 当前状态
- 工作树 `~/mobiletranslator-592`，分支 `cursor/feat-592-unified-subs`，提交均为本地，未推送。较新提交：`4d4b361f`（`UPSTREAM=qwencloud` 时转写默认仍走 OpenRouter）、`bd6330a7`（本交接文档首版）、`9f355922`（#38 设置页转写下拉 `selected`）、`6c33f770` / `ea8bb067` / `5050867c` / `93e02a69`（中继 QwenCloud 与朗读 SSE）。
- HEAD `4d4b361f`。`npm test`：**2767 passed / 1 failed**（仅 X10 构建产物新鲜度，预期失败）。
- `bt-relay` 已部署；`UPSTREAM` 当前未设置（线上走原路径）。白名单只含令牌前 8 位 `afeada82`（belliedmonkey.en@gmail.com）。
- 聊天（`qwen3.7-plus`）、朗读（`qwen3-tts-flash`，SSE 流式，读 Base64，不下载音频地址）已验证。
- 转写：`4d4b361f` 起额度路径在 `UPSTREAM=qwencloud` 时**默认仍走 OpenRouter**（whisper），未端到端复测「测试连接」+ #38 修复后的 `grant_stt` 读回。若将来启用 `QWENCLOUD_STT=1`：QwenCloud 文档未写明支持 m4a/webm，示例为 WAV、MP3，限制 10 MB、5 分钟。
- #38 **已修**（`9f355922`）：`src/app/settings-view.jsx` 填充转写下拉已传 `selected`，避免 `populate` 隐藏 `grant_stt`、测连接写空 `sttEngine`。

## #41 上线前盘点（2026-10-17，只读）
- 评论：[#592#issuecomment-6222452906](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592#issuecomment-6222452906)（盘点日 HEAD `4d4b361f`）。
- 摘要：X10 产物未重建（**A**）；#569 两站隐私页与 L2 诊断披露（**D** 指部署上线，文案在站点仓）；#569 文档路径已修未验（**A**）；中继 ≥ `4d4b361f` 未部署（**D**）；QwenCloud Key / `UPSTREAM` 灰度多项 **D**；#38 **已修** `9f355922`；#590 / #592 真机项多 **B**；m4a vs ASR、TED 门槛等 **C** 待裁定。

## #42 隐私页文字（#569 第 3 处）
- **本仓库不含** `privacy.html`。中国版源文件在 `~/belliedmonkey-com/privacy.html`（EdgeOne Pages）；国际版在 `~/belliedmonkey-cc/privacy.html`（及 `scripts/gen-site-langs.js` 生成的多语言页，Vercel）。须分别在对应站点仓库改字并推送部署；`docs/release-checklist.md` 跨仓义务。
- 本地克隆已有部分稿（见 `docs/release-blockers-2026-10-16.md:110-124`），但未在本任务仓提交；**发布上线仍须用户单独同意**。

## 必须遵守的规矩
- 禁止推送、合并 `release/1.19.0`、提审。
- 每一步线上操作（部署 `bt-relay`、设置或取消 `UPSTREAM`、改白名单、发真实请求、推送站点隐私页）都要用户单独同意；部署用 `supabase functions deploy bt-relay --no-verify-jwt`，不带 `--prune`、`--use-api`，失败不重试；回滚是 `supabase secrets unset UPSTREAM`。
- 不读 `keys.md`，不碰令牌明文；日志和记账表不记原文、音频。
- 不要在仓库里留临时文件；`git status` 只允许有 `app/native/vendor` 和 `node_modules` 两个未跟踪项。
- 做完一项后在 #592 贴评论（改了什么、测试数、提交哈希、「未找到」清单）然后停止，等用户下一步。
- 代码改动先写方案、再改，同类问题反复出现时先停手、写根因提案。

## 待办
1. ~~完成 #38（设置页 `selected` 修复 + 单测，本地提交）。~~ 已完成 `9f355922`。
2. 读 `sttEngine` 的 id（只读 id，不读 `sttApiKey` 或令牌），确认测试包状态。
3. 转写 WAV 复测：临时设 `UPSTREAM=qwencloud`，用测试包点一次「测试连接」，立刻取消变量（每步需用户同意）；确认 #38 后 `grant_stt` 不被清空。
4. #569 两站隐私页：在 `belliedmonkey-com` / `belliedmonkey-cc` 改字并与 L2 行为一致，部署前用户同意。
5. 决定 m4a：维持 OpenRouter 默认（`4d4b361f`）、或启用 `QWENCLOUD_STT=1` 并验 WAV、或客户端额度路录 WAV。
6. 之后：部署含 `4d4b361f` 的 `bt-relay`、逐个加白名单令牌、发带 #592 的客户端、7 天观察。
