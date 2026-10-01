// cooking-fat.js — the oil or butter a meal was cooked in, which a photo can't show and which
// is the biggest thing people leave out (a tablespoon of oil is ~120 kcal). When the analysis
// assumed some, the meal's editor asks "Cooked with oil or butter?" with None / A little / A lot,
// and the answer replaces the assumed amount with a known one.

const FAT_NAME = /\b(oil|olive oil|cooking oil|aceite|butter|mantequilla|margarin[ae]?|ghee|lard|manteca)\b/i;
export const FAT_LEVELS = { none: 0, little: 5, lot: 20 }; // grams of oil

export const isFatItem = (item) => FAT_NAME.test(String(item?.name ?? ""));

/** Grams of cooking fat in the meal now (0 when none was listed). */
export const fatGrams = (items) => (items ?? []).filter(isFatItem).reduce((g, i) => g + (Number(i.gramsEstimate) || 0), 0);

/** Which button matches the meal as it is, or null when it's the analysis's own guess. */
export function fatLevelOf(items) {
  const g = fatGrams(items);
  if (g === 0) return "none";
  if (g === FAT_LEVELS.little) return "little";
  if (g === FAT_LEVELS.lot) return "lot";
  return null;
}

/** The items with the cooking fat set to `level`: the old fat lines go, one oil line comes in. */
export function applyCookingFat(items, level, { name = "cooking oil", idFn = () => `fat-${Date.now()}` } = {}) {
  const rest = (items ?? []).filter((i) => !isFatItem(i));
  const g = FAT_LEVELS[level] ?? 0;
  if (g === 0) return rest;
  return [...rest, {
    id: idFn(),
    name,
    gramsEstimate: g,
    calories: Math.round(g * 8.84),
    proteinG: 0,
    carbsG: 0,
    fatG: g,
    micros: { fiberG: 0, sugarG: 0, addedSugarG: 0, satFatG: Math.round(g * 0.14 * 10) / 10, sodiumMg: 0, potassiumMg: 0 },
    confidence: 0.9,
    grounded: false,
  }];
}
