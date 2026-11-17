-- BEL-293 增补 2（2026-11-17）：pack_download_fail 的按下载尝试去重视图。
-- **等架构 GO 再执行；本拍只提交，不执行 DDL。**
--
-- 口径：
--   · download_id 非 NULL：按 (install_id, name, download_id) 分组，只保留
--     received_at 最新的一行，dedupe='deduped'。
--   · download_id IS NULL 的 1.23.3 老行：无法去重，**原样透传**，dedupe='legacy'。
--     老行没有 detail 就是 NULL —— 不回填，也不把缺失值写成 'other'。
--   · 只覆盖 name='pack_download_fail'；其它事件的原行不在这里去重。
--   · 与 bt_events 同一 RLS 纪律：视图不单独授权，service role 才能读。
--
-- 为什么要有这个视图：失败会立即 flush，网络重试 / 后台重发可能让同一个
-- download_id 落成多行；bt_daily 直接读 bt_events 会把同一次尝试算两次。
-- 报表和 bt_rollup_day 都从这里读。
--
-- 执行前请架构确认：列名 / dedupe 语义 / 是否要物化。不要在 GO 之前跑。

create or replace view public.bt_events_pack_fail_dedup as
with fails as (
  select
    e.id,
    e.install_id,
    e.ts,
    e.v,
    e.flavor,
    e.host,
    e.device,
    e.ui,
    e.name,
    e.props,
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
      else null
    end as size,
    case
      when coalesce(e.props->>'progress', '') ~ '^[0-9]{1,3}$'
       and (e.props->>'progress')::int between 0 and 100 then (e.props->>'progress')::int
      else null
    end as progress,
    e.props->>'launch_id' as launch_id,
    e.props->>'attempt' as attempt,
    e.props->>'download_id' as download_id,
    case
      when e.props->>'download_id' is null then null
      else row_number() over (
        partition by e.install_id, e.name, e.props->>'download_id'
        order by e.received_at desc
      )
    end as rn
  from public.bt_events e
  where e.name = 'pack_download_fail'
)
select
  f.id,
  f.install_id,
  f.ts,
  f.v,
  f.flavor,
  f.host,
  f.device,
  f.ui,
  f.name,
  f.props,
  f.received_at,
  f.pack_kind,
  f.pack_id,
  f.locale,
  f.surface,
  f.source,
  f.code,
  f.reason,
  f.tier,
  f.detail,
  f.size,
  f.progress,
  f.launch_id,
  f.attempt,
  f.download_id,
  case when f.download_id is null then 'legacy' else 'deduped' end as dedupe
from fails f
where f.download_id is null or f.rn = 1;

comment on view public.bt_events_pack_fail_dedup is
  'BEL-293 pack_download_fail 去重视图：download_id 非 NULL 按 (install_id,name,download_id) 保留 received_at 最新一行（dedupe=deduped）；NULL 老行原样透传（dedupe=legacy），detail 保持 NULL、不回填。等架构 GO 再执行。';

-- 与 bt_events 同一条纪律：RLS 开着、零策略；视图再 revoke 掉 anon / authenticated。
revoke all on table public.bt_events_pack_fail_dedup from public, anon, authenticated;
