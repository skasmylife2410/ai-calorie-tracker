// leftovers.js — "I didn't finish it": a photo of what's left of a meal already logged. The AI says
// how much of each logged item is still on the plate (api/gemini.js, mode "leftovers") and the
// meal is scaled down to what was actually eaten. The meal remembers what it was before, so it can
// be undone, and is marked as having had leftovers taken off.

import * as store from "./store.js";
import { analyzeWithGemini } from "./api.js";
import { scaleMicros } from "./nutrition.js";

/** Meals that leftovers can be taken from: finished, today or yesterday, newest first. */
export function leftoverCandidates(now = Date.now()) {
  const from = now - 36 * 3600000;
  return store.allFoodEntries()
    .filter((e) => e.timestamp >= from && e.timestamp <= now + 60000 && e.isPending !== true && e.analysisFailed !== true && Number(e.calories) > 0)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12);
}

/** The meal's items as the leftovers analysis sees them: one serving of each, times servings. */
export function itemsOf(entry) {
  if (Array.isArray(entry?.analysisItems) && entry.analysisItems.length) return entry.analysisItems.map((i) => ({ ...i }));
  // a meal logged without items (manual, barcode, favourite): the whole entry is one item
  const b = store.baseMacros(entry);
  const grams = entry?.amountUnit === "g" && Number(entry.amount) > 0 ? Number(entry.amount) : 0;
  return [{ name: entry?.name || "meal", calories: b.calories, proteinG: b.proteinG, carbsG: b.carbsG, fatG: b.fatG, micros: b.micros ?? null, gramsEstimate: grams }];
}

/** "0. white rice, cooked — 320 g" lines for the prompt. */
export function leftoversText(items, servings = 1) {
  return items.map((i, idx) => {
    const g = Math.round((Number(i.gramsEstimate) || 0) * servings);
    const name = String(i.name ?? "food").replace(/\s+/g, " ").slice(0, 60);
    return `${idx}. ${name}${g > 0 ? ` — ${g} g` : ""}`;
  }).join("\n").slice(0, 1400);
}

/**
 * Scales each item to what was eaten. `answers` are { index, left_fraction } from the AI; items
 * it didn't mention were eaten. Returns the new one-serving items and the kcal taken off (for the
 * whole meal, servings included).
 */
export function applyLeftovers(items, answers, servings = 1) {
  const left = new Map();
  for (const a of answers ?? []) {
    const idx = Number(a?.index), f = Number(a?.left_fraction);
    if (Number.isInteger(idx) && idx >= 0 && idx < items.length && Number.isFinite(f)) left.set(idx, Math.min(1, Math.max(0, f)));
  }
  let removed = 0;
  const out = items.map((item, idx) => {
    const f = left.get(idx) ?? 0;
    if (f <= 0) return { ...item };
    const keep = 1 - f;
    removed += (Number(item.calories) || 0) * f;
    return {
      ...item,
      calories: (Number(item.calories) || 0) * keep,
      proteinG: (Number(item.proteinG) || 0) * keep,
      carbsG: (Number(item.carbsG) || 0) * keep,
      fatG: (Number(item.fatG) || 0) * keep,
      gramsEstimate: Math.round((Number(item.gramsEstimate) || 0) * keep),
      micros: scaleMicros(item.micros, keep),
      leftFraction: f,
    };
  });
  return { items: out, removedKcal: Math.round(removed * servings) };
}

/**
 * Photograph the leftovers of a logged meal and take them off. Resolves to
 * { ok:true, removedKcal } or { ok:false, message }.
 */
export async function takeLeftovers(entryId, leftoverPhotoDataUrl) {
  const entry = store.getFoodEntry(entryId);
  if (!entry) return { ok: false, message: "That meal is gone." };
  // undo first, so a second leftovers photo replaces the first instead of stacking on it
  const base = entry.leftovers?.before ? { ...entry, ...entry.leftovers.before } : entry;
  const servings = store.normalizeServings(base.servings);
  const items = itemsOf(base);
  const out = await analyzeWithGemini({
    mode: "leftovers",
    imageDataUrl: leftoverPhotoDataUrl,
    imageDataUrl2: base.photoDataUrl || undefined,
    text: leftoversText(items, servings),
  });
  if (!out.ok) return { ok: false, message: out.message };
  const { items: eaten, removedKcal } = applyLeftovers(items, out.items, servings);
  if (removedKcal <= 0) return { ok: true, removedKcal: 0 };
  store.updateFoodEntry(entryId, {
    analysisItems: eaten,
    ...store.fieldsFromItems(eaten, servings),
    leftovers: {
      at: Date.now(),
      removedKcal,
      confidence: Number.isFinite(out.meta?.confidence) ? out.meta.confidence : null,
      // what the meal was, to undo it
      before: { analysisItems: base.analysisItems ?? null, calories: base.calories, proteinG: base.proteinG, carbsG: base.carbsG, fatG: base.fatG, micros: base.micros ?? null, base: base.base ?? null },
    },
  });
  return { ok: true, removedKcal };
}

/** Puts the meal back as it was logged. */
export function undoLeftovers(entryId) {
  const entry = store.getFoodEntry(entryId);
  if (!entry?.leftovers?.before) return false;
  store.updateFoodEntry(entryId, { ...entry.leftovers.before, leftovers: null });
  return true;
}
