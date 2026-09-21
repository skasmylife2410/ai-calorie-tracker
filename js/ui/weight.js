// weight.js — the Weight tab.
//
// Design notes, because weight UIs get this wrong constantly:
//  - The big number is the 7-day average, not this morning's reading. Day-to-day weight moves a
//    kilo on water and salt alone; showing the raw number invites reading noise as progress.
//  - One reading per day. Weighing twice and keeping both is noise, so a second entry replaces
//    the first.
//  - No praise or scolding attached to the direction of travel. It reports, it doesn't judge.

import * as store from "../store.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { t, formatNumber, formatDate } from "../i18n.js";

const RANGES = [30, 90, 365];
let range = 30;

const unit = () => store.weightUnit();
const toDisplay = (kg) => (unit() === "lb" ? store.kgToLb(kg) : kg);
const fromDisplay = (v) => (unit() === "lb" ? store.lbToKg(v) : Number(v));
const fmt1 = (n) => formatNumber(Math.round(Number(n) * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function render(container) {
  const series = store.weightSeries(range);
  const latest = store.latestWeight();
  const change = store.weightChange(range);
  const avg = series.length ? series[series.length - 1].avg : null;

  container.innerHTML = `
    <div class="wt-screen">
      <div class="wt-head">
        <h1 class="wt-title">${t("weight.title")}</h1>
        <div class="wt-unit" role="group">
          ${["kg", "lb"].map((u) => `<button type="button" data-unit="${u}" aria-pressed="${u === unit()}">${u}</button>`).join("")}
        </div>
      </div>

      <div class="wt-card wt-hero">
        ${avg === null
          ? `<div class="wt-empty">
               ${icon("chartBarFill", { size: 34 })}
               <div class="wt-empty-title">${t("weight.emptyTitle")}</div>
               <div class="wt-empty-body">${t("weight.emptyBody")}</div>
             </div>`
          : `<div class="wt-big">${fmt1(toDisplay(avg))}<span>${unit()}</span></div>
             <div class="wt-sub">${t("weight.avgLabel")}</div>
             ${latest ? `<div class="wt-latest">${t("weight.lastReading", { value: `${fmt1(toDisplay(latest.kg))} ${unit()}`, day: formatDate(latest.timestamp, { month: "short", day: "numeric" }) })}</div>` : ""}
             ${change ? `<div class="wt-delta ${change.delta > 0 ? "is-up" : change.delta < 0 ? "is-down" : ""}">
                ${change.delta > 0 ? "+" : ""}${fmt1(toDisplay(Math.abs(change.delta)) * (change.delta < 0 ? -1 : 1))} ${unit()} · ${t("weight.overDays", { n: change.days })}
             </div>` : ""}`}
        <button type="button" class="wt-add" id="wt-add">${t("weight.addToday")}</button>
      </div>

      <div class="wt-ranges">
        ${RANGES.map((r) => `<button type="button" data-range="${r}" aria-pressed="${r === range}">${t("weight.rangeDays", { n: r })}</button>`).join("")}
      </div>

      ${series.length >= 2 ? `<div class="wt-card">${chartSvg(series)}</div>` : ""}

      ${series.length > 0 ? `
        <div class="wt-list-head">${t("weight.history")}</div>
        <div class="wt-card wt-list">
          ${[...series].reverse().slice(0, 30).map((s) => `
            <div class="wt-row" data-day="${s.day}">
              <span class="wt-row-day">${formatDate(s.timestamp, { weekday: "short", month: "short", day: "numeric" })}</span>
              <span class="wt-row-kg">${fmt1(toDisplay(s.kg))} ${unit()}</span>
              <button type="button" class="wt-row-del" data-del="${s.day}" aria-label="${t("app.delete")}">${icon("trashFill", { size: 15 })}</button>
            </div>`).join("")}
        </div>` : ""}

      <div class="bottom-safe-spacer"></div>
    </div>`;

  container.querySelectorAll("[data-unit]").forEach((b) =>
    b.addEventListener("click", () => { store.setWeightUnit(b.dataset.unit); render(container); })
  );
  container.querySelectorAll("[data-range]").forEach((b) =>
    b.addEventListener("click", () => { range = Number(b.dataset.range); render(container); })
  );
  container.querySelector("#wt-add")?.addEventListener("click", () => openWeightSheet({ onSaved: () => render(container) }));
  container.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const entry = store.allWeightEntries().find((w) => w.day === b.dataset.del);
      if (entry) store.deleteWeightEntry(entry.id);
      render(container);
    })
  );
}

/** Line chart: faint raw readings, solid 7-day average on top. */
function chartSvg(series) {
  const W = 320, H = 150, PAD = 10;
  const values = series.flatMap((s) => [s.kg, s.avg]).filter((v) => typeof v === "number");
  const min = Math.min(...values) - 0.6;
  const max = Math.max(...values) + 0.6;
  const span = Math.max(0.8, max - min);

  const x = (i) => PAD + (i / Math.max(1, series.length - 1)) * (W - PAD * 2);
  const y = (v) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const path = (key) => series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(s[key]).toFixed(1)}`).join(" ");

  const first = series[0], last = series[series.length - 1];
  return `
    <svg class="wt-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t("weight.title")}">
      <path d="${path("kg")}" fill="none" stroke="var(--sc-secondary)" stroke-width="1.5" opacity=".35"/>
      <path d="${path("avg")}" fill="none" stroke="var(--sc-primary-text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${x(series.length - 1).toFixed(1)}" cy="${y(last.avg).toFixed(1)}" r="4" fill="var(--sc-primary-text)" stroke="#fff" stroke-width="2"/>
    </svg>
    <div class="wt-chart-foot">
      <span>${formatDate(first.timestamp, { month: "short", day: "numeric" })}</span>
      <span class="wt-chart-legend">${t("weight.legend")}</span>
      <span>${formatDate(last.timestamp, { month: "short", day: "numeric" })}</span>
    </div>`;
}

/** The entry sheet: one number, a date, done. */
export function openWeightSheet({ timestamp = Date.now(), onSaved } = {}) {
  openSheet({
    render(panel, close) {
      const existing = store.allWeightEntries().find((w) => w.day === new Date(timestamp).toISOString().slice(0, 10));
      const start = existing ? fmt1(toDisplay(existing.kg)) : "";

      panel.innerHTML = `
        ${navBar({ title: t("weight.addTitle"), leading: { label: t("app.cancel") } })}
        <div class="sheet-panel-body">
          <div class="wt-input-card">
            <input id="wt-value" class="wt-input" type="text" inputmode="decimal" value="${start}" placeholder="0.0" />
            <span class="wt-input-unit">${unit()}</span>
          </div>
          <div class="wt-hint">${t("weight.hint")}</div>
        </div>
        <div class="results-actions">
          <button class="btn-prominent" id="wt-save">${t("app.save")}</button>
        </div>`;

      const input = panel.querySelector("#wt-value");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);

      const save = () => {
        const value = Number(String(input.value).replace(",", "."));
        if (!Number.isFinite(value) || value <= 0) return;
        store.addWeightEntry({ kg: fromDisplay(value), timestamp });
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(15);
        onSaved?.();
        close();
      };

      panel.querySelector("#wt-save").addEventListener("click", save);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
      wireNavBar(panel, { onLeading: () => close() });
    },
  });
}
