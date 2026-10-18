// share-meal.js — "Share" on a meal: it goes to your group's feed (the group you pick, when
// you're in more than one), the meal remembers it's there (its row then says "Shared"), and a
// note says where it went, with a way to go and see it.

import * as store from "../store.js";
import { t } from "../i18n.js";
import { shareMeal, sharingGroups } from "../social.js";
import { openActionSheet } from "./action-sheet.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let timer = null;

/** A note at the bottom; `see` adds "See it", which opens the Shared tab. */
function note(text, { see = false } = {}) {
  document.getElementById("undo-toast")?.remove();
  clearTimeout(timer);
  const el = document.createElement("div");
  el.id = "undo-toast";
  el.className = "undo-toast";
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="undo-text"></span>${see ? `<button type="button" class="undo-btn">${t("feedShare.see")}</button>` : ""}`;
  el.querySelector(".undo-text").textContent = text;
  el.querySelector(".undo-btn")?.addEventListener("click", () => { el.remove(); globalThis.snapcalGoTo?.("shared"); });
  document.body.appendChild(el);
  timer = setTimeout(() => el.remove(), 5000);
}

const reason = (out) => ({
  photoOnly: t("feedShare.photoOnly"),
  mealLimit: t("feedShare.mealLimit"),
  noGroup: t("feedShare.noGroup"),
  network: t("errors.offline"),
}[out.errorType] ?? (out.message || t("errors.generic")));

/** Whether a meal can go to the feed: done analysing, and with its photo on this phone. */
export const canShare = (entry) => Boolean(entry?.photoDataUrl) && entry.isPending !== true && entry.analysisFailed !== true;

/**
 * Shares `entry` to the feed (`overrides`: edits on screen that aren't saved yet).
 * Resolves true once it's there.
 */
export async function shareToFeed(entry, overrides = {}) {
  const groups = await sharingGroups();
  let group = groups[0] ?? null;
  if (groups.length > 1) {
    group = await new Promise((resolve) => openActionSheet({
      title: t("feedShare.which"),
      actions: [
        ...groups.map((g) => ({ label: esc(g.name), onSelect: () => resolve(g) })),
        { label: t("app.cancel"), cancel: true, onSelect: () => resolve(null) },
      ],
    }));
    if (!group) return false;
  }
  const out = await shareMeal({ ...entry, ...overrides, entryId: entry.id }, "", group?.id ?? null);
  if (!out.ok) { note(reason(out)); return false; }
  if (store.getFoodEntry(entry.id)) store.updateFoodEntry(entry.id, { sharedAt: Date.now() });
  note(t("feedShare.done", { group: out.group?.name ?? group?.name ?? t("social.tab") }), { see: true });
  return true;
}
