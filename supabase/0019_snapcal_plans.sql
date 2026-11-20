-- 0019_snapcal_plans.sql — planned workouts for a group (api/_plans.js via /api/groups): once or
-- every week, at a time in the planner's time zone, with a split (push, pull, legs or their own).
-- People answer per day (or '*' for every time) and pick their own split; an hour before, the ones
-- who are in get a reminder (api/weekly.js ?job=tick, run every few minutes by pg_cron).
create table if not exists public.snapcal_plans (
  id text primary key,
  group_id text not null,
  created_by text not null,
  split text not null,
  custom text,
  place text,
  time text not null,            -- "HH:MM", local to tz
  tz text not null,              -- IANA zone of the phone that planned it
  day date,                      -- once: that day
  weekdays smallint[],           -- every week: 0 = Sunday … 6 = Saturday
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists snapcal_plans_group on public.snapcal_plans (group_id);
create index if not exists snapcal_plans_creator on public.snapcal_plans (created_by);

create table if not exists public.snapcal_plan_rsvps (
  plan_id text not null references public.snapcal_plans (id) on delete cascade,
  day text not null,             -- "YYYY-MM-DD", or "*" for every time
  username text not null,
  going boolean not null,
  split text,
  custom text,
  updated_at timestamptz not null default now(),
  primary key (plan_id, day, username)
);
create index if not exists snapcal_plan_rsvps_user on public.snapcal_plan_rsvps (username);

create table if not exists public.snapcal_plan_sent (
  plan_id text not null references public.snapcal_plans (id) on delete cascade,
  day text not null,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (plan_id, day, kind)
);

-- a tiny lock so the every-few-minutes job runs once even if it's called more often
create table if not exists public.snapcal_ticks (
  name text primary key,
  at timestamptz not null default now()
);

alter table public.snapcal_plans enable row level security;
alter table public.snapcal_plan_rsvps enable row level security;
alter table public.snapcal_plan_sent enable row level security;
alter table public.snapcal_ticks enable row level security;
revoke all on table public.snapcal_plans, public.snapcal_plan_rsvps, public.snapcal_plan_sent, public.snapcal_ticks from anon, authenticated;

-- The reminder job (applied separately as "boca0_plan_reminder_tick"): every five minutes,
-- pg_cron asks the app to send any reminders that are due. The endpoint needs no secret: it only
-- sends what's due, once each, and runs at most once a minute.
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule('boca0-plan-tick', '*/5 * * * *', $$ select net.http_get(url := 'https://ai-calorie-tracker-gules.vercel.app/api/weekly?job=tick', timeout_milliseconds := 20000) $$);
