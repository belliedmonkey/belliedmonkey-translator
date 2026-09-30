# 设计审计对账（2026-09-29 稿 × 2026-09-30 现状）

本目录是 OpenDesign 在 **2026-09-29** 产出的设计审计稿：`index.html`（报告）+ `findings.js`
（28 条结构化结论 · 117 处源码锚点）+ `visual/onboarding-causal-chain.html`（引导因果链）
+ `onboarding-redesign/`（引导重做稿）。

审计是针对 **React 迁移之后不久**的一棵树做的。迁移把 App 壳从 `app/app.js` 搬到了
`src/app/shell-model.js` + `src/app/AppShell.jsx`，把扩展页从 `popup.js` / `options.js`
搬到 `src/pages/*.jsx`，因此稿里的**行号锚点**有一批已经指不到东西（8 条 ONB 结论的
4 个锚点全部指向已删除的 `app/app.js`）。

**本文件是逐条回验的记录**——不改动原稿（它是一份时间点快照），只补上「这条现在还在不在、
现在的锚点在哪、归谁做」。跟踪 issue：**#524**。

## 一、回验结论

**28 条全部仍成立。** 行号会漂，结论没漂：

| 判定 | 条数 |
|---|---|
| 仍成立 | 27 |
| 仍成立，但**我们的应对口径已变** | 1（ONB-01） |
| 已修 / 不成立 | 0 |

唯一需要单独说的是 **ONB-01**：它说的事实（iOS 上 App 判不了 Safari 扩展开没开）成立，
但它的**处方**（把检测页当引导最后一屏、未确认就保持未完成）与我们在 **#485** 已经定过的
口径相反——我们定的是「**问过就不再问**」（主按钮即写 `extBannerDoneAt`，不再拿
`browserSideOk` 当判据）。这一条不是「已修」，是「**同意事实、不同意处方**」，
要你拍（见文末三件裁定）。

## 二、逐条对账

锚点一律给 **React 迁移后的当前位置**（文件 + 符号/选择器，不写行号——行号会漂）。
判定为「仍成立」= 现状核实过，问题仍在。

### P0（6 条）

| id | 面 | 结论 | 判定 | 当前锚点 |
|---|---|---|---|---|
| OVL-01 | 注入层 | 页内注入层脱离 token，palette 门禁管不到 | 仍成立 | `extension/content/subtitle-adapter.js`（内联 `rgba(8,8,8,.82)` / `#ffb3b3` / `#d6d6d6`；无 overlay css 文件） |
| OVL-02 | 注入层 | 叠层圆角与全站形态语言相反 | 仍成立 | `subtitle-adapter.js`（3px）、`src/content/sub-menu.jsx`（10px）、`src/shared/doc-view.js`（10px） |
| POP-01 | 弹窗 | 键盘焦点态大面积缺失 | 仍成立 | `src/pages/popup.jsx` / `extension/popup/popup.css` / `extension/learn/review.css` / `src/app/AppShell.jsx` 的 `:focus-visible` 计数均为 **0**（全站仅 `options.css` 一处） |
| ONB-01 | 引导 | iOS 判不了扩展启没启用（引导所有问题的根因） | **事实成立，处方与 #485 相反** | `src/app/shell-model.js` `paintExtBanner` / `setExtState`（iOS 分支拿不到真实状态） |
| ONB-02 | 引导 | ext 屏是死胡同：点了就完成、`OB_RESUME` 被删 | 仍成立 | `src/app/shell-model.js` `obFinish`（写 `OB_SEEN` + `remove(OB_RESUME)`） |
| ONB-03 | 引导 | 引导退场后横幅立刻回来说同样的话 | 仍成立 | `src/app/shell-model.js` `paintExtBanner`（横幅 `<ol>` 直接用 `iosSteps()`，与引导同一份） |

### P1（12 条）

| id | 面 | 结论 | 判定 | 当前锚点 |
|---|---|---|---|---|
| DS-01 | 设计系统 | Organic 展示字在实现中零落地 | 仍成立 | 实现里无展示字（`design/_ds/` 有承诺、`extension/**` 无引用） |
| DS-02 | 设计系统 | 没有 type scale，基准三套、取值 36 个 | 仍成立 | `organic-tokens.gen.css` 无 `--fs-*` 组；各页自写字号 |
| DS-03 | 设计系统 | 垂直节奏无共同基线 | 仍成立 | 12/14/16/18/22/24 三套内边距并存 |
| POP-02 | 弹窗 | 弹窗与扩展页字号密度不一致 | 仍成立 | `popup.css` 13px / `options.css` 14px（同一「设置行」） |
| POP-03 | 弹窗 | 触控目标 < 44pt | 仍成立 | `popup.css` `.row` 高 40px |
| OPT-01 | 设置页 | 后三节永远全展开 | 仍成立 | `extension/options/options.css` 的节头注释原样：「『快速 / 详细』只管第一节……其余三节永远可见」 |
| OVL-03 | 注入层 | 注入层出现 Material 绿 | 仍成立（位置变了） | `#4caf50` 现在在 `src/content/sub-menu.jsx` |
| APP-01 | App 壳 | 平铺 section，没有导航模型 | 仍成立（13 屏 → React 后 **7 个 `<section>`**，仍是 `[hidden]` 互斥 + 每屏自带返回，模型未建） | `src/app/AppShell.jsx` + `app/style.css` |
| APP-02 | App 壳 | 跨宿主同名组件无法共用 token | 仍成立 | 随 DS-02 |
| ONB-04 | 引导 | 「我只要网页翻译」把用户推进死胡同 | 仍成立 | `src/app/shell-model.js` `ob-webonly` 点击 → `OB.indexOf('ext')`（仍落到 ext 屏） |
| ONB-05 | 引导 | App 引导与扩展引导是两套相反范式 | 仍成立 | App：`shell-model.js` 的 `OB` 线性数组；扩展：`src/pages/onboard.jsx` 的 `forkPick` / `forkLanded`（订阅真实 `grantTail`） |
| ONB-06 | 引导 | 引导进行中会被账号核对打断，进度不保留 | 仍成立 | `src/app/shell-model.js` `dl-mismatch` 处理（`onboard.hidden = true` + `LearnAuth.signOut()`） |

### P2（9 条）+ 正面样本（1 条）

| id | 面 | 结论 | 判定 | 当前锚点 |
|---|---|---|---|---|
| DS-04 | 设计系统 | 圆角双轨，小圆角散在胶囊语言之外 | 仍成立 | 同一张复习卡上 16 / 6 / 3px 并存 |
| POP-04 | 弹窗 | emoji 充当功能图标 | 仍成立 | `popup.jsx` 首帧行 |
| POP-05 | 弹窗 | `popup.jsx` 有恒等三元（React 迁移残留） | 仍成立 | `src/pages/popup.jsx:374` `className={firstRunVisible ? 'setup-note' : 'setup-note'}` |
| OVL-04 | 注入层 | FAB 没有暗色变体 | 仍成立 | `extension/styles/floating-button.css`（`prefers-color-scheme` 计数 **0**；同层 `bilingual.css` 有 2 处） |
| OVL-05 | 注入层 | 译文层留有空规则与未联动的分隔线 | 仍成立 | `extension/styles/bilingual.css`：`.mt-translation::before { display: none }` + `border-top: rgba(86, 99, 63, 0.18)` |
| APP-03 | App 壳 | 壳与复习页的样式拼接是结构性耦合 | 仍成立 | `build/app-bundle.js`（模块 + `review.css` 拼接） |
| APP-04 | App 壳 | 壳与设置页内容宽度不一致 | 仍成立 | `options.css` `.page{max-width:640px}` vs `review.css` `.page{max-width:680px}` |
| ONB-07 | 引导 | 「打开 Safari 扩展」有五个出处 | 仍成立 | 引导 ext 屏 / 首页横幅 / 扩展引导页 / `popup.jsx` 首帧 / 同屏 `setup-note` |
| ONB-08 | 引导 | 跨端引导状态互不可见 | 仍成立 | App：`onboardSeen` / `onboardResume`；扩展：`extObSeen` |
| POS-01 | 设计系统 | （正面）门禁覆盖面建议 | 采纳 | 与 OVL-01 一起落地最省事 |

## 三、路由

- **源头型（做完一批下游跟着收敛）**：DS-02 type scale → 顺手收掉 POP-02、DS-04、APP-04；
  DS-03 间距基线；APP-02 跨宿主 token。OVL-01/02 抽 `overlay.css` 走 `palette.gen.js`
  ⇒ **自动进现有 palette 门禁**，连带把 POS-01 的建议做掉。
- **便宜且明确（可搭车清理）**：POP-01 四页共用一条 `:focus-visible` 基线；
  POP-05 删恒等三元；OVL-03 换 sage；OVL-04 FAB 补暗色；OVL-05 清空规则与分隔线。
- **引导专项（ONB-01…08 + `onboarding-redesign/`）**：**走交互稿流程，不能搭车**。
  这一簇与 #485 已定口径正面冲突，必须人先看稿再拍。
- **本目录不进 1.19.0 的发布物**：它是设计来源与对账记录，不是 shipped 代码。

## 四、需要人拍的三件（拍完 1.19.0 的 scope 才能定）

1. **引导口径**：审计主张「检测页当最后一屏、未确认保持未完成」 vs 现行 #485
   「问过就不再问」——二选一或折中。（`onboarding-redesign/` 走的是前者。）
2. **DS-01 字体方向**：把展示字从设计系统降级为「可选」并删实现承诺；或在扩展页引入
   Figtree Latin 子集（CJK 回落系统字）。审计的原话是「不要停在中间」。
3. **「我只要网页翻译」的出口语义**（ONB-04）：维持 #493 的「落 ext 屏继续」，
   还是照审计改成「直接收尾 + 首页保留横幅」。
