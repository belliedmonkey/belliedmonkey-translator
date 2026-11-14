# ASCEND 6 条：原文、真实 hyp、规范化 tokens、分母

只读复核。官方分数仍是冻结 MER 24/42，`ranking: false`。未听音频，不评中英翻译。6 条短片不能推广到连续对话、口音或噪声。

规范化来自冻结 `codeswitch-score.js` 的 `mixedTokens`：NFKC、小写；每个汉字一枚 token；连续 `\p{L}\p{N}` 为一枚拉丁/数字词；其余字符（含空格、撇号、标点）会切断拉丁串。分母是参考串 token 数。Han/Latin 分段距离只是诊断，不并入官方 MER，也不能相加还原 MER。

对齐在相同时代价下优先替换/匹配，其次删除，再次插入。对齐距离已与冻结 `levenshtein()` 一致；同一距离可以有不同对齐路径。

| id | 官方 errors/length | S | D | I | C | 官方 rate |
|---|---|---|---|---|---|---|
| ascend/00004 | 5/5 | 2 | 3 | 0 | 0 | 1.0 |
| ascend/00009 | 9/13 | 6 | 3 | 0 | 4 | 0.6923 |
| ascend/00028 | 2/3 | 2 | 0 | 0 | 1 | 0.6667 |
| ascend/00055 | 1/14 | 1 | 0 | 0 | 13 | 0.0714 |
| ascend/00066 | 1/4 | 1 | 0 | 0 | 3 | 0.2500 |
| ascend/00068 | 6/3 | 3 | 0 | 3 | 0 | 2.0 |
| **合计** | **24/42** | **15** | **6** | **3** | **21** | **0.5714** |

合计满足 `C+S+D = 21+15+6 = 42`（参考分母），`S+D+I = 24`（分子）。

## ascend/00004

- 原文：`呃what's the呃`
- 真实 hyp：`我so`
- tokens ref（分母 5）：`呃` `what` `s` `the` `呃`
- tokens hyp：`我` `so`
- 对齐：D `呃`，D `what`，D `s`，S `the`→`我`，S `呃`→`so`
- 说明：撇号把 `what's` 切成 `what` + `s`，这是冻结规则，不是改写参考。即便把撇号去掉合成 `whats`，本条 hyp 仍几乎对不上，诊断变体仍为 4/4。本条是内容几乎全错，不是大小写或空格问题。`OK`/`ok` 类折叠与本条无关。Han 段 2/2，Latin 段 3/3，均为诊断值。

## ascend/00009

- 原文：`no我专业是那个i s m information systems management`
- 真实 hyp：`那我觉爱是那个 ISM impormation sistancemangement。`
- tokens ref（分母 13）：`no` `我` `专` `业` `是` `那` `个` `i` `s` `m` `information` `systems` `management`
- tokens hyp：`那` `我` `觉` `爱` `是` `那` `个` `ism` `impormation` `sistancemangement`
- 对齐：S `no`→`那`，S `专`→`觉`，S `业`→`爱`，D `i`，D `s`，D `m`，S `information`→`ism`，S `systems`→`impormation`，S `management`→`sistancemangement`；C：`我` `是` `那` `个`
- 说明：`ISM` 经小写后是一枚 `ism`，参考里空格分开的 `i` `s` `m` 是三枚。这是冻结规则下的真实代价，不是大小写偏差（大小写已折叠）。诊断变体若把单字母拉丁串起来，本条 9/13 变为 6/11，`ism` 可对上，剩余主要是 `no`/`那`、`专业`/`觉爱` 以及后面两个词的拼写错误。Han 段 3/6，Latin 段 7/7，诊断用。

## ascend/00028

- 原文：`ok福建`
- 真实 hyp：`OK附件。`
- tokens ref（分母 3）：`ok` `福` `建`
- tokens hyp：`ok` `附` `件`
- 对齐：C `ok`，S `福`→`附`，S `建`→`件`
- 说明：`OK` 小写后与 `ok` 一致，句号被切断丢弃。剩下是汉字替换（福建 / 附件），属识别差异，不是大小写或标点偏差。Latin 段 0/1。

## ascend/00055

- 原文：`um运动啊男生一般不都喜欢运动`
- 真实 hyp：`嗯 ，运动啊 ，男生一般不都喜欢运动`
- tokens ref（分母 14）：`um` `运` `动` `啊` `男` `生` `一` `般` `不` `都` `喜` `欢` `运` `动`
- tokens hyp：`嗯` `运` `动` `啊` `男` `生` `一` `般` `不` `都` `喜` `欢` `运` `动`
- 对齐：S `um`→`嗯`，其余 13 枚匹配
- 说明：填充词书面形式不同（拉丁 `um` 对汉字 `嗯`）。空格和逗号不影响。未听音频，不判断口吻是否等价；冻结规则下就是 1 次替换。

## ascend/00066

- 原文：`哦这么technical`
- 真实 hyp：`哦 ，这么 technicle`
- tokens ref（分母 4）：`哦` `这` `么` `technical`
- tokens hyp：`哦` `这` `么` `technicle`
- 对齐：C 三枚汉字，S `technical`→`technicle`
- 说明：空格/逗号已切开并丢弃。错误是拉丁词拼写，不是大小写。

## ascend/00068

- 原文：`computer languages是`
- 真实 hyp：`可能平时都 anguage`
- tokens ref（分母 3）：`computer` `languages` `是`
- tokens hyp：`可` `能` `平` `时` `都` `anguage`
- 对齐：I `可`，I `能`，I `平`，S `computer`→`时`，S `languages`→`都`，S `是`→`anguage`
- 说明：几乎无重叠，故 rate 为 6/3=2。Hyp 里的 `anguage` 即使看作 `languages` 的残片，在冻结规则下也不能自动对齐到参考的 `languages`（当前位置被替换到 `是`）。诊断变体仍是 6/3。Han 段 5/1、Latin 段 2/2 是分段诊断，数字大于 MER 是因为分段编辑距离独立计算，不能加总。

