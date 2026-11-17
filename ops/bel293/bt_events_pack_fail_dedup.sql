-- BEL-293 P0 草稿 —— **等架构 GO 再执行；本拍只提交，不执行 DDL。**
--
-- bt_events_pack_fail_dedup：pack_download_fail 的按下载尝试去重视图。
--
-- 口径：
--   · 新行按 (install_id, download_id) 去重；同一 download_id 因重发/重试落成多行时
--     只保留 received_at 最新的一行（同秒再按 id 最大）。
--   · 没有 download_id 的老行无法去重，逐行保留，并标 legacy=true。
--   · 视图不丢行：新行每组 1 行 + 老行原样；`select count(*) ... where not legacy`
--     才是「去重后的下载尝试数」。
--   · 只暴露已登记的归因字段（不 select props 原对象），避免未来新增键被报表无意带出。
--   · 与 bt_events 同一 RLS 纪律：视图不单独授权；service role 才能读。
--
-- 执行前请架构确认：列名 / legacy 语义 / 是否要物化。不要在 GO 之前跑。

create or replace view public.bt_events_pack_fail_dedup as
with fails as (
  select
    e.id,
    e.install_id,
    e.name,
    e.ts,
    e.v,
    e.flavor,
    e.host,
    e.device,
    e.ui,
    e.received_at,
    e.props->>'pack_kind' as pack_kind,
    e.props->>'pack_id' as pack_id,
    e.props->>'locale' as locale,
    e.props->>'surface' as surface,
    e.props->>'source' as source,
    e.props->>'code' as code,
    e.props->>'reason' as reason,
    e.props->>'tier' as tier,
    e.props->>'detail' as detail,
    case
      when coalesce(e.props->>'size', '') ~ '^[0-9]{1,10}$' then (e.props->>'size')::bigint
      else 0
    end as size,
    case
      when coalesce(e.props->>'progress', '') ~ '^[0-9]{1,3}$'
       and (e.props->>'progress')::int between 0 and 100 then (e.props->>'progress')::int
      else 0
    end as progress,
    e.props->>'download_id' as download_id,
    e.props->>'launch_id' as launch_id,
    e.props->>'attempt' as attempt
  from public.bt_events e
  where e.name = 'pack_download_fail'
), keyed as (
  select
    fails.*,
    (download_id is null or download_id = '') as legacy
  from fails
), ranked as (
  select
    keyed.*,
    row_number() over (
      partition by install_id, name, download_id
      order by received_at desc, id desc
    ) as rn
  from keyed
  where not legacy
)
select
  id as event_id,
  install_id,
  name,
  ts,
  v,
  flavor,
  host,
  device,
  ui,
  pack_kind,
  pack_id,
  locale,
  surface,
  source,
  code,
  reason,
  tier,
  detail,
  size,
  progress,
  download_id,
  launch_id,
  attempt,
  false as legacy,
  received_at
from ranked
where rn = 1
union all
select
  id as event_id,
  install_id,
  name,
  ts,
  v,
  flavor,
  host,
  device,
  ui,
  pack_kind,
  pack_id,
  locale,
  surface,
  source,
  code,
  reason,
  tier,
  detail,
  size,
  progress,
  download_id,
  launch_id,
  attempt,
  true as legacy,
  received_at
from keyed
where legacy;

comment on view public.bt_events_pack_fail_dedup is
  'BEL-293 pack_download_fail 去重视图：按 (install_id, download_id) 保留最新一行；无 download_id 的老行逐行保留并标 legacy=true。等架构 GO 再执行。';
