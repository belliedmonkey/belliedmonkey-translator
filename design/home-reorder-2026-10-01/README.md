# App 首页重排 · 设计稿（2026-10-01）

用户裁定（附 TestFlight 首页截图）：

1. 顶部「让 iPhone 自带的『翻译』用上大肚猴」那段**太乱**，且**不该出现在首页** —— 可在引擎**完整配好之后**才出现；版面要重做。
2. **登录完就该所有引擎都配好**（含转写与朗读），**这一屏上实时字幕与听译要能直接用** —— 它们是主角；**单词卡可以更次要**。

## 稿子在哪

- **本目录 `od/`** —— 由 **OpenDesign** 生成（项目 `App 首页重排 · 听译与字幕当主角`，技能：Apple HIG 那套，本地 agent：OpenCode），
  2026-10-01 一次跑完的产物：
  - `od/homepage-canvas.html` —— 版面画布（现状问题 + 新版层级）
  - `od/homepage-prototype.html` —— 可点击原型（iPhone 竖屏）
  - `od/homepage-prototype-mac.html` —— 可点击原型（Mac 宽屏）
  - `od/homepage-spec.html` —— 一页规格（层级理由 / 档位 / 判据）
- 同名产物也在 OpenDesign 里（可导 PDF）。

## 流程（2026-10-01 起强制）

**交互改动必须先经 OpenDesign 设计 + 人工评审才可发布**（`AGENTS.md`「Interaction / UX constraints」、
`docs/release-checklist.md` 顶部）：设计稿 → **人工签署** → `docs/interaction-spec.md` → 代码 → 门禁。
当前会话连不上 OpenDesign 时停下等待，不许「先写代码回头补设计」。

## 状态

- [x] 设计稿已出（上面四件）
- [ ] **人工评审**（等用户签署）
- [ ] 写进 `docs/interaction-spec.md`
- [ ] 代码（登录时配全三引擎 / 系统翻译段后置 / 首页重排 + 新门禁）
- [ ] 重出四线包 → **只传 TestFlight，不提审**
