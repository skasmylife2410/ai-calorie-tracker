-- 0015_snapcal_rls_everywhere.sql — row level security on every SnapCal table.
--
-- The app never talks to Supabase from the phone: every read and write goes through the Vercel
-- functions with the service-role key, which bypasses RLS. So turning RLS on (with no policies)
-- changes nothing for the app, but closes these tables to anyone who gets hold of the project's
-- anon key: without it they'd be readable and writable through Supabase's public REST API.
--
-- The original tables already have it (0001, 0004-0009, 0013). These were created later, outside
-- the numbered migrations, so this makes sure. Safe to run more than once.
--
-- Before running: confirm SUPABASE_SERVICE_ROLE_KEY is set in Vercel (it must be, since the
-- tables above already have RLS on and the app works).

alter table if exists public.snapcal_shares        enable row level security;
alter table if exists public.snapcal_comments      enable row level security;
alter table if exists public.snapcal_notes         enable row level security;
alter table if exists public.snapcal_groups        enable row level security;
alter table if exists public.snapcal_group_members enable row level security;
alter table if exists public.snapcal_invites       enable row level security;
alter table if exists public.snapcal_recaps        enable row level security;
alter table if exists public.snapcal_suggestions   enable row level security;

-- and the earlier ones again, in case any was switched off by hand
alter table if exists public.snapcal_food_entries    enable row level security;
alter table if exists public.snapcal_water           enable row level security;
alter table if exists public.snapcal_profile         enable row level security;
alter table if exists public.snapcal_exercise        enable row level security;
alter table if exists public.snapcal_favorites       enable row level security;
alter table if exists public.snapcal_users           enable row level security;
alter table if exists public.snapcal_weight          enable row level security;
alter table if exists public.snapcal_push_subs       enable row level security;
alter table if exists public.snapcal_auth_failures   enable row level security;
alter table if exists public.snapcal_password_resets enable row level security;
alter table if exists public.snapcal_client_errors   enable row level security;

-- To check afterwards (every row should say true):
--   select relname, relrowsecurity from pg_class where relname like 'snapcal_%' and relkind = 'r';
