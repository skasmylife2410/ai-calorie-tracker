// api.js — client-side data-source clients: Open Food Facts, USDA FoodData Central, the
// barcode fallback chain, USDA grounding of Gemini output, and the Gemini analysis call
// (which itself is proxied through /api/gemini so the API keys never reach the browser).
//
// Verbatim URLs/params/constants per SPEC-LOGIC.md §3, §7, §8, §9, §10.

import { apiFetch } from "./net.js";
import { cleanMicros, scaleMicros, MICRO_KEYS } from "./nutrition.js";

// Open Food Facts asks apps to identify themselves with a contact email — put YOURS here.
const OFF_USER_AGENT = "SnapCal/1.0 (personal calorie tracker; you@example.com)";
// NOTE (portability): browsers treat "User-Agent" as a forbidden fetch header and silently drop
// it — there is no web equivalent of setting a custom UA from client JS. We still set it so the
// header is honored in any environment that does allow it (e.g. a future server-side proxy).

const OFF_TIMEOUT_MS = 10000;
const USDA_TIMEOUT_MS = 10000;
const GROUNDING_PER_ITEM_TIMEOUT_MS = 3000;
const GROUNDING_BATCH_BUDGET_MS = 4000;
const USDA_DEMO_KEY = "DEMO_KEY";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Tries Double, then Int, then Double(String) — anything else = field absent (per-field, never throws). */
function lenientNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function usdaApiKey() {
  // Browser has no access to server secrets; USDA's DEMO_KEY is public-safe and rate-limited,
  // matching the iOS fallback (Secrets.usdaAPIKey ?? "DEMO_KEY"). A real key can be injected via
  // configureUsdaApiKey() if the host app wants to proxy one server-side later.
  return _usdaApiKeyOverride ?? USDA_DEMO_KEY;
}
let _usdaApiKeyOverride = null;
export function configureUsdaApiKey(key) {
  _usdaApiKeyOverride = key && key.trim() !== "" ? key.trim() : null;
}

// ---------------------------------------------------------------------------
// §8 OpenFoodFactsClient
// ---------------------------------------------------------------------------

/**
 * Shared basis-selection rule (parseBasis). Returns null if any of the 4 core per-100g
 * macros is missing (incomplete/dropped); otherwise picks per-serving (only if a serving_size
 * string AND all 4 per-serving nutriments are present) else per-100g.
 */
export function parseBasis(nutriments, servingSize, servingQuantity) {
  const n = nutriments ?? {};

  const kcal100g =
    lenientNumber(n["energy-kcal_100g"]) ??
    (lenientNumber(n["energy-kj_100g"]) !== undefined ? lenientNumber(n["energy-kj_100g"]) / 4.184 : undefined) ??
    (lenientNumber(n["energy_100g"]) !== undefined ? lenientNumber(n["energy_100g"]) / 4.184 : undefined);
  const protein100g = lenientNumber(n["proteins_100g"]);
  const carbs100g = lenientNumber(n["carbohydrates_100g"]);
  const fat100g = lenientNumber(n["fat_100g"]);

  if ([kcal100g, protein100g, carbs100g, fat100g].some((v) => v === undefined)) {
    return null;
  }

  const servingPresent = typeof servingSize === "string" && servingSize.trim() !== "";

  let kcalServing = lenientNumber(n["energy-kcal_serving"]);
  if (kcalServing === undefined) {
    const kj = lenientNumber(n["energy-kj_serving"]);
    if (kj !== undefined) kcalServing = kj / 4.184;
  }
  if (kcalServing === undefined) {
    const e = lenientNumber(n["energy_serving"]);
    if (e !== undefined) kcalServing = e / 4.184;
  }
  const proteinServing = lenientNumber(n["proteins_serving"]);
  const carbsServing = lenientNumber(n["carbohydrates_serving"]);
  const fatServing = lenientNumber(n["fat_serving"]);
  const allServingPresent = [kcalServing, proteinServing, carbsServing, fatServing].every((v) => v !== undefined);

  if (servingPresent && allServingPresent) {
    return {
      servingDescription: `per serving (${servingSize.trim()})`,
      calories: kcalServing,
      proteinG: proteinServing,
      carbsG: carbsServing,
      fatG: fatServing,
      micros: servingMicros(n, servingSize, servingQuantity),
    };
  }

  return { servingDescription: "per 100 g", calories: kcal100g, proteinG: protein100g, carbsG: carbs100g, fatG: fat100g, micros: offMicros(n, "_100g") };
}

/**
 * Grams (or ml) in one serving: OFF's serving_quantity when it has one, else the number in
 * serving_size ("30 g", "1 cup (240 ml)"). Null when the serving isn't given by weight.
 */
export function servingGrams(servingSize, servingQuantity) {
  const q = lenientNumber(servingQuantity);
  if (q !== undefined && q > 0) return q;
  const s = String(servingSize ?? "");
  const m = s.match(/\(\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i) ?? s.match(/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
  const v = m ? Number(m[1].replace(",", ".")) : NaN;
  return v > 0 ? v : null;
}

/**
 * Per-serving micros. OFF often has the four macros per serving but leaves sugars, fiber and
 * sodium only per 100 g; those are worked out from the serving weight instead of dropped.
 */
function servingMicros(n, servingSize, servingQuantity) {
  const own = offMicros(n, "_serving") ?? {};
  const grams = servingGrams(servingSize, servingQuantity);
  const from100 = grams ? scaleMicros(offMicros(n, "_100g"), grams / 100) ?? {} : {};
  const out = {};
  for (const k of MICRO_KEYS) out[k] = own[k] ?? from100[k] ?? null;
  return cleanMicros(out);
}

/**
 * Fiber, sugars, sat fat, sodium, potassium from OFF nutriments. OFF keeps everything in grams,
 * so sodium and potassium are converted to mg; when only salt is given, sodium = salt ÷ 2.5.
 */
export function offMicros(nutriments, suffix = "_100g") {
  const n = nutriments ?? {};
  const g = (k) => lenientNumber(n[`${k}${suffix}`]);
  const salt = g("salt");
  const sodiumG = g("sodium") ?? (salt !== undefined ? salt / 2.5 : undefined);
  const potassiumG = g("potassium");
  return cleanMicros({
    fiberG: g("fiber"),
    sugarG: g("sugars"),
    addedSugarG: g("added-sugars"),
    satFatG: g("saturated-fat"),
    sodiumMg: sodiumG !== undefined ? sodiumG * 1000 : null,
    potassiumMg: potassiumG !== undefined ? potassiumG * 1000 : null,
  });
}

function offProductName(product) {
  const candidates = [product.product_name, product.product_name_en, product.generic_name];
  const found = candidates.find((v) => typeof v === "string" && v.trim() !== "");
  return found ? found.trim() : "Unknown product";
}

function offBrand(product) {
  if (typeof product.brands !== "string" || product.brands.trim() === "") return null;
  return product.brands.split(",")[0].trim() || null;
}

export function offProductToScannedProduct(barcode, product) {
  const basis = parseBasis(product.nutriments, product.serving_size, product.serving_quantity);
  if (!basis) return null;
  return {
    barcode,
    name: offProductName(product),
    brand: offBrand(product),
    servingDescription: basis.servingDescription,
    calories: basis.calories,
    proteinG: basis.proteinG,
    carbsG: basis.carbsG,
    fatG: basis.fatG,
    micros: basis.micros ?? null,
  };
}

/**
 * GET https://world.openfoodfacts.org/api/v3/product/{barcode}.json
 * @returns {Promise<{status:"complete", product:object}|{status:"notFound"}|{status:"incompleteData"}|{status:"failed", message:string}>}
 */
export async function offLookupBarcode(barcode, { timeoutMs = OFF_TIMEOUT_MS } = {}) {
  const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json`;
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { "User-Agent": OFF_USER_AGENT } }, timeoutMs);
  } catch (err) {
    return { status: "failed", message: `OFF network error: ${err.message ?? err}` };
  }
  if (res.status === 404) return { status: "notFound" };
  if (!res.ok) return { status: "failed", message: `OFF HTTP ${res.status}` };

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { status: "failed", message: `OFF decode error: ${err.message ?? err}` };
  }

  if (body?.result?.id === "product_not_found" || body?.status === "failure") return { status: "notFound" };
  if (!body?.product) return { status: "notFound" };

  const scanned = offProductToScannedProduct(barcode, body.product);
  return scanned ? { status: "complete", product: scanned } : { status: "incompleteData" };
}

/**
 * GET https://world.openfoodfacts.org/cgi/search.pl?search_terms=...&search_simple=1&action=process
 *   &json=1&page_size=20&fields=code,product_name,brands,nutriments,serving_size,serving_quantity
 * Blank/whitespace query short-circuits to success([]) with no network request.
 * @returns {Promise<{status:"success", products:object[]}|{status:"failed", message:string}>}
 */
export async function offSearchByName(query) {
  if (typeof query !== "string" || query.trim() === "") return { status: "success", products: [] };

  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "20",
    fields: "code,product_name,brands,nutriments,serving_size,serving_quantity",
  });
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`;

  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { "User-Agent": OFF_USER_AGENT } }, OFF_TIMEOUT_MS);
  } catch (err) {
    return { status: "failed", message: `OFF network error: ${err.message ?? err}` };
  }
  if (!res.ok) return { status: "failed", message: `OFF HTTP ${res.status}` };

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { status: "failed", message: `OFF decode error: ${err.message ?? err}` };
  }

  const hits = Array.isArray(body?.products) ? body.products : [];
  const products = hits
    .map((p) => offProductToScannedProduct(p.code ?? "", p))
    .filter((p) => p !== null); // incomplete hits are silently dropped, not surfaced as errors

  return { status: "success", products };
}

/**
 * GET /api/foods?q=... — the app's own search endpoint (api/foods.js): USDA and Open Food Facts
 * together, ranked and cached on the server with a real USDA key. Preferred over calling the two
 * databases from the phone, which runs into their rate limits within a few searches.
 * @returns {Promise<{status:"success", products:object[], partial:boolean}|{status:"failed", message:string, aborted?:boolean}>}
 */
export async function searchFoods(query, { signal } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return { status: "success", products: [], partial: false };
  let res;
  try {
    res = await apiFetch(`/api/foods?q=${encodeURIComponent(q)}`, { signal });
  } catch (err) {
    return { status: "failed", message: `Search network error: ${err.message ?? err}`, aborted: err?.name === "AbortError" };
  }
  if (!res.ok) return { status: "failed", message: `Search HTTP ${res.status}` };
  try {
    const body = await res.json();
    if (!body?.ok || !Array.isArray(body.products)) return { status: "failed", message: body?.message || "Search failed" };
    return { status: "success", products: body.products, partial: body.partial === true };
  } catch (err) {
    return { status: "failed", message: `Search decode error: ${err.message ?? err}` };
  }
}

// ---------------------------------------------------------------------------
// §9 USDAClient — barcode fallback
// ---------------------------------------------------------------------------

/** Strips non-digits, then strips leading zeros (leading-zero-tolerant GTIN comparison). */
export function normalizedDigits(s) {
  const digits = (String(s ?? "").match(/\d/g) ?? []).join("");
  return digits.replace(/^0+/, "");
}

const USDA_NUTRIENT_NUMBERS = { calories: "208", protein: "203", carbs: "205", fat: "204" };
// fiber, total sugars (269; Foundation foods sometimes use 269.3), added sugar, sat fat, sodium, potassium
const USDA_MICRO_NUMBERS = { fiberG: ["291"], sugarG: ["269", "269.3"], addedSugarG: ["539"], satFatG: ["606"], sodiumMg: ["307"], potassiumMg: ["306"] };

/** Per-100 g micros from an FDC foodNutrients list (FDC already reports sodium/potassium in mg). */
export function usdaMicrosPer100g(foodNutrients) {
  const out = {};
  for (const [key, numbers] of Object.entries(USDA_MICRO_NUMBERS)) {
    let v;
    for (const num of numbers) {
      v = getUsdaNutrient(foodNutrients, num);
      if (v !== undefined) break;
    }
    out[key] = v ?? null;
  }
  return cleanMicros(out);
}

function getUsdaNutrient(foodNutrients, number) {
  if (!Array.isArray(foodNutrients)) return undefined;
  const hit = foodNutrients.find((n) => {
    const num = n?.nutrientNumber ?? n?.number ?? n?.nutrient?.number;
    return num !== undefined && String(num) === String(number);
  });
  if (!hit) return undefined;
  return lenientNumber(hit.value ?? hit.amount);
}

function usdaPer100g(foodNutrients) {
  const calories = getUsdaNutrient(foodNutrients, USDA_NUTRIENT_NUMBERS.calories);
  const protein = getUsdaNutrient(foodNutrients, USDA_NUTRIENT_NUMBERS.protein);
  const carbs = getUsdaNutrient(foodNutrients, USDA_NUTRIENT_NUMBERS.carbs);
  const fat = getUsdaNutrient(foodNutrients, USDA_NUTRIENT_NUMBERS.fat);
  if ([calories, protein, carbs, fat].some((v) => v === undefined)) return null;
  return { calories, protein, carbs, fat };
}

function isGramLikeUnit(unit) {
  if (typeof unit !== "string" || unit.trim() === "") return false;
  const lower = unit.toLowerCase();
  return lower.includes("g") || lower.includes("ml") || lower.includes("mlt");
}

function formatServingUnit(unit) {
  if (!unit || String(unit).trim() === "") return "g";
  const upper = String(unit).toUpperCase();
  if (upper === "GRM") return "g";
  if (upper === "MLT") return "ml";
  return String(unit).toLowerCase();
}

function formatServingSize(size) {
  return Number.isInteger(size) ? String(size) : String(size);
}

function usdaLabelNutrients(food) {
  const ln = food?.labelNutrients;
  if (!ln) return null;
  const calories = lenientNumber(ln.calories?.value);
  const protein = lenientNumber(ln.protein?.value);
  const carbs = lenientNumber(ln.carbohydrates?.value);
  const fat = lenientNumber(ln.fat?.value);
  if ([calories, protein, carbs, fat].some((v) => v === undefined)) return null;
  const lv = (k) => lenientNumber(ln[k]?.value) ?? null;
  const micros = cleanMicros({
    fiberG: lv("fiber"),
    sugarG: lv("sugars"),
    addedSugarG: lv("addedSugar") ?? lv("addedSugars"),
    satFatG: lv("saturatedFat"),
    sodiumMg: lv("sodium"),
    potassiumMg: lv("potassium"),
  });
  return { calories, proteinG: protein, carbsG: carbs, fatG: fat, micros };
}

export function usdaFoodToScannedProduct(barcode, food) {
  const name = (food.description ?? "").trim() || "Unknown product";
  const brandRaw = food.brandName ?? food.brandOwner ?? "";
  const brand = String(brandRaw).trim() || null;

  const label = usdaLabelNutrients(food);
  if (label) {
    return { barcode, name, brand, servingDescription: "per serving (label)", ...label };
  }

  const per100 = usdaPer100g(food.foodNutrients);
  if (!per100) return null;
  const micros100 = usdaMicrosPer100g(food.foodNutrients);

  const servingSize = lenientNumber(food.servingSize);
  const servingUnit = food.servingSizeUnit;
  if (servingSize !== undefined && isGramLikeUnit(servingUnit)) {
    const factor = servingSize / 100;
    return {
      barcode,
      name,
      brand,
      servingDescription: `per serving (${formatServingSize(servingSize)} ${formatServingUnit(servingUnit)})`,
      calories: per100.calories * factor,
      proteinG: per100.protein * factor,
      carbsG: per100.carbs * factor,
      fatG: per100.fat * factor,
      micros: scaleMicros(micros100, factor),
    };
  }

  return {
    barcode,
    name,
    brand,
    servingDescription: "per 100 g",
    calories: per100.calories,
    proteinG: per100.protein,
    carbsG: per100.carbs,
    fatG: per100.fat,
    micros: micros100,
  };
}

/**
 * GET https://api.nal.usda.gov/fdc/v1/foods/search?api_key=...&query=...&dataType=Foundation,SR+Legacy
 * Name search restricted to generic whole foods (no branded/UPC data), which is where FDC's
 * plain-English descriptions ("Bananas, raw") beat Open Food Facts' barcode-scan product titles.
 * Used by search.js alongside offSearchByName(), not as a replacement — FDC has no branded
 * product catalog worth searching by name (Branded dataType names are as messy as OFF's).
 * @returns {Promise<{status:"success", products:object[]}|{status:"failed", message:string}>}
 */
export async function usdaSearchByName(query) {
  if (typeof query !== "string" || query.trim() === "") return { status: "success", products: [] };

  const params = new URLSearchParams({
    api_key: usdaApiKey(),
    query: query.trim(),
    dataType: "Foundation,SR Legacy",
    pageSize: "10",
  });
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?${params.toString()}`;

  let res;
  try {
    res = await fetchWithTimeout(url, {}, USDA_TIMEOUT_MS);
  } catch (err) {
    return { status: "failed", message: `USDA network error: ${err.message ?? err}` };
  }
  if (!res.ok) return { status: "failed", message: `USDA HTTP ${res.status}` };

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { status: "failed", message: `USDA decode error: ${err.message ?? err}` };
  }

  const foods = Array.isArray(body?.foods) ? body.foods : [];
  const products = foods
    .map((f) => usdaFoodToScannedProduct(`usda:${f.fdcId}`, f))
    .filter((p) => p !== null);

  return { status: "success", products };
}

/**
 * GET https://api.nal.usda.gov/fdc/v1/foods/search?api_key=...&query={barcode}&dataType=Branded
 * FDC has no direct barcode endpoint — filters foods[] by normalized gtinUpc match.
 * @returns {Promise<{status:"found", product:object}|{status:"notFound"}|{status:"failed", message:string}>}
 */
export async function usdaLookupBarcode(barcode, { apiKey = usdaApiKey(), timeoutMs = USDA_TIMEOUT_MS } = {}) {
  const normalizedTarget = normalizedDigits(barcode);
  if (normalizedTarget === "") return { status: "notFound" };

  const params = new URLSearchParams({ api_key: apiKey, query: barcode, dataType: "Branded" });
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?${params.toString()}`;

  let res;
  try {
    res = await fetchWithTimeout(url, {}, timeoutMs);
  } catch (err) {
    return { status: "failed", message: `USDA network error: ${err.message ?? err}` };
  }
  if (!res.ok) return { status: "failed", message: `USDA HTTP ${res.status}` };

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { status: "failed", message: `USDA decode error: ${err.message ?? err}` };
  }

  const foods = Array.isArray(body?.foods) ? body.foods : [];
  const match = foods.find((f) => normalizedDigits(f.gtinUpc) === normalizedTarget);
  if (!match) return { status: "notFound" };

  const product = usdaFoodToScannedProduct(barcode, match);
  return product ? { status: "found", product } : { status: "notFound" };
}

// ---------------------------------------------------------------------------
// §10 FoodLookupService — barcode lookup across Open Food Facts and USDA Branded
// ---------------------------------------------------------------------------
//
// Open Food Facts is written by volunteers and is sometimes wrong (a milk entered per cup but
// saved as per 100 g comes out 1.7× too high). USDA Branded Foods is what US and Canadian
// manufacturers submit from their own labels, so for North American barcodes it is asked at the
// same time and preferred. Either source's numbers are checked against the calories their own
// protein, carbs and fat add up to; a product that doesn't add up is marked `suspect` and the
// Add Food sheet says to check the label.

/** UPC-A (12 digits) or an EAN-13 that is a UPC with a leading 0: sold in the US or Canada. */
export function isNorthAmericanCode(barcode) {
  const d = (String(barcode ?? "").match(/\d/g) ?? []).join("");
  return d.length === 12 || (d.length === 13 && d[0] === "0");
}

/**
 * Do the calories roughly match 4·protein + 4·carbs + 9·fat? Labels round, and fiber, alcohol
 * and sugar alcohols move the sum, so only a gap over 30% counts; tiny amounts always pass.
 */
export function macrosConsistent(p) {
  const kcal = Number(p?.calories) || 0;
  const sum = 4 * (Number(p?.proteinG) || 0) + 4 * (Number(p?.carbsG) || 0) + 9 * (Number(p?.fatG) || 0);
  const hi = Math.max(kcal, sum);
  if (hi < 40) return true;
  return Math.abs(kcal - sum) / hi <= 0.3;
}

/**
 * Picks the answer from the two lookups (either may be null when it wasn't asked).
 * North American codes prefer USDA; others prefer Open Food Facts. A product whose numbers add up
 * beats one that doesn't; when neither does, the preferred one comes back with `suspect: true`.
 * @returns {{status:"found", product:object}|{status:"notFound"}|{status:"failed", message:string}}
 */
export function pickBarcodeResult(barcode, off, usda) {
  const fromOff = off?.status === "complete" ? { ...off.product, source: "off" } : null;
  const fromUsda = usda?.status === "found" ? { ...usda.product, source: "usda" } : null;
  const order = (isNorthAmericanCode(barcode) ? [fromUsda, fromOff] : [fromOff, fromUsda]).filter(Boolean);
  const good = order.find(macrosConsistent);
  if (good) return { status: "found", product: { ...good, suspect: false } };
  if (order.length > 0) return { status: "found", product: { ...order[0], suspect: true } };
  const failures = [off, usda].filter((r) => r?.status === "failed");
  if (failures.length > 0 && failures.length === [off, usda].filter(Boolean).length) {
    return { status: "failed", message: failures.map((r) => r.message).join("; ") };
  }
  if (off?.status === "failed") return { status: "failed", message: off.message };
  return { status: "notFound" };
}

/**
 * Both lookups, from wherever this runs (the phone, or api/foods.js with a real USDA key).
 * USDA is asked alongside OFF for North American codes, and afterwards for any other code only
 * when OFF has nothing usable, so European products don't spend USDA's rate limit.
 */
export async function lookupBarcodeBoth(barcode, { usdaKey, timeoutMs } = {}) {
  const opts = timeoutMs ? { timeoutMs } : {};
  const usdaOpts = { ...opts, ...(usdaKey ? { apiKey: usdaKey } : {}) };
  if (isNorthAmericanCode(barcode)) {
    const [off, usda] = await Promise.all([offLookupBarcode(barcode, opts), usdaLookupBarcode(barcode, usdaOpts)]);
    return pickBarcodeResult(barcode, off, usda);
  }
  const off = await offLookupBarcode(barcode, opts);
  if (off.status === "complete" && macrosConsistent(off.product)) return pickBarcodeResult(barcode, off, null);
  const usda = await usdaLookupBarcode(barcode, usdaOpts);
  return pickBarcodeResult(barcode, off, usda);
}

/**
 * Barcode lookup for the scanner. Asks the app's own /api/foods first (a real USDA key and a
 * shared cache); if that can't be reached, does both lookups from the phone.
 * @param {string} barcode
 * @returns {Promise<{status:"found", product:object}|{status:"notFound"}|{status:"failed", message:string}>}
 */
export async function foodLookup(barcode) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await apiFetch(`/api/foods?barcode=${encodeURIComponent(barcode)}`, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (res.ok) {
      const body = await res.json();
      if (body?.ok && (body.status === "found" || body.status === "notFound")) {
        return body.status === "found" ? { status: "found", product: body.product } : { status: "notFound" };
      }
    }
  } catch {
    // offline, or the server is unreachable: look it up from here instead
  }
  return lookupBarcodeBoth(barcode, { timeoutMs: 5000 });
}

// ---------------------------------------------------------------------------
// §7 NutritionGrounding — USDA accuracy layer for Gemini output
// ---------------------------------------------------------------------------

/** One USDA search result reduced to what grounding needs (server side, api/foods.js). */
export function usdaGroundingHit(food) {
  const per100 = usdaPer100g(food?.foodNutrients);
  if (!per100 || !(per100.calories > 0)) return null;
  return { description: String(food.description ?? ""), per100, microsPer100: usdaMicrosPer100g(food.foodNutrients) };
}

// Grounding swaps the AI's numbers for USDA's only when USDA clearly describes the same food:
// - the item isn't a special version a generic entry can't represent (sugar-free, keto, protein,
//   a brand...): "sugar free dulce de leche" was getting regular dulce de leche's calories;
// - the USDA name shares the food's main words ("chocolate croissant" → "Croissants, butter" is
//   fine, "egg" → "Egg, white, raw" is not, because "white" isn't in "egg");
// - USDA's number is within a third of the AI's. Beyond that the match is more likely wrong
//   than the AI: donuts and croissants were coming out 40% low from mismatched entries.
export const GROUNDING_MIN_RATIO = 0.75;
export const GROUNDING_MAX_RATIO = 1.33;
const SPECIAL_VERSION = /(sugar[- ]?free|no sugar|sin az[uú]car|keto|protein|prote[ií]na|whey|light\b|lite\b|low[- ]?(fat|carb|sugar|cal)|diet\b|zero\b|stevia|monk ?fruit|vegan|gluten[- ]?free|almond flour|harina de almendra|fairlife|®|™)/i;
const GROUND_STOP = new Set(["and", "with", "the", "of", "con", "de", "del", "la", "el", "y", "raw", "cooked", "fresh", "plain", "piece", "slice", "homemade", "small", "large", "medium", "glass", "cup", "bowl", "plate", "serving", "portion", "scoop", "tbsp", "tsp", "vaso", "taza", "plato", "porcion", "half"]);
const SAME_WORD = { donut: "doughnut", dona: "doughnut", chop: "chop", cooky: "cookie", biscuit: "cookie", galleta: "cookie", pastel: "cake", torta: "cake" };
const stem = (w) => {
  const b = /ies$/.test(w) ? w.replace(/ies$/, "y") : /ie$/.test(w) ? w.replace(/ie$/, "y") : /(ches|shes|sses|xes)$/.test(w) ? w.slice(0, -2) : /[^s]s$/.test(w) ? w.slice(0, -1) : w;
  return SAME_WORD[b] ?? b;
};
const words = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z]+/).filter((w) => w.length >= 3 && !GROUND_STOP.has(w)).map(stem);

/**
 * Does this USDA description name the same food as the item? Every main word of the item has to
 * be in it ("white rice" → "Rice, white, long-grain…" yes; "chocolate frosted donut" →
 * "Doughnuts, cake-type, chocolate…" no: nothing says frosted). Wrong parts of the right food
 * ("Egg, white") are caught by the calorie check instead.
 */
export function sameFood(itemName, description) {
  const mine = words(itemName);
  if (mine.length === 0) return false;
  const theirs = new Set(words(description));
  return mine.every((w) => theirs.has(w));
}

/** The item with USDA's numbers when they pass the checks above, else null. */
export function groundWith(item, hit) {
  if (!hit || !(item?.calories > 0) || !(item.gramsEstimate > 0)) return null;
  if (SPECIAL_VERSION.test(item.name ?? "")) return null;
  if (!sameFood(item.name, hit.description)) return null;
  const factor = item.gramsEstimate / 100;
  const calories = hit.per100.calories * factor;
  const ratio = calories / item.calories;
  if (ratio < GROUNDING_MIN_RATIO || ratio > GROUNDING_MAX_RATIO) return null;
  // USDA's numbers win where it has them; the AI's estimate fills the gaps (USDA whole foods
  // rarely list added sugar, for example).
  const usdaMicros = scaleMicros(hit.microsPer100, factor);
  let micros = cleanMicros(item.micros);
  if (usdaMicros) {
    micros = { ...(micros ?? {}) };
    for (const [k, v] of Object.entries(usdaMicros)) if (v !== null) micros[k] = v;
    micros = cleanMicros(micros);
  }
  return {
    ...item,
    calories,
    proteinG: hit.per100.protein * factor,
    carbsG: hit.per100.carbs * factor,
    fatG: hit.per100.fat * factor,
    micros,
    grounded: true,
  };
}

async function groundSingle(item) {
  try {
    if (!(item?.calories > 0) || SPECIAL_VERSION.test(item.name ?? "")) return item;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROUNDING_PER_ITEM_TIMEOUT_MS);
    const res = await apiFetch(`/api/foods?ground=${encodeURIComponent(item.name)}`, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) return item;
    const body = await res.json();
    const hits = Array.isArray(body?.hits) ? body.hits : [];
    // the first result that is really this food, not just the first result
    for (const hit of hits) {
      const out = groundWith(item, hit);
      if (out) return out;
      if (sameFood(item.name, hit.description)) return item; // same food, numbers too far apart: keep the AI's
    }
    return item;
  } catch {
    return item; // network failure/timeout never fails the overall analysis
  }
}

/**
 * Grounds every item concurrently against USDA, racing a whole-batch deadline. Any item still
 * in flight when the deadline fires keeps its original (ungrounded) numbers. Output order always
 * matches input order regardless of completion order.
 * @param {Array} items AnalyzedFoodItem[]
 * @param {{budgetMs?:number}} [options]
 * @returns {Promise<Array>}
 */
export function groundItems(items, { budgetMs = GROUNDING_BATCH_BUDGET_MS } = {}) {
  if (!Array.isArray(items) || items.length === 0) return Promise.resolve([]);

  return new Promise((resolve) => {
    const results = new Array(items.length);
    let resolvedCount = 0;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(items.map((item, i) => results[i] ?? item));
    };

    const timer = setTimeout(finish, budgetMs);

    items.forEach((item, i) => {
      groundSingle(item)
        .then((grounded) => {
          results[i] = grounded;
        })
        .catch(() => {
          results[i] = item;
        })
        .finally(() => {
          resolvedCount += 1;
          if (resolvedCount === items.length) finish();
        });
    });
  });
}

// ---------------------------------------------------------------------------
// §3/§5 Gemini analysis (server-proxied) + orchestration contract
// ---------------------------------------------------------------------------

/** Analysis mode metadata — verbatim from AnalysisMode (MealAnalysis.swift). */
export const ANALYSIS_MODES = Object.freeze({
  meal: { groundsAgainstUSDA: true, requiresImage: true, pendingTitle: "Analyzing Image", pendingRampSeconds: 10 },
  label: { groundsAgainstUSDA: false, requiresImage: true, pendingTitle: "Analyzing Image", pendingRampSeconds: 10 },
  text: { groundsAgainstUSDA: true, requiresImage: false, pendingTitle: "Analyzing description", pendingRampSeconds: 4 },
});

function generateItemId() {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pieces the AI counted ("two eggs" → 2), or 0 when the food isn't counted in pieces. */
export function pieceCount(raw) {
  const n = Number(raw?.count);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.round(n * 2) / 2 : 0;
}

/** Maps a raw Gemini item (post JSON-schema decode) to the final AnalyzedFoodItem shape. */
export function mapRawItemToAnalyzedItem(raw) {
  const grams = raw.grams_estimate ?? raw.gramsEstimate;
  const count = pieceCount(raw);
  // counted foods open in servings (2 eggs = 2 ×), each serving one piece's weight
  const pieces = count > 0 && Number(grams) > 0
    ? { unit: "serving", amount: count, gramsPerServing: Math.max(1, Math.round(Number(grams) / count)) }
    : {};
  return {
    id: generateItemId(),
    name: raw.name,
    gramsEstimate: raw.grams_estimate ?? raw.gramsEstimate,
    calories: raw.calories,
    proteinG: raw.protein_g ?? raw.proteinG,
    carbsG: raw.carbs_g ?? raw.carbsG,
    fatG: raw.fat_g ?? raw.fatG,
    micros: microsFromRaw(raw),
    confidence: raw.confidence,
    grounded: false,
    ...pieces,
  };
}

/** The AI's snake_case nutrient fields -> a micros object (or null if it gave none). */
export function microsFromRaw(raw) {
  if (raw?.micros && typeof raw.micros === "object") return cleanMicros(raw.micros);
  return cleanMicros({
    fiberG: raw?.fiber_g,
    sugarG: raw?.sugar_g,
    addedSugarG: raw?.added_sugar_g,
    satFatG: raw?.sat_fat_g,
    sodiumMg: raw?.sodium_mg,
    potassiumMg: raw?.potassium_mg,
  });
}

/**
 * Thin POST wrapper around the serverless Gemini proxy. Never throws — always resolves to
 * either {ok:true, items} or {ok:false, errorType, message}.
 * @param {{mode:"meal"|"label"|"text", imageDataUrl?:string, text?:string}} params
 */
const GEMINI_TIMEOUT_MS = 75000;

export async function analyzeWithGemini({ mode, imageDataUrl, text }) {
  let image;
  if (imageDataUrl) {
    const commaIdx = imageDataUrl.indexOf(",");
    image = commaIdx === -1 ? imageDataUrl : imageDataUrl.slice(commaIdx + 1);
  }

  // The server gives up at 60 s; a request still open well after that is dead (a phone that
  // suspended the app mid-request can hold it for minutes), so it counts as a network error
  // and the queue retries it instead of waiting on it.
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS) : null;
  let res;
  try {
    res = await apiFetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, image, text, lang: currentLang() }),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    return { ok: false, errorType: "network", message: `Gemini network error: ${err.message ?? err}` };
  } finally {
    if (timer) clearTimeout(timer);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { ok: false, errorType: "parse", message: `Gemini decode error: ${err.message ?? err}` };
  }

  if (!res.ok || body?.errorType) {
    return { ok: false, errorType: body?.errorType ?? "other", message: body?.message ?? `Gemini HTTP ${res.status}` };
  }

  return { ok: true, items: Array.isArray(body.items) ? body.items : [], meta: cleanMeta(body.meta) };
}

/** The app's language for the AI's questions; English when it can't be told. */
function currentLang() {
  try { return (globalThis.localStorage?.getItem("snapcal.lang") || globalThis.navigator?.language || "en").slice(0, 2) === "es" ? "es" : "en"; } catch { return "en"; }
}

/**
 * The meal's overall confidence (0–1), up to two questions when it's under 50%, and whether
 * cooking fat was assumed. Null when the server didn't send it (label photos, older servers).
 */
export function cleanMeta(raw) {
  const c = Number(raw?.confidence);
  if (!raw || !Number.isFinite(c)) return null;
  const questions = Array.isArray(raw.questions)
    ? raw.questions.filter((q) => q && typeof q.question === "string" && Array.isArray(q.options))
      .slice(0, 2).map((q) => ({ question: q.question.slice(0, 140), options: q.options.map(String).slice(0, 4) }))
    : [];
  return {
    confidence: Math.min(1, Math.max(0, c)),
    questions: c < 0.5 ? questions : [],
    cookingFat: ["visible", "assumed", "none"].includes(raw.cookingFat) ? raw.cookingFat : null,
  };
}

/**
 * Full MealAnalysis.swift orchestration contract: validate -> call Gemini (server-proxied,
 * key failover happens server-side) -> map -> ground (if applicable). Mirrors
 * GeminiMealAnalyzer.analyze exactly, including the empty-items-is-success rule.
 * @param {{mode:"meal"|"label"|"text", imageDataUrl?:string, text?:string}} params
 * @returns {Promise<{success:true, items:Array}|{success:false, reason:string}>}
 */
/**
 * Parses a free-text workout ("45 min soccer, pretty intense") into structured sessions.
 * @returns {Promise<{ok:true, sessions:Array}|{ok:false, errorType:string, message:string}>}
 */
export async function parseExerciseText(text, { lang = "en" } = {}) {
  const outcome = await geminiRequest({ mode: "exercise", text, lang });
  if (!outcome.ok) return outcome;
  const sessions = outcome.items
    .map((raw) => ({
      name: typeof raw?.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : "Workout",
      activity: String(raw?.activity ?? "other").toLowerCase(),
      minutes: Math.max(0, Math.round(Number(raw?.minutes) || 0)),
      intensity: String(raw?.intensity ?? "moderate").toLowerCase(),
    }))
    .filter((s) => s.minutes > 0);
  return { ok: true, sessions };
}

/**
 * Asks for three recipe ideas that fit the calories/protein left in the day.
 * Nothing is persisted — ideas are regenerated on demand.
 */
export async function suggestRecipes({ caloriesLeft, proteinLeft, preferences = [], lang = "en" } = {}) {
  const outcome = await geminiRequest({ mode: "recipes", caloriesLeft, proteinLeft, preferences, lang });
  if (!outcome.ok) return outcome;
  const recipes = outcome.items
    .map((raw) => ({
      name: String(raw?.name ?? "").trim(),
      minutes: Math.max(0, Math.round(Number(raw?.minutes) || 0)),
      calories: Math.max(0, Math.round(Number(raw?.calories) || 0)),
      proteinG: Math.max(0, Math.round(Number(raw?.protein_g) || 0)),
      carbsG: Math.max(0, Math.round(Number(raw?.carbs_g) || 0)),
      fatG: Math.max(0, Math.round(Number(raw?.fat_g) || 0)),
      micros: microsFromRaw(raw),
      ingredients: Array.isArray(raw?.ingredients) ? raw.ingredients.map(String).filter(Boolean) : [],
      steps: Array.isArray(raw?.steps) ? raw.steps.map(String).filter(Boolean) : [],
    }))
    .filter((r) => r.name !== "" && r.calories > 0);
  return { ok: true, recipes };
}

/**
 * Transcribes a recorded voice note (used when the phone can't transcribe on its own).
 * @param {Blob} blob  what MediaRecorder produced
 * @returns {Promise<{ok:true, text:string}|{ok:false, errorType:string, message:string}>}
 */
export async function transcribeAudio(blob, { lang = "en" } = {}) {
  let audio;
  try {
    audio = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch (err) {
    return { ok: false, errorType: "other", message: "Couldn't read the recording." };
  }
  const outcome = await geminiRequest({ mode: "transcribe", audio, audioMime: blob.type || "audio/webm", lang });
  if (!outcome.ok) return outcome;
  const text = outcome.items.map((i) => String(i?.text ?? "")).join(" ").trim();
  return { ok: true, text };
}

/** Shared POST /api/gemini plumbing for the non-meal modes. */
async function geminiRequest(payload) {
  let res;
  try {
    res = await apiFetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, errorType: "network", message: `Network error: ${err?.message ?? err}` };
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { ok: false, errorType: "parse", message: `Decode error: ${err?.message ?? err}` };
  }
  if (!res.ok || body?.errorType) {
    return { ok: false, errorType: body?.errorType ?? "other", message: body?.message ?? `HTTP ${res.status}` };
  }
  if (!Array.isArray(body?.items)) {
    return { ok: false, errorType: "parse", message: "Unexpected response from the AI." };
  }
  return { ok: true, items: body.items };
}

export async function analyzeMeal({ mode, imageDataUrl, text }) {
  const modeInfo = ANALYSIS_MODES[mode] ?? ANALYSIS_MODES.meal;

  if (modeInfo.requiresImage && !imageDataUrl) {
    return { success: false, reason: "That photo couldn't be read — retake it or add the meal manually." };
  }
  if (!modeInfo.requiresImage && (!text || text.trim() === "")) {
    return { success: false, reason: "Add a description of what you ate." };
  }

  const outcome = await analyzeWithGemini({ mode, imageDataUrl, text });
  if (!outcome.ok) {
    return { success: false, reason: outcome.message, errorType: outcome.errorType };
  }

  const items = outcome.items.map(mapRawItemToAnalyzedItem);
  const meta = outcome.meta ?? null;
  if (items.length === 0) {
    return { success: true, items: [], meta }; // valid "no food found" result, skip grounding
  }

  if (modeInfo.groundsAgainstUSDA) {
    const grounded = await groundItems(items);
    return { success: true, items: grounded, meta };
  }

  return { success: true, items, meta };
}
