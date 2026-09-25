-- 0007 — push notification subscriptions, one row per phone. Server-only (service role);
-- RLS on with no policies, like every other snapcal_ table. Applied 2026-09-25.
create table if not exists public.snapcal_push_subs (
  endpoint text primary key,
  owner text not null references public.snapcal_users(username) on update cascade on delete cascade,
  p256dh text not null,
  auth text not null,
  lang text not null default 'en',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists snapcal_push_subs_owner_idx on public.snapcal_push_subs(owner);
alter table public.snapcal_push_subs enable row level security;
