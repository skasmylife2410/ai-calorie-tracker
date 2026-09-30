-- 0014_snapcal_gifs.sql — comments and notes can carry a GIF from GIPHY, stored as {id, w, h}
-- (never a URL: the app builds the GIPHY address from the id, see js/gif.js). Posts keep theirs
-- inside snapcal_shares.data. Nullable, so existing rows and older app versions are unaffected.
alter table public.snapcal_comments add column if not exists gif jsonb;
alter table public.snapcal_notes add column if not exists gif jsonb;

-- Words became optional when a comment could be just a photo (0012) or just a GIF, but the old
-- "body at least 1 character" checks still refused those. Now: up to 200 characters, and a row
-- needs words, a photo or a GIF.
alter table public.snapcal_comments drop constraint if exists snapcal_comments_body_check;
alter table public.snapcal_comments add constraint snapcal_comments_body_check
  check (char_length(body) <= 200 and (char_length(body) >= 1 or photo is not null or gif is not null));
alter table public.snapcal_notes drop constraint if exists snapcal_notes_body_check;
alter table public.snapcal_notes add constraint snapcal_notes_body_check
  check (char_length(body) <= 200 and (char_length(body) >= 1 or gif is not null));
