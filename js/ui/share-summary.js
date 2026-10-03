// share-summary.js — "Share" on the calorie card: a clean summary of a day or a week, as a
// 1080×1350 image (4:5, shown uncropped by Instagram and WhatsApp) or as plain text, handed to
// the phone's own share menu so it can go to any app. Nothing is uploaded by SnapCal itself.
//
// The builders (daySummary / weekSummary / summaryText) are pure so they can be tested; the
// card is drawn on a canvas; the sheet ties them together.

import * as store from "../store.js";
import { t, formatNumber, formatDate } from "../i18n.js";
import { startOfDay, addDays, localDateString, daysForAverage } from "../nutrition.js";
import { foodCategory, foodIconSvg } from "./food-icons.js";
import { iconSvg } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { doodleSvg } from "./doodle.js";
import { updatePending } from "../updater.js";
import { cachedFaceDoodle } from "./photo-doodle.js";
import { cachedNanoDoodle, ensureNanoDoodle } from "./nano-doodle.js";

const W = 1080, H = 1350, PAD = 84;
const INK = "#000000", SEC = "#5C5C60", LINE = "#E2E2E2", TRACK = "#EDEDED";
const MARK = { protein: "#D14343", carbs: "#B9741F", fat: "#4F74D6", over: "#D71921", flame: "#C9661A" };
// A · spec sheet on white, B · poster on black (the "Dark" switch). Colour only on the markers.
const PALETTE = {
  light: { bg: "#FFFFFF", grid: "rgba(0,0,0,0.07)", ink: INK, sec: SEC, line: LINE, track: TRACK, dash: "#BDBDC2", over: MARK.over, fat: MARK.fat },
  dark: { bg: "#0A0A0A", grid: "rgba(255,255,255,0.07)", ink: "#F2F2F2", sec: "#A0A0A0", line: "#2A2A2A", track: "#262626", dash: "#4A4A4A", over: "#FF453A", fat: "#7F9BEA" },
};
const hoursLabel = (min) => (min >= 60 ? `${one(min / 60)}h` : `${Math.round(min)}m`);
const SANS = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const FLAME_PATH = "M 189.8 125.4 C 183.5 127.1,180.1 129.5,178.4 133.5 C 175.5 140.5,177 144,189.8 160.7 C 204 179.1,211.4 196.8,210.8 210.7 L 210.5 217.5 207.8 213 C 201.1 201.6,190.5 194,181.3 194 C 171.6 194,169.8 197.7,170.7 215.2 C 171.4 230.3,169.9 237.4,161.7 256.6 C 152 279.3,149.6 290.2,149.6 310.5 C 149.7 363.6,189 398,249.5 398 C 306.3 398,346.7 367,359.1 314 C 361.7 302.9,362.7 276.9,361.1 263.4 C 354.5 209,323.5 166.1,273.5 142 C 246 128.7,206.6 120.9,189.8 125.4 M 252.5 264.8 C 252.5 277.3,252.1 281.7,250.7 286.5 C 247.4 297.1,247.2 297.1,243.4 289.9 C 241.5 286.5,238.6 282.1,236.8 280.3 C 233 276.4,232 277,230.1 284 C 229.4 286.5,226.9 291.6,224.5 295.5 C 213.2 314,211.5 324.3,217.8 338.3 C 224.5 353.6,245.2 361.6,265 356.6 C 308.3 345.6,306.6 279.1,262.4 252.5 C 252.4 246.4,252.4 246.4,252.5 264.8";
const MEALS_SHOWN = 4;
const OPTS_KEY = "snapcal.shareOpts";

const done = (e) => e && e.isPending !== true && e.analysisFailed !== true;
const kgOrLb = (kg) => (store.weightUnit() === "lb" ? { v: kg * 2.2046226218, u: "lb" } : { v: kg, u: "kg" });
const one = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Summaries (pure: read the store, return plain objects)
// ---------------------------------------------------------------------------

export function daySummary(date = new Date()) {
  const energy = store.dayEnergy(date);
  const totals = store.totalsForDay(date);
  const meals = store.entriesForDay(date).filter(done).sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => ({ name: e.name, calories: Math.round(e.calories), kind: foodCategory(e), ts: e.timestamp }));
  const latest = store.latestWeight();
  const goals = store.computeGoals();
  const workouts = store.exerciseForDay(date);
  return {
    kind: "day",
    date: startOfDay(date),
    eaten: Math.round(totals.calories),
    goal: energy.adjustedTarget,
    remaining: energy.remaining,
    proteinG: Math.round(totals.proteinG),
    carbsG: Math.round(totals.carbsG),
    fatG: Math.round(totals.fatG),
    meals,
    water: store.getWaterEntryForDay(date).glasses ?? 0,
    streak: store.streak(date),
    weightKg: latest ? latest.kg : null,
    proteinGoal: Math.round(goals.proteinTargetG || 0),
    carbsGoal: Math.round(goals.carbsTargetG || 0),
    fatGoal: Math.round(goals.fatTargetG || 0),
    burned: Math.round(energy.burned || 0),
    credit: Math.round(energy.credit || 0),
    workoutMinutes: workouts.reduce((n, x) => n + (Number(x.minutes) || 0), 0),
    micros: dayMicros(date),
  };
}

/** Fiber, sugar and sodium for the card, or null when the day's meals carry no nutrient data. */
function dayMicros(date) {
  const m = store.microsForDay(date);
  const tot = m.totals;
  if (!tot || !m.meals) return null;
  const fiberGoal = m.targets?.fiberG?.value || 30;
  const sodiumLimit = m.targets?.sodiumMg?.value || 2300;
  return [
    { label: t("share.fiber"), value: `${Math.round(tot.fiberG || 0)}/${fiberGoal} g`, share: (tot.fiberG || 0) / fiberGoal },
    { label: t("share.sugar"), value: `${Math.round(tot.sugarG || 0)} g`, share: (tot.sugarG || 0) / 90 },
    { label: t("share.sodium"), value: `${one((tot.sodiumMg || 0) / 1000)} g`, share: (tot.sodiumMg || 0) / sodiumLimit, color: (tot.sodiumMg || 0) > sodiumLimit ? MARK.over : undefined },
  ];
}

/** The seven days ending on `date` (so a week shared on Sunday is Monday to Sunday). */
export function weekSummary(date = new Date()) {
  const end = startOfDay(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6)).map((ts) => {
    const list = store.entriesForDay(ts).filter(done);
    const tot = store.totalsForDay(ts);
    const ex = store.exerciseForDay(ts);
    return {
      ts, key: localDateString(ts), logged: list.length > 0, meals: list.length,
      calories: Math.round(tot.calories), proteinG: tot.proteinG,
      goal: store.dayEnergy(ts).adjustedTarget,
      workouts: ex.length,
      minutes: ex.reduce((n, x) => n + (Number(x.minutes) || 0), 0),
      burned: ex.reduce((n, x) => n + (Number(x.caloriesBurned) || 0), 0),
      water: store.getWaterEntryForDay(ts).glasses ?? 0,
    };
  });
  const logged = days.filter((d) => d.logged);
  // averages over full days only (today and half-logged days would drag them down)
  const forAvg = daysForAverage(days, { goal: days[days.length - 1].goal, todayKey: localDateString(Date.now()) });
  const avg = (k) => (forAvg.days.length ? forAvg.days.reduce((s, d) => s + d[k], 0) / forAvg.days.length : 0);
  const proteinGoal = Math.round(store.computeGoals().proteinTargetG || 0);
  const best = logged.filter((d) => d.goal > 0).sort((a, b) => Math.abs(a.calories - a.goal) - Math.abs(b.calories - b.goal))[0];
  const near = logged.filter((d) => d.goal > 0 && Math.abs(d.calories - d.goal) <= d.goal * 0.1).length;
  const change = store.weightChange(7);
  return {
    kind: "week",
    from: days[0].ts,
    to: end,
    days,
    avgCalories: Math.round(avg("calories")),
    goal: Math.round(days[days.length - 1].goal),
    loggedDays: logged.length,
    nearGoal: near,
    avgProteinG: Math.round(avg("proteinG")),
    workouts: days.reduce((s, d) => s + d.workouts, 0),
    workoutMinutes: days.reduce((s, d) => s + d.minutes, 0),
    workoutKcal: Math.round(days.reduce((s, d) => s + d.burned, 0)),
    fullDays: forAvg.full,
    proteinGoal,
    proteinHitDays: proteinGoal ? logged.filter((d) => d.proteinG >= proteinGoal * 0.95).length : 0,
    bestDay: best ? best.ts : null,
    waterPerDay: one(days.reduce((s, d) => s + d.water, 0) / 7),
    streak: store.streak(date),
    weightDeltaKg: change ? change.delta : null,
  };
}

const dayLabel = (ts) => formatDate(ts, { weekday: "short", month: "short", day: "numeric" });
const rangeLabel = (a, b) => `${formatDate(a, { month: "short", day: "numeric" })} – ${formatDate(b, { month: "short", day: "numeric" })}`;

/** The same summary as plain text, for apps that don't take images (and for copying). */
export function summaryText(s, { meals = true, streak = true, weight = false } = {}) {
  const lines = [];
  if (s.kind === "day") {
    lines.push(`SnapCal · ${dayLabel(s.date)}`);
    lines.push(`${formatNumber(s.eaten)} / ${formatNumber(s.goal)} kcal (${s.remaining >= 0 ? t("share.leftN", { n: formatNumber(s.remaining) }) : t("share.overN", { n: formatNumber(-s.remaining) })})`);
    lines.push(t("share.macrosLine", { p: s.proteinG, c: s.carbsG, f: s.fatG }));
    if (meals && s.meals.length) {
      lines.push("");
      for (const m of s.meals) lines.push(`• ${m.name} — ${formatNumber(m.calories)}`);
    }
    const foot = [];
    if (s.water) foot.push(`💧 ${t("us.glassesOfWater", { n: s.water })}`);
    if (streak && s.streak > 0) foot.push(`🔥 ${t("share.streakN", { n: s.streak })}`);
    if (weight && s.weightKg) { const w = kgOrLb(s.weightKg); foot.push(`${one(w.v)} ${w.u}`); }
    if (foot.length) lines.push("", foot.join(" · "));
  } else {
    lines.push(`SnapCal · ${rangeLabel(s.from, s.to)}`);
    lines.push(t("share.weekAvg", { n: formatNumber(s.avgCalories), goal: formatNumber(s.goal) }));
    lines.push(t("share.weekLogged", { n: s.loggedDays }) + " · " + t("share.weekNear", { n: s.nearGoal }));
    lines.push(t("share.weekProtein", { n: s.avgProteinG }));
    if (meals) {
      lines.push("");
      for (const d of s.days) lines.push(`${formatDate(d.ts, { weekday: "short" })}  ${d.logged ? `${formatNumber(d.calories)} kcal` : "—"}`);
    }
    const foot = [];
    if (s.workouts) foot.push(t("us.statWorkouts", { n: s.workouts }));
    if (streak && s.streak > 0) foot.push(`🔥 ${t("share.streakN", { n: s.streak })}`);
    if (weight && s.weightDeltaKg !== null) { const w = kgOrLb(s.weightDeltaKg); foot.push(`${w.v > 0 ? "+" : ""}${one(w.v)} ${w.u}`); }
    if (foot.length) lines.push("", foot.join(" · "));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The card (canvas)
// ---------------------------------------------------------------------------

const svgImage = (svg) => within(new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  const xml = /xmlns=/.test(svg) ? svg : svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}), 3000);
const urlImage = (src) => within(new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
}), 3000);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/**
 * The "showing off" doodle for the card: the person's Nano Banana drawing of that pose when one
 * exists, else the built-in doodle (with their face sketch if they've set a photo).
 */
function showoffDoodle(ink = INK, sec = SEC) {
  const p = store.getProfile();
  const variant = p.doodleVariant === "b" ? "b" : "a";
  const nano = cachedNanoDoodle("showoff", variant, p.avatar ?? null);
  if (nano) return { kind: "img", src: nano };
  const face = p.avatar ? cachedFaceDoodle(p.avatar) : null;
  const svg = doodleSvg({ state: "showoff", variant, size: 300, face })
    .split("var(--sc-primary-text)").join(ink).split("var(--sc-secondary)").join(sec);
  return { kind: "svg", svg };
}

/** Resolves after `ms` at most, so one slow piece can never keep the card from being drawn. */
const within = (promise, ms, fallback = null) => Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);

/**
 * Draws the card and resolves to a JPEG blob. JPEG, not PNG: WhatsApp on iPhone answers
 * "Couldn't share, please try again" to PNGs handed over by the browser, and the card has no
 * transparency to lose (it is drawn on white).
 */
export async function renderCard(s, opts = {}) {
  try { await within(document.fonts?.load?.('900 120px "Doto"') ?? Promise.resolve(), 2500); } catch { /* falls back to the sans */ }
  const P = opts.dark ? PALETTE.dark : PALETTE.light;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const dot = (px) => `900 ${px}px "Doto", ${SANS}`;
  const sans = (wt, px) => `${wt} ${px}px ${SANS}`;
  const text = (str, x, y, { font, color = P.ink, align = "left", base = "alphabetic", max } = {}) => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
    ctx.fillText(max ? fitText(ctx, str, max) : str, x, y);
    const w = ctx.measureText(max ? fitText(ctx, str, max) : str).width;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    return w;
  };
  const tile = (x, y, w, h) => { ctx.strokeStyle = P.line; ctx.lineWidth = 2; roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 26); ctx.stroke(); };
  const dark = !!opts.dark;

  // paper with the faint dot grid
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = P.grid;
  for (let y = 24; y < H; y += 48) for (let x = 24; x < W; x += 48) { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); }

  // header: flame + SNAPCAL, the date on the right
  ctx.save();
  ctx.translate(PAD, PAD - 8); ctx.scale(52 / 282, 52 / 282); ctx.translate(-146, -120);
  ctx.fillStyle = P.ink; ctx.fill(new Path2D(FLAME_PATH), "evenodd");
  ctx.restore();
  ctx.save(); ctx.font = sans(800, 32); ctx.fillStyle = P.ink; ctx.textBaseline = "middle";
  let lx = PAD + 70; for (const ch of "SNAPCAL") { ctx.fillText(ch, lx, PAD + 20); lx += ctx.measureText(ch).width + 6; }
  ctx.restore();
  text((s.kind === "day" ? dayLabel(s.date) : rangeLabel(s.from, s.to)).toUpperCase(), W - PAD, PAD + 20, { font: sans(600, 32), color: P.sec, align: "right", base: "middle" });

  const footer = async (left) => {
    const fy = H - PAD - 70;
    ctx.fillStyle = P.line; ctx.fillRect(PAD, fy, W - PAD * 2, 2);
    text(left, PAD, fy + 52, { font: sans(400, 34), color: P.sec, base: "middle", max: 560 });
    if (opts.streak !== false && s.streak > 0) {
      const w = text(t("share.streakN", { n: s.streak }), W - PAD, fy + 52, { font: sans(600, 34), align: "right", base: "middle" });
      const fl = await svgImage(iconSvg("flameFill", { size: 40, color: MARK.flame }));
      if (fl) ctx.drawImage(fl, W - PAD - w - 50, fy + 32, 40, 40);
    }
  };

  // the dot-matrix progress bar: 40 cells, the goal after the 32nd, red cells past it
  const dotBar = (y, eaten, goal) => {
    const n = 40, gap = 8, goalAt = 32, cw = (W - PAD * 2 - gap * (n - 1)) / n, h = 34;
    const on = goal > 0 ? Math.min(goalAt, Math.round((Math.min(eaten, goal) / goal) * goalAt)) : 0;
    const over = goal > 0 ? Math.min(n - goalAt, Math.ceil((Math.max(0, eaten - goal) / goal) * goalAt)) : 0;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < on ? P.ink : i >= goalAt && i < goalAt + over ? P.over : P.track;
      roundRect(ctx, PAD + i * (cw + gap), y, cw, h, 6); ctx.fill();
    }
    ctx.fillStyle = P.ink; roundRect(ctx, PAD + goalAt * (cw + gap) - gap / 2 - 3, y - 12, 6, h + 24, 3); ctx.fill();
  };

  // when the meals were eaten, 6am to midnight, each bubble sized by its calories
  const timeline = (y, meals) => {
    const x0 = PAD + 20, x1 = W - PAD - 20;
    const xOf = (h) => x0 + ((Math.min(24, Math.max(6, h)) - 6) / 18) * (x1 - x0);
    ctx.strokeStyle = P.dash; ctx.lineWidth = 3; ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
    for (const [h, key, align] of [[6, "share.t6", "left"], [12, "share.t12", "center"], [18, "share.t18", "center"], [24, "share.t24", "right"]]) {
      text(t(key), align === "left" ? PAD : align === "right" ? W - PAD : xOf(h), y + 62, { font: sans(400, 26), color: P.sec, align });
    }
    for (const m of meals) {
      const d = new Date(m.ts);
      const r = Math.min(56, 16 + m.calories / 22);
      ctx.fillStyle = P.ink; ctx.beginPath(); ctx.arc(xOf(d.getHours() + d.getMinutes() / 60), y, r, 0, Math.PI * 2); ctx.fill();
    }
  };

  const doodleAt = async (x, y, size) => {
    if (opts.doodle === false || size < 150) return;
    const d = showoffDoodle(P.ink, P.sec);
    let im = d.kind === "img" ? await urlImage(d.src) : await svgImage(d.svg);
    if (im && d.kind === "img") {
      const ink = document.createElement("canvas");
      ink.width = im.width; ink.height = im.height;
      const ic = ink.getContext("2d");
      ic.drawImage(im, 0, 0);
      ic.globalCompositeOperation = "source-in";
      ic.fillStyle = P.ink; ic.fillRect(0, 0, ink.width, ink.height);
      im = ink;
    }
    if (im) {
      const h = Math.min(size * (im.height && im.width ? im.height / im.width : 1.08), size * 1.1);
      ctx.drawImage(im, x, y, size, h);
    }
  };
  const bigNumber = async (str, px, y, doodleTop, maxSize = 250) => {
    const w = text(str, PAD - 6, y, { font: dot(px) });
    const size = Math.min(maxSize, W - PAD - (PAD + w + 30));
    await doodleAt(W - PAD - size, doodleTop, size);
  };
  const kcalLine = (ofGoal, y) => {
    const base = ofGoal;
    let w = text(base, PAD, y, { font: sans(400, 40), color: P.sec });
    if (s.credit > 0) {
      w += text(" · ", PAD + w, y, { font: sans(400, 40), color: P.sec });
      w += text(`+${formatNumber(s.credit)}`, PAD + w, y, { font: sans(700, 40) });
      text(` ${t("share.fromExercise", { min: s.workoutMinutes })}`, PAD + w, y, { font: sans(400, 40), color: P.sec, max: W - PAD * 2 - w });
    }
  };
  const statusLine = (y) => {
    const lt = s.remaining >= 0 ? t("share.leftN", { n: formatNumber(s.remaining) }) : t("share.overN", { n: formatNumber(-s.remaining) });
    text(lt, PAD, y, { font: sans(700, 40), color: s.remaining >= 0 ? P.ink : P.over });
  };
  const blockChart = (top, base) => {
    // the week as stacked blocks: ink up to the goal, red past it, a dashed box for a missed day
    const n = s.days.length, blocks = 14, bh = (base - top) / blocks, gap = 8, bw = 74;
    const scaleTop = Math.max(s.goal * 1.25, ...s.days.map((d) => d.calories), 1);
    const slot = (W - PAD * 2) / n;
    const goalBlocks = (s.goal / scaleTop) * blocks;
    const gy = base - goalBlocks * bh;
    ctx.strokeStyle = P.dash; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(W - PAD, gy); ctx.stroke(); ctx.setLineDash([]);
    text(`${t("share.goalShort")} ${formatNumber(s.goal)}`.toUpperCase(), W - PAD, gy - 14, { font: sans(700, 24), color: P.sec, align: "right" });
    s.days.forEach((d, i) => {
      const x = PAD + slot * i + (slot - bw) / 2;
      if (!d.logged) {
        ctx.strokeStyle = P.dash; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
        roundRect(ctx, x, base - 70, bw, 70, 10); ctx.stroke(); ctx.setLineDash([]);
        text("–", x + bw / 2, base - 90, { font: dot(34), color: P.sec, align: "center" });
      } else {
        const count = Math.max(1, Math.round((d.calories / scaleTop) * blocks));
        for (let b = 0; b < count; b++) {
          ctx.fillStyle = b >= Math.round(goalBlocks) && d.calories > d.goal ? P.over : P.ink;
          roundRect(ctx, x, base - (b + 1) * bh + gap / 2, bw, bh - gap, 6); ctx.fill();
        }
        text(`${(d.calories / 1000).toFixed(1)}k`, x + bw / 2, base - count * bh - 14, { font: dot(34), align: "center" });
      }
      text(formatDate(d.ts, { weekday: "narrow" }), x + bw / 2, base + 46, { font: sans(600, 32), color: P.sec, align: "center" });
    });
  };
  const statTile = (x, y, w, h, value, label, color = P.ink, vpx = 60) => {
    tile(x, y, w, h);
    ctx.font = sans(400, 26);
    const room = w - 46;
    let lines = [label];
    if (ctx.measureText(label).width > room) {
      const words = label.split(" ");
      let cut = words.length - 1;
      while (cut > 1 && ctx.measureText(words.slice(0, cut).join(" ")).width > room) cut--;
      lines = [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
    }
    text(value, x + 24, y + 20 + vpx * 0.8, { font: dot(lines.length > 1 ? vpx - 8 : vpx), color, max: w - 40 });
    lines.forEach((l, i) => text(l, x + 26, y + h - 24 - (lines.length - 1 - i) * 30, { font: sans(400, 26), color: P.sec, max: room }));
  };
  const microBars = (y, items) => {
    const gap = 30, cw = (W - PAD * 2 - gap * (items.length - 1)) / items.length;
    items.forEach((m, i) => {
      const x = PAD + i * (cw + gap);
      text(m.label, x, y, { font: sans(400, 30), color: P.sec });
      text(m.value, x + cw, y, { font: sans(700, 30), align: "right" });
      ctx.fillStyle = P.track; roundRect(ctx, x, y + 18, cw, 14, 7); ctx.fill();
      ctx.fillStyle = m.color ?? P.ink; roundRect(ctx, x, y + 18, Math.max(14, cw * Math.min(1, m.share)), 14, 7); ctx.fill();
    });
  };
  const tw = (W - PAD * 2 - 18 * 3) / 4;

  if (s.kind === "day" && !dark) {
    // A · spec sheet
    await bigNumber(formatNumber(s.eaten), 210, 318, 128, 180);
    kcalLine(t("share.ofGoal", { goal: formatNumber(s.goal) }), 386);
    dotBar(424, s.eaten, s.goal);
    statusLine(508);
    if (s.goal > 0) text(`${Math.round((s.eaten / s.goal) * 100)}%`, W - PAD, 508, { font: sans(400, 40), color: P.sec, align: "right" });
    // macros against their goals, as rings
    const mw = (W - PAD * 2 - 22 * 2) / 3;
    [[MARK.protein, s.proteinG, s.proteinGoal, "share.protein"], [MARK.carbs, s.carbsG, s.carbsGoal, "share.carbs"], [P.fat, s.fatG, s.fatGoal, "share.fat"]].forEach(([c, g, goal, k], i) => {
      const x = PAD + i * (mw + 22), y = 548;
      tile(x, y, mw, 140);
      const cx = x + 56, cy = y + 70;
      ctx.lineWidth = 12; ctx.lineCap = "round";
      ctx.strokeStyle = P.track; ctx.beginPath(); ctx.arc(cx, cy, 32, 0, Math.PI * 2); ctx.stroke();
      if (goal > 0 && g > 0) { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(cx, cy, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, g / goal)); ctx.stroke(); }
      ctx.lineCap = "butt";
      text(`${g}g`, x + 104, y + 70, { font: dot(48), max: mw - 116 });
      text(goal > 0 ? `${t(k)} / ${goal}` : t(k), x + 106, y + 110, { font: sans(400, 25), color: P.sec, max: mw - 116 });
    });
    timeline(760, s.meals);
    let y = 880;
    if (s.meals.length && opts.meals !== false) {
      const shown = s.micros ? 3 : 4;
      for (const m of s.meals.slice(0, shown)) {
        text(formatDate(m.ts, { hour: "numeric", minute: "2-digit" }), PAD, y, { font: sans(600, 28), color: P.sec });
        const kw = text(formatNumber(m.calories), W - PAD, y, { font: sans(700, 40), align: "right" });
        text(m.name, PAD + 150, y, { font: sans(400, 40), max: W - PAD * 2 - 150 - kw - 24 });
        y += 58;
      }
      if (s.meals.length > shown) text(t("share.moreN", { n: s.meals.length - shown }), PAD + 150, y - 12, { font: sans(400, 30), color: P.sec });
    } else if (!s.meals.length) {
      text(t("us.mealsCount", { n: 0 }), PAD, y, { font: sans(400, 36), color: P.sec });
    }
    if (s.micros) microBars(1112, s.micros);
    const left = [opts.weight && s.weightKg ? (() => { const w = kgOrLb(s.weightKg); return `${one(w.v)} ${w.u}`; })() : null,
      s.water ? t("us.glassesOfWater", { n: s.water }) : null].filter(Boolean).join(" · ");
    await footer(left);
  } else if (s.kind === "day") {
    // B · poster
    text(t("share.todayIAte"), PAD, 228, { font: sans(400, 44), color: P.sec });
    await bigNumber(formatNumber(s.eaten), 236, 452, 200);
    text(t("share.ofGoal", { goal: formatNumber(s.goal) }), PAD, 522, { font: sans(400, 40), color: P.sec });
    dotBar(560, s.eaten, s.goal);
    statusLine(646);
    if (s.credit > 0) text(t("share.earnedN", { n: formatNumber(s.credit) }), W - PAD, 646, { font: sans(400, 34), color: P.sec, align: "right" });
    [[`${s.proteinG}`, t("share.gProtein"), MARK.protein], [`${s.carbsG}`, t("share.gCarbs"), MARK.carbs], [`${s.fatG}`, t("share.gFat"), P.fat], [formatNumber(s.burned), t("share.kcalBurned"), P.ink]]
      .forEach(([v, l, c], i) => statTile(PAD + i * (tw + 18), 690, tw, 150, v, l, c));
    timeline(912, s.meals);
    const biggest = s.meals.reduce((a, m) => (m.calories > (a?.calories ?? 0) ? m : a), null);
    const hw = (W - PAD * 2 - 18) / 2;
    statTile(PAD, 1030, hw, 132, String(s.meals.length), biggest ? t("share.mealsBiggest", { n: formatNumber(biggest.calories) }) : t("share.mealsWord"), P.ink, 54);
    statTile(PAD + hw + 18, 1030, hw, 132, String(s.water), t("share.glassesWord"), P.ink, 54);
    await footer(opts.weight && s.weightKg ? (() => { const w = kgOrLb(s.weightKg); return `${one(w.v)} ${w.u}`; })() : "SnapCal");
  } else if (!dark) {
    // A · week
    await bigNumber(formatNumber(s.avgCalories), 210, 318, 128, 180);
    text(s.fullDays ? t("share.avgFullDays", { n: s.fullDays, goal: formatNumber(s.goal) }) : t("share.avgOfGoal", { goal: formatNumber(s.goal) }), PAD, 386, { font: sans(400, 40), color: P.sec, max: W - PAD * 2 });
    blockChart(450, 850);
    const weightTile = opts.weight && s.weightDeltaKg !== null
      ? (() => { const w = kgOrLb(s.weightDeltaKg); return [`${w.v > 0 ? "+" : ""}${one(w.v)}`, t("share.weightWeek", { u: w.u })]; })()
      : [one(s.waterPerDay).toString(), t("share.waterAvgShort")];
    [[`${s.loggedDays}/7`, t("share.daysLogged")], [s.loggedDays ? `${s.proteinHitDays}/${s.loggedDays}` : "–", t("share.proteinHit")],
      s.workoutMinutes ? [hoursLabel(s.workoutMinutes), t("share.workoutsN", { n: s.workouts })] : [String(s.workouts), t("share.workouts")], weightTile]
      .forEach(([v, l], i) => statTile(PAD + i * (tw + 18), 935, tw, 150, v, l));
    microBars(1134, [
      { label: t("share.proteinAvg"), value: `${s.avgProteinG} g`, share: s.proteinGoal ? s.avgProteinG / s.proteinGoal : 0, color: MARK.protein },
      { label: t("share.waterAvg"), value: String(one(s.waterPerDay)), share: s.waterPerDay / 8 },
      { label: t("share.bestDay"), value: s.bestDay ? formatDate(s.bestDay, { weekday: "short" }) : "–", share: s.bestDay ? 1 : 0 },
    ]);
    await footer(s.nearGoal ? t("share.nearGoalN", { n: s.nearGoal }) : "");
  } else {
    // B · week
    text(t("share.myWeek"), PAD, 228, { font: sans(400, 44), color: P.sec });
    const w = text(formatNumber(s.avgCalories), PAD - 6, 400, { font: dot(170) });
    text(t("share.avgKcalShort"), PAD + w + 16, 400, { font: sans(400, 44), color: P.sec });
    blockChart(470, 810);
    const hw = (W - PAD * 2 - 18) / 2;
    statTile(PAD, 902, hw, 132, `${s.loggedDays}/7`, t("share.loggedNear", { n: s.nearGoal }), P.ink, 54);
    statTile(PAD + hw + 18, 902, hw, 132, `${s.avgProteinG}g`, t("share.proteinADay"), MARK.protein, 54);
    statTile(PAD, 1050, hw, 132, String(s.workouts), s.workoutKcal ? t("share.workoutsKcal", { n: formatNumber(s.workoutKcal) }) : t("share.workouts"), P.ink, 54);
    const wt = opts.weight && s.weightDeltaKg !== null ? (() => { const x = kgOrLb(s.weightDeltaKg); return [`${x.v > 0 ? "+" : ""}${one(x.v)}`, t("share.weightWeek", { u: x.u })]; })() : [String(one(s.waterPerDay)), t("share.waterAvgShort")];
    statTile(PAD + hw + 18, 1050, hw, 132, wt[0], wt[1], P.ink, 54);
    await footer("SnapCal");
  }

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92));
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/** Holds off automatic updates (js/updater.js) for `ms` from now; 0 releases the hold. */
function busyFor(ms) {
  globalThis.__snapcalBusyUntil = ms > 0 ? Date.now() + ms : 0;
}

/** Tells the server when sharing didn't work on a phone, so it can be fixed (api/auth "clientError"). */
function reportShareProblem(message) {
  try {
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-snapcal-token": localStorage.getItem("snapcal.apiToken") || "" },
      body: JSON.stringify({ op: "clientError", message: `${message}\n[${navigator.userAgent}]` }),
    }).catch(() => {});
  } catch { /* diagnostics only */ }
}

function readOpts() {
  try { return { doodle: true, meals: true, streak: true, weight: false, dark: false, ...(JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") || {}) }; }
  catch { return { doodle: true, meals: true, streak: true, weight: false, dark: false }; }
}
function saveOpts(o) { try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); } catch { /* private mode */ } }

export function openShareSheet({ date = new Date() } = {}) {
  openSheet({
    render(panel, close) {
      let kind = "day";
      const opts = readOpts();
      let file = null;       // prepared ahead, so tapping Share opens the share menu at once (iOS
      let text = "";         // only allows it straight from the tap)
      let url = null;
      let drawing = 0;

      panel.innerHTML = `
        ${navBar({ title: t("share.title"), leading: { label: t("app.close") } })}
        <div class="sheet-panel-body share-body">
          <div class="share-seg" role="group">
            <button type="button" data-kind="day" aria-pressed="true">${t("share.today")}</button>
            <button type="button" data-kind="week" aria-pressed="false">${t("share.week")}</button>
          </div>
          <div class="share-preview"><img id="share-img" alt="${t("share.previewAlt")}" /></div>
          <div class="share-opts">
            ${["dark", "doodle", "meals", "streak", "weight"].map((k) => `<label><input type="checkbox" data-opt="${k}" ${opts[k] ? "checked" : ""}/> ${t(`share.opt.${k}`)}</label>`).join("")}
          </div>
          <button type="button" class="share-primary" id="share-image" disabled>${iconSvg("share", { size: 18 })}<span>${t("share.image")}</span></button>
          <div class="share-actions">
            <button type="button" class="share-ghost" id="share-text">${t("share.asText")}</button>
            <button type="button" class="share-ghost" id="share-copy">${t("share.copy")}</button>
          </div>
          <p class="share-hint" id="share-hint">${t("share.hint")}</p>
          <button type="button" class="share-trouble" id="share-trouble">${t("share.trouble")}</button>
        </div>`;

      const img = panel.querySelector("#share-img");
      const imageBtn = panel.querySelector("#share-image");
      const hint = panel.querySelector("#share-hint");
      const say = (msg) => { hint.textContent = msg; };

      const redraw = async () => {
        const mine = ++drawing;
        imageBtn.disabled = true;
        const s = kind === "day" ? daySummary(date) : weekSummary(date);
        text = summaryText(s, opts);
        let blob = null;
        try { blob = await renderCard(s, opts); } catch (err) { reportShareProblem(`draw card: ${err?.message ?? err}`); }
        if (mine !== drawing) return;
        if (!blob) { say(t("share.drawFailed")); return; }
        // A data: URL, not a blob: link. Pressing and holding the picture (the fallback for apps
        // that refuse the share) must hand over a real JPEG; from a blob: link iPhone passes on
        // a page link, and Instagram answers "file type not supported".
        const dataUrl = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => resolve(null);
          r.readAsDataURL(blob);
        });
        if (mine !== drawing) return;
        if (!dataUrl) { say(t("share.drawFailed")); return; }
        url = dataUrl;
        img.src = url;
        const stamp = kind === "day" ? localDateString(s.date) : `week-${localDateString(s.to)}`;
        // a full copy of the bytes, so the file doesn't depend on this page while another app reads it
        const bytes = await blob.arrayBuffer();
        if (mine !== drawing) return;
        file = new File([bytes], `snapcal-${stamp}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
        imageBtn.disabled = false;
      };

      panel.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
        kind = b.dataset.kind;
        panel.querySelectorAll("[data-kind]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        redraw();
      }));
      panel.querySelectorAll("[data-opt]").forEach((c) => c.addEventListener("change", () => {
        opts[c.dataset.opt] = c.checked;
        saveOpts(opts);
        redraw();
      }));

      // The image itself, big, to press and hold: on iPhone that always offers Save / Share,
      // even where the share menu won't take a file (or a Home Screen app can't "download").
      const showToHold = (hintKey = "share.holdHint") => {
        const hold = document.createElement("div");
        hold.className = "share-hold";
        hold.innerHTML = `<img src="${url}" alt="${t("share.previewAlt")}" /><p>${t(hintKey)}</p>
          <div class="share-actions"><a class="share-ghost" href="${url}" download="${file.name}">${t("share.download")}</a><button type="button" class="share-primary" data-done>${t("share.done")}</button></div>`;
        hold.querySelector("[data-done]").addEventListener("click", () => hold.remove());
        panel.appendChild(hold);
      };

      panel.querySelector("#share-trouble").addEventListener("click", () => { if (file) showToHold(); });

      imageBtn.addEventListener("click", async () => {
        if (!file) return;
        reportShareProblem(`share tap (info): canShare files: ${Boolean(navigator.canShare?.({ files: [file] }))}, ${file.type} ${Math.round(file.size / 1024)} KB, home screen app: ${Boolean(globalThis.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone)}`);
        let why = "no file sharing on this browser";
        // Opera for Android says it can share files but hands other apps a broken one (WhatsApp:
        // "couldn't share", Instagram: "file type not supported", Messages: nothing). Save it
        // to the gallery instead and share from there.
        if (/\bOPR\//.test(navigator.userAgent) && /Android/i.test(navigator.userAgent)) {
          showToHold("share.operaHint");
          return;
        }
        if (navigator.canShare?.({ files: [file] })) {
          busyFor(3 * 60 * 1000); // no automatic update may reload the page mid-share
          let wentHidden = false;
          const onHide = () => { if (document.visibilityState === "hidden") wentHidden = true; };
          document.addEventListener("visibilitychange", onHide);
          const started = Date.now();
          try {
            await navigator.share({ files: [file] });
            reportShareProblem(`share image ok (info): ${file.type} ${Math.round(file.size / 1024)} KB, ${Math.round((Date.now() - started) / 1000)} s, went to background: ${wentHidden}, update waiting: ${updatePending()}`);
            busyFor(30 * 1000); // the other app may still be reading it
            return;
          } catch (err) {
            if (err?.name === "AbortError") { busyFor(0); return; } // they closed the share menu
            why = `${err?.name ?? "Error"}: ${err?.message ?? err}`;
          } finally {
            document.removeEventListener("visibilitychange", onHide);
          }
        }
        reportShareProblem(`share image: ${why}`);
        showToHold();
      });
      panel.querySelector("#share-text").addEventListener("click", async () => {
        try {
          if (navigator.share) { busyFor(60 * 1000); await navigator.share({ text }); busyFor(15 * 1000); return; }
        } catch (err) {
          if (err?.name === "AbortError") return;
          reportShareProblem(`share text: ${err?.name ?? "Error"}: ${err?.message ?? err}`);
        }
        copy();
      });
      const copy = async () => {
        try { await navigator.clipboard.writeText(text); say(t("share.copied")); }
        catch { say(t("share.copyFailed")); }
      };
      panel.querySelector("#share-copy").addEventListener("click", copy);

      wireNavBar(panel, { onLeading: () => close() });
      redraw();
      const p = store.getProfile();
      const variant = p.doodleVariant === "b" ? "b" : "a";
      if (!cachedNanoDoodle("showoff", variant, p.avatar ?? null) && cachedNanoDoodle("strong", variant, p.avatar ?? null)) {
        ensureNanoDoodle("showoff", variant, p.avatar ?? null).then((got) => { if (got && panel.isConnected) redraw(); }).catch(() => {});
      }
    },
    onClosed() { /* object URLs are released with the page */ },
  });
}
