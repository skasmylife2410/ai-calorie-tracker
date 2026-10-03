// undo-delete.js — deleting a meal happens at once, and a toast offers Undo for a few seconds.
// Friendlier than a confirm box and much faster when clearing several rows. Used by every list
// that can delete a meal (Home, the day sheet, history, the failed-analysis menu).

import * as store from "../store.js";
import { sfx } from "../sounds.js";
import { t } from "../i18n.js";

export const UNDO_MS = 4000;
let timer = null;

/** Deletes `entry`, calls `onChange` so the list redraws, and shows the Undo toast. */
export function deleteWithUndo(entry, onChange) {
  const snapshot = store.getFoodEntry(entry.id) ?? entry;
  if (!store.deleteFoodEntry(entry.id)) return;
  onChange?.();

  document.getElementById("undo-toast")?.remove();
  clearTimeout(timer);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = document.createElement("div");
  toast.id = "undo-toast";
  toast.className = "undo-toast";
  toast.setAttribute("role", "status");
  toast.innerHTML = `
    <span class="undo-text">${esc(t("undo.removed", { name: snapshot.name ?? "" }))}</span>
    <button type="button" class="undo-btn">${t("undo.action")}</button>`;
  document.body.appendChild(toast);

  toast.querySelector(".undo-btn").addEventListener("click", () => {
    clearTimeout(timer);
    toast.remove();
    store.restoreFoodEntry(snapshot);
    sfx("undo");
    onChange?.();
  });
  timer = setTimeout(() => toast.remove(), UNDO_MS);
}
