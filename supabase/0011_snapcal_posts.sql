-- 0011_snapcal_posts.sql — the Us feed takes short posts (a caption, photo optional) as well as
-- shared meals. One of either per person per day is enforced in api/shares.js.
alter table public.snapcal_shares drop constraint if exists snapcal_shares_kind_check;
alter table public.snapcal_shares add constraint snapcal_shares_kind_check check (kind in ('meal', 'idea', 'post'));
