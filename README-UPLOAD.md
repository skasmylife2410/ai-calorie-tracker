# SnapCal — full update

Everything currently built, in one folder. Safe to upload over what is live: nothing here
needs deleting first, and js/ui/saved.js is included so no file is ever missing mid-upload.

## Upload

1. https://github.com/skasmylife2410/ai-calorie-tracker/upload/main
   (path above the drop area must read just `ai-calorie-tracker /`)
2. Open this folder in Finder, Cmd+A, drag the selection on.
3. Check the list shows FOLDER PATHS (js/ui/weight.js, i18n/es.json). Bare names = Safari
   flattened them; use Chrome.
4. Commit to main. Vercel redeploys itself.

## Database

Nothing to run. All six migrations are already applied to your Supabase project; the .sql
files are here only as a record of what the schema is.

## Vercel variables (already set, listed for reference)

    APP_SECRET    signs sign-in sessions; changing it signs everyone out
    INVITE_CODE   needed to create an account
    MAX_USERS     optional, defaults to 3

APP_USERS can be deleted once all three of you have signed in with a username.

## What's new since the last zip

- Week navigation: arrows above the day strip, so past weeks are reachable and editable
- Meals moved off the dashboard into a sheet, opened from "See meals" on the calorie card
- Weight tab: 7-day average, trend chart, kg/lb, history, syncs between phones
- Profile tab restored (four tabs, two either side of +) and a proper scale icon
- Us: rebuilt for up to five people, sparklines for 3+, polish pass
- Colour through the app: calories orange, exercise green, ideas amber, weight violet
- Accounts: username + password, sign-up capped at 3, password change in Profile

## Known gaps

- Onboarding screens are still English only
- No rate limit on login attempts yet
- Meal photos live in the database rather than storage
