# 发布清单（release checklist）

> **这份清单收的是「构建闸门看不见的东西」。** 仓库里能自动化的都已经是闸门——版本漂移、
> `data_collection_permissions`、locale 目录名、译文里的版本号字面量、`enabled` 与隐私文案
> 的耦合、Safari 包完整性（`npm run verify:ios`）。**下面这些跨仓库或跨账号，闸门够不到，
> 只能靠这张表。**
>
> **清单比闸门弱。** 它依赖有人在发版时打开它。凡是能变成闸门的项，都应该从这里搬进
> `build.js` 然后从这里删掉——这份文件越短越好。

## 0. 门禁（都能自动跑，跑之前别做下面任何一步）

```bash
npm test                 # 纯逻辑
npm run test:layout      # 真实 headless Chrome，31+ fixture
node build.js            # Chrome/Safari；含全部构建期闸门
node build.js firefox    # Firefox
```

## 1. 设备矩阵

按 [`verification-spec.md`](verification-spec.md) §0：**全矩阵，每次**。
每一行要么跑过，要么显式标 N/A —— 不写「大概没影响」。

**配 DeepSeek，不要在免费 Google 端点上验证**（§0，强制）。判据：**译文里不该有原文回显**。
免费端点的典型故障就是对同一输入既返回真译文又返回逐字回显——本项目曾因此把一次 Google
的结果误当成 DeepSeek 验证通过。

## 2. 隐私文案必须与本次发布的功能同版上线 ⚠️

**这一条是承诺，不是惯例。** `belliedmonkey.com/privacy.html` 自己写着：

> 本 App 将来若在你的设备上保存更多内容，会在本节逐项列出，并在**该功能上线的同一个版本**
> 更新本页——**不提前写，也不事后补**。

所以两个站点的隐私改动**必须与扩展发版同时推送**：

```bash
git -C ~/belliedmonkey-com push    # EdgeOne Pages，推送即自动部署
git -C ~/belliedmonkey-cc  push    # Vercel，同上
```

- **提前推**：页面描述一个用户还没有的功能——违反「不提前写」，且用户会去找一个不存在的开关。
- **事后推**：功能已经在采集数据而页面还没说——违反「不事后补」，这一头严重得多。

对应关系（`learning-design.md` §10）：

| 发布内容 | 闸门 |
|---|---|
| V1 本地采集 | **Gate A** —— README 隐私段 + 两个站点的「本机存储的数据」条目 |
| V3 同步 | **Gate B** —— 「无账号」那句必须改；`build.js` 已有闸门：`learn/backend.config.js` 的 `enabled` 为 true 而 README 仍写着旧句子时**构建失败** |

## 3. 商店文案

`extension_description` 与商店描述由注册表驱动，不要手写服务商清单（AGENTS.md「一个注册表，
N 个消费者」；已因此漂移过两次：DeepSeek 模型名、版本号）。

## 4. Issue 与 PR

AGENTS.md 要求每个改动一个 issue。**修复合并进 `main` 之后才关闭 issue**——分支上就关，
等于声称一件还没进产品的事已经做完了。
