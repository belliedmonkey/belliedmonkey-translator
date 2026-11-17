-- BEL-293 P0 草稿 —— **等架构 GO 再执行；本拍只提交，不执行 DDL。**
--
-- bt_events_rejected：被 ingest 拒收/部分拒收时只记「事件名 + 非法键名集合 + 计数」。
--
-- 为什么不是明细表：被拒的载荷里可能有内容、URL、原文；把原值落库等于绕过
-- telemetry-design 的「白名单之外一个字节都不进」。所以这里只允许：
--   · name          事件名（它已经在白名单里，否则连名字都不记）
--   · invalid_keys  非法/未登记的键名（不是值）；最多 64 个，按字典序存
--   · n             同一个 (name, invalid_keys) 的聚合次数
-- 不记 install_id / ts / 任何 props 值 / 原始 body。需要按安装排查时走既有诊断通道，
-- 不在遥测表里开口子。
--
-- ingest 侧接入（本拍不做）：校验失败时 `insert ... on conflict (name, invalid_keys)
-- do update set n = bt_events_rejected.n + 1, last_seen = now()`。只传键名，不传值。
--
-- 执行前请架构确认：是否与 bt_events 同库 / 保留期 / 是否需要 RLS 之外的运维读权限。
-- 不要在 GO 之前跑。

create table if not exists public.bt_events_rejected (
  id           bigint generated always as identity primary key,
  name         text        not null,
  invalid_keys text[]      not null default '{}'::text[],
  n            bigint      not null default 0,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  constraint bt_events_rejected_name_chk check (name ~ '^[a-z0-9_]{1,64}$'),
  constraint bt_events_rejected_keys_chk check (cardinality(invalid_keys) between 0 and 64),
  constraint bt_events_rejected_n_chk check (n >= 0)
);

-- 同一事件名 + 同一组非法键名只留一行，计数累加。
create unique index if not exists bt_events_rejected_key_idx
  on public.bt_events_rejected (name, invalid_keys);

create index if not exists bt_events_rejected_seen_idx
  on public.bt_events_rejected (last_seen);

comment on table public.bt_events_rejected is
  'BEL-293 ingest 拒收聚合：只记 name + 非法键名集合 + 计数，绝不记值/install_id/原始 body。等架构 GO 再执行。';
comment on column public.bt_events_rejected.invalid_keys is
  '非法/未登记的键名（不是值）。最多 64 个。';

-- 与 bt_events 同一条纪律：RLS 开着、零策略，只有 service role 进得来。
alter table public.bt_events_rejected enable row level security;
revoke all on table public.bt_events_rejected from anon, authenticated;
