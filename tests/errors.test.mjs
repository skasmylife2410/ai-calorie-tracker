// errors.test.mjs — the unhappy paths. Every one of these is a real thing that can happen on a
// phone (bad key, quota, offline, junk JSON, weird user input) and none of them may throw.
import test from "node:test";
import assert from "node:assert/strict";

// These tests exercise /api/gemini's error handling, not its auth gate, so open the gate the
// same way the local dev server does.
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

const api = await import("../js/api.js");
const store = await import("../js/store.js");
const { default: gemini } = await import("../api/gemini.js");

const mockRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (body, method = "POST") => ({ method, headers: {}, body });

// --- server: /api/gemini refuses bad input without calling the model ----------

test("exercise mode with empty text never reaches the model", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const res = mockRes();
  await gemini(req({ mode: "exercise", text: "   " }), res);
  assert.equal(res.body.errorType, "other");
  assert.match(res.body.message, /Describe the workout/);
  assert.equal(called, false);
});

test("missing API key is reported as badKey, not a crash", async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const res = mockRes();
  await gemini(req({ mode: "recipes", caloriesLeft: 800, proteinLeft: 40 }), res);
  assert.equal(res.body.errorType, "badKey");
  if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
});

test("rate limiting surfaces as quota, and a 400 as badKey", async () => {
  process.env.GEMINI_API_KEY = "primary";
  delete process.env.GEMINI_API_KEY_BACKUP;

  globalThis.fetch = async () => ({ status: 429, ok: false });
  let res = mockRes();
  await gemini(req({ mode: "recipes", caloriesLeft: 800, proteinLeft: 40 }), res);
  assert.equal(res.body.errorType, "quota");

  globalThis.fetch = async () => ({ status: 400, ok: false });
  res = mockRes();
  await gemini(req({ mode: "exercise", text: "45 min soccer" }), res);
  assert.equal(res.body.errorType, "badKey");
});

test("malformed model output is reported as a parse error", async () => {
  process.env.GEMINI_API_KEY = "primary";
  globalThis.fetch = async () => ({
    status: 200, ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "not json at all" }] } }] }),
  });
  const res = mockRes();
  await gemini(req({ mode: "exercise", text: "45 min soccer" }), res);
  assert.equal(res.body.errorType, "parse");
});

test("GET is rejected", async () => {
  const res = mockRes();
  await gemini(req({ mode: "recipes" }, "GET"), res);
  assert.equal(res.code, 405);
});

// --- client: parsers cope with junk -----------------------------------------

test("exercise parser drops zero-minute sessions and defaults odd fields", async () => {
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ items: [
      { name: "", activity: "QUIDDITCH", minutes: "45", intensity: "BRUTAL" },
      { name: "Nap", activity: "other", minutes: 0, intensity: "easy" },
    ] }),
  });
  const out = await api.parseExerciseText("45 min quidditch");
  assert.equal(out.ok, true);
  assert.equal(out.sessions.length, 1);
  assert.deepEqual(out.sessions[0], { name: "Workout", activity: "quidditch", minutes: 45, intensity: "brutal" });
  // the store is the gatekeeper: unknown activity/intensity fall back to sane values
  localStorage.clear();
  const saved = store.addExerciseEntry(out.sessions[0]);
  assert.equal(saved.activity, "other");
  assert.equal(saved.intensity, "moderate");
  assert.ok(saved.caloriesBurned > 0);
});

test("network failure and a non-JSON body are reported, not thrown", async () => {
  globalThis.fetch = async () => { throw new Error("offline"); };
  const a = await api.suggestRecipes({ caloriesLeft: 900, proteinLeft: 50 });
  assert.equal(a.ok, false);
  assert.equal(a.errorType, "network");

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
  const b = await api.suggestRecipes({ caloriesLeft: 900, proteinLeft: 50 });
  assert.equal(b.ok, false);
  assert.equal(b.errorType, "parse");
});

test("recipes with missing fields are dropped rather than shown half-empty", async () => {
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ items: [
      { name: "Good one", minutes: 20, calories: 600, protein_g: 40, carbs_g: 50, fat_g: 20, ingredients: ["rice"], steps: ["cook"] },
      { name: "", minutes: 10, calories: 400 },
      { name: "No calories", minutes: 10, calories: 0 },
    ] }),
  });
  const out = await api.suggestRecipes({ caloriesLeft: 900, proteinLeft: 50 });
  assert.equal(out.recipes.length, 1);
  assert.equal(out.recipes[0].name, "Good one");
  assert.deepEqual(out.recipes[0].ingredients, ["rice"]);
});

// --- store: hostile / broken local data --------------------------------------

test("corrupt localStorage falls back to empty instead of crashing the app", () => {
  localStorage.clear();
  localStorage.setItem("snapcal.foodEntries", "{{{not json");
  localStorage.setItem("snapcal.exerciseEntries", "also broken");
  assert.deepEqual(store.allFoodEntries(), []);
  assert.deepEqual(store.allExerciseEntries(), []);
  assert.equal(store.totalsForDay().calories, 0);
});

test("servings and exercise reject nonsense input", () => {
  localStorage.clear();
  assert.equal(store.setServings("no-such-entry", 2), null);
  assert.equal(store.normalizeServings(NaN), 1);
  assert.equal(store.normalizeServings(Infinity), 1);
  assert.equal(store.normalizeServings(null), 1);

  const e = store.addExerciseEntry({ minutes: -30, activity: null, intensity: 42 });
  assert.equal(e.minutes, 0);
  assert.equal(e.caloriesBurned, 0);
  assert.equal(store.dayEnergy().credit, 0);
});

test("a day with no profile still produces usable numbers", () => {
  localStorage.clear();
  const day = store.dayEnergy();
  assert.ok(Number.isFinite(day.baseTarget));
  assert.ok(Number.isFinite(day.remaining));
  assert.equal(day.burned, 0);
});

test("favouriting an entry that was deleted does nothing", () => {
  localStorage.clear();
  const e = store.addFoodEntry({ name: "Gone", calories: 100 });
  store.deleteFoodEntry(e.id);
  assert.equal(store.toggleFavorite(e.id), false);
  assert.equal(store.allSavedFoods().length, 0);
  assert.equal(store.logSavedFood("missing-id"), null);
});

// --- voice transcription -------------------------------------------------------------

test("transcribe rejects missing, unknown-format and oversized audio before calling the model", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200 }; };
  process.env.GEMINI_API_KEY = "primary";

  let res = mockRes();
  await gemini(req({ mode: "transcribe", audio: "", audioMime: "audio/webm" }), res);
  assert.equal(res.body.errorType, "other");

  res = mockRes();
  await gemini(req({ mode: "transcribe", audio: "AAAA", audioMime: "video/mp4" }), res);
  assert.equal(res.body.errorType, "other", "only audio types are accepted");

  res = mockRes();
  await gemini(req({ mode: "transcribe", audio: "A".repeat(3_000_001), audioMime: "audio/mp4" }), res);
  assert.match(res.body.message, /under a minute/);

  assert.equal(called, false, "none of these may reach Gemini");
});

test("transcribe sends the audio inline with its real type and returns the text", async () => {
  process.env.GEMINI_API_KEY = "primary";
  let sent;
  globalThis.fetch = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({
      candidates: [{ content: { parts: [{ text: '{"items":[{"text":"dos huevos y una arepa con queso"}]}' }] } }],
    }) };
  };
  const res = mockRes();
  // iPhone reports "audio/mp4;codecs=mp4a.40.2" — the codec suffix must be stripped
  await gemini(req({ mode: "transcribe", audio: "QUJD", audioMime: "audio/mp4;codecs=mp4a.40.2", lang: "es" }), res);
  const media = sent.contents[0].parts.find((p) => p.inline_data);
  assert.equal(media.inline_data.mime_type, "audio/mp4");
  assert.equal(media.inline_data.data, "QUJD");
  assert.deepEqual(res.body.items, [{ text: "dos huevos y una arepa con queso" }]);
});

// --- extra context travels with the photo ----------------------------------------------

test("a note typed with the photo is sent to the model, and re-analysing keeps it", async () => {
  process.env.GEMINI_API_KEY = "primary";
  const prompts = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    prompts.push(body.contents[0].parts.map((p) => p.text ?? "[image]").join(" "));
    return { ok: true, status: 200, json: async () => ({
      candidates: [{ content: { parts: [{ text: '{"items":[{"name":"Arepa","gramsEstimate":120,"calories":300,"proteinG":8,"carbsG":38,"fatG":13}]}' }] } }],
    }) };
  };
  const res = mockRes();
  await gemini(req({ mode: "meal", image: "QUJD", text: "fried in about two tablespoons of oil, I only ate half" }), res);
  assert.equal(res.body.items.length, 1);
  assert.match(prompts[0], /two tablespoons of oil/, "the note reaches the model");
  assert.match(prompts[0], /only ate half/);
  assert.match(prompts[0], /\[image\]/, "and the photo is still attached");
});
