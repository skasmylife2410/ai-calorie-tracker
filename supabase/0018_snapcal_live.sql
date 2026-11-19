-- 0018_snapcal_live.sql — "Train together": someone goes live for one of their groups
-- (api/groups.js, ops live*). The video goes straight between phones (WebRTC); the server only
-- passes each viewer's connection offer and the answer, and is never sent any video.
create table if not exists public.snapcal_live (
  id text primary key,
  owner text not null,
  group_id text not null,
  muscle text not null,
  level text not null,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists snapcal_live_group on public.snapcal_live (group_id, last_seen);
create index if not exists snapcal_live_owner on public.snapcal_live (owner);

create table if not exists public.snapcal_live_signals (
  id text primary key,
  live_id text not null references public.snapcal_live (id) on delete cascade,
  viewer text not null,
  camera boolean not null default false,
  offer text not null,
  answer text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at timestamptz
);
create index if not exists snapcal_live_signals_live on public.snapcal_live_signals (live_id);
create index if not exists snapcal_live_signals_viewer on public.snapcal_live_signals (viewer);

alter table public.snapcal_live enable row level security;
alter table public.snapcal_live_signals enable row level security;
revoke all on table public.snapcal_live from anon, authenticated;
revoke all on table public.snapcal_live_signals from anon, authenticated;
