-- deploy/diag-events.sql — L2 自动上报的信箱表（§0.4.1，2026-10-06 设计）。
-- **本批未部署**：L1（本机环形日志 + 手动导出）先上；L2（国际版先行、默认关）另批。
-- 纪律（test/diag-log.test.js 的门禁钉着）：
--   · **write-only**：anon 只有 INSERT，没有 SELECT / UPDATE / DELETE —— 只能投递，读不走这条门。
--   · 行数与保留：服务端 cron 30 天清理（部署时一并落）。
--   · 事件字段白名单在客户端 push 处强制（app/diag-log.js SCHEMA），这里不再校验内容 ——
--     信箱收到什么由客户端白名单决定，那张表本身就是零内容纪律的边界。

create table if not exists public.bt_diag_events (
  id          bigint generated always as identity primary key,
  install_id  uuid not null,                    -- 与遥测同一个匿名安装 id，永不 join 到账号
  flavor      text not null check (flavor in ('global', 'china')),
  app_version text not null,
  app_build   text not null,
  os          text not null default '',
  events      jsonb not null,                   -- DiagLog 环形日志的全文（head + entries）
  created_at  timestamptz not null default now()
);

alter table public.bt_diag_events enable row level security;

drop policy if exists "anon insert diag events" on public.bt_diag_events;
create policy "anon insert diag events" on public.bt_diag_events
  for insert with check (true);

revoke all on public.bt_diag_events from anon, authenticated;
-- 只有 INSERT：这是整个设计的形状 —— 没有任何 SELECT/DELETE policy 会被加进来（门禁）。
grant insert on public.bt_diag_events to anon, authenticated;

create index if not exists bt_diag_events_install_created_idx
  on public.bt_diag_events (install_id, created_at desc);
