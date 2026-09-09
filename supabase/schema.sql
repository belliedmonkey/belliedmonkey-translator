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
-- 任何能连到 auth.users 的列 —— 这是设计上的承诺，不是暂时没加。
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
  'BelliedMonkey Translator 匿名用量事件。无账号关联；180 天后删；见 docs/telemetry-design.md。';

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
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('bt_events_rollup', 'bt_events_retention');
select cron.schedule('bt_events_rollup',    '17 3 * * *', $$select public.bt_rollup_day((now() - interval '1 day')::date)$$);
select cron.schedule('bt_events_retention', '27 3 * * *', $$delete from public.bt_events where received_at < now() - interval '180 days'$$);

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
create or replace function public.bt_grant_charge(
  p_hash text, p_kind text, p_model text, p_cost numeric, p_ms int)
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

  insert into public.bt_grant_usage (user_id, kind, model, cost_usd, ms)
  values (uid, p_kind, p_model, greatest(p_cost, 0), greatest(p_ms, 0));

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
revoke all on function public.bt_grant_charge(text, text, text, numeric, int) from public, anon, authenticated;
revoke all on function public.bt_grant_stats() from public, anon, authenticated;

-- 流水 90 天保留（额度本身与账号同寿，删号 cascade 带走）。
select cron.unschedule(jobid) from cron.job where jobname = 'bt_grant_usage_retention';
select cron.schedule('bt_grant_usage_retention', '37 3 * * *',
  $$delete from public.bt_grant_usage where at < now() - interval '90 days'$$);
