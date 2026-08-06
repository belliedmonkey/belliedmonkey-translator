-- supabase/schema.sql — the ENTIRE sync backend, in one idempotent script.
-- See docs/learning-design.md §8.4 / §8.4.1.
--
-- Run this against a fresh project and sync works; there is nothing else to click.
-- It lives in git rather than only in a provider's migration history because the
-- backend is expected to MOVE (§8.4.1), and a migration you cannot replay is a
-- migration that only exists as long as someone remembers it.
--
-- Safe to re-run: every statement is `if not exists` / `or replace` / drop-then-create.
--
--   psql "$DATABASE_URL" -f supabase/schema.sql
--
-- Two things this file does NOT do, because they are not SQL:
--   1. The auth email template must render `{{ .Token }}` (a 6-digit code). The stock
--      template sends a magic LINK, and a link cannot be completed from inside an
--      extension — there is no page of ours for it to land on.
--   2. `supabase/functions/bt-delete-account` must be deployed (§8.7).

-- ─────────────────────────────────────────────────────────────────────────────
-- The chunk log. One row = one deflate-raw'd JSONL bundle, byte-identical to what
-- the export button writes (learn/chunk.js). Sync is a transport, not a format.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bt_chunks (
  -- Server-assigned, NOT client-assigned. Two devices pushing at the same moment
  -- would otherwise pick the same number: one insert fails, or worse, silently wins.
  seq         bigint generated always as identity primary key,
  user_id     uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text   not null default 'bundle',
  blob        bytea  not null,                    -- deflate-raw JSONL, NOT encrypted (§8.6)
  generation  int    not null default 0,          -- bumped by compaction
  created_at  timestamptz not null default now()
);

alter table public.bt_chunks drop constraint if exists bt_chunks_kind_check;
alter table public.bt_chunks add constraint bt_chunks_kind_check
  check (kind in ('bundle', 'cards', 'reviews', 'sources'));

create index if not exists bt_chunks_user_seq_idx on public.bt_chunks (user_id, seq);

comment on table public.bt_chunks is
  'BelliedMonkey Translator 记忆层：只追加的 chunk 日志。见 docs/learning-design.md §8。';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS. NOTE THE MISSING POLICY: there is deliberately no UPDATE policy, so
-- append-only is held by the database rather than by client discipline. Nothing in
-- the system — including our own client, including a bug in it — can rewrite a chunk
-- that has been written. Adding an UPDATE policy here silently deletes that
-- guarantee, which is why this comment is longer than the statements.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.bt_chunks enable row level security;

drop policy if exists bt_chunks_select on public.bt_chunks;
create policy bt_chunks_select on public.bt_chunks
  for select to authenticated using (user_id = auth.uid());

drop policy if exists bt_chunks_insert on public.bt_chunks;
create policy bt_chunks_insert on public.bt_chunks
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists bt_chunks_delete on public.bt_chunks;
create policy bt_chunks_delete on public.bt_chunks
  for delete to authenticated using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Quota. AGENTS.md rule 7: enforced by a database constraint, never by client-side
-- good behaviour. It RAISES rather than truncating — the same rule forbids silently
-- dropping data, and the client turns this error into a visible pressure state with
-- a cleanup action (§7.1).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.bt_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  used  bigint;
  quota constant bigint := 50 * 1024 * 1024;
begin
  select coalesce(sum(octet_length(blob)), 0) into used
    from public.bt_chunks
   where user_id = new.user_id;

  if used + octet_length(new.blob) > quota then
    raise exception 'bt: quota exceeded (% of % bytes used)', used, quota
      using errcode = 'disk_full';        -- 53100; the client matches on the CODE
  end if;
  return new;
end;
$$;

drop trigger if exists bt_chunks_quota on public.bt_chunks;
create trigger bt_chunks_quota
  before insert on public.bt_chunks
  for each row execute function public.bt_enforce_quota();

-- What the settings page shows. SECURITY INVOKER + its own auth.uid() filter, so it
-- can only ever report on the caller.
create or replace function public.bt_usage()
returns table (bytes bigint, chunks bigint, quota bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select coalesce(sum(octet_length(blob)), 0)::bigint,
         count(*)::bigint,
         (50 * 1024 * 1024)::bigint
    from public.bt_chunks
   where user_id = auth.uid();
$$;

-- A SECURITY DEFINER function that anyone can call over RPC is a privilege-escalation
-- surface. The trigger runs as the table owner and needs no grants at all, so take
-- them away — the security advisor flags this, correctly.
revoke all on function public.bt_enforce_quota() from public, anon, authenticated;
revoke all on function public.bt_usage() from public, anon;
grant execute on function public.bt_usage() to authenticated;
