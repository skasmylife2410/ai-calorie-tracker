// us-together.test.mjs — "Day by day" on the Us tab: unfinished days are gaps, people who rarely
// log stay out of the group average (but stay visible), and the chart draws for any group size.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class MemoryStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
}
globalThis.localStorage = new MemoryStorage();
const i18n = await import("../js/i18n.js");
i18n.setBundles({
  en: JSON.parse(readFileSync(new URL("../i18n/en.json", import.meta.url), "utf8")),
  es: JSON.parse(readFileSync(new URL("../i18n/es.json", import.meta.url), "utf8")),
});
await i18n.setLanguage("en");
const { dayValue, regulars, groupAverage, togetherInner } = await import("../js/ui/us-together.js");

const KEYS = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
const TODAY = "2026-10-10";
const day = (calories, proteinG = 100) => ({ calories, proteinG, meals: 3 });
const person = (owner, goal, kcals) => ({ owner, name: owner, goals: { calories: goal, proteinG: 120 }, days: Object.fromEntries(kcals.map((c, i) => [KEYS[i], c === null ? undefined : day(c)]).filter(([, d]) => d)) });

const steady = person("ana", 2000, [2000, 1900, 2100, 2000, 1800, 2200, 600]);
const rare = person("bo", 1500, [null, 3000, null, null, null, 3000, null]); // two big days a week
const forgot = person("cy", 1800, [1800, 300, 1700, 1900, 1750, 1850, null]); // one short day

test("every logged day counts, a short one too; a day with nothing logged is a gap", () => {
  assert.equal(dayValue(forgot, "2026-10-05", "kcal"), 300, "300 of 1,800 still counts");
  assert.equal(Math.round(dayValue(forgot, "2026-10-05", "pct")), 17);
  assert.equal(dayValue(forgot, "2026-10-05", "protein"), 100);
  assert.equal(dayValue(forgot, "2026-10-04", "pct"), 100);
  assert.equal(dayValue(steady, TODAY, "kcal"), 600, "today: so far");
  assert.equal(dayValue(rare, "2026-10-04", "kcal"), null, "nothing logged");
  assert.equal(dayValue(rare, "2026-10-04", "protein"), null);
});

test("someone who logs two days a week isn't in the average, and doesn't move it", () => {
  const reg = regulars([steady, rare, forgot], KEYS, TODAY);
  assert.deepEqual([...reg].sort(), ["ana", "cy"]);
  const avg = groupAverage([steady, rare, forgot], reg, "2026-10-05", "kcal", TODAY);
  assert.deepEqual(avg, { v: 1100, n: 2 }, "bo's 3,000 is left out; cy's short day counts");
});

test("a new member is judged on the days since they started", () => {
  const newbie = person("di", 1600, [null, null, null, null, 1600, 1500, 400]);
  assert.ok(regulars([newbie], KEYS, TODAY).has("di"), "2 logged days of the 2 since joining");
  const once = person("ed", 1600, [null, null, null, null, null, 1500, null]);
  assert.ok(!regulars([once], KEYS, TODAY).has("ed"), "one day isn't a habit yet");
});

test("the section draws for a group, marks who's left out, and for one person alone", () => {
  const days = KEYS.map((key) => ({ key, ts: new Date(`${key}T12:00:00`).getTime() })).reverse();
  const html = togetherInner({ people: [steady, rare, forgot], days, me: "ana", todayKey: TODAY });
  assert.match(html, /Day by day/);
  assert.match(html, /not in avg/);
  assert.equal((html.match(/data-pick=/g) || []).length, 3, "everyone is listed");
  const solo = togetherInner({ people: [steady], days, me: "ana", todayKey: TODAY });
  assert.match(solo, /<svg/);
});

test("an opened day marks each person as the chart does", () => {
  const days = KEYS.map((key) => ({ key, ts: new Date(`${key}T12:00:00`).getTime() })).reverse();
  const seen = [];
  togetherInner({ people: [steady, rare, forgot], days, me: "ana", todayKey: TODAY, selectedDay: "2026-10-04",
    dayDetail: (key, mark) => { seen.push(...[steady, rare, forgot].map((p) => mark(p).color)); return ""; } });
  // picks last the session: after the solo view only ana is picked, in slot 1; the rest stay grey
  assert.deepEqual(seen, ["var(--tc-s1)", "var(--tc-sec)", "var(--tc-sec)"]);
});
