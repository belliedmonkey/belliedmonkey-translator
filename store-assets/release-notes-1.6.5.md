# 1.6.5 发布说明（Apple 三条线）

> `whatsNew` 为空会让整轮提审在 `reviewSubmissionItems` 被挡，报的是
> 「appStoreVersions … is not in valid state」，**不会告诉你缺的是哪一项**。
> 提审前先跑 `node scripts/asc-submit.js 1.6.5` 的干运行。

本轮三条线：

| 线 | bundle id | build |
|---|---|---|
| 国际版 iOS | `com.belliedmonkeytranslator` | 45 |
| 中国版 iOS | `com.belliedmonkeytranslator.cn` | 10 |
| 中国版 macOS | `com.belliedmonkeytranslator.cn` | 15 |

**国际版 macOS 本轮不发** —— 1.6.4 (build 24) 还在审，撤审会把排队位置清零，
等它上架后单独补 1.6.5。

**为什么国际版和中国版的文案必须不同**：能返回音频字节的语音引擎，国际版有
自建端点和 OpenAI Speech 两个，**中国版只有自建端点**（合规门滤掉了另一个）。
所以「出发前把语音下载到本机」这句话，对绝大多数中国版用户是不成立的 —— 他们用的
是设备内置语音，那本来就离线，预载对他们真正补上的是解析和译文。写成一样的就是
在对一半用户说假话。

---

## 国际版 · en-US

```
Podcast mode can now be taken offline. Tap Preload before you set out and the speech,
sentence notes and translations for today's deck are downloaded to your device, so a
whole session plays with no network at all.

The first tap only prices it — it shows how many cards and how many billed calls, and
spends nothing. You decide, then tap again.

· Cards start faster. Everything a card needs is now requested at once instead of one
  piece at a time, so the silence between sentences is gone.
· Cards captured without a translation can be given one, using the engine you already
  configured.
· When the speech engine cannot be reached, it now says so and stops — instead of
  skipping through the whole deck in silence and reporting that the round is finished.
· Stop now takes effect promptly during a preload.
```

## 国际版 · zh-Hans

```
播客模式可以离线用了。出发前点一下「预载离线资源」，今天要听的语音、句子解析和译文
就全部下到本机，路上完全没网也能整轮播完。

第一下只算账——告诉你有多少张卡、要花多少次付费调用，不花一分钱。你看清楚了再点
第二下。

· 开卡更快。一张卡需要的东西现在一次性同时请求，不再一段一段地取，句与句之间的空档
  没有了。
· 采集时没有译文的卡，现在可以用你已经配好的引擎补上译文。
· 连不上语音引擎时会明确说出来并停下——而不是一声不响地把整副牌跳完，再告诉你
  「本轮听完了」。
· 预载过程中按「停止」现在会立刻生效。
```

## 中国版 · zh-Hans

```
播客模式新增「出发前预载」：点一下，就把今天要听的句子解析和译文全部准备好存在本机，
路上没网也能整轮播完。用设备内置语音时朗读本来就不需要联网，预载补上的是解析和译文；
如果你配置了自建语音端点，语音也会一并下载到本机。

第一下只算账——告诉你有多少张卡、要花多少次调用，不花一分钱。你看清楚了再点第二下。

· 开卡更快。一张卡需要的东西现在一次性同时请求，句与句之间的空档没有了。
· 采集时没有译文的卡，现在可以用你已经配好的引擎补上译文。
· 连不上解析或语音引擎时会明确说出来并停下——而不是一声不响地把整副牌跳完，再告诉你
  「本轮听完了」。
· 预载过程中按「停止」现在会立刻生效。
```
