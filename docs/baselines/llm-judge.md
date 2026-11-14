# LLM 评委

这是独立研究入口，不是产品桥，不是默认链路，也不是发布。索引见 [`docs/baselines/README.md`](README.md)。端到端仍 **待测**。

2026-11-13 16:58（Asia/Shanghai）的原话是：可以，尤其适合评判翻译是否忠实、漏译或增译，以及表达是否自然；但语音识别仍应以错误率为主，LLM 辅助区分数字写法等表面差异与真正的内容错误。建议采用匿名、随机顺序的双模型盲评，固定评分标准，并抽样人工复核；保留原始错误率，不让评委模型把真实漏识别解释掉。

这里只做已有 ASR 文本的辅助判分。不新开翻译模型实验，不接产品，也不把音字听审当成语义人评。

## 评委看不到什么

参考和候选只以文本进入提示词。比较两条候选时，顺序由固定 seed 打乱。哪一条被放进 slot-1，写在证据目录的 `assignment.json`，不写进请求。请求里没有后端名字，没有 WER、CER、MER，也没有既有结论。

两个评委必须是两个不同的 model 字符串。缺端点、缺密钥、或两个 id 相同，结果是 `blocked` 或 `same-model`。不会用同一个模型假装两个评委。本仓库不登记新账号，不订阅，不把密钥写进文件。`--run` 才读配置里点名的环境变量，证据里的 Authorization 只写 `redacted`。

默认是 dry-run。它不读环境变量，不访问网络，`called` 为 false，`results` 为 null。条数超过 `maxItems` 时 dry-run 也是 `item-cap`，不是成功。被略过的 id 在 `omittedIds`，人审表的 `notAssessed` 列出全部未评 id。`disagreement` 和 `sample` 是另外两栏。`semanticHumanReviewCount` 保持 0。

本文件不指定已经选中的模型，也没有已经发生的调用。配置里的 model 字符串只是占位，直到操作者填上两只不同的 id。temperature、seed 和提示词模板 sha256 由当次配置和 `rubric.js` 记下来。

## 费用

正式运行不能把 `budgetUsd` 留空。每个 model 要有一份事先声明的价格：来源、来源版本、每 token 的输入价和输出价。两边都是 0 只有在 `pricedZero` 为 true 时成立。价格缺失，或者预算装不下一次保守预留，在第一次请求之前就是 `price-missing` 或 `budget-blocked`。

每次预留都是配置里的 `maxInputTokens * 输入价 + maxOutputTokens * 输出价`，不用更小的字符估计去少留。用量没有超过这两个上限时，才按 token 数核销。响应里的 `usd` 只记成 `providerUsd`，不参与预算。超时或 HTTP 失败可能已经计费，全额预留留下，`costUnknown` 为 true，并且不再发出下一次。`maxRetries` 必须是 0。请求文件在发送前就写下，`authorization` 是 `redacted`。结束时无论成败都写 response 和 parsed。失败时 `plan.json` 仍留下输入检查和预留上界。

发送前要量整段请求体，包括 system、user、JSON 转义和 role。字符数除以 4 不是 token 上界，这里不用它。没有声明 `inputBound` 就不发送。`utf8-bytes-plus-overhead` 把请求体的 UTF-8 字节数加上操作者写的 `overheadTokens`，再和 `maxInputTokens` 比。字节数已经包含本仓库拼出来的模板。`overheadTokens` 只覆盖供应商可能另加的特殊 token。本仓库不证明某个模型的分词器，也不给出一个通用整数。选这个界，等于操作者断言「一个 token 至少占请求体里的一个 UTF-8 字节，额外特殊 token 不超过 overhead」。不能这么断言就不要选它。`counter` 只有在调用方提供计数函数时可用，否则是 `tokenizer-unspecified`。这两种都不是精确 token 数。

请求体会带 `max_tokens`。这只在离线形状里核对过，没有对真实网关验证。返回的 `prompt_tokens` 或 `completion_tokens` 超过声明上限时，预留不退回，`providerExceededDeclaredCap` 为 true，后续调用停止。这只说明返回值超过了我们声明的上限，不是一份已经证实的网关违约。

用户消息是一份 JSON。字符串是不可信数据，不授予执行、链接或额外目标。这不能说成已经挡住了模型自己跟着文本走。

## 审计

chair 审计了包 `f4a58b85f79c7e8da13d2049f987802bcd0fbebbdb70320c85b0aaf422302d55`。`AUDIT.md` 的 sha256 是 `74c8c620ee7ca56ebbd9a1e89a1f790c3cd64f90e489dbed27af69c9980c432b`。本仓库没有打开 `/workspace/baseline-sa-sv-36-20261113/judge-prep/audit/AUDIT.md`。上面的费用和文本边界就是那次审计指出的阻塞。真实评委没有调用。

chair 的 36 条双臂输入 sha256 是 `1a44cca3bf05662c8701d943702a35e7fd1a303f9bcd931764775d9057c795a1`，配对清单是 `2e5d95d1b61e16f9e0b3506f3e949b94c9717d577e1cc8c41fe72e3b6e221bb7`。身份在单独的映射里，不进请求。那次 dry-run 是 `called` false、`results` null，seed `20261113` 有 18/36 对调。本仓库没有这份输入，没有重跑它，也没有第二只假臂。

## 固定量表

当前发送的量表版本是 `belliedmonkey.llm-judge.asr.v2`。判决 schema 是 `belliedmonkey.llm-judge.verdict.v2`。`slots` 必须是长度为 2 的 JSON 数组，不是以 slot 名为键的对象。`note` 和 `reason` 最长 400。kind 只有 `format-only`、`entity`、`number`、`negation`、`semantic`、`omission`、`addition`。这些句子和一份完整示例都在实际发送的 system 提示里，和解析器用同一份 `verdict-contract.js`。`refQuote` 必须出现在 reference 里，`hypQuote` 必须出现在同一槽的候选里。缺引用就弃权，不能编造。

## 2026-11-13 首轮 partial

父侧离线摘要：72 次请求都结算了。GPT 官方解析 0/36，其中 35 条把 `slots` 写成对象，1 条 `ascend/00066` 是非法 JSON。Qwen 官方解析 32/36。冻结提示句是 “slots has one object for slot-1 and one for slot-2.”，没有数组示例，400 字上限当时只在解析器里。那个提示的 sha256 仍是 `a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6`，对应包 `74258e362de80cf39986717b32b65ef6ec9d3719bd60d21b91af54c1d441a9fe`。本仓库没有打开父侧 box 里的其他原件。官方结果保持 `partial`，不回填。ASR 的 29/363、57/624、17/42 与 SA 的 36/363、57/624、24/42 都不改。

对象改成数组的适配只在 `slots-object-adapter.js`，标记为诊断。它不进入正式解析，也不把那 30 条事后双有效写成正式双盲。非法 JSON、超长 note、跨槽引用、多出来的标点和未允许的 kind 仍然是 null。

v2 的新判断必须两只评委都用这份新提示重跑。不能把修提示后的 GPT 和旧的 Qwen 拼成同一轮。一次完整计划是 36 条乘 2 只评委，共 72 次请求。每次预留仍是配置里的全部 `maxInputTokens + maxOutputTokens`，72 次都一样，不按短文本少留。不要沿用任何 40 次的混跑预算。当前 v2 system 提示是 2507 个 UTF-8 字节，sha256 `a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923`。这只是模板。真实 36 条文本不在本仓库，逐条 user 字节要等父侧对自己的输入做 dry-run。`maxInputTokens` 必须盖住整段请求体加 `overheadTokens`，不能把 2507 直接当成 36 条的输入上限。

## 错误记录和定点补评

`usageComplete` 只表示 token 字段齐全。`generationOk` 只在 `finish_reason` 为 `stop` 或 `length`、且没有供应商错误时为 true。二者都不是判决成功。`finish_reason=stop` 且正文不是合法判决时，`modelFormatFault` 为 true，解析码仍是原来的 `bad-json`。`finish_reason=error` 即使正文不闭合，也不是模型格式过错。没有完整 token 用量时费用仍是未知，预留留下，后续调用停止，并且不自动重试。缺 `note`、精确引用失败、`length` 都各自留在 `parseCode` 或 `finishReason` 里。

父侧 v2 首轮仍是 partial。本仓库不回填那次 run。观察包 `75266d0a`（归档 sha256 `89a6a263dfff22fb0415f30de43e5e26dfc51f92a6e1be4896aa799678179ee4`）的离线复验没有通过，也没有付费。那一版会在六种情况下仍然发出或覆盖目录：selection 里夹着 origin 已成功的 pair；`--run --select` 没有 `--origin`；任意 `summary.json` 都被当成 origin；seed 或 assignment 槽位变了仍发；`--out` 等于 origin；`--out` 里已经有文件。这六种现在都在任何请求之前拒绝，并且不写 origin，也不改非空的 out。

定点补评仍然只重跑 origin 里明确失败的 pair。成功项留在原件上，失败项也不从多条结果里挑一条。`--run` 加上 `--select` 必须同时有 `--origin`、`--origin-lock` 和一个空的新 `--out`。lock 是外部文件，schema 是 `belliedmonkey.llm-judge.origin-lock.v1`。旧 run 缺字段时，由父侧按已经冻结的文件生成这份 lock，不改原 run。

lock 要钉住这些字节：`summarySha256` 是 origin 目录里 `summary.json` 的原始字节；`inputSha256` 是 `--input` 文件的原始字节；`promptTemplateSha256` 必须等于当前 v2 模板 `a2e82f866445b73f2956011c4ff27ce7ff9b233d2aa2c5c5c9d2b7fa9d220923`；`seed` 和 `models` 必须等于当次配置；`assignmentSha256` 是 `JSON.stringify({ schema: 'belliedmonkey.llm-judge.assignment.v1', seed, items })` 的 sha256，`items` 只取 assignment 的 `id` 和 `slots`，不含说明文字。`failedPairs` 只列 origin 明确失败的 `{itemId, judgeId}`，`succeededPairs` 列仍然有效的 pair。selection 的每一对都必须落在 `failedPairs` 里，并且不能落在 `succeededPairs` 里。selection 的 schema 仍是 `belliedmonkey.llm-judge.selection.v1`。父侧那份 15 对 selection 的 sha256 是 `c151018bfda2953d2375f8cfce25580787745f162824b66f2d7eccec641979a4`，只作为他们自己的 lock 可以钉的值，本仓库不把这份名单写进代码。

origin 的 `summary.json` 若写成 `code` 为 `complete`，或 `singleRunComplete` / `doubleBlindComplete` 为 true，直接拒绝。一份任意摘要不能变成完整双盲。

派生表写在新目录的 `derived-merge.json`。有效 pair 的 `source` 是 `origin`，`verdict` 保持 null，只表示原件引用。选中的失败 pair 的 `source` 是 `supplement`，只用这一次请求的解析结果；解析无效就是 null。`singleRunComplete` 和 `originSingleRunComplete` 保持 false。`supplementComplete` 与 `coverage` 分开记。`coverage.cherryPick` 是 false。人审不在这个入口里。

```bash
node eval/baselines/judge/run-judge.js --run \
  --input full-input.json --config config.json \
  --select selection.json --origin /path/to/origin-run \
  --origin-lock /path/to/origin-lock.json \
  --out /tmp/judge-supplement-empty
```

评委没有听过音频。不能用常识把听到的内容改对，不能删掉括注里的拉丁字母，也不能把 `um` 从参考里拿掉。原始编辑率不由这个入口重算，`editRates` 保持 null。

翻译量表的名字留着：`belliedmonkey.llm-judge.translation.v1`。没有待评译文时任务直接是 `translation-not-open`，不生成分数。1675 的中英平行原文意思并不相同，不能当翻译 gold。

## 失败怎么记

输入多一个字段、缺一条、或 id 重复，退出码不是 0，`results` 为 null。模型返回坏 JSON、引用了不存在的片段、或在文本里说出候选 key，该评委该条是 null，不是 0。只有一个评委有结果时，`code` 是 `partial`，`doubleBlindComplete` 是 false，不能称为双盲完成。

条数、超时、输入上界和预算写在配置里。失败的请求不重试。预算不看响应里的 `usd`。用量缺字段，或超过声明的输入、输出上限，就记 `costUnknown`，预留留下，并停止后续调用。

两个评委的类别不一致，以及从一致项里按 seed 抽出的样本，写入 `human-review.json`。每一行的 `semanticHumanReviewed` 都是 false。以前的音字听审不算这些行的人评。`semanticHumanReviewCount` 保持 0。

## 命令

合成夹具才带 `--synthetic`。真实假设由操作者按下面的形状自己准备。本仓库没有父侧 box 里的 SA 原文。

```bash
node eval/baselines/judge/run-judge.js --synthetic \
  --input input.json --config config.json --out /tmp/judge-dry
node eval/baselines/judge/run-judge.js --run --synthetic \
  --input input.json --config config.json --out /tmp/judge-dry-run
node eval/baselines/judge/pack-judge-bundle.js <out.tar.gz>
```

`input.json` 只允许 `schema`、`task`、`items`。每条只允许 `id`、`reference`、`candidates`。每个候选只允许 `key` 和 `text`，而且正好两个。`task` 为 `asr`。key 是小写字母开头的 3 到 32 位标记，不要用后端名字。

`config.json` 的 `schema` 是 `belliedmonkey.llm-judge.config.v1`。`judges` 两行，每行有 `id`、`model`、`endpointEnv`、`keyEnv`。环境变量名只是名字。下面是合成例子，不是 36 条的假设，也不是已选模型。

```json
{
  "schema": "belliedmonkey.llm-judge.input.v1",
  "task": "asr",
  "items": [
    {
      "id": "fixture-1",
      "reference": "the cat sat",
      "candidates": [
        {"key": "arm-a", "text": "the cat sat"},
        {"key": "arm-b", "text": "the dog sat"}
      ]
    }
  ]
}
```

```json
{
  "schema": "belliedmonkey.llm-judge.config.v1",
  "seed": 7,
  "temperature": 0,
  "sampleCount": 1,
  "maxItems": 36,
  "timeoutMs": 20000,
  "maxRetries": 0,
  "inputBound": { "kind": "utf8-bytes-plus-overhead", "overheadTokens": 0 },
  "budgetUsd": 1,
  "judges": [
    {"id": "judge-a", "model": "REPLACE_MODEL_A", "endpointEnv": "JUDGE_A_URL", "keyEnv": "JUDGE_A_KEY"},
    {"id": "judge-b", "model": "REPLACE_MODEL_B", "endpointEnv": "JUDGE_B_URL", "keyEnv": "JUDGE_B_KEY"}
  ],
  "prices": {
    "schema": "belliedmonkey.llm-judge.prices.v1",
    "source": "REPLACE_PRICE_SOURCE",
    "sourceVersion": "REPLACE_PRICE_VERSION",
    "maxInputTokens": 4000,
    "maxOutputTokens": 800,
    "maxTotalTokens": 200000,
    "maxRequests": 72,
    "models": {
      "REPLACE_MODEL_A": {"inputUsdPerToken": 0.000001, "outputUsdPerToken": 0.000002, "pricedZero": false},
      "REPLACE_MODEL_B": {"inputUsdPerToken": 0.000001, "outputUsdPerToken": 0.000002, "pricedZero": false}
    }
  }
}
```

上面的价格数字是占位，不是一份已选定的价目。`pricedZero` 为 false 且单价都是 0 时，配置直接无效。真正免费必须把 `pricedZero` 设为 true，并写明来源。当前 v2 提示词模板 sha256 写在下一节，由测试核对。冻结 v1 模板 sha256 是 `a955cddc61e16ef988ee7c4290437218df4653f88ec9a8a45d6cb38adca5bdd6`。

## 限度

一次模型判断会受提示词、顺序和模型差异影响。两个评委一致也不是校准过的准确率。这里没有用人工语义标签拟合过阈值，所以不能把类别计数当成新的错误率，也不能拿来排名。编辑率仍以 `score.js` 的 v1 为准。
