---
name: perf-tune
description: 给一个翻译引擎（或新供应商）逐模型实测请求参数，找到性能/质量最划算的一组，并把结果——包括否定结果——记进性能台账。新增 build/providers.config.js 条目时必跑；npm test 里有门禁会拦。
---

# perf-tune —— 参数不是读出来的，是打出来的

## 什么时候跑

- **往 `build/providers.config.js` 加了一个条目**（这是硬性的：`test/perf-ledger.test.js`
  会因为缺台账而红）。
- 用户报「某个模型很慢 / 长段落翻不出来 / 一直转圈」。
- 想给 `build/model-params.config.js` 加一行或改一个值 —— 那张表只收观测，不收文档摘抄。

## 为什么不能只读文档

2026-08-20 花了大半天。用户报「翻译失败」，配置是 ChatGPT + gpt-5-mini。四个坑，
每一个都是「文档说得对，但对不上这个具体端点」：

| 坑 | 长什么样 |
|---|---|
| **文档支持 ≠ 这个型号支持** | `o3-mini` 收到 `reasoning_effort:'minimal'` 直接 400（`Supported values are: 'low', …`），而它不发这个参数时本来是好的。差点用一个「优化」打断一条能用的路。 |
| **200 ≠ 生效** | GLM 收下 `reasoning_effort:'low'` 返回 200，然后**完全无视它** —— 照样 38 秒、思考 1991 tok、正文 0 字。 |
| **200 ≠ 最优** | OpenRouter 两种拼法都 200，顶层 `reasoning_effort` 思考 320 tok，嵌套 `reasoning:{effort}` 只要 192。只看状态码会选到次优解。 |
| **200 ≠ 成功** | MiniMax 在 `/v1/text/chatcompletion_v2` 上把「无效 key」包在 HTTP 200 里返回，正文为空。我们的代码会把它读成一次失败的翻译，且拿不到任何服务端原话。 |

还有一个不是「坑」而是根因的发现：**推理开销不随输入变小而变小**。gpt-5-mini 为一个
23 字符的小标题思考了 448 tok，比它为 510 字整段思考的 176 还多。而 `max_completion_tokens`
在推理模型上**同时覆盖思考与输出** —— 长段落上思考先把预算吃光，返回 HTTP 200 + 正文 0 字，
用户看到「翻译失败」，重试永远同样失败。

## 步骤

### 0. 准备凭证

```bash
node scripts/perf-probe.js --list        # 看 .local/keys.md 里哪些槽位填了
```

注册表条目用 `key_chat_<id>[_flavor]`。**不是注册表条目的厂商**（grok / minimax / ark /
gemini …）没有官方槽位，在 `.local/keys.md` 末尾自己加一行 `key_chat_<厂商> = …`，
探针按名字直接读。key 不打印、不进日志、不进任何提交。

### 1. 逐模型打

**「它下面所有能做翻译的模型」都要打一遍。** 至少覆盖：

- 注册表里的 `defaultModel`（每个默认用户都在打它 —— DeepSeek 那次就是这么发现的：
  `deepseek-v4-flash` 一直在为每个段落思考）
- 该厂最快的一档、最强的一档
- **每一个推理/thinking 型号**
- 至少一个**不思考**的型号 —— 它是安全性检查的对象，见第 2 步

```bash
node scripts/perf-probe.js key_chat_openai \
  https://api.openai.com/v1/chat/completions gpt-5-mini --safe gpt-4o-mini
```

探针默认用**用户真机上失败的那段 870 字维基正文 + 我们真实的 2000 预算**。这不是随便
选的题面：短句测不出饿死（gpt-5-mini 短句 9 秒能过、长段 27.8 秒吐 0 字）。

### 2. 三条判据，缺一不可

1. **有收益吗，还是反了** —— 看 `思考=` 与 `出参tok`，**不要看墙钟时间**。
   ⚠️ 同一个参数名在不同端点上可能是**相反的意思**：OpenRouter 的
   `reasoning:{effort:'low'}` 对本来不思考的模型是「以低档**开启**推理」——
   `deepseek/deepseek-v4-flash` 基线 0 tok、加了之后 78–233 tok，baidu 与 mistral
   同样从 0 变成几百。所以必须同时看「有没有变多」，否则会把一个开关当成优化写进表。端点会抖、会 503
   （gemini 那轮多次 503，openrouter 会换上游供应商，bigmodel 同一请求体在 0.6 秒到
   19.9 秒之间跳）。墙钟是最弱的证据。
2. **它真的生效了吗** —— 200 但 token 没变 = 没生效（GLM 那条）。两个候选都 200 时，
   选 token 更少的那个（OpenRouter 那条）。
3. **候选之间真的分得出高下吗** —— 若几个候选的思考量落在同一个区间（相差 <15%），
   那通常意味着**它们都没生效**，不是「都很好」。先 `--repeat 4` 看基线自己的抖动；
   基线若能跨进那个区间，结论就是 `rejected`。
   （工具自己踩过这个坑：minimax/minimax-m2 经 openrouter，五个候选思考量 233–264，
   它按单次采样里最小的那个推荐了 `enable_thinking:false` —— 一行假知识。现在会警告。）
4. **它会打断别的模型吗** —— `--safe <不思考的模型>` 那一段里，你打算写进表的那个值
   必须在它身上也是 200。这一条是 `o3-mini` 那个 400 教的，**没有它就不要写表**。

### 3. 落台账 —— 三种结论都要写

`build/perf-ledger.config.js`。**否定结果和肯定结果一样重要**：

| verdict | 什么时候 | 不写的后果 |
|---|---|---|
| `adopted` | 找到更好的参数 | —— |
| `rejected` | 打通了，但没有值得写的参数（没收益 / 效果不稳定 / 本来就不思考） | 下一个人会照厂商文档把它补上，而我们实测的结论恰恰是「不写」 |
| `unreachable` | 打不到（没 key / 余额不足 / 模型 id 拿不到） | 门会红；而且这个缺口会被忘掉 |

`rejected` 的实例：`api.x.ai` —— `reasoning_effort:'low'` 全型号都收，但 grok-4-fast 长段
858→602 tok 变好、grok-3-mini 长段 624→**969** tok 变差。**效果不稳定的值是维护负担，
不是知识。**

### 4. 落配置

采纳的参数写进 `build/model-params.config.js` 的 `reasoning` 一列。那一列存的是
**按 chat-compat 写法的请求体片段**，不是一个档位枚举 —— 因为各家根本不是同一种机制：

```
api.openai.com    reasoning_effort: 'minimal' / 'low'    档位（顶层字符串）
api.deepseek.com  thinking: { type: 'disabled' }         开关
open.bigmodel.cn  thinking: { type: 'disabled' }         开关
openrouter.ai     reasoning: { effort: 'low' }           嵌套档位
responses 形状     reasoning: { effort: … }               同一个模型、另一种拼法
```

顶层键有白名单（`test/registry.test.js`）。要加新键，先说清**它缺了会怎样** —— 这张表的
许可证建立在「没有一个字段是缺了就会错的」之上。

### 5. 跑门禁

```bash
npm test        # test/perf-ledger.test.js + test/model-params.test.js
```

四种破坏方式都会红，且报错直接说该改哪一行：新增供应商没台账、表与台账不一致、
给实测否决过的 host 补参数、测完采纳了却没写进表。

## 判断口径

- **不要为了「有个数字」而写一行。** 收益不稳定就是 `rejected`。
- **关掉思考是质量取舍，不只是速度。** 翻译这个任务上实测译文长度与可读性相当
  （123→111、118→116、127→115 字），据此默认压到最低档；换一个任务这个结论不成立。
- **墙钟只用来描述，不用来判断。** 台账里 `ms` 可以为 `null`，`thinkTokens` / `outChars`
  不行。
- **打不到就说打不到。** `unreachable` 是一张带日期的欠条，比一个想当然的值诚实得多。

## 相关

- `build/perf-ledger.config.js` —— 台账（证据）
- `build/model-params.config.js` —— 能力表（结论）
- `test/perf-ledger.test.js` —— 把两者锁在一起的门
- `scripts/perf-probe.js` —— 测量工具
- `docs/domain-design.md` §7 —— 为什么请求体是查表而不是试探
- `docs/verification-spec.md` §1.0 —— 证据不对称：写 `false` 要实测，写 `true` 可据文档
