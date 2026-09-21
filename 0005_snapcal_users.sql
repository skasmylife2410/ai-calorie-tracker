-- SnapCal — user accounts. Replaces the APP_USERS environment variable.
-- Passwords are PBKDF2-SHA256 hashes with a per-user salt, written only by /api/auth.
create table if not exists public.snapcal_users (
  username      text primary key,
  password_hash text not null,
  salt          text not null,
  must_change   boolean not null default false,
  created_at    timestamptz not null default now()
);
comment on table public.snapcal_users is 'SnapCal accounts. username matches the owner column on every other snapcal_ table.';
alter table public.snapcal_users enable row level security;
