// photo-trim.test.mjs — a phone whose storage is full of meal photos can still log a meal: the
// oldest meals let go of their local photo (the server keeps it) until the new one fits.
import test from "node:test";
import assert from "node:assert/strict";

/** localStorage with Safari's limit: about 5 MB, counted two bytes per character. */
class TinyStorage {
  constructor(maxChars) { this._d = new Map(); this.max = maxChars; }
  size() { let n = 0; for (const [k, v] of this._d) n += k.length + v.length; return n; }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) {
    const s = String(v);
    const after = this.size() - (this._d.get(k)?.length ?? 0) - (this._d.has(k) ? 0 : -k.length) + s.length;
    if (after > this.max) { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e; }
    this._d.set(k, s);
  }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
}

globalThis.localStorage = new TinyStorage(400_000);
const store = await import("../js/store.js");

const photo = (i) => `data:image/jpeg;base64,${String(i).padStart(4, "0")}${"A".repeat(20_000)}`;

test("a full storage trims the oldest photos so a new photo meal still saves", () => {
  const day = 86_400_000;
  const t0 = Date.now() - 30 * day;
  for (let i = 0; i < 19; i += 1) {
    store.addFoodEntry({ name: `meal ${i}`, calories: 400, source: "photo", photoDataUrl: photo(i), timestamp: t0 + i * day, updatedAt: 1000 + i });
  }
  const before = store.allFoodEntries();
  const stamps = new Map(before.map((e) => [e.id, e.updatedAt]));
  // the storage can't take another photo as things are
  assert.throws(() => localStorage.setItem("probe", "x".repeat(25_000)));

  const added = store.addFoodEntry({ name: "Analyzing…", source: "photo", photoDataUrl: photo(99), isPending: true });
  const after = store.allFoodEntries();
  assert.ok(after.some((e) => e.id === added.id && e.photoDataUrl === photo(99)), "the new meal saved with its photo");
  const byTime = [...after].sort((a, b) => a.timestamp - b.timestamp);
  const trimmed = byTime.filter((e) => e.photoTrimmed);
  assert.ok(trimmed.length > 0, "some old photos were let go");
  assert.ok(trimmed.every((e) => e.photoDataUrl === null));
  assert.ok(byTime.slice(-9).every((e) => e.photoDataUrl), "the newest meals keep their photos");
  assert.equal(trimmed[0].id, byTime[0].id, "oldest first");
  assert.ok(trimmed.every((e) => e.updatedAt === stamps.get(e.id)), "nothing to sync: the server's meal is unchanged");
  // an edited trimmed meal keeps saying so, for the server to put its photo back
  const edited = store.updateFoodEntry(trimmed[0].id, { name: "renamed" });
  assert.equal(edited.photoTrimmed, true);
  assert.equal(store.makeFoodEntry(edited).photoTrimmed, true);
});
