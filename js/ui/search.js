// search.js — Food Database search (FoodSearchView.swift), SPEC-UI.md §8.
// Results come in two steps while typing: your own foods and the built-in list show at once
// (they match half-typed words), then /api/foods adds USDA + Open Food Facts (debounced 250ms,
// cached per query so backspacing is instant). Tapping a result puts it on the
// plate at the bottom and the sheet STAYS OPEN, so a whole meal can be built in one go; "Add"
// saves every food on the plate as one meal (see meal-builder.js).

import { offSearchByName, usdaSearchByName, searchFoods } from "../api.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { openAddFoodSheet } from "./addfood.js";
import { searchLocalFoods, normalize } from "../foods-local.js";
import { currentLanguage, t } from "../i18n.js";
import * as store from "../store.js";
import { trayItemFromProduct, withAmount, stepOf, scaled, trayTotals, trayToEntry } from "../meal-builder.js";

const DEBOUNCE_MS = 250;
const RETRY_DELAY_MS = 1200;
// remote answers for this session, by normalized query — backspacing or retyping never re-asks
const remoteCache = new Map();

/**
 * @param {object} [opts]
 * @param {(items:object[])=>void} [opts.onPick]  "pick" mode: the plate's foods are handed back as
 *   meal items (for adding to an existing or saved meal) instead of being logged.
 * @param {string} [opts.pickLabel]  button text in pick mode
 */
export function openFoodSearchSheet({ timestamp = null, onSaved = null, onPick = null, pickLabel = null } = {}) {
  let state = { kind: "idle" }; // idle | loading | results | noResults | error
  let tray = [];            // foods picked so far
  let trayOpen = false;     // amounts list expanded
  let query = "";
  let debounceTimer = null;
  let searchGeneration = 0;
  let inFlight = null;      // AbortController of the remote search being waited on

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({
          title: t("ui.foodDb"),
          leading: { label: t("app.close") },
          trailing: onPick ? null : { label: t("ui.addManually") },
        })}
        <div class="search-field-wrap">
          <div class="search-field">
            ${icon("magnifyingglass", { size: 18 })}
            <input type="text" class="search-input" id="search-input" placeholder="Search foods…"
              autocomplete="off" autocorrect="off" spellcheck="false" />
            <button class="search-clear-btn hidden" id="search-clear">${icon("xmarkCircleFill", { size: 18 })}</button>
          </div>
        </div>
        <div class="sheet-panel-body" id="search-content"></div>
        <div class="tray" id="tray" hidden></div>
      `;

      const input = panel.querySelector("#search-input");
      const clearBtn = panel.querySelector("#search-clear");
      const content = panel.querySelector("#search-content");
      const trayEl = panel.querySelector("#tray");

      const onTray = (key) => tray.some((i) => i.key === key);

      const renderTray = () => {
        trayEl.hidden = tray.length === 0;
        if (tray.length === 0) { trayEl.innerHTML = ""; return; }
        const tot = trayTotals(tray);
        trayEl.innerHTML = `
          ${trayOpen ? `<ul class="tray-list">${tray.map((i, idx) => `
            <li class="tray-item">
              <div class="tray-item-text">
                <div class="tray-item-name">${escapeHtml(i.name)}</div>
                <div class="tray-item-kcal">${scaled(i).calories} kcal, ${scaled(i).proteinG} g protein</div>
              </div>
              <div class="tray-stepper">
                <button type="button" data-step="-1" data-idx="${idx}" aria-label="${t("tray.less")}">−</button>
                <span>${i.amount} ${i.per.unit === "serving" ? t("tray.serv") : i.per.unit}</span>
                <button type="button" data-step="1" data-idx="${idx}" aria-label="${t("tray.more")}">+</button>
              </div>
              <button type="button" class="tray-remove" data-remove="${idx}" aria-label="${t("tray.remove", { name: escapeHtml(i.name) })}">×</button>
            </li>`).join("")}</ul>` : ""}
          <div class="tray-bar">
            <button type="button" class="tray-summary" id="tray-toggle" aria-expanded="${trayOpen}">
              <span class="tray-count">${tray.length}</span>
              <span>${t(tray.length === 1 ? "tray.one" : "tray.many", { n: tray.length })}, ${tot.calories} kcal</span>
              <span class="tray-caret">${trayOpen ? "▾" : "▴"}</span>
            </button>
            <button type="button" class="tray-add" id="tray-add">${onPick ? escapeHtml(pickLabel ?? t("group.addToMeal")) : t("tray.add")}</button>
          </div>`;
        trayEl.querySelector("#tray-toggle").addEventListener("click", () => { trayOpen = !trayOpen; renderTray(); });
        trayEl.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
          const i = tray[Number(b.dataset.idx)];
          tray[Number(b.dataset.idx)] = withAmount(i, i.amount + Number(b.dataset.step) * stepOf(i));
          renderTray();
        }));
        trayEl.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
          tray.splice(Number(b.dataset.remove), 1);
          if (tray.length === 0) trayOpen = false;
          renderTray();
          renderState();
        }));
        trayEl.querySelector("#tray-add").addEventListener("click", () => {
          if (onPick) {
            onPick(trayToEntry(tray).analysisItems);
            close();
            return;
          }
          const saved = store.addFoodEntry(trayToEntry(tray, timestamp ?? Date.now()));
          if (typeof onSaved === "function") onSaved(saved);
          close();
        });
      };

      const toggleProduct = (product) => {
        const item = trayItemFromProduct(product);
        const at = tray.findIndex((i) => i.key === item.key);
        if (at >= 0) tray.splice(at, 1);
        else tray.push(item);
        renderTray();
        renderState();
      };

      const renderState = () => {
        clearBtn.classList.toggle("hidden", query === "");
        if (state.kind === "idle") {
          // Before anything is typed: your own foods (favourites, then recent), one tap to add.
          const mine = store.quickFoods(12);
          if (mine.length === 0) {
            content.innerHTML = emptyStateHtml({
              iconName: "magnifyingglass",
              title: t("ui.searchTitle"),
              message: t("ui.searchSub"),
            });
          } else {
            content.innerHTML = `<p class="tray-hint">${t("group.yourFoods")}</p><div class="search-results">${mine.map((p, i) => resultRowHtml(p, i, onTray(trayItemFromProduct(p).key), { noDetails: true })).join("")}</div>`;
            content.querySelectorAll("[data-result-idx]").forEach((row) => {
              row.addEventListener("click", () => toggleProduct(mine[Number(row.dataset.resultIdx)]));
            });
          }
        } else if (state.kind === "loading") {
          content.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
        } else if (state.kind === "results") {
          const footer = state.loadingMore
            ? `<div class="loading-center search-more"><div class="spinner"></div></div>`
            : state.remoteFailed
              ? `<div class="empty-state search-more"><div class="empty-state-message">${t("ui.searchDown")}</div><button class="btn-bordered" style="width:auto;padding:8px 20px;" data-retry>${t("app.retry")}</button></div>`
              : "";
          content.innerHTML = `<p class="tray-hint">${t("tray.hint")}</p><div class="search-results">${state.products.map((p, i) => resultRowHtml(p, i, onTray(trayItemFromProduct(p).key))).join("")}</div>${footer}`;
          wireRetry(content);
          content.querySelectorAll("[data-result-idx]").forEach((row) => {
            row.addEventListener("click", () => toggleProduct(state.products[Number(row.dataset.resultIdx)]));
            row.addEventListener("keydown", (e) => {
              if (e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleProduct(state.products[Number(row.dataset.resultIdx)]); }
            });
          });
          content.querySelectorAll("[data-edit-idx]").forEach((b) => {
            b.addEventListener("click", (e) => {
              e.stopPropagation();
              const product = state.products[Number(b.dataset.editIdx)];
              // in pick mode nothing gets logged on its own; the food just goes on the plate
              if (onPick) toggleProduct(product);
              else openAddFoodSheet({ prefill: product, timestamp, onSaved });
            });
          });
        } else if (state.kind === "noResults") {
          content.innerHTML = emptyStateHtml({
            iconName: "questionmarkCircle",
            title: t("ui.noResults"),
            message: t("ui.noResultsBody", { q: escapeHtml(state.query) }),
            retry: true,
          });
          wireRetry(content);
        } else if (state.kind === "error") {
          content.innerHTML = emptyStateHtml({
            iconName: "wifiSlash",
            title: t("ui.searchDown"),
            message: escapeHtml(state.message),
            retry: true,
          });
          wireRetry(content);
        }
      };

      const runSearch = async () => {
        const trimmed = query.trim();
        if (trimmed === "") {
          state = { kind: "idle" };
          renderState();
          return;
        }
        const generation = ++searchGeneration;
        inFlight?.abort();
        inFlight = null;

        // Your own foods and the built-in list match half-typed words ("pech", "arep") and need
        // no network, so they show at once while the databases are asked.
        const lang = currentLanguage() === "es" ? "es" : "en";
        const local = dedupe([...searchMyFoods(trimmed), ...searchLocalFoods(trimmed, { lang })]);
        const key = normalize(trimmed);
        const cached = remoteCache.get(key);
        if (cached) {
          state = { kind: "results", products: dedupe([...local, ...cached]) };
          renderState();
          return;
        }
        if (trimmed.length < 2) {
          state = local.length > 0 ? { kind: "results", products: local } : { kind: "idle" };
          renderState();
          return;
        }
        state = local.length > 0 ? { kind: "results", products: local, loadingMore: true } : { kind: "loading" };
        renderState();

        const controller = new AbortController();
        inFlight = controller;
        const remote = await fetchRemote(trimmed, controller.signal);
        if (generation !== searchGeneration) return; // superseded by a newer search
        inFlight = null;

        if (remote.status === "success") {
          if (!remote.partial) remoteCache.set(key, remote.products);
          const products = dedupe([...local, ...remote.products]);
          state = products.length > 0 ? { kind: "results", products } : { kind: "noResults", query: trimmed };
        } else if (local.length > 0) {
          state = { kind: "results", products: local, remoteFailed: true };
        } else {
          state = { kind: "error", message: remote.message };
        }
        renderState();
      };

      const wireRetry = (contentEl) => {
        const btn = contentEl.querySelector("[data-retry]");
        if (btn) btn.addEventListener("click", runSearch);
      };

      input.addEventListener("input", () => {
        query = input.value;
        clearBtn.classList.toggle("hidden", query === "");
        clearTimeout(debounceTimer);
        if (query.trim() === "") {
          searchGeneration += 1; // cancel any in-flight result application
          inFlight?.abort();
          state = { kind: "idle" };
          renderState();
          return;
        }
        debounceTimer = setTimeout(runSearch, remoteCache.has(normalize(query)) ? 0 : DEBOUNCE_MS);
      });

      clearBtn.addEventListener("click", () => {
        query = "";
        input.value = "";
        clearTimeout(debounceTimer);
        searchGeneration += 1;
        inFlight?.abort();
        state = { kind: "idle" };
        renderState();
        input.focus();
      });

      wireNavBar(panel, {
        onLeading: () => close(),
        onTrailing: onPick ? null : () => openAddFoodSheet({ timestamp, onSaved }),
      });

      renderState();
      setTimeout(() => input.focus(), 350);
    },
  });
}

/**
 * USDA + Open Food Facts for one query. Tries the app's own /api/foods first; if that can't be
 * reached (older deploy, local dev server) it asks the two databases directly, as before. A
 * failure is retried once on its own after a moment, so a brief hiccup never needs a tap.
 */
async function fetchRemote(query, signal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      if (signal.aborted) break;
    }
    const viaServer = await searchFoods(query, { signal });
    if (viaServer.status === "success" || viaServer.aborted) return viaServer;
    const [usda, off] = await Promise.all([usdaSearchByName(query), offSearchByName(query)]);
    if (usda.status === "success" || off.status === "success") {
      const products = [
        ...(usda.status === "success" ? usda.products : []),
        ...(off.status === "success" ? off.products : []),
      ];
      return { status: "success", products, partial: usda.status !== "success" || off.status !== "success" };
    }
    if (attempt === 1) return { status: "failed", message: off.message || viaServer.message };
  }
  return { status: "failed", message: "Search cancelled", aborted: true };
}

/** Foods you've logged or saved whose name matches every typed word (prefixes count). */
function searchMyFoods(query, limit = 5) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return store.quickFoods(200)
    .filter((p) => {
      const words = normalize(p.name).split(/[^a-z0-9]+/).filter(Boolean);
      return terms.every((term) => words.some((w) => w.startsWith(term)));
    })
    .slice(0, limit);
}

/** First occurrence wins, compared by name (and brand) ignoring case and accents. */
function dedupe(products) {
  const seen = new Set();
  return products.filter((p) => {
    const key = `${normalize(p.name)}|${normalize(p.brand ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resultRowHtml(product, idx, picked = false, { noDetails = false } = {}) {
  return `
    <div class="search-result-row card${picked ? " is-picked" : ""}" data-result-idx="${idx}" role="button" tabindex="0" aria-pressed="${picked}">
      <div class="search-result-left">
        <div class="search-result-name">${escapeHtml(product.name)}</div>
        ${product.brand ? `<div class="search-result-brand">${escapeHtml(product.brand)}</div>` : ""}
        ${noDetails ? "" : `<button type="button" class="search-result-edit" data-edit-idx="${idx}">${t("tray.details")}</button>`}
      </div>
      <div class="search-result-right">
        <div class="search-result-cal">${Math.round(product.calories)} kcal</div>
        <div class="search-result-serving">${escapeHtml(product.servingDescription)}</div>
      </div>
      <span class="search-result-pick" aria-hidden="true">${picked ? "✓" : "+"}</span>
    </div>
  `;
}

function emptyStateHtml({ iconName, title, message, retry = false }) {
  return `
    <div class="empty-state">
      ${icon(iconName, { size: 40 })}
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-message">${message}</div>
      ${retry ? `<button class="btn-bordered" style="width:auto;padding:8px 20px;" data-retry>${t("app.retry")}</button>` : ""}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
