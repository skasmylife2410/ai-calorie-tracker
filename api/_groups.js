// api/_groups.js — group membership, the single gate for "who can see whose activity".
//
// Every endpoint that returns someone else's data must go through here: pick the group, check
// the caller is in it, and only then read that group's members. Nothing is visible across
// groups, and being signed in is never enough on its own.

import { select } from "./_rest.js";

/** Groups this person belongs to, oldest first. */
export async function myGroups(username) {
  const rows = await select("snapcal_group_members", { select: "group_id,joined_at", username: `eq.${username}`, order: "joined_at.asc", limit: "20" });
  const ids = rows.map((r) => r.group_id);
  if (ids.length === 0) return [];
  const groups = await select("snapcal_groups", { select: "id,name", id: `in.(${ids.join(",")})`, limit: "20" });
  // keep the order the person joined in, so their first group is their default
  return ids.map((id) => groups.find((g) => g.id === id)).filter(Boolean);
}

export async function membersOf(groupId) {
  const rows = await select("snapcal_group_members", { select: "username,joined_at", group_id: `eq.${groupId}`, order: "joined_at.asc", limit: "50" });
  return rows.map((r) => r.username);
}

export async function isMember(username, groupId) {
  const rows = await select("snapcal_group_members", { select: "username", group_id: `eq.${groupId}`, username: `eq.${username}`, limit: "1" });
  return rows.length > 0;
}

/**
 * Resolves which group a request is about.
 * @returns {{group:{id:string,name:string}|null, groups:Array, error?:string}}
 *   error "notMember" when they asked for a group they're not in — never leak that it exists.
 */
export async function resolveGroup(username, requested) {
  const groups = await myGroups(username);
  if (groups.length === 0) return { group: null, groups: [] };
  if (!requested) return { group: groups[0], groups };
  const match = groups.find((g) => g.id === requested);
  if (!match) return { group: null, groups, error: "notMember" };
  return { group: match, groups };
}

/** True when two people share at least one group — the test for "may I send them a note?". */
export async function sharesGroup(a, b) {
  const [ga, gb] = await Promise.all([myGroups(a), myGroups(b)]);
  const ids = new Set(gb.map((g) => g.id));
  return ga.some((g) => ids.has(g.id));
}

export function addMembership(groupId, username) {
  return import("./_rest.js").then(({ insert }) => insert("snapcal_group_members", { group_id: groupId, username }));
}
