-- SnapCal — exercise log and favourites, per owner. Both are written only by /api/sync.
create table if not exists public.snapcal_exercise (
  id          text primary key,
  owner       text not null,
  day         date not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
comment on table public.snapcal_exercise is 'SnapCal exercise sessions. data = full client ExerciseEntry JSON.';
create index if not exists snapcal_exercise_owner_updated_idx on public.snapcal_exercise (owner, updated_at);
alter table public.snapcal_exercise enable row level security;

create table if not exists public.snapcal_favorites (
  id          text primary key,
  owner       text not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
comment on table public.snapcal_favorites is 'SnapCal hearted foods (one serving each). data = full client SavedFood JSON.';
create index if not exists snapcal_favorites_owner_updated_idx on public.snapcal_favorites (owner, updated_at);
alter table public.snapcal_favorites enable row level security;
