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
  ('tts', 'china', 'kokoro-zh-en.zip',
   'https://www.modelscope.cn/models/belliedmonkey/belliedmonkey-device-models/resolve/master/kokoro-zh-en.zip',
   'https://hf-mirror.com/belliedmonkey/belliedmonkey-device-models/resolve/main/kokoro-zh-en.zip',
   '中国版：默认魔搭 ModelScope，备用 hf-mirror。2026-10-03 换成 Kokoro int8 多语（中英一个包 140 MB）')
on conflict (kind, flavor, path) do nothing;

-- 2026-10-03（**应用时才发现**）：App 从 1.19.0 起请求的是 `kokoro-zh-en.zip`，
-- 而这张表里还是当年那两行 piper。**只插新行不够** —— 旧两行仍 active ⇒
-- 下面那条「恰好 1 行 active」的回读断言会直接报错，而且「这个 flavor 有哪些包」这件事失真。
-- 停用而不是删除：它们指向的包还在托管上，留着当历史；`active=false` 就不再参与下载决策。
update public.bt_model_sources set active = false, updated_at = now()
 where kind = 'tts' and flavor = 'china' and path in ('piper-zh.zip', 'piper-en.zip');

-- 2026-10-01（#532）：**国际版那两行不在这里** —— 它们在东京库里是当年直接用 SQL 建的。
--   今天把它们的 `url_alt` 从 huggingface.co 换成了 hf-mirror.com（同一个 zip、同一个 sha256）：
--   包在 1.19.0 起是**首启硬门**，而国内实测 GitHub 拉不动（HEAD 超时 / 下载停在 1%），
--   备用若也不可达 ⇒ 屏 2 过不去、App 用不了（以前只是朗读降级）。改法见上：换一行 url。


-- 回读断言：别拿「没报错」当成功。
do $$ begin
  if (select count(*) from public.bt_model_sources where flavor = 'china' and active) <> 1 then
    raise exception 'bt_model_sources：中国版应有 1 行 active（kokoro-zh-en.zip 一条覆盖中英），实际 %',
      (select count(*) from public.bt_model_sources where flavor = 'china' and active);
  end if;
end $$;
