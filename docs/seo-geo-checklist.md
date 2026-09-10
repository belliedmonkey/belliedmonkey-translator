# 官网 SEO / GEO 判据清单

> 两层：**脚本层**（`npm run site:audit`，`scripts/site-audit.js`）做确定性检查，任一红即 exit 1；
> **人 / 模型层**（本文）做语义判断 —— 写什么、怎么写、发到哪。发版走 `/store-release` 第 11 步时两层都过。
> 判据都带一手出处；出处变了先改这里再改脚本。

## 0. 先说结论：GEO 不是另一套东西

Google 官方《AI 优化指南》（Search Central，2026-06-29）原话：**AEO / GEO 是改名，AI Overviews 与
AI Mode 用的是同一套排名系统**。页面先得被索引、能出摘要，才可能进 AI 答案。所以：

- **不要为「GEO」另起一套页面或标记**。技术底子（可抓、可索引、结构化数据对、语言页互指）+ 可引用的内容
  = GEO。
- **`llms.txt` 不是引用杠杆**：Google 明说「忽略它」；SE Ranking 30 万域研究里最常被 AI 引用的 50 个域只有
  1 个有它；AI 爬虫流量 0.1% 打到它（OtterlyAI 日志）。**但对开发者工具类站点它有真实用途** —— Cursor /
  Claude Code 这类编码代理会读。我们保留并维护它（它是全站写得最好的一份文本），**不再往上投入**，也不在任何
  文案里把它当成「做了 GEO」的证据。
- **品牌提及 > 反链**（Ahrefs 2025-12，7.5 万品牌）：YouTube 提及相关性 0.737 最强，Reddit / Wikipedia 高，
  域评级只有 0.266；**只有 11% 的域同时被 ChatGPT 与 AIO 引用**。分类型问题（"best … for Safari iPhone"）
  的答案是从第三方 listicle / Reddit / AlternativeTo / awesome 列表拼出来的 —— **站内文字再好也进不了这类
  答案**。第三方锚点是第一优先级，见 §4。

## 1. 脚本层管什么（`site:audit`，两站都查）

| 判据 | 为什么 | 出处 |
|---|---|---|
| 首页 `<title>` 含本语种的产品词、不含「公司」词、≤ 65 字符 | 2026-09-10：12 个 priority 1.0 的首页全在争 "AI Translation Company" | 审计 #1 |
| 每个可索引页：description、恰好一个 h1、自指 canonical | 基本功；`.com` 曾 4/5 页无 canonical | 审计 #3 |
| hreflang 成对互指（国际站） | 单向互指 Google 忽略整组 | Google hreflang 文档 |
| `og:image` ≥ 1200×630、`twitter:card=summary_large_image` | 128×128 低于多数平台 200×200 阈值，分享卡不出图 | 审计 #7/#8 |
| `<img>` 有内容 alt + width/height | 截图是内容不是装饰；lazy 图无尺寸伤 CLS | 审计 #10/#11 |
| JSON-LD 可解析、无退役类型、`softwareVersion` == `VERSION` | HowTo 2023-09 退役；版本曾停在 1.7.18 | Google 富结果变更日志 · 审计 #2 |
| 口径黑名单 0 命中：`no telemetry` / `completely free` / `only|first … iOS` | 前者 Gate D 后是假话；后两条是营销红线 | `oss-marketing-direction` |
| sitemap：可索引页都在、noindex 页不在、`llms.txt` 在、lastmod ≥ 最后提交 | beta.html 曾两边都占；`.com` lastmod 手写过期 | 审计 #9/#12 |
| robots.txt 未单独屏蔽 AI 爬虫 | GEO 的门 | — |
| `llms.txt` 链到 faq / guide / youtube / safari-ios | 它曾只链 home/setup/privacy/support | 审计 #5 |
| 无 `.bad/.orig/.tmp` | 仓库根整个发布，脏文件公开可访问 | 审计 #18 |
| 可引用页每个 h2 段 100–220 词（最优 134–167） | AI 引用的段落形状 | SE Ranking 2025 · Ahrefs |
| 新鲜度（黄）：首页与对比页 90 天没动提醒 | 6 个月不动失去引用资格，3 个月内 ~3× | SE Ranking 130 万引用研究 |

## 2. 人 / 模型层：一段「可引用」的文字长什么样

1. **首句给结论**（前 40–60 词直接回答），不做铺垫；**44% 的 AI 引用来自页面前 30%**。
2. **自足**：脱离上下文也成立 —— 主语写全名（"BelliedMonkey Translator"，不写 "it"），代词密度 < 2%。
3. **问句式 h2**（"How is this different from Immersive Translate?"），一段回答一个问题。
4. **有具体数字与出处**（"GPL-3.0"、"$0.2"、"11 languages"），少形容词。
5. **诚实示弱**：写清「谁不该选我们」「他们比我们强在哪」—— 这是 AI 引擎判可信度的信号，也是我们最强的口气。
6. 表格 > 列表 > 段落（对比题尤其）。

## 3. 红线（一字不改，见 memory `oss-marketing-direction`）

- ❌ 「iPhone Safari 唯一 / 第一」—— 沉浸式翻译有 iOS 条目
- ❌ 「读过的句子变复习卡」首创
- ❌ 「完全免费」不加限定 —— 写「扩展免费 + 自带 key 按厂商计费 + 登录可领 $0.2 额度」
- ❌ 「no telemetry」—— 写「匿名用量事件，只记用了哪些功能，一个开关关掉」
- ✅ GPL 开源 / 无订阅 / 无账号 / 翻译不经我们服务器（免费额度那条中继要单独说明）/ 自带 key / 六面同源
- ⚠️ **竞品全名可进官网 / README / HN / Reddit；绝不进 App Store keywords**（`store-assets/aso.md` 那条红线只约束
  keywords 字段，`amo-listing.md` 那条只约束 AMO description）
- 英文优先（91% 国际）；Firefox 搭便车面不单独攻

## 4. 第三方锚点（分类型答案唯一的入口）

按投入产出比：OpenAlternative（只要 repo URL）→ awesome 列表 PR（一行）→ AlternativeTo（挂到 Immersive
Translate 的「Suggest alternative」）→ Show HN → Reddit r/languagelearning、r/Safari → Product Hunt（等评分 > 0）。
稿子在 `store-assets/posts/`；**发送键由人点**（memory `social-posts-manual-send-only`）；每条进 `.local/TODO.md`，
**回读到 URL / 合并才算完成**。发之前先跑 `site:audit` —— 稿子的口径与站点同一套。

## 5. 刷新周期

- 每次 `/store-release`：`site:audit` + `gen-site-langs.js --check` + `changelog.html` 重生成（这是唯一自动刷新的新鲜度信号）
- 每 90 天：首页与对比页至少动一次（数字、版本、支持站点）—— 门禁到期会黄
- 每周（已在 TODO）：Discussions / 商店评论 / AlternativeTo 审核状态回读

## 6. 学习来源（2026-09-10 从 GitHub 最火的 SEO/GEO skill 里取的方法，未安装任何一个）

`AgriciDaniel/claude-seo`（16.5k★，GEO=SEO 基本功、llms.txt 证据档、schema 退役表）·
`zubair-trabzada/geo-seo-claude`（10.3k★，引用性/品牌提及/E-E-A-T/技术/结构化/平台 = 25/20/20/15/10/10）·
`JeffLi1993/seo-audit-skill`（Script + LLM 两层，本文的结构就来自它）· `yaojingang/GEOHub`（证据受限、诚实标缺失）·
`RankSpotAI/awesome-seo-agent-skills`（点名 hreflang / 国际化几乎没人做 —— 我们有 11 套语言页，是优势）。
