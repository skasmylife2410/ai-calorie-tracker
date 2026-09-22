// api.js — client-side data-source clients: Open Food Facts, USDA FoodData Central, the
// barcode fallback chain, USDA grounding of Gemini output, and the Gemini analysis call
// (which itself is proxied through /api/gemini so the API keys never reach the browser).
//
// Verbatim URLs/params/constants per SPEC-LOGIC.md §3, §7, §8, §9, §10.

import { apiFetch } from "./net.js";

// Open Food Facts asks apps to identify themselves with a contact email — put YOURS here.
const OFF_USER_AGENT = "SnapCal/1.0 (personal calorie tracker; you@example.com)";
// NOTE (portability): browsers treat "User-Agent" as a forbidden fetch header and silently drop
// it — there is no web equivalent of setting a custom UA from client JS. We still set it so the
// header is honored in any environment that does allow it (e.g. a future server-side proxy).

const OFF_TIMEOUT_MS = 10_000;
const USDA_TIMEOUT_MS = 10_000;
const GROUNDING_PER_ITEM_TIMEOUT_MS = 3_000;
const GROUNDING_BATCH_BUDGET_MS = 4_000;
const GROUNDING_RATIO_MIN = 0.3;
const GROUNDING_RATIO_MAX = 3.0;
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
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
export function parseBasis(nutriments, servingSize) {
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
    };
  }

  return { servingDescription: "per 100 g", calories: kcal100g, proteinG: protein100g, carbsG: carbs100g, fatG: fat100g };
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

function offProductToScannedProduct(barcode, product) {
  const basis = parseBasis(product.nutriments, product.serving_size);
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
  };
}

/**
 * GET https://world.openfoodfacts.org/api/v3/product/{barcode}.json
 * @returns {Promise<{status:"complete", product:object}|{status:"notFound"}|{status:"incompleteData"}|{status:"failed", message:string}>}
 */
export async function offLookupBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json`;
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { "User-Agent": OFF_USER_AGENT } }, OFF_TIMEOUT_MS);
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

// ---------------------------------------------------------------------------
// §9 USDAClient — barcode fallback
// ---------------------------------------------------------------------------

/** Strips non-digits, then strips leading zeros (leading-zero-tolerant GTIN comparison). */
export function normalizedDigits(s) {
  const digits = (String(s ?? "").match(/\d/g) ?? []).join("");
  return digits.replace(/^0+/, "");
}

const USDA_NUTRIENT_NUMBERS = { calories: "208", protein: "203", carbs: "205", fat: "204" };

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
  return { calories, proteinG: protein, carbsG: carbs, fatG: fat };
}

function usdaFoodToScannedProduct(barcode, food) {
  const name = (food.description ?? "").trim() || "Unknown product";
  const brandRaw = food.brandName ?? food.brandOwner ?? "";
  const brand = String(brandRaw).trim() || null;

  const label = usdaLabelNutrients(food);
  if (label) {
    return { barcode, name, brand, servingDescription: "per serving (label)", ...label };
  }

  const per100 = usdaPer100g(food.foodNutrients);
  if (!per100) return null;

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
export async function usdaLookupBarcode(barcode) {
  const normalizedTarget = normalizedDigits(barcode);
  if (normalizedTarget === "") return { status: "notFound" };

  const params = new URLSearchParams({ api_key: usdaApiKey(), query: barcode, dataType: "Branded" });
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
  const match = foods.find((f) => normalizedDigits(f.gtinUpc) === normalizedTarget);
  if (!match) return { status: "notFound" };

  const product = usdaFoodToScannedProduct(barcode, match);
  return product ? { status: "found", product } : { status: "notFound" };
}

// ---------------------------------------------------------------------------
// §10 FoodLookupService — barcode fallback CHAIN orchestrator (OFF -> USDA)
// ---------------------------------------------------------------------------

/**
 * @param {string} barcode
 * @returns {Promise<{status:"found", product:object}|{status:"notFound"}|{status:"failed", message:string}>}
 */
export async function foodLookup(barcode) {
  const off = await offLookupBarcode(barcode);

  if (off.status === "complete") return { status: "found", product: off.product };

  if (off.status === "notFound" || off.status === "incompleteData") {
    return fallBackToUsda(barcode);
  }

  // off.status === "failed" — OFF errored outright, but still try USDA.
  const usda = await usdaLookupBarcode(barcode);
  if (usda.status === "found") return { status: "found", product: usda.product };
  if (usda.status === "notFound") return { status: "failed", message: off.message }; // surface ORIGINAL OFF error
  return { status: "failed", message: `OFF: ${off.message}; USDA: ${usda.message}` };
}

async function fallBackToUsda(barcode) {
  const usda = await usdaLookupBarcode(barcode);
  if (usda.status === "found") return { status: "found", product: usda.product };
  if (usda.status === "notFound") return { status: "notFound" };
  return { status: "failed", message: usda.message };
}

// ---------------------------------------------------------------------------
// §7 NutritionGrounding — USDA accuracy layer for Gemini output
// ---------------------------------------------------------------------------

async function groundSingle(item) {
  try {
    const params = new URLSearchParams({
      api_key: usdaApiKey(),
      query: item.name,
      dataType: "Foundation,SR Legacy",
      pageSize: "3",
    });
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?${params.toString()}`;
    const res = await fetchWithTimeout(url, {}, GROUNDING_PER_ITEM_TIMEOUT_MS);
    if (!res.ok) return item;

    const body = await res.json();
    const topHit = Array.isArray(body?.foods) ? body.foods[0] : undefined;
    if (!topHit) return item;

    const per100 = usdaPer100g(topHit.foodNutrients);
    if (!per100) return item;

    if (!(item.calories > 0)) return item;

    const factor = item.gramsEstimate / 100;
    const groundedCalories = per100.calories * factor;
    const ratio = groundedCalories / item.calories;
    if (ratio < GROUNDING_RATIO_MIN || ratio > GROUNDING_RATIO_MAX) return item;

    return {
      ...item,
      calories: groundedCalories,
      proteinG: per100.protein * factor,
      carbsG: per100.carbs * factor,
      fatG: per100.fat * factor,
      grounded: true,
    };
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

/** Maps a raw Gemini item (post JSON-schema decode) to the final AnalyzedFoodItem shape. */
export function mapRawItemToAnalyzedItem(raw) {
  return {
    id: generateItemId(),
    name: raw.name,
    gramsEstimate: raw.grams_estimate ?? raw.gramsEstimate,
    calories: raw.calories,
    proteinG: raw.protein_g ?? raw.proteinG,
    carbsG: raw.carbs_g ?? raw.carbsG,
    fatG: raw.fat_g ?? raw.fatG,
    confidence: raw.confidence,
    grounded: false,
  };
}

/**
 * Thin POST wrapper around the serverless Gemini proxy. Never throws — always resolves to
 * either {ok:true, items} or {ok:false, errorType, message}.
 * @param {{mode:"meal"|"label"|"text", imageDataUrl?:string, text?:string}} params
 */
export async function analyzeWithGemini({ mode, imageDataUrl, text }) {
  let image;
  if (imageDataUrl) {
    const commaIdx = imageDataUrl.indexOf(",");
    image = commaIdx === -1 ? imageDataUrl : imageDataUrl.slice(commaIdx + 1);
  }

  let res;
  try {
    res = await apiFetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, image, text }),
    });
  } catch (err) {
    return { ok: false, errorType: "network", message: `Gemini network error: ${err.message ?? err}` };
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

  return { ok: true, items: Array.isArray(body.items) ? body.items : [] };
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
    return { success: false, reason: outcome.message };
  }

  const items = outcome.items.map(mapRawItemToAnalyzedItem);
  if (items.length === 0) {
    return { success: true, items: [] }; // valid "no food found" result, skip grounding
  }

  if (modeInfo.groundsAgainstUSDA) {
    const grounded = await groundItems(items);
    return { success: true, items: grounded };
  }

  return { success: true, items };
}
