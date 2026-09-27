// api/_account-data.js — "Download my data" and "Delete my account".
//
// Every table that holds something about a person is listed here once, with the column that
// says whose it is. Export reads them all; delete removes them all. Adding a table to the app
// means adding it here, or it won't be exported or deleted.

import { select, remove, patch } from "./_rest.js";

const OWNED = [
  ["snapcal_profile", "owner"],
  ["snapcal_food_entries", "owner"],
  ["snapcal_water", "owner"],
  ["snapcal_exercise", "owner"],
  ["snapcal_weight", "owner"],
  ["snapcal_favorites", "owner"],
  ["snapcal_recaps", "owner"],
  ["snapcal_shares", "owner"],
  ["snapcal_comments", "owner"],
  ["snapcal_suggestions", "owner"],
  ["snapcal_notes", "from_user"],
  ["snapcal_notes", "to_user"],
  ["snapcal_group_members", "username"],
];

/** Everything stored about `username`, minus secrets (password hash, salt, push keys). */
export async function exportAccount(username) {
  const [user] = await select("snapcal_users", { select: "username,email,created_at,consent_version,consent_at", username: `eq.${username}`, limit: "1" });
  const out = { exportedAt: new Date().toISOString(), account: user ?? null };
  for (const [table, col] of OWNED) {
    const key = table === "snapcal_notes" ? `notes_${col === "from_user" ? "sent" : "received"}` : table.replace("snapcal_", "");
    out[key] = await select(table, { select: "*", [col]: `eq.${username}`, limit: "20000" });
  }
  out.push_devices = await select("snapcal_push_subs", { select: "lang,created_at,last_ok_at", owner: `eq.${username}` });
  return out;
}

/** Removes the account and everything it owns. Groups other people are in stay. */
export async function deleteAccount(username) {
  for (const [table, col] of OWNED) await remove(table, { [col]: `eq.${username}` });
  await remove("snapcal_push_subs", { owner: `eq.${username}` });
  await remove("snapcal_invites", { created_by: `eq.${username}`, used_by: "is.null" }); // their open links
  await patch("snapcal_invites", { used_by: `eq.${username}` }, { used_by: "deleted" });  // keep the link spent
  await remove("snapcal_auth_failures", { key: `eq.user:${username}` });
  await remove("snapcal_users", { username: `eq.${username}` }); // reset links go with it (cascade)
}
