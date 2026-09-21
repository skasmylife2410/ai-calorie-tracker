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

      <div class="wt-hero-v2">
        ${avg === null
          ? `<div class="wt-empty">
               ${icon("chartBarFill", { size: 34 })}
               <div class="wt-empty-title">${t("weight.emptyTitle")}</div>
               <div class="wt-empty-body">${t("weight.emptyBody")}</div>
             </div>`
          : `<div class="wt-big">${fmt1(toDisplay(avg))}<span>${unit()}</span></div>
             <div class="wt-sub">${t("weight.avgLabel")}</div>
             ${latest ? `<div class="wt-latest">${t("weight.lastReading", { value: `${fmt1(toDisplay(latest.kg))} ${unit()}`, day: formatDate(latest.timestamp, { month: "short", day: "numeric" }) })}</div>` : ""}
             ${goalHtml(avg)}`}
        <button type="button" class="wt-add" id="wt-add">${t("weight.addToday")}</button>
      </div>

      ${avg !== null ? statsHtml(series, change) : ""}

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
  container.querySelector("#wt-goal")?.addEventListener("click", () => openGoalSheet({ onSaved: () => render(container) }));
  container.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const entry = store.allWeightEntries().find((w) => w.day === b.dataset.del);
      if (entry) store.deleteWeightEntry(entry.id);
      render(container);
    })
  );
}

/**
 * Area chart: a violet wash under the 7-day average, faint raw readings behind it, light
 * horizontal gridlines with labels, and the goal as a dashed line when one is set.
 */
function chartSvg(series) {
  const W = 320, H = 170, L = 34, R = 8, T = 10, B = 8;
  const goalKg = Number(store.getProfile().goalWeightKg) || null;
  const values = series.flatMap((s) => [s.kg, s.avg]).filter((v) => typeof v === "number");
  if (goalKg) values.push(goalKg);
  let min = Math.min(...values) - 0.8;
  let max = Math.max(...values) + 0.8;
  const span = Math.max(1.2, max - min);

  const x = (i) => L + (i / Math.max(1, series.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / span) * (H - T - B);
  const line = (key) => series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(s[key]).toFixed(1)}`).join(" ");
  const area = `${line("avg")} L${x(series.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;

  // three gridlines at round numbers in the display unit
  const ticks = [0.2, 0.5, 0.8].map((f) => min + span * f);
  const grid = ticks.map((v) => `
    <line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--sc-secondary)" stroke-width="1" opacity=".12"/>
    <text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="wt-tick">${fmt1(toDisplay(v))}</text>`).join("");

  const last = series[series.length - 1];
  const first = series[0];
  return `
    <svg class="wt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("weight.title")}">
      <defs>
        <linearGradient id="wt-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--sc-accent-weight)" stop-opacity=".28"/>
          <stop offset="1" stop-color="var(--sc-accent-weight)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      ${goalKg ? `<line x1="${L}" x2="${W - R}" y1="${y(goalKg).toFixed(1)}" y2="${y(goalKg).toFixed(1)}" stroke="#2AA66B" stroke-width="1.5" stroke-dasharray="4 4"/>
                  <text x="${W - R}" y="${(y(goalKg) - 5).toFixed(1)}" text-anchor="end" class="wt-tick wt-goal-tick">${t("weight2.goal")}</text>` : ""}
      <path d="${area}" fill="url(#wt-fill)"/>
      <path d="${line("kg")}" fill="none" stroke="var(--sc-accent-weight)" stroke-width="1.2" opacity=".35"/>
      <path d="${line("avg")}" fill="none" stroke="var(--sc-accent-weight)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${x(series.length - 1).toFixed(1)}" cy="${y(last.avg).toFixed(1)}" r="5" fill="var(--sc-accent-weight)" stroke="#fff" stroke-width="2.5"/>
    </svg>
    <div class="wt-chart-foot">
      <span>${formatDate(first.timestamp, { month: "short", day: "numeric" })}</span>
      <span class="wt-chart-legend">${t("weight.legend")}</span>
      <span>${formatDate(last.timestamp, { month: "short", day: "numeric" })}</span>
    </div>`;
}

/** Progress bar from the first reading toward the goal, or a prompt to set one. */
function goalHtml(avg) {
  const goalKg = Number(store.getProfile().goalWeightKg) || null;
  if (!goalKg) {
    return `<button type="button" class="wt-goal-set" id="wt-goal">＋ ${t("weight2.setGoal")}</button>`;
  }
  const all = store.weightSeries(3650);
  const startKg = all.length ? all[0].avg : avg;
  const total = Math.abs(goalKg - startKg);
  const done = Math.abs(avg - startKg);
  const towards = Math.sign(goalKg - startKg) === Math.sign(avg - startKg) || avg === startKg;
  const pct = total > 0 && towards ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
  const remaining = Math.abs(goalKg - avg);
  const reached = remaining < 0.15 || (goalKg < startKg ? avg <= goalKg : avg >= goalKg);

  return `
    <button type="button" class="wt-goal-card" id="wt-goal">
      <div class="wt-goal-top">
        <span>${t("weight2.startedAt", { value: `${fmt1(toDisplay(startKg))}` })}</span>
        <b>${t("weight2.goal")} ${fmt1(toDisplay(goalKg))} ${unit()}</b>
      </div>
      <div class="wt-goal-bar"><span style="width:${reached ? 100 : pct}%"></span></div>
      <div class="wt-goal-foot">${reached ? t("weight2.reached") : t("weight2.toGo", { value: `${fmt1(toDisplay(remaining))} ${unit()}` })}</div>
    </button>`;
}

/** Three small tiles: change over the window, weekly rate, and number of readings. */
function statsHtml(series, change) {
  const perWeek = change && change.days >= 6 ? (change.delta / change.days) * 7 : null;
  const signed = (kg) => `${kg > 0 ? "+" : kg < 0 ? "−" : ""}${fmt1(toDisplay(Math.abs(kg)))}`;
  const lowest = Math.min(...series.map((s) => s.kg));
  return `
    <div class="wt-stats">
      <div class="wt-stat">
        <div class="wt-stat-label">${t("weight2.change")}</div>
        <div class="wt-stat-value">${change ? signed(change.delta) : "–"}<small>${unit()}</small></div>
      </div>
      <div class="wt-stat">
        <div class="wt-stat-label">${t("weight2.perWeek")}</div>
        <div class="wt-stat-value">${perWeek === null ? "–" : signed(Math.round(perWeek * 10) / 10)}<small>${unit()}</small></div>
      </div>
      <div class="wt-stat">
        <div class="wt-stat-label">${t("weight2.lowest")}</div>
        <div class="wt-stat-value">${fmt1(toDisplay(lowest))}<small>${unit()}</small></div>
      </div>
    </div>`;
}

/** Goal weight, entered in the display unit and stored in kg. */
function openGoalSheet({ onSaved } = {}) {
  openSheet({
    render(panel, close) {
      const current = Number(store.getProfile().goalWeightKg) || null;
      panel.innerHTML = `
        ${navBar({ title: t("weight2.goalTitle"), leading: { label: t("app.cancel") } })}
        <div class="sheet-panel-body">
          <div class="wt-input-card">
            <input id="wt-goal-value" class="wt-input" type="text" inputmode="decimal" value="${current ? fmt1(toDisplay(current)) : ""}" placeholder="0.0" />
            <span class="wt-input-unit">${unit()}</span>
          </div>
          <div class="wt-hint">${t("weight2.goalHint")}</div>
        </div>
        <div class="results-actions"><button class="btn-prominent" id="wt-goal-save">${t("app.save")}</button></div>`;
      const input = panel.querySelector("#wt-goal-value");
      input.focus();
      const save = () => {
        const raw = String(input.value).trim().replace(",", ".");
        const v = Number(raw);
        store.setProfile({ goalWeightKg: raw === "" || !Number.isFinite(v) || v <= 0 ? null : Math.round(fromDisplay(v) * 10) / 10 });
        onSaved?.();
        close();
      };
      panel.querySelector("#wt-goal-save").addEventListener("click", save);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
      wireNavBar(panel, { onLeading: () => close() });
    },
  });
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
