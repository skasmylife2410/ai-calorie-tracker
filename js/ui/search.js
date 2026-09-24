// search.js — Food Database search (FoodSearchView.swift), SPEC-UI.md §8.
// Backed by Open Food Facts name search (debounced 400ms). Tapping a result puts it on the
// plate at the bottom and the sheet STAYS OPEN, so a whole meal can be built in one go; "Add"
// saves every food on the plate as one meal (see meal-builder.js).

import { offSearchByName, usdaSearchByName } from "../api.js";
import { icon } from "./icons.js";
import { openSheet, navBar, wireNavBar } from "./sheet.js";
import { openAddFoodSheet } from "./addfood.js";
import { searchLocalFoods } from "../foods-local.js";
import { currentLanguage, t } from "../i18n.js";
import * as store from "../store.js";
import { trayItemFromProduct, withAmount, stepOf, scaled, trayTotals, trayToEntry } from "../meal-builder.js";

const DEBOUNCE_MS = 400;

export function openFoodSearchSheet({ timestamp = null, onSaved = null } = {}) {
  let state = { kind: "idle" }; // idle | loading | results | noResults | error
  let tray = [];            // foods picked so far
  let trayOpen = false;     // amounts list expanded
  let query = "";
  let debounceTimer = null;
  let searchGeneration = 0;

  openSheet({
    render(panel, close) {
      panel.innerHTML = `
        ${navBar({
          title: "Food Database",
          leading: { label: "Close" },
          trailing: { label: "Add manually" },
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
            <button type="button" class="tray-add" id="tray-add">${t("tray.add")}</button>
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
          content.innerHTML = emptyStateHtml({
            iconName: "magnifyingglass",
            title: "Search the food database",
            message: "Find packaged foods by name or brand.",
          });
        } else if (state.kind === "loading") {
          content.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
        } else if (state.kind === "results") {
          content.innerHTML = `<p class="tray-hint">${t("tray.hint")}</p><div class="search-results">${state.products.map((p, i) => resultRowHtml(p, i, onTray(trayItemFromProduct(p).key))).join("")}</div>`;
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
              openAddFoodSheet({ prefill: product, timestamp, onSaved });
            });
          });
        } else if (state.kind === "noResults") {
          content.innerHTML = emptyStateHtml({
            iconName: "questionmarkCircle",
            title: "No results",
            message: `No foods found for “${escapeHtml(state.query)}”. Try a different search, or add it manually.`,
            retry: true,
          });
          wireRetry(content);
        } else if (state.kind === "error") {
          content.innerHTML = emptyStateHtml({
            iconName: "wifiSlash",
            title: "Search unavailable",
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
        // Built-in foods match partial words ("pech", "arep") and need no network, so they
        // show immediately while the databases are still being asked. Both remote sources
        // only match whole words, which is why typing half a word used to return nothing.
        const local = searchLocalFoods(trimmed, { lang: currentLanguage() === "es" ? "es" : "en" });
        state = local.length > 0 ? { kind: "results", products: local, loadingMore: true } : { kind: "loading" };
        renderState();
        // USDA covers plain whole foods with clean names ("Bananas, raw"); OFF covers branded
        // packaged products. Both run in parallel; USDA's cleaner matches lead the list, since a
        // person typing "banana" almost always means the fruit, not a branded banana product.
        const [usda, off] = await Promise.all([usdaSearchByName(trimmed), offSearchByName(trimmed)]);
        if (generation !== searchGeneration) return; // superseded by a newer search

        const usdaProducts = usda.status === "success" ? usda.products : [];
        const offProducts = off.status === "success" ? off.products : [];
        // built-in first (they matched what was actually typed), then the databases, no repeats
        const seen = new Set(local.map((p) => p.name.toLowerCase()));
        const remote = [...usdaProducts, ...offProducts].filter((p) => {
          const key = String(p.name ?? "").toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const products = [...local, ...remote];

        if (products.length > 0) {
          state = { kind: "results", products };
        } else if (usda.status === "failed" && off.status === "failed") {
          state = { kind: "error", message: off.message };
        } else {
          state = { kind: "noResults", query: trimmed };
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
          state = { kind: "idle" };
          renderState();
          return;
        }
        debounceTimer = setTimeout(runSearch, DEBOUNCE_MS);
      });

      clearBtn.addEventListener("click", () => {
        query = "";
        input.value = "";
        clearTimeout(debounceTimer);
        searchGeneration += 1;
        state = { kind: "idle" };
        renderState();
        input.focus();
      });

      wireNavBar(panel, {
        onLeading: () => close(),
        onTrailing: () => openAddFoodSheet({ timestamp, onSaved }),
      });

      renderState();
      setTimeout(() => input.focus(), 350);
    },
  });
}

function resultRowHtml(product, idx, picked = false) {
  return `
    <div class="search-result-row card${picked ? " is-picked" : ""}" data-result-idx="${idx}" role="button" tabindex="0" aria-pressed="${picked}">
      <div class="search-result-left">
        <div class="search-result-name">${escapeHtml(product.name)}</div>
        ${product.brand ? `<div class="search-result-brand">${escapeHtml(product.brand)}</div>` : ""}
        <button type="button" class="search-result-edit" data-edit-idx="${idx}">${t("tray.details")}</button>
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
      ${retry ? `<button class="btn-bordered" style="width:auto;padding:8px 20px;" data-retry>Try again</button>` : ""}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
