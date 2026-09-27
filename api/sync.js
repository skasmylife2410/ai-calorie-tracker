// api/sync.js — Vercel serverless function (Node runtime). Mirrors localStorage into Supabase
// via PostgREST (zero npm deps — global fetch), so the browser never talks to Supabase directly
// and the anon key never reaches the client. Passcode-gated by api/_auth.js, same as gemini.js.
//
// Request:  POST { op: "push", entries?: Row[], water?: Row[], profile?: Row }
//           POST { op: "pull", since?: isoString }
// Response: push -> { ok: true } | pull -> { entries, water, profile, serverTime }
//           If SUPABASE_URL / a key (SUPABASE_SERVICE_ROLE_KEY preferred, SUPABASE_ANON_KEY fallback) are unset -> { errorType: "unconfigured" }
//           (client treats this as "sync off" and goes silent — see js/sync.js).
//
// Tables (supabase/0001_snapcal_schema.sql): snapcal_food_entries, snapcal_water, snapcal_profile.
// Resolution: last-write-wins on updated_at, implemented via PostgREST upsert with
// Prefer: resolution=merge-duplicates (server-side "latest row wins" is actually decided by the
// CLIENT before it pushes — see js/sync.js's LWW merge — this upsert just replaces whatever row
// existed for that id/day/id=1, which is correct because the client only ever pushes records it
// has already determined are newer than what it last pulled).

import { requireUser } from "./_auth.js";

const ID_RE = /^[0-9a-zA-Z-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 1000; // per table per push; the app pushes only what changed since last time

function supabaseConfigured() {
  return Boolean((process.env.SUPABASE_URL || "").trim() && ((process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim()));
}

function restBase() {
  return (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function restHeaders(extra = {}) {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const headers = { apikey: key, "Content-Type": "application/json", ...extra };
  // Legacy JWT keys (eyJ...) also go in Authorization; new sb_secret_ keys must not.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function parseRequestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim() !== "") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

/** Upserts `rows` into `table`, resolving conflicts on `onConflict` in favor of the pushed row. */
async function upsert(table, rows, onConflict) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true };
  try {
    const url = `${restBase()}/rest/v1/${table}?on_conflict=${onConflict}`;
    const res = await fetch(url, {
      method: "POST",
      headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`sync: upsert ${table} HTTP ${res.status}: ${text}`);
      return { ok: false, message: `Couldn't save ${table.replace("snapcal_", "")} (${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Supabase upsert ${table} network error: ${err?.message ?? err}` };
  }
}

/** Selects `owner`'s rows in `table` updated at/after `since` (or all of them if `since` is absent). */
async function selectSince(table, owner, since) {
  const params = new URLSearchParams({ select: "*", order: "updated_at.asc", owner: `eq.${owner}` });
  if (since) params.set("updated_at", `gte.${since}`);
  const res = await fetch(`${restBase()}/rest/v1/${table}?${params.toString()}`, { headers: restHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`sync: select ${table} HTTP ${res.status}: ${text}`);
    throw new Error(`Couldn't read ${table.replace("snapcal_", "")} (${res.status}).`);
  }
  return await res.json();
}

/** Returns the subset of `ids` that exist in `table` under a different owner. */
async function foreignIds(ids, owner, table = "snapcal_food_entries") {
  const valid = ids.filter((id) => typeof id === "string" && /^[0-9a-zA-Z-]{1,64}$/.test(id));
  if (valid.length === 0) return { ok: true, ids: new Set() };
  try {
    const params = new URLSearchParams({ select: "id", id: `in.(${valid.join(",")})`, owner: `neq.${owner}` });
    const res = await fetch(`${restBase()}/rest/v1/${table}?${params.toString()}`, { headers: restHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`sync: guard ${table} HTTP ${res.status}: ${text}`);
      return { ok: false, message: `Couldn't check ${table.replace("snapcal_", "")} (${res.status}).` };
    }
    const rows = await res.json();
    return { ok: true, ids: new Set(rows.map((r) => r.id)) };
  } catch (err) {
    return { ok: false, message: `Couldn't check ${table.replace("snapcal_", "")}: network error.` };
  }
}

export default async function handler(req, res) {
  const owner = await requireUser(req, res);
  if (!owner) return;

  if (req.method !== "POST") {
    res.status(405).json({ errorType: "other", message: "Method not allowed" });
    return;
  }

  if (!supabaseConfigured()) {
    res.status(200).json({ errorType: "unconfigured" });
    return;
  }

  const body = parseRequestBody(req);

  if (body.op === "push") {
    // Only well-formed rows are accepted, and only so many per push: ids are the app's own
    // UUIDs, days are YYYY-MM-DD, and `data` is an object (not a string or array of junk).
    const rowsOf = (list, needsId = true) => (Array.isArray(list) ? list : [])
      .filter((r) => r && typeof r === "object"
        && (!needsId || (typeof r.id === "string" && ID_RE.test(r.id)))
        && (r.day === undefined || (typeof r.day === "string" && DAY_RE.test(r.day)))
        && (r.data === undefined || r.data === null || (typeof r.data === "object" && !Array.isArray(r.data))))
      .slice(0, MAX_ROWS);
    body.entries = rowsOf(body.entries);
    body.exercise = rowsOf(body.exercise);
    body.weight = rowsOf(body.weight);
    body.favorites = rowsOf(body.favorites);
    body.water = rowsOf(body.water, false).filter((w) => typeof w.day === "string");
    if (body.profile && (typeof body.profile !== "object" || Array.isArray(body.profile))) body.profile = null;

    const entryRows = body.entries.map((e) => ({
      owner,
      id: e.id,
      day: e.day,
      logged_at: e.loggedAt,
      name: e.name ?? "",
      calories: e.calories ?? null,
      protein_g: e.proteinG ?? null,
      carbs_g: e.carbsG ?? null,
      fat_g: e.fatG ?? null,
      source: e.source ?? null,
      data: e.data ?? {},
      deleted: Boolean(e.deleted),
      updated_at: e.updatedAt,
    }));
    const exerciseRows = (Array.isArray(body.exercise) ? body.exercise : []).map((x) => ({
      owner,
      id: x.id,
      day: x.day,
      data: x.data ?? {},
      updated_at: x.updatedAt,
    }));

    const weightRows = (Array.isArray(body.weight) ? body.weight : []).map((w) => ({
      owner, id: w.id, day: w.day, data: w.data ?? {}, updated_at: w.updatedAt,
    }));

    const favoriteRows = (Array.isArray(body.favorites) ? body.favorites : []).map((f) => ({
      owner,
      id: f.id,
      data: f.data ?? {},
      updated_at: f.updatedAt,
    }));

    const waterRows = (Array.isArray(body.water) ? body.water : []).map((w) => ({
      owner,
      day: w.day,
      glasses: w.glasses,
      updated_at: w.updatedAt,
    }));
    const profileRows = body.profile
      ? [{ owner, data: body.profile.data ?? {}, updated_at: body.profile.updatedAt }]
      : [];

    // Ids are random UUIDs, so they never collide between people. As a guard, refuse to
    // overwrite any id-keyed row (meal, exercise, weight, favourite) that belongs to someone
    // else — an upsert on id would otherwise hand that row to the caller.
    const guards = await Promise.all([
      foreignIds(entryRows.map((r) => r.id), owner, "snapcal_food_entries"),
      foreignIds(exerciseRows.map((r) => r.id), owner, "snapcal_exercise"),
      foreignIds(weightRows.map((r) => r.id), owner, "snapcal_weight"),
      foreignIds(favoriteRows.map((r) => r.id), owner, "snapcal_favorites"),
    ]);
    const broken = guards.find((g) => !g.ok);
    if (broken) {
      res.status(200).json({ errorType: "other", message: broken.message });
      return;
    }
    const mineOnly = (rows, g) => rows.filter((r) => !g.ids.has(r.id));
    const safeEntryRows = mineOnly(entryRows, guards[0]);

    const [entriesResult, waterResult, exerciseResult, weightResult, favoritesResult, profileResult] = await Promise.all([
      upsert("snapcal_food_entries", safeEntryRows, "id"),
      upsert("snapcal_water", waterRows, "owner,day"),
      upsert("snapcal_exercise", mineOnly(exerciseRows, guards[1]), "id"),
      upsert("snapcal_weight", mineOnly(weightRows, guards[2]), "id"),
      upsert("snapcal_favorites", mineOnly(favoriteRows, guards[3]), "id"),
      upsert("snapcal_profile", profileRows, "owner"),
    ]);

    const failures = [entriesResult, waterResult, exerciseResult, weightResult, favoritesResult, profileResult].filter((r) => !r.ok);
    if (failures.length > 0) {
      res.status(200).json({ errorType: "other", message: failures.map((f) => f.message).join("; ") });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (body.op === "pull") {
    const since = typeof body.since === "string" && !Number.isNaN(Date.parse(body.since)) ? new Date(body.since).toISOString() : undefined;
    const serverTime = new Date().toISOString();
    let entries, water, exercise, weight, favorites, profile;
    try {
      [entries, water, exercise, weight, favorites, profile] = await Promise.all([
        selectSince("snapcal_food_entries", owner, since),
        selectSince("snapcal_water", owner, since),
        selectSince("snapcal_exercise", owner, since),
        selectSince("snapcal_weight", owner, since),
        selectSince("snapcal_favorites", owner, since),
        selectSince("snapcal_profile", owner, since),
      ]);
    } catch (err) {
      res.status(200).json({ errorType: "other", message: err?.message ?? String(err) });
      return;
    }

    res.status(200).json({
      entries: entries.map((r) => ({
        id: r.id,
        day: r.day,
        loggedAt: r.logged_at,
        name: r.name,
        calories: r.calories,
        proteinG: r.protein_g,
        carbsG: r.carbs_g,
        fatG: r.fat_g,
        source: r.source,
        data: r.data,
        deleted: r.deleted,
        updatedAt: r.updated_at,
      })),
      water: water.map((r) => ({ day: r.day, glasses: r.glasses, updatedAt: r.updated_at })),
      exercise: exercise.map((r) => ({ id: r.id, day: r.day, data: r.data, updatedAt: r.updated_at })),
      weight: weight.map((r) => ({ id: r.id, day: r.day, data: r.data, updatedAt: r.updated_at })),
      favorites: favorites.map((r) => ({ id: r.id, data: r.data, updatedAt: r.updated_at })),
      profile: profile[0] ? { data: profile[0].data, updatedAt: profile[0].updated_at } : null,
      serverTime,
    });
    return;
  }

  res.status(200).json({ errorType: "other", message: "Unknown op" });
}
