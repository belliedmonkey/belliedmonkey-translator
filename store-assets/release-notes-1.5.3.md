# 1.5.3 店铺文案草稿（接口地址逐字使用）

> 本轮提交计划：CWS + AMO（扩展，直接送审）；Apple 国际版 iOS 41 / macOS 23 先发
> TestFlight，真机验完再送审。**中国版 1.5.1 仍在首次审核队列里，本轮不动**——撤审
> 重提会把排队位置清零，而这次修的拼接缺陷只影响「自己填了完整接口地址」的用户，
> 中国版默认走注册表端点，不受影响。

---

## Chrome Web Store · What's new（英文，≤ 若干行）

Custom endpoints are now used exactly as you type them, with no exceptions. Failed
requests quote the server's own explanation instead of a generic message, and the
request body concedes any optional field the server says it will not accept. The
translation cache is keyed by endpoint and model, so changing either takes effect
immediately, and 「Test connection」 always makes a real request.

## Chrome Web Store · 更新说明（简体中文）

自定义接口地址现在逐字使用，没有例外。请求被拒时会附上服务端原话，而不是一句笼统的
「服务端拒绝了这次请求」；请求体会让掉服务端点名不接受的可选字段再试一次。翻译缓存的
键包含端点与模型，改地址或模型立刻生效；「测试连接」一定真发一次请求。

---

## AMO · Release notes（英文）

- Custom endpoints are used verbatim — the last conditional fallback that could
  re-append a path (and could rewrite an address you had just saved) is gone.
- HTTP failures now show the server's own sentence alongside our hint.
- The request body negotiates: a 400/422 naming `temperature`, `max_tokens`, the
  `system` role or streaming is answered by conceding that field and retrying once.
- Cache is keyed by endpoint and model; 「Test connection」 never answers from cache.
- Retries are limited to failures that can resolve themselves (network, timeout,
  408, 429, 5xx).

---

## App Store · What's New（iOS 41 / macOS 23，送审时用）

英文：
Custom API endpoints are now used exactly as entered. When a request is rejected, the
settings screen shows the server's own explanation, and the app retries once without
whatever optional field the server refused. Changing your endpoint or model now takes
effect immediately instead of being masked by cached results.

简体中文：
自定义接口地址现在完全按你填写的样子使用。请求被拒时，设置页会显示服务端的原话，并会
去掉服务端拒收的那个可选字段重试一次。改接口地址或模型即刻生效，不会再被缓存结果盖住。

---

## 提交清单

- [ ] CWS：上传 `belliedmonkey-translator-chrome.zip`（v1.5.3）→ 填 What's new → 提交
- [ ] AMO：上传同一个 zip → 填 release notes → 随传源码包
      （`git archive v1.5.3 ':!store-assets'`）
- [ ] Apple 国际版：TestFlight 真机验完 iOS 41 / macOS 23 → 建 1.5.3 版本 → 绑 build
      → 填 What's New → reviewSubmissions 三步提交
- [ ] 中国版：**本轮不提**，等 1.5.1 出审核结果
