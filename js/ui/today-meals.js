// today-meals.js — the "Today" tab: what has been eaten today, and nothing older.
//
// Past days are reachable from Home's week strip; this tab is deliberately just today, so it
// reads like a running receipt of the day rather than a history log.

import * as store from "../store.js";
import { mountEntryRow } from "./entry-row.js";
import { wireMealDrag, groupWithToast, rowIsGroupable } from "./meal-drag.js";
import { openAddFoodSheet } from "./addfood.js";
import { openResultsSheet } from "./results.js";
import { icon } from "./icons.js";
import { deleteWithUndo } from "./undo-delete.js";
import { t, formatNumber, formatDate } from "../i18n.js";
import { localDateString } from "../nutrition.js";

let cleanups = [];
let viewedDay = 0; // 0 = today, -1 = yesterday, …

export function render(container) {
  cleanups.forEach((fn) => fn?.());
  cleanups = [];

  const today = new Date(Date.now() + viewedDay * 86400000);
  const isToday = viewedDay === 0;
  const meals = store.entriesForDay(today).sort((a, b) => b.timestamp - a.timestamp);
  const totals = store.totalsForDay(today);
  const goals = store.computeGoals();
  const energy = store.dayEnergy(today);

  container.innerHTML = `
    <div class="tm-screen">
      <div class="tm-head">
        <button type="button" class="tm-arrow" id="tm-prev" aria-label="${t("day.prevDay")}">‹</button>
        <div class="tm-head-mid">
          <h1 class="tm-title">${isToday ? t("todayTab.title") : formatDate(today, { weekday: "long" })}</h1>
          <div class="tm-date">${formatDate(today, { month: "long", day: "numeric" })}</div>
        </div>
        <button type="button" class="tm-arrow${isToday ? " is-hidden" : ""}" id="tm-next" aria-label="${t("day.nextDay")}">›</button>
      </div>

      <div class="tm-summary">
        <div class="tm-sum-main">
          <div class="tm-sum-num">${formatNumber(Math.round(totals.calories))}</div>
          <div class="tm-sum-label">${t("todayTab.eatenOf", { goal: formatNumber(energy.adjustedTarget) })}</div>
        </div>
        <div class="tm-sum-macros">
          ${[
            ["proteinG", "proteinTargetG", "var(--sc-protein)", "todayTab.protein"],
            ["carbsG", "carbsTargetG", "var(--sc-carbs)", "todayTab.carbs"],
            ["fatG", "fatTargetG", "var(--sc-fat)", "todayTab.fat"],
          ].map(([k, g, c, label]) => {
            const pct = goals[g] > 0 ? Math.min(100, (totals[k] / goals[g]) * 100) : 0;
            return `
              <div class="tm-macro">
                <div class="tm-macro-top"><span>${t(label)}</span><b>${Math.round(totals[k])}g</b></div>
                <div class="tm-macro-bar"><span style="width:${pct}%;background:${c}"></span></div>
              </div>`;
          }).join("")}
        </div>
      </div>

      <div class="tm-count">${t("us.mealsCount", { n: meals.length })}${isToday ? "" : ` · <button type="button" class="tm-back" id="tm-back">${t("home.backToToday")}</button>`}</div>
      <div class="tm-list" id="tm-list"></div>
      <div class="bottom-safe-spacer"></div>
    </div>`;

  container.querySelector("#tm-prev")?.addEventListener("click", () => { viewedDay -= 1; render(container); });
  container.querySelector("#tm-next")?.addEventListener("click", () => { if (viewedDay < 0) { viewedDay += 1; render(container); } });
  container.querySelector("#tm-back")?.addEventListener("click", () => { viewedDay = 0; render(container); });

  cleanups.push(renderMealList(container.querySelector("#tm-list"), today, () => render(container)));
}

// Select mode: one list at a time, kept across redraws of that day's list.
let selecting = null; // { day: "YYYY-MM-DD", ids: Set<string> }

function closeSelectBar() {
  document.getElementById("stack-bar")?.remove();
}

/**
 * One day's meals as rows: tap to edit, ♥ to favourite, bin to remove, hold and drop one on another
 * to stack them. "Select" ticks several at once to Stack, Favourite or (an earlier day) log Today.
 * Used by Home's "Today's meals" mini tab and the day sheet.
 * @returns {() => void} cleanup
 */
export function renderMealList(list, date, onChange) {
  const own = [];
  const meals = store.entriesForDay(date).sort((a, b) => b.timestamp - a.timestamp);
  const dayKey = localDateString(date);
  const isToday = dayKey === localDateString(Date.now());
  if (selecting && selecting.day !== dayKey) selecting = null;
  const sel = selecting?.ids ?? null;
  const redraw = () => onChange();

  if (meals.length === 0) {
    selecting = null;
    closeSelectBar();
    list.innerHTML = `
      <div class="tm-empty">
        ${icon("forkKnife", { size: 38 })}
        <div class="tm-empty-title">${t("todayTab.emptyTitle")}</div>
        <div class="tm-empty-body">${t("todayTab.emptyBody")}</div>
      </div>`;
    return () => {};
  }
  list.innerHTML = `
    <div class="ml-tools">
      ${sel
        ? `<span class="ml-count">${t("stack.selected", { n: sel.size })}</span><button type="button" class="ml-btn" id="ml-cancel">${t("app.cancel")}</button>`
        : `<span class="ml-tip">${isToday ? t("stack.tip") : t("stack.tipPast")}</span><button type="button" class="ml-btn" id="ml-select">${t("stack.select")}</button>`}
    </div>`;
  list.querySelector("#ml-select")?.addEventListener("click", () => { selecting = { day: dayKey, ids: new Set() }; redraw(); });
  list.querySelector("#ml-cancel")?.addEventListener("click", () => { selecting = null; closeSelectBar(); redraw(); });

  for (const entry of meals) {
    own.push(
      mountEntryRow(list, entry, {
        onShare: !entry.photoDataUrl ? null : async (e) => {
          const { shareMeal } = await import("../social.js");
          const out = await shareMeal(store.getFoodEntry(e.id) ?? e);
          return out.ok === true;
        },
        onFavorite: (e) => store.toggleFavorite(e.id),
        onCopyToday: isToday ? null : (e) => { store.copyEntryTo(e.id, Date.now()); toast(t("stack.copiedOne")); },
        select: sel ? { on: true, selected: sel.has(entry.id), onToggle: (e) => { sel.has(e.id) ? sel.delete(e.id) : sel.add(e.id); redraw(); } } : null,
        onTap: (e) => {
          const fresh = store.getFoodEntry(e.id);
          // Photo meals open the item-by-item editor (grams per item); everything else opens
          // the single-food editor, which now edits grams/ml too.
          if (Array.isArray(fresh?.analysisItems) && fresh.analysisItems.length > 0) {
            openResultsSheet(fresh);
          } else {
            openAddFoodSheet({ entry: fresh, onSaved: () => onChange() });
          }
        },
        onDelete: (e) => deleteWithUndo(e, onChange),
      })
    );
  }

  if (sel) showSelectBar(sel, { isToday, onDone: () => { selecting = null; closeSelectBar(); redraw(); } });
  else closeSelectBar();

  own.push(closeSelectBar); // redrawn with the list; gone when the list goes
  own.push(wireMealDrag(list, {
    canDrag: (id) => !selecting && rowIsGroupable(list, id),
    onDrop: (src, dst) => groupWithToast(src, dst, () => onChange()),
  }));
  return () => own.forEach((fn) => fn?.());
}

/** The bar at the bottom while selecting: Stack · ♥ Favourite · + Today (earlier days). */
function showSelectBar(sel, { isToday, onDone }) {
  closeSelectBar();
  const ids = [...sel];
  const kcal = ids.reduce((a, id) => a + (Number(store.getFoodEntry(id)?.calories) || 0), 0);
  const bar = document.createElement("div");
  bar.id = "stack-bar";
  bar.className = "stack-bar";
  bar.innerHTML = `
    <div class="stack-bar-sum">${ids.length ? t("stack.sum", { n: ids.length, kcal: formatNumber(Math.round(kcal)) }) : t("stack.pick")}</div>
    <div class="stack-bar-btns">
      <button type="button" data-act="stack" ${ids.length < 2 ? "disabled" : ""}>${icon("stack", { size: 16 })}${t("stack.stack")}</button>
      <button type="button" data-act="fav" ${ids.length < 1 ? "disabled" : ""}>♡ ${t("stack.favourite")}</button>
      ${isToday ? "" : `<button type="button" data-act="today" ${ids.length < 1 ? "disabled" : ""}>${icon("plus", { size: 14 })}${t("stack.toToday")}</button>`}
    </div>`;
  document.body.appendChild(bar);
  bar.querySelector('[data-act="stack"]').addEventListener("click", () => {
    // oldest first, so the stacked meal keeps the earliest time
    const ordered = ids.map(store.getFoodEntry).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp).map((e) => e.id);
    const out = store.groupMany(ordered);
    onDone();
    if (out) toast(t("group.done", { name: out.entry.name }), { undo: () => { out.undo(); onDone(); } });
  });
  bar.querySelector('[data-act="fav"]').addEventListener("click", () => {
    const saved = store.favouriteMany(ids);
    onDone();
    if (saved) toast(ids.length > 1 ? t("stack.favMany", { n: ids.length }) : t("stack.favOne"));
  });
  bar.querySelector('[data-act="today"]')?.addEventListener("click", () => {
    const now = Date.now();
    ids.map(store.getFoodEntry).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp)
      .forEach((e, i) => store.copyEntryTo(e.id, now + i)); // keep their order
    onDone();
    toast(t("stack.copied", { n: ids.length }));
  });
}

let toastTimer = null;
function toast(text, { undo = null } = {}) {
  document.getElementById("undo-toast")?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.id = "undo-toast";
  el.className = "undo-toast";
  el.innerHTML = `<span class="undo-text"></span>${undo ? `<button type="button" class="undo-btn">${t("undo.action")}</button>` : ""}`;
  el.querySelector(".undo-text").textContent = text;
  el.querySelector(".undo-btn")?.addEventListener("click", () => { undo(); el.remove(); });
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 5000);
}
