-- ============================================================
--  ShopFlow — Supabase schema (for the GitHub Pages + Supabase setup)
--  One workspace = one JSON document, synced live to every device.
--  Data is locked to LOGGED-IN sessions: the public anon key alone
--  grants nothing — you must sign in with the shop login to read/write.
--  Run once: Supabase → SQL Editor → paste → Run.
-- ============================================================

create table if not exists public.workspaces (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create or replace function public.touch_ws()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_ws on public.workspaces;
create trigger trg_ws before update on public.workspaces
  for each row execute function public.touch_ws();

-- Row-Level Security: only authenticated sessions (the shop login) can touch data.
alter table public.workspaces enable row level security;
drop policy if exists ws_all on public.workspaces;
create policy ws_all on public.workspaces
  for all to authenticated using (true) with check (true);

-- Live updates to every signed-in device
alter publication supabase_realtime add table public.workspaces;
