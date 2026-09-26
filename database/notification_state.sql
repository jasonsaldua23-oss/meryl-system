-- ==============================================================================
-- MERYL SHOES SYSTEM - NOTIFICATION READ / DISMISSED STATE
-- Run in the Supabase SQL Editor after security_phase4_session_enforcement.sql.
--
-- Remembers, per user, which bell notifications were read or dismissed, so they
-- stay read after a reload, after closing the tab and on other devices.
-- (The app deliberately clears browser storage on load, so this lives here.)
-- Each user can only see and change their own rows (x-meryl-session model).
-- ==============================================================================

begin;

set search_path to public, extensions;

create table if not exists public.notification_state (
  user_id uuid not null default public.app_current_user_id()
    references public."user"(user_id) on delete cascade,
  notification_key text not null check (length(notification_key) between 1 and 300),
  read_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, notification_key)
);

create index if not exists notification_state_updated_idx
  on public.notification_state (updated_at);

alter table public.notification_state enable row level security;
revoke all on table public.notification_state from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_state to anon, authenticated;

drop policy if exists notification_state_own on public.notification_state;
create policy notification_state_own on public.notification_state
  for all to anon, authenticated
  using (user_id = (select public.app_current_user_id()))
  with check (user_id = (select public.app_current_user_id()));

-- Keep the table small: forget state for notifications untouched for 90 days
-- (they are long gone from the bell by then).
create or replace function public.notification_state_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  delete from public.notification_state
  where user_id = new.user_id
    and updated_at < now() - interval '90 days';
  return new;
end;
$$;
revoke all on function public.notification_state_touch() from public, anon, authenticated;

drop trigger if exists notification_state_touch on public.notification_state;
create trigger notification_state_touch
  before insert or update on public.notification_state
  for each row execute function public.notification_state_touch();

commit;
