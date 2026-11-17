-- BEL-293 定稿（2026-11-17）：bt_events_rejected —— ingest 拒收/部分拒收聚合。
-- **等架构 GO 再执行；本拍只提交，不执行 DDL。**
--
-- 只允许四个字段：
--   hour          聚合小时桶（date_trunc('hour', now())）
--   name          事件名（白名单里的事件名；否则不记）
--   invalid_keys  非法/未登记的**键名**（不是值），排序去重后最多 8 个、每个 ≤64 字符
--   n             同一个 (hour, name, invalid_keys) 的累计次数
--
-- 不记 install_id / ts / 任何 props 值 / 原始 body —— 被拒载荷里可能有内容、
-- URL、原文，把原值落库等于绕过 telemetry-design 的「白名单之外一个字节都不进」。
--
-- 唯一键 (hour, name, invalid_keys)：数组相等是顺序敏感的，所以写入前必须排序去重；
-- bt_event_rejected_bump() 就是唯一写入口。
--
-- 执行前请架构确认：是否与 bt_events 同库 / 保留期 / 是否需要 RLS 之外的运维读权限。
-- 不要在 GO 之前跑。

-- 表 check 不允许子查询：每个元素 ≤64 用一个 immutable 小函数判。
create or replace function public.bt_rejected_keys_valid(p_keys text[])
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(bool_and(k is not null and k <> '' and length(k) <= 64), true)
    from unnest(coalesce(p_keys, '{}'::text[])) as k;
$$;

create table if not exists public.bt_events_rejected (
  hour         timestamptz not null default date_trunc('hour', now()),
  name         text   not null,
  invalid_keys text[] not null default '{}'::text[],
  n            bigint not null default 0,
  constraint bt_events_rejected_pkey primary key (hour, name, invalid_keys),
  constraint bt_events_rejected_name_chk check (name ~ '^[a-z0-9_]{1,64}$'),
  constraint bt_events_rejected_keys_chk check (cardinality(invalid_keys) between 0 and 8),
  constraint bt_events_rejected_key_len_chk check (public.bt_rejected_keys_valid(invalid_keys)),
  constraint bt_events_rejected_n_chk check (n >= 0)
);

comment on table public.bt_events_rejected is
  'BEL-293 ingest 拒收聚合：按小时桶（hour=date_trunc(''hour'', now())）只记 name + 非法键名集合(最多 8 个、每个 ≤64 字符) + 计数；绝不记值/install_id/原始 body。等架构 GO 再执行。';
comment on column public.bt_events_rejected.hour is
  '聚合小时桶：date_trunc(''hour'', now())。';
comment on column public.bt_events_rejected.invalid_keys is
  '非法/未登记的键名（不是值）。写入前排序去重，最多 8 个、每个 ≤64 字符。';

-- 与 bt_events 同一条纪律：RLS 开着、零策略，只有 service role 进得来。
alter table public.bt_events_rejected enable row level security;
revoke all on table public.bt_events_rejected from anon, authenticated;

-- 唯一写入口：hour 由 date_trunc('hour', now()) 决定；invalid_keys 先排序去重、
-- 截断到 8 个，再 upsert 累加。
-- ingest 侧只传键名，不传值；事件名不在白名单时连这个函数都不该调。
-- 旧的三参（带 p_hour）签名若存在先删掉，避免留下第二个写入口。
drop function if exists public.bt_event_rejected_bump(text, text[], timestamptz);
create or replace function public.bt_event_rejected_bump(
  p_name text,
  p_keys text[]
)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  insert into public.bt_events_rejected (hour, name, invalid_keys, n)
  values (
    date_trunc('hour', now()),
    p_name,
    (coalesce((
      select array_agg(distinct k order by k)
        from unnest(coalesce(p_keys, '{}'::text[])) as k
       where k is not null and k <> '' and length(k) <= 64
    ), '{}'::text[]))[1:8],
    1
  )
  on conflict (hour, name, invalid_keys)
  do update set n = public.bt_events_rejected.n + excluded.n;
$$;

revoke all on function public.bt_event_rejected_bump(text, text[]) from public, anon, authenticated;
