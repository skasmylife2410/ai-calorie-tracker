// ate-too.test.mjs — "I ate this too" on Shared: someone else's meal or food photo goes into your
// log at the time they shared it (you ate together); never on your own posts.
import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.fetch = async (url) => {
  if (String(url).includes("/api/gemini")) return { ok: true, status: 200, json: async () => ({ items: [{ name: "arepa", calories: 300, protein_g: 8, carbs_g: 40, fat_g: 12, grams_estimate: 150, confidence: 0.8 }] }) };
  throw new TypeError("offline");
};

const store = await import("../js/store.js");
const { canEatToo, logAteToo } = await import("../js/ui/us-social.js");
const PHOTO = "data:image/jpeg;base64,AAAA";
const at = "2026-10-16T18:30:00.000Z";
const meal = { id: "s1", owner: "mibaby", kind: "meal", created_at: at, data: { name: "Bandeja paisa", calories: 1100, proteinG: 55, carbsG: 120, fatG: 45, photo: PHOTO, items: [] } };
const post = { id: "s2", owner: "vivi", kind: "post", created_at: at, data: { text: "Dinner with the family", photo: PHOTO } };

test("only someone else's meal, or a post with a photo", () => {
  assert.equal(canEatToo(meal, "aelson"), true);
  assert.equal(canEatToo(post, "aelson"), true);
  assert.equal(canEatToo(meal, "mibaby"), false, "your own post: it's already in your log");
  assert.equal(canEatToo({ ...post, data: { text: "Good morning!" } }, "aelson"), false, "nothing to eat in words only");
  assert.equal(canEatToo({ ...post, data: { gif: { id: "x" } } }, "aelson"), false);
});

test("a shared meal is copied with its numbers, at the time it was shared", async () => {
  const e = await logAteToo(meal, Date.parse("2026-10-17T09:00:00Z"));
  const saved = store.getFoodEntry(e.id);
  assert.equal(saved.calories, 1100);
  assert.equal(saved.proteinG, 55);
  assert.equal(saved.timestamp, Date.parse(at), "when you ate together, not when you tapped");
});

test("a food photo post is analysed for your log, its caption as context", async () => {
  const e = await logAteToo(post, Date.parse("2026-10-17T09:00:00Z"));
  assert.equal(e.isPending, true);
  assert.equal(e.analysisDescription, "Dinner with the family");
  assert.equal(e.timestamp, Date.parse(at));
  assert.equal(store.getFoodEntry(e.id).photoDataUrl, PHOTO);
});

test("a post time in the future (a phone clock off) lands now instead", async () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const e = await logAteToo(meal, now);
  assert.equal(store.getFoodEntry(e.id).timestamp, now);
});
