// entry-row.js — RecentEntryRow, shared by Today (§5.4.3) and Progress/History (§6.2).
// Three states (pending / failed / completed), swipeable to delete, tap-routed per §5.4.4.

import { entryState } from "../queue.js";
import { isGroupedEntry } from "../store.js";
import { ANALYSIS_MODES } from "../api.js";
import { icon } from "./icons.js";
import { ringGauge } from "./ring.js";
import { t } from "../i18n.js";

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
    ? `<img src="${entry.photoDataUrl}" alt="" /><div class="scrim"></div>`
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
    return `<div class="${className} is-group has-photo"><img src="${entry.photoDataUrl}" alt="" /><span class="group-badge">${icon("layersFill", { size: 11, color: "#fff" })}${n > 1 ? n : ""}</span></div>`;
  }
  return `<div class="${className} is-group">${icon("layersFill", { size: 22, color: "#fff" })}${count}</div>`;
}

function completedRowHtml(entry) {
  const thumb = entry.photoDataUrl
    ? `<img src="${entry.photoDataUrl}" alt="" />`
    : icon("forkKnife", { size: 18, color: "var(--sc-secondary)" });
  const thumbBox = isGroupedEntry(entry) ? groupThumbHtml(entry) : `<div class="entry-thumb">${thumb}</div>`;
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
      <div class="entry-cal-row"><span class="emoji">\u{1F525}</span><span>${Math.round(entry.calories)} calories</span></div>
      <div class="macro-chip-row">${macroChips}</div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/**
 * Mounts one entry row into `container` (appends). Returns a cleanup() to call before the next
 * re-render (clears the pending-ring ticking interval, if any).
 * @param {HTMLElement} container
 * @param {object} entry
 * @param {{onTap:(entry)=>void, onDelete:(entry)=>void}} handlers
 */
export function mountEntryRow(container, entry, { onTap, onDelete, onShare = null }) {
  const state = entryState(entry);
  const wrap = document.createElement("div");
  wrap.className = "entry-row";
  wrap.dataset.entryId = entry.id;
  wrap.dataset.state = state;
  // No swipe gestures on rows any more: sideways swipes now move between tabs, and a visible
  // bin is quicker than any gesture anyway. Tap the row to edit, tap the bin to remove.
  wrap.innerHTML = `
    <div class="entry-row-fg${state === "failed" ? " failed" : ""}">
      ${state === "pending" ? pendingRowHtml(entry) : state === "failed" ? failedRowHtml(entry) : completedRowHtml(entry)}
    </div>
    ${state === "pending" ? "" : `
      <div class="entry-row-actions">
        ${onShare ? `<button type="button" class="entry-row-share" aria-label="Share">↗︎</button>` : ""}
        <button type="button" class="entry-row-bin" aria-label="Remove">${icon("trashFill", { size: 17 })}</button>
      </div>`}
  `;
  container.appendChild(wrap);

  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".entry-row-bin") || e.target.closest(".entry-row-share")) return;
    onTap(entry);
  });
  wrap.querySelector(".entry-row-share")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true;
    const done = await onShare(entry);
    btn.textContent = done ? "✓" : "↗︎";
    btn.disabled = !done;
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
