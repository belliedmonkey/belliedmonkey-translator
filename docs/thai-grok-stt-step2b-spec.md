# 步 2b：App 原生 Grok STT 鉴权桥

日期：2026-10-23。作者：架构师。  
依据：用户 08:02（经产品转达）立项 **1.20.x**、先开 2b；不进 1.19.x；改线上中继前先问用户。  
基线：archdemo `7fe71d68`（步 2）；云端效果已过关见 `RESULT.md`。

## 1. 目标

在 WKWebView 内让 `GrokStt` **带 `Authorization: Bearer`** 连上 `wss://api.x.ai/v1/stt`，使 Debug 开关开 + th 时 App 真听可用；开关关行为不变。

## 2. 架构

```
JS GrokStt.open({ locale, getApiKey, onEvent })
    │
    ├─ Node / 有自定义头的 WS → 今天路径（headers）
    │
    └─ App（有 mtSpeech 或专用通道）→ 原生桥
         JS post: grok-stt-open { req, url|params, locale } + key 只此一次
         原生 URLSessionWebSocketTask（headers 含 Authorization）
         JS post: grok-stt-pcm (base64 / 二进制约定) · grok-stt-cut · grok-stt-close
         原生 → JS：grok-stt-event { req, kind, … } 映射为 ready/partial/final/error/close
```

- **优先**扩 `mtSpeech` 通道（少一个 handler）；若 speech-bridge 过重，可新建 `mtGrokStt` 通道，须进 sync-app-assets / Xcode 注册。
- URL / model / sample_rate / encoding / language 仍由 **JS 拼好**传给原生（与 `grok-stt.js` 常量一致），原生不复制业务逻辑。
- Key：仅 `open` 时从 JS `getApiKey()` 传到原生；原生**不**写入日志 / DiagLog / 回执；会话结束后从内存清掉。不进 git、不进 Release 默认。
- 无 key → 仍 JS 侧 `no-key`（不建原生会话）。
- **热修（建议同提交）**：`no-key` / `no-grok` / 仅 th 路 `server`/`ws` 错误时，**不要** `socketLost` 拖垮仍健康的原生非 th 路（步 2 ACCEPT 项）；整场仅 Grok（无其它 locale）时才可按掉线处理。

## 3. dsh 步骤（仅 archdemo；DeepSeek 4.1 flash；本地提交；不 push）

| 步 | 内容 | 验证 |
|---|---|---|
| 2b.0 | 记录 HEAD=`7fe71d68`、status | 干净可开工 |
| 2b.1 | Swift：WebSocket 会话（open/pcm/cut/close/event）；key 不落日志 | 编译 Debug；假测或探针 |
| 2b.2 | `grok-stt.js`：探测原生桥则走桥，否则保留 Node headers / 浏览器退回 | 单测：假桥映射；无桥行为与步 1 同 |
| 2b.3 | listen-model：隔离 th 路 error（上节热修） | 路由测扩展：zh+th 无 key 时 zh 不 halt |
| 2b.4 | 本地 commit；报告 STEP2B.md | 交架构师复核 |

停手：要改线上中继 / secrets；要默认开开关进 Release；要进 1.19.x；要 push。

## 4. 验收

| 项 | 过关 |
|---|---|
| 开关关 | 与 `7fe71d68` 听译路径同形 |
| 开关开 + key + App | 原生带头发连；有 partial/final；key 不出现在日志/回执 |
| 开关开 + 无 key | `no-key`；双语言场不因 th 废路而 socketLost 整场 |
| 范围 | 仅 archdemo；不进 1.19.x；不 push |

## 5. 不做

中国翻墙手测（步 4，另批）；额度中继代付；进版合入 main/1.19.5。
