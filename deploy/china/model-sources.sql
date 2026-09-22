-- deploy/china/model-sources.sql — 离线朗读模型的下载地址表（app/model-sources.js 读它）。
--
-- 为什么单独一个文件：这张表在东京是 2026-09-17 直接用 SQL 建的，**不在 supabase/schema.sql 里**。
-- 境内后端按 schema.sql 原样建库时它就缺了 —— 而中国版 App 的「设备内置朗读」下载前要先问它。
-- 结构、约束与 RLS 于 2026-09-22 从东京逐项读回照抄；只放中国版那两行（国际版不会打这个后端）。
-- 与东京的一处有意不同：只授 SELECT（东京 anon 带着 Supabase 默认给的 TRUNCATE 等，接口不暴露，
-- 但没有理由在新库里再发一遍）。换下载地址 = 改一行 url，见 memory「离线朗读模型托管」。

create table if not exists public.bt_model_sources (
  kind       text not null,
  flavor     text not null check (flavor in ('global', 'china')),
  path       text not null,
  url        text not null check (url like 'https://%'),
  url_alt    text check (url_alt is null or url_alt like 'https://%'),
  active     boolean not null default true,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (kind, flavor, path)
);

alter table public.bt_model_sources enable row level security;
drop policy if exists "anon read active model sources" on public.bt_model_sources;
create policy "anon read active model sources" on public.bt_model_sources
  for select using (active = true);
revoke all on public.bt_model_sources from anon, authenticated;
grant select on public.bt_model_sources to anon, authenticated;

insert into public.bt_model_sources (kind, flavor, path, url, url_alt, note) values
  ('tts', 'china', 'piper-zh.zip',
   'https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/piper-zh.zip',
   'https://hf-mirror.com/belliedmonkey/belliedmonkey-device-models/resolve/main/piper-zh.zip',
   '中国版：默认魔搭 ModelScope（真机 18.7 MB/s），备用 hf-mirror（≈580 KB/s）'),
  ('tts', 'china', 'piper-en.zip',
   'https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/piper-en.zip',
   'https://hf-mirror.com/belliedmonkey/belliedmonkey-device-models/resolve/main/piper-en.zip',
   '中国版：默认魔搭 ModelScope（真机 18.7 MB/s），备用 hf-mirror（≈580 KB/s）')
on conflict (kind, flavor, path) do nothing;

-- 回读断言：别拿「没报错」当成功。
do $$ begin
  if (select count(*) from public.bt_model_sources where flavor = 'china' and active) <> 2 then
    raise exception 'bt_model_sources：中国版应有 2 行 active，实际 %',
      (select count(*) from public.bt_model_sources where flavor = 'china' and active);
  end if;
end $$;
