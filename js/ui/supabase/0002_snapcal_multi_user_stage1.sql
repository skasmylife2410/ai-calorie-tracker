-- SnapCal — multi-user, stage 1 of 2. Safe to run while the single-user code is still live:
-- only adds an `owner` column (existing rows become 'aelson') and per-owner unique indexes.
alter table public.snapcal_food_entries add column if not exists owner text not null default 'aelson';
alter table public.snapcal_water        add column if not exists owner text not null default 'aelson';
alter table public.snapcal_profile      add column if not exists owner text not null default 'aelson';

create index if not exists snapcal_food_entries_owner_updated_idx on public.snapcal_food_entries (owner, updated_at);
create unique index if not exists snapcal_water_owner_day_key on public.snapcal_water (owner, day);
create unique index if not exists snapcal_profile_owner_key  on public.snapcal_profile (owner);
