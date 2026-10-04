# 0015_snapcal_rls_everywhere — applied

- Date: 2026-10-04
- Project: `mtcgbdoflagueadqfywy`
- Tool: Supabase MCP `apply_migration`, name `snapcal_rls_everywhere`, with the 19
  `alter table if exists ... enable row level security` statements from
  `supabase/0015_snapcal_rls_everywhere.sql`.
- Result: `{"success":true}` — no errors.

## Verification

`select relname, relrowsecurity from pg_class where relname like 'snapcal_%' and relkind = 'r' order by relname;`

| relname                 | relrowsecurity |
|-------------------------|----------------|
| snapcal_auth_failures   | true           |
| snapcal_client_errors   | true           |
| snapcal_comments        | true           |
| snapcal_exercise        | true           |
| snapcal_favorites       | true           |
| snapcal_food_entries    | true           |
| snapcal_group_members   | true           |
| snapcal_groups          | true           |
| snapcal_invites         | true           |
| snapcal_notes           | true           |
| snapcal_password_resets | true           |
| snapcal_profile         | true           |
| snapcal_push_subs       | true           |
| snapcal_recaps          | true           |
| snapcal_shares          | true           |
| snapcal_suggestions     | true           |
| snapcal_users           | true           |
| snapcal_water           | true           |
| snapcal_weight          | true           |

19 tables, all `true`.

## Counts (read-only)

| query                                                     | result |
|-----------------------------------------------------------|--------|
| `select count(*) as users from public.snapcal_users;`         | 11     |
| `select count(*) as push_subs from public.snapcal_push_subs;` | 8      |
