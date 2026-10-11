-- 0016_snapcal_barcodes.sql — the scanner's own barcode memory and its hit rate (api/foods.js).
-- snapcal_barcodes: a product someone typed in after a scan found nothing, under the code's one
-- spelling (js/api.js canonicalBarcode); the next scan of that code, by anyone, finds it.
-- snapcal_barcode_lookups: one row per lookup (code, result, which source answered, time taken;
-- no account name) to measure how often a scan finds its product.
create table if not exists public.snapcal_barcodes (
  code text primary key,
  product jsonb not null,
  owner text not null,
  updated_at timestamptz not null default now()
);
alter table public.snapcal_barcodes enable row level security;
revoke all on table public.snapcal_barcodes from anon, authenticated;

create table if not exists public.snapcal_barcode_lookups (
  id bigserial primary key,
  at timestamptz not null default now(),
  code text not null,
  status text not null,
  source text,
  ms integer
);
create index if not exists snapcal_barcode_lookups_at on public.snapcal_barcode_lookups (at desc);
alter table public.snapcal_barcode_lookups enable row level security;
revoke all on table public.snapcal_barcode_lookups from anon, authenticated;
revoke all on sequence public.snapcal_barcode_lookups_id_seq from anon, authenticated;
