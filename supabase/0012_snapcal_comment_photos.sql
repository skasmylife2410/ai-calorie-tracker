-- 0012_snapcal_comment_photos.sql — a comment on a Shared post can carry one small photo
-- (shrunk on the phone to ~480px WebP/JPEG, size-checked in api/shares.js). Nullable, so every
-- existing comment and the code that doesn't know about photos keep working unchanged.
alter table public.snapcal_comments add column if not exists photo text;
