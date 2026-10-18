// api/foods.js — food name search for the search sheet, as one call.
//
// GET /api/foods?q=chick  -> { ok, products, partial }
// GET /api/foods?barcode=0123456789012  -> { ok, status: "found"|"notFound", product? }
//   (the scanner's lookup: barcodes people typed in first, then Open Food Facts + USDA Branded
//   with the real key; see js/api.js §10). Every lookup adds a row to snapcal_barcode_lookups
//   (code, result, source, time; no account) so the scanner's hit rate can be measured.
// POST /api/foods { barcode, product } -> { ok }
//   A product typed in after a scan found nothing: kept in snapcal_barcodes, so the next scan of
//   that code, by anyone, finds it.
//
// Why this runs on the server instead of the phone:
//  - USDA's public DEMO_KEY allows about 10 searches an hour per phone, and search-as-you-type
//    spent that in a couple of meals, after which results came back empty until "Try again".
//    Here a real key (USDA_API_KEY, free from https://api.data.gov/signup) serves everyone.
//  - Open Food Facts' fast search service (search-a-licious) doesn't allow browser calls; the
//    old one the phone used is slow and returns 503 when searched quickly.
//  - Answers are cached (here and at Vercel's edge), so a food someone already looked up comes
//    back instantly and never counts against either service again.
// Both sources run in parallel with a short budget; whichever answers in time is used.

import { requireUser } from "./_auth.js";
import { offProductToScannedProduct, usdaFoodToScannedProduct, lookupBarcodeBoth, usdaGroundingHit, canonicalBarcode } from "../js/api.js";
import { cleanMicros } from "../js/nutrition.js";
import { select, insert, restBase, restHeaders, parseBody } from "./_rest.js";
import { rankProducts, normalize, englishQuery } from "../js/foods-local.js";
import { cleanGif } from "../js/gif.js";

const SOURCE_TIMEOUT_MS = 4_500;
const MAX_QUERY = 80;
const MAX_RESULTS = 30;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const OFF_USER_AGENT = "SnapCal/1.0 (personal calorie tracker)";

const cache = new Map(); // normalized query -> { at, products }

export default async function handler(req, res) {
  // GIF pass-through (js/gif.js): an <img> can't send the sign-in header, and the answer is a
  // public GIPHY picture chosen by a strictly checked id, so this part needs no account.
  const gifId = new URL(req.url, "http://localhost").searchParams.get("gif");
  if (gifId !== null) return proxyGif(gifId, res);

  const me = await requireUser(req, res);
  if (!me) return;
  if (req.method === "POST") return rememberBarcode(parseBody(req), me, res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, errorType: "other", message: "Method not allowed" });

  const url = new URL(req.url, "http://localhost");
  const barcode = String(url.searchParams.get("barcode") ?? req.query?.barcode ?? "").replace(/\D/g, "").slice(0, 14);
  if (barcode) return lookupBarcode(canonicalBarcode(barcode), res);
  const ground = String(url.searchParams.get("ground") ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_QUERY);
  if (ground.length >= 2) return groundingHits(ground, res);
  const q = String(url.searchParams.get("q") ?? req.query?.q ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_QUERY);
  if (q.length < 2) return res.status(200).json({ ok: true, products: [], partial: false });

  const key = normalize(q);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    setCacheHeaders(res);
    return res.status(200).json({ ok: true, products: hit.products, partial: false });
  }

  const [usda, off] = await Promise.all([searchUsda(q), searchOff(q)]);
  if (!usda.ok && !off.ok) {
    return res.status(502).json({ ok: false, errorType: "unavailable", message: off.message || usda.message });
  }

  const products = rankProducts([...(usda.products ?? []), ...(off.products ?? [])], q).slice(0, MAX_RESULTS);
  const partial = !usda.ok || !off.ok;
  // only complete answers are remembered, so a source that was down gets asked again next time
  if (!partial) remember(key, products);
  if (!partial) setCacheHeaders(res);
  return res.status(200).json({ ok: true, products, partial });
}

async function lookupBarcode(barcode, res) {
  const t0 = Date.now();
  const key = `barcode:${barcode}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    logLookup(barcode, hit.products, t0);
    setCacheHeaders(res);
    return res.status(200).json({ ok: true, ...hit.products });
  }
  // typed in by someone after an earlier miss
  const mine = await select("snapcal_barcodes", { code: `eq.${barcode}`, select: "product", limit: "1" }).catch(() => []);
  if (mine[0]?.product) {
    const out = { status: "found", product: { ...mine[0].product, barcode, source: "group", suspect: false } };
    remember(key, out);
    logLookup(barcode, out, t0);
    return res.status(200).json({ ok: true, ...out });
  }
  const usdaKey = (process.env.USDA_API_KEY || "").trim() || undefined;
  // 4 s per source: with OFF then USDA for a non-US code that stays inside the function's 10 s
  const out = await lookupBarcodeBoth(barcode, { usdaKey, timeoutMs: 4000 });
  logLookup(barcode, out, t0);
  if (out.status === "failed") return res.status(502).json({ ok: false, errorType: "unavailable", message: out.message });
  // only hits are remembered: a product missing today may be added, or a source was just down
  if (out.status === "found") {
    remember(key, out);
    setCacheHeaders(res);
  }
  return res.status(200).json({ ok: true, ...out });
}

/** One row per lookup, for the hit rate. Never holds up or fails the answer. */
function logLookup(code, out, t0) {
  insert("snapcal_barcode_lookups", { code, status: out.status, source: out.product?.source ?? null, ms: Date.now() - t0 }).catch(() => {});
}

const num = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
};
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Keeps a product typed in after a miss, under the code's one spelling. Last one in wins. */
async function rememberBarcode(body, me, res) {
  const code = canonicalBarcode(body?.barcode);
  const p = body?.product ?? {};
  const product = {
    name: text(p.name, 90),
    brand: text(p.brand, 60) || null,
    servingDescription: text(p.servingDescription, 60) || "1 serving",
    calories: num(p.calories, 5000),
    proteinG: num(p.proteinG, 1000),
    carbsG: num(p.carbsG, 1000),
    fatG: num(p.fatG, 1000),
    micros: cleanMicros(p.micros),
  };
  if (!/^\d{8,14}$/.test(code) || !product.name || [product.calories, product.proteinG, product.carbsG, product.fatG].includes(null)) {
    return res.status(400).json({ ok: false, errorType: "other", message: "That product is missing its name or numbers." });
  }
  const saved = await fetch(`${restBase()}/rest/v1/snapcal_barcodes?on_conflict=code`, {
    method: "POST",
    headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([{ code, product, owner: me, updated_at: new Date().toISOString() }]),
  }).catch(() => null);
  if (!saved?.ok) return res.status(502).json({ ok: false, errorType: "unavailable", message: "Couldn't save it for next time." });
  cache.delete(`barcode:${code}`);
  return res.status(200).json({ ok: true });
}

/**
 * GET /api/foods?ground=<food name> -> { ok, hits: [{ description, per100, microsPer100 }] }
 * Generic USDA foods (Foundation, SR Legacy) for checking an AI estimate (js/api.js groundItems),
 * looked up here with the real key: the public DEMO_KEY ran out after a few lookups an hour, so
 * the same food was checked on one meal and not on the next.
 */
async function groundingHits(name, res) {
  const key = `ground:${normalize(name)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    setCacheHeaders(res);
    return res.status(200).json({ ok: true, hits: hit.products });
  }
  const apiKey = encodeURIComponent((process.env.USDA_API_KEY || "").trim() || "DEMO_KEY");
  const out = await getJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: name, dataType: ["Foundation", "SR Legacy"], pageSize: 5 }),
  }, "USDA");
  if (!out.ok) return res.status(502).json({ ok: false, errorType: "unavailable", message: out.message });
  const hits = (Array.isArray(out.body?.foods) ? out.body.foods : []).map(usdaGroundingHit).filter(Boolean);
  remember(key, hits);
  setCacheHeaders(res);
  return res.status(200).json({ ok: true, hits });
}

function setCacheHeaders(res) {
  // food data changes rarely; let Vercel's edge answer repeat searches without running this
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
}

function remember(key, products) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // oldest first
  cache.set(key, { at: Date.now(), products });
}

/**
 * USDA FoodData Central: generic foods (Foundation, SR Legacy) and everyday dishes as eaten
 * (FNDDS: "Chicken breast, baked"). The last word gets a wildcard so "chick" finds chicken.
 * Spanish food words are sent in English (foods-local.js englishQuery).
 */
async function searchUsda(q) {
  // USDA names foods in English: "harina de avena" is asked as "flour oat"
  const words = (englishQuery(q) ?? q).split(" ");
  const last = words[words.length - 1];
  if (last.length >= 3 && /^[\p{L}\p{N}]+$/u.test(last)) words[words.length - 1] = `${last}*`;
  const key = encodeURIComponent((process.env.USDA_API_KEY || "").trim() || "DEMO_KEY");
  // POST, because the GET form rejects "Survey (FNDDS)" in its comma-separated dataType list.
  // USDA's own ordering is loose (fast food first for "chick*"), so ask for plenty and re-rank.
  const out = await getJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: words.join(" "),
      dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)"],
      pageSize: 50,
      requireAllWords: true,
    }),
  }, "USDA");
  if (!out.ok) return out;
  const foods = Array.isArray(out.body?.foods) ? out.body.foods : [];
  const products = foods
    .map((f) => usdaFoodToScannedProduct(`usda:${f.fdcId}`, f))
    .filter(Boolean)
    .map((p) => ({ ...p, source: "usda" }));
  return { ok: true, products };
}

/** Open Food Facts via search-a-licious: branded and packaged products, any language. */
async function searchOff(q) {
  const params = new URLSearchParams({
    q,
    page_size: "25",
    langs: "en,es",
    fields: "code,product_name,product_name_en,product_name_es,generic_name,brands,nutriments,serving_size,serving_quantity",
  });
  const out = await getJson(`https://search.openfoodfacts.org/search?${params}`, { headers: { "User-Agent": OFF_USER_AGENT } }, "Open Food Facts");
  if (!out.ok) return out;
  const hits = Array.isArray(out.body?.hits) ? out.body.hits : [];
  const products = hits
    .map((p) => offProductToScannedProduct(p.code ?? "", p))
    .filter(Boolean)
    .map((p) => ({ ...p, source: "off" }));
  return { ok: true, products };
}

async function getJson(url, options, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) return { ok: false, message: `${label} HTTP ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, message: `${label} ${err?.name === "AbortError" ? "timed out" : "unreachable"}` };
  } finally {
    clearTimeout(timer);
  }
}

// --- GIF pass-through --------------------------------------------------------------------------
const GIF_MAX_BYTES = 4000_000; // Vercel answers up to 4.5 MB

async function proxyGif(id, res) {
  if (!cleanGif({ id })) return res.status(400).end();
  for (const name of ["200w.webp", "200w.gif"]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const r = await fetch(`https://media.giphy.com/media/${id}/${name}`, { signal: controller.signal });
      if (!r.ok) continue;
      const body = Buffer.from(await r.arrayBuffer());
      if (body.length > GIF_MAX_BYTES) continue;
      res.setHeader("Content-Type", name.endsWith(".webp") ? "image/webp" : "image/gif");
      res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=2592000, immutable");
      return res.status(200).send(body);
    } catch {
      // try the next rendition
    } finally {
      clearTimeout(timer);
    }
  }
  return res.status(502).end();
}
