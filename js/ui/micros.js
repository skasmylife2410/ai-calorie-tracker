// micros.js — shared pieces for fiber / sugars / saturated fat / sodium / potassium:
// the Today "Nutrients" page, and the editable fields used by Edit Meal and Add Food.
// Values are numbers or null; null means unknown and is shown as "—", never as 0.

import { t, formatNumber } from "../i18n.js";
import { MICRO_KEYS, cleanMicros } from "../nutrition.js";

/** Order on screen. Sugars shows total sugar; its bar tracks ADDED sugar against the limit. */
const ROWS = [
  { key: "sodiumMg", targetKey: "sodiumMg" },
  { key: "sugarG", targetKey: "addedSugarG" },
  { key: "satFatG", targetKey: "satFatG" },
  { key: "fiberG", targetKey: "fiberG" },
  { key: "potassiumMg", targetKey: "potassiumMg" },
];

export const unitOf = (key) => (key.endsWith("Mg") ? "mg" : "g");

/** "820 mg", "4.5 g", or "—" when unknown. */
export function formatMicro(key, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const v = Number(value);
  const shown = key.endsWith("Mg") ? Math.round(v) : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${formatNumber(shown)} ${unitOf(key)}`;
}

/** One-line summary for a meal item: "Sodium 820 mg · Sugars 12 g · Fiber 4 g". */
export function microsSummary(micros) {
  const m = cleanMicros(micros);
  if (!m) return t("nutrients.noneShort");
  return ["sodiumMg", "sugarG", "fiberG"]
    .map((k) => `${t(`nutrients.${k}`)} ${formatMicro(k, m[k])}`)
    .join(" · ");
}

/**
 * The Today swipe page. `day` is store.microsForDay(): {totals, meals, missing, targets}.
 */
export function nutrientsPageHtml(day) {
  const totals = day?.totals ?? null;
  const targets = day?.targets ?? {};
  const rows = ROWS.map(({ key, targetKey }) => {
    const target = targets[targetKey];
    const value = totals?.[key] ?? null;
    const tracked = totals?.[targetKey] ?? null; // for sugar: the added part
    const ratio = target && tracked !== null ? tracked / target.value : null;
    let state = "";
    if (ratio !== null && target.kind === "limit") state = ratio > 1 ? " is-over" : ratio >= 0.8 ? " is-near" : "";
    if (ratio !== null && target.kind === "goal") state = ratio >= 1 ? " is-met" : " is-goal";
    const fill = ratio === null ? 0 : Math.min(1, ratio) * 100;
    const targetLine = target
      ? t(target.kind === "limit" ? "nutrients.limit" : "nutrients.goal", { value: formatMicro(targetKey, target.value) })
      : "";
    const sub = key === "sugarG"
      ? `${t("nutrients.addedPart", { value: formatMicro("addedSugarG", totals?.addedSugarG ?? null) })} · ${targetLine}`
      : targetLine;
    return `
      <div class="nutr-row${state}">
        <div class="nutr-head">
          <span class="nutr-name">${t(`nutrients.${key}`)}</span>
          <span class="nutr-value">${formatMicro(key, value)}</span>
        </div>
        <div class="nutr-bar" role="presentation"><i style="width:${fill.toFixed(1)}%"></i></div>
        <div class="nutr-sub">${sub}</div>
      </div>`;
  }).join("");

  let foot = "";
  if (!day || day.meals === 0) foot = t("nutrients.empty");
  else if (day.missing > 0) foot = t("nutrients.partial", { n: day.missing });
  return `
    <div class="nutr-page">
      <div class="nutr-card card">
        <div class="nutr-title">${t("nutrients.title")}</div>
        ${rows}
        ${foot ? `<div class="nutr-foot">${foot}</div>` : ""}
      </div>
    </div>`;
}

/**
 * The slim card on Home, right under protein / carbs / fat: five numbers with a thin bar each,
 * so the nutrients are visible without swiping. Sodium, added sugar and saturated fat are limits
 * (a tick marks the limit; past it the bar turns red and says "over"); fiber and potassium are
 * goals that fill up. Tapping it opens the full nutrients page.
 */
const STRIP = ["sodiumMg", "addedSugarG", "satFatG", "fiberG", "potassiumMg"];
const LIMIT_AT = 80; // the limit tick sits at 80% of the bar so going over has room to show
export function nutrientsStripHtml(day) {
  const totals = day?.totals ?? null;
  const targets = day?.targets ?? {};
  const shortNum = (key, v) => formatMicro(key, v).replace(/\s*(mg|g)$/, "");
  const items = STRIP.map((key) => {
    const target = targets[key];
    const value = totals?.[key] ?? null;
    const known = value !== null && value !== undefined && Number.isFinite(Number(value));
    const limit = target?.kind === "limit";
    const ratio = known && target ? Number(value) / target.value : 0;
    const over = limit && ratio > 1;
    const fill = limit ? Math.min(100, ratio * LIMIT_AT) : Math.min(100, ratio * 100);
    const sub = over ? t("nutrients.over") : target ? `${limit ? "≤" : "/"}${shortNum(key, target.value)}` : "";
    return `
      <div class="ns-item${over ? " is-over" : ""}${limit ? " is-limit" : " is-goal"}" title="${t(`nutrients.${key}`)}">
        <span class="ns-name">${t(`nutrients.short.${key}`)}</span>
        <span class="ns-value"><b>${known ? shortNum(key, value) : "—"}</b> <span class="ns-unit">${unitOf(key)}</span></span>
        <span class="ns-bar">${limit ? `<i class="ns-tick" style="left:${LIMIT_AT}%"></i>` : ""}<i class="ns-fill" style="width:${fill.toFixed(1)}%"></i></span>
        <span class="ns-sub">${sub}</span>
      </div>`;
  }).join("");
  return `
    <button type="button" class="nutr-strip card" id="nutr-strip" aria-label="${t("nutrients.stripOpen")}">
      <span class="ns-head"><span class="ns-title">${t("nutrients.title")}</span><span class="ns-hint">${t("nutrients.stripHint")} ›</span></span>
      <span class="ns-grid">${items}</span>
    </button>`;
}

/**
 * Editable fields for all six values. Blank = unknown. Inputs carry data-micro="<key>".
 * Used by Add Food (whole entry) and Edit Meal (per item).
 */
export function microInputsHtml(micros) {
  const m = cleanMicros(micros) ?? {};
  return `
    <div class="micro-grid">
      ${MICRO_KEYS.map((k) => `
        <label class="micro-field">
          <span class="micro-label">${t(`nutrients.${k}`)}</span>
          <span class="micro-input-wrap">
            <input type="text" inputmode="decimal" class="micro-input" data-micro="${k}"
                   value="${m[k] === null || m[k] === undefined ? "" : formatPlain(k, m[k])}" placeholder="—" />
            <span class="micro-unit">${unitOf(k)}</span>
          </span>
        </label>`).join("")}
    </div>`;
}

function formatPlain(key, v) {
  return String(key.endsWith("Mg") ? Math.round(v) : Math.round(v * 10) / 10);
}

/** Parses "1,5" / "1.5" / "" -> number or null. */
export function parseMicroInput(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined; // undefined = mid-edit garbage, ignore
}

/**
 * Wires every [data-micro] input inside `root`. onChange(key, valueOrNull) fires on each valid
 * edit; blur rewrites the box from getValue so leftovers like "1." are tidied up.
 */
export function wireMicroInputs(root, { getValue, onChange }) {
  root.querySelectorAll("[data-micro]").forEach((input) => {
    const key = input.dataset.micro;
    input.addEventListener("input", () => {
      const v = parseMicroInput(input.value);
      if (v === undefined) return;
      onChange(key, v);
    });
    input.addEventListener("blur", () => {
      const v = getValue(key);
      input.value = v === null || v === undefined ? "" : formatPlain(key, v);
    });
  });
}

/** Refreshes the boxes (skipping the focused one) after a rescale. */
export function refreshMicroInputs(root, micros) {
  const m = cleanMicros(micros) ?? {};
  root.querySelectorAll("[data-micro]").forEach((input) => {
    if (typeof document !== "undefined" && document.activeElement === input) return;
    const v = m[input.dataset.micro];
    input.value = v === null || v === undefined ? "" : formatPlain(input.dataset.micro, v);
  });
}
