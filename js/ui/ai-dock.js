// ai-dock.js — the floating capsule that shows a meal being analysed, on every tab.
//
// After a photo (or a typed meal) goes to the AI, the picture flies from the camera into a
// black capsule above the tab bar: the photo with a dot scan across it, what it's doing now
// ("Weighing the portions…"), a dot-matrix percentage and a row of dots filling in. When the
// answer comes back the capsule says what it found and the calories, and a tap opens the
// meal to check it. It hides itself a few seconds later. Nothing else on screen moves.

import * as store from "../store.js";
import * as queue from "../queue.js";
import { ANALYSIS_MODES } from "../api.js";
import { stageText } from "./chew.js";
import { icon } from "./icons.js";
import { t, formatNumber } from "../i18n.js";

const DOTS = 24;
const DONE_MS = 7000; // how long the "found it" capsule stays
const TICK_MS = 250;

const tracked = new Map(); // entry id -> { seenAt, doneAt?, state? }
let dock = null;
let tick = null;
let hideTimer = null;
let dismissed = null; // id the person closed

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeSrc = (s) => (/^(data:image\/|blob:|https?:)/.test(String(s)) ? esc(s) : "");
const kindOf = (entry) => (entry.analysisMode === "text" ? "text" : entry.analysisMode === "label" ? "label" : "meal");

/** 0–96 %, quick at first and slower as it goes, so it never sits still and never claims done. */
export function progressFor(mode, elapsedMs) {
  const ramp = (ANALYSIS_MODES[mode] ?? ANALYSIS_MODES.meal).pendingRampSeconds * 1000;
  return Math.min(96, Math.floor(96 * (1 - Math.exp(-elapsedMs / (ramp * 0.55)))));
}

/** "Arroz blanco y 2 más" from a finished meal. */
export function foundName(entry) {
  const items = Array.isArray(entry.analysisItems) ? entry.analysisItems : [];
  if (items.length <= 1) return String(items[0]?.name || entry.name || "");
  return t("aiDock.andMore", { name: items[0].name, n: items.length - 1 });
}

function dotsHtml(pct) {
  const on = Math.round((pct / 100) * DOTS);
  return Array.from({ length: DOTS }, (_, i) => `<i${i < on ? ' class="on"' : ""}></i>`).join("");
}

function current() {
  // the newest meal still being read wins; otherwise the newest that just finished
  let pick = null;
  for (const [id, info] of tracked) {
    const entry = store.getFoodEntry(id);
    if (!entry || id === dismissed) continue;
    const rank = info.doneAt ? info.doneAt - 1e13 : info.seenAt;
    if (!pick || rank > pick.rank) pick = { id, entry, info, rank };
  }
  return pick;
}

function ensureDock() {
  if (dock?.isConnected) return dock;
  dock = document.createElement("div");
  dock.id = "ai-dock";
  dock.className = "aid";
  dock.setAttribute("role", "status");
  dock.setAttribute("aria-live", "polite");
  document.body.appendChild(dock);
  requestAnimationFrame(() => requestAnimationFrame(() => dock?.classList.add("is-in")));
  dock.addEventListener("click", (e) => {
    const id = dock?.dataset.id;
    if (!id) return;
    if (e.target.closest("[data-aid-x]")) { dismissed = id; tracked.delete(id); draw(); return; }
    const entry = store.getFoodEntry(id);
    if (!entry || queue.entryState(entry) === "pending") return;
    tracked.delete(id);
    draw();
    openEntry(entry);
  });
  return dock;
}

async function openEntry(entry) {
  if (queue.entryState(entry) === "failed") {
    const m = await import("./failed-meal.js");
    m.openFailedMealSheet(entry, {});
  } else if (Array.isArray(entry.analysisItems) && entry.analysisItems.length > 0) {
    const m = await import("./results.js");
    m.openResultsSheet(entry);
  }
}

function removeDock() {
  clearInterval(tick); tick = null;
  document.documentElement.removeAttribute("data-ai-dock");
  const old = dock;
  dock = null;
  if (!old) return;
  old.classList.remove("is-in");
  setTimeout(() => old.remove(), 300);
}

function draw() {
  const pick = current();
  if (!pick || typeof document === "undefined" || !document.getElementById("app-root")) { removeDock(); return; }
  const { id, entry, info } = pick;
  const el = ensureDock();
  document.documentElement.setAttribute("data-ai-dock", "");
  const state = queue.entryState(entry);
  const kind = kindOf(entry);
  const busy = state === "pending";
  const failed = state === "failed";
  const others = [...tracked.keys()].filter((k) => k !== id && store.getFoodEntry(k) && queue.entryState(store.getFoodEntry(k)) === "pending").length;
  const phase = busy ? "busy" : failed ? "failed" : "done";

  // the photo and the frame are drawn once per meal; the moving parts are updated in place
  if (el.dataset.id !== id || el.dataset.phase !== phase) {
    el.dataset.id = id;
    el.dataset.phase = phase;
    el.className = `aid is-in is-${phase}`;
    const photo = entry.photoDataUrl ? `<img src="${safeSrc(entry.photoDataUrl)}" alt="" />` : `<span class="aid-glyph">${icon("textBubbleFill", { size: 20 })}</span>`;
    const kcal = Math.round(Number(entry.calories) || 0);
    el.innerHTML = `
      <span class="aid-thumb${entry.photoDataUrl ? " has-photo" : ""}">${photo}${busy ? "" : `<span class="aid-badge">${failed ? "!" : icon("checkmark", { size: 11 })}</span>`}</span>
      <span class="aid-text">
        <b class="aid-title">${esc(busy ? t(`chew.title.${kind}`) : failed ? t("aiDock.failed") : foundName(entry))}</b>
        <span class="aid-sub">${esc(busy ? stageText(kind, Date.now() - info.seenAt) : failed ? t("aiDock.failedHint") : t("aiDock.review"))}</span>
      </span>
      <span class="aid-num">${busy ? `<span data-aid-pct>0</span><small>%</small>` : failed ? "" : `${formatNumber(kcal)}<small>kcal</small>`}</span>
      ${busy ? "" : `<button type="button" class="aid-x" data-aid-x aria-label="${esc(t("app.close"))}">${icon("xmark", { size: 13 })}</button>`}
      <span class="aid-dots" aria-hidden="true">${dotsHtml(busy ? 0 : 100)}</span>
      ${others > 0 ? `<span class="aid-more">+${others}</span>` : ""}`;
  }
  clearInterval(tick); tick = null;
  if (busy) {
    const update = () => {
      if (!dock || dock.dataset.id !== id) return;
      const elapsed = Date.now() - info.seenAt;
      const pct = progressFor(entry.analysisMode ?? "meal", elapsed);
      const n = dock.querySelector("[data-aid-pct]");
      if (n) n.textContent = String(pct);
      const dots = dock.querySelectorAll(".aid-dots i");
      const on = Math.round((pct / 100) * DOTS);
      dots.forEach((d, i) => d.classList.toggle("on", i < on));
      const sub = dock.querySelector(".aid-sub");
      const line = stageText(kind, elapsed);
      if (sub && sub.textContent !== line) {
        sub.textContent = line;
        sub.classList.remove("is-new"); void sub.offsetWidth; sub.classList.add("is-new");
      }
    };
    update();
    tick = setInterval(update, TICK_MS);
  }
}

function sync() {
  const now = Date.now();
  let changed = false;
  for (const entry of store.allFoodEntries()) {
    if (entry.isPending === true && !tracked.has(entry.id)) {
      tracked.set(entry.id, { seenAt: now });
      if (dismissed === entry.id) dismissed = null;
      changed = true;
    }
  }
  for (const [id, info] of tracked) {
    const entry = store.getFoodEntry(id);
    if (!entry) { tracked.delete(id); changed = true; continue; }
    if (!info.doneAt && entry.isPending !== true) {
      info.doneAt = now;
      changed = true;
      setTimeout(() => {
        const still = tracked.get(id);
        if (still && still.doneAt === info.doneAt) { tracked.delete(id); draw(); }
      }, DONE_MS);
    }
  }
  if (changed || (dock && !current())) draw();
}

let started = false;
/** Starts watching the log for meals being analysed. Safe to call more than once. */
export function watchAnalysis() {
  if (started || typeof document === "undefined") return;
  started = true;
  // meals already waiting when the app opens show too (counted from now)
  sync();
  store.subscribe(() => { clearTimeout(hideTimer); hideTimer = setTimeout(sync, 0); });
}

/**
 * The one big moment: the photo just taken shrinks from full screen into the capsule's thumbnail.
 * Answers the shutter, so it's allowed to move; skipped for reduced motion.
 */
export function flyPhotoToDock(dataUrl) {
  if (typeof document === "undefined" || !dataUrl) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (started) sync(); // the capsule is there before the photo lands in it
  requestAnimationFrame(() => {
    const target = document.querySelector("#ai-dock .aid-thumb");
    if (!target) return;
    const to = target.getBoundingClientRect();
    const img = document.createElement("img");
    img.className = "aid-fly";
    img.src = dataUrl;
    img.alt = "";
    document.body.appendChild(img);
    target.style.visibility = "hidden";
    const w = window.innerWidth, h = window.innerHeight;
    const done = () => { img.remove(); target.style.visibility = ""; };
    // the real size of the capsule's photo is 52px; it lands there, rounding as it goes
    const anim = img.animate([
      { left: "0px", top: "0px", width: `${w}px`, height: `${h}px`, borderRadius: "0px", opacity: 1 },
      { left: `${w * 0.06}px`, top: `${h * 0.08}px`, width: `${w * 0.88}px`, height: `${h * 0.62}px`, borderRadius: "28px", opacity: 1, offset: 0.35 },
      { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: "14px", opacity: 1 },
    ], { duration: 720, easing: "cubic-bezier(.3,.7,.1,1)", fill: "forwards" });
    anim.onfinish = done;
    anim.oncancel = done;
    setTimeout(done, 1200);
  });
}
