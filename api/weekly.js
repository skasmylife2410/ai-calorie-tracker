// api/weekly.js — the daily housekeeping job and each person's Friday recommendation.
//
// GET  (Vercel cron, daily)   Authorization: Bearer $CRON_SECRET
//      Every day: deletes feed posts older than 7 days (their comments go with them), and nudges
//      anyone who hasn't logged a meal in 24 hours (see nudgeDue for how often).
//      On Fridays (America/Chicago): writes a recommendation for every account from its last 7 days.
//      ?force=1 writes the recommendations today regardless of weekday (still needs the secret).
// POST { op: "mine", lang } -> { ok, recap|null }  your own latest recommendation, text in `lang`
//                                               (en|es). Private: nobody else's is ever returned.
//                                               A recap written before it came in both languages
//                                               is translated once on first read and saved.
//
// One Vercel function for both jobs keeps the project under the Hobby plan's function limit.

import { requireUser } from "./_auth.js";
import { notify } from "./_push.js";
import { select, remove, restBase, restHeaders, parseBody } from "./_rest.js";
import { boardGoals, GOALS_VERSION, streakFromDays } from "../js/nutrition.js";
import { weekWindow, localWeekday, summarizeWeek, candidateMeals, buildPrompt, cleanRecap, RECAP_SCHEMA, TRANSLATE_SCHEMA, translatePrompt, textIn, localDay } from "./_week.js";

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

async function askGemini(prompt, schema = RECAP_SCHEMA) {
  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_BACKUP].map((k) => (k || "").trim()).filter(Boolean);
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4 },
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

/** The same goals the person sees in the app (current method, learned maintenance included). */
function goalsFrom(profile) {
  return boardGoals(profile ?? {});
}

// One-time notice about the new way goals are worked out (GOALS_VERSION 2), sent by the daily job
// on this day only; the details, with each person's own before and after, are in the app.
export const GOALS_NOTICE_DAY = "2026-10-04";
export function goalsNotice(lang) {
  return lang === "es"
    ? { title: "Actualizamos tus metas", body: "Mejoramos cómo calculamos tus calorías y macros. Toca para ver tus números nuevos y por qué cambiaron.", url: "/?goals=1", tag: "goals" }
    : { title: "Your targets were updated", body: "We improved how your calories and macros are worked out. Tap to see your new numbers and why they changed.", url: "/?goals=1", tag: "goals" };
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
    const raw = await askGemini(buildPrompt({ name: profile.displayName, stats, candidates }));
    recap = cleanRecap(raw, candidates);
  }
  const data = { weekStart: win.start, weekEnd: win.end, stats: { ...shownStats, days }, ...recap, goalsV: GOALS_VERSION, createdAt: new Date().toISOString() };
  await upsert("snapcal_recaps", { owner, week_start: win.start, data });
  return data;
}

/**
 * People whose streak (2+ days) ends at midnight because nothing is logged today yet, as
 * { owner, streak, freezes }. Days are the app's local days (America/Chicago, like the rest of
 * this job); freezes come from each person's profile, so the count matches their Home screen.
 */
export function streaksAtRisk({ rows, profiles, today }) {
  const days = new Map();
  for (const r of rows) {
    if (!days.has(r.owner)) days.set(r.owner, new Set());
    days.get(r.owner).add(r.day);
  }
  const out = [];
  for (const p of profiles) {
    const logged = days.get(p.owner);
    if (!logged || logged.has(today)) continue;
    const st = p.streak && typeof p.streak === "object" ? p.streak : {};
    const n = streakFromDays(logged, Array.isArray(st.frozenDays) ? st.frozenDays : [], today);
    if (n >= 2) out.push({ owner: p.owner, name: p.name || null, streak: n, freezes: Number(st.freezes) || 0 });
  }
  return out;
}

/** The evening reminder: "your 12-day streak ends tonight", only to people it applies to. */
export async function streakReminders(now = Date.now()) {
  const today = localDay(new Date(now));
  const [rows, profiles] = await Promise.all([
    select("snapcal_food_entries", { select: "owner,day", deleted: "is.false", day: `gte.${addDays(today, -400)}`, limit: "50000" }),
    select("snapcal_profile", { select: "owner,name:data->>displayName,streak:data->streak" }),
  ]);
  const due = streaksAtRisk({ rows, profiles, today });
  let sent = 0;
  for (const p of due) {
    const name = String(p.name ?? "").trim() || p.owner.replace(/^./, (c) => c.toUpperCase());
    const out = await notify([p.owner], (lang) => ({
      title: lang === "es" ? `${name}, tu racha de ${p.streak} días acaba esta noche` : `${name}, your ${p.streak}-day streak ends tonight`,
      body: p.freezes > 0
        ? (lang === "es" ? "Tienes una protección guardada, pero una comida la mantiene sin gastarla." : "You have a freeze saved, but one meal keeps it without using it.")
        : (lang === "es" ? "Registra una comida antes de medianoche para mantenerla." : "Log one meal before midnight to keep it."),
      url: "/",
      tag: "streak",
    }));
    sent += out?.sent ?? 0;
  }
  return { due: due.length, sent };
}

/**
 * A recap written against targets the person no longer has (before the current method, or before
 * their targets moved): its "under" and "over" would judge the week by the wrong numbers.
 */
export function recapIsStale(recap, goals) {
  if (!recap?.stats || !goals) return false;
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const off = (a, b) => Number.isFinite(num(a)) && Number.isFinite(num(b)) && Math.abs(num(a) - num(b)) > 2;
  return off(recap.stats.targetCalories, goals.calories) || off(recap.stats.targetProteinG, goals.proteinG);
}

/**
 * Should someone who last logged `hoursSince` hours ago get a reminder today (the job runs once a
 * day)? Daily for the first 3 days, then every third day, never after 2 weeks: a nudge, not nagging.
 */
export function nudgeDue(hoursSince) {
  if (!Number.isFinite(hoursSince) || hoursSince < 24) return false;
  const days = Math.floor(hoursSince / 24);
  if (days > 14) return false;
  return days <= 3 || days % 3 === 0;
}

/** Reminds people with no meal logged in the last 24 hours (only phones with notifications on). */
export async function nudgeInactive(now = Date.now()) {
  const since = new Date(now - 15 * 86400000).toISOString();
  const [users, rows, profiles] = await Promise.all([
    select("snapcal_users", { select: "username" }),
    select("snapcal_food_entries", { select: "owner,logged_at", deleted: "is.false", logged_at: `gte.${since}`, order: "logged_at.desc", limit: "5000" }),
    select("snapcal_profile", { select: "owner,name:data->>displayName" }).catch(() => []),
  ]);
  const last = new Map();
  for (const r of rows) {
    const t = Date.parse(r.logged_at);
    if (Number.isFinite(t) && t <= now && t > (last.get(r.owner) ?? 0)) last.set(r.owner, t);
  }
  const due = users.map((u) => u.username).filter((u) => last.has(u) && nudgeDue((now - last.get(u)) / 3600000));
  const nameOf = (u) => {
    const n = String(profiles.find((p) => p.owner === u)?.name ?? "").trim();
    return n || u.replace(/[-_]\d*$/, "").replace(/\d+$/, "").replace(/^./, (c) => c.toUpperCase());
  };
  let sent = 0;
  for (const u of due) {
    const days = Math.floor((now - last.get(u)) / 86400000);
    const name = nameOf(u);
    const out = await notify([u], (lang) => ({
      title: lang === "es" ? `${name}, ¿qué comiste hoy?` : `${name}, what did you eat today?`,
      body: days <= 1
        ? (lang === "es" ? "Un día sin registrar. Una foto y listo: SnapCal hace el resto." : "A day without logging. One photo is all it takes: SnapCal does the rest.")
        : (lang === "es" ? `${days} días sin registrar. Retómalo con tu próxima comida, sin culpa.` : `${days} days without logging. Pick it back up with your next meal, no guilt.`),
      url: "/",
      tag: "nudge",
    }));
    sent += out?.sent ?? 0;
  }
  return { due: due.length, sent };
}

export async function purgeOldPosts(now = Date.now()) {
  const cutoff = new Date(now - FEED_DAYS * 86400000).toISOString();
  await remove("snapcal_shares", { created_at: `lt.${cutoff}` }); // comments cascade
  // failed sign-in records only matter for 15 minutes; keep a day for looking back
  await remove("snapcal_auth_failures", { at: `lt.${new Date(now - 86400000).toISOString()}` }).catch(() => {});
  await remove("snapcal_password_resets", { expires_at: `lt.${new Date(now - 86400000).toISOString()}` }).catch(() => {});
  return cutoff;
}

export default async function handler(req, res) {
  if (!restBase()) return fail(res, "unconfigured", "Needs Supabase configured.");

  if (req.method === "GET") {
    const secret = (process.env.CRON_SECRET || "").trim();
    if (!secret || req.headers?.authorization !== `Bearer ${secret}`) return fail(res, "auth", "Not allowed.", 401);
    const now = new Date();
    // the evening run (second cron, ~7:30pm): only the streak reminder
    if (String(req.query?.job ?? new URL(req.url, "http://x").searchParams.get("job") ?? "") === "evening") {
      return res.status(200).json({ ok: true, streaks: await streakReminders(now.getTime()).catch((err) => ({ error: String(err?.message ?? err) })) });
    }
    const out = { ok: true, purgedBefore: await purgeOldPosts(now.getTime()), recaps: [] };
    out.nudges = await nudgeInactive(now.getTime()).catch((err) => ({ error: String(err?.message ?? err) }));
    if (now.toISOString().slice(0, 10) === GOALS_NOTICE_DAY) {
      const everyone = await select("snapcal_users", { select: "username" }).catch(() => []);
      out.goalsNotice = await notify(everyone.map((u) => u.username), goalsNotice);
    }
    const force = String(req.query?.force ?? "") === "1";
    if (force || localWeekday(now) === 5) {
      const win = weekWindow(now);
      const users = await select("snapcal_users", { select: "username" });
      const results = await Promise.allSettled(users.map((u) => recapFor(u.username, win)));
      out.recaps = results.map((r, i) => ({ owner: users[i].username, ok: r.status === "fulfilled", ...(r.status === "rejected" ? { error: String(r.reason?.message ?? r.reason) } : { tips: r.value.tips.length }) }));
      // a heads-up only for people who actually got tips; the text itself stays private in the app
      const ready = out.recaps.filter((r) => r.ok && r.tips > 0).map((r) => r.owner);
      out.pushed = await notify(ready, (lang) => ({
        title: lang === "es" ? "Tu revisión del viernes está lista" : "Your Friday check-in is ready",
        body: lang === "es" ? "Consejos basados en tu semana. Solo tú los ves." : "Tips based on your week. Only you can see them.",
        url: "/?tab=us",
        tag: "recap",
      }));
    }
    return res.status(200).json(out);
  }

  const me = await requireUser(req, res);
  if (!me) return;
  if (req.method !== "POST") return fail(res, "other", "Method not allowed", 405);
  const body = parseBody(req);
  if (String(body.op ?? "mine") !== "mine") return fail(res, "other", "Unknown operation.");
  const lang = body.lang === "es" ? "es" : "en";
  try {
    // only ever filtered by the signed-in owner: recommendations are private
    const rows = await select("snapcal_recaps", { select: "week_start,data", owner: `eq.${me}`, order: "week_start.desc", limit: "1" });
    let recap = rows[0]?.data ?? null;
    // shown until the next Friday's replaces it; older than 8 days means the job missed a week
    if (!recap || localDay(new Date()) > addDays(recap.weekEnd, 8)) return res.status(200).json({ ok: true, recap: null });
    // written with old targets: the same week again, judged by the targets they have now
    if (recap.goalsV !== GOALS_VERSION || recapIsStale(recap, goalsFrom((await select("snapcal_profile", { select: "data", owner: `eq.${me}`, limit: "1" }))[0]?.data))) {
      try { recap = await recapFor(me, { start: recap.weekStart, end: recap.weekEnd }); } catch { /* keep the old one rather than none */ }
    }
    if (recap.tips?.length && !recap.byLang?.[lang]) recap = await addLanguage(me, rows[0].week_start, recap, lang);
    const text = textIn(recap, lang);
    const rest = { ...recap };
    delete rest.byLang;
    return res.status(200).json({ ok: true, recap: { ...rest, headline: text.headline, tips: recap.tips.map((tip, i) => ({ ...tip, ...text.tips[i] })) } });
  } catch (err) {
    return fail(res, "other", err?.message ?? String(err));
  }
}

/** One-time translation of an older recap; on any failure the English text is shown instead. */
async function addLanguage(owner, weekStart, recap, lang) {
  try {
    const source = textIn(recap, "en");
    const out = await askGemini(translatePrompt(source, lang), TRANSLATE_SCHEMA);
    const tips = Array.isArray(out?.tips) ? out.tips : [];
    if (!out?.headline || tips.length !== source.tips.length) return recap;
    const next = {
      ...recap,
      byLang: {
        en: recap.byLang?.en ?? source,
        ...(recap.byLang ?? {}),
        [lang]: { headline: String(out.headline).slice(0, 200), tips: tips.map((x) => ({ title: String(x.title ?? "").slice(0, 80), body: String(x.body ?? "").slice(0, 360) })) },
      },
    };
    await upsert("snapcal_recaps", { owner, week_start: weekStart, data: next });
    return next;
  } catch {
    return recap;
  }
}

function addDays(day, k) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}
