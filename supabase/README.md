# 同步后端

学习层的**可选**同步后端。不登录的用户完全用不到这里的任何东西——
见 [`../docs/learning-design.md`](../docs/learning-design.md) §8。

搬到一个新项目需要三步，没有第四步：

```bash
psql "$DATABASE_URL" -f supabase/schema.sql        # 1. 库结构、RLS、配额
supabase functions deploy bt-delete-account        # 2. 一键删除的后半截（§8.7）
```

3. 邮件模板与验证码长度（**没有 SQL 能代劳**，走 Management API）：

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)   # macOS Keychain
curl -X PATCH "https://api.supabase.com/v1/projects/<REF>/config/auth" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'User-Agent: SupabaseCLI/1.100.1' \
  -d '{"mailer_otp_length":6,
       "mailer_templates_confirmation_content":"…{{ .Token }}…",
       "mailer_templates_magic_link_content":"…{{ .Token }}…"}'
```

   三个坑，每一个都是实测踩出来的：

   - **必须两个模板都改。** GoTrue 按「这个邮箱是不是新的」选模板：新邮箱走
     confirmation，老邮箱走 magic link。只改一个，等于一半用户收到一个在扩展里
     点不动的链接——而且看起来像扩展的 bug，不像邮件模板的问题。
   - **`mailer_otp_length` 默认是 8，不是 6。** UI 文案「6 位验证码」已经翻成 11
     种语言，所以改配置（一处）比改文案（十一处）便宜。
   - **Management API 会按 User-Agent 挡人**：不带 UA 会收到 `403 error code 1010`
     （Cloudflare），看着像权限不足，其实不是。

然后把 `extension/learn/backend.config.js` 的 `url` / `anonKey` 改成新项目的。
那个文件就是全部的「用哪个后端」——刻意只有一处。

## 验证不变量

三条**承载性**保证（RLS 隔离、只追加、配额）不该靠读代码确认。下面这段用
PostgREST 相同的机制模拟两个登录用户，跑完用异常回滚，一个字节都不留：

见 git 历史中 commit `1364ccf` 的验证脚本；结果必须是

```
改写影响 0 行 · 超配额被拒 sqlstate=53100 · B 能看到 A 的 0 行
```

其中「改写影响 0 行」靠的是 `schema.sql` 里**不存在** UPDATE 策略。
加一条 UPDATE 策略会静默地删掉这个保证——这是这个库里最容易被无声破坏的东西。


## 发布闸门：自建 SMTP（**没配之前登录不能给真人用**）

新项目当前 `smtp_host = None`，用的是 Supabase 内建邮件服务，而

```
rate_limit_email_sent = 2      # 每小时 2 封，整个项目共享，不是每用户
```

内建服务是给开发测试用的，Supabase 不保证投递。**照这个配置，一小时内第三个想登录
的用户就收不到验证码**——而他看到的症状是「填了邮箱，什么也没来」，看起来像扩展坏了，
不像邮件配额用光了。这类故障最贵的地方在于：它只在有人用的时候才出现，而那时你已经
发版了。

上线前必须：

1. 接一个真实的邮件服务（Resend / SES / Postmark 之类；Resend 免费额度对这个量级
   够用，符合「能免费尽量免费」）。
2. 在 belliedmonkey.com 上配 SPF / DKIM，否则验证码会进垃圾箱——**那和收不到在用户
   眼里是一回事**。
3. 配好之后再调 `rate_limit_email_sent`。在内建服务下调高它没有意义。

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<REF>/config/auth" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'User-Agent: SupabaseCLI/1.100.1' \
  -d '{"smtp_host":"…","smtp_port":587,"smtp_user":"…","smtp_pass":"…",
       "smtp_admin_email":"noreply@belliedmonkey.com","smtp_sender_name":"大肚猴翻译",
       "rate_limit_email_sent":30}'
```
