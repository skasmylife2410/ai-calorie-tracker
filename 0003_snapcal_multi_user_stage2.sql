-- SnapCal — multi-user, stage 2 of 2. Run only AFTER the multi-user api/ code is deployed
-- (the old single-user code upserts on water.day / profile.id and stops working after this).
alter table public.snapcal_water drop constraint snapcal_water_pkey;
alter table public.snapcal_water add constraint snapcal_water_pkey primary key using index snapcal_water_owner_day_key;

alter table public.snapcal_profile drop constraint snapcal_profile_pkey;
alter table public.snapcal_profile drop column id;
alter table public.snapcal_profile add constraint snapcal_profile_pkey primary key using index snapcal_profile_owner_key;

-- From now on every row must say whose it is.
alter table public.snapcal_food_entries alter column owner drop default;
alter table public.snapcal_water        alter column owner drop default;
alter table public.snapcal_profile      alter column owner drop default;

comment on table public.snapcal_profile is 'SnapCal per-person profile/goals JSON, one row per owner.';
comment on table public.snapcal_water is 'SnapCal daily water glasses count, one row per owner per day.';
