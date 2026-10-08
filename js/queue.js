// queue.js — port of MealAnalysisQueue.swift: instant pending entry -> async analyze/ground ->
// finalize, with a reload-time sweep for orphaned pending entries (the web equivalent of the
// iOS relaunch sweep — see SPEC-LOGIC.md §6 and §15.1-2 for why the semantics differ slightly:
// a Vercel function could in principle keep working after the tab closes, but this client-only
// port has no server-side job store, so a reload conservatively marks in-flight work as
// retryable-failed, exactly like the iOS "process died" sweep).

import { ANALYSIS_MODES, analyzeMeal } from "./api.js";
import * as store from "./store.js";
import { leftoversForItems, leftoversRecord } from "./leftovers.js";

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
export function enqueueText(description, { timestamp, photoDataUrl = null, leftoversDataUrl = null } = {}) {
  const trimmed = (description ?? "").trim();
  if (trimmed === "") return null;
  // photoDataUrl: a photo of the meal for context — it fills in what the words leave out but
  // never changes an amount they give (api/gemini.js, js/stated.js); it stays with the meal and
  // goes along on every re-analysis. leftoversDataUrl: what wasn't eaten, taken off once the
  // meal is known (js/leftovers.js); not kept.

  const entry = store.addFoodEntry({
    // lands on the day being viewed when logged from a past day; otherwise now
    ...(Number.isFinite(timestamp) ? { timestamp } : {}),
    name: ANALYSIS_MODES.text.pendingTitle,
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    source: "text",
    photoDataUrl: photoDataUrl || null,
    isPending: true,
    analysisFailed: false,
    analysisItems: null,
    analysisMode: "text",
    analysisDescription: trimmed,
  });
  runAnalysis(entry.id, { imageDataUrl: photoDataUrl || undefined, description: trimmed, mode: "text", leftoversDataUrl });
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
 * How sure the analysis is (0–1) and, when it's under 50%, what to ask. The questions are asked
 * once: after the person has answered, a still-unsure result is kept as it is.
 */
export function metaFields(entry, meta, items = []) {
  const confidence = Number.isFinite(meta?.confidence) ? meta.confidence : averageConfidence(items);
  const ask = !entry?.questionsAnswered && Array.isArray(meta?.questions) && meta.questions.length > 0 && confidence !== null && confidence < 0.5;
  return {
    analysisConfidence: confidence,
    analysisQuestions: ask ? meta.questions : null,
    cookingFat: meta?.cookingFat ?? null,
    // questions first; the size photo is asked for once they're out of the way
    analysisSizeCheck: !ask && needsSizeCheck(entry, meta, items) ? richKcal(items) : null,
  };
}

// --- Size check ---------------------------------------------------------------------------------
// Rich foods (sweets, pastries, fried, cheesy, creamy) pack 300–500 kcal per 100 g, so a portion
// misjudged by a third moves the day by 100–200 kcal. When a photo of one shows nothing to judge
// its size by, the app asks for one more photo with a hand, a fork or a card beside it.

export const RICH_KCAL_PER_100G = 300;
export const SIZE_CHECK_MIN_KCAL = 200;
const FAT_ITEM = /\b(oil|butter|aceite|mantequilla|ghee|lard|manteca)\b/i;
const RICH_NAME = /(fried|frit|empanad|pizza|burger|hamburg|cheese|queso|cream|crema|chocolate|cake|pastel|torta|donut|dona|croissant|cookie|galleta|brownie|churro|pie\b|tart|pastry|dessert|postre|nutella|peanut butter|mani|nuts|nueces)/i;

/** Calories in the meal that come from rich items (cooking oil aside: it has its own question). */
export function richKcal(items) {
  let kcal = 0;
  for (const i of items ?? []) {
    const c = Number(i?.calories) || 0, g = Number(i?.gramsEstimate) || 0;
    if (c <= 0 || g <= 0 || FAT_ITEM.test(i?.name ?? "")) continue;
    const per100 = (c / g) * 100;
    if (per100 >= RICH_KCAL_PER_100G || (per100 >= 220 && RICH_NAME.test(i?.name ?? ""))) kcal += c;
  }
  return Math.round(kcal);
}

/** A meal photo of rich food with nothing in it to show the size, not checked yet. */
export function needsSizeCheck(entry, meta, items) {
  if ((entry?.analysisMode ?? "meal") !== "meal" || entry?.sizeChecked) return false;
  if (meta?.sizeReference === "clear") return false;
  return richKcal(items) >= SIZE_CHECK_MIN_KCAL;
}

/** The size-check photo: re-analyse with both photos, once. */
export function addSizePhoto(entryId, sizeDataUrl) {
  const entry = store.getFoodEntry(entryId);
  if (!entry || !sizeDataUrl) return null;
  const updated = store.updateFoodEntry(entryId, { isPending: true, analysisFailed: false, analysisSizeCheck: null, sizeChecked: true });
  runAnalysis(entryId, { imageDataUrl: entry.photoDataUrl, imageDataUrl2: sizeDataUrl, description: entry.analysisDescription, mode: "meal" });
  return updated;
}

/** "Keep the estimate": stop asking for a size photo. */
export function skipSizeCheck(entryId) {
  return store.updateFoodEntry(entryId, { analysisSizeCheck: null, sizeChecked: true });
}

/** Older answers had only per-item confidence: weigh it by calories. */
export function averageConfidence(items) {
  let w = 0, sum = 0;
  for (const i of items ?? []) {
    const c = Number(i?.confidence);
    const kcal = Math.max(1, Number(i?.calories) || 0);
    if (!Number.isFinite(c)) continue;
    w += kcal; sum += c * kcal;
  }
  return w > 0 ? Math.min(1, Math.max(0, sum / w)) : null;
}

/** "Answers to your questions" block added to the meal's description for the re-analysis. */
export function answersText(questions, answers) {
  const lines = (questions ?? []).map((q, i) => {
    const a = String(answers?.[i] ?? "").trim();
    return a ? `- ${q.question} ${a}` : null;
  }).filter(Boolean);
  return lines.length ? `Answers to your questions (authoritative):\n${lines.join("\n")}` : "";
}

/**
 * The person answered the analysis's questions: re-analyse with their answers (and the same
 * photo), once. The meal shows as analysing meanwhile, like any other.
 */
export function answerQuestions(entryId, answers) {
  const entry = store.getFoodEntry(entryId);
  if (!entry) return null;
  const extra = answersText(entry.analysisQuestions, answers);
  const description = [entry.analysisDescription, extra].filter((x) => typeof x === "string" && x.trim() !== "").join("\n\n");
  const mode = entry.analysisMode ?? "meal";
  const updated = store.updateFoodEntry(entryId, {
    isPending: true,
    analysisFailed: false,
    analysisQuestions: null,
    questionsAnswered: true,
    analysisDescription: description || entry.analysisDescription,
  });
  runAnalysis(entryId, { imageDataUrl: entry.photoDataUrl, description, mode });
  return updated;
}

/** "Not now": keep the best guess and stop asking. */
export function skipQuestions(entryId) {
  return store.updateFoodEntry(entryId, { analysisQuestions: null, questionsAnswered: true });
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
      // items are one serving; keep whatever servings multiplier the meal already had
      ...store.fieldsFromItems(outcome.items, entry.servings),
      // a correction is the person telling us: never ask on top of it
      ...metaFields({ ...entry, questionsAnswered: true, sizeChecked: true }, outcome.meta, outcome.items),
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
    // Cut off mid-analysis (the app was closed or the phone suspended it), or failed only
    // because the connection dropped: try again by itself, a couple of times per meal, before
    // leaving it as "Analysis failed — tap to retry".
    const cutOff = entry.isPending === true;
    const droppedConnection = entry.analysisFailed === true && /^Gemini network error/.test(entry.analysisFailureReason ?? "");
    const tries = Number(entry.autoRetries) || 0;
    if ((cutOff || droppedConnection) && canRetry(entry) && tries < AUTO_RETRY_LIMIT) {
      store.updateFoodEntry(entry.id, { autoRetries: tries + 1 });
      retry(entry.id);
      continue;
    }
    if (cutOff) {
      store.updateFoodEntry(entry.id, {
        isPending: false,
        analysisFailed: true,
        name: "Analysis failed — tap to retry",
      });
    }
  }
}

const AUTO_RETRY_LIMIT = 2;

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

const NETWORK_RETRIES = 3;
const RETRY_DELAYS_MS = [2000, 6000, 15000];

/** Resolves when the app is on screen (at once if it already is). */
function whenVisible() {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", on);
      resolve();
    };
    document.addEventListener("visibilitychange", on);
  });
}

const isNetworkFailure = (outcome) =>
  !outcome.success && (outcome.errorType === "network" || /^Gemini network error/.test(outcome.reason ?? ""));

/**
 * Analyse, and ride out a lost connection: phones suspend an app in the background (people
 * leave while "We'll notify you when done!" is showing) and the request dies with it. A
 * network failure keeps the meal pending, waits until the app is on screen again and retries,
 * instead of turning it into "Analysis failed".
 */
async function runAnalysis(entryId, { imageDataUrl, imageDataUrl2, description, mode, leftoversDataUrl = null }) {
  let outcome = await analyzeMeal({ mode, imageDataUrl, imageDataUrl2, text: description });
  for (let attempt = 0; attempt < NETWORK_RETRIES && isNetworkFailure(outcome); attempt += 1) {
    await whenVisible();
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt] ?? 15000));
    if (!store.getFoodEntry(entryId)) return; // deleted while waiting
    outcome = await analyzeMeal({ mode, imageDataUrl, imageDataUrl2, text: description });
  }
  if (leftoversDataUrl && outcome.success && outcome.items.length > 0 && store.getFoodEntry(entryId)) {
    outcome = await withLeftovers(outcome, leftoversDataUrl, imageDataUrl);
  }
  handleOutcome(entryId, mode, outcome);
}

/**
 * Takes a leftovers photo off a fresh analysis: the meal is logged at what was eaten, and keeps
 * what it was before for Undo. Foods measured by the person are left as they are. If the
 * leftovers can't be read the meal is logged whole (it can be done again from the meal).
 */
export async function withLeftovers(outcome, leftoversDataUrl, beforeDataUrl = null) {
  const res = await leftoversForItems(outcome.items, leftoversDataUrl, beforeDataUrl, 1);
  if (!res.ok) return { ...outcome, leftoversError: res.message || "leftovers" };
  if (res.removedKcal <= 0) return { ...outcome, keptMeasured: res.keptMeasured };
  const whole = { analysisItems: outcome.items, ...store.fieldsFromItems(outcome.items, 1) };
  return { ...outcome, items: res.items, leftovers: leftoversRecord(whole, res), keptMeasured: res.keptMeasured };
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
    const fields = store.fieldsFromItems(items, store.getFoodEntry(entryId)?.servings);
    const calories = fields.calories;

    store.updateFoodEntry(entryId, {
      name,
      ...fields,
      analysisItems: items,
      isPending: false,
      analysisFailed: false,
      analysisFailureReason: null,
      ...metaFields(entry, outcome.meta, items),
      // fresh foods replace any leftovers taken off before (it can be done again from the meal)
      leftovers: outcome.leftovers ?? null,
      ...(outcome.leftoversError ? { leftoversFailed: true } : entry.leftoversFailed ? { leftoversFailed: null } : {}),
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
