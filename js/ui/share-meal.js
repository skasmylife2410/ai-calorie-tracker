// share-meal.js — "Share" on a meal, or on a whole breakfast, lunch, dinner or snack: a short sheet
// shows what's going out, which group it goes to (when you're in more than one) and an optional
// caption; then it goes to that group's feed, the meal(s) remember it's there (the row then says
// "Shared"), and a note says where it went, with a way to go and see it. Any finished meal can be
// shared, with or without a photo. A mealtime goes as one post: its photos as a collage or, with
// none, a picture of its foods drawn by the image model (plate-art.js), or the foods as a board
// (ingredient-board.js) when that can't be drawn.

import * as store from "../store.js";
import { t, formatNumber } from "../i18n.js";
import { shareMeal, shareMealtime, collagePhotos, sharingGroups, CAPTION_MAX } from "../social.js";
import { canShare } from "../mealtime.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { safeSrc } from "../safe-src.js";
import { foodCategory, foodIconSvg } from "./food-icons.js";
import { ingredientBoardHtml } from "./ingredient-board.js";

export { canShare };

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
  mealLimit: t("feedShare.mealLimit"),
  noGroup: t("feedShare.noGroup"),
  network: t("errors.offline"),
}[out.errorType] ?? (out.message || t("errors.generic")));

/**
 * The sheet itself. `previewHtml` is what's going out; `send(caption, groupId)` posts it and
 * answers like api/shares.js; `onShared()` marks the meal(s). Resolves true once it's in the
 * feed, false if it was cancelled or refused.
 */
async function openShareSheet({ previewHtml, send, onShared, afterRender }) {
  const groups = await sharingGroups();
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    let group = groups[0] ?? null;
    openSheet({
      onClosed: () => settle(false),
      render(panel, close) {
        panel.innerHTML = `
          ${navBar({ title: t("feedShare.title"), leading: { label: t("app.cancel") } })}
          <div class="sheet-panel-body shm-body">
            ${previewHtml}
            ${groups.length > 1 ? `
              <div class="shm-label">${t("feedShare.with")}</div>
              <div class="us-groups shm-groups" role="group" aria-label="${t("feedShare.with")}">
                ${groups.map((g) => `<button type="button" data-shm-group="${esc(g.id)}" aria-pressed="${g.id === group.id}">${esc(g.name)}</button>`).join("")}
              </div>` : ""}
            <textarea class="shm-caption" id="shm-caption" rows="3" maxlength="${CAPTION_MAX}" placeholder="${t("feedShare.captionPlaceholder")}" aria-label="${t("feedShare.caption")}"></textarea>
            <div class="shm-count" id="shm-count">0/${CAPTION_MAX}</div>
            <div class="acct-msg is-error" id="shm-err" role="status" hidden></div>
            <button type="button" class="acct-btn is-primary shm-go" id="shm-go">${t("feedShare.to", { group: esc(group?.name ?? t("social.tab")) })}</button>
          </div>`;
        wireNavBar(panel, { onLeading: close });
        afterRender?.(panel);
        const caption = panel.querySelector("#shm-caption");
        const go = panel.querySelector("#shm-go");
        caption.addEventListener("input", () => { panel.querySelector("#shm-count").textContent = `${caption.value.length}/${CAPTION_MAX}`; });
        panel.querySelectorAll("[data-shm-group]").forEach((b) => b.addEventListener("click", () => {
          group = groups.find((g) => g.id === b.dataset.shmGroup) ?? group;
          panel.querySelectorAll("[data-shm-group]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          go.textContent = t("feedShare.to", { group: group.name });
        }));
        go.addEventListener("click", async () => {
          go.disabled = true;
          go.textContent = t("auth.working");
          const out = await send(caption.value, group?.id ?? null);
          if (!out.ok) {
            const err = panel.querySelector("#shm-err");
            err.hidden = false;
            err.textContent = reason(out);
            go.disabled = false;
            go.textContent = t("feedShare.to", { group: group?.name ?? t("social.tab") });
            return;
          }
          onShared();
          settle(true);
          close();
          note(t("feedShare.done", { group: out.group?.name ?? group?.name ?? t("social.tab") }), { see: true });
        });
      },
    });
  });
}

/**
 * Opens the share sheet for `entry` (`overrides`: edits on screen that aren't saved yet).
 * Resolves true once the meal is in the feed, false if it was cancelled or refused.
 */
export function shareToFeed(entry, overrides = {}) {
  const meal = { ...entry, ...overrides };
  const thumb = meal.photoDataUrl
    ? `<img class="shm-thumb" src="${safeSrc(meal.photoDataUrl)}" alt="">`
    : `<span class="shm-thumb is-food" aria-hidden="true">${foodIconSvg(foodCategory(meal), { size: 24 })}</span>`;
  return openShareSheet({
    previewHtml: `
      <div class="shm-meal">${thumb}
        <span class="shm-text"><b>${esc(meal.name)}</b><small>${formatNumber(Math.round(Number(meal.calories) || 0))} kcal</small></span>
      </div>`,
    send: (caption, group) => shareMeal({ ...meal, entryId: entry.id }, caption, group),
    onShared: () => { if (store.getFoodEntry(entry.id)) store.updateFoodEntry(entry.id, { sharedAt: Date.now() }); },
  });
}

/**
 * Opens the share sheet for a whole mealtime (`summary`: mealtime.mealtimeSummary). It shows what
 * will be posted: the collage of the photos or, with none, the image model's picture of the foods
 * (asked for as the sheet opens; the board stands in until it's there, and if it never comes).
 */
export async function shareMealtimeToFeed(summary) {
  const collage = await collagePhotos(summary.photos);
  let picture = collage;   // what goes out as the post's photo
  let drawn = false;
  // started before the sheet is up, so it's drawing while the caption is being written
  const drawing = collage ? null : import("../plate-art.js")
    .then((m) => m.drawPlate(summary.items))
    .then((img) => { if (img) { picture = img; drawn = true; } return img; })
    .catch(() => null);
  const pictureHtml = (src, isDrawn) => `
    <div class="shm-art feed-media"><img class="shm-collage" src="${safeSrc(src)}" alt="">${isDrawn ? `<span class="feed-drawn">${t("feedShare.drawn")}</span>` : ""}</div>`;
  const hero = collage
    ? pictureHtml(collage, false)
    : `<div class="shm-board">${ingredientBoardHtml(summary.items)}</div>
       <div class="shm-drawing" role="status"><span class="left-spin" aria-hidden="true"></span>${t("feedShare.drawing", { meal: t(`mealType.lower.${summary.mealType}`) })}</div>`;
  return openShareSheet({
    previewHtml: `
      <div class="shm-mealtime">
        ${hero}
        <div class="shm-text"><b>${t(`mealType.${summary.mealType}`)} · ${t("stack.foods", { n: summary.items.length })}</b><small>${esc(summary.name)} · ${formatNumber(Math.round(summary.calories))} kcal</small></div>
      </div>`,
    afterRender: (panel) => {
      drawing?.then((img) => {
        if (!panel.isConnected) return;
        panel.querySelector(".shm-drawing")?.remove();
        const board = panel.querySelector(".shm-board");
        if (img && board) board.outerHTML = pictureHtml(img, true);
      });
    },
    // tapped before the picture is ready: wait for it (or for it to fail) rather than post without
    send: async (caption, group) => {
      await drawing;
      return shareMealtime({ ...summary, collage: picture, drawn }, caption, group);
    },
    onShared: () => { const now = Date.now(); for (const id of summary.ids) if (store.getFoodEntry(id)) store.updateFoodEntry(id, { sharedAt: now }); },
  });
}
