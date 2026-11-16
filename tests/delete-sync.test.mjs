// delete-sync.test.mjs — a deleted meal must stay deleted.
//
// sync.js pulls before it pushes, so every sync cycle merges the server's copy of an entry that
// this device has just deleted but not yet reported. The entry is gone locally, so the old
// last-write-wins rule gave it localUpdatedAt = -1, remote won every time, and the meal came back
// on screen. Carmen hit exactly this deleting a Margarita from the day before (Nov 2026).

import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
  key(i) { return [...this._d.keys()][i]; }
  get length() { return this._d.size; }
}
globalThis.localStorage = new MemoryStorage();
const store = await import("../js/store.js");
const sync = await import("../js/sync.js");

/** Logs one meal and returns it, with `updatedAt` forced so the clocks in each test are explicit. */
function logMeal({ name = "Margarita cocktail", calories = 275, updatedAt }) {
  const entry = store.addFoodEntry({ name, calories, proteinG: 0, carbsG: 26, fatG: 0 });
  return store.updateFoodEntry(entry.id, { updatedAt });
}

test("a pull does not resurrect a meal this device just deleted", () => {
  localStorage.clear();
  const entry = logMeal({ updatedAt: 1000 });
  assert.equal(store.deleteFoodEntry(entry.id), true);
  assert.equal(store.allFoodEntries().length, 0, "deleted locally");

  // The server still has the live copy: it has not heard about the deletion yet.
  store.applyRemoteFoodEntry({ id: entry.id, deleted: false, updatedAt: 1000, data: entry });

  assert.equal(store.allFoodEntries().length, 0, "the deleted meal must not come back");
});

test("a genuinely newer remote edit still wins over an older deletion", () => {
  localStorage.clear();
  const entry = logMeal({ updatedAt: 1000 });
  store.deleteFoodEntry(entry.id);
  const tomb = store.allDeletedTombstones().find((t) => t.id === entry.id);
  assert.ok(tomb, "deleting records a tombstone");

  // Another phone edited the same meal AFTER this deletion — that edit is the later intent.
  store.applyRemoteFoodEntry({
    id: entry.id,
    deleted: false,
    updatedAt: (tomb.deletedAt ?? 0) + 5000,
    data: { ...entry, name: "Margarita cocktail", calories: 300 },
  });

  assert.equal(store.allFoodEntries().length, 1, "a later remote edit is not swallowed");
});

test("a remote tombstone still deletes the local copy", () => {
  localStorage.clear();
  const entry = logMeal({ updatedAt: 1000 });
  store.applyRemoteFoodEntry({ id: entry.id, deleted: true, updatedAt: 2000 });
  assert.equal(store.allFoodEntries().length, 0, "deletions from other devices still apply");
});

test("every pending tombstone is pushed, however old, until the server takes it", () => {
  localStorage.clear();
  const entry = logMeal({ updatedAt: 1000 });
  store.deleteFoodEntry(entry.id);

  // sinceMs far in the future: the old filter stranded the tombstone here, so the deletion
  // never reached the server and every later pull put the meal back.
  const payload = sync.buildPushPayload(Date.now() + 86_400_000);
  const ids = payload.entries.filter((e) => e.deleted).map((e) => e.id);
  assert.deepEqual(ids, [entry.id], "the tombstone is still offered to the server");
  assert.deepEqual(payload.tombstoneIds, [entry.id]);
});
