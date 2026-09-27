// api/_members.js — who may manage the group, and how big it can get.

/** Total accounts allowed. Three original members + five invited. MAX_USERS in Vercel overrides. */
export function maxUsers() {
  const n = Number(process.env.MAX_USERS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8;
}

/**
 * The one account that can invite, remove people and manage groups. Fixed in code on purpose:
 * an environment variable could quietly hand these powers to someone else.
 */
export const ADMIN = "aelson";

export function isAdmin(username) {
  return String(username ?? "").toLowerCase() === ADMIN;
}

export const INVITE_DAYS = 7;
