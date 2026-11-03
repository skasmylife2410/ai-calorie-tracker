// api/_audit.js — a trail of security events (ISO 27001 A.8.15 logging).
//
// One JSON line per event in the function logs: sign-ins, failures, lockouts, password and email
// changes, resets, sign-ups and deletions. Never passwords, tokens or reset links. Vercel keeps
// function logs only briefly, so for a longer trail add a Log Drain in Vercel (Settings -> Drains);
// every line starts with {"audit": so a drain can filter on it.

export function audit(event, fields = {}) {
  try {
    console.info(JSON.stringify({ audit: event, at: new Date().toISOString(), ...fields }));
  } catch {
    // logging must never break a sign-in
  }
}
