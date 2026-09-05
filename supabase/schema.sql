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
