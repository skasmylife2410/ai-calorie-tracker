// barcode-memory.test.mjs — one spelling per barcode (UPC-E and padded US codes), the USDA retry
// with a leading 0, and the scanner's own memory: a product typed in after a miss is found on the
// next scan, by anyone, and every lookup is logged for the hit rate.
import test from "node:test";
import assert from "node:assert/strict";

process.env.ALLOW_ANONYMOUS = "1";
delete process.env.APP_USERS;
delete process.env.APP_TOKEN;
process.env.SUPABASE_URL = "https://sb.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

const { upcEToUpcA, canonicalBarcode, lookupBarcodeBoth } = await import("../js/api.js");
const { default: handler } = await import("../api/foods.js");

const mockRes = () => ({
  code: 200, body: null, headers: {},
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; },
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
});
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

test("UPC-E codes are written out as their UPC-A", () => {
  assert.equal(upcEToUpcA("04252614"), "042100005264");
  assert.equal(upcEToUpcA("04963406"), "049000006346"); // a Coca-Cola can
  assert.equal(upcEToUpcA("04963407"), null, "wrong check digit: not a UPC-E");
  assert.equal(upcEToUpcA("96385074"), null, "an EAN-8 stays itself");
});

test("every spelling of a code comes to the same one", () => {
  for (const c of ["04963406", "049000006346", "0049000006346", "00049000006346"]) assert.equal(canonicalBarcode(c), "049000006346");
  assert.equal(canonicalBarcode("7702011026187"), "7702011026187");
  assert.equal(canonicalBarcode("07702011026187"), "7702011026187");
});

test("a US code: OFF gets 13 digits, USDA tries 12 then the leading-0 spelling", async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === "world.openfoodfacts.org") { asked.push(`off ${u.pathname.split("/").pop()}`); return { ok: false, status: 404 }; }
    const q = u.searchParams.get("query");
    asked.push(`usda ${q}`);
    return ok({ foods: q === "0049000006346" ? [{ fdcId: 1, description: "COLA", gtinUpc: "0049000006346", servingSize: 355, servingSizeUnit: "ml", foodNutrients: [{ nutrientNumber: "208", value: 39 }, { nutrientNumber: "203", value: 0 }, { nutrientNumber: "205", value: 11 }, { nutrientNumber: "204", value: 0 }] }] : [] });
  };
  const out = await lookupBarcodeBoth("04963406");
  assert.deepEqual(asked.sort(), ["off 0049000006346.json", "usda 0049000006346", "usda 049000006346"]);
  assert.equal(out.status, "found");
});

test("typed in after a miss: kept, found on the next scan, and every lookup logged", async () => {
  const saved = new Map();
  const logged = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.hostname === "sb.test") {
      if (u.pathname.endsWith("/snapcal_barcode_lookups")) { logged.push(JSON.parse(opts.body)[0]); return ok({}); }
      if (opts.method === "POST") { const [row] = JSON.parse(opts.body); saved.set(row.code, row); return ok({}); }
      const code = u.searchParams.get("code").replace("eq.", "");
      return ok(saved.has(code) ? [{ product: saved.get(code).product }] : []);
    }
    if (u.hostname === "world.openfoodfacts.org") return { ok: false, status: 404 };
    return ok({ foods: [] }); // USDA: nothing
  };
  const scan = async (code) => { const res = mockRes(); await handler({ method: "GET", url: `/api/foods?barcode=${code}`, headers: {} }, res); return res; };

  const miss = await scan("04252614");
  assert.equal(miss.body.status, "notFound");

  const res = mockRes();
  await handler({ method: "POST", url: "/api/foods", headers: {}, body: { barcode: "04252614", product: { name: "Trail mix", servingDescription: "1 serving (40 g)", calories: 190, proteinG: 5, carbsG: 18, fatG: 12 } } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(saved.get("042100005264").product.name, "Trail mix", "kept under the full UPC-A");

  const next = await scan("0042100005264"); // the same product, read the long way
  assert.equal(next.body.status, "found");
  assert.equal(next.body.product.source, "group");
  assert.equal(next.body.product.calories, 190);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(logged.map((l) => [l.code, l.status, l.source]), [["042100005264", "notFound", null], ["042100005264", "found", "group"]]);
});

test("a product without its numbers isn't kept", async () => {
  globalThis.fetch = async () => { throw new Error("should not be called"); };
  const res = mockRes();
  await handler({ method: "POST", url: "/api/foods", headers: {}, body: { barcode: "04252614", product: { name: "Trail mix", calories: 190 } } }, res);
  assert.equal(res.code, 400);
});

test("a label photo fills the form with one serving as printed; a typed name stays", async () => {
  const { fillFromLabel } = await import("../js/ui/addfood.js");
  const item = { name: "Granola Bar", gramsEstimate: 40, calories: 189.6, proteinG: 4.04, carbsG: 26.96, fatG: 7.5, micros: { sugarG: 11 } };
  const blank = fillFromLabel({ name: "", amount: null, amountUnit: "g" }, item);
  assert.deepEqual([blank.name, blank.amount, blank.amountUnit, blank.calories, blank.proteinG, blank.carbsG, blank.fatG], ["Granola Bar", 40, "g", 190, 4, 27, 7.5]);
  assert.equal(blank.micros.sugarG, 11);
  assert.equal(fillFromLabel({ name: "Kids' granola", amount: null, amountUnit: "g" }, item).name, "Kids' granola");
  const noWeight = fillFromLabel({ name: "", amount: 2, amountUnit: "serving" }, { ...item, gramsEstimate: 0 });
  assert.deepEqual([noWeight.amount, noWeight.amountUnit], [2, "serving"], "no serving weight printed: keep what was there");
});
