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

---

## 2. 不要做的事

- **不要为了查问题去开中国版遥测。** 它要改的是一条**写死的承诺**（`AGENTS.md` 规则 4 + 官网隐私页，
  且隐私页必须与功能同版本发），成本远高于问题本身；而 §0 说了，它对网络类失败**根本抓不到**。
- **不要动 `previousUrl`。** 合规门（`build/china-gate.js`）为它开了豁免，它是归属比较用的，删了会让
  老用户的库挂到一个登不上的身份下（`docs/learning-design.md` §8.4.3）。
- **不要把 `172.18.x.x` 当用户。** 见 §1.3。
