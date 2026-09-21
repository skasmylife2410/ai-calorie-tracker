// sync.js — client-side mirror of localStorage into Supabase via /api/sync. Offline-first:
// localStorage (store.js) remains the sole source of truth; this module only pushes/pulls a
// copy and merges remote changes back in with last-write-wins (by updatedAt). Completely silent
// (no UI, no throws) whenever the server reports {errorType:"unconfigured"} or any network/API
// call fails — the app must behave identically with sync fully absent.

import * as store from "./store.js";
import { localDateString } from "./nutrition.js";
import { apiFetch } from "./net.js";

const LAST_SYNC_KEY = "snapcal.sync.lastSyncAt"; // ISO string; absent until the first successful round trip
const DEBOUNCE_MS = 2000;
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 60000;

let state = "off"; // "off" | "ok" | "pending" | "error"
let lastSyncAt = null;
let debounceTimer = null;
let retryTimer = null;
let retryDelay = RETRY_BASE_MS;
let unconfigured = false;
let syncing = false;
let initialized = false;

function readLastSyncAt() {
  try {
    return globalThis.localStorage?.getItem(LAST_SYNC_KEY) || null;
  } catch {
    return null;
  }
}

function writeLastSyncAt(iso) {
  try {
    globalThis.localStorage?.setItem(LAST_SYNC_KEY, iso);
  } catch {
    // best-effort only
  }
  lastSyncAt = iso;
}

/** @returns {{state:"off"|"ok"|"pending"|"error", lastSyncAt:string|null}} */
export function getSyncStatus() {
  return { state, lastSyncAt };
}

function setState(next) {
  state = next;
}

// ---------------------------------------------------------------------------
// Push payload shaping
// ---------------------------------------------------------------------------

/**
 * Builds the {entries, water, profile} push body from everything locally dirty since `sinceMs`
 * (ms epoch, 0 = "everything"). Exported for tests; not part of the intended public surface for
 * UI code — use syncNow().
 */
export function buildPushPayload(sinceMs = 0) {
  const dirtyEntries = store
    .allFoodEntries()
    .filter((e) => (e.updatedAt ?? 0) > sinceMs)
    .map((e) => ({
      id: e.id,
      day: localDateString(e.timestamp),
      loggedAt: new Date(e.timestamp).toISOString(),
      name: e.name,
      calories: e.calories,
      proteinG: e.proteinG,
      carbsG: e.carbsG,
      fatG: e.fatG,
      source: e.source,
      data: e,
      deleted: false,
      updatedAt: new Date(e.updatedAt ?? Date.now()).toISOString(),
    }));

  const tombstones = store.allDeletedTombstones().filter((t) => (t.deletedAt ?? 0) > sinceMs);
  const tombstoneRows = tombstones.map((t) => ({
    id: t.id,
    day: t.day,
    loggedAt: new Date(t.deletedAt).toISOString(),
    name: "",
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    source: null,
    data: {},
    deleted: true,
    updatedAt: new Date(t.deletedAt).toISOString(),
  }));

  const dirtyWater = store
    .allWaterEntries()
    .filter((w) => (w.updatedAt ?? 0) > sinceMs)
    .map((w) => ({
      day: localDateString(w.date),
      glasses: w.glasses,
      updatedAt: new Date(w.updatedAt ?? Date.now()).toISOString(),
    }));

  const dirtyExercise = store
    .allExerciseEntries()
    .filter((e) => (e.updatedAt ?? 0) > sinceMs)
    .map((e) => ({
      id: e.id,
      day: localDateString(e.timestamp),
      data: e,
      updatedAt: new Date(e.updatedAt ?? Date.now()).toISOString(),
    }));

  const dirtyWeight = store
    .allWeightEntries()
    .filter((w) => (w.updatedAt ?? 0) > sinceMs)
    .map((w) => ({ id: w.id, day: w.day, data: w, updatedAt: new Date(w.updatedAt ?? Date.now()).toISOString() }));

  const dirtyFavorites = store
    .allSavedFoods()
    .filter((f) => (f.updatedAt ?? f.createdAt ?? 0) > sinceMs)
    .map((f) => ({
      id: f.id,
      data: f,
      updatedAt: new Date(f.updatedAt ?? f.createdAt ?? Date.now()).toISOString(),
    }));

  const profile = store.getProfile();
  const profilePayload =
    (profile.updatedAt ?? 0) > sinceMs ? { data: profile, updatedAt: new Date(profile.updatedAt).toISOString() } : null;

  return {
    entries: [...dirtyEntries, ...tombstoneRows],
    water: dirtyWater,
    exercise: dirtyExercise,
    weight: dirtyWeight,
    favorites: dirtyFavorites,
    profile: profilePayload,
    tombstoneIds: tombstones.map((t) => t.id),
  };
}

async function push(sinceMs) {
  const { entries, water, exercise, weight, favorites, profile, tombstoneIds } = buildPushPayload(sinceMs);
  if (entries.length === 0 && water.length === 0 && exercise.length === 0 && weight.length === 0 && favorites.length === 0 && !profile) {
    return { ok: true };
  }

  let res;
  try {
    res = await apiFetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "push", entries, water, exercise, weight, favorites, profile }),
    });
  } catch {
    return { ok: false };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false };
  }

  if (body?.errorType === "unconfigured") return { ok: true, unconfigured: true };
  if (!res.ok || body?.errorType) return { ok: false };

  if (tombstoneIds.length > 0) store.clearDeletedTombstones(tombstoneIds);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pull + merge (last-write-wins by updatedAt, applied via store.js)
// ---------------------------------------------------------------------------

async function pull(sinceIso) {
  let res;
  try {
    res = await apiFetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "pull", since: sinceIso ?? undefined }),
    });
  } catch {
    return { ok: false };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false };
  }

  if (body?.errorType === "unconfigured") return { ok: true, unconfigured: true };
  if (!res.ok || body?.errorType) return { ok: false };

  for (const remote of body.entries ?? []) {
    store.applyRemoteFoodEntry({ ...remote, updatedAt: Date.parse(remote.updatedAt) });
  }
  for (const w of body.water ?? []) {
    store.applyRemoteWater(w.day, w.glasses, Date.parse(w.updatedAt));
  }
  for (const row of body.exercise ?? []) {
    store.applyRemoteExercise(row.data ?? row, Date.parse(row.updatedAt));
  }
  for (const row of body.weight ?? []) {
    store.applyRemoteWeight(row.data ?? row, Date.parse(row.updatedAt));
  }
  for (const row of body.favorites ?? []) {
    store.applyRemoteFavorite(row.data ?? row, Date.parse(row.updatedAt));
  }
  if (body.profile) {
    store.applyRemoteProfile(body.profile.data, Date.parse(body.profile.updatedAt));
  }

  return { ok: true, serverTime: body.serverTime };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Runs one pull-then-push round trip. Safe to call any time; de-duped while already in flight. */
export async function syncNow() {
  if (unconfigured || syncing) return;
  syncing = true;
  setState("pending");

  try {
    const sinceIso = lastSyncAt;
    const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;

    const pullResult = await pull(sinceIso);
    if (pullResult.unconfigured) {
      unconfigured = true;
      setState("off");
      return;
    }
    if (!pullResult.ok) throw new Error("sync pull failed");

    const pushResult = await push(sinceMs);
    if (pushResult.unconfigured) {
      unconfigured = true;
      setState("off");
      return;
    }
    if (!pushResult.ok) throw new Error("sync push failed");

    writeLastSyncAt(pullResult.serverTime ?? new Date().toISOString());
    retryDelay = RETRY_BASE_MS;
    setState("ok");
  } catch {
    setState("error");
    scheduleRetry();
  } finally {
    syncing = false;
  }
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    syncNow();
  }, retryDelay);
}

function scheduleDebouncedSync() {
  if (unconfigured) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncNow();
  }, DEBOUNCE_MS);
}

/** Call once at app boot, after queue.sweepIfNeeded(). Idempotent. */
export function initSync() {
  if (initialized) return;
  initialized = true;
  lastSyncAt = readLastSyncAt();

  store.subscribe(() => {
    if (syncing) return; // ignore notifications caused by our own pull-merge writes
    scheduleDebouncedSync();
  });

  syncNow();
}
