// usdasearch.test.mjs — USDA FoodData Central name search (usdaSearchByName), and that
// search.js's UI ordering rule (USDA generic foods first, OFF branded second) is what the
// merge in js/ui/search.js implements. This file only tests the api.js client function
// directly; search.js's merge order is simple enough to read, but we sanity-check the shape
// USDA returns so a future API change fails loudly here instead of silently in the UI.
import test from "node:test";
import assert from "node:assert/strict";

const { usdaSearchByName } = await import("../js/api.js");

test("blank query short-circuits with no network call", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({ foods: [] }) }; };
  const res = await usdaSearchByName("   ");
  assert.deepEqual(res, { status: "success", products: [] });
  assert.equal(called, false);
});

test("maps Foundation/SR Legacy foods to clean-named products, dropping incomplete ones", async () => {
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = new URL(url);
    return {
      ok: true,
      json: async () => ({
        foods: [
          {
            fdcId: 1102640,
            description: "Bananas, raw",
            foodNutrients: [
              { nutrientNumber: "208", value: 89 },
              { nutrientNumber: "203", value: 1.09 },
              { nutrientNumber: "205", value: 22.8 },
              { nutrientNumber: "204", value: 0.33 },
            ],
          },
          { fdcId: 999, description: "Incomplete food", foodNutrients: [] }, // dropped
        ],
      }),
    };
  };
  const res = await usdaSearchByName("banana");
  assert.equal(capturedUrl.pathname, "/fdc/v1/foods/search");
  assert.equal(capturedUrl.searchParams.get("dataType"), "Foundation,SR Legacy");
  assert.equal(capturedUrl.searchParams.get("query"), "banana");
  assert.equal(res.status, "success");
  assert.equal(res.products.length, 1);
  assert.equal(res.products[0].name, "Bananas, raw");
  assert.equal(res.products[0].barcode, "usda:1102640");
  assert.equal(res.products[0].calories, 89);
});

test("network failure reports failed status, not a throw", async () => {
  globalThis.fetch = async () => { throw new Error("boom"); };
  const res = await usdaSearchByName("banana");
  assert.equal(res.status, "failed");
  assert.match(res.message, /boom/);
});
