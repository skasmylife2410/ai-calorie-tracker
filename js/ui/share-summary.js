// share-summary.js — "Share" on the calorie card: a clean summary of a day or a week, as a
// 1080×1350 image (4:5, shown uncropped by Instagram and WhatsApp) or as plain text, handed to
// the phone's own share menu so it can go to any app. Nothing is uploaded by SnapCal itself.
//
// The builders (daySummary / weekSummary / summaryText) are pure so they can be tested; the
// card is drawn on a canvas; the sheet ties them together.

import * as store from "../store.js";
import { t, formatNumber, formatDate } from "../i18n.js";
import { startOfDay, addDays, localDateString } from "../nutrition.js";
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
    .map((e) => ({ name: e.name, calories: Math.round(e.calories), kind: foodCategory(e) }));
  const latest = store.latestWeight();
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
  };
}

/** The seven days ending on `date` (so a week shared on Sunday is Monday to Sunday). */
export function weekSummary(date = new Date()) {
  const end = startOfDay(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6)).map((ts) => {
    const list = store.entriesForDay(ts).filter(done);
    const tot = store.totalsForDay(ts);
    return {
      ts, key: localDateString(ts), logged: list.length > 0,
      calories: Math.round(tot.calories), proteinG: tot.proteinG,
      goal: store.dayEnergy(ts).adjustedTarget,
      workouts: store.exerciseForDay(ts).length,
      water: store.getWaterEntryForDay(ts).glasses ?? 0,
    };
  });
  const logged = days.filter((d) => d.logged);
  const avg = (k) => (logged.length ? logged.reduce((s, d) => s + d[k], 0) / logged.length : 0);
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
function showoffDoodle() {
  const p = store.getProfile();
  const variant = p.doodleVariant === "b" ? "b" : "a";
  const nano = cachedNanoDoodle("showoff", variant, p.avatar ?? null);
  if (nano) return { kind: "img", src: nano };
  const face = p.avatar ? cachedFaceDoodle(p.avatar) : null;
  const svg = doodleSvg({ state: "showoff", variant, size: 300, face })
    .replaceAll("var(--sc-primary-text)", INK).replaceAll("var(--sc-secondary)", SEC);
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
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // paper with the faint dot grid
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.07)";
  for (let y = 24; y < H; y += 48) for (let x = 24; x < W; x += 48) { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); }

  // the flame, top left; the date, top right
  ctx.save();
  ctx.translate(PAD, PAD - 6);
  ctx.scale(66 / 282, 66 / 282);
  ctx.translate(-146, -120);
  ctx.fillStyle = INK;
  ctx.fill(new Path2D(FLAME_PATH), "evenodd");
  ctx.restore();
  ctx.fillStyle = SEC; ctx.font = `600 38px ${SANS}`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.fillText((s.kind === "day" ? dayLabel(s.date) : rangeLabel(s.from, s.to)).toUpperCase(), W - PAD, PAD + 28);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";

  // the big number
  ctx.fillStyle = INK; ctx.font = `900 ${opts.doodle === false ? 190 : 164}px "Doto", ${SANS}`;
  const bigText = formatNumber(s.kind === "day" ? s.eaten : s.avgCalories);
  ctx.fillText(bigText, PAD - 6, 360);
  if (opts.doodle !== false) {
    // the doodle showing off, in the room to the right of the big number
    const room = W - PAD - (PAD + ctx.measureText(bigText).width + 24);
    const size = Math.min(340, room);
    if (size >= 150) {
      const d = showoffDoodle();
      let im = d.kind === "img" ? await urlImage(d.src) : await svgImage(d.svg);
      if (im && d.kind === "img") {
        // Nano Banana's drawing in plain ink, like the rest of the card
        const ink = document.createElement("canvas");
        ink.width = im.width; ink.height = im.height;
        const ic = ink.getContext("2d");
        ic.drawImage(im, 0, 0);
        ic.globalCompositeOperation = "source-in";
        ic.fillStyle = INK; ic.fillRect(0, 0, ink.width, ink.height);
        im = ink;
      }
      if (im) {
        const h = size * (im.height && im.width ? im.height / im.width : 1.08);
        ctx.drawImage(im, W - PAD - size + 10, 118 + Math.max(0, (330 - h) / 2), size, Math.min(h, 340));
      }
    }
  }
  ctx.fillStyle = SEC; ctx.font = `400 44px ${SANS}`;
  ctx.fillText(s.kind === "day" ? t("share.ofGoal", { goal: formatNumber(s.goal) }) : t("share.avgOfGoal", { goal: formatNumber(s.goal) }), PAD, 428);

  const flameImg = opts.streak !== false && s.streak > 0 ? await svgImage(iconSvg("flameFill", { size: 40, color: MARK.flame })) : null;
  const footer = (left) => {
    ctx.fillStyle = LINE; ctx.fillRect(PAD, H - PAD - 70, W - PAD * 2, 2);
    ctx.fillStyle = SEC; ctx.font = `400 36px ${SANS}`; ctx.textBaseline = "middle";
    ctx.fillText(fitText(ctx, left, 560), PAD, H - PAD - 22);
    if (flameImg) {
      ctx.textAlign = "right";
      const txt = t("share.streakN", { n: s.streak });
      ctx.fillText(txt, W - PAD, H - PAD - 22);
      ctx.drawImage(flameImg, W - PAD - ctx.measureText(txt).width - 50, H - PAD - 42, 40, 40);
      ctx.textAlign = "left";
    }
    ctx.textBaseline = "alphabetic";
  };

  if (s.kind === "day") {
    // bar with the goal line at 80%, red past it
    const bx = PAD, bw = W - PAD * 2, by = 476, bh = 34, GOAL_AT = 0.8;
    ctx.fillStyle = TRACK; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
    const within = s.goal > 0 ? Math.min(s.eaten, s.goal) / s.goal : 0;
    const over = s.goal > 0 ? Math.min(0.2, (Math.max(0, s.eaten - s.goal) / s.goal) * GOAL_AT) : 0;
    ctx.save(); roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.clip();
    ctx.fillStyle = INK; ctx.fillRect(bx, by, bw * GOAL_AT * within, bh);
    if (over > 0) { ctx.fillStyle = MARK.over; ctx.fillRect(bx + bw * GOAL_AT, by, bw * over, bh); }
    ctx.restore();
    ctx.fillStyle = INK; ctx.fillRect(bx + bw * GOAL_AT - 2, by - 10, 4, bh + 20);
    ctx.font = `700 42px ${SANS}`; ctx.fillStyle = INK;
    const lt = s.remaining >= 0 ? t("share.leftN", { n: formatNumber(s.remaining) }) : t("share.overN", { n: formatNumber(-s.remaining) });
    ctx.fillText(lt, PAD, 566);

    // macros with their dots
    let x = PAD; ctx.font = `400 38px ${SANS}`;
    for (const [c, g, k] of [[MARK.protein, s.proteinG, "share.protein"], [MARK.carbs, s.carbsG, "share.carbs"], [MARK.fat, s.fatG, "share.fat"]]) {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 11, 630, 11, 0, Math.PI * 2); ctx.fill();
      x += 32;
      ctx.fillStyle = INK; ctx.font = `700 38px ${SANS}`; const num = `${g} g `; ctx.fillText(num, x, 643); x += ctx.measureText(num).width;
      ctx.fillStyle = SEC; ctx.font = `400 38px ${SANS}`; const lab = t(k); ctx.fillText(lab, x, 643); x += ctx.measureText(lab).width + 44;
    }

    ctx.fillStyle = LINE; ctx.fillRect(PAD, 700, W - PAD * 2, 2);
    let y = 760;
    if (opts.meals !== false && s.meals.length) {
      const shown = s.meals.slice(0, MEALS_SHOWN);
      const icons = await Promise.all(shown.map((m) => svgImage(foodIconSvg(m.kind, { size: 44 }))));
      shown.forEach((m, i) => {
        ctx.fillStyle = "#F0F0F0"; roundRect(ctx, PAD, y - 38, 76, 76, 20); ctx.fill();
        if (icons[i]) ctx.drawImage(icons[i], PAD + 16, y - 22, 44, 44);
        ctx.fillStyle = INK; ctx.font = `400 44px ${SANS}`; ctx.textBaseline = "middle";
        ctx.textAlign = "right"; ctx.font = `700 44px ${SANS}`; ctx.fillText(formatNumber(m.calories), W - PAD, y);
        const kw = ctx.measureText(formatNumber(m.calories)).width;
        ctx.textAlign = "left"; ctx.font = `400 44px ${SANS}`;
        ctx.fillText(fitText(ctx, m.name, W - PAD * 2 - 110 - kw - 30), PAD + 106, y);
        ctx.textBaseline = "alphabetic";
        y += 100;
      });
      if (s.meals.length > MEALS_SHOWN) { ctx.fillStyle = SEC; ctx.font = `400 36px ${SANS}`; ctx.fillText(t("share.moreN", { n: s.meals.length - MEALS_SHOWN }), PAD + 106, y - 26); }
    } else {
      ctx.fillStyle = SEC; ctx.font = `400 40px ${SANS}`;
      ctx.fillText(t("us.mealsCount", { n: s.meals.length }), PAD, y);
    }
    const left = [s.water ? t("us.glassesOfWater", { n: s.water }) : null,
      opts.weight && s.weightKg ? (() => { const w = kgOrLb(s.weightKg); return `${one(w.v)} ${w.u}`; })() : null].filter(Boolean).join(" · ");
    footer(left);
  } else {
    // seven bars: ink up to the goal, a red cap past it, a ring when within 10%, dashed when missed
    const cx = PAD, cw = W - PAD * 2, top = 490, ch = 330, n = s.days.length;
    const scaleTop = Math.max(s.goal * 1.3, ...s.days.map((d) => d.calories), 1);
    const hOf = (v) => (v / scaleTop) * ch;
    const slot = cw / n, bw = 58;
    const base = top + ch;
    const gy = base - hOf(s.goal);
    ctx.strokeStyle = SEC; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx + cw, gy); ctx.stroke(); ctx.setLineDash([]);
    s.days.forEach((d, i) => {
      const x = cx + slot * i + (slot - bw) / 2;
      const near = d.logged && d.goal > 0 && Math.abs(d.calories - d.goal) <= d.goal * 0.1;
      if (!d.logged) {
        ctx.strokeStyle = "#CFCFCF"; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
        roundRect(ctx, x, top + 20, bw, ch - 20, 10); ctx.stroke(); ctx.setLineDash([]);
      } else {
        const within = Math.min(d.calories, d.goal || d.calories), over = Math.max(0, d.calories - (d.goal || d.calories));
        const hw = Math.max(6, hOf(within)), ho = Math.min(hOf(over), ch - hw);
        if (near) { ctx.strokeStyle = INK; ctx.lineWidth = 4; roundRect(ctx, x - 8, base - hw - 8, bw + 16, hw + 16, 16); ctx.stroke(); }
        ctx.fillStyle = INK; roundRect(ctx, x, base - hw, bw, hw, 10); ctx.fill();
        if (ho > 0) { ctx.fillStyle = MARK.over; roundRect(ctx, x, base - hw - ho - 4, bw, ho, 10); ctx.fill(); }
      }
      ctx.fillStyle = near ? INK : SEC; ctx.font = `${near ? 700 : 400} 34px ${SANS}`; ctx.textAlign = "center";
      ctx.fillText(formatDate(d.ts, { weekday: "narrow" }), x + bw / 2, base + 56);
      ctx.textAlign = "left";
    });

    // four numbers
    const stats = [
      [`${s.loggedDays}/7`, t("share.daysLogged")],
      [String(s.nearGoal), t("share.nearGoal")],
      [`${s.avgProteinG}g`, t("share.avgProtein")],
      opts.weight && s.weightDeltaKg !== null
        ? (() => { const w = kgOrLb(s.weightDeltaKg); return [`${w.v > 0 ? "+" : ""}${one(w.v)}`, t("share.weightWeek", { u: w.u })]; })()
        : [String(s.workouts), t("share.workouts")],
    ];
    stats.forEach(([v, l], i) => {
      const x = PAD + (i % 2) * ((W - PAD * 2) / 2), y = 1000 + Math.floor(i / 2) * 120;
      ctx.fillStyle = INK; ctx.font = `900 76px "Doto", ${SANS}`; ctx.fillText(v, x - 4, y);
      ctx.fillStyle = SEC; ctx.font = `400 34px ${SANS}`; ctx.fillText(l, x, y + 42);
    });
    footer(s.waterPerDay > 0 ? t("share.waterPerDay", { n: s.waterPerDay }) : "");
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
  try { return { doodle: true, meals: true, streak: true, weight: false, ...(JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") || {}) }; }
  catch { return { doodle: true, meals: true, streak: true, weight: false }; }
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
            ${["doodle", "meals", "streak", "weight"].map((k) => `<label><input type="checkbox" data-opt="${k}" ${opts[k] ? "checked" : ""}/> ${t(`share.opt.${k}`)}</label>`).join("")}
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
      const showToHold = () => {
        const hold = document.createElement("div");
        hold.className = "share-hold";
        hold.innerHTML = `<img src="${url}" alt="${t("share.previewAlt")}" /><p>${t("share.holdHint")}</p>
          <div class="share-actions"><a class="share-ghost" href="${url}" download="${file.name}">${t("share.download")}</a><button type="button" class="share-primary" data-done>${t("share.done")}</button></div>`;
        hold.querySelector("[data-done]").addEventListener("click", () => hold.remove());
        panel.appendChild(hold);
      };

      panel.querySelector("#share-trouble").addEventListener("click", () => { if (file) showToHold(); });

      imageBtn.addEventListener("click", async () => {
        if (!file) return;
        reportShareProblem(`share tap (info): canShare files: ${Boolean(navigator.canShare?.({ files: [file] }))}, ${file.type} ${Math.round(file.size / 1024)} KB, home screen app: ${Boolean(globalThis.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone)}`);
        let why = "no file sharing on this browser";
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
