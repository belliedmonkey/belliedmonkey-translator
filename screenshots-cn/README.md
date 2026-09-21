# 中国版商店素材（screenshots-cn/）

App Store 中国版（大肚猴翻译 / `com.belliedmonkeytranslator.cn`）的截图。
**出货图是 `cn-{iphone,ipad,mac,web}-1..7.png`** —— iPhone 6.5"（1242×2688）、iPad 13"（2064×2752）、
Mac App Store 16:10（2880×1800），以及给官网 belliedmonkey.com 用的 1280×800（`cn-web-*`）。

## 与全球版（store-assets/）的区别 —— 不是风格差异，是事实差异

中国版刻意少了两个全球版有的故事，因为它们在中国版**不成立**：

- **没有视频字幕帧**：YouTube 在境内不可达，审核员打不开的功能不该出现在商店页
  （同 `build/descriptions.china.js` 的既有判断）。
- **没有「电脑上读、手机上复习」跨设备帧**：china flavor 的扩展同步是关的
  （`backend.config.js` enabled:false），语料不上传，那个闭环讲不通。

七帧：1 网页双语对照 · 2 国内引擎 + 自带 Key · 3 复习卡 · 4 学习设置 · 5 文档翻译 ·
6 实时字幕 · 7 对话听译。（5 是 1.10.0 加的，6 / 7 是 1.11.0 加的，原料由 `capture-app.js`
拍 `dist-app-china` 得到。）**帧号只往后加、不重排。**

## 重做流程（改了 UI 就得重跑，否则商店图与实包不符）

```bash
node build.js --flavor china                  # 出 dist-china
(cd dist-china && python3 -m http.server 8731 &)
node screenshots-cn/src/capture.js            # 拍 dist-china 实屏 → src/assets/
bash screenshots-cn/src/render.sh             # 合成四个尺寸 → cn-{iphone,ipad,mac,web}-* 共 28 张
```

**实拍，不手绘**：`src/capture.js` 用 headless Chrome 打开出货的 `dist-china`
页面截图（同 store-assets 的纪律）。抓图环境缺的东西由桩补上、且只补环境
（无系统语音 → 桩一个 voice；AI 题包离线必失败 → 把首卡题型钉在本地题型），
产品自身的界面与文案一律照实拍。

2026-08-17 重做：旧版是 1.0 时代的绿色两张图 + 手绘 mock，与 Organic 改版后的
真实界面完全不符，被用户在提审前发现（见 gbrain 发布权威页当日记载）。

## 官网 belliedmonkey.com 的图也从这里来

`cn-web-{1,3,5,6,7}` → 中国官网首页五张。**不要手工 cp**，用
`bash ~/belliedmonkey-com/media/src/sync-from-screenshots-cn.sh`，它会写一份
`PROVENANCE.txt`（来源路径 / 来源改动时间 / sha256）。

**绝不能拿 `store-assets/zh-web-*` 充数** —— 那是国际版素材，含视频字幕帧与跨设备帧，
正是上面说的「在中国版不成立」的两样。
