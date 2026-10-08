// build.js — which deploy this copy of the app's code came from. Always the same value as
// CACHE_VERSION in sw.js (tests/sw.test.mjs checks): the updater compares it with the newest
// sw.js on the server to know whether the code on screen is old (js/updater.js).
export const BUILD = "snapcal-v73";
