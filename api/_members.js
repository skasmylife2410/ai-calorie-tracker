// api/_members.js — who may manage the group, and how big it can get.

/** Total accounts allowed. Three original members + five invited. MAX_USERS in Vercel overrides. */
export function maxUsers() {
  const n = Number(process.env.MAX_USERS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8;
}

/** People who can create invite links. ADMIN_USERS in Vercel overrides (comma-separated). */
export function isAdmin(username) {
  const list = (process.env.ADMIN_USERS || "aelson").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(username ?? "").toLowerCase());
}

export const INVITE_DAYS = 7;
