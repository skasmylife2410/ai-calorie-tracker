// queue.js — port of MealAnalysisQueue.swift: instant pending entry -> async analyze/ground ->
// finalize, with a reload-time sweep for orphaned pending entries (the web equivalent of the
// iOS relaunch sweep — see SPEC-LOGIC.md §6 and §15.1-2 for why the semantics differ slightly:
// a Vercel function could in principle keep working after the tab closes, but this client-only
// port has no server-side job store, so a reload conservatively marks in-flight work as
// retryable-failed, exactly like the iOS "process died" sweep).

import { ANALYSIS_MODES, analyzeMeal } from "./api.js";
import * as store from "./store.js";

const JOINED_NAME_LIMIT = 80;
const JOINED_NAME_TRUNCATE_TO = 77;

function modeInfo(mode) {
  return ANALYSIS_MODES[mode] ?? ANALYSIS_MODES.meal;
}

/** items.map(name).join(", "), truncated to 77 chars + "…" past 80 chars (spec §11). */
export function buildJoinedName(items) {
  const joined = items.map((i) => i.name).join(", ");
  if (joined === "") return "";
  return joined.length > JOINED_NAME_LIMIT ? `${joined.slice(0, JOINED_NAME_TRUNCATE_TO)}…` : joined;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Enqueues a photo (meal or label) for background analysis. Inserts a pending FoodEntry
 * immediately and returns it; the caller should dismiss its capture UI right away.
 * @param {string} imageDataUrl JPEG as a data: URL (already resized via resize.js)
 * @param {"meal"|"label"} mode
 * @param {{description?:string}} [opts]
 * @returns {object} the pending FoodEntry
 */
export function enqueuePhoto(imageDataUrl, mode, { description = null } = {}) {
  const info = modeInfo(mode);
  const entry = store.addFoodEntry({
    name: info.pendingTitle,
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    source: "photo",
    photoDataUrl: imageDataUrl,
    isPending: true,
    analysisFailed: false,
    analysisItems: null,
    analysisMode: mode,
    analysisDescription: description,
  });
  runAnalysis(entry.id, { imageDataUrl, description, mode });
  return entry;
}

/**
 * Enqueues a typed meal description. No-op (returns null) if the trimmed description is empty.
 * @param {string} description
 * @returns {object|null} the pending FoodEntry, or null if nothing was inserted
 */
export function enqueueText(description, { timestamp } = {}) {
  const trimmed = (description ?? "").trim();
  if (trimmed === "") return null;

  const entry = store.addFoodEntry({
    // lands on the day being viewed when logged from a past day; otherwise now
    ...(Number.isFinite(timestamp) ? { timestamp } : {}),
    name: ANALYSIS_MODES.text.pendingTitle,
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    source: "text",
    photoDataUrl: null,
    isPending: true,
    analysisFailed: false,
    analysisItems: null,
    analysisMode: "text",
    analysisDescription: trimmed,
  });
  runAnalysis(entry.id, { description: trimmed, mode: "text" });
  return entry;
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

/** Pure decision: can this entry be resubmitted for analysis? */
export function canRetry(entry) {
  const mode = entry.analysisMode ?? "meal";
  if (modeInfo(mode).requiresImage) {
    return typeof entry.photoDataUrl === "string" && entry.photoDataUrl.length > 0;
  }
  return typeof entry.analysisDescription === "string" && entry.analysisDescription.trim() !== "";
}

/** Re-runs analysis with the entry's STORED inputs/mode — retry always repeats the original pipeline. */
export function retry(entryId) {
  const entry = store.getFoodEntry(entryId);
  if (!entry) return null;

  if (!canRetry(entry)) {
    return store.updateFoodEntry(entryId, { isPending: false, analysisFailed: true });
  }

  const mode = entry.analysisMode ?? "meal";
  const updated = store.updateFoodEntry(entryId, {
    name: modeInfo(mode).pendingTitle,
    isPending: true,
    analysisFailed: false,
    analysisFailureReason: null,
  });

  runAnalysis(entryId, { imageDataUrl: entry.photoDataUrl, description: entry.analysisDescription, mode });
  return updated;
}

/**
 * "Fix results" — re-runs analysis for an ALREADY-completed entry with an appended correction.
 * Composes `workingDescription + "\n\n" + "Correction: {text}"` (or just the correction if there
 * was no prior description), re-uses the entry's original imageDataUrl/mode.
 * @param {string} entryId
 * @param {string} correctionText
 */
export async function submitCorrection(entryId, correctionText) {
  const entry = store.getFoodEntry(entryId);
  if (!entry) return { success: false, reason: "Entry not found." };

  const trimmedCorrection = (correctionText ?? "").trim();
  const correction = `Correction: ${trimmedCorrection}`;
  const workingDescription = entry.analysisDescription;
  const composedDescription =
    typeof workingDescription === "string" && workingDescription.trim() !== ""
      ? `${workingDescription}\n\n${correction}`
      : correction;

  const mode = entry.analysisMode ?? "meal";
  const outcome = await analyzeMeal({ mode, imageDataUrl: entry.photoDataUrl, text: composedDescription });

  if (outcome.success) {
    store.updateFoodEntry(entryId, {
      analysisItems: outcome.items,
      analysisDescription: composedDescription,
      name: buildJoinedName(outcome.items) || "Analyzed meal",
      calories: sum(outcome.items, "calories"),
      proteinG: sum(outcome.items, "proteinG"),
      carbsG: sum(outcome.items, "carbsG"),
      fatG: sum(outcome.items, "fatG"),
    });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Startup sweep — runs at most once per page load (module-scoped guard, NOT persisted;
// a fresh page load = a fresh module instance = sweeps again, exactly mirroring the
// non-persisted in-memory guard on a fresh iOS queue object after relaunch).
// ---------------------------------------------------------------------------

let hasSweptThisSession = false;

/** Must be called once at app startup, before any pending-state UI renders. Idempotent per load. */
export function sweepIfNeeded() {
  if (hasSweptThisSession) return;
  hasSweptThisSession = true;

  for (const entry of store.allFoodEntries()) {
    if (entry.isPending === true) {
      store.updateFoodEntry(entry.id, {
        isPending: false,
        analysisFailed: true,
        name: "Analysis failed — tap to retry",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Completion callback hook
// ---------------------------------------------------------------------------

const completionListeners = new Set();

/** Registers a callback fired whenever an entry finishes analysis (success or failure). Returns unsubscribe. */
export function onComplete(callback) {
  completionListeners.add(callback);
  return () => completionListeners.delete(callback);
}

function emitComplete(payload) {
  for (const listener of completionListeners) {
    try {
      listener(payload);
    } catch (err) {
      console.error("queue.js: completion listener threw", err);
    }
  }
}

function sum(items, key) {
  return items.reduce((acc, item) => acc + (item[key] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Notifications (best-effort — see SPEC-LOGIC.md §15.3: no direct browser equivalent of
// UNUserNotificationCenter local notifications; degrade to Notification API when permitted,
// silently no-op otherwise).
// ---------------------------------------------------------------------------

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") return false;
  try {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  } catch {
    return false;
  }
}

export function isNotificationAuthorized() {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

function postCompletionNotification(name, calories) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    // eslint-disable-next-line no-new
    new Notification("SnapCal", { body: `${name} — ${Math.round(calories)} calories logged` });
  } catch {
    // best-effort only
  }
}

function isDocumentForeground() {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}

// ---------------------------------------------------------------------------
// Core pipeline: analyze -> ground (inside analyzeMeal) -> finalize (handle outcome)
// ---------------------------------------------------------------------------

async function runAnalysis(entryId, { imageDataUrl, description, mode }) {
  const outcome = await analyzeMeal({ mode, imageDataUrl, text: description });
  handleOutcome(entryId, mode, outcome);
}

function handleOutcome(entryId, mode, outcome) {
  const entry = store.getFoodEntry(entryId);
  if (!entry) return; // entry was deleted while analysis was in flight

  if (outcome.success) {
    const items = outcome.items;

    // Typed "no food found" is a near-certain user mistake, NOT a valid quiet success
    // (unlike a photo, which can legitimately contain no food).
    if (items.length === 0 && mode === "text") {
      store.updateFoodEntry(entryId, {
        isPending: false,
        analysisFailed: true,
        name: "Analysis failed — tap to retry",
        analysisFailureReason: "Couldn't find any food in that description — try adding more detail.",
      });
      emitComplete({ entryId, success: false, reason: "Couldn't find any food in that description — try adding more detail." });
      return;
    }

    const joinedName = buildJoinedName(items);
    const name = joinedName === "" ? "Analyzed meal" : joinedName;
    const calories = sum(items, "calories");

    store.updateFoodEntry(entryId, {
      name,
      calories,
      proteinG: sum(items, "proteinG"),
      carbsG: sum(items, "carbsG"),
      fatG: sum(items, "fatG"),
      analysisItems: items,
      isPending: false,
      analysisFailed: false,
      analysisFailureReason: null,
    });

    if (isDocumentForeground()) {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(20); // best-effort haptic stand-in; Safari iOS has no Vibration API
      }
    } else {
      postCompletionNotification(name, calories);
    }

    emitComplete({ entryId, success: true, name, calories });
    return;
  }

  store.updateFoodEntry(entryId, {
    isPending: false,
    analysisFailed: true,
    name: "Analysis failed — tap to retry",
    analysisFailureReason: outcome.reason,
  });
  emitComplete({ entryId, success: false, reason: outcome.reason });
}

// ---------------------------------------------------------------------------
// Entry state classification (for UI state-machine rendering)
// ---------------------------------------------------------------------------

/** @returns {"pending"|"failed"|"completedWithItems"|"completedPlain"} */
export function entryState(entry) {
  if (entry.isPending === true) return "pending";
  if (entry.analysisFailed === true) return "failed";
  if (entry.analysisItems != null) return "completedWithItems";
  return "completedPlain";
}
