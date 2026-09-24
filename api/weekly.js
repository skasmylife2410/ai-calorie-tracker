// api/weekly.js — the daily housekeeping job and each person's Friday recommendation.
//
// GET  (Vercel cron, daily)   Authorization: Bearer $CRON_SECRET
//      Every day: deletes feed posts older than 7 days (their comments go with them).
//      On Fridays (America/Chicago): writes a recommendation for every account from its last 7 days.
//      ?force=1 writes the recommendations today regardless of weekday (still needs the secret).
// POST { op: "mine" }  -> { ok, recap|null }   your own latest recommendation. Private: nobody
//                                               else's is ever returned, whatever the group.
//
// One Vercel function for both jobs keeps the project under the Hobby plan's function limit.

import { checkAuth } from "./_auth.js";
import { select, remove, restBase, restHeaders, parseBody } from "./_rest.js";
import { resolveUserGoals } from "../js/nutrition.js";
import { weekWindow, localWeekday, summarizeWeek, candidateMeals, buildPrompt, cleanRecap, RECAP_SCHEMA, localDay } from "./_week.js";

const MODEL_ID = "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;
export const FEED_DAYS = 7;

const fail = (res, errorType, message, status = 200) => res.status(status).json({ ok: false, errorType, message });

async function upsert(table, row) {
  const r = await fetch(`${restBase()}/rest/v1/${table}`, {
    method: "POST",
    headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([row]),
  });
  if (!r.ok) throw new Error(`Supabase ${table} upsert failed (${r.status})`);
}

async function askGemini(prompt) {
  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_BACKUP].map((k) => (k || "").trim()).filter(Boolean);
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: RECAP_SCHEMA, temperature: 0.4 },
  });
  let last = "no Gemini key";
  for (const key of keys) {
    try {
      const r = await fetch(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body });
      if (!r.ok) { last = `Gemini HTTP ${r.status}`; continue; }
      const json = await r.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch (err) {
      last = err?.message ?? String(err);
    }
  }
  throw new Error(last);
}

function goalsFrom(profile) {
  try {
    const g = resolveUserGoals(profile ?? {});
    if (!(g.targetCalories > 0)) return null;
    return { calories: Math.round(g.targetCalories), proteinG: Math.round(g.proteinTargetG) };
  } catch {
    return null;
  }
}

/** Builds and stores one person's recommendation for the week that ended yesterday. */
export async function recapFor(owner, win) {
  const range = { day: `gte.${win.start}`, and: `(day.lte.${win.end})` };
  const [meals, exercise, weights, profiles] = await Promise.all([
    // columns only — never `data`, which holds the meal photo
    select("snapcal_food_entries", { select: "id,day,logged_at,name,calories,protein_g", owner: `eq.${owner}`, deleted: "eq.false", ...range, limit: "300" }),
    select("snapcal_exercise", { select: "day,data", owner: `eq.${owner}`, ...range, limit: "100" }),
    select("snapcal_weight", { select: "day,data", owner: `eq.${owner}`, ...range, limit: "30" }),
    select("snapcal_profile", { select: "data", owner: `eq.${owner}`, limit: "1" }),
  ]);
  const profile = profiles[0]?.data ?? {};
  const stats = summarizeWeek({ meals, exercise, weights, goals: goalsFrom(profile), profile });
  const { days, ...shownStats } = stats;

  let recap = { headline: "", tips: [] };
  if (stats.enough) {
    const candidates = candidateMeals(meals);
    const raw = await askGemini(buildPrompt({ name: profile.displayName, language: profile.language, stats, candidates }));
    recap = cleanRecap(raw, candidates);
  }
  const data = { weekStart: win.start, weekEnd: win.end, stats: { ...shownStats, days }, ...recap, createdAt: new Date().toISOString() };
  await upsert("snapcal_recaps", { owner, week_start: win.start, data });
  return data;
}

export async function purgeOldPosts(now = Date.now()) {
  const cutoff = new Date(now - FEED_DAYS * 86400000).toISOString();
  await remove("snapcal_shares", { created_at: `lt.${cutoff}` }); // comments cascade
  return cutoff;
}

export default async function handler(req, res) {
  if (!restBase()) return fail(res, "unconfigured", "Needs Supabase configured.");

  if (req.method === "GET") {
    const secret = (process.env.CRON_SECRET || "").trim();
    if (!secret || req.headers?.authorization !== `Bearer ${secret}`) return fail(res, "auth", "Not allowed.", 401);
    const now = new Date();
    const out = { ok: true, purgedBefore: await purgeOldPosts(now.getTime()), recaps: [] };
    const force = String(req.query?.force ?? "") === "1";
    if (force || localWeekday(now) === 5) {
      const win = weekWindow(now);
      const users = await select("snapcal_users", { select: "username" });
      const results = await Promise.allSettled(users.map((u) => recapFor(u.username, win)));
      out.recaps = results.map((r, i) => ({ owner: users[i].username, ok: r.status === "fulfilled", ...(r.status === "rejected" ? { error: String(r.reason?.message ?? r.reason) } : { tips: r.value.tips.length }) }));
    }
    return res.status(200).json(out);
  }

  const me = checkAuth(req, res);
  if (!me) return;
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  const body = parseBody(req);
  if (String(body.op ?? "mine") !== "mine") return fail(res, "other", "Unknown operation.");
  try {
    // only ever filtered by the signed-in owner: recommendations are private
    const rows = await select("snapcal_recaps", { select: "week_start,data", owner: `eq.${me}`, order: "week_start.desc", limit: "1" });
    const recap = rows[0]?.data ?? null;
    // shown until the next Friday's replaces it; older than 8 days means the job missed a week
    const fresh = recap && localDay(new Date()) <= addDays(recap.weekEnd, 8);
    return res.status(200).json({ ok: true, recap: fresh ? recap : null });
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}

function addDays(day, k) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}
