// foods.test.mjs — /api/foods (server-side food search) and the ranking it shares with the phone.
import test from "node:test";
import assert from "node:assert/strict";

process.env.ALLOW_ANONYMOUS = "1";
delete process.env.APP_USERS;
delete process.env.APP_TOKEN;

const { default: handler } = await import("../api/foods.js");
const { rankProducts, scoreProduct, englishQuery, searchLocalFoods } = await import("../js/foods-local.js");

const mockRes = () => ({
  code: 200, body: null, headers: {},
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; },
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
});
const get = async (q) => {
  const res = mockRes();
  await handler({ method: "GET", url: `/api/foods?q=${encodeURIComponent(q)}`, headers: {} }, res);
  return res;
};

const usdaBody = {
  foods: [
    { fdcId: 1, description: "Fast foods, chicken tenders", foodNutrients: macros(300, 18, 17, 17) },
    { fdcId: 2, description: "Chicken breast, baked", foodNutrients: macros(165, 31, 0, 3.6) },
  ],
};
const offBody = {
  hits: [
    { code: "123", product_name: "Chicken breast fillets", brands: "Tesco", nutriments: { "energy-kcal_100g": 106, proteins_100g: 24, carbohydrates_100g: 0, fat_100g: 1 } },
    { code: "456", product_name: "Chick Peas", brands: "Goya", nutriments: { "energy-kcal_100g": 110, proteins_100g: 7, carbohydrates_100g: 16, fat_100g: 2 } },
    { code: "789", product_name: "No numbers", nutriments: {} }, // incomplete: dropped
  ],
};
function macros(kcal, p, c, f) {
  return [
    { nutrientNumber: "208", value: kcal }, { nutrientNumber: "203", value: p },
    { nutrientNumber: "205", value: c }, { nutrientNumber: "204", value: f },
  ];
}
function mockFetch({ usda = usdaBody, off = offBody, usdaStatus = 200, offStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    u.body = opts.body ? JSON.parse(opts.body) : null;
    calls.push(u);
    const isUsda = u.hostname === "api.nal.usda.gov";
    const status = isUsda ? usdaStatus : offStatus;
    return { ok: status === 200, status, json: async () => (isUsda ? usda : off) };
  };
  return calls;
}

test("one or zero letters asks nobody", async () => {
  const calls = mockFetch();
  const res = await get("c");
  assert.deepEqual(res.body, { ok: true, products: [], partial: false });
  assert.equal(calls.length, 0);
});

test("asks USDA (with a prefix wildcard) and Open Food Facts together, best match first", async () => {
  const calls = mockFetch();
  const res = await get("chicken bre");
  assert.equal(res.body.ok, true);
  assert.equal(res.body.partial, false);
  const usdaUrl = calls.find((u) => u.hostname === "api.nal.usda.gov");
  assert.equal(usdaUrl.body.query, "chicken bre*");
  assert.ok(usdaUrl.body.dataType.includes("Survey (FNDDS)"));
  assert.equal(usdaUrl.body.requireAllWords, true);
  assert.ok(calls.some((u) => u.hostname === "search.openfoodfacts.org"));
  const names = res.body.products.map((p) => p.name);
  assert.equal(names[0], "Chicken breast, baked");
  assert.ok(names.indexOf("Chicken breast fillets") < names.indexOf("Chick Peas"));
  assert.ok(!names.includes("No numbers"));
  assert.match(res.headers["cache-control"], /s-maxage/);
});

test("a repeated search is served from memory", async () => {
  mockFetch();
  await get("banana split");
  const calls = mockFetch();
  const res = await get("Banana  Split");
  assert.equal(calls.length, 0);
  assert.equal(res.body.ok, true);
});

test("one source down still returns the other, flagged partial and not cached", async () => {
  mockFetch({ usdaStatus: 429 });
  const res = await get("oreo cookies");
  assert.equal(res.body.ok, true);
  assert.equal(res.body.partial, true);
  assert.ok(res.body.products.length > 0);
  assert.equal(res.headers["cache-control"], undefined);
  const calls = mockFetch();
  await get("oreo cookies");
  assert.ok(calls.length > 0, "asked again because the first answer was incomplete");
});

test("both sources down is an error the phone can fall back from", async () => {
  mockFetch({ usdaStatus: 429, offStatus: 503 });
  const res = await get("anything at all");
  assert.equal(res.code, 502);
  assert.equal(res.body.ok, false);
});

test("ranking: whole words beat prefixes, missing a word sinks, repeats and unnamed go", () => {
  const p = (name, extra = {}) => ({ name, brand: null, ...extra });
  const ranked = rankProducts([
    p("Chickpea curry"),
    p("Chicken"),
    p("Unknown product"),
    p("Chicken", { brand: null }),
    p("Rice"),
  ], "chicken");
  assert.equal(ranked[0].name, "Chicken");
  assert.equal(ranked.length, 3, "non-matches are kept, below the match");
  assert.equal(ranked.filter((x) => x.name === "Chicken").length, 1);
  assert.ok(!ranked.some((x) => x.name === "Unknown product"));
  assert.ok(scoreProduct(p("Pechuga de pollo"), "pech") > scoreProduct(p("Pollo asado"), "pech"));
  assert.ok(scoreProduct(p("Plátano maduro"), "platano") > 0, "accents ignored");
});

test("harina de avena finds oat flour, not almond flour, in Spanish or English names", () => {
  const p = (name, extra = {}) => ({ name, brand: null, ...extra });
  const ranked = rankProducts([
    p("Harina de almendras"),
    p("Almond flour"),
    p("Oat flour", { source: "usda" }),
    p("Harina de avena integral"),
    p("Avena en hojuelas"),
  ], "harina de avena");
  assert.deepEqual(ranked.slice(0, 2).map((x) => x.name), ["Harina de avena integral", "Oat flour"]);
  assert.ok(ranked.indexOf(ranked.find((x) => x.name === "Harina de almendras")) > 1, "almond flour sinks");
  assert.equal(rankProducts([p("Harina de avena"), p("Harina de almendras")], "harina de almendras")[0].name, "Harina de almendras");
  // plurals, and "de" alone is no match
  assert.ok(scoreProduct(p("Scrambled eggs"), "huevos revueltos") > scoreProduct(p("Huevo de chocolate"), "huevos revueltos") - 1000);
  assert.ok(scoreProduct(p("Oat flour"), "harina de avena") > scoreProduct(p("Harina de almendras"), "harina de avena"));
});

test("USDA is asked in English when the words are Spanish", () => {
  assert.equal(englishQuery("harina de avena"), "flour oat");
  assert.equal(englishQuery("Pechuga de pollo asada"), "breast chicken roasted");
  assert.equal(englishQuery("almendras"), "almond");
  assert.equal(englishQuery("oat flour"), null, "English stays as typed");
  assert.equal(englishQuery("pan fried chicken"), null, "pan isn't translated: it's English too");
  assert.equal(englishQuery("arepa"), null);
});

test("the built-in list has each flour on its own", () => {
  assert.equal(searchLocalFoods("harina de avena", { lang: "es" })[0].name, "Harina de avena");
  assert.equal(searchLocalFoods("harina de avena", { lang: "es" })[0].calories, 404);
  assert.equal(searchLocalFoods("oat flour", { lang: "en" })[0].name, "Oat flour");
  assert.ok(!searchLocalFoods("harina de avena", { lang: "es" }).some((f) => /almendra/i.test(f.name)));
  assert.equal(searchLocalFoods("harina de almendras", { lang: "es" })[0].name, "Harina de almendras");
});
