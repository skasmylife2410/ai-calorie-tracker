// Foods are shown in the person's language; the English name is kept only for the USDA check.
import test from "node:test";
import assert from "node:assert/strict";
import { mapRawItemToAnalyzedItem, groundWith, searchNameOf } from "../js/api.js";

const raw = { name: "white rice, cooked", display_name: "Arroz blanco", grams_estimate: 160, calories: 210, protein_g: 4, carbs_g: 45, fat_g: 0.5, confidence: 0.8 };

test("the shown name is the Spanish one, the English one is kept for lookups", () => {
  const item = mapRawItemToAnalyzedItem(raw);
  assert.equal(item.name, "Arroz blanco");
  assert.equal(item.searchName, "white rice, cooked");
  assert.equal(searchNameOf(item), "white rice, cooked");
});

test("English users get one name and no searchName", () => {
  const item = mapRawItemToAnalyzedItem({ ...raw, display_name: "white rice, cooked" });
  assert.equal(item.name, "white rice, cooked");
  assert.equal(item.searchName, undefined);
  assert.equal(mapRawItemToAnalyzedItem({ ...raw, display_name: undefined }).name, "white rice, cooked");
});

test("grounding still matches USDA through the English name and keeps the Spanish one", () => {
  const item = mapRawItemToAnalyzedItem(raw);
  const hit = { description: "Rice, white, long-grain, regular, cooked", per100: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 }, microsPer100: null };
  const out = groundWith(item, hit);
  assert.ok(out?.grounded);
  assert.equal(out.name, "Arroz blanco");
});
