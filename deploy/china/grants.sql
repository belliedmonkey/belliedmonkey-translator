-- deploy/china/grants.sql — 免费额度的**台账**（境内后端要用的那一份）。
--
-- 为什么单独一个文件：这套表与函数在东京是 2026-09 随额度一起建的，**不在 schema.sql 里**
-- （同 `model-sources.sql` 的先例）。境内后端按 README 建库时它就缺了 —— 而中国版一旦翻
-- `grant.china.ready`，中继（`supabase/functions/bt-relay`）要经 `LEDGER_URL` 打
-- `bt-grant-ledger` 的 `/check`、`/charge`，领取要打 `bt-grant` ⇒ 三个函数一个都不能少。
--
-- **账本与账号同库**（2026-09-22 用户裁定，`deploy/china-relay/README.md` 开头）：
-- 中继的 `/claim` 代转打的是它自己的 `SUPABASE_URL` —— 部署在境内时，那台就是境内后端，
-- 所以「账本在境内」不需要改客户端、也不需要第二套账。
--
-- 形状与东京逐字相同（客户端协议一个字节都不能变：`bt_grant_claim` 的返回列、
-- `bt_grant_check` / `bt_grant_charge` 的参数与返回都照抄 `supabase/schema.sql`）。
-- 有意的不同只有两处：
--   1. 不建 pg_cron（境内这台没有该扩展）⇒ 90 天流水清理改用宿主机 crontab，见文件末尾；
--   2. 只授必要权限（同 `model-sources.sql` 的理由：接口不暴露 TRUNCATE 一类）。

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

alter table public.bt_grants enable row level security;
alter table public.bt_grant_usage enable row level security;
revoke all on table public.bt_grants from anon, authenticated;
revoke all on table public.bt_grant_usage from anon, authenticated;

-- 领取：已有就原样返回（reused），没有才插。两台设备同时点也只会有一枚。
-- 全局日上限也在这里判 —— 理由见 supabase/schema.sql 那段注释（行锁化的计数）。
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

  select count(*)::int into today
    from public.bt_grants where created_at >= date_trunc('day', now());
  if today >= p_daily_cap then
    return query select null::text, null::text, p_limit, 0::numeric, 'capped'::text, false, true;
    return;
  end if;

  insert into public.bt_grants (user_id, token_hash, token_ct, token_iv, limit_usd)
  values (p_user, p_hash, p_ct, p_iv, p_limit)
  returning * into g;

  return query select g.token_ct, g.token_iv, g.limit_usd, g.spent_usd, g.status, false, false;
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
-- 境内这台没有 pg_cron ⇒ 用宿主机 crontab 跑同一句（与东京等价）：
--   37 3 * * *  psql "$DATABASE_URL" -c "delete from public.bt_grant_usage where at < now() - interval '90 days'"
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron 在（不该出现在境内这台）：本文件不建定时任务，请改用宿主机 crontab';
  else
    raise notice 'pg_cron 不可用（预期）：bt_grant_usage 的 90 天清理走宿主机 crontab';
  end if;
end
$cron$;

-- 回读断言：别拿「没报错」当成功。四张/四个对象少一个，翻 ready 之前就该红。
do $verify$
declare
  n_tab int; n_fn int;
begin
  select count(*) into n_tab from information_schema.tables
   where table_schema = 'public' and table_name in ('bt_grants', 'bt_grant_usage');
  select count(*) into n_fn from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('bt_grant_claim', 'bt_grant_check', 'bt_grant_charge', 'bt_grant_stats');
  if n_tab <> 2 or n_fn <> 4 then
    raise exception '台账不完整：表 %/2，函数 %/4', n_tab, n_fn;
  end if;
  raise notice '台账就位：2 表 + 4 函数';
end
$verify$;
