// entry-row.js — RecentEntryRow, shared by Today (§5.4.3) and Progress/History (§6.2).
// Three states (pending / failed / completed), swipeable to delete, tap-routed per §5.4.4.

import { entryState } from "../queue.js";
import { ANALYSIS_MODES } from "../api.js";
import { icon } from "./icons.js";
import { ringGauge } from "./ring.js";

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
  const reason = entry.analysisFailureReason || "Tap to retry";
  return `
    <div class="entry-fail-icon-box">${icon("exclamationTriangleFill", { size: 18, color: "var(--sc-red)" })}</div>
    <div class="entry-fail-body">
      <div class="entry-fail-title">Analysis failed</div>
      <div class="entry-fail-reason">${escapeHtml(reason)}</div>
    </div>
    <div class="entry-fail-chevron">${icon("chevronRight", { size: 13 })}</div>
  `;
}

function completedRowHtml(entry) {
  const thumb = entry.photoDataUrl
    ? `<img src="${entry.photoDataUrl}" alt="" />`
    : icon("forkKnife", { size: 18, color: "var(--sc-secondary)" });
  const macroChips = MACRO_META.map(
    (m) => `
      <div class="macro-chip">
        ${icon(m.icon, { size: 11, color: m.color })}
        <span class="macro-chip-value">${Math.round(entry[m.key] ?? 0)}g</span>
      </div>`
  ).join("");
  return `
    <div class="entry-thumb">${thumb}</div>
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
export function mountEntryRow(container, entry, { onTap, onDelete }) {
  const state = entryState(entry);
  const wrap = document.createElement("div");
  wrap.className = "entry-row";
  wrap.innerHTML = `
    <div class="entry-row-swipe-bg">${icon("trashFill", { size: 20, color: "#fff" })}</div>
    <div class="entry-row-fg${state === "failed" ? " failed" : ""}">
      ${state === "pending" ? pendingRowHtml(entry) : state === "failed" ? failedRowHtml(entry) : completedRowHtml(entry)}
    </div>
  `;
  container.appendChild(wrap);

  const fg = wrap.querySelector(".entry-row-fg");
  wireSwipe(wrap, fg, {
    onTap: () => onTap(entry),
    onDelete: () => onDelete(entry),
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

function wireSwipe(rowEl, fgEl, { onTap, onDelete }) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let decided = false; // whether we've decided this gesture is horizontal
  let horizontal = false;

  // A full 80px throw was more commitment than this deserves. 52px deletes outright; anything
  // past 24px parks the row open so the trash button can simply be tapped instead.
  const DELETE_THRESHOLD = -52;
  const OPEN_OFFSET = -76;

  const onPointerDown = (e) => {
    const point = e.touches ? e.touches[0] : e;
    startX = point.clientX;
    startY = point.clientY;
    dx = 0;
    dragging = true;
    decided = false;
    horizontal = false;
    fgEl.style.transition = "none";
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const point = e.touches ? e.touches[0] : e;
    const moveX = point.clientX - startX;
    const moveY = point.clientY - startY;
    if (!decided) {
      if (Math.abs(moveX) > 6 || Math.abs(moveY) > 6) {
        decided = true;
        horizontal = Math.abs(moveX) > Math.abs(moveY);
      }
    }
    if (decided && horizontal) {
      if (e.cancelable) e.preventDefault();
      rowEl.classList.add("dragging");
      dx = Math.min(0, moveX);
      fgEl.style.transform = `translateX(${dx}px)`;
    }
  };

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    fgEl.style.transition = "";
    if (!decided) {
      if (rowEl.classList.contains("is-open")) {
        fgEl.style.transition = "transform 0.22s ease-out";
        fgEl.style.transform = "";
        rowEl.classList.remove("is-open", "dragging");
      } else {
        onTap();
      }
      return;
    }
    if (!horizontal) {
      fgEl.style.transform = "";
      return;
    }
    if (dx < DELETE_THRESHOLD) {
      fgEl.style.transition = "transform 0.2s ease-out";
      fgEl.style.transform = "translateX(-400px)";
      setTimeout(onDelete, 200);
    } else if (dx < -24) {
      // parked open: the red panel stays put, one tap on it removes the meal
      fgEl.style.transition = "transform 0.22s cubic-bezier(0.2,0.8,0.3,1)";
      fgEl.style.transform = `translateX(${OPEN_OFFSET}px)`;
      rowEl.classList.add("is-open");
    } else {
      fgEl.style.transition = "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)";
      fgEl.style.transform = "";
      rowEl.classList.remove("is-open");
      setTimeout(() => rowEl.classList.remove("dragging"), 300);
    }
  };

  const bg = rowEl.querySelector(".entry-row-swipe-bg");
  bg?.addEventListener("click", (e) => {
    if (!rowEl.classList.contains("is-open")) return;
    e.stopPropagation();
    fgEl.style.transition = "transform 0.2s ease-out";
    fgEl.style.transform = "translateX(-400px)";
    setTimeout(onDelete, 200);
  });

  rowEl.addEventListener("touchstart", onPointerDown, { passive: true });
  rowEl.addEventListener("touchmove", onPointerMove, { passive: false });
  rowEl.addEventListener("touchend", endDrag);
  rowEl.addEventListener("touchcancel", endDrag);

  // Mouse fallback for desktop testing.
  rowEl.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", (e) => {
    if (dragging) onPointerMove(e);
  });
  window.addEventListener("mouseup", () => {
    if (dragging) endDrag();
  });
}
