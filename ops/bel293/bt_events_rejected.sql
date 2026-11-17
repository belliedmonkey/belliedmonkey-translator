-- BEL-293 增补 2（2026-11-17）：bt_events_rejected —— ingest 拒收/部分拒收的按小时聚合。
-- **等架构 GO 再执行；本拍只提交，不执行 DDL。**
--
-- 只允许四个字段：
--   hour  UTC 小时（date_trunc('hour', now())）
--   name  事件名（白名单里的事件名；否则不记）
--   keys  非法/未登记的**键名**（不是值），排序去重后最多 8 个
--   n     同一个 (hour, name, keys) 的累计次数
--
-- 不记 install_id / ts / 任何 props 值 / 原始 body —— 被拒载荷里可能有内容、URL、
-- 原文，把原值落库等于绕过 telemetry-design 的「白名单之外一个字节都不进」。
--
-- 唯一键 (hour, name, keys)：数组相等是顺序敏感的，所以写入前必须排序去重；
-- bt_event_rejected_bump() 就是唯一写入口。
--
-- 执行前请架构确认：是否与 bt_events 同库 / 保留期 / 是否需要 RLS 之外的运维读权限。
-- 不要在 GO 之前跑。

create table if not exists public.bt_events_rejected (
  hour  timestamptz not null,
  name  text        not null,
  keys  text[]      not null default '{}'::text[],
  n     bigint      not null default 0,
  constraint bt_events_rejected_pkey primary key (hour, name, keys),
  constraint bt_events_rejected_name_chk check (name ~ '^[a-z0-9_]{1,64}$'),
  constraint bt_events_rejected_keys_chk check (cardinality(keys) between 0 and 8),
  constraint bt_events_rejected_n_chk check (n >= 0)
);

comment on table public.bt_events_rejected is
  'BEL-293 ingest 拒收聚合：只记 hour + name + 非法键名集合(最多 8 个) + 计数，绝不记值/install_id/原始 body。等架构 GO 再执行。';
comment on column public.bt_events_rejected.keys is
  '非法/未登记的键名（不是值）。写入前排序去重，最多 8 个。';

-- 与 bt_events 同一条纪律：RLS 开着、零策略，只有 service role 进得来。
alter table public.bt_events_rejected enable row level security;
revoke all on table public.bt_events_rejected from anon, authenticated;

-- 唯一写入口：排序去重、截断到 8 个，然后 upsert 累加。
-- ingest 侧只传键名，不传值；事件名不在白名单时连这个函数都不该调。
create or replace function public.bt_event_rejected_bump(
  p_name text,
  p_keys text[],
  p_hour timestamptz default date_trunc('hour', now())
)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  insert into public.bt_events_rejected (hour, name, keys, n)
  values (
    p_hour,
    p_name,
    (coalesce((
      select array_agg(distinct k order by k)
        from unnest(coalesce(p_keys, '{}'::text[])) as k
       where k is not null and k <> ''
    ), '{}'::text[]))[1:8],
    1
  )
  on conflict (hour, name, keys)
  do update set n = public.bt_events_rejected.n + 1;
$$;

revoke all on function public.bt_event_rejected_bump(text, text[], timestamptz) from public, anon, authenticated;
