# 排查手册（troubleshooting）

> **用途**：线上出的毛病 —— 网络、后端、真机行为、偶发 —— 从这里开始。
> 每查完一件，把**判据、命令、结论**写进来。下一篇的人只有这份文档。
>
> **与相邻文档的分工**：
> - [`docs/verification-spec.md`](verification-spec.md) —— **怎么验**（全矩阵回归、cua-driver、诚实性规则）。
> - [`docs/regression-tests.md`](regression-tests.md) —— 逐条手测场景。
> - **本篇** —— **出了毛病怎么查**：证据在哪、怎么取、已经查过什么、别再重复查什么。
>
> 一次排查如果产出了新的**判据**（能变成门禁的那种），把它移进 `build.js` / `test/`，
> 然后**从这里删掉** —— 手册比门禁弱，留在手册里的东西总会烂。

---

## 0. 先读这条：**证据在哪，决定了你能查出什么**

排查一开始最常见的那句错话是「日志里没有，所以没问题」。下面这张表是这条规则的全部内容：

| 失败形态 | 客户端表现 | 留在服务端日志？ | 留在遥测？ |
|---|---|---|---|
| 服务端明确拒绝（4xx/5xx，有 response body） | 具名错误文案 | **有**（状态码 + error + path） | 有 |
| 请求根本没发出去 / 超时 / TLS / DNS 失败 | `network` / `offline` | **没有** —— 请求没到 | **没有** —— 上报走同一条网络 |
| 请求到了但被中间层拦（preflight、代理） | `Load failed` | 有时只有预检那一行 | 没有 |

**推论**（2026-10-03 吃过一次）：

- 屏幕上写着「连不上服务器」时，**服务端日志里查不到是正常的**，不是「没记」；
- 这时**开遥测也没用** —— 同一个网络失败会把上报一起挡住。**别为了查这类问题去动遥测承诺。**
- 这类问题只能**在设备侧取证据**：本机日志、Xcode Console、抓包。

---

## 1. 中国版登录 / 境内后端

### 1.1 后端在哪

| | |
|---|---|
| 机器 | `lhins-6amaoj8m`（腾讯云轻量，`Ubuntu-W4rk`），北京 · `ap-beijing` |
| 公网 | `49.233.0.7`（内网 `10.2.0.12`） |
| 域名 | `api.belliedmonkey.com`（境内后端，ICP 备案接入资源就是这台） |
| 客户端地址来源 | `extension/learn/backend.config.js` 的 `china.url`；构建时 `build.js` 的 `switchBackend()` 写进产物 |
| 容器 | `db` · `auth`(GoTrue) · `rest`(PostgREST) · `fn` · `grant` · `ledger` · `proxy`(Caddy) |

**中国版与说好的不一样时，先看这一条**：产物里 `MT_BACKEND.url` 必须是 `api.belliedmonkey.com`，
`previousUrl` 是东京 `*.supabase.co`（**只用于归属比较，从不发请求**，合规门为它开了豁免）。
国际版反过来。

### 1.2 怎么上机（**不要试 SSH**）

SSH 只认 `publickey,password`，而仓库里**没有那台机器的密码**（`.local/keys.md` 里是
`tencent_secret_id` / `tencent_secret_key`，云 API 的，不是 ssh 的）。`~/.ssh/config` 里也没有它。
**在这上面耗时间是最常见的浪费。** 走腾讯云 TAT：

```bash
# 本机侧的一次性配置（每次跑都带这两个环境变量即可，不必写进 ~/.tccli）
cd /Users/belliedmonkey/mobiletranslator-1190
export TENCENTCLOUD_SECRET_ID=$(grep -m1 '^tencent_secret_id'  .local/keys.md | sed 's/^[^=]*=[[:space:]]*//')
export TENCENTCLOUD_SECRET_KEY=$(grep -m1 '^tencent_secret_key' .local/keys.md | sed 's/^[^=]*=[[:space:]]*//')
```

helper（存成 `/tmp/tat.sh`，`chmod +x`；`$1` 是远端脚本）：

```bash
#!/bin/zsh
CMD=$(printf '%s' "$1" | base64)
INV=$(uvx tccli tat RunCommand --Content "$CMD" --CommandType SHELL \
  --InstanceIds '["lhins-6amaoj8m"]' --Timeout 120 --region ap-beijing \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["InvocationId"])')
sleep 9
uvx tccli tat DescribeInvocationTasks \
  --Filters "[{\"Name\":\"invocation-id\",\"Values\":[\"$INV\"]}]" --HideOutput false --region ap-beijing \
  | python3 -c '
import sys,json,base64
for t in json.load(sys.stdin).get("InvocationTaskSet",[]):
    r=t.get("TaskResult") or {}
    print("[status]",t.get("TaskStatus"),"exit",r.get("ExitCode"))
    print(base64.b64decode(r.get("Output","")).decode("utf-8","replace"))
'
```

```bash
/tmp/tat.sh 'hostname; cd /opt/bt/deploy/china && docker compose ps --format "{{.Service}} {{.Status}}"'
```

**判据（回读，别拿「没报错」当成功）**：输出里能看到 `auth` / `db` / `proxy` … 且都是 `Up`。
看不到就是没跑到，不是「机器坏了」。

**四个踩过的坑**：
1. `tccli` 不在 PATH —— 用 **`uvx tccli`**（首次会下载，约 14 MB）。
2. `~/.tccli/default.configure` 里的凭证**是失效的**（`secretId is invalid`）—— 用 `keys.md` 的两个值覆盖，别去修那个文件。
3. 端口参数是大写：`--Limit 20` 不是 `--limit`；区域 `--region ap-beijing` 要显式给。
4. **远端脚本里别再套一层引号**（比如 `python3 -c "…\"…"`）—— 会把 base64 后的请求弄坏，症状是
   `RunCommand` 没有 `InvocationId`。远端只做简单 grep，**解析放本机**。

### 1.3 读日志

GoTrue 是每行一个 JSON；Caddy（`proxy`）也开 access log。

```bash
cd /opt/bt/deploy/china

# ① 近 7 天所有非 2xx 的 completed，按 (method, path, status, error) 归类
docker compose logs --since 168h auth 2>&1 | grep -F '"msg":"request completed"' \
  | grep -vE '"status":(200|204)' \
  | python3 -c '
import sys,json
from collections import Counter
c=Counter()
for line in sys.stdin:
    i=line.find("{")
    if i<0: continue
    try: d=json.loads(line[i:])
    except Exception: continue
    c[(d.get("method"),d.get("path"),str(d.get("status")),str(d.get("error",""))[:70])]+=1
for k,v in c.most_common(30): print(v,k)
'

# ② 5xx / panic（**这一条是「服务器有没有真挂」的判据**）
docker compose logs --since 168h auth 2>&1 | grep -E 'panic|"level":"(error|fatal)"|"status":5'

# ③ 某一个来源 IP 的完整时间线（把 <IP> 换成用户出口 IP）
docker compose logs --since 72h auth 2>&1 | grep -F '<IP>' | tail -60
```

`remote_addr` 读到 **`172.18.x.x`** ＝ 容器内网（`fn`/`grant`/`ledger` 自己发出来的），**不是用户**；
用户是公网地址。这条不弄清会把「我们自己的服务在打自己」当成「用户在报错」。

### 1.4 已知结论（2026-10-03 首次实查）

**症状**：中国版「第一次登录报错、第二次就成功」。遥测里 `auth_fail` **0 行**。

**近 7 天该机器的全部非 2xx**：

```
23  GET  /user             403   全是容器内网 172.18.0.6（我们自己的服务）
12  POST /token            400   invalid_grant: Invalid Refresh Token: Not Found
 3  GET  /authorize        302   正常 OAuth 跳转
 2  POST /otp              400   Unable to validate email address: invalid format
 1  POST /verify           403   token has expired or is invalid
 1  POST /admin/generate_link 403
```

**零个 5xx、零个 panic、零个超时。** Apple 登录**全部 200**（含用户本人账号，一周内多次）。

**用户那次失败的时间线**（UTC，本地 = +8）：

| 时间 | 请求 | 结果 |
|---|---|---|
| 09:00:27 | `POST /otp`（`…en@gmail.com`） | 200 码已发 |
| 09:01:59 | `POST /verify` | **403 验证码已过期** ← 第一次失败 |
| 09:05:53 | `POST /otp` | **400 邮箱格式不合法** |
| 09:08:40 | `POST /otp` | **400 同上** |
| 09:09:53 | `POST /otp`（`…@gmail.com`） | 200 |
| 09:11:05 | `POST /verify` | **200 注册成功** ← 第二次成功 |

**结论**：

1. **不是服务器/网络故障** —— 第一次失败是**验证码过期**，中间两次是**邮箱写错**。
2. `/token` 400 `invalid_grant` 一周 12 次 = App 拿着**境内不认的刷新令牌**（2026-09-22 切境内后端留下的）。
   `extension/learn/auth.js` 的 `token()` 已经**正确地**吞掉它（400/401 且有 GoTrue body ⇒ 判死 → 登出 → 返回 null），
   所以它不该在界面上变成报错。
3. 「连不上服务器」这**句文案**只有一个来源：`src/app/shell-model.js` 的 `humanError()`
   —— `code === 'network' || code === 'offline'`。即 **fetch 根本没完成**。
   按 §0 的表，**这类失败服务端日志里查不到、遥测也上报不了** —— `auth_fail` 0 行因此是**预期**，不是埋点漏了。

### 1.5 所以下次怎么查这条

| 现象 | 先看哪 |
|---|---|
| 屏幕上具名报错（验证码/密码/额度…） | 后端日志（§1.3 ①②③），多半就是它说的那件事 |
| 屏幕上「连不上服务器」 | **设备侧**：Xcode Console / `devicectl` / 抓包。服务端和遥测都指望不上 |
| 「第一次失败第二次成功」 | 先数后端日志里同 IP 的序列 —— 大半是**输入问题**（码过期、邮箱写错） |

### 1.6 设备侧复现（2026-10-03 模拟器实测，中国版）

配方：`.local/regress-1.19.0/runner/run-ob.sh`，用例 `testD2OtpBadCode`（坏码，不需要 service key）。

| 面 | 看到什么 |
|---|---|
| **屏上**（`.local/cn-login-549/shots/testD2OtpBadCode/D2-bad-code_*.png`） | **「验证码不对或已过期，重新试一次。」**（红字，在登录卡下方） |
| **同一刻后端**（§1.3 的 TAT 回读） | `POST /otp` → 200 `user_confirmation_requested`；`POST /verify` → **403 `token has expired or is invalid`** |

**两者一一对应** ⇒ 这条路上「报错」是真的在说「码不对/过期」，**文案与服务端事实一致**。
「连不上服务器」不出现在这条路上 —— 它只有 `code === 'network' \| 'offline'` 一个来源（§1.4 第 3 条），
要抓它得让请求**根本发不出去**（§0 的表）。

### 1.7 中国版模拟器包怎么编（本轮踩出来的，之前没有）

```bash
node build.js --flavor china && npm run app:sync      # 必须都跑：app:sync 读 dist-app-china/
xcodebuild -project "safari-project-china/BelliedMonkey Translator CN/BelliedMonkey Translator CN.xcodeproj" \
  -scheme "BelliedMonkey Translator CN (iOS)" -configuration Debug -sdk iphonesimulator \
  -derivedDataPath /tmp/mt1190-dd-china \
  -destination "platform=iOS Simulator,id=<UDID>" build
npm run verify:app-fresh -- "<…/BelliedMonkey Translator CN.app>" china   # 必过，否则别下结论
```

- scheme 名带 flavor：中国版是 `… CN (iOS)`，国际版是 `… (iOS)`；**工程在 `safari-project-china/<App 名>/` 里**，
  不在 `safari-project-china/` 根下（`ls safari-project-china/*.xcodeproj` 会 no-match，别据此以为工程没了）。
- 中国版包的 `.app` 名是 `BelliedMonkey Translator CN.app`；`app:sync` 会按工程树自动选 `dist-app-china/`，
  **没有 flavor 参数**。

### 1.8 Apple 登录这条（2026-10-03 收窄，**未定论**）

**用户给的复现条件：这一条只有 Apple 登录会复现。** 这与代码形状一致 —— Apple 是唯一
「先弹系统面板 → 回来立刻 `POST /auth/v1/token?grant_type=id_token`」的入口（Google 同形，
`ASWebAuthenticationSession`，用户没报）。

**已经排除的**：

| 假设 | 判据 | 结果 |
|---|---|---|
| 服务端出不了网去 `appleid.apple.com` 取 JWKS | 宿主机与 `auth` 容器 curl `/auth/keys` 各 3 次 | **都 200，0.55 s** ⇒ 排除 |
| 服务端真拒过 Apple | 近 7 天日志 `jwks|appleid|apple`（滤掉 `provider":"apple"` 这类正常行） | **零条** ⇒ 排除 |
| 「回前台后的第一发 fetch 必失败」 | 模拟器 DBG13：压后台 12 s → 回前台 → 立刻发验证码 | **第一次请求成功** ⇒ **证伪** |

**还没排除 / 一句话就能定**：`humanError`（`src/app/shell-model.js`）对 Apple 有两个出口，
**屏上那一句把它一分为二**：

| 屏上写的是 | 含义 |
|---|---|
| 「连不上服务器，检查网络后重试。」（`app_offline`） | id_token **拿到了**，是**换会话那个 POST 在网络层抛了**（`auth.js` 的 `post()` catch → `code='offline'`） |
| 「Apple 登录没能完成。可以改用下面的邮箱或手机号。」（`app_apple_failed`） | **原生那一步没给出 id_token**（`ASAuthorizationControllerDelegate.didCompleteWithError` → `error:"apple_failed"`） |

**代码侧确定的一条**：`LearnAuth.signInWithIdToken()` **没有重试** —— 一次 `post()`，抛了就抛。
而用户的观察是「**第二次就成功**」⇒ 把那一次重试**自动化**，就是这个症状的对症修法
（对 id_token 兑换是安全的：同一用户、幂等）。

**模拟器的硬限制**：模拟器**没有登录 Apple ID**（`MobileMeAccounts` 域不存在），
`ASAuthorizationController` 的面板出不来 ⇒ **Apple 这条路本机复现不了**，只能真机
（仓库里一直记着「未验：真机中国版 Apple 登录」，见 `deploy/china/README.md` §4 第 2 条）。

### 1.9 中国版怎么留证据：本机诊断 `mt:diag`（2026-10-03 加）

中国版按承诺一个字节都不发（规则 4），于是**登录失败在那个 flavor 里原本不留任何痕迹** ——
而境内后端只有那个 flavor 会碰到。折中：**同样的记录，换个落点 —— 留在本机、绝不外发**。

`extension/learn/telemetry.js`：当 `spec() === null`（＝**这个 build 根本没有遥测**）时，
把 `auth_fail` 追加到本机 `localStorage['mt:diag']`（JSON 数组，**上限 20 条**，只记 auth_fail）。

- **判定用 `spec() === null`，不是 `enabled()`** —— 用户自己关掉遥测（有 spec、`tm:on=false`）
  **不写**：那是他的选择，不该被一个本机副本绕过。
- 记录形状与遥测那条相同（`{name, props, ts}`），props 就是 `auth_fail` 的白名单键
  （`provider` / `stage` / `code` / `http` / `attempt`）。没有 install id、没有 URL、没有邮箱。
- **仍然一个字节都不发** —— 回归钉住了：`test/telemetry.test.js` 的 ⑤ / ⑤b / ⑤c。

**怎么读出来**（真机、USB 连着、**解锁**）：

```bash
xcrun devicectl device info files --device <UDID> \
  --domain-type appDataContainer --domain-identifier com.belliedmonkeytranslator.cn
```

拿到 WebKit 的 LocalStorage sqlite 后 copy 出来，`sqlite3` 查 key = `mt:diag`（值是 UTF-16 或 UTF-8，
按 `strings` 兜底也行）。**别用模拟器验这条** —— 中国版模拟器包的 `MT_TELEMETRY` 同样是 `null`，
行为一致，但模拟器碰不到境内后端。

`stage` 读出来怎么分：`native` = 原生那步没给出 id_token；`id_token` = 换会话那个 POST 失败
（`code='offline'` 就是「连不上服务器」那句）。

---

### 1.10 2026-10-04 复查（用户报「连不上服务器又出来了」+「查中国数据库」）

**结论：后端与库都健康；服务端没有可修的东西。真正挖出来的是一条我自己的漏动作（见下）。**

上机读数（§1.2/§1.3 的配方，全部回读）：

| 项 | 读数 |
|---|---|
| 服务 | 七个全 `Up`（`db` healthy；`auth`/`db`/`fn` 11 天，`grant`/`ledger`/`proxy`/`rest` 2 天） |
| 宿主机 | 磁盘 **20%**（7.5G/40G）、内存 686/1967 MB、load 0.13 |
| 数据库 | `pg_isready` accepting；连接 **9 / 100**；库大小 **11 MB**；未授予锁 **0** |
| proxy | 502/503/504 **0 条**（近 24h 只有蜘蛛/扫描器打 IP 的 308） |
| auth | panic/5xx **0 条**；近 6h **零个非 2xx** |
| 7 天非 2xx | 与 §1.4 记录的**完全一致**（23×403 `/user` 内网、12×400 `/token` invalid_grant、2×302 authorize、2×403 verify、2×400 otp、1×403 generate_link）⇒ **没有新增失败** |
| grant / ledger / fn | 日志里 error/fail/panic **0 条** |
| 用户自己 | **Apple 登录 24h 内 3 次全 200**，最后一次 `2026-10-03T19:10:05Z`（= 10-04 03:10 CST） |

⇒ 「连不上服务器」按 §0 是 `code=network|offline`（**请求根本没到**），服务端与遥测都指望不上；
而用户同一条登录路径在同一时段是 200 ⇒ **没有任何服务端侧要修的东西**。下一步只能在设备侧取证据：
中国版的 `mt:diag`（§1.9）。**本次取不到** —— 真机 `00008130-000474622EE0001C`（张大本事）是 `unavailable`，
人机不在一起；`devicectl` 只看到模拟器。

#### 真正修掉的：`bt_model_sources` 里还是两行 piper（我的漏动作）

用户说「查中国数据库」，于是逐个看表 —— 挖出一条**我在 #558 里自己制造的缺口**：

- 中国版 App 从 1.19.0 起请求的是 `kokoro-zh-en.zip`，但库里的 `bt_model_sources` **仍是 `piper-zh.zip` / `piper-en.zip` 两行、且都 `active`**；
- 我改了 `deploy/china/model-sources.sql` 却**从没应用它**（那份文件是给境内后端用的部署脚本，不是快照）；
- 更糟的是那份脚本**只插新行、不停用旧行** ⇒ 它自带的「恰好 1 行 active」回读断言**会直接报错**（`psql rc≠0`）。
  也就是说：照它跑一遍，结果是**失败**，而失败的原因看起来像「数据不对」而不是「脚本没写全」。

修法（已应用并回读）：

```sql
update public.bt_model_sources set active = false, updated_at = now()
 where kind = 'tts' and flavor = 'china' and path in ('piper-zh.zip', 'piper-en.zip');
```

应用结果：`INSERT 0 1` + `UPDATE 2` + 断言 `DO` 通过（`psql rc=0`）；回读 `kokoro-zh-en.zip active=t`、
两条 piper `active=f`。**两个地址都实测可下**：魔搭 206 `bytes 0-0/146767700`、**hf-mirror 备用同样 206 且总长一致**
（备用是 #532 那条「包是首启硬门」的安全网，缺了它国内网络下 ModelScope 不可达就会卡在屏 2）。

**对老版本没有回归**：还在用 piper 的旧中国版构建会请求 piper 两行 ⇒ 表里查不到 ⇒ 回落到**内置地址**
（`device-models.config.js` 里的魔搭 piper URL，实测 206）⇒ 照旧能下。

#### 记账（别把这两条当成产品错误）

- 本次查库时我在 `db` 日志里留下了 2 条：`FATAL: role "root" does not exist` 与
  `ERROR: syntax error at or near "\"`（时间 `19:10:29Z`）—— **是我自己第一次 psql 的引号写坏**，
  不是应用行为。查日志看到它们时以时间戳排除。
- 一条口径：`docker compose exec -T db psql` **不给 `-U`** 会以 host 用户连（`root`）；
  给 `-U postgres` 才对。远端脚本里别套单引号（§1.2 坑 4），SQL 的引号用**双引号**。

## 2. 读「用户给的截图」：**同比例 ≠ 整屏**

2026-10-03：用户报「设置页底部卡片的按钮被卡片下沿切掉」。截图 886×1920 —— 与 iPhone 14 Pro
屏幕 1179×2556 **同比例**。我据此判「这是整屏截图 ⇒ 按钮是被屏幕下沿切的 ⇒ 页面滚不到底」，
并且把「卡片被 flex 压扁」当成根因查了半天。**两条都错**：用户随后确认，那个位置**还能往下拖、
按钮能完整出来** —— 截图是**裁的**。

**同比例不是「整屏」的证据**：裁剪只要按原比例切，比例就一模一样。
像素比例是**最弱的**那条线索。真判据是**内容**：

- 屏上有没有状态栏 / Home 指示条（有 ⇒ 至少顶/底是原生的）；
- 页面**可见地**滚到了尽头吗（到底时会有橡皮筋回弹 / 内容停住）；
- 让**用户**说一句「还能不能往下拖」—— 一句话的成本，比在 Mac 上量半天便宜得多。

**方法论那一句**（与 `deploy/china/README.md` §6 记的是同一条）：**两个解释都能装下同一批观测时，
别只验证自己先想到的那个。** 这次我连续两次只验证了先想到的那个。

---

## 3. 在 App 里找元素：**「AX 文本里没有」不等于「页面里没有」**

2026-10-03 追 `#g-systrans` 那张卡，我被这一条**骗了五轮构建**。症状：探针用
`visibleText().contains("…")` 判断元素在不在，一直 `false`，我据此写下「那张卡没渲染」——
**是错的**。

**铁证在同一份快照里**：它**有** webext 卡的按钮「在网页上完成设置」，却**没有那张卡自己的标题**
「先把浏览器那半边打通」——标题就在那个按钮**上方三行**。⇒ 这页 DOM 上千个节点（播种账号里
来源管理有几十行、213 张卡），`XCUITest` 的 AX 快照**会缺项**，而且是**静默**缺。

**判据（照做）**：

- 「AX 文本里没有」**只能**用来怀疑，**不能**用来断定「元素不存在」；
- 要确认某元素在不在，**用能看见的兄弟元素做锚点**：滚到它 `isHittable`，**截图看**；
- 文本搜索只用于「**同一份快照里刚刚成功匹配过**的那段文字」（例如用它找锚点），
  不能拿一个从没验证过会被暴露的键当判据。

**另一条同型**：**固定步长的滚动取样会跳过内容**。我按视口 42% 一拖、靠文本判断，
连拖 14 次都没落在那张卡上。改用「锚点 + 截图」一次就中。取样要**锚定内容**，不要锚定步数。

**为什么这一页特别容易踩**：设置页的 DOM 会随账号长出来（来源管理、卡片数），
**在 A 账号上量得到的东西，在 B 账号上可能根本不在快照里** —— 别用「我这台量不到」推「它不存在」。

---

## 4. 不要做的事

- **不要为了查问题去开中国版遥测。** 它要改的是一条**写死的承诺**（`AGENTS.md` 规则 4 + 官网隐私页，
  且隐私页必须与功能同版本发），成本远高于问题本身；而 §0 说了，它对网络类失败**根本抓不到**。
- **不要动 `previousUrl`。** 合规门（`build/china-gate.js`）为它开了豁免，它是归属比较用的，删了会让
  老用户的库挂到一个登不上的身份下（`docs/learning-design.md` §8.4.3）。
- **不要把 `172.18.x.x` 当用户。** 见 §1.3。
