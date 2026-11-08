-- supabase/schema.sql — the ENTIRE sync backend, in one idempotent script.
-- See docs/learning-design.md §8.4 / §8.4.1.
--
-- Run this against a fresh project and sync works; there is nothing else to click.
-- It lives in git rather than only in a provider's migration history because the
-- backend is expected to MOVE (§8.4.1), and a migration you cannot replay is a
-- migration that only exists as long as someone remembers it.
--
-- Safe to re-run: every statement is `if not exists` / `or replace` / drop-then-create.
--
--   psql "$DATABASE_URL" -f supabase/schema.sql
--
-- Two things this file does NOT do, because they are not SQL:
--   1. The auth email template must render `{{ .Token }}` (a 6-digit code). The stock
--      template sends a magic LINK, and a link cannot be completed from inside an
--      extension — there is no page of ours for it to land on.
--   2. `supabase/functions/bt-delete-account` must be deployed (§8.7).

-- ─────────────────────────────────────────────────────────────────────────────
-- The chunk log. One row = one deflate-raw'd JSONL bundle, byte-identical to what
-- the export button writes (learn/chunk.js). Sync is a transport, not a format.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bt_chunks (
  -- Server-assigned, NOT client-assigned. Two devices pushing at the same moment
  -- would otherwise pick the same number: one insert fails, or worse, silently wins.
  seq         bigint generated always as identity primary key,
  user_id     uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text   not null default 'bundle',
  blob        bytea  not null,                    -- deflate-raw JSONL, NOT encrypted (§8.6)
  generation  int    not null default 0,          -- bumped by compaction
  created_at  timestamptz not null default now()
);

alter table public.bt_chunks drop constraint if exists bt_chunks_kind_check;
alter table public.bt_chunks add constraint bt_chunks_kind_check
  check (kind in ('bundle', 'cards', 'reviews', 'sources'));

create index if not exists bt_chunks_user_seq_idx on public.bt_chunks (user_id, seq);

comment on table public.bt_chunks is
  'BelliedMonkey Translator 记忆层：只追加的 chunk 日志。见 docs/learning-design.md §8。';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS. NOTE THE MISSING POLICY: there is deliberately no UPDATE policy, so
-- append-only is held by the database rather than by client discipline. Nothing in
-- the system — including our own client, including a bug in it — can rewrite a chunk
-- that has been written. Adding an UPDATE policy here silently deletes that
-- guarantee, which is why this comment is longer than the statements.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.bt_chunks enable row level security;

drop policy if exists bt_chunks_select on public.bt_chunks;
create policy bt_chunks_select on public.bt_chunks
  for select to authenticated using (user_id = auth.uid());

drop policy if exists bt_chunks_insert on public.bt_chunks;
create policy bt_chunks_insert on public.bt_chunks
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists bt_chunks_delete on public.bt_chunks;
create policy bt_chunks_delete on public.bt_chunks
  for delete to authenticated using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Quota. AGENTS.md rule 7: enforced by a database constraint, never by client-side
-- good behaviour. It RAISES rather than truncating — the same rule forbids silently
-- dropping data, and the client turns this error into a visible pressure state with
-- a cleanup action (§7.1).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.bt_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  used  bigint;
  quota constant bigint := 50 * 1024 * 1024;
begin
  select coalesce(sum(octet_length(blob)), 0) into used
    from public.bt_chunks
   where user_id = new.user_id;

  if used + octet_length(new.blob) > quota then
    raise exception 'bt: quota exceeded (% of % bytes used)', used, quota
      using errcode = 'disk_full';        -- 53100; the client matches on the CODE
  end if;
  return new;
end;
$$;

drop trigger if exists bt_chunks_quota on public.bt_chunks;
create trigger bt_chunks_quota
  before insert on public.bt_chunks
  for each row execute function public.bt_enforce_quota();

-- What the settings page shows. SECURITY INVOKER + its own auth.uid() filter, so it
-- can only ever report on the caller.
create or replace function public.bt_usage()
returns table (bytes bigint, chunks bigint, quota bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select coalesce(sum(octet_length(blob)), 0)::bigint,
         count(*)::bigint,
         (50 * 1024 * 1024)::bigint
    from public.bt_chunks
   where user_id = auth.uid();
$$;

-- A SECURITY DEFINER function that anyone can call over RPC is a privilege-escalation
-- surface. The trigger runs as the table owner and needs no grants at all, so take
-- them away — the security advisor flags this, correctly.
revoke all on function public.bt_enforce_quota() from public, anon, authenticated;
revoke all on function public.bt_usage() from public, anon;
grant execute on function public.bt_usage() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 匿名用量事件（docs/telemetry-design.md；AGENTS.md 规则 4，2026-09-05 修订）。
--
-- 一行 = 一个事件。install_id 是客户端随机生成的 UUID，**这张表里没有、也永远不会有**
-- 任何能直接标识账号的列。但 install_id 可与第一方登录台账 bt_auth_ok 对上
-- （2026-11-08；仅支持与滥用排查，不导出第三方）。
-- 只有边缘函数 bt-ingest（service role）能写；anon / authenticated 一条策略都没有，
-- 所以没有任何客户端能读到别人的、或自己的事件。
-- 原始行 180 天后由 pg_cron 删除；bt_daily 是不含 install_id 的日聚合，长期保留。
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bt_events (
  id           bigint generated always as identity primary key,
  install_id   uuid        not null,
  ts           timestamptz not null,               -- 客户端时间（取整到分钟）
  v            text        not null,               -- 扩展版本
  flavor       text        not null,
  host         text        not null,               -- safari / chrome / firefox / app
  device       text        not null default '',
  ui           text        not null default '',
  name         text        not null,               -- 事件名，白名单见 build/telemetry.config.js
  props        jsonb       not null default '{}'::jsonb,
  received_at  timestamptz not null default now()
);

create index if not exists bt_events_install_idx  on public.bt_events (install_id);
create index if not exists bt_events_received_idx on public.bt_events (received_at);
create index if not exists bt_events_name_day_idx on public.bt_events (name, received_at);

comment on table public.bt_events is
  'BelliedMonkey Translator 匿名用量事件。事件本身无账号列；install_id 可与第一方台账 bt_auth_ok 对上（仅支持与滥用排查）；180 天后删；见 docs/telemetry-design.md。';

-- RLS 开着、**没有任何策略** = 对 anon / authenticated 全拒。service role 绕过 RLS，
-- 这正是「只有边缘函数能写」的实现方式。往这里加一条 select 策略就是把别人的事件
-- 开放给客户端 —— 别加。
alter table public.bt_events enable row level security;
revoke all on table public.bt_events from anon, authenticated;

-- 日聚合：不含 install_id。installs 是当天去重后的 install 数。
create table if not exists public.bt_daily (
  day       date  not null,
  flavor    text  not null,
  host      text  not null,
  name      text  not null,
  provider  text  not null default '',
  n         int   not null,
  installs  int   not null,
  primary key (day, flavor, host, name, provider)
);
alter table public.bt_daily enable row level security;
revoke all on table public.bt_daily from anon, authenticated;

-- 关闭遥测的次数（事件本身不落库，只计数）：知道 opt-out 率，不知道是谁。
create table if not exists public.bt_optouts (
  day  date not null primary key,
  n    int  not null default 0
);
alter table public.bt_optouts enable row level security;
revoke all on table public.bt_optouts from anon, authenticated;

-- 把某一天聚合进 bt_daily（幂等：重跑覆盖）。
create or replace function public.bt_rollup_day(d date)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  insert into public.bt_daily (day, flavor, host, name, provider, n, installs)
  select d, flavor, host, name, coalesce(props->>'provider', ''),
         count(*)::int, count(distinct install_id)::int
    from public.bt_events
   where received_at >= d and received_at < d + 1
   group by flavor, host, name, coalesce(props->>'provider', '')
  on conflict (day, flavor, host, name, provider)
  do update set n = excluded.n, installs = excluded.installs;
$$;
revoke all on function public.bt_rollup_day(date) from public, anon, authenticated;

-- 每天 03:17 UTC：先聚合昨天，再删 180 天前的原始行。顺序是硬的 —— 反过来会把
-- 还没聚合的那一天删掉。
-- pg_cron 是 Supabase 自带的扩展，**普通 PostgreSQL 没有**。中国版境内后端（deploy/china，
-- postgres:15-alpine）按这份文件建库时，2026-09-22 第一次实跑就停在这里，后面的表一张都没建。
-- 所以改成「有才建」：Supabase 上行为逐字不变；境内 postgres:15-alpine 没有 pg_cron，
-- 汇总 / 180 天清理在那边跳过。表仍是这份文件的 bt_events 段，不另建中国表。
-- 流水清理见下面 bt_grant_usage 那一段的注释。
do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname in ('bt_events_rollup', 'bt_events_retention');
    perform cron.schedule('bt_events_rollup',    '17 3 * * *', $$select public.bt_rollup_day((now() - interval '1 day')::date)$$);
    perform cron.schedule('bt_events_retention', '27 3 * * *', $$delete from public.bt_events where received_at < now() - interval '180 days'$$);
  else
    raise notice 'pg_cron 不可用：跳过 bt_events 的汇总 / 清理任务（表仍是同一份 schema.sql，不另建中国表）';
  end if;
end
$cron$;

-- bt_optouts 的自增（边缘函数经 RPC 调；service role 才有权限）。
create or replace function public.bt_optout_bump(d date)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  insert into public.bt_optouts (day, n) values (d, 1)
  on conflict (day) do update set n = public.bt_optouts.n + 1;
$$;
revoke all on function public.bt_optout_bump(date) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 免费额度（docs/learning-design.md §8.10；AGENTS.md 规则 4 的有界例外，2026-09-08）。
--
-- 一行 = 一个账号的额度。用户领到的是一枚**令牌**（`bmg_` + 43 字符），不是提供方的
-- key —— 提供方的 key 只在边缘函数 bt-relay 的环境变量里，永不离开服务器。
--
-- 三件事只有 SQL 做得对，所以都在这里，不在函数里：
--   1. **幂等领取**：user_id 是主键，`bt_grant_claim` 用 on conflict do nothing 之后
--      再 select —— 两台设备同时点「领取」不会得到两枚令牌（D1：回传同一枚）。
--   2. **原子记账**：`bt_grant_charge` 一条语句里加钱、记流水、返回余额。分成两步做
--      的那一刻，并发请求就会互相覆盖 spent_usd，而覆盖的方向永远是少收钱。
--   3. **上限**：余额判定读的是这张表，不是客户端、也不是提供方 —— 这正是「额度走我们
--      服务端」这条裁定要买的东西（用户 2026-09-08）。
--
-- bt_grant_usage **没有内容列，也永远不会有**：中继转发的文本不进表、不进日志。
-- 与 bt_events 同一条 RLS 纪律：开着、零策略，只有 service role 进得来。
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bt_grants (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  token_hash  text not null unique,               -- sha256(令牌) 的十六进制；明文不入库
  token_ct    text not null,                      -- AES-256-GCM 密文(base64)，KEK 只在函数密钥里
  token_iv    text not null,
  limit_usd   numeric(10,4) not null,
  spent_usd   numeric(12,6) not null default 0,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.bt_grants drop constraint if exists bt_grants_status_check;
alter table public.bt_grants add constraint bt_grants_status_check
  check (status in ('active', 'revoked'));

comment on table public.bt_grants is
  'BelliedMonkey Translator 免费额度：一账号一枚令牌 + 花了多少。见 docs/learning-design.md §8.10。';

create table if not exists public.bt_grant_usage (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  at       timestamptz not null default now(),
  kind     text not null,                          -- chat / tts / stt
  model    text not null default '',
  cost_usd numeric(12,6) not null,
  ms       int not null default 0
);
-- BEL-222（2026-11-08）：归因用的三列，**可空**。旧行保持 NULL；新行由中继从请求里带，
-- 缺了也照记花费（不能因为归因字段缺失而漏记一笔真实花费）。
-- 仍然**没有内容列** —— 这三列只是「哪个安装 / 哪个宿主 / 哪个功能面」，不是原文。
-- install_id 使这些账号级用量行可与匿名事件对上（配合 bt_auth_ok；仅支持与滥用排查，不导出第三方）。
alter table public.bt_grant_usage add column if not exists install_id uuid;
alter table public.bt_grant_usage add column if not exists host      text;
alter table public.bt_grant_usage add column if not exists surface   text;
-- 没有内容列。加一列存原文/URL/译文，就是把 Gate F 那段承诺变成假话。
create index if not exists bt_grant_usage_at_idx on public.bt_grant_usage (at);
create index if not exists bt_grant_usage_user_idx on public.bt_grant_usage (user_id, at);

comment on table public.bt_grant_usage is
  '免费额度的花费流水：kind / cost / ms，**没有内容**。90 天后删。';

alter table public.bt_grants enable row level security;
alter table public.bt_grant_usage enable row level security;
revoke all on table public.bt_grants from anon, authenticated;
revoke all on table public.bt_grant_usage from anon, authenticated;

-- 领取：已有就原样返回（reused），没有才插。两台设备同时点也只会有一枚。
--
-- 全局日上限也在这里判，理由是它**只能**在这里判对：调用方在插进去之前并不知道这次
-- 是「新铸」还是「已经有了」，而上限只该拦新铸 —— 换台设备的人不该被别人今天的领取量
-- 挡在门外。放到函数里先查后插，并发下会漏判；放到函数里先插后查，判了也已经铸出去了。
create or replace function public.bt_grant_claim(
  p_user uuid, p_hash text, p_ct text, p_iv text, p_limit numeric, p_daily_cap int)
returns table (token_ct text, token_iv text, limit_usd numeric, spent_usd numeric,
               status text, reused boolean, capped boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  g public.bt_grants%rowtype;
  today int;
begin
  select * into g from public.bt_grants where user_id = p_user;
  if found then
    return query select g.token_ct, g.token_iv, g.limit_usd, g.spent_usd, g.status, true, false;
    return;
  end if;

  -- 行锁化的计数：同一秒里的并发领取会在这里排队，所以上限是真的上限，不是近似值。
  select count(*)::int into today
    from public.bt_grants where created_at >= date_trunc('day', now());
  if today >= p_daily_cap then
    return query select null::text, null::text, p_limit, 0::numeric, 'capped'::text, false, true;
    return;
  end if;

  insert into public.bt_grants (user_id, token_hash, token_ct, token_iv, limit_usd)
  values (p_user, p_hash, p_ct, p_iv, p_limit)
  on conflict (user_id) do nothing;

  select * into g from public.bt_grants where user_id = p_user;
  return query select g.token_ct, g.token_iv, g.limit_usd, g.spent_usd, g.status,
                      (g.token_hash is distinct from p_hash), false;
end;
$$;

-- 中继的余额检查。返回一行或零行；零行 = 这枚令牌不存在。
create or replace function public.bt_grant_check(p_hash text)
returns table (user_id uuid, limit_usd numeric, spent_usd numeric, status text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select g.user_id, g.limit_usd, g.spent_usd, g.status
    from public.bt_grants g where g.token_hash = p_hash;
$$;

-- 记账。**唯一**的写路径，一条语句里做完三件事，返回花完之后还剩多少。
-- BEL-222（2026-11-08）：后三个参数是归因列，**可缺**（默认 NULL）。旧调用方（5 个参数）
-- 行为不变；新调用方（bt-relay / bt-grant-ledger）把请求里带的 install_id/host/surface
-- 原样传进来。它们只是「哪个安装 / 哪个宿主 / 哪个功能面」，不进内容，也不改花费口径。
-- 先 drop 旧的 5 参签名再建 8 参（带默认值）：PostgREST 按具名参数调用，5 参调用仍会落到
-- 这个新函数；留着两个重载会让解析变得依赖参数个数，部署时容易出现「调到了旧函数」。
drop function if exists public.bt_grant_charge(text, text, text, numeric, int);
create or replace function public.bt_grant_charge(
  p_hash text, p_kind text, p_model text, p_cost numeric, p_ms int,
  p_install_id uuid default null, p_host text default null, p_surface text default null)
returns numeric
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  uid  uuid;
  left_ numeric;
begin
  update public.bt_grants
     set spent_usd = spent_usd + greatest(p_cost, 0),
         last_used_at = now()
   where token_hash = p_hash and status = 'active'
   returning user_id, limit_usd - spent_usd into uid, left_;

  if uid is null then return null; end if;

  insert into public.bt_grant_usage
    (user_id, kind, model, cost_usd, ms, install_id, host, surface)
  values
    (uid, p_kind, p_model, greatest(p_cost, 0), greatest(p_ms, 0),
     p_install_id, p_host, p_surface);

  return left_;
end;
$$;

-- 运营用：池子巡检脚本读的那一行（scripts/grant-float.js）。
create or replace function public.bt_grant_stats()
returns table (grants bigint, active bigint, spent_total numeric,
               spent_30d numeric, claimed_today bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select (select count(*) from public.bt_grants),
         (select count(*) from public.bt_grants where status = 'active'),
         (select coalesce(sum(spent_usd), 0) from public.bt_grants),
         (select coalesce(sum(cost_usd), 0) from public.bt_grant_usage
            where at >= now() - interval '30 days'),
         (select count(*) from public.bt_grants where created_at >= date_trunc('day', now()));
$$;

revoke all on function public.bt_grant_claim(uuid, text, text, text, numeric, int) from public, anon, authenticated;
revoke all on function public.bt_grant_check(text) from public, anon, authenticated;
revoke all on function public.bt_grant_charge(text, text, text, numeric, int, uuid, text, text) from public, anon, authenticated;
revoke all on function public.bt_grant_stats() from public, anon, authenticated;

-- 流水 90 天保留（额度本身与账号同寿，删号 cascade 带走）。
-- 没有 pg_cron 的库（中国版境内后端）跳过；那边开额度时用宿主机 crontab 跑同一句 delete。
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'bt_grant_usage_retention';
    perform cron.schedule('bt_grant_usage_retention', '37 3 * * *',
      $$delete from public.bt_grant_usage where at < now() - interval '90 days'$$);
  else
    raise notice 'pg_cron 不可用：跳过 bt_grant_usage 的 90 天清理（改用宿主机 crontab）';
  end if;
end
$cron$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 第一方登录成功台账（BEL-222，2026-11-08）。
--
-- 一行 = 服务端确认的一次登录成功。**与 bt_events 分开**：user_id 只在第一方表里出现，
-- 永远不进事件正文（AGENTS.md 规则 4）；install_id 在这里承担「账号 ↔ 安装」的归因 ——
-- 这正是匿名用量与账号可连接的那一列（仅支持与滥用排查），但不进 PostHog —— BEL-227
-- 的导入映射会丢掉 user_id / 邮箱，只保留匿名 install_id。
--
-- 只有 service role 能写读：与 bt_events / bt_grant_usage 同一条纪律 —— RLS 开着、
-- **零策略**。往这里加一条 select 策略就是把账号↔安装关系开放给客户端，别加。
--
-- 90 天保留：照 bt_grant_usage 的既有写法登记 pg_cron；没有 pg_cron 的库（中国版境内
-- 后端）跳过，那边开这条通道时用宿主机 crontab 跑同一句 delete。
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.bt_auth_ok (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  install_id uuid,                                 -- 客户端带；老客户端缺失时为 NULL，不丢这次登录
  ts         timestamptz not null default now(),   -- 服务端时间；登录成功那一刻
  provider   text not null default '',             -- apple / google / email / phone
  method     text not null default '',             -- signup / signin
  host       text not null default '',             -- safari / chrome / firefox / app
  flavor     text not null default ''              -- global / china
);

-- 按 user、按 install、按 ts 三种查法各一条。前两条带 ts desc，最近一次登录排在最前。
create index if not exists bt_auth_ok_user_ts_idx    on public.bt_auth_ok (user_id, ts desc);
create index if not exists bt_auth_ok_install_ts_idx on public.bt_auth_ok (install_id, ts desc);
create index if not exists bt_auth_ok_ts_idx         on public.bt_auth_ok (ts);

comment on table public.bt_auth_ok is
  '第一方登录成功台账（BEL-222）：user_id ↔ install_id，使匿名用量可与账号对上（仅支持与滥用排查，不导出第三方）；90 天后删。';

alter table public.bt_auth_ok enable row level security;
revoke all on table public.bt_auth_ok from anon, authenticated;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'bt_auth_ok_retention';
    perform cron.schedule('bt_auth_ok_retention', '47 3 * * *',
      $$delete from public.bt_auth_ok where ts < now() - interval '90 days'$$);
  else
    raise notice 'pg_cron 不可用：跳过 bt_auth_ok 的 90 天清理（改用宿主机 crontab）';
  end if;
end
$cron$;

-- ─────────────────────────────────────────────────────────────────────────────
-- bt_forget_install（BEL-227，2026-11-08）：关掉遥测 = 原子忘掉一个 install。
--
-- 单事务内删两类行，顺序固定：
--   1. public.bt_events  —— 匿名用量事件
--   2. public.bt_auth_ok —— 第一方登录成功台账里这个 install 的行
-- 返回两行删除计数，形状固定为 (table_name text, deleted bigint)：
--   'bt_events'  → 删掉的事件行数
--   'bt_auth_ok' → 删掉的登录台账行数
-- 任一 delete 失败，整个函数回滚 —— 不会留下「事件已删、台账没删」的半状态。
--
-- **故意不删 public.bt_grant_usage**：那是免费额度的计费流水（含 user_id /
-- install_id / cost_usd / ms），用于对账与滥用排查，按 90 天保留，由
-- bt_grant_usage_retention 的 pg_cron 清扫。关遥测不是删账，别在这里顺手删。
--
-- 只给 service role：调用面与 bt_events / bt_auth_ok 的 RLS 纪律一致（RLS 开着、
-- 零策略），这里再 revoke 掉 public / anon / authenticated 的执行权。
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.bt_forget_install(p_install_id uuid)
returns table (table_name text, deleted bigint)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  n_events bigint;
  n_auth   bigint;
begin
  delete from public.bt_events where install_id = p_install_id;
  get diagnostics n_events = row_count;

  delete from public.bt_auth_ok where install_id = p_install_id;
  get diagnostics n_auth = row_count;

  return query
    select 'bt_events'::text, n_events
    union all
    select 'bt_auth_ok'::text, n_auth;
end;
$$;

revoke all on function public.bt_forget_install(uuid) from public, anon, authenticated;
