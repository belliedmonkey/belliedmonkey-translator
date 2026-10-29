# User-visible tip diff `aac5a87d` vs `ecd8b8b4`

- Base: `aac5a87d08234ed1c9d634521955c00708a376da` — fix(1.21.2): deliver mic PCM to JS when thaiGrokStt so Grok STT gets audio
- Head: `ecd8b8b4d19e965942ab738366b767e4032a7a79` — feat(agent): Claude Code and Codex packaging for N25 H1 (#598)
- Generated: 2026-10-29T15:26Z by `scripts/tip-user-visible-diff.sh`
- Checklist: `docs/product/user-visible-checklist.md`
- Markers: `scripts/lib/user-visible-markers.txt`

Counts: PRESENT 0 · MISSING 22 · NEW 0 · ABSENT 0

MISSING means the marker is on the base tip and gone on the head tip.
A submit / marketing cut with MISSING rows needs a product card before it proceeds.
Silent drop is forbidden. `QD-JUDGE-submit-*` without this receipt is BLOCKED.

## MISSING

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
| captionDesk | 字幕台 captionDesk | `src/app/layout-caption.js` | `captionDesk` |
| Duo-06 | Duo-06 门控徽章 | `src/app/listen-view.jsx` | `Duo-06` |
| Duo-08 | Duo-08 安全区 +12 | `app/style.css` | `Duo-08` |
| thai | 泰语听译 thaiGrokStt（听译） | `src/app/listen-model.js` | `thaiGrokStt` |
| thai | 泰语听译 thaiGrokStt（模块） | `app/grok-stt.js` | `thaiGrokStt` |
| thai | 泰语听译国际包模块表 | `build/app-bundle.js` | `INTL_GROK_MODULES` |
| thai-peel | 泰语听译中国剥扫 | `build/china-gate.js` | `grok-stt-open` |

## PRESENT

(none)

## NEW

(none)

## ABSENT

(none)

## Hotspot files

| path | base | head |
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

File `absent` on head with markers MISSING is a dropped surface.
File `present` on both with markers MISSING is a deletion inside a file that is still there.
