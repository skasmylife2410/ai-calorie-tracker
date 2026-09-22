// store.js — localStorage data layer for FoodEntry / WaterEntry / UserProfile / SavedFood.
// Mirrors the SwiftData persistence semantics described in SPEC-LOGIC.md §1, §13.
// Uses `globalThis.localStorage` so it can be exercised under Node with a mock (see tests).

import { startOfDay, addDays, computeStreak, resolveUserGoals, normalizeEntrySource, normalizeSex, normalizeActivityLevel, localDateString, normalizeActivity, normalizeIntensity, estimateCaloriesBurned, exerciseCredit, learnedMaintenance, EXERCISE_CREDIT_CHOICES } from "./nutrition.js";

export const STORAGE_KEYS = Object.freeze({
  foodEntries: "snapcal.foodEntries",
  waterEntries: "snapcal.waterEntries",
  userProfile: "snapcal.userProfile",
  savedFoods: "snapcal.savedFoods",
  exerciseEntries: "snapcal.exerciseEntries",
  weightEntries: "snapcal.weightEntries",
  notifyBannerDismissed: "snapcal.notifyBannerDismissed",
  deletedEntryTombstones: "snapcal.deletedEntryTombstones",
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function ls() {
  if (typeof globalThis.localStorage === "undefined") {
    throw new Error("store.js requires a localStorage implementation on globalThis");
  }
  return globalThis.localStorage;
}

function readJSON(key, fallback) {
  const raw = ls().getItem(key);
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  ls().setItem(key, JSON.stringify(value));
}

function generateId() {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback id generator (non-cryptographic) for environments without crypto.randomUUID.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Pub/sub
// ---------------------------------------------------------------------------

const listeners = new Set();

/** Subscribe to any store mutation. Returns an unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error("store.js: subscriber threw", err);
    }
  }
}

// ---------------------------------------------------------------------------
// FoodEntry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FoodEntry
 * @property {string} id
 * @property {string} name
 * @property {number} calories
 * @property {number} proteinG
 * @property {number} carbsG
 * @property {number} fatG
 * @property {number} timestamp - ms since epoch
 * @property {string|null} photoDataUrl - JPEG as a data: URL, or null
 * @property {"manual"|"barcode"|"photo"|"text"} source
 * @property {boolean|null} isPending
 * @property {boolean|null} analysisFailed
 * @property {Array|null} analysisItems - AnalyzedFoodItem[] once analysis completes
 * @property {string|null} analysisFailureReason
 * @property {"meal"|"label"|"text"|null} analysisMode
 * @property {string|null} analysisDescription
 * @property {number} updatedAt - ms since epoch, bumped on create/update; used for sync LWW merge
 */

function allFoodEntriesRaw() {
  return readJSON(STORAGE_KEYS.foodEntries, []);
}

function saveFoodEntries(entries) {
  writeJSON(STORAGE_KEYS.foodEntries, entries);
  notify();
}

/** Default field values, mirrors FoodEntry init defaults in Models.swift. */
export function makeFoodEntry(fields) {
  const now = Date.now();
  return {
    id: fields.id ?? generateId(),
    name: fields.name ?? "",
    calories: fields.calories ?? 0,
    proteinG: fields.proteinG ?? 0,
    carbsG: fields.carbsG ?? 0,
    fatG: fields.fatG ?? 0,
    timestamp: fields.timestamp ?? now,
    photoDataUrl: fields.photoDataUrl ?? null,
    source: normalizeEntrySource(fields.source ?? "manual"),
    isPending: fields.isPending ?? null,
    analysisFailed: fields.analysisFailed ?? null,
    analysisItems: fields.analysisItems ?? null,
    analysisFailureReason: fields.analysisFailureReason ?? null,
    analysisMode: fields.analysisMode ?? null,
    analysisDescription: fields.analysisDescription ?? null,
    // How much was eaten, so the edit screen can rescale by grams/ml rather than only by kcal.
    amount: Number.isFinite(Number(fields.amount)) && Number(fields.amount) > 0 ? Number(fields.amount) : null,
    amountUnit: ["g", "ml", "serving"].includes(fields.amountUnit) ? fields.amountUnit : null,
    servings: normalizeServings(fields.servings),
    base: fields.base ?? {
      calories: fields.calories ?? 0,
      proteinG: fields.proteinG ?? 0,
      carbsG: fields.carbsG ?? 0,
      fatG: fields.fatG ?? 0,
    },
    updatedAt: fields.updatedAt ?? now,
  };
}

/** Servings are 0.5-step multipliers between 0.5 and 20. */
export function normalizeServings(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(20, Math.max(0.5, Math.round(n * 2) / 2));
}

/**
 * Reads an entry's one-serving macros. Entries created before servings existed have no `base`,
 * so their current macros ARE the one-serving values (servings defaults to 1).
 */
export function baseMacros(entry) {
  const b = entry?.base;
  const servings = normalizeServings(entry?.servings);
  if (b && typeof b === "object") return { ...b };
  return {
    calories: (entry?.calories ?? 0) / servings,
    proteinG: (entry?.proteinG ?? 0) / servings,
    carbsG: (entry?.carbsG ?? 0) / servings,
    fatG: (entry?.fatG ?? 0) / servings,
  };
}

/** Sets the serving multiplier, rescaling the stored totals from the one-serving base. */
export function setServings(id, servings) {
  const entry = getFoodEntry(id);
  if (!entry) return null;
  const n = normalizeServings(servings);
  const b = baseMacros(entry);
  return updateFoodEntry(id, {
    servings: n,
    base: b,
    calories: Math.round(b.calories * n),
    proteinG: Math.round(b.proteinG * n * 10) / 10,
    carbsG: Math.round(b.carbsG * n * 10) / 10,
    fatG: Math.round(b.fatG * n * 10) / 10,
  });
}

/** All food entries (no ordering guarantee). */
export function allFoodEntries() {
  return allFoodEntriesRaw();
}

export function getFoodEntry(id) {
  return allFoodEntriesRaw().find((e) => e.id === id) ?? null;
}

/** Insert a fully-formed entry (or field subset — defaults are applied). Returns the stored entry. */
export function addFoodEntry(fields) {
  const entry = makeFoodEntry(fields);
  const entries = allFoodEntriesRaw();
  entries.push(entry);
  saveFoodEntries(entries);
  return entry;
}

/** Shallow-merge patch into an existing entry by id. Returns the updated entry, or null if not found. */
export function updateFoodEntry(id, patch) {
  const entries = allFoodEntriesRaw();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  entries[idx] = { ...entries[idx], ...patch, updatedAt: patch.updatedAt ?? Date.now() };
  saveFoodEntries(entries);
  return entries[idx];
}

/**
 * Deletes an entry. UX is unchanged (the entry vanishes from allFoodEntries/entriesForDay etc.
 * exactly as before) but a lightweight tombstone {id, day, deletedAt} is recorded separately so
 * sync.js can propagate the deletion — see allDeletedTombstones()/clearDeletedTombstones().
 */
export function deleteFoodEntry(id) {
  const entries = allFoodEntriesRaw();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  const [removed] = entries.splice(idx, 1);
  saveFoodEntries(entries);

  const tombstones = allDeletedTombstonesRaw();
  tombstones.push({ id, day: localDateString(removed.timestamp), deletedAt: Date.now() });
  saveDeletedTombstones(tombstones);
  return true;
}

// ---------------------------------------------------------------------------
// Sync support — tombstones (deletions) + LWW merge of remote records.
// Never called from UI code; see js/sync.js.
// ---------------------------------------------------------------------------

function allDeletedTombstonesRaw() {
  return readJSON(STORAGE_KEYS.deletedEntryTombstones, []);
}

function saveDeletedTombstones(list) {
  writeJSON(STORAGE_KEYS.deletedEntryTombstones, list);
}

/** Pending deletions not yet confirmed pushed to the sync server. */
export function allDeletedTombstones() {
  return allDeletedTombstonesRaw();
}

/** Drops tombstones once sync.js has confirmed they were pushed successfully. */
export function clearDeletedTombstones(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const set = new Set(ids);
  const remaining = allDeletedTombstonesRaw().filter((t) => !set.has(t.id));
  saveDeletedTombstones(remaining);
}

/**
 * Merges one remote FoodEntry record (from a sync pull) into local storage using last-write-wins
 * on updatedAt (ms epoch). `remote.data` is the full FoodEntry object as originally pushed;
 * `remote.deleted` is a tombstone flag. A tie (equal updatedAt) keeps the local copy.
 */
export function applyRemoteFoodEntry(remote) {
  const entries = allFoodEntriesRaw();
  const idx = entries.findIndex((e) => e.id === remote.id);
  const remoteUpdatedAt = remote.updatedAt ?? 0;
  const localUpdatedAt = idx !== -1 ? entries[idx].updatedAt ?? 0 : -1;

  if (remote.deleted) {
    if (idx !== -1 && localUpdatedAt <= remoteUpdatedAt) {
      entries.splice(idx, 1);
      saveFoodEntries(entries);
    }
    return;
  }

  if (localUpdatedAt >= remoteUpdatedAt) return; // local is newer or tied — keep local

  const merged = makeFoodEntry({ ...(remote.data ?? {}), id: remote.id, updatedAt: remoteUpdatedAt });
  if (idx === -1) entries.push(merged);
  else entries[idx] = merged;
  saveFoodEntries(entries);
}

/** Entries whose calendar day (device-local) matches `date`. No midnight cron — recomputed live. */
export function entriesForDay(date = new Date()) {
  const start = startOfDay(date);
  const end = addDays(start, 1);
  return allFoodEntriesRaw().filter((e) => e.timestamp >= start && e.timestamp < end);
}

/** Sum of calories/macros for a given day. */
export function totalsForDay(date = new Date()) {
  return entriesForDay(date).reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
}

/** Set of start-of-day timestamps that have at least one logged entry (streak + week-strip dots). */
export function loggedDaySet() {
  return new Set(allFoodEntriesRaw().map((e) => startOfDay(e.timestamp)));
}

/** Current streak in days, as of `today`. */
export function streak(today = new Date()) {
  return computeStreak(loggedDaySet(), today);
}

/** allEntries sorted timestamp-descending, capped to the first `limit` (default 10). */
export function recentlyUploaded(limit = 10) {
  return [...allFoodEntriesRaw()].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/**
 * History grouped by calendar day, newest bucket first, newest entry first within a bucket.
 * @returns {Array<{dayStart:number, total:{calories:number,proteinG:number,carbsG:number,fatG:number}, entries:FoodEntry[]}>}
 */
export function historyGroupedByDay() {
  const byDay = new Map();
  for (const entry of allFoodEntriesRaw()) {
    const day = startOfDay(entry.timestamp);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }
  const buckets = [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayStart, entries]) => {
      const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
      const total = sorted.reduce(
        (acc, e) => ({
          calories: acc.calories + e.calories,
          proteinG: acc.proteinG + e.proteinG,
          carbsG: acc.carbsG + e.carbsG,
          fatG: acc.fatG + e.fatG,
        }),
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
      );
      return { dayStart, total, entries: sorted };
    });
  return buckets;
}

/**
 * Monday-start week strip (7 columns Mon->Sun) for the week containing `referenceDate`.
 * daysSinceMonday = (swiftWeekday + 5) % 7, swiftWeekday = JS getDay() + 1 (1=Sunday), matching
 * Calendar.component(.weekday) semantics from the spec so Monday is always column 0.
 * @returns {Array<{dayStart:number, hasLog:boolean}>}
 */
export function weekStrip(referenceDate = new Date()) {
  const startToday = startOfDay(referenceDate);
  const jsDay = new Date(startToday).getDay(); // 0=Sunday..6=Saturday
  const swiftWeekday = jsDay + 1; // 1=Sunday..7=Saturday
  const daysSinceMonday = (swiftWeekday + 5) % 7;
  const monday = addDays(startToday, -daysSinceMonday);
  const logged = loggedDaySet();
  return Array.from({ length: 7 }, (_, i) => {
    const dayStart = addDays(monday, i);
    return { dayStart, hasLog: logged.has(dayStart) };
  });
}

// ---------------------------------------------------------------------------
// WaterEntry — one row per calendar day, created lazily on first "+" tap
// ---------------------------------------------------------------------------

function allWaterEntriesRaw() {
  return readJSON(STORAGE_KEYS.waterEntries, []);
}

function saveWaterEntries(entries) {
  writeJSON(STORAGE_KEYS.waterEntries, entries);
  notify();
}

/** All stored WaterEntry rows (no ordering guarantee). */
export function allWaterEntries() {
  return allWaterEntriesRaw();
}

/** Returns the stored WaterEntry for `date`, or a transient {date, glasses:0} if none exists yet. */
export function getWaterEntryForDay(date = new Date()) {
  const day = startOfDay(date);
  const found = allWaterEntriesRaw().find((w) => w.date === day);
  return found ?? { date: day, glasses: 0 };
}

/** Increments glasses for `date`, creating the row lazily if it doesn't exist yet. */
export function incrementWater(date = new Date()) {
  const day = startOfDay(date);
  const entries = allWaterEntriesRaw();
  const idx = entries.findIndex((w) => w.date === day);
  if (idx === -1) {
    entries.push({ date: day, glasses: 1, updatedAt: Date.now() });
  } else {
    entries[idx] = { ...entries[idx], glasses: entries[idx].glasses + 1, updatedAt: Date.now() };
  }
  saveWaterEntries(entries);
  return getWaterEntryForDay(day);
}

/** Decrements glasses for `date`, clamped >=0. No-op (never creates a row) if none exists yet. */
export function decrementWater(date = new Date()) {
  const day = startOfDay(date);
  const entries = allWaterEntriesRaw();
  const idx = entries.findIndex((w) => w.date === day);
  if (idx === -1) return { date: day, glasses: 0 };
  const nextGlasses = Math.max(0, entries[idx].glasses - 1);
  entries[idx] = { ...entries[idx], glasses: nextGlasses, updatedAt: Date.now() };
  saveWaterEntries(entries);
  return entries[idx];
}

/** Sync-only: merges a remote water row (LWW on updatedAt, ms epoch). `day` is "YYYY-MM-DD". */
export function applyRemoteWater(day, glasses, updatedAt) {
  const [y, m, d] = String(day).split("-").map(Number);
  const dayStart = startOfDay(new Date(y, m - 1, d));
  const entries = allWaterEntriesRaw();
  const idx = entries.findIndex((w) => w.date === dayStart);
  const localUpdatedAt = idx !== -1 ? entries[idx].updatedAt ?? 0 : -1;
  if (localUpdatedAt >= (updatedAt ?? 0)) return;
  const merged = { date: dayStart, glasses, updatedAt };
  if (idx === -1) entries.push(merged);
  else entries[idx] = merged;
  saveWaterEntries(entries);
}

// ---------------------------------------------------------------------------
// UserProfile — singleton row
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE = Object.freeze({
  weightKg: 0,
  heightCm: 0,
  age: 0,
  sex: "male",
  activityLevel: "sedentary",
  targetDeltaKcal: 0,
  customTargetKcal: null,
  customProteinG: null,
  customCarbsG: null,
  customFatG: null,
});

export function getProfile() {
  const stored = readJSON(STORAGE_KEYS.userProfile, null);
  if (!stored) return { ...DEFAULT_PROFILE };
  return {
    ...DEFAULT_PROFILE,
    ...stored,
    sex: normalizeSex(stored.sex),
    activityLevel: normalizeActivityLevel(stored.activityLevel),
  };
}

/** Shallow-merges `patch` into the singleton profile and persists it. */
export function setProfile(patch) {
  const next = { ...getProfile(), ...patch, updatedAt: Date.now() };
  writeJSON(STORAGE_KEYS.userProfile, next);
  notify();
  return next;
}

/** TDEE/goals helper — custom-first resolution per NutritionMath.resolveUserGoals. */
export function computeGoals() {
  const profile = getProfile();
  const learned = profile.useLearnedTdee === false ? null : learnedMaintenanceNow();
  const apply = learned && learned.confidence !== "low";
  return resolveUserGoals(profile, { learnedTdee: apply ? learned.tdee : null });
}

/** Share of exercise burn added back to the day's budget: this person's setting, default 0. */
export function exerciseCreditRatio() {
  const v = Number(getProfile().exerciseCreditPct);
  const ratio = Number.isFinite(v) ? v / 100 : 0;
  return EXERCISE_CREDIT_CHOICES.includes(ratio) ? ratio : 0;
}

/**
 * Learned maintenance from the last 28 complete days (today is excluded: it isn't over).
 * Days logged at under half the formula maintenance are treated as incomplete and skipped,
 * because a forgotten dinner would otherwise make maintenance look far lower than it is.
 */
export function learnedMaintenanceNow({ now = Date.now(), windowDays = 28 } = {}) {
  const profile = getProfile();
  const formula = resolveUserGoals(profile).formulaTdee;
  if (!(formula > 0)) return null;

  const todayStart = startOfDay(now);
  const from = addDays(todayStart, -windowDays);
  const perDay = new Map();
  for (const e of allFoodEntries()) {
    if (e.isPending === true || e.analysisFailed === true) continue;
    if (e.timestamp < from || e.timestamp >= todayStart) continue;
    const key = localDateString(e.timestamp);
    perDay.set(key, (perDay.get(key) ?? 0) + (Number(e.calories) || 0));
  }
  const days = [...perDay.values()].filter((kcal) => kcal >= formula * 0.5).map((calories) => ({ calories }));

  const weights = allWeightEntries()
    .filter((w) => w.timestamp >= from && w.timestamp < todayStart + 86400000)
    .map((w) => ({ t: w.timestamp, kg: w.kg }));

  const out = learnedMaintenance({ days, weights, formulaTdee: formula });
  return out ? { ...out, formulaTdee: Math.round(formula), skippedDays: perDay.size - days.length } : null;
}

/** Sync-only: merges a remote profile row (LWW on updatedAt, ms epoch). */
export function applyRemoteProfile(data, updatedAt) {
  const stored = readJSON(STORAGE_KEYS.userProfile, null);
  const localUpdatedAt = stored?.updatedAt ?? -1;
  if (localUpdatedAt >= (updatedAt ?? 0)) return;
  writeJSON(STORAGE_KEYS.userProfile, { ...data, updatedAt });
  notify();
}

// ---------------------------------------------------------------------------
// Saved foods (quick re-log)
// ---------------------------------------------------------------------------

function allSavedFoodsRaw() {
  return readJSON(STORAGE_KEYS.savedFoods, []);
}

function saveSavedFoods(list) {
  writeJSON(STORAGE_KEYS.savedFoods, list);
  notify();
}

export function allSavedFoods() {
  return allSavedFoodsRaw();
}

/** Saves a food for quick re-logging later. `source` is copied but analysisItems is NEVER copied. */
export function addSavedFood({ name, calories, proteinG = 0, carbsG = 0, fatG = 0, source = "manual", photoDataUrl = null, servings = 1, favorite = true, fromEntryId = null }) {
  const saved = {
    id: generateId(),
    name,
    calories,
    proteinG,
    carbsG,
    fatG,
    source: normalizeEntrySource(source),
    photoDataUrl,
    servings: normalizeServings(servings),
    favorite: favorite !== false,
    fromEntryId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const list = allSavedFoodsRaw();
  list.push(saved);
  saveSavedFoods(list);
  return saved;
}

export function deleteSavedFood(id) {
  const list = allSavedFoodsRaw();
  const next = list.filter((f) => f.id !== id);
  const changed = next.length !== list.length;
  if (changed) saveSavedFoods(next);
  return changed;
}

/**
 * Logs a saved food as a brand-new FoodEntry. `source` is copied from the saved food, but
 * `analysisItems` is intentionally left null so this never opens the AI results screen
 * (detection is on analysisItems presence, not on `source === "photo"` — see spec §6 state 3).
 */
export function logSavedFood(id, { timestamp = Date.now(), servings } = {}) {
  const saved = allSavedFoodsRaw().find((f) => f.id === id);
  if (!saved) return null;
  // A saved food's macros are always ONE serving; the multiplier is applied here.
  const n = normalizeServings(servings ?? saved.servings ?? 1);
  const base = {
    calories: saved.calories,
    proteinG: saved.proteinG,
    carbsG: saved.carbsG,
    fatG: saved.fatG,
  };
  return addFoodEntry({
    name: saved.name,
    calories: Math.round(base.calories * n),
    proteinG: Math.round(base.proteinG * n * 10) / 10,
    carbsG: Math.round(base.carbsG * n * 10) / 10,
    fatG: Math.round(base.fatG * n * 10) / 10,
    base,
    servings: n,
    source: saved.source,
    photoDataUrl: saved.photoDataUrl ?? null,
    timestamp,
    analysisItems: null,
  });
}

/** True when an entry has already been hearted (matched by origin entry id, else by name). */
export function isFavorited(entry) {
  if (!entry) return false;
  const name = String(entry.name ?? "").trim().toLowerCase();
  return allSavedFoodsRaw().some(
    (f) => f.favorite !== false && (f.fromEntryId === entry.id || String(f.name ?? "").trim().toLowerCase() === name)
  );
}

/** Heart / un-heart an entry. Returns true when it is now a favourite. */
export function toggleFavorite(entryId) {
  const entry = getFoodEntry(entryId);
  if (!entry) return false;
  const name = String(entry.name ?? "").trim().toLowerCase();
  const list = allSavedFoodsRaw();
  const existing = list.find(
    (f) => f.favorite !== false && (f.fromEntryId === entry.id || String(f.name ?? "").trim().toLowerCase() === name)
  );
  if (existing) {
    deleteSavedFood(existing.id);
    return false;
  }
  const b = baseMacros(entry);
  addSavedFood({
    name: entry.name,
    calories: Math.round(b.calories),
    proteinG: Math.round(b.proteinG * 10) / 10,
    carbsG: Math.round(b.carbsG * 10) / 10,
    fatG: Math.round(b.fatG * 10) / 10,
    source: entry.source,
    photoDataUrl: entry.photoDataUrl ?? null,
    servings: entry.servings ?? 1,
    fromEntryId: entry.id,
  });
  return true;
}

// ---------------------------------------------------------------------------
// ExerciseEntry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ExerciseEntry
 * @property {string} id
 * @property {string} name - what the user called it ("Soccer", "Evening walk")
 * @property {string} activity - key in ACTIVITY_METS
 * @property {number} minutes
 * @property {string} intensity - easy | moderate | hard
 * @property {number} caloriesBurned - full estimated burn (NOT the credited share)
 * @property {number} timestamp
 * @property {number} updatedAt
 */

function allExerciseRaw() {
  return readJSON(STORAGE_KEYS.exerciseEntries, []);
}

function saveExercise(list) {
  writeJSON(STORAGE_KEYS.exerciseEntries, list);
  notify();
}

export function allExerciseEntries() {
  return allExerciseRaw();
}

/** Adds an exercise entry. caloriesBurned is estimated from the profile weight when omitted. */
export function addExerciseEntry(fields = {}) {
  const now = Date.now();
  const activity = normalizeActivity(fields.activity);
  const intensity = normalizeIntensity(fields.intensity);
  const minutes = Math.max(0, Math.round(Number(fields.minutes) || 0));
  const burned = Number.isFinite(Number(fields.caloriesBurned)) && Number(fields.caloriesBurned) > 0
    ? Math.round(Number(fields.caloriesBurned))
    : estimateCaloriesBurned({ activity, minutes, intensity, weightKg: getProfile().weightKg });
  const entry = {
    id: fields.id ?? generateId(),
    name: fields.name ?? "",
    activity,
    minutes,
    intensity,
    caloriesBurned: burned,
    timestamp: fields.timestamp ?? now,
    updatedAt: fields.updatedAt ?? now,
  };
  const list = allExerciseRaw();
  list.push(entry);
  saveExercise(list);
  return entry;
}

export function updateExerciseEntry(id, patch) {
  const list = allExerciseRaw();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: patch.updatedAt ?? Date.now() };
  saveExercise(list);
  return list[idx];
}

export function deleteExerciseEntry(id) {
  const list = allExerciseRaw();
  const next = list.filter((e) => e.id !== id);
  const changed = next.length !== list.length;
  if (changed) saveExercise(next);
  return changed;
}

export function exerciseForDay(date = new Date()) {
  const day = localDateString(date instanceof Date ? date.getTime() : date);
  return allExerciseRaw()
    .filter((e) => localDateString(e.timestamp) === day)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * The day's calorie picture once exercise is taken into account.
 * `burned` is the full estimate; `credit` is the 60% share that actually raises the budget,
 * so the UI can show both rather than one blended number.
 */
export function dayEnergy(date = new Date()) {
  const goals = computeGoals();
  const totals = totalsForDay(date);
  const burned = exerciseForDay(date).reduce((sum, e) => sum + (e.caloriesBurned || 0), 0);
  const credit = exerciseCredit(burned, exerciseCreditRatio());
  const baseTarget = Math.round(goals.targetCalories);
  const adjustedTarget = baseTarget + credit;
  return {
    baseTarget,
    burned,
    credit,
    adjustedTarget,
    eaten: Math.round(totals.calories),
    remaining: adjustedTarget - Math.round(totals.calories),
  };
}

/** LWW merge of one remote exercise row (see js/sync.js). */
export function applyRemoteExercise(data, remoteUpdatedAt) {
  if (!data || typeof data !== "object" || typeof data.id !== "string") return;
  const stamp = Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : Date.now();
  const list = allExerciseRaw();
  const idx = list.findIndex((e) => e.id === data.id);
  if (idx !== -1 && (list[idx].updatedAt ?? 0) >= stamp) return; // local is newer — keep it
  const row = { ...data, updatedAt: stamp };
  if (idx === -1) list.push(row); else list[idx] = row;
  saveExercise(list);
}

/** LWW merge of one remote favourite row. */
export function applyRemoteFavorite(data, remoteUpdatedAt) {
  if (!data || typeof data !== "object" || typeof data.id !== "string") return;
  const stamp = Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : Date.now();
  const list = allSavedFoodsRaw();
  const idx = list.findIndex((f) => f.id === data.id);
  if (idx !== -1 && (list[idx].updatedAt ?? list[idx].createdAt ?? 0) >= stamp) return;
  const row = { ...data, updatedAt: stamp };
  if (idx === -1) list.push(row); else list[idx] = row;
  saveSavedFoods(list);
}

// ---------------------------------------------------------------------------
// WeightEntry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} WeightEntry
 * @property {string} id
 * @property {string} day - YYYY-MM-DD, one entry per day (a second entry replaces the first)
 * @property {number} kg - always stored in kg; display units are a profile preference
 * @property {string|null} note
 * @property {number} timestamp
 * @property {number} updatedAt
 */

export const LB_PER_KG = 2.2046226218;

export const kgToLb = (kg) => (Number(kg) || 0) * LB_PER_KG;
export const lbToKg = (lb) => (Number(lb) || 0) / LB_PER_KG;

/** Display unit for weight — "kg" or "lb". Stored on the profile, so it follows the person. */
export function weightUnit() {
  return getProfile().weightUnit === "lb" ? "lb" : "kg";
}

export function setWeightUnit(unit) {
  setProfile({ weightUnit: unit === "lb" ? "lb" : "kg" });
}

function allWeightRaw() {
  return readJSON(STORAGE_KEYS.weightEntries, []);
}

function saveWeight(list) {
  writeJSON(STORAGE_KEYS.weightEntries, list);
  notify();
}

/** Newest first. */
export function allWeightEntries() {
  return allWeightRaw().sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Records a weight for a day. One reading per day: logging twice replaces the earlier value,
 * because two numbers for the same morning is noise, not data.
 */
export function addWeightEntry({ kg, timestamp = Date.now(), note = null } = {}) {
  const value = Number(kg);
  if (!Number.isFinite(value) || value <= 0 || value > 600) return null;

  const day = localDateString(timestamp);
  const list = allWeightRaw();
  const idx = list.findIndex((w) => w.day === day);
  const entry = {
    id: idx === -1 ? generateId() : list[idx].id,
    day,
    kg: Math.round(value * 10) / 10,
    note,
    timestamp,
    updatedAt: Date.now(),
  };
  if (idx === -1) list.push(entry); else list[idx] = entry;
  saveWeight(list);
  return entry;
}

export function deleteWeightEntry(id) {
  const list = allWeightRaw();
  const next = list.filter((w) => w.id !== id);
  const changed = next.length !== list.length;
  if (changed) saveWeight(next);
  return changed;
}

export function latestWeight() {
  return allWeightEntries()[0] ?? null;
}

/**
 * A 7-day rolling average, which is what you actually want to look at: day-to-day weight swings
 * by a kilo or two on water alone, and a raw line tempts people to read noise as progress.
 * @returns {Array<{day:string, kg:number, avg:number|null, timestamp:number}>} oldest first
 */
export function weightSeries(days = 90) {
  const cutoff = startOfDay(addDays(startOfDay(new Date()), -(days - 1)));
  const entries = allWeightRaw()
    .filter((w) => w.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);

  return entries.map((entry, i) => {
    const window = entries.slice(Math.max(0, i - 6), i + 1);
    const avg = window.reduce((sum, w) => sum + w.kg, 0) / window.length;
    return { day: entry.day, kg: entry.kg, avg: Math.round(avg * 10) / 10, timestamp: entry.timestamp };
  });
}

/**
 * Change over a window, using the rolling average at each end rather than single readings.
 * @returns {{from:number, to:number, delta:number, days:number}|null}
 */
export function weightChange(days = 30) {
  const series = weightSeries(days);
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  return {
    from: first.avg ?? first.kg,
    to: last.avg ?? last.kg,
    delta: Math.round(((last.avg ?? last.kg) - (first.avg ?? first.kg)) * 10) / 10,
    days: Math.max(1, Math.round((last.timestamp - first.timestamp) / 86400000)),
  };
}

/** LWW merge of a remote weight row (js/sync.js). */
export function applyRemoteWeight(data, remoteUpdatedAt) {
  if (!data || typeof data !== "object" || typeof data.id !== "string") return;
  const stamp = Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : Date.now();
  const list = allWeightRaw();
  const idx = list.findIndex((w) => w.id === data.id);
  if (idx !== -1 && (list[idx].updatedAt ?? 0) >= stamp) return;
  const row = { ...data, updatedAt: stamp };
  if (idx === -1) list.push(row); else list[idx] = row;
  saveWeight(list);
}

// ---------------------------------------------------------------------------
// Misc persisted flags
// ---------------------------------------------------------------------------

export function isNotifyBannerDismissed() {
  return readJSON(STORAGE_KEYS.notifyBannerDismissed, false) === true;
}

export function setNotifyBannerDismissed(value = true) {
  writeJSON(STORAGE_KEYS.notifyBannerDismissed, value === true);
  notify();
}
