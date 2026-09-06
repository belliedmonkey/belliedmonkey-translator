# 国际版商店素材（store-assets/）

App Store（`com.belliedmonkeytranslator`）、Chrome Web Store、AMO 共用的截图与预览片。
出货图是 `{zh,en}-{iphone,ipad,mac,web}-1..6.png`，由 `src/scene.html` 把**实拍产品图**
合进版式框里渲染而成。中国版的对应目录是 [`screenshots-cn/`](../screenshots-cn/)。

## 一条硬规矩：画布是什么设备，就放那个设备看到的东西

**手机画布（iPhone）只放手机视口拍的图；iPad 画布只放平板视口拍的图；Mac / Chrome
商店的横幅只放桌面视口拍的图。** 不许把一个 Mac 窗口塞进手机图，也不许把一台手机塞进
Mac 横幅。

为什么是硬规矩（2026-09-06，用户原话「人类看起来很糟糕」）：此前第 1、2、5 帧在 iPhone
画布里放的是 1728 宽的 Mac 窗口 —— 缩到 1160 像素宽之后正文一个字都看不清，画布上下各
空出四成；反过来第 3、4、6 帧在 2880 宽的 Mac 横幅里放一台手机，同样是另一个平台的截图。
用户在商店页看到的第一眼就是这些图，它们比任何文案都先说话。

`src/scene.html` 按画布判档位：横版 → `desk`；竖版且宽 ≥ 1500 → `tablet`；否则 `phone`。
**唯一的例外**是横版第 5 帧「电脑上读，手机上复习」：手机是那一帧的主语，Mac 窗口旁边
的那台手机是内容本身，不是错放。竖版第 5 帧没有 Mac（手机画布是两台手机斜叠、iPad
画布是 iPad + 手机），标题也换成「读到哪，复习到哪」。

## 实拍图矩阵 —— 三个档位，两种来源

| 档位 | 视口 | 文章双语 | 视频字幕 | 复习卡 / 统计 / 一键配置 |
|---|---|---|---|---|
| `phone`（iPhone） | 402×874 @3x | `phone-article.png` ← `capture-live.js` | `phone-video.png` ← **真机/模拟器手拍** | `{en,zh}-phone-{card,stats,onboard}.png` ← `capture.js` |
| `tablet`（iPad） | 1032×1376 @2x | `tablet-article.png` ← `capture-live.js` | `tablet-video.png` ← **模拟器手拍** | `{en,zh}-tablet-*.png` ← `capture.js` |
| `desk`（Mac / Web） | 1280×800（f1/f2）· 1100×760 @2x | `f1-article.png` ← **真 Safari 手拍** | `f2-video.png` ← **真 Safari 手拍** | `{en,zh}-desk-*.png` ← `capture.js` |

两种来源的分界只有一条：**页面是不是扩展自己的**。复习卡、统计、一键配置是扩展自己的
页面，可以在 headless 里连数据一起造，于是脚本化了（`capture.js`，18 张一次出）。文章
双语要真实扩展跑在真实站点上，`capture-live.js` 用真 Chrome 装上 `dist/` 去翻维基百科，
三个档位都拍得出来；**视频字幕在受控 Chrome 里拍不出来** —— YouTube 对自动化浏览器直接
报「Something went wrong」，headless / 有头 / 换 UA / 先暖 cookie 都试过（2026-09-06），
所以视频那一列永远是手拍。

语言也是拍出来的：`capture.js` 按页面自己的 `uiLang` 设置分 en / zh 各拍一套。此前
en-* 商店图里的复习页是中文界面。语料始终是 EN→ZH 的对照 —— 那是产品在做的事。

## 重做流程

改了 UI 就得重跑，否则商店图与实包不符。

```bash
node build.js                                   # 出 dist/
node store-assets/src/capture.js                # 18 张扩展页面（自带 http 服务，不用另起）
node store-assets/src/capture-live.js phone article
node store-assets/src/capture-live.js tablet article
# 视频两张 + 桌面 f1/f2：手拍，见 .claude/skills/store-release/assets.md「手工那几张」
bash store-assets/src/render.sh                 # 合成 48 张
```

### 手拍的判据

**拍之前要清掉三样东西**，它们都真的进过出货图：

- **未完成状态**。旧 `f1`（08-15）有两段停在「⏳ 翻译中…」。等到全部收敛再拍。
- **你自己的浏览记录**。用只有一个标签页的新窗口，否则标签栏会把你所有标签页印上去。
- **你的账号**。旧 `f3`/`f4` 印着真实邮箱 —— 那是公开页面。脚本拍的那些不登录，
  页面显示「未登录，仅本机数据」；YouTube 也别登录（头像会进图）。

## 上传

`node scripts/asc-media.js` 打印计划，`--apply` 才真替换。资产上传是三步（预留 → 传字节
→ 提交 md5 校验和），**漏了校验和会停在 `UPLOAD_COMPLETE` 而商店页看不到图，且 API
不报错** —— 所以传完必须回读 `assetDeliveryState.state === 'COMPLETE'`。

官网首页那两张（`~/belliedmonkey-cc/media/shot-*.png`）是从这里的 `en-web-1` / `en-web-4`
拷过去的，重出之后要跟着重拷（配方在那边的 `media/src/README.md`）。
