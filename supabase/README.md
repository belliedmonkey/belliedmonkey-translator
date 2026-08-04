# 同步后端

学习层的**可选**同步后端。不登录的用户完全用不到这里的任何东西——
见 [`../docs/learning-design.md`](../docs/learning-design.md) §8。

搬到一个新项目需要三步，没有第四步：

```bash
psql "$DATABASE_URL" -f supabase/schema.sql        # 1. 库结构、RLS、配额
supabase functions deploy bt-delete-account        # 2. 一键删除的后半截（§8.7）
```

3. 在 Authentication → Email Templates 里把模板改成渲染 **`{{ .Token }}`**。
   默认模板发的是**魔法链接**，而链接在浏览器扩展里无法完成——接跳转需要一个
   我们托管的页面，我们不托管任何东西。这一步没有 SQL 可以代劳，漏掉的表现是
   「验证码收到了，但邮件里只有一个点不动的链接」。

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
