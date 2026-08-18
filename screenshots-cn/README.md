# 中国版商店素材（screenshots-cn/）

App Store 中国版（大肚猴翻译 / `com.belliedmonkeytranslator.cn`）的截图。
**出货图是 `cn-iphone-1..4.png`（iPhone 6.5"）与 `cn-ipad-1..4.png`（iPad 13"）。**

## 与全球版（store-assets/）的区别 —— 不是风格差异，是事实差异

中国版的四帧刻意少了两个全球版有的故事，因为它们在中国版**不成立**：

- **没有视频字幕帧**：YouTube 在境内不可达，审核员打不开的功能不该出现在商店页
  （同 `build/descriptions.china.js` 的既有判断）。
- **没有「电脑上读、手机上复习」跨设备帧**：china flavor 的扩展同步是关的
  （`backend.config.js` enabled:false），语料不上传，那个闭环讲不通。

四帧：1 网页双语对照 · 2 国内引擎 + 自带 Key · 3 复习卡 · 4 学习设置。

## 重做流程（改了 UI 就得重跑，否则商店图与实包不符）

```bash
node build.js --flavor china                  # 出 dist-china
(cd dist-china && python3 -m http.server 8731 &)
node screenshots-cn/src/capture.js            # 拍 dist-china 实屏 → src/assets/
bash screenshots-cn/src/render.sh             # 合成两个尺寸 → cn-iphone-* / cn-ipad-*
```

**实拍，不手绘**：`src/capture.js` 用 headless Chrome 打开出货的 `dist-china`
页面截图（同 store-assets 的纪律）。抓图环境缺的东西由桩补上、且只补环境
（无系统语音 → 桩一个 voice；AI 题包离线必失败 → 把首卡题型钉在本地题型），
产品自身的界面与文案一律照实拍。

2026-08-17 重做：旧版是 1.0 时代的绿色两张图 + 手绘 mock，与 Organic 改版后的
真实界面完全不符，被用户在提审前发现（见 gbrain 发布权威页当日记载）。
