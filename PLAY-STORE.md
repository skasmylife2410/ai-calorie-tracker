# Bocado on Google Play

Bocado goes on Google Play as a Trusted Web Activity: the same web app, packaged by
PWABuilder (pwabuilder.com) or Bubblewrap. Updates keep coming from Vercel; a new upload is
only needed to change the Android package itself (name, icon, version).

## What the app already has

| Play asks for | Where it is |
|---|---|
| Privacy policy URL | `https://ai-calorie-tracker-gules.vercel.app/privacy.html` |
| Account deletion URL | `https://ai-calorie-tracker-gules.vercel.app/delete-account.html` (works without the app) |
| In-app account deletion | Profile → Privacy → Delete my account |
| Digital Asset Links | `/.well-known/assetlinks.json` (fingerprint still to add, below) |
| Web app manifest | `/manifest.webmanifest`: id, scope, categories, portrait, icons (the 512 icon is safe for Android's round crop) |
| Package name | `app.bocado.diario`: permanent once the app exists in the Play Console |

## Steps

1. **Contact email:** skasmylife2410@gmail.com is in the privacy policy and on the deletion
   page. Use the same address as the Play listing's developer email.
2. **Play Console.** Create the developer account ($25 once) and an app called Bocado.
3. **PWABuilder.** Enter the site address, choose Android, package ID `app.bocado.diario`,
   and let it create the signing key. Keep the key file and its passwords somewhere safe.
4. **Fingerprint.** In the Play Console: Setup → App signing → "SHA-256 certificate
   fingerprint" (the app signing key, not the upload key). Put it in
   `.well-known/assetlinks.json` under `sha256_cert_fingerprints`, publish, and the address
   bar disappears from the Android app.
5. **Forms.** Data safety, Health apps declaration, Content rating, Target audience (18+).
   The Data safety answers follow `privacy.html` sections 1 and 3: health and fitness data,
   photos, audio (voice notes), app activity; collected, not sold or shared for ads;
   encrypted in transit; deletion available.
6. **Closed test.** New personal developer accounts need at least 12 testers opted in for 14
   days before applying for production. The current group can be the testers.

## Payments (later)

Subscriptions sold inside the Android app must use Google Play Billing (15% under $1M a
year). A Trusted Web Activity reaches it through the Digital Goods API.
