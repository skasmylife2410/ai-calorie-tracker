// api/compare.js — read-only "Together" dashboard data. Any valid passcode (see api/_auth.js)
// can read every person's DAILY TOTALS and goals. Nothing here writes, and it never returns
// meal photos, meal names, or body stats (weight/height/age) — only numbers per day.
//
// Request:  POST { from: "YYYY-MM-DD" }   (earliest local day to include; max 90 days back)
// Response: { me, people: [{ owner, goals|null, days: { "YYYY-MM-DD": {calories, proteinG,
//             carbsG, fatG, meals, water} } }] }  |  { errorType }

import { checkAuth, parseUsers, DEFAULT_OWNER } from "./_auth.js";
import { resolveGroup, membersOf } from "./_groups.js";
import { resolveUserGoals } from "../js/nutrition.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function restBase() {
  return (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
}

function restHeaders() {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const headers = { apikey: key };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function select(table, params) {
  const res = await fetch(`${restBase()}/rest/v1/${table}?${new URLSearchParams(params).toString()}`, {
    headers: restHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase select ${table} HTTP ${res.status}: ${text}`);
  }
  return await res.json();
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

function goalsFrom(profileData) {
  if (!profileData || typeof profileData !== "object") return null;
  try {
    const g = resolveUserGoals(profileData);
    const ok = [g.targetCalories, g.proteinTargetG, g.carbsTargetG, g.fatTargetG].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n > 0
    );
    if (!ok) return null;
    return {
      calories: Math.round(g.targetCalories),
      proteinG: Math.round(g.proteinTargetG),
      carbsG: Math.round(g.carbsTargetG),
      fatG: Math.round(g.fatTargetG),
    };
  } catch {
    return null;
  }
}

const num = (v) => (typeof v === "number" ? v : Number(v) || 0);

export default async function handler(req, res) {
  const me = checkAuth(req, res);
  if (!me) return;

  if (req.method !== "POST") {
    res.status(405).json({ errorType: "other", message: "Method not allowed" });
    return;
  }
  if (!restBase() || !restHeaders().apikey) {
    res.status(200).json({ errorType: "unconfigured" });
    return;
  }

  const body = parseBody(req);
  const earliest = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  let from = typeof body.from === "string" && DAY_RE.test(body.from) ? body.from : earliest;
  if (from < earliest) from = earliest;

  // Who appears on this dashboard: the members of ONE group the caller belongs to. Nothing
  // from another group is ever read, so people in different groups can't see each other.
  let owners = [];
  let group = null;
  let groups = [];
  try {
    const resolved = await resolveGroup(me, typeof body.group === "string" ? body.group : null);
    if (resolved.error === "notMember") {
      res.status(200).json({ errorType: "notMember", message: "You're not in that group." });
      return;
    }
    group = resolved.group;
    groups = resolved.groups;
    if (group) owners = await membersOf(group.id);
  } catch (err) {
    res.status(200).json({ errorType: "other", message: `Couldn't read your groups: ${err?.message ?? err}` });
    return;
  }
  // Fail closed. This used to fall back to "every account in the app" when someone had no
  // group — which handed the whole board to anyone who signed up with the shared code. Now a
  // person with no group sees only themselves, and the app tells them to ask for an invite.
  if (owners.length === 0) owners = [me];
  const ownerFilter = `in.(${owners.join(",")})`;

  let entries, water, exercise, profiles;
  try {
    [entries, water, exercise, profiles] = await Promise.all([
      select("snapcal_food_entries", {
        select: "owner,day,calories,protein_g,carbs_g,fat_g,ts:data->>timestamp",
        owner: ownerFilter,
        deleted: "is.false",
        day: `gte.${from}`,
        limit: "5000",
      }),
      select("snapcal_water", { select: "owner,day,glasses", owner: ownerFilter, day: `gte.${from}` }),
      select("snapcal_exercise", { select: "owner,day,data", owner: ownerFilter, day: `gte.${from}`, limit: "2000" }),
      select("snapcal_profile", { select: "owner,data", owner: ownerFilter }),
    ]);
  } catch (err) {
    res.status(200).json({ errorType: "other", message: err?.message ?? String(err) });
    return;
  }

  const people = owners.map((owner) => {
    const profile = profiles.find((p) => p.owner === owner);
    // Only accept a small JPEG/PNG data URL — never an arbitrary URL, which could be used to
    // make everyone's phone fetch something from elsewhere.
    const raw = profile?.data?.avatar;
    const avatar = typeof raw === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(raw) && raw.length < 120000 ? raw : null;
    return { owner, avatar, goals: goalsFrom(profile?.data), days: {} };
  });
  const byOwner = Object.fromEntries(people.map((p) => [p.owner, p]));
  const dayOf = (person, day) =>
    (person.days[day] ??= {
      calories: 0, proteinG: 0, carbsG: 0, fatG: 0, meals: 0, water: 0, burned: 0, sessions: 0,
      // the same calories, split by when they were eaten
      morning: 0, afternoon: 0, evening: 0,
    });

/** Which part of the day a meal belongs to: before 11, before 17, or after. */
function partOfDay(timestamp) {
  const hour = new Date(Number(timestamp) || 0).getHours();
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

  for (const e of entries) {
    const person = byOwner[e.owner];
    if (!person) continue;
    const d = dayOf(person, e.day);
    d.calories += num(e.calories);
    d.proteinG += num(e.protein_g);
    d.carbsG += num(e.carbs_g);
    d.fatG += num(e.fat_g);
    d.meals += 1;
    d[partOfDay(e.ts)] += num(e.calories);
  }
  for (const x of exercise) {
    const person = byOwner[x.owner];
    if (!person) continue;
    const d = dayOf(person, x.day);
    d.burned += num(x.data?.caloriesBurned);
    d.sessions += 1;
  }
  for (const w of water) {
    const person = byOwner[w.owner];
    if (person) dayOf(person, w.day).water = num(w.glasses);
  }
  for (const p of people) {
    for (const d of Object.values(p.days)) {
      for (const k of ["calories", "proteinG", "carbsG", "fatG", "burned", "morning", "afternoon", "evening"]) d[k] = Math.round(d[k]);
    }
  }

  res.status(200).json({ me, people, group, groups });
}
