# 独立离线复验：supplement-gate 包 e5a17a1c / 01M7BZMPXBWB0C6952HYQ3SNY3

**结论：复验未通过，停，不修包，不启动付费。** 上一失败包 75266d0a 的六项硬闸（成功 pair、缺 origin、随意 summary、seed 槽位、out=origin、非空 out）以及 symlink / `..` / origin 父子别名，在使用**诚实** origin-lock（由正式 parsed 推导 57/15）时均已在发请求前拒绝，且不写原件。但仍有一个与「成功 pair / 付费范围」直接相关的缺口：`failedPairs`/`succeededPairs` 只来自 lock JSON，包不读取已钉扎的 origin `summary.json`/`parsed/` 来核对，伪造列表即可把已成功项标成失败并发请求。

授权：用户 t57u 流程下仅离线最小独立复验。不 paid、不网络、不 Mac、不 key、不改 repo、不改正式 v2 证据、不修包、不自动扩修。75266d0a 包永久 FAIL，本轮未当 runner 使用。时间：2026-11-14 10:56 Asia/Shanghai (CST)。cloud 所称 3412 tests / CI green 不在本包内，未重跑。

## 已通过（诚实 lock + 最小六闸）

- 包 23824 字节，sha256 `a44cf59f13febe3232519c08314166d9570b753151d85860058cd8031121a4fb`。内层 SHA256SUMS 全部匹配。`run-judge.js` sha `9d884e73…fca6f750`，不是 75266d0a 的 `d58e7e26…`。
- prompt / contract / parser / scoring / assign / schema / input-bound 与正式 v2 同源。prompt 仍为 `a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923`。72 条 pack prompt 与正式请求 messages 一致。
- 冻结 selection 15 对规范 sha `c151018bfda2953d2375f8cfce25580787745f162824b66f2d7eccec641979a4`（GPT 2 / Qwen 13）未改。全 36 输入 sha `1a44cca3…7c795a1`，seed 20261113，assignment **整文件** sha `3c54b9c2…e79470`，**规范** body `JSON.stringify({schema,seed,items})` sha `3cffd11608d4cf4f721ca410cbd93a2a183d1cc7f2f6659e581524e79fb5f52e`（与整文件不同，lock 使用后者）。
- 由正式 `parsed/` 统计 succeeded 57、failed 15，与 `summary.results` 及冻结 selection 一一对应、零错位。据此在包外生成 `lock/origin-lock.json`（schema `belliedmonkey.llm-judge.origin-lock.v1`），未改原 run。
- 草稿配置：`budgetUsd=0.17905768`，`maxRequests=15`，`maxTotalTokens=48000`，`maxRetries=0`，预留 `2×0.00411136+13×0.0018688=0.03251712`，模型与 1152+2048 未改。
- 真实 36 dry-run：`called=false`，`selectedPairs=15`。input-bound 仍检查全部 72（更保守），15 条选中全部 ok，声明 token 660–889。
- 合成 transport：只发 15，已有效 57 不发。`supplement-complete`/`partial` 时 `singleRunComplete` 与 `doubleBlindComplete` 仍为 false。`derived-merge.json` 对 origin 57 标 `source=origin`、`verdict=null`（只引用、不拷贝、不挑优）；补评 15 标 `source=supplement`，无效则为 null。`--out` 与 origin 不同时，正式 summary 仍为 `4744aef1…34365f`。缺 usage 保留预留并停止后续请求。
- 发请求前拒绝且不写原件：selection 含官方成功 pair → `selection-not-failed`；缺 origin → `origin-required`；缺 origin-lock → `origin-lock-required`；随意 summary → `origin-hash`；`seed=1` → `seed-mismatch`；out=origin → `out-is-origin`；非空 out → `out-not-empty`；out 符号链接到 origin、`..` 别名、out 在 origin 内、out 为 origin 父目录 → `out-is-origin`。正式证据未被写入。

## 最小阻塞（唯一失败，足以不得付费）

**`origin-lock` 的 `failedPairs`/`succeededPairs` 不被 origin 判决钉扎。** 保持正确的 `summarySha256`/`inputSha256`/`assignmentSha256`/`promptTemplateSha256`/`seed`/`models`，仅把官方已成功的 `en_us/1668`×`judge-a` 从 `succeededPairs` 挪到 `failedPairs` 后，合成 `--run` 发出 1 次请求并得到 `supplement-complete`。

因此 lock 列表本身不足以「与真实 parsed 57/failed 15 一一对应」：对应关系只存在于本目录外置的诚实 lock 文件，包在付费前并不核验。这是原「成功 pair 必须拒绝」缺陷的残留旁路，影响付费范围。

最小修复期望（不在本轮改包）：在 `summary.json` hash 已匹配后，从该 summary 的 `results`（或 origin `parsed/`）推导成功/失败集合，要求 lock 列表与之完全一致，否则拒绝且不发请求。不得只相信 lock JSON 的自称。

## 因此不宣布 ready，不提供可执行付费入口

`config/config.supplement-budget-remaining.json`、`lock/origin-lock.json`、`selection/selection-15.json` 只供检视和复验对照，旁有 `DO-NOT-RUN.txt`。父侧在此缺口修复并再次独立复验通过前，不要用本包执行 15 次补评。本步未执行付费。

日后若复验通过，Mac wrapper 才应：注入与正式 v2 相同的 `countTokens`；调用 `runJudge` / `main`，参数为冻结 `--input`、本 `--config`、`--select selection-15.json`、`--origin` 正式 v2 `judge-run`、`--origin-lock` 由正式 parsed 生成并经包内核验的 lock、`--out` 空的新目录且不得等于/嵌套/别名 origin；密钥只在 Mac 内存。现不得执行。

## 可复现（离线、不付费）

```
node /workspace/baseline-sa-sv-36-20261113/judge-prep/verify-e5a17a1c-supplement-gate/scripts/verify-supplement-gate.mjs
```

逐条结果：`out/verify-results.json`（36 项，35 通过，1 项 critical 失败）。
