-- 0008_snapcal_security.sql — brute-force limits and defence in depth.
--
-- 1. snapcal_auth_failures: one row per failed sign-in or passcode guess, keyed by
--    "ip:<address>" or "user:<name>". The API refuses further guesses from a key with too many
--    recent failures (api/_limits.js). /api/weekly deletes rows older than a day.
-- 2. The app only ever reaches these tables through the server with the service-role key.
--    RLS already blocks the public anon/authenticated roles (no policies exist); revoking their
--    table privileges as well means a future accidental policy can't expose anything.

create table if not exists public.snapcal_auth_failures (
  id bigserial primary key,
  key text not null,
  at timestamptz not null default now()
);
create index if not exists snapcal_auth_failures_key_at on public.snapcal_auth_failures (key, at desc);
alter table public.snapcal_auth_failures enable row level security;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'snapcal\_%' loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.snapcal_auth_failures_id_seq from anon, authenticated;
