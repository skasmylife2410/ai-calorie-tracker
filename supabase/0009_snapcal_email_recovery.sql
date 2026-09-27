-- 0009_snapcal_email_recovery.sql — an optional email per account, for "Forgot password?".
--
-- snapcal_users.email: lower-case, at most one account per address.
-- snapcal_password_resets: one row per reset link sent. Only the SHA-256 of the link's token is
-- stored, so someone reading this table can't use a link; each is single-use and expires.

alter table public.snapcal_users add column if not exists email text;
create unique index if not exists snapcal_users_email_unique on public.snapcal_users (email) where email is not null;

create table if not exists public.snapcal_password_resets (
  token_hash text primary key,
  username text not null references public.snapcal_users (username) on delete cascade on update cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists snapcal_password_resets_username on public.snapcal_password_resets (username);
alter table public.snapcal_password_resets enable row level security;
revoke all on table public.snapcal_password_resets from anon, authenticated;
