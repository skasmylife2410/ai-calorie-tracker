// us.js — read-only "Us" dashboard (us.html). Each person keeps their own rings, doodle and
// exercise; nothing here writes. Uses the same passcode the main
// app stored on this device; never writes anything.

import { getStoredToken, setStoredToken } from "./net.js";
import { t, initI18n, formatNumber, formatDate, currentLanguage } from "./i18n.js";
import { doodleSvg } from "./ui/doodle.js";
import { localDateString, addDays, startOfDay } from "./nutrition.js";

const body = document.getElementById("tg-body");
const COLORS = [
  { solid: "var(--tg-a)", soft: "var(--tg-a-soft)" },
  { solid: "var(--tg-b)", soft: "var(--tg-b-soft)" },
];
let range = 7;
let data = null;

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Math.round(n).toLocaleString();
const titleCase = (s) => s.replace(/(^|[-_])([a-z])/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());
const pct = (v, goal) => (goal > 0 ? Math.max(0, Math.min(100, (v / goal) * 100)) : 0);
const EMPTY_DAY = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, meals: 0, water: 0, burned: 0, sessions: 0 };

function dayList(n) {
  const today = startOfDay(Date.now());
  return Array.from({ length: n }, (_, i) => addDays(today, -i)).map((ts) => ({ ts, key: localDateString(ts) }));
}

async function load() {
  const from = localDateString(addDays(startOfDay(Date.now()), -29));
  const res = await fetch("/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-snapcal-token": getStoredToken() },
    body: JSON.stringify({ from }),
  });
  if (res.status === 401) return { unauthorized: true };
  if (!res.ok) return { error: `The server answered ${res.status}. Pull down to refresh or try again in a minute.` };
  const json = await res.json();
  if (json.errorType === "unconfigured") return { error: "Cloud sync isn't set up, so there's nothing to compare yet." };
  if (json.errorType) return { error: json.message || "The dashboard couldn't load. Try again in a minute." };
  return json;
}

function showPin(wrong) {
  body.innerHTML = `
    <form class="tg-pin" id="tg-pin">
      <label for="tg-pin-input" class="tg-note">Enter your passcode to see the dashboard.</label>
      <input id="tg-pin-input" type="password" autocomplete="current-password" required />
      ${wrong ? `<div class="tg-error">That passcode didn't match. Check capital letters and try again.</div>` : ""}
      <button type="submit">Show dashboard</button>
    </form>`;
  const input = document.getElementById("tg-pin-input");
  input.focus();
  document.getElementById("tg-pin").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    setStoredToken(input.value.trim());
    start(true);
  });
}

function personHead(p, i) {
  const c = COLORS[i % COLORS.length];
  return `<span class="tg-dot" style="background:${c.solid}"></span>${escHtml(titleCase(p.owner))}${
    p.owner === data.me ? ` <span class="tg-you">(${t("us.you")})</span>` : ""
  }`;
}

function todayHtml(people) {
  const key = localDateString(Date.now());
  const cols = people.map((p, i) => {
    const c = COLORS[i % COLORS.length];
    const d = p.days[key] || EMPTY_DAY;
    const g = p.goals;
    const macro = (label, val, goal, color) => `
      <li class="tg-macro"><span>${label}</span><b>${fmt(val)}${goal ? ` / ${fmt(goal)}` : ""} g</b>
        <div class="tg-bar"><span style="width:${pct(val, goal)}%;background:${color}"></span></div></li>`;
    return `
      <div class="tg-person">
        <div class="tg-name">${personHead(p, i)}</div>
        <div class="tg-doodle">${doodleFor(p, i)}</div>
        <div class="tg-kcal">${fmt(d.calories)}</div>
        <div class="tg-of">${g ? `of ${fmt(g.calories)} kcal · ${fmt(Math.max(0, g.calories - d.calories))} left` : "kcal · no goal set yet"}</div>
        <div class="tg-bar" style="background:${c.soft}"><span style="width:${pct(d.calories, g?.calories)}%;background:${c.solid}"></span></div>
        <ul class="tg-macros">
          ${macro("Protein", d.proteinG, g?.proteinG, "var(--sc-protein)")}
          ${macro("Carbs", d.carbsG, g?.carbsG, "var(--sc-carbs)")}
          ${macro("Fat", d.fatG, g?.fatG, "var(--sc-fat)")}
        </ul>
        <div class="tg-extra">${t("us.mealsCount", { n: d.meals })}${d.sessions ? ` · ${t("us.sessionsCount", { n: d.sessions })}` : ` · ${t("us.noExercise")}`}<br>${t("us.glassesOfWater", { n: d.water })}</div>
      </div>`;
  });
  return `<section class="tg-section"><h2 class="tg-h2">${t("us.today")}</h2><div class="tg-today">${cols.join("")}</div></section>`;
}

function mirrorHtml(people, days) {
  const [a, b] = people;
  const vals = days.flatMap((d) => people.map((p) => (p.days[d.key] || EMPTY_DAY).calories));
  const goals = people.map((p) => p.goals?.calories || 0);
  const max = Math.max(1, ...vals, ...goals) * 1.08;

  const side = (p, i, key, dir) => {
    const c = COLORS[i % COLORS.length];
    const kcal = (p.days[key] || EMPTY_DAY).calories;
    const w = (kcal / max) * 100;
    const goal = p.goals?.calories;
    const over = goal && kcal > goal * 1.1;
    const pos = dir === "left" ? "right" : "left";
    const numPos = w > 45 ? `${pos}:6px;color:#fff` : `${pos}:calc(${w}% + 5px)`;
    return `<div class="tg-side ${dir}">
      <div class="fill" style="width:${w}%;background:${c.solid};opacity:${over ? 1 : 0.78}"></div>
      ${goal ? `<div class="goal" style="${pos}:calc(${(goal / max) * 100}% - 1px)"></div>` : ""}
      ${kcal > 0 ? `<span class="num" style="${numPos}">${fmt(kcal)}</span>` : ""}
    </div>`;
  };

  const rows = days.map(({ ts, key }) => {
    const dt = new Date(ts);
    const label = key === localDateString(Date.now())
      ? `<strong>Today</strong>`
      : `<strong>${dt.toLocaleDateString(undefined, { weekday: "short" })}</strong>${dt.getMonth() + 1}/${dt.getDate()}`;
    return `<div class="tg-row">${side(a, 0, key, "left")}<div class="tg-day">${label}</div>${b ? side(b, 1, key, "right") : "<div></div>"}</div>`;
  });

  return `<section class="tg-section">
    <h2 class="tg-h2">${t("us.caloriesByDay")}</h2>
    <div class="tg-mirror">
      <div class="tg-mirror-head"><span>${escHtml(titleCase(a.owner))}</span><span></span><span>${b ? escHtml(titleCase(b.owner)) : ""}</span></div>
      ${rows.join("")}
      <div class="tg-legend"><i></i> ${t("us.goalLine")}</div>
    </div>
  </section>`;
}

function summaryHtml(people, days) {
  const stats = people.map((p) => {
    const logged = days.map((d) => p.days[d.key]).filter((d) => d && d.meals > 0);
    const avg = (k) => (logged.length ? logged.reduce((s, d) => s + d[k], 0) / logged.length : 0);
    const goal = p.goals?.calories;
    const onTarget = goal ? logged.filter((d) => Math.abs(d.calories - goal) <= goal * 0.1).length : null;
    const water = days.map((d) => p.days[d.key]?.water || 0);
    const sessions = days.reduce((n, d) => n + (p.days[d.key]?.sessions || 0), 0);
    return {
      sessions,
      logged: logged.length,
      kcal: avg("calories"),
      protein: avg("proteinG"),
      onTarget,
      water: water.reduce((s, v) => s + v, 0) / days.length,
    };
  });
  const row = (label, fn) => `<tr><td>${label}</td>${stats.map((s) => `<td>${fn(s)}</td>`).join("")}</tr>`;
  return `<section class="tg-section">
    <h2 class="tg-h2">${t("us.lastNDays", { n: days.length })}</h2>
    <table class="tg-table">
      <thead><tr><th></th>${people.map((p, i) => `<th><span class="tg-name" style="justify-content:flex-end">${personHead(p, i)}</span></th>`).join("")}</tr></thead>
      <tbody>
        ${row(t("us.daysLogged"), (s) => `${s.logged} / ${days.length}`)}
        ${row(t("us.avgCalories"), (s) => (s.logged ? fmt(s.kcal) : "–"))}
        ${row(t("us.avgProtein"), (s) => (s.logged ? `${fmt(s.protein)} g` : "–"))}
        ${row(t("us.daysNearGoal"), (s) => (s.onTarget === null ? "–" : `${s.onTarget}`))}
        ${row(t("us.exercise"), (s) => (s.sessions ? t("us.sessionsCount", { n: s.sessions }) : "–"))}
        ${row(t("us.waterPerDay"), (s) => s.water.toFixed(1))}
      </tbody>
    </table>
    <p class="tg-note">${t("us.nearGoalNote")}</p>
  </section>`;
}

function doodleFor(person, i) {
  // Same rules as the app: over the goal today = well fed, nothing logged = idle, else strong.
  const key = localDateString(Date.now());
  const d = person.days[key] || EMPTY_DAY;
  const goal = person.goals?.calories;
  const logged = Object.values(person.days).some((x) => x.meals > 0);
  const state = !logged ? "idle" : goal && d.calories > goal ? "wellFed" : "strong";
  const streak = Object.keys(person.days).length;
  return doodleSvg({ state, streak, variant: i === 0 ? "a" : "b", size: 64 });
}

function render() {
  const people = data.people || [];
  if (people.length === 0) {
    body.innerHTML = `<p class="tg-note">No one is set up yet. Add people to APP_USERS in Vercel.</p>`;
    return;
  }
  const days = dayList(range);
  body.innerHTML = todayHtml(people) + mirrorHtml(people, days) + summaryHtml(people, days) +
    (people.length === 1 ? `<p class="tg-note">Only one person is set up. Add a second name and passcode to APP_USERS in Vercel to compare.</p>` : "");
}

async function start(afterPin = false) {
  body.innerHTML = `<p class="tg-note">Loading…</p>`;
  let result;
  try {
    result = await load();
  } catch {
    body.innerHTML = `<p class="tg-note">No connection. Check your internet and reload the page.</p>`;
    return;
  }
  if (result.unauthorized) return showPin(afterPin);
  if (result.error) {
    body.innerHTML = `<p class="tg-note">${escHtml(result.error)}</p>`;
    return;
  }
  data = result;
  render();
}

document.querySelectorAll("[data-range]").forEach((btn) => {
  btn.addEventListener("click", () => {
    range = Number(btn.dataset.range);
    document.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    if (data) render();
  });
});

(async () => {
  await initI18n();
  document.title = `${t("us.title")} · SnapCal`;
  document.getElementById("tg-title").textContent = t("us.title");
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  start();
})();
