// mealtime.js — a whole breakfast, lunch, dinner or snack as one thing to share, and to copy.
//
// Sharing: the day's meals of one mealtime become one post (their foods in one list, their photos
// in one collage; without photos the feed draws the foods, js/ui/ingredient-board.js). Copying:
// someone who ate the same picks which foods and how much, and each food lands in their log as its
// own meal under the same mealtime. Pure apart from the log, so it's tested without a browser.

import * as store from "./store.js";
import { sumMicros, MAX_SHARED_FOODS as MAX_FOODS } from "./nutrition.js";

export const MAX_COLLAGE = 4;         // photos in the collage
export const PORTIONS = [0.5, 1, 2];  // what "I ate the same" offers per food

/** A meal that's done being analysed, so it can be shared. */
export const canShare = (entry) => Boolean(entry) && entry.isPending !== true && entry.analysisFailed !== true;

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** One food as it travels in a post: what it's called, its weight and its numbers. */
const foodOf = (i) => ({
  name: String(i.name ?? "").trim() || "Food",
  gramsEstimate: Math.round(Number(i.gramsEstimate) || 0),
  calories: r1(i.calories), proteinG: r1(i.proteinG), carbsG: r1(i.carbsG), fatG: r1(i.fatG),
  micros: i.micros ?? null,
});

/** Every food in these meals, as eaten (servings applied), oldest meal first. */
export function foodsOfMeals(entries) {
  return [...entries].filter(canShare).sort((a, b) => a.timestamp - b.timestamp)
    .flatMap((e) => store.itemsOfEntry(e).map(foodOf)).slice(0, MAX_FOODS);
}

export const totalsOf = (foods) => ({
  calories: Math.round(foods.reduce((a, f) => a + (Number(f.calories) || 0), 0)),
  proteinG: r1(foods.reduce((a, f) => a + (Number(f.proteinG) || 0), 0)),
  carbsG: r1(foods.reduce((a, f) => a + (Number(f.carbsG) || 0), 0)),
  fatG: r1(foods.reduce((a, f) => a + (Number(f.fatG) || 0), 0)),
});

/**
 * Everything a mealtime post is made of.
 * @param {string} mealType  breakfast | lunch | dinner | snack
 * @param {object[]} entries the day's meals filed under it
 * @param {string} dayKey    "2026-10-21", for the key that stops one mealtime being posted twice
 */
export function mealtimeSummary(mealType, entries, dayKey) {
  const list = [...entries].filter(canShare).sort((a, b) => a.timestamp - b.timestamp);
  const items = foodsOfMeals(list);
  return {
    mealType,
    name: list.map((e) => String(e.name ?? "").trim()).filter(Boolean).join(", ").slice(0, 90),
    ...totalsOf(items),
    micros: sumMicros(items.map((f) => f.micros)),
    items,
    photos: list.map((e) => e.photoDataUrl).filter((p) => typeof p === "string" && p.startsWith("data:image/")).slice(0, MAX_COLLAGE),
    ids: list.map((e) => e.id),
    // adding a food after sharing is a different mealtime to the feed, so it can be shared again
    key: `mt-${dayKey}-${mealType}-${list.length}`,
  };
}

/** Where each photo goes in a collage of `n`, inside w × h with `gap` between: [{x, y, w, h}]. */
export function collageLayout(n, w, h, gap = 3) {
  const cols = (cw) => Math.floor((cw - gap) / 2);
  const half = cols(w), halfH = cols(h);
  const rect = (x, y, rw, rh) => ({ x, y, w: rw, h: rh });
  if (n <= 1) return [rect(0, 0, w, h)];
  if (n === 2) return [rect(0, 0, half, h), rect(half + gap, 0, w - half - gap, h)];
  if (n === 3) return [rect(0, 0, half, h), rect(half + gap, 0, w - half - gap, halfH), rect(half + gap, halfH + gap, w - half - gap, h - halfH - gap)];
  return [rect(0, 0, half, halfH), rect(half + gap, 0, w - half - gap, halfH), rect(0, halfH + gap, half, h - halfH - gap), rect(half + gap, halfH + gap, w - half - gap, h - halfH - gap)];
}

/** The foods picked in the "I ate the same" sheet: left out, or scaled by the portion chosen. */
export function chosenFoods(foods, picks) {
  return foods.flatMap((f, i) => {
    const p = picks[i] ?? { on: true, f: 1 };
    return p.on ? [{ ...store.scaleItem(f, p.f), calories: Math.round(f.calories * p.f) }] : [];
  });
}

/** Puts these foods in the log, each as its own meal under `mealType`, in order, quietly (the
 *  sheet already said where they went). Returns the new entries. */
export function logMealtimeFoods(foods, { mealType, timestamp = Date.now() } = {}) {
  return foods.map((f, i) => store.addFoodEntry({
    name: f.name, calories: f.calories, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG,
    micros: f.micros ?? null, source: "manual", analysisItems: [f], mealType, timestamp: timestamp + i,
  }, { quiet: true }));
}
