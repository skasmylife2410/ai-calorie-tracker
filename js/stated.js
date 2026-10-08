// stated.js — amounts people give themselves are objective measurements. "200 g of chicken" or
// "a 330 ml can" is logged at exactly that weight or volume, whatever a photo seems to show and
// however the model's estimate drifts. The AI quotes the words that gave each food's amount
// (stated_amount, api/gemini.js); this checks the quote really is in what they wrote, reads it,
// and holds the item to it. Such foods are marked `stated`, so a leftovers photo leaves them too.
//
// Weights and volumes (g, kg, oz, lb, ml, l, fl oz) are held exactly; a range ("200–250 g") keeps
// the estimate if it's inside, else the nearest end. Household measures (cups, spoons, scoops,
// glasses) are trusted to the model's conversion, since a cup of rice and a cup of milk weigh
// different amounts, but they're still the person's own amount and are marked `stated`.

import { scaleMicros } from "./nutrition.js";
import { densityOf, kindOf } from "./ui/portion-plate.js";

const UNITS = [
  // longest spellings first, so "fl oz" is not read as "oz", "kg" not as "g"
  [/^(?:fl\.?\s*oz|fluid\s+ounces?)/, "volume", 29.57],
  [/^(?:kilogramos?|kilograms?|kilos?|kgs?)/, "mass", 1000],
  [/^(?:gramos?|grammes?|grams?|grs?|g)/, "mass", 1],
  [/^(?:onzas?|ounces?|oz)/, "mass", 28.35],
  [/^(?:libras?|pounds?|lbs?)/, "mass", 453.6],
  [/^(?:mililitros?|millilit(?:re|er)s?|mls?|cc)/, "volume", 1],
  [/^(?:centilit(?:re|er)s?|cl)/, "volume", 10],
  [/^(?:decilit(?:re|er)s?|dl)/, "volume", 100],
  [/^(?:litros?|lit(?:re|er)s?|lts?|l)/, "volume", 1000],
  [/^(?:cups?|tazas?|tablespoons?|tbsps?|cucharadas?|teaspoons?|tsps?|cucharaditas?|scoops?|medidas?|glass(?:es)?|vasos?)/, "household", 0],
];

const WORD_NUMBERS = [
  [/^(?:a\s+)?quarter(?:\s+of)?(?:\s+an?)?\s+|^(?:un\s+)?cuarto\s+de\s+/, 0.25],
  [/^half(?:\s+of)?(?:\s+an?)?\s+|^medi[oa]\s+/, 0.5],
  [/^(?:an?|one|un|una|uno)\s+/, 1],
  [/^(?:two|dos)\s+/, 2],
  [/^(?:three|tres)\s+/, 3],
];

const FRACTIONS = { "½": ".5", "¼": ".25", "¾": ".75", "⅓": ".333", "⅔": ".667" };

function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[½¼¾⅓⅔]/g, (c) => FRACTIONS[c])
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads one number at the start of `s`: "200", "1.5", "1/2", "1 1/2", ".5". */
function readNumber(s) {
  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*/);
  if (m && Number(m[3]) > 0) return { n: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: s.slice(m[0].length) };
  m = s.match(/^(\d+)\s*\/\s*(\d+)\s*/);
  if (m && Number(m[2]) > 0) return { n: Number(m[1]) / Number(m[2]), rest: s.slice(m[0].length) };
  m = s.match(/^(\d*\.?\d+)\s*/);
  if (m) return { n: Number(m[1]), rest: s.slice(m[0].length) };
  for (const [re, n] of WORD_NUMBERS) {
    const w = s.match(re);
    if (w) return { n, rest: s.slice(w[0].length) };
  }
  return null;
}

function readUnit(s) {
  const t = s.replace(/^(?:of|de)\s+/, "");
  for (const [re, kind, factor] of UNITS) {
    const m = t.match(re);
    // the unit must end there: "2 glasses" is not 2 g, "1 large" is not 1 l
    if (m && !/^[a-záéíóúñ]/.test(t.slice(m[0].length))) return { kind, factor };
  }
  return null;
}

/**
 * The first weight or volume in a quote, in grams or ml: { kind:"mass"|"volume", lo, hi } (lo = hi
 * unless it's a range), { kind:"household" } for cups and spoons, or null when there's none.
 */
export function parseMeasure(quote) {
  const s = normalize(quote);
  for (let i = 0; i < s.length; i += 1) {
    if (i > 0 && /[a-z0-9.]/.test(s[i - 1])) continue; // numbers and words start on a boundary
    const a = readNumber(s.slice(i));
    if (!a || !(a.n > 0)) continue;
    let lo = a.n, hi = a.n, rest = a.rest;
    const range = rest.match(/^(?:-|–|to|a)\s*/);
    if (range) {
      const b = readNumber(rest.slice(range[0].length));
      if (b && b.n > a.n) { hi = b.n; rest = b.rest; }
    }
    const unit = readUnit(rest);
    if (!unit) continue;
    if (unit.kind === "household") return { kind: "household" };
    return { kind: unit.kind, lo: lo * unit.factor, hi: hi * unit.factor };
  }
  return null;
}

/** True when the quote is really in what the person wrote (spacing aside). */
export function quoteIsInText(quote, text) {
  const q = normalize(quote).replace(/\s/g, "");
  return q.length > 0 && normalize(text).replace(/\s/g, "").includes(q);
}

const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function scaled(item, f) {
  if (!(f > 0) || Math.abs(f - 1) < 1e-9) return { ...item };
  return {
    ...item,
    calories: Math.round((Number(item.calories) || 0) * f),
    proteinG: r1((Number(item.proteinG) || 0) * f),
    carbsG: r1((Number(item.carbsG) || 0) * f),
    fatG: r1((Number(item.fatG) || 0) * f),
    micros: scaleMicros(item.micros, f),
  };
}

/** One item held to the amount its person gave. Items without one come back as they were. */
export function holdToStated(item, text) {
  const quote = String(item?.statedAmount ?? "").trim();
  const { statedAmount, stated, ...rest } = item ?? {};
  if (!quote || !quoteIsInText(quote, text)) return rest;
  const m = parseMeasure(quote);
  if (!m) return rest;
  const out = { ...rest, stated: true, statedAmount: quote.slice(0, 60) };
  if (m.kind === "household") return out;

  const grams = Number(item.gramsEstimate) || 0;
  const counted = out.unit === "serving" && Number(out.amount) > 0; // "2 eggs, 120 g": keep the count
  let target, ml = null;
  if (m.kind === "mass") {
    target = m.lo === m.hi ? m.lo : clamp(grams || m.lo, m.lo, m.hi);
  } else {
    // a volume: the model's grams are fine for any sensible density (oil 0.9 … honey 1.4)
    // something poured by the ml that isn't a known food is a drink: water's density
    const density = kindOf(item.name) === "other" ? 1 : densityOf(item.name);
    const impliedMl = grams > 0 ? grams / density : m.lo;
    ml = m.lo === m.hi ? m.lo : clamp(impliedMl, m.lo, m.hi);
    target = grams >= ml * 0.8 && grams <= ml * 1.5 ? grams : ml * density;
  }
  target = Math.max(1, Math.round(target));
  const held = grams > 0 ? scaled(out, target / grams) : out;
  held.gramsEstimate = target;
  if (counted) {
    held.gramsPerServing = Math.max(1, Math.round(target / Number(out.amount)));
  } else if (ml !== null) {
    held.unit = "ml";
    held.amount = r1(ml);
  } else {
    held.unit = "g";
    held.amount = target;
    delete held.gramsPerServing;
  }
  return held;
}

/** Every item held to what the person wrote (`text` is their own words). */
export function holdItemsToStated(items, text) {
  if (!Array.isArray(items)) return items;
  if (typeof text !== "string" || text.trim() === "") return items.map((i) => holdToStated({ ...i, statedAmount: "" }, ""));
  return items.map((i) => holdToStated(i, text));
}
