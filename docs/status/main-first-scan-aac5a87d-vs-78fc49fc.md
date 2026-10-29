# Main-first user-visible scan `aac5a87d` vs `78fc49fc`

- Base (RFS tip): `aac5a87d08234ed1c9d634521955c00708a376da` — fix(1.21.2): deliver mic PCM to JS when thaiGrokStt so Grok STT gets audio
- Main ref: `origin/main` → `78fc49fc4aa39b736cb369a41aa47a43af18eb63` — fix(release): align package, manifest, and MT_VERSION to 1.22.3 (#620)
- Base is ancestor of Main: **no** (`git merge-base --is-ancestor`)
- Generated: 2026-10-29T15:30Z by `scripts/main-first-user-visible-scan.sh`
- Checklist: `docs/product/user-visible-checklist.md`
- Markers: `scripts/lib/user-visible-markers.txt`

Counts: PRESENT 15 · MISSING 7 · NEW 0 · ABSENT 0
- Markers PRESENT on BASE: 22
- Of those, also PRESENT on MAIN: 15

Semantics match tip-user-visible-diff (BASE↔MAIN):
- PRESENT = on BASE and on MAIN
- MISSING = on BASE, gone on MAIN（上架过 IA 未进 main）
- NEW = on MAIN only
- ABSENT = neither

**缺本收据 = BLOCKED**（宣称「上架过 IA 已在 main / 可 marketing 落条」的提审或打版路径）。
脚本对 MISSING / 非祖先不 exit≠0；裁决在 QD / 形检。

## Ancestry

BASE is **not** an ancestor of MAIN — shipped tip is off the main line;
marker PRESENT/MISSING still reports content presence, but main-first
形检 must treat this as a red flag until BASE (or its user-visible)
lands on main.

## MISSING

| id | item | path | marker |
|---|---|---|---|
| captionDesk | 字幕台 captionDesk | `src/app/layout-caption.js` | `captionDesk` |
| Duo-06 | Duo-06 门控徽章 | `src/app/listen-view.jsx` | `Duo-06` |
| Duo-08 | Duo-08 安全区 +12 | `app/style.css` | `Duo-08` |
| thai | 泰语听译 thaiGrokStt（听译） | `src/app/listen-model.js` | `thaiGrokStt` |
| thai | 泰语听译 thaiGrokStt（模块） | `app/grok-stt.js` | `thaiGrokStt` |
| thai | 泰语听译国际包模块表 | `build/app-bundle.js` | `INTL_GROK_MODULES` |
| thai-peel | 泰语听译中国剥扫 | `build/china-gate.js` | `grok-stt-open` |

## PRESENT

| id | item | path | marker |
|---|---|---|---|
| D-02 | D-02 整体进度（细条） | `src/app/AppShell.jsx` | `packs-dl-progress` |
| D-02 | D-02 整体进度（绘制） | `src/app/shell-model.js` | `paintDlProgress` |
| D-02 | D-02 整体进度（% · 大小） | `src/app/shell-model.js` | `firstrun_packs_progress_pct` |
| D-02 | D-02 整体进度（CTA 键） | `src/app/shell-model.js` | `firstrun_packs_busy_pct` |
| D-02 | D-02 整体进度（CTA 文案 下载中 {n}%） | `src/app/shell-model.js` | `下载中 {n}%` |
| D-02 | D-02 整体进度（汇总） | `src/app/pack-progress.js` | `aggregatePackProgress` |
| D-03 | D-03 齐了就离开包屏 | `src/app/shell-model.js` | `dismissPacksAfterDone` |
| N24-M01 | N24 M-01 行右态 | `src/app/shell-model.js` | `N24 M-01` |
| N24-M02 | N24 M-02 文案锁 | `src/app/shell-model.js` | `N24 文案锁 M-02` |
| N24-M03 | N24 M-03 语言包与朗读 | `src/app/settings-view.jsx` | `N24 M-03` |
| N24-M04 | N24 M-04 高级参数 | `src/app/settings-view.jsx` | `N24 M-04` |
| switch | 一键⇄分项确认（设置） | `src/app/settings-view.jsx` | `opt_mode_switch_to_quick` |
| switch | 一键⇄分项确认（选项页） | `src/pages/options.jsx` | `opt_mode_switch_to_detail` |
| P0-B | 句子序 P0-B 新→旧（模型） | `src/app/listen-model.js` | `P0-B` |
| P0-B | 句子序 P0-B 新→旧（视图） | `src/app/listen-view.jsx` | `P0-B` |

## NEW

(none)

## ABSENT

(none)

## Hotspot files

| path | base | main |
|---|---|---|
| `app/grok-stt.js` | present | absent |
| `app/style.css` | present | present |
| `build/app-bundle.js` | present | present |
| `build/china-gate.js` | present | present |
| `src/app/AppShell.jsx` | present | present |
| `src/app/layout-caption.js` | present | absent |
| `src/app/listen-model.js` | present | present |
| `src/app/listen-view.jsx` | present | present |
| `src/app/pack-progress.js` | present | present |
| `src/app/settings-view.jsx` | present | present |
| `src/app/shell-model.js` | present | present |
| `src/pages/options.jsx` | present | present |

File `absent` on main with markers MISSING = dropped surface not on main.
