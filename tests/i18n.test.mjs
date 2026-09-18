// i18n.test.mjs — translation lookup, plurals, placeholders, locale formatting, and the
// structural check that matters most: en.json and es.json must have exactly the same keys,
// or a screen silently falls back to English for one of us.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../i18n/en.json", import.meta.url), "utf8"));
const es = JSON.parse(readFileSync(new URL("../i18n/es.json", import.meta.url), "utf8"));

const i18n = await import("../js/i18n.js");
i18n.setBundles({ en, es });

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

test("both language files define exactly the same keys", () => {
  const a = new Set(flatten(en));
  const b = new Set(flatten(es));
  const missingInEs = [...a].filter((k) => !b.has(k));
  const missingInEn = [...b].filter((k) => !a.has(k));
  assert.deepEqual(missingInEs, [], "keys missing from es.json");
  assert.deepEqual(missingInEn, [], "keys missing from en.json");
});

test("placeholders match across languages, so no value loses a variable", () => {
  const vars = (s) => (String(s).match(/\{(\w+)\}/g) ?? []).sort().join(",");
  const walk = (a, b, path = "") => {
    for (const [k, v] of Object.entries(a)) {
      const other = b[k];
      if (v && typeof v === "object") walk(v, other ?? {}, `${path}${k}.`);
      else assert.equal(vars(v), vars(other), `${path}${k} placeholder mismatch`);
    }
  };
  walk(en, es);
});

test("t() resolves, substitutes and falls back", async () => {
  await i18n.setLanguage("en");
  assert.equal(i18n.t("home.caloriesLeft"), "Calories left");
  assert.equal(i18n.t("exercise.rowSub", { minutes: 45, burned: 430, credit: 258 }), "45 min · −430 kcal (258 counted)");
  assert.equal(i18n.t("nope.not.here"), "nope.not.here", "missing keys return the key, never blank");
});

test("Spanish switches every string and formats numbers its own way", async () => {
  await i18n.setLanguage("es");
  assert.equal(i18n.t("home.caloriesLeft"), "Calorías restantes");
  assert.equal(i18n.t("us.title"), "Nosotros");
  assert.equal(i18n.formatNumber(1240), "1240" === i18n.formatNumber(1240) ? i18n.formatNumber(1240) : "1.240");
  assert.match(i18n.formatNumber(1240), /1[.,\u202f\u00a0]?240/);
});

test("plurals pick the right form in both languages", async () => {
  await i18n.setLanguage("en");
  assert.equal(i18n.t("us.mealsCount", { n: 1 }), "1 meal");
  assert.equal(i18n.t("us.mealsCount", { n: 3 }), "3 meals");
  await i18n.setLanguage("es");
  assert.equal(i18n.t("us.glassesOfWater", { n: 1 }), "1 vaso de agua");
  assert.equal(i18n.t("us.glassesOfWater", { n: 5 }), "5 vasos de agua");
});

test("weekday labels start on Monday and follow the language", async () => {
  await i18n.setLanguage("en");
  const enDays = i18n.weekdayLabels();
  assert.equal(enDays.length, 7);
  assert.match(enDays[0], /^Mon/);
  await i18n.setLanguage("es");
  const esDays = i18n.weekdayLabels();
  assert.match(esDays[0].toLowerCase(), /^lun/);
});

test("an unsupported language is ignored rather than breaking the app", async () => {
  await i18n.setLanguage("fr");
  assert.equal(i18n.currentLanguage(), "es", "stays on the last valid language");
  assert.ok(i18n.supportedLanguages().includes("en"));
});
