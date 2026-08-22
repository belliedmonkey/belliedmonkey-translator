# 1.6.4 发布说明（Apple 四条线）

> 提审时 `whatsNew` 为空会被 Apple 直接挡在 `reviewSubmissionItems` 那一步，报的是
> 「appStoreVersions … is not in valid state」——**不会告诉你缺的是哪一项**。
> 2026-08-22 四条线全部卡在这里。以后先跑 `node scripts/asc-submit.js <版本>` 的
> 干运行，它会逐项检查。

国际版（`com.belliedmonkeytranslator`，iOS build 43 / macOS build 24）与中国版
（`com.belliedmonkeytranslator.cn`，iOS build 9 / macOS build 14）的文案不同：
中国版多一条默认引擎修复，那是它独有的问题。

---

## 国际版 · en-US

```
Reasoning models now translate long passages reliably. Some of them used to return a
successful response with no text in it — the paragraph just stayed blank, with no error
to explain why. Requests now carry only the fields each endpoint is known to accept,
which fixed that and cut a long paragraph from about 15 seconds to 3.

· Advanced settings accept your own request parameters, so a private or corporate
  endpoint can be tuned without waiting for us to add it.
· More engines to choose from — each one measured against its real endpoint rather
  than its documentation.
· An engine whose default model had been retired no longer fails the moment you pick it.
· Fixed a few interface strings that showed their formatting marks verbatim.
```

## 国际版 · zh-Hans

```
推理型模型现在能稳定翻完长段落。此前它们有时会返回一个「成功」的响应、里面却一个字
都没有——那一段就那样空着，也没有任何报错说明原因。现在请求只携带各端点确实接受的
字段，这个问题解决了，一个长段落也从约 15 秒降到 3 秒。

· 高级设置可以自己填请求参数，私有或企业端点不必等我们适配。
· 可选引擎更多——每一个都是拿真实端点测出来的，不是照着文档写的。
· 某个引擎的默认模型已被下架，导致一选就报错，现已修复。
· 修正了几处界面文案里原样显示出来的格式符号。
```

## 中国版 · zh-Hans

```
修复：全新安装时默认引擎未正确指向可用引擎，可能导致翻译一直停在「翻译中…」而不
报错。现在默认即为 DeepSeek，选择不认识的引擎也会立刻给出明确提示。

推理型模型现在能稳定翻完长段落。此前它们有时会返回一个「成功」的响应、里面却一个字
都没有。现在请求只携带各端点确实接受的字段，这个问题解决了，速度也快了很多。

· 高级设置可以自己填请求参数，自建或企业端点不必等我们适配。
· 可选引擎更多——每一个都是拿真实端点测出来的。
· 修正了几处界面文案里原样显示出来的格式符号。
```
