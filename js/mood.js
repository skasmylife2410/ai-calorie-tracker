// mood.js — the whole app reacts to how the day is going.
//   "over": today's calories are past the budget → meltdown (glitching number, red pulse, scanlines).
//   "sad":  no meal logged for two days → gloom (colour drains, rain falls). The next meal brings it back.
// Set as <html data-mood="…">; css/app.css draws it. Phones asking for less motion get the colours only.

export const SAD_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/** The newest finished meal's time, or null when there are none. */
export function lastMealAt(entries) {
  let latest = null;
  for (const e of entries ?? []) {
    if (e?.isPending === true) continue;
    const at = Number(e?.timestamp);
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/** "sad" | "over" | null. New accounts (no meals yet) are never sad. */
export function moodFor({ remainingToday, lastMeal, now = Date.now() }) {
  if (lastMeal !== null && lastMeal !== undefined && now - lastMeal >= SAD_AFTER_MS) return "sad";
  if (Number.isFinite(remainingToday) && Math.round(remainingToday) < 0) return "over";
  return null;
}

/** Whole days since the last meal, for the "it's been N days" card. */
export const daysAway = (lastMeal, now = Date.now()) => Math.max(2, Math.floor((now - lastMeal) / 86_400_000));

/**
 * Puts the mood on the page. Going over plays a one-off shake and flash; coming back from sad
 * plays a "colour returns" bloom. Nothing happens when the mood didn't change.
 */
let firstApply = true;
export function applyMood(mood, doc = globalThis.document) {
  const root = doc?.documentElement;
  if (!root) return;
  const prev = root.dataset.mood ?? null;
  const opening = firstApply;
  firstApply = false;
  if (prev === (mood ?? null)) return;
  if (mood) root.dataset.mood = mood; else delete root.dataset.mood;
  const once = (cls, ms) => {
    root.classList.remove(cls);
    void root.offsetWidth; // restart the animation
    root.classList.add(cls);
    setTimeout(() => root.classList.remove(cls), ms);
  };
  if (opening) return; // effects only when it happens, not every time the app opens
  if (mood === "over") once("mood-hit", 900);
  if (prev === "sad" && mood !== "sad") once("mood-revive", 1600);
}
