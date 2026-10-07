// api/compare.js — read-only "Together" dashboard data. Any valid passcode (see api/_auth.js)
// can read every person's DAILY TOTALS and goals. Nothing here writes, and it never returns
// meal photos, meal names, or body stats (weight/height/age) — only numbers per day.
//
// Request:  POST { from: "YYYY-MM-DD" }   (earliest local day to include; max 90 days back)
// Response: { me, people: [{ owner, goals|null, days: { "YYYY-MM-DD": {calories, proteinG,
//             carbsG, fatG, meals, water} } }] }  |  { errorType }

import { isSafeDataImage } from "../js/safe-src.js";
import { requireUser, parseUsers, DEFAULT_OWNER } from "./_auth.js";
import { resolveGroup, membersOf } from "./_groups.js";
import { boardGoals, exerciseCredit, creditRatioFor, estimateCaloriesBurned } from "../js/nutrition.js";
import { isAdmin } from "./_members.js";


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
    console.error(`compare: select ${table} HTTP ${res.status}: ${text}`);
    throw new Error(`Couldn't read the dashboard (${res.status}).`);
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

/** Goals for the board: the person's phone's own when worked out by the current method. */
export function goalsFrom(profileData) {
  return boardGoals(profileData);
}

const num = (v) => (typeof v === "number" ? v : Number(v) || 0);

const SUMMARY_FIELDS = ["calories", "proteinG", "carbsG", "fatG", "meals", "burned", "credit", "sessions", "water", "morning", "afternoon", "evening"];
/** The day totals a person's phone reported on its profile, checked field by field. */
export function reportedDays(profileData, from = "0000-00-00") {
  const raw = profileData?.daySummaries;
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [day, s] of Object.entries(raw).slice(0, 60)) {
    if (!DAY_RE.test(day) || day < from || !s || typeof s !== "object") continue;
    const clean = {};
    for (const k of SUMMARY_FIELDS) {
      const n = Number(s[k]);
      if (Number.isFinite(n) && n >= 0 && n < 100000) clean[k] = Math.round(n);
    }
    if (Number.isFinite(clean.calories)) out[day] = clean;
  }
  return out;
}

/**
 * A workout's burn as the app estimates it now (net of resting, per person), so the board is right
 * even for someone whose phone still holds the older, higher estimate. Calories typed in from a
 * watch or machine are used as given.
 */
export function burnOf(data, body) {
  const minutes = Number(data?.minutes);
  if (data?.kcalEntered === true || !(minutes > 0) || !data?.activity) return num(data?.caloriesBurned);
  return estimateCaloriesBurned({ activity: data.activity, minutes, intensity: data.intensity, ...body });
}

export default async function handler(req, res) {
  const me = await requireUser(req, res);
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
  if (body.op === "coach" || body.op === "coachMeals") return coach(me, body, res);
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
    const displayName = typeof profile?.data?.displayName === "string" ? profile.data.displayName.trim().slice(0, 40) : "";
    const raw = profile?.data?.avatar;
    const avatar = typeof raw === "string" && isSafeDataImage(raw) && raw.length < 120000 ? raw : null;
    const d = profile?.data ?? {};
    // days a streak freeze covered, so the board counts the same streak as their Home screen
    const frozenDays = (Array.isArray(d.streak?.frozenDays) ? d.streak.frozenDays : []).filter((k) => typeof k === "string" && DAY_RE.test(k)).slice(-60);
    return { owner, name: displayName || null, avatar, goals: goalsFrom(profile?.data), creditRatio: creditRatioFor(profile?.data), frozenDays,
      body: { weightKg: d.weightKg, heightCm: d.heightCm, age: d.age, sex: d.sex }, days: {} };
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
    d.burned += burnOf(x.data, person.body);
    d.sessions += 1;
  }
  for (const w of water) {
    const person = byOwner[w.owner];
    if (person) dayOf(person, w.day).water = num(w.glasses);
  }
  for (const p of people) {
    for (const d of Object.values(p.days)) {
      for (const k of ["calories", "proteinG", "carbsG", "fatG", "burned", "morning", "afternoon", "evening"]) d[k] = Math.round(d[k]);
      // how much exercise raised that day's budget, by the person's own setting
      d.credit = exerciseCredit(d.burned, p.creditRatio);
    }
    // private: used above for the burn and credit, never sent to the group
    delete p.body;
    delete p.creditRatio;
  }
  // Where a person's phone reported its own day totals (the numbers on their Home screen), the
  // board shows those: the server's sum can lag behind or count differently.
  for (const p of people) {
    const data = profiles.find((x) => x.owner === p.owner)?.data;
    const reported = reportedDays(data, from);
    const lo = typeof data?.daySummariesFrom === "string" && DAY_RE.test(data.daySummariesFrom) ? data.daySummariesFrom : null;
    const hi = typeof data?.daySummariesTo === "string" && DAY_RE.test(data.daySummariesTo) ? data.daySummariesTo : null;
    if (lo && hi) {
      // inside the window the phone covered, a day it didn't list had nothing on it
      for (const day of Object.keys(p.days)) if (day >= lo && day <= hi && !reported[day]) delete p.days[day];
    }
    for (const [day, s] of Object.entries(reported)) p.days[day] = { ...dayOf(p, day), ...s };
  }

  res.status(200).json({ me, people, group, groups });
}

// --- Coach view ---------------------------------------------------------------------------------
// People can choose, in Profile, to share their meal log with the app's owner (their coach):
// profile.shareWithCoach. Only the owner can ask, and only for people who have it on right now —
// checked on every request, so turning it off takes effect at once.
//
// POST { op: "coach" }                       -> { ok, people: [{ owner, name, avatar, goals, sharedAt, days }] }
// POST { op: "coachMeals", owner, day }      -> { ok, meals: [...] }  one day's meals, photos included

const sharesWithCoach = (data) => data?.shareWithCoach === true;

async function coach(me, body, res) {
  if (!isAdmin(me)) return res.status(200).json({ errorType: "forbidden", message: "Only the coach can see this." });
  try {
    if (body.op === "coach") {
      const profiles = await select("snapcal_profile", { select: "owner,data", limit: "500" });
      const from = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
      const people = profiles
        .filter((p) => p.owner !== me && sharesWithCoach(p.data))
        .map((p) => {
          const d = p.data ?? {};
          const raw = d.avatar;
          return {
            owner: p.owner,
            name: typeof d.displayName === "string" ? d.displayName.trim().slice(0, 40) || null : null,
            avatar: typeof raw === "string" && isSafeDataImage(raw) && raw.length < 120000 ? raw : null,
            goals: goalsFrom(d),
            sharedAt: Number(d.shareWithCoachAt) || null,
            days: reportedDays(d, from), // their phone's own day totals, last week
          };
        })
        .sort((a, b) => String(a.name ?? a.owner).localeCompare(String(b.name ?? b.owner)));
      return res.status(200).json({ ok: true, people });
    }
    const owner = String(body.owner ?? "").toLowerCase();
    const day = typeof body.day === "string" && DAY_RE.test(body.day) ? body.day : null;
    if (!owner || !day) return res.status(200).json({ errorType: "other", message: "Pick a person and a day." });
    const [profile] = await select("snapcal_profile", { select: "data", owner: `eq.${owner}`, limit: "1" });
    if (!sharesWithCoach(profile?.data)) return res.status(200).json({ errorType: "forbidden", message: "This person isn't sharing their log." });
    const rows = await select("snapcal_food_entries", { select: "data", owner: `eq.${owner}`, deleted: "is.false", day: `eq.${day}`, limit: "200" });
    const meals = rows.map((r) => coachMeal(r.data)).filter(Boolean).sort((a, b) => a.ts - b.ts);
    return res.status(200).json({ ok: true, meals, goals: goalsFrom(profile.data) });
  } catch (err) {
    return res.status(200).json({ errorType: "other", message: err?.message ?? String(err) });
  }
}

/** One meal as the coach sees it: what, when, how much, the photo, and its foods. */
export function coachMeal(d) {
  if (!d || typeof d !== "object" || d.isPending === true) return null;
  const n = (v) => Math.round((Number(v) || 0) * 10) / 10;
  const photo = typeof d.photoDataUrl === "string" && isSafeDataImage(d.photoDataUrl) && d.photoDataUrl.length < 1500000 ? d.photoDataUrl : null;
  return {
    id: String(d.id ?? ""),
    ts: Number(d.timestamp) || 0,
    name: String(d.name ?? "").slice(0, 120),
    calories: Math.round(Number(d.calories) || 0),
    proteinG: n(d.proteinG), carbsG: n(d.carbsG), fatG: n(d.fatG),
    servings: Number(d.servings) || 1,
    source: typeof d.source === "string" ? d.source : null,
    photo,
    leftoverKcal: Math.round(Number(d.leftovers?.removedKcal) || 0) || null,
    items: Array.isArray(d.analysisItems)
      ? d.analysisItems.slice(0, 20).map((i) => ({ name: String(i?.name ?? "").slice(0, 80), grams: Math.round(Number(i?.gramsEstimate) || 0), calories: Math.round(Number(i?.calories) || 0) }))
      : [],
  };
}
