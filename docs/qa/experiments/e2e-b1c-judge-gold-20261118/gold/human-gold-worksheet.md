# Judge gold worksheet — 50 cases

Fill `human-gold.csv`, not this file. Order and `case_id` are identical.

## How to fill

- Each `d_*` column takes exactly one of: `P` (pass — no real defect), `F` (fail — a real defect in that dimension), `?` (cannot decide from the text shown).
- `human_note` is optional; use it when a call is arguable.
- **Blinding rule:** you see what the judge saw — authoritative source and candidate translation only. Do not look up the audio or the ASR text; a reviewer who knows the input was noisy will excuse defects.
- Judge meaning first, then the six narrower dimensions. `fluency` is about the target reading naturally, not about being faithful.
- Numbers in `note` are context only. `known real defect` marks a case already confirmed by hand.

## B1 items

### B1-B-ascend/00004

| | |
|---|---|
| target | en |
| source | 呃what's the呃 |
| translation | I am so |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-ascend/00009

| | |
|---|---|
| target | en |
| source | no我专业是那个i s m information systems management |
| translation | Then I think love is that ISM, information system management. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-ascend/00028

| | |
|---|---|
| target | en |
| source | ok福建 |
| translation | OK, attachment. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-ascend/00055

| | |
|---|---|
| target | en |
| source | um运动啊男生一般不都喜欢运动 |
| translation | Well, sports—don’t most guys generally like sports? |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-ascend/00066 — A/B translation byte-identical

| | |
|---|---|
| target | en |
| source | 哦这么technical |
| translation | Oh, so technical. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-ascend/00068

| | |
|---|---|
| target | en |
| source | computer languages是 |
| translation | Maybe usually all language |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1668

| | |
|---|---|
| target | en |
| source | 买一张万能卡（Wild Card）也有不少好处。带着这张卡，你可以进入南非的一些公园或全部的国家公园。 |
| translation | Buying a Universal Card also has many benefits. With this card, you can enter some parks in South Africa or all of the national parks. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1669

| | |
|---|---|
| target | en |
| source | 警察局长钱德拉·谢卡尔·索兰基说，被告人出庭时都蒙住了脸。 |
| translation | Police Chief Chandrashekhar Solanki said that the defendants had their faces covered when they appeared in court. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1670

| | |
|---|---|
| target | en |
| source | “它们的热行为不像地球上的大型洞穴那么稳定，这些大型洞穴通常会保持相当恒定的温度，但它们与地下深穴的情况很相似，”亚利桑那州旗杆镇美国地质调查局 (USGS) 太空地质团队和北亚利桑那大学的格伦·库欣说道。 |
| translation | Their thermal behavior is not as stable as that of large caves on Earth, which typically maintain a fairly constant temperature. However, they are quite similar to conditions involving rising snow underground, said Glen Cushing of the U.S. Geological Survey (USGS) Astrogeology Team in Flagstaff, Arizona, and Northern Arizona University. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1671

| | |
|---|---|
| target | en |
| source | 国会从 2005 财年开始资助该扫黄倡议，并规定联邦调查局 (FBI) 必须指派 10 名探员专门打击成人色情。 |
| translation | Since 2005, Congress has been funding the anti-pornography initiative and mandated that the FBI assign ten agents specifically to combat adult pornography. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1672

| | |
|---|---|
| target | en |
| source | 小心不要让衣服变得太热（这可能会产生收缩现象，在极端情况下会把衣服烤焦）。 |
| translation | Be careful not to let the clothes get too hot, as this may cause shrinkage and, in extreme cases, scorch the fabric. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1673

| | |
|---|---|
| target | en |
| source | 在独立战争期间，十三个州最初根据《联邦条例》组成了弱小的中央政府（国会是其唯一的组成部分）。 |
| translation | During the Revolutionary War, the 13 states formed a weak central government under the Articles of Confederation, with Congress as its sole component. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1674

| | |
|---|---|
| target | en |
| source | 在某些地区，水煮一分钟就足够了，在其他地区则需要几分钟的时间。 |
| translation | In some regions, boiling for 1 minute is sufficient, while in others it takes several minutes. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1675

| | |
|---|---|
| target | en |
| source | 除去表示您的“Sie”之外的所有名词都应以大写字母开头，即使在句子中间也应如此。 |
| translation | All nouns, except for the letter C representing you, should begin with a capital letter, even in the middle of a sentence. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1676

| | |
|---|---|
| target | en |
| source | 与所有南非国家公园一样，该公园每天都收取养护费和门票费。 |
| translation | Like all South African national parks, this park charges conservation fees and entrance fees daily. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1677 — A/B translation byte-identical

| | |
|---|---|
| target | en |
| source | 如今，唯一不能向后折叠翅膀的昆虫是蜻蜓和蜉蝣。 |
| translation | Today, the only insects that cannot fold their wings backward are dragonflies and mayflies. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1678

| | |
|---|---|
| target | en |
| source | 奥利弗·萨克斯 (Oliver Sacks) 在他的论文《总统的演讲》中指出，那些因为脑损伤而无法理解语言的人仍然能够准确地判断说话人是否有诚意。 |
| translation | Oliver Sacks, in his presidential address, pointed out that individuals who are unable to comprehend language due to brain damage can still accurately judge whether a speaker is sincere. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1679 — A/B translation byte-identical

| | |
|---|---|
| target | en |
| source | 空中铁匠乐队已经取消了他们巡回演唱会的剩余场次。 |
| translation | Aerosmith has canceled the remaining dates of their tour. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1680

| | |
|---|---|
| target | en |
| source | 老虎是全能运动员，它会攀爬（虽然攀爬能力不是很强）、游泳、跳远，拉力能达到人类大力士的五倍。 |
| translation | Tigers are all-around athletes. They can climb, although their climbing ability is not particularly strong. Their swimming, long jump, and pulling strength are five times that of the strongest humans. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1681

| | |
|---|---|
| target | en |
| source | 实验是一种用来消除一个或多个可能性假设的试验，不过，实验并不是唯一的方法。提出问题及进行观察也可以指导科学研究。 |
| translation | An experiment is a method used to eliminate one or more hypothetical possibilities. However, experiments are not the only approach; posing questions and making observations can also guide scientific research. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/cmn_hans_cn/1682

| | |
|---|---|
| target | en |
| source | 虽然没有人能确定作者是谁，但这个大型羊皮纸文档（尺寸为 29¾ 英寸乘以 24½ 英寸）据称在刚写成的时候是卷起来存放的。 |
| translation | Although no one can be certain of the author’s identity, this large parchment document measures 29¾ inches by 24½ inches. It is said to have been stored rolled up when it was first written. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1668

| | |
|---|---|
| target | zh-CN |
| source | It may also be beneficial for one to buy a Wild Card, which provides entry to either selections of parks in South Africa or all of the South African National Parks. |
| translation | 购买一张野生卡也可能对您有益，该卡可让您进入南非的部分公园或所有南非国家公园。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1669

| | |
|---|---|
| target | zh-CN |
| source | Police superintendent Chandra Shekhar Solanki said the accused appeared in court with covered faces. |
| translation | 警察总监钱德拉·希卡尔·索兰基表示，被告在出庭时遮住了面部。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1670

| | |
|---|---|
| target | zh-CN |
| source | Their thermal behavior is not as steady as large caves on Earth that often maintain a fairly constant temperature, but it is consistent with these being deep holes in the ground," said Glen Cushing of the United States Geological Survey (USGS) Astrogeology Team and of Northern Arizona University located in Flagstaff, Arizona. |
| translation | 它们的热行为不如地球上的大型洞穴那样稳定，后者通常能保持相当恒定的温度。但这一现象与这些洞穴是深入地下的深坑相符，美国地质调查局天体地质学团队、位于亚利桑那州弗拉格斯塔夫的北亚利桑那大学的格伦·卡辛表示。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1671

| | |
|---|---|
| target | zh-CN |
| source | Congress began funding the obscenity initiative in fiscal 2005 and specified that the FBI must devote 10 agents to adult pornography. |
| translation | 国会从2005财年开始为淫秽物品整治计划提供资金，并明确规定联邦调查局必须指派10名特工专门负责成人色情内容相关事务。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1672

| | |
|---|---|
| target | zh-CN |
| source | Be careful not to allow fabric to become too hot (which can cause shrinkage, or in extreme cases, scorch). |
| translation | 好的，注意不要让织物温度过高，以免导致缩水，极端情况下甚至可能烧焦。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1673

| | |
|---|---|
| target | zh-CN |
| source | During the Revolutionary War, the thirteen states first formed a weak central government—with the Congress being its only component—under the Articles of Confederation. |
| translation | 在美国独立战争期间，13个州最初建立了一个软弱的中央政府，根据《邦联条例》，国会是其唯一组成部分。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1674

| | |
|---|---|
| target | zh-CN |
| source | In some areas boiling water for a minute is enough, in others several minutes are needed. |
| translation | 在某些地区，将水煮沸一分钟就足够了，而在其他地区则需要更长时间。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1675

| | |
|---|---|
| target | zh-CN |
| source | All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence. |
| translation | 所有与你世界安全相关的名词，即使在句子中间，也始终以大写字母开头。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1676

| | |
|---|---|
| target | zh-CN |
| source | As with all South African National Parks, there are daily conservation and entry fees for the park. |
| translation | 与所有南非国家公园一样，该公园收取每日保育费和入园费。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1677 — A/B translation byte-identical

| | |
|---|---|
| target | zh-CN |
| source | Today, the only insects that cannot fold back their wings are dragon flies and mayflies. |
| translation | 如今，唯一不能将翅膀折叠回去的昆虫是蜻蜓和蜉蝣。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1678

| | |
|---|---|
| target | zh-CN |
| source | Oliver Sacks, in his paper The President's Speech, indicated how people who are unable to understand speech because of brain damage are nevertheless able to assess sincerity accurately. |
| translation | 奥利弗·萨克斯及其论文指出，总统的演讲表明，尽管因脑损伤而无法理解言语的人，仍能准确评估说话者的真诚度。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1679

| | |
|---|---|
| target | zh-CN |
| source | Aerosmith have cancelled their remaining concerts on their tour. |
| translation | Aerosmith 已经取消了他们巡演中剩余的演唱会。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1680

| | |
|---|---|
| target | zh-CN |
| source | A well rounded athlete, the tiger can climb (though not well), swim, leap great distances and pull with five times the force of a strong human. |
| translation | 老虎是一位全能型运动员，虽然攀爬能力不强，但会游泳，能长途跋涉，拉力更是强壮人类的五倍。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1681

| | |
|---|---|
| target | zh-CN |
| source | It isn’t alone though, experimentation, and an experiment is a test that is used to eliminate one or more of the possible hypotheses, asking questions, and making observations also guide scientific research. |
| translation | 然而，实验并非孤立存在。实验是一种用于排除一个或多个可能假设的检验方法，而提出问题与进行观察也指导着科学研究。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-B-fleurs-public-candidates/en_us/1682

| | |
|---|---|
| target | zh-CN |
| source | While no one knows for certain who wrote it, it is known that early in its life, the large parchment document (it measures 29¾ inches by 24½ inches) was rolled up for storage. |
| translation | 虽然无人知晓Serenhu Roi的情况，但众所周知的是，在其早期阶段，这份大型羊皮纸文件（尺寸为29又3/4英寸×24.5英寸）曾被卷起以便存放。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-ascend/00066 — A/B translation byte-identical

| | |
|---|---|
| target | en |
| source | 哦这么technical |
| translation | Oh, so technical. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/cmn_hans_cn/1669

| | |
|---|---|
| target | en |
| source | 警察局长钱德拉·谢卡尔·索兰基说，被告人出庭时都蒙住了脸。 |
| translation | Police Chief Chandra Shekhar Solanki said that the defendants had their faces covered when they appeared in court. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/cmn_hans_cn/1672

| | |
|---|---|
| target | en |
| source | 小心不要让衣服变得太热（这可能会产生收缩现象，在极端情况下会把衣服烤焦）。 |
| translation | Be careful not to let the clothes get too hot (this may cause shrinkage, and in extreme cases, scorch the fabric). |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/cmn_hans_cn/1675

| | |
|---|---|
| target | en |
| source | 除去表示您的“Sie”之外的所有名词都应以大写字母开头，即使在句子中间也应如此。 |
| translation | All nouns, except for the formal “Sie” used to address someone, should begin with a capital letter, even in the middle of a sentence. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/cmn_hans_cn/1677 — A/B translation byte-identical

| | |
|---|---|
| target | en |
| source | 如今，唯一不能向后折叠翅膀的昆虫是蜻蜓和蜉蝣。 |
| translation | Today, the only insects that cannot fold their wings backward are dragonflies and mayflies. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/cmn_hans_cn/1679 — A/B translation byte-identical

| | |
|---|---|
| target | en |
| source | 空中铁匠乐队已经取消了他们巡回演唱会的剩余场次。 |
| translation | Aerosmith has canceled the remaining dates of their tour. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/en_us/1673

| | |
|---|---|
| target | zh-CN |
| source | During the Revolutionary War, the thirteen states first formed a weak central government—with the Congress being its only component—under the Articles of Confederation. |
| translation | 在美国独立战争期间，十三个州根据《邦联条例》首先建立了一个软弱的中央政府，其唯一组成部分是国会。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/en_us/1677 — A/B translation byte-identical

| | |
|---|---|
| target | zh-CN |
| source | Today, the only insects that cannot fold back their wings are dragon flies and mayflies. |
| translation | 如今，唯一不能将翅膀折叠回去的昆虫是蜻蜓和蜉蝣。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/en_us/1678

| | |
|---|---|
| target | zh-CN |
| source | Oliver Sacks, in his paper The President's Speech, indicated how people who are unable to understand speech because of brain damage are nevertheless able to assess sincerity accurately. |
| translation | 奥利弗·萨克斯在其论文《总统的演讲》中指出，那些因脑损伤而无法理解言语的人，仍然能够准确地评估真诚度。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### B1-A-fleurs-public-candidates/en_us/1679

| | |
|---|---|
| target | zh-CN |
| source | Aerosmith have cancelled their remaining concerts on their tour. |
| translation | Aerosmith 已取消巡演中剩余的演唱会。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

## Hard set (Wikipedia, CC BY-SA 4.0)

### HS-zh_92816176 — source says 威廉一世; target says William III. Historically III is right, so this is an unfaithful rendering, not a translator error

| | |
|---|---|
| target | en |
| source | 英格兰银行成立于1694年。在后续的历史中，苏格兰和北爱尔兰相继成为联合王国的一部分，但作为最初的中央银行，英格兰银行的名字沿用至今。英格兰银行最初成立的目的是为英格兰国王威廉一世融资，以支付战争经费和王国开支。英格兰银行，以英王未来的税收为抵押向政府提供贷款。同年威廉一世为英格兰银行颁发了皇家特许执照，英格兰银行成为独家为政府服务的银行，并为政府管理其债务。在成立之初，英格兰银行一直是一家私有银行。而其同时向私人客户开放，提供存取款业务，但是后期成为仅向其他银行开放的“银行的银行”。在十九世纪时，英格兰银行成为英国其他商业银行的最终借款人。1931英国宣布离开金本位制度，英格兰银行的黄金和外汇储备移交国库所有，但仍为政府经手管理这些财产。1946年英格兰银行成为国有银行。1998年，英格兰银行法案确立了英格兰银行独立执行货币政策的权力。 |
| translation | The Bank of England was established in 1694. In the course of subsequent history, Scotland and Northern Ireland successively became part of the United Kingdom, but as the original central bank, the name “Bank of England” has remained in use to this day. The Bank was initially founded to finance King William III of England, covering war expenses and the kingdom’s expenditures. The Bank of England provided loans to the government, secured by future tax revenues of the English Crown. In the same year, William III granted the Bank of England a royal charter, making it the exclusive bank serving the government and managing its debt. From its inception, the Bank of England operated as a private bank. While it also served private customers with deposit and withdrawal services, it later evolved into a “bank for banks,” open only to other financial institutions. During the nineteenth century, the Bank of England became the lender of last resort for other commercial banks in Britain. In 1931, when Britain abandoned the gold standard, the Bank’s gold and foreign exchange reserves were transferred to the ownership of the Treasury, although the Bank continued to manage these assets on behalf of the government. In 1946, the Bank of England was nationalized. In 1998, the Bank of England Act established the Bank’s independence in conducting monetary policy. |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### HS-en_1385458475 — Habeas corpus

| | |
|---|---|
| target | zh-CN |
| source | In 1941, the Article 40 procedure was restricted by the Second Amendment. Prior to the amendment, a prisoner had the constitutional right to apply to any High Court judge for an enquiry into her detention, and to as many High Court judges as she wished. If the prisoner successfully challenged her detention before the High Court she was entitled to immediate, unconditional release. |
| translation | 1941年，第二修正案对第40条程序进行了限制。在修正案通过之前，囚犯拥有宪法权利，可以向任何一名高等法院法官申请对其拘留情况进行审查，并且可以根据需要向任意数量的高等法院法官提出申请。如果囚犯在高等法院成功质疑其拘留的合法性，她有权获得立即且无条件的释放。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### HS-en_1385049036 — Bayesian inference

| | |
|---|---|
| target | zh-CN |
| source | Suppose there are two full bowls of cookies. Bowl #1 has 10 chocolate chip and 30 plain cookies, while bowl #2 has 20 of each. Fred picks a bowl at random and then picks a cookie at random, which means that there is no reason to believe Fred treats one bowl differently from another, likewise for the cookies. The cookie turns out to be a plain one. As to how probable it is that Fred picked it out of bowl #1, that is an example of a Bayesian inference-approachable problem. |
| translation | 假设有两满碗饼干。1号碗里有10块巧克力碎饼干和30块普通饼干，而2号碗里两种饼干各有20块。弗雷德随机选择一个碗，然后从中随机取出一块饼干，这意味着没有理由认为弗雷德对某个碗有偏好，对饼干也是如此。结果取出的是一块普通饼干。关于弗雷德从1号碗中取出这块饼干的概率有多大，这是一个可以用贝叶斯推断方法解决的问题。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`

### HS-en_1378366143 — Tidal locking

| | |
|---|---|
| target | zh-CN |
| source | Many exoplanets (especially the close-in ones) are expected to be in spin–orbit resonances higher than 1:1. A Mercury-like terrestrial planet can, for example, become captured in a 3:2, 2:1, or 5:2 spin–orbit resonance, with the probability of each being dependent on the orbital eccentricity. |
| translation | 许多系外行星（尤其是那些轨道靠近恒星的）预计会处于高于1:1的自转-轨道共振状态。例如，一颗类似水星的类地行星可能会被捕获到3:2、2:1或5:2的自转-轨道共振中，每种情况的概率取决于其轨道偏心率。 |

labels: `meaning` · `entities_numbers` · `negation` · `omission` · `hallucination` · `terminology` · `fluency`
