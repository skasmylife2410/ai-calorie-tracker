# SnapCal update — upload instructions

Everything in this folder goes into your repo, keeping the folder structure.

## 1. Upload the code (2 minutes)

1. Unzip this folder.
2. Open https://github.com/skasmylife2410/ai-calorie-tracker/upload/main
   (top level of the repo — the path above the drop area should read just `ai-calorie-tracker /`)
3. Select everything INSIDE `snapcal-update` (api, css, i18n, js, supabase, tests, us.html)
   and drag it onto the page. Do not drag the `snapcal-update` folder itself.
4. Check the file list shows paths like `js/ui/exercise.js` and `i18n/es.json`, not bare names.
5. Commit to main. Vercel redeploys on its own.
6. Delete the old renamed files — see DELETE-THESE.txt.

## 2. Run the database migration (1 minute)

In Supabase → SQL Editor, paste and run `supabase/0004_snapcal_exercise_favorites.sql`.
This creates the two tables that let exercise and favourites sync between phones.
(0002 and 0003 are already applied — they're here only as a record.)

Nothing else to change: no new environment variables, no Vercel settings.

## 3. What to check on your phone

- The Home screen shows the doodle, an Exercise section and an Ideas card
- Tap a past day in the week strip — you can add meals to it
- Open a meal: servings stepper (− 1 +) and a heart
- Profile → Language switches everything to Spanish
- Progress → "Together" opens the Us page

## Known gaps

- Sync carries exercise and favourites only after the migration in step 2.
- Onboarding screens are still English-only.
