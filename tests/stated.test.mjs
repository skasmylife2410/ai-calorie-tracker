// stated.test.mjs — describing a meal with a photo of it (and of the leftovers). Amounts people
// give are objective measurements: the photo fills in what they leave out, never what they said,
// and leftovers never come off a food they measured.
import test from "node:test";
import assert from "node:assert/strict";

process.env.ALLOW_ANONYMOUS = "1";
delete process.env.APP_USERS;
delete process.env.APP_TOKEN;

class MemoryStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const { parseMeasure, quoteIsInText, holdToStated, holdItemsToStated } = await import("../js/stated.js");
const { applyLeftovers, leftoversText } = await import("../js/leftovers.js");
const { mapRawItemToAnalyzedItem } = await import("../js/api.js");
const { default: gemini } = await import("../api/gemini.js");

test("weights and volumes are read in English and Spanish", () => {
  const g = (q) => { const m = parseMeasure(q); return m && m.kind !== "household" ? [m.kind, Math.round(m.lo), Math.round(m.hi)] : m?.kind ?? null; };
  assert.deepEqual(g("200 g"), ["mass", 200, 200]);
  assert.deepEqual(g("200g"), ["mass", 200, 200]);
  assert.deepEqual(g("1,5 kg"), ["mass", 1500, 1500]);
  assert.deepEqual(g("8 oz"), ["mass", 227, 227]);
  assert.deepEqual(g("1/2 lb"), ["mass", 227, 227]);
  assert.deepEqual(g("a 330 ml can"), ["volume", 330, 330]);
  assert.deepEqual(g("half a litre"), ["volume", 500, 500]);
  assert.deepEqual(g("medio litro"), ["volume", 500, 500]);
  assert.deepEqual(g("8 fl oz"), ["volume", 237, 237]);
  assert.deepEqual(g("200-250 g"), ["mass", 200, 250]);
  assert.deepEqual(g("2 large eggs (100 g)"), ["mass", 100, 100]);
  assert.equal(g("2 cups"), "household");
  assert.equal(g("3 glasses"), "household");
  assert.equal(g("2 eggs"), null, "a count is not a weight");
  assert.equal(g("a la plancha"), null);
});

test("a quote counts only if it's really in what they wrote", () => {
  assert.equal(quoteIsInText("200 g", "Rice and 200g of chicken"), true);
  assert.equal(quoteIsInText("250 g", "Rice and 200g of chicken"), false);
});

const chicken = { name: "grilled chicken breast", gramsEstimate: 150, calories: 240, proteinG: 45, carbsG: 0, fatG: 5, unit: undefined };

test("a stated weight is held exactly, numbers scaled with it", () => {
  const out = holdToStated({ ...chicken, statedAmount: "200 g" }, "rice with 200 g chicken");
  assert.equal(out.gramsEstimate, 200);
  assert.equal(out.unit, "g");
  assert.equal(out.amount, 200);
  assert.equal(Math.round(out.calories), 320);
  assert.equal(out.proteinG, 60);
  assert.equal(out.stated, true);
  assert.equal(out.statedAmount, "200 g");
});

test("an invented quote is ignored, and the estimate stands", () => {
  const out = holdToStated({ ...chicken, statedAmount: "200 g" }, "rice with chicken");
  assert.equal(out.gramsEstimate, 150);
  assert.equal(out.stated, undefined);
  assert.equal(out.statedAmount, undefined);
});

test("a stated volume shows in ml; the model's density is kept when it's sensible", () => {
  const soda = { name: "cola", gramsEstimate: 340, calories: 139, proteinG: 0, carbsG: 35, fatG: 0 };
  const ok = holdToStated({ ...soda, statedAmount: "330 ml" }, "a 330 ml can of cola");
  assert.deepEqual([ok.unit, ok.amount, ok.gramsEstimate, Math.round(ok.calories)], ["ml", 330, 340, 139]);
  const off = holdToStated({ ...soda, gramsEstimate: 150, calories: 63, statedAmount: "330 ml" }, "a 330 ml can of cola");
  assert.equal(off.gramsEstimate, 330, "150 g can't be 330 ml of cola: back to the volume");
  assert.equal(Math.round(off.calories), 139);
});

test("a range keeps an estimate inside it and pulls one outside to the nearest end", () => {
  const inside = holdToStated({ ...chicken, gramsEstimate: 220, calories: 352, statedAmount: "200-250 g" }, "200-250 g chicken");
  assert.equal(inside.gramsEstimate, 220);
  const outside = holdToStated({ ...chicken, statedAmount: "200-250 g" }, "200-250 g chicken");
  assert.equal(outside.gramsEstimate, 200);
});

test("a count keeps its pieces; the weight sets what each one weighs", () => {
  const eggs = { name: "egg", gramsEstimate: 100, calories: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5, unit: "serving", amount: 2, gramsPerServing: 50 };
  const out = holdToStated({ ...eggs, statedAmount: "120 g" }, "2 eggs, 120 g");
  assert.deepEqual([out.unit, out.amount, out.gramsEstimate, out.gramsPerServing], ["serving", 2, 120, 60]);
});

test("household measures are the person's own amount but keep the model's grams", () => {
  const rice = { name: "white rice, cooked", gramsEstimate: 320, calories: 416, proteinG: 8.6, carbsG: 90, fatG: 0.9 };
  const out = holdToStated({ ...rice, statedAmount: "2 cups" }, "2 cups of rice");
  assert.equal(out.gramsEstimate, 320);
  assert.equal(out.stated, true);
});

test("without the person's words nothing is marked stated", () => {
  const [out] = holdItemsToStated([{ ...chicken, statedAmount: "200 g" }], "");
  assert.equal(out.stated, undefined);
  assert.equal(out.gramsEstimate, 150);
});

test("the model's quote comes through from the raw answer", () => {
  const item = mapRawItemToAnalyzedItem({ name: "chicken", grams_estimate: 200, calories: 330, protein_g: 62, carbs_g: 0, fat_g: 7, confidence: 0.9, stated_amount: " 200 g " });
  assert.equal(item.statedAmount, "200 g");
  const none = mapRawItemToAnalyzedItem({ name: "rice", grams_estimate: 180, calories: 230, protein_g: 4, carbs_g: 50, fat_g: 0.5, confidence: 0.8, stated_amount: "" });
  assert.equal(none.statedAmount, undefined);
});

test("leftovers never come off a measured food, and say so", () => {
  const items = [
    { name: "chicken", calories: 320, proteinG: 60, carbsG: 0, fatG: 7, gramsEstimate: 200, stated: true, statedAmount: "200 g" },
    { name: "rice", calories: 300, proteinG: 6, carbsG: 66, fatG: 1, gramsEstimate: 230 },
  ];
  assert.match(leftoversText(items), /0\. chicken — 200 g \(measured\)/);
  const out = applyLeftovers(items, [{ index: 0, left_fraction: 0.5 }, { index: 1, left_fraction: 0.5 }]);
  assert.equal(out.items[0].calories, 320, "measured: kept");
  assert.equal(out.items[1].calories, 150, "estimated: half came off");
  assert.equal(out.removedKcal, 150);
  assert.equal(out.keptMeasured, 1);
});

test("a typed meal with a photo gets the photo-as-context prompt; without, the words-only one", async () => {
  process.env.GEMINI_API_KEY = "primary";
  const prompts = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    prompts.push({ text: body.contents[0].parts.map((p) => p.text).filter(Boolean).join("\n"), images: body.contents[0].parts.filter((p) => p.inline_data).length });
    return { status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [], confidence: 0.8, questions: [], cooking_fat: "none" }) }] } }] }) };
  };
  const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  await gemini({ method: "POST", headers: {}, body: { mode: "text", text: "rice with 200 g chicken", image: "aGVsbG8=" } }, res());
  await gemini({ method: "POST", headers: {}, body: { mode: "text", text: "rice with 200 g chicken" } }, res());
  assert.equal(prompts[0].images, 1);
  assert.match(prompts[0].text, /OBJECTIVE MEASUREMENTS ARE NEVER CHANGED/);
  assert.match(prompts[0].text, /stated_amount/);
  assert.equal(prompts[1].images, 0);
  assert.match(prompts[1].text, /there is no photo/);
});
