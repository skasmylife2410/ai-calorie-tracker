// meal-drag.js — hold a logged meal, drag it onto another, let go: they become one meal.
//
// Hold ~0.35 s to pick a meal up (a quick touch is still a tap, and moving straight away is still
// a scroll). While a meal is held, page scrolling, the sideways tab swipe and the sheet's
// pull-to-close are all paused, so the finger only moves the meal. Works with a mouse too.

import { t } from "../i18n.js";
import * as store from "../store.js";

/**
 * Only finished meals can be picked up or dropped on. queue.entryState() calls these
 * "completedWithItems" and "completedPlain" (never plain "completed").
 */
export function isGroupableState(state) {
  return state === "completedWithItems" || state === "completedPlain";
}

/** canDrag for a list built with mountEntryRow: reads the row's data-state. */
export function rowIsGroupable(list, id) {
  const row = [...list.querySelectorAll(".entry-row[data-entry-id]")].find((r) => r.dataset.entryId === id);
  return isGroupableState(row?.dataset.state);
}

const HOLD_MS = 350;
const SLOP = 8; // px the finger may wander during the hold before it counts as a scroll
const EDGE_SCROLL = 70; // px from the top/bottom of the screen that scroll the list while dragging

/**
 * @param {HTMLElement} list  container whose direct children are .entry-row elements with data-entry-id
 * @param {{canDrag:(id:string)=>boolean, onDrop:(sourceId:string, targetId:string)=>void}} opts
 * @returns {() => void} cleanup
 */
export function wireMealDrag(list, { canDrag, onDrop }) {
  let timer = null;
  let start = null;       // {x, y}
  let sourceRow = null;
  let ghost = null;
  let target = null;
  let lifted = false;
  let offset = { x: 0, y: 0 };
  let scroller = null;
  let scrollRaf = null;
  let last = { x: 0, y: 0 };
  let suppressClick = false;

  const rowAt = (x, y) => {
    if (ghost) ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(x, y);
    if (ghost) ghost.style.visibility = "";
    const row = el?.closest?.(".entry-row[data-entry-id]");
    if (!row || row === sourceRow || !list.contains(row)) return null;
    return canDrag(row.dataset.entryId) ? row : null;
  };

  const scrollParent = (el) => {
    for (let n = el?.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement;
  };

  const cancelHold = () => {
    clearTimeout(timer);
    timer = null;
  };

  const lift = () => {
    timer = null;
    lifted = true;
    const r = sourceRow.getBoundingClientRect();
    offset = { x: start.x - r.left, y: start.y - r.top };
    ghost = sourceRow.cloneNode(true);
    ghost.classList.add("entry-drag-ghost");
    ghost.style.width = `${r.width}px`;
    ghost.style.left = `${r.left}px`;
    ghost.style.top = `${r.top}px`;
    document.body.appendChild(ghost);
    sourceRow.classList.add("is-drag-source");
    list.classList.add("is-dragging");
    scroller = scrollParent(list);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(15);
  };

  const moveTo = (x, y) => {
    last = { x, y };
    ghost.style.left = `${x - offset.x}px`;
    ghost.style.top = `${y - offset.y}px`;
    const next = rowAt(x, y);
    if (next !== target) {
      target?.classList.remove("is-drop-target");
      target = next;
      target?.classList.add("is-drop-target");
      if (target && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(8);
    }
    ghost.classList.toggle("has-target", !!target);
    autoScroll();
  };

  const autoScroll = () => {
    if (scrollRaf || !scroller) return;
    const step = () => {
      scrollRaf = null;
      if (!lifted) return;
      const h = window.innerHeight;
      const dy = last.y < EDGE_SCROLL ? -8 : last.y > h - EDGE_SCROLL - 90 ? 8 : 0; // 90 ≈ tab bar
      if (dy === 0) return;
      scroller.scrollTop += dy;
      moveTo(last.x, last.y);
      scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  };

  const finish = (drop) => {
    cancelHold();
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
    const wasLifted = lifted;
    const src = sourceRow?.dataset.entryId;
    const dst = target?.dataset.entryId;
    ghost?.remove();
    ghost = null;
    sourceRow?.classList.remove("is-drag-source");
    target?.classList.remove("is-drop-target");
    list.classList.remove("is-dragging");
    lifted = false;
    sourceRow = null;
    target = null;
    start = null;
    if (wasLifted) {
      suppressClick = true; // the click that follows letting go must not open the meal
      setTimeout(() => { suppressClick = false; }, 400);
      if (drop && src && dst) onDrop(src, dst);
    }
  };

  const begin = (row, x, y) => {
    if (!row || !canDrag(row.dataset.entryId)) return;
    sourceRow = row;
    start = { x, y };
    timer = setTimeout(lift, HOLD_MS);
  };

  // --- touch -----------------------------------------------------------------------------------
  const onTouchStart = (e) => {
    if (e.touches.length !== 1 || e.target.closest("button")) return;
    const t = e.touches[0];
    begin(e.target.closest(".entry-row[data-entry-id]"), t.clientX, t.clientY);
  };
  const onTouchMove = (e) => {
    if (!start) return;
    const t = e.touches[0];
    if (!lifted) {
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > SLOP) finish(false); // it's a scroll
      return;
    }
    // held: this gesture belongs to the meal — no page scroll, no tab swipe, no sheet close
    e.preventDefault();
    e.stopPropagation();
    moveTo(t.clientX, t.clientY);
  };
  const onTouchEnd = (e) => {
    if (!start) return;
    if (lifted) e.stopPropagation();
    finish(e.type === "touchend");
  };

  // --- mouse (desktop) ------------------------------------------------------------------------
  const onMouseDown = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    begin(e.target.closest(".entry-row[data-entry-id]"), e.clientX, e.clientY);
  };
  const onMouseMove = (e) => {
    if (!start) return;
    if (!lifted) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) finish(false);
      return;
    }
    e.preventDefault();
    moveTo(e.clientX, e.clientY);
  };
  const onMouseUp = () => { if (start) finish(true); };

  const onClickCapture = (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
  };
  const onContextMenu = (e) => { if (start || lifted) e.preventDefault(); };

  list.addEventListener("touchstart", onTouchStart, { passive: true });
  list.addEventListener("touchmove", onTouchMove, { passive: false });
  list.addEventListener("touchend", onTouchEnd);
  list.addEventListener("touchcancel", onTouchEnd);
  list.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  list.addEventListener("click", onClickCapture, true);
  list.addEventListener("contextmenu", onContextMenu);

  return () => {
    finish(false);
    list.removeEventListener("touchstart", onTouchStart);
    list.removeEventListener("touchmove", onTouchMove);
    list.removeEventListener("touchend", onTouchEnd);
    list.removeEventListener("touchcancel", onTouchEnd);
    list.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    list.removeEventListener("click", onClickCapture, true);
    list.removeEventListener("contextmenu", onContextMenu);
  };
}

let toastTimer = null;

/**
 * Groups the dropped meal into the target and shows "Grouped · ♡ Save · Undo".
 * `refresh` re-renders whichever list the drag happened in.
 */
export function groupWithToast(sourceId, targetId, refresh) {
  const out = store.groupEntries(sourceId, targetId);
  if (!out) return;
  refresh();
  document.getElementById("undo-toast")?.remove();
  clearTimeout(toastTimer);
  const toast = document.createElement("div");
  toast.id = "undo-toast";
  toast.className = "undo-toast group-toast";
  toast.innerHTML = `
    <span class="undo-text">${t("group.done", { name: escapeHtml(out.entry.name) })}</span>
    <button type="button" class="undo-btn" data-save>♡ ${t("group.save")}</button>
    <button type="button" class="undo-btn" data-undo>${t("undo.action")}</button>`;
  document.body.appendChild(toast);
  toast.querySelector("[data-save]").addEventListener("click", (e) => {
    const on = store.toggleFavorite(out.entry.id);
    e.currentTarget.textContent = on ? `♥ ${t("group.saved")}` : `♡ ${t("group.save")}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), 2500);
  });
  toast.querySelector("[data-undo]").addEventListener("click", () => {
    out.undo();
    toast.remove();
    clearTimeout(toastTimer);
    refresh();
  });
  toastTimer = setTimeout(() => toast.remove(), 6000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
