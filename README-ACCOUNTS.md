# SnapCal — usernames and passwords

Upload these files the same way as before:
https://github.com/skasmylife2410/ai-calorie-tracker/upload/main  (Cmd+A inside this folder, drag, commit)

## Two environment variables in Vercel (Settings -> Environment Variables)

    APP_SECRET    any long random string — it signs the sign-in sessions
    INVITE_CODE   a word you share with someone you want to let in

Add both, save, then Deployments -> ... -> Redeploy.

- Changing APP_SECRET later signs everyone out. That is the "log everyone out" button.
- Without INVITE_CODE nobody can create an account, since the app is on a public URL.
- LEAVE APP_USERS IN PLACE for now: phones that haven't signed in yet keep working on the old
  passcode. Delete it once all three of you have signed in with a username.

## Accounts are already created in the database

The table is seeded, and each account is flagged to change its password on first sign-in.
Starter passwords are in the chat — change them once you're in (Profile -> Account).

## What people see

- Opening the app asks for username and password, with "Create account" underneath
- Profile -> Account shows who you are, changes your password, and signs out
- Forgotten passwords: I can reset one in seconds; there is no reset email in this version
