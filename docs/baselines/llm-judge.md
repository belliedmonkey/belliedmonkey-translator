# LLM 评委

这是独立研究入口，不是产品桥，不是默认链路，也不是发布。索引见 [`docs/baselines/README.md`](README.md)。端到端仍 **待测**。

2026-11-13 16:58（Asia/Shanghai）的原话是：可以，尤其适合评判翻译是否忠实、漏译或增译，以及表达是否自然；但语音识别仍应以错误率为主，LLM 辅助区分数字写法等表面差异与真正的内容错误。建议采用匿名、随机顺序的双模型盲评，固定评分标准，并抽样人工复核；保留原始错误率，不让评委模型把真实漏识别解释掉。

这里只做已有 ASR 文本的辅助判分。不新开翻译模型实验，不接产品，也不把音字听审当成语义人评。

## 评委看不到什么

参考和候选只以文本进入提示词。比较两条候选时，顺序由固定 seed 打乱。哪一条被放进 slot-1，写在证据目录的 `assignment.json`，不写进请求。请求里没有后端名字，没有 WER、CER、MER，也没有既有结论。

两个评委必须是两个不同的 model 字符串。缺端点、缺密钥、或两个 id 相同，结果是 `blocked` 或 `same-model`。不会用同一个模型假装两个评委。本仓库不登记新账号，不订阅，不把密钥写进文件。`--run` 才读配置里点名的环境变量，证据里的 Authorization 只写 `redacted`。

默认是 dry-run。它不读环境变量，不访问网络，`called` 为 false，`results` 为 null。

本文件不指定已经选中的模型，也没有已经发生的调用。model、temperature、seed 和提示词模板 sha256 由当次配置和 `rubric.js` 记下来。响应里如果带回了模型名，另记为 `responseModel`，不拿它回填成事先声明。

## 固定量表

ASR 量表版本是 `belliedmonkey.llm-judge.asr.v1`。类别只有：`format-only`、`entity`、`number`、`negation`、`semantic`、`omission`、`addition`。评委可以 `abstain`。每条非弃权发现都要引用参考或候选里的原片段。置信度是 0 到 1 的数。

评委没有听过音频。不能用常识把听到的内容改对，不能删掉括注里的拉丁字母，也不能把 `um` 从参考里拿掉。原始编辑率不由这个入口重算，`editRates` 保持 null。

翻译量表的名字留着：`belliedmonkey.llm-judge.translation.v1`。没有待评译文时任务直接是 `translation-not-open`，不生成分数。1675 的中英平行原文意思并不相同，不能当翻译 gold。

## 失败怎么记

输入多一个字段、缺一条、或 id 重复，退出码不是 0，`results` 为 null。模型返回坏 JSON、引用了不存在的片段、或在文本里说出候选 key，该评委该条是 null，不是 0。只有一个评委有结果时，`code` 是 `partial`，`doubleBlindComplete` 是 false，不能称为双盲完成。

条数上限、超时和重试上限写在配置里。重试最多 2 次，只用于超时、网络错误、429 和 5xx。预算用响应里的 `usd`。没有 `usd` 就记 `costUnknown`，不记成 0；配置了预算时，缺费用就停止后续调用。

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
  "maxRetries": 1,
  "budgetUsd": 1,
  "judges": [
    {"id": "judge-a", "model": "REPLACE_MODEL_A", "endpointEnv": "JUDGE_A_URL", "keyEnv": "JUDGE_A_KEY"},
    {"id": "judge-b", "model": "REPLACE_MODEL_B", "endpointEnv": "JUDGE_B_URL", "keyEnv": "JUDGE_B_KEY"}
  ]
}
```

## 限度

一次模型判断会受提示词、顺序和模型差异影响。两个评委一致也不是校准过的准确率。这里没有用人工语义标签拟合过阈值，所以不能把类别计数当成新的错误率，也不能拿来排名。编辑率仍以 `score.js` 的 v1 为准。
