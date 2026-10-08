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

-- 2026-10-04 用户拍板：**不再把 CC-BY-NC 的 vits-mms-tha 当正式默认包**（要换成达摩院
-- iic/speech_sambert-hifigan_tts_waan_Thai_16k，Apache 2.0 —— 但那要 ONNX 导出 + 两段式运行时，
-- 见 app/device-models.config.js 里那段说明）。这一行因此撤下；泰语朗读回落系统语音。
delete from public.bt_model_sources where kind = 'tts' and flavor = 'china' and path = 'vits-mms-tha.zip';

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


-- 2026-10-08：**语种识别包（kind='lid'）也进这张表** —— 与朗读包同一套「查表 → 探测 → 换源」逻辑
-- （`app/model-sources.js` 的过滤已从 `kind=eq.tts` 放开到 `kind=in.(tts,lid)`）。
-- **两行都填中继地址，不填 ModelScope / HF 的真实地址**：真实托管由服务端 `bt-models` 按请求 IP 选
-- （中国 → ModelScope，其它 → Hugging Face 原站），把真实地址写进来就等于绕过分流。
-- `url_alt` = 同址 + `?src=other`（「按 IP 分流时不会选的那一边」），主源下载失败时客户端用它重试。
insert into public.bt_model_sources (kind, flavor, path, url, url_alt, note) values
  ('lid', 'global', 'speechbrain-ecapa-voxlingua107.zip',
   'https://api.belliedmonkey.com/models/speechbrain-ecapa-voxlingua107.zip',
   'https://api.belliedmonkey.com/models/speechbrain-ecapa-voxlingua107.zip?src=other',
   '国际版：语种识别默认引擎 SpeechBrain ECAPA VoxLingua107（Apache-2.0）；地址走中继，按 IP 分流'),
  ('lid', 'china', 'speechbrain-ecapa-voxlingua107.zip',
   'https://api.belliedmonkey.com/models/speechbrain-ecapa-voxlingua107.zip',
   'https://api.belliedmonkey.com/models/speechbrain-ecapa-voxlingua107.zip?src=other',
   '中国版：同上；ModelScope 与 HF 同一份字节（sha256 f4fa066c…7eda1）')
on conflict (kind, flavor, path) do update
  set url = excluded.url, url_alt = excluded.url_alt, active = true, updated_at = now();

-- 回读断言：别拿「没报错」当成功。**按 kind 拆开数**（2026-10-08 起表里有两类包：朗读 + 语种识别）。
do $$ begin
  if (select count(*) from public.bt_model_sources where flavor = 'china' and kind = 'tts' and active) <> 1 then
    raise exception 'bt_model_sources：中国版 kind=tts 应有 1 行 active（kokoro 中英；泰语默认包撤下，要换达摩院需先做 ONNX+两段式运行时），实际 %',
      (select count(*) from public.bt_model_sources where flavor = 'china' and kind = 'tts' and active);
  end if;
  if (select count(*) from public.bt_model_sources where flavor = 'china' and kind = 'lid' and active) <> 1 then
    raise exception 'bt_model_sources：中国版 kind=lid 应有 1 行 active（SpeechBrain ECAPA，地址走中继按 IP 分流），实际 %',
      (select count(*) from public.bt_model_sources where flavor = 'china' and kind = 'lid' and active);
  end if;
end $$;
