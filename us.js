// us.js — read-only "Us" dashboard (us.html). Each person keeps their own rings, doodle and
// exercise; nothing here writes. Uses the same passcode the main
// app stored on this device; never writes anything.

import { getStoredToken, setStoredToken } from "./net.js";
import { t, initI18n, formatNumber, formatDate, currentLanguage } from "./i18n.js";
import { doodleSvg } from "./ui/doodle.js";
import { localDateString, addDays, startOfDay } from "./nutrition.js";

// The element the dashboard draws into: #tg-body on the standalone us.html page, or the tab's
// container when mounted inside the app.
let body = typeof document !== "undefined" ? document.getElementById("tg-body") : null;
const COLORS = [
  { solid: "var(--tg-a)", soft: "var(--tg-a-soft)" },
  { solid: "var(--tg-b)", soft: "var(--tg-b-soft)" },
  { solid: "var(--tg-c)", soft: "var(--tg-c-soft)" },
  { solid: "var(--tg-d)", soft: "var(--tg-d-soft)" },
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

function avatarHtml(p, i, size = 40) {
  const c = COLORS[i % COLORS.length];
  const mine = p.owner === data.me;
  const inner = p.avatar
    ? `<img src="${p.avatar}" alt="" />`
    : `<span>${escHtml(titleCase(p.owner).slice(0, 1))}</span>`;
  return `
    <button type="button" class="us-avatar${mine ? " is-mine" : ""}" ${mine ? 'data-edit-avatar="1"' : "disabled"}
            style="--av:${c.solid};--av-soft:${c.soft};width:${size}px;height:${size}px" aria-label="${escHtml(titleCase(p.owner))}">
      ${inner}
      ${mine ? `<i class="us-avatar-edit">+</i>` : ""}
    </button>`;
}

function todayHtml(people) {
  const key = localDateString(Date.now());

  // One row per person rather than side-by-side cards: cards worked for two and broke at three,
  // and the row puts the three numbers that matter (eaten, goal, protein) on one line.
  const rows = people.map((p, i) => {
    const c = COLORS[i % COLORS.length];
    const d = p.days[key] || EMPTY_DAY;
    const goal = p.goals?.calories;
    const pGoal = p.goals?.proteinG;
    const ratio = goal > 0 ? Math.max(0, Math.min(1.15, d.calories / goal)) : 0;
    const over = goal && d.calories > goal;
    const left = goal ? Math.max(0, Math.round(goal - d.calories)) : null;

    return `
      <div class="us-row">
        <div class="us-row-top">
          ${avatarHtml(p, i)}
          <span class="us-name">${escHtml(titleCase(p.owner))}</span>
          ${p.owner === data.me ? `<span class="tg-you">${t("us.you")}</span>` : ""}
          <span class="us-spacer"></span>
          <span class="us-eaten">${fmt(d.calories)}</span>
          ${goal ? `<span class="us-goal">/ ${fmt(goal)}</span>` : ""}
        </div>
        <div class="us-bar" style="background:${c.soft}">
          <span style="width:${ratio * 100}%;background:${c.solid}"></span>
        </div>
        <div class="us-row-foot">
          <span>${pGoal ? `${fmt(d.proteinG)} / ${fmt(pGoal)} g` : `${fmt(d.proteinG)} g`}</span>
          <span class="us-extra">${t("us.mealsCount", { n: d.meals })}${d.sessions ? ` · ${t("us.sessionsCount", { n: d.sessions })}` : ""} · ${t("us.glassesOfWater", { n: d.water })}</span>
          ${left !== null ? `<span class="us-left" style="color:${over ? "var(--tg-over)" : c.solid}">${over ? `+${fmt(d.calories - goal)}` : `${fmt(left)} left`}</span>` : ""}
        </div>
      </div>`;
  });

  return `<section class="tg-section">
    <h2 class="tg-h2">${t("us.today")}</h2>
    <div class="us-card">${rows.join("")}</div>
  </section>`;
}

/**
 * One sparkline per person instead of a grid of bars: seven days times three people was 21 bars
 * to compare by eye. The dashed line is that person's goal, the dot is today.
 */
function trendHtml(people, days) {
  const ordered = [...days].reverse(); // oldest -> newest, so the line reads left to right
  const W = 180, H = 44;

  const rows = people.map((p, i) => {
    const c = COLORS[i % COLORS.length];
    const values = ordered.map((d) => (p.days[d.key] || EMPTY_DAY).calories);
    const goal = p.goals?.calories || 0;
    const max = Math.max(1, ...values, goal) * 1.12;
    const logged = values.filter((v) => v > 0);
    const avg = logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : 0;

    const pts = values.map((v, idx) => ({
      x: (idx / Math.max(1, values.length - 1)) * W,
      y: H - (v / max) * H,
    }));
    const path = pts.map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    const goalY = goal ? H - (goal / max) * H : null;

    return `
      <div class="us-trend">
        <div class="us-trend-label">
          <div class="us-trend-name"><span class="tg-dot" style="background:${c.solid}"></span>${escHtml(titleCase(p.owner))}</div>
          <div class="us-trend-avg">${t("us.avgCalories")} ${fmt(avg)}</div>
        </div>
        <svg class="us-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${goalY !== null ? `<line x1="0" y1="${goalY.toFixed(1)}" x2="${W}" y2="${goalY.toFixed(1)}" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity=".45"/>` : ""}
          <path d="${path}" fill="none" stroke="${c.solid}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5" fill="${c.solid}" stroke="#fff" stroke-width="2"/>
        </svg>
      </div>`;
  });

  return `<section class="tg-section">
    <h2 class="tg-h2">${t("us.caloriesByDay")}</h2>
    <div class="us-card">${rows.join("")}</div>
    <p class="tg-note">${t("us.goalLine")}</p>
  </section>`;
}

function groupedHtml(people, days) {
  const vals = days.flatMap((d) => people.map((p) => (p.days[d.key] || EMPTY_DAY).calories));
  const goals = people.map((p) => p.goals?.calories || 0);
  const max = Math.max(1, ...vals, ...goals) * 1.08;

  const rows = days.map(({ ts, key }) => {
    const dt = new Date(ts);
    const label = key === localDateString(Date.now())
      ? t("us.today")
      : `${formatDate(ts, { weekday: "short" })} ${dt.getMonth() + 1}/${dt.getDate()}`;

    const bars = people.map((p, i) => {
      const c = COLORS[i % COLORS.length];
      const kcal = (p.days[key] || EMPTY_DAY).calories;
      const w = (kcal / max) * 100;
      const goal = p.goals?.calories;
      return `
        <div class="tg-gbar">
          <div class="tg-gtrack" style="background:${c.soft}">
            <div class="tg-gfill" style="width:${w}%;background:${c.solid}"></div>
            ${goal ? `<div class="tg-ggoal" style="left:calc(${(goal / max) * 100}% - 1px)"></div>` : ""}
          </div>
          <span class="tg-gnum">${kcal > 0 ? fmt(kcal) : "–"}</span>
        </div>`;
    }).join("");

    return `<div class="tg-grow"><div class="tg-gday">${escHtml(label)}</div><div class="tg-gbars">${bars}</div></div>`;
  });

  return `<section class="tg-section">
    <h2 class="tg-h2">${t("us.caloriesByDay")}</h2>
    <div class="tg-mirror">
      <div class="tg-glegend">${people.map((p, i) => `<span><i style="background:${COLORS[i % COLORS.length].solid}"></i>${escHtml(titleCase(p.owner))}</span>`).join("")}</div>
      ${rows.join("")}
      <div class="tg-legend"><i></i> ${t("us.goalLine")}</div>
    </div>
  </section>`;
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
      <thead><tr><th></th>${people.map((p, i) => {
        const c = COLORS[i % COLORS.length];
        return `<th><span class="tg-th-name"><i style="background:${c.solid}"></i>${escHtml(titleCase(p.owner))}</span></th>`;
      }).join("")}</tr></thead>
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

function wireAvatar() {
  body.querySelectorAll("[data-edit-avatar]").forEach((btn) => {
    btn.addEventListener("click", () => pickAvatar());
  });
}

/** Choose a photo, crop it square, shrink it to 192px JPEG, save it on the profile. */
function pickAvatar() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await squareThumb(file, 192);
      const store = await import("./store.js");
      store.setProfile({ avatar: dataUrl }); // syncs to the other phones with the profile
      const sync = await import("./sync.js");
      await sync.syncNow?.();
      data = null;
      start();
    } catch (err) {
      console.warn("avatar upload failed", err);
    }
  });
  input.click();
}

function squareThumb(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function render() {
  const people = data.people || [];
  if (people.length === 0) {
    body.innerHTML = `<p class="tg-note">No one is set up yet. Add people to APP_USERS in Vercel.</p>`;
    return;
  }
  // The layout is designed for up to about 5 people; beyond that the bars get unreadable.
  if (people.length > 5) people.length = 5;
  const days = dayList(range);
  // Two people still get the mirror chart — it reads beautifully head to head. Three or more
  // get sparklines, which stay legible however many rows there are.
  const chart = people.length > 2 ? trendHtml(people, days) : mirrorHtml(people, days);
  body.innerHTML = todayHtml(people) + chart + summaryHtml(people, days) +
    (people.length === 1 ? `<p class="tg-note">Only one person is set up. Add a second name and passcode to APP_USERS in Vercel to compare.</p>` : "");
  wireAvatar();
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

function wireRange(root) {
  root.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      range = Number(btn.dataset.range);
      root.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      if (data) render();
    });
  });
}

/**
 * Mounts the dashboard as a tab inside the app. The app has already signed in and loaded the
 * language bundles, so this only draws the header and fetches the numbers.
 */
export function renderUsTab(container) {
  container.innerHTML = `
    <div class="us-tab">
      <div class="us-tab-head">
        <h1 class="tg-title">${t("us.title")}</h1>
        <div class="tg-range" role="group">
          <button type="button" data-range="7" aria-pressed="${range === 7}">${t("us.days7")}</button>
          <button type="button" data-range="30" aria-pressed="${range === 30}">${t("us.days30")}</button>
        </div>
      </div>
      <div id="us-tab-body" aria-live="polite"><p class="tg-note">…</p></div>
      <div class="bottom-safe-spacer"></div>
    </div>`;
  body = container.querySelector("#us-tab-body");
  wireRange(container);
  start();
}

// Standalone page (us.html) — only when that page's markup is present.
if (typeof document !== "undefined" && document.getElementById("tg-body")) {
  wireRange(document);
  (async () => {
    await initI18n();
    document.title = `${t("us.title")} · SnapCal`;
    document.getElementById("tg-title").textContent = t("us.title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    start();
  })();
}
