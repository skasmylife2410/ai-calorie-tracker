-- 0010_snapcal_consent.sql — record who agreed to which version of the privacy policy, and when.
-- The app asks again whenever the policy version (api/_policy.js) changes.
alter table public.snapcal_users add column if not exists consent_version text;
alter table public.snapcal_users add column if not exists consent_at timestamptz;
