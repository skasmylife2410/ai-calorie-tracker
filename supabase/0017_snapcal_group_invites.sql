-- 0017_snapcal_group_invites.sql — someone already on the app asked to join a group (api/groups.js).
-- Joining shows your log to everyone in that group, so it waits here until the person says yes.
create table if not exists public.snapcal_group_invites (
  group_id text not null,
  username text not null,
  invited_by text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, username)
);
alter table public.snapcal_group_invites enable row level security;
revoke all on table public.snapcal_group_invites from anon, authenticated;
