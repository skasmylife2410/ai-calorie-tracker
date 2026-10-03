// weight.js — the Progress tab (it began as the Weight tab, and weight still lives here).
//
// Every habit the app tracks, over time: marker tiles against the stretch before, one timeline
// with the weight line, milestone pins and a lane per habit, plain-language insights, and the
// wins it spots on its own (js/progress.js does the measuring).
//
// Design notes, because weight UIs get this wrong constantly:
//  - The big number is the 7-day average, not this morning's reading. Day-to-day weight moves a
//    kilo on water and salt alone; showing the raw number invites reading noise as progress.
//  - One reading per day. Weighing twice and keeping both is noise, so a second entry replaces
//    the first.
//  - No praise or scolding attached to the direction of travel. It reports, it doesn't judge.

import * as store from "../store.js";
import { missedYouHtml } from "./missed-you.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { t, formatNumber, formatDate } from "../i18n.js";
import { buildDays, summarize, insights, milestones, weightDirection } from "../progress.js";
import { localDateString } from "../nutrition.js";

const RANGES = [30, 90, 365];
let range = 30;

const unit = () => store.weightUnit();
const toDisplay = (kg) => (unit() === "lb" ? store.kgToLb(kg) : kg);
const fromDisplay = (v) => (unit() === "lb" ? store.lbToKg(v) : Number(v));
const fmt1 = (n) => formatNumber(Math.round(Number(n) * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

let selectedDay = null;   // "YYYY-MM-DD" picked on the timeline
let showAllWins = false;

/** Everything the tab measures, for this range and the same length of time before it. */
function collect() {
  const profile = store.getProfile();
  const goals = store.computeGoals();
  const data = {
    foods: store.allFoodEntries(),
    exercise: store.allExerciseEntries(),
    water: store.allWaterEntries(),
    weights: store.allWeightEntries(),
  };
  const both = buildDays({
    ...data,
    days: range * 2,
    calorieTarget: (ts) => store.dayEnergy(new Date(ts)).adjustedTarget,
    proteinTarget: goals.proteinTargetG,
  });
  const days = both.slice(range);
  const cur = summarize(days);
  const prev = summarize(both.slice(0, range));
  const goal = profile.goal ?? "maintain";
  const goalKg = Number(profile.goalWeightKg) || null;
  const wins = milestones({ ...data, goal, goalKg, proteinTarget: goals.proteinTargetG });
  const findings = insights({ cur, prev, goal, days: range, weekendGap: store.weekendGap() });
  return { days, cur, prev, goal, goalKg, wins, findings, goals };
}

export function render(container) {
  const p = collect();
  const avg = p.cur.weightEnd ?? store.weightSeries(3650).slice(-1)[0]?.avg ?? null;
  const latest = store.latestWeight();
  const series = store.weightSeries(range);

  container.innerHTML = `
    <div class="wt-screen pg">
      <div class="wt-head">
        <h1 class="wt-title">${t("prog.title")}</h1>
        <div class="wt-unit" role="group">
          ${["kg", "lb"].map((u) => `<button type="button" data-unit="${u}" aria-pressed="${u === unit()}">${u}</button>`).join("")}
        </div>
      </div>
      ${missedYouHtml()}
      <div class="wt-ranges pg-ranges">
        ${RANGES.map((r) => `<button type="button" data-range="${r}" aria-pressed="${r === range}">${t("weight.rangeDays", { n: r })}</button>`).join("")}
      </div>

      <div class="pg-tiles">${tilesHtml(p)}</div>
      <div class="pg-note">${t("prog.compareNote", { n: range })}</div>

      <div class="pg-h">${t("prog.timeline")}</div>
      <div class="wt-card pg-timeline" id="pg-timeline">${timelineHtml(p)}</div>

      <div class="pg-h">${t("prog.insightsTitle")}</div>
      <div class="wt-card pg-insights">${insightsHtml(p)}</div>

      <div class="pg-h">${t("prog.winsTitle")}</div>
      <div class="wt-card pg-wins" id="pg-wins">${winsHtml(p)}</div>

      <div class="pg-h">${t("weight.title")}</div>
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

      ${maintenanceHtml()}

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
    b.addEventListener("click", () => { range = Number(b.dataset.range); selectedDay = null; render(container); })
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
  wireTimeline(container, p);
  const toggleWins = () => {
    showAllWins = !showAllWins;
    container.querySelector("#pg-wins").innerHTML = winsHtml(p);
    container.querySelector("#pg-wins-more")?.addEventListener("click", toggleWins);
  };
  container.querySelector("#pg-wins-more")?.addEventListener("click", toggleWins);
}

// ---------------------------------------------------------------------------------------------
// Marker tiles: this range against the same length of time before it
// ---------------------------------------------------------------------------------------------

/** "▲ 3" / "▼ 1.2" chip, green when the change is good for this person, red when it isn't. */
function deltaChip(diff, goodWhenUp = true, { decimals = 0, tone = null } = {}) {
  if (diff === null || diff === undefined || !Number.isFinite(diff)) return `<span class="pg-delta">${t("prog.noCompare")}</span>`;
  const r = decimals ? Math.round(diff * 10 ** decimals) / 10 ** decimals : Math.round(diff);
  if (r === 0) return `<span class="pg-delta">${t("prog.same")}</span>`;
  const good = tone ?? ((r > 0) === goodWhenUp ? "good" : "bad");
  const shown = decimals ? formatNumber(Math.abs(r), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : formatNumber(Math.abs(r));
  return `<span class="pg-delta is-${good}">${r > 0 ? "▲" : "▼"} ${shown}</span>`;
}

function tile({ key, label, value, sub, chip, color }) {
  return `
    <div class="pg-tile" style="--pg-c:${color}" data-tile="${key}">
      <div class="pg-tile-label">${label}</div>
      <div class="pg-tile-value">${value}</div>
      <div class="pg-tile-sub">${sub}</div>
      ${chip}
    </div>`;
}

function tilesHtml(p) {
  const { cur, prev, goal } = p;
  const had = prev.daysLogged >= 3; // too little before to compare with
  const weightTone = cur.weightDelta === null ? null : ({ 1: "good", "-1": "bad", 0: "neutral" })[weightDirection(cur.weightDelta, goal)];
  const hours = Math.floor(cur.minutes / 60), mins = cur.minutes % 60;
  return [
    tile({
      key: "weight", color: "var(--sc-accent-weight)", label: t("prog.tWeight"),
      value: cur.weightEnd === null ? "–" : `${fmt1(toDisplay(cur.weightEnd))}<small>${unit()}</small>`,
      sub: t("prog.tWeightSub"),
      chip: cur.weightDelta === null ? `<span class="pg-delta">${t("prog.noCompare")}</span>` : deltaChip(toDisplay(Math.abs(cur.weightDelta)) * Math.sign(cur.weightDelta), true, { decimals: 1, tone: weightTone }),
    }),
    tile({
      key: "target", color: "var(--sc-accent-calories, #F08A24)", label: t("prog.tTarget"),
      value: `${cur.onTarget}<small>/${cur.daysLogged}</small>`,
      sub: t("prog.tTargetSub"),
      chip: had ? deltaChip(cur.onTarget - prev.onTarget) : deltaChip(null),
    }),
    tile({
      key: "protein", color: "var(--sc-protein)", label: t("prog.tProtein"),
      value: `${cur.proteinHit}<small>${t("prog.days")}</small>`,
      sub: cur.avgProtein === null ? "–" : t("prog.tProteinSub", { g: formatNumber(Math.round(cur.avgProtein)) }),
      chip: had ? deltaChip(cur.proteinHit - prev.proteinHit) : deltaChip(null),
    }),
    tile({
      key: "logged", color: "var(--mk-violet, #6E5BD6)", label: t("prog.tLogged"),
      value: `${cur.daysLogged}<small>/${cur.total}</small>`,
      sub: t("prog.tLoggedSub", { n: store.streak() }),
      chip: had ? deltaChip(cur.daysLogged - prev.daysLogged) : deltaChip(null),
    }),
    tile({
      key: "workouts", color: "var(--mk-green, #1F9E75)", label: t("prog.tWorkouts"),
      value: `${cur.workouts}`,
      sub: cur.minutes ? t("prog.tWorkoutsSub", { time: hours ? `${hours} h ${mins} min` : `${mins} min`, kcal: formatNumber(cur.burned) }) : t("prog.tWorkoutsNone"),
      chip: had || prev.workouts ? deltaChip(cur.workouts - prev.workouts) : deltaChip(null),
    }),
    tile({
      key: "water", color: "var(--sc-water)", label: t("prog.tWater"),
      value: cur.avgWater === null ? "–" : `${fmt1(cur.avgWater)}<small>${t("prog.glasses")}</small>`,
      sub: t("prog.tWaterSub", { n: cur.waterHit }),
      chip: cur.avgWater !== null && prev.avgWater !== null ? deltaChip(cur.avgWater - prev.avgWater, true, { decimals: 1 }) : deltaChip(null),
    }),
  ].join("");
}

// ---------------------------------------------------------------------------------------------
// Timeline: the weight line with milestone pins, and a lane per habit, one column per day
// ---------------------------------------------------------------------------------------------

const TL = { W: 340, L: 62, R: 8, top: 14, chartH: 96, lane: 11, laneGap: 5 };
const LANES = ["calories", "protein", "workout", "water"];
const CAL_COLORS = { on: "var(--mk-on, #2AA66B)", over: "var(--mk-over, #F08A24)", under: "var(--mk-under, #8FB8F0)" };
const WIN_COLORS = { streak: "var(--mk-violet, #6E5BD6)", meals: "var(--mk-over, #F08A24)", workouts: "var(--mk-green, #1F9E75)", proteinWeek: "var(--sc-protein, #E85D5D)", weightStep: "var(--sc-accent-weight)", halfway: "var(--sc-accent-weight)", goal: "var(--mk-on, #2AA66B)" };

function timelineHtml(p) {
  const { days, goalKg, wins } = p;
  const n = days.length;
  const cw = (TL.W - TL.L - TL.R) / n;
  const x = (i) => TL.L + (i + 0.5) * cw;
  const lanesTop = TL.top + TL.chartH + 14;
  const H = lanesTop + LANES.length * (TL.lane + TL.laneGap) + 16;

  // weight scale from what's in range (plus the goal when it's close enough to matter)
  const weighed = days.map((d, i) => ({ i, v: d.weightAvg, raw: d.weightKg })).filter((d) => d.v !== null);
  const vals = weighed.flatMap((d) => [d.v, d.raw]);
  if (goalKg && vals.length && Math.abs(goalKg - vals[vals.length - 1]) < 6) vals.push(goalKg);
  const min = vals.length ? Math.min(...vals) - 0.5 : 0;
  const max = vals.length ? Math.max(...vals) + 0.5 : 1;
  const y = (v) => TL.top + (1 - (v - min) / Math.max(1, max - min)) * TL.chartH;

  const weekend = days.map((d, i) => (d.weekend ? `<rect class="pg-wk" x="${(TL.L + i * cw).toFixed(2)}" y="${TL.top - 6}" width="${cw.toFixed(2)}" height="${H - TL.top - 10}"/>` : "")).join("");
  const line = weighed.map((d, k) => `${k ? "L" : "M"}${x(d.i).toFixed(1)} ${y(d.v).toFixed(1)}`).join(" ");
  const rawDots = n <= 90 ? weighed.map((d) => `<circle cx="${x(d.i).toFixed(1)}" cy="${y(d.raw).toFixed(1)}" r="1.6" class="pg-raw"/>`).join("") : "";

  const byKey = new Map(days.map((d, i) => [d.key, i]));
  const pins = wins.map((w) => ({ ...w, i: byKey.get(localDateString(w.ts)) })).filter((w) => w.i !== undefined);
  const pinsSvg = pins.map((w) => {
    const d = days[w.i];
    const onLine = (w.kind === "weightStep" || w.kind === "halfway" || w.kind === "goal") && d.weightAvg !== null;
    const cy = onLine ? y(d.weightAvg) : TL.top - 2;
    return `<g class="pg-pin"><circle cx="${x(w.i).toFixed(1)}" cy="${cy.toFixed(1)}" r="${onLine ? 4.5 : 3.5}" fill="${WIN_COLORS[w.kind] ?? "#888"}" stroke="var(--sc-card-bg, #fff)" stroke-width="1.5"/></g>`;
  }).join("");

  const lane = (li, name) => {
    const ly = lanesTop + li * (TL.lane + TL.laneGap);
    const cells = days.map((d, i) => {
      let fill = null, op = 1;
      if (name === "calories" && d.calStatus) fill = CAL_COLORS[d.calStatus];
      if (name === "protein" && d.proteinHit) fill = "var(--sc-protein)";
      if (name === "workout" && d.workouts) fill = "var(--mk-green, #1F9E75)";
      if (name === "water" && d.water) { fill = "var(--sc-water)"; op = d.waterHit ? 1 : 0.35; }
      const gap = cw > 4 ? 1 : 0;
      const today = name === "calories" && i === n - 1 ? ` class="pg-cell-today"` : "";
      return fill ? `<rect${today} x="${(TL.L + i * cw + gap / 2).toFixed(2)}" y="${ly}" width="${Math.max(0.6, cw - gap).toFixed(2)}" height="${TL.lane}" rx="${cw > 4 ? 2 : 0}" fill="${fill}" opacity="${op}"/>` : "";
    }).join("");
    return `<text x="${TL.L - 6}" y="${ly + TL.lane - 2}" text-anchor="end" class="pg-lane-label">${t(`prog.lane.${name}`)}</text>
      <rect x="${TL.L}" y="${ly}" width="${TL.W - TL.L - TL.R}" height="${TL.lane}" rx="2" class="pg-lane-bg"/>${cells}`;
  };

  const sel = selectedDay ? days.findIndex((d) => d.key === selectedDay) : -1;
  const goalLine = goalKg && vals.length && goalKg >= min && goalKg <= max
    ? `<line x1="${TL.L}" x2="${TL.W - TL.R}" y1="${y(goalKg).toFixed(1)}" y2="${y(goalKg).toFixed(1)}" class="pg-goal"/><text x="${TL.W - TL.R}" y="${(y(goalKg) - 4).toFixed(1)}" text-anchor="end" class="pg-tick pg-goal-tick">${t("weight2.goal")}</text>`
    : "";
  const ticks = vals.length ? [0.15, 0.5, 0.85].map((f) => min + (max - min) * (1 - f)).map((v) => `<text x="${TL.L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="pg-tick">${fmt1(toDisplay(v))}</text>`).join("") : "";

  return `
    <svg class="pg-svg" viewBox="0 0 ${TL.W} ${H}" data-n="${n}" role="img" aria-label="${t("prog.timeline")}">
      ${weekend}
      ${ticks}
      ${goalLine}
      ${weighed.length >= 2
        ? `<path d="${line}" fill="none" stroke="var(--sc-accent-weight)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>${rawDots}`
        : `<text x="${(TL.L + TL.W - TL.R) / 2}" y="${TL.top + TL.chartH / 2}" text-anchor="middle" class="pg-empty">${t("prog.noWeight")}</text>`}
      ${pinsSvg}
      ${LANES.map((name, li) => lane(li, name)).join("")}
      ${sel >= 0 ? `<rect x="${(TL.L + sel * cw).toFixed(2)}" y="${TL.top - 6}" width="${Math.max(2, cw).toFixed(2)}" height="${H - TL.top - 10}" class="pg-sel"/>` : ""}
      <text x="${TL.L}" y="${H - 2}" class="pg-tick">${formatDate(days[0].ts, { month: "short", day: "numeric" })}</text>
      <text x="${TL.W - TL.R}" y="${H - 2}" text-anchor="end" class="pg-tick">${t("us.today")}</text>
    </svg>
    <div class="pg-legend">
      <span><i style="background:${CAL_COLORS.on}"></i>${t("prog.leg.on")}</span>
      <span><i style="background:${CAL_COLORS.over}"></i>${t("prog.leg.over")}</span>
      <span><i style="background:${CAL_COLORS.under}"></i>${t("prog.leg.under")}</span>
      <span><i class="pg-leg-wk"></i>${t("us.weekend")}</span>
      <span><i class="pg-leg-pin"></i>${t("prog.leg.win")}</span>
    </div>
    <div class="pg-day" id="pg-day">${sel >= 0 ? dayHtml(days[sel], wins) : `<span class="pg-hint">${t("prog.tapDay")}</span>`}</div>`;
}

function dayHtml(d, wins) {
  const parts = [];
  if (d.logged) parts.push(`<b>${formatNumber(d.calories)}</b> / ${formatNumber(d.target)} kcal ${d.calStatus ? `<span class="pg-st is-${d.calStatus}">${t(`prog.leg.${d.calStatus}`)}</span>` : ""}`);
  else parts.push(t("prog.dayNothing"));
  if (d.logged) parts.push(t("prog.dayProtein", { g: formatNumber(d.proteinG) }) + (d.proteinHit ? " ✓" : ""));
  if (d.workouts) parts.push(t("prog.dayWorkout", { n: d.workouts, min: d.minutes }));
  if (d.water) parts.push(t("prog.dayWater", { n: d.water }));
  if (d.weightKg !== null) parts.push(`${fmt1(toDisplay(d.weightKg))} ${unit()}`);
  const dayWins = wins.filter((w) => localDateString(w.ts) === d.key).map((w) => `<div class="pg-day-win">★ ${winText(w)}</div>`).join("");
  return `
    <div class="pg-day-head">${formatDate(d.ts, { weekday: "long", month: "long", day: "numeric" })}${d.weekend ? ` <span class="us-wk-chip">${t("us.weekend")}</span>` : ""}</div>
    <div class="pg-day-facts">${parts.map((x) => `<span>${x}</span>`).join("")}</div>${dayWins}`;
}

/** Tap or drag across the timeline to pick a day. */
function wireTimeline(container, p) {
  const host = container.querySelector("#pg-timeline");
  if (!host) return;
  const n = p.days.length;
  const pick = (clientX, svg) => {
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * TL.W;
    if (sx < TL.L - 4) return;
    const i = Math.max(0, Math.min(n - 1, Math.floor(((sx - TL.L) / (TL.W - TL.L - TL.R)) * n)));
    if (p.days[i].key === selectedDay) return;
    selectedDay = p.days[i].key;
    host.innerHTML = timelineHtml(p);
    wireTimeline(container, p);
  };
  const svg = host.querySelector(".pg-svg");
  let down = false;
  svg.addEventListener("pointerdown", (e) => { down = true; pick(e.clientX, svg); });
  svg.addEventListener("pointermove", (e) => { if (down) pick(e.clientX, host.querySelector(".pg-svg")); });
  window.addEventListener("pointerup", () => { down = false; }, { once: true });
}

// ---------------------------------------------------------------------------------------------
// Insights and wins
// ---------------------------------------------------------------------------------------------

function insightsHtml(p) {
  if (p.findings.length === 0) return `<div class="pg-hint">${t("prog.in.none")}</div>`;
  return p.findings.map((f) => {
    const vars = { ...f.vars };
    if (vars.kg !== undefined) vars.kg = `${fmt1(toDisplay(vars.kg))} ${unit()}`;
    if (vars.perWeek !== undefined) vars.perWeek = `${fmt1(toDisplay(vars.perWeek))} ${unit()}`;
    return `<div class="pg-insight is-${f.tone}"><span class="pg-dot"></span><span>${t(f.key, vars)}</span></div>`;
  }).join("");
}

function winText(w) {
  const vars = { ...w.vars };
  if (vars.kg !== undefined) vars.kg = `${unit() === "lb" ? formatNumber(Math.round(toDisplay(vars.kg))) : formatNumber(vars.kg)} ${unit()}`;
  return t(`prog.ms.${w.kind}`, vars);
}

function winsHtml(p) {
  if (p.wins.length === 0) return `<div class="pg-hint">${t("prog.noWins")}</div>`;
  const shown = showAllWins ? p.wins : p.wins.slice(0, 6);
  return `
    <ul class="pg-win-list">
      ${shown.map((w) => `
        <li><span class="pg-win-dot" style="background:${WIN_COLORS[w.kind] ?? "#888"}"></span>
          <span class="pg-win-text">${winText(w)}</span>
          <span class="pg-win-date">${formatDate(w.ts, { month: "short", day: "numeric" })}</span></li>`).join("")}
    </ul>
    ${p.wins.length > 6 ? `<button type="button" class="feed-more" id="pg-wins-more">${showAllWins ? t("prog.fewer") : t("prog.allWins", { n: p.wins.length })}</button>` : ""}`;
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


/** "Your real maintenance": what the data says you burn, next to what the formula guessed. */
function maintenanceHtml() {
  const m = store.learnedMaintenanceNow();
  const goals = store.computeGoals();
  const using = goals.tdeeSource === "learned";
  if (!m || m.loggedDays < 7) {
    const days = m?.loggedDays ?? countLoggedDays();
    const weighIns = m?.weighIns ?? store.weightSeries(28).length;
    return `
      <div class="wt-card mt-card">
        <div class="mt-title">${t("accuracy.cardTitle")}</div>
        <div class="mt-sub">${t("accuracy.cardBuilding")}</div>
        <div class="mt-progress"><span style="width:${Math.min(100, (Math.min(days, 14) / 14) * 50 + (Math.min(weighIns, 8) / 8) * 50)}%"></span></div>
        <div class="mt-foot">${t("accuracy.cardProgress", { days: Math.min(days, 14), weighIns: Math.min(weighIns, 8) })}</div>
      </div>`;
  }
  return `
    <div class="wt-card mt-card">
      <div class="mt-row">
        <div class="mt-title">${t("accuracy.cardTitle")}</div>
        <span class="mt-conf mt-${m.confidence}">${t(`accuracy.conf.${m.confidence}`)}</span>
      </div>
      <div class="mt-big">${formatNumber(m.tdee)}<small> kcal</small></div>
      <div class="mt-sub">${t("accuracy.cardFormula", { n: formatNumber(m.formulaTdee) })} · ${using ? t("accuracy.cardUsing") : t("accuracy.cardNotYet")}</div>
      <div class="mt-how">${t("accuracy.cardHow", { days: m.loggedDays, intake: formatNumber(m.avgIntake), rate: fmt1(m.kgPerWeek) })}</div>
      ${m.skippedDays > 0 ? `<div class="mt-how">${t("accuracy.cardSkipped", { n: m.skippedDays })}</div>` : ""}
    </div>`;
}

function countLoggedDays() {
  const cutoff = Date.now() - 28 * 86400000;
  return new Set(store.allFoodEntries().filter((e) => e.timestamp >= cutoff && !e.isPending).map((e) => new Date(e.timestamp).toDateString())).size;
}
