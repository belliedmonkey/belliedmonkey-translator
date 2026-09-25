# ASO 台账

规矩在 `docs/growth-spec.md` §6，发版时怎么走在 `.claude/skills/store-release/SKILL.md` §6.5。

每一条 = 平台 · 语种 · 字段 · 改前 / 改后原文 · 假设 · 基线读数 · 改后读数（过审后 7 天、14 天）· 结论。
结论只有三种：**adopted**（测过、留下）· **rejected**（测过、撤回或不再往这个方向走）· **inconclusive**
（测过、说不清 —— 通常是观察窗被下一次改动盖掉了）。还没上线的条目写 **planned**。
「测过且否定」与「从没测过」是两件事，只有台账能把它们分开（形状照 `build/perf-ledger.config.js`）。

**读数口径**：结果指标是**各地区来自 App Store 搜索的曝光**（`node scripts/asc.js sources`）与**各国下载**
（`node scripts/asc.js installs`）；名次（`npm run aso:rank`，iTunes Search API）只是近似、只当趋势，
取多日中位数、只记跨档（200+ → 前 100 → 前 50 → 前 10）。星级按店面读 `node scripts/store-stats.js`。
快照都在主仓库的 `.local/stats/`（在 worktree 里跑也写回主树）。

---

## 基线 · 2026-09-25（改任何东西之前）

线上版本 1.16.0；关键词 / subtitle 自 09-15（`4b8471e`）起没动过。

- **获客面**：30 天 1596 次下载（约 100/天）；曝光约 99% 来自 App Store 搜索，外部引荐 0。
  国际版的搜索曝光里 US 占 76%。
- **星级**：11 个主要店面（us tw ca gb it au jp tr kr sa de）+ 中国区，`userRatingCount` **全部 0**。
  评分触发点的改动（#453）随 1.17.0 上线，之后每周读一次。
- **近似名次**（`.local/stats/aso-rank-2026-09-25.json`，83 个词，40 个进前 200；单日读数）：

| 平台 · 店面 | 进前 50 | 51–200 | 200 名外（节选） |
|---|---|---|---|
| iOS · us | 品牌词 #1 | bilingual translation #96、dual subtitles #147、bilingual subtitles #150 | live subtitles、live translate、interpreter、translate webpage、全部长尾候选 |
| iOS · tw | 網頁雙語 #11、同步口譯 #21、雙語對照 #36 | 即時字幕 #76、雙語字幕 #77、網頁翻譯 #113、字幕翻譯 #142 | |
| iOS · jp | 対訳 #35 | 字幕翻訳 #125、同時通訳 #158 | |
| iOS · tr / vn / de | canlı altyazı #47、altyazı çeviri #45、phụ đề song ngữ #48 | dịch trực tiếp #71、canlı çeviri #121、phiên dịch #124、live untertitel #52 | |
| iOS · cn（中国版） | 品牌词 #1、网页双语 #13、双语对照 #35 | 实时字幕 #136、同声传译 #173 | 网页翻译 |
| Mac · us | bilingual translation #10、subtitle translator #27、webpage translator #32 | translate safari #61、live subtitles #83、translator #130、screenshot translate #131、quick translate #139 | |
| Mac · cn（中国版） | 网页翻译 #37、实时字幕 #39 | 截图翻译 #136、划词翻译 #151 | |

**读法**：零评分下，US iOS 的头部词与长尾词都排不上；排得上的是 CJK 的「双语 / 对照」一类定位词和 Mac 的
组合词。这是单日读数 —— 下面的关键词假设要等多日中位数，别拿这一天的数下结论。

---

## 实验

### E1 · iOS · 全部 15 个语种 · description —— 加一节「系统翻译（iPhone）」 · planned（1.17.0）

- **改前**：iOS 与 Mac 共用 `aso.md` 的描述；1.14.0 的主角「系统翻译」在 iOS 商店文案里一次都没出现过。
- **改后**：`store-assets/aso-ios.md`（= `aso.md` + `aso-ios-section.json` 的一节，`scripts/gen-aso-platforms.js` 生成）。
- **假设**：描述**不进搜索索引**，所以这一条**不是排名实验**，名次不该因此变。它修的是正确性（商店页没写主打功能），
  预期影响的是页面浏览 → 下载的转化。
- **基线**：上面 09-25 那份；转化率在 `asc.js sources`（页面浏览）+ `asc.js installs` 里按国家读。
- **改后读数**：（1.17.0 过审后 +7 天、+14 天）
- **结论**：

### E2 · 关键词第一批假设 · planned（1.17.0 备版时再定，先攒多日读数）

候选方向，按预期收益排；**每个版本、每个语种组只动一个变量，改完锁两个版本**（growth-spec §6）：

1. **中文往「网页双语 / 双语对照」定位走**：cn #13 / #35、tw #11 / #36 已经排得上，而「网页翻译」「同声传译」
   这些头部词被大户占着（沉浸式翻译 #1）。先看 CJK subtitle 剩下的 14 个字能不能放进这类词。
2. **Mac 的组合词**：bilingual translation #10、subtitle translator #27、webpage translator #32 —— Mac 的 keywords
   是单独一份，可以围绕已经进前 50 的组合词补相邻词。
3. **US iOS 暂不动关键词**：头部词和长尾候选全在 200 名外，零评分下改词大概率测不出差别。先等评分起来，
   这一格留给 E1 与评分触发点。

动之前：`npm run aso:rank` 至少再攒几天，取中位数；定下来的那一条拆成单独的 E 编号写进来。
