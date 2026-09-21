-- SnapCal — weight readings, one per owner per day. Applied already; kept as a record.
create table if not exists public.snapcal_weight (
  id          text primary key,
  owner       text not null,
  day         date not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
comment on table public.snapcal_weight is 'SnapCal weight readings, one per owner per day. data = full client WeightEntry JSON.';
create index if not exists snapcal_weight_owner_updated_idx on public.snapcal_weight (owner, updated_at);
create unique index if not exists snapcal_weight_owner_day_key on public.snapcal_weight (owner, day);
alter table public.snapcal_weight enable row level security;
