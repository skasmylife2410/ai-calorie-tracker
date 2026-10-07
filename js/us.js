// us.js — read-only "Us" dashboard (us.html). Each person keeps their own rings, doodle and
// exercise; nothing here writes. Uses the same passcode the main
// app stored on this device; never writes anything.

import { safeSrc } from "./safe-src.js";
import { getStoredToken, setStoredToken } from "./net.js";
import { t, initI18n, formatNumber, formatDate, currentLanguage } from "./i18n.js";
import { doodleSvg } from "./ui/doodle.js";
import { openNoteSheet } from "./ui/us-social.js";
import { renderRecap } from "./ui/us-recap.js";
import { renderPushCard } from "./ui/push-ui.js";
import { localDateString, addDays, startOfDay, daysForAverage, streakFromDays } from "./nutrition.js";
import { icon } from "./ui/icons.js";
import { cleanGif, gifImgHtml } from "./gif.js";
import { searchGifs } from "./social.js";
import { sfx } from "./sounds.js";
import * as store from "./store.js";

// The element the dashboard draws into: #tg-body on the standalone us.html page, or the tab's
// container when mounted inside the app.
let body = typeof document !== "undefined" ? document.getElementById("tg-body") : null;
export const COLORS = [
  { solid: "var(--tg-a)", soft: "var(--tg-a-soft)" },
  { solid: "var(--tg-b)", soft: "var(--tg-b-soft)" },
  { solid: "var(--tg-c)", soft: "var(--tg-c-soft)" },
  { solid: "var(--tg-d)", soft: "var(--tg-d-soft)" },
  { solid: "var(--tg-e)", soft: "var(--tg-e-soft)" },
  { solid: "var(--tg-f)", soft: "var(--tg-f-soft)" },
  { solid: "var(--tg-g)", soft: "var(--tg-g-soft)" },
  { solid: "var(--tg-h)", soft: "var(--tg-h-soft)" },
  { solid: "var(--tg-i)", soft: "var(--tg-i-soft)" },
  { solid: "var(--tg-j)", soft: "var(--tg-j-soft)" },
  { solid: "var(--tg-k)", soft: "var(--tg-k-soft)" },
  { solid: "var(--tg-l)", soft: "var(--tg-l-soft)" },
];
let range = 7;
let data = null;
let groupId = null; // which group the dashboard is showing; null = the server picks your first
let selectedDay = null; // "YYYY-MM-DD" opened in the calories-by-day chart, or null

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
    body: JSON.stringify({ from, ...(groupId ? { group: groupId } : {}) }),
  });
  if (res.status === 401) return { unauthorized: true };
  if (!res.ok) {
    console.warn(`us.js: /api/compare answered ${res.status}`); // the status is for us, not for people
    return { error: t("us.loadFailed") };
  }
  const json = await res.json();
  if (json.errorType === "unconfigured") return { error: t("us.unconfigured") };
  if (json.errorType) return { error: json.message || t("us.loadFailed") };
  return json;
}

function showPin(wrong) {
  body.innerHTML = `
    <form class="tg-pin" id="tg-pin">
      <label for="tg-pin-input" class="tg-note">${t("ui.pinPrompt")}</label>
      <input id="tg-pin-input" type="password" autocomplete="current-password" required />
      ${wrong ? `<div class="tg-error">${t("ui.pinWrong")}</div>` : ""}
      <button type="submit">${t("ui.showDash")}</button>
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
  return `<span class="tg-dot" style="background:${c.solid}"></span>${escHtml(p.name || titleCase(p.owner))}${
    p.owner === data.me ? ` <span class="tg-you">(${t("us.you")})</span>` : ""
  }`;
}

function avatarHtml(p, i, size = 40) {
  const c = COLORS[i % COLORS.length];
  const mine = p.owner === data.me;
  const inner = p.avatar
    ? `<img src="${safeSrc(p.avatar)}" alt="" />`
    : `<span>${escHtml(titleCase(p.owner).slice(0, 1))}</span>`;
  return `
    <button type="button" class="us-avatar${mine ? " is-mine" : ""}" ${mine ? 'data-edit-avatar="1"' : "disabled"}
            style="--av:${c.solid};--av-soft:${c.soft};width:${size}px;height:${size}px" aria-label="${escHtml(p.name || titleCase(p.owner))}">
      ${inner}
      ${mine ? `<i class="us-avatar-edit">+</i>` : ""}
    </button>`;
}

/**
 * Today's calories as one bar with the goal drawn inside it. The goal line sits at GOAL_AT% of
 * the track so there is room past it: what's eaten up to the goal is the person's fill (ink in
 * Mono), split by thin gaps into morning, afternoon and evening; anything past the goal carries
 * on in striped red. The label says "N left" or "+N over" in words, so colour is never the only
 * cue, and moves inside the fill (reversed) when the empty track is too short for it.
 */
const GOAL_AT = 80;
export function kcalBarHtml(d, baseGoal, c = COLORS[0]) {
  const style = `--pc:${c.solid};--pc-soft:${c.soft}`;
  if (!(baseGoal > 0)) return `<div class="us-kbar" style="${style}"></div>`;
  // Exercise raises the day's budget: the goal mark moves out by that much, and the stretch it
  // added shows as a hatched band ending at the mark, so the boost is visible at a glance.
  const credit = Math.max(0, Math.round(d.credit || 0));
  const goal = baseGoal + credit;
  const eaten = Math.max(0, d.calories || 0);
  const scale = (v) => (v / goal) * GOAL_AT;
  let parts = ["morning", "afternoon", "evening"].map((k) => Math.max(0, d[k] || 0));
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum <= 0) parts = [eaten];
  else if (sum < eaten) parts[parts.length - 1] += eaten - sum; // older rows without the split
  const within = Math.min(eaten, goal);
  let used = 0;
  const segs = [];
  for (const [n, v] of parts.entries()) {
    const take = Math.min(v, within - used);
    if (take <= 0) continue;
    const w = scale(take);
    if (w > 0.4) segs.push(`<span class="us-kseg" style="left:${scale(used).toFixed(2)}%;width:${w.toFixed(2)}%" title="${t(`partOfDay.${["morning", "afternoon", "evening"][n] ?? "morning"}`)}: ${fmt(v)}"></span>`);
    used += take;
  }
  const overKcal = Math.round(eaten - goal);
  const fillEnd = scale(within);
  let over = "";
  let label;
  if (overKcal > 0) {
    const overW = Math.min(100 - GOAL_AT, scale(overKcal));
    over = `<span class="us-kseg is-over" style="left:${GOAL_AT}%;width:${overW.toFixed(2)}%"></span>`;
    const text = t("us.kcalOver", { n: `<b>${fmt(overKcal)}</b>` });
    label = 100 - GOAL_AT - overW >= 18
      ? `<span class="us-klabel" style="left:${(GOAL_AT + overW + 1.5).toFixed(2)}%">${text}</span>`
      : `<span class="us-klabel is-rev" style="right:${100 - GOAL_AT + 2}%">${text}</span>`;
  } else {
    const text = t("us.kcalLeft", { n: `<b>${fmt(goal - eaten)}</b>` });
    label = GOAL_AT - fillEnd >= 24
      ? `<span class="us-klabel" style="left:${(fillEnd + 2).toFixed(2)}%">${text}</span>`
      : `<span class="us-klabel is-rev" style="right:${(100 - fillEnd + 2).toFixed(2)}%">${text}</span>`;
  }
  const boost = credit > 0
    ? `<span class="us-kboost" style="left:${scale(baseGoal).toFixed(2)}%;width:${(GOAL_AT - scale(baseGoal)).toFixed(2)}%" title="${t("us.boostTitle", { n: fmt(credit) })}"></span>`
    : "";
  return `<div class="us-kbar" style="${style}" role="img" aria-label="${fmt(eaten)} / ${fmt(goal)} kcal${credit > 0 ? ` (${t("us.boostTitle", { n: fmt(credit) })})` : ""}">${boost}${segs.join("")}${over}<i class="us-kgoal" style="left:${GOAL_AT}%"></i>${label}</div>`;
}

/**
 * How each person's day is going, the same idea as Home's mood (js/mood.js):
 *   over  — past today's budget: their row melts down.
 *   dusty — no meal for two days or more: their row gathers cobwebs.
 *   low   — evening, and they've logged only 30% or less of the budget: a "seriously?" GIF badge.
 */
const LOW_SHARE = 0.3;
const LOW_AFTER_HOUR = 18;
export function rowMood(p, now = Date.now()) {
  const today = startOfDay(now);
  let since = null; // days since their last meal (0 = today), within the 30 days we load
  for (let i = 0; i < 30; i++) {
    if ((p.days?.[localDateString(addDays(today, -i))]?.meals || 0) > 0) { since = i; break; }
  }
  if (since === null) return null; // nothing logged in the month we load: no cobwebs for people who never started
  if (since >= 2) return { kind: "dusty", days: since };
  const d = p.days?.[localDateString(today)] || EMPTY_DAY;
  const goal = (p.goals?.calories || 0) + Math.max(0, d.credit || 0);
  if (!(goal > 0)) return null;
  if (Math.round(d.calories - goal) > 0) return { kind: "over" };
  if (d.meals > 0 && new Date(now).getHours() >= LOW_AFTER_HOUR && d.calories <= goal * LOW_SHARE) {
    return { kind: "low", share: Math.round((d.calories / goal) * 100) };
  }
  return null;
}

/** One "are you serious?" GIF for every low badge, looked up once a day and remembered. */
const INCREDULOUS_KEY = "snapcal.incredulousGif";
async function incredulousGif() {
  const today = localDateString(Date.now());
  try {
    const saved = JSON.parse(localStorage.getItem(INCREDULOUS_KEY) || "null");
    if (saved?.day === today && cleanGif(saved.gif)) return saved.gif;
  } catch { /* look it up again */ }
  const out = await searchGifs("are you serious", "en").catch(() => null);
  const gifs = (out?.gifs ?? []).map(cleanGif).filter(Boolean);
  if (!gifs.length) return null;
  const gif = gifs[new Date().getDate() % Math.min(gifs.length, 5)]; // a different face now and then
  try { localStorage.setItem(INCREDULOUS_KEY, JSON.stringify({ day: today, gif })); } catch { /* fine */ }
  return gif;
}
function fillIncredulousBadges(root) {
  const badges = [...root.querySelectorAll("[data-incredulous]")];
  if (!badges.length) return;
  incredulousGif().then((gif) => {
    if (!gif) return;
    for (const b of badges) b.innerHTML = gifImgHtml(gif, { cls: "us-gif-badge-img", alt: "" });
  }).catch(() => {});
}

/** A sound for each kind of row on show, when the tab opens; the tab redraws on every change,
 *  so at most once every five minutes. */
let lastMoodSoundAt = 0;
function moodSounds(people) {
  if (Date.now() - lastMoodSoundAt < 5 * 60000) return;
  const kinds = new Set(people.map((p) => rowMood(p)?.kind).filter(Boolean));
  const order = [["over", "glitch"], ["dusty", "creak"], ["low", "huh"]].filter(([k]) => kinds.has(k));
  if (order.length) lastMoodSoundAt = Date.now();
  order.forEach(([, name], i) => setTimeout(() => sfx(name), 350 + i * 650));
}

function moodBitsHtml(mood) {
  if (mood?.kind === "dusty") {
    return `<i class="us-web us-web-a" aria-hidden="true"></i><i class="us-web us-web-b" aria-hidden="true"></i><i class="us-spider" aria-hidden="true"></i>`;
  }
  return "";
}

/** A person's streak: yours from this phone (exactly Home's), others' from the board's 30 days. */
export function personStreak(p, me, todayKey = localDateString(Date.now())) {
  if (p.owner === me) return { n: store.streak(), more: false };
  const logged = Object.entries(p.days ?? {}).filter(([, d]) => (d?.meals ?? 0) > 0 || (d?.calories ?? 0) > 0).map(([k]) => k);
  const n = streakFromDays(logged, p.frozenDays ?? [], todayKey);
  return { n, more: n >= 29 }; // the board only reaches 30 days back
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
    const mood = rowMood(p);

    return `
      <div class="us-row${mood ? ` mood-${mood.kind}` : ""}">
        ${moodBitsHtml(mood)}
        <div class="us-row-top">
          ${avatarHtml(p, i)}
          <span class="us-name">${escHtml(p.name || titleCase(p.owner))}</span>
          ${(() => { const s = personStreak(p, data.me); return s.n >= 2 ? `<span class="us-streak" title="${escHtml(t("streak.usTitle", { n: s.n }))}">${icon("flameFill", { size: 11, color: "var(--sc-streak-flame)" })}${s.n}${s.more ? "+" : ""}</span>` : ""; })()}
          ${mood?.kind === "low" ? `<span class="us-gif-badge" data-incredulous role="img" aria-label="${escHtml(t("us.lowTitle", { n: mood.share }))}" title="${escHtml(t("us.lowTitle", { n: mood.share }))}">?!</span>` : ""}
          ${p.owner === data.me ? `<span class="tg-you">${t("us.you")}</span>` : `<button type="button" class="us-note-btn" data-note-to="${escHtml(p.owner)}" aria-label="${t("social.writeNote")}">✉︎</button>`}
          <span class="us-spacer"></span>
          <span class="us-eaten">${fmt(d.calories)}</span>
          ${goal ? `<span class="us-goal">/ ${fmt(goal + (d.credit || 0))}</span>` : ""}
          ${goal && d.credit > 0 ? `<span class="us-boost" title="${t("us.boostTitle", { n: fmt(d.credit) })}">${icon("boltFill", { size: 11 })}+${fmt(d.credit)}</span>` : ""}
        </div>
        ${kcalBarHtml(d, goal, c)}
        <div class="us-row-foot">
          ${mood?.kind === "dusty" ? `<span class="us-dusty-note">${t("us.lastMealDays", { n: mood.days })}</span>` : ""}
          <span class="us-extra">${pGoal ? `${fmt(d.proteinG)} / ${fmt(pGoal)} g` : `${fmt(d.proteinG)} g`} · ${t("us.mealsCount", { n: d.meals })}${d.sessions ? ` · ${t("us.sessionsCount", { n: d.sessions })}` : ""} · ${t("us.glassesOfWater", { n: d.water })}</span>
        </div>
      </div>`;
  });

  return `<section class="tg-section">
    <h2 class="tg-h2">${t("us.today")}</h2>
    <div class="us-card">${rows.join("")}</div>
    <div class="us-legend">
      <span><i class="k-eaten"></i>${t("us.keyEaten")}</span>
      <span><i class="k-over"></i>${t("us.keyOver")}</span>
      <span><i class="k-goal"></i>${t("us.keyGoal")}</span>
      ${people.some((p) => (p.days[key] || EMPTY_DAY).credit > 0) ? `<span><i class="k-boost"></i>${t("us.keyBoost")}</span>` : ""}
    </div>
  </section>`;
}

/**
 * One sparkline per person instead of a grid of bars: seven days times three people was 21 bars
 * to compare by eye. The dashed line is that person's goal, the dot is today.
 */
const SPARK_W = 180, SPARK_H = 44;

const isWeekend = (ts) => [0, 6].includes(new Date(ts).getDay());
const dayLabel = (ts, key) => (key === localDateString(Date.now()) ? t("us.today") : formatDate(ts, { weekday: "short", month: "numeric", day: "numeric" }));

/**
 * One day, everyone in the group: calories against goal, macros, meals, exercise, water and when
 * the calories were eaten. Opened by tapping a day in either chart.
 */
function dayDetailHtml(people, key) {
  const ts = startOfDay(new Date(`${key}T12:00:00`).getTime());
  const rows = people.map((p, i) => {
    const c = COLORS[i % COLORS.length];
    const d = { ...EMPTY_DAY, ...(p.days[key] ?? {}) };
    const name = escHtml(p.name || titleCase(p.owner));
    if (!d.meals && !d.sessions && !d.water) {
      return `<div class="us-dd-person is-empty"><span class="tg-dot" style="background:${c.solid}"></span><b>${name}</b><span class="us-dd-muted">${t("us.noLog")}</span></div>`;
    }
    const goal = p.goals?.calories;
    const diff = goal ? Math.round(d.calories - goal) : null;
    const diffHtml = diff === null ? "" : `<span class="us-dd-diff ${Math.abs(diff) <= goal * 0.1 ? "is-near" : diff > 0 ? "is-over" : "is-under"}">${diff > 0 ? t("us.overGoal", { n: fmt(diff) }) : t("us.underGoal", { n: fmt(-diff) })}</span>`;
    const parts = ["morning", "afternoon", "evening"].map((k) => d[k] || 0);
    const total = parts.reduce((x, y) => x + y, 0);
    const split = total > 0
      ? `<div class="us-dd-split" style="--c:${c.solid}">${parts.map((v, n) => (v > 0 ? `<i class="seg-${n}" style="flex:${v}" title="${t(`us.part${n}`)} ${fmt(v)}"></i>` : "")).join("")}</div>
         <div class="us-dd-splitkey">${parts.map((v, n) => `<span>${t(`us.part${n}`)} ${v > 0 ? fmt(v) : "–"}</span>`).join("")}</div>`
      : "";
    return `
      <div class="us-dd-person">
        <div class="us-dd-top"><span class="tg-dot" style="background:${c.solid}"></span><b>${name}</b>
          <span class="us-dd-kcal">${fmt(d.calories)} kcal</span>${diffHtml}</div>
        <div class="us-dd-facts">
          <span>${t("us.macros", { p: fmt(d.proteinG), c: fmt(d.carbsG), f: fmt(d.fatG) })}</span>
          <span>${t("us.mealsCount", { n: d.meals })}</span>
          ${d.sessions ? `<span>${t("us.burned", { n: fmt(d.burned) })}</span>` : ""}
          ${d.water ? `<span>${t("us.glassesOfWater", { n: d.water })}</span>` : ""}
        </div>
        ${split}
      </div>`;
  }).join("");
  return `
    <div class="us-daydetail" id="us-daydetail">
      <div class="us-dd-head"><strong>${escHtml(formatDate(ts, { weekday: "long", month: "long", day: "numeric" }))}</strong>
        ${isWeekend(ts) ? `<span class="us-wk-chip">${t("us.weekend")}</span>` : ""}
        <button type="button" class="us-dd-close" data-close-day aria-label="${t("app.close")}">×</button></div>
      ${rows}
    </div>`;
}

function trendHtml(people, days) {
  const ordered = [...days].reverse(); // oldest -> newest, so the line reads left to right
  const W = SPARK_W, H = SPARK_H;
  const n = ordered.length;
  const xOf = (idx) => (idx / Math.max(1, n - 1)) * W;
  const step = W / Math.max(1, n - 1);
  const selIdx = ordered.findIndex((d) => d.key === selectedDay);
  // weekend bands: half a step either side of each Saturday/Sunday point, so Sat+Sun join up
  const bands = ordered.map((d, idx) => (isWeekend(d.ts)
    ? `<rect class="us-wk-band" x="${Math.max(0, xOf(idx) - step / 2).toFixed(1)}" y="0" width="${(Math.min(W, xOf(idx) + step / 2) - Math.max(0, xOf(idx) - step / 2)).toFixed(1)}" height="${H}"/>`
    : "")).join("");

  const rows = people.map((p, i) => {
    const c = COLORS[i % COLORS.length];
    const values = ordered.map((d) => (p.days[d.key] || EMPTY_DAY).calories);
    const goal = p.goals?.calories || 0;
    const max = Math.max(1, ...values, goal) * 1.12;
    // only full days count: today and half-logged days would pull the average down
    const counted = daysForAverage(ordered.map((d) => ({ key: d.key, ...(p.days[d.key] || EMPTY_DAY) })), { goal, todayKey: localDateString(Date.now()) }).days;
    const avg = counted.length ? Math.round(counted.reduce((a, d) => a + d.calories, 0) / counted.length) : 0;

    const pts = values.map((v, idx) => ({ x: xOf(idx), y: H - (v / max) * H }));
    // protein as dots, scaled so its target sits on the same dashed goal line (see proteinThread)
    const pGoal = p.goals?.proteinG || 0;
    const protDots = goal && pGoal ? ordered.map((d, idx) => {
      const g = (p.days[d.key] || EMPTY_DAY).proteinG;
      if (!(g > 0)) return "";
      const y = Math.max(1.5, H - Math.min(max, (g / pGoal) * goal) / max * H);
      return `<circle class="us-pdot${g >= pGoal ? " is-met" : ""}" cx="${xOf(idx).toFixed(1)}" cy="${y.toFixed(1)}" r="1.6"/>`;
    }).join("") : "";
    const path = pts.map((pt, idx) => `${idx === 0 ? "M" : "L"}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    const goalY = goal ? H - (goal / max) * H : null;
    const sel = selIdx >= 0 ? pts[selIdx] : null;

    return `
      <div class="us-trend">
        <div class="us-trend-label">
          <div class="us-trend-name"><span class="tg-dot" style="background:${c.solid}"></span>${escHtml(p.name || titleCase(p.owner))}</div>
          <div class="us-trend-avg">${sel ? (values[selIdx] > 0 ? `${fmt(values[selIdx])} kcal` : "–") : `${t("us.avgCalories")} ${fmt(avg)}`}</div>
        </div>
        <svg class="us-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-spark data-ys="${pts.map((pt) => pt.y.toFixed(1)).join(",")}" data-vals="${values.join(",")}" data-avg="${fmt(avg)}">
          ${bands}
          ${goalY !== null ? `<line x1="0" y1="${goalY.toFixed(1)}" x2="${W}" y2="${goalY.toFixed(1)}" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity=".45"/>` : ""}
          ${protDots}
          <path d="${path}" fill="none" stroke="${c.solid}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
          <line class="us-cursor" x1="${sel ? sel.x.toFixed(1) : -10}" x2="${sel ? sel.x.toFixed(1) : -10}" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>
          <circle class="us-cursor-dot" cx="${(sel ?? last).x.toFixed(1)}" cy="${(sel ?? last).y.toFixed(1)}" r="3.5" fill="${c.solid}" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>
        </svg>
      </div>`;
  });

  // day strip under the lines: tap a day, weekends shaded; lines up with the sparklines
  const every = n > 14 ? 7 : 1; // 30 days: label weekly, but every day is still tappable
  const strip = `
    <div class="us-axis">
      <div class="us-trend-label"></div>
      <div class="us-axis-days" style="--n:${n}"><div class="us-axis-grid">
        ${ordered.map((d, idx) => `<button type="button" class="us-axis-day${isWeekend(d.ts) ? " is-weekend" : ""}${d.key === selectedDay ? " is-selected" : ""}" data-day="${d.key}" aria-pressed="${d.key === selectedDay}" aria-label="${escHtml(dayLabel(d.ts, d.key))}">${(n - 1 - idx) % every === 0 ? escHtml(n > 14 ? `${new Date(d.ts).getMonth() + 1}/${new Date(d.ts).getDate()}` : formatDate(d.ts, { weekday: "narrow" })) : ""}</button>`).join("")}
      </div></div>
    </div>`;

  return `<section class="tg-section" id="us-chart">
    <h2 class="tg-h2">${t("us.caloriesByDay")}</h2>
    <div class="us-card">${rows.join("")}${strip}</div>
    ${selectedDay && selIdx >= 0 ? dayDetailHtml(people, selectedDay) : ""}
    <p class="tg-note"><span class="us-wk-key"></span> ${t("us.weekend")} · ${t("us.goalLine")} · <span class="pthread-key is-dots" aria-hidden="true"></span> ${t("us.proteinLine")} · ${t("us.tapDay")}</p>
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
            ${["morning", "afternoon", "evening"].map((part, n) => {
              const kcal = (p.days[key] ?? {})[part] ?? 0;
              const pw = (kcal / max) * 100;
              return pw > 0 ? `<div class="tg-gfill seg-${n}" style="width:${pw}%;background:${c.solid}"></div>` : "";
            }).join("")}
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
      <div class="tg-glegend">${people.map((p, i) => `<span><i style="background:${COLORS[i % COLORS.length].solid}"></i>${escHtml(p.name || titleCase(p.owner))}</span>`).join("")}</div>
      ${rows.join("")}
      <div class="tg-legend"><i></i> ${t("us.goalLine")}</div>
    </div>
  </section>`;
}

/**
 * Where a day's protein sits on the calorie chart: scaled so the protein target lands on the
 * calorie goal line. The dotted thread under a bar reaches that line on a day protein was hit
 * (and may run past it: more protein is fine). Returns { at: % of the track, met } or null.
 */
export function proteinThread(proteinG, proteinGoal, goalAt) {
  if (!(proteinGoal > 0) || !(goalAt > 0) || !(proteinG > 0)) return null;
  return { at: Math.min(100, (proteinG / proteinGoal) * goalAt), met: proteinG >= proteinGoal };
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
    const prot = proteinThread((p.days[key] || EMPTY_DAY).proteinG, p.goals?.proteinG, goal ? (goal / max) * 100 : null);
    return `<div class="tg-side ${dir}">
      <div class="fill" style="width:${w}%;background:${c.solid};opacity:${over ? 1 : 0.78}"></div>
      ${prot && kcal > 0 ? `<div class="pthread${prot.met ? " is-met" : ""}" style="width:${prot.at.toFixed(1)}%" title="${escHtml(t("us.proteinOf", { g: fmt((p.days[key] || EMPTY_DAY).proteinG), goal: fmt(p.goals.proteinG) }))}"></div>` : ""}
      ${goal ? `<div class="goal" style="${pos}:calc(${(goal / max) * 100}% - 1px)"></div>` : ""}
      ${kcal > 0 ? `<span class="num" style="${numPos}">${fmt(kcal)}</span>` : ""}
    </div>`;
  };

  const rows = days.map(({ ts, key }) => {
    const dt = new Date(ts);
    const weekend = isWeekend(ts);
    const selected = key === selectedDay;
    const label = key === localDateString(Date.now())
      ? `<strong>${t("us.today")}</strong>`
      : `<strong>${formatDate(dt, { weekday: "short" })}</strong>${formatDate(dt, { month: "numeric", day: "numeric" })}`;
    // Sunday closes a week (the list runs newest first), so a line above it separates weeks
    const weekBreak = dt.getDay() === 0 && key !== days[0].key ? " is-week-start" : "";
    const row = `<div class="tg-row${weekend ? " is-weekend" : ""}${selected ? " is-selected" : ""}${weekBreak}" role="button" tabindex="0" data-day="${key}" aria-pressed="${selected}" aria-label="${escHtml(dayLabel(ts, key))}">${side(a, 0, key, "left")}<div class="tg-day">${label}</div>${b ? side(b, 1, key, "right") : "<div></div>"}</div>`;
    return selected ? row + dayDetailHtml(people, key) : row;
  });

  return `<section class="tg-section" id="us-chart">
    <h2 class="tg-h2">${t("us.caloriesByDay")}</h2>
    <div class="tg-mirror">
      <div class="tg-mirror-head"><span>${escHtml(a.name || titleCase(a.owner))}</span><span></span><span>${b ? escHtml(b.name || titleCase(b.owner)) : ""}</span></div>
      ${rows.join("")}
      <div class="tg-legend"><i></i> ${t("us.goalLine")} <span class="us-wk-key"></span> ${t("us.weekend")}</div>
      <div class="tg-legend"><span class="pthread-key" aria-hidden="true"></span> ${t("us.proteinLine")}</div>
    </div>
    <p class="tg-note">${t("us.tapDay")}</p>
  </section>`;
}

/**
 * Last N days as one small bar chart per person (it was a table of averages). Each day is a thin
 * ink bar up to the goal, with anything over the goal stacked on top in red; a day within 10% of
 * the goal gets a ring, a day with nothing logged is a dashed empty slot (so a gap never looks
 * like a light day), and the dashed line is the goal. The averages sit on one line underneath.
 */
const WEEK_H = 64;
export function weekChartHtml(p, i, days) {
  const c = COLORS[i % COLORS.length];
  const ordered = [...days].reverse(); // oldest -> newest, left to right
  const goal = p.goals?.calories || 0;
  const logged = days.map((d) => p.days[d.key]).filter((d) => d && d.meals > 0);
  // averages use full days only: today isn't over, and a day with just breakfast logged
  // would make it look like they barely ate (see nutrition.daysForAverage)
  const forAvg = daysForAverage(days.map((d) => (p.days[d.key] ? { key: d.key, ...p.days[d.key] } : null)), { goal, todayKey: localDateString(Date.now()) });
  const avg = (k) => (forAvg.days.length ? forAvg.days.reduce((s, d) => s + (d[k] || 0), 0) / forAvg.days.length : 0);
  const near = goal ? logged.filter((d) => Math.abs(d.calories - goal) <= goal * 0.1).length : null;
  const water = days.reduce((s, d) => s + (p.days[d.key]?.water || 0), 0) / days.length;
  const sessions = days.reduce((n, d) => n + (p.days[d.key]?.sessions || 0), 0);
  const top = Math.max(goal * 1.25, ...logged.map((d) => d.calories), 1);
  const h = (v) => (v / top) * WEEK_H;
  const many = ordered.length > 14;
  const todayKey = localDateString(Date.now());

  const cols = ordered.map(({ ts, key }, idx) => {
    const d = p.days[key];
    const tick = many ? ((ordered.length - 1 - idx) % 7 === 0 ? `${new Date(ts).getMonth() + 1}/${new Date(ts).getDate()}` : "") : formatDate(ts, { weekday: "narrow" });
    const label = `<small>${escHtml(tick)}</small>`;
    const when = escHtml(dayLabel(ts, key));
    if (!d || !(d.meals > 0)) {
      return `<div class="us-wcol is-missing${key === todayKey ? " is-today" : ""}" title="${when}: ${escHtml(t("us.keyMissing"))}"><div class="us-wbar"><span class="us-wmiss"></span></div>${label}</div>`;
    }
    const within = goal ? Math.min(d.calories, goal) : d.calories;
    const over = goal ? Math.max(0, d.calories - goal) : 0;
    const status = goal && Math.abs(d.calories - goal) <= goal * 0.1 ? " is-near" : over > 0 ? " is-over" : "";
    const overH = Math.min(h(over), WEEK_H - h(within));
    return `<div class="us-wcol${status}${key === todayKey ? " is-today" : ""}" title="${when}: ${fmt(d.calories)} kcal"><div class="us-wbar">${over > 0 ? `<span class="us-wover" style="height:${overH.toFixed(1)}px"></span>` : ""}<span class="us-weat" style="height:${Math.max(2, h(within)).toFixed(1)}px"></span></div>${label}</div>`;
  }).join("");

  const stat = (text, value) => `<span>${text.replace(value, `<b>${value}</b>`)}</span>`;
  const loggedTxt = `${logged.length}/${days.length}`;
  const stats = [
    stat(t("us.statLogged", { n: loggedTxt }), loggedTxt),
    near !== null ? stat(t("us.statNear", { n: near }), formatNumber(near)) : "",
    logged.length ? stat(t("us.statProtein", { n: Math.round(avg("proteinG")) }), formatNumber(Math.round(avg("proteinG")))) : "",
    stat(t("us.statWater", { n: water.toFixed(1) }), water.toFixed(1)),
    sessions ? stat(t("us.statWorkouts", { n: sessions }), formatNumber(sessions)) : "",
  ].join("");
  const name = escHtml(p.name || titleCase(p.owner));
  const avgKcal = logged.length ? fmt(avg("calories")) : "–";

  return `
    <div class="us-week${many ? " is-many" : ""}" style="--pc:${c.solid}">
      <div class="us-week-head">
        <span class="us-week-dot" style="background:${c.solid}"></span><b>${name}</b>
        <span class="us-spacer"></span><span class="us-week-avg">${avgKcal}</span><small>${forAvg.full ? t("us.avgKcalDays", { n: forAvg.full }) : t("us.avgKcal")}</small>
      </div>
      <div class="us-wchart" role="img" aria-label="${escHtml(t("us.weekChart", { name: p.name || titleCase(p.owner), avg: avgKcal, d: days.length }))}">
        ${goal ? `<i class="us-wgoal" style="bottom:${(h(goal) + 17).toFixed(1)}px"><em>${t("us.goalShort")}</em></i>` : ""}
        ${cols}
      </div>
      <div class="us-wstats">${stats}</div>
    </div>`;
}

function summaryHtml(people, days) {
  return `<section class="tg-section">
    <h2 class="tg-h2">${t("us.lastNDays", { n: days.length })}</h2>
    <div class="us-card us-weeks">${people.map((p, i) => weekChartHtml(p, i, days)).join("")}</div>
    <div class="us-legend">
      <span><i class="k-eaten"></i>${t("us.keyEatenShort")}</span>
      <span><i class="k-over"></i>${t("us.keyOver")}</span>
      <span><i class="k-near"></i>${t("us.keyNear")}</span>
      <span><i class="k-miss"></i>${t("us.keyMissing")}</span>
    </div>
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

function groupBarHtml() {
  const groups = data.groups ?? [];
  if (groups.length < 2) return "";
  const current = data.group?.id ?? groups[0].id;
  return `
    <div class="us-groups" role="group" aria-label="${t("groups.switch")}">
      ${groups.map((g) => `<button type="button" data-group="${escHtml(g.id)}" aria-pressed="${g.id === current}">${escHtml(g.name)}</button>`).join("")}
    </div>`;
}

const chartHtml = (people, days) => (people.length > 2 ? trendHtml(people, days) : mirrorHtml(people, days));

/** Redraws only the chart (a day was picked), leaving the rest of the page alone. */
function redrawChart(people, days) {
  const old = body.querySelector("#us-chart");
  if (!old) return;
  old.outerHTML = chartHtml(people, days);
  wireChart(people, days);
}

function wireChart(people, days) {
  const chart = body.querySelector("#us-chart");
  if (!chart) return;
  const pick = (key) => {
    selectedDay = selectedDay === key ? null : key;
    redrawChart(people, days);
    body.querySelector(`#us-chart [data-day="${selectedDay}"]`)?.focus({ preventScroll: true });
  };
  chart.querySelectorAll("[data-day]").forEach((el) => {
    el.addEventListener("click", () => pick(el.dataset.day));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(el.dataset.day); }
    });
  });
  chart.querySelector("[data-close-day]")?.addEventListener("click", () => { selectedDay = null; redrawChart(people, days); });

  // Trend lines: drag a finger across any line to scrub through the days; every line's cursor
  // follows, and lifting the finger opens that day's details.
  const sparks = [...chart.querySelectorAll("[data-spark]")];
  if (sparks.length === 0) return;
  const ordered = [...days].reverse();
  const n = ordered.length;
  const moveTo = (idx) => {
    for (const svg of sparks) {
      const ys = svg.dataset.ys.split(",");
      const vals = svg.dataset.vals.split(",");
      const x = ((idx / Math.max(1, n - 1)) * SPARK_W).toFixed(1);
      svg.querySelector(".us-cursor")?.setAttribute("x1", x);
      svg.querySelector(".us-cursor")?.setAttribute("x2", x);
      svg.querySelector(".us-cursor-dot")?.setAttribute("cx", x);
      svg.querySelector(".us-cursor-dot")?.setAttribute("cy", ys[idx]);
      const label = svg.closest(".us-trend")?.querySelector(".us-trend-avg");
      if (label) label.textContent = `${dayLabel(ordered[idx].ts, ordered[idx].key)} · ${Number(vals[idx]) > 0 ? `${fmt(Number(vals[idx]))} kcal` : "–"}`;
    }
  };
  const idxAt = (svg, clientX) => {
    const r = svg.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / Math.max(1, r.width)) * (n - 1))));
  };
  for (const svg of sparks) {
    let dragging = false;
    let idx = null;
    svg.addEventListener("pointerdown", (e) => {
      dragging = true;
      svg.setPointerCapture?.(e.pointerId);
      idx = idxAt(svg, e.clientX);
      moveTo(idx);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const next = idxAt(svg, e.clientX);
      if (next !== idx) { idx = next; moveTo(idx); }
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (idx !== null) { selectedDay = ordered[idx].key; redrawChart(people, days); }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }
}

/** In the app, your own row comes straight from this phone: the same numbers as your Home,
 *  with nothing waiting on a sync. */
function withMyOwnNumbers(people) {
  if (body?.id !== "us-tab-body") return people; // the standalone page has no log of its own
  return people.map((p) => {
    if (p.owner !== data.me) return p;
    try {
      const goals = store.computeGoals();
      const mine = {
        calories: Math.round(goals.targetCalories), proteinG: Math.round(goals.proteinTargetG),
        carbsG: Math.round(goals.carbsTargetG), fatG: Math.round(goals.fatTargetG),
      };
      const days = { ...p.days };
      const today = startOfDay(Date.now());
      for (let i = 0; i < 30; i++) days[localDateString(addDays(today, -i))] = store.daySummary(new Date(addDays(today, -i)));
      return { ...p, goals: mine.calories > 0 ? mine : p.goals, days };
    } catch {
      return p;
    }
  });
}

function render() {
  const people = withMyOwnNumbers(data.people || []);
  if (people.length === 0) {
    body.innerHTML = `<p class="tg-note">No one is set up yet. Add people to APP_USERS in Vercel.</p>`;
    return;
  }
  // Everyone in the group (accounts are capped at 25, api/_members.js). Rows and charts stack,
  // one per person; colours repeat past twelve, and every row carries the person's name.
  if (people.length > 25) people.length = 25;
  const days = dayList(range);
  // Two people still get the mirror chart — it reads beautifully head to head. Three or more
  // get sparklines, which stay legible however many rows there are.
  if (selectedDay && !days.some((d) => d.key === selectedDay)) selectedDay = null; // range shrank
  const chart = chartHtml(people, days);
  body.innerHTML = groupBarHtml() + `<section id="us-coach" class="us-coach"></section><section id="us-push"></section><section class="us-recap" id="us-recap"></section>` + todayHtml(people) + chart + summaryHtml(people, days) +
    (people.length === 1 ? `<p class="tg-note">${t("groups.onlyYou", { name: data.group?.name ?? "" })}</p>` : "");
  body.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.group === (data.group?.id ?? null)) return;
    groupId = b.dataset.group;
    data = null;
    start();
  }));
  wireAvatar();
  wireChart(people, days);
  if (body.id === "us-tab-body") renderPushCard(body.querySelector("#us-push")); // in the app only, not us.html
  renderRecap(body.querySelector("#us-recap"), { lang: currentLanguage() === "es" ? "es" : "en" });
  // the coach's own account: who shares their log, one tap away (js/ui/coach.js)
  if (body.id === "us-tab-body") import("./ui/coach.js").then((m) => m.renderCoachCard(body.querySelector("#us-coach"))).catch(() => {});
  body.querySelectorAll("[data-note-to]").forEach((b) => b.addEventListener("click", () => openNoteSheet(b.dataset.noteTo)));
  fillIncredulousBadges(body);
  moodSounds(people);
  // the shared feed has its own tab now (js/ui/shared-tab.js)
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
