-- 0013_snapcal_client_errors.sql — when the app fails to open on someone's phone, the phone
-- sends the error text here (api/auth.js op "clientError", signed-in sessions only) so it can be
-- diagnosed without the phone in hand. Short text only; /api/weekly can prune old rows.
create table if not exists public.snapcal_client_errors (
  id bigserial primary key,
  owner text not null,
  at timestamptz not null default now(),
  message text not null,
  ua text
);
create index if not exists snapcal_client_errors_at on public.snapcal_client_errors (at desc);
alter table public.snapcal_client_errors enable row level security;
revoke all on table public.snapcal_client_errors from anon, authenticated;
revoke all on sequence public.snapcal_client_errors_id_seq from anon, authenticated;
