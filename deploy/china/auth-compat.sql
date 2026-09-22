-- deploy/china/auth-compat.sql — 让 supabase/schema.sql 在**自建** GoTrue + PostgREST 上原样跑通。
--
-- 这个文件存在的全部理由：`supabase/schema.sql` 用了 `auth.uid()`，而
-- **`auth.uid()` 不是 GoTrue 的东西，是 Supabase 平台预置的**。自建时
-- `auth` schema 和 `auth.users` 表由 GoTrue 自己的 migrations 建出来，
-- 但那两个函数没有 —— 不补上，`schema.sql` 的每一条 RLS policy 都会在
-- 创建时直接报 `function auth.uid() does not exist`。
--
-- 跑的顺序是硬的（README 第 3 步）：
--   1. GoTrue 先起一次，让它跑完自己的 migrations（建 auth schema + auth.users）
--   2. 这个文件
--   3. supabase/schema.sql（原样，一个字节不改）
--
-- 反过来跑会失败，且失败信息指向的是症状不是原因。

-- ── 扩展 ─────────────────────────────────────────────────────────────────
-- pgcrypto：GoTrue 存密码哈希要用。uuid-ossp：`auth.users.id` 的默认值要用。
-- 托管数据库上这两条常常因为权限跑不通 —— 那正是 §11 记的第二个风险，
-- 而自建时我们是超级用户，不是问题。
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ── PostgREST 的三个角色 ────────────────────────────────────────────────
--
-- `authenticator` 是 PostgREST 自己连库用的角色，它**几乎没有权限**，
-- 靠 SET ROLE 切到下面两个之一 —— 这是 PostgREST 的安全模型，不是可选的。
--
--   anon          —— 没带 JWT 的请求。我们的表全在 RLS 后面，所以它读写不到任何东西。
--   authenticated —— 带了有效 JWT 的请求。RLS policy 全部 `to authenticated`。
--   service_role  —— 绕过 RLS。只有 bt-delete-account 那个小服务用，**绝不下发给客户端**。
--
-- ⚠️ `NOLOGIN` 不能省：anon / authenticated 是被 SET ROLE 切进去的，不是拿来登录的。
--    给了 LOGIN 就等于开了一个能直连数据库的口子。
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    -- 密码由 .env 注入，不写在这里：它是**会话参数**，用 PGOPTIONS="-c mt.authenticator_password=…" 传，
    -- 不是 psql -v 变量（psql 变量名不许带点，2026-09-22 照原 README 跑时当场报 invalid variable name）。
    -- 没传进来时 current_setting(…, true) 是 NULL ⇒ 会**静默**建出一个没有密码的登录角色 —— 拦下。
    if coalesce(current_setting('mt.authenticator_password', true), '') = '' then
      raise exception 'mt.authenticator_password 没有传进来：用 PGOPTIONS="-c mt.authenticator_password=…" 调 psql';
    end if;
    execute format('create role authenticator login noinherit password %L',
                   current_setting('mt.authenticator_password', true));
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

-- ── 表权限：Supabase 平台预置的那一层（2026-09-22 首次实跑时缺，同步全部 42501）───────
--
-- Supabase 给 anon / authenticated / service_role 预置了 public 下所有表的权限，**真正的门是 RLS**。
-- supabase/schema.sql 依赖这个前提、自己不写 grant —— 于是自建库里登录成功、push / pull 一律
-- `permission denied for table bt_chunks`。这里补出同样的一层，唯一的有意不同：**不给 TRUNCATE**
-- （它不受 RLS 约束；Supabase 给了，接口不暴露，但没有理由在新库里再发一遍）。
-- 默认权限对之后才建的表生效（schema.sql 在本文件之后跑）；下面那句 grant 覆盖已经存在的表。
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- ── auth.uid() / auth.role() ────────────────────────────────────────────
--
-- PostgREST 把 JWT 的 claims 放进 `request.jwt.claims`（v9+ 是整个 JSON）。
-- 老版本走 `request.jwt.claim.sub` 这种一个 claim 一个 setting 的形状。
-- **两种都认**，与 Supabase 自己的实现同形 —— 换 PostgREST 大版本时不会突然全挂。
--
-- `stable` 而不是 `volatile`：查询计划里会被调用很多次（每行 RLS 都要），
-- volatile 会让规划器不敢缓存，代价是白白多跑几千次。
--
-- 第二个参数 `true` 是 `missing_ok` —— 没有 JWT 时返回 NULL 而不是抛错。
-- 这很重要：匿名请求必须**读不到东西**，而不是**报 500**。
create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- `bt_chunks.user_id` 有一条 `references auth.users(id) on delete cascade`（schema.sql:26）。
-- 外键要求引用方能 REFERENCES 被引用表 —— 不给这个权限，建表那一步会失败。
grant references on table auth.users to authenticated;

-- ── 回读判据 ─────────────────────────────────────────────────────────────
-- 跑完这个文件后应当为真。不要用「没报错」当成功 —— 上面全是 `if not exists`
-- 与 `create or replace`，跑在一个空库上同样不报错。
do $$
begin
  assert (select count(*) from pg_roles
          where rolname in ('anon','authenticated','service_role','authenticator')) = 4,
         '四个角色没齐';
  assert to_regprocedure('auth.uid()') is not null, 'auth.uid() 没建出来';
  assert to_regprocedure('auth.role()') is not null, 'auth.role() 没建出来';
  assert to_regclass('auth.users') is not null,
         'auth.users 不存在 —— GoTrue 的 migrations 还没跑过，顺序错了（见文件头）';
  raise notice 'auth-compat: OK（4 角色 · auth.uid/role · auth.users 都在）';
end
$$;
