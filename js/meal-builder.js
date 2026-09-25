// meal-builder.js — the "plate" you fill from the food search before adding it, so several foods
// go in at once instead of reopening search for each. Pure functions; the UI is in ui/search.js.
//
// A tray item keeps the product's per-base numbers (usually per 100 g) and scales them by the
// amount eaten. Added together they become ONE meal whose analysisItems are the foods, so tapping
// it later opens the item-by-item editor, same as a scanned plate.

import { cleanMicros, scaleMicros, sumMicros } from "./nutrition.js";

const r1 = (v) => Math.round(v * 10) / 10;

/** "per 100 g" -> {amount:100, unit:"g"}, "per serving (30 g)" -> {30, "g"}, unknown -> 1 serving. */
export function baseOf(product) {
  const desc = String(product?.servingDescription ?? "");
  const hundred = desc.match(/per\s+100\s*(g|ml)/i);
  if (hundred) return { amount: 100, unit: hundred[1].toLowerCase() };
  const inner = desc.match(/\((\d+(?:[.,]\d+)?)\s*(g|ml)\)/i);
  if (inner) return { amount: Number(inner[1].replace(",", ".")), unit: inner[2].toLowerCase() };
  return { amount: 1, unit: "serving" };
}

/** A starting portion: 100 g for per-100 g foods, otherwise the stated serving. */
export function trayItemFromProduct(product, key = null) {
  const base = baseOf(product);
  const item = {
    key: key ?? `${product?.name ?? ""}|${product?.brand ?? ""}`,
    name: String(product?.name ?? "").trim() || "Food",
    per: {
      amount: base.amount,
      unit: base.unit,
      calories: Number(product?.calories) || 0,
      proteinG: Number(product?.proteinG) || 0,
      carbsG: Number(product?.carbsG) || 0,
      fatG: Number(product?.fatG) || 0,
      micros: cleanMicros(product?.micros),
    },
    amount: base.amount,
    // a saved meal's own foods (one serving), so it unpacks back into separate foods when added
    ...(Array.isArray(product?.items) && product.items.length > 0 ? { sub: product.items } : {}),
  };
  return item;
}

/** Numbers for the amount currently on the tray item. */
export function scaled(item) {
  const f = item.per.amount > 0 ? item.amount / item.per.amount : 0;
  return {
    calories: Math.round(item.per.calories * f),
    proteinG: r1(item.per.proteinG * f),
    carbsG: r1(item.per.carbsG * f),
    fatG: r1(item.per.fatG * f),
    micros: scaleMicros(item.per.micros, f),
  };
}

/** Step size for the − / + buttons: 25 g/ml, or half a serving. */
export function stepOf(item) {
  return item.per.unit === "serving" ? 0.5 : 25;
}

export function withAmount(item, amount) {
  const min = stepOf(item);
  const v = Number(amount);
  return { ...item, amount: Number.isFinite(v) ? Math.min(5000, Math.max(min, r1(v))) : item.amount };
}

export function trayTotals(items) {
  const each = items.map(scaled);
  const totals = each.reduce(
    (t, s) => ({ calories: t.calories + s.calories, proteinG: r1(t.proteinG + s.proteinG), carbsG: r1(t.carbsG + s.carbsG), fatG: r1(t.fatG + s.fatG) }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
  return { ...totals, micros: sumMicros(each.map((s) => s.micros)) };
}

/** "Arepa", "Arepa & Huevo", "Arepa, Huevo & Café", "Arepa, Huevo +2". */
export function mealName(items) {
  const names = items.map((i) => i.name.split(",")[0].trim());
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/** The fields for store.addFoodEntry: one meal, the foods as its items. */
export function trayToEntry(items, timestamp = Date.now()) {
  const totals = trayTotals(items);
  return {
    name: mealName(items).slice(0, 90),
    ...totals,
    source: "manual",
    timestamp,
    analysisItems: items.flatMap((i) => {
      if (Array.isArray(i.sub) && i.per.unit === "serving") {
        const n = i.amount; // servings of the saved meal
        return i.sub.map((f) => ({
          ...f,
          id: undefined,
          calories: (Number(f.calories) || 0) * n,
          proteinG: r1((Number(f.proteinG) || 0) * n),
          carbsG: r1((Number(f.carbsG) || 0) * n),
          fatG: r1((Number(f.fatG) || 0) * n),
          micros: scaleMicros(f.micros, n),
          gramsEstimate: Math.round((Number(f.gramsEstimate) || 0) * n),
          ...(Number.isFinite(Number(f.amount)) ? { amount: r1(Number(f.amount) * n) } : {}),
        }));
      }
      const s = scaled(i);
      const unit = i.per.unit;
      return {
        name: i.name,
        unit,
        amount: i.amount,
        // grams underneath for the totals and portion plate; a serving keeps its own weight unknown
        gramsEstimate: unit === "serving" ? 0 : i.amount,
        ...s,
      };
    }),
  };
}
