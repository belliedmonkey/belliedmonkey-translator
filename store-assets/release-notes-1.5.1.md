# 1.5.1 店铺文案草稿（大肚猴视觉改版）

> 本轮实际提交：CWS + AMO（2026-08-15）。ASC 双平台的 1.5.1 What's New 一并草拟，
> 供之后 App Store 提审用（iOS TestFlight 31 / macOS 19 已是同源预览包）。
> 提交后把定稿沉淀回 gbrain 权威页。

## CWS 更新说明（What's new，双语一段）

```
1.5.1: Meet the BelliedMonkey — a full visual redesign. New mascot icon and floating button, warm terracotta & sage palette across the popup, settings and review pages. Translations now render in a calmer sage green (your custom color is never touched; the old defaults migrate once automatically). Same translation engine, same privacy model — your keys, your data.

1.5.1：大肚猴新形象——整套视觉改版。新吉祥物图标与悬浮按钮，弹窗/设置/复习页换上暖陶土与鼠尾草配色。译文默认改为更柔和的鼠尾草绿（你自定义过的颜色不会被动；旧默认色一次性自动迁移）。翻译引擎与隐私模型不变——自己的 key、自己的数据。
```

## AMO Release notes（双语）

```
Full visual redesign: new BelliedMonkey mascot (icon + floating button), warm terracotta & sage palette across every surface. Translation default color moves from green to sage — a one-shot migration updates old defaults only; any color you chose yourself is never touched. No functional or permission changes.

整套视觉改版：大肚猴新吉祥物（图标 + 悬浮按钮），全部界面换上暖陶土与鼠尾草配色。译文默认色由绿改为鼠尾草——一次性迁移只更新旧默认值，你自己选过的颜色绝不改动。功能与权限零变化。
```

## ASC What's New（简体中文，双平台通用；提审时用）

```
1.5.1 —— 大肚猴新形象

整套视觉改版：
• 新吉祥物图标与页内悬浮按钮——大肚猴，肚子里装着译文
• 全部界面换上暖陶土与鼠尾草配色（弹窗、设置、复习页、App）
• 译文默认色改为更柔和的鼠尾草绿；你自定义过的颜色不受影响，旧默认色一次性自动迁移
• 翻译与学习功能不变，隐私模型不变
```

## ASC What's New（English）

```
1.5.1 — Meet the BelliedMonkey

A full visual redesign:
• New mascot icon and in-page floating button — a pot-bellied monkey carrying the translation
• Warm terracotta & sage palette across every surface (popup, settings, review, app)
• Translations default to a calmer sage green; your custom color is untouched, old defaults migrate once automatically
• Translation, learning and privacy model unchanged
```

## 提交前检查

- [x] main @ 43002b8（PR #136）+ 本 bump；同源 TestFlight iOS 31 / macOS 19 已上传
- [x] 权限零变化（manifest 只动 version 与 content_scripts 新增 palette.gen.js——包内文件，非权限）
- [x] Firefox `data_collection_permissions` 不变（纯视觉改版）
- [ ] AMO 源码包随传（git archive v1.5.1 ':!store-assets'）
- [ ] CWS：1.5.0 仍在审（捆着 unlisted→Public + single purpose 改写）——提交 1.5.1 前和后台实况核对是否要撤审重排
