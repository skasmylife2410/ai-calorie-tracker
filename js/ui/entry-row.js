// entry-row.js — RecentEntryRow, shared by Today (§5.4.3) and Progress/History (§6.2).
// Three states (pending / failed / completed), swipeable to delete, tap-routed per §5.4.4.

import { safeSrc } from "../safe-src.js";
import { entryState, isWaitingForAi } from "../queue.js";
import { isGroupedEntry, isFavorited, itemsOfEntry } from "../store.js";
import { ANALYSIS_MODES } from "../api.js";
import { icon } from "./icons.js";
import { foodCategory, foodIconSvg } from "./food-icons.js";
import { ringGauge } from "./ring.js";
import { t } from "../i18n.js";
import { sureBadgeHtml } from "./questions.js";

const MACRO_META = [
  { key: "proteinG", label: "P", icon: "fishFill", color: "var(--sc-protein)" },
  { key: "carbsG", label: "C", icon: "leafFill", color: "var(--sc-carbs)" },
  { key: "fatG", label: "F", icon: "dropFill", color: "var(--sc-fat)" },
];

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function pendingRampInfo(entry) {
  const mode = entry.analysisMode ?? "meal";
  const info = ANALYSIS_MODES[mode] ?? ANALYSIS_MODES.meal;
  const elapsedMs = Date.now() - entry.timestamp;
  const rampMs = info.pendingRampSeconds * 1000;
  const pct = Math.min(90, Math.floor((elapsedMs / rampMs) * 90));
  return pct;
}

function pendingRowHtml(entry) {
  const pct = pendingRampInfo(entry);
  const thumbInner = entry.photoDataUrl
    ? `<img src="${safeSrc(entry.photoDataUrl)}" alt="" /><div class="scrim"></div>`
    : `${icon("textBubbleFill", { size: 20, color: "rgba(255,255,255,0.55)" })}`;
  const ring = ringGauge({
    size: 34,
    strokeWidth: 3,
    progress: pct / 100,
    color: "#fff",
    trackColor: "rgba(255,255,255,0.3)",
  });
  return `
    <div class="entry-thumb-pending">
      ${thumbInner}
      <div class="pending-ring-wrap" data-pending-ring>
        ${ring}
        <div class="pending-ring-pct" data-pending-pct>${pct}%</div>
      </div>
    </div>
    <div class="entry-body">
      <div class="entry-pending-title">${entry.name}</div>
      <div class="shimmer-bars">
        <div class="shimmer-bar" style="width:100%"></div>
        <div class="shimmer-bar" style="width:70%"></div>
        <div class="shimmer-bar" style="width:50%"></div>
      </div>
      <div class="entry-pending-footer">We'll notify you when done!</div>
    </div>
  `;
}

function failedRowHtml(entry) {
  // saved while the AI was under repair: nothing went wrong on their side, it's waiting its turn
  if (isWaitingForAi(entry)) {
    return `
    <div class="entry-fail-icon-box is-waiting${entry.photoDataUrl ? " has-photo" : ""}">${entry.photoDataUrl ? `<img src="${safeSrc(entry.photoDataUrl)}" alt="" />` : icon("boltSlashFill", { size: 18 })}</div>
    <div class="entry-fail-body">
      <div class="entry-fail-title">${t("repair.rowTitle")}</div>
      <div class="entry-fail-reason">${t("repair.rowBody")}</div>
    </div>
    <div class="entry-fail-chevron">${icon("chevronRight", { size: 13 })}</div>
  `;
  }
  const reason = entry.analysisFailureReason || t("ui.tapRetry");
  return `
    <div class="entry-fail-icon-box">${icon("exclamationTriangleFill", { size: 18, color: "var(--sc-red)" })}</div>
    <div class="entry-fail-body">
      <div class="entry-fail-title">${t("ui.analysisFailed")}</div>
      <div class="entry-fail-reason">${escapeHtml(reason)}</div>
    </div>
    <div class="entry-fail-chevron">${icon("chevronRight", { size: 13 })}</div>
  `;
}

/** A grouped meal: the layers icon, with how many foods it holds. */
export function groupThumbHtml(entry, { className = "entry-thumb" } = {}) {
  const n = Array.isArray(entry.analysisItems) ? entry.analysisItems.length : Array.isArray(entry.items) ? entry.items.length : 0;
  const count = n > 1 ? `<span class="group-count" aria-hidden="true">${n}</span>` : "";
  if (entry.photoDataUrl) {
    return `<div class="${className} is-group has-photo"><img src="${safeSrc(entry.photoDataUrl)}" alt="" /><span class="group-badge">${icon("stack", { size: 11, color: "#fff" })}${n > 1 ? n : ""}</span>${sureBadgeHtml(entry)}</div>`;
  }
  return `<div class="${className} is-group">${icon("stack", { size: 24, color: "var(--sc-background, #fff)" })}${count}</div>`;
}

function completedRowHtml(entry) {
  // No photo: a glyph for the kind of food (fruit, meat, a drink…), sorted from the names.
  const kind = foodCategory(entry);
  const thumbBox = isGroupedEntry(entry)
    ? groupThumbHtml(entry)
    : entry.photoDataUrl
      ? `<div class="entry-thumb"><img src="${safeSrc(entry.photoDataUrl)}" alt="" />${sureBadgeHtml(entry)}</div>`
      : `<div class="entry-thumb is-food" data-food="${kind}">${foodIconSvg(kind, { size: 22 })}${sureBadgeHtml(entry)}</div>`;
  const asking = Array.isArray(entry.analysisQuestions) && entry.analysisQuestions.length > 0;
  const sizing = !asking && Number(entry.analysisSizeCheck) > 0;
  const macroChips = MACRO_META.map(
    (m) => `
      <div class="macro-chip">
        ${icon(m.icon, { size: 11, color: m.color })}
        <span class="macro-chip-value">${Math.round(entry[m.key] ?? 0)}g</span>
      </div>`
  ).join("");
  return `
    ${thumbBox}
    <div class="entry-complete-body">
      <div class="entry-title-row">
        <div class="entry-name">${escapeHtml(entry.name)}</div>
        <div class="entry-time">${formatTime(entry.timestamp)}</div>
      </div>
      <div class="entry-cal-row"><span class="entry-kcal">${Math.round(entry.calories)} kcal</span>${asking
        ? `<span class="entry-ask">${t("ask.rowCta", { n: entry.analysisQuestions.length })}</span>`
        : sizing ? `<span class="entry-ask">${t("size.rowCta")}</span>`
        : Number(entry.leftovers?.removedKcal) > 0 ? `<span class="entry-leftover">${icon("plateHalf", { size: 12 })}${t("left.mark", { n: Math.round(entry.leftovers.removedKcal).toLocaleString() })}</span>`
        : `<span class="entry-kind">${t(`food.${kind}`)}</span>`}</div>
      <div class="macro-chip-row">${macroChips}</div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// stacks whose foods are showing, so a redraw of the list keeps them open
const openFoods = new Set();

/**
 * Mounts one entry row into `container` (appends). Returns a cleanup() to call before the next
 * re-render (clears the pending-ring ticking interval, if any).
 * @param {HTMLElement} container
 * @param {object} entry
 * @param {{onTap:(entry)=>void, onDelete:(entry)=>void, onShare?:Function, onFavorite?:Function,
 *   onCopyToday?:Function, footer?:boolean, grip?:boolean, onDetach?:(entry, index)=>void,
 *   select?:{on:boolean, selected:boolean, onToggle:(entry)=>void}}} handlers
 *   select: the list is in Select mode: the row shows a check and a tap selects it instead of opening
 *   footer: the buttons sit on a line of their own, so the name has the whole width and Share can
 *   say what it does. grip: the dots that say the meal can be held and moved.
 *   onDetach: a stacked meal shows "2 foods", which opens its foods, each with Detach
 */
export function mountEntryRow(container, entry, { onTap, onDelete, onShare = null, onFavorite = null, onCopyToday = null, footer = false, grip = false, onDetach = null, select = null }) {
  const state = entryState(entry);
  const wrap = document.createElement("div");
  const selecting = Boolean(select?.on) && state !== "pending";
  const foot = footer && !selecting;
  wrap.className = `entry-row${foot ? " has-foot" : ""}${grip && !selecting ? " has-grip" : ""}${selecting ? " is-selecting" : ""}${selecting && select.selected ? " is-selected" : ""}`;
  wrap.dataset.entryId = entry.id;
  wrap.dataset.state = state;
  const fav = onFavorite && state !== "pending" && state !== "failed" ? isFavorited(entry) : false;
  // Share says where it goes; once the meal is in the feed it says so, and opens the feed
  const sharedInner = `${icon("checkmark", { size: 13 })}<span>${t("feedShare.shared")}</span>`;
  const shareBtn = !onShare ? ""
    : Number(entry.sharedAt) > 0
      ? `<button type="button" class="entry-row-share is-shared" aria-label="${t("feedShare.sharedLabel")}">${sharedInner}</button>`
      : `<button type="button" class="entry-row-share" aria-label="${t("feedShare.label")}">${icon("feedShare", { size: 17 })}<span>${t("feedShare.short")}</span></button>`;
  // a meal from an earlier day offers "+ Today" where today's meals offer Share
  const acts = selecting || state === "pending" ? [] : [
    onCopyToday && state !== "failed" ? `<button type="button" class="entry-row-today" aria-label="${t("stack.toToday")}">${icon("plus", { size: 14 })}<span>${t("stack.todayShort")}</span></button>`
      : shareBtn,
    onFavorite && !onCopyToday && state !== "failed" ? `<button type="button" class="entry-row-fav${fav ? " is-on" : ""}" aria-pressed="${fav}" aria-label="${t("stack.favourite")}">${fav ? "♥" : "♡"}</button>` : "",
    `<button type="button" class="entry-row-bin" aria-label="Remove">${icon("trashFill", { size: 17 })}</button>`,
  ].filter(Boolean);
  // room the buttons take, so the name and time never run under them ("+ Today" is wider)
  const actsWidth = acts.reduce((w, html) => w + (html.includes("entry-row-today") ? 86 : 44), 0);
  wrap.style.setProperty("--acts-w", `${actsWidth}px`);
  // No swipe gestures on rows any more: sideways swipes now move between tabs, and a visible
  // bin is quicker than any gesture anyway. Tap the row to edit, tap the bin to remove.
  const actsHtml = acts.length ? `<div class="entry-row-actions">${acts.join("")}</div>` : "";
  // a stack's foods, each one detachable (in case it was stacked by mistake)
  const foods = onDetach && foot && state !== "pending" && state !== "failed" && isGroupedEntry(entry) ? itemsOfEntry(entry) : [];
  const canDetach = foods.length > 1;
  const foodsOpen = canDetach && openFoods.has(entry.id);
  const foodsChip = canDetach
    ? `<button type="button" class="entry-foods-btn" aria-expanded="${foodsOpen}">${icon(foodsOpen ? "chevronUp" : "chevronDown", { size: 12 })}<span>${t("stack.foods", { n: foods.length })}</span></button>`
    : "<span></span>";
  const foodsHtml = foodsOpen ? `
      <div class="entry-foods">
        ${foods.map((f, i) => `
          <div class="entry-food">
            <span class="entry-food-text"><b>${escapeHtml(f.name)}</b><small>${Math.round(f.calories)} kcal${Number(f.gramsEstimate) > 0 ? ` · ${Math.round(f.gramsEstimate)} g` : ""}</small></span>
            <button type="button" class="entry-detach" data-detach="${i}" aria-label="${t("stack.detachOne", { name: escapeHtml(f.name) })}">${t("stack.detach")}</button>
          </div>`).join("")}
      </div>` : "";
  wrap.innerHTML = `
    <div class="entry-row-fg${state === "failed" ? " failed" : ""}">
      ${grip && !selecting ? `<span class="entry-grip" aria-hidden="true"></span>` : ""}
      ${state === "pending" ? pendingRowHtml(entry) : state === "failed" ? failedRowHtml(entry) : completedRowHtml(entry)}
      ${foot ? `<div class="entry-foot">${foodsChip}${actsHtml}</div>${foodsHtml}` : ""}
    </div>
    ${foot ? "" : actsHtml}
    ${selecting ? `<span class="entry-row-check" aria-hidden="true">${select.selected ? icon("checkmark", { size: 14 }) : ""}</span>` : ""}
  `;
  if (selecting) { wrap.setAttribute("role", "checkbox"); wrap.setAttribute("aria-checked", String(Boolean(select.selected))); }
  container.appendChild(wrap);

  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".entry-row-actions, .entry-foot, .entry-foods")) return;
    if (selecting) { select.onToggle(entry); return; }
    // an unsure analysis with questions waiting: ask them first
    if (state !== "pending" && Array.isArray(entry.analysisQuestions) && entry.analysisQuestions.length > 0) {
      import("./questions.js").then((m) => m.openQuestionsSheet(entry));
      return;
    }
    // rich food with nothing to show its size: one more photo first
    if (state !== "pending" && Number(entry.analysisSizeCheck) > 0) {
      import("./size-check.js").then((m) => m.openSizeCheckSheet(entry));
      return;
    }
    onTap(entry);
  });
  wrap.querySelector(".entry-row-share")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    if (btn.classList.contains("is-shared")) { globalThis.snapcalGoTo?.("shared"); return; }
    btn.disabled = true;
    const done = await onShare(entry);
    btn.disabled = false;
    if (!done) return;
    btn.classList.add("is-shared");
    btn.setAttribute("aria-label", t("feedShare.sharedLabel"));
    btn.innerHTML = sharedInner;
  });
  // "2 foods": show or hide what the stack holds
  wrap.querySelector(".entry-foods-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (openFoods.has(entry.id)) openFoods.delete(entry.id);
    else openFoods.add(entry.id);
    const tmp = document.createElement("div");
    mountEntryRow(tmp, entry, { onTap, onDelete, onShare, onFavorite, onCopyToday, footer, grip, onDetach, select });
    wrap.replaceWith(tmp.firstElementChild);
  });
  wrap.querySelectorAll("[data-detach]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    onDetach(entry, Number(b.dataset.detach));
  }));
  wrap.querySelector(".entry-row-fav")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = onFavorite(entry);
    const b = e.currentTarget;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "♥" : "♡";
  });
  wrap.querySelector(".entry-row-today")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.currentTarget;
    onCopyToday(entry);
    b.classList.add("is-done");
    b.innerHTML = `${icon("checkmark", { size: 14 })}<span>${t("stack.todayShort")}</span>`;
    b.disabled = true;
  });
  wrap.querySelector(".entry-row-bin")?.addEventListener("click", (e) => {
    e.stopPropagation();
    wrap.classList.add("is-removing");
    // let the fade play before the list re-renders without this row
    setTimeout(() => onDelete(entry), 180);
  });

  let intervalId = null;
  if (state === "pending") {
    intervalId = setInterval(() => {
      const pct = pendingRampInfo(entry);
      const pctEl = wrap.querySelector("[data-pending-pct]");
      if (pctEl) pctEl.textContent = `${pct}%`;
      const ringWrap = wrap.querySelector("[data-pending-ring]");
      const progressCircle = ringWrap?.querySelector(".ring-progress");
      if (progressCircle) {
        const r = Number(progressCircle.getAttribute("r"));
        const circumference = 2 * Math.PI * r;
        progressCircle.setAttribute("stroke-dashoffset", String(circumference * (1 - pct / 100)));
      }
    }, 300);
  }

  return () => {
    if (intervalId) clearInterval(intervalId);
  };
}
